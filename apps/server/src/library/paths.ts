import { lstatSync, readFileSync, readdirSync, realpathSync, statSync, type Dirent } from "node:fs";
import { isAbsolute, join, relative } from "node:path";

/** How deep a walk goes under a source's root: a repo's folders, a rules folder's subfolders. */
const WALK_DEPTH = 6;

export const within = (child: string, parent: string): boolean => {
  const r = relative(parent, child);
  return r === "" || (!r.startsWith("..") && !isAbsolute(r));
};
export const realOr = (p: string): string => { try { return realpathSync(p); } catch { return p; } };
export const isDir = (p: string): boolean => { try { return statSync(p).isDirectory(); } catch { return false; } };
export const readOr = (p: string): string | null => { try { return readFileSync(p, "utf8"); } catch { return null; } };

/** `/Users/name/x` as `~/x`. */
export function tildify(p: string, home: string): string {
  const h = home.endsWith("/") ? home.slice(0, -1) : home;
  return p === h ? "~" : p.startsWith(`${h}/`) ? `~${p.slice(h.length)}` : p;
}

/**
 * Files under `root` that `keep` accepts, by path from the root: plain files, and links to files that
 * stay inside the root. A folder that is a link is never followed, nor is `.git`.
 */
export function walk(root: string, keep: (rel: string) => boolean, depth = WALK_DEPTH): string[] {
  const out: string[] = [];
  const realRoot = realOr(root);
  const visit = (dir: string, rel: string, left: number): void => {
    let entries: Dirent[];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === ".git") continue;
      const childRel = rel === "" ? e.name : `${rel}/${e.name}`;
      const abs = join(dir, e.name);
      if (e.isDirectory()) { if (left > 0) visit(abs, childRel, left - 1); continue; }
      if (!keep(childRel)) continue;
      if (e.isFile() || (e.isSymbolicLink() && insideAsFile(abs, realRoot))) out.push(childRel);
    }
  };
  visit(root, "", depth);
  return out.sort();
}

/** A link that leads to a file inside `realRoot`. Anything else is an escape, and is left out. */
function insideAsFile(abs: string, realRoot: string): boolean {
  try { return statSync(abs).isFile() && within(realpathSync(abs), realRoot); } catch { return false; }
}

/** The files of `names` that are in `root`, by the same rule `walk` uses. */
export function present(root: string, names: readonly string[]): string[] {
  const realRoot = realOr(root);
  return names.filter((n) => {
    const abs = join(root, n);
    try { return lstatSync(abs).isSymbolicLink() ? insideAsFile(abs, realRoot) : statSync(abs).isFile(); } catch { return false; }
  });
}

export function childFolders(dir: string): string[] {
  try { return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort(); } catch { return []; }
}

/**
 * Where `names` are in a project: at its top, and in each folder directly inside it. An agent loads a
 * nested instruction file when it works in that folder. Hidden folders and `node_modules` are skipped.
 */
export function presentNear(root: string, names: readonly string[]): string[] {
  const nested = childFolders(root)
    .filter((dir) => !dir.startsWith(".") && dir !== "node_modules")
    .flatMap((dir) => present(join(root, dir), names).map((name) => `${dir}/${name}`));
  return [...present(root, names), ...nested];
}
