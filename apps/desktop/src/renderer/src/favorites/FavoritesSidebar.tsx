import { useRef } from "react";
import type { FavoriteKind } from "@amc/contracts";
import { Icon, type IconName } from "@amc/ui";
import { useDissolve } from "../components/ScrollFades";
import { FAVORITE_KINDS, type FavoriteItem } from "./use-favorite-items";

export type FavoritesShown = FavoriteKind | "all";

const KIND_MARK: Record<FavoriteKind, IconName> = { file: "context", skill: "book", mcp: "plug", hook: "zap", session: "session" };

/** Under Favorites: everything starred, then each kind of thing with how many of it are. */
export function FavoritesSidebar({ items, shown, show }: { items: readonly FavoriteItem[]; shown: FavoritesShown; show: (to: FavoritesShown) => void }) {
  const scroller = useRef<HTMLElement>(null);
  useDissolve(scroller);
  const row = (to: FavoritesShown, label: string, count: number, mark: IconName) => (
    <li key={to}>
      <button type="button" className="lib-nav-row" data-selected={shown === to || undefined} aria-current={shown === to || undefined} onClick={() => show(to)}>
        <Icon name={mark} size={16} className="lib-nav-mark" />
        <span className="lib-nav-name">{label}</span>
        <span className="lib-nav-count">{count}</span>
      </button>
    </li>
  );
  return (
    <nav className="sb-list lib-nav" aria-label="Favorites" ref={scroller}>
      <ul className="lib-nav-list">{row("all", "All", items.length, "star")}</ul>
      <ul className="lib-nav-list" aria-label="Kinds">
        {FAVORITE_KINDS.map(({ kind, label }) => row(kind, label, items.filter((item) => item.kind === kind).length, KIND_MARK[kind]))}
      </ul>
    </nav>
  );
}
