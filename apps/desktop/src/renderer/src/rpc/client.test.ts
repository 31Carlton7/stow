import { describe, expect, it } from "vitest";
import { RpcClient, RpcError } from "./client";

class FakeSocket {
  static last: FakeSocket;
  static dialled = 0;
  readyState = 0;
  sent: string[] = [];
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  private onceOpen: (() => void)[] = [];
  constructor(public url: string, public protocols: string[]) { FakeSocket.last = this; FakeSocket.dialled++; }
  addEventListener(_type: "open", listener: () => void) { this.onceOpen.push(listener); }
  send(frame: string) { this.sent.push(frame); }
  open() { this.readyState = 1; for (const listener of this.onceOpen.splice(0)) listener(); }
  close() { this.readyState = 3; this.onclose?.(); }
  answer(reply: object) { this.onmessage?.({ data: JSON.stringify(reply) }); }
}

const dial = () => {
  const client = new RpcClient("ws://127.0.0.1:1", ["amc.secret"], FakeSocket as unknown as typeof WebSocket);
  return { client, socket: FakeSocket.last };
};
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("RpcClient", () => {
  it("offers the token as its subprotocol", () => {
    expect(dial().socket.protocols).toEqual(["amc.secret"]);
  });

  it("holds a call made before the socket opens, then resolves it with the result", async () => {
    const { client, socket } = dial();
    const info = client.call("system.info", {});
    expect(socket.sent).toEqual([]);
    socket.open();
    await settle();
    expect(JSON.parse(socket.sent[0]!)).toEqual({ id: "1", method: "system.info", params: {} });
    socket.answer({ id: "1", ok: true, result: { version: "0.1.0" } });
    await expect(info).resolves.toEqual({ version: "0.1.0" });
  });

  it("rejects with the server's error code", async () => {
    const { client, socket } = dial();
    socket.open();
    const info = client.call("system.info", {});
    socket.answer({ id: "1", ok: false, error: { code: "INVALID_PARAMS", message: "no" } });
    await expect(info).rejects.toMatchObject({ code: "INVALID_PARAMS", message: "no" });
  });

  it("rejects what is in flight when the socket closes, and does not send it again", async () => {
    const { client, socket } = dial();
    socket.open();
    const inFlight = client.call("system.info", {});
    socket.close();
    await expect(inFlight).rejects.toBeInstanceOf(RpcError);
    await expect(inFlight).rejects.toMatchObject({ code: "DISCONNECTED" });
    expect(socket.sent).toHaveLength(1);
  });

  it("dials again for the next call after its socket has closed, with the same token", async () => {
    const { client, socket } = dial();
    socket.open();
    socket.close();
    const dialledBefore = FakeSocket.dialled;

    const info = client.call("system.info", {});
    const second = FakeSocket.last;
    expect(second).not.toBe(socket);
    expect(FakeSocket.dialled).toBe(dialledBefore + 1);
    expect(second.protocols).toEqual(["amc.secret"]);
    second.open();
    await settle();
    second.answer({ id: JSON.parse(second.sent[0]!).id, ok: true, result: { version: "0.1.0" } });
    await expect(info).resolves.toEqual({ version: "0.1.0" });
  });

  it("refuses a call whose dial the server does not answer, and dials afresh for the one after", async () => {
    const { client, socket } = dial();
    const first = client.call("system.info", {});
    socket.close();
    await expect(first).rejects.toMatchObject({ code: "DISCONNECTED" });
    expect(socket.sent).toEqual([]);

    const dialledBefore = FakeSocket.dialled;
    void client.call("system.info", {}).catch(() => {});
    expect(FakeSocket.dialled).toBe(dialledBefore + 1);
  });

  it("makes one dial for calls made together while there is no socket", () => {
    const { client, socket } = dial();
    socket.open();
    socket.close();
    const dialledBefore = FakeSocket.dialled;
    void client.call("system.info", {}).catch(() => {});
    void client.call("system.info", {}).catch(() => {});
    expect(FakeSocket.dialled).toBe(dialledBefore + 1);
  });
});
