import { statSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  HealthCarried, HealthContributor, HealthFixes, HealthKind, HealthPass, HealthReach, HealthStorage, HealthSummary,
  SessionAgent, SessionContextFile,
} from "@amc/contracts";
import type { Db } from "../db/database";
import type { Library } from "../library/library";
import { walk } from "../library/paths";
import type { Review } from "../review/review";
import { contextOf } from "../sessions/context";
import { whyWait } from "../sessions/power";
import type { Skills } from "../setup/skills";

/** How many of the newest conversations the measures are over. */
export const RECENT_SESSIONS = 200;
const CONTRIBUTORS = 8;
const WIDEST = 5;

const KIND_OF_ROLE: Record<string, HealthKind> = {
  Instructions: "instructions", Memory: "memory", "Skill list": "skills", "MCP instructions": "mcp", Hook: "hooks",
};
const KINDS: readonly HealthKind[] = ["instructions", "memory", "skills", "mcp", "hooks"];
const AGENTS: readonly SessionAgent[] = ["claude", "codex"];

const otherWork = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
const bytesOf = (text: string): number => Buffer.byteLength(text, "utf8");

type Recent = { path: string; agent: SessionAgent; cwd: string | null; size: number; mtime_ms: number };
type Loaded = { agent: SessionAgent; recorded: boolean; files: SessionContextFile[] };

export type HealthDeps = {
  db: Db;
  /** The home folder whose files are measured. Nothing is written under it. */
  home: string;
  library: Pick<Library, "inspect">;
  review: Pick<Review, "scan" | "proposal">;
  skills: Pick<Skills, "list">;
  /** Why the reading should wait, or null. */
  whyWait?: () => string | null;
  waitMs?: number;
};

/**
 * What agents carry into a session and keep on disk, counted.
 *
 * What a session loaded is read from its transcript once and kept in `session_context`, keyed by the
 * file's size and time like the index's own rows. A session's number is everything it loaded, so a
 * nested instruction file picked up part-way through is in it.
 */
export class Health {
  private state: HealthPass["state"] = "idle";
  private pausedWhy: string | null = null;
  private reading: Promise<void> | null = null;
  private stopped = false;

  constructor(private d: HealthDeps) {}

  /** The newest conversations a person had: programs' one-shot calls and sub-agents are not what a person sat through. */
  private recent(): Recent[] {
    return this.d.db.prepare(`
      SELECT path, agent, cwd, size, mtime_ms FROM sessions WHERE origin IN ('person', 'app') ORDER BY mtime_ms DESC, path LIMIT ?
    `).all(RECENT_SESSIONS) as Recent[];
  }

  private unread(): Recent[] {
    const held = this.d.db.prepare("SELECT 1 FROM session_context WHERE path = ? AND size = ? AND mtime_ms = ?");
    return this.recent().filter((session) => held.get(session.path, session.size, session.mtime_ms) === undefined);
  }

  /** Read what each recent session loaded, waiting while the Mac should be left alone. A second call joins the first. */
  refresh(): Promise<void> {
    this.reading ??= this.read().finally(() => {
      this.state = "idle";
      this.reading = null;
    });
    return this.reading;
  }

  start(): void {
    this.refresh().catch((e: unknown) => { process.stderr.write(`health: ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`); });
  }

  stop(): void { this.stopped = true; }

  private async read(): Promise<void> {
    const why = this.d.whyWait ?? whyWait;
    const keep = this.d.db.prepare("INSERT OR REPLACE INTO session_context (path, size, mtime_ms, recorded, files_json) VALUES (?, ?, ?, ?, ?)");
    for (const session of this.unread()) {
      for (;;) {
        if (this.stopped) return;
        this.pausedWhy = why();
        if (this.pausedWhy === null) break;
        this.state = "paused";
        await new Promise((resolve) => setTimeout(resolve, this.d.waitMs ?? 30_000));
      }
      this.state = "reading";
      let context: ReturnType<typeof contextOf>;
      // A transcript that went since the index listed it has nothing to read; the index drops its row on its next look.
      try { context = contextOf(session, this.d); } catch { continue; }
      keep.run(session.path, session.size, session.mtime_ms, context.recorded ? 1 : 0, JSON.stringify(context.files));
      await otherWork();
    }
  }

