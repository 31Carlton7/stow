/**
 * Live check for the Sessions section (run with: pnpm build && node apps/desktop/scripts/sessions-live.mjs)
 *
 * Boots the BUILT app on a scratch data folder, reading a fixture home that holds six invented
 * transcripts (Claude and Codex; typed at a terminal, driven by Realm, a one-shot call, sub-agents),
 * and drives the real window:
 *
 *   1. The list is the conversations a person had. One-shot calls and sub-agents come in only when
 *      their switch is turned on, and the sidebar's counts are of what the list would hold.
 *   2. A session Realm drove says so. Search narrows the list by title.
 *   3. A transcript reads as a person's words, the model's, folded tool calls and notes; a tool row
 *      opens to what came back, and a failed one is marked.
 *   4. Context lists the files a Claude session recorded loading, marks one changed since, and opens
 *      one in the library. A Codex session's context says it was worked out, not recorded.
 *   5. A session's sub-agents are listed from it, with a way back.
 *   6. Nothing under the home it reads is written.
 *
 * No model is called. Pictures of both faces go to LIVE_DIR.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildFixtureHome } from "../../../fixtures/home.mjs";
import { checks, launchLiveApp, sleep, until, windowTools } from "./lib/live-app.mjs";

const outDir = process.env.LIVE_DIR ?? path.join(os.tmpdir(), "amc-live", "sessions");
const at = buildFixtureHome(fs.mkdtempSync(path.join(os.tmpdir(), "amc-sessions-home-")));
const { check, finish } = checks();

/** Every file under the home with its size and when it was written, as one hash. */
const homeAsItIs = () => {
  const hash = createHash("sha1");
  for (const entry of fs.readdirSync(at.home, { recursive: true, withFileTypes: true }).sort((a, b) => path.join(a.parentPath, a.name).localeCompare(path.join(b.parentPath, b.name)))) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath, entry.name);
    const stat = fs.statSync(file);
    hash.update(`${file}\0${stat.size}\0${stat.mtimeMs}\n`);
  }
  return hash.digest("hex");
};
const before = homeAsItIs();

const app = await launchLiveApp({ name: "sessions", sourceHome: at.home });
const { page } = app;
const { text, texts, has, click, shots, unreachable } = windowTools(app, outDir);
const rowTitles = () => texts(".lib-row-title");
const rows = (n, what) => until(() => page.eval(`document.querySelectorAll(".lib-row").length === ${n}`), 8_000, what);
const opened = (title) => until(() => page.eval(`document.querySelector(".lib-reader-title")?.textContent === ${JSON.stringify(title)}`), 8_000, `${title} in the reader`);
const sidebar = () => texts('nav[aria-label="Sessions"] .lib-nav-row');

