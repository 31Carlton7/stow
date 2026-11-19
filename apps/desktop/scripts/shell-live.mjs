/**
 * Live check for the shell (run with: pnpm build && node apps/desktop/scripts/shell-live.mjs)
 *
 * Boots the BUILT app on a scratch data folder, pointed at an empty fixture home, and checks what no
 * unit test can see:
 *
 *   1. The window's page reaches the server through the token handshake: Settings' About page
 *      names the fixture home the server was told to read, and the build's version.
 *   2. The server made its index in the scratch data folder, and nowhere else.
 *   3. The three columns are laid out: a 280px sidebar on the window's material, then the panel what
 *      is read sits on, 8px in from the window's other edges: a 340px list and the reader taking the
 *      rest, under a 44px head row, which is what the traffic lights are centred on.
 *   4. A dial with no token is refused.
 *   5. When the app is killed, its server goes with it.
 *
 * Pictures of both faces go to LIVE_DIR (default: a folder under the system temp directory). They
 * are page captures over a stand-in colour: the real material and the traffic lights are not in them.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checks, launchLiveApp, sleep, until, windowTools } from "./lib/live-app.mjs";

const outDir = process.env.LIVE_DIR ?? path.join(os.tmpdir(), "amc-live", "shell");
const fixtureHome = fs.mkdtempSync(path.join(os.tmpdir(), "amc-shell-home-"));
const { check, finish } = checks();
const listenerPid = (port) => {
  try { return Number(execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { encoding: "utf8" }).trim().split("\n")[0]); }
  catch { return null; }
};
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

const app = await launchLiveApp({ name: "shell", sourceHome: fixtureHome });
let serverPid = null;
try {
  const { click } = windowTools(app, outDir);
  await until(() => app.page.eval(`document.querySelector(".dest") !== null`), 10_000, "the sidebar");
  check("the sidebar has no foot: what it said is in Settings", (await app.page.eval(`document.querySelector(".sidebar").innerText.includes("Reading ")`)) === false);
  await click(".dest .lib-nav-row", "Settings");
  await click('nav[aria-label="Settings"] .lib-nav-row', "About");
  const about = await until(() => app.page.eval(`(() => { const said = [...document.querySelectorAll(".about .about-value")].map((v) => v.textContent); return said.length === 2 ? said : null; })()`), 10_000, "Settings' About page");
  check("About names the home the server reads", about[1] === fixtureHome, about[1]);
  const built = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
  check("About shows this build's version", about[0] === built, about[0]);
  await click(".dest .lib-nav-row", "Library");

  check("the index is in the scratch data folder", fs.existsSync(path.join(app.scratch, "home", "index.db")));
  check("nothing was written into the home it reads", fs.readdirSync(fixtureHome).length === 0);

  const box = (selector) => app.page.eval(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x) }; })()`);
  const [sidebar, list, reader, head] = [await box(".sidebar"), await box(".col-list"), await box(".col-reader"), await box(".col-head")];
  const viewport = await app.page.eval(`innerWidth`);
  check("the sidebar is 280px, at the window's left edge", sidebar.w === 280 && sidebar.x === 0, JSON.stringify(sidebar));
  check("the list is 340px, beside it", list.w === 340 && list.x === 280, JSON.stringify(list));
  check("the reader takes the rest, up to the panel's 8px inset", reader.x === 620 && reader.w === viewport - 620 - 8, JSON.stringify({ reader, viewport }));
  check("the panel's head row is 44px", head.h === 44, JSON.stringify(head));
  const title = await until(() => app.page.eval(`document.querySelector(".col-list .empty-state:not(.is-late) .empty-state-title")?.textContent ?? null`), 10_000, "the list's answer");
  check("the list says it is empty", title === "No memory files yet", title);

  const refused = await new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${app.ports.server}`);
    ws.addEventListener("open", () => { ws.close(); resolve(false); });
    ws.addEventListener("error", () => resolve(true));
  });
  check("a dial with no token is refused", refused);

  const viewportHeight = await app.page.eval(`innerHeight`);
  check("the page has the whole window: no title bar above it", viewportHeight === 820, String(viewportHeight));

  const { shots, unreachable } = windowTools(app, outDir);
  await shots("shell");
  check("every control on screen takes a real press: none lies in a part that drags the window", (await unreachable()).length === 0, (await unreachable()).join(" | "));

  serverPid = listenerPid(app.ports.server);
  check("the server is listening on its port", serverPid !== null && alive(serverPid), String(serverPid));
} finally {
  await app.stop();
  fs.rmSync(fixtureHome, { recursive: true, force: true });
}
if (serverPid !== null) {
  await sleep(1_000);
  check("the server went when the app was killed", !alive(serverPid), String(serverPid));
}
finish();
