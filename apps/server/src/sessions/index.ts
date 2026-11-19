import { statSync } from "node:fs";
import { basename } from "node:path";
import type { Session, SessionFacets, SessionFilter, SessionIndexStatus, SessionMetrics } from "@amc/contracts";
import type { Db } from "../db/database";
import type { Library } from "../library/library";
import { realOr, tildify } from "../library/paths";
import { projectRoot, type Project } from "../library/projects";
import { realmDb } from "../library/realm-names";
import { RpcError } from "../rpc/error";
import { findTranscripts, type Transcript } from "./discover";
import { originOf, recounted } from "./origin";
import { whyWait } from "./power";
import { readRealmSessions, type RealmRow } from "./realm-sessions";
import { Scan } from "./scan";

/** How much of a file the first look reads, with no one line counted for more than `HEAD_LINE_BYTES`. */
const HEAD_BYTES = 128 * 1024;
const HEAD_LINE_BYTES = 8 * 1024;
/** How much of a file the second look reads before it lets other work in. */
const SLICE_BYTES = 8 * 1024 * 1024;
/** How many files the first look takes between letting other work in, and writes in one transaction. */
const LOOK_BATCH = 10;
/** A list asked for this long after the last first look starts another, so new sessions turn up. */
const STALE_MS = 60_000;

const otherWork = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

type Row = {
  path: string; size: number; mtime_ms: number; id: string; agent: Session["agent"]; origin: Session["origin"]; driven_by: string | null;
  title: string; cwd: string | null; project_id: string | null; project_name: string | null; model: string | null;
  started_at: number; parent_id: string | null; realm_json: string | null; metrics_json: string | null; children: number;
};

const COLUMNS = "s.*, (SELECT COUNT(*) FROM sessions c WHERE c.parent_id = s.id) AS children";

export type SessionIndexDeps = {
  db: Db;
  /** The home folder whose transcripts are indexed. Nothing is written under it. */
  home: string;
  library: Pick<Library, "projects">;
  /** Why the second look should wait, or null. */
  whyWait?: () => string | null;
  /** How long a waiting second look leaves it before asking again. */
  waitMs?: number;
};

/**
 * Every transcript on disk as a row in the app's own database, keyed by path with the size and
 * time it was written, so a file that has not changed is never opened again. The first look reads
 * each file's head and makes the list usable; the second reads every file whole, one at a time,
 * for what can only be counted.
 */
export class SessionIndex {
  private state: SessionIndexStatus["state"] = "idle";
  private pausedWhy: string | null = null;
  private files = 0;
  private looked = 0;
  private lookedAt = 0;
  private refreshing: Promise<void> | null = null;
  private stopped = false;

  constructor(private d: SessionIndexDeps) {
    this.files = this.count("");
    this.looked = this.files;
  }

  /** Look at every file, then measure what is unmeasured. One at a time: a second call joins the first. */
  refresh(): Promise<void> {
    this.refreshing ??= this.look().then(() => this.measure()).finally(() => {
      this.state = "idle";
      this.refreshing = null;
    });
    return this.refreshing;
  }

  /** The same, for a caller that will not wait: a failure is said on stderr, where the app keeps the server's log. */
  start(): void {
    this.refresh().catch((e: unknown) => { process.stderr.write(`sessions: ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`); });
  }

  stop(): void { this.stopped = true; }

  // ─── The first look ───────────────────────────────────────────────────────────────────────────

  async look(): Promise<void> {
    const { db } = this.d;
    this.state = "listing";
    const found = findTranscripts(this.d.home);
    this.files = found.length;
    this.looked = 0;
    const realm = readRealmSessions(realmDb(this.d.home));
    const known = new Map((db.prepare("SELECT path, size, mtime_ms FROM sessions").all() as Pick<Row, "path" | "size" | "mtime_ms">[]).map((row) => [row.path, row]));
    // Asked for once: the library reads its whole home again when what it holds has gone stale.
    const projects = { all: this.d.library.projects(), at: new Map<string, Project | null>() };

    for (let from = 0; from < found.length && !this.stopped; from += LOOK_BATCH) {
      db.exec("BEGIN");
      try {
        for (const transcript of found.slice(from, from + LOOK_BATCH)) {
          const stat = statSync(transcript.path, { throwIfNoEntry: false });
          const held = known.get(transcript.path);
          known.delete(transcript.path);
          if (!stat) { db.prepare("DELETE FROM sessions WHERE path = ?").run(transcript.path); continue; }
          const written = Math.floor(stat.mtimeMs);
          if (held?.size !== stat.size || held.mtime_ms !== written) this.firstLook(transcript, stat.size, written, Math.floor(stat.birthtimeMs), realm, projects);
          this.looked++;
        }
        db.exec("COMMIT");
      } catch (e) { db.exec("ROLLBACK"); throw e; }
      await otherWork();
    }
    for (const gone of known.keys()) db.prepare("DELETE FROM sessions WHERE path = ?").run(gone);
    this.lookedAt = Date.now();
    this.state = "idle";
  }

