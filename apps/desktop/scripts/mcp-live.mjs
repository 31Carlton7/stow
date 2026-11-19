/**
 * Live check for adding, checking and removing an MCP server from the window
 * (run with: pnpm build && node apps/desktop/scripts/mcp-live.mjs)
 *
 * Boots the BUILT app on a scratch data folder and a fixture home, with stand-ins for `claude` and
 * `codex` that do to the fixture's files what the real `mcp` subcommands do. It adds one server to
 * three agents through the Add sheet, with a token typed into it, and reads the disk afterwards:
 *
 *   1. Before anything is added, the sheet shows the command each agent's tool will be given and the
 *      file that will change, with the token masked.
 *   2. Adding writes the server into each agent's own config, through that agent's tool where it
 *      has one. The token is in those configs and nowhere on screen.
 *   3. The new server is in the list, under each agent that has it.
 *   4. "Check all" asks the agents' tools, and each place then says more than "Not checked".
 *   5. Removing it from one agent takes it out of that agent's config and leaves the others.
 *
 * No real agent's tool is run and no model is called. Pictures of both faces go to LIVE_DIR.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildFixtureHome } from "../../../fixtures/home.mjs";
import { writeFakeAgents } from "../../server/scripts/lib/fake-agents.mjs";
import { checks, launchLiveApp, until, windowTools } from "./lib/live-app.mjs";

const outDir = process.env.LIVE_DIR ?? path.join(os.tmpdir(), "amc-live", "mcp");
const at = buildFixtureHome(fs.mkdtempSync(path.join(os.tmpdir(), "amc-mcp-home-")));
const agents = writeFakeAgents(fs.mkdtempSync(path.join(os.tmpdir(), "amc-mcp-agents-")));
const { check, finish } = checks();

const TOKEN = "live-check-token-4b7d2e";
const read = (rel) => (fs.existsSync(path.join(at.home, rel)) ? fs.readFileSync(path.join(at.home, rel), "utf8") : "");

const app = await launchLiveApp({ name: "mcp", sourceHome: at.home, env: agents.env });
const { page } = app;
const { text, texts, has, click, shots } = windowTools(app, outDir);
const seen = [];
const keep = async () => { seen.push(await page.eval(`document.body.innerText`)); };
/** Type into a field the way a person does, so React hears it. */
const type = (selector, value) => page.eval(`(() => {
  const input = document.querySelector(${JSON.stringify(selector)});
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, ${JSON.stringify(value)});
  input.dispatchEvent(new Event("input", { bubbles: true }));
})()`);
const rowTitles = () => texts(".col-list .lib-row-title");

