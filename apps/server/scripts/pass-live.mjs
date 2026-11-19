/**
 * Live check for the model pass (run with: pnpm --filter @amc/server build && node apps/server/scripts/pass-live.mjs)
 *
 * Boots the BUILT server on a scratch data folder, reading a fixture home with four planted problems,
 * and runs one real pass through your own `claude` login: two small calls on the cheap model and one
 * on the stronger one. It checks what no unit test can see, which is what a real model makes of the
 * prompt:
 *
 *   1. With the switch off the pass does not start.
 *   2. The pass makes the calls it said it would, and each is in the ledger.
 *   3. The planted problems come back as findings that survive the checks: a memory about a freeze
 *      that another memory says is over, an instruction file that shouts, and a memory naming a
 *      script and a path its project does not have.
 *   4. A stale memory's fix removes the file and its index line; a dated passage's fix is written by
 *      the stronger model, shown, and only then applied.
 *   5. No transcript is left behind.
 *
 * Nothing outside the fixture home and the scratch folder is read or written.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildFixtureHome } from "../../../fixtures/home.mjs";
import { checks } from "../../../fixtures/checks.mjs";
import { startLiveServer } from "./lib/live-server.mjs";

const { check, finish } = checks();
const at = buildFixtureHome(fs.mkdtempSync(path.join(os.tmpdir(), "amc-pass-home-")));

const fact = (name, description, body) => `---\nname: ${name}\ndescription: ${description}\nmetadata:\n  type: project\n---\n\n${body}\n`;
const plant = (file, text) => fs.writeFileSync(path.join(at.home, file), text);
const memory = path.relative(at.home, at.claudeMemory);
plant(`${memory}/beta-freeze.md`, fact("beta-freeze", "The beta freeze and what it blocks", "The beta freeze starts on Friday, June 5 2026. Until the beta ships, merge nothing risky into main."));
plant(`${memory}/beta-shipped.md`, fact("beta-shipped", "The beta is out", "The beta shipped on June 12 2026. The freeze is over and main is open again."));
plant(`${memory}/release-commands.md`, fact("release-commands", "What to run before a release", "Before a release run `pnpm test` and `pnpm verify:release`. The release notes template is at docs/release-template.md."));
fs.appendFileSync(path.join(at.claudeMemory, "MEMORY.md"), "- [beta-freeze](beta-freeze.md) — The beta freeze and what it blocks\n- [beta-shipped](beta-shipped.md) — The beta is out\n- [release-commands](release-commands.md) — What to run before a release\n");
plant("work/atlas/package.json", JSON.stringify({ scripts: { test: "vitest", build: "tsc" } }));
plant("work/atlas/CLAUDE.md", "# Atlas\n\nAtlas is the release tool. It is a pnpm workspace.\n\nCRITICAL: You MUST ALWAYS use pnpm. NEVER use npm!!!\n\nThink step by step before every change.\n\nRun the tests before you say a change works.\n");
// A fix leaves alone any file written in the last hour, so the fixture is made to look older than that.
const earlier = new Date(Date.now() - 3 * 60 * 60_000);
for (const entry of fs.readdirSync(at.home, { recursive: true, withFileTypes: true })) {
  if (entry.isFile()) fs.utimesSync(path.join(entry.parentPath, entry.name), earlier, earlier);
}

const server = await startLiveServer({ name: "pass", sourceHome: at.home });
const { call, result, scratch } = server;
try {
  const scope = await result("review.passScope");
  console.log(`     a pass would send ${scope.files} files (${scope.chars} characters) in ${scope.calls} calls; ${scope.withheld} held back`);

  const refused = await call("review.startPass", { runner: "claude" });
  check("the pass does not start while the switch is off", !refused.ok && refused.error.code === "MODELS_NOT_ALLOWED");

  await result("models.setAllowed", { runner: "claude", allowed: true });
  let status = await result("review.startPass", { runner: "claude" });
  for (const started = Date.now(); status.running && Date.now() - started < 240_000;) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    status = await result("review.passStatus");
  }
  console.log(`     pass: ${JSON.stringify(status)}`);
  check("the pass ran to its end", !status.running && status.error === null, status.error ?? "");
  check("it made the calls it said it would, and none failed", status.calls === scope.calls && status.callsDone === scope.calls && status.callsFailed === 0);

  const { calls } = await result("models.ledger", { limit: 20 });
  for (const c of calls) console.log(`     ledger #${c.id} ${c.model} ${c.tier}/${c.purpose} files=${c.sent.length} in=${c.inputTokens} out=${c.outputTokens} cost=${c.costUsd} took=${c.durationMs}ms ${c.ok ? "" : c.error}`);
  check("each call is in the ledger", calls.filter((c) => c.purpose === "scan" && c.ok).length === scope.calls);

  const judged = (await result("review.scan")).findings.filter((f) => f.judgedBy !== null);
  console.log("     the model's findings:");
  for (const f of judged) console.log(`       [${f.type}] ${f.title}\n         ${f.detail}\n         fix: ${f.fix ?? "none"}`);
  const about = (type, label) => judged.find((f) => f.type === type && f.subjects.some((s) => s.label === label));
  const stale = about("stale", "beta-freeze") ?? about("contradiction", "beta-freeze");
  const dated = judged.find((f) => f.type === "dated-prompt" && f.subjects.some((s) => s.displayPath === "~/work/atlas/CLAUDE.md"));
  const wrong = about("wrong-claim", "release-commands");
  check("it found the freeze that another memory says is over", stale !== undefined);
  check("it found the instruction file that shouts", dated !== undefined);
  check("it found the script and the path the project does not have", wrong !== undefined && wrong.detail.includes("verify:release") && wrong.detail.includes("docs/release-template.md"), wrong?.detail ?? "");
  check("it did not report the script the project does have", wrong === undefined || !/the script test\b/.test(wrong.detail));

  if (stale?.type === "stale") {
    await result("review.approve", { fingerprint: stale.fingerprint });
    check("approving the stale memory removed it", !fs.existsSync(path.join(at.claudeMemory, "beta-freeze.md")));
    check("and its line in the index", !fs.readFileSync(path.join(at.claudeMemory, "MEMORY.md"), "utf8").includes("beta-freeze"));
    check("the file went to the fixture's Trash", fs.existsSync(path.join(at.home, ".Trash", "beta-freeze.md")));
  }

  if (dated) {
    check("the rewrite is not applied before it is written", (await call("review.approve", { fingerprint: dated.fingerprint })).error?.code === "REVIEW_NOT_DRAFTED");
    const { changes } = await result("review.draft", { fingerprint: dated.fingerprint, runner: "claude" });
    console.log(`     the stronger model's rewrite of ${changes[0].displayPath}:\n${changes[0].after.split("\n").map((line) => `       | ${line}`).join("\n")}`);
    check("the rewrite keeps the facts and loses the shouting", /pnpm/.test(changes[0].after) && /tests/.test(changes[0].after) && !/CRITICAL|MUST ALWAYS|!!!/.test(changes[0].after));
    check("the file is untouched until it is approved", fs.readFileSync(path.join(at.atlas, "CLAUDE.md"), "utf8").includes("CRITICAL"));
    await result("review.approve", { fingerprint: dated.fingerprint });
    check("approving it replaces the file", fs.readFileSync(path.join(at.atlas, "CLAUDE.md"), "utf8") === changes[0].after);
    const backups = fs.readdirSync(path.join(scratch, "backups"), { recursive: true }).filter((p) => String(p).endsWith("work/atlas/CLAUDE.md"));
    check("behind a backup of what it was", backups.length === 1);
  }

  const spent = await result("models.status");
  console.log(`     counted against today's cap: $${spent.spentTodayUsd.toFixed(6)} of $${spent.dailyCapUsd.toFixed(2)}`);
  const claudeHome = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
  const transcript = path.join(claudeHome, "projects", path.join(scratch, "runner-cwd").replace(/[^A-Za-z0-9]/g, "-"));
  check("claude left no transcript for the runner's folder", !fs.existsSync(transcript), transcript);
} finally {
  await server.stop();
  fs.rmSync(at.home, { recursive: true, force: true });
}
finish();
