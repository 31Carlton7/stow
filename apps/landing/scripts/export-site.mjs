/**
 * Writes the page as it is served under a path of another site
 * (run with: node apps/landing/scripts/export-site.mjs <outDir> [/stow])
 *
 * The page's files name each other relatively, which works wherever the page's address ends in a
 * slash. A site that serves it at `/stow`, with no slash, would look for `styles.css` at its own
 * root. So each relative address in the three pages is written from the site's root, under the
 * path given, and the page's own address loses `index.html`. The stylesheet's addresses are
 * relative to the stylesheet and need nothing.
 *
 * The share-image candidates (`og-a.png` and its siblings) are left behind: only the chosen
 * `og.png` and `twitter.png` are served.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [outDir, base = "/stow"] = process.argv.slice(2);
if (!outDir) throw new Error("usage: export-site.mjs <outDir> [/path]");

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAGES = ["index.html", "privacy.html", "terms.html"];
const isCandidate = (file) => /^og-[a-z]\.png$/.test(path.basename(file));

/** A relative address, from the site's root. One with a scheme, a root or only a fragment is left as it is. */
function rooted(address) {
  if (/^([a-z][a-z0-9+.-]*:|\/|#)/i.test(address)) return address;
  return address === "index.html" ? base : `${base}/${address}`;
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
for (const page of PAGES) {
  const html = fs.readFileSync(path.join(site, page), "utf8")
    .replace(/\b(href|src|srcset)="([^"]*)"/g, (_, name, address) => `${name}="${rooted(address)}"`)
    // The page's own address, as the share tags and the canonical link give it.
    .replaceAll(`${base}/"`, `${base}"`);
  fs.writeFileSync(path.join(outDir, page), html);
}
for (const file of ["styles.css", "script.js"]) fs.copyFileSync(path.join(site, file), path.join(outDir, file));
fs.cpSync(path.join(site, "assets"), path.join(outDir, "assets"), { recursive: true, filter: (from) => !isCandidate(from) });

const written = fs.readdirSync(outDir, { recursive: true }).filter((name) => fs.statSync(path.join(outDir, name)).isFile());
console.log(`wrote ${written.length} files under ${outDir} for ${base}`);
