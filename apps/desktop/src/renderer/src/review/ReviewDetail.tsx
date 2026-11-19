import { useRef, useState } from "react";
import { FINDING_TYPE_LABEL, type ProposedChange, type RunnerId } from "@amc/contracts";
import { Icon } from "@amc/ui";
import { EmptyState } from "../components/EmptyState";
import { RunnerPicker } from "../components/RunnerPicker";
import { SourceMark, agentOfPath } from "../components/SourceMark";
import { useDissolve } from "../components/ScrollFades";
import { FileDiffView, PathLabel } from "./DiffView";
import { fileDiff } from "./diff";
import { SEVERITY_LABEL } from "./review-model";
import type { Review } from "./use-review";

/** One file as approving would leave it: its diff, or where it goes when it goes. */
function Change({ change }: { change: ProposedChange }) {
  if (change.after !== null) return <FileDiffView file={fileDiff(change.displayPath, change.before, change.after)} />;
  return (
    <div className="fd-file">
      <div className="fd-head">
        <PathLabel className="fd-path" path={change.displayPath} />
        <span className="rev-removal">{change.removal === "commit" ? "Removed in a commit" : "Moved to the Trash"}</span>
      </div>
    </div>
  );
}

/**
 * The finding being read: what it is, the evidence, the files it is about, and what approving it
 * would change, shown before anything is changed. A fix a model has to write first is written only
 * when asked for, and is then read here like any other.
 */
export function ReviewDetail({ review, onOpenFile, onOpenModels }: { review: Review; onOpenFile: (id: string) => void; onOpenModels: () => void }) {
  const { finding, changes, work, runners } = review;
  const scroller = useRef<HTMLDivElement>(null);
  useDissolve(scroller);
  const [chosen, setChosen] = useState<RunnerId | null>(null);
  const writer = runners.find((r) => r.runner === chosen) ?? runners[0];

  if (!finding) {
    return (
      <section className="col col-reader" aria-label="Finding">
        <div className="col-head" />
        {review.filter.kind === "history" ? review.history.length > 0 && (
          <EmptyState icon="clock" title="Each fix can be undone">
            In a memory repository Undo is a commit of its own. Anywhere else the file comes back from its backup, as long as nothing has changed it since.
          </EmptyState>
        ) : review.shown !== null && review.shown.length > 0 && (
          <EmptyState icon="review" title="Pick a finding">Each says what it found and shows exactly what approving it would change.</EmptyState>
        )}
      </section>
    );
  }
  const ready = finding.fix !== null && !finding.needsDraft;
  return (
    <section className="col col-reader" aria-label="Finding">
      <header className="col-head lib-reader-bar">
        <button type="button" className="btn" disabled={work !== null} onClick={() => void review.reject()}>Not a problem</button>
        {finding.needsDraft && (writer ? (
          <>
            {runners.length > 1 && <RunnerPicker runners={runners} chosen={writer.runner} onChoose={setChosen} name="writing-runner" />}
            <button type="button" className="btn primary" disabled={work !== null} aria-busy={work === "draft" || undefined} onClick={() => void review.draft(writer.runner)}>
              {work === "draft" ? "Writing…" : `Write the fix with ${writer.settings.models.write}`}
            </button>
          </>
        ) : <button type="button" className="btn" onClick={onOpenModels}>Turn a model on to write the fix</button>)}
        {ready && (
          <button type="button" className="btn primary" disabled={work !== null || changes === null} aria-busy={work === "approve" || undefined} onClick={() => void review.approve()}>
            Approve
          </button>
        )}
      </header>
      <div className="lib-reader-scroll" ref={scroller}>
        <article className="lib-reader rev-detail">
          <p className="rev-kind">{FINDING_TYPE_LABEL[finding.type]} · {SEVERITY_LABEL[finding.severity]}</p>
          <h1 className="lib-reader-title">{finding.title}</h1>
          <p className="lib-reader-desc" data-selectable>{finding.detail}</p>
          {finding.judgedBy !== null && (
            <p className="lib-reader-note"><Icon name="sparkles" size={14} />
              <span>This is {finding.judgedBy}'s reading, not a rule. The quote was checked against the file; the judgement is yours.</span>
            </p>
          )}

          <h2 className="rev-heading">{finding.subjects.length === 1 ? "The file" : `The ${finding.subjects.length} files`}</h2>
          <ul className="rev-subjects">
            {finding.subjects.map((subject, at) => (
              <li key={`${subject.displayPath}:${at}`}>
                {subject.id !== null ? (
                  <button type="button" className="rev-subject" title="Open in the library" onClick={() => onOpenFile(subject.id!)}>
                    <span className="rev-subject-name"><SourceMark of={agentOfPath(subject.displayPath)} />{subject.label}</span>
                    <PathLabel className="rev-subject-path" path={subject.displayPath} />
                  </button>
                ) : (
                  <div className="rev-subject">
                    <span className="rev-subject-name"><SourceMark of={agentOfPath(subject.displayPath)} />{subject.label}</span>
                    <PathLabel className="rev-subject-path" path={subject.displayPath} />
                  </div>
                )}
              </li>
            ))}
          </ul>

          <h2 className="rev-heading">{finding.fix === null ? "What to do" : "What approving does"}</h2>
          {finding.fix === null
            ? <p className="lib-reader-none">Nothing can be done for you here. Open the files and decide which is right.</p>
            : <p className="rev-fix">{finding.fix}</p>}
          {ready && (changes === null
            ? <p className="lib-reader-none" role="status">Working out the change…</p>
            : <div className="fd-view">{changes.map((change) => <Change key={change.id} change={change} />)}</div>)}
        </article>
      </div>
    </section>
  );
}