  private firstLook(
    transcript: Transcript, size: number, written: number, created: number,
    realm: Map<string, RealmRow> | null, projects: { all: readonly Project[]; at: Map<string, Project | null> },
  ): void {
    const scan = new Scan(transcript.path, transcript.agent);
    try { scan.step(HEAD_BYTES, HEAD_LINE_BYTES); } finally { scan.close(); }
    const { facts } = scan;
    const name = basename(transcript.path, ".jsonl");
    // A Claude file is named for its session. A sub-agent's records carry its parent's id, so it goes by both names.
    const id = transcript.agent === "codex" ? facts.sessionId ?? name : transcript.parentId === null ? name : `${transcript.parentId}:${name}`;
    const realmRow = realm?.get(id) ?? null;
    const origin = originOf({
      // `isSidechain` is not asked: older Claude files kept a sub-agent's records inside its parent's file.
      subAgent: transcript.parentId !== null || (transcript.agent === "codex" && facts.subAgent),
      parentId: transcript.parentId ?? facts.parentId,
      startedBy: facts.startedBy, userTurns: scan.userTurns, realm: realmRow,
    });
    if (facts.cwd !== null && !projects.at.has(facts.cwd)) {
      // A worktree's sessions belong to its repository, as its files do in the library.
      const root = projectRoot(realOr(facts.cwd));
      projects.at.set(facts.cwd, projects.all.find((project) => project.root === root) ?? null);
    }
    const project = facts.cwd === null ? null : projects.at.get(facts.cwd) ?? null;
    const drove = origin.drivenBy === "Realm" && realmRow !== null ? { title: realmRow.title, space: realmRow.space, teammate: realmRow.teammate } : null;
    // A Codex sub-agent's file holds no turn in the person's role, so there is nothing asked to name it by.
    const title = facts.title ?? scan.firstAsked ?? (origin.origin === "sub-agent" ? "Sub-agent" : "Untitled");
    this.d.db.prepare(`
      INSERT OR REPLACE INTO sessions (path, size, mtime_ms, id, agent, origin, driven_by, title, cwd, project_id, project_name, model, started_at, parent_id, realm_json, metrics_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `).run(
      transcript.path, size, written, id, transcript.agent, origin.origin, origin.drivenBy,
      title, facts.cwd, project?.id ?? null, project?.name ?? null, facts.model,
      facts.startedAt ?? created, origin.parentId, drove && JSON.stringify(drove),
    );
  }

  // ─── The second look ──────────────────────────────────────────────────────────────────────────

  /** Measure every file that has no measurements, newest first, waiting while the Mac should be left alone. */
  async measure(): Promise<void> {
    const { db } = this.d;
    const why = this.d.whyWait ?? whyWait;
    const unmeasured = db.prepare("SELECT path, agent, origin, driven_by FROM sessions WHERE metrics_json IS NULL ORDER BY mtime_ms DESC LIMIT 1");
    for (;;) {
      if (this.stopped) return;
      const next = unmeasured.get() as Pick<Row, "path" | "agent" | "origin" | "driven_by"> | undefined;
      if (!next) return;
      this.pausedWhy = why();
      if (this.pausedWhy !== null) {
        this.state = "paused";
        await new Promise((resolve) => setTimeout(resolve, this.d.waitMs ?? 30_000));
        continue;
      }
      this.state = "measuring";
      await this.measureFile(next);
    }
  }

  private async measureFile(row: Pick<Row, "path" | "agent" | "origin" | "driven_by">): Promise<void> {
    const { db } = this.d;
    let scan: Scan;
    // A file that went since the first look has nothing to measure; the next look would drop it anyway.
    try { scan = new Scan(row.path, row.agent); } catch { db.prepare("DELETE FROM sessions WHERE path = ?").run(row.path); return; }
    try {
      while (scan.step(SLICE_BYTES)) {
        await otherWork();
        if (this.stopped) return;
      }
    } finally { scan.close(); }
    const { facts } = scan;
    const metrics: SessionMetrics = {
      userTurns: scan.userTurns, assistantTurns: facts.assistantTurns, toolCalls: scan.toolCalls, toolErrors: scan.toolErrors,
      inputTokens: facts.inputTokens, outputTokens: facts.outputTokens, costUsd: facts.costUsd,
    };
    // The agent's own title and the model can lie past the head the first look read.
    db.prepare("UPDATE sessions SET metrics_json = ?, origin = ?, title = COALESCE(?, title), model = COALESCE(model, ?) WHERE path = ?")
      .run(JSON.stringify(metrics), recounted({ origin: row.origin, drivenBy: row.driven_by }, scan.userTurns), facts.title, facts.model, row.path);
  }

