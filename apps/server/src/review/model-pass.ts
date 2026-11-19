import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, posix } from "node:path";
import { z } from "zod";
import { LIBRARY_GROUP_LABEL, type FindingType, type PassScope, type PassSource, type PassStatus, type ProposedChange, type RunnerId } from "@amc/contracts";
import type { Db } from "../db/database";
import { readSetting, writeSetting } from "../db/settings";
import { withClaudeIndexLine, yamlScalar } from "../library/claude-facts";
import { readFrontmatter } from "../library/frontmatter";
import { git } from "../library/git";
import { textHash, type Change, type HeldFile, type Library } from "../library/library";
import { MEMORY_INDEX_FILE } from "../library/memory-index";
import { tildify } from "../library/paths";
import type { ModelGate } from "../models/gate";
import { RpcError } from "../rpc/error";
import { secretShapeIn } from "../secret-shapes";
import { fingerprintOf, isMemoryKind, placeOf } from "./rules";

export type PassDeps = { db: Db; home: string; library: Library; gate: ModelGate; now?: () => number };

/** How much text one call carries, and how much of one file: enough for a folder of memories, small
 *  enough that the model reads all of it with care. */
const CALL_CHARS = 48_000;
const FILE_CHARS = 8_000;
const NEVER_SEND_KEY = "review.neverSend";

/** The switch, the cap, a stop and a CLI that cannot run end the pass. Any other refusal is one call that failed. */
const ENDS_PASS = new Set(["MODELS_NOT_ALLOWED", "MODELS_OVER_CAP", "MODELS_ABORTED", "MODELS_CLI_MISSING", "MODELS_SIGNED_OUT"]);

const SCAN_GUIDANCE = [
  "You review the files one person's coding agents read at the start of their sessions: memories (one",
  "fact per file, under a short header) and instruction files (CLAUDE.md, AGENTS.md, rules). Find what",
  "would mislead an agent, and nothing else. Most files are fine, and an empty answer is a good answer.",
  "",
  "Report a finding only when you can quote the words that show it:",
  "- stale: a memory about work that is finished, a plan that was replaced, or a state that no longer",
  "  holds, where the file itself or another file here says so. Never because a file is old, and never",
  "  a preference or a standing rule.",
  "- contradiction: two files that tell an agent opposite things about the same subject.",
  "- merge: two or more memories that state the same fact and would be clearer as one. Not memories",
  "  that only share a topic.",
  "- dated-prompt: in instruction files only. A passage written for older models that now does harm:",
  "  shouted emphasis (CRITICAL, MUST, NEVER in capitals) on an ordinary rule; telling the agent to",
  "  think step by step or to be thorough; role boilerplate standing in for context; a hedge on",
  "  something that is required (\"try to\", \"if possible\"). Leave alone anything that states a fact",
  "  about the project, gives the reason for a rule, spells out an exact sequence for a risky",
  "  operation, or guards against a mistake that would still happen. A one-line statement of who the",
  "  agent is, is fine. Never flag a file for its length.",
  "",
  "For each finding give the file ids exactly as shown, one sentence of reason written for the person",
  "who owns the files, and a quote copied exactly from one of the named files: the shortest passage",
  "that shows it. A stale finding names the stale file first, then the file that shows it is stale if",
  "there is one. A dated-prompt finding names one file. The others name two or more.",
  "",
  "Separately, list the checkable claims the memories make about their project as current fact: a",
  "relative file path, a package script (the name after pnpm, npm run, yarn or bun run), or a git",
  "branch, each copied exactly. Code checks them. Do not judge them yourself, and leave out anything",
  "described as past or removed.",
].join("\n");

const MERGE_GUIDANCE = [
  "You are given memories that state the same fact. Write the one memory that replaces them: nothing",
  "true lost, nothing invented, the person's own words kept where you can, and no mention that it was",
  "merged. Give its one-line description and its body in Markdown, without a header block.",
].join("\n");

