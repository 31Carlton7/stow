/**
 * Live check for favourites
 * (run with: pnpm build && node apps/desktop/scripts/favorites-live.mjs)
 *
 * Boots the BUILT app on a scratch data folder and the fixture home, and stars a memory, a skill and
 * an MCP server from their rows:
 *
 *   1. A star pressed in a row is on in the reader's bar, and does not open another row.
 *   2. Each section's Favorites row counts what is starred there and narrows the list to it.
 *   3. The Favorites section lists all three under their kinds, and a card opens its thing in the
 *      section it lives in.
 *   4. Quit and started again on the same data folder, the three are still starred.
 *   5. No control on any of these screens lies in a part of the window that drags it.
 *
 * Nothing is written to the fixture home and no model is called. Pictures of both faces go to LIVE_DIR.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildFixtureHome } from "../../../fixtures/home.mjs";
import { checks, launchLiveApp, sleep, until, windowTools } from "./lib/live-app.mjs";

const outDir = process.env.LIVE_DIR ?? path.join(os.tmpdir(), "amc-live", "favorites");
const at = buildFixtureHome(fs.mkdtempSync(path.join(os.tmpdir(), "amc-favorites-home-")));
const { check, finish } = checks();

const SECTION_ROW = ".sb-list .lib-nav-row";
const ROWS = ".col-list .lib-row";

/** What every part of the check does to whichever window is up. */
function driver(app) {
  const { page } = app;
  const tools = windowTools(app, outDir);
  const count = (selector) => page.eval(`document.querySelectorAll(${JSON.stringify(selector)}).length`);
  return {
    ...tools, page, count,
    ready: () => until(() => page.eval(`document.querySelector(".dest") !== null`), 15_000, "the sidebar"),
    async goTo(section) {
      await tools.click(".dest .lib-nav-row", section);
      await until(() => page.eval(`document.querySelector(".dest .lib-nav-row[data-selected]")?.textContent.startsWith(${JSON.stringify(section)})`), 5_000, `the ${section} section`);
    },
    /** The number beside the sidebar's Favorites row of the section on screen. */
    starredCount: () => page.eval(`[...document.querySelectorAll(${JSON.stringify(SECTION_ROW)})].find((row) => row.textContent.startsWith("Favorites"))?.querySelector(".lib-nav-count")?.textContent ?? null`),
    rowsListed: (n, what) => until(async () => (await count(ROWS)) === n, 15_000, what),
  };
}

