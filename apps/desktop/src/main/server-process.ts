import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { TOKEN_STDIN_ENV } from "@amc/contracts";

export type ServerInfo = { port: number; home: string };
export type ServerLine = { type: "ready"; port: number; home: string } | { type: "error"; message: string };

const READY_TIMEOUT_MS = 15_000;

/** Parse one stdout line from the server. Returns null for anything that isn't a ready/error announcement. */
export function parseServerLine(line: string): ServerLine | null {
  let msg: unknown;
  try { msg = JSON.parse(line); } catch { return null; }
  if (typeof msg !== "object" || msg === null) return null;
  const m = msg as Record<string, unknown>;
  if (m.type === "ready" && typeof m.port === "number" && typeof m.home === "string") return { type: "ready", port: m.port, home: m.home };
  if (m.type === "error") return { type: "error", message: typeof m.message === "string" ? m.message : "unknown error" };
  return null;
}

/** Accumulates stdout chunks and yields the first ready/error line seen; unrelated lines are skipped. */
export class ReadyLineParser {
  private buf = "";
  feed(chunk: string): ServerLine | null {
    this.buf += chunk;
    let nl: number;
    while ((nl = this.buf.indexOf("\n")) !== -1) {
      const line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + 1);
      const parsed = parseServerLine(line);
      if (parsed) return parsed;
    }
    return null;
  }
}

/**
 * Where the server's bundle lives. Dev: `apps/server/dist/main.js` (appPath is `apps/desktop`).
 * Packaged: `Resources/server/dist/main.js`, real files on disk and never inside the asar.
 */
export function resolveServerEntry(d: { override: string | undefined; packaged: boolean; appPath: string; resourcesPath: string }): string {
  if (d.override) return d.override;
  return d.packaged
    ? join(d.resourcesPath, "server", "dist", "main.js")
    : join(d.appPath, "..", "server", "dist", "main.js");
}

/**
 * Start the server as a child of this app and wait for its ready line.
 *
 * Electron's own binary IS a Node runtime under ELECTRON_RUN_AS_NODE, so the app depends on no system
 * node (a Finder launch has launchd's minimal PATH). The token is the first line of the child's
 * stdin, and the pipe is left open: the server exits when it closes, so it cannot outlive this app.
 */
export function startServer(d: { entry: string; token: string; env: Record<string, string> }): { child: ChildProcess; ready: Promise<ServerInfo> } {
  if (!existsSync(d.entry)) throw new Error(`server bundle not found at ${d.entry}: run \`pnpm build\``);
  const child = spawn(process.execPath, [d.entry], {
    env: { ...process.env, ...d.env, [TOKEN_STDIN_ENV]: "1", ELECTRON_RUN_AS_NODE: "1" },
    stdio: ["pipe", "pipe", "inherit"],
  });
  child.stdin!.on("error", () => { /* a server that died at once says so through `exit` */ });
  child.stdin!.write(`${d.token}\n`);
  const ready = new Promise<ServerInfo>((resolve, reject) => {
    const parser = new ReadyLineParser();
    const stdout = child.stdout!;
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stdout.off("data", onData);
      child.off("error", onError);
      child.off("exit", onExit);
      fn();
    };
    const onData = (chunk: Buffer | string) => {
      const line = parser.feed(chunk.toString());
      if (!line) return;
      if (line.type === "ready") finish(() => resolve({ port: line.port, home: line.home }));
      else finish(() => reject(new Error(`the server failed to start: ${line.message}`)));
    };
    const onError = (e: Error) => finish(() => reject(e));
    const onExit = (code: number | null) => finish(() => reject(new Error(`the server exited early with code ${code}`)));
    const timer = setTimeout(() => finish(() => reject(new Error(`the server did not report ready within ${READY_TIMEOUT_MS / 1000}s`))), READY_TIMEOUT_MS);
    stdout.on("data", onData);
    child.once("error", onError);
    child.once("exit", onExit);
  });
  return { child, ready };
}
