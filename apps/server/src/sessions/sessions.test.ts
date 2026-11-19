import { appendFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { tempDir } from "@amc/test-utils";
import { buildFixtureHome, SESSIONS } from "../../../../fixtures/home.mjs";
import { openDatabase, type Db } from "../db/database";
import { Library } from "../library/library";
import { TagStore } from "../library/tags";
import { contextOf } from "./context";
import { SessionIndex } from "./index";
import { originOf, recounted } from "./origin";
import { readStretch } from "./read";
import type { RealmRow } from "./realm-sessions";

let at: ReturnType<typeof buildFixtureHome>;
let db: Db;
let library: Library;
let index: SessionIndex;

const libraryOf = (home: string): Library =>
  new Library({ home, backups: tempDir("amc-sessions-backups-"), tags: new TagStore(openDatabase(":memory:")), trash: async () => {} });

beforeAll(async () => {
  at = buildFixtureHome(tempDir("amc-sessions-"));
  db = openDatabase(":memory:");
  library = libraryOf(at.home);
  index = new SessionIndex({ db, home: at.home, library, whyWait: () => null });
  await index.look();
});

describe("who was on the other end", () => {
  const told = { subAgent: false, parentId: null, startedBy: "cli" as string | null, userTurns: 1, realm: null as RealmRow | null };
  const realm = (dispatchedBy: string): RealmRow => ({ title: "t", space: "s", teammate: null, dispatchedBy, parentId: "parent-thread" });

  it("takes a file another session started for a sub-agent, whoever started the agent", () => {
    expect(originOf({ ...told, subAgent: true, parentId: "p" })).toEqual({ origin: "sub-agent", drivenBy: null, parentId: "p" });
  });

  it("says Realm drove what Realm's database holds, unless Realm only imported it", () => {
    // THE MUTANT: any Realm row means Realm drove it, and a terminal session Realm imported stops being a person's.
    expect(originOf({ ...told, startedBy: "sdk-ts", realm: realm("") })).toEqual({ origin: "app", drivenBy: "Realm", parentId: null });
    expect(originOf({ ...told, startedBy: "sdk-ts", realm: realm("agent_run") })).toEqual({ origin: "sub-agent", drivenBy: "Realm", parentId: "parent-thread" });
    expect(originOf({ ...told, realm: realm("import") })).toEqual({ origin: "person", drivenBy: null, parentId: null });
  });

  it("takes a terminal for a person, and a file too old to say for one too", () => {
    for (const startedBy of ["cli", "codex-tui", "codex_cli_rs", null]) expect(originOf({ ...told, startedBy }).origin).toBe("person");
  });

  it("names the desktop apps and editors", () => {
    expect(originOf({ ...told, startedBy: "claude-desktop" })).toMatchObject({ origin: "app", drivenBy: "Claude Desktop" });
    expect(originOf({ ...told, startedBy: "Codex Desktop" })).toMatchObject({ origin: "app", drivenBy: "Codex Desktop" });
    expect(originOf({ ...told, startedBy: "other_desktop" })).toMatchObject({ origin: "app", drivenBy: "Other desktop" });
  });

  it("tells a program that asked once from one that kept talking", () => {
    for (const startedBy of ["sdk-ts", "sdk-cli", "codex_exec", "codex_sdk_ts"]) {
      expect(originOf({ ...told, startedBy, userTurns: 1 })).toEqual({ origin: "one-shot", drivenBy: null, parentId: null });
      expect(originOf({ ...told, startedBy, userTurns: 3 })).toEqual({ origin: "app", drivenBy: null, parentId: null });
    }
  });

  it("changes only an unnamed program's origin once every turn is counted", () => {
    expect(recounted({ origin: "one-shot", drivenBy: null }, 4)).toBe("app");
    expect(recounted({ origin: "app", drivenBy: null }, 1)).toBe("one-shot");
    expect(recounted({ origin: "app", drivenBy: "Realm" }, 1)).toBe("app");
    expect(recounted({ origin: "person", drivenBy: null }, 1)).toBe("person");
  });
});

describe("the first look", () => {
  it("lists the conversations a person had, newest first", () => {
    const { sessions, matched } = index.list({}, 200, 0);
    expect(matched).toBe(3);
    expect(sessions.map((s) => [s.id, s.agent, s.origin, s.drivenBy, s.title, s.projectName])).toEqual([
      [SESSIONS.realm, "claude", "app", "Realm", "Plan the 2.4 release with me", "atlas"],
      [SESSIONS.codex, "codex", "person", null, "Why is the beacon dark?", "beacon"],
      [SESSIONS.typed, "claude", "person", null, "Tagging the 2.4 release", "atlas"],
    ]);
  });

  it("fills in what each file says of itself and where it is", () => {
    expect(index.get(SESSIONS.typed)).toMatchObject({
      cwd: "~/work/atlas", model: "claude-fixture-1", startedAt: Date.UTC(2026, 2, 2, 9, 0), endedAt: Date.UTC(2026, 2, 2, 9, 10),
      metrics: null, parentId: null, children: 1, realm: null,
      path: `${at.home}/.claude/projects/${at.atlas.replace(/[^a-zA-Z0-9]/g, "-")}/${SESSIONS.typed}.jsonl`,
    });
    expect(index.get(SESSIONS.typed).displayPath.startsWith("~/.claude/projects/")).toBe(true);
    expect(index.get(SESSIONS.codex)).toMatchObject({ cwd: "~/work/beacon", model: "gpt-fixture-1" });
    expect(() => index.get("nope")).toThrowError(/no session/);
  });

  it("joins Realm's database for the sessions Realm drove", () => {
    expect(index.get(SESSIONS.realm)).toMatchObject({ realm: { title: "Plan the 2.4 release", space: "Atlas", teammate: "Release captain" }, children: 1 });
    expect(index.get(SESSIONS.dispatched)).toMatchObject({
      origin: "sub-agent", drivenBy: "Realm", parentId: SESSIONS.realm, realm: { title: "Check the changelog", space: "Atlas", teammate: null },
    });
  });

  it("finds sub-agents and one-shots only when they are asked for", () => {
    expect(index.list({ parentId: SESSIONS.typed }, 200, 0).sessions.map((s) => [s.id, s.origin, s.title])).toEqual([[SESSIONS.subAgent, "sub-agent", "List what changed since 2.3"]]);
    expect(index.list({ origins: ["one-shot"] }, 200, 0).sessions.map((s) => s.id)).toEqual([SESSIONS.oneShot]);
  });

  it("narrows by agent, project and words, and pages", () => {
    const atlas = index.get(SESSIONS.typed).projectId!;
    expect(index.list({ agent: "codex" }, 200, 0).matched).toBe(1);
    expect(index.list({ projectId: atlas }, 200, 0).sessions.map((s) => s.id)).toEqual([SESSIONS.realm, SESSIONS.typed]);
    expect(index.list({ query: "release atlas" }, 200, 0).sessions.map((s) => s.id)).toEqual([SESSIONS.realm, SESSIONS.typed]);
    expect(index.list({ query: "100%" }, 200, 0).matched).toBe(0);
    expect(index.list({}, 1, 1)).toMatchObject({ matched: 3, sessions: [{ id: SESSIONS.codex }] });
  });

  it("counts every session by origin, and the conversations a person had by agent and by project", () => {
    expect(index.facets()).toEqual({
      total: 6,
      agents: [{ agent: "claude", count: 2 }, { agent: "codex", count: 1 }],
      origins: [{ origin: "app", count: 1 }, { origin: "one-shot", count: 1 }, { origin: "person", count: 2 }, { origin: "sub-agent", count: 2 }],
      projects: [{ id: index.get(SESSIONS.typed).projectId, name: "atlas", count: 2 }, { id: index.get(SESSIONS.codex).projectId, name: "beacon", count: 1 }],
    });
  });
});

describe("a second run of the index", () => {
  it("does not read an unchanged file again, and reads a changed one", async () => {
    const home = buildFixtureHome(tempDir("amc-sessions-again-"));
    const again = openDatabase(":memory:");
    const second = new SessionIndex({ db: again, home: home.home, library: libraryOf(home.home), whyWait: () => null });
    await second.refresh();
    expect(second.status()).toEqual({ state: "idle", files: 6, listed: 6, measured: 6, pausedWhy: null });

    // THE MUTANT: every start reads every file, and 5,000 transcripts are opened to learn nothing.
    again.exec("UPDATE sessions SET title = 'as the index left it'");
    await second.refresh();
    expect(second.get(SESSIONS.codex).title).toBe("as the index left it");
    expect(second.status().measured).toBe(6);

    appendFileSync(second.get(SESSIONS.oneShot).path, `${JSON.stringify({ type: "user", message: { role: "user", content: "And a second line for it" }, sessionId: SESSIONS.oneShot, entrypoint: "sdk-ts" })}\n`);
    await second.look();
    expect(second.get(SESSIONS.oneShot)).toMatchObject({ title: "Give this commit a one-line summary: fix the date on the receipt", origin: "app", metrics: null });
    expect(second.get(SESSIONS.codex).title).toBe("as the index left it");
    expect(second.status().measured).toBe(5);
  });
});

describe("the second look", () => {
  it("waits while the Mac should be left alone, says why, and goes on when it may", async () => {
    let why: string | null = "on battery";
    const waiting = new SessionIndex({ db, home: at.home, library, whyWait: () => why, waitMs: 2 });
    const measuring = waiting.measure();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(waiting.status()).toMatchObject({ state: "paused", pausedWhy: "on battery", measured: 0 });

    why = null;
    await measuring;
    expect(waiting.status()).toMatchObject({ measured: 6, pausedWhy: null });
  });

  it("measures nothing more once it is told to stop", async () => {
    const home = buildFixtureHome(tempDir("amc-sessions-stop-"));
    const stopping = new SessionIndex({ db: openDatabase(":memory:"), home: home.home, library: libraryOf(home.home), whyWait: () => null });
    await stopping.look();
    stopping.stop();
    await stopping.measure();
    expect(stopping.status()).toMatchObject({ files: 6, listed: 6, measured: 0 });
  });

  it("counts turns, tools, tokens and the cost the agent recorded", () => {
    expect(index.get(SESSIONS.typed).metrics).toEqual({ userTurns: 2, assistantTurns: 5, toolCalls: 3, toolErrors: 1, inputTokens: 7000, outputTokens: 171, costUsd: 0.42 });
    expect(index.get(SESSIONS.codex).metrics).toEqual({ userTurns: 1, assistantTurns: 1, toolCalls: 2, toolErrors: 1, inputTokens: 2100, outputTokens: 140, costUsd: null });
    expect(index.get(SESSIONS.oneShot).origin).toBe("one-shot");
  });
});

describe("reading a transcript a stretch at a time", () => {
  const typed = () => index.file(SESSIONS.typed).path;

  it("gives a Claude session's blocks in file order, each tool with what came back", () => {
    const { blocks, next } = readStretch(typed(), "claude", undefined, 120);
    expect(next).toBeNull();
    expect(blocks.map((b) => [b.kind, b.kind === "tool" ? `${b.name} ${b.failed}` : b.kind === "note" ? b.label : b.text.slice(0, 12)])).toEqual([
      ["note", "Hook · SessionStart"], ["user", "Tag the 2.4 "], ["thinking", "The tag has "],
      ["tool", "Bash false"], ["tool", "Bash true"], ["note", "Task notification"], ["tool", "Agent false"],
      ["assistant", "Tagged **v2."], ["user", "Try the push"], ["assistant", "Pushed."],
    ]);
    expect(blocks[4]).toMatchObject({ input: '{"command":"git push origin v2.4.0"}', output: "fatal: could not read from remote repository", failed: true });
    expect(blocks[6]).toMatchObject({ output: "Two fixes and the new signing step." });
  });

  it("gives a Codex session's blocks in the same shape", () => {
    const { blocks } = readStretch(index.file(SESSIONS.codex).path, "codex", undefined, 120);
    expect(blocks.map((b) => [b.kind, b.kind === "tool" ? `${b.name} ${b.failed}` : b.kind === "note" ? b.label : b.text.slice(0, 12)])).toEqual([
      ["note", "Instructions"], ["note", "Environment context"], ["user", "Why is the b"], ["thinking", "Look at the "],
      ["tool", "shell false"], ["tool", "apply_patch true"], ["assistant", "Fuse 3 blew "],
    ]);
    expect(blocks[4]).toMatchObject({ output: "Exit code: 0\nWall time: 0.1 seconds\nOutput:\nfuse 3 blew at 02:10" });
  });

  it("starts each stretch where the last one stopped, and reads the same blocks whatever the stretch", () => {
    const whole = readStretch(typed(), "claude", undefined, 120).blocks;
    for (const limit of [1, 3, 4, 7]) {
      const pieced = [];
      let cursor: string | undefined;
      for (let calls = 0; calls < 20; calls++) {
        const stretch = readStretch(typed(), "claude", cursor, limit);
        expect(stretch.blocks.length).toBeLessThanOrEqual(limit);
        pieced.push(...stretch.blocks);
        if (stretch.next === null) break;
        cursor = stretch.next;
      }
      expect(pieced).toEqual(whole);
    }
  });

  it("gives a tool call at a stretch's end the result that lies past it", () => {
    // THE MUTANT: the stretch stops at its last block, and the call is drawn as never having answered.
    const { blocks, next } = readStretch(typed(), "claude", undefined, 5);
    expect(blocks.at(-1)).toMatchObject({ kind: "tool", output: "fatal: could not read from remote repository", failed: true });
    expect(readStretch(typed(), "claude", next!, 1).blocks).toMatchObject([{ kind: "note", label: "Task notification" }]);
  });

  it("stops between two blocks of one record and picks up at the second", () => {
    const first = readStretch(index.file(SESSIONS.realm).path, "claude", undefined, 1);
    expect(first.next).toBe(`${first.next!.split(".")[0]}.0`);
    const helper = index.file(SESSIONS.subAgent).path;
    appendFileSync(helper, `${JSON.stringify({ type: "assistant", message: { id: "msg-s3", model: "claude-fixture-1", content: [{ type: "text", text: "One more look." }, { type: "tool_use", id: "tool-s3", name: "Read", input: {} }] } })}\n`);
    const upTo = readStretch(helper, "claude", undefined, 4);
    expect(upTo.blocks.at(-1)).toMatchObject({ kind: "assistant", text: "One more look." });
    expect(upTo.next!.endsWith(".1")).toBe(true);
    expect(readStretch(helper, "claude", upTo.next!, 4)).toMatchObject({ blocks: [{ kind: "tool", name: "Read", output: null }], next: null });
  });

  it("keeps a Codex stretch's model when it starts past where the model is named", () => {
    const { next } = readStretch(index.file(SESSIONS.codex).path, "codex", undefined, 6);
    expect(readStretch(index.file(SESSIONS.codex).path, "codex", next!, 6).blocks).toMatchObject([{ kind: "assistant", model: "gpt-fixture-1" }]);
  });

  it("refuses a cursor it did not give", () => {
    expect(() => readStretch(typed(), "claude", "page-2", 10)).toThrowError(/not a cursor/);
  });
});

describe("what a session had loaded", () => {
  it("reads what Claude recorded, finds each file in the library, and says which have changed since", () => {
    const context = contextOf(index.file(SESSIONS.typed), { home: at.home, library });
    const memory = `~/.claude/projects/${at.atlas.replace(/[^a-zA-Z0-9]/g, "-")}/memory/MEMORY.md`;
    expect(context.files.map((f) => [f.role, f.displayPath, f.chars, f.changedSince])).toEqual([
      ["Hook", "SessionStart:startup", 21, null],
      // Claude records a file without its last newline, which is no change to it.
      ["Instructions", "~/.claude/CLAUDE.md", 21, false],
      ["Instructions", "~/work/atlas/CLAUDE.md", 18, true],
      ["Memory", memory, 185, false],
      ["Skill list", "2 skills", 95, null],
      ["MCP instructions", "notes", 47, null],
    ]);
    expect(context).toMatchObject({ recorded: true, chars: 21 + 21 + 18 + 185 + 95 + 47 });
    const inLibrary = library.inspect().find((file) => file.real === `${at.home}/.claude/CLAUDE.md`)!;
    expect(context.files[1]!.libraryId).toBe(inLibrary.entry.id);
    expect(context.files[4]!.libraryId).toBeNull();
  });

  it("works a Codex session's out from the folder it ran in, and says it is not recorded", () => {
    const context = contextOf(index.file(SESSIONS.codex), { home: at.home, library });
    expect(context.recorded).toBe(false);
    // ~/.codex/AGENTS.md is empty in the fixture, and Codex passes over an empty file.
    expect(context.files.map((f) => [f.role, f.displayPath, f.changedSince])).toEqual([["Instructions", "~/work/beacon/AGENTS.md", null]]);
    expect(context.chars).toBe(context.files[0]!.chars);
    expect(context.files[0]!.libraryId).not.toBeNull();
  });
});
