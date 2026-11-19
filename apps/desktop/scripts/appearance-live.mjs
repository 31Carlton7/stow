/**
 * Live check for the accent, the agents' marks and the list's heading
 * (run with: pnpm build && node apps/desktop/scripts/appearance-live.mjs)
 *
 * Boots the BUILT app on a scratch data folder, pointed at the fixture home (fixtures/home.mjs), and
 * checks in the real window what a component test cannot compute:
 *
 *   1. A library row wears its agent's mark, and the heading of one agent's kind is the mark, the
 *      name and the kind, with no dot.
 *   2. Settings opens on its Appearance page. A swatch and the colour well change the accent at once.
 *   3. The shades the stylesheet makes from the one colour can be read: the label on a filled
 *      button, and the accent's ink on the panel, for each of the Mac's eight on both faces. The
 *      ratios are printed.
 *   4. The choice is kept: a second start on the same data folder wears it.
 *
 * Pictures of both faces go to LIVE_DIR (default: a folder under the system temp directory). They
 * are page captures over a stand-in colour: the real material, the traffic lights and the system's
 * own colour panel are not in them.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildFixtureHome } from "../../../fixtures/home.mjs";
import { checks, launchLiveApp, sleep, until, windowTools } from "./lib/live-app.mjs";

const outDir = process.env.LIVE_DIR ?? path.join(os.tmpdir(), "amc-live", "appearance");
const at = buildFixtureHome(fs.mkdtempSync(path.join(os.tmpdir(), "amc-appearance-home-")));
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "amc-appearance-data-"));
const { check, finish } = checks();
const PRESETS = ["Blue", "Purple", "Pink", "Red", "Orange", "Yellow", "Green", "Graphite"];
/** The least a label or a line of accent text may stand off its ground: WCAG's floor for large text and for a control. */
const FLOOR = 3;

/** In the page: a CSS colour as the browser paints it, and the contrast of two of them. */
const MEASURE = `
  const rgb = (colour) => { const c = new OffscreenCanvas(1, 1).getContext("2d", { willReadFrequently: true }); c.fillStyle = colour; c.fillRect(0, 0, 1, 1); return [...c.getImageData(0, 0, 1, 1).data].slice(0, 3); };
  const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const contrast = (a, b) => { const [hi, lo] = [lum(rgb(a)), lum(rgb(b))].sort((x, y) => y - x); return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100; };
  const shade = (name) => { const probe = document.createElement("i"); probe.style.color = "var(" + name + ")"; document.body.append(probe); const painted = getComputedStyle(probe).color; probe.remove(); return painted; };
`;

