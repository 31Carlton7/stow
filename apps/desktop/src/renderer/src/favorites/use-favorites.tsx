import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Favorite, FavoriteKind } from "@amc/contracts";
import { said, type RpcClient } from "../rpc/client";
import { toast } from "../toasts";

export type FavoritesRpc = Pick<RpcClient, "call">;

export type Favorites = {
  /** Newest first. */
  all: readonly Favorite[];
  has(kind: FavoriteKind, key: string): boolean;
  set(kind: FavoriteKind, key: string, on: boolean): void;
};

const same = (favorite: Favorite, kind: FavoriteKind, key: string): boolean => favorite.kind === kind && favorite.key === key;

/** What a section drawn with nothing holding the set sees: nothing starred, and a star that does nothing. */
const NONE: Favorites = { all: [], has: () => false, set: () => {} };
const Held = createContext<Favorites>(NONE);

/** What is starred, the same for every section of the window: a star pressed in one shows in all of them at once. */
export const useFavorites = (): Favorites => useContext(Held);

/**
 * Holds the window's favourites. A press shows at once and is then sent; the server answers with the
 * whole set, which is kept, and a refusal puts the star back as it was.
 */
export function FavoritesProvider({ rpc, children }: { rpc: FavoritesRpc; children: ReactNode }) {
  const [all, setAll] = useState<Favorite[]>([]);

  useEffect(() => {
    let live = true;
    rpc.call("favorites.list", {}).then((kept) => { if (live) setAll(kept.favorites); }, () => {});
    return () => { live = false; };
  }, [rpc]);

  const favorites = useMemo((): Favorites => {
    const starred = new Set(all.map((f) => `${f.kind}\n${f.key}`));
    const put = (kind: FavoriteKind, key: string, on: boolean): void => {
      setAll((held) => {
        const others = held.filter((f) => !same(f, kind, key));
        return on ? [{ kind, key, at: Date.now() }, ...others] : others;
      });
    };
    return {
      all,
      has: (kind, key) => starred.has(`${kind}\n${key}`),
      set(kind, key, on) {
        put(kind, key, on);
        rpc.call("favorites.set", { kind, key, on }).then(
          (kept) => setAll(kept.favorites),
          (e: unknown) => { put(kind, key, !on); toast({ tone: "error", text: said(e) }); },
        );
      },
    };
  }, [all, rpc]);

  return <Held.Provider value={favorites}>{children}</Held.Provider>;
}