  status(): HealthPass {
    const recent = this.recent();
    const unread = this.unread().length;
    if (unread > 0 && this.reading === null && !this.stopped) this.start();
    return { state: unread === 0 ? "idle" : this.state === "idle" ? "reading" : this.state, sessions: recent.length, read: recent.length - unread, pausedWhy: this.state === "paused" ? this.pausedWhy : null };
  }

  private loaded(): Loaded[] {
    const held = this.d.db.prepare("SELECT recorded, files_json FROM session_context WHERE path = ? AND size = ? AND mtime_ms = ?");
    const out: Loaded[] = [];
    for (const session of this.recent()) {
      const row = held.get(session.path, session.size, session.mtime_ms) as { recorded: number; files_json: string } | undefined;
      if (row) out.push({ agent: session.agent, recorded: row.recorded === 1, files: JSON.parse(row.files_json) as SessionContextFile[] });
    }
    return out;
  }

  summary(): HealthSummary {
    const pass = this.status();
    const loaded = this.loaded();
    // The scan reads the disk again, so the library's files below are the ones the findings are about.
    const { findings } = this.d.review.scan();
    const counted = new Map(AGENTS.map((agent) => [agent, loaded.filter((session) => session.agent === agent && session.files.length > 0).length]));

    /** Which sessions loaded each library file, by the session's place in `loaded`. */
    const loads = new Map<string, Set<number>>();
    for (const [n, session] of loaded.entries()) {
      for (const file of session.files) {
        if (file.libraryId === null) continue;
        if (!loads.has(file.libraryId)) loads.set(file.libraryId, new Set());
        loads.get(file.libraryId)!.add(n);
      }
    }

    return {
      pass,
      carried: this.carried(loaded),
      contributors: this.contributors(loaded),
      reach: this.reach(findings, loads),
      fixes: this.fixes(findings, loads, loaded, counted),
      storage: this.storage(),
    };
  }

  private carried(loaded: readonly Loaded[]): HealthCarried[] {
    return AGENTS.flatMap((agent) => {
      const sessions = loaded.filter((session) => session.agent === agent);
      if (sessions.length === 0) return [];
      const carrying = sessions.filter((session) => session.files.length > 0);
      const mean = (kind: HealthKind): number => {
        let chars = 0;
        for (const session of carrying) for (const file of session.files) if (KIND_OF_ROLE[file.role] === kind) chars += file.chars;
        return carrying.length === 0 ? 0 : Math.round(chars / carrying.length);
      };
      const kinds = KINDS.map((kind) => ({ kind, chars: mean(kind) })).filter((k) => k.chars > 0);
      return [{
        agent, sessions: carrying.length, empty: sessions.length - carrying.length, recorded: sessions.some((session) => session.recorded),
        chars: kinds.reduce((sum, k) => sum + k.chars, 0), kinds,
      }];
    });
  }

  private contributors(loaded: readonly Loaded[]): HealthContributor[] {
    const byName = new Map<string, HealthContributor>();
    for (const session of loaded) {
      for (const file of session.files) {
        const kind = KIND_OF_ROLE[file.role];
        if (kind === undefined) continue;
        const key = `${session.agent}\n${kind}\n${file.displayPath}`;
        const known = byName.get(key);
        // Sessions are newest first, so the first size seen is the size it was last loaded at.
        if (known) known.sessions++;
        else byName.set(key, { agent: session.agent, kind, label: file.displayPath, libraryId: file.libraryId, chars: file.chars, sessions: 1 });
      }
    }
    return [...byName.values()].sort((a, b) => b.chars * b.sessions - a.chars * a.sessions || a.label.localeCompare(b.label)).slice(0, CONTRIBUTORS);
  }

