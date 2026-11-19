import { useEffect, useMemo, useState } from "react";
import { hookFavoriteKey, type FavoriteKind, type Hook, type LibraryFile, type McpServer, type Session, type Skill } from "@amc/contracts";
import type { RpcClient } from "../rpc/client";
import type { Setup } from "../setup/use-setup";
import { useFavorites } from "./use-favorites";

/** One starred thing, with the thing itself as its own section knows it. `at` is a hook's place in the list of hooks. */
export type FavoriteItem =
  | { kind: "file"; key: string; file: LibraryFile }
  | { kind: "skill"; key: string; skill: Skill }
  | { kind: "mcp"; key: string; server: McpServer }
  | { kind: "hook"; key: string; hook: Hook; at: number }
  | { kind: "session"; key: string; session: Session };

/** The kinds in the order the Favorites section lists them, by the name each goes under there. */
export const FAVORITE_KINDS: readonly { kind: FavoriteKind; label: string }[] = [
  { kind: "file", label: "Memories" }, { kind: "skill", label: "Skills" }, { kind: "mcp", label: "MCP servers" },
  { kind: "hook", label: "Hooks" }, { kind: "session", label: "Sessions" },
];

/**
 * Everything starred, newest first, each with the thing it names. Skills, servers and hooks are
 * found in what the setup has read; a file and a session are asked for by id. A favourite whose
 * thing is gone from this Mac is left out, and is still kept in case the thing comes back.
 *
 * Files and sessions are asked for only while `shown`, and again each time it becomes so: a file
 * may have been renamed, and a session indexed, since the section was last on screen.
 */
export function useFavoriteItems(rpc: Pick<RpcClient, "call">, setup: Pick<Setup, "skills" | "servers" | "hooks">, shown: boolean): FavoriteItem[] {
  const { all } = useFavorites();
  const [files, setFiles] = useState<ReadonlyMap<string, LibraryFile>>(new Map());
  const [sessions, setSessions] = useState<ReadonlyMap<string, Session>>(new Map());
  const fileIds = all.filter((f) => f.kind === "file").map((f) => f.key).join("\n");
  const sessionIds = all.filter((f) => f.kind === "session").map((f) => f.key).join("\n");

  useEffect(() => {
    if (!shown) return;
    let live = true;
    const ids = fileIds === "" ? [] : fileIds.split("\n");
    void Promise.all(ids.map((id) => rpc.call("library.read", { id }).catch(() => null))).then((read) => {
      if (live) setFiles(new Map(read.filter((file) => file !== null).map((file) => [file.id, file])));
    });
    return () => { live = false; };
  }, [rpc, fileIds, shown]);

  useEffect(() => {
    if (!shown) return;
    let live = true;
    const ids = sessionIds === "" ? [] : sessionIds.split("\n");
    void Promise.all(ids.map((id) => rpc.call("sessions.get", { id }).catch(() => null))).then((got) => {
      if (live) setSessions(new Map(got.filter((session) => session !== null).map((session) => [session.id, session])));
    });
    return () => { live = false; };
  }, [rpc, sessionIds, shown]);

  const { skills, servers, hooks } = setup;
  return useMemo(() => {
    const items: FavoriteItem[] = [];
    for (const { kind, key } of all) {
      if (kind === "file") { const file = files.get(key); if (file) items.push({ kind, key, file }); }
      if (kind === "session") { const session = sessions.get(key); if (session) items.push({ kind, key, session }); }
      if (kind === "skill") { const skill = skills?.find((s) => s.id === key); if (skill) items.push({ kind, key, skill }); }
      if (kind === "mcp") { const server = servers?.find((s) => s.name === key); if (server) items.push({ kind, key, server }); }
      if (kind === "hook") {
        const at = hooks?.findIndex((h) => hookFavoriteKey(h) === key) ?? -1;
        if (at !== -1) items.push({ kind, key, hook: hooks![at]!, at });
      }
    }
    return items;
  }, [all, files, sessions, skills, servers, hooks]);
}