try {
  await until(() => page.eval(`document.querySelector(".dest") !== null`), 15_000, "the sidebar");
  await click(".dest .lib-nav-row", "Sessions");
  await rows(3, "the three conversations a person had");
  check("the list is the conversations a person had", JSON.stringify((await rowTitles()).toSorted()) === JSON.stringify(["Plan the 2.4 release with me", "Tagging the 2.4 release", "Why is the beacon dark?"]), (await rowTitles()).join(" | "));
  const counts = await sidebar();
  check("the sidebar counts what the list holds, by agent and by project", JSON.stringify(counts) === JSON.stringify(["All conversations3", "Favorites0", "Claude2", "Codex1", "atlas2", "beacon1"]), counts.join(", "));
  check("a session Realm drove says so", await has(".lib-row", "Claude in Realm"));
  check("the switches say how many each would add", JSON.stringify(await texts(".ses-show")) === JSON.stringify(["One-shot calls1", "Sub-agents2"]));
  await shots("sessions-list");

  await page.eval(`[...document.querySelectorAll(".ses-show .switch")].forEach((s) => s.click())`);
  await rows(6, "every transcript once both switches are on");
  check("one-shot calls and sub-agents come in when their switch is on, and the sidebar still counts conversations", (await sidebar())[0] === "All conversations3", (await rowTitles()).join(" | "));
  await page.eval(`[...document.querySelectorAll(".ses-show .switch")].forEach((s) => s.click())`);
  await rows(3, "the conversations again");

  await page.eval(`document.querySelector(".lib-search input").focus()`);
  await page.send("Input.insertText", { text: "beacon" });
  await rows(1, "the one conversation with the word in its title");
  check("search narrows the list by title", (await rowTitles()).join() === "Why is the beacon dark?");
  await click(".lib-row", "Why is the beacon dark?");
  await opened("Why is the beacon dark?");
  await click(".seg-opt", "Context");
  await until(() => page.eval(`document.querySelector(".ses-context") !== null`), 5_000, "the Codex session's context");
  check("a Codex session's context says it was worked out, not recorded", (await text(".ses-context")).includes("worked out"), (await text(".ses-context")).slice(0, 160));
  await page.eval(`(() => { const field = document.querySelector(".lib-search input"); field.focus(); field.select(); })()`);
  await page.send("Input.insertText", { text: " " });
  await rows(3, "the list with the search cleared");

  await click(".lib-row", "Tagging the 2.4 release");
  await opened("Tagging the 2.4 release");
  await click(".seg-opt", "Transcript");
  await until(() => page.eval(`document.querySelectorAll(".ses-blocks > *").length >= 8`), 8_000, "the transcript");
  const shapes = await page.eval(`[...document.querySelector(".ses-blocks").children].map((el) => el.className.split(" ")[0])`);
  check("the transcript holds a person's words, the model's, folded rows and notes", ["ses-user", "ses-assistant", "ses-fold", "ses-note"].every((shape) => shapes.includes(shape)), shapes.join(" "));
  check("a tool's output is not drawn until its row is opened", (await page.eval(`document.querySelectorAll(".ses-tool-body").length`)) === 0);
  check("a failed tool is marked in words", (await texts(".ses-tool-failed")).length === 1, (await texts(".ses-tool-failed")).join());
  await page.eval(`document.querySelector(".ses-fold-row:has(.ses-tool-name)").click()`);
  await until(() => page.eval(`document.querySelector(".ses-tool-body .setup-code") !== null`), 5_000, "the opened tool call");
  check("an opened tool row shows what it was called with and what came back", (await texts(".ses-tool-part")).length === 2, (await texts(".ses-tool-part")).join(" | "));
  await shots("sessions-transcript");
  check("every control on screen takes a real press: none lies in a part that drags the window", (await unreachable()).length === 0, (await unreachable()).join(" | "));

  await click(".seg-opt", "Context");
  await until(() => page.eval(`document.querySelectorAll(".ses-files > li").length > 0`), 5_000, "the files the session loaded");
  const files = await texts(".ses-files > li");
  check("context lists the instruction files the session recorded loading", files.some((f) => f.includes("~/.claude/CLAUDE.md")) && files.some((f) => f.includes("~/work/atlas/CLAUDE.md")), files.join(" || "));
  check("the one edited since is marked, and only that one", (await texts(".ses-file-changed")).length === 1 && files.find((f) => f.includes("~/work/atlas/CLAUDE.md")).includes("Changed since"), (await texts(".ses-file-changed")).join());
  check("a recorded context does not claim to be worked out", !(await text(".ses-context")).includes("worked out"));
  await shots("sessions-context");
  await page.eval(`[...document.querySelectorAll(".ses-files > li")].find((li) => li.textContent.includes("~/.claude/CLAUDE.md")).querySelector("button").click()`);
  await until(() => page.eval(`document.querySelector(".dest [aria-current]")?.textContent.includes("Library") && document.querySelector(".lib-reader-title")?.textContent === "CLAUDE"`), 8_000, "the file open in the library");
  check("a loaded file opens in the library", true);

  await click(".dest .lib-nav-row", "Sessions");
  await rows(3, "the conversations");
  await click(".lib-row", "Plan the 2.4 release with me");
  await opened("Plan the 2.4 release with me");
  await click(".col-reader button", "1 sub-agent");
  await rows(1, "the session's sub-agent");
  check("a session's sub-agents are listed from it", (await rowTitles()).join() === "Check the changelog names the signing step");
  await page.eval(`document.querySelector('.col-list [aria-label="Back to the sessions"]').click()`);
  await rows(3, "the conversations, after going back");
  check("and there is a way back to the conversations", true);

  await sleep(300);
  check("nothing under the home was written", homeAsItIs() === before);
} finally {
  await app.stop();
  fs.rmSync(at.home, { recursive: true, force: true });
}
finish();
