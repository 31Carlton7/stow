import { z } from "zod";

/*
 * The graph: everything the app knows of, as nodes, and the facts that join them, as edges. Nothing
 * here is measured or guessed for the drawing: each edge is something another section already shows
 * (where a file is kept, what it links to, who loads it, where a session ran).
 */

/** `sessions` is the older conversations of one project in one month, gathered so the graph stays readable. */
export const GraphNodeKindSchema = z.enum(["agent", "project", "file", "skill", "mcp", "session", "sessions"]);
export type GraphNodeKind = z.infer<typeof GraphNodeKindSchema>;

/**
 * What joins two nodes, read from `source` to `target`:
 * `belongs`: a file is kept in an agent's folder, or is one project's.
 * `loads`: an agent puts a file in front of the model when a session starts.
 * `links`: a file names another in its index or with a `[[link]]`.
 * `copy`: two files hold exactly the same text.
 * `ran-in`, `ran-with`: a session ran in a project, with an agent.
 * `loaded`: a session's transcript recorded that it loaded a file. Only in a node's neighbourhood.
 * `set-up-for`: a skill or an MCP server is set up for an agent, or for one project.
 */
export const GraphEdgeKindSchema = z.enum(["belongs", "loads", "links", "copy", "ran-in", "ran-with", "loaded", "set-up-for"]);
export type GraphEdgeKind = z.infer<typeof GraphEdgeKindSchema>;

/** Where a node is opened: one thing in its own section, or a section narrowed to an agent or a project. */
export const GraphOpenSchema = z.object({
  section: z.enum(["library", "skills", "mcp", "sessions"]),
  what: z.enum(["file", "skill", "server", "session", "agent", "project"]),
  id: z.string(),
});
export type GraphOpen = z.infer<typeof GraphOpenSchema>;

export const GraphNodeSchema = z.object({
  id: z.string(),
  kind: GraphNodeKindSchema,
  label: z.string(),
  /** The agent it is, or is of, by the name its mark is drawn from ("claude", "codex"); null where it is no one agent's. */
  agent: z.string().nullable(),
  /** How big it is drawn: a file's or a transcript's bytes, else how many things it stands for or joins. */
  size: z.number(),
  unit: z.enum(["bytes", "count"]),
  /** One line of what it is: who loads a file, a skill's description, when a session ran. */
  detail: z.string().nullable(),
  open: GraphOpenSchema.nullable(),
});
export type GraphNode = z.infer<typeof GraphNodeSchema>;

export const GraphEdgeSchema = z.object({ source: z.string(), target: z.string(), kind: GraphEdgeKindSchema });
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;

export const GraphSchema = z.object({
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
  /** Every agent and project of the whole graph, whatever was asked for: what the graph can be narrowed to. */
  scopes: z.array(z.object({ id: z.string(), kind: z.enum(["agent", "project"]), label: z.string(), agent: z.string().nullable() })),
});
export type Graph = z.infer<typeof GraphSchema>;

export const GraphNeighbourhoodSchema = z.object({
  node: GraphNodeSchema,
  /** Each edge at the node with the node at its other end. `outward` when the edge runs from this node. */
  links: z.array(z.object({ kind: GraphEdgeKindSchema, outward: z.boolean(), node: GraphNodeSchema })),
  /** For a session whose transcript records what it loaded: how many of those files the library no longer holds. Null for anything else. */
  loadedElsewhere: z.number().int().nullable(),
});
export type GraphNeighbourhood = z.infer<typeof GraphNeighbourhoodSchema>;

const NodeId = z.string().min(1).max(2100);

export const GraphMethods = {
  /** The whole graph, or with `around` an agent or a project: that node, what joins it, and the agents and projects those belong to. */
  "graph.get": { params: z.object({ around: NodeId.nullable().default(null) }), result: GraphSchema },
  "graph.neighbourhood": { params: z.object({ id: NodeId }), result: GraphNeighbourhoodSchema },
} as const;