  // ─── What the window asks ─────────────────────────────────────────────────────────────────────

  status(): SessionIndexStatus {
    return {
      state: this.state, files: this.files, listed: this.looked,
      measured: this.count("WHERE metrics_json IS NOT NULL"), pausedWhy: this.state === "paused" ? this.pausedWhy : null,
    };
  }

  list(filter: SessionFilter, limit: number, offset: number): { sessions: Session[]; matched: number } {
    if (this.refreshing === null && Date.now() - this.lookedAt > STALE_MS) this.start();
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (filter.agent) { where.push("s.agent = ?"); args.push(filter.agent); }
    if (filter.projectId) { where.push("s.project_id = ?"); args.push(filter.projectId); }
    if (filter.parentId) { where.push("s.parent_id = ?"); args.push(filter.parentId); }
    // Asking for one session's sub-agents is asking for sub-agents, whatever the list otherwise leaves out. So is asking for the starred.
    if (filter.favorites) where.push("EXISTS (SELECT 1 FROM favorites f WHERE f.kind = 'session' AND f.key = s.id)");
    const origins = filter.origins ?? (filter.parentId || filter.favorites ? null : ["person", "app"]);
    if (origins) { where.push(`s.origin IN (${origins.map(() => "?").join(", ")})`); args.push(...origins); }
    for (const word of (filter.query ?? "").split(/\s+/).filter(Boolean)) {
      where.push("(s.title LIKE ? ESCAPE '\\' OR COALESCE(s.project_name, '') LIKE ? ESCAPE '\\' OR COALESCE(s.cwd, '') LIKE ? ESCAPE '\\')");
      const anywhere = `%${word.replace(/[\\%_]/g, "\\$&")}%`;
      args.push(anywhere, anywhere, anywhere);
    }
    const narrowed = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const rows = this.d.db.prepare(`SELECT ${COLUMNS} FROM sessions s ${narrowed} ORDER BY s.mtime_ms DESC, s.path LIMIT ? OFFSET ?`).all(...args, limit, offset) as Row[];
    const { matched } = this.d.db.prepare(`SELECT COUNT(*) AS matched FROM sessions s ${narrowed}`).get(...args) as { matched: number };
    return { sessions: rows.map((row) => this.session(row)), matched };
  }

  facets(): SessionFacets {
    const { db } = this.d;
    return {
      total: this.count(""),
      agents: db.prepare("SELECT agent, COUNT(*) AS count FROM sessions WHERE origin IN ('person', 'app') GROUP BY agent ORDER BY agent").all() as SessionFacets["agents"],
      origins: db.prepare("SELECT origin, COUNT(*) AS count FROM sessions GROUP BY origin ORDER BY origin").all() as SessionFacets["origins"],
      projects: db.prepare(`
        SELECT project_id AS id, project_name AS name, COUNT(*) AS count FROM sessions
        WHERE project_id IS NOT NULL AND origin IN ('person', 'app') GROUP BY project_id ORDER BY MAX(mtime_ms) DESC
      `).all() as SessionFacets["projects"],
    };
  }

  get(id: string): Session {
    return this.session(this.row(id));
  }

  /** Where a session's file is and whose format it is in, for the readers. */
  file(id: string): { path: string; agent: Session["agent"]; cwd: string | null } {
    const { path, agent, cwd } = this.row(id);
    return { path, agent, cwd };
  }

  /** Two files can claim one id (a thread Codex resumed into a new rollout): the one written last is it. */
  private row(id: string): Row {
    const row = this.d.db.prepare(`SELECT ${COLUMNS} FROM sessions s WHERE s.id = ? ORDER BY s.mtime_ms DESC LIMIT 1`).get(id) as Row | undefined;
    if (!row) throw new RpcError("SESSION_NOT_FOUND", `no session ${id} in the index`);
    return row;
  }

  private count(where: string): number {
    return (this.d.db.prepare(`SELECT COUNT(*) AS n FROM sessions ${where}`).get() as { n: number }).n;
  }

  private session(row: Row): Session {
    const { home } = this.d;
    return {
      id: row.id, agent: row.agent, origin: row.origin, drivenBy: row.driven_by, title: row.title,
      projectId: row.project_id, projectName: row.project_name, cwd: row.cwd === null ? null : tildify(row.cwd, home),
      model: row.model, startedAt: row.started_at, endedAt: row.mtime_ms, sizeBytes: row.size,
      metrics: row.metrics_json === null ? null : JSON.parse(row.metrics_json) as SessionMetrics,
      parentId: row.parent_id, children: row.children,
      realm: row.realm_json === null ? null : JSON.parse(row.realm_json) as Session["realm"],
      path: row.path, displayPath: tildify(row.path, home),
    };
  }
}
