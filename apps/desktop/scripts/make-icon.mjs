/**
 * Rebuilds the app's icon from its drawing (run with: pnpm build && node apps/desktop/scripts/make-icon.mjs)
 *
 * Reads `build/icon.svg` and writes `build/icon.png` (1024px, what the Dock is given in development),
 * `build/icon.icns` (what a packager picks up) and `build/logo.png` (512px: the icon's body to the
 * edges, without the Dock's margin and shadow, for anywhere that draws it small in a tile of its
 * own). The SVG is drawn by the built app's own page, in
 * the quiet window a live check uses, because this Mac has no SVG rasteriser of its own and Chromium
 * draws the gradients and shadows as the drawing means them. Each size is drawn from the vector, not
 * scaled down from the largest.
 *
 * `icon-dark.svg` and `icon-tinted.svg` are not in the .icns, which holds one appearance. They are the
 * drawings for an Icon Composer file, when the app is packaged with one.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchLiveApp } from "./lib/live-app.mjs";

const buildDir = fileURLToPath(new URL("../build", import.meta.url));
const svg = fs.readFileSync(path.join(buildDir, "icon.svg"), "utf8");
const asUrl = (text) => `data:image/svg+xml;base64,${Buffer.from(text).toString("base64")}`;
const drawing = asUrl(svg);
// The body sits in the middle 824 of the drawing's 1024, over a shadow the logo does not carry.
const BODY = { at: 100, size: 824 };
const unlifted = svg.replace(' filter="url(#lift)"', "");
if (unlifted === svg) throw new Error("icon.svg no longer names its body's shadow as #lift");
// What `iconutil` expects in an .iconset: each point size at 1x and 2x.
const iconsetFiles = [
  ["icon_16x16.png", 16], ["icon_16x16@2x.png", 32], ["icon_32x32.png", 32], ["icon_32x32@2x.png", 64],
  ["icon_128x128.png", 128], ["icon_128x128@2x.png", 256], ["icon_256x256.png", 256], ["icon_256x256@2x.png", 512],
  ["icon_512x512.png", 512], ["icon_512x512@2x.png", 1024],
];

const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), "amc-icon-home-"));
const iconset = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "amc-icon-")), "icon.iconset");
fs.mkdirSync(iconset);
const app = await launchLiveApp({ name: "icon", sourceHome: emptyHome });
try {
  /** `px` square of the drawing at `url`: all of it, or the `part` of its 1024 given. */
  const drawAt = async (px, url = drawing, part = { at: 0, size: 1024 }) => {
    const png = await app.page.eval(`(async () => {
      const img = new Image();
      img.src = ${JSON.stringify(url)};
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = ${px};
      canvas.getContext("2d").drawImage(img, ${part.at}, ${part.at}, ${part.size}, ${part.size}, 0, 0, ${px}, ${px});
      return canvas.toDataURL("image/png");
    })()`);
    return Buffer.from(png.slice(png.indexOf(",") + 1), "base64");
  };
  for (const [name, px] of iconsetFiles) fs.writeFileSync(path.join(iconset, name), await drawAt(px));
  fs.copyFileSync(path.join(iconset, "icon_512x512@2x.png"), path.join(buildDir, "icon.png"));
  execFileSync("iconutil", ["-c", "icns", iconset, "-o", path.join(buildDir, "icon.icns")]);
  fs.writeFileSync(path.join(buildDir, "logo.png"), await drawAt(512, asUrl(unlifted), BODY));
  console.log(`wrote icon.png, icon.icns and logo.png in ${buildDir}`);
} finally {
  await app.stop();
  fs.rmSync(emptyHome, { recursive: true, force: true });
  fs.rmSync(path.dirname(iconset), { recursive: true, force: true });
}
