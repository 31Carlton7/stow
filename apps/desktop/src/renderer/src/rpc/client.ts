import { parseWireMessage, type MethodName, type MethodParams, type MethodResult } from "@amc/contracts";

export class RpcError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = "RpcError"; }
}

/** What a failed call said, in the server's own words. */
export const said = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const WS_OPEN = 1;

/**
 * The window's line to its server: one socket at a time, dialled again when it has closed.
 *
 * The server is the app's own child and outlives any one socket. A Mac that sleeps, or a network that
 * changes, closes a loopback socket under a window that is still open, and the server is still there
 * with the same port and token. So a call made when there is no socket dials a new one first.
 *
 * A call that had been sent when its socket closed is rejected and not sent again: whether the
 * server acted on it is not known, and a write asked twice is worse than one refused.
 */
export class RpcClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private seq = 0;

  constructor(private url: string, private protocols: string[], private Impl: typeof WebSocket = WebSocket) {
    this.dial();
  }

  private dial(): WebSocket {
    const ws = new this.Impl(this.url, this.protocols);
    this.ws = ws;
    ws.onmessage = (e) => this.onMessage(String(e.data));
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      for (const call of this.pending.values()) call.reject(new RpcError("DISCONNECTED", "The connection to the app's server closed. Try again."));
      this.pending.clear();
    };
    return ws;
  }

  call<M extends MethodName>(method: M, params: MethodParams<M>): Promise<MethodResult<M>> {
    const id = String(++this.seq);
    const ws = this.ws ?? this.dial();
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      // Rejected while it waited for the socket to open: the close has already answered it.
      const send = () => { if (this.pending.has(id)) ws.send(JSON.stringify({ id, method, params })); };
      if (ws.readyState === WS_OPEN) send();
      else ws.addEventListener("open", send, { once: true });
    });
  }

  private onMessage(raw: string): void {
    let wire: ReturnType<typeof parseWireMessage>;
    try { wire = parseWireMessage(raw); }
    catch (e) { console.warn("[rpc] ignoring malformed frame", e); return; }
    if (wire.kind !== "response") return;
    const call = this.pending.get(wire.msg.id);
    if (!call) return;
    this.pending.delete(wire.msg.id);
    if (wire.msg.ok) call.resolve(wire.msg.result);
    else call.reject(new RpcError(wire.msg.error.code, wire.msg.error.message));
  }
}

let client: RpcClient | null = null;
export function rpc(): RpcClient {
  if (!client) {
    const bridge = window.amc;
    if (!bridge || !Number.isFinite(bridge.port) || !bridge.token) throw new Error("the app did not hand this window a server address");
    client = new RpcClient(`ws://127.0.0.1:${bridge.port}`, [`amc.${bridge.token}`]);
  }
  return client;
}

/** The window's server as a caller that never throws: a window with no server address rejects each
 *  call instead, so whoever asked can say so where the answer would have gone. */
export const server: Pick<RpcClient, "call"> = { call: async (method, params) => rpc().call(method, params) };
