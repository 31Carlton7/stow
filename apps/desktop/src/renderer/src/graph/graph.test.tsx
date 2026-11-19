import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { Graph, GraphNeighbourhood, GraphNode, GraphOpen } from "@amc/contracts";
import type { GraphCanvasProps } from "./GraphCanvas";
import { GraphPanel } from "./GraphPanel";
import { GraphSidebar } from "./GraphSidebar";
import { useGraph, type GraphRpc } from "./use-graph";

// The canvas needs WebGL, which the test's page has none of: this stands in for it and says what it was handed.
let handed: GraphCanvasProps | null = null;
vi.mock("./GraphCanvas", () => ({
  default: (props: GraphCanvasProps) => {
    handed = props;
    return <div data-testid="canvas" data-flat={props.flat} data-nodes={props.nodes.map((node) => node.id).join(" ")} data-lit={props.lit ? [...props.lit].sort().join(" ") : ""} />;
  },
}));

const node = (id: string, kind: GraphNode["kind"], label: string, over: Partial<GraphNode> = {}): GraphNode => ({ id, kind, label, agent: null, size: 1, unit: "count", detail: null, open: null, ...over });
const CLAUDE = node("agent:claude", "agent", "Claude", { agent: "claude", size: 2, open: { section: "library", what: "agent", id: "claude" } });
const ATLAS = node("project:p-atlas", "project", "atlas", { size: 3 });
const DEPLOY = node("file:mem:deploy.md", "file", "deploy-steps", { agent: "claude", size: 2048, unit: "bytes", detail: "Claude · Project memory.", open: { section: "library", what: "file", id: "mem:deploy.md" } });
const SHIP = node("skill:ship", "skill", "ship", { open: { section: "skills", what: "skill", id: "ship" } });
const TALK = node("session:t1", "session", "Fix the deploy", { agent: "claude", open: { section: "sessions", what: "session", id: "t1" } });
const MARCH = node("sessions:p-atlas:2026-03", "sessions", "Mar 2026 · 14", { size: 14 });
const WHOLE: Graph = {
  nodes: [CLAUDE, ATLAS, DEPLOY, SHIP, TALK, MARCH],
  edges: [
    { source: DEPLOY.id, target: CLAUDE.id, kind: "belongs" }, { source: DEPLOY.id, target: ATLAS.id, kind: "belongs" },
    { source: SHIP.id, target: ATLAS.id, kind: "set-up-for" }, { source: TALK.id, target: ATLAS.id, kind: "ran-in" }, { source: TALK.id, target: CLAUDE.id, kind: "ran-with" },
    { source: MARCH.id, target: ATLAS.id, kind: "ran-in" },
  ],
  scopes: [{ id: CLAUDE.id, kind: "agent", label: "Claude", agent: "claude" }, { id: ATLAS.id, kind: "project", label: "atlas", agent: null }],
};
const AROUND_ATLAS: Graph = { ...WHOLE, nodes: [ATLAS, DEPLOY, SHIP], edges: WHOLE.edges.slice(1, 3) };

function fakeGraphServer(whole: Graph = WHOLE) {
  const asked: [string, unknown][] = [];
  const rpc = {
    call: async (method: string, params: { around?: string | null; id?: string }) => {
      asked.push([method, params]);
      if (method === "graph.get") return params.around ? AROUND_ATLAS : whole;
      if (method === "graph.neighbourhood") {
        const picked = whole.nodes.find((candidate) => candidate.id === params.id)!;
        return {
          node: picked, loadedElsewhere: picked.kind === "session" ? 1 : null,
          links: picked.id === TALK.id
            ? [{ kind: "ran-in", outward: true, node: ATLAS }, { kind: "ran-with", outward: true, node: CLAUDE }, { kind: "loaded", outward: true, node: DEPLOY }]
            : [{ kind: "belongs", outward: true, node: CLAUDE }, { kind: "belongs", outward: true, node: ATLAS }],
        } satisfies GraphNeighbourhood;
      }
      throw new Error(`no answer for ${method}`);
    },
  } as unknown as GraphRpc;
  return { rpc, asked };
}

function Section({ rpc, onOpen = () => {}, webgl = true }: { rpc: GraphRpc; onOpen?: (to: GraphOpen) => void; webgl?: boolean }) {
  const graph = useGraph(rpc);
  return (
    <>
      <button type="button" onClick={() => void graph.refresh()}>Show the graph</button>
      <GraphSidebar graph={graph} />
      <GraphPanel graph={graph} onOpen={onOpen} webgl={webgl} />
    </>
  );
}

async function shown(rpc: GraphRpc, more: Partial<Parameters<typeof Section>[0]> = {}) {
  render(<Section rpc={rpc} {...more} />);
  fireEvent.click(screen.getByRole("button", { name: "Show the graph" }));
  return screen.findByTestId("canvas");
}

