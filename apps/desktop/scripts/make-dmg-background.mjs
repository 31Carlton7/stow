/**
 * Draws the picture behind the disk image's window (run with: pnpm build && node apps/desktop/scripts/make-dmg-background.mjs)
 *
 * Writes `build/dmg-background.png` (660 by 420, the window's size in points), `dmg-background@2x.png`
 * and `dmg-background.tiff`, which holds both so the Finder picks the one for the display. The picture
 * is HTML, drawn by the built app's own page in the quiet window a live check uses, as make-icon.mjs
 * draws the icon.
 *
 * The Finder lays the app's icon and the Applications folder over it at the centres
 * electron-builder.yml gives (`dmg.contents`): APP and APPLICATIONS here must stay the same points.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchLiveApp, sleep } from "./lib/live-app.mjs";

const buildDir = fileURLToPath(new URL("../build", import.meta.url));
const WINDOW = { width: 660, height: 420 };
const APP = { x: 180, y: 190 };
const APPLICATIONS = { x: 480, y: 190 };
// The arrow keeps clear of the two 128pt icons.
const arrow = { from: APP.x + 96, to: APPLICATIONS.x - 96, y: APP.y };

const picture = `
<div style="position:fixed; inset:0; z-index:2147483647; overflow:hidden;
  background: #f7f7fb;">
  <svg width="${WINDOW.width}" height="${WINDOW.height}" viewBox="0 0 ${WINDOW.width} ${WINDOW.height}" style="position:absolute; inset:0"
    fill="none" stroke="#4136C8" stroke-opacity="0.7" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M${arrow.from} ${arrow.y} H${arrow.to}"/>
    <path d="M${arrow.to - 9} ${arrow.y - 8} L${arrow.to} ${arrow.y} L${arrow.to - 9} ${arrow.y + 8}"/>
  </svg>
  <p style="position:absolute; left:0; right:0; top:330px; margin:0; text-align:center;
    font:300 17px/24px -apple-system, 'SF Pro Text', 'Helvetica Neue', sans-serif; letter-spacing:0.01em; color:rgb(34 36 58 / 0.88);">
    Drag Stow to Applications
  </p>
</div>`;

const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), "amc-dmg-home-"));
const app = await launchLiveApp({ name: "dmg-background", sourceHome: emptyHome });
try {
  await app.page.eval(`(() => {
    const host = document.createElement("div");
    host.attachShadow({ mode: "open" }).innerHTML = ${JSON.stringify(picture)};
    document.body.append(host);
  })()`);
  for (const [name, scale] of [["dmg-background.png", 1], ["dmg-background@2x.png", 2]]) {
    await app.page.send("Emulation.setDeviceMetricsOverride", { ...WINDOW, deviceScaleFactor: scale, mobile: false });
    await sleep(300);
    const { data } = await app.page.send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, ...WINDOW, scale: 1 } });
    fs.writeFileSync(path.join(buildDir, name), Buffer.from(data, "base64"));
  }
  // `-cathidpicheck` refuses a pair that is not the same picture at 1x and 2x.
  execFileSync("tiffutil", ["-cathidpicheck", path.join(buildDir, "dmg-background.png"), path.join(buildDir, "dmg-background@2x.png"), "-out", path.join(buildDir, "dmg-background.tiff")]);
  console.log(`wrote dmg-background.png, dmg-background@2x.png and dmg-background.tiff in ${buildDir}`);
} finally {
  await app.stop();
  fs.rmSync(emptyHome, { recursive: true, force: true });
}
