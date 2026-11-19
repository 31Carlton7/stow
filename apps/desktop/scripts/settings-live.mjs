/**
 * Live check for Settings (run with: pnpm build && node apps/desktop/scripts/settings-live.mjs)
 *
 * Boots the BUILT app on a scratch data folder and the fixture home, with stand-ins for `claude` and
 * `codex` that answer what the real ones answer when asked their version, whether they are signed in,
 * which models they offer, and one question. No real tool is run and no model is called. It checks in the real window what a
 * component test cannot lay out:
 *
 *   1. The sidebar has one Settings and no Models, and Settings lists its five pages.
 *   2. The two model cards are the same height with their parts on the same lines, before and after
 *      one of them has answered a test with a long sentence.
 *   3. Each card's two models are picked from the list its tool gives, and a pick is kept.
 *   4. Each accent swatch chosen in turn wears a ring whose centre is the swatch's own, set off by
 *      whole pixels on a display with one pixel to the point and on one with two. The centres are
 *      printed.
 *
 * Pictures of every page in both faces go to LIVE_DIR, with close-ups of the cards and the accent
 * row. They are page captures over a stand-in colour: the real material is not in them.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildFixtureHome } from "../../../fixtures/home.mjs";
import { checks, launchLiveApp, sleep, until, windowTools } from "./lib/live-app.mjs";

const outDir = process.env.LIVE_DIR ?? path.join(os.tmpdir(), "amc-live", "settings");
const at = buildFixtureHome(fs.mkdtempSync(path.join(os.tmpdir(), "amc-settings-home-")));
const tools = fs.mkdtempSync(path.join(os.tmpdir(), "amc-settings-tools-"));
const { check, finish } = checks();

// What each stand-in answers when asked which models it offers, in the shape the real tool uses.
const CLAUDE_OFFERS = [
  { value: "default", resolvedModel: "claude-opus-5-5", displayName: "Default (recommended)" },
  { value: "opus", resolvedModel: "claude-opus-5-5", displayName: "Opus 5.5" },
  { value: "sonnet", resolvedModel: "claude-sonnet-5-5", displayName: "Sonnet 5.5" },
  { value: "haiku", resolvedModel: "claude-haiku-5-5", displayName: "Haiku 5.5" },
];
const CODEX_OFFERS = [{ id: "gpt-6.1-sol", displayName: "GPT-6.1-Sol" }, { id: "gpt-6-luna", displayName: "GPT-6-Luna" }, { id: "gpt-hidden", displayName: "Hidden", hidden: true }];
const LINES = `const lines = (heard) => require("readline").createInterface({ input: process.stdin }).on("line", (line) => heard(JSON.parse(line)));`;

const CLAUDE = `#!/usr/bin/env node
const args = process.argv.slice(2);
${LINES}
if (args[0] === "--version") console.log("2.1.322 (Claude Code)");
else if (args[0] === "auth") console.log(JSON.stringify({ loggedIn: true, subscriptionType: "max" }));
else if (args.includes("--input-format")) lines((asked) => console.log(JSON.stringify({ type: "control_response", response: { subtype: "success", request_id: asked.request_id, response: { models: ${JSON.stringify(CLAUDE_OFFERS)} } } })));
else if (args[0] === "-p") console.log(JSON.stringify({ is_error: false, result: "", structured_output: { ok: true }, total_cost_usd: 0.002, usage: { input_tokens: 1840, output_tokens: 12 } }));
else process.exit(1);
`;
const CODEX = `#!/usr/bin/env node
const args = process.argv.slice(2);
${LINES}
if (args[0] === "--version") console.log("codex-cli 0.169.0");
else if (args[0] === "login") console.log("Logged in using ChatGPT");
else if (args[0] === "app-server") lines((asked) => {
  if (asked.method === "initialize") console.log(JSON.stringify({ id: asked.id, result: {} }));
  if (asked.method === "model/list") console.log(JSON.stringify({ id: asked.id, result: { data: ${JSON.stringify(CODEX_OFFERS)}, nextCursor: null } }));
});
else process.exit(1);
`;
fs.writeFileSync(path.join(tools, "claude"), CLAUDE, { mode: 0o755 });
fs.writeFileSync(path.join(tools, "codex"), CODEX, { mode: 0o755 });

const app = await launchLiveApp({ name: "settings", sourceHome: at.home, env: { AMC_CLAUDE_BIN: path.join(tools, "claude"), AMC_CODEX_BIN: path.join(tools, "codex") } });
const { page } = app;
const { texts, click, shots, noticesGone, unreachable } = windowTools(app, outDir);

/** Both faces of one part of the page, at twice the window's own scale. */
async function closeUps(name, selector) {
  const box = await page.eval(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x - 12, y: r.y - 12, width: r.width + 24, height: r.height + 24 }; })()`);
  for (const mode of ["dark", "light"]) {
    await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: mode }] });
    await until(() => page.eval(`document.documentElement.dataset.mode === ${JSON.stringify(mode)}`), 3_000, `the ${mode} face`);
    await sleep(150);
    await page.eval(`void (document.documentElement.style.background = ${JSON.stringify(mode === "dark" ? "rgb(30 32 44)" : "rgb(232 234 242)")})`);
    const { data } = await page.send("Page.captureScreenshot", { format: "png", clip: { ...box, scale: 2 } });
    await page.eval(`void (document.documentElement.style.background = "")`);
    const file = path.join(outDir, `${name}-${mode}.png`);
    fs.writeFileSync(file, Buffer.from(data, "base64"));
    console.log(`shot ${file}`);
  }
  await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
}

/** In the page: where each model card and each of its parts sits. */
const CARDS = `[...document.querySelectorAll(".models-card")].map((card) => ({
  height: card.getBoundingClientRect().height,
  parts: [...card.children].map((part) => Math.round(part.getBoundingClientRect().top * 100) / 100),
}))`;
async function cardsAlign(when) {
  const [claude, codex] = await page.eval(CARDS);
  check(`the two cards are the same height ${when}`, claude.height === codex.height, `${claude.height} and ${codex.height}`);
  check(`and their four parts start on the same lines ${when}`, claude.parts.length === 4 && claude.parts.join() === codex.parts.join(), `${claude.parts.join(" ")} | ${codex.parts.join(" ")}`);
}

/** In the page: the chosen swatch's box and its ring's, in points, and how far the ring is set off in the display's own pixels. */
const RING = `(() => {
  const swatch = document.querySelector(".look-swatch[data-selected]");
  const disc = swatch.getBoundingClientRect();
  const ring = getComputedStyle(swatch, "::after");
  const px = (name) => parseFloat(ring[name]);
  const borderBox = ring.boxSizing === "border-box";
  const width = px("width") + (borderBox ? 0 : px("borderLeftWidth") + px("borderRightWidth"));
  const height = px("height") + (borderBox ? 0 : px("borderTopWidth") + px("borderBottomWidth"));
  const glyph = swatch.querySelector("svg");
  const mark = glyph && getComputedStyle(glyph).display !== "none" ? glyph.getBoundingClientRect() : null;
  return {
    swatch: [disc.x + disc.width / 2, disc.y + disc.height / 2],
    ring: [disc.x + px("left") + width / 2, disc.y + px("top") + height / 2],
    glyph: mark && [mark.x + mark.width / 2, mark.y + mark.height / 2],
    offsetInPixels: px("left") * devicePixelRatio,
    ringWidth: px("borderLeftWidth"),
  };
})()`;

try {
  await until(() => page.eval(`document.querySelector(".dest") !== null`), 15_000, "the sidebar");
  const destinations = await texts(".dest .lib-nav-name");
  check("the sidebar has Settings and no Models", destinations.includes("Settings") && !destinations.includes("Models"), destinations.join(", "));
  await click(".dest .lib-nav-row", "Settings");
  await until(() => page.eval(`document.querySelector('nav[aria-label="Settings"]') !== null`), 8_000, "the pages of Settings");
  check("Settings lists its five pages", (await texts('nav[aria-label="Settings"] .lib-nav-name')).join("|") === "Appearance|Models|What is sent|Activity|About");
  check("and opens on Appearance", (await page.eval(`document.querySelector(".lib-reader-title").textContent`)) === "Appearance");
  await shots("appearance");

  console.log("accent     swatch centre · ring centre · glyph centre (points), at one and at two pixels to the point");
  const swatches = await page.eval(`[...document.querySelectorAll(".look-swatches input[type=radio]")].map((input) => input.getAttribute("aria-label"))`);
  const chosenInTurn = [...swatches, "A colour of your own"];
  for (const label of chosenInTurn) {
    if (label === "A colour of your own") {
      // The well's own panel is the system's and is not opened here: the colour is given as the panel gives it.
      await page.eval(`(() => { const well = document.querySelector(".look-well input"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(well, "#e0508c"); well.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    } else {
      await page.eval(`document.querySelector('.look-swatches input[aria-label="${label}"]').click()`);
    }
    await until(() => page.eval(`document.querySelector('.look-swatch[data-selected] input[aria-label="${label}"]') !== null`), 3_000, `${label} chosen`);
    const measured = [];
    for (const scale of [1, 2]) {
      await page.send("Emulation.setDeviceMetricsOverride", { width: 0, height: 0, deviceScaleFactor: scale, mobile: false });
      measured.push(await page.eval(RING));
    }
    await page.send("Emulation.clearDeviceMetricsOverride");
    const said = measured.map((m) => `${m.swatch.join(",")} · ${m.ring.join(",")}${m.glyph ? ` · ${m.glyph.join(",")}` : ""}`).join("   ");
    console.log(`  ${label.padEnd(20)} ${said}`);
    check(`${label}: the ring's centre is the swatch's, and the ring is set off by whole pixels`,
      measured.every((m) => m.ringWidth === 2 && m.ring.join() === m.swatch.join() && Number.isInteger(m.offsetInPixels) && (m.glyph === null || m.glyph.join() === m.swatch.join())), JSON.stringify(measured));
    if (label === "Match the Mac" || label === "Green" || label === "A colour of your own") await closeUps(`accent-${label === "Match the Mac" ? "mac" : label === "Green" ? "green" : "own"}`, ".look-accent");
  }
  await page.eval(`document.querySelector('.look-swatches input[aria-label="Match the Mac"]').click()`);
  const caption = await page.eval(`(() => { const row = document.querySelector(".look-swatches").getBoundingClientRect(), said = document.querySelector(".look-chosen").getBoundingClientRect(); return { text: document.querySelector(".look-chosen").textContent, off: (said.x + said.width / 2) - (row.x + row.width / 2) }; })()`);
  check("the caption says the Mac is matched, centred under the row", caption.text === "Matches the Mac" && Math.abs(caption.off) <= 0.5, JSON.stringify(caption));

  await click('nav[aria-label="Settings"] .lib-nav-row', "Models");
  await until(() => page.eval(`document.querySelectorAll(".models-card").length === 2`), 15_000, "the two cards");
  await noticesGone();
  check("each card says it is signed in, in words", (await texts(".models-signed")).join("|") === "Signed in on the max plan.2.1.322 (Claude Code)|Signed in.codex-cli 0.169.0", (await texts(".models-signed")).join("|"));
  check("nothing on the page says runner", !/runner/i.test(await page.eval(`document.querySelector(".models-page").innerText`)));
  check("both start switched off", (await page.eval(`[...document.querySelectorAll(".models-card .switch")].every((s) => !s.checked)`)) === true);
  await cardsAlign("as they open");
  await shots("models");
  check("every control on screen takes a real press: none lies in a part that drags the window", (await unreachable()).length === 0, (await unreachable()).join(" | "));
  await closeUps("models-cards", ".models-cards");

  const offeredIn = (name) => page.eval(`[...document.querySelectorAll('.models-card[aria-label="${name}"] select')].map((s) => [...s.options].map((o) => o.text).join(", ") + " = " + s.value)`);
  await until(async () => (await offeredIn("Claude")).length === 2 && (await offeredIn("Codex")).length === 2, 15_000, "each tool's list of models");
  check("Claude's two models are picked from the list Claude gives, each alias under its model",
    (await offeredIn("Claude")).join(" | ") === "Opus 5.5, Sonnet 5.5, Haiku 5.5 = claude-haiku-5-5 | Opus 5.5, Sonnet 5.5, Haiku 5.5 = claude-opus-5-5", (await offeredIn("Claude")).join(" | "));
  check("Codex's are picked from the list Codex gives, without the one it hides",
    (await offeredIn("Codex")).join(" | ") === "GPT-6.1-Sol, GPT-6-Luna = gpt-6-luna | GPT-6.1-Sol, GPT-6-Luna = gpt-6.1-sol", (await offeredIn("Codex")).join(" | "));
  await page.eval(`(() => {
    const reads = document.querySelector('.models-card[aria-label="Claude"] select');
    reads.value = "claude-sonnet-5-5";
    reads.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
  await until(async () => (await offeredIn("Claude"))[0].endsWith("= claude-sonnet-5-5"), 5_000, "the pick to be taken");
  await click('nav[aria-label="Settings"] .lib-nav-row', "Activity");
  await click('nav[aria-label="Settings"] .lib-nav-row', "Models");
  await until(async () => (await offeredIn("Claude")).length === 2, 15_000, "the cards again");
  check("a model picked is still the one chosen after leaving the page", (await offeredIn("Claude"))[0].endsWith("= claude-sonnet-5-5"), (await offeredIn("Claude"))[0]);
  await cardsAlign("with the models as pickers");
  await closeUps("models-pickers", ".models-cards");

  await page.eval(`document.querySelector('.models-card[aria-label="Claude"] .switch').click()`);
  await until(() => page.eval(`document.querySelector('.models-card[aria-label="Claude"] .switch').checked`), 5_000, "Claude switched on");
  await click('.models-card[aria-label="Claude"] .models-test .btn', "Test");
  await until(() => page.eval(`document.querySelector('.models-card[aria-label="Claude"] .models-test .models-line').textContent.includes("answered in")`), 15_000, "the stand-in's answer");
  await cardsAlign("after one has answered a test");
  await closeUps("models-cards-tested", ".models-cards");
  await page.eval(`document.querySelector(".models-scroll").scrollTo(0, 100000)`);
  await shots("models-limit");

  await click('nav[aria-label="Settings"] .lib-nav-row', "What is sent");
  await until(() => page.eval(`document.querySelector(".models-sends") !== null`), 8_000, "the places a reading sends from");
  check("What is sent lists where memories are kept, each with a switch", (await page.eval(`[...document.querySelectorAll(".models-sends tbody tr")].every((row) => row.querySelector(".switch") !== null)`)) === true);
  await shots("sent");

  await click('nav[aria-label="Settings"] .lib-nav-row', "Activity");
  await until(() => page.eval(`document.querySelector(".lib-reader-title").textContent === "Activity"`), 8_000, "the calls made");
  check("Activity lists the test that was just made", (await texts(".models-table tbody tr")).some((row) => row.includes("Test") && row.includes("Answered")));
  await shots("activity");
} finally {
  await app.stop();
  fs.rmSync(at.home, { recursive: true, force: true });
  fs.rmSync(tools, { recursive: true, force: true });
}
finish();
