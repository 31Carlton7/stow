import type { RpcServer } from "../rpc/server";
import type { Health } from "./health";

export function registerHealth(rpc: RpcServer, health: Health): void {
  rpc.register("health.summary", async () => health.summary());
  rpc.register("health.status", async () => health.status());
}
