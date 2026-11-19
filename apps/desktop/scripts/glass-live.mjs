/**
 * Live check for the glass controls (run with: pnpm build && node apps/desktop/scripts/glass-live.mjs)
 *
 * Boots the BUILT app on the fixture home and looks at what floats over content:
 *
 *   1. The segmented control and a column head's buttons, worded or not, a reader bar's among
 *      them, are each drawn with a blurred backdrop.
 *   2. A reader's page starts below its bar, scrolls up under it, and the bar's buttons still take
 *      the press there.
 *   3. Words scrolled up under a bar's button cannot be read through it. This is measured on the
 *      page as the window has it, with nothing behind: over a solid stand-in the blur always covers.
 *   4. Asked for less transparency, the same controls are solid.
 *
 * No model is called. Pictures of both faces go to LIVE_DIR. They show the page's own glass over a
 * stand-in for the window's material, still: not the material itself, and not the motion.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildFixtureHome } from "../../../fixtures/home.mjs";
import { checks, launchLiveApp, sleep, until, windowTools } from "./lib/live-app.mjs";

const outDir = process.env.LIVE_DIR ?? path.join(os.tmpdir(), "amc-live", "glass");
const at = buildFixtureHome(fs.mkdtempSync(path.join(os.tmpdir(), "amc-glass-home-")));
const { check, finish } = checks();
// A page long enough for its lines to pass under the bar's buttons.
const LONG_PAGE = "long-page";
const line = "The code, the notes and the release plan were all read again from the top, slowly, to see what still held.";
fs.writeFileSync(path.join(at.repo, `spaces/atlas/${LONG_PAGE}.md`),
  `---\nname: ${LONG_PAGE}\ndescription: A long page\nmetadata:\n  type: project\n---\n\n${Array.from({ length: 40 }, () => line).join("\n\n")}\n`);

const app = await launchLiveApp({ name: "glass", sourceHome: at.home });
const { page } = app;
const { click, shots } = windowTools(app, outDir);
const opened = (title) => until(() => page.eval(`document.querySelector(".lib-reader-title")?.textContent === ${JSON.stringify(title)}`), 8_000, `${title} in the reader`);
const backdropOf = (selector) => page.eval(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).backdropFilter`);
const GLASS = [".col-reader .seg", ".col-list .col-head .icon-btn", ".lib-reader-bar .btn"];
const scrollReader = (top) => page.eval(`void document.querySelector(".lib-reader-scroll").scrollTo(0, ${top})`);

/**
 * How sharp the sharpest thing behind `button` is: the largest step in brightness (0 to 255) between
 * two pixels side by side inside it, with its own label hidden. Words showing through are steps of
 * dozens; a blur leaves one or two. `backdrop` is the button's `backdrop-filter` for the length of
 * the look, or null for its own.
 */
async function sharpestBehind(button, backdrop = null) {
  const hide = (on) => page.eval(`(() => {
    const el = document.querySelector(${JSON.stringify(button)});
    el.style.color = ${on} ? "transparent" : "";
    el.style.backdropFilter = ${on} ? ${JSON.stringify(backdrop ?? "")} : "";
    for (const child of el.children) child.style.visibility = ${on} ? "hidden" : "";
    const r = el.getBoundingClientRect();
    return { x: r.x + 8, y: r.y + 6, width: r.width - 16, height: r.height - 12, scale: 1 };
  })()`);
  const clip = await hide(true);
  await sleep(250);
  const { data } = await page.send("Page.captureScreenshot", { format: "png", clip });
  await hide(false);
  return page.eval(`(async () => {
    const img = new Image();
    img.src = "data:image/png;base64,${data}";
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.width; canvas.height = img.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, img.width, img.height).data;
    const light = (i) => 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
    let step = 0;
    for (let y = 0; y < img.height; y++) for (let x = 0; x + 1 < img.width; x++) {
      const i = (y * img.width + x) * 4;
      step = Math.max(step, Math.abs(light(i + 4) - light(i)));
    }
    return Math.round(step);
  })()`);
}

