import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { tempDir } from "@amc/test-utils";
import { ClaudeCliRunner } from "./claude-runner";
import { argAfter, replay } from "./replay";
import { RunnerError } from "./runner";
import type { CliExit } from "./cli";

// Recorded from claude 2.1.322 on a Max login, cut down to the fields the runner reads and a few it must ignore.
const SUCCESS = JSON.stringify({
  type: "result", subtype: "success", is_error: false, num_turns: 2, result: '{"ok":true}', structured_output: { ok: true },
  total_cost_usd: 0.00037569999999999997, duration_ms: 1567,
  usage: { input_tokens: 2, cache_creation_input_tokens: 1118, cache_read_input_tokens: 0, output_tokens: 52 },
  modelUsage: { "claude-haiku-5-5": { inputTokens: 1176, outputTokens: 69, cacheReadInputTokens: 0, cacheCreationInputTokens: 1118, costUSD: 0.00037569999999999997 } },
});
const SIGNED_OUT = JSON.stringify({
  type: "result", subtype: "success", is_error: true, num_turns: 1, result: "Not logged in · Please run /login", total_cost_usd: 0,
  usage: { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 }, modelUsage: {}, terminal_reason: "api_error",
});
const AUTH_IN = JSON.stringify({ loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", email: "someone@example.com", subscriptionType: "max" });
const AUTH_OUT = JSON.stringify({ loggedIn: false, authMethod: "none", apiProvider: "firstParty", loginExpiresAt: null });

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function runner(exits: Partial<CliExit>[], o: { env?: NodeJS.ProcessEnv; installed?: boolean } = {}) {
  const home = tempDir("amc-claude-");
  dirs.push(home);
  const cli = replay(exits);
  const cwd = join(home, "runner-cwd");
  return { ...cli, cwd, runner: new ClaudeCliRunner({ cwd, env: o.env ?? {}, runCli: cli.runCli, locate: () => (o.installed === false ? null : "/bin/claude") }) };
}
const request = { system: "You answer with JSON only.", prompt: "Reply with ok set to true.", schema: { type: "object" }, model: "claude-haiku-5-5", maxCostUsd: 0.5 };
const failure = (p: Promise<unknown>): Promise<RunnerError> => p.then(() => { throw new Error("the run was expected to fail"); }, (e: RunnerError) => e);

describe("ClaudeCliRunner.probe", () => {
  it("reports the version, the sign-in and the plan the CLI names", async () => {
    const { runner: claude, started } = runner([{ stdout: "2.1.322 (Claude Code)\n" }, { stdout: AUTH_IN }]);
    expect(await claude.probe()).toEqual({ installed: true, version: "2.1.322 (Claude Code)", signedIn: true, plan: "max" });
    expect(started.map((s) => s.args)).toEqual([["--version"], ["auth", "status", "--json"]]);
  });

  it("reads signed out from what the CLI printed, though it exits 1", async () => {
    const { runner: claude } = runner([{ stdout: "2.1.322 (Claude Code)\n" }, { code: 1, stdout: AUTH_OUT }]);
    expect(await claude.probe()).toEqual({ installed: true, version: "2.1.322 (Claude Code)", signedIn: false, plan: null });
  });

  it("calls the sign-in unknown when the CLI will not say", async () => {
    const { runner: claude } = runner([{ stdout: "1.0.0\n" }, { code: 1, stderr: "error: unknown command 'auth'" }]);
    expect(await claude.probe()).toMatchObject({ installed: true, signedIn: null, plan: null });
  });

  it("reports no install when there is no binary, or it will not start", async () => {
    const none = runner([], { installed: false });
    expect(await none.runner.probe()).toEqual({ installed: false, version: null, signedIn: null, plan: null });
    expect(none.started).toEqual([]);
    const broken = runner([{ missing: true, code: null }]);
    expect(await broken.runner.probe()).toMatchObject({ installed: false });
  });
});

describe("ClaudeCliRunner.run", () => {
  it("returns the structured output with the tokens and cost the CLI reported", async () => {
    const { runner: claude } = runner([{ stdout: SUCCESS }]);
    const outcome = await claude.run(request);
    expect(outcome).toMatchObject({ output: { ok: true }, inputTokens: 2294, outputTokens: 69, costUsd: 0.00037569999999999997 });
    expect(outcome.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("starts the CLI headless, with no tools, no settings and no transcript, in its own empty folder", async () => {
    const { runner: claude, started, cwd } = runner([{ stdout: SUCCESS }]);
    await claude.run(request);
    const [run] = started;
    expect(run!.args).toEqual([
      "-p", "--model", "claude-haiku-5-5", "--output-format", "json", "--json-schema", '{"type":"object"}',
      "--system-prompt", "You answer with JSON only.",
      "--tools", "", "--setting-sources", "", "--strict-mcp-config", "--disable-slash-commands", "--no-session-persistence",
      "--max-budget-usd", "0.5",
    ]);
    expect(run!.args).not.toContain("--bare");
    expect(run!.stdin).toBe("Reply with ok set to true.");
    expect(run!.cwd).toBe(cwd);
    expect(existsSync(cwd) && readdirSync(cwd)).toEqual([]);
  });

  it("keeps an API key in the server's environment away from the CLI", async () => {
    const { runner: claude, started } = runner([{ stdout: SUCCESS }, { stdout: "2.1.322\n" }, { stdout: AUTH_IN }], {
      env: { PATH: "/usr/bin", ANTHROPIC_API_KEY: "key", ANTHROPIC_AUTH_TOKEN: "token", CLAUDE_CONFIG_DIR: "/somewhere" },
    });
    await claude.run(request);
    await claude.probe();
    for (const run of started) expect(run.env).toEqual({ PATH: "/usr/bin", CLAUDE_CONFIG_DIR: "/somewhere" });
  });

  it("fails as missing when there is no binary, or it will not start", async () => {
    expect((await failure(runner([], { installed: false }).runner.run(request))).kind).toBe("missing");
    expect((await failure(runner([{ missing: true, code: null }]).runner.run(request))).kind).toBe("missing");
  });

  it("fails as signed out on the CLI's own words", async () => {
    const e = await failure(runner([{ code: 1, stdout: SIGNED_OUT }]).runner.run(request));
    expect(e).toBeInstanceOf(RunnerError);
    expect(e.kind).toBe("signed-out");
  });

  it("fails when the answer came without the structured output, and still says what it used", async () => {
    const { structured_output: _dropped, ...withoutOutput } = JSON.parse(SUCCESS) as Record<string, unknown>;
    const e = await failure(runner([{ stdout: JSON.stringify(withoutOutput) }]).runner.run(request));
    expect(e.kind).toBe("no-output");
    expect(e.spend).toEqual({ inputTokens: 2294, outputTokens: 69, costUsd: 0.00037569999999999997 });
  });

  it("fails on output that is not the CLI's report", async () => {
    expect((await failure(runner([{ stdout: "Welcome to Claude Code!\n" }]).runner.run(request))).kind).toBe("invalid-output");
    const crashed = await failure(runner([{ code: 1, stdout: "", stderr: "error: unknown option '--json-schema'\n" }]).runner.run(request));
    expect(crashed).toMatchObject({ kind: "failed", message: "error: unknown option '--json-schema'" });
  });

  it("fails with the CLI's reason when the run itself errored", async () => {
    const overBudget = JSON.stringify({ type: "result", subtype: "error_max_budget_usd", is_error: true, total_cost_usd: 0.5, modelUsage: {} });
    expect(await failure(runner([{ code: 1, stdout: overBudget }]).runner.run(request))).toMatchObject({ kind: "failed", message: "error_max_budget_usd" });
  });

  it("fails as aborted when the call was stopped, and as failed when it ran out of time", async () => {
    expect((await failure(runner([{ code: null, aborted: true }]).runner.run(request))).kind).toBe("aborted");
    expect(await failure(runner([{ code: null, timedOut: true }]).runner.run(request))).toMatchObject({ kind: "failed", message: "claude did not answer within 180s" });
  });

  it("hands the caller's signal to the CLI", async () => {
    const { runner: claude, started } = runner([{ stdout: SUCCESS }]);
    const stop = new AbortController();
    await claude.run({ ...request, signal: stop.signal });
    expect(started[0]!.signal).toBe(stop.signal);
    expect(argAfter(started[0]!, "--model")).toBe("claude-haiku-5-5");
  });
});
