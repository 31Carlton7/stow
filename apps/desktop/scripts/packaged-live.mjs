/**
 * Live check for the packed app (run with: pnpm dist:dir && node apps/desktop/scripts/packaged-live.mjs)
 *
 * Takes `release/mac-<arch>/Stow.app` (or the app at PACKED_APP) and checks what only the packed app
 * can show, on the fixture home (fixtures/home.mjs):
 *
 *   1. The app's own binary, run as Node, starts the server from Contents/Resources and the server
 *      opens its index: no Node on the PATH, and `node:sqlite` from the Node inside Electron.
 *   2. The app starts that server itself and its window shows the Library, with a row for each
 *      memory the sidebar counts.
 *
 * A packed app ignores quiet mode (src/main/quiet-windows.ts), and Electron calls an app packed when
 * its executable is not named Electron. So the window is opened by a copy of the app with its
 * executables given that name back, and nothing else changed: the same binary with the same fuses,
 * the same asar, the same server. What is left unchecked is the lines of main that ask
 * `app.isPackaged`: where the server's bundle is (the copy finds it at the same path, by the
 * development rule) and the Dock icon.
 */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildFixtureHome } from "../../../fixtures/home.mjs";
import { checks, launchLiveApp, until } from "./lib/live-app.mjs";

const desktopRoot = fileURLToPath(new URL("..", import.meta.url));
const packedApp = process.env.PACKED_APP ?? path.join(desktopRoot, "release", `mac-${process.arch}`, "Stow.app");
if (!fs.existsSync(packedApp)) throw new Error(`${packedApp} is missing: run \`pnpm dist:dir\` first`);
const { check, finish } = checks();
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "amc-packaged-"));
const fixture = buildFixtureHome(fs.mkdtempSync(path.join(scratch, "fixture-")));

/** The server's ready line, from the packed binary run as Node on the bundle inside the app. */
function serverReadyLine() {
  const server = spawn(path.join(packedApp, "Contents/MacOS/Stow"), [path.join(packedApp, "Contents/Resources/server/dist/main.js")], {
    env: { PATH: "/usr/bin:/bin", HOME: os.homedir(), ELECTRON_RUN_AS_NODE: "1", AMC_TOKEN_STDIN: "1", AMC_HOME: path.join(scratch, "server-home"), AMC_SOURCE_HOME: fixture.home, AMC_PORT: "0", AMC_ALLOWED_ORIGINS: "file://" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  server.stdin.write("a-token-for-this-check\n");
  return new Promise((resolve) => {
    let said = "";
    const done = (line) => { server.kill("SIGKILL"); resolve(line); };
    server.stdout.on("data", (chunk) => { said += chunk; if (said.includes("\n")) done(said.split("\n")[0]); });
    server.stderr.on("data", (chunk) => { said += chunk; });
    server.on("exit", (code) => resolve(`exited with code ${code}: ${said}`));
    setTimeout(() => done(`nothing in 15s: ${said}`), 15_000);
  });
}

/** A copy of the packed app whose executables are named Electron, so it honours quiet mode. */
function quietCopy() {
  const copy = path.join(scratch, "Stow.app");
  execFileSync("cp", ["-cR", packedApp, copy]);
  const rename = (bundle, from, to) => {
    fs.renameSync(path.join(bundle, "Contents/MacOS", from), path.join(bundle, "Contents/MacOS", to));
    execFileSync("plutil", ["-replace", "CFBundleExecutable", "-string", to, path.join(bundle, "Contents/Info.plist")]);
  };
  rename(copy, "Stow", "Electron");
  execFileSync("plutil", ["-replace", "LSUIElement", "-bool", "true", path.join(copy, "Contents/Info.plist")]);
  const frameworks = path.join(copy, "Contents/Frameworks");
  for (const helper of fs.readdirSync(frameworks).filter((name) => name.startsWith("Stow Helper"))) {
    const named = helper.replace("Stow", "Electron");
    fs.renameSync(path.join(frameworks, helper), path.join(frameworks, named));
    rename(path.join(frameworks, named), helper.replace(".app", ""), named.replace(".app", ""));
  }
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", copy], { stdio: "ignore" });
  return path.join(copy, "Contents/MacOS/Electron");
}

const ready = await serverReadyLine();
check("the packed binary runs the packed server as Node", ready.includes('"type":"ready"'), ready);

const app = await launchLiveApp({ name: "packaged", sourceHome: fixture.home, binary: quietCopy() });
try {
  const { page } = app;
  await until(() => page.eval(`document.querySelectorAll(".lib-row").length > 0`), 20_000, "the Library's rows");
  const shown = await page.eval(`({
    rows: document.querySelectorAll(".lib-row").length,
    counted: Number([...document.querySelectorAll(".lib-nav-row")].find((r) => r.querySelector(".lib-nav-name")?.textContent === "All memories")?.querySelector(".lib-nav-count")?.textContent),
    from: location.href,
  })`);
  check("the window's page is the one inside the app's asar", shown.from.includes("app.asar/out/renderer/index.html"), shown.from);
  check("the Library lists a row for each memory it counts", shown.rows > 0 && shown.rows === shown.counted, `${shown.rows} rows, ${shown.counted} counted`);
} finally {
  await app.stop();
  fs.rmSync(scratch, { recursive: true, force: true });
}
finish();
