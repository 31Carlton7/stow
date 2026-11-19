/**
 * Live check for dragging things out of the window and for Share
 * (run with: pnpm build && node apps/desktop/scripts/share-drag-live.mjs)
 *
 * Boots the BUILT app on a scratch data folder and the fixture home. No drag is started and no share
 * sheet is opened: the app runs in quiet mode, where main records each instead of showing it
 * (src/main/quiet-windows.ts), and this reads the record from the app's log. So what is checked is
 * what main would have handed to the Mac, after its own test of the path.
 *
 *   1. Every row and card is draggable. A `dragstart` on a library file, a skill and a session is
 *      cancelled in the page and main drags a copy of the file (the folder, for a skill).
 *   2. A `dragstart` on a server and a hook is the page's own, carrying text.
 *   3. Share in each reader's bar opens the sheet on the same file, folder or text.
 *   4. No secret the fixture's configs hold is in anything dragged or shared.
 *   5. Asked for a credentials file or a path outside the home, main drags and shares nothing.
 *   6. Share can be reached by a real press in every bar.
 *
 * Pictures of both faces go to LIVE_DIR. They cannot show a drag or the share sheet, which are the
 * Mac's own: only a person at the window sees those.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildFixtureHome } from "../../../fixtures/home.mjs";
import { checks, launchLiveApp, sleep, until, windowTools } from "./lib/live-app.mjs";

const outDir = process.env.LIVE_DIR ?? path.join(os.tmpdir(), "amc-live", "share-drag");
const at = buildFixtureHome(fs.mkdtempSync(path.join(os.tmpdir(), "amc-share-home-")));
const { check, finish } = checks();

/** Every secret value the fixture writes starts this way. */
const SECRET = "fixture-secret";
const login = path.join(at.home, ".claude/.credentials.json");
fs.writeFileSync(login, JSON.stringify({ token: `${SECRET}-login` }));

const app = await launchLiveApp({ name: "share-drag", sourceHome: at.home });
const { page } = app;
const { click, shots, unreachable } = windowTools(app, outDir);
const js = JSON.stringify;

/** What quiet mode recorded under one name, oldest first. */
const recorded = (what) => fs.readFileSync(path.join(app.scratch, "electron.log"), "utf8").split("\n")
  .filter((line) => line.startsWith(`[quiet-windows] ${what} `)).map((line) => JSON.parse(line.slice(`[quiet-windows] ${what} `.length)));
const drags = () => recorded("drag");
const shares = () => recorded("shared");
const nextDrag = async (after) => (await until(async () => drags().length > after && drags(), 5_000, "main to start the drag")).at(-1);
const nextShare = async (after) => (await until(async () => shares().length > after && shares(), 5_000, "main to open the share sheet")).at(-1);

/** Send the first row or card holding `words` the event a drag begins with. No drag begins: the event is scripted. */
const dragStart = (selector, words) => page.eval(`(() => {
  const el = [...document.querySelectorAll(${js(selector)})].find((e) => e.textContent.includes(${js(words)}));
  if (!el) return null;
  const e = new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() });
  el.dispatchEvent(e);
  return { cancelled: e.defaultPrevented, text: e.dataTransfer.getData("text/plain") };
})()`);
const allDraggable = (selector) => page.eval(`(() => { const all = [...document.querySelectorAll(${js(selector)})]; return all.length > 0 && all.every((el) => el.draggable); })()`);
const rows = (n, what) => until(() => page.eval(`document.querySelectorAll(".col-list .lib-row").length >= ${n}`), 15_000, what);
const titled = (title) => until(() => page.eval(`document.querySelector(".lib-reader-title")?.textContent === ${js(title)}`), 8_000, `${title} in the reader`);
const firstTitle = () => page.eval(`document.querySelector(".col-list .lib-row .lib-row-title").textContent`);
const pressShare = () => click('.col-reader .lib-reader-bar button[aria-label="Share"]');
const texts = [];
const unreached = [];
const lookForUnreachable = async () => { unreached.push(...await unreachable()); };

