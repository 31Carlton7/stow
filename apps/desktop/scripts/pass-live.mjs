/**
 * Live check for a model's reading, from the window (run with: pnpm build && node apps/desktop/scripts/pass-live.mjs)
 *
 * Boots the BUILT app on a scratch data folder, reading a fixture home with planted problems, and
 * does in the real window what a person would: turns Claude on, tests it, has it read the library,
 * has the stronger model write one fix, approves it and undoes it. This makes FOUR small real calls
 * through your own `claude` login (one test, two readings, one rewrite), all of fixture text.
 *
 *   1. Nothing can be read while the runner is off; turning it on is the only thing that changes that.
 *   2. The test call answers, and the reading runs to its end with its progress on screen.
 *   3. What the model found is marked as a model's reading, and a fix it has to write is not
 *      approvable until it has been written and shown.
 *   4. Approving the rewrite changes the file on disk; Undo puts it back.
 *   5. Every call is in the ledger, under Activity in Settings.
 *
 * Nothing outside the fixture home and the scratch folder is read or written.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildFixtureHome } from "../../../fixtures/home.mjs";
import { checks, launchLiveApp, until, windowTools } from "./lib/live-app.mjs";

const outDir = process.env.LIVE_DIR ?? path.join(os.tmpdir(), "amc-live", "pass");
const at = buildFixtureHome(fs.mkdtempSync(path.join(os.tmpdir(), "amc-pass-ui-home-")));

const fact = (name, description, body) => `---\nname: ${name}\ndescription: ${description}\nmetadata:\n  type: project\n---\n\n${body}\n`;
const plant = (file, text) => fs.writeFileSync(path.join(at.home, file), text);
const memory = path.relative(at.home, at.claudeMemory);
plant(`${memory}/beta-freeze.md`, fact("beta-freeze", "The beta freeze and what it blocks", "The beta freeze starts on Friday, June 5 2026. Until the beta ships, merge nothing risky into main."));
plant(`${memory}/beta-shipped.md`, fact("beta-shipped", "The beta is out", "The beta shipped on June 12 2026. The freeze is over and main is open again."));
plant(`${memory}/release-commands.md`, fact("release-commands", "What to run before a release", "Before a release run `pnpm test` and `pnpm verify:release`. The release notes template is at docs/release-template.md."));
fs.appendFileSync(path.join(at.claudeMemory, "MEMORY.md"), "- [beta-freeze](beta-freeze.md) — The beta freeze and what it blocks\n- [beta-shipped](beta-shipped.md) — The beta is out\n- [release-commands](release-commands.md) — What to run before a release\n");
plant("work/atlas/package.json", JSON.stringify({ scripts: { test: "vitest", build: "tsc" } }));
const instructions = path.join(at.atlas, "CLAUDE.md");
fs.writeFileSync(instructions, "# Atlas\n\nAtlas is the release tool. It is a pnpm workspace.\n\nCRITICAL: You MUST ALWAYS use pnpm. NEVER use npm!!!\n\nThink step by step before every change.\n\nRun the tests before you say a change works.\n");
// A fix leaves alone any file written in the last hour, so the fixture is made to look older than that.
const earlier = new Date(Date.now() - 3 * 60 * 60_000);
for (const entry of fs.readdirSync(at.home, { recursive: true, withFileTypes: true })) {
  if (entry.isFile() && !entry.parentPath.includes(`${path.sep}.git`)) fs.utimesSync(path.join(entry.parentPath, entry.name), earlier, earlier);
}

const { check, finish } = checks();

const app = await launchLiveApp({ name: "pass", sourceHome: at.home });
const { page } = app;
const { text, texts, has, click, noticesGone, shots: picture } = windowTools(app, outDir);
const shots = async (name) => { await noticesGone(); await picture(name); };

try {
  await until(() => page.eval(`document.querySelector(".dest-count") !== null`), 15_000, "the first scan");
  await click(".dest .lib-nav-row", "Review");
  await until(() => page.eval(`document.querySelector(".rev-reading") !== null`), 8_000, "the reading strip");
  check("with the runner off, a reading can only be turned on, not started", (await texts(".rev-reading .btn")).join("|") === "Open Models");

  await click(".rev-reading .btn", "Open Models");
  await until(() => page.eval(`document.querySelectorAll(".models-card").length === 2`), 15_000, "the two runners");
  await page.eval(`document.querySelector('.models-card[aria-label="Claude"] .switch').click()`);
  await until(() => page.eval(`document.querySelector('.models-card[aria-label="Claude"] .switch').checked`), 5_000, "Claude switched on");
  check("only the runner switched on is on", (await page.eval(`document.querySelector('.models-card[aria-label="Codex"] .switch').checked`)) === false);
  await click('.models-card[aria-label="Claude"] .models-test .btn', "Test");
  await until(() => has('.models-card[aria-label="Claude"] .models-test .models-line', "answered in"), 120_000, "the test call's answer");
  console.log(`     ${await text('.models-card[aria-label="Claude"] .models-test .models-line')}`);
  check("the test call answered", true);

  await click(".dest .lib-nav-row", "Review");
  await until(() => has(".rev-reading .btn", "Read now"), 8_000, "the offer to read");
  const offer = await text(".rev-reading-line");
  check("the strip says what a reading sends and to which model before it is started", /^A reading sends \d+ files in \d+ calls?, about [\d,]+ tokens, to claude-haiku-5-5\.$/.test(offer), offer);
  await shots("pass-offer");
  await click(".rev-reading .btn", "Read now");
  await until(() => has(".rev-reading-title", "Reading with claude-haiku-5-5"), 10_000, "the reading's progress");
  check("a reading under way says how far it is and can be stopped", (await texts(".rev-reading .btn")).join("|") === "Stop", await text(".rev-reading-line"));
  await until(() => has(".rev-reading-title", "Last reading"), 300_000, "the reading's end");
  const last = (await texts(".rev-reading-line")).join(" ");
  check("the reading ran to its end and says what it cost", /^\d+ found/.test(last) && !last.includes("stopped early"), last);

  await until(() => page.eval(`document.querySelectorAll(".rev-row-model").length > 0`), 10_000, "the model's findings in the list");
  const judged = await page.eval(`[...document.querySelectorAll(".rev-row")].filter((r) => r.querySelector(".rev-row-model")).map((r) => r.querySelector(".rev-row-kind").firstChild.textContent + " | " + r.querySelector(".rev-row-title").textContent)`);
  for (const row of judged) console.log(`     ${row}`);
  check("what the model found is marked as a model's reading", judged.length > 0);
  await shots("pass-findings");

  const stale = (await has(".rev-row", "May be out of date")) ? "May be out of date" : "Two memories disagree";
  await click(".rev-row", stale);
  await until(() => page.eval(`document.querySelector(".rev-detail .lib-reader-note") !== null`), 5_000, "the note that this is a reading");
  check("a model's finding says whose reading it is", (await text(".rev-detail .lib-reader-note")).includes("claude-haiku-5-5's reading, not a rule"));
  await shots("pass-stale");

  if (await has(".rev-row", "Names something the project lacks")) {
    await click(".rev-row", "Names something the project lacks");
    await until(() => has(".rev-detail .rev-kind", "Names something the project lacks"), 5_000, "the wrong claim");
    const claim = await text(".rev-detail .lib-reader-desc");
    check("the claim the project does not bear out names what is missing", claim.includes("verify:release") && claim.includes("docs/release-template.md"), claim);
    await shots("pass-wrong-claim");
  } else check("the model reported the script and the path the project lacks", false);

  await click(".rev-row", "Written for an older model");
  await until(() => has(".lib-reader-bar .btn", "Write the fix with claude-opus-5-5"), 5_000, "the offer to write the fix");
  check("a fix that has to be written offers no Approve first", !(await has(".lib-reader-bar .btn", "Approve")));
  await click(".lib-reader-bar .btn", "Write the fix with");
  await until(() => page.eval(`document.querySelector(".fd-line[data-kind=add]") !== null`), 240_000, "the rewrite, as a diff");
  check("the rewrite is shown before it is applied, and the file is untouched", fs.readFileSync(instructions, "utf8").includes("CRITICAL") && (await has(".lib-reader-bar .btn", "Approve")));
  const added = (await texts(".fd-line[data-kind=add] .fd-text")).join("\n");
  check("the rewrite keeps pnpm and loses the shouting", /pnpm/.test(added) && !/CRITICAL|MUST ALWAYS|!!!/.test(added), added.replaceAll("\n", " / "));
  await shots("pass-rewrite");

  await click(".lib-reader-bar .btn.primary", "Approve");
  await until(async () => !fs.readFileSync(instructions, "utf8").includes("CRITICAL"), 10_000, "the file rewritten");
  check("approving it rewrote the file", true);
  await click(".lib-nav-row", "Applied fixes");
  await until(() => page.eval(`document.querySelectorAll(".rev-applied").length === 1`), 8_000, "the applied fix");
  await click(".rev-applied .btn", "Undo");
  await until(async () => fs.readFileSync(instructions, "utf8").includes("CRITICAL"), 10_000, "the file put back");
  check("undo put the file back as it was", true);

  // Settings is still on the page Review opened it at, and reads again when it is come back to.
  await click(".dest .lib-nav-row", "Settings");
  await until(() => page.eval(`document.querySelector(".models-limit") !== null`), 15_000, "the daily limit");
  const used = (await texts(".models-limit .models-line")).join(" ");
  await click('nav[aria-label="Settings"] .lib-nav-row', "Activity");
  // The test call's row is there from before.
  await until(() => page.eval(`[...document.querySelectorAll(".models-table")].at(-1)?.querySelectorAll("tbody tr").length >= 4`), 15_000, "the ledger with the reading's calls");
  const ledger = await page.eval(`[...document.querySelectorAll(".models-table")].at(-1).innerText`);
  const rows = await page.eval(`[...[...document.querySelectorAll(".models-table")].at(-1).querySelectorAll("tbody tr")].map((tr) => [...tr.children].map((td) => td.textContent).join(" | "))`);
  for (const row of rows) console.log(`     ${row}`);
  check("every call is in the ledger: a test, the readings and the rewrite", rows.length >= 4 && rows.every((row) => row.endsWith("Answered")) && ledger.includes("claude-opus-5-5") && ledger.includes("claude-haiku-5-5"));
  console.log(`     ${used}`);
  await shots("pass-ledger");
} finally {
  await app.stop();
  fs.rmSync(at.home, { recursive: true, force: true });
}
finish();
