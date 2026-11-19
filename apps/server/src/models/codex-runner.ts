import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { OfferedModel, RunnerProbe } from "@amc/contracts";
import { askCli, envWithout, findExecutable, runCli, type RunCli } from "./cli";
import { askCodex, keptFor } from "./offered";
import { lastLines, NOT_INSTALLED, PROBE_TIMEOUT_MS, RUN_TIMEOUT_MS, RunnerError, tokenCount, type CliRunnerDeps, type ModelRunner, type RunOutcome, type RunRequest, type RunSpend } from "./runner";

/** With either set, Codex bills that key instead of using the ChatGPT login. */
const BILLING_KEYS = ["OPENAI_API_KEY", "CODEX_API_KEY"];

/**
 * Everything Codex would otherwise offer the model, switched off. As measured on codex-cli 0.169.0
 * this is NOT "no tools": the model is still told about `exec`, `wait`, `request_user_input` and the
 * `collaboration` tools. With `code_mode_host` off, `exec` fails closed, and `run` below refuses any
 * answer that came with a tool call.
 */
const FEATURES_OFF = [
  "shell_tool", "unified_exec", "code_mode_host", "code_mode_host_grpc", "view_image", "apps", "plugins",
  "multi_agent", "multi_agent_v2", "hooks", "image_generation", "browser_use", "computer_use", "skill_search",
  "tool_suggest", "sleep_tool", "goals", "shell_snapshot", "memories",
];

/** Context Codex adds to every prompt, none of which a scan of someone's files should carry. */
const CONFIG = [
  'web_search="disabled"', 'model_reasoning_effort="low"', "project_doc_max_bytes=0", "skills.include_instructions=false",
  "include_permissions_instructions=false", "include_apps_instructions=false", "include_environment_context=false",
  "include_collaboration_mode_instructions=false",
];

/** Items in the `--json` stream that are the model speaking, or Codex reporting on itself. Anything
 *  else is a tool at work. */
const SPEECH_ITEMS = new Set(["agent_message", "reasoning", "error"]);

type CodexEvent = {
  type?: unknown;
  message?: unknown;
  item?: { type?: unknown; text?: unknown };
  usage?: { input_tokens?: unknown; output_tokens?: unknown };
  error?: { message?: unknown };
};

function eventsIn(stdout: string): CodexEvent[] {
  const events: CodexEvent[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.startsWith("{")) continue;
    try { events.push(JSON.parse(line) as CodexEvent); } catch { /* a line cut short by a kill */ }
  }
  return events;
}

/**
 * Runs the person's own `codex`, headless, on their ChatGPT login.
 *
 * - `--ephemeral` writes no rollout, so the app never indexes its own calls.
 * - `--ignore-user-config` and `--ignore-rules` keep the person's MCP servers and rules out.
 * - `model_instructions_file` replaces Codex's own 21,000-character instructions with the system text.
 * - The answer is the last `agent_message` of the event stream, so there is no `-o` file to read back.
 *
 * Codex reports tokens and no dollar cost.
 */
export class CodexCliRunner implements ModelRunner {
  readonly id = "codex" as const;
  private readonly runCli: RunCli;
  private readonly locate: () => string | null;
  private readonly env: NodeJS.ProcessEnv;

  /** `scratch` holds the schema and instruction files of a run in flight; it is not the cwd, which stays empty. */
  constructor(private readonly deps: CliRunnerDeps & { scratch: string }) {
    this.runCli = deps.runCli ?? runCli;
    this.env = envWithout(deps.env, BILLING_KEYS);
    this.locate = deps.locate ?? (() => deps.env.AMC_CODEX_BIN || findExecutable("codex", deps.env));
  }

  readonly offered: () => Promise<OfferedModel[] | null> = keptFor(async () => {
    const bin = this.locate();
    if (!bin) return null;
    mkdirSync(this.deps.cwd, { recursive: true });
    return askCodex({ askCli: this.deps.askCli ?? askCli, bin, cwd: this.deps.cwd, env: this.env, timeoutMs: PROBE_TIMEOUT_MS });
  });

