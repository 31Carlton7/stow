import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { tempDir } from "@amc/test-utils";
import type { RunnerId } from "@amc/contracts";
import { openDatabase, type Db } from "../db/database";
import { RpcError } from "../rpc/error";
import { ModelGate, type GateRequest } from "./gate";
import { recentCalls } from "./ledger";
import { codexEstimateUsd } from "./pricing";
import { NOT_INSTALLED, RunnerError, type ModelRunner, type RunOutcome, type RunRequest } from "./runner";

const NOON = new Date(2026, 10, 17, 12, 0, 0).getTime();
const HOUR = 3_600_000;

/** A runner that answers with what the test queued, and keeps what it was asked. */
class ScriptedRunner implements ModelRunner {
  asked: RunRequest[] = [];
  next: RunOutcome | Error = { output: { ok: true }, inputTokens: 1200, outputTokens: 60, costUsd: 0.0004, durationMs: 1500 };
  constructor(readonly id: RunnerId) {}
  async probe() { return NOT_INSTALLED; }
  async offered() { return null; }
  async run(request: RunRequest): Promise<RunOutcome> {
    this.asked.push(request);
    if (this.next instanceof Error) throw this.next;
    return this.next;
  }
}

let dir: string, db: Db, now: number, claude: ScriptedRunner, codex: ScriptedRunner, gate: ModelGate;
beforeEach(() => {
  dir = tempDir("amc-gate-");
  db = openDatabase(join(dir, "index.db"));
  now = NOON;
  claude = new ScriptedRunner("claude");
  codex = new ScriptedRunner("codex");
  gate = new ModelGate({ db, runners: { claude, codex }, now: () => now });
});
afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });

const scan = (over: Partial<GateRequest> = {}): GateRequest => ({
  runner: "claude", tier: "scan", purpose: "scan", sent: ["~/.claude/CLAUDE.md"],
  system: "You answer with JSON only.", prompt: "Is this file stale?", schema: { type: "object" }, ...over,
});
const refusal = (p: Promise<unknown>): Promise<RpcError> => p.then(() => { throw new Error("the call was expected to be refused"); }, (e: RpcError) => e);

describe("the settings", () => {
  it("start with every runner off, a cheap scan model and a one-dollar day", () => {
    expect(gate.settings("claude")).toEqual({ allowed: false, models: { scan: "claude-haiku-5-5", write: "claude-opus-5-5" } });
    expect(gate.settings("codex")).toEqual({ allowed: false, models: { scan: "gpt-6-luna", write: "gpt-6.1-sol" } });
    expect(gate.dailyCapUsd()).toBe(1);
  });

  it("keep what was set, per runner and per tier, for a gate opened later on the same index", () => {
    gate.setAllowed("codex", true);
    gate.setModel("claude", "write", "claude-opus-5-5");
    gate.setDailyCap(0.25);
    const later = new ModelGate({ db, runners: { claude, codex } });
    expect(later.settings("codex").allowed).toBe(true);
    expect(later.settings("claude")).toEqual({ allowed: false, models: { scan: "claude-haiku-5-5", write: "claude-opus-5-5" } });
    expect(later.dailyCapUsd()).toBe(0.25);
  });
});

describe("a refused call", () => {
  it("is one whose runner is off", async () => {
    const e = await refusal(gate.run(scan()));
    expect(e).toBeInstanceOf(RpcError);
    expect(e.code).toBe("MODELS_NOT_ALLOWED");
    expect(claude.asked).toEqual([]);
    expect(recentCalls(db, 10)).toMatchObject([{ runner: "claude", model: "claude-haiku-5-5", ok: false, error: "MODELS_NOT_ALLOWED", inputTokens: null, costUsd: null, apiEquivalentUsd: 0 }]);
  });

  it("is one made after today's spend reached the cap, until the day turns", async () => {
    gate.setAllowed("claude", true);
    gate.setDailyCap(0.001);
    claude.next = { output: {}, inputTokens: 9000, outputTokens: 100, costUsd: 0.001, durationMs: 900 };
    await gate.run(scan());
    expect((await refusal(gate.run(scan()))).code).toBe("MODELS_OVER_CAP");
    expect(claude.asked).toHaveLength(1);
    expect(recentCalls(db, 10).map((c) => c.error)).toEqual(["MODELS_OVER_CAP", null]);
    now = NOON + 13 * HOUR;
    expect(gate.spentTodayUsd()).toBe(0);
    await gate.run(scan());
    expect(claude.asked).toHaveLength(2);
  });

  it("is one whose prompt or system text holds a secret shape", async () => {
    gate.setAllowed("claude", true);
    const token = `ghp_${"a".repeat(36)}`;
    expect((await refusal(gate.run(scan({ prompt: `export GITHUB_TOKEN=${token}` })))).code).toBe("SECRET_IN_PROMPT");
    expect((await refusal(gate.run(scan({ system: `Use ${token}` })))).code).toBe("SECRET_IN_PROMPT");
    expect(claude.asked).toEqual([]);
    const [row] = recentCalls(db, 1);
    expect(row).toMatchObject({ ok: false, error: "SECRET_IN_PROMPT" });
    expect(JSON.stringify(row)).not.toContain(token);
  });

  it("counts a Codex call by its tokens, which report no cost", async () => {
    gate.setAllowed("codex", true);
    gate.setDailyCap(0.001);
    codex.next = { output: {}, inputTokens: 8000, outputTokens: 500, costUsd: null, durationMs: 4000 };
    await gate.run(scan({ runner: "codex" }));
    expect(codexEstimateUsd("gpt-6-luna", 8000, 500)).toBeCloseTo(0.00105);
    expect(gate.spentTodayUsd()).toBeCloseTo(0.00105);
    expect(recentCalls(db, 1)[0]).toMatchObject({ runner: "codex", costUsd: null });
    expect((await refusal(gate.run(scan({ runner: "codex" })))).code).toBe("MODELS_OVER_CAP");
  });

  it("prices a Codex model nobody listed at the dearest rate", () => {
    expect(codexEstimateUsd("gpt-7-unknown", 1_000_000, 0)).toBe(10);
  });
});

