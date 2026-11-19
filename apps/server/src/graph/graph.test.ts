import { beforeAll, describe, expect, it } from "vitest";
import type { GraphEdge, LibraryEntry, McpServer, Session, Skill } from "@amc/contracts";
import { tempDir } from "@amc/test-utils";
import { buildFixtureHome, SESSIONS } from "../../../../fixtures/home.mjs";
import { openDatabase } from "../db/database";
import { Library } from "../library/library";
import { TagStore } from "../library/tags";
import { SessionIndex } from "../sessions/index";
import { McpServers } from "../setup/mcp";
import { Skills } from "../setup/skills";
import { RECENT_PER_PROJECT, buildGraph, graphAround, type GraphFile, type GraphParts } from "./build";
import { ConnectionGraph } from "./graph";

const HOME = "/home/ada";
const ATLAS = { id: "p-atlas", name: "atlas", root: `${HOME}/work/atlas` };

const file = (id: string, over: Partial<LibraryEntry> = {}, more: Partial<Omit<GraphFile, "entry">> = {}): GraphFile => ({
  entry: {
    id, sourceId: id.split(":")[0]!, group: "claude", kind: "project-memory", path: `${HOME}/${id}`, rel: id.split(":")[1]!, title: id, description: null,
    type: null, folder: null, projectId: null, index: false, updatedAt: 0, size: 100, copies: 1, canonical: true, tags: [], match: null, ...over,
  },
  hash: id, real: `${HOME}/${id}`, by: "Claude Code keeps these for a project.", links: [], ...more,
});
const session = (id: string, over: Partial<Session> = {}): Session => ({
  id, agent: "claude", origin: "person", drivenBy: null, title: id, projectId: ATLAS.id, projectName: "atlas", cwd: "~/work/atlas", model: null,
  startedAt: 0, endedAt: Date.UTC(2026, 5, 15), sizeBytes: 2048, metrics: null, parentId: null, children: 0, realm: null, path: `/t/${id}.jsonl`, displayPath: `/t/${id}.jsonl`, ...over,
});
const parts = (over: Partial<GraphParts>): GraphParts => ({ home: HOME, projects: [ATLAS], files: [], skills: [], servers: [], sessions: [], ...over });
const edgesOf = (edges: readonly GraphEdge[]): string[] => edges.map((edge) => `${edge.source} ${edge.kind} ${edge.target}`).sort();

describe("the graph's files", () => {
  it("joins an agent to what it loads as a session starts, and anything else to where it is kept", () => {
    const { nodes, edges } = buildGraph(parts({ files: [
      file("mem:MEMORY.md", { index: true, projectId: ATLAS.id }),
      file("mem:deploy.md", { projectId: ATLAS.id }),
      file("ins:CLAUDE.md", { kind: "instructions" }),
      file("imp:old.md", { group: "realm", kind: "imported" }, { by: "No agent reads them." }),
    ] }));
    // THE MUTANT: every file "loads", and a memory an agent only opens when it needs it is drawn as always in context.
    expect(edgesOf(edges)).toEqual([
      "agent:claude loads file:ins:CLAUDE.md",
      "agent:claude loads file:mem:MEMORY.md",
      "file:imp:old.md belongs agent:realm",
      "file:mem:MEMORY.md belongs project:p-atlas",
      "file:mem:deploy.md belongs agent:claude",
      "file:mem:deploy.md belongs project:p-atlas",
    ]);
    expect(nodes.find((node) => node.id === "file:mem:deploy.md")).toMatchObject({ kind: "file", agent: "claude", size: 100, unit: "bytes", open: { section: "library", what: "file", id: "mem:deploy.md" } });
    expect(nodes.find((node) => node.id === "project:p-atlas")).toMatchObject({ label: "atlas", size: 2, open: { section: "library", what: "project", id: "p-atlas" } });
    expect(nodes.find((node) => node.id === "agent:claude")).toMatchObject({ label: "Claude", size: 3, open: { section: "library", what: "agent", id: "claude" } });
  });

  it("draws a link only to a file the library holds, and a copy only between two real files", () => {
    const { edges } = buildGraph(parts({ files: [
      file("mem:MEMORY.md", { index: true }, { links: ["mem:a.md", "mem:gone.md"] }),
      file("mem:a.md", {}, { hash: "same" }),
      file("codex:a.md", { group: "codex", canonical: false }, { hash: "same" }),
      file("link:a.md", { canonical: false }, { hash: "same", real: `${HOME}/mem:a.md` }),
      file("mem:empty.md", {}, { hash: null }),
      file("mem:blank.md", {}, { hash: null }),
    ] }));
    expect(edgesOf(edges).filter((edge) => edge.includes(" links ") || edge.includes(" copy "))).toEqual([
      "file:codex:a.md copy file:mem:a.md",
      "file:mem:MEMORY.md links file:mem:a.md",
    ]);
  });
});

