/**
 * Live check for the model runners (run with: pnpm --filter @amc/server build && node apps/server/scripts/models-live.mjs)
 *
 * Boots the BUILT server on a scratch data folder and makes exactly ONE small real call per runner,
 * on your own plan logins, to check what no unit test can see:
 *
 *   1. Each CLI says it is installed and signed in.
 *   2. With a runner's switch off, the test call is refused and nothing is run.
 *   3. With it on, the call comes back as `{ "ok": true }` with its tokens, and a cost where the CLI gives one.
 *   4. The ledger holds every attempt, the refused ones included.
 *   5. No transcript was left behind: nothing under ~/.claude/projects for the runner's folder, no new
 *      rollout under ~/.codex/sessions that names it, and the runner's own folders are empty.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checks } from "../../../fixtures/checks.mjs";
import { startLiveServer } from "./lib/live-server.mjs";

const RUNNERS = ["claude", "codex"];
const { check, finish } = checks();
const startedAt = Date.now();
const server = await startLiveServer({ name: "models" });
const { call, result, scratch } = server;
const runnerCwd = path.join(scratch, "runner-cwd");

/** Every file under `folder`, or none when it is not there. */
const filesUnder = (folder) => {
  try { return fs.readdirSync(folder, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => path.join(e.parentPath, e.name)); }
  catch { return []; }
};

try {
  const status = await result("models.status");
  for (const { runner, probe, settings } of status.runners) {
    console.log(`     ${runner}: ${JSON.stringify(probe)} scan=${settings.models.scan} write=${settings.models.write}`);
    check(`${runner} is installed and signed in`, probe.installed && probe.signedIn === true);
    check(`${runner} starts switched off`, settings.allowed === false);
  }
  check("the day starts unspent, under a $1.00 cap", status.spentTodayUsd === 0 && status.dailyCapUsd === 1);

  for (const runner of RUNNERS) {
    const refused = await call("models.test", { runner });
    check(`${runner}: the call is refused while its switch is off`, !refused.ok && refused.error.code === "MODELS_NOT_ALLOWED", refused.ok ? "it ran" : `${refused.error.code}: ${refused.error.message}`);
  }

  for (const runner of RUNNERS) {
    await result("models.setAllowed", { runner, allowed: true });
    const tested = await call("models.test", { runner });
    if (!tested.ok) { check(`${runner}: one real call answers { "ok": true }`, false, `${tested.error.code}: ${tested.error.message}`); continue; }
    const { model, output, inputTokens, outputTokens, costUsd, durationMs } = tested.result;
    check(`${runner}: one real call answers { "ok": true }`, output.ok === true, JSON.stringify(output));
    console.log(`     ${runner}: model=${model} in=${inputTokens} out=${outputTokens} cost=${costUsd === null ? "not reported" : `$${costUsd.toFixed(6)}`} took=${durationMs}ms`);
    check(`${runner}: the call reports its tokens`, inputTokens > 0 && outputTokens > 0);
  }

  const { calls } = await result("models.ledger", { limit: 10 });
  console.log("     ledger, newest first:");
  for (const c of calls) {
    console.log(`       #${c.id} ${c.runner} ${c.model} ${c.tier}/${c.purpose} sent=${JSON.stringify(c.sent)} chars=${c.promptChars} in=${c.inputTokens} out=${c.outputTokens} cost=${c.costUsd} counted=$${c.apiEquivalentUsd.toFixed(6)} ${c.durationMs}ms ${c.ok ? "ok" : c.error}`);
  }
  check("the ledger holds all four attempts", calls.length === 4, String(calls.length));
  check("two were refused and two ran", calls.filter((c) => c.error === "MODELS_NOT_ALLOWED").length === 2 && calls.filter((c) => c.ok).length === 2);
  const after = await result("models.status");
  console.log(`     counted against today's cap: $${after.spentTodayUsd.toFixed(6)} of $${after.dailyCapUsd.toFixed(2)}`);
  check("the calls count against the day", after.spentTodayUsd > 0);

  const claudeHome = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
  const claudeProject = path.join(claudeHome, "projects", runnerCwd.replace(/[^A-Za-z0-9]/g, "-"));
  check("claude left no transcript for the runner's folder", !fs.existsSync(claudeProject), claudeProject);
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  const rollouts = filesUnder(path.join(codexHome, "sessions"))
    .filter((file) => fs.statSync(file).mtimeMs >= startedAt)
    .filter((file) => fs.readFileSync(file, "utf8").includes(runnerCwd));
  check("codex left no rollout that names the runner's folder", rollouts.length === 0, rollouts.join(", "));
  check("the runner's folder is still empty", fs.existsSync(runnerCwd) && fs.readdirSync(runnerCwd).length === 0);
  check("no schema or instruction file is left over", filesUnder(path.join(scratch, "runner-scratch")).length === 0);
} finally {
  await server.stop();
}
finish();
