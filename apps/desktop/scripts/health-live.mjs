/**
 * Live check for the Health page (run with: pnpm build && node apps/desktop/scripts/health-live.mjs)
 *
 * Boots the BUILT app on a scratch data folder, reading the fixture home, and drives the real
 * window. It checks the page's numbers against the fixture's DISK:
 *
 *   1. Health is the first row of Review's sidebar and opens one page.
 *   2. What a Claude session loaded is what its transcript recorded; what a Codex session loaded is
 *      the AGENTS.md of the folder it ran in, as it is on disk.
 *   3. A file sessions loaded opens in the library.
 *   4. Storage's files are the transcripts on disk, by who was on the other end.
 *   5. The button goes to the list of ready fixes, and there are as many as it said.
 *
 * No model is called. Pictures of both faces go to LIVE_DIR.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildFixtureHome, claudeSlug } from "../../../fixtures/home.mjs";
import { checks, launchLiveApp, until, windowTools } from "./lib/live-app.mjs";

const outDir = process.env.LIVE_DIR ?? path.join(os.tmpdir(), "amc-live", "health");
const at = buildFixtureHome(fs.mkdtempSync(path.join(os.tmpdir(), "amc-health-home-")));
// A fix leaves alone any file written in the last hour, so the fixture's memory is made to look older than that.
const earlier = new Date(Date.now() - 3 * 60 * 60_000);
for (const entry of fs.readdirSync(at.home, { recursive: true, withFileTypes: true })) {
  if (entry.isFile() && !entry.parentPath.includes(`${path.sep}.git`) && !entry.name.endsWith(".jsonl")) fs.utimesSync(path.join(entry.parentPath, entry.name), earlier, earlier);
}

const transcripts = [".claude/projects", ".codex/sessions"].flatMap((dir) => fs.readdirSync(path.join(at.home, dir), { recursive: true, withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl") && !entry.parentPath.includes(`${path.sep}memory`));
const recorded = fs.readFileSync(path.join(at.home, ".claude/projects", claudeSlug(at.atlas), "11111111-1111-4111-8111-111111111111.jsonl"), "utf8")
  .split("\n").filter(Boolean).map((line) => JSON.parse(line)).filter((record) => record.type === "attachment").map((record) => record.attachment);
const instructions = recorded.find((attached) => attached.type === "instructions").files;
const charsOf = (type) => instructions.filter((file) => (file.type === "AutoMem") === (type === "memory")).reduce((sum, file) => sum + file.content.length, 0);
const beaconRules = fs.readFileSync(path.join(at.beacon, "AGENTS.md"), "utf8").length;

const { check, finish } = checks();
const app = await launchLiveApp({ name: "health", sourceHome: at.home });
const { page } = app;
const { text, texts, click, shots, noticesGone } = windowTools(app, outDir);
const cells = (row) => page.eval(`[...document.querySelectorAll(".health .models-table tr")].find((tr) => tr.cells[0].textContent === ${JSON.stringify(row)})?.innerText.split("\\t").slice(1).join("|")`);
const filesOf = (kind) => page.eval(`[...document.querySelectorAll("[aria-label='Kept on disk, by kind'] li")].find((li) => li.firstChild.textContent === ${JSON.stringify(kind)})?.lastChild.textContent`);

try {
  await until(() => text(".dest-count"), 15_000, "the count of findings beside Review");
  await click(".dest .lib-nav-row", "Review");
  await until(() => page.eval(`document.querySelectorAll(".rev-row").length > 0`), 8_000, "the findings");
  check("Health is the first row of Review's sidebar", (await texts(".lib-nav[aria-label=Review] .lib-nav-name"))[0] === "Health");

  await click(".lib-nav[aria-label=Review] .lib-nav-row", "Health");
  // The index lists the transcripts after the window is up, and the reading follows it: the page waits for both.
  await until(async () => (await cells("All of it"))?.split("|").length === 2 && (await page.eval(`document.querySelector(".health-pass") === null`)), 30_000, "both agents' sessions read");
  check("the page replaces the two columns", (await page.eval(`document.querySelector(".rev-row") === null && document.querySelector(".health .lib-reader-title")?.textContent`)) === "Health");
  check("a Claude session's instructions are what its transcript recorded", (await cells("Instructions")) === `${charsOf("instructions")}|${beaconRules}`, await cells("Instructions"));
  check("and its memory", (await cells("Memory")) === `${charsOf("memory")}|0`, await cells("Memory"));
  check("a Codex session's load is the AGENTS.md on disk where it ran", (await cells("All of it")).split("|")[1] === String(beaconRules));
  check("the chart's parts are named in a legend", (await texts(".hc-legend li")).join("|") === "Instructions|Memory|Skills list|MCP instructions|Hook output");

  const kept = { conversations: await filesOf("Conversations"), once: await filesOf("One-shot calls"), helpers: await filesOf("Sub-agents") };
  const counted = Object.values(kept).reduce((sum, files) => sum + Number(/^\d+/.exec(files)[0]), 0);
  check("storage counts every transcript on disk, by who was on the other end", counted === transcripts.length && kept.once === "1 file", JSON.stringify(kept));

  const ready = /Review the (\d+) ready fix/.exec(await text(".health-act"))?.[1];
  await noticesGone();
  await shots("health");
  await page.eval(`document.querySelector(".health .models-scroll").scrollTo(0, 100000)`);
  await shots("health-end");

  await click(".health-link", "MEMORY.md");
  await until(() => page.eval(`document.querySelector(".dest [aria-current]")?.textContent.includes("Library") && document.querySelector(".lib-reader-title") !== null`), 8_000, "the file open in the library");
  check("a file sessions loaded opens in the library", (await text(".lib-reader-title")).length > 0);

  await click(".dest .lib-nav-row", "Review");
  await until(() => page.eval(`document.querySelector(".health-act") !== null`), 15_000, "the Health page again");
  await click(".health-act");
  await until(() => page.eval(`document.querySelectorAll(".rev-row").length > 0`), 8_000, "the ready fixes");
  check("the button goes to the fixes that are ready, as many as it said", (await page.eval(`document.querySelectorAll(".rev-row").length`)) === Number(ready)
    && (await page.eval(`document.querySelector(".lib-nav[aria-label=Review] [aria-current]")?.textContent`)).startsWith("Fix ready"), ready);
} finally {
  await app.stop();
  fs.rmSync(at.home, { recursive: true, force: true });
}
finish();
