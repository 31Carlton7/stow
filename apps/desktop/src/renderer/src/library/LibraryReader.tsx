import { Suspense, lazy, useRef, useState, type FormEvent, type MouseEvent as ReactMouseEvent } from "react";
import { LIBRARY_GROUP_LABEL, type LibraryFile } from "@amc/contracts";
import { Icon } from "@amc/ui";
import { EmptyState } from "../components/EmptyState";
import { ShareButton } from "../components/hand-out";
import { FavoriteButton } from "../components/FavoriteButton";
import { SourceMark } from "../components/SourceMark";
import { useDissolve } from "../components/ScrollFades";
import { READER_ID } from "./LibraryList";
import { linkOf, linkWikiLinks, tagsTyped, typeLabel, withoutTitle } from "./library-model";
import type { EditorSurface, Library } from "./use-library";
import { ago, stampTitle, useNow } from "./when";

/* The editors are ProseMirror and CodeMirror: split out, so the window's first paint pays for neither. */
const RichTextEditor = lazy(() => import("../editors/RichTextEditor").then((m) => ({ default: m.RichTextEditor })));
const CodeEditor = lazy(() => import("../editors/CodeEditor").then((m) => ({ default: m.CodeEditor })));

const NOOP = () => {};
/** What the property list leaves out: the head already says them. */
const SHOWN_ELSEWHERE = new Set(["name", "description", "type", "metadata.type"]);
const SURFACES: readonly { id: EditorSurface; label: string; title: string }[] = [
  { id: "rich", label: "Rich", title: "The text as it reads. Frontmatter is shown as it is written and left alone." },
  { id: "source", label: "Source", title: "The whole file as Markdown, frontmatter included." },
];

/** The way back to the grid, at the left of the bar of a file opened from it. */
function Back({ onBack }: { onBack: () => void }) {
  return (
    <div className="col-head-actions lib-reader-back">
      <button type="button" className="btn" onClick={onBack}><Icon name="chevronLeft" size={14} />Back</button>
    </div>
  );
}

/** The third column: the file being read, or the editor on it. Opened from the grid it has the whole
 *  panel, and `onBack` returns to the cards. */
export function LibraryReader({ library, onBack }: { library: Library; onBack?: () => void }) {
  const { file, editing, entries, shownId } = library;
  return (
    <section className="col col-reader" aria-label="Reader" id={READER_ID} tabIndex={-1} data-alone={onBack ? "" : undefined}>
      {file && editing ? <FileEditor library={library} file={file} />
        : file ? <FileReader library={library} file={file} onBack={onBack} />
        : (
          <>
            {onBack ? <header className="col-head lib-reader-bar"><Back onBack={onBack} /></header> : <div className="col-head" />}
            {library.missing !== null ? (
              <EmptyState icon="alert" title="This file is gone">It was moved or deleted after the list was read.</EmptyState>
            ) : shownId !== null ? (
              <EmptyState className="is-late" role="status" title="Opening the file" />
            ) : entries !== null && (
              <EmptyState icon="note" title="No file to read">Choose a file from the list to read it here.</EmptyState>
            )}
          </>
        )}
    </section>
  );
}

/** A file's path on one line, cut in the middle so its name stays whole: the folders give way first.
 *  The whole of it is the tooltip. */
function FilePath({ file }: { file: LibraryFile }) {
  const cut = file.displayPath.lastIndexOf("/") + 1;
  return (
    <code className="lib-path" title={file.path}>
      <span className="lib-path-dir">{file.displayPath.slice(0, cut)}</span>
      <span className="lib-path-name">{file.displayPath.slice(cut)}</span>
    </code>
  );
}

