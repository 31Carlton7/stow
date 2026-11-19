import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { libraryId, type Finding, type FindingType, type RunnerId } from "@amc/contracts";
import { tempDir } from "@amc/test-utils";
import { PROFILE_ID, buildFixtureHome } from "../../../../fixtures/home.mjs";
import { openDatabase, type Db } from "../db/database";
import { HOLD_MS, Library } from "../library/library";
import { TagStore } from "../library/tags";
import { ModelGate } from "../models/gate";
import { recentCalls } from "../models/ledger";
import { NOT_INSTALLED, type ModelRunner, type RunOutcome, type RunRequest } from "../models/runner";
import { McpServers } from "../setup/mcp";
import { Skills } from "../setup/skills";
import { ModelPass } from "./model-pass";
import { Review } from "./review";

/** A runner that answers each call with what the test's `answer` makes of it, and keeps what it was asked. */
class ScriptedRunner implements ModelRunner {
  asked: RunRequest[] = [];
  answer: (request: RunRequest) => unknown = () => ({ findings: [], claims: [] });
  constructor(readonly id: RunnerId) {}
  async probe() { return NOT_INSTALLED; }
  async offered() { return null; }
  async run(request: RunRequest): Promise<RunOutcome> {
    this.asked.push(request);
    return { output: this.answer(request), inputTokens: 9_000, outputTokens: 200, costUsd: 0.001, durationMs: 900 };
  }
}

let at: ReturnType<typeof buildFixtureHome>;
let db: Db;
let library: Library;
let claude: ScriptedRunner;
let gate: ModelGate;
let pass: ModelPass;
let review: Review;
let now: number;

beforeEach(() => {
  at = buildFixtureHome(tempDir("amc-pass-"));
  now = Date.now() + 2 * HOLD_MS;
  db = openDatabase(":memory:");
  library = new Library({ home: at.home, backups: tempDir("amc-pass-backups-"), tags: new TagStore(db), trash: async (path) => rmSync(path) });
  claude = new ScriptedRunner("claude");
  gate = new ModelGate({ db, runners: { claude, codex: new ScriptedRunner("codex") }, now: () => now });
  pass = new ModelPass({ db, home: at.home, library, gate, now: () => now });
  const projects = () => library.projects();
  review = new Review({
    db, home: at.home, library, pass, now: () => now,
    skills: new Skills({ home: at.home, projects }),
    mcp: new McpServers({ home: at.home, projects, projectAt: (folder) => library.projectAt(folder) }),
  });
});

/** The short id a call gave the file of this name in this place. */
const aliasOf = (request: RunRequest, name: string, place: string): string =>
  new RegExp(`<file id="(f\\d+)"[^>]* place="${place}" name="${name}"`).exec(request.prompt)![1]!;
const isMemoryCall = (request: RunRequest): boolean => request.prompt.includes('kind="memory"');
/** Whether a call asks for an answer of exactly these properties: how the suite tells a write from a scan. */
const wants = (request: RunRequest, ...properties: string[]): boolean => JSON.stringify(request.schema.required) === JSON.stringify(properties);
const found = (type: FindingType): Finding[] => review.scan().findings.filter((f) => f.type === type);
const runPass = async (): Promise<void> => { pass.start("claude"); await pass.whenFinished(); };
const git = (...args: string[]): string => execFileSync("git", args, { cwd: at.repo, encoding: "utf8" }).trim();