const REWRITE_GUIDANCE = [
  "You are given an instruction file a coding agent loads, and what was found in it: passages written",
  "for older models. Return the whole file with each of those passages put plainly, or taken out where",
  "it only told the agent how to think. Say exactly what is meant at normal volume, and keep every",
  "fact, reason and exact command. Change nothing else, and do not add anything.",
].join("\n");

const SCAN_KINDS = ["stale", "contradiction", "merge", "dated-prompt"] as const;
const CLAIM_KINDS = ["path", "script", "branch"] as const;

/** Codex holds a schema to having every property required and no others allowed, so every schema here is written that way. */
const SCAN_SCHEMA = {
  type: "object", additionalProperties: false, required: ["findings", "claims"],
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["kind", "files", "reason", "quote"],
        properties: {
          kind: { type: "string", enum: SCAN_KINDS },
          files: { type: "array", items: { type: "string" } },
          reason: { type: "string" },
          quote: { type: "string" },
        },
      },
    },
    claims: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["file", "kind", "value"],
        properties: { file: { type: "string" }, kind: { type: "string", enum: CLAIM_KINDS }, value: { type: "string" } },
      },
    },
  },
};
const MERGE_SCHEMA = {
  type: "object", additionalProperties: false, required: ["description", "body"],
  properties: { description: { type: "string" }, body: { type: "string" } },
};
const REWRITE_SCHEMA = { type: "object", additionalProperties: false, required: ["text"], properties: { text: { type: "string" } } };

const ScanAnswer = z.object({
  findings: z.array(z.object({ kind: z.enum(SCAN_KINDS), files: z.array(z.string()), reason: z.string(), quote: z.string() })),
  claims: z.array(z.object({ file: z.string(), kind: z.enum(CLAIM_KINDS), value: z.string() })),
});
const MergeAnswer = z.object({ description: z.string().min(1), body: z.string().min(1) });
const RewriteAnswer = z.object({ text: z.string().min(1) });

/** One file in a call, under the short id the model is shown instead of its path. */
type Sent = { alias: string; file: HeldFile; place: string; text: string };
type Call = { instructions: boolean; files: Sent[] };

export type ModelFindingRow = {
  fingerprint: string; type: FindingType; title: string; detail: string; model: string;
  files_json: string; drafted_json: string | null; found_at: number;
};

