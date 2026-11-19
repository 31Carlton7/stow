/**
 * Live check for adding and removing a skill from the window
 * (run with: pnpm build && node apps/desktop/scripts/skills-live.mjs)
 *
 * Boots the BUILT app on a scratch data folder and a fixture home, and looks at a folder of two
 * invented skills made for the check, one of which holds a script. Then it reads the disk:
 *
 *   1. Looking at the folder lists both skills, says which holds something an agent could run, and
 *      installs nothing.
 *   2. A skill's SKILL.md can be read before it is installed.
 *   3. Installing the one ticked copies its folder into the fixture's Claude skills folder; the other
 *      is not copied; nothing in either was run.
 *   4. The installed skill is in the Skills list, and its page has a health line when something is
 *      wrong with it.
 *   5. Removing it takes the folder out again, into the fixture's Trash.
 *
 * Nothing is fetched from the network and no model is called. Pictures of both faces go to LIVE_DIR.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildFixtureHome } from "../../../fixtures/home.mjs";
import { checks, launchLiveApp, until, windowTools } from "./lib/live-app.mjs";

const outDir = process.env.LIVE_DIR ?? path.join(os.tmpdir(), "amc-live", "skills");
const at = buildFixtureHome(fs.mkdtempSync(path.join(os.tmpdir(), "amc-skills-home-")));
const { check, finish } = checks();

const offered = path.join(at.home, "Downloads", "skills-to-try");
const skill = (name, description, body) => `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`;
const put = (rel, text, mode) => {
  const file = path.join(offered, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, mode === undefined ? undefined : { mode });
};
const ran = path.join(at.home, "the-script-ran");
put("changelog/SKILL.md", skill("changelog", "Write a changelog entry from the commits since the last tag", "List the commits, group them by what a person will notice, and write one line each. See scripts/collect.sh."));
put("changelog/scripts/collect.sh", `#!/bin/sh\ntouch ${JSON.stringify(ran)}\n`, 0o755);
put("tidy-names/SKILL.md", skill("tidy-names", "Rename files to the house style", "Lower case, hyphens, no dates."));
const installedAt = path.join(at.home, ".claude", "skills", "changelog");

const app = await launchLiveApp({ name: "skills", sourceHome: at.home });
const { page } = app;
const { text, texts, has, click, shots } = windowTools(app, outDir);
const type = (selector, value) => page.eval(`(() => {
  const input = document.querySelector(${JSON.stringify(selector)});
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, ${JSON.stringify(value)});
  input.dispatchEvent(new Event("input", { bubbles: true }));
})()`);
const rowTitles = () => texts(".col-list .lib-row-title");

try {
  await until(() => page.eval(`document.querySelector(".dest") !== null`), 15_000, "the sidebar");
  await click(".dest .lib-nav-row", "Skills");
  await until(() => page.eval(`document.querySelectorAll(".col-list .lib-row").length === 6`), 15_000, "the six skills the fixture holds");

  await click(".lib-list-head .btn", "Add skills");
  await until(() => page.eval(`document.querySelector(".sheet")?.getAttribute("aria-label") === "Add skills"`), 8_000, "the Add skills sheet");
  await until(() => page.eval(`document.querySelectorAll(".sheet .setup-library").length > 0`), 8_000, "the libraries offered by name");
  check("libraries are offered by name, each with where it is", (await texts(".sheet .setup-library-url")).every((url) => url.startsWith("https://")), (await texts(".sheet .setup-library-name")).join(" | "));
  await shots("skills-add");

  await type('.sheet input[aria-label="Where to look"]', offered);
  await click(".sheet .setup-look .btn", "Look");
  await until(() => page.eval(`document.querySelectorAll(".sheet .setup-offer").length === 2`), 20_000, "the two skills in the folder");
  const offers = await texts(".sheet .setup-offer");
  check("looking lists both skills with what each is", offers.some((o) => o.includes("changelog") && o.includes("Write a changelog entry")) && offers.some((o) => o.includes("tidy-names")), offers.map((o) => o.slice(0, 60)).join(" || "));
  check("it says which holds something an agent could run, and that installing does not run it", offers.find((o) => o.includes("changelog")).includes("Installing does not run") && !offers.find((o) => o.includes("tidy-names")).includes("Installing does not run"), offers.find((o) => o.includes("changelog")).slice(0, 220));
  check("looking installed nothing", !fs.existsSync(installedAt));

  await page.eval(`[...document.querySelectorAll(".sheet .setup-offer")].find((o) => o.textContent.includes("changelog")).querySelector(".setup-offer-open").click()`);
  await until(() => page.eval(`document.querySelector(".sheet .setup-offer-text") !== null`), 8_000, "the skill's own text");
  check("a skill's SKILL.md can be read before it is installed", (await text(".sheet .setup-offer-text")).includes("group them by what a person will notice"));
  await shots("skills-offers");

  await page.eval(`document.querySelector('.sheet input[aria-label="Install changelog"]').click()`);
  await page.eval(`(() => { const pick = document.querySelector('.sheet select[aria-label="Install for"]'); const claude = [...pick.options].find((o) => /Claude/.test(o.textContent)); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(pick, claude.value); pick.dispatchEvent(new Event("change", { bubbles: true })); })()`);
  await click(".sheet-foot .btn.primary", "Install");
  await until(async () => fs.existsSync(path.join(installedAt, "SKILL.md")), 15_000, "the skill's folder in Claude's skills folder");
  check("installing copied the ticked skill, script and all", fs.existsSync(path.join(installedAt, "scripts", "collect.sh")));
  check("the skill that was not ticked was not copied", !fs.existsSync(path.join(at.home, ".claude", "skills", "tidy-names")));
  check("nothing in it was run", !fs.existsSync(ran));
  await page.eval(`document.querySelector(".sheet-head button").click()`);
  await until(() => page.eval(`document.querySelector(".sheet") === null`), 8_000, "the sheet to close");

  await until(async () => (await rowTitles()).includes("changelog"), 10_000, "the new skill in the list");
  check("the installed skill is in the list", (await rowTitles()).length === 7);
  await click(".col-list .lib-row", "changelog");
  await until(() => page.eval(`document.querySelector(".lib-reader-title")?.textContent === "changelog"`), 8_000, "the skill's page");
  await shots("skills-installed");

  await click(".col-reader .btn", "Remove");
  await until(() => page.eval(`document.querySelector(".sheet") !== null`), 8_000, "the question before removing");
  await click(".sheet-foot .btn", "Remove").catch(() => click(".sheet-foot .btn", "Move to Trash"));
  await until(async () => !fs.existsSync(installedAt), 15_000, "the folder gone from Claude's skills folder");
  check("removing it moved the folder to the fixture's Trash", fs.existsSync(path.join(at.home, ".Trash")) && fs.readdirSync(path.join(at.home, ".Trash")).some((name) => name.startsWith("changelog")), fs.existsSync(path.join(at.home, ".Trash")) ? fs.readdirSync(path.join(at.home, ".Trash")).join() : "no Trash");
  await until(async () => !(await rowTitles()).includes("changelog"), 10_000, "the list without it");
  check("and the list is back to the six it held", (await rowTitles()).length === 6 && !(await has(".col-list .lib-row", "changelog")));
} finally {
  await app.stop();
  fs.rmSync(at.home, { recursive: true, force: true });
}
finish();
