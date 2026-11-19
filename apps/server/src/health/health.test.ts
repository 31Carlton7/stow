import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { Finding, ProposedChange } from "@amc/contracts";
import { tempDir } from "@amc/test-utils";
import { SESSIONS, buildFixtureHome, claudeSlug } from "../../../../fixtures/home.mjs";
import { openDatabase, type Db } from "../db/database";
import { Library } from "../library/library";
import { realOr } from "../library/paths";
import { TagStore } from "../library/tags";
import { SessionIndex } from "../sessions/index";
import { Skills } from "../setup/skills";
import { Health, type HealthDeps } from "./health";

// What the fixture's typed Claude session recorded loading.
const HOOK = "Today is release day.";
const USER_RULES = "Prefer small commits.";
const ATLAS_RULES = "# Atlas\n\nUse npm.\n";
const MEMORY_INDEX = "- [deploy-steps](deploy-steps.md) — How Atlas ships: sign, notarize, then publish\n- [release-day](release-day.md) — Releases go out on Mondays\n- [old-flag](old-flag.md) — The beta flag\n";
const SKILL_LIST = "- release-notes: Write the notes for a release from its merged pull requests\n- ship: Ship Atlas";
const MCP_NOTES = "Search the notes before you answer from memory.";

let at: ReturnType<typeof buildFixtureHome>;
let db: Db;
let library: Library;
let findings: Finding[];
let proposals: Record<string, ProposedChange[]>;

const finding = (fingerprint: string, ids: string[], ready = true): Finding => ({
  fingerprint, type: "stale", severity: "low", title: `Finding ${fingerprint}`, detail: "",
  subjects: ids.map((id) => ({ id, label: id, displayPath: id })), fix: ready ? "Delete it." : null, judgedBy: null, needsDraft: false,
});
const idOf = (path: string): string => library.inspect().find((file) => file.real === realOr(path))!.entry.id;
const change = (id: string, before: string, after: string | null): ProposedChange => ({ id, label: id, displayPath: id, before, after, removal: after === null ? "trash" : null });

const health = (more: Partial<HealthDeps> = {}): Health => new Health({
  db, home: at.home, library, skills: new Skills({ home: at.home, projects: () => library.projects() }),
  review: { scan: () => ({ findings, rejected: 0 }), proposal: (fingerprint) => proposals[fingerprint] ?? [] },
  whyWait: () => null, ...more,
});

beforeEach(async () => {
  at = buildFixtureHome(tempDir("amc-health-"));
  db = openDatabase(":memory:");
  library = new Library({ home: at.home, backups: tempDir("amc-health-backups-"), tags: new TagStore(openDatabase(":memory:")), trash: async () => {} });
  await new SessionIndex({ db, home: at.home, library, whyWait: () => null }).look();
  findings = [];
  proposals = {};
});

describe("what a session carries", () => {
  it("takes a Claude session's load from what its transcript recorded, by kind", async () => {
    const measured = health();
    await measured.refresh();
    const claude = measured.summary().carried.find((c) => c.agent === "claude")!;
    expect(claude.kinds).toEqual([
      { kind: "instructions", chars: USER_RULES.length + ATLAS_RULES.length },
      { kind: "memory", chars: MEMORY_INDEX.length },
      { kind: "skills", chars: SKILL_LIST.length },
      { kind: "mcp", chars: MCP_NOTES.length },
      { kind: "hooks", chars: HOOK.length },
    ]);
    expect(claude.chars).toBe(USER_RULES.length + ATLAS_RULES.length + MEMORY_INDEX.length + SKILL_LIST.length + MCP_NOTES.length + HOOK.length);
    // THE MUTANT: the session Realm drove recorded nothing, and counted as a session that loaded nothing it halves the mean.
    expect(claude).toMatchObject({ sessions: 1, empty: 1, recorded: true });
  });

  it("works a Codex session's load out from the AGENTS.md files where it ran", async () => {
    const measured = health();
    await measured.refresh();
    const codex = measured.summary().carried.find((c) => c.agent === "codex")!;
    const rules = readFileSync(join(at.beacon, "AGENTS.md"), "utf8");
    expect(codex).toEqual({ agent: "codex", sessions: 1, empty: 0, recorded: false, chars: rules.length, kinds: [{ kind: "instructions", chars: rules.length }] });
  });

  it("names what was loaded, the heaviest across sessions first, with the library file it is", async () => {
    const measured = health();
    await measured.refresh();
    const { contributors } = measured.summary();
    expect(contributors[0]).toMatchObject({ agent: "claude", kind: "memory", chars: MEMORY_INDEX.length, sessions: 1 });
    expect(contributors[0]!.libraryId).toBe(idOf(join(at.home, ".claude/projects", claudeSlug(at.atlas), "memory/MEMORY.md")));
    expect(contributors.find((c) => c.kind === "skills")).toMatchObject({ label: "2 skills", libraryId: null });
  });
});

