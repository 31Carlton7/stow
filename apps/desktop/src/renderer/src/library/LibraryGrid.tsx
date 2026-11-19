import { useEffect, useLayoutEffect, useRef, type CSSProperties } from "react";
import { LIBRARY_KIND_LABEL } from "@amc/contracts";
import { Icon } from "@amc/ui";
import { dragOut } from "../components/hand-out";
import { FavoriteButton } from "../components/FavoriteButton";
import { SourceMark } from "../components/SourceMark";
import { useDissolve } from "../components/ScrollFades";
import { LayoutChoice, NoFiles } from "./LibraryList";
import { LibraryReader } from "./LibraryReader";
import { scopeHeading, scopeTitle, typeLabel, whereOf } from "./library-model";
import type { Library } from "./use-library";
import { age, stampTitle, useNow } from "./when";

/** How many cards arrive one after another. The rest are simply there, as with a list's rows. */
const STAGGERED = 12;

/**
 * The same files as the list, as cards across the whole panel. A card opens its file in the reader,
 * which takes the panel until Back or Escape returns to the cards where they were scrolled to.
 */
export function LibraryGrid({ library }: { library: Library }) {
  const { entries, index, scope, query, reading } = library;
  const now = useNow();
  const scroller = useRef<HTMLUListElement>(null);
  useDissolve(scroller);
  /** Where the cards were when one was opened, and which: Back returns there. */
  const left = useRef<{ top: number; id: string } | null>(null);
  const heading = scopeHeading(scope, index?.projects ?? []);

  // Other files are listed now: there is no place among them to return to.
  useLayoutEffect(() => { left.current = null; }, [scope, query]);

  useLayoutEffect(() => {
    if (reading || !left.current || !scroller.current) return;
    scroller.current.scrollTop = left.current.top;
    scroller.current.querySelector<HTMLElement>(`[data-id="${CSS.escape(left.current.id)}"]`)?.focus({ preventScroll: true });
  }, [reading]);

  const busy = library.editing !== null || library.question !== null || library.newMemory !== null;
  const { closeReading } = library;
  useEffect(() => {
    if (!reading || busy) return;
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape" && !e.defaultPrevented) closeReading(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [reading, busy, closeReading]);

  if (reading) return <LibraryReader library={library} onBack={closeReading} />;

  const returned = left.current !== null;
  return (
    <section className="col lib-grid" aria-label="Files">
      <header className="col-head lib-list-head lib-grid-head">
        <h1 className="lib-list-title">
          {heading.agent !== undefined && <SourceMark of={heading.agent} size={16} fallback="terminal" />}
          <span className="lib-list-name">{heading.name}</span>
          {heading.kind !== undefined && <span className="lib-list-kind">{heading.kind}</span>}
        </h1>
        <label className="lib-search">
          <Icon name="search" size={14} />
          <input className="search-field" type="search" aria-label="Search the library" placeholder="Search" spellCheck={false}
            value={query} onChange={(e) => library.setQuery(e.target.value)} />
        </label>
        <div className="col-head-actions">
          <LayoutChoice library={library} />
          <button type="button" className="icon-btn" aria-label="New memory" title="New memory" onClick={library.startNew}>
            <Icon name="add" size={14} />
          </button>
        </div>
      </header>
      {entries === null || entries.length === 0 ? <NoFiles library={library} /> : (
        /* Marked a dissolving scroller from its first layout. Where the Mac draws classic bars the mark
           narrows the bar, and narrowed a frame late it rewraps the cards after the scroll was put back. */
        <ul className="lib-cards" aria-label={scopeTitle(scope, index?.projects ?? [])} ref={scroller} data-dissolve="">
          {entries.map((e, at) => {
            const where = whereOf(e, library.sourceById.get(e.sourceId), scope);
            const line = e.match && e.match !== e.description ? e.match : e.description;
            const open = () => {
              left.current = { top: scroller.current?.scrollTop ?? 0, id: e.id };
              library.open(e.id);
            };
            return (
              <li key={e.id} style={!returned && at < STAGGERED ? { "--nth": at } as CSSProperties : undefined}>
                <button type="button" className="lib-card" data-id={e.id} data-index={e.index || undefined} onClick={open} {...dragOut({ path: e.path })}>
                  <span className="lib-card-head">
                    <SourceMark of={e.group} size={14} />
                    <span className="lib-card-kind">{LIBRARY_KIND_LABEL[e.kind]}</span>
                    {e.copies > 1 && (
                      <span className="lib-row-copies" title={`${e.copies} files on this Mac hold exactly this text`}>
                        <Icon name="copy" size={12} />{e.copies} copies
                      </span>
                    )}
                  </span>
                  <span className="lib-card-title">{e.title}</span>
                  <span className="lib-card-line" data-empty={line ? undefined : ""}>{line ?? "Empty"}</span>
                  <span className="lib-card-foot">
                    <span className="lib-row-place">{where}</span>
                    {e.type && <span className="lib-chip">{typeLabel(e.type)}</span>}
                    <time dateTime={new Date(e.updatedAt).toISOString()} title={stampTitle(e.updatedAt)}>{age(e.updatedAt, now)}</time>
                  </span>
                </button>
                <FavoriteButton kind="file" of={e.id} placed="row" />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
