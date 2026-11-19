import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { tempDir } from "@amc/test-utils";
import { CodexCliRunner } from "./codex-runner";
import { argAfter, replay } from "./replay";
import type { CliExit, CliRun, RunCli } from "./cli";
import type { RunnerError } from "./runner";

// Recorded from codex-cli 0.169.0 on a ChatGPT login. The first item is printed on every run that has
// `code_mode_host` off, before the turn starts.
const CODE_MODE_NOTE = '{"type":"item.completed","item":{"id":"item_0","type":"error","message":"Code Mode is unavailable because code-mode host is disabled. Code mode will fail closed; enable `features.code_mode_host` and install `codex-code-mode-host`."}}';
const stream = (...lines: string[]): string => ['{"type":"thread.started","thread_id":"01a1ecbb-7c72-7550-9e6f-32e74a4bbba9"}', CODE_MODE_NOTE, '{"type":"turn.started"}', ...lines].join("\n") + "\n";
const ANSWER = '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"{\\"ok\\":true}"}}';
const USAGE = '{"type":"turn.completed","usage":{"input_tokens":4194,"cached_input_tokens":0,"cache_write_input_tokens":0,"output_tokens":63,"reasoning_output_tokens":0}}';
const UNAUTHORIZED = "unexpected status 401 Unauthorized: Missing bearer or basic authentication in header, url: https://api.openai.com/v1/responses, cf-ray: a5c3f21effeb4f1a-LAX";
const SIGNED_OUT = stream(
  `{"type":"error","message":"Reconnecting... 5/5 (${UNAUTHORIZED})"}`,
  `{"type":"error","message":"${UNAUTHORIZED}"}`,
  `{"type":"turn.failed","error":{"message":"${UNAUTHORIZED}"}}`,
);

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function runner(exits: Partial<CliExit>[], o: { env?: NodeJS.ProcessEnv; installed?: boolean; wrap?: (inner: RunCli) => RunCli } = {}) {
  const home = tempDir("amc-codex-");
  dirs.push(home);
  const cli = replay(exits);
  const cwd = join(home, "runner-cwd"), scratch = join(home, "runner-scratch");
  const codex = new CodexCliRunner({ cwd, scratch, env: o.env ?? {}, runCli: o.wrap ? o.wrap(cli.runCli) : cli.runCli, locate: () => (o.installed === false ? null : "/bin/codex") });
  return { ...cli, cwd, scratch, runner: codex };
}
const request = {
  system: "You answer with JSON only.", prompt: "Reply with ok set to true.", model: "gpt-6-luna", maxCostUsd: 0.5,
  schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false },
};
const failure = (p: Promise<unknown>): Promise<RunnerError> => p.then(() => { throw new Error("the run was expected to fail"); }, (e: RunnerError) => e);

describe("CodexCliRunner.probe", () => {
  it("reports the version and the sign-in, and no plan", async () => {
    const { runner: codex, started } = runner([{ stdout: "codex-cli 0.169.0\n" }, { stdout: "Logged in using ChatGPT\n" }]);
    expect(await codex.probe()).toEqual({ installed: true, version: "codex-cli 0.169.0", signedIn: true, plan: null });
    expect(started.map((s) => s.args)).toEqual([["--version"], ["login", "status"]]);
  });

  it("reads signed out from either stream, though the CLI exits 1", async () => {
    const { runner: codex } = runner([{ stdout: "codex-cli 0.169.0\n" }, { code: 1, stderr: "Not logged in\n" }]);
    expect(await codex.probe()).toMatchObject({ installed: true, signedIn: false });
  });

  it("calls the sign-in unknown when the CLI says neither, and reports no install without a binary", async () => {
    expect(await runner([{ stdout: "codex-cli 0.169.0\n" }, { code: 2, stderr: "error: unrecognized subcommand" }]).runner.probe()).toMatchObject({ installed: true, signedIn: null });
    expect(await runner([], { installed: false }).runner.probe()).toEqual({ installed: false, version: null, signedIn: null, plan: null });
  });
});

