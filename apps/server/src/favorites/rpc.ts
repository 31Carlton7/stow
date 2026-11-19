import type { RpcServer } from "../rpc/server";
import type { FavoriteStore } from "./favorites";

export function registerFavorites(rpc: RpcServer, favorites: FavoriteStore): void {
  rpc.register("favorites.list", async () => ({ favorites: favorites.list() }));
  rpc.register("favorites.set", async ({ kind, key, on }) => {
    favorites.set(kind, key, on);
    return { favorites: favorites.list() };
  });
}
