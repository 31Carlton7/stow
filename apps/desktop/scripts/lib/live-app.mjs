/**
 * The one way a live check starts Electron: quietly, and cleaned up after.
 *
 * Every `*-live.mjs` boots the BUILT app on a scratch data folder. Started through here, that app
 * runs in quiet mode (`AMC_QUIET_WINDOWS=1`, src/main/quiet-windows.ts) on an Electron that is never
 * a Dock app (`quietElectronBinary`): no Dock icon, no focus taken, every window all but transparent,
 * while it still paints and lays out, so screenshots and measurements are real. The app is killed
 * when the check ends, on a normal exit, a throw, or Ctrl-C, and its server goes with it.
 *
 *   const app = await launchLiveApp({ name: "shell", sourceHome });
 *   try { … app.page.eval(…) … await app.screenshot(file) } finally { await app.stop(); }
 */
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const desktopRoot = path.join(repoRoot, "apps/desktop");
const mainEntry = path.join(desktopRoot, "out/main/index.js");
const serverEntry = path.join(repoRoot, "apps/server/dist/main.js");

function electronBinary() {
  return createRequire(path.join(desktopRoot, "package.json"))("electron");
}

/**
 * The same Electron, marked an agent app (`LSUIElement`): the Dock never shows it, not even for the
 * ~100ms between launch and main's `app.dock.hide()` that the stock binary spends as a regular app.
 * An APFS clone, so it costs no disk, re-signed ad hoc as the stock one is, and made once per
 * Electron build.
 */
function quietElectronBinary() {
  const stock = electronBinary();
  if (process.platform !== "darwin") return stock;
  const bundle = path.resolve(stock, "../../..");
  const plist = path.join(bundle, "Contents/Info.plist");
  const version = execFileSync("plutil", ["-extract", "CFBundleVersion", "raw", plist], { encoding: "utf8" }).trim();
  const quiet = path.join(desktopRoot, "node_modules/.cache/quiet-electron", version, "Electron.app");
  const binary = path.join(quiet, path.relative(bundle, stock));
  if (fs.existsSync(binary)) return binary;
  const staging = `${path.dirname(quiet)}.tmp-${process.pid}`;
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  const copy = path.join(staging, "Electron.app");
  execFileSync("cp", ["-cR", bundle, copy]);
  execFileSync("plutil", ["-replace", "LSUIElement", "-bool", "true", path.join(copy, "Contents/Info.plist")]);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", copy], { stdio: "ignore" });
  fs.mkdirSync(path.dirname(quiet), { recursive: true });
  try { fs.renameSync(copy, quiet); } catch { /* another run made it first */ }
  fs.rmSync(staging, { recursive: true, force: true });
  return binary;
}

const launched = new Set();
let hooked = false;

function hookExit() {
  if (hooked) return;
  hooked = true;
  process.on("exit", () => { for (const child of launched) child.kill("SIGKILL"); });
  for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143], ["SIGHUP", 129]]) {
    process.on(signal, () => process.exit(code));
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function until(fn, ms, what) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timed out after ${ms}ms waiting for ${what}`);
    await sleep(150);
  }
}

/** A CDP connection: `send(method, params)` and `eval(expression)` for a value. */
async function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id === undefined) return;
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) p?.reject(new Error(`${p.method}: ${msg.error.message}`));
    else p?.resolve(msg.result);
  });
  await new Promise((resolve, reject) => { ws.addEventListener("open", resolve); ws.addEventListener("error", reject); });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const i = ++id;
    pending.set(i, { resolve, reject, method });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  return {
    send,
    async eval(expression) {
      const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    },
    close: () => ws.close(),
  };
}

/**
 * Boot the built app with a fresh data folder and free ports, in quiet mode, and attach to its
 * window's page over CDP. `sourceHome` is the home folder the app reads agent files from: a fixture,
 * or the person's own for a read-only check. `keep` leaves the scratch folder behind. `binary` is a
 * packed app's own executable, which carries its app and server inside it, in place of the built one.
 */
export async function launchLiveApp({ name = "app", sourceHome, env = {}, keep = false, timeoutMs = 30_000, binary = null } = {}) {
  if (!binary) for (const f of [mainEntry, serverEntry]) if (!fs.existsSync(f)) throw new Error(`${f} is missing: run \`pnpm build\` first (a live check runs the BUILT app)`);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), `amc-${name}-live-`));
  const ports = { server: await freePort(), cdp: await freePort() };
  const log = fs.openSync(path.join(scratch, "electron.log"), "a");
  const electron = spawn(binary ?? quietElectronBinary(), binary ? [] : [desktopRoot], {
    env: {
      ...process.env,
      AMC_QUIET_WINDOWS: "1",
      AMC_USER_DATA: path.join(scratch, "userData"),
      AMC_HOME: path.join(scratch, "home"),
      AMC_PORT: String(ports.server),
      AMC_DEVTOOLS_PORT: String(ports.cdp),
      ...(sourceHome ? { AMC_SOURCE_HOME: sourceHome } : {}),
      ...env,
    },
    stdio: ["ignore", log, log],
  });
  launched.add(electron);
  hookExit();
  let page = null;
  const kill = () => {
    page?.close();
    electron.kill("SIGKILL");
    launched.delete(electron);
  };
  try {
    const targets = () => fetch(`http://127.0.0.1:${ports.cdp}/json/list`).then((r) => r.json());
    const target = await until(async () => (await targets()).find((t) => t.type === "page" && t.url.startsWith("file://")), timeoutMs,
      `the renderer on CDP port ${ports.cdp} (log: ${path.join(scratch, "electron.log")})`);
    page = await cdp(target.webSocketDebuggerUrl);
    await page.send("Runtime.enable");
    await page.send("Page.enable");
  } catch (err) {
    // The scratch folder stays: the error names the log inside it.
    kill();
    throw err;
  }
  return {
    scratch, ports, page,
    async stop() {
      kill();
      if (!keep) fs.rmSync(scratch, { recursive: true, force: true });
    },
    /**
     * A PNG of the page. DOM only: the macOS material behind the sidebar is not in it, and a
     * see-through sidebar captured over nothing comes out a flat grey no window ever shows. So the
     * page is given `backdrop`, a CSS colour standing in for the material, for the length of the
     * capture. (CDP's own background override does nothing in a transparent window.)
     */
    async screenshot(file, backdrop) {
      await page.eval(`void (document.documentElement.style.background = ${JSON.stringify(backdrop)})`);
      const { data } = await page.send("Page.captureScreenshot", { format: "png" });
      await page.eval(`void (document.documentElement.style.background = "")`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(data, "base64"));
      return file;
    },
  };
}

