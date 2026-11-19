import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { tempDir } from "@amc/test-utils";
import { hookFavoriteKey } from "@amc/contracts";
import { buildFixtureHome } from "../../../../fixtures/home.mjs";
import { openDatabase } from "../db/database";
import { Library } from "../library/library";
import { TagStore } from "../library/tags";
import { RpcServer, tokenProtocol } from "../rpc/server";
import { SessionIndex } from "../sessions/index";
import { FavoriteStore } from "./favorites";
import { registerFavorites } from "./rpc";

const sessionIndex = (db: ReturnType<typeof openDatabase>, home: string): SessionIndex => new SessionIndex({
  db, home, whyWait: () => null,
  library: new Library({ home, backups: tempDir("amc-favorites-backups-"), tags: new TagStore(db), trash: async () => {} }),
});

describe("favourites", () => {
  it("keep a starred session through a rescan and a reopen of the index", async () => {
    const { home } = buildFixtureHome(tempDir("amc-favorites-"));
    const path = join(tempDir("amc-favorites-db-"), "index.db");
    const db = openDatabase(path);
    const index = sessionIndex(db, home);
    await index.look();
    const starred = index.list({}, 10, 0).sessions[1]!;
    new FavoriteStore(db).set("session", starred.id, true);
    await index.look();
    db.close();

    const again = openDatabase(path);
    expect(new FavoriteStore(again).list()).toMatchObject([{ kind: "session", key: starred.id }]);
    const reopened = sessionIndex(again, home);
    await reopened.look();
    expect(reopened.list({ favorites: true }, 10, 0)).toMatchObject({ matched: 1, sessions: [{ id: starred.id }] });
    again.close();
  });

  it("hold one row however many times a thing is starred, and none once it is unstarred", () => {
    const favorites = new FavoriteStore(openDatabase(":memory:"));
    favorites.set("skill", "s-release", true);
    const first = favorites.list();
    favorites.set("skill", "s-release", true);
    expect(favorites.list()).toEqual(first);
    // The same key under another kind is another thing.
    favorites.set("mcp", "s-release", true);
    expect(favorites.list().map((f) => f.kind).sort()).toEqual(["mcp", "skill"]);
    favorites.set("skill", "s-release", false);
    favorites.set("skill", "s-release", false);
    expect(favorites.list()).toMatchObject([{ kind: "mcp", key: "s-release" }]);
  });

  it("tell two hooks of one file apart by when they run and what they run", () => {
    const hook = { file: "~/.claude/settings.json", event: "Stop", matcher: null, command: "say done" };
    expect(hookFavoriteKey(hook)).toBe(hookFavoriteKey({ ...hook }));
    expect(hookFavoriteKey({ ...hook, event: "PostToolUse" })).not.toBe(hookFavoriteKey(hook));
    expect(hookFavoriteKey({ ...hook, command: "say finished" })).not.toBe(hookFavoriteKey(hook));
    expect(hookFavoriteKey({ ...hook, matcher: "Edit" })).not.toBe(hookFavoriteKey(hook));
  });
});

describe("favorites.set over the socket", () => {
  let server: RpcServer;
  afterEach(async () => { await server?.close(); });

  it("stars a known kind and refuses an unknown one", async () => {
    const favorites = new FavoriteStore(openDatabase(":memory:"));
    server = new RpcServer();
    registerFavorites(server, favorites);
    const port = await server.listen(0, { token: "t", allowedOrigins: [] });
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, [tokenProtocol("t")]);
    await new Promise((opened) => ws.once("open", opened));
    const ask = (id: string, params: object): Promise<unknown> => new Promise((answered) => {
      ws.once("message", (frame) => answered(JSON.parse(frame.toString())));
      ws.send(JSON.stringify({ id, method: "favorites.set", params }));
    });

    expect(await ask("1", { kind: "mcp", key: "search", on: true })).toMatchObject({ ok: true, result: { favorites: [{ kind: "mcp", key: "search" }] } });
    expect(await ask("2", { kind: "plugin", key: "search", on: true })).toMatchObject({ ok: false, error: { code: "INVALID_PARAMS" } });
    expect(favorites.list()).toHaveLength(1);
    ws.close();
  });
});
