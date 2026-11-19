/**
 * Pictures of the landing page itself, for checking it by eye
 * (run with: apps/desktop/node_modules/.bin/electron apps/landing/scripts/page-shots.mjs [outDir])
 *
 * Loads ../index.html from the file system in a window nobody can see (see below),
 * and writes it a screenful at a time at 1440 and 390 wide in both faces, then the bar with words
 * scrolled under it, and prints whether those words can be read through the bar. Motion is
 * switched off for those pictures, every section's left and right edges are compared, and the bar
 * and each part of the opening are measured against the page's centre line. Privacy and Terms are
 * pictured once each. At the end motion is allowed, and the opening's window, the sentence, the
 * working tiles and each chip of the real window are checked and pictured.
 */
import { app, BrowserWindow } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const outDir = process.argv[2] ?? path.join(os.tmpdir(), "stow-landing");
const pageFile = (name) => path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", name);
const indexFile = pageFile("index.html");

app.dock?.hide();
// Waited for with `then`: Electron does not become ready while its main module is still awaiting.
app.whenReady().then(picture);

async function picture() {

// As the app's own quiet windows are (apps/desktop/src/main/quiet-windows.ts): on screen so that
// Chromium paints it, at an alpha nobody can see, taking neither the keyboard nor the mouse.
const win = new BrowserWindow({ show: false, focusable: false, opacity: 1 / 255, hasShadow: false, width: 1440, height: 900 });
win.setIgnoreMouseEvents(true);
win.setAlwaysOnTop(true, "screen-saver");
win.showInactive();
// Loaded once before anything is asked of the page: a command sent to a window with no page never answers.
await win.loadFile(indexFile);
const cdp = win.webContents.debugger;
cdp.attach("1.3");
const ask = async (expression) => (await cdp.sendCommand("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.value;
const settle = (ms) => new Promise((done) => setTimeout(done, ms));

async function face(width, height, mode, stillness, file = indexFile) {
  await cdp.sendCommand("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 600 });
  await cdp.sendCommand("Emulation.setEmulatedMedia", { features: [
    { name: "prefers-color-scheme", value: mode },
    { name: "prefers-reduced-motion", value: stillness },
  ] });
  await win.loadFile(file);
  await ask(`Promise.all([...document.images].map((img) => { img.loading = "eager"; return img.decode().catch(() => {}); }))`);
  await settle(1_200);
}

/** What the window is showing, as a visitor at this scroll position sees it: the bar included, where it floats. */
async function shot(name, clip) {
  const { data } = await cdp.sendCommand("Page.captureScreenshot", { format: "png", ...(clip ? { clip } : {}) });
  const file = path.join(outDir, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(data, "base64"));
  console.log(`shot ${file}`);
}

/** Largest step in brightness between two pixels side by side in a strip of the window: words show as steps of dozens, a blur as one or two. */
async function sharpest(clip) {
  const { data } = await cdp.sendCommand("Page.captureScreenshot", { format: "png", clip: { ...clip, scale: 1 } });
  return ask(`(async () => {
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
    for (let y = 0; y < img.height; y++) for (let x = 0; x + 1 < img.width; x++) step = Math.max(step, Math.abs(light((y * img.width + x + 1) * 4) - light((y * img.width + x) * 4)));
    return Math.round(step);
  })()`);
}

/** How far the bar and each part of the opening lie from the page's centre line, and whether the
 *  marks at the window's two sides mirror each other inside the column. A line of the headline is
 *  measured by its ink: its words, and the icon by its own box, which its turn does not move. */
const OPENING_MEASURES = `(() => {
  const middle = document.documentElement.clientWidth / 2;
  const off = (left, right) => (left + right) / 2 - middle;
  const boxOff = (selector) => { const box = document.querySelector(selector).getBoundingClientRect(); return off(box.left, box.right); };
  const round = (n) => Math.round(n * 100) / 100;

  const headline = document.querySelector(".opening h1");
  const inkLines = [];
  const addInk = (left, right, top, bottom) => {
    const line = inkLines.find((ink) => (top + bottom) / 2 > ink.top && (top + bottom) / 2 < ink.bottom);
    if (line === undefined) inkLines.push({ left, right, top, bottom });
    else Object.assign(line, { left: Math.min(line.left, left), right: Math.max(line.right, right) });
  };
  const range = document.createRange();
  for (const node of headline.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      // A word at a time: the space a line ends on is not ink.
      for (const word of node.textContent.matchAll(/[^\\s\\u00a0]+/g)) {
        range.setStart(node, word.index);
        range.setEnd(node, word.index + word[0].length);
        for (const box of range.getClientRects()) addInk(box.left, box.right, box.top, box.bottom);
      }
    } else {
      const box = node.getBoundingClientRect();
      const centre = (box.left + box.right) / 2;
      addInk(centre - node.offsetWidth / 2, centre + node.offsetWidth / 2, box.top, box.bottom);
    }
  }

  const bar = document.querySelector(".nav").getBoundingClientRect();
  const column = document.querySelector(".opening").getBoundingClientRect();
  const marks = [...document.querySelectorAll(".drift li")].map((li) => li.getBoundingClientRect());
  const leftMarks = marks.filter((box) => box.right <= middle);
  const rightMarks = marks.filter((box) => box.left >= middle);
  // Each mark at the left against the one at the right that comes nearest to being its reflection.
  const apart = (box, other) => Math.max(Math.abs((middle - box.left) - (other.right - middle)), Math.abs(box.top - other.top), Math.abs(box.width - other.width));
  const unmirrored = Math.max(...leftMarks.map((box) => Math.min(...rightMarks.map((other) => apart(box, other)))));
  const beyond = Math.max(0, ...marks.map((box) => Math.max(column.left - box.left, box.right - column.right)));

  return "bar " + round(bar.width) + " wide, " + round(off(bar.left, bar.right)) + " off centre; opening off centre: headline lines "
    + inkLines.map((ink) => round(off(ink.left, ink.right))).join(" ") + ", sentence " + round(boxOff(".opening .lede")) + ", button " + round(boxOff(".opening .button"))
    + ", requirements " + round(boxOff(".opening .requires")) + ", window " + round(boxOff(".stage .window-wrap"))
    + "; marks " + leftMarks.length + " left and " + rightMarks.length + " right, " + round(unmirrored) + " out of mirror, " + round(beyond) + " beyond the column";
})()`;

try {
  fs.mkdirSync(outDir, { recursive: true });
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    for (const mode of ["light", "dark"]) {
      await face(width, height, mode, "reduce");
      const tall = await ask(`document.documentElement.scrollHeight`);
      console.log(`${width} ${mode}: ${tall} tall, widest thing ${await ask(`document.documentElement.scrollWidth`)}`);
      // One column: every section and the foot begin and end on the same two lines.
      const edges = await ask(`[...document.querySelectorAll("main > section, footer")].map((el) => { const box = el.getBoundingClientRect(); return (el.className || el.tagName.toLowerCase()).split(" ")[0] + " " + box.left + " to " + box.right; })`);
      const lines = new Set(edges.map((edge) => edge.slice(edge.indexOf(" ") + 1)));
      console.log(`${width} ${mode}: ${lines.size === 1 ? `every section runs ${[...lines][0]}` : `edges DIFFER: ${edges.join("; ")}`}`);
      console.log(`${width} ${mode}: ${await ask(OPENING_MEASURES)}`);
      // The page a screenful at a time, as it is scrolled through.
      for (let at = 0, n = 1; at < tall; at += height - 80, n += 1) {
        await ask(`scrollTo(0, ${at})`);
        await settle(250);
        await shot(`view-${width}-${mode}-${String(n).padStart(2, "0")}`);
      }

      // Words scrolled under the bar: a line of a paragraph level with the bar's middle. The bar's own
      // words are hidden for the measure, and the same strip is measured with the bar's blur off, to
      // show that there were words there to blur.
      const strip = await ask(`(() => {
        const bar = document.querySelector(".nav").getBoundingClientRect();
        const lede = document.querySelector(".statement p");
        scrollTo(0, lede.getBoundingClientRect().top + scrollY - (bar.top + bar.height / 2) + 12);
        return { x: bar.x + 24, y: bar.y + scrollY + 8, width: bar.width - 48, height: bar.height - 16 };
      })()`);
      await settle(400);
      // A clip is measured from the top of the page, not of the window.
      await shot(`bar-${width}-${mode}`, { x: 0, y: await ask(`scrollY`), width, height: 140, scale: 2 });
      await ask(`void document.querySelector(".nav").style.setProperty("color", "transparent"), document.querySelectorAll(".nav *").forEach((el) => { el.style.visibility = "hidden"; })`);
      const blurred = await sharpest(strip);
      await ask(`void (document.querySelector(".nav").style.backdropFilter = "none", document.querySelector(".nav").style.webkitBackdropFilter = "none")`);
      const through = await sharpest(strip);
      console.log(`${width} ${mode}: sharpest step under the bar ${blurred} of 255, ${through} with its blur off`);
    }
  }

  for (const [name, width, height, mode] of [["privacy", 1440, 900, "light"], ["terms", 390, 844, "dark"]]) {
    await face(width, height, mode, "reduce", pageFile(`${name}.html`));
    console.log(`${name}: ${await ask(`document.documentElement.scrollHeight`)} tall, widest thing ${await ask(`document.documentElement.scrollWidth`)}, download goes to ${await ask(`document.querySelector("[data-download]").href`)}`);
    await shot(`${name}-${width}-${mode}`);
  }

  // With motion allowed: the window lies back at the top of the page and stands as it is scrolled,
  // the sentence is dim until it is read, and a tile waits below the fold and arrives when reached.
  await face(1440, 900, "light", "no-preference");
  const stood = () => ask(`getComputedStyle(document.querySelector(".opening")).getPropertyValue("--stand").trim()`);
  const lit = () => ask(`document.querySelectorAll(".lit .w.on").length + " of " + document.querySelectorAll(".lit .w").length`);
  console.log(`at the top: the window has stood ${await stood()}, words lit ${await lit()}; ${await ask(OPENING_MEASURES)}`);
  await shot("motion-top");
  await ask(`scrollTo(0, 450)`);
  await settle(600);
  console.log(`scrolled half a screen: the window has stood ${await stood()}`);
  await shot("motion-stood");
  await ask(`document.querySelector(".lit").scrollIntoView({ behavior: "instant", block: "center" })`);
  await settle(700);
  console.log(`the sentence at the middle of the screen: words lit ${await lit()}`);
  await shot("motion-sentence");
  const waits = await ask(`[...document.querySelectorAll(".tile")].every((el) => getComputedStyle(el).opacity === "0")`);
  await ask(`document.querySelector("#work .bento").scrollIntoView({ behavior: "instant" })`);
  await settle(2_600);
  const arrived = await ask(`[...document.querySelectorAll(".tile.seen")].length`);
  console.log(`tiles: below the fold wait = ${waits}; seen after scrolling to them = ${arrived}; copies gathered = ${await ask(`document.querySelector("[data-dupes]").dataset.dupes`)}`);

  // The working copies, pressed.
  await ask(`void (document.querySelector("[data-approve]").click(), document.querySelector("[data-model-switch]").click(), document.querySelector("[data-check]").click(), document.querySelector('.swatches [aria-label="Orange"]').click())`);
  await settle(2_600);
  console.log(`pressed: finding ${await ask(`document.querySelector(".finding").dataset.finding`)}, model ${await ask(`document.querySelector(".tile-model").dataset.model`)}, servers ${await ask(`[...document.querySelectorAll(".servers li")].map((li) => li.dataset.state).join(" ")`)}, accent ${await ask(`document.documentElement.style.getPropertyValue("--accent")`)}`);
  await shot("pressed-tiles");
  await ask(`void document.querySelector("[data-approve]").click()`);
  console.log(`undone: finding ${await ask(`document.querySelector(".finding").dataset.finding`)}`);

  for (const chip of await ask(`[...document.querySelectorAll(".chips button")].map((b) => b.dataset.screen)`)) {
    await ask(`void document.querySelector('.chips [data-screen="${chip}"]').click()`);
    await ask(`document.querySelector("#app").scrollIntoView({ behavior: "instant" })`);
    await ask(`Promise.all([...document.querySelectorAll("#app picture:not([hidden]) img")].map((img) => { img.loading = "eager"; return img.decode().catch(() => {}); }))`);
    await settle(700);
    await shot(`screen-${chip}`);
  }
} finally {
  app.exit(0);
}
}
