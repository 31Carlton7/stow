import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { tempDir } from "@amc/test-utils";
import WebSocket from "ws";
import type { OfferedModel, RunnerId, RunnerProbe } from "@amc/contracts";
import { openDatabase, type Db } from "../db/database";
import { RpcServer, tokenProtocol } from "../rpc/server";
import { ModelGate } from "./gate";
import { registerModels } from "./rpc";
import type { ModelRunner, RunOutcome, RunRequest } from "./runner";

const token = "s3cret";
const SIGNED_IN: RunnerProbe = { installed: true, version: "2.1.322 (Claude Code)", signedIn: true, plan: "max" };
const ABSENT: RunnerProbe = { installed: false, version: null, signedIn: null, plan: null };

class ScriptedRunner implements ModelRunner {
  asked: RunRequest[] = [];
  output: unknown = { ok: true };
  constructor(readonly id: RunnerId, private readonly probed: RunnerProbe) {}
  async probe() { return this.probed; }
  offers: OfferedModel[] | null = null;
  async offered() { return this.offers; }
  async run(request: RunRequest): Promise<RunOutcome> {
    this.asked.push(request);
    return { output: this.output, inputTokens: 2294, outputTokens: 69, costUsd: this.id === "claude" ? 0.0004 : null, durationMs: 1500 };
  }
}

let dir: string, db: Db, server: RpcServer, ws: WebSocket, claude: ScriptedRunner, codex: ScriptedRunner, nextId = 0;
beforeEach(async () => {
  dir = tempDir("amc-models-rpc-");
  db = openDatabase(join(dir, "index.db"));
  claude = new ScriptedRunner("claude", SIGNED_IN);
  codex = new ScriptedRunner("codex", ABSENT);
  const runners = { claude, codex };
  server = new RpcServer();
  registerModels(server, { db, runners, gate: new ModelGate({ db, runners }) });
  const port = await server.listen(0, { token, allowedOrigins: [] });
  ws = await new Promise((res, rej) => {
    const dialled = new WebSocket(`ws://127.0.0.1:${port}`, [tokenProtocol(token)]);
    dialled.once("open", () => res(dialled));
    dialled.once("error", rej);
  });
});
afterEach(async () => { ws.close(); await server.close(); db.close(); rmSync(dir, { recursive: true, force: true }); });

type Answer = { ok: true; result: never } | { ok: false; error: { code: string; message: string } };
function call(method: string, params: object): Promise<Answer> {
  return new Promise((res) => {
    ws.once("message", (d) => res(JSON.parse(d.toString()) as Answer));
    ws.send(JSON.stringify({ id: String(++nextId), method, params }));
  });
}
const result = async <T>(method: string, params: object): Promise<T> => {
  const answer = await call(method, params);
  if (!answer.ok) throw new Error(`${method}: ${answer.error.code}`);
  return answer.result as T;
};

describe("the models methods", () => {
  it("list the models a runner's CLI offers, and nothing for one that would not say", async () => {
    claude.offers = [{ id: "claude-opus-5-5", label: "Opus 5.5" }, { id: "claude-haiku-5-5", label: "Haiku 5.5" }];
    expect(await result("models.offered", { runner: "claude" })).toEqual({ models: claude.offers });
    expect(await result("models.offered", { runner: "codex" })).toEqual({ models: null });
  });

  it("report each runner's probe and settings, today's spend and the cap", async () => {
    expect(await result("models.status", {})).toEqual({
      runners: [
        { runner: "claude", probe: SIGNED_IN, settings: { allowed: false, models: { scan: "claude-haiku-5-5", write: "claude-opus-5-5" } } },
        { runner: "codex", probe: ABSENT, settings: { allowed: false, models: { scan: "gpt-6-luna", write: "gpt-6.1-sol" } } },
      ],
      spentTodayUsd: 0, dailyCapUsd: 1,
    });
  });

  it("change the switch, a tier's model and the cap", async () => {
    expect(await result("models.setAllowed", { runner: "claude", allowed: true })).toMatchObject({ allowed: true });
    expect(await result("models.setModel", { runner: "codex", tier: "scan", model: "gpt-5.6-luna" })).toMatchObject({ models: { scan: "gpt-5.6-luna", write: "gpt-6.1-sol" } });
    expect(await result("models.setDailyCap", { usd: 0.5 })).toEqual({ dailyCapUsd: 0.5 });
    expect(await result("models.status", {})).toMatchObject({ dailyCapUsd: 0.5, runners: [{ settings: { allowed: true } }, { settings: { models: { scan: "gpt-5.6-luna" } } }] });
  });

  it("refuse a model id that would read as a flag, a negative cap and a runner nobody knows", async () => {
    expect(await call("models.setModel", { runner: "claude", tier: "scan", model: "--dangerously-skip-permissions" })).toMatchObject({ ok: false, error: { code: "INVALID_PARAMS" } });
    expect(await call("models.setDailyCap", { usd: -1 })).toMatchObject({ ok: false, error: { code: "INVALID_PARAMS" } });
    expect(await call("models.setAllowed", { runner: "ollama", allowed: true })).toMatchObject({ ok: false, error: { code: "INVALID_PARAMS" } });
  });

  it("refuse the test call while the runner is off, and show the refusal in the ledger", async () => {
    expect(await call("models.test", { runner: "claude" })).toMatchObject({ ok: false, error: { code: "MODELS_NOT_ALLOWED" } });
    expect(claude.asked).toEqual([]);
    expect(await result("models.ledger", {})).toMatchObject({ calls: [{ runner: "claude", purpose: "test", ok: false, error: "MODELS_NOT_ALLOWED" }] });
  });

  it("make one small call once the runner is on, sending nothing of the person's", async () => {
    await result("models.setAllowed", { runner: "claude", allowed: true });
    expect(await result("models.test", { runner: "claude" })).toEqual({
      model: "claude-haiku-5-5", output: { ok: true }, inputTokens: 2294, outputTokens: 69, costUsd: 0.0004, durationMs: 1500,
    });
    expect(claude.asked).toHaveLength(1);
    expect(claude.asked[0]!.schema).toEqual({ type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false });
    expect(await result("models.ledger", { limit: 1 })).toMatchObject({ calls: [{ purpose: "test", sent: [], tier: "scan", ok: true, costUsd: 0.0004 }] });
    expect(await result("models.status", {})).toMatchObject({ spentTodayUsd: 0.0004 });
  });

  it("fail the test call when the answer is not the one asked for", async () => {
    await result("models.setAllowed", { runner: "codex", allowed: true });
    codex.output = { ok: false };
    expect(await call("models.test", { runner: "codex" })).toMatchObject({ ok: false, error: { code: "MODELS_INVALID_OUTPUT" } });
  });
});