describe("the Graph section", () => {
  it("asks for nothing until it is shown, then counts each kind in the legend", async () => {
    const { rpc, asked } = fakeGraphServer();
    render(<Section rpc={rpc} />);
    expect(asked).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Show the graph" }));
    await screen.findByTestId("canvas");
    const legend = screen.getByRole("group", { name: "Drawn" });
    // THE MUTANT: a gathered month counts as one conversation, and fourteen conversations read as one.
    expect(within(legend).getByText("Conversations").parentElement).toHaveTextContent("Conversations15");
    expect(within(legend).getByText("Skills").parentElement).toHaveTextContent("Skills1");
    expect(screen.getByText("Two files hold exactly the same text.")).toBeInTheDocument();
  });

  it("stops drawing a kind that is switched off, with the lines that ended at it", async () => {
    const { rpc } = fakeGraphServer();
    const canvas = await shown(rpc);
    fireEvent.click(screen.getByRole("switch", { name: "Conversations" }));
    expect(canvas.dataset.nodes).toBe([CLAUDE, ATLAS, DEPLOY, SHIP].map((kept) => kept.id).join(" "));
    expect(handed!.edges.map((edge) => edge.kind)).toEqual(["belongs", "belongs", "set-up-for"]);
    for (const name of ["Agents", "Projects", "Memory and instructions", "Skills"]) fireEvent.click(screen.getByRole("switch", { name }));
    expect(screen.getByText("Every kind is switched off")).toBeInTheDocument();
  });

  it("narrows to a project from the sidebar", async () => {
    const { rpc, asked } = fakeGraphServer();
    await shown(rpc);
    fireEvent.click(within(screen.getByRole("list", { name: "Projects" })).getByRole("button", { name: "atlas" }));
    await vi.waitFor(() => expect(screen.getByTestId("canvas").dataset.nodes).toBe([ATLAS, DEPLOY, SHIP].map((kept) => kept.id).join(" ")));
    expect(asked.at(-1)).toEqual(["graph.get", { around: ATLAS.id }]);
    expect(within(screen.getByRole("list", { name: "Projects" })).getByRole("button", { name: "atlas" })).toHaveAttribute("aria-current", "true");
  });

  it("lights a hovered node's neighbourhood", async () => {
    const { rpc } = fakeGraphServer();
    const canvas = await shown(rpc);
    expect(canvas.dataset.lit).toBe("");
    act(() => handed!.onHover(SHIP.id));
    expect(canvas.dataset.lit).toBe([ATLAS.id, SHIP.id].sort().join(" "));
    act(() => handed!.onHover(null));
    expect(canvas.dataset.lit).toBe("");
  });

  it("opens a card for the node picked, and opens it in its own section", async () => {
    const { rpc } = fakeGraphServer();
    const opened: GraphOpen[] = [];
    await shown(rpc, { onOpen: (to) => opened.push(to) });
    act(() => handed!.onPick(DEPLOY.id));
    const card = await screen.findByRole("complementary", { name: "Picked" });
    expect(within(card).getByRole("heading", { name: "deploy-steps" })).toBeInTheDocument();
    expect(card).toHaveTextContent("File · 2 KB");
    const joined = await within(card).findByRole("region", { name: "Belongs to" });
    expect(within(joined).getAllByRole("button").map((row) => row.textContent)).toEqual(["Claude", "atlas"]);
    fireEvent.click(within(card).getByRole("button", { name: "Open in Library" }));
    expect(opened).toEqual([{ section: "library", what: "file", id: "mem:deploy.md" }]);
    fireEvent.click(within(card).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("complementary", { name: "Picked" })).toBeNull();
  });

  it("lights the files a picked session loaded, and says how many the library no longer holds", async () => {
    const { rpc } = fakeGraphServer();
    const canvas = await shown(rpc);
    act(() => handed!.onPick(TALK.id));
    const card = await screen.findByRole("complementary", { name: "Picked" });
    await within(card).findByRole("region", { name: "Loaded, by its transcript" });
    expect(canvas.dataset.lit).toBe([ATLAS.id, CLAUDE.id, DEPLOY.id, TALK.id].sort().join(" "));
    expect(card).toHaveTextContent("It also loaded 1 file the library does not hold now.");
  });

  it("finds a node by name and flies to it", async () => {
    const { rpc } = fakeGraphServer();
    await shown(rpc);
    const field = screen.getByRole("searchbox", { name: "Find in the graph" });
    fireEvent.change(field, { target: { value: "zzz" } });
    expect(screen.getByText("Nothing by that name is drawn.")).toBeInTheDocument();
    fireEvent.change(field, { target: { value: "ship" } });
    fireEvent.click(within(screen.getByRole("list", { name: "Found" })).getByRole("button", { name: /ship/ }));
    expect(handed!.flight).toEqual({ id: SHIP.id, n: 1 });
    expect(handed!.pickedId).toBe(SHIP.id);
    expect(field).toHaveValue("");
  });

  it("says so when there is nothing to draw, and draws flat where there is no WebGL", async () => {
    const empty = fakeGraphServer({ nodes: [], edges: [], scopes: [] });
    const { unmount } = render(<Section rpc={empty.rpc} />);
    fireEvent.click(screen.getByRole("button", { name: "Show the graph" }));
    expect(await screen.findByText("Nothing to draw yet")).toBeInTheDocument();
    expect(screen.queryByTestId("canvas")).toBeNull();
    unmount();

    const canvas = await shown(fakeGraphServer().rpc, { webgl: false });
    expect(canvas.dataset.flat).toBe("true");
    expect(screen.getByRole("note")).toHaveTextContent("Drawn flat");
  });
});