try {
  await until(() => page.eval(`document.querySelector(".dest") !== null`), 15_000, "the sidebar");
  await click(".dest .lib-nav-row", "MCP servers");
  await until(() => page.eval(`document.querySelectorAll(".col-list .lib-row").length === 4`), 15_000, "the four servers the fixture holds");

  await click(".lib-list-head .btn", "Add");
  await until(() => page.eval(`document.querySelector(".sheet") !== null`), 8_000, "the Add sheet");
  await click(".sheet .seg-opt", "Fill it in");
  await until(() => page.eval(`document.querySelector(".sheet form.setup-add") !== null`), 8_000, "the form");
  await type('.sheet form.setup-add input[placeholder="linear"]', "ledger");
  await type(".sheet form.setup-add input.setup-mono", "npx -y @example/ledger-mcp");
  await click(".sheet .setup-given-foot .btn", "Add a variable");
  await until(() => page.eval(`document.querySelector('.sheet .setup-given input[type="password"]') !== null`), 5_000, "the variable's fields");
  await type(".sheet .setup-given input:not([type=password])", "LEDGER_TOKEN");
  await type('.sheet .setup-given input[type="password"]', TOKEN);
  // Tick Claude Code, Codex and Cursor, whatever was ticked to begin with.
  await page.eval(`[...document.querySelectorAll(".sheet .setup-tick")].forEach((tick) => {
    const box = tick.querySelector("input"), wanted = /Claude Code|Codex|Cursor/.test(tick.textContent);
    if (box.checked !== wanted) box.click();
  })`);
  await click(".sheet-foot .btn", "Show what it will do");
  await until(() => page.eval(`document.querySelectorAll(".sheet .setup-step").length === 3`), 15_000, "what adding would do, for each of the three agents");
  const steps = await texts(".sheet .setup-step");
  check("the sheet shows what each agent's tool will be given before anything is added", steps.some((s) => s.includes("claude mcp add-json")) && steps.some((s) => s.includes("codex mcp add")) && steps.some((s) => s.includes(".cursor/mcp.json")), steps.join(" || "));
  check("and the token is masked in it", steps.every((s) => !s.includes(TOKEN)) && steps.some((s) => s.includes("LEDGER_TOKEN")));
  check("nothing has been written yet", !read(".claude.json").includes("ledger") && !read(".codex/config.toml").includes("ledger") && !read(".cursor/mcp.json").includes("ledger"));
  await keep();
  await shots("mcp-preview");

  await click(".sheet-foot .btn.primary", "Add");
  await until(() => page.eval(`document.querySelectorAll(".sheet .setup-step-outcome").length === 3`), 20_000, "each agent's outcome");
  check("each agent says the server was added", (await page.eval(`[...document.querySelectorAll(".sheet .setup-step-outcome")].every((o) => o.dataset.ok !== undefined)`)) === true, (await texts(".sheet .setup-step-outcome")).join(" | "));
  check("it is in each agent's own config, with the token", [".claude.json", ".codex/config.toml", ".cursor/mcp.json"].every((file) => read(file).includes("ledger") && read(file).includes(TOKEN)));
  await keep();
  await shots("mcp-added");
  await click(".sheet-foot .btn", "Done").catch(() => click(".sheet-foot .btn", "Close"));
  await until(() => page.eval(`document.querySelector(".sheet") === null`), 8_000, "the sheet to close");

  await until(async () => (await rowTitles()).includes("ledger"), 10_000, "the new server in the list");
  check("the new server is in the list", (await rowTitles()).length === 5);
  await click(".col-list .lib-row", "ledger");
  await until(() => page.eval(`document.querySelector(".lib-reader-title")?.textContent === "ledger"`), 8_000, "the new server's page");
  const places = await texts(".setup-place-who");
  check("its page names the three agents that have it", ["Claude Code", "Codex", "Cursor"].every((agent) => places.some((p) => p.includes(agent))), places.join(" | "));
  await keep();

  await click(".lib-list-head .btn", "Check all");
  await until(() => has(".col-reader", "Checking"), 10_000, "the check to start");
  await until(async () => !(await has(".col-reader", "Checking")), 120_000, "the check to finish");
  const page1 = await text(".col-reader");
  check("after a check, a place says more than Not checked", /Connected|Failed|Sign in|Not known|Off/.test(page1), page1.replaceAll("\n", " ").slice(0, 300));
  await keep();
  await shots("mcp-server");

  // Remove it from Codex only.
  await page.eval(`(() => {
    const place = [...document.querySelectorAll(".setup-places > li")].find((li) => li.querySelector(".setup-place-who")?.textContent.includes("Codex"));
    [...place.querySelectorAll("button")].find((b) => b.textContent.includes("Remove")).click();
  })()`);
  await until(() => page.eval(`document.querySelector(".sheet")?.getAttribute("aria-label")?.startsWith("Remove ledger from ")`), 8_000, "the question before removing");
  await click(".sheet-foot .btn", "Remove");
  await until(() => page.eval(`document.querySelector(".sheet") === null`), 15_000, "the sheet to close after removing");
  await until(async () => !read(".codex/config.toml").includes("ledger"), 10_000, "Codex's config without the server");
  check("removing it from Codex leaves it for Claude Code and Cursor", read(".claude.json").includes("ledger") && read(".cursor/mcp.json").includes("ledger"));
  await until(async () => !(await texts(".setup-place-who")).some((p) => p.includes("Codex")), 10_000, "the page without Codex");
  await keep();

  check("the token was never on screen", seen.length === 5 && seen.every((shown) => !shown.includes(TOKEN)));
} finally {
  await app.stop();
  fs.rmSync(at.home, { recursive: true, force: true });
  fs.rmSync(path.dirname(agents.env.AMC_CLAUDE_BIN), { recursive: true, force: true });
}
finish();
