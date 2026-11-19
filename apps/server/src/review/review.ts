import type { AppliedFix, Finding, FindingSeverity, FindingType, ProposedChange, RunnerId } from "@amc/contracts";
import type { Db } from "../db/database";
import type { Applied, Change, Library } from "../library/library";
import { tildify } from "../library/paths";
import { RpcError } from "../rpc/error";
import type { McpServers } from "../setup/mcp";
import type { Skills } from "../setup/skills";
import type { ModelPass } from "./model-pass";
import { bySeverity, findProblems, type Draft } from "./rules";

export type ReviewDeps = { db: Db; home: string; library: Library; skills: Skills; mcp: McpServers; pass: ModelPass; now?: () => number };

const MODEL_SEVERITY: Partial<Record<FindingType, FindingSeverity>> = { stale: "medium", contradiction: "medium", "wrong-claim": "medium", merge: "low", "dated-prompt": "low" };

type ApplyRow = { id: number; fingerprint: string; type: FindingType; title: string; at: number; applied_json: string; undone_at: number | null };

const fixOf = (row: ApplyRow): AppliedFix => ({ id: row.id, fingerprint: row.fingerprint, type: row.type, title: row.title, at: row.at, undoneAt: row.undone_at });

/**
 * The review inbox. Findings are worked out afresh from the disk on every scan, so one whose cause
 * is gone is gone with it; what is kept is what the person decided: the findings they rejected, which
 * are not raised again, and the fixes they approved, each with what undoing it needs.
 */
export class Review {
  private readonly now: () => number;

  constructor(private d: ReviewDeps) {
    this.now = d.now ?? Date.now;
  }

  private drafts(): Draft[] {
    const byRule = findProblems({ home: this.d.home, files: this.d.library.inspect(), skillCopies: this.d.skills.copySets(), mcp: this.d.mcp.list() });
    return [...byRule, ...this.modelDrafts()].sort(bySeverity);
  }

  /** The model's stored findings as the inbox shows them, each with the fix it has or still needs written. */
  private modelDrafts(): Draft[] {
    return this.d.pass.current().map(({ row, files }) => {
      const first = files[0]!;
      const locked = files.some((f) => f.source.lockedNote?.(f.entry.rel));
      let changes: Change[] = [], fix: string | null = null, commit = "", needsDraft = false;
      if (row.type === "stale" && !locked) {
        changes = this.d.library.removals([first.entry.id]);
        fix = first.source.repo !== null ? "Delete it, and drop its line from the index." : "Move it to the Trash, and drop its line from the index.";
        commit = `Forget ${first.entry.rel}`;
      } else if ((row.type === "merge" || row.type === "dated-prompt") && !locked) {
        const merging = row.type === "merge";
        if (row.drafted_json) {
          changes = JSON.parse(row.drafted_json) as Change[];
          fix = merging ? `Replace ${files.length} memories with the one that was written.` : "Replace the file with the rewritten one.";
          commit = merging ? `Merge ${files.length} memories into one` : `Put a dated passage of ${first.entry.rel} plainly`;
        } else {
          needsDraft = true;
          fix = merging ? "Have the stronger model write the one memory. You read it before it replaces these." : "Have the stronger model rewrite the passage. You read it before it replaces the file.";
        }
      }
      return {
        fingerprint: row.fingerprint, type: row.type, severity: MODEL_SEVERITY[row.type] ?? "low", title: row.title, detail: row.detail,
        subjects: files.map((f) => ({ id: f.entry.id, label: f.entry.title, displayPath: tildify(f.entry.path, this.d.home) })),
        fix, judgedBy: row.model, needsDraft, changes, commit,
      };
    });
  }

  async draftFix(fingerprint: string, runner: RunnerId): Promise<ProposedChange[]> {
    return this.d.pass.proposed(await this.d.pass.draft(fingerprint, runner));
  }

  private draft(fingerprint: string): Draft {
    const found = this.drafts().find((d) => d.fingerprint === fingerprint);
    if (!found) throw new RpcError("REVIEW_GONE", "That finding is no longer there. Scan again.");
    return found;
  }

  scan(): { findings: Finding[]; rejected: number } {
    this.d.library.refresh();
    const rejected = new Set((this.d.db.prepare("SELECT fingerprint FROM review_rejections").all() as { fingerprint: string }[]).map((r) => r.fingerprint));
    const drafts = this.drafts();
    return {
      findings: drafts.filter((d) => !rejected.has(d.fingerprint)).map(({ changes: _changes, commit: _commit, ...finding }) => finding),
      rejected: drafts.filter((d) => rejected.has(d.fingerprint)).length,
    };
  }

  proposal(fingerprint: string): ProposedChange[] {
    return this.d.pass.proposed(this.draft(fingerprint).changes);
  }

  async approve(fingerprint: string): Promise<AppliedFix> {
    const draft = this.draft(fingerprint);
    if (draft.needsDraft) throw new RpcError("REVIEW_NOT_DRAFTED", "The fix has not been written yet. Have it written, read it, then approve it.");
    if (draft.changes.length === 0) throw new RpcError("REVIEW_NOT_FIXABLE", "There is nothing here to apply. Open the files it names and change them yourself.");
    const applied = await this.d.library.applyChanges(draft.changes, draft.commit || draft.title, this.now());
    const { lastInsertRowid } = this.d.db.prepare("INSERT INTO review_applies (fingerprint, type, title, at, applied_json) VALUES (?, ?, ?, ?, ?)")
      .run(draft.fingerprint, draft.type, draft.title, this.now(), JSON.stringify(applied));
    return fixOf(this.row(Number(lastInsertRowid)));
  }

  reject(fingerprint: string): void {
    const draft = this.draft(fingerprint);
    this.d.db.prepare("INSERT OR REPLACE INTO review_rejections (fingerprint, type, title, at) VALUES (?, ?, ?, ?)").run(draft.fingerprint, draft.type, draft.title, this.now());
  }

  async undo(id: number): Promise<AppliedFix> {
    const row = this.row(id);
    if (row.undone_at !== null) throw new RpcError("REVIEW_UNDONE", "That fix has already been undone.");
    await this.d.library.undo(JSON.parse(row.applied_json) as Applied[]);
    this.d.db.prepare("UPDATE review_applies SET undone_at = ? WHERE id = ?").run(this.now(), id);
    return fixOf(this.row(id));
  }

  history(): AppliedFix[] {
    return (this.d.db.prepare("SELECT * FROM review_applies ORDER BY at DESC, id DESC LIMIT 200").all() as ApplyRow[]).map(fixOf);
  }

  private row(id: number): ApplyRow {
    const row = this.d.db.prepare("SELECT * FROM review_applies WHERE id = ?").get(id) as ApplyRow | undefined;
    if (!row) throw new RpcError("REVIEW_GONE", "There is no such fix in the history.");
    return row;
  }
}
