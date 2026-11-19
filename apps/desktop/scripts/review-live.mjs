/**
 * Live check for the review inbox and the model settings (run with: pnpm build && node apps/desktop/scripts/review-live.mjs)
 *
 * Boots the BUILT app on a scratch data folder, reading a fixture home with one of each seeded
 * problem, and drives the real window. It checks against the DISK what no component test can see:
 *
 *   1. The sidebar counts the findings; the list shows them most serious first.
 *   2. A finding shows the exact change before anything is changed.
 *   3. Approving it makes one commit in the fixture's memory repo, by the app, of that file alone;
 *      Undo, from the applied fixes, makes a second commit that puts the text back.
 *   4. A finding with nothing mechanical to do offers no Approve; turning it down keeps it away.
 *   5. A finding's file opens in the library.
 *   6. Open Models lands on the Models page of Settings: both are off, no call has been made, and ruling a source out of a reading
 *      takes its files out of what would be sent.
 *
 * No model is called: the runners stay off. Pictures of both faces go to LIVE_DIR.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildFixtureHome } from "../../../fixtures/home.mjs";
import { checks, launchLiveApp, sleep, until, windowTools } from "./lib/live-app.mjs";

const outDir = process.env.LIVE_DIR ?? path.join(os.tmpdir(), "amc-live", "review");
const at = buildFixtureHome(fs.mkdtempSync(path.join(os.tmpdir(), "amc-review-home-")));
// A fix leaves alone any file written in the last hour, so the fixture is made to look older than that.
const earlier = new Date(Date.now() - 3 * 60 * 60_000);
for (const entry of fs.readdirSync(at.home, { recursive: true, withFileTypes: true })) {
  if (entry.isFile() && !entry.parentPath.includes(`${path.sep}.git`)) fs.utimesSync(path.join(entry.parentPath, entry.name), earlier, earlier);
}

const { check, finish } = checks();
const git = (...args) => execFileSync("git", args, { cwd: at.repo, encoding: "utf8" }).trim();
const index = () => fs.readFileSync(path.join(at.repo, "MEMORY.md"), "utf8");

const app = await launchLiveApp({ name: "review", sourceHome: at.home });
const { page } = app;
const { text, texts, click, shots, noticesGone, unreachable } = windowTools(app, outDir);

try {
  const badge = await until(() => text(".dest-count"), 15_000, "the count of findings beside Review");
  check("the sidebar counts the findings a scan made", badge === "8", badge);

  await click(".dest .lib-nav-row", "Review");
  await until(() => page.eval(`document.querySelectorAll(".rev-row").length === 8`), 5_000, "the eight findings");
  check("the list heads them by how serious they are", JSON.stringify(await texts(".rev-group-name")) === JSON.stringify(["Worth a look", "Tidying"]));
  check("the model's reading is offered only as something to turn on", (await text(".rev-reading-line")).includes("Nothing is sent until you turn a model on"));
  await shots("review-list");

  await click(".rev-row", "links to 1 file that is not there");
  await until(() => page.eval(`document.querySelector(".fd-line[data-kind=del]") !== null`), 5_000, "the diff of the fix");
  check("the finding says what approving does", (await text(".rev-fix")) === "Remove 1 line from the index.");
  check("and shows the one line that would go", JSON.stringify(await texts(".fd-line[data-kind=del] .fd-text")) === JSON.stringify(["- [[missing-note]]"]));
  check("nothing is changed by looking", index().includes("[[missing-note]]"));
  await shots("review-finding");
  check("every control on screen takes a real press: none lies in a part that drags the window", (await unreachable()).length === 0, (await unreachable()).join(" | "));

  const commitsBefore = Number(git("rev-list", "--count", "HEAD"));
  await click(".lib-reader-bar .btn.primary", "Approve");
  await until(() => page.eval(`document.querySelectorAll(".rev-row").length === 7`), 8_000, "the list without the fixed finding");
  check("approving removed the dead link from the file", !index().includes("missing-note"));
  check("as one commit by the app", Number(git("rev-list", "--count", "HEAD")) === commitsBefore + 1 && git("log", "-1", "--format=%an|%s") === "Stow|Drop 1 dead link from MEMORY.md");
  check("of that file alone", git("show", "--name-only", "--format=", "HEAD") === "MEMORY.md");
  check("the sidebar's count went down with it", (await text(".dest-count")) === "7");

  await click(".lib-nav-row", "Applied fixes");
  await until(() => page.eval(`document.querySelectorAll(".rev-applied").length === 1`), 5_000, "the applied fix");
  await shots("review-applied");
  await click(".rev-applied .btn", "Undo");
  await until(async () => index().includes("[[missing-note]]"), 8_000, "the file put back");
  check("undo put the line back, as a commit of its own", git("log", "-1", "--format=%s").startsWith('Revert "Drop 1 dead link from MEMORY.md"'));

  await click(".lib-nav-row", "All findings");
  await until(() => page.eval(`document.querySelectorAll(".rev-row").length === 8`), 8_000, "the finding back in the list");
  await click(".rev-row", "MCP server is set up 2 ways");
  await until(() => page.eval(`document.querySelector(".rev-detail .lib-reader-title")?.textContent.includes("search MCP server")`), 5_000, "the conflict's detail");
  check("a finding with nothing mechanical to do offers no Approve", (await texts(".lib-reader-bar .btn")).join("|") === "Not a problem");
  check("and no secret from the config is on screen", !(await page.eval(`document.body.innerText`)).includes("fixture-secret"));
  await shots("review-conflict");
  await click(".lib-reader-bar .btn", "Not a problem");
  await until(() => page.eval(`document.querySelectorAll(".rev-row").length === 7`), 8_000, "the list without the one turned down");
  await click(".col-head .icon-btn");
  await sleep(1_500);
  check("a finding turned down is not raised by the next scan", (await page.eval(`document.querySelectorAll(".rev-row").length`)) === 7);

  await click(".rev-row", "imported copy");
  await until(() => page.eval(`document.querySelector(".rev-removal") !== null`), 5_000, "the file that would go");
  check("a file that would go says where it goes", (await text(".rev-removal")) === "Moved to the Trash");
  await click(".rev-subject");
  await until(() => page.eval(`document.querySelector(".lib-reader-title")?.textContent === "deploy-steps" && document.querySelector(".lib-rows:not(.rev-rows)") !== null`), 8_000, "the file open in the library");
  check("a finding's file opens in the library", (await page.eval(`document.querySelector(".dest [aria-current]")?.textContent`)).includes("Library"));

  await click(".dest .lib-nav-row", "Review");
  await click(".lib-nav-row", "Applied fixes");
  await until(() => page.eval(`document.querySelectorAll(".rev-applied").length === 1`), 5_000, "the fix in the history");
  check("a fix undone from the list takes its own Undo off the screen", (await page.eval(`document.querySelectorAll(".toast-action").length`)) === 0);
  check("and the history says it was undone", (await text(".rev-applied .rev-row-offer")).startsWith("Undone"));

  await click(".lib-nav-row", "All findings");
  await click(".rev-reading .btn", "Open Models");
  await until(() => page.eval(`document.querySelectorAll(".models-card").length === 2`), 15_000, "the two model cards");
  check("Review's Open Models lands on the Models page of Settings", (await page.eval(`[...document.querySelectorAll(".sidebar [aria-current]")].map((row) => row.textContent).join("|")`)) === "Settings|Models");
  await noticesGone();
  check("no model field reaches past its card", (await page.eval(`[...document.querySelectorAll(".models-card")].every((card) =>
    [...card.querySelectorAll("input[type=text]")].every((field) => field.getBoundingClientRect().right <= card.getBoundingClientRect().right - 15))`)) === true);
  check("both models start switched off", (await page.eval(`[...document.querySelectorAll(".models-card .switch")].every((s) => !s.checked)`)) === true);
  await shots("models");
  await click('nav[aria-label="Settings"] .lib-nav-row', "Activity");
  await until(() => page.eval(`document.querySelector(".lib-reader-title")?.textContent === "Activity"`), 5_000, "the calls made");
  check("no call has been made", (await page.eval(`document.querySelector(".models-page").innerText`)).includes("No call has been made."));
  await click('nav[aria-label="Settings"] .lib-nav-row', "What is sent");
  await until(() => page.eval(`document.querySelector(".models-sends") !== null`), 5_000, "the places a reading sends from");
  const sent = () => page.eval(`[...document.querySelectorAll(".models-line")].map((p) => p.textContent).find((t) => /files in \\d+ calls?/.test(t))`);
  const before = await sent();
  await page.eval(`document.querySelector(".models-table .switch").click()`);
  await until(async () => (await sent()) !== before, 5_000, "the reading without that source");
  check("ruling a source out takes its files out of a reading", Number(/^(\d+) files/.exec(await sent())[1]) < Number(/^(\d+) files/.exec(before)[1]), `${before} → ${await sent()}`);
  await shots("sent");
} finally {
  await app.stop();
  fs.rmSync(at.home, { recursive: true, force: true });
}
finish();
