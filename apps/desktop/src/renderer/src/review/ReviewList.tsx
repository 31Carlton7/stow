import { useRef, useState, type ReactNode } from "react";
import { FINDING_TYPE_LABEL, type RunnerId } from "@amc/contracts";
import { Icon } from "@amc/ui";
import { EmptyState } from "../components/EmptyState";
import { RunnerPicker } from "../components/RunnerPicker";
import { SourceMark } from "../components/SourceMark";
import { useDissolve } from "../components/ScrollFades";
import { ago, stampTitle, useNow } from "../library/when";
import { SEVERITY_LABEL, bySeverity, offerOf, oneAgentOf, passTokens, tokensSaid, usdSaid } from "./review-model";
import type { Review } from "./use-review";

/** The card each state of a reading is drawn on: what is being said, and what can be pressed. */
function ReadingCard({ title, done, acts, children, role }: { title: string; done?: number; acts: ReactNode; children: ReactNode; role?: "status" }) {
  return (
    <div className="rev-reading" role={role}>
      <div className="rev-reading-text">
        <p className="rev-reading-title">{title}</p>
        {children}
      </div>
      {done !== undefined && <div className="rev-reading-bar" aria-hidden="true"><span style={{ width: `${Math.round(done * 100)}%` }} /></div>}
      <div className="rev-reading-acts">{acts}</div>
    </div>
  );
}

/**
 * The model's reading: what it would send, the button that starts it, and its progress. It only
 * offers to start when the person has turned a runner on, and says where to do that when they have not.
 */
function Reading({ review, onOpenModels }: { review: Review; onOpenModels: () => void }) {
  const { pass, scope, runners } = review;
  const [chosen, setChosen] = useState<RunnerId | null>(null);
  const runner = runners.find((r) => r.runner === chosen) ?? runners[0];
  if (pass === null || scope === null) return null;

  if (pass.running) {
    return (
      <ReadingCard role="status" title={`Reading with ${pass.model}`} done={pass.calls === 0 ? 0 : pass.callsDone / pass.calls}
        acts={<button type="button" className="btn" onClick={() => void review.stopPass()}>Stop</button>}>
        <p className="rev-reading-line">Call {Math.min(pass.callsDone + 1, pass.calls)} of {pass.calls}, {pass.found} found so far.</p>
      </ReadingCard>
    );
  }
  if (!runner) {
    return (
      <ReadingCard title="Have a model read the library" acts={<button type="button" className="btn primary" onClick={onOpenModels}>Open Models</button>}>
        <p className="rev-reading-line">A model can find memories that are out of date or that disagree. Nothing is sent until you turn a model on.</p>
      </ReadingCard>
    );
  }
  const read = pass.finishedAt !== null;
  return (
    <ReadingCard title={read ? "Last reading" : "Have a model read the library"}
      acts={<>
        {runners.length > 1 && <RunnerPicker runners={runners} chosen={runner.runner} onChoose={setChosen} name="reading-runner" />}
        <button type="button" className="btn primary" disabled={scope.files === 0} onClick={() => void review.startPass(runner.runner)}>
          {read ? "Read again" : "Read now"}
        </button>
      </>}>
      {read ? (
        <>
          <p className="rev-reading-line">
            {pass.found} found{pass.dropped > 0 ? `, ${pass.dropped} dropped for not checking out` : ""}, {usdSaid(pass.spentUsd)} at API prices.
          </p>
          {pass.error && <p className="rev-reading-line" data-tone="warning">It stopped early: {pass.error}</p>}
        </>
      ) : (
        <p className="rev-reading-line">
          A reading sends {scope.files} files in {scope.calls} {scope.calls === 1 ? "call" : "calls"}, about {tokensSaid(passTokens(scope))} tokens, to {runner.settings.models.scan}.
        </p>
      )}
    </ReadingCard>
  );
}

function Applied({ review }: { review: Review }) {
  const now = useNow();
  if (review.history.length === 0) return <EmptyState icon="clock" title="No fixes applied yet">A fix you approve is listed here, with Undo.</EmptyState>;
  return (
    <ul className="lib-rows rev-rows" aria-label="Applied fixes">
      {review.history.map((fix) => (
        <li key={fix.id} className="rev-applied">
          <div className="rev-applied-text">
            <span className="rev-row-kind">{FINDING_TYPE_LABEL[fix.type]}</span>
            <span className="rev-row-title">{fix.title}</span>
            <time className="rev-row-offer" title={stampTitle(fix.at)}>{fix.undoneAt === null ? `Applied ${ago(fix.at, now)}` : `Undone ${ago(fix.undoneAt, now)}`}</time>
          </div>
          {fix.undoneAt === null && <button type="button" className="btn" disabled={review.work !== null} onClick={() => void review.undo(fix.id)}>Undo</button>}
        </li>
      ))}
    </ul>
  );
}

export function ReviewList({ review, onOpenModels }: { review: Review; onOpenModels: () => void }) {
  const { shown, finding, filter, scanning, scanError, rejected } = review;
  const scroller = useRef<HTMLUListElement>(null);
  useDissolve(scroller);

  return (
    <section className="col col-list" aria-label="Findings">
      <header className="col-head lib-list-head">
        <h1 className="lib-list-title">{filter.kind === "history" ? "Applied fixes" : "Review"}</h1>
        <button type="button" className="icon-btn" aria-label="Scan again" title="Scan again" aria-busy={scanning || undefined} disabled={scanning} onClick={() => void review.scan()}>
          <Icon name="reload" size={14} />
        </button>
      </header>
      {filter.kind === "history" ? <Applied review={review} /> : (
        <>
          <Reading review={review} onOpenModels={onOpenModels} />
          {shown === null ? (
            scanError !== null
              ? <EmptyState icon="alert" title="The scan could not be run" role="status">{scanError}</EmptyState>
              : <EmptyState className="is-late" role="status" title="Scanning the library" />
          ) : shown.length === 0 ? (
            <EmptyState icon="checkCircle" title="Nothing to review">
              {rejected > 0 ? `A scan found nothing new. ${rejected} you turned down ${rejected === 1 ? "is" : "are"} not raised again.` : "A scan found nothing wrong."}
            </EmptyState>
          ) : (
            <ul className="lib-rows rev-rows" aria-label="Findings" ref={scroller}>
              {bySeverity(shown).map((group) => (
                <li key={group.severity} className="rev-group">
                  <h2 className="rev-group-name">{SEVERITY_LABEL[group.severity]}</h2>
                  <ul className="rev-group-rows">
                    {group.findings.map((f) => (
                      <li key={f.fingerprint}>
                        <button type="button" className="lib-row rev-row" data-selected={finding?.fingerprint === f.fingerprint || undefined}
                          aria-current={finding?.fingerprint === f.fingerprint || undefined} onClick={() => review.pick(f.fingerprint)}>
                          <span className="rev-row-kind">{FINDING_TYPE_LABEL[f.type]}{f.judgedBy !== null && <span className="rev-row-model"> · a model's reading</span>}</span>
                          <span className="rev-row-title"><SourceMark of={oneAgentOf(f)} size={13} />{f.title}</span>
                          <span className="rev-row-offer" data-ready={f.fix !== null && !f.needsDraft || undefined}>{offerOf(f)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
