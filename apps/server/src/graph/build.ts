import { LIBRARY_GROUP_LABEL, LIBRARY_KIND_LABEL, type Graph, type GraphEdge, type GraphEdgeKind, type GraphNode, type LibraryEntry, type LibraryGroup, type McpServer, type Session, type Skill } from "@amc/contracts";
import { within } from "../library/paths";
import type { Project } from "../library/projects";

/** One library file with what the graph draws of it besides its row. */
export type GraphFile = {
  entry: LibraryEntry;
  /** The text's hash, or null for an empty file. */
  hash: string | null;
  real: string;
  /** Who loads it, in the library's own sentence. */
  by: string;
  /** The ids of the files it links to. */
  links: string[];
};

export type GraphParts = {
  home: string;
  projects: readonly Project[];
  files: readonly GraphFile[];
  skills: readonly Skill[];
  servers: readonly McpServer[];
  /** The conversations a person had, newest first. */
  sessions: readonly Session[];
};

/** How many of a project's newest conversations are each drawn; the older ones are gathered by month. */
export const RECENT_PER_PROJECT = 8;

export const agentNodeId = (agent: string): string => `agent:${agent}`;
export const projectNodeId = (id: string): string => `project:${id}`;
export const fileNodeId = (id: string): string => `file:${id}`;
export const sessionNodeId = (id: string): string => `session:${id}`;
const skillNodeId = (id: string): string => `skill:${id}`;
const mcpNodeId = (name: string): string => `mcp:${name}`;

/** The name an agent's mark is drawn from. Claude Code is the library's "Claude"; Claude Desktop is an app of its own. */
function agentKey(name: string): string {
  const lower = name.trim().toLowerCase();
  if (lower === "claude code" || lower === "claude") return "claude";
  return lower.replace(/[^a-z0-9]+/g, "-");
}

/**
 * Whether the agent puts the file in front of the model as a session starts. Instructions and rules
 * are; of a folder of memories only its index is, unless the library says the agent loads them all;
 * a copy Realm imported is read by no agent.
 */
function loadedAtStart(file: GraphFile): boolean {
  const { kind, index } = file.entry;
  if (kind === "imported") return false;
  if (kind === "memory" || kind === "project-memory" || kind === "documents") return index || file.by.includes(" loads ");
  return true;
}

const monthOf = (at: number): string => {
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
};
const monthLabel = (month: string): string =>
  new Date(Number(month.slice(0, 4)), Number(month.slice(5)) - 1, 1).toLocaleString("en", { month: "short", year: "numeric" });

