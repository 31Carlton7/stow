import { z } from "zod";
import type { Hook } from "./setup";

/*
 * What the person has starred. A favourite is kept in the app's own index and never written into an
 * agent's files, so it names its thing by whatever of that thing outlasts a rescan and a restart.
 */

/**
 * What a favourite's `key` is, by kind:
 * `file`: a library file's id. `skill`: a skill's id, which names its real folder.
 * `mcp`: a server's name. `session`: a session's id. `hook`: `hookFavoriteKey` of it.
 */
export const FavoriteKindSchema = z.enum(["file", "skill", "mcp", "hook", "session"]);
export type FavoriteKind = z.infer<typeof FavoriteKindSchema>;

export const FavoriteSchema = z.object({ kind: FavoriteKindSchema, key: z.string(), at: z.number() });
export type Favorite = z.infer<typeof FavoriteSchema>;

/** A hook has no name of its own: it is the config file it is in, when it runs, what it is limited to and what it runs. */
export const hookFavoriteKey = (hook: Pick<Hook, "file" | "event" | "matcher" | "command">): string =>
  [hook.file, hook.event, hook.matcher ?? "", hook.command].join("\n");

const Favorites = z.object({ favorites: z.array(FavoriteSchema) });

export const FavoriteMethods = {
  /** Newest first. */
  "favorites.list": { params: z.object({}), result: Favorites },
  /** Star or unstar one thing. Answers with every favourite as it then stands. */
  "favorites.set": { params: z.object({ kind: FavoriteKindSchema, key: z.string().min(1).max(8000), on: z.boolean() }), result: Favorites },
} as const;
