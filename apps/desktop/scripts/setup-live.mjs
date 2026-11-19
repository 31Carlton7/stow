/**
 * Live check for the Skills, MCP servers and Hooks sections (run with: pnpm build && node apps/desktop/scripts/setup-live.mjs)
 *
 * Boots the BUILT app on a scratch data folder, reading a fixture home whose configs hold secrets
 * that all start `fixture-secret`, and drives the real window:
 *
 *   1. Each section lists what the fixture holds: six skills, four servers, four hooks.
 *   2. A skill shows every place it is reached from and which are links; a copy and a skill no agent
 *      will load are both said.
 *   3. An MCP server defined two ways shows each way; one defined the same way twice shows one.
 *   4. A hook shows its command.
 *   5. No secret from any config is on screen, in any list or on any page opened.
 *   6. Skills and MCP servers each have their own rows in the sidebar, counted from the fixture.
 *   7. Each server's row says its health, and its page offers to check again and to remove it; the
 *      removal asks first and names the agent and its file.
 *   8. The sheets for adding a server (described, or filled in) and for adding skills open.
 *
 * Nothing is added, removed or signed in to: every sheet is closed without its button being pressed,
 * so nothing on disk is checked. Pictures of both faces go to LIVE_DIR.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildFixtureHome } from "../../../fixtures/home.mjs";
import { checks, launchLiveApp, until, windowTools } from "./lib/live-app.mjs";

const outDir = process.env.LIVE_DIR ?? path.join(os.tmpdir(), "amc-live", "setup");
const at = buildFixtureHome(fs.mkdtempSync(path.join(os.tmpdir(), "amc-setup-home-")));

const { check, finish } = checks();

const app = await launchLiveApp({ name: "setup", sourceHome: at.home });
const { page } = app;
const { texts, click, shots, unreachable } = windowTools(app, outDir);
const titled = (title) => until(() => page.eval(`document.querySelector(".lib-reader-title")?.textContent === ${JSON.stringify(title)}`), 8_000, `the page of ${title}`);
const sheet = (title) => until(() => page.eval(`document.querySelector(".sheet")?.getAttribute("aria-label") === ${JSON.stringify(title)}`), 8_000, `the sheet ${title}`);
const closeSheet = async () => {
  await click(".sheet-foot .btn", "Cancel");
  await until(() => page.eval(`document.querySelector(".sheet") === null`), 8_000, "the sheet to close");
};
/** Type into a field the way a person does, so React hears it. */
const typeInto = (label, value) => page.eval(`(() => {
  const input = [...document.querySelectorAll(".sheet label.field")].find((field) => field.firstElementChild.textContent === ${JSON.stringify(label)}).querySelector("input");
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, ${JSON.stringify(value)});
  input.dispatchEvent(new Event("input", { bubbles: true }));
})()`);
const seen = [];
/** Everything on screen now is kept, so the secrets can be looked for across every page at the end. */
const keep = async () => { seen.push(await page.eval(`document.body.innerText`)); };

