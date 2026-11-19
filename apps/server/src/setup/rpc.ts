import type { RpcServer } from "../rpc/server";
import type { Hooks } from "./hooks";
import type { McpServers } from "./mcp";
import type { Skills } from "./skills";

export function registerSetup(rpc: RpcServer, d: { skills: Skills; mcp: McpServers; hooks: Hooks }): void {
  rpc.register("setup.skills", async () => ({ skills: d.skills.list() }));
  rpc.register("setup.skill", async ({ id }) => d.skills.read(id));
  rpc.register("setup.mcp", async () => ({ servers: d.mcp.list() }));
  rpc.register("setup.hooks", async () => ({ hooks: d.hooks.list() }));
}
