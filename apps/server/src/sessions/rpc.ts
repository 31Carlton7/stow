import type { Library } from "../library/library";
import type { RpcServer } from "../rpc/server";
import { contextOf } from "./context";
import type { SessionIndex } from "./index";
import { readStretch } from "./read";

export function registerSessions(rpc: RpcServer, d: { index: SessionIndex; home: string; library: Pick<Library, "inspect"> }): void {
  rpc.register("sessions.list", async ({ filter, limit, offset }) => d.index.list(filter, limit, offset));
  rpc.register("sessions.facets", async () => d.index.facets());
  rpc.register("sessions.status", async () => d.index.status());
  rpc.register("sessions.get", async ({ id }) => d.index.get(id));
  rpc.register("sessions.read", async ({ id, cursor, limit }) => {
    const { path, agent } = d.index.file(id);
    return readStretch(path, agent, cursor, limit);
  });
  rpc.register("sessions.context", async ({ id }) => contextOf(d.index.file(id), d));
}
