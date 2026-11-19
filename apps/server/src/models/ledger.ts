import type { ModelCall, ModelTier, RunnerId } from "@amc/contracts";
import type { Db } from "../db/database";
import { codexEstimateUsd } from "./pricing";

export type CallRecord = {
  ts: number;
  runner: RunnerId;
  model: string;
  tier: ModelTier;
  purpose: string;
  sent: string[];
  promptChars: number;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  durationMs: number | null;
  ok: boolean;
  error: string | null;
};

type CallRow = {
  id: number; ts: number; runner: RunnerId; model: string; tier: ModelTier; purpose: string; sent_json: string; prompt_chars: number;
  input_tokens: number | null; output_tokens: number | null; cost_usd: number | null; duration_ms: number | null; ok: number; error: string | null;
};

export function recordCall(db: Db, call: CallRecord): void {
  db.prepare(
    `INSERT INTO model_calls (ts, runner, model, tier, purpose, sent_json, prompt_chars, input_tokens, output_tokens, cost_usd, duration_ms, ok, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    call.ts, call.runner, call.model, call.tier, call.purpose, JSON.stringify(call.sent), call.promptChars,
    call.inputTokens, call.outputTokens, call.costUsd, call.durationMs, call.ok ? 1 : 0, call.error,
  );
}

/** What a call counts against the cap: the cost its CLI reported, or an estimate from its tokens. */
function apiEquivalentUsd(row: CallRow): number {
  if (row.cost_usd !== null) return row.cost_usd;
  if (row.runner !== "codex") return 0;
  return codexEstimateUsd(row.model, row.input_tokens ?? 0, row.output_tokens ?? 0);
}

const toCall = (row: CallRow): ModelCall => ({
  id: row.id, ts: row.ts, runner: row.runner, model: row.model, tier: row.tier, purpose: row.purpose,
  sent: JSON.parse(row.sent_json) as string[], promptChars: row.prompt_chars,
  inputTokens: row.input_tokens, outputTokens: row.output_tokens, costUsd: row.cost_usd, apiEquivalentUsd: apiEquivalentUsd(row),
  durationMs: row.duration_ms, ok: row.ok === 1, error: row.error,
});

export function recentCalls(db: Db, limit: number): ModelCall[] {
  return (db.prepare("SELECT * FROM model_calls ORDER BY id DESC LIMIT ?").all(limit) as CallRow[]).map(toCall);
}

/** API-equivalent dollars of every call recorded at or after `since`, failed ones included: a run that
 *  ended without an answer still used its tokens. */
export function spentSince(db: Db, since: number): number {
  const rows = db.prepare("SELECT * FROM model_calls WHERE ts >= ? AND (cost_usd IS NOT NULL OR input_tokens IS NOT NULL)").all(since) as CallRow[];
  return rows.reduce((sum, row) => sum + apiEquivalentUsd(row), 0);
}
