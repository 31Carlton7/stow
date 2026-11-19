import type { Graph, GraphEdge, GraphEdgeKind, GraphNeighbourhood, GraphNode, GraphNodeKind, GraphOpen } from "@amc/contracts";
import { brandMarks, type BrandName } from "@amc/ui";

/** What the legend switches on and off. A month of gathered conversations goes with the conversations. */
export type DrawnKind = Exclude<GraphNodeKind, "sessions">;
export const DRAWN_KINDS: readonly DrawnKind[] = ["agent", "project", "file", "skill", "mcp", "session"];
export const KIND_LABEL: Record<DrawnKind, string> = {
  agent: "Agents", project: "Projects", file: "Memory and instructions", skill: "Skills", mcp: "MCP servers", session: "Conversations",
};
export const KIND_NAME: Record<GraphNodeKind, string> = {
  agent: "Agent", project: "Project", file: "File", skill: "Skill", mcp: "MCP server", session: "Conversation", sessions: "Conversations",
};
export const drawnKind = (kind: GraphNodeKind): DrawnKind => (kind === "sessions" ? "session" : kind);

export type Face = "dark" | "light";

/** The Mac's own system colours, one a kind, each in the shade its face uses. */
const KIND_COLOUR: Record<Exclude<DrawnKind, "agent">, Record<Face, string>> = {
  project: { dark: "#0A84FF", light: "#007AFF" },
  file: { dark: "#7D7AFF", light: "#5856D6" },
  skill: { dark: "#30D158", light: "#28A745" },
  mcp: { dark: "#66D4CF", light: "#00A39B" },
  session: { dark: "#BF5AF2", light: "#AF52DE" },
};
/** An agent whose vendor draws its mark in no one colour is ink, as its mark is everywhere else. */
const AGENT_INK: Record<Face, string> = { dark: "#E6E6EB", light: "#3C3C43" };
/** The agents whose mark has a colour of its own. */
const AGENT_BRAND: Record<string, BrandName> = { claude: "claude", "claude-desktop": "claude", gemini: "gemini", realm: "realm" };

export function nodeColour(node: Pick<GraphNode, "kind" | "agent">, face: Face): string {
  if (node.kind !== "agent") return KIND_COLOUR[drawnKind(node.kind) as Exclude<DrawnKind, "agent">][face];
  const brand = node.agent === null ? undefined : AGENT_BRAND[node.agent];
  const mark = brand === undefined ? undefined : brandMarks[brand];
  return mark !== undefined && "color" in mark ? mark.color : AGENT_INK[face];
}
export const legendColour = (kind: DrawnKind, face: Face): string => (kind === "agent" ? AGENT_INK[face] : KIND_COLOUR[kind][face]);

/** A sphere's volume. Agents and projects are the hubs the eye starts from; everything else grows slowly with what it holds. */
export function nodeWeight(node: Pick<GraphNode, "kind" | "size" | "unit">): number {
  if (node.kind === "agent") return 14 + Math.sqrt(node.size);
  if (node.kind === "project") return 6 + Math.sqrt(node.size);
  if (node.unit === "bytes") return 1 + Math.log10(1 + node.size / 1024);
  return 1 + Math.sqrt(node.size) / 2;
}

/** What each line means, as the legend says it. */
export const EDGE_MEANING: readonly { kind: GraphEdgeKind; label: string; means: string }[] = [
  { kind: "loads", label: "Loads", means: "An agent puts the file in front of the model when a session starts." },
  { kind: "belongs", label: "Belongs to", means: "A file is kept in an agent's folder, or is one project's." },
  { kind: "links", label: "Links to", means: "A file names another in its index or with a [[link]]." },
  { kind: "copy", label: "Copy of", means: "Two files hold exactly the same text." },
  { kind: "ran-in", label: "Ran in", means: "A conversation ran in a project." },
  { kind: "ran-with", label: "Ran with", means: "A conversation was held with an agent." },
  { kind: "set-up-for", label: "Set up for", means: "A skill or an MCP server is set up for an agent, or for one project." },
];

