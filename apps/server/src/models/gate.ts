import { z } from "zod";
import { ModelIdSchema, type ModelTier, type RunnerId, type RunnerSettings } from "@amc/contracts";
import type { Db } from "../db/database";
import { readSetting, writeSetting } from "../db/settings";
import { RpcError } from "../rpc/error";
import { recordCall, spentSince, type CallRecord } from "./ledger";
import { RunnerError, type ModelRunner, type RunFailure, type RunOutcome } from "./runner";
import { secretShapeIn } from "../secret-shapes";

const DEFAULT_DAILY_CAP_USD = 1;

const DEFAULT_MODELS: Record<RunnerId, Record<ModelTier, string>> = {
  claude: { scan: "claude-haiku-5-5", write: "claude-opus-5-5" },
  codex: { scan: "gpt-6-luna", write: "gpt-6.1-sol" },
};

const FAILURE_CODES: Record<RunFailure, string> = {
  "missing": "MODELS_CLI_MISSING",
  "signed-out": "MODELS_SIGNED_OUT",
  "no-output": "MODELS_NO_OUTPUT",
  "invalid-output": "MODELS_INVALID_OUTPUT",
  "aborted": "MODELS_ABORTED",
  "failed": "MODELS_RUN_FAILED",
};

export type GateRequest = {
  runner: RunnerId;
  tier: ModelTier;
  /** Why the call is made, for the ledger: "scan", "test". */
  purpose: string;
  /** Labels of what is being sent, such as file paths. Never the bodies. */
  sent: string[];
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  signal?: AbortSignal;
};

export type GateDeps = { db: Db; runners: Record<RunnerId, ModelRunner>; now?: () => number };

function localMidnight(now: number): number {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

/**
 * The policy in front of the runners. Nothing reaches a model except through `run`, which refuses a
 * runner the person has not allowed, a day already at its cap and a prompt carrying a secret, and
 * writes every attempt to the ledger whether it ran or not.
 */
export class ModelGate {
  private readonly db: Db;
  private readonly runners: Record<RunnerId, ModelRunner>;
  private readonly now: () => number;

  constructor(deps: GateDeps) {
    this.db = deps.db;
    this.runners = deps.runners;
    this.now = deps.now ?? Date.now;
  }

  settings(runner: RunnerId): RunnerSettings {
    const model = (tier: ModelTier): string => readSetting(this.db, `models.${runner}.model.${tier}`, ModelIdSchema, DEFAULT_MODELS[runner][tier]);
    return { allowed: readSetting(this.db, `models.${runner}.allowed`, z.boolean(), false), models: { scan: model("scan"), write: model("write") } };
  }

  setAllowed(runner: RunnerId, allowed: boolean): void { writeSetting(this.db, `models.${runner}.allowed`, allowed); }
  setModel(runner: RunnerId, tier: ModelTier, model: string): void { writeSetting(this.db, `models.${runner}.model.${tier}`, model); }

  dailyCapUsd(): number { return readSetting(this.db, "models.dailyCapUsd", z.number().min(0), DEFAULT_DAILY_CAP_USD); }
  setDailyCap(usd: number): void { writeSetting(this.db, "models.dailyCapUsd", usd); }

  spentTodayUsd(): number { return spentSince(this.db, localMidnight(this.now())); }

  async run(request: GateRequest): Promise<RunOutcome & { model: string }> {
    const settings = this.settings(request.runner);
    const model = settings.models[request.tier];
    const attempt: CallRecord = {
      ts: this.now(), runner: request.runner, model, tier: request.tier, purpose: request.purpose, sent: request.sent,
      promptChars: request.system.length + request.prompt.length,
      inputTokens: null, outputTokens: null, costUsd: null, durationMs: null, ok: false, error: null,
    };
    const refuse = (code: string, message: string): never => {
      recordCall(this.db, { ...attempt, error: code });
      throw new RpcError(code, message);
    };

    if (!settings.allowed) refuse("MODELS_NOT_ALLOWED", `${request.runner} is not allowed to make model calls: turn it on in Settings`);
    const cap = this.dailyCapUsd(), spent = this.spentTodayUsd();
    if (spent >= cap) refuse("MODELS_OVER_CAP", `today's model calls have reached the daily cap of $${cap.toFixed(2)}`);
    const secret = secretShapeIn(request.system) ?? secretShapeIn(request.prompt);
    if (secret) refuse("SECRET_IN_PROMPT", `the prompt holds what looks like ${secret}, so it was not sent`);

    try {
      const outcome = await this.runners[request.runner].run({
        system: request.system, prompt: request.prompt, schema: request.schema, model, maxCostUsd: cap - spent, signal: request.signal,
      });
      recordCall(this.db, {
        ...attempt, inputTokens: outcome.inputTokens, outputTokens: outcome.outputTokens, costUsd: outcome.costUsd, durationMs: outcome.durationMs, ok: true,
      });
      return { ...outcome, model };
    } catch (e) {
      const failure = e instanceof RunnerError ? e : new RunnerError("failed", e instanceof Error ? e.message : String(e));
      recordCall(this.db, {
        ...attempt, inputTokens: failure.spend?.inputTokens ?? null, outputTokens: failure.spend?.outputTokens ?? null, costUsd: failure.spend?.costUsd ?? null,
        durationMs: this.now() - attempt.ts, error: `${FAILURE_CODES[failure.kind]}: ${failure.message}`,
      });
      throw new RpcError(FAILURE_CODES[failure.kind], failure.message);
    }
  }
}