export { checks } from "../../../../fixtures/checks.mjs";

/**
 * Stand-ins for the window's material, which a page capture cannot see: the window is hidden, so the
 * page is pictured over nothing. Each is a soft wash of colour of the kind the material makes of a
 * desktop picture, so a capture shows what is translucent and what is not. It is NOT the real
 * material: only the window on screen shows that.
 */
const MATERIAL = {
  dark: "radial-gradient(70% 60% at 12% 18%, rgb(112 44 52 / 0.55), transparent 72%), radial-gradient(60% 70% at 85% 80%, rgb(36 64 128 / 0.6), transparent 70%), rgb(30 32 44)",
  light: "radial-gradient(70% 60% at 12% 18%, rgb(255 214 200 / 0.8), transparent 72%), radial-gradient(60% 70% at 85% 80%, rgb(190 214 255 / 0.9), transparent 70%), rgb(232 234 242)",
};

/** What a check does to the window: read what it shows, press what it finds by its words, and
 *  picture both faces into `outDir`. */
export function windowTools(app, outDir) {
  const { page } = app;
  const all = (selector) => `[...document.querySelectorAll(${JSON.stringify(selector)})]`;
  return {
    text: (selector) => page.eval(`document.querySelector(${JSON.stringify(selector)})?.innerText ?? null`),
    texts: (selector) => page.eval(`${all(selector)}.map((el) => el.textContent.trim())`),
    has: (selector, words) => page.eval(`${all(selector)}.some((el) => el.textContent.includes(${JSON.stringify(words)}))`),
    /** Press the first element matching `selector` whose text holds `words`. */
    async click(selector, words = "") {
      const pressed = await page.eval(`(() => {
        const el = ${all(selector)}.find((e) => e.textContent.includes(${JSON.stringify(words)}));
        el?.click();
        return el !== undefined;
      })()`);
      if (!pressed) throw new Error(`nothing to click: ${selector} "${words}"`);
    },
    /**
     * The controls on screen that a real press cannot reach, by their words: each lies in a part of
     * the window that drags it, and the window takes a press there before the page sees it. A
     * scripted click reaches them all the same, so nothing but this finds them.
     */
    unreachable: () => page.eval(`[...document.querySelectorAll("button, select, input, textarea, a[href], label, [role=button]")].filter((el) => {
      if (el.getClientRects().length === 0) return false;
      for (let at = el; at !== null; at = at.parentElement) {
        const region = getComputedStyle(at).getPropertyValue("-webkit-app-region");
        if (region === "no-drag") return false;
        if (region === "drag") return true;
      }
      return false;
    }).map((el) => (el.getAttribute("aria-label") ?? el.textContent.trim()).slice(0, 40))`),
    noticesGone: () => until(() => page.eval(`document.querySelectorAll(".toast").length === 0`), 15_000, "the notices to leave"),
    /** `name-dark.png` and `name-light.png`. The window is left on its dark face. */
    async shots(name) {
      for (const mode of ["dark", "light"]) {
        await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: mode }] });
        await until(() => page.eval(`document.documentElement.dataset.mode === ${JSON.stringify(mode)}`), 3_000, `the ${mode} face`);
        await sleep(150);
        console.log(`shot ${await app.screenshot(path.join(outDir, `${name}-${mode}.png`), MATERIAL[mode])}`);
      }
      await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
    },
  };
}