  private reach(findings: ReturnType<Review["scan"]>["findings"], loads: ReadonlyMap<string, Set<number>>): HealthReach {
    const sizes = new Map(this.d.library.inspect().map((file) => [file.entry.id, file.text.length]));
    const files = new Set<string>();
    const touched = new Set<number>();
    const widest: HealthReach["widest"] = [];
    for (const finding of findings) {
      const sessions = new Set<number>();
      for (const subject of finding.subjects) {
        if (subject.id === null) continue;
        files.add(subject.id);
        for (const n of loads.get(subject.id) ?? []) { sessions.add(n); touched.add(n); }
      }
      if (sessions.size > 0) widest.push({ fingerprint: finding.fingerprint, type: finding.type, title: finding.title, sessions: sessions.size });
    }
    return {
      findings: findings.length, files: files.size,
      chars: [...files].reduce((sum, id) => sum + (sizes.get(id) ?? 0), 0),
      sessions: touched.size,
      widest: widest.sort((a, b) => b.sessions - a.sessions || a.title.localeCompare(b.title)).slice(0, WIDEST),
    };
  }

  private fixes(
    findings: ReturnType<Review["scan"]>["findings"], loads: ReadonlyMap<string, Set<number>>,
    loaded: readonly Loaded[], counted: ReadonlyMap<SessionAgent, number>,
  ): HealthFixes {
    const ready = findings.filter((finding) => finding.fix !== null && !finding.needsDraft);
    // Two findings can propose to change one file; it is counted as the first leaves it.
    const changes = new Map<string, { before: string; after: string | null }>();
    for (const finding of ready) {
      // A finding whose cause went between the scan and now has nothing to propose.
      let proposed: ReturnType<Review["proposal"]>;
      try { proposed = this.d.review.proposal(finding.fingerprint); } catch { continue; }
      for (const change of proposed) if (!changes.has(change.id)) changes.set(change.id, change);
    }
    const saved = new Map<SessionAgent, number>(AGENTS.map((agent) => [agent, 0]));
    let bytesFreed = 0, filesRemoved = 0;
    for (const [id, change] of changes) {
      bytesFreed += bytesOf(change.before) - bytesOf(change.after ?? "");
      if (change.after === null) filesRemoved++;
      const fewer = change.before.length - (change.after ?? "").length;
      for (const n of loads.get(id) ?? []) saved.set(loaded[n]!.agent, saved.get(loaded[n]!.agent)! + fewer);
    }
    return {
      ready: ready.length, filesRemoved, filesChanged: changes.size - filesRemoved, bytesFreed,
      perSession: AGENTS.filter((agent) => counted.get(agent)! > 0).map((agent) => ({ agent, chars: Math.round(saved.get(agent)! / counted.get(agent)!) })),
    };
  }

  private storage(): HealthStorage[] {
    const memory = new Map(this.d.library.inspect().map((file) => [file.real, file.entry.size]));
    const skillFiles = new Map<string, number>();
    for (const skill of this.d.skills.list()) {
      const folder = dirname(skill.path);
      for (const rel of walk(folder, () => true)) skillFiles.set(join(folder, rel), statSync(join(folder, rel), { throwIfNoEntry: false })?.size ?? 0);
    }
    const transcripts = new Map((this.d.db.prepare(`
      SELECT CASE WHEN origin IN ('person', 'app') THEN 'conversations' WHEN origin = 'one-shot' THEN 'one-shot' ELSE 'sub-agents' END AS kind,
        COUNT(*) AS files, COALESCE(SUM(size), 0) AS bytes
      FROM sessions GROUP BY kind
    `).all() as HealthStorage[]).map((row) => [row.kind, row]));
    const sum = (sizes: ReadonlyMap<string, number>): number => [...sizes.values()].reduce((total, size) => total + size, 0);
    return [
      { kind: "memory", files: memory.size, bytes: sum(memory) },
      { kind: "skills", files: skillFiles.size, bytes: sum(skillFiles) },
      ...(["conversations", "one-shot", "sub-agents"] as const).map((kind) => transcripts.get(kind) ?? { kind, files: 0, bytes: 0 }),
    ];
  }
}