/** Every node and edge, from what the library, the setup readers and the session index already hold. */
export function buildGraph(parts: GraphParts): Pick<Graph, "nodes" | "edges"> {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const projectName = new Map(parts.projects.map((project) => [project.id, project.name]));

  const join = (source: string, target: string, kind: GraphEdgeKind): void => {
    if (source !== target) edges.set(`${source}\n${target}\n${kind}`, { source, target, kind });
  };
  const agent = (name: string): string => {
    const key = agentKey(name);
    const id = agentNodeId(key);
    if (!nodes.has(id)) {
      const group = key in LIBRARY_GROUP_LABEL ? (key as LibraryGroup) : null;
      nodes.set(id, {
        id, kind: "agent", label: group ? LIBRARY_GROUP_LABEL[group] : name, agent: key, size: 0, unit: "count", detail: null,
        open: group ? { section: "library", what: "agent", id: group } : null,
      });
    }
    return id;
  };
  const project = (id: string, name: string | null): string => {
    const nodeId = projectNodeId(id);
    if (!nodes.has(nodeId)) nodes.set(nodeId, { id: nodeId, kind: "project", label: projectName.get(id) ?? name ?? id, agent: null, size: 0, unit: "count", detail: null, open: null });
    return nodeId;
  };

  for (const file of parts.files) {
    const { entry } = file;
    const id = fileNodeId(entry.id);
    nodes.set(id, {
      id, kind: "file", label: entry.title, agent: entry.group, size: entry.size, unit: "bytes",
      detail: `${LIBRARY_GROUP_LABEL[entry.group]} · ${LIBRARY_KIND_LABEL[entry.kind]}. ${file.by}`,
      open: { section: "library", what: "file", id: entry.id },
    });
    // One line between a file and its agent: that the agent loads it says more than that it is kept there.
    if (loadedAtStart(file)) join(agent(entry.group), id, "loads");
    else join(id, agent(entry.group), "belongs");
    if (entry.projectId !== null) {
      const owner = project(entry.projectId, null);
      join(id, owner, "belongs");
      nodes.get(owner)!.open ??= { section: "library", what: "project", id: entry.projectId };
    }
  }
  const held = new Set(parts.files.map((file) => file.entry.id));
  const byHash = new Map<string, GraphFile[]>();
  for (const file of parts.files) {
    for (const target of file.links) if (held.has(target)) join(fileNodeId(file.entry.id), fileNodeId(target), "links");
    if (file.hash !== null) byHash.set(file.hash, [...(byHash.get(file.hash) ?? []), file]);
  }
  for (const copies of byHash.values()) {
    const kept = copies.find((file) => file.entry.canonical) ?? copies[0]!;
    // A link and the file it points at are one file, not two copies.
    for (const copy of copies) if (copy.real !== kept.real) join(fileNodeId(copy.entry.id), fileNodeId(kept.entry.id), "copy");
  }

  for (const skill of parts.skills) {
    const id = skillNodeId(skill.id);
    nodes.set(id, {
      id, kind: "skill", label: skill.name, agent: null, size: skill.places.length, unit: "count", detail: skill.description,
      open: { section: "skills", what: "skill", id: skill.id },
    });
    for (const place of skill.places) {
      const folder = place.displayPath.startsWith("~/") ? `${parts.home}${place.displayPath.slice(1)}` : place.displayPath;
      const owner = place.label.includes(" · ") ? parts.projects.find((candidate) => within(folder, candidate.root)) : undefined;
      if (owner) join(id, project(owner.id, owner.name), "set-up-for");
      // A plugin's skills are Claude Code's. `~/.agents/skills` is no one agent's, so it joins nothing.
      else if (place.label.endsWith(" plugin")) join(id, agent("Claude"), "set-up-for");
      else if (place.label !== "Shared" && !place.label.includes(" · ")) join(id, agent(place.label), "set-up-for");
    }
  }

  for (const server of parts.servers) {
    const id = mcpNodeId(server.name);
    const count = server.definitions.length;
    nodes.set(id, {
      id, kind: "mcp", label: server.name, agent: null, size: count, unit: "count",
      detail: `Defined in ${count} ${count === 1 ? "place" : "places"}${server.conflict ? ", not the same way in all of them" : ""}.`,
      open: { section: "mcp", what: "server", id: server.name },
    });
    for (const definition of server.definitions) {
      if (definition.projectId !== null) join(id, project(definition.projectId, definition.projectName), "set-up-for");
      else join(id, agent(definition.agent), "set-up-for");
    }
  }

  const drawn = new Map<string, number>();
  const gathered = new Map<string, Session[]>();
  for (const session of parts.sessions) {
    const owner = session.projectId ?? "";
    const before = drawn.get(owner) ?? 0;
    drawn.set(owner, before + 1);
    // Conversations in no project have nothing to be the newest of: all of them are gathered.
    if (session.projectId === null || before >= RECENT_PER_PROJECT) {
      const key = `${owner}\n${monthOf(session.endedAt)}`;
      gathered.set(key, [...(gathered.get(key) ?? []), session]);
      continue;
    }
    const id = sessionNodeId(session.id);
    nodes.set(id, {
      id, kind: "session", label: session.title, agent: session.agent, size: session.sizeBytes, unit: "bytes",
      detail: `${LIBRARY_GROUP_LABEL[session.agent]}${session.drivenBy ? `, through ${session.drivenBy}` : ""} · ${new Date(session.endedAt).toLocaleDateString("en", { dateStyle: "medium" })}`,
      open: { section: "sessions", what: "session", id: session.id },
    });
    join(id, project(session.projectId, session.projectName), "ran-in");
    join(id, agent(session.agent), "ran-with");
  }
  for (const [key, sessions] of gathered) {
    const [owner, month] = key.split("\n") as [string, string];
    const id = `sessions:${owner}:${month}`;
    const where = owner === "" ? "in no project" : `in ${projectName.get(owner) ?? sessions[0]!.projectName ?? "one project"}`;
    nodes.set(id, {
      id, kind: "sessions", label: `${monthLabel(month)} · ${sessions.length}`, agent: null, size: sessions.length, unit: "count",
      detail: `${sessions.length} ${sessions.length === 1 ? "conversation" : "conversations"} ${where}, ${monthLabel(month)}.`,
      open: owner === "" ? null : { section: "sessions", what: "project", id: owner },
    });
    if (owner !== "") join(id, project(owner, sessions[0]!.projectName), "ran-in");
    for (const session of sessions) join(id, agent(session.agent), "ran-with");
  }

  for (const node of nodes.values()) {
    if (node.kind === "project" && node.open === null && drawn.has(node.id.slice("project:".length))) {
      node.open = { section: "sessions", what: "project", id: node.id.slice("project:".length) };
    }
  }
  for (const edge of edges.values()) {
    for (const end of [edge.source, edge.target]) {
      const hub = nodes.get(end)!;
      if (hub.kind === "agent" || hub.kind === "project") hub.size += 1;
    }
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

/**
 * The graph around one agent or project: that node, everything an edge joins it to, and the agents
 * and projects those belong to, so a project's files still show whose they are.
 */
export function graphAround(whole: Pick<Graph, "nodes" | "edges">, id: string): Pick<Graph, "nodes" | "edges"> {
  const byId = new Map(whole.nodes.map((node) => [node.id, node]));
  const kept = new Set([id]);
  for (const edge of whole.edges) {
    if (edge.source === id) kept.add(edge.target);
    if (edge.target === id) kept.add(edge.source);
  }
  const isHub = (nodeId: string): boolean => { const kind = byId.get(nodeId)?.kind; return kind === "agent" || kind === "project"; };
  const hubs = new Set<string>();
  for (const edge of whole.edges) {
    if (kept.has(edge.source) && edge.source !== id && !isHub(edge.source) && isHub(edge.target)) hubs.add(edge.target);
    if (kept.has(edge.target) && edge.target !== id && !isHub(edge.target) && isHub(edge.source)) hubs.add(edge.source);
  }
  for (const hub of hubs) kept.add(hub);
  return {
    nodes: whole.nodes.filter((node) => kept.has(node.id)),
    edges: whole.edges.filter((edge) => kept.has(edge.source) && kept.has(edge.target)),
  };
}
