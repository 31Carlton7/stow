import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { readOr, realOr, within } from "./paths";

/** A folder agents have worked in, by the top of its repository. */
export type Project = { id: string; name: string; root: string };

export const projectId = (root: string): string => createHash("sha1").update(root).digest("hex").slice(0, 12);

/**
 * Directory prefixes whose contents are scratch: temp trees, and the per-run checkouts tests build
 * inside them. `/private` is listed alongside `/tmp` and `/var` because macOS resolves both to the
 * same place and a recorded path holds whichever form the process happened to.
 */
const SCRATCH_PREFIXES = ["/tmp", "/private/tmp", "/var/folders", "/private/var/folders", "/var/tmp", "/private/var/tmp"];

export function isScratchPath(folder: string, tmp = tmpdir()): boolean {
  if (!folder || !isAbsolute(folder)) return true;
  const p = resolve(folder);
  const under = (prefix: string) => p === prefix || p.startsWith(prefix.endsWith(sep) ? prefix : prefix + sep);
  return [...SCRATCH_PREFIXES, resolve(tmp)].some(under);
}

/**
 * The top of the repository a folder is in, read from `.git` without running git. A worktree's `.git`
 * is a file naming `<main>/.git/worktrees/<name>`, and its project is the main checkout: twenty
 * worktrees of one repository are one project. A folder in no repository is its own top.
 */
export function projectRoot(folder: string): string {
  for (let dir = folder; ; dir = dirname(dir)) {
    const dotGit = join(dir, ".git");
    let isFile: boolean;
    try { isFile = statSync(dotGit).isFile(); } catch {
      if (dirname(dir) === dir) return folder;
      continue;
    }
    if (!isFile) return dir;
    const gitdir = /^gitdir:\s*(.+)$/m.exec(readOr(dotGit) ?? "")?.[1]?.trim();
    const worktrees = gitdir?.indexOf(`${sep}.git${sep}worktrees${sep}`) ?? -1;
    return gitdir && worktrees !== -1 ? gitdir.slice(0, worktrees) : dir;
  }
}

/**
 * Projects from the folders agents have recorded working in. Folders that are gone, scratch folders
 * and the home folder itself are left out. Two projects of one name are told apart by their parent.
 *
 * A scratch folder inside `home` still counts: a check's fixture home is itself in a temp folder.
 */
export function projectsOf(folders: Iterable<string>, home: string): Project[] {
  const realHome = realOr(home);
  const roots = new Set<string>();
  for (const folder of folders) {
    const real = realOr(folder);
    if (isScratchPath(real) && !within(real, realHome)) continue;
    try { if (!statSync(real).isDirectory()) continue; } catch { continue; }
    const root = projectRoot(real);
    if (root !== realHome) roots.add(root);
  }
  const named = new Map<string, number>();
  for (const root of roots) named.set(basename(root), (named.get(basename(root)) ?? 0) + 1);
  return [...roots].sort().map((root) => ({
    id: projectId(root), root,
    name: named.get(basename(root))! > 1 ? `${basename(root)} · ${basename(dirname(root))}` : basename(root),
  }));
}