try {
  await until(() => page.eval(`document.querySelector(".dest") !== null`), 15_000, "the sidebar");
  await click(".dest .lib-nav-row", "Skills");
  await until(() => page.eval(`document.querySelectorAll(".lib-row").length === 6`), 15_000, "the six skills");
  check("Skills lists the six the fixture holds", (await texts(".lib-list-title")).join() === "Skills");

  await click(".lib-row", "2 copies");
  await titled("release-notes");
  const places = await texts(".setup-places > li");
  check("a skill names each place it is reached from, and which are links", places.length === 2 && places.some((p) => p.endsWith("Link")) && places.some((p) => p.endsWith("Its own folder")), places.join(" | "));
  check("a skill kept twice says so", (await page.eval(`document.querySelector(".lib-props").innerText`)).includes("2 folders on this Mac hold exactly this skill"));
  await until(() => page.eval(`document.querySelector(".lib-reader-body")?.innerText.trim().length > 0`), 8_000, "the skill's text");
  await keep();
  await shots("setup-skills");
  const skillNav = await texts('nav[aria-label="Skills"] .lib-nav-row');
  check("the sidebar counts every skill and each place they are reached from", skillNav[0] === "All skills6" && skillNav.length > 2 && skillNav.at(-1).startsWith("Needs a look"), skillNav.join(" | "));
  check("a skill's page offers to remove it", await page.eval(`[...document.querySelectorAll(".setup-acts .btn")].some((b) => b.textContent === "Remove")`));

  await click(".lib-list-head .btn", "Add skills");
  await sheet("Add skills");
  check("adding skills asks where to look", await page.eval(`document.querySelector('.sheet [aria-label="Where to look"]') !== null`));
  await shots("skills-add");
  await closeSheet();

  await click(".lib-row", "scratch");
  await titled("scratch");
  check("a skill with no name or description is said to load nowhere", (await page.eval(`document.querySelector(".lib-reader").innerText`)).includes("no agent will load it"));

  await click(".dest .lib-nav-row", "MCP servers");
  await until(() => page.eval(`document.querySelectorAll(".lib-row").length === 4`), 8_000, "the four servers");
  await keep();
  const mcpNav = await texts('nav[aria-label="MCP servers"] .lib-nav-row');
  check("the sidebar counts every server and each agent's", mcpNav[0] === "All servers4" && mcpNav.length > 1, mcpNav.join(" | "));
  const healthWords = await texts(".lib-row .setup-health");
  check("each server's row says its health", healthWords.length === 4, healthWords.join(" | "));
  await shots("mcp-list");
  check("every control on screen takes a real press: none lies in a part that drags the window", (await unreachable()).length === 0, (await unreachable()).join(" | "));

  await click(".lib-list-head .btn", "Add");
  await sheet("Add an MCP server");
  await until(() => page.eval(`document.querySelector(".sheet .setup-describe, .sheet .setup-describe-form") !== null`), 8_000, "the way in by describing");
  check("describing a server asks for a model to be turned on first, on a home with none", await page.eval(`document.querySelector(".sheet").innerText.includes("Open Models")`));
  await shots("mcp-add-describe");
  await click(".sheet .seg-opt", "Fill it in");
  await until(() => page.eval(`document.querySelector(".sheet form.setup-add") !== null`), 8_000, "the form");
  await typeInto("Name", "tracker");
  await typeInto("Command, with its arguments", "npx -y @example/tracker-mcp");
  await click(".sheet .setup-given-foot .btn", "Add a variable");
  await shots("mcp-add-fill");
  await click(".sheet-foot .btn", "Show what it will do");
  await until(() => page.eval(`document.querySelector(".sheet .setup-steps, .sheet .setup-refusal") !== null`), 15_000, "what adding would do, or why that could not be said");
  check("nothing is offered to be added before what it will do is shown", await page.eval(`document.querySelector(".sheet .setup-steps") !== null || ![...document.querySelectorAll(".sheet-foot .btn")].some((b) => b.textContent.startsWith("Add"))`));
  await shots("mcp-add-preview");
  await closeSheet();

  await click(".lib-row", "Defined two ways");
  await titled("search");
  check("a server defined two ways shows both", (await texts(".setup-way .rev-heading")).join("|") === "Way 1, in 1 place|Way 2, in 1 place");
  check("and names what it is given without its value", (await page.eval(`document.querySelector(".lib-reader").innerText`)).includes("Given SEARCH_KEY."));
  await keep();
  await shots("setup-mcp");
  const acts = await texts(".setup-place-acts .btn");
  check("each place a server is defined offers to check it again and to remove it", acts.filter((a) => a === "Check again").length === 2 && acts.includes("Remove"), acts.join(" | "));
  await click(".setup-place-acts .btn", "Remove");
  await until(() => page.eval(`document.querySelector(".sheet")?.getAttribute("aria-label")?.startsWith("Remove search from ")`), 8_000, "the question before removing");
  check("removing asks first, and names the config it leaves", await page.eval(`document.querySelector(".sheet .lib-ask-path").textContent.length > 0`));
  await keep();
  await shots("mcp-remove");
  await closeSheet();
  await click(".lib-row", "notes");
  await titled("notes");
  check("a server defined the same way twice shows one way and both places", (await texts(".setup-way .rev-heading")).join("|") === "How it is started" && (await texts(".setup-place-who")).length === 2);
  await keep();
  for (const name of ["atlasdb", "realm-tools"]) {
    await click(".lib-row", name);
    await titled(name);
    await keep();
  }

  await click(".dest .lib-nav-row", "Hooks");
  await until(() => page.eval(`document.querySelectorAll(".lib-row").length === 4`), 8_000, "the four hooks");
  await keep();
  await click(".lib-row", "PostToolUse");
  await titled("PostToolUse · Edit|Write");
  check("a hook shows its command", (await texts(".setup-code")).join("") === "pnpm lint --fix");
  await shots("setup-hooks");
  await click(".lib-row", "notify");
  await until(() => page.eval(`document.querySelector(".setup-code")?.textContent.startsWith("notify")`), 8_000, "the hook that carries a token");
  await keep();

  check("no secret from any config was on screen", seen.length === 9 && seen.every((text) => !text.includes("fixture-secret")));
} finally {
  await app.stop();
  fs.rmSync(at.home, { recursive: true, force: true });
}
finish();
