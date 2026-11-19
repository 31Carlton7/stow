import { memo, useRef, useState, type ReactNode, type UIEvent } from "react";
import type { Session, SessionBlock, SessionContext } from "@amc/contracts";
import { Icon } from "@amc/ui";
import { EmptyState } from "../components/EmptyState";
import { ShareButton } from "../components/hand-out";
import { FavoriteButton } from "../components/FavoriteButton";
import { SourceMark } from "../components/SourceMark";
import { useDissolve } from "../components/ScrollFades";
import { ago, stampTitle, useNow } from "../library/when";
import { PathLabel } from "../review/DiffView";
import { plural } from "../setup/setup-model";
import { Markdown } from "./Markdown";
import { calledWith, counted, cutNotice, metricsLine, ranFor, sizeOf, type Stretch } from "./sessions-model";
import type { ReaderView, Sessions } from "./use-sessions";

const VIEWS: readonly { id: ReaderView; label: string }[] = [{ id: "transcript", label: "Transcript" }, { id: "context", label: "Context" }];
/** How close to the end of what is loaded the reader is scrolled before the next stretch is read. */
const NEAR_END_PX = 800;

function Cut({ cut }: { cut: number }) {
  return cut > 0 ? <p className="ses-cut">{cutNotice(cut)}</p> : null;
}

/** A row that opens in place. What it opens to is not built until it is opened: a transcript holds
 *  hundreds of tool calls, and their outputs are most of its text. */
function Fold({ head, children }: { head: ReactNode; children: () => ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="ses-fold">
      <button type="button" className="ses-fold-row" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name={open ? "chevronDown" : "chevronRight"} size={12} className="ses-fold-mark" />
        {head}
      </button>
      {open && children()}
    </div>
  );
}

function Block({ block }: { block: SessionBlock }) {
  if (block.kind === "user") {
    return <div className="ses-user" data-selectable><p className="ses-user-text">{block.text}</p><Cut cut={block.cut} /></div>;
  }
  if (block.kind === "assistant") {
    return <div className="ses-assistant"><Markdown text={block.text} /><Cut cut={block.cut} /></div>;
  }
  if (block.kind === "thinking") {
    return (
      <Fold head={<span className="ses-fold-name">Thinking</span>}>
        {() => <div className="ses-thinking" data-selectable><p>{block.text}</p><Cut cut={block.cut} /></div>}
      </Fold>
    );
  }
  if (block.kind === "tool") {
    return (
      <Fold head={<>
        <span className="ses-tool-name">{block.name}</span>
        <span className="ses-tool-called">{calledWith(block.input)}</span>
        {block.failed && <span className="ses-tool-failed"><Icon name="alert" size={12} />Failed</span>}
      </>}>
        {() => (
          <div className="ses-tool-body" data-selectable>
            <h3 className="ses-tool-part">Called with</h3>
            <pre className="setup-code">{block.input}</pre>
            <Cut cut={block.inputCut} />
            <h3 className="ses-tool-part">{block.failed ? "It failed with" : "It answered"}</h3>
            {block.output === null ? <p className="lib-reader-none">The transcript holds no result for this call.</p>
              : block.output === "" ? <p className="lib-reader-none">Nothing. The call gave no output.</p>
              : <pre className="setup-code">{block.output}</pre>}
            <Cut cut={block.outputCut} />
          </div>
        )}
      </Fold>
    );
  }
  return (
    <div className="ses-note">
      <p className="ses-note-line" title={block.text}><span className="ses-note-label">{block.label}</span>{block.text}</p>
      <Cut cut={block.cut} />
    </div>
  );
}

/** One stretch's blocks. A stretch is never changed once read, so when the next one arrives the ones before it are not drawn again. */
const StretchBlocks = memo(function StretchBlocks({ stretch }: { stretch: Stretch }) {
  return <>{stretch.blocks.map((block, at) => <Block key={at} block={block} />)}</>;
});

