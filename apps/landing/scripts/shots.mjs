/**
 * Remakes the page's pictures of the app (run with: pnpm build && node apps/landing/scripts/shots.mjs [screen ...])
 *
 * Boots the BUILT app in a hidden window on the fixture home, whose people and projects are invented,
 * walks to each screen the page shows, and writes both faces of it into ../assets at two pixels to
 * the point. No real tool is run and no model is called.
 *
 * These are page captures: the window's frame and its traffic lights are not in them (the page draws
 * those), and the Mac's material behind the sidebar is stood in for by GROUND.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildFixtureHome } from "../../../fixtures/home.mjs";
import { launchLiveApp, sleep, until, windowTools } from "../../desktop/scripts/lib/live-app.mjs";

// Screens named on the command line are the only ones remade. With none named, all are.
const wanted = process.argv.slice(2);
const assets = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../assets");
// What the sidebar's material makes of the page's own indigo wash, near enough.
const GROUND = {
  dark: "linear-gradient(160deg, rgb(44 42 78), rgb(26 26 40) 55%, rgb(30 28 52))",
  light: "linear-gradient(160deg, rgb(226 228 250), rgb(236 237 244) 55%, rgb(228 230 248))",
};

const at = buildFixtureHome(fs.mkdtempSync(path.join(os.tmpdir(), "stow-landing-home-")));
const app = await launchLiveApp({ name: "landing", sourceHome: at.home, timeoutMs: 60_000 });
const { page } = app;
const { text, click, noticesGone } = windowTools(app, assets);
const shown = (expression, what, ms = 15_000) => until(() => page.eval(expression), ms, what);

async function picture(name) {
  await noticesGone();
  const window = await page.eval(`({ x: 0, y: 0, width: innerWidth, height: innerHeight })`);
  for (const mode of ["dark", "light"]) {
    await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: mode }] });
    await shown(`document.documentElement.dataset.mode === "${mode}"`, `the ${mode} face`, 3_000);
    await sleep(400);
    await page.eval(`void (document.documentElement.style.background = ${JSON.stringify(GROUND[mode])})`);
    const { data } = await page.send("Page.captureScreenshot", { format: "webp", quality: 92, clip: { ...window, scale: 2 } });
    await page.eval(`void (document.documentElement.style.background = "")`);
    const file = path.join(assets, `${name}-${mode}.webp`);
    fs.writeFileSync(file, Buffer.from(data, "base64"));
    console.log(`shot ${file}`);
  }
}

/** Walks to one of the page's screens and pictures it, unless other screens were asked for by name. */
async function screen(name, walkThere) {
  if (wanted.length > 0 && !wanted.includes(name)) return;
  await walkThere();
  await picture(name);
}

try {
  fs.mkdirSync(assets, { recursive: true });

  await shown(`document.querySelectorAll(".lib-nav-row").length > 1 && document.querySelector(".lib-reader-title") !== null`, "the library");
  await until(() => text(".dest-count"), 15_000, "the count of findings beside Review");

  await screen("library", async () => {
    await page.eval(`document.querySelector('input[name="library-layout"][aria-label="Grid"]').click()`);
    await shown(`document.querySelectorAll(".lib-card").length > 8`, "the library as a grid of cards");
    await sleep(800);
  });

  await screen("review", async () => {
    await click(".dest .lib-nav-row", "Review");
    await shown(`document.querySelectorAll(".rev-row").length > 0`, "the findings");
    await click(".rev-row", "links to 1 file that is not there");
    await shown(`document.querySelector(".fd-line[data-kind=del]") !== null`, "the diff of the fix");
  });

  await screen("health", async () => {
    await click(".dest .lib-nav-row", "Review");
    await click(".lib-nav[aria-label=Review] .lib-nav-row", "Health");
    await shown(`document.querySelector(".models-page .models-table") !== null`, "the measures", 90_000);
    await sleep(3_000);
  });

  await screen("sessions", async () => {
    await click(".dest .lib-nav-row", "Sessions");
    await shown(`document.querySelectorAll(".lib-row").length > 0`, "the sessions", 30_000);
    await click(".lib-row", "Tagging the 2.4 release");
    await shown(`document.querySelector(".lib-reader-title") !== null`, "the conversation");
    await sleep(1_000);
  });

  await screen("servers", async () => {
    await click(".dest .lib-nav-row", "MCP servers");
    await shown(`document.querySelectorAll(".col-list .lib-row").length > 0`, "the servers");
    await click(".col-list .lib-row");
    await shown(`document.querySelector(".lib-reader-title") !== null`, "a server's page");
    await sleep(600);
  });

  await screen("settings", async () => {
    await click(".dest .lib-nav-row", "Settings");
    await shown(`document.querySelector('nav[aria-label="Settings"]') !== null`, "the pages of Settings");
    await sleep(600);
  });
} finally {
  await app.stop();
  fs.rmSync(at.home, { recursive: true, force: true });
}
