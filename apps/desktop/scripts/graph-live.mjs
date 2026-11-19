/**
 * Live check for the Graph section (run with: pnpm build && node apps/desktop/scripts/graph-live.mjs)
 *
 * Boots the BUILT app on a scratch data folder, reading a fixture home, and drives the real window:
 *
 *   1. The legend counts what the other sections list: six skills, four MCP servers, and as many
 *      conversations as Sessions counts.
 *   2. Finding a node by name picks it and opens its card, which says what it is joined to.
 *   3. The card's button lands in the library on that file.
 *   4. Narrowed to one project, the graph is smaller and still holds the project.
 *
 * Pictures of both faces go to LIVE_DIR. The window is hidden: they show the page and whatever the
 * canvas drew there, not the window's material, and nothing of how the graph moves.
 *
 * With GRAPH_REAL=1 it reads the person's own home instead and prints numbers only: how many nodes
 * and edges of each kind, how long until the graph was drawn, and the frame time while it turns. No
 * name, path or text of anything is printed, and nothing is pictured.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildFixtureHome } from "../../../fixtures/home.mjs";
import { checks, launchLiveApp, sleep, until, windowTools } from "./lib/live-app.mjs";

const real = process.env.GRAPH_REAL === "1";
const outDir = process.env.LIVE_DIR ?? path.join(os.tmpdir(), "amc-live", "graph");
const at = real ? null : buildFixtureHome(fs.mkdtempSync(path.join(os.tmpdir(), "amc-graph-home-")));

const { check, finish } = checks();

const app = await launchLiveApp({ name: "graph", ...(at ? { sourceHome: at.home } : {}), timeoutMs: 60_000 });
const { page } = app;
const { texts, click, shots } = windowTools(app, outDir);
const legend = async () => Object.fromEntries((await texts(".ses-show")).map((row) => { const [, name, count] = /^(.*?)([\d,]+)$/.exec(row); return [name, Number(count.replace(/,/g, ""))]; }));
const drawn = () => until(() => page.eval(`document.querySelector(".graph-host")?.dataset.drawn ?? null`), 60_000, "the graph's canvas");
/** The time between frames over `ms`, as the page itself sees it. */
const frames = (ms) => page.eval(`new Promise((done) => {
  const gaps = []; let last = performance.now(); const until = last + ${ms};
  const tick = (now) => { gaps.push(now - last); last = now; if (now < until) requestAnimationFrame(tick); else done(gaps.slice(1)); };
  requestAnimationFrame(tick);
})`);
const settled = (gaps) => {
  const sorted = [...gaps].sort((a, b) => a - b);
  const of = (share) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))] * 10) / 10;
  return `${gaps.length} frames, median ${of(0.5)} ms, 95th ${of(0.95)} ms, worst ${of(1)} ms`;
};

try {
  await until(() => page.eval(`document.querySelector(".dest") !== null`), 15_000, "the sidebar");

  if (real) {
    // The index has to have listed the transcripts before the graph can hold the conversations.
    await click(".dest .lib-nav-row", "Sessions");
    await until(() => page.eval(`document.querySelectorAll(".lib-nav-list .lib-nav-row").length > 0`), 120_000, "the sessions");
    await sleep(5_000);
    const asked = Date.now();
    await click(".dest .lib-nav-row", "Graph");
    const how = await drawn();
    console.log(`drawn as ${how} in ${Date.now() - asked} ms`);
    console.log(`nodes drawn: ${await page.eval(`document.querySelector(".graph-host").dataset.nodes`)}`);
    console.log(`legend: ${JSON.stringify(await legend())}`);
    console.log(`lines: ${(await texts(".graph-lines dt")).join(", ")}`);
    console.log(`while the layout settles and the graph turns: ${settled(await frames(4_000))}`);
    await sleep(6_000);
    console.log(`settled, turning: ${settled(await frames(4_000))}`);
  } else {
    await click(".dest .lib-nav-row", "Sessions");
    const conversations = Number((await until(() => page.eval(`document.querySelector(".lib-nav-list .lib-nav-count")?.textContent ?? null`), 20_000, "the count of conversations")).replace(/,/g, ""));

    await click(".dest .lib-nav-row", "Graph");
    const how = await drawn();
    console.log(`drawn as ${how}`);
    const counts = await legend();
    check("the legend counts the six skills and four servers the fixture holds", counts["Skills"] === 6 && counts["MCP servers"] === 4, JSON.stringify(counts));
    check("and as many conversations as Sessions lists", counts["Conversations"] === conversations && conversations > 0, `${counts["Conversations"]} of ${conversations}`);
    check("the legend says what each line means", (await texts(".graph-lines dt")).length === 7);
    console.log(`frames: ${settled(await frames(2_000))}`);
    await sleep(2_500);
    await shots("graph-whole");

    await page.eval(`(() => {
      const field = document.querySelector(".graph-search input");
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(field, "deploy");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
    await until(() => page.eval(`document.querySelectorAll(".graph-found-row").length > 0`), 5_000, "what the search found");
    await click(".graph-found .graph-found-row", "File");
    await until(() => page.eval(`document.querySelector(".graph-card-links section") !== null`), 8_000, "the picked node's card");
    const title = await page.eval(`document.querySelector(".graph-card-title").textContent`);
    check("finding a node picks it and opens its card", title.toLowerCase().includes("deploy"), title);
    check("the card says what it is joined to", (await texts(".graph-card-heading")).some((heading) => heading.startsWith("Belongs to")), (await texts(".graph-card-heading")).join(" | "));
    await sleep(1_500);
    await shots("graph-picked");

    await click(".graph-card-open", "Open in Library");
    // The reader may still hold the file it showed last: the check is that it comes to show this one.
    const landed = await until(() => page.eval(`document.querySelector(".lib-reader-title")?.textContent === ${JSON.stringify(title)}`), 8_000, "the library's reader on that file").then(() => true, () => false);
    check("the card's button lands in the library on that file", landed && (await page.eval(`document.querySelector(".dest [aria-current]").textContent`)).includes("Library"));

    await click(".dest .lib-nav-row", "Graph");
    await drawn();
    const whole = Number(await page.eval(`document.querySelector(".graph-host").dataset.nodes`));
    await click('[aria-label="Projects"] .lib-nav-row', "atlas");
    await until(() => page.eval(`Number(document.querySelector(".graph-host")?.dataset.nodes) < ${whole}`), 8_000, "the graph of one project");
    check("narrowed to a project, the graph is that project's", (await page.eval(`document.querySelector('[aria-label="Projects"] [aria-current]').textContent`)).includes("atlas"));
    await sleep(2_500);
    await shots("graph-project");
  }
} finally {
  await app.stop();
  if (at) fs.rmSync(at.home, { recursive: true, force: true });
}
finish();