try {
  await until(() => page.eval(`document.querySelector(".lib-reader-title") !== null`), 15_000, "the library");
  await sleep(400);
  await shots("library");
  const rest = await page.eval(`(() => { const bar = document.querySelector(".lib-reader-bar").getBoundingClientRect(); return { bar: Math.round(bar.bottom), title: Math.round(document.querySelector(".lib-reader-title").getBoundingClientRect().top) }; })()`);
  check("a page at rest starts below its bar", rest.title >= rest.bar, JSON.stringify(rest));

  await click(".lib-reader-bar .btn", "Edit");
  await until(() => page.eval(`document.querySelector(".lib-editor-bar .seg") !== null`), 10_000, "the editor");
  await sleep(400);
  await shots("editor");
  await click(".lib-reader-bar .btn", "Cancel");

  await click(".dest .lib-nav-row", "Sessions");
  await until(() => page.eval(`document.querySelectorAll(".lib-row").length === 3`), 8_000, "the conversations");
  await click(".lib-row", "Tagging the 2.4 release");
  await opened("Tagging the 2.4 release");
  await until(() => page.eval(`document.querySelectorAll(".ses-blocks > *").length >= 8`), 8_000, "the transcript");
  await sleep(400);
  await shots("sessions");
  for (const selector of GLASS.slice(0, 2)) check(`${selector} blurs what is behind it`, (await backdropOf(selector)).includes("blur("), await backdropOf(selector));

  // Every folded row is opened so the transcript is taller than the window, then its first words
  // are brought up level with the segmented control.
  await page.eval(`void document.querySelectorAll(".ses-fold-row").forEach((row) => row.click())`);
  await sleep(500);
  const under = await page.eval(`(() => {
    const scroller = document.querySelector(".lib-reader-scroll");
    const seg = document.querySelector(".lib-reader-bar .seg").getBoundingClientRect();
    const words = document.querySelector(".ses-user").getBoundingClientRect();
    scroller.scrollBy(0, words.top - seg.top);
    const segment = document.querySelector(".lib-reader-bar .seg-opt:not([data-selected])");
    const spot = segment.getBoundingClientRect();
    return { scrolled: scroller.scrollTop, takesPress: segment.contains(document.elementFromPoint(spot.x + spot.width / 2, spot.y + spot.height / 2)) };
  })()`);
  check("the page scrolls up under the bar, and a segment there still takes the press", under.scrolled > 0 && under.takesPress, JSON.stringify(under));
  await sleep(300);
  await shots("sessions-scrolled");

  await click(".dest .lib-nav-row", "MCP servers");
  await until(() => page.eval(`document.querySelectorAll(".col-list .col-head .btn").length === 2`), 8_000, "the servers' head");
  await sleep(400);
  await shots("servers");
  check(".col-list .col-head .btn blurs what is behind it", (await backdropOf(".col-list .col-head .btn")).includes("blur("), await backdropOf(".col-list .col-head .btn"));

  await click(".dest .lib-nav-row", "Library");
  await until(() => page.eval(`document.querySelector(".lib-reader-bar .btn") !== null`), 8_000, "the library's reader");
  check(".lib-reader-bar .btn blurs what is behind it", (await backdropOf(GLASS[2])).includes("blur("), await backdropOf(GLASS[2]));
  await scrollReader(90);
  await sleep(300);
  await shots("library-scrolled");

  await click(".lib-row", LONG_PAGE);
  await opened(LONG_PAGE);
  await until(() => page.eval(`document.querySelectorAll(".lib-reader-body p").length === 40`), 8_000, "the long page");
  // One full line of the page is brought level with the middle of the bar's first button.
  const lined = await page.eval(`(() => {
    const button = document.querySelector(".lib-reader-bar .btn").getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(document.querySelectorAll(".lib-reader-body p")[12]);
    const first = range.getClientRects()[0];
    document.querySelector(".lib-reader-scroll").scrollBy(0, first.top + first.height / 2 - (button.top + button.height / 2));
    return { button: [Math.round(button.left), Math.round(button.right)], line: [Math.round(first.left), Math.round(first.right)] };
  })()`);
  check("a line of the page lies under the bar's first button", lined.line[0] < lined.button[0] && lined.line[1] > lined.button[1], JSON.stringify(lined));
  await sleep(300);
  for (const mode of ["dark", "light"]) {
    await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: mode }] });
    await until(() => page.eval(`document.documentElement.dataset.mode === ${JSON.stringify(mode)}`), 3_000, `the ${mode} face`);
    const through = await sharpestBehind(".lib-reader-bar .btn", "none");
    const blurred = await sharpestBehind(".lib-reader-bar .btn");
    check(`${mode}: words under a bar's button cannot be read through it`, through >= 30 && blurred <= 4, `sharpest step ${blurred} of 255 behind the glass, ${through} with its blur off`);
  }
  await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
  await shots("library-words-under");

  await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-transparency", value: "reduce" }] });
  await sleep(200);
  check("asked for less transparency, a glass control is solid", (await backdropOf(GLASS[2])) === "none" && (await backdropOf(".seg")) === "none", await backdropOf(GLASS[2]));
  console.log(`shot ${await app.screenshot(path.join(outDir, "library-solid-dark.png"), "rgb(30 32 44)")}`);
} finally {
  await app.stop();
  fs.rmSync(at.home, { recursive: true, force: true });
}
finish();