describe("reading recent sessions", () => {
  it("waits while the Mac should be left alone, and says why", async () => {
    let why: string | null = "on battery";
    const measured = health({ whyWait: () => why, waitMs: 5 });
    expect(measured.status()).toMatchObject({ sessions: 3, read: 0 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(measured.status()).toMatchObject({ state: "paused", pausedWhy: "on battery", read: 0 });
    why = null;
    await measured.refresh();
    expect(measured.status()).toEqual({ state: "idle", sessions: 3, read: 3, pausedWhy: null });
  });

  it("does not open a transcript again that has not changed", async () => {
    await health().refresh();
    db.exec("UPDATE session_context SET files_json = '[]'");
    const again = health();
    await again.refresh();
    expect(again.summary().carried.map((c) => c.sessions)).toEqual([0, 0]);
  });
});

describe("what the findings touch", () => {
  it("counts the recent sessions that loaded a file a finding is about", async () => {
    const atlasRules = idOf(join(at.atlas, "CLAUDE.md"));
    const beaconRules = idOf(join(at.beacon, "AGENTS.md"));
    const unloaded = library.inspect().find((file) => file.entry.rel.endsWith("old-flag.md"))!;
    findings = [finding("a", [atlasRules, beaconRules]), finding("b", [atlasRules]), finding("c", [unloaded.entry.id])];
    const measured = health();
    await measured.refresh();
    const { reach } = measured.summary();
    const text = (id: string): number => library.inspect().find((file) => file.entry.id === id)!.text.length;
    expect(reach).toEqual({
      findings: 3, files: 3, chars: text(atlasRules) + text(beaconRules) + unloaded.text.length,
      // THE MUTANT: one session that two findings reach is two sessions.
      sessions: 2,
      widest: [
        { fingerprint: "a", type: "stale", title: "Finding a", sessions: 2 },
        { fingerprint: "b", type: "stale", title: "Finding b", sessions: 1 },
      ],
    });
  });
});

describe("what the ready fixes would change", () => {
  it("adds up the files that go, the bytes freed, and what each agent's session would no longer load", async () => {
    const atlasRules = idOf(join(at.atlas, "CLAUDE.md"));
    const unloaded = library.inspect().find((file) => file.entry.rel.endsWith("old-flag.md"))!.entry.id;
    findings = [finding("a", [atlasRules]), finding("b", [unloaded]), finding("c", [atlasRules]), finding("d", [atlasRules], false)];
    proposals = {
      a: [change(atlasRules, "# Atlas\n\nUse npm — always.\n", "# Atlas\n")],
      b: [change(unloaded, "gone é", null)],
      c: [change(atlasRules, "# Atlas\n\nUse npm — always.\n", null)],
      d: [change(unloaded, "never asked for", null)],
    };
    const measured = health();
    await measured.refresh();
    expect(measured.summary().fixes).toEqual({
      ready: 3, filesRemoved: 1, filesChanged: 1,
      // Bytes, not characters: the dash and the é are more than one each.
      bytesFreed: (29 - 8) + 7,
      perSession: [{ agent: "claude", chars: 27 - 8 }, { agent: "codex", chars: 0 }],
    });
  });
});

describe("storage", () => {
  it("adds up what is on disk by kind", async () => {
    const transcripts = [join(at.home, ".claude/projects"), join(at.home, ".codex/sessions")].flatMap((dir) => readdirSync(dir, { recursive: true, withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl") && !entry.parentPath.includes("/memory")).map((entry) => statSync(join(entry.parentPath, entry.name)).size);
    const helper = statSync(join(at.home, ".claude/projects", claudeSlug(at.atlas), SESSIONS.typed, "subagents/agent-a7c2.jsonl")).size;
    const { storage } = health().summary();
    const of = (kind: string) => storage.find((s) => s.kind === kind)!;
    const held = new Map(library.inspect().map((file) => [file.real, file.entry.size]));
    expect(of("memory")).toEqual({ kind: "memory", files: held.size, bytes: [...held.values()].reduce((a, b) => a + b, 0) });
    const kept = [of("conversations"), of("one-shot"), of("sub-agents")];
    expect(kept.reduce((sum, kind) => sum + kind.files, 0)).toBe(transcripts.length);
    expect(kept.reduce((sum, kind) => sum + kind.bytes, 0)).toBe(transcripts.reduce((a, b) => a + b, 0));
    expect(of("sub-agents").bytes).toBeGreaterThanOrEqual(helper);
    expect(of("one-shot").files).toBe(1);
    expect(of("skills").files).toBeGreaterThan(0);
    expect(of("skills").bytes).toBeGreaterThanOrEqual(statSync(join(at.home, ".codex/skills/release-notes/SKILL.md")).size);
  });
});
