import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

export type CliRun = {
  command: string;
  args: string[];
  cwd?: string;
  env: NodeJS.ProcessEnv;
  stdin?: string;
  signal?: AbortSignal;
  timeoutMs: number;
};

/** How one run of a CLI ended. `missing` is a binary that could not be started at all. */
export type CliExit = { code: number | null; stdout: string; stderr: string; missing: boolean; aborted: boolean; timedOut: boolean };

/** The one place a CLI is started. Runners take it as a dependency, so their tests replay recorded output. */
export type RunCli = (run: CliRun) => Promise<CliExit>;

export const runCli: RunCli = (run) =>
  new Promise((resolve) => {
    if (run.signal?.aborted) return resolve({ code: null, stdout: "", stderr: "", missing: false, aborted: true, timedOut: false });
    const child = spawn(run.command, run.args, { cwd: run.cwd, env: run.env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "", missing = false, aborted = false, timedOut = false;
    const abort = (): void => { aborted = true; child.kill("SIGTERM"); };
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); }, run.timeoutMs);
    run.signal?.addEventListener("abort", abort, { once: true });
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.stdin.on("error", () => { /* a child that exited before reading says so through `close` */ });
    child.stdin.end(run.stdin ?? "");
    const finish = (code: number | null): void => {
      clearTimeout(timer);
      run.signal?.removeEventListener("abort", abort);
      resolve({ code, stdout, stderr, missing, aborted, timedOut });
    };
    child.once("error", (e: NodeJS.ErrnoException) => { missing = e.code === "ENOENT" || e.code === "EACCES"; stderr += e.message; finish(null); });
    child.once("close", finish);
  });

export type CliAsk<T> = {
  command: string;
  args: string[];
  cwd?: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  /** The lines written to the CLI as it starts. */
  opening: string[];
  /** Given each line the CLI prints. It returns the answer, which ends the exchange, or writes more
   *  lines with `say` and returns nothing to go on listening. */
  onLine: (line: string, say: (line: string) => void) => T | undefined;
};

/**
 * A short exchange with a CLI that answers over its own stdin and stdout and would otherwise stay
 * running: lines in, lines out, and it is stopped once the answer is in hand. Null when it could not
 * be started, exited first, or took too long.
 */
export type AskCli = <T>(ask: CliAsk<T>) => Promise<T | null>;

export const askCli: AskCli = (ask) =>
  new Promise((resolve) => {
    const child = spawn(ask.command, ask.args, { cwd: ask.cwd, env: ask.env, stdio: ["pipe", "pipe", "ignore"] });
    let unread = "";
    let settled = false;
    const finish = (answer: Parameters<typeof resolve>[0]): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill("SIGTERM");
      resolve(answer);
    };
    const timer = setTimeout(() => finish(null), ask.timeoutMs);
    const say = (line: string): void => { child.stdin.write(`${line}\n`); };
    child.stdin.on("error", () => { /* a child that exited before reading says so through `close` */ });
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      unread += chunk;
      for (let end = unread.indexOf("\n"); end >= 0 && !settled; end = unread.indexOf("\n")) {
        const line = unread.slice(0, end);
        unread = unread.slice(end + 1);
        const answer = line.trim() === "" ? undefined : ask.onLine(line, say);
        if (answer !== undefined) finish(answer);
      }
    });
    child.once("error", () => finish(null));
    child.once("close", () => finish(null));
    for (const line of ask.opening) say(line);
  });

/** PATH's folders, then the ones the CLIs install into and a shell would have. */
function toolFolders(env: NodeJS.ProcessEnv): string[] {
  const home = env.HOME || homedir();
  const folders = [...(env.PATH ?? "").split(delimiter).filter(Boolean), join(home, ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin"];
  return [...new Set(folders)];
}

/**
 * The environment with those folders on its PATH. Finding a CLI past launchd's PATH is not enough
 * when the CLI is a script: it starts with `env node`, which looks for Node on the PATH it is given.
 */
export function withToolFolders(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...env, PATH: toolFolders(env).join(delimiter) };
}

/**
 * The full path of `name`, or null. PATH first, then the folders the CLIs install into: an app
 * opened from the Finder gets launchd's PATH, which has neither `~/.local/bin` nor Homebrew.
 */
export function findExecutable(name: string, env: NodeJS.ProcessEnv): string | null {
  const folders = toolFolders(env);
  for (const folder of folders) {
    const candidate = join(folder, name);
    try { accessSync(candidate, constants.X_OK); return candidate; } catch { /* not in this folder */ }
  }
  return null;
}

/** The environment a CLI runs under: the server's own, without the variables in `billingKeys`. */
export function envWithout(env: NodeJS.ProcessEnv, billingKeys: readonly string[]): NodeJS.ProcessEnv {
  const child = { ...env };
  for (const key of billingKeys) delete child[key];
  return child;
}
