/**
 * Live check for the welcome (run with: pnpm build && node apps/desktop/scripts/intro-live.mjs)
 *
 * Boots the BUILT app on a scratch data folder and the fixture home with `AMC_INTRO=1`: without it a
 * check's window, which is always a first launch, never meets the welcome. It checks in the real
 * window what a component test cannot lay out or time:
 *
 *   1. The welcome is up before the Library, over the whole window, with the app under it not drawn
 *      and out of reach.
 *   2. The word is written along its one stroke: held part-way it is part drawn and nothing else
 *      shows; left alone it finishes and what the app is arrives under it, inside the window.
 *   3. Open Stow lifts it away and the window is the Library.
 *   4. Settings > About shows it again; with motion reduced the word is simply there and Escape
 *      opens the app at once.
 *   5. Launched again on the same data folder, it does not show.
 *
 * Pictures of the writing held part-way and of the settled welcome, in both faces, go to LIVE_DIR.
 * They are page captures over a stand-in colour: the real material is not in them, and the motion
 * (the writing, the settle, the lift) cannot be pictured at all.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildFixtureHome } from "../../../fixtures/home.mjs";
import { checks, launchLiveApp, until, windowTools } from "./lib/live-app.mjs";

const outDir = process.env.LIVE_DIR ?? path.join(os.tmpdir(), "amc-live", "intro");
const at = buildFixtureHome(fs.mkdtempSync(path.join(os.tmpdir(), "amc-intro-home-")));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "amc-intro-data-"));
const { check, finish } = checks();
// Both launches keep their data in one folder, as two launches of the person's own copy do.
const launch = () => launchLiveApp({ name: "intro", sourceHome: at.home, env: { AMC_INTRO: "1", AMC_USER_DATA: path.join(dataDir, "userData"), AMC_HOME: path.join(dataDir, "home") } });

/** In the page: how much of the word is still to be written (1 is none of it, 0 all), and whether what the app is shows. */
const WRITING = `(() => {
  const stroke = document.querySelector(".intro-word path");
  return stroke === null ? null : {
    left: parseFloat(getComputedStyle(stroke).strokeDashoffset),
    aboutShows: getComputedStyle(document.querySelector(".intro-open")).visibility === "visible",
  };
})()`;
const welcomeUp = (page) => page.eval(`document.querySelector(".intro") !== null`);
const running = (page) => page.eval(`document.querySelector(".intro").getAnimations({ subtree: true }).length`);

let app = await launch();
try {
  const { page } = app;
  const { click, shots, unreachable } = windowTools(app, outDir);
  await until(() => page.eval(`document.querySelector(".intro, .dest") !== null`), 15_000, "the window");
  check("the welcome is up on a first launch", await welcomeUp(page));
  // Held where the pen is part-way through the word, whatever time the launch took.
  await page.eval(`void document.querySelector(".intro").getAnimations({ subtree: true }).forEach((animation) => { animation.pause(); animation.currentTime = 1500; })`);
  const held = await page.eval(WRITING);
  check("part-way, the word is part written and nothing else shows", held.left > 0.2 && held.left < 0.8 && !held.aboutShows, JSON.stringify(held));
  const under = await page.eval(`(() => { const app = document.querySelector(".app"); return { inert: app.inert, opacity: getComputedStyle(app).opacity }; })()`);
  check("the app under it is not drawn and cannot be reached", under.inert && under.opacity === "0", JSON.stringify(under));
  await shots("writing");

  await page.eval(`void document.querySelector(".intro").getAnimations({ subtree: true }).forEach((animation) => animation.play())`);
  await until(async () => (await running(page)) === 0, 10_000, "the writing and the arrival to end");
  const settled = await page.eval(WRITING);
  check("left alone, the word is written and what the app is has arrived", settled.left === 0 && settled.aboutShows, JSON.stringify(settled));
  const laidOut = await page.eval(`(() => {
    const box = (selector) => document.querySelector(selector).getBoundingClientRect();
    const [word, button, cover] = [box(".intro-word"), box(".intro-open"), box(".intro")];
    return { covers: cover.width === innerWidth && cover.height === innerHeight, inside: word.top >= 44 && button.bottom <= innerHeight - 24,
      offCentre: [word, button].map((part) => part.x + part.width / 2 - innerWidth / 2), facts: document.querySelectorAll(".intro-facts li").length };
  })()`);
  check("it covers the window, with the word and the button inside it and centred", laidOut.covers && laidOut.inside && laidOut.offCentre.every((off) => Math.abs(off) <= 0.5), JSON.stringify(laidOut));
  check("it says the three things a new person needs", laidOut.facts === 3);
  check("the button takes a real press: only the top strip drags the window", (await unreachable()).length === 0, (await unreachable()).join(" | "));
  await shots("welcome");

  await click(".intro-open", "Open Stow");
  await until(async () => !(await welcomeUp(page)), 5_000, "the welcome to lift away");
  await until(() => page.eval(`document.querySelector(".col-list .lib-row") !== null`), 15_000, "the Library's rows");
  const opened = await page.eval(`(() => { const app = document.querySelector(".app"); return { inert: app.inert, section: document.querySelector(".dest [aria-current]").textContent }; })()`);
  check("Open Stow shows the Library, within reach", !opened.inert && opened.section === "Library", JSON.stringify(opened));
  await until(() => page.eval(`getComputedStyle(document.querySelector(".app")).opacity === "1"`), 3_000, "the app to be drawn");
  check("main keeps that it was opened, beside the app's other data", fs.existsSync(path.join(dataDir, "userData", "welcomed")));
  await shots("opened");

  await click(".dest .lib-nav-row", "Settings");
  await click('nav[aria-label="Settings"] .lib-nav-row', "About");
  await until(() => page.eval(`document.querySelector(".about-welcome") !== null`), 8_000, "About");
  await shots("about");
  await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }, { name: "prefers-reduced-motion", value: "reduce" }] });
  await click(".about-welcome .btn", "Show the welcome again");
  check("About shows the welcome again", await welcomeUp(page));
  const still = await page.eval(WRITING);
  check("with motion reduced the word is simply there and nothing moves", still.left === 0 && still.aboutShows && (await running(page)) === 0, JSON.stringify(still));
  await page.eval(`void window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
  check("and Escape opens the app at once", !(await welcomeUp(page)));
  await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
} finally {
  await app.stop();
}

app = await launch();
try {
  await until(() => app.page.eval(`document.querySelector(".col-list .lib-row") !== null`), 15_000, "the Library's rows");
  check("launched again on the same data, the welcome does not show", !(await welcomeUp(app.page)));
} finally {
  await app.stop();
  fs.rmSync(at.home, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
}
finish();
