import { useRef, type ReactNode } from "react";
import { Icon } from "@amc/ui";
import { EmptyState } from "../components/EmptyState";
import { SourceMark } from "../components/SourceMark";
import { useDissolve } from "../components/ScrollFades";
import { useFavorites } from "../favorites/use-favorites";
import { SESSION_AGENT_LABEL, counted, sameScope, sidebarCounts, type SessionScope, type Shown } from "./sessions-model";
import type { Sessions } from "./use-sessions";

/**
 * The sidebar: the conversations a person had, then the same by agent and by project. The two
 * switches under them bring in what is left out at first, because on a real Mac most transcripts are
 * a program asking once, and they bury the conversations.
 */
export function SessionsSidebar({ sessions }: { sessions: Sessions }) {
  const { facets, scope, shown } = sessions;
  const starred = useFavorites().all.filter((f) => f.kind === "session").length;
  const scroller = useRef<HTMLElement>(null);
  useDissolve(scroller);

  const row = (key: string, to: SessionScope, label: string, sessionCount: number, mark: ReactNode) => {
    const chosen = sameScope(scope, to);
    return (
      <li key={key}>
        <button type="button" className="lib-nav-row" data-selected={chosen || undefined} aria-current={chosen || undefined} onClick={() => sessions.setScope(to)}>
          {mark}
          <span className="lib-nav-name">{label}</span>
          <span className="lib-nav-count">{counted(sessionCount)}</span>
        </button>
      </li>
    );
  };
  const show = (which: keyof Shown, label: string, sessionCount: number) => (
    <label className="ses-show">
      <span className="lib-nav-name">{label}</span>
      <span className="lib-nav-count">{counted(sessionCount)}</span>
      <input type="checkbox" role="switch" className="switch" aria-label={label} checked={shown[which]}
        onChange={(e) => sessions.setShown({ ...shown, [which]: e.target.checked })} />
    </label>
  );

  if (facets === null) {
    return (
      <nav className="sb-list lib-nav" aria-label="Sessions" ref={scroller}>
        {sessions.listError === null && <EmptyState className="is-late" role="status" title="Reading the sessions" />}
      </nav>
    );
  }
  const counts = sidebarCounts(facets);
  return (
    <nav className="sb-list lib-nav" aria-label="Sessions" ref={scroller}>
      <ul className="lib-nav-list">
        {row("all", {}, "All conversations", counts.conversations, <Icon name="session" size={16} className="lib-nav-mark" />)}
        {row("favorites", { favorites: true }, "Favorites", starred, <Icon name="star" size={16} className="lib-nav-mark" />)}
      </ul>
      {facets.agents.length > 0 && (
        <ul className="lib-nav-list" aria-label="Agents">
          {facets.agents.map((a) => row(a.agent, { agent: a.agent }, SESSION_AGENT_LABEL[a.agent], a.count, <SourceMark of={a.agent} size={16} className="lib-nav-mark" />))}
        </ul>
      )}
      {facets.projects.length > 0 && (
        <>
          <h2 className="sb-section">Projects</h2>
          <ul className="lib-nav-list" aria-label="Projects">
            {facets.projects.map((p) => row(p.id, { projectId: p.id }, p.name, p.count, <Icon name="folder" size={16} className="lib-nav-mark" />))}
          </ul>
        </>
      )}
      <h2 className="sb-section">Also list</h2>
      <div className="ses-shows">
        {show("oneShot", "One-shot calls", counts.oneShot)}
        {show("subAgents", "Sub-agents", counts.subAgents)}
      </div>
    </nav>
  );
}
