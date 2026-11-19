import { useEffect, useRef, type KeyboardEvent } from "react";
import { Icon } from "@amc/ui";
import { EmptyState } from "../components/EmptyState";
import { dragOut } from "../components/hand-out";
import { FavoriteButton } from "../components/FavoriteButton";
import { SourceMark } from "../components/SourceMark";
import { useDissolve } from "../components/ScrollFades";
import { scopeHeading, scopeTitle, typeLabel, whereOf } from "./library-model";
import type { Layout, Library } from "./use-library";
import { age, stampTitle, useNow } from "./when";

/** The reader's column, which Enter in the list hands the keyboard to. */
export const READER_ID = "library-reader";

const LAYOUTS: readonly { id: Layout; label: string; icon: "list" | "grid" }[] = [
  { id: "list", label: "List", icon: "list" },
  { id: "grid", label: "Grid", icon: "grid" },
];

/** List or Grid: the two ways the same files are laid out. It sits in the head of either. */
export function LayoutChoice({ library }: { library: Library }) {
  return (
    <div className="seg lib-layout" role="radiogroup" aria-label="Show as">
      {LAYOUTS.map((l) => (
        <label key={l.id} className="seg-opt" data-selected={library.layout === l.id || undefined} title={l.label}>
          <input type="radio" name="library-layout" aria-label={l.label} checked={library.layout === l.id} onChange={() => library.setLayout(l.id)} />
          <Icon name={l.icon} size={14} />
        </label>
      ))}
    </div>
  );
}

/** What stands where the files would be while there are none to show: still being read, not
 *  readable, or none that match. */
export function NoFiles({ library }: { library: Library }) {
  const { entries, index } = library;
  if (entries === null) {
    return library.listError !== null
      ? <EmptyState icon="alert" title="The library could not be read" role="status">{library.listError}</EmptyState>
      : <EmptyState className="is-late" role="status" title="Reading the library" />;
  }
  if (library.query.trim()) return <EmptyState icon="search" title="Nothing matches">Search reads every file's name, description and text. Try fewer words.</EmptyState>;
  if (library.scope.favorites) return <EmptyState icon="star" title="No favorites">Star a file to keep it here.</EmptyState>;
  if (index !== null && index.total === 0) return <EmptyState icon="folder" title="No memory files yet">No agent this app knows keeps a memory or instruction file on this Mac.</EmptyState>;
  return <EmptyState icon="folder" title="Nothing here">No file is kept here now.</EmptyState>;
}

/**
 * The files the sidebar's row keeps, under one search. A row is a file's name, the line that says
 * what it is (or where the search found it), where it is kept and how long ago it changed.
 *
 * The arrows move the selection from the search field and from the list alike, and Enter goes to the
 * file being read.
 */
export function LibraryList({ library }: { library: Library }) {
  const { entries, index, scope, shownId } = library;
  const now = useNow();
  const scroller = useRef<HTMLUListElement>(null);
  useDissolve(scroller);
  const heading = scopeHeading(scope, index?.projects ?? []);

  useEffect(() => {
    scroller.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" });
  }, [shownId]);

  const onKeyDown = (e: KeyboardEvent) => {
    // A button in the column keeps its own keys: Enter on New memory opens the sheet.
    if ((e.target as HTMLElement).closest("button")) return;
    if (e.key === "Enter") {
      e.preventDefault();
      document.getElementById(READER_ID)?.focus();
      return;
    }
    if ((e.key !== "ArrowDown" && e.key !== "ArrowUp") || !entries || entries.length === 0) return;
    e.preventDefault();
    const at = entries.findIndex((entry) => entry.id === shownId);
    const next = entries[Math.min(entries.length - 1, Math.max(0, at + (e.key === "ArrowDown" ? 1 : -1)))]!;
    if (next.id !== shownId) library.open(next.id);
  };

  return (
    <section className="col col-list" aria-label="Files" onKeyDown={onKeyDown}>
      <header className="col-head lib-list-head">
        <h1 className="lib-list-title">
          {heading.agent !== undefined && <SourceMark of={heading.agent} size={16} fallback="terminal" />}
          <span className="lib-list-name">{heading.name}</span>
          {heading.kind !== undefined && <span className="lib-list-kind">{heading.kind}</span>}
        </h1>
        <div className="col-head-actions">
          <LayoutChoice library={library} />
          <button type="button" className="icon-btn" aria-label="New memory" title="New memory" onClick={library.startNew}>
            <Icon name="add" size={14} />
          </button>
        </div>
      </header>
      <label className="lib-search">
        <Icon name="search" size={14} />
        <input className="search-field" type="search" aria-label="Search the library" placeholder="Search" spellCheck={false}
          value={library.query} onChange={(e) => library.setQuery(e.target.value)} />
      </label>
      {entries === null || entries.length === 0 ? <NoFiles library={library} /> : (
        <ul className="lib-rows" role="listbox" aria-label={scopeTitle(scope, index?.projects ?? [])} tabIndex={0} ref={scroller}>
          {entries.map((e) => {
            const where = whereOf(e, library.sourceById.get(e.sourceId), scope);
            const line = e.match && e.match !== e.description ? e.match : e.description;
            const chosen = shownId === e.id;
            return (
              <li key={e.id} className="lib-row" role="option" aria-selected={chosen} data-selected={chosen || undefined} data-index={e.index || undefined}
                onClick={() => library.open(e.id)} {...dragOut({ path: e.path })}>
                <span className="lib-row-head">
                  <SourceMark of={e.group} size={13} />
                  <span className="lib-row-title">{e.title}</span>
                  {e.copies > 1 && (
                    <span className="lib-row-copies" title={`${e.copies} files on this Mac hold exactly this text`}>
                      <Icon name="copy" size={12} />{e.copies} copies
                    </span>
                  )}
                  <FavoriteButton kind="file" of={e.id} placed="row" />
                </span>
                <span className="lib-row-line" data-empty={line ? undefined : ""}>{line ?? "Empty"}</span>
                <span className="lib-row-foot">
                  <span className="lib-row-place">{where}</span>
                  {e.type && <span className="lib-chip">{typeLabel(e.type)}</span>}
                  <time dateTime={new Date(e.updatedAt).toISOString()} title={stampTitle(e.updatedAt)}>{age(e.updatedAt, now)}</time>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
