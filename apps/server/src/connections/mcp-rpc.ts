import type { ModelGate } from "../models/gate";
import type { RpcServer } from "../rpc/server";
import type { McpChanges } from "./mcp-changes";
import type { McpHealthChecks } from "./mcp-health";
import type { McpIcons } from "./mcp-icons";
import { suggestServer } from "./mcp-suggest";

export function registerMcp(rpc: RpcServer, d: { changes: McpChanges; health: McpHealthChecks; icons: McpIcons; gate: ModelGate }): void {
  rpc.register("mcp.preview", async ({ draft, placement }) => ({ steps: d.changes.preview(draft, placement) }));
  rpc.register("mcp.add", async ({ draft, placement }) => ({ outcomes: await d.changes.add(draft, placement) }));
  rpc.register("mcp.remove", async ({ name, agent, projectId }) => d.changes.remove(name, agent, projectId));
  rpc.register("mcp.health", async ({ check, name }) => d.health.report(check, name));
  rpc.register("mcp.signIn", async ({ name, agent }) => d.health.signIn(name, agent));
  rpc.register("mcp.suggest", async ({ ask, runner }) => suggestServer(d.gate, ask, runner));
  rpc.register("mcp.icon", async ({ name }) => ({ icon: await d.icons.iconFor(name) }));
}
