import { mkdirSync } from "node:fs";
import type { OfferedModel, RunnerProbe } from "@amc/contracts";
import { askCli, envWithout, findExecutable, runCli, type RunCli } from "./cli";
import { askClaude, keptFor } from "./offered";
import { lastLines, NOT_INSTALLED, PROBE_TIMEOUT_MS, RUN_TIMEOUT_MS, RunnerError, tokenCount, type CliRunnerDeps, type ModelRunner, type RunOutcome, type RunRequest, type RunSpend } from "./runner";

/** With either set, Claude Code bills that key instead of using the plan login. */
const BILLING_KEYS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"];

/** The fields of `claude -p --output-format json` this file acts on. */
type ClaudeReport = {
  is_error?: unknown;
  subtype?: unknown;
  result?: unknown;
  structured_output?: unknown;
  total_cost_usd?: unknown;
  usage?: { input_tokens?: unknown; cache_creation_input_tokens?: unknown; cache_read_input_tokens?: unknown; output_tokens?: unknown };
  modelUsage?: Record<string, { inputTokens?: unknown; outputTokens?: unknown; cacheReadInputTokens?: unknown; cacheCreationInputTokens?: unknown }>;
};

/**
 * What the run used. `modelUsage` is the total the reported cost is computed from; the top-level
 * `usage` leaves out part of the input (6 against 1,180 on a recorded run), so it is only the
 * fallback. Cached input counts as input.
 */
function spendOf(report: ClaudeReport): RunSpend {
  const perModel = Object.values(report.modelUsage ?? {});
  const costUsd = typeof report.total_cost_usd === "number" ? report.total_cost_usd : null;
  if (perModel.length > 0) {
    return {
      inputTokens: perModel.reduce((sum, m) => sum + tokenCount(m.inputTokens) + tokenCount(m.cacheReadInputTokens) + tokenCount(m.cacheCreationInputTokens), 0),
      outputTokens: perModel.reduce((sum, m) => sum + tokenCount(m.outputTokens), 0),
      costUsd,
    };
  }
  const usage = report.usage ?? {};
  return {
    inputTokens: tokenCount(usage.input_tokens) + tokenCount(usage.cache_creation_input_tokens) + tokenCount(usage.cache_read_input_tokens),
    outputTokens: tokenCount(usage.output_tokens),
    costUsd,
  };
}

/**
 * Runs the person's own `claude`, headless, on their plan login.
 *
 * Each flag closes one way a run could do more than answer:
 * - `--tools ""` leaves the model nothing to call but the structured-output tool.
 * - `--setting-sources ""` keeps the person's settings out. Without it their plugins' SessionStart
 *   hooks ran on every call and added 13,000 tokens of their own context to the prompt.
 * - `--strict-mcp-config` and `--disable-slash-commands` keep MCP servers and skills out.
 * - `--no-session-persistence` writes no transcript, so the app never indexes its own calls.
 * - `--system-prompt` replaces Claude Code's own.
 *
 * Never `--bare`: it cannot use the plan login.
 */
export class ClaudeCliRunner implements ModelRunner {
  readonly id = "claude" as const;
  private readonly runCli: RunCli;
  private readonly locate: () => string | null;
  private readonly env: NodeJS.ProcessEnv;

  constructor(private readonly deps: CliRunnerDeps) {
    this.runCli = deps.runCli ?? runCli;
    this.env = envWithout(deps.env, BILLING_KEYS);
    this.locate = deps.locate ?? (() => deps.env.AMC_CLAUDE_BIN || findExecutable("claude", deps.env));
  }

  readonly offered: () => Promise<OfferedModel[] | null> = keptFor(async () => {
    const bin = this.locate();
    if (!bin) return null;
    mkdirSync(this.deps.cwd, { recursive: true });
    return askClaude({ askCli: this.deps.askCli ?? askCli, bin, cwd: this.deps.cwd, env: this.env, timeoutMs: PROBE_TIMEOUT_MS });
  });

  async probe(): Promise<RunnerProbe> {
    const bin = this.locate();
    if (!bin) return NOT_INSTALLED;
    const version = await this.runCli({ command: bin, args: ["--version"], env: this.env, timeoutMs: PROBE_TIMEOUT_MS });
    if (version.missing || version.code !== 0) return NOT_INSTALLED;
    // Signed out, the CLI prints `{"loggedIn": false, …}` and exits 1, so what it printed is read
    // whatever the exit status.
    const auth = await this.runCli({ command: bin, args: ["auth", "status", "--json"], env: this.env, timeoutMs: PROBE_TIMEOUT_MS });
    let status: { loggedIn?: unknown; subscriptionType?: unknown } = {};
    try { status = JSON.parse(auth.stdout) as typeof status; } catch { /* a CLI too old for the subcommand: unknown, not signed out */ }
    return {
      installed: true,
      version: version.stdout.trim() || null,
      signedIn: typeof status.loggedIn === "boolean" ? status.loggedIn : null,
      plan: typeof status.subscriptionType === "string" && status.subscriptionType ? status.subscriptionType : null,
    };
  }

  async run(request: RunRequest): Promise<RunOutcome> {
    const bin = this.locate();
    if (!bin) throw new RunnerError("missing", "`claude` is not installed");
    mkdirSync(this.deps.cwd, { recursive: true });
    const started = Date.now();
    const exit = await this.runCli({
      command: bin,
      args: [
        "-p", "--model", request.model, "--output-format", "json",
        "--json-schema", JSON.stringify(request.schema),
        "--system-prompt", request.system,
        "--tools", "", "--setting-sources", "", "--strict-mcp-config", "--disable-slash-commands", "--no-session-persistence",
        "--max-budget-usd", String(request.maxCostUsd),
      ],
      cwd: this.deps.cwd, env: this.env, stdin: request.prompt, signal: request.signal, timeoutMs: RUN_TIMEOUT_MS,
    });
    if (exit.missing) throw new RunnerError("missing", "`claude` could not be started");
    if (exit.aborted) throw new RunnerError("aborted", "the call was stopped");
    if (exit.timedOut) throw new RunnerError("failed", `claude did not answer within ${RUN_TIMEOUT_MS / 1000}s`);

    let report: ClaudeReport;
    try { report = JSON.parse(exit.stdout) as ClaudeReport; }
    catch { throw new RunnerError(exit.code === 0 ? "invalid-output" : "failed", lastLines(exit.stderr || exit.stdout) || `claude exited with code ${exit.code}`); }
    if (typeof report !== "object" || report === null) throw new RunnerError("invalid-output", "claude printed something other than its report");

    const spend = spendOf(report);
    const said = typeof report.result === "string" ? report.result : "";
    if (report.is_error === true) {
      if (/not logged in|\/login/i.test(said)) throw new RunnerError("signed-out", "claude is not signed in: run `claude auth login`", spend);
      throw new RunnerError("failed", said || String(report.subtype ?? "claude reported an error"), spend);
    }
    if (report.structured_output === undefined || report.structured_output === null) {
      throw new RunnerError("no-output", "claude answered without the structured output", spend);
    }
    return { output: report.structured_output, ...spend, durationMs: Date.now() - started };
  }
}
