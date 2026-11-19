import { useRef, type ReactNode } from "react";
import { LIBRARY_GROUP_LABEL, LIBRARY_KIND_LABEL } from "@amc/contracts";
import { Icon } from "@amc/ui";
import { EmptyState } from "../components/EmptyState";
import { FavoriteButton } from "../components/FavoriteButton";
import { useDissolve } from "../components/ScrollFades";
import { SourceMark } from "../components/SourceMark";
import { age, stampTitle, useNow } from "../library/when";
import { whoseLine } from "../sessions/sessions-model";
import { definedIn, hookTitle, ownerOf, reachedBy } from "../setup/setup-model";
import type { FavoritesShown } from "./FavoritesSidebar";
import { FAVORITE_KINDS, type FavoriteItem } from "./use-favorite-items";

/** What a card says of its thing: the same words its row has in its own section. */
type Face = { mark: ReactNode; kind: string; title: string; line: string | null; mono?: boolean; place: string; changedAt?: number };

function faceOf(item: FavoriteItem): Face {
  if (item.kind === "file") {
    const { file } = item;
    return { mark: <SourceMark of={file.group} size={14} />, kind: LIBRARY_KIND_LABEL[file.kind], title: file.title, line: file.description, place: LIBRARY_GROUP_LABEL[file.group], changedAt: file.updatedAt };
  }
  if (item.kind === "skill") {
    const { skill } = item;
    return { mark: <Icon name="book" size={14} />, kind: "Skill", title: skill.name, line: skill.description, place: reachedBy(skill), changedAt: skill.updatedAt };
  }
  if (item.kind === "mcp") {
    const { server } = item;
    return { mark: <Icon name="plug" size={14} />, kind: "MCP server", title: server.name, line: server.definitions[0]?.target ?? null, mono: true, place: definedIn(server) };
  }
  if (item.kind === "hook") {
    const { hook } = item;
    return { mark: <SourceMark of={hook.agent} size={14} />, kind: "Hook", title: hookTitle(hook), line: hook.command, mono: true, place: ownerOf(hook) };
  }
  const { session } = item;
  return { mark: <SourceMark of={session.agent} size={14} />, kind: "Session", title: session.title, line: null, place: whoseLine(session), changedAt: session.endedAt };
}

/**
 * Everything starred, as cards under the kind of thing each is. A card opens its thing in the
 * section that thing lives in.
 */
export function FavoritesPage({ items, shown, onOpen }: { items: readonly FavoriteItem[]; shown: FavoritesShown; onOpen: (item: FavoriteItem) => void }) {
  const now = useNow();
  const scroller = useRef<HTMLDivElement>(null);
  useDissolve(scroller);
  const groups = FAVORITE_KINDS.filter(({ kind }) => shown === "all" || shown === kind)
    .map((group) => ({ ...group, items: items.filter((item) => item.kind === group.kind) }))
    .filter((group) => group.items.length > 0);
  const heading = shown === "all" ? "Favorites" : FAVORITE_KINDS.find(({ kind }) => kind === shown)!.label;

  return (
    <section className="col lib-grid" aria-label="Favorites">
      <header className="col-head lib-list-head lib-grid-head">
        <h1 className="lib-list-title"><span className="lib-list-name">{heading}</span></h1>
      </header>
      {groups.length === 0 ? (
        <EmptyState icon="star" title="No favorites">The star on a memory, a skill, a server, a hook or a session keeps it here.</EmptyState>
      ) : (
        <div className="fav-groups" ref={scroller} data-dissolve="">
          {groups.map((group) => (
            <section key={group.kind} aria-label={group.label}>
              {shown === "all" && <h2 className="fav-group-name">{group.label}</h2>}
              <ul className="lib-cards fav-cards" aria-label={group.label}>
                {group.items.map((item) => {
                  const face = faceOf(item);
                  return (
                    <li key={item.key}>
                      <button type="button" className="lib-card" onClick={() => onOpen(item)}>
                        <span className="lib-card-head">{face.mark}<span className="lib-card-kind">{face.kind}</span></span>
                        <span className="lib-card-title">{face.title}</span>
                        {face.line !== null && <span className="lib-card-line" data-mono={face.mono || undefined}>{face.line}</span>}
                        <span className="lib-card-foot">
                          <span className="lib-row-place">{face.place}</span>
                          {face.changedAt !== undefined && <time dateTime={new Date(face.changedAt).toISOString()} title={stampTitle(face.changedAt)}>{age(face.changedAt, now)}</time>}
                        </span>
                      </button>
                      <FavoriteButton kind={item.kind} of={item.key} placed="row" />
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