describe("CodexCliRunner.run", () => {
  it("returns the last agent message as JSON, with the tokens of the turn and no cost", async () => {
    const { runner: codex } = runner([{ stdout: stream(ANSWER, USAGE) }]);
    expect(await codex.run(request)).toMatchObject({ output: { ok: true }, inputTokens: 4194, outputTokens: 63, costUsd: null });
  });

  it("starts the CLI ephemeral and read-only, with the system text and the schema in files it removes afterwards", async () => {
    let schema = "", system = "";
    const { runner: codex, started, cwd, scratch } = runner([{ stdout: stream(ANSWER, USAGE) }], {
      wrap: (inner) => (run: CliRun) => {
        schema = readFileSync(argAfter(run, "--output-schema")!, "utf8");
        system = readFileSync(JSON.parse(run.args.find((a) => a.startsWith("model_instructions_file="))!.split("=")[1]!) as string, "utf8");
        return inner(run);
      },
    });
    await codex.run(request);
    const [run] = started;
    expect(run!.args.slice(0, 7)).toEqual(["exec", "--ephemeral", "--skip-git-repo-check", "--sandbox", "read-only", "--ignore-user-config", "--ignore-rules"]);
    expect(argAfter(run!, "-m")).toBe("gpt-6-luna");
    expect(run!.args).toContain("--json");
    for (const feature of ["shell_tool", "unified_exec", "code_mode_host", "apps", "plugins", "multi_agent", "hooks"]) {
      expect(run!.args.join(" ")).toContain(`--disable ${feature}`);
    }
    expect(run!.args).toContain('web_search="disabled"');
    expect(JSON.parse(schema)).toEqual(request.schema);
    expect(system).toBe("You answer with JSON only.");
    expect(run!.stdin).toBe("Reply with ok set to true.");
    expect(run!.cwd).toBe(cwd);
    expect(readdirSync(cwd)).toEqual([]);
    expect(existsSync(scratch) && readdirSync(scratch)).toEqual([]);
  });

  it("keeps an API key in the server's environment away from the CLI", async () => {
    const { runner: codex, started } = runner([{ stdout: stream(ANSWER, USAGE) }], { env: { PATH: "/usr/bin", OPENAI_API_KEY: "key", CODEX_API_KEY: "key", CODEX_HOME: "/somewhere" } });
    await codex.run(request);
    expect(started[0]!.env).toEqual({ PATH: "/usr/bin", CODEX_HOME: "/somewhere" });
  });

  it("fails as missing when there is no binary, or it will not start", async () => {
    expect((await failure(runner([], { installed: false }).runner.run(request))).kind).toBe("missing");
    expect((await failure(runner([{ missing: true, code: null }]).runner.run(request))).kind).toBe("missing");
  });

  it("fails as signed out when the turn failed on the server's 401", async () => {
    expect((await failure(runner([{ code: 1, stdout: SIGNED_OUT }]).runner.run(request))).kind).toBe("signed-out");
  });

  it("fails when the turn ended with no answer, and still says what it used", async () => {
    const e = await failure(runner([{ stdout: stream(USAGE) }]).runner.run(request));
    expect(e.kind).toBe("no-output");
    expect(e.spend).toEqual({ inputTokens: 4194, outputTokens: 63, costUsd: null });
  });

  it("fails on an answer that is not JSON, and on output that is no event stream", async () => {
    const prose = '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"Sure! ok is true."}}';
    expect((await failure(runner([{ stdout: stream(prose, USAGE) }]).runner.run(request))).kind).toBe("invalid-output");
    expect((await failure(runner([{ stdout: "Usage: codex exec [OPTIONS]\n" }]).runner.run(request))).kind).toBe("invalid-output");
    expect(await failure(runner([{ code: 2, stderr: "error: unexpected argument '--ephemeral' found\n" }]).runner.run(request))).toMatchObject({ kind: "failed", message: "error: unexpected argument '--ephemeral' found" });
  });

  it("refuses an answer that came with a tool call", async () => {
    const command = '{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"cat ~/.zshrc","aggregated_output":"","exit_code":0,"status":"completed"}}';
    const e = await failure(runner([{ stdout: stream(command, ANSWER.replace("item_1", "item_2"), USAGE) }]).runner.run(request));
    expect(e).toMatchObject({ kind: "failed", message: "codex used a tool (command_execution); a model call here may only answer" });
  });

  it("fails as aborted when the call was stopped, and removes its files", async () => {
    const { runner: codex, scratch } = runner([{ code: null, aborted: true }]);
    expect((await failure(codex.run(request))).kind).toBe("aborted");
    expect(readdirSync(scratch)).toEqual([]);
  });
});