describe("what a pass would send", () => {
  it("sends each memory once, in as few calls as hold them, and leaves out what no reading could help", () => {
    const scope = pass.scope();
    // Six memories (the repo's copy of deploy-steps stands for Claude's too) and eight instruction files.
    // Not sent: indexes, Realm's document and imported copy, the two empty files, the one Realm rewrites.
    expect(scope).toMatchObject({ files: 14, calls: 2, withheld: 0 });
    expect(scope.sources.find((s) => s.id === "claude-projects")).toMatchObject({ label: "Claude · Project memory", files: 2, neverSend: false });
  });

  it("sends nothing from a source the person has ruled out", async () => {
    gate.setAllowed("claude", true);
    pass.setNeverSend("claude-projects", true);
    expect(pass.scope()).toMatchObject({ files: 12 });
    await runPass();
    expect(claude.asked.map((r) => r.prompt).join("\n")).not.toContain('place="Claude · atlas" name="old-flag"');
    pass.setNeverSend("claude-projects", false);
    expect(pass.scope()).toMatchObject({ files: 14 });
  });

  it("holds back a file shaped like it has a credential in it, and says how many", async () => {
    gate.setAllowed("claude", true);
    writeFileSync(join(at.claudeMemory, "old-flag.md"), "---\nname: old-flag\ndescription: The beta flag\ntype: feedback\n---\n\nKey: sk-abcdefghijklmnopqrstuvwxyz012345\n");
    expect(pass.scope()).toMatchObject({ files: 13, withheld: 1 });
    await runPass();
    expect(claude.asked.map((r) => r.prompt).join("\n")).not.toContain("sk-abcdefghijklmnopqrstuvwxyz012345");
  });
});

describe("a pass", () => {
  it("does not start while the person has the runner switched off", () => {
    expect(() => pass.start("claude")).toThrowError(/not allowed/);
    expect(claude.asked).toEqual([]);
  });

  it("goes through the gate: every call is in the ledger with the files it carried, never their text", async () => {
    gate.setAllowed("claude", true);
    await runPass();
    expect(pass.passStatus()).toMatchObject({ running: false, calls: 2, callsDone: 2, callsFailed: 0, found: 0, dropped: 0, error: null, model: "claude-haiku-5-5" });
    const calls = recentCalls(db, 10);
    expect(calls.map((c) => [c.purpose, c.tier, c.ok])).toEqual([["scan", "scan", true], ["scan", "scan", true]]);
    expect(calls.flatMap((c) => c.sent)).toContain(`~/Realm/memory/repos/profile-${PROFILE_ID}/team.md`);
    expect(JSON.stringify(calls)).not.toContain("Riley approves releases");
  });

  it("keeps a finding only when its files were sent and its quote is in one of them", async () => {
    gate.setAllowed("claude", true);
    claude.answer = (request) => (isMemoryCall(request) ? {
      findings: [
        { kind: "stale", files: [aliasOf(request, "old-flag", "Claude · atlas")], reason: "The beta flag is described as the current one.", quote: "The beta flag is `ATLAS_BETA`." },
        // A quote that is in no file, an id that was never sent, and a merge across two places: all dropped.
        { kind: "stale", files: [aliasOf(request, "Team", "Realm · Sam's memory")], reason: "Made up.", quote: "Riley left the team in March." },
        { kind: "stale", files: ["f99"], reason: "No such file.", quote: "anything" },
        { kind: "merge", files: [aliasOf(request, "release-day", "Claude · atlas"), aliasOf(request, "release-day", "Realm · Atlas")], reason: "Same fact.", quote: "Releases go out on Mondays" },
      ],
      claims: [],
    } : { findings: [], claims: [] });
    await runPass();
    expect(pass.passStatus()).toMatchObject({ found: 1, dropped: 3 });
    const stale = found("stale");
    expect(stale).toEqual([expect.objectContaining({
      title: "old-flag may be out of date", severity: "medium", judgedBy: "claude-haiku-5-5", needsDraft: false,
      detail: "The beta flag is described as the current one. It says: “The beta flag is `ATLAS_BETA`.”",
      fix: "Move it to the Trash, and drop its line from the index.",
    })]);
    expect(found("merge")).toEqual([]);
  });

  it("checks what a memory claims about its project in code, and reports only what is not there", async () => {
    gate.setAllowed("claude", true);
    writeFileSync(join(at.atlas, "package.json"), JSON.stringify({ scripts: { test: "vitest" } }));
    mkdirSync(join(at.atlas, "src/api"), { recursive: true });
    // A real repository this time: a branch is only called missing when git itself says so.
    rmSync(join(at.atlas, ".git"), { recursive: true });
    for (const args of [["init", "-q", "-b", "main"], ["-c", "user.name=T", "-c", "user.email=t@localhost", "commit", "-q", "--allow-empty", "-m", "start"]]) execFileSync("git", args, { cwd: at.atlas });
    writeFileSync(join(at.claudeMemory, "old-flag.md"), "---\nname: old-flag\ndescription: The beta flag\ntype: feedback\n---\n\nRun `pnpm test` and `pnpm lint:all` before a release. Handlers are in src/api and src/legacy. Work on the release-prep branch, cut from main.\n");
    claude.answer = (request) => {
      if (!isMemoryCall(request)) return { findings: [], claims: [] };
      const file = aliasOf(request, "old-flag", "Claude · atlas");
      return { findings: [], claims: [
        { file, kind: "script", value: "test" }, { file, kind: "script", value: "lint:all" },
        { file, kind: "path", value: "src/api" }, { file, kind: "path", value: "src/legacy" },
        { file, kind: "branch", value: "release-prep" }, { file, kind: "branch", value: "main" },
        // A claim the file does not make is not held against it.
        { file, kind: "path", value: "src/never-mentioned" },
      ] };
    };
    await runPass();
    expect(found("wrong-claim")).toEqual([expect.objectContaining({
      title: "old-flag names 3 things its project does not have",
      detail: "Not in the project now: the script lint:all, the path src/legacy, the branch release-prep. The memory states them as current.",
      fix: null,
    })]);
  });

  it("forgets a finding once the file it was about has changed", async () => {
    gate.setAllowed("claude", true);
    claude.answer = (request) => (isMemoryCall(request)
      ? { findings: [{ kind: "stale", files: [aliasOf(request, "old-flag", "Claude · atlas")], reason: "Dated.", quote: "ATLAS_BETA" }], claims: [] }
      : { findings: [], claims: [] });
    await runPass();
    expect(found("stale")).toHaveLength(1);
    writeFileSync(join(at.claudeMemory, "old-flag.md"), "---\nname: old-flag\ndescription: The beta flag\ntype: feedback\n---\n\nThe flag was removed in March.\n");
    // THE MUTANT: show the stored finding regardless, and the inbox argues with a file the person has already fixed.
    expect(found("stale")).toEqual([]);
  });

  it("stops at the daily cap and says why", async () => {
    gate.setAllowed("claude", true);
    gate.setDailyCap(0.0005);
    await runPass();
    expect(pass.passStatus()).toMatchObject({ callsDone: 2, error: expect.stringContaining("daily cap") });
    expect(claude.asked).toHaveLength(1);
  });
});

