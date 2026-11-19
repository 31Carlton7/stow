import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { RpcServer, acceptedProtocol, tokenProtocol } from "./server";
import { RpcError } from "./error";

const token = "s3cret";
const opts = { token, allowedOrigins: ["file://"] };
const info = { version: "0.1.0", home: "/h", sourceHome: "/s", schemaVersion: 0 };

let server: RpcServer;
afterEach(async () => { await server?.close(); });

function dial(port: number, protocols: string[] = [tokenProtocol(token)]): Promise<WebSocket> {
  return new Promise((res, rej) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, protocols);
    ws.once("open", () => res(ws));
    ws.once("error", rej);
  });
}
function ask(ws: WebSocket, frame: object): Promise<unknown> {
  return new Promise((res) => {
    ws.once("message", (d) => res(JSON.parse(d.toString())));
    ws.send(JSON.stringify(frame));
  });
}

describe("the handshake", () => {
  it("decides on the two headers it reads", () => {
    const good = [tokenProtocol(token)];
    expect(acceptedProtocol({ protocols: good }, opts)).toBe(tokenProtocol(token));
    expect(acceptedProtocol({ origin: "file://", protocols: good }, opts)).toBe(tokenProtocol(token));
    // A page holding the token is still not the app's own window.
    expect(acceptedProtocol({ origin: "https://evil.com", protocols: good }, opts)).toBeNull();
    expect(acceptedProtocol({ protocols: [] }, opts)).toBeNull();
    expect(acceptedProtocol({ protocols: ["amc.wrong"] }, opts)).toBeNull();
    expect(acceptedProtocol({ protocols: [token] }, opts)).toBeNull();
  });

  it("accepts a dial carrying the token and refuses one without it", async () => {
    server = new RpcServer();
    const port = await server.listen(0, opts);
    const ws = await dial(port);
    expect(ws.protocol).toBe(tokenProtocol(token));
    ws.close();
    await expect(dial(port, [])).rejects.toThrow(/401|Unexpected server response/);
  });
});

describe("a call", () => {
  it("runs the registered handler and answers with its result", async () => {
    server = new RpcServer();
    server.register("system.info", async () => info);
    const ws = await dial(await server.listen(0, opts));
    expect(await ask(ws, { id: "1", method: "system.info", params: {} })).toEqual({ id: "1", ok: true, result: info });
    ws.close();
  });

  it("refuses a method nobody registered and params the schema rejects", async () => {
    server = new RpcServer();
    server.register("system.info", async () => info);
    const ws = await dial(await server.listen(0, opts));
    expect(await ask(ws, { id: "1", method: "nope", params: {} })).toMatchObject({ ok: false, error: { code: "METHOD_NOT_FOUND" } });
    expect(await ask(ws, { id: "2", method: "system.info", params: "x" })).toMatchObject({ ok: false, error: { code: "INVALID_PARAMS" } });
    ws.close();
  });

  it("carries an RpcError's code across the wire and hides every other error behind INTERNAL", async () => {
    server = new RpcServer();
    let fail: Error = new RpcError("NOT_FOUND", "gone");
    server.register("system.info", async () => { throw fail; });
    const ws = await dial(await server.listen(0, opts));
    expect(await ask(ws, { id: "1", method: "system.info", params: {} })).toEqual({ id: "1", ok: false, error: { code: "NOT_FOUND", message: "gone" } });
    fail = new TypeError("boom");
    expect(await ask(ws, { id: "2", method: "system.info", params: {} })).toEqual({ id: "2", ok: false, error: { code: "INTERNAL", message: "boom" } });
    ws.close();
  });
});