let app = await launchLiveApp({ name: "appearance", sourceHome: at.home, env: { AMC_USER_DATA: userData } });
try {
  const { page } = app;
  const tools = windowTools(app, outDir);
  await until(() => page.eval(`document.querySelectorAll(".lib-row").length > 0`), 15_000, "the library's rows");

  const rowMarks = await page.eval(`[...document.querySelectorAll(".lib-row")].map((row) => row.querySelector(".lib-row-head > svg[data-brand]")?.dataset.brand ?? null)`);
  check("every library row wears its agent's mark", rowMarks.length > 0 && rowMarks.every((mark) => mark !== null), JSON.stringify([...new Set(rowMarks)]));
  await tools.click(".lib-nav-row[data-nested]", "Memory");
  const heading = await until(() => page.eval(`(() => { const h = document.querySelector(".lib-list-title"); return h.querySelector(".lib-list-kind") ? [...h.children].map((part) => part.dataset.brand ?? part.textContent) : null; })()`), 8_000, "the heading of one agent's kind");
  check("the heading is the mark, the agent's name and the kind, with no dot", heading.length === 3 && !heading.join("").includes("·"), JSON.stringify(heading));
  await tools.shots("library-marks");

  await tools.click(".dest .lib-nav-row", "Settings");
  await until(() => page.eval(`document.querySelector(".look-swatches") !== null`), 8_000, "the Appearance page");
  const base = () => page.eval(`document.documentElement.style.getPropertyValue("--accent-base")`);
  const systemAccent = await base();
  check("the accent starts as the Mac's own", /^#[0-9a-f]{6}$/.test(systemAccent), systemAccent);
  await tools.shots("appearance");

  const pick = (label) => page.eval(`document.querySelector('.look-swatches input[aria-label="${label}"]').click()`);
  console.log("contrast   label on a filled button (dark, light) · accent ink on the panel (dark, light)");
  for (const label of PRESETS) {
    await pick(label);
    const ratios = [];
    for (const mode of ["dark", "light"]) {
      await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: mode }] });
      await until(() => page.eval(`document.documentElement.dataset.mode === "${mode}"`), 3_000, `the ${mode} face`);
      // The panel is part see-through. Its solid form is what it is nearest to over any desktop.
      ratios.push(await page.eval(`(() => { ${MEASURE} return { label: contrast(shade("--on-accent"), shade("--accent-fill")), ink: contrast(shade("--accent-ink"), "${mode === "dark" ? "rgb(30 30 32)" : "rgb(255 255 255)"}") }; })()`));
    }
    await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
    const [dark, light] = ratios;
    console.log(`  ${label.padEnd(9)} ${dark.label} ${light.label} · ${dark.ink} ${light.ink}`);
    check(`${label}: the button's label and the accent's ink can be read on both faces`, [dark.label, light.label, dark.ink, light.ink].every((ratio) => ratio >= FLOOR), JSON.stringify(ratios));
  }

  await pick("Green");
  check("Green is painted at once", (await base()) === "#34c759", await base());
  await tools.click(".dest .lib-nav-row", "Library");
  await until(() => page.eval(`document.querySelectorAll(".lib-row").length > 0`), 8_000, "the library");
  await tools.shots("accent-green-library");
  await tools.click(".dest .lib-nav-row", "Review");
  await sleep(1_500);
  await tools.shots("accent-green-review");

  await tools.click(".dest .lib-nav-row", "Settings");
  await until(() => page.eval(`document.querySelector(".look-well input") !== null`), 8_000, "the colour well");
  // The well's own panel is the system's and is not opened here: the colour is given as the panel gives it.
  await page.eval(`(() => { const well = document.querySelector(".look-well input"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(well, "#e0508c"); well.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await until(async () => (await base()) === "#e0508c", 3_000, "the colour from the well");
  check("a colour of the person's own is painted at once", true);
  await tools.shots("accent-custom");
  await tools.click('nav[aria-label="Settings"] .lib-nav-row', "Models");
  await sleep(1_000);
  await tools.shots("accent-custom-models");

  const kept = await until(async () => { try { return JSON.parse(fs.readFileSync(path.join(userData, "appearance.json"), "utf8")); } catch { return null; } }, 3_000, "the kept choice");
  check("the choice is kept beside the app's data", kept.accent === "#e0508c" && kept.appearance === "system", JSON.stringify(kept));
  await app.stop();

  app = await launchLiveApp({ name: "appearance", sourceHome: at.home, env: { AMC_USER_DATA: userData } });
  // The page is attached to before its script has run. The accent is set as the script starts, ahead of React.
  const worn = await until(() => app.page.eval(`document.documentElement.style.getPropertyValue("--accent-base")`), 8_000, "the page's script");
  check("a second start wears the kept accent", worn === "#e0508c", worn);
  const fill = await app.page.eval(`(() => { ${MEASURE} return rgb(shade("--accent-fill")).join(" "); })()`);
  check("and its filled button is that colour's, not the blue's", fill !== "0 122 255", fill);
} finally {
  await app.stop();
  fs.rmSync(at.home, { recursive: true, force: true });
  fs.rmSync(userData, { recursive: true, force: true });
}
finish();
