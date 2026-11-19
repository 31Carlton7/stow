/**
 * The pictures a link to the site unfurls with, and the tags that point at them
 * (run with: apps/desktop/node_modules/.bin/electron apps/landing/scripts/share-images.mjs)
 *
 * Draws share.html in a window nobody can see and writes ../assets/og-a.png, og-b.png and og-c.png
 * (1200 by 630, one for each drawing), then og.png and twitter.png (1200 by 600) from the drawing
 * named in CHOSEN. It also rewrites the block between "share:start" and "share:end" in each page,
 * so the site's address is written here and nowhere else.
 */
import { app, BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Where the site is served from, with its closing slash. Change it here and run this script.
const SITE_URL = "https://www.carltonaikins.com/stow/";
// Which drawing og.png and twitter.png are made from: "a" (the window, light), "b" (the tray on
// the icon's indigo) or "c" (the window, dark).
const CHOSEN = "a";

const landing = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assets = path.join(landing, "assets");
const PAGES = ["index.html", "privacy.html", "terms.html"];

function shareTags(file, html) {
  const title = html.slice(html.indexOf("<title>") + 7, html.indexOf("</title>"));
  const describedAt = html.indexOf('<meta name="description" content="') + 34;
  const description = html.slice(describedAt, html.indexOf('">', describedAt));
  const address = SITE_URL + (file === "index.html" ? "" : file);
  return [
    `<link rel="canonical" href="${address}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="Stow">`,
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${description}">`,
    `<meta property="og:url" content="${address}">`,
    `<meta property="og:image" content="${SITE_URL}assets/og.png">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta property="og:image:alt" content="The Stow icon and name, with the line: one place for what your agents know.">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:creator" content="@31carlton7">`,
    `<meta name="twitter:title" content="${title}">`,
    `<meta name="twitter:description" content="${description}">`,
    `<meta name="twitter:image" content="${SITE_URL}assets/twitter.png">`,
  ].map((tag) => `    ${tag}\n`).join("");
}

for (const file of PAGES) {
  const html = fs.readFileSync(path.join(landing, file), "utf8");
  const blockStarts = html.indexOf("\n", html.indexOf("<!-- share:start")) + 1;
  const blockEnds = html.indexOf("    <!-- share:end -->");
  fs.writeFileSync(path.join(landing, file), html.slice(0, blockStarts) + shareTags(file, html) + html.slice(blockEnds));
  console.log(`tags ${file}`);
}

app.dock?.hide();
// Waited for with `then`: Electron does not become ready while its main module is still awaiting.
app.whenReady().then(draw);

async function draw() {
  // As page-shots.mjs makes its window: painted, but at an alpha nobody can see, and never focused.
  const win = new BrowserWindow({ show: false, focusable: false, opacity: 1 / 255, hasShadow: false, width: 1200, height: 630 });
  win.setIgnoreMouseEvents(true);
  win.showInactive();
  await win.loadFile(path.join(landing, "scripts/share.html"));
  const cdp = win.webContents.debugger;
  cdp.attach("1.3");
  const ask = async (expression) => (await cdp.sendCommand("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.value;

  const indexHtml = fs.readFileSync(path.join(landing, "index.html"), "utf8");
  const marks = indexHtml.slice(indexHtml.indexOf('<svg class="sprite"'), indexHtml.indexOf("</svg>", indexHtml.indexOf('<svg class="sprite"')) + 6);

  async function picture(drawing, height, name) {
    await cdp.sendCommand("Emulation.setDeviceMetricsOverride", { width: 1200, height, deviceScaleFactor: 1, mobile: false });
    await ask(`(async () => {
      if (document.querySelector(".sprite") === null) document.body.insertAdjacentHTML("afterbegin", ${JSON.stringify(marks)});
      document.body.dataset.drawing = "${drawing}";
      const capture = document.querySelector("[data-capture]");
      capture.src = "assets/library-${drawing === "c" ? "dark" : "light"}.webp";
      await Promise.all([...document.images].map((img) => img.decode().catch(() => {})));
      await new Promise((painted) => requestAnimationFrame(() => requestAnimationFrame(painted)));
    })()`);
    const { data } = await cdp.sendCommand("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(assets, `${name}.png`), Buffer.from(data, "base64"));
    console.log(`shot ${path.join(assets, `${name}.png`)}`);
  }

  try {
    for (const drawing of ["a", "b", "c"]) await picture(drawing, 630, `og-${drawing}`);
    await picture(CHOSEN, 630, "og");
    await picture(CHOSEN, 600, "twitter");
  } finally {
    app.exit(0);
  }
}