function Transcript({ sessions }: { sessions: Sessions }) {
  const { stretches, next, reading, readError } = sessions;
  if (stretches === null) {
    return readError !== null
      ? <EmptyState icon="alert" title="The transcript could not be read" role="status">{readError}</EmptyState>
      : <EmptyState className="is-late" role="status" title="Opening the transcript" />;
  }
  return (
    <div className="ses-blocks">
      {stretches.map((stretch) => <StretchBlocks key={stretch.key} stretch={stretch} />)}
      {stretches.every((stretch) => stretch.blocks.length === 0) && next === null && <p className="lib-reader-none">Nothing was said in this session.</p>}
      {readError !== null && (
        <p className="lib-reader-note" data-tone="warning" role="status"><Icon name="alert" size={14} /><span>The rest could not be read: {readError}</span></p>
      )}
      {next !== null && (
        <button type="button" className="btn ses-more" disabled={reading} aria-busy={reading || undefined} onClick={sessions.readMore}>
          {reading ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}

function ContextFiles({ context, error, onOpenFile }: { context: SessionContext | null; error: string | null; onOpenFile: (id: string) => void }) {
  if (context === null) {
    return error !== null
      ? <EmptyState icon="alert" title="The context could not be read" role="status">{error}</EmptyState>
      : <EmptyState className="is-late" role="status" title="Reading the context" />;
  }
  return (
    <div className="ses-context">
      <p className="lib-reader-desc">{counted(context.chars)} {context.chars === 1 ? "character was" : "characters were"} in context before the person's first word.</p>
      {!context.recorded && (
        <p className="lib-reader-note"><Icon name="info" size={14} />
          <span>This was worked out from where the session ran. The transcript itself does not record what it loaded.</span>
        </p>
      )}
      {context.files.length === 0 ? <p className="lib-reader-none">No file is known to have been loaded.</p> : (
        <ul className="setup-places ses-files" aria-label="Files in context">
          {context.files.map((file) => (
            <li key={`${file.role}:${file.displayPath}`}>
              <span className="setup-place-who">{file.role}</span>
              <PathLabel className="setup-place-path" path={file.displayPath} />
              <span className="setup-place-how">{counted(file.chars)} characters</span>
              {(file.changedSince === true || file.libraryId !== null) && (
                <span className="ses-file-more">
                  {file.changedSince === true && <span className="ses-file-changed"><Icon name="alert" size={12} />Changed since this session read it</span>}
                  {file.libraryId !== null && <button type="button" className="btn" onClick={() => onOpenFile(file.libraryId!)}>Open in the library</button>}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Head({ session, onListSubAgents }: { session: Session; onListSubAgents: () => void }) {
  const now = useNow();
  const where = [session.projectName, session.cwd, session.model].filter((part) => part !== null);
  return (
    <>
      <h2 className="lib-reader-title" id="ses-title">{session.title}</h2>
      <p className="lib-reader-where">
        <SourceMark of={session.agent} size={13} />
        {where.length > 0 && `${where.join(" · ")} · `}
        <time dateTime={new Date(session.startedAt).toISOString()} title={stampTitle(session.startedAt)}>Started {ago(session.startedAt, now)}</time>
        {` · Ran ${ranFor(session.startedAt, session.endedAt)} · ${sizeOf(session.sizeBytes)}`}
      </p>
      {session.metrics && <p className="lib-reader-where">{metricsLine(session.metrics)}</p>}
      {session.children > 0 && (
        <button type="button" className="btn ses-children" onClick={onListSubAgents}><Icon name="agents" size={14} />{plural(session.children, "sub-agent")}</button>
      )}
    </>
  );
}

/** The session being read: what it was, then its transcript a stretch at a time, or the files it had loaded. */
export function SessionReader({ sessions, onOpenFile }: { sessions: Sessions; onOpenFile: (id: string) => void }) {
  const { session, view } = sessions;
  const scroller = useRef<HTMLDivElement>(null);
  useDissolve(scroller);

  if (session === null) {
    return (
      <section className="col col-reader" aria-label="Reader">
        <div className="col-head" />
        {(sessions.sessions?.length ?? 0) > 0 && (
          <EmptyState icon="session" title="Pick a session">Each opens to what was said and done, and to the files it had loaded.</EmptyState>
        )}
      </section>
    );
  }
  const nearEnd = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (view === "transcript" && el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_END_PX) sessions.readMore();
  };
  return (
    <section className="col col-reader" aria-label="Reader">
      <header className="col-head lib-reader-bar">
        <div className="col-head-actions">
          <div className="seg" role="radiogroup" aria-label="Show">
            {VIEWS.map((v) => (
              <label key={v.id} className="seg-opt" data-selected={view === v.id || undefined}>
                <input type="radio" name="session-view" checked={view === v.id} onChange={() => sessions.setView(v.id)} />
                {v.label}
              </label>
            ))}
          </div>
          <FavoriteButton kind="session" of={session.id} placed="bar" />
          <ShareButton handed={{ path: session.path }} />
          <button type="button" className="icon-btn" aria-label="Show in Finder" title="Show in Finder" onClick={() => sessions.reveal(session.path)}><Icon name="folder" size={14} /></button>
        </div>
      </header>
      <div className="lib-reader-scroll" key={session.id} ref={scroller} onScroll={nearEnd}>
        <article className="lib-reader ses-reader" aria-labelledby="ses-title">
          <Head session={session} onListSubAgents={() => sessions.listSubAgents(session)} />
          {view === "transcript" ? <Transcript sessions={sessions} /> : <ContextFiles context={sessions.context} error={sessions.contextError} onOpenFile={onOpenFile} />}
        </article>
      </div>
    </section>
  );
}
