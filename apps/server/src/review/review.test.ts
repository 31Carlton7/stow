import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { libraryId, type Finding, type FindingType } from "@amc/contracts";
import { tempDir } from "@amc/test-utils";
import { PROFILE_ID, buildFixtureHome, claudeSlug } from "../../../../fixtures/home.mjs";
import { openDatabase } from "../db/database";
import { HOLD_MS, Library } from "../library/library";
import { TagStore } from "../library/tags";
import { ModelGate } from "../models/gate";
import { NOT_INSTALLED, type ModelRunner } from "../models/runner";
import { McpServers } from "../setup/mcp";
import { Skills } from "../setup/skills";
import { ModelPass } from "./model-pass";
import { Review } from "./review";

const REPO = `realm-repo-profile-${PROFILE_ID}`;

let at: ReturnType<typeof buildFixtureHome>;
let review: Review;
let library: Library;
let backups: string;
let trashed: string[];
/** The clock the review runs on: two hours after the fixture was written, so nothing in it is held as fresh. */
let now: number;

beforeEach(() => {
  at = buildFixtureHome(tempDir("amc-review-"));
  backups = tempDir("amc-review-backups-");
  trashed = [];
  now = Date.now() + 2 * HOLD_MS;
  const db = openDatabase(":memory:");
  library = new Library({ home: at.home, backups, tags: new TagStore(db), trash: async (path) => { trashed.push(path); rmSync(path); } });
  const projects = () => library.projects();
  // No model is asked anything in this suite: these are the findings the rules make on their own.
  const silent = (id: "claude" | "codex"): ModelRunner => ({ id, probe: async () => NOT_INSTALLED, offered: async () => null, run: async () => { throw new Error("no model call was expected"); } });
  const gate = new ModelGate({ db, runners: { claude: silent("claude"), codex: silent("codex") } });
  review = new Review({
    db, home: at.home, library, now: () => now,
    skills: new Skills({ home: at.home, projects }),
    mcp: new McpServers({ home: at.home, projects, projectAt: (folder) => library.projectAt(folder) }),
    pass: new ModelPass({ db, home: at.home, library, gate, now: () => now }),
  });
});

const git = (...args: string[]): string => execFileSync("git", args, { cwd: at.repo, encoding: "utf8" }).trim();
const found = (type: FindingType): Finding[] => review.scan().findings.filter((f) => f.type === type);
const only = (type: FindingType): Finding => {
  const all = found(type);
  expect(all).toHaveLength(1);
  return all[0]!;
};

describe("what a scan finds in the fixture home", () => {
  it("finds one of each seeded problem, the serious ones first", () => {
    const { findings, rejected } = review.scan();
    expect(rejected).toBe(0);
    expect(findings.map((f) => [f.severity, f.type])).toEqual([
      ["medium", "broken-link"], ["medium", "diverged-copy"], ["medium", "mcp-conflict"],
      ["low", "dead-copy"], ["low", "duplicate"], ["low", "duplicate-skill"], ["low", "empty-file"], ["low", "empty-file"],
    ]);
  });

  it("calls Realm's imported copy dead, and the copy Claude still reads a duplicate", () => {
    expect(only("dead-copy")).toMatchObject({ title: "1 imported copy in Atlas · atlas that no agent reads", fix: "Move 1 file to the Trash." });
    // THE MUTANT: propose deleting every copy but one, and Claude loses the memory it reads outside Realm.
    expect(only("duplicate")).toMatchObject({ title: "1 memory is word for word in Claude · atlas and Realm · Atlas", fix: null });
    expect(only("diverged-copy")).toMatchObject({ title: "1 memory differs between Claude · atlas and Realm · Atlas", fix: null });
  });

  it("names the dead link and offers to drop its line", () => {
    const dead = only("broken-link");
    expect(dead).toMatchObject({ detail: expect.stringContaining("missing-note"), fix: "Remove 1 line from the index." });
    expect(dead.subjects).toEqual([expect.objectContaining({ id: libraryId(REPO, "MEMORY.md") })]);
  });

  it("flags only the server that is started two ways, not one two agents share", () => {
    const conflict = only("mcp-conflict");
    expect(conflict.title).toBe("The search MCP server is set up 2 ways");
    expect(conflict.subjects.map((s) => s.label)).toEqual(["Claude Code: npx -y @example/search-mcp --api-key ••••", "Codex: npx -y @example/search-mcp@2"]);
    expect(found("mcp-duplicate")).toEqual([]);
  });

  it("finds the skill that was copied where a link would do, and both empty instruction files", () => {
    expect(only("duplicate-skill")).toMatchObject({ title: "1 skill is copied, not linked, in Realm and Shared" });
    expect(only("duplicate-skill").subjects.map((s) => s.displayPath).sort()).toEqual(["~/.agents/skills/release-notes", "~/Realm/skills/release-notes"]);
    expect(found("empty-file").map((f) => f.title).sort()).toEqual(["~/.codex/AGENTS.md is empty", "~/.gemini/GEMINI.md is empty"]);
  });

  it("finds a memory missing from its index, a path that is gone, and two memories that say the same thing", () => {
    const memory = at.claudeMemory;
    const body = "Staging lives behind the VPN. Ask Riley for access, then run the smoke test before every release and write down what failed so the next release starts from a known state and nothing is found twice.";
    writeFileSync(join(memory, "staging.md"), `---\nname: staging\ndescription: How to reach staging\nmetadata:\n  type: reference\n---\n\n${body}\n`);
    writeFileSync(join(memory, "staging-notes.md"), `---\nname: staging-notes\ndescription: Staging, again\nmetadata:\n  type: reference\n---\n\n${body} See ~/work/atlas-old/README.md.\n`);
    const orphan = only("orphan");
    expect(orphan).toMatchObject({ title: "2 memories are not in the index of Claude · atlas", fix: "Add 2 lines to the index." });
    expect(only("near-duplicate").title).toBe("staging and staging-notes say nearly the same thing");
    expect(only("dead-reference")).toMatchObject({ title: "staging-notes names 1 path that is gone", detail: expect.stringContaining("~/work/atlas-old/README.md") });
  });

  it("does not take a link in a code fence, or a path that is there, for a problem", () => {
    writeFileSync(join(at.repo, "team.md"), "# Team\n\n```\nSee [[not-a-real-link]]\n```\n\nThe repo is at ~/work/atlas.\n");
    execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@localhost", "commit", "-qam", "edit"], { cwd: at.repo });
    expect(found("broken-link")).toHaveLength(1);
    expect(found("dead-reference")).toEqual([]);
  });
});

