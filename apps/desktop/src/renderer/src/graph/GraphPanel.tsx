import { Suspense, lazy, useMemo } from "react";
import type { GraphNode, GraphOpen } from "@amc/contracts";
import { Icon } from "@amc/ui";
import { EmptyState } from "../components/EmptyState";
import { SourceMark } from "../components/SourceMark";
import { prefersReducedMotion } from "../reduced-motion";
import { KIND_NAME, linkGroups, openLabel, sizeLabel } from "./graph-model";
import type { GraphState } from "./use-graph";

// three.js is most of a megabyte: only a person who opens the graph loads it.
const GraphCanvas = lazy(() => import("./GraphCanvas"));

/** How many of one heading's nodes the card lists before it says how many more there are. */
const CARD_ROWS = 6;

function hasWebGL(): boolean {
  try { return document.createElement("canvas").getContext("webgl2") !== null; } catch { return false; }
}

const NodeMark = ({ node }: { node: Pick<GraphNode, "kind" | "agent"> }) =>
  node.kind === "agent" ? <SourceMark of={node.agent} size={14} fallback="agents" /> : <span className="graph-dot" data-kind={node.kind} />;

/**
 * The graph, filling the panel: the drawing, a search that flies to a node, and a card for the node
 * picked that says what it is, what it is joined to, and opens it in its own section.
 */
export function GraphPanel({ graph, onOpen, webgl }: { graph: GraphState; onOpen: (to: GraphOpen) => void; webgl?: boolean }) {
  const { visible, picked, pickedId, matches } = graph;
  const flat = useMemo(() => !(webgl ?? hasWebGL()), [webgl]);
  const reducedMotion = useMemo(prefersReducedMotion, []);

  if (graph.graph === null || visible === null) {
    return (
      <section className="col graph-panel" aria-label="Graph">
        {graph.error !== null
          ? <EmptyState icon="link" title="The graph could not be drawn">{graph.error}</EmptyState>
          : <EmptyState className="is-late" role="status" title="Drawing the graph" />}
      </section>
    );
  }
  if (graph.graph.nodes.length === 0) {
    return (
      <section className="col graph-panel" aria-label="Graph">
        <EmptyState icon="link" title="Nothing to draw yet">
          The graph joins agents to their memory, skills, MCP servers and conversations. None were found on this Mac.
        </EmptyState>
      </section>
    );
  }
  const pickedNode = picked?.node ?? visible.nodes.find((node) => node.id === pickedId) ?? null;
  return (
    <section className="col graph-panel" aria-label="Graph">
      {visible.nodes.length === 0
        ? <EmptyState icon="link" title="Every kind is switched off">Switch a kind on in the sidebar to draw it.</EmptyState>
        : (
          <Suspense fallback={<EmptyState className="is-late" role="status" title="Drawing the graph" />}>
            <GraphCanvas nodes={visible.nodes} edges={visible.edges} lit={graph.lit} pickedId={pickedId} flight={graph.flight}
              flat={flat} reducedMotion={reducedMotion} onHover={graph.hover} onPick={graph.pick} />
          </Suspense>
        )}

      <div className="graph-find">
        <label className="lib-search graph-search">
          <Icon name="filter" size={14} />
          <input className="search-field" type="search" aria-label="Find in the graph" placeholder="Find" spellCheck={false}
            value={graph.typed} onChange={(e) => graph.setTyped(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && matches[0]) graph.flyTo(matches[0].id); }} />
        </label>
        {graph.typed.trim() !== "" && (
          <ul className="graph-found" aria-label="Found">
            {matches.length === 0 && <li className="graph-found-none">Nothing by that name is drawn.</li>}
            {matches.map((node) => (
              <li key={node.id}>
                <button type="button" className="graph-found-row" onClick={() => graph.flyTo(node.id)}>
                  <NodeMark node={node} />
                  <span className="graph-found-name">{node.label}</span>
                  <span className="graph-found-kind">{KIND_NAME[node.kind]}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {flat && <p className="graph-note" role="note">Drawn flat: this Mac gave the window no 3D drawing.</p>}

      {pickedNode && (
        <aside className="graph-card" aria-label="Picked">
          <header className="graph-card-head">
            <p className="graph-card-kind"><NodeMark node={pickedNode} />{KIND_NAME[pickedNode.kind]}{sizeLabel(pickedNode) && ` · ${sizeLabel(pickedNode)}`}</p>
            <button type="button" className="icon-btn graph-card-close" aria-label="Close" onClick={() => graph.pick(null)}><Icon name="close" size={14} /></button>
          </header>
          <h2 className="graph-card-title" data-selectable>{pickedNode.label}</h2>
          {pickedNode.detail && <p className="graph-card-detail" data-selectable>{pickedNode.detail}</p>}
          <div className="graph-card-links">
            {graph.pickError !== null && <p className="graph-card-detail">{graph.pickError}</p>}
            {picked === null && graph.pickError === null && <p className="graph-card-detail" role="status">Reading what it connects to</p>}
            {picked !== null && picked.links.length === 0 && <p className="graph-card-detail">Nothing the app knows of is joined to it.</p>}
            {picked !== null && linkGroups(picked.links).map((group) => (
              <section key={group.heading} aria-label={group.heading}>
                <h3 className="graph-card-heading">{group.heading}<span className="lib-nav-count">{group.nodes.length}</span></h3>
                <ul>
                  {group.nodes.slice(0, CARD_ROWS).map((node) => (
                    <li key={node.id}>
                      <button type="button" className="graph-found-row" onClick={() => graph.flyTo(node.id)}>
                        <NodeMark node={node} />
                        <span className="graph-found-name">{node.label}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                {group.nodes.length > CARD_ROWS && <p className="graph-card-more">and {group.nodes.length - CARD_ROWS} more</p>}
              </section>
            ))}
            {picked !== null && picked.loadedElsewhere !== null && picked.loadedElsewhere > 0 && (
              <p className="graph-card-more">It also loaded {picked.loadedElsewhere} {picked.loadedElsewhere === 1 ? "file" : "files"} the library does not hold now.</p>
            )}
          </div>
          {pickedNode.open && (
            <button type="button" className="btn primary graph-card-open" onClick={() => onOpen(pickedNode.open!)}>{openLabel(pickedNode.open)}</button>
          )}
        </aside>
      )}
    </section>
  );
}
