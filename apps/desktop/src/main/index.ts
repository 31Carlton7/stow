import { app, BrowserWindow, dialog, ipcMain, nativeImage, nativeTheme, ShareMenu, shell, systemPreferences } from "electron";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { APP_NAME } from "@amc/contracts";
import { anchorOf, dragOut, sharingItem } from "./hand-out";
import { installQuietWindows, noteQuiet, quietWindowsOn, QUIET_WINDOW_OPTIONS } from "./quiet-windows";
import type { AppearanceChoice } from "../preload";
import { resolveServerEntry, startServer } from "./server-process";

const quiet = quietWindowsOn({ packaged: app.isPackaged, env: process.env });
if (quiet) installQuietWindows();

app.setName(APP_NAME);
// A check runs beside the person's own copy: its own data folder, and with it its own instance lock.
if (process.env.AMC_USER_DATA) app.setPath("userData", process.env.AMC_USER_DATA);
if (process.env.AMC_DEVTOOLS_PORT) app.commandLine.appendSwitch("remote-debugging-port", process.env.AMC_DEVTOOLS_PORT);

// A check pictures both faces of the real window, which follows the Mac's appearance and not the page's.
const appearance = process.env.AMC_APPEARANCE;
if (!app.isPackaged && (appearance === "light" || appearance === "dark")) nativeTheme.themeSource = appearance;

// The look the person chose, kept beside the app's other data. It is read before the window is made,
// so the window's material and its first paint already wear it.
const appearanceFile = join(app.getPath("userData"), "appearance.json");
const isAppearanceChoice = (kept: unknown): kept is AppearanceChoice => {
  const { appearance, accent } = (kept ?? {}) as Partial<AppearanceChoice>;
  return (appearance === "system" || appearance === "light" || appearance === "dark") && typeof accent === "string" && accent.length <= 16;
};
function keptAppearance(): AppearanceChoice {
  try {
    const kept: unknown = JSON.parse(readFileSync(appearanceFile, "utf8"));
    if (isAppearanceChoice(kept)) return kept;
  } catch { /* nothing chosen yet */ }
  return { appearance: "system", accent: "system" };
}
let chosenAppearance = keptAppearance();
if (chosenAppearance.appearance !== "system") nativeTheme.themeSource = chosenAppearance.appearance;
// The Mac answers RRGGBBAA; the page wants a CSS colour.
const systemAccent = (): string => (process.platform === "darwin" ? `#${systemPreferences.getAccentColor().slice(0, 6)}` : "#007aff");
ipcMain.on("appearance", (e) => { e.returnValue = { choice: chosenAppearance, systemAccent: systemAccent() }; });
ipcMain.handle("appearance:choose", (_e, choice: unknown) => {
  if (!isAppearanceChoice(choice)) return;
  chosenAppearance = choice;
  nativeTheme.themeSource = choice.appearance;
  writeFileSync(appearanceFile, JSON.stringify(choice));
});
// Electron's `accent-color-changed` is not sent on a Mac. The system says it this way.
if (process.platform === "darwin") {
  systemPreferences.subscribeNotification("AppleColorPreferencesChangedNotification", () => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send("appearance:system-accent", systemAccent());
  });
}

// The welcome is shown until it has been opened once. A check's window is always on fresh data, so
// there it shows only when asked for.
const welcomedFile = join(app.getPath("userData"), "welcomed");
ipcMain.on("intro", (e) => { e.returnValue = !existsSync(welcomedFile) && (!quiet || process.env.AMC_INTRO === "1"); });
ipcMain.handle("intro:seen", () => writeFileSync(welcomedFile, ""));

const devOrigin = process.env.ELECTRON_RENDERER_URL ? new URL(process.env.ELECTRON_RENDERER_URL).origin : null;

let endpoint: { port: number; token: string } | null = null;
let quitting = false;

