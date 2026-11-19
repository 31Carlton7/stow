import type { Favorite, FavoriteKind } from "@amc/contracts";
import type { Db } from "../db/database";

/** What the person has starred. It lives here and is never written into an agent's files. */
export class FavoriteStore {
  constructor(private db: Db) {}

  list(): Favorite[] {
    return this.db.prepare("SELECT kind, key, at FROM favorites ORDER BY at DESC, kind, key").all() as Favorite[];
  }

  /** Starring what is already starred keeps the day it was first starred. */
  set(kind: FavoriteKind, key: string, on: boolean): void {
    if (on) this.db.prepare("INSERT OR IGNORE INTO favorites (kind, key, at) VALUES (?, ?, ?)").run(kind, key, Date.now());
    else this.db.prepare("DELETE FROM favorites WHERE kind = ? AND key = ?").run(kind, key);
  }
}
