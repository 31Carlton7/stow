import { useRef } from "react";
import { Icon } from "@amc/ui";
import { useDissolve } from "../components/ScrollFades";
import { isReady, kindsOf, sameFilter, type ReviewFilter } from "./review-model";
import type { Review } from "./use-review";

/** `health` says whether the Health page is what the columns show, and shows or leaves it. */
export function ReviewSidebar({ review, health }: { review: Review; health: { shown: boolean; show: (shown: boolean) => void } }) {
  const { findings, filter, history } = review;
  const scroller = useRef<HTMLElement>(null);
  useDissolve(scroller);

  const row = (key: string, to: ReviewFilter, label: string, count: number, nested = false) => {
    const chosen = !health.shown && sameFilter(filter, to);
    return (
      <li key={key}>
        <button type="button" className="lib-nav-row" data-nested={nested || undefined} data-selected={chosen || undefined}
          aria-current={chosen || undefined} onClick={() => { health.show(false); review.setFilter(to); }}>
          <span className="lib-nav-name">{label}</span>
          <span className="lib-nav-count">{count}</span>
        </button>
      </li>
    );
  };

  return (
    <nav className="sb-list lib-nav" aria-label="Review" ref={scroller}>
      <ul className="lib-nav-list">
        <li>
          <button type="button" className="lib-nav-row" data-selected={health.shown || undefined} aria-current={health.shown || undefined} onClick={() => health.show(true)}>
            <Icon name="activity" size={16} className="lib-nav-mark" />
            <span className="lib-nav-name">Health</span>
          </button>
        </li>
      </ul>
      {findings !== null && (
        <>
          <ul className="lib-nav-list">
            {row("all", { kind: "all" }, "All findings", findings.length)}
            {row("ready", { kind: "ready" }, "Fix ready", findings.filter(isReady).length)}
          </ul>
          {findings.length > 0 && (
            <>
              <h2 className="sb-section">Kinds</h2>
              <ul className="lib-nav-list" aria-label="Kinds">
                {kindsOf(findings).map((k) => row(k.type, { kind: "type", type: k.type }, k.label, k.count))}
              </ul>
            </>
          )}
          <ul className="lib-nav-list">
            <li>
              <button type="button" className="lib-nav-row" data-selected={(!health.shown && filter.kind === "history") || undefined}
                aria-current={(!health.shown && filter.kind === "history") || undefined} onClick={() => { health.show(false); review.setFilter({ kind: "history" }); }}>
                <Icon name="clock" size={16} className="lib-nav-mark" />
                <span className="lib-nav-name">Applied fixes</span>
                <span className="lib-nav-count">{history.length}</span>
              </button>
            </li>
          </ul>
        </>
      )}
    </nav>
  );
}
