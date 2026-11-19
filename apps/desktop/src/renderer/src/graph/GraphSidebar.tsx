import { useRef, type ReactNode } from "react";
import { Icon } from "@amc/ui";
import { EmptyState } from "../components/EmptyState";
import { SourceMark } from "../components/SourceMark";
import { useDissolve } from "../components/ScrollFades";
import { DRAWN_KINDS, EDGE_MEANING, KIND_LABEL } from "./graph-model";
import type { GraphState } from "./use-graph";

/**
 * The sidebar under Graph: the legend as switches (which kinds are drawn, with how many of each),
 * what each line means, and what the graph is narrowed to.
 */
export function GraphSidebar({ graph }: { graph: GraphState }) {
  const scroller = useRef<HTMLElement>(null);
  useDissolve(scroller);
  const { counts, shown, around } = graph;

  if (graph.graph === null || counts === null) {
    return (
      <nav className="sb-list lib-nav" aria-label="Graph" ref={scroller}>
        {graph.error === null && <EmptyState className="is-late" role="status" title="Reading the graph" />}
      </nav>
    );
  }
  const scope = (id: string | null, label: string, mark: ReactNode) => (
    <li key={id ?? "all"}>
      <button type="button" className="lib-nav-row" data-selected={around === id || undefined} aria-current={around === id || undefined} onClick={() => graph.setAround(id)}>
        {mark}
        <span className="lib-nav-name">{label}</span>
      </button>
    </li>
  );
  const edgeCount = (kind: string): number => graph.graph!.edges.filter((edge) => edge.kind === kind).length;
  const agents = graph.graph.scopes.filter((s) => s.kind === "agent");
  const projects = graph.graph.scopes.filter((s) => s.kind === "project");
  return (
    <nav className="sb-list lib-nav" aria-label="Graph" ref={scroller}>
      <h2 className="sb-section">Drawn</h2>
      <div className="ses-shows" role="group" aria-label="Drawn">
        {DRAWN_KINDS.map((kind) => (
          <label className="ses-show" key={kind}>
            <span className="graph-dot" data-kind={kind} />
            <span className="lib-nav-name">{KIND_LABEL[kind]}</span>
            <span className="lib-nav-count">{counts[kind].toLocaleString("en")}</span>
            <input type="checkbox" role="switch" className="switch" aria-label={KIND_LABEL[kind]} checked={shown[kind]}
              onChange={(e) => graph.setShown({ ...shown, [kind]: e.target.checked })} />
          </label>
        ))}
      </div>

      <h2 className="sb-section">Lines</h2>
      <dl className="graph-lines" aria-label="Lines">
        {EDGE_MEANING.map((edge) => (
          <div key={edge.kind}>
            <dt>{edge.label}<span className="lib-nav-count">{edgeCount(edge.kind).toLocaleString("en")}</span></dt>
            <dd>{edge.means}</dd>
          </div>
        ))}
      </dl>

      <h2 className="sb-section">Show</h2>
      <ul className="lib-nav-list" aria-label="Scope">
        {scope(null, "Everything", <Icon name="link" size={16} className="lib-nav-mark" />)}
        {agents.map((agent) => scope(agent.id, agent.label, <SourceMark of={agent.agent} size={16} className="lib-nav-mark" fallback="agents" />))}
      </ul>
      {projects.length > 0 && (
        <>
          <h2 className="sb-section">Projects</h2>
          <ul className="lib-nav-list" aria-label="Projects">
            {projects.map((project) => scope(project.id, project.label, <Icon name="folder" size={16} className="lib-nav-mark" />))}
          </ul>
        </>
      )}
    </nav>
  );
}
