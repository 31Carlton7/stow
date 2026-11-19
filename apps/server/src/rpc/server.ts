import { WebSocketServer, WebSocket } from "ws";
import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { z } from "zod";
import { Methods, parseWireMessage, type MethodName, type MethodResult, type RpcResponse } from "@amc/contracts";
import { RpcError } from "./error";

type Handler<M extends MethodName> = (params: z.output<(typeof Methods)[M]["params"]>) => Promise<MethodResult<M>>;

/**
 * Who is allowed onto the socket.
 *
 * The listener binds loopback, which is not a boundary: a WebSocket dial is not subject to CORS, so
 * without a token any page in any browser could open `ws://127.0.0.1:<port>` and call a method that
 * edits the person's files.
 *
 * `token` travels as the WebSocket subprotocol `amc.<token>`, the one channel both `ws` and the
 * renderer's browser `WebSocket` can set, since neither can add a header to a handshake.
 *
 * `allowedOrigins` is the second lock, for a token that leaked into a log or a screenshot. A browser
 * stamps `Origin` from the document and a page cannot forge it. Clients that send no Origin at all
 * (`ws` from Node) are judged on the token alone.
 */
export type ListenOptions = { token: string; allowedOrigins: readonly string[] };

export const tokenProtocol = (token: string): string => `amc.${token}`;

const sameSecret = (a: string, b: string): boolean => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** The handshake decision, pure over the two headers it reads: the protocol to echo back, or null to
 *  refuse the dial. */
export function acceptedProtocol(offer: { origin?: string; protocols: readonly string[] }, opts: ListenOptions): string | null {
  if (offer.origin !== undefined && !opts.allowedOrigins.includes(offer.origin)) return null;
  const expected = tokenProtocol(opts.token);
  return offer.protocols.some((p) => sameSecret(p, expected)) ? expected : null;
}

/** `Sec-WebSocket-Protocol` is a comma-separated list; `verifyClient` gets only the raw header. */
const offeredProtocols = (header: string | undefined): string[] =>
  header === undefined ? [] : header.split(",").map((p) => p.trim()).filter(Boolean);

export class RpcServer {
  private wss: WebSocketServer | null = null;
  private methods = new Map<string, (params: never) => Promise<unknown>>();
  private clients = new Set<WebSocket>();

  register<M extends MethodName>(name: M, handler: Handler<M>): void {
    this.methods.set(name, handler);
  }

  listen(port: number, opts: ListenOptions): Promise<number> {
    return new Promise((resolve, reject) => {
      // The check lives in `verifyClient` because `handleProtocols` is not called at all when the
      // client offers no subprotocol: a tokenless dial would sail straight past it.
      const wss = new WebSocketServer({
        port, host: "127.0.0.1",
        verifyClient: ({ req }: { req: IncomingMessage }) =>
          acceptedProtocol({ origin: req.headers.origin, protocols: offeredProtocols(req.headers["sec-websocket-protocol"]) }, opts) !== null,
        handleProtocols: () => tokenProtocol(opts.token),
      });
      this.wss = wss;
      wss.once("error", reject);
      wss.on("listening", () => {
        wss.on("error", (err) => process.stderr.write(`[server] ws error: ${err.message}\n`));
        const addr = wss.address();
        resolve(typeof addr === "object" && addr ? addr.port : port);
      });
      wss.on("connection", (ws) => this.attach(ws));
    });
  }

  private attach(ws: WebSocket): void {
    this.clients.add(ws);
    ws.on("close", () => this.clients.delete(ws));
    ws.on("error", (err) => process.stderr.write(`[server] client error: ${err.message}\n`));
    ws.on("message", (data) => void this.handle(ws, data.toString()));
  }

  async close(): Promise<void> {
    for (const c of this.clients) c.terminate();
    this.clients.clear();
    await new Promise<void>((res) => (this.wss ? this.wss.close(() => res()) : res()));
  }

  private async handle(ws: WebSocket, raw: string): Promise<void> {
    let id = "?";
    const send = (r: RpcResponse): void => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(r)); };
    try {
      const wire = parseWireMessage(raw);
      if (wire.kind !== "request") return;
      id = wire.msg.id;
      send({ id, ok: true, result: await this.dispatch(wire.msg.method, wire.msg.params) });
    } catch (e) {
      send({ id, ok: false, error: toRpcError(e) });
    }
  }

  private async dispatch(method: string, params: unknown): Promise<unknown> {
    const handler = this.methods.get(method);
    if (!handler) throw new RpcError("METHOD_NOT_FOUND", method);
    const parsed = Methods[method as MethodName].params.safeParse(params);
    if (!parsed.success) throw new RpcError("INVALID_PARAMS", parsed.error.message);
    return handler(parsed.data as never);
  }
}

/** Only RpcError codes cross the wire; everything else is INTERNAL. */
function toRpcError(e: unknown): { code: string; message: string } {
  if (e instanceof RpcError) return { code: e.code, message: e.message };
  const message = typeof e === "object" && e !== null && "message" in e ? String((e as { message: unknown }).message) : String(e);
  return { code: "INTERNAL", message };
}