describe("a proposal", () => {
  it("shows each file as it is and as it would be", () => {
    const [change] = review.proposal(only("broken-link").fingerprint);
    expect(change).toMatchObject({ displayPath: `~/Realm/memory/repos/profile-${PROFILE_ID}/MEMORY.md`, removal: null });
    expect(change!.before).toContain("- [[missing-note]]\n");
    expect(change!.after).toBe(change!.before.replace("- [[missing-note]]\n", ""));
    expect(review.proposal(only("dead-copy").fingerprint)).toEqual([expect.objectContaining({ after: null, removal: "trash" })]);
  });
});

describe("approving", () => {
  it("makes one commit in a repository, and undoing it makes another that puts the text back", async () => {
    const before = readFileSync(join(at.repo, "MEMORY.md"), "utf8");
    const fix = await review.approve(only("broken-link").fingerprint);
    expect(readFileSync(join(at.repo, "MEMORY.md"), "utf8")).not.toContain("missing-note");
    expect(git("log", "-1", "--format=%an|%s")).toBe("Stow|Drop 1 dead link from MEMORY.md");
    expect(found("broken-link")).toEqual([]);

    expect(await review.undo(fix.id)).toMatchObject({ id: fix.id, undoneAt: now });
    expect(readFileSync(join(at.repo, "MEMORY.md"), "utf8")).toBe(before);
    expect(git("log", "-1", "--format=%s")).toMatch(/^Revert "Drop 1 dead link from MEMORY.md"/);
    await expect(review.undo(fix.id)).rejects.toMatchObject({ code: "REVIEW_UNDONE" });
  });

  it("moves a plain file to the Trash behind a backup, and undo puts it back", async () => {
    const copy = join(at.home, `Realm/memory/imported`, readdirSync(join(at.home, "Realm/memory/imported"))[0]!, claudeSlug(at.atlas).slice(1), "deploy-steps.md");
    const text = readFileSync(copy, "utf8");
    const fix = await review.approve(only("dead-copy").fingerprint);
    expect(trashed).toEqual([copy]);
    expect(existsSync(copy)).toBe(false);
    expect(review.history()).toEqual([expect.objectContaining({ id: fix.id, type: "dead-copy", undoneAt: null })]);

    await review.undo(fix.id);
    expect(readFileSync(copy, "utf8")).toBe(text);
  });

  it("will not undo over a file that has changed since", async () => {
    const empty = join(at.home, ".codex/AGENTS.md");
    const fix = await review.approve(found("empty-file").find((f) => f.title.includes(".codex"))!.fingerprint);
    writeFileSync(empty, "Something written since.\n");
    await expect(review.undo(fix.id)).rejects.toMatchObject({ code: "REVIEW_UNDO_BLOCKED" });
    expect(readFileSync(empty, "utf8")).toBe("Something written since.\n");
  });

  it("leaves alone a file written in the last hour", async () => {
    const index = join(at.repo, "MEMORY.md");
    utimesSync(index, new Date(now - 60_000), new Date(now - 60_000));
    await expect(review.approve(only("broken-link").fingerprint)).rejects.toMatchObject({ code: "REVIEW_FILE_BUSY" });
    expect(readFileSync(index, "utf8")).toContain("missing-note");
  });

  it("refuses a finding with nothing mechanical to do", async () => {
    await expect(review.approve(only("duplicate").fingerprint)).rejects.toMatchObject({ code: "REVIEW_NOT_FIXABLE" });
  });

  it("adds the missing lines to an index it does not keep history for, behind a backup", async () => {
    writeFileSync(join(at.claudeMemory, "staging.md"), "---\nname: staging\ndescription: How to reach staging\nmetadata:\n  type: reference\n---\n\nBehind the VPN.\n");
    const old = new Date(now - 2 * HOLD_MS);
    utimesSync(join(at.claudeMemory, "MEMORY.md"), old, old);
    await review.approve(only("orphan").fingerprint);
    expect(readFileSync(join(at.claudeMemory, "MEMORY.md"), "utf8")).toMatch(/- \[staging\]\(staging\.md\) — How to reach staging\n$/);
    expect(readdirSync(backups, { recursive: true, encoding: "utf8" }).some((p) => p.endsWith("memory/MEMORY.md"))).toBe(true);
    expect(found("orphan")).toEqual([]);
  });
});

describe("rejecting", () => {
  it("keeps a finding away on the next scan, and counts it", () => {
    const conflict = only("mcp-conflict");
    review.reject(conflict.fingerprint);
    const again = review.scan();
    expect(again.findings.map((f) => f.type)).not.toContain("mcp-conflict");
    expect(again.rejected).toBe(1);
  });
});
