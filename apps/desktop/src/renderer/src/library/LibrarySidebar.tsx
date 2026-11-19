import { useRef, type ReactNode } from "react";
import { Icon } from "@amc/ui";
import { EmptyState } from "../components/EmptyState";
import { useDissolve } from "../components/ScrollFades";
import { SourceMark } from "../components/SourceMark";
import { agentRows, sameScope, type Scope } from "./library-model";
import type { Library, SidebarView } from "./use-library";

const VIEWS: readonly { id: SidebarView; label: string }[] = [{ id: "agent", label: "By agent" }, { id: "project", label: "By project" }];

/**
 * The sidebar: every memory, then the same files by whose they are or by the project they belong
 * to, then by tag. A row narrows the list beside it.
 */
export function LibrarySidebar({ library }: { library: Library }) {
  const { index, scope, view } = library;
  const scroller = useRef<HTMLElement>(null);
  useDissolve(scroller);

  const row = (key: string, to: Scope, label: string, count: number, mark: ReactNode, o: { nested?: boolean; title?: string } = {}) => {
    const chosen = sameScope(scope, to);
    return (
      <li key={key}>
        <button type="button" className="lib-nav-row" data-nested={o.nested || undefined} data-selected={chosen || undefined}
          aria-current={chosen || undefined} title={o.title} onClick={() => library.setScope(to)}>
          {mark}
          <span className="lib-nav-name">{label}</span>
          <span className="lib-nav-count">{count}</span>
        </button>
      </li>
    );
  };

  return (
    <>
      <div className="lib-view">
        <div className="seg" role="radiogroup" aria-label="Group files">
          {VIEWS.map((v) => (
            <label key={v.id} className="seg-opt" data-selected={view === v.id || undefined}>
              <input type="radio" name="library-view" checked={view === v.id} onChange={() => library.setView(v.id)} />
              {v.label}
            </label>
          ))}
        </div>
      </div>
      <nav className="sb-list lib-nav" aria-label="Library" ref={scroller}>
        {index === null ? (
          library.listError === null && <EmptyState className="is-late" role="status" title="Reading the library" />
        ) : (
          <>
            <ul className="lib-nav-list">
              {row("all", {}, "All memories", index.total, <Icon name="context" size={16} className="lib-nav-mark" />)}
              {row("favorites", { favorites: true }, "Favorites", index.starred, <Icon name="star" size={16} className="lib-nav-mark" />)}
            </ul>
            {view === "agent" ? agentRows(index.sources).map((agent) => (
              <ul key={agent.group} className="lib-nav-list" aria-label={agent.label}>
                {row(agent.group, { group: agent.group }, agent.label, agent.count, <SourceMark of={agent.group} size={16} className="lib-nav-mark" fallback="terminal" />)}
                {agent.kinds.map((k) => row(`${agent.group}/${k.kind}`, { group: agent.group, kind: k.kind }, k.label, k.count, null, { nested: true }))}
              </ul>
            )) : (
              <ul className="lib-nav-list" aria-label="Projects">
                {index.projects.map((p) => row(p.id, { projectId: p.id }, p.name, p.count, <Icon name="folder" size={16} className="lib-nav-mark" />, { title: p.root }))}
                {index.projects.length === 0 && <li className="lib-nav-none">No file here belongs to a project.</li>}
              </ul>
            )}
            {index.tags.length > 0 && (
              <>
                <h2 className="sb-section">Tags</h2>
                <ul className="lib-nav-list" aria-label="Tags">
                  {index.tags.map((t) => row(`tag:${t.tag}`, { tag: t.tag }, t.tag, t.count, <Icon name="bookmark" size={16} className="lib-nav-mark" />))}
                </ul>
              </>
            )}
          </>
        )}
      </nav>
    </>
  );
}