try {
  await until(() => page.eval(`document.querySelector(".dest") !== null && document.querySelector(".lib-reader-title") !== null`), 20_000, "the library");

  /* A library file, from the list and from the grid. */
  const fileTitle = await page.eval(`document.querySelector(".lib-reader-title").textContent`);
  const filePath = await page.eval(`document.querySelector(".lib-props .lib-path").title`);
  check("every row of the library is draggable", await allDraggable(".col-list .lib-row"));
  let before = drags().length;
  const fileDrag = await dragStart(".col-list .lib-row[aria-selected=true]", "");
  const draggedFile = await nextDrag(before);
  check("a file's row cancels the page's drag and carries no text of its own", fileDrag.cancelled && fileDrag.text === "");
  check("main drags a copy of that file, under its own name", path.basename(draggedFile) === path.basename(filePath)
    && draggedFile.startsWith(path.join(app.scratch, "userData/dragged")) && fs.readFileSync(draggedFile, "utf8") === fs.readFileSync(filePath, "utf8"), draggedFile.replace(app.scratch, ""));
  check("and the file is still where it was", fs.existsSync(filePath));
  before = shares().length;
  await pressShare();
  check("Share in the reader's bar opens the sheet on the file itself", js(await nextShare(before)) === js({ filePaths: [fs.realpathSync(filePath)] }));
  await lookForUnreachable();
  await shots("share-library");

  await click(".lib-layout .seg-opt[title=Grid]");
  await until(() => page.eval(`document.querySelectorAll(".lib-card").length > 0`), 8_000, "the cards");
  check("every card of the grid is draggable", await allDraggable(".lib-card"));
  before = drags().length;
  const cardDrag = await dragStart(".lib-card", fileTitle);
  check("a card drags its file the same way", cardDrag.cancelled && path.basename(await nextDrag(before)) === path.basename(filePath));
  await click(".lib-layout .seg-opt[title=List]");

  /* A skill: its folder. */
  await click(".dest .lib-nav-row", "Skills");
  await rows(2, "the skills");
  check("every skill's row is draggable", await allDraggable(".col-list .lib-row"));
  const skillName = await firstTitle();
  await click(".col-list .lib-row", skillName);
  await titled(skillName);
  const skillFolder = path.dirname(await page.eval(`document.querySelector(".lib-props .lib-path").title`));
  before = drags().length;
  const skillDrag = await dragStart(".col-list .lib-row[aria-selected=true]", "");
  const draggedSkill = await nextDrag(before);
  check("a skill's row drags a copy of its whole folder", skillDrag.cancelled && path.basename(draggedSkill) === path.basename(skillFolder)
    && fs.statSync(draggedSkill).isDirectory() && fs.existsSync(path.join(draggedSkill, "SKILL.md")), draggedSkill.replace(app.scratch, ""));
  before = shares().length;
  await pressShare();
  check("Share on a skill opens the sheet on its folder", js(await nextShare(before)) === js({ filePaths: [fs.realpathSync(skillFolder)] }));
  await lookForUnreachable();
  await shots("share-skill");

  /* A server and a hook: text, with nothing secret in it. */
  for (const [section, least] of [["MCP servers", 4], ["Hooks", 4]]) {
    await click(".dest .lib-nav-row", section);
    await rows(least, section);
    check(`every row of ${section} is draggable`, await allDraggable(".col-list .lib-row"));
    const names = await page.eval(`[...document.querySelectorAll(".col-list .lib-row")].map((row) => row.querySelector(".lib-row-title").textContent)`);
    const dragsBefore = drags().length;
    for (let nth = 0; nth < names.length; nth++) {
      const row = `.col-list .lib-row:nth-child(${nth + 1})`;
      const drag = await dragStart(row, "");
      await click(row);
      await until(() => page.eval(`document.querySelector(${js(`${row}[aria-selected=true]`)}) !== null && document.querySelector('.col-reader button[aria-label="Share"]') !== null`), 8_000, `${names[nth]} in the reader`);
      before = shares().length;
      await pressShare();
      const shared = await nextShare(before);
      check(`${section}: ${names[nth]} drags as text, and Share gives the same text`, !drag.cancelled && drag.text.includes(names[nth].split(" · ")[0]) && js(shared) === js({ texts: [drag.text] }));
      texts.push(drag.text);
    }
    check(`${section}: no file is dragged for what has none`, drags().length === dragsBefore);
    await lookForUnreachable();
    await shots(section === "Hooks" ? "share-hook" : "share-server");
  }
  check("the text names a variable and leaves its value out", texts.some((text) => text.includes("NOTES_TOKEN")), texts.find((text) => text.includes("NOTES_TOKEN"))?.replaceAll("\n", " | "));

  /* A session: its transcript. */
  await click(".dest .lib-nav-row", "Sessions");
  await rows(1, "the sessions");
  check("every session's row is draggable", await allDraggable(".col-list .lib-row"));
  const sessionTitle = await firstTitle();
  await click(".col-list .lib-row", sessionTitle);
  await titled(sessionTitle);
  before = shares().length;
  await pressShare();
  const sharedSession = (await nextShare(before)).filePaths[0];
  check("Share on a session opens the sheet on its transcript, under the home", sharedSession.startsWith(at.home + path.sep) && fs.statSync(sharedSession).isFile(), sharedSession.replace(at.home, "~"));
  before = drags().length;
  const sessionDrag = await dragStart(".col-list .lib-row[aria-selected=true]", "");
  const draggedSession = await nextDrag(before);
  check("a session's row drags a copy of the same transcript", sessionDrag.cancelled && path.basename(draggedSession) === path.basename(sharedSession)
    && fs.readFileSync(draggedSession, "utf8") === fs.readFileSync(sharedSession, "utf8"));
  await lookForUnreachable();
  await shots("share-session");

  /* What main refuses, whatever the page asks. */
  const [dragsSoFar, sharesSoFar] = [drags().length, shares().length];
  for (const refused of [login, "/etc/hosts", path.join(at.home, ".claude"), at.home]) {
    await page.eval(`(window.amc.dragOut(${js(refused)}), window.amc.share({ path: ${js(refused)} }, { x: 10, y: 10 }))`);
  }
  await sleep(800);
  check("main drags and shares nothing for a login file, a path outside the home, an agent's folder or the home", drags().length === dragsSoFar && shares().length === sharesSoFar);

  const handedOut = [...texts, ...shares().map((shared) => js(shared))];
  check("no secret is in any text dragged or anything shared", handedOut.length > 12 && handedOut.every((out) => !out.includes(SECRET) && !out.includes(".credentials")));
  check("Share is within a real press's reach in every bar", unreached.length === 0, unreached.join(" | "));
  const sheets = fs.readFileSync(path.join(app.scratch, "electron.log"), "utf8").split("\n").filter((line) => line === "[quiet-windows] share sheet");
  check("every share sheet was recorded in place of being shown", sheets.length === shares().length);
} finally {
  await app.stop();
  fs.rmSync(at.home, { recursive: true, force: true });
}
finish();
