/**
 * How a live check of the server alone starts it: the BUILT bundle on a scratch data folder, dialled
 * the way the app dials it (the token on stdin, then as the `amc.<token>` WebSocket subprotocol).
 *
 *   const server = await startLiveServer({ name: "models" });
 *   try { await server.result("models.status") } finally { await server.stop() }
 *
 * `call` answers with the wire reply, refusals included; `result` throws on a refusal.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const entry = fileURLToPath(new URL("../../dist/main.js", import.meta.url));

export async function startLiveServer({ name, sourceHome, env: extra = {} } = {}) {
  if (!fs.existsSync(entry)) throw new Error(`no built server at ${entry}: run \`pnpm --filter @amc/server build\``);
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `amc-${name}-live-`)));
  const token = randomBytes(24).toString("hex");

  // A check is often started from inside a Claude Code session, whose own variables would tell the
  // `claude` the server starts that it is a child of that session. The app is never started that way.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key === "CLAUDE_CONFIG_DIR" || !key.startsWith("CLAUDE")));
  const child = spawn(process.execPath, [entry], {
    env: { ...env, AMC_HOME: scratch, AMC_TOKEN_STDIN: "1", ...(sourceHome ? { AMC_SOURCE_HOME: sourceHome } : {}), ...extra },
    stdio: ["pipe", "pipe", "inherit"],
  });
  child.stdin.write(`${token}\n`);

  const port = await new Promise((resolve, reject) => {
    let head = "";
    const timer = setTimeout(() => reject(new Error("the server did not report ready within 15s")), 15_000);
    child.once("exit", (code) => reject(new Error(`the server exited early with code ${code}`)));
    child.stdout.on("data", (chunk) => {
      head += chunk.toString();
      for (const line of head.split("\n").slice(0, -1)) {
        let said;
        try { said = JSON.parse(line); } catch { continue; }
        if (said.type === "ready") { clearTimeout(timer); resolve(said.port); }
        if (said.type === "error") reject(new Error(`the server failed to start: ${said.message}`));
      }
    });
  });

  const ws = new WebSocket(`ws://127.0.0.1:${port}`, [`amc.${token}`]);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("the server refused the dial")), { once: true });
  });
  const waiting = new Map();
  ws.addEventListener("message", (event) => {
    const answer = JSON.parse(event.data);
    waiting.get(answer.id)?.(answer);
    waiting.delete(answer.id);
  });
  let nextId = 0;
  const call = (method, params = {}) =>
    new Promise((resolve) => {
      const id = String(++nextId);
      waiting.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  const result = async (method, params = {}) => {
    const answer = await call(method, params);
    if (!answer.ok) throw new Error(`${method} failed: ${answer.error.code}: ${answer.error.message}`);
    return answer.result;
  };
  const stop = async () => {
    ws.close();
    child.stdin.end();
    await new Promise((resolve) => { child.once("exit", resolve); setTimeout(() => { child.kill(); resolve(); }, 3_000); });
    fs.rmSync(scratch, { recursive: true, force: true });
  };
  return { scratch, call, result, stop };
}