describe("the graph's skills and servers", () => {
  it("sets a skill up for each agent that reaches it and for a project it is kept in", () => {
    const skill = (id: string, places: Skill["places"]): Skill => ({ id, name: id, description: "Ship it", path: `/s/${id}/SKILL.md`, places, copies: 1, variants: 0, valid: true, updatedAt: 0 });
    const { nodes, edges } = buildGraph(parts({ skills: [
      skill("release", [{ label: "Shared", displayPath: "~/.agents/skills/release", linked: false }, { label: "Codex", displayPath: "~/.codex/skills/release", linked: true }]),
      skill("ship", [{ label: "atlas · .claude", displayPath: "~/work/atlas/.claude/skills/ship", linked: false }]),
      skill("draw", [{ label: "figma plugin", displayPath: "~/.claude/plugins/cache/figma/skills/draw", linked: false }]),
    ] }));
    expect(edgesOf(edges)).toEqual(["skill:draw set-up-for agent:claude", "skill:release set-up-for agent:codex", "skill:ship set-up-for project:p-atlas"]);
    expect(nodes.find((node) => node.id === "skill:release")).toMatchObject({ kind: "skill", size: 2, unit: "count", detail: "Ship it", open: { section: "skills", what: "skill", id: "release" } });
  });

  it("sets a server up for the agent whose config holds it, or for the one project it is defined for", () => {
    const definition = (agent: string, projectId: string | null): McpServer["definitions"][number] => ({
      agent, projectId, projectName: projectId && "atlas", file: "~/x.json", transport: "stdio", target: "npx x", envKeys: [], headerKeys: [], disabled: false, fingerprint: agent,
    });
    const { nodes, edges } = buildGraph(parts({ servers: [
      { name: "search", conflict: true, definitions: [definition("Claude Code", null), definition("Claude Desktop", null), definition("Cursor", ATLAS.id)] },
    ] }));
    expect(edgesOf(edges)).toEqual(["mcp:search set-up-for agent:claude", "mcp:search set-up-for agent:claude-desktop", "mcp:search set-up-for project:p-atlas"]);
    expect(nodes.find((node) => node.id === "agent:claude-desktop")).toMatchObject({ label: "Claude Desktop", open: null });
    expect(nodes.find((node) => node.id === "mcp:search")).toMatchObject({ open: { section: "mcp", what: "server", id: "search" }, detail: "Defined in 3 places, not the same way in all of them." });
  });
});

describe("the graph's sessions", () => {
  it("makes one project of sessions run in different worktrees of it", () => {
    const { nodes, edges } = buildGraph(parts({ sessions: [session("a", { cwd: "~/work/atlas" }), session("b", { cwd: "~/worktrees/atlas-fix", agent: "codex" })] }));
    expect(nodes.filter((node) => node.kind === "project").map((node) => node.id)).toEqual(["project:p-atlas"]);
    expect(edgesOf(edges)).toEqual([
      "session:a ran-in project:p-atlas", "session:a ran-with agent:claude", "session:b ran-in project:p-atlas", "session:b ran-with agent:codex",
    ]);
    expect(nodes.find((node) => node.id === "project:p-atlas")!.open).toEqual({ section: "sessions", what: "project", id: "p-atlas" });
  });

  it("draws a project's newest conversations and gathers the older ones by month", () => {
    const newest = Array.from({ length: RECENT_PER_PROJECT }, (_, n) => session(`new-${n}`, { endedAt: Date.UTC(2026, 9, 20) - n }));
    const older = [
      session("may-1", { endedAt: Date.UTC(2026, 4, 12) }), session("may-2", { endedAt: Date.UTC(2026, 4, 10), agent: "codex" }),
      session("mar-1", { endedAt: Date.UTC(2026, 2, 12) }),
    ];
    const nowhere = session("loose", { projectId: null, projectName: null, endedAt: Date.UTC(2026, 9, 12) });
    const { nodes, edges } = buildGraph(parts({ sessions: [...newest, nowhere, ...older] }));
    expect(nodes.filter((node) => node.kind === "session")).toHaveLength(RECENT_PER_PROJECT);
    // THE MUTANT: one node per old session, and a project a person worked in for a year buries everything else.
    expect(nodes.filter((node) => node.kind === "sessions").map((node) => [node.id, node.label, node.size, node.open?.id ?? null])).toEqual([
      ["sessions::2026-10", "Oct 2026 · 1", 1, null],
      ["sessions:p-atlas:2026-05", "May 2026 · 2", 2, "p-atlas"],
      ["sessions:p-atlas:2026-03", "Mar 2026 · 1", 1, "p-atlas"],
    ]);
    expect(edgesOf(edges).filter((edge) => edge.startsWith("sessions:"))).toEqual([
      "sessions::2026-10 ran-with agent:claude",
      "sessions:p-atlas:2026-03 ran-in project:p-atlas", "sessions:p-atlas:2026-03 ran-with agent:claude",
      "sessions:p-atlas:2026-05 ran-in project:p-atlas", "sessions:p-atlas:2026-05 ran-with agent:claude", "sessions:p-atlas:2026-05 ran-with agent:codex",
    ]);
  });
});