/** How the card heads the nodes joined by one kind of edge, from the picked node's side. */
const LINK_HEADING: Record<GraphEdgeKind, [outward: string, inward: string]> = {
  loads: ["Loads when a session starts", "Loaded when a session starts by"],
  belongs: ["Belongs to", "Holds"],
  links: ["Links to", "Linked from"],
  copy: ["Same text as", "Same text as"],
  "ran-in": ["Ran in", "Conversations here"],
  "ran-with": ["Ran with", "Conversations"],
  loaded: ["Loaded, by its transcript", "Loaded by"],
  "set-up-for": ["Set up for", "Set up with"],
};

export type LinkGroup = { heading: string; nodes: GraphNode[] };

/** A neighbourhood's links under the headings the card shows them by, in the order the edges came. */
export function linkGroups(links: GraphNeighbourhood["links"]): LinkGroup[] {
  const groups = new Map<string, GraphNode[]>();
  for (const link of links) {
    const heading = LINK_HEADING[link.kind][link.outward ? 0 : 1];
    groups.set(heading, [...(groups.get(heading) ?? []), link.node]);
  }
  return [...groups].map(([heading, nodes]) => ({ heading, nodes }));
}

const SECTION_NAME: Record<GraphOpen["section"], string> = { library: "Library", skills: "Skills", mcp: "MCP servers", sessions: "Sessions" };
export const openLabel = (open: GraphOpen): string => `Open in ${SECTION_NAME[open.section]}`;

export function sizeLabel(node: Pick<GraphNode, "kind" | "size" | "unit">): string | null {
  if (node.unit === "bytes") return node.size < 1024 ? `${node.size} bytes` : node.size < 1024 * 1024 ? `${Math.round(node.size / 1024)} KB` : `${(node.size / 1024 / 1024).toFixed(1)} MB`;
  if (node.kind === "agent" || node.kind === "project") return `${node.size} ${node.size === 1 ? "connection" : "connections"}`;
  return null;
}

export type Shown = Record<DrawnKind, boolean>;
export const EVERY_KIND: Shown = { agent: true, project: true, file: true, skill: true, mcp: true, session: true };

/** The nodes of the kinds switched on, and the edges with both ends among them. */
export function drawn(graph: Pick<Graph, "nodes" | "edges">, shown: Shown): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes = graph.nodes.filter((node) => shown[drawnKind(node.kind)]);
  const kept = new Set(nodes.map((node) => node.id));
  return { nodes, edges: graph.edges.filter((edge) => kept.has(edge.source) && kept.has(edge.target)) };
}

export function kindCounts(nodes: readonly GraphNode[]): Record<DrawnKind, number> {
  const counts: Record<DrawnKind, number> = { agent: 0, project: 0, file: 0, skill: 0, mcp: 0, session: 0 };
  // A gathered month counts as the conversations it stands for.
  for (const node of nodes) counts[drawnKind(node.kind)] += node.kind === "sessions" ? node.size : 1;
  return counts;
}

/** A node and everything one edge away from it: what lights when it is hovered. */
export function neighboursOf(edges: readonly GraphEdge[], id: string): Set<string> {
  const lit = new Set([id]);
  for (const edge of edges) {
    if (edge.source === id) lit.add(edge.target);
    if (edge.target === id) lit.add(edge.source);
  }
  return lit;
}

/** The nodes a typed word finds, hubs first, then by name. */
export function found(nodes: readonly GraphNode[], typed: string, limit = 8): GraphNode[] {
  const words = typed.trim().toLowerCase();
  if (words === "") return [];
  const rank = (node: GraphNode): number => (node.kind === "agent" ? 0 : node.kind === "project" ? 1 : 2);
  return nodes.filter((node) => node.label.toLowerCase().includes(words))
    .sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label)).slice(0, limit);
}