  async probe(): Promise<RunnerProbe> {
    const bin = this.locate();
    if (!bin) return NOT_INSTALLED;
    const version = await this.runCli({ command: bin, args: ["--version"], env: this.env, timeoutMs: PROBE_TIMEOUT_MS });
    if (version.missing || version.code !== 0) return NOT_INSTALLED;
    // "Logged in using ChatGPT" or "Not logged in" (exit 1), on either stream. It names no plan, and
    // the plan is not looked up: it is only written inside the login's own token.
    const login = await this.runCli({ command: bin, args: ["login", "status"], env: this.env, timeoutMs: PROBE_TIMEOUT_MS });
    const said = `${login.stdout}\n${login.stderr}`;
    return {
      installed: true,
      version: version.stdout.trim() || null,
      signedIn: /not logged in/i.test(said) ? false : /logged in/i.test(said) ? true : null,
      plan: null,
    };
  }

  async run(request: RunRequest): Promise<RunOutcome> {
    const bin = this.locate();
    if (!bin) throw new RunnerError("missing", "`codex` is not installed");
    mkdirSync(this.deps.cwd, { recursive: true });
    mkdirSync(this.deps.scratch, { recursive: true });
    const files = mkdtempSync(join(this.deps.scratch, "codex-"));
    const started = Date.now();
    try {
      const schemaFile = join(files, "schema.json"), systemFile = join(files, "system.md");
      writeFileSync(schemaFile, JSON.stringify(request.schema));
      writeFileSync(systemFile, request.system);
      const exit = await this.runCli({
        command: bin,
        args: [
          "exec", "--ephemeral", "--skip-git-repo-check", "--sandbox", "read-only", "--ignore-user-config", "--ignore-rules",
          "--output-schema", schemaFile, "--json", "--color", "never", "-m", request.model,
          ...FEATURES_OFF.flatMap((feature) => ["--disable", feature]),
          ...[...CONFIG, `model_instructions_file=${JSON.stringify(systemFile)}`].flatMap((entry) => ["-c", entry]),
        ],
        cwd: this.deps.cwd, env: this.env, stdin: request.prompt, signal: request.signal, timeoutMs: RUN_TIMEOUT_MS,
      });
      if (exit.missing) throw new RunnerError("missing", "`codex` could not be started");
      if (exit.aborted) throw new RunnerError("aborted", "the call was stopped");
      if (exit.timedOut) throw new RunnerError("failed", `codex did not answer within ${RUN_TIMEOUT_MS / 1000}s`);
      return { ...answerIn(exit.stdout, exit.stderr, exit.code), durationMs: Date.now() - started };
    } finally {
      rmSync(files, { recursive: true, force: true });
    }
  }
}

function answerIn(stdout: string, stderr: string, code: number | null): RunSpend & { output: unknown } {
  const events = eventsIn(stdout);
  let answer: string | null = null, failure: string | null = null, tool: string | null = null;
  const spend: RunSpend = { inputTokens: 0, outputTokens: 0, costUsd: null };
  for (const event of events) {
    if (event.type === "item.completed" || event.type === "item.started") {
      const kind = String(event.item?.type);
      if (kind === "agent_message" && typeof event.item?.text === "string") answer = event.item.text;
      else if (!SPEECH_ITEMS.has(kind)) tool = kind;
    } else if (event.type === "turn.completed") {
      spend.inputTokens += tokenCount(event.usage?.input_tokens);
      spend.outputTokens += tokenCount(event.usage?.output_tokens);
    } else if (event.type === "turn.failed") {
      failure = typeof event.error?.message === "string" ? event.error.message : "the turn failed";
    }
  }
  const used = spend.inputTokens + spend.outputTokens > 0 ? spend : null;
  if (failure !== null) {
    // Signed out, Codex retries for half a minute and then fails the turn with the server's 401.
    if (/401|unauthorized|not logged in/i.test(failure)) throw new RunnerError("signed-out", "codex is not signed in: run `codex login`", used);
    throw new RunnerError("failed", failure, used);
  }
  if (events.length === 0) throw new RunnerError(code === 0 ? "invalid-output" : "failed", lastLines(stderr || stdout) || `codex exited with code ${code}`);
  if (tool !== null) throw new RunnerError("failed", `codex used a tool (${tool}); a model call here may only answer`, used);
  if (answer === null) throw new RunnerError("no-output", "codex finished without an answer", used);
  try { return { output: JSON.parse(answer) as unknown, ...spend }; }
  catch { throw new RunnerError("invalid-output", "codex answered with something other than JSON", used); }
}