describe("a finding's fix", () => {
  it("removes a stale memory with its line in the index, as one approval", async () => {
    gate.setAllowed("claude", true);
    claude.answer = (request) => (isMemoryCall(request)
      ? { findings: [{ kind: "stale", files: [aliasOf(request, "release-day", "Realm · Atlas")], reason: "Superseded.", quote: "after the weekly review" }], claims: [] }
      : { findings: [], claims: [] });
    await runPass();
    const [stale] = found("stale");
    expect(review.proposal(stale!.fingerprint).map((c) => [c.displayPath.split("/").slice(-2).join("/"), c.after === null])).toEqual([["atlas/release-day.md", true], ["atlas/MEMORY.md", false]]);
    await review.approve(stale!.fingerprint);
    expect(existsSync(join(at.repo, "spaces/atlas/release-day.md"))).toBe(false);
    expect(readFileSync(join(at.repo, "spaces/atlas/MEMORY.md"), "utf8")).not.toContain("release-day");
    expect(git("log", "-1", "--format=%s")).toBe("Forget spaces/atlas/release-day.md");
    expect(git("show", "--name-only", "--format=", "HEAD").split("\n").sort()).toEqual(["spaces/atlas/MEMORY.md", "spaces/atlas/release-day.md"]);
  });

  it("has the stronger model write a merge only when asked, and applies it only when approved", async () => {
    gate.setAllowed("claude", true);
    const second = join(at.repo, "spaces/atlas/release-cadence.md");
    writeFileSync(second, "---\nname: release-cadence\ndescription: When Atlas releases\nmetadata:\n  type: project\n---\n\nAtlas releases weekly, on Mondays.\n");
    const index = join(at.repo, "spaces/atlas/MEMORY.md");
    writeFileSync(index, `${readFileSync(index, "utf8")}- [release-cadence](release-cadence.md) — When Atlas releases\n`);
    execFileSync("git", ["add", "--all"], { cwd: at.repo });
    execFileSync("git", ["-c", "user.name=T", "-c", "user.email=t@localhost", "commit", "-qm", "add"], { cwd: at.repo });
    for (const file of [second, index]) utimesSync(file, new Date(now - 2 * HOLD_MS), new Date(now - 2 * HOLD_MS));

    claude.answer = (request) => {
      if (wants(request, "description", "body")) return { description: "Atlas releases weekly, on Mondays after the review", body: "Releases go out weekly on Mondays, after the weekly review." };
      return isMemoryCall(request)
        ? { findings: [{ kind: "merge", files: [aliasOf(request, "release-day", "Realm · Atlas"), aliasOf(request, "release-cadence", "Realm · Atlas")], reason: "Both say when Atlas releases.", quote: "Atlas releases weekly, on Mondays." }], claims: [] }
        : { findings: [], claims: [] };
    };
    await runPass();
    const [merge] = found("merge");
    expect(merge).toMatchObject({ title: "2 memories in Realm · Atlas state the same fact", needsDraft: true });
    await expect(review.approve(merge!.fingerprint)).rejects.toMatchObject({ code: "REVIEW_NOT_DRAFTED" });

    const changes = await review.draftFix(merge!.fingerprint, "claude");
    expect(recentCalls(db, 1)[0]).toMatchObject({ purpose: "merge", tier: "write", model: "claude-opus-5-5" });
    // The first memory named keeps the merged fact under its own header; the other goes.
    expect(changes.map((c) => [c.displayPath.split("/").at(-1), c.after === null])).toEqual([["release-day.md", false], ["release-cadence.md", true], ["MEMORY.md", false]]);
    expect(changes[0]!.after).toBe("---\nname: release-day\ndescription: \"Atlas releases weekly, on Mondays after the review\"\nmetadata:\n  type: project\n  originSessionId: session-b\n---\n\nReleases go out weekly on Mondays, after the weekly review.\n");
    expect(existsSync(second)).toBe(true);

    expect(found("merge")[0]).toMatchObject({ needsDraft: false, fix: "Replace 2 memories with the one that was written." });
    await review.approve(merge!.fingerprint);
    expect(existsSync(second)).toBe(false);
    expect(readFileSync(index, "utf8")).toBe("- [deploy-steps](deploy-steps.md) — How Atlas ships: sign, notarize, then publish\n- [release-day](release-day.md) — Atlas releases weekly, on Mondays after the review\n");
    expect(git("log", "-1", "--format=%s")).toBe("Merge 2 memories into one");
  });

  it("rewrites a dated passage of an instruction file as a proposal over the whole file", async () => {
    gate.setAllowed("claude", true);
    const instructions = join(at.atlas, "CLAUDE.md");
    writeFileSync(instructions, "# Atlas\n\nCRITICAL: You MUST ALWAYS use pnpm.\n");
    claude.answer = (request) => {
      if (wants(request, "text")) return { text: "# Atlas\n\nUse pnpm.\n" };
      return isMemoryCall(request) ? { findings: [], claims: [] }
        : { findings: [
          { kind: "dated-prompt", files: [aliasOf(request, "Atlas", "Claude · atlas")], reason: "Shouted emphasis on an ordinary rule.", quote: "CRITICAL: You MUST ALWAYS use pnpm." },
          { kind: "dated-prompt", files: [aliasOf(request, "Atlas", "Claude · atlas")], reason: "Capitals again.", quote: "MUST ALWAYS" },
        ], claims: [] };
    };
    await runPass();
    // Two passages of one file are one finding, and one rewrite.
    const dated = found("dated-prompt")[0];
    expect(found("dated-prompt")).toHaveLength(1);
    expect(dated).toMatchObject({ title: "~/work/atlas/CLAUDE.md has 2 passages written for an older model", needsDraft: true });
    expect(await review.draftFix(dated!.fingerprint, "claude")).toEqual([expect.objectContaining({ id: libraryId(`claude-project-${library.projectAt(at.atlas)!.id}`, "CLAUDE.md"), after: "# Atlas\n\nUse pnpm.\n" })]);
    utimesSync(instructions, new Date(now - 2 * HOLD_MS), new Date(now - 2 * HOLD_MS));
    await review.approve(dated!.fingerprint);
    expect(readFileSync(instructions, "utf8")).toBe("# Atlas\n\nUse pnpm.\n");
  });
});
