import type { Graph, GraphNeighbourhood, GraphNode } from "@amc/contracts";
import type { Library } from "../library/library";
import { RpcError } from "../rpc/error";
import { contextOf } from "../sessions/context";
import type { SessionIndex } from "../sessions/index";
import type { McpServers } from "../setup/mcp";
import type { Skills } from "../setup/skills";
import { buildGraph, fileNodeId, graphAround, sessionNodeId } from "./build";

/** How long one drawing of the graph answers for. A pick asks for a neighbourhood of the graph the window drew. */
const WHOLE_MS = 20_000;

export type GraphDeps = {
  home: string;
  library: Pick<Library, "inspect" | "projects" | "read">;
  skills: Pick<Skills, "list">;
  mcp: Pick<McpServers, "list">;
  sessions: Pick<SessionIndex, "list" | "file">;
};

type Whole = Pick<Graph, "nodes" | "edges"> & { at: number; byId: Map<string, GraphNode> };

/**
 * How everything the app knows of connects. It reads no disk of its own: the files are the
 * library's, the skills and servers the setup readers', the sessions the index's. What a session
 * loaded is the one thing read late, for the one session picked, because it means reading its transcript.
 */
export class ConnectionGraph {
  private whole: Whole | null = null;

  constructor(private d: GraphDeps) {}

  private current(): Whole {
    if (this.whole && Date.now() - this.whole.at < WHOLE_MS) return this.whole;
    const { library } = this.d;
    const files = library.inspect().map((held) => {
      let links: string[] = [];
      // A file that went since the library last looked has no links to read.
      try { links = library.read(held.entry.id).links.flatMap((link) => (link.id === null ? [] : [link.id])); } catch { /* drawn without them */ }
      return { entry: held.entry, hash: held.hash, real: held.real, by: held.source.by, links };
    });
    const drawn = buildGraph({
      home: this.d.home, projects: library.projects(), files, skills: this.d.skills.list(), servers: this.d.mcp.list(),
      sessions: this.d.sessions.list({}, 100_000, 0).sessions,
    });
    this.whole = { ...drawn, at: Date.now(), byId: new Map(drawn.nodes.map((node) => [node.id, node])) };
    return this.whole;
  }

  get(around: string | null): Graph {
    const whole = this.current();
    if (around !== null && !whole.byId.has(around)) throw new RpcError("GRAPH_NODE_NOT_FOUND", "there is no such agent or project in the graph");
    const { nodes, edges } = around === null ? whole : graphAround(whole, around);
    return {
      nodes, edges,
      scopes: whole.nodes.flatMap((node) => (node.kind === "agent" || node.kind === "project" ? [{ id: node.id, kind: node.kind, label: node.label, agent: node.agent }] : []))
        .sort((a, b) => a.label.localeCompare(b.label)),
    };
  }

  neighbourhood(id: string): GraphNeighbourhood {
    const whole = this.current();
    const node = whole.byId.get(id);
    if (!node) throw new RpcError("GRAPH_NODE_NOT_FOUND", "that is no longer in the graph");
    const links: GraphNeighbourhood["links"] = [];
    for (const edge of whole.edges) {
      if (edge.source === id) links.push({ kind: edge.kind, outward: true, node: whole.byId.get(edge.target)! });
      else if (edge.target === id) links.push({ kind: edge.kind, outward: false, node: whole.byId.get(edge.source)! });
    }
    let loadedElsewhere: number | null = null;
    // Only Claude Code's transcripts record what was loaded; for Codex it could only be worked out from the folder.
    if (node.kind === "session" && node.agent === "claude") {
      loadedElsewhere = 0;
      const sessionId = id.slice(sessionNodeId("").length);
      const seen = new Set<string>();
      for (const loaded of contextOf(this.d.sessions.file(sessionId), this.d).files) {
        if (loaded.role !== "Instructions" && loaded.role !== "Memory") continue;
        const file = loaded.libraryId === null ? undefined : whole.byId.get(fileNodeId(loaded.libraryId));
        if (!file) loadedElsewhere += 1;
        else if (!seen.has(file.id)) { seen.add(file.id); links.push({ kind: "loaded", outward: true, node: file }); }
      }
    }
    return { node, links, loadedElsewhere };
  }
}
