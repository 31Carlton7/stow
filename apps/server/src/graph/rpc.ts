import type { RpcServer } from "../rpc/server";
import type { ConnectionGraph } from "./graph";

export function registerGraph(rpc: RpcServer, graph: ConnectionGraph): void {
  rpc.register("graph.get", async ({ around }) => graph.get(around));
  rpc.register("graph.neighbourhood", async ({ id }) => graph.neighbourhood(id));
}
