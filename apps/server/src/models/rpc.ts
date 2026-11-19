import { RUNNER_IDS, type RunnerId } from "@amc/contracts";
import { RpcError } from "../rpc/error";
import type { RpcServer } from "../rpc/server";
import type { ModelGate } from "./gate";
import { recentCalls } from "./ledger";
import type { Db } from "../db/database";
import type { ModelRunner } from "./runner";

export type ModelsDeps = { db: Db; gate: ModelGate; runners: Record<RunnerId, ModelRunner> };

const TEST_SCHEMA = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false };

export function registerModels(rpc: RpcServer, deps: ModelsDeps): void {
  const { db, gate, runners } = deps;

  rpc.register("models.status", async () => ({
    runners: await Promise.all(RUNNER_IDS.map(async (runner) => ({ runner, probe: await runners[runner].probe(), settings: gate.settings(runner) }))),
    spentTodayUsd: gate.spentTodayUsd(),
    dailyCapUsd: gate.dailyCapUsd(),
  }));

  rpc.register("models.setAllowed", async ({ runner, allowed }) => {
    gate.setAllowed(runner, allowed);
    return gate.settings(runner);
  });

  rpc.register("models.setModel", async ({ runner, tier, model }) => {
    gate.setModel(runner, tier, model);
    return gate.settings(runner);
  });

  rpc.register("models.offered", async ({ runner }) => ({ models: await runners[runner].offered() }));

  rpc.register("models.setDailyCap", async ({ usd }) => {
    gate.setDailyCap(usd);
    return { dailyCapUsd: gate.dailyCapUsd() };
  });

  rpc.register("models.test", async ({ runner }) => {
    const { output, model, inputTokens, outputTokens, costUsd, durationMs } = await gate.run({
      runner, tier: "scan", purpose: "test", sent: [],
      system: "You answer with JSON only.", prompt: "Reply with ok set to true.", schema: TEST_SCHEMA,
    });
    if (typeof output !== "object" || output === null || (output as { ok?: unknown }).ok !== true) {
      throw new RpcError("MODELS_INVALID_OUTPUT", `${runner} answered ${JSON.stringify(output)} where { "ok": true } was asked for`);
    }
    return { model, output: { ok: true as const }, inputTokens, outputTokens, costUsd, durationMs };
  });

  rpc.register("models.ledger", async ({ limit }) => ({ calls: recentCalls(db, limit) }));
}