function FileReader({ library, file, onBack }: { library: Library; file: LibraryFile; onBack?: () => void }) {
  const now = useNow();
  const scroller = useRef<HTMLDivElement>(null);
  useDissolve(scroller);
  const source = library.sourceById.get(file.sourceId);
  const props = file.frontmatter.filter((f) => !SHOWN_ELSEWHERE.has(f.key));
  /* What the head already says is not said again under it: a description is a lede only where the
     frontmatter gave one (otherwise it is the body's own first line), and a title taken from the body's
     opening heading leaves that heading out. */
  const lede = file.frontmatter.some((f) => f.key === "description") ? file.description : null;
  const body = withoutTitle(file.body, file.title);
  const place = file.folder !== null && !file.index ? file.folder : source?.label ?? null;
  /* A link to another file opens it here, and one that leads nowhere does nothing: its tooltip says
     why. A web link is left to the window, which hands it to the browser. */
  const follow = (e: ReactMouseEvent) => {
    const href = (e.target as HTMLElement).closest("a")?.getAttribute("href");
    const link = href ? linkOf(file.links, href) : null;
    if (!link) return;
    e.preventDefault();
    if (link.id !== null) library.open(link.id);
  };
  return (
    <>
      <header className="col-head lib-reader-bar">
        {onBack && <Back onBack={onBack} />}
        <div className="col-head-actions">
          <FavoriteButton kind="file" of={file.id} placed="bar" />
          <ShareButton handed={{ path: file.path }} />
          {file.deletable && <button type="button" className="btn" aria-label={`Delete ${file.title}`} onClick={library.askDelete}>Delete…</button>}
          {file.writable && <button type="button" className="btn" onClick={library.startEdit}><Icon name="edit" size={14} />Edit</button>}
        </div>
      </header>
      <div className="lib-reader-scroll" ref={scroller}>
        <article className="lib-reader" aria-labelledby="library-reader-title">
          <h2 className="lib-reader-title" id="library-reader-title">{file.title}</h2>
          <p className="lib-reader-where">
            <SourceMark of={file.group} size={13} />
            {[LIBRARY_GROUP_LABEL[file.group], place].filter(Boolean).join(" · ")}{" · "}
            <time dateTime={new Date(file.updatedAt).toISOString()} title={stampTitle(file.updatedAt)}>Edited {ago(file.updatedAt, now)}</time>
          </p>
          {lede && <p className="lib-reader-desc">{lede}</p>}
          <dl className="lib-props">
            {file.type && <><dt>Type</dt><dd>{typeLabel(file.type)}</dd></>}
            {/* An empty file says who loads it where its text would be. */}
            {file.size > 0 && <><dt>Loaded by</dt><dd>{file.readBy}</dd></>}
            {props.map((p) => <PropRow key={p.key} name={p.key} value={p.value} />)}
            <dt>File</dt>
            <dd className="lib-props-file">
              <FilePath file={file} />
              <button type="button" className="icon-btn" aria-label="Show in Finder" title="Show in Finder" onClick={() => library.reveal(file.path)}>
                <Icon name="folder" size={14} />
              </button>
            </dd>
            {file.otherCopies.length > 0 && (
              <>
                <dt>Copies</dt>
                <dd>
                  <ul className="lib-copies">
                    {file.otherCopies.map((copy) => (
                      <li key={copy.id}>
                        <button type="button" className="lib-copy" title={copy.displayPath} onClick={() => library.open(copy.id)}>
                          <SourceMark of={copy.where} />
                          <span className="lib-copy-where">{copy.where}</span>
                          <span className="lib-copy-state" data-changed={copy.same ? undefined : ""}>{copy.same ? "Same text" : "Has changed since"}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </dd>
              </>
            )}
            <dt>Tags</dt>
            <dd><Tags tags={file.tags} onChange={library.setTags} /></dd>
          </dl>
          {file.note && <p className="lib-reader-note"><Icon name="lock" size={14} />{file.note}</p>}
          {file.size === 0 ? (
            <EmptyState icon="note" title="This file is empty">{file.readBy}</EmptyState>
          ) : body.trim() === "" ? (
            <p className="lib-reader-none">Nothing is written below the properties.</p>
          ) : (
            <div className="lib-reader-body" data-selectable onClickCapture={follow}>
              <Suspense fallback={null}>
                <RichTextEditor key={`${file.id}:${file.updatedAt}`} text={linkWikiLinks(body)} onChange={NOOP} readOnly
                  isDeadLink={(href) => linkOf(file.links, href)?.id === null} />
              </Suspense>
            </div>
          )}
        </article>
      </div>
    </>
  );
}

function PropRow({ name, value }: { name: string; value: string }) {
  return <><dt>{name.replace(/^metadata\./, "")}</dt><dd>{value}</dd></>;
}

/** A file's tags: each one a chip that takes it off, and a field that adds more. They are kept
 *  beside the library, never written into the file. */
function Tags({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const [typed, setTyped] = useState("");
  const add = (e: FormEvent) => {
    e.preventDefault();
    const more = tagsTyped(typed).filter((t) => !tags.includes(t.toLowerCase()));
    setTyped("");
    if (more.length > 0) onChange([...tags, ...more]);
  };
  return (
    <form className="lib-tags" onSubmit={add}>
      {tags.map((tag) => (
        <button key={tag} type="button" className="lib-tag" aria-label={`Remove the tag ${tag}`} title={`Remove the tag ${tag}`}
          onClick={() => onChange(tags.filter((t) => t !== tag))}>
          {tag}<Icon name="close" size={12} />
        </button>
      ))}
      <input className="lib-tag-field" aria-label="Add a tag" placeholder="Add a tag" maxLength={40} spellCheck={false}
        value={typed} onChange={(e) => setTyped(e.target.value)} />
    </form>
  );
}

/**
 * Editing a file: its whole text, frontmatter included, as rich text or as source. Save writes it:
 * one commit in a repository, and anywhere else a backup first, after the person's yes.
 */
function FileEditor({ library, file }: { library: Library; file: LibraryFile }) {
  const editing = library.editing!;
  const state = editing.saving ? "Saving…" : library.dirty ? "Edited" : "No changes";
  const consequence = file.external ? `${LIBRARY_GROUP_LABEL[file.group]}'s own file` : "Saving makes one commit";
  return (
    <>
      <header className="col-head lib-reader-bar lib-editor-bar">
        <div className="lib-editor-name">
          <span className="lib-editor-title">{file.title}</span>
          <span className="lib-editor-state" role="status">{state} · {consequence}</span>
        </div>
        <div className="col-head-actions">
          <div className="seg" role="radiogroup" aria-label="Edit as">
            {SURFACES.map((s) => (
              <label key={s.id} className="seg-opt" data-selected={editing.surface === s.id || undefined} title={s.title}>
                <input type="radio" name="library-editor" checked={editing.surface === s.id} onChange={() => library.chooseSurface(s.id)} />
                {s.label}
              </label>
            ))}
          </div>
          <button type="button" className="btn" onClick={library.cancelEdit}>Cancel</button>
          <button type="button" className="btn primary" disabled={!library.dirty || editing.saving} aria-busy={editing.saving || undefined} onClick={library.save}>Save</button>
        </div>
      </header>
      <div className="lib-editor-body" data-surface={editing.surface}>
        <Suspense fallback={null}>
          {editing.surface === "rich"
            ? <RichTextEditor text={editing.draft} onChange={library.changeDraft} onSave={library.save} />
            : <CodeEditor path={file.path} text={editing.draft} onChange={library.changeDraft} onSave={library.save} />}
        </Suspense>
      </div>
    </>
  );
}