describe("a call that runs", () => {
  it("goes to the runner with the tier's model and what is left of the day, and comes back with the model named", async () => {
    gate.setAllowed("claude", true);
    gate.setModel("claude", "write", "claude-opus-5-5");
    const stop = new AbortController();
    const outcome = await gate.run(scan({ tier: "write", signal: stop.signal }));
    expect(outcome).toEqual({ output: { ok: true }, inputTokens: 1200, outputTokens: 60, costUsd: 0.0004, durationMs: 1500, model: "claude-opus-5-5" });
    expect(claude.asked).toEqual([{ system: "You answer with JSON only.", prompt: "Is this file stale?", schema: { type: "object" }, model: "claude-opus-5-5", maxCostUsd: 1, signal: stop.signal }]);
    await gate.run(scan());
    expect(claude.asked[1]!.maxCostUsd).toBeCloseTo(0.9996);
  });

  it("is written to the ledger with what was sent by label, never by body", async () => {
    gate.setAllowed("claude", true);
    await gate.run(scan({ prompt: "BODY-OF-THE-FILE" }));
    const [row] = recentCalls(db, 1);
    expect(row).toEqual({
      id: 1, ts: NOON, runner: "claude", model: "claude-haiku-5-5", tier: "scan", purpose: "scan", sent: ["~/.claude/CLAUDE.md"],
      promptChars: "You answer with JSON only.".length + "BODY-OF-THE-FILE".length,
      inputTokens: 1200, outputTokens: 60, costUsd: 0.0004, apiEquivalentUsd: 0.0004, durationMs: 1500, ok: true, error: null,
    });
    expect(JSON.stringify(db.prepare("SELECT * FROM model_calls").all())).not.toContain("BODY-OF-THE-FILE");
  });

  it("is written to the ledger when the runner fails, with the failure's code and what it used", async () => {
    gate.setAllowed("claude", true);
    claude.next = new RunnerError("no-output", "claude answered without the structured output", { inputTokens: 2294, outputTokens: 69, costUsd: 0.0003 });
    const e = await refusal(gate.run(scan()));
    expect(e).toMatchObject({ code: "MODELS_NO_OUTPUT", message: "claude answered without the structured output" });
    expect(recentCalls(db, 1)[0]).toMatchObject({ ok: false, error: "MODELS_NO_OUTPUT: claude answered without the structured output", inputTokens: 2294, costUsd: 0.0003 });
    expect(gate.spentTodayUsd()).toBe(0.0003);

    for (const [kind, code] of [["missing", "MODELS_CLI_MISSING"], ["signed-out", "MODELS_SIGNED_OUT"], ["invalid-output", "MODELS_INVALID_OUTPUT"], ["aborted", "MODELS_ABORTED"], ["failed", "MODELS_RUN_FAILED"]] as const) {
      claude.next = new RunnerError(kind, "why");
      expect((await refusal(gate.run(scan()))).code).toBe(code);
    }
    claude.next = new TypeError("boom");
    expect(await refusal(gate.run(scan()))).toMatchObject({ code: "MODELS_RUN_FAILED", message: "boom" });
    expect(recentCalls(db, 50)).toHaveLength(7);
  });

  it("lists the most recent calls first, as many as asked for", async () => {
    gate.setAllowed("claude", true);
    for (const purpose of ["first", "second", "third"]) { now += 1000; await gate.run(scan({ purpose })); }
    expect(recentCalls(db, 2).map((c) => c.purpose)).toEqual(["third", "second"]);
  });
});
