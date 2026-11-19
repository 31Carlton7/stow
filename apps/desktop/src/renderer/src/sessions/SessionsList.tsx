import { useRef } from "react";
import type { Session, SessionOrigin } from "@amc/contracts";
import { Icon } from "@amc/ui";
import { EmptyState } from "../components/EmptyState";
import { dragOut } from "../components/hand-out";
import { FavoriteButton } from "../components/FavoriteButton";
import { SourceMark } from "../components/SourceMark";
import { useDissolve } from "../components/ScrollFades";
import { age, stampTitle, useNow } from "../library/when";
import { plural } from "../setup/setup-model";
import { LIST_PAGE, SESSION_AGENT_LABEL, counted, statusLine, turnsLine, whoseLine } from "./sessions-model";
import type { Sessions } from "./use-sessions";

/** What a row is marked as when it is not a conversation a person had. */
const ORIGIN_CHIP: Partial<Record<SessionOrigin, string>> = { "one-shot": "One-shot", "sub-agent": "Sub-agent" };

function SessionRow({ session, chosen, now, onPick }: { session: Session; chosen: boolean; now: number; onPick: () => void }) {
  const chip = ORIGIN_CHIP[session.origin];
  return (
    <li className="lib-row" role="option" aria-selected={chosen} data-selected={chosen || undefined} onClick={onPick} {...dragOut({ path: session.path })}>
      <span className="lib-row-head">
        <SourceMark of={session.agent} size={13} />
        <span className="lib-row-title">{session.title}</span>
        {session.children > 0 && (
          <span className="lib-row-copies" title={`It started ${plural(session.children, "sub-agent")}`}><Icon name="agents" size={12} />{session.children}</span>
        )}
        <FavoriteButton kind="session" of={session.id} placed="row" />
      </span>
      <span className="lib-row-line">{whoseLine(session)}</span>
      <span className="lib-row-foot">
        {chip && <span className="lib-chip">{chip}</span>}
        {session.metrics && <span className="lib-row-place">{turnsLine(session.metrics)}</span>}
        <time dateTime={new Date(session.endedAt).toISOString()} title={stampTitle(session.endedAt)}>{age(session.endedAt, now)}</time>
      </span>
    </li>
  );
}

/** What the column says when it has no row to show. */
function NoRows({ sessions }: { sessions: Sessions }) {
  const { facets, status, shown } = sessions;
  if (sessions.parent !== null) return <EmptyState icon="agents" title="No sub-agents">The index holds none that this session started.</EmptyState>;
  // The index of a first run holds nothing for a few seconds, and that is not the same as nothing to hold.
  if (!sessions.statusAsked) return <EmptyState className="is-late" role="status" title="Reading the sessions" />;
  if (status?.state === "listing" || (status !== null && status.state !== "idle" && facets?.total === 0)) {
    return <EmptyState icon="session" title="Building the index" role="status">Every agent's transcripts are being listed where they lie. They show here once that is done.</EmptyState>;
  }
  if (sessions.scope.favorites && sessions.query === "") return <EmptyState icon="star" title="No favorites">Star a session to keep it here.</EmptyState>;
  if (sessions.query !== "") return <EmptyState icon="search" title="Nothing matches">The search reads each session's title, project and folder.</EmptyState>;
  if ((facets?.total ?? 0) === 0) return <EmptyState icon="session" title="No sessions">No agent on this Mac has kept a transcript.</EmptyState>;
  if (shown.oneShot && shown.subAgents) return <EmptyState icon="session" title="No sessions here" />;
  return <EmptyState icon="session" title="No conversations here">One-shot calls and sub-agents are left out. The switches in the sidebar list them.</EmptyState>;
}

export function SessionsList({ sessions }: { sessions: Sessions }) {
  const { facets, scope, parent, status } = sessions;
  const rows = sessions.sessions;
  const scroller = useRef<HTMLUListElement>(null);
  useDissolve(scroller);
  const now = useNow();
  const title = parent !== null ? `Sub-agents of ${parent.title}`
    : scope.favorites ? "Favorites"
    : scope.agent !== undefined ? SESSION_AGENT_LABEL[scope.agent]
    : scope.projectId !== undefined ? facets?.projects.find((p) => p.id === scope.projectId)?.name ?? "Project"
    : "All conversations";
  const working = status === null ? null : statusLine(status);

  return (
    <section className="col col-list" aria-label="Sessions">
      <header className="col-head lib-list-head">
        {parent !== null && (
          <button type="button" className="icon-btn" aria-label="Back to the sessions" title="Back to the sessions" onClick={sessions.leaveSubAgents}>
            <Icon name="chevronLeft" size={14} />
          </button>
        )}
        <h1 className="lib-list-title" title={title}>
          {parent === null && scope.agent !== undefined && <SourceMark of={scope.agent} size={16} />}
          <span className="lib-list-name">{title}</span>
        </h1>
        <button type="button" className="icon-btn" aria-label="Read again" title="Read again" onClick={() => void sessions.refresh()}>
          <Icon name="reload" size={14} />
        </button>
      </header>
      {parent === null && (
        <label className="lib-search">
          <Icon name="search" size={14} />
          <input className="search-field" type="search" aria-label="Search the sessions" placeholder="Search" spellCheck={false} value={sessions.typed} onChange={(e) => sessions.setTyped(e.target.value)} />
        </label>
      )}
      {sessions.listError !== null ? <EmptyState icon="alert" title="The sessions could not be read" role="status">{sessions.listError}</EmptyState>
        : rows === null ? <EmptyState className="is-late" role="status" title="Reading the sessions" />
        : rows.length === 0 ? <NoRows sessions={sessions} />
        : (
          <ul className="lib-rows" role="listbox" aria-label="Sessions" tabIndex={0} ref={scroller}>
            {rows.map((session) => (
              <SessionRow key={session.id} session={session} chosen={sessions.session?.id === session.id} now={now} onPick={() => sessions.open(session)} />
            ))}
            {rows.length < sessions.matched && (
              <li className="ses-next" role="presentation">
                <button type="button" className="btn" disabled={sessions.loadingMore} aria-busy={sessions.loadingMore || undefined} onClick={() => void sessions.loadMore()}>
                  Show the next {Math.min(LIST_PAGE, sessions.matched - rows.length)}
                </button>
                <span>{counted(rows.length)} of {counted(sessions.matched)}</span>
              </li>
            )}
          </ul>
        )}
      {working !== null && <p className="ses-status" role="status">{working}</p>}
    </section>
  );
}