describe("the graph around one node", () => {
  it("keeps what joins a project and whose those things are, and nothing else", () => {
    const whole = buildGraph(parts({
      files: [file("mem:deploy.md", { projectId: ATLAS.id }), file("codex:AGENTS.md", { group: "codex", kind: "instructions" })],
      sessions: [session("a")],
    }));
    const around = graphAround(whole, "project:p-atlas");
    expect(around.nodes.map((node) => node.id).sort()).toEqual(["agent:claude", "file:mem:deploy.md", "project:p-atlas", "session:a"]);
    expect(edgesOf(around.edges)).toEqual([
      "file:mem:deploy.md belongs agent:claude", "file:mem:deploy.md belongs project:p-atlas", "session:a ran-in project:p-atlas", "session:a ran-with agent:claude",
    ]);
    expect(graphAround(whole, "agent:codex").nodes.map((node) => node.id).sort()).toEqual(["agent:codex", "file:codex:AGENTS.md"]);
  });
});

describe("the graph of the fixture home", () => {
  let graph: ConnectionGraph;

  beforeAll(async () => {
    const at = buildFixtureHome(tempDir("amc-graph-"));
    const library = new Library({ home: at.home, backups: tempDir("amc-graph-backups-"), tags: new TagStore(openDatabase(":memory:")), trash: async () => {} });
    const projects = () => library.projects();
    const sessions = new SessionIndex({ db: openDatabase(":memory:"), home: at.home, library, whyWait: () => null });
    await sessions.look();
    graph = new ConnectionGraph({
      home: at.home, library, sessions,
      skills: new Skills({ home: at.home, projects }), mcp: new McpServers({ home: at.home, projects, projectAt: (folder) => library.projectAt(folder) }),
    });
  });

  it("draws every file, skill, server and conversation the other sections list", () => {
    const { nodes, edges, scopes } = graph.get(null);
    const count = (kind: string): number => nodes.filter((node) => node.kind === kind).length;
    expect(count("skill")).toBe(6);
    expect(count("mcp")).toBe(4);
    expect(count("file")).toBeGreaterThan(10);
    expect(count("session") + count("sessions")).toBeGreaterThan(0);
    const ids = new Set(nodes.map((node) => node.id));
    expect(edges.every((edge) => ids.has(edge.source) && ids.has(edge.target))).toBe(true);
    for (const kind of ["loads", "belongs", "links", "copy", "ran-in", "ran-with", "set-up-for"]) expect(edges.some((edge) => edge.kind === kind), kind).toBe(true);
    expect(scopes.map((scope) => scope.kind)).toEqual(expect.arrayContaining(["agent", "project"]));
  });

  it("narrows to one project, and refuses a node that is not there", () => {
    const atlas = graph.get(null).scopes.find((scope) => scope.label === "atlas")!;
    const around = graph.get(atlas.id);
    expect(around.nodes.length).toBeLessThan(graph.get(null).nodes.length);
    expect(around.nodes.some((node) => node.id === atlas.id)).toBe(true);
    expect(around.scopes).toEqual(graph.get(null).scopes);
    expect(() => graph.get("project:nope")).toThrowError(/no such/);
  });

  it("gives a node's neighbourhood, and for a Claude session the files its transcript says it loaded", () => {
    const picked = graph.neighbourhood(`session:${SESSIONS.typed}`);
    expect(picked.node.kind).toBe("session");
    expect(picked.links.filter((link) => link.kind === "ran-in").map((link) => link.node.kind)).toEqual(["project"]);
    expect(picked.links.filter((link) => link.kind === "loaded").length).toBeGreaterThan(0);
    expect(picked.links.filter((link) => link.kind === "loaded").every((link) => link.outward && link.node.kind === "file")).toBe(true);
    expect(picked.loadedElsewhere).not.toBeNull();

    const agent = graph.neighbourhood("agent:claude");
    expect(agent.loadedElsewhere).toBeNull();
    expect(agent.links.some((link) => link.kind === "loads" && link.outward)).toBe(true);
    expect(() => graph.neighbourhood("file:nope")).toThrowError(/no longer/);
  });
});
