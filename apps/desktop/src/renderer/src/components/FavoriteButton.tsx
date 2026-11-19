import type { MouseEvent } from "react";
import type { FavoriteKind } from "@amc/contracts";
import { Icon } from "@amc/ui";
import { useFavorites } from "../favorites/use-favorites";

/**
 * The star on anything that can be a favourite. In a row or on a card it is a small glyph that shows
 * under the pointer and stays once it is on; in a column's bar it is an icon button like the others
 * there. `of` is the favourite's key for its kind.
 */
export function FavoriteButton({ kind, of, placed }: { kind: FavoriteKind; of: string; placed: "row" | "bar" }) {
  const favorites = useFavorites();
  const on = favorites.has(kind, of);
  const label = on ? "Remove from Favorites" : "Add to Favorites";
  // The row or card under it opens on a click: the star's own click stops here.
  const press = (e: MouseEvent) => { e.stopPropagation(); favorites.set(kind, of, !on); };
  return (
    <button type="button" className={placed === "bar" ? "icon-btn fav-bar" : "fav"} aria-pressed={on} aria-label={label} title={label} onClick={press}>
      <Icon name="star" size={14} />
    </button>
  );
}