let unreached = [];
let app = await launchLiveApp({ name: "favorites", sourceHome: at.home, keep: true });
const dataFolder = app.scratch;
try {
  let win = driver(app);
  await win.ready();

  // The Library: star the first memory from its row.
  await until(async () => (await win.count(ROWS)) > 1, 15_000, "the library's files");
  const filesListed = await win.count(ROWS);
  const memory = (await win.texts(`${ROWS} .lib-row-title`))[1];
  const openBefore = await win.text(".lib-reader-title");
  await win.click(`${ROWS}:nth-child(2) .fav`);
  check("a star pressed in a row does not open that row", (await win.text(".lib-reader-title")) === openBefore, `${openBefore} -> ${await win.text(".lib-reader-title")}`);
  await win.click(`${ROWS}:nth-child(2)`);
  await until(async () => (await win.text(".lib-reader-title")) === memory, 5_000, "the starred file in the reader");
  check("the star is on in the reader's bar", await win.page.eval(`document.querySelector(".lib-reader-bar .fav-bar")?.getAttribute("aria-pressed") === "true"`));
  check("the Library's Favorites row counts it", (await win.starredCount()) === "1", String(await win.starredCount()));
  // The pointer over the row above, so one picture shows a star that is on and one that is only offered.
  const above = await win.page.eval(`(() => { const box = document.querySelector(${JSON.stringify(`${ROWS}:nth-child(1)`)}).getBoundingClientRect(); return { x: box.left + box.width / 2, y: box.top + box.height / 2 }; })()`);
  await win.page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: above.x, y: above.y });
  await sleep(250);
  await win.shots("favorites-row");
  unreached.push(...await win.unreachable());

  await win.click(SECTION_ROW, "Favorites");
  await win.rowsListed(1, "the one starred file");
  check("and narrows the list to it", (await win.texts(`${ROWS} .lib-row-title`)).join() === memory, (await win.texts(`${ROWS} .lib-row-title`)).join());
  check("the list is headed Favorites", (await win.text(".lib-list-name")) === "Favorites", String(await win.text(".lib-list-name")));
  await win.click(SECTION_ROW, "All memories");
  await win.rowsListed(filesListed, "every file again");

  await win.click('.lib-layout .seg-opt[title="Grid"]');
  await until(async () => (await win.count(".lib-cards .lib-card")) > 1, 8_000, "the grid's cards");
  check("the same file is starred on its card", (await win.count('.lib-cards .fav[aria-pressed="true"]')) === 1);
  await win.shots("favorites-card");
  unreached.push(...await win.unreachable());
  await win.click('.lib-layout .seg-opt[title="List"]');

  // Skills and MCP servers: the first of each.
  const starFirst = async (section, what) => {
    await win.goTo(section);
    await until(async () => (await win.count(ROWS)) > 1, 15_000, `the ${what}s`);
    const name = (await win.texts(`${ROWS} .lib-row-title`))[0];
    await win.click(`${ROWS}:nth-child(1) .fav`);
    check(`the ${section} Favorites row counts the starred ${what}`, (await win.starredCount()) === "1", String(await win.starredCount()));
    await win.click(SECTION_ROW, "Favorites");
    await win.rowsListed(1, `the one starred ${what}`);
    check(`and narrows the list to that ${what}`, (await win.texts(`${ROWS} .lib-row-title`)).join() === name, (await win.texts(`${ROWS} .lib-row-title`)).join());
    await win.click(`${ROWS}:nth-child(1)`);
    await until(() => win.page.eval(`document.querySelector(".col-reader .fav-bar") !== null`), 5_000, `the ${what}'s bar`);
    check(`the ${what}'s bar has the star on`, await win.page.eval(`document.querySelector(".col-reader .fav-bar").getAttribute("aria-pressed") === "true"`));
    unreached.push(...await win.unreachable());
    return name;
  };
  const skill = await starFirst("Skills", "skill");
  await win.shots("favorites-bar");
  const server = await starFirst("MCP servers", "server");

  const sectionLists = async () => {
    await win.goTo("Favorites");
    await until(async () => (await win.count(".fav-cards .lib-card")) === 3, 10_000, "the three starred things");
    return { titles: await win.texts(".fav-cards .lib-card-title"), nav: await win.texts(SECTION_ROW) };
  };
  let listed = await sectionLists();
  check("the Favorites section lists the memory, the skill and the server", [memory, skill, server].every((name) => listed.titles.includes(name)), listed.titles.join(" | "));
  check("its sidebar counts each kind", listed.nav.join() === "All3,Memories1,Skills1,MCP servers1,Hooks0,Sessions0", listed.nav.join());
  await win.shots("favorites-section");
  unreached.push(...await win.unreachable());

  await win.click(".fav-cards .lib-card", skill);
  await until(() => win.page.eval(`document.querySelector(".dest .lib-nav-row[data-selected]")?.textContent.startsWith("Skills")`), 5_000, "the Skills section");
  await until(async () => (await win.text(".lib-reader-title")) === skill, 8_000, "the skill's page");
  check("a card opens its thing in its own section", true);

  // Quit, and start again on the same data folder.
  await app.stop();
  app = await launchLiveApp({ name: "favorites", sourceHome: at.home, env: { AMC_HOME: path.join(dataFolder, "home"), AMC_USER_DATA: path.join(dataFolder, "userData") } });
  win = driver(app);
  await win.ready();
  listed = await sectionLists();
  check("started again on the same data folder, the three are still starred", [memory, skill, server].every((name) => listed.titles.includes(name)), listed.titles.join(" | "));

  check("every control on these screens takes a real press", unreached.length === 0, [...new Set(unreached)].join(" | "));
} finally {
  await app.stop();
  fs.rmSync(dataFolder, { recursive: true, force: true });
  fs.rmSync(at.home, { recursive: true, force: true });
}
finish();