async function createWindow(): Promise<void> {
  const win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 900, minHeight: 600,
    // Inset traffic lights over the sidebar's material. The lights are 14px across (measured on
    // macOS 27), so y:23 puts their middle 30px down: the middle of the panel's 44px head row, which
    // starts 8px down. x:20 is where the sidebar's icons start (12px of list, 8px of row).
    titleBarStyle: "hiddenInset", trafficLightPosition: { x: 20, y: 23 },
    vibrancy: "sidebar", backgroundColor: "#00000000",
    ...(quiet ? QUIET_WINDOW_OPTIONS : {}),
    // sandbox: false because electron-vite emits an ESM preload (.mjs), which Electron only loads unsandboxed.
    webPreferences: { preload: join(__dirname, "../preload/index.mjs"), contextIsolation: true, sandbox: false,
      ...(quiet ? { backgroundThrottling: false } : {}) },
  });
  if (quiet) win.show();
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  // Keep the top frame inside the app: the dev server's origin in dev, file:// otherwise.
  win.webContents.on("will-navigate", (e, url) => {
    const inApp = devOrigin ? url === devOrigin || url.startsWith(`${devOrigin}/`) : url.startsWith("file://");
    if (!inApp) e.preventDefault();
  });
  if (process.env.ELECTRON_RENDERER_URL) await win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else await win.loadFile(join(__dirname, "../renderer/index.html"));
}

async function boot(): Promise<void> {
  // In development the Dock would show Electron's own icon. A packaged app carries its icon in the bundle.
  if (!app.isPackaged && !quiet) app.dock?.setIcon(join(__dirname, "../../build/icon.png"));
  const token = randomBytes(32).toString("hex");
  const server = startServer({
    entry: resolveServerEntry({ override: process.env.AMC_SERVER_ENTRY, packaged: app.isPackaged, appPath: app.getAppPath(), resourcesPath: process.resourcesPath }),
    token,
    env: {
      AMC_HOME: process.env.AMC_HOME ?? join(app.getPath("userData"), "home"),
      AMC_ALLOWED_ORIGINS: devOrigin ?? "file://",
    },
  });
  app.on("before-quit", () => { quitting = true; server.child.kill(); });
  const info = await server.ready;
  endpoint = { port: info.port, token };
  server.child.on("exit", (code) => {
    if (quitting) return;
    dialog.showErrorBox(APP_NAME, `The background server stopped (code ${code}). Open the app again to restart it.`);
    app.quit();
  });
  await createWindow();
}

// Asked of main rather than passed on the window's command line, which `ps` shows to every process
// this user runs.
ipcMain.on("server:endpoint", (e) => { e.returnValue = endpoint; });
ipcMain.handle("reveal", (_e, path: unknown) => {
  if (typeof path === "string" && isAbsolute(path)) shell.showItemInFolder(path);
});

// What may be dragged or shared out of the window lies under a home the server reads: the person's
// own (or a check's fixture), and the app's own, where the memories it keeps are.
const homesRead = (): string[] => [process.env.AMC_SOURCE_HOME || homedir(), process.env.AMC_HOME ?? join(app.getPath("userData"), "home")];
const draggedDir = join(app.getPath("userData"), "dragged");
// A dropped copy may still be read by the app it was dropped on, so the copies of one run are cleared at the next.
rmSync(draggedDir, { recursive: true, force: true });
ipcMain.on("drag-out", (e, path: unknown) => {
  dragOut(path, {
    homes: homesRead(), stagingDir: draggedDir,
    // The Mac refuses a drag with no picture, and gives a file's own only on a promise.
    startDrag: (file) => void app.getFileIcon(file, { size: "normal" }).catch(() => nativeImage.createEmpty()).then((icon) => {
      if (e.sender.isDestroyed()) return;
      e.sender.startDrag({ file, icon: icon.isEmpty() ? nativeImage.createFromPath(join(__dirname, "../../build/icon.png")) : icon });
    }),
  });
});
ipcMain.handle("share", (e, shared: unknown, at: unknown) => {
  const item = sharingItem(shared, homesRead());
  const anchor = anchorOf(at);
  const window = BrowserWindow.fromWebContents(e.sender);
  if (process.platform !== "darwin" || item === null || anchor === null || window === null) return;
  if (quiet) noteQuiet("shared", item);
  new ShareMenu(item).popup({ window, ...anchor });
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.on("window-all-closed", () => app.quit());
  void app.whenReady().then(boot).catch((e: unknown) => {
    dialog.showErrorBox(APP_NAME, e instanceof Error ? e.message : String(e));
    app.quit();
  });
}