const squeezed = (text: string): string => text.replace(/\s+/g, " ").trim();
/** A value inside a double-quoted attribute of the prompt's markup. */
const attr = (value: string): string => value.replace(/"/g, "'");
const short = (text: string, n: number): string => (text.length <= n ? text : `${text.slice(0, n - 1).trimEnd()}…`);

function agoOf(then: number, now: number): string {
  const days = Math.max(0, Math.round((now - then) / 86_400_000));
  return days === 0 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`;
}

/**
 * The model's reading of the library. A pass sends the memories and instruction files a folder at a
 * time through the gate, which is what holds it to the person's switch, the daily cap and the ledger.
 * What comes back is checked before it is kept: every file id must be one that was sent, every quote
 * must be in the file it is said to be from, and a claim about the project is tested against the
 * project by code. What survives is stored, so the inbox shows it without another call.
 */
export class ModelPass {
  private readonly now: () => number;
  private status: PassStatus = { running: false, runner: null, model: null, finishedAt: null, calls: 0, callsDone: 0, callsFailed: 0, found: 0, dropped: 0, spentUsd: 0, error: null };
  private stopping: AbortController | null = null;
  private finished: Promise<void> = Promise.resolve();

  constructor(private d: PassDeps) {
    this.now = d.now ?? Date.now;
  }

  // ─── What a pass would send ───────────────────────────────────────────────────────────────────

  private neverSend(): string[] {
    return readSetting(this.d.db, NEVER_SEND_KEY, z.array(z.string()), []);
  }

  setNeverSend(sourceId: string, neverSend: boolean): void {
    const kept = new Set(this.neverSend());
    if (neverSend) kept.add(sourceId);
    else kept.delete(sourceId);
    writeSetting(this.d.db, NEVER_SEND_KEY, [...kept].sort());
  }

  /**
   * The calls a pass would make. A file is sent once however many copies of it there are; indexes,
   * empty files, Realm's dead copies and files their owner rewrites are not sent, nor is anything
   * from a source the person has said is never to be, nor a file that looks like it holds a credential.
   */
  private plan(): { calls: Call[]; scope: PassScope } {
    const never = new Set(this.neverSend());
    const sources = new Map<string, PassSource>();
    const groups = new Map<string, HeldFile[]>();
    let withheld = 0;
    for (const file of this.d.library.inspect()) {
      const { source, entry } = file;
      if (source.kind === "imported" || source.kind === "documents" || entry.index || !entry.canonical || file.text.trim() === "" || source.lockedNote?.(entry.rel)) continue;
      if (!sources.has(source.id)) sources.set(source.id, { id: source.id, label: `${LIBRARY_GROUP_LABEL[source.group]} · ${source.label}`, files: 0, chars: 0, neverSend: never.has(source.id) });
      const counted = sources.get(source.id)!;
      if (secretShapeIn(file.text)) { withheld++; continue; }
      counted.files++;
      counted.chars += Math.min(file.text.length, FILE_CHARS);
      if (counted.neverSend) continue;
      const group = `${isMemoryKind(file) ? "m" : "i"}\n${placeOf(file)}`;
      groups.set(group, [...(groups.get(group) ?? []), file]);
    }
    // Places are packed into calls whole where they fit, so files that can be compared arrive together.
    const cut = (file: HeldFile): string => (file.text.length <= FILE_CHARS ? file.text : `${file.text.slice(0, FILE_CHARS)}\n[the rest of this file was left out]`);
    const calls: Call[] = [];
    for (const instructions of [false, true]) {
      let call: Call | null = null;
      let room = 0;
      for (const [group, files] of [...groups].filter(([g]) => g.startsWith(instructions ? "i" : "m")).sort(([a], [b]) => a.localeCompare(b))) {
        const place = group.split("\n")[1]!;
        const whole = files.reduce((n, file) => n + cut(file).length, 0);
        if (call !== null && call.files.length > 0 && whole > room && whole <= CALL_CHARS) call = null;
        for (const file of files) {
          const text = cut(file);
          if (call === null || (text.length > room && call.files.length > 0)) {
            call = { instructions, files: [] };
            calls.push(call);
            room = CALL_CHARS;
          }
          call.files.push({ alias: `f${call.files.length + 1}`, file, place, text });
          room -= text.length;
        }
      }
    }
    const sent = [...sources.values()].filter((s) => !s.neverSend);
    return {
      calls,
      scope: {
        sources: [...sources.values()].sort((a, b) => a.label.localeCompare(b.label)),
        files: sent.reduce((n, s) => n + s.files, 0), chars: sent.reduce((n, s) => n + s.chars, 0), calls: calls.length, withheld,
      },
    };
  }

  scope(): PassScope {
    return this.plan().scope;
  }

  // ─── The pass ─────────────────────────────────────────────────────────────────────────────────

  passStatus(): PassStatus {
    return { ...this.status };
  }

  /** Start a pass in the background, unless one is running. Its progress is `passStatus`. */
  start(runner: RunnerId): PassStatus {
    if (this.status.running) return this.passStatus();
    const settings = this.d.gate.settings(runner);
    if (!settings.allowed) throw new RpcError("MODELS_NOT_ALLOWED", `${runner} is not allowed to make model calls: turn it on in Settings`);
    const { calls } = this.plan();
    this.stopping = new AbortController();
    this.status = { running: true, runner, model: settings.models.scan, finishedAt: null, calls: calls.length, callsDone: 0, callsFailed: 0, found: 0, dropped: 0, spentUsd: 0, error: null };
    this.d.db.exec("DELETE FROM model_findings");
    this.finished = this.run(runner, calls, this.stopping.signal).finally(() => {
      this.status = { ...this.status, running: false, finishedAt: this.now() };
      this.stopping = null;
    });
    return this.passStatus();
  }

  stop(): PassStatus {
    this.stopping?.abort();
    return this.passStatus();
  }

  /** Resolves when the pass that is running, if any, has ended. */
  whenFinished(): Promise<void> {
    return this.finished;
  }

  private async run(runner: RunnerId, calls: readonly Call[], signal: AbortSignal): Promise<void> {
    const spentBefore = this.d.gate.spentTodayUsd();
    for (const call of calls) {
      if (signal.aborted) { this.status.error = "Stopped."; return; }
      try {
        const outcome = await this.d.gate.run({
          runner, tier: "scan", purpose: "scan", sent: call.files.map((s) => tildify(s.file.entry.path, this.d.home)),
          system: SCAN_GUIDANCE, prompt: this.promptFor(call), schema: SCAN_SCHEMA, signal,
        });
        const answer = ScanAnswer.safeParse(outcome.output);
        if (answer.success) this.status.found += await this.keep(call, answer.data, outcome.model);
        else this.status.callsFailed++;
      } catch (e) {
        const code = e instanceof RpcError ? e.code : "";
        if (ENDS_PASS.has(code)) {
          this.status.error = code === "MODELS_ABORTED" ? "Stopped." : e instanceof Error ? e.message : String(e);
          return;
        }
        this.status.callsFailed++;
      } finally {
        this.status.callsDone++;
        this.status.spentUsd = this.d.gate.spentTodayUsd() - spentBefore;
      }
    }
  }

  private promptFor(call: Call): string {
    const what = call.instructions
      ? "These are instruction files an agent loads at the start of a session."
      : "These are memories: facts agents saved to read in later sessions.";
    const files = call.files.map(({ alias, file, place, text }) => {
      const type = file.entry.type ? ` type="${attr(file.entry.type)}"` : "";
      return `<file id="${alias}" kind="${call.instructions ? "instructions" : "memory"}" place="${attr(place)}" name="${attr(file.entry.title)}"${type} changed="${agoOf(file.entry.updatedAt, this.now())}">\n${text}\n</file>`;
    });
    return `Today is ${new Date(this.now()).toISOString().slice(0, 10)}. ${what} Each says the place it is kept in: compare a file only with others of the same place.\n\n${files.join("\n\n")}`;
  }

  /** Store the findings of one call that hold up, and return how many there were. */
  private async keep(call: Call, answer: z.infer<typeof ScanAnswer>, model: string): Promise<number> {
    const byAlias = new Map(call.files.map((s) => [s.alias, s.file]));
    const placeBy = new Map(call.files.map((s) => [s.file, s.place]));
    let kept = 0;
    const store = (type: FindingType, files: readonly HeldFile[], title: string, detail: string, key: string): void => {
      const fingerprint = fingerprintOf(type, ...files.map((f) => f.entry.id).sort(), squeezed(key));
      this.d.db.prepare("INSERT OR REPLACE INTO model_findings (fingerprint, type, title, detail, model, files_json, drafted_json, found_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)")
        .run(fingerprint, type, title, detail, model, JSON.stringify(files.map((f) => ({ id: f.entry.id, hash: textHash(f.text) }))), this.now());
      kept++;
    };

    /** An instruction file's dated passages, collected so the file gets one finding and one rewrite. */
    const dated = new Map<HeldFile, string[]>();
    for (const found of answer.findings) {
      const files = [...new Set(found.files)].map((alias) => byAlias.get(alias));
      const named = files.filter((f): f is HeldFile => f !== undefined);
      const quote = squeezed(found.quote);
      const holdsUp = named.length > 0 && named.length === files.length
        && quote !== "" && named.some((f) => squeezed(f.text).includes(quote))
        && new Set(named.map((f) => placeBy.get(f))).size === 1
        && (found.kind === "dated-prompt" ? call.instructions && named.length === 1 : found.kind === "stale" ? !call.instructions : named.length >= 2)
        && (found.kind !== "merge" || !call.instructions);
      if (!holdsUp) { this.status.dropped++; continue; }
      const reason = `${short(squeezed(found.reason), 300)} It says: “${short(quote, 240)}”`;
      const [first, second] = named as [HeldFile, HeldFile | undefined];
      if (found.kind === "dated-prompt") dated.set(first, [...(dated.get(first) ?? []), reason]);
      else if (found.kind === "stale") store("stale", named, `${first.entry.title} may be out of date`, reason, quote);
      else if (found.kind === "contradiction") store("contradiction", named, `${first.entry.title} and ${second!.entry.title} disagree`, reason, quote);
      else store("merge", named, `${named.length} memories in ${placeBy.get(first)} state the same fact`, reason, quote);
    }
    for (const [file, reasons] of dated) {
      store("dated-prompt", [file], `${tildify(file.entry.path, this.d.home)} has ${reasons.length === 1 ? "a passage" : `${reasons.length} passages`} written for an older model`, reasons.join(" "), "dated");
    }

    const wrong = new Map<HeldFile, string[]>();
    for (const claim of answer.claims) {
      const file = byAlias.get(claim.file);
      if (!file || call.instructions || !squeezed(file.text).includes(squeezed(claim.value))) continue;
      const root = this.d.library.projects().find((p) => p.id === file.entry.projectId)?.root;
      if (!root || (await holds(root, claim.kind, claim.value.trim()))) continue;
      wrong.set(file, [...(wrong.get(file) ?? []), `the ${claim.kind} ${claim.value.trim()}`]);
    }
    for (const [file, missing] of wrong) {
      store("wrong-claim", [file], `${file.entry.title} names ${missing.length === 1 ? "something" : `${missing.length} things`} its project does not have`,
        `Not in the project now: ${missing.slice(0, 5).join(", ")}. The memory states ${missing.length === 1 ? "it" : "them"} as current.`, missing.join("\n"));
    }
    return kept;
  }

  // ─── Stored findings, and the fixes a stronger model writes ───────────────────────────────────

  /** The stored findings whose files are all still there and unchanged since they were judged. */
  current(): { row: ModelFindingRow; files: HeldFile[] }[] {
    const byId = new Map(this.d.library.inspect().map((f) => [f.entry.id, f]));
    const rows = this.d.db.prepare("SELECT * FROM model_findings ORDER BY found_at, fingerprint").all() as ModelFindingRow[];
    return rows.flatMap((row) => {
      const judged = JSON.parse(row.files_json) as { id: string; hash: string }[];
      const files = judged.map((j) => byId.get(j.id));
      return files.every((f, i) => f !== undefined && textHash(f.text) === judged[i]!.hash) ? [{ row, files: files as HeldFile[] }] : [];
    });
  }

  /**
   * Have the stronger model write what a finding's fix needs: the one memory that replaces several,
   * or an instruction file with its dated passage put plainly. The result is stored with the finding
   * and applied only when the person approves it.
   */
  async draft(fingerprint: string, runner: RunnerId): Promise<Change[]> {
    const found = this.current().find((c) => c.row.fingerprint === fingerprint);
    if (!found) throw new RpcError("REVIEW_GONE", "That finding is no longer there. Scan again.");
    const { row, files } = found;
    const sent = files.map((f) => tildify(f.entry.path, this.d.home));
    let changes: Change[];
    if (row.type === "merge") {
      const prompt = files.map((f) => `<memory name="${attr(f.entry.title)}">\n${f.text}\n</memory>`).join("\n\n");
      const outcome = await this.d.gate.run({ runner, tier: "write", purpose: "merge", sent, system: MERGE_GUIDANCE, prompt, schema: MERGE_SCHEMA });
      const merged = MergeAnswer.parse(outcome.output);
      const [into, ...others] = files as [HeldFile, ...HeldFile[]];
      changes = this.mergeChanges(into, others, squeezed(merged.description), merged.body.trim());
    } else if (row.type === "dated-prompt") {
      const file = files[0]!;
      const outcome = await this.d.gate.run({
        runner, tier: "write", purpose: "rewrite", sent, system: REWRITE_GUIDANCE, schema: REWRITE_SCHEMA,
        prompt: `What was found: ${row.detail}\n\n<file>\n${file.text}\n</file>`,
      });
      changes = [{ id: file.entry.id, baseHash: textHash(file.text), text: RewriteAnswer.parse(outcome.output).text }];
    } else {
      throw new RpcError("REVIEW_NOT_FIXABLE", "There is nothing to write for this finding.");
    }
    this.d.db.prepare("UPDATE model_findings SET drafted_json = ? WHERE fingerprint = ?").run(JSON.stringify(changes), fingerprint);
    return changes;
  }

  /** `into` with the merged description and body under its own header, the others gone, and the
   *  folder's index saying what `into` now is. */
  private mergeChanges(into: HeldFile, others: readonly HeldFile[], description: string, body: string): Change[] {
    const { fields } = readFrontmatter(into.text);
    const header = into.text.startsWith("---") ? into.text.slice(0, into.text.indexOf("\n---", 3) + 4) : "";
    const described = fields.some((f) => f.key === "description")
      ? header.replace(/^description:.*$/m, `description: ${yamlScalar(description)}`)
      : header;
    const changes = this.d.library.removals(others.map((f) => f.entry.id));
    changes.unshift({ id: into.entry.id, baseHash: textHash(into.text), text: `${described}${described ? "\n\n" : ""}${body}\n` });

    const dir = posix.dirname(into.entry.rel);
    const indexId = `${into.source.id}:${dir === "." ? MEMORY_INDEX_FILE : `${dir}/${MEMORY_INDEX_FILE}`}`;
    const index = this.d.library.inspect().find((f) => f.entry.id === indexId);
    const atRepoTop = into.source.repo !== null && dir === ".";
    if (index && !atRepoTop) {
      const pending = changes.find((c) => c.id === indexId);
      const text = withClaudeIndexLine(pending?.text ?? index.text, basename(into.entry.rel), into.entry.title, description);
      if (pending) pending.text = text;
      else if (text !== index.text) changes.push({ id: indexId, baseHash: textHash(index.text), text });
    }
    return changes;
  }

  /** What a drafted fix would do to each file, for the person to read before approving. */
  proposed(changes: readonly Change[]): ProposedChange[] {
    const byId = new Map(this.d.library.inspect().map((f) => [f.entry.id, f]));
    return changes.map((change) => {
      const file = byId.get(change.id)!;
      return {
        id: change.id, label: file.entry.title, displayPath: tildify(file.entry.path, this.d.home), before: file.text, after: change.text,
        removal: change.text !== null ? null : file.source.repo !== null ? "commit" : "trash",
      };
    });
  }
}

/** Whether a project still has what a memory says it has. Anything that cannot be checked counts as there. */
async function holds(root: string, kind: (typeof CLAIM_KINDS)[number], value: string): Promise<boolean> {
  if (value === "" || /[*<>{}$|]/.test(value)) return true;
  if (kind === "path") return value.startsWith("/") || value.startsWith("~") || existsSync(join(root, value));
  if (kind === "script") {
    const scripts = packageScripts(root);
    return scripts === null || scripts.has(value);
  }
  if (!existsSync(join(root, ".git"))) return true;
  for (const ref of [`refs/heads/${value}`, `refs/remotes/origin/${value}`]) {
    // Exit 1 is git saying the ref is not there. Anything else is git unable to say.
    if ((await git(root, ["rev-parse", "--verify", "--quiet", ref])).code !== 1) return true;
  }
  return false;
}

/** Every script a project's package.json files define, at its top and one workspace folder down, or
 *  null for a project with no package.json at its top. */
function packageScripts(root: string): Set<string> | null {
  const read = (file: string): string[] => {
    try { return Object.keys((JSON.parse(readFileSync(file, "utf8")) as { scripts?: Record<string, unknown> }).scripts ?? {}); } catch { return []; }
  };
  if (!existsSync(join(root, "package.json"))) return null;
  const scripts = new Set(read(join(root, "package.json")));
  for (const workspaces of ["apps", "packages"]) {
    let names: string[] = [];
    try { names = readdirSync(join(root, workspaces)); } catch { /* a project without that folder */ }
    for (const name of names) for (const script of read(join(root, workspaces, name, "package.json"))) scripts.add(script);
  }
  return scripts;
}
