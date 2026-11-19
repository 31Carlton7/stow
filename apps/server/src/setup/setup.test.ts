import { beforeAll, describe, expect, it } from "vitest";
import { tempDir } from "@amc/test-utils";
import { buildFixtureHome } from "../../../../fixtures/home.mjs";
import { openDatabase } from "../db/database";
import { Library } from "../library/library";
import { projectId } from "../library/projects";
import { TagStore } from "../library/tags";
import { Hooks } from "./hooks";
import { McpServers } from "./mcp";
import { Skills } from "./skills";

let at: ReturnType<typeof buildFixtureHome>;
let skills: Skills;
let mcp: McpServers;
let hooks: Hooks;

beforeAll(() => {
  at = buildFixtureHome(tempDir("amc-setup-"));
  const library = new Library({ home: at.home, backups: tempDir("amc-setup-backups-"), tags: new TagStore(openDatabase(":memory:")), trash: async () => {} });
  const projects = () => library.projects();
  skills = new Skills({ home: at.home, projects });
  mcp = new McpServers({ home: at.home, projects, projectAt: (folder) => library.projectAt(folder) });
  hooks = new Hooks({ home: at.home, projects });
});

describe("skills", () => {
  it("lists a skill once per real folder, with every place it is reached from", () => {
    const shared = skills.list().find((s) => s.places.some((p) => p.label === "Shared"))!;
    expect(shared).toMatchObject({ name: "release-notes", valid: true, description: "Write the notes for a release from its merged pull requests" });
    // THE MUTANT: one row per skills folder, and a link into ~/.agents/skills is listed as a second skill.
    expect(shared.places).toEqual([
      { label: "Shared", displayPath: "~/.agents/skills/release-notes", linked: false },
      { label: "Claude", displayPath: "~/.claude/skills/release-notes", linked: true },
    ]);
  });

  it("tells a copied folder from a link, and a different skill of the same name from both", () => {
    const named = skills.list().filter((s) => s.name === "release-notes");
    expect(named.map((s) => [s.places[0]!.label, s.copies, s.variants])).toEqual(expect.arrayContaining([
      ["Shared", 2, 1], ["Realm", 2, 1], ["Codex", 1, 2],
    ]));
    expect(named).toHaveLength(3);
  });

  it("finds a project's skills and a skill sorted into a category, and marks one an agent could not pick", () => {
    const all = skills.list();
    expect(all.find((s) => s.name === "ship")!.places[0]).toMatchObject({ label: "atlas · .claude" });
    expect(all.find((s) => s.name === "tone")!.places[0]).toMatchObject({ label: "Hermes", displayPath: "~/.hermes/skills/writing/tone" });
    expect(all.find((s) => s.name === "scratch")).toMatchObject({ valid: false, description: null });
  });

  it("reads a skill's body and the other files in its folder", () => {
    const shared = skills.list().find((s) => s.places.some((p) => p.label === "Shared"))!;
    expect(skills.read(shared.id)).toMatchObject({ body: "\nGroup changes by what a person will notice.\n", files: ["reference/tone.md"] });
    expect(() => skills.read("nope")).toThrowError(/no skill/);
  });
});

describe("MCP servers", () => {
  it("lists a server once, with every place it is defined", () => {
    const servers = mcp.list();
    expect(servers.map((s) => s.name)).toEqual(["atlasdb", "notes", "realm-tools", "search"]);
    const notes = servers.find((s) => s.name === "notes")!;
    expect(notes.definitions.map((d) => [d.agent, d.file])).toEqual([["Claude Code", "~/.claude.json"], ["Cursor", "~/.cursor/mcp.json"]]);
    expect(notes).toMatchObject({ conflict: false });
    expect(notes.definitions[0]).toMatchObject({ transport: "stdio", target: "npx -y @example/notes-mcp", envKeys: ["NOTES_TOKEN"] });
  });

  it("says when the places disagree about how to start it", () => {
    const search = mcp.list().find((s) => s.name === "search")!;
    expect(search.conflict).toBe(true);
    expect(search.definitions.map((d) => [d.agent, d.target, d.envKeys])).toEqual([
      ["Claude Code", "npx -y @example/search-mcp --api-key ••••", []],
      ["Codex", "npx -y @example/search-mcp@2", ["SEARCH_KEY"]],
    ]);
  });

  it("files a project's server under its project, and reads Realm's own", () => {
    const servers = mcp.list();
    expect(servers.find((s) => s.name === "atlasdb")!.definitions[0]).toMatchObject({
      agent: "Claude Code", projectId: projectId(at.atlas), projectName: "atlas", transport: "http",
      target: "https://db.example.com/mcp?token=••••", headerKeys: ["Authorization"],
    });
    expect(servers.find((s) => s.name === "realm-tools")!.definitions[0]).toMatchObject({ agent: "Realm", transport: "http", target: "http://127.0.0.1:8123/mcp" });
  });
});

describe("hooks", () => {
  it("reads each agent's own shape into one list", () => {
    expect(hooks.list().map((h) => [h.agent, h.event, h.matcher, h.command])).toEqual([
      ["Claude Code", "PostToolUse", "Edit|Write", "pnpm lint --fix"],
      ["Claude Code", "Stop", null, "notify --token •••• done"],
      ["Codex", "Stop", null, "say done"],
      ["Cursor", "beforeSubmitPrompt", null, "./check.sh"],
    ]);
  });
});

describe("secrets", () => {
  it("never leave the server, whichever config they were in", () => {
    // Every secret the fixture plants starts `fixture-secret`: an env value, an argument, a URL's
    // query, a header, a hook's flag, Codex's env table, Realm's secrets column, a settings value.
    const everything = JSON.stringify([skills.list(), mcp.list(), hooks.list()]);
    expect(everything).not.toContain("fixture-secret");
  });
});
