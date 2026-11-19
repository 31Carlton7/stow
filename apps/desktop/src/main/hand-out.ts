import { constants, cpSync, existsSync, mkdtempSync, mkdirSync, realpathSync, statSync } from "node:fs";
import { basename, isAbsolute, join, relative, sep } from "node:path";

/** Longer than any definition the window shows. A page that asks to share more is not this app's. */
const TEXT_LIMIT = 20_000;

const CREDENTIALS_FILES = new Set([".credentials.json", "auth.json"]);
const isKeychain = (name: string): boolean => name === "Keychains" || name.endsWith(".keychain") || name.endsWith(".keychain-db");

/**
 * The real path of a file or folder that may leave the app, or null. The page's word is not taken
 * for it: the path must exist, lie under one of `homes` after every link in it is followed, and be
 * neither a credentials file nor in a keychain. The one folder that may leave is a skill's.
 */
export function pathToHandOut(asked: unknown, homes: readonly string[]): string | null {
  if (typeof asked !== "string" || !isAbsolute(asked)) return null;
  let real: string;
  let isFolder: boolean;
  try {
    real = realpathSync(asked);
    const stat = statSync(real);
    if (!stat.isFile() && !stat.isDirectory()) return null;
    isFolder = stat.isDirectory();
  } catch {
    return null;
  }
  const below = homes.map((home) => {
    try { return relative(realpathSync(home), real); } catch { return ".."; }
  }).find((rel) => rel !== "" && !rel.startsWith("..") && !isAbsolute(rel));
  if (below === undefined) return null;
  const names = below.split(sep);
  if (names.some(isKeychain) || CREDENTIALS_FILES.has(names.at(-1)!)) return null;
  // An agent's own folder (`~/.claude`, `~/.codex`) holds its login beside everything else.
  if (isFolder && (!existsSync(join(real, "SKILL.md")) || [...CREDENTIALS_FILES].some((name) => existsSync(join(real, name))))) return null;
  return real;
}

/**
 * A copy of `real` under `stagingDir`, with its own name, for a drag to carry. The app a thing is
 * dropped on may move it rather than copy it, and the original is an agent's memory or a transcript: it
 * must stay where the agent reads it. On APFS the copy is a clone: no room taken, and no wait for a
 * long transcript.
 */
function copyForDrag(real: string, stagingDir: string): string {
  mkdirSync(stagingDir, { recursive: true });
  const copy = join(mkdtempSync(join(stagingDir, "drag-")), basename(real));
  cpSync(real, copy, { recursive: true, mode: constants.COPYFILE_FICLONE });
  return copy;
}

export function dragOut(asked: unknown, d: { homes: readonly string[]; stagingDir: string; startDrag: (file: string) => void }): void {
  const real = pathToHandOut(asked, d.homes);
  if (real !== null) d.startDrag(copyForDrag(real, d.stagingDir));
}

/** What the share sheet is opened on, in Electron's own shape. */
export type SharingItem = { filePaths: string[] } | { texts: string[] };

export function sharingItem(asked: unknown, homes: readonly string[]): SharingItem | null {
  const { path, text } = (asked ?? {}) as { path?: unknown; text?: unknown };
  if (typeof text === "string") return text !== "" && text.length <= TEXT_LIMIT ? { texts: [text] } : null;
  const real = pathToHandOut(path, homes);
  return real === null ? null : { filePaths: [real] };
}

/** Where in the window the sheet is anchored, or null when the page gave no point. */
export function anchorOf(asked: unknown): { x: number; y: number } | null {
  const { x, y } = (asked ?? {}) as { x?: unknown; y?: unknown };
  return Number.isSafeInteger(x) && Number.isSafeInteger(y) ? { x: x as number, y: y as number } : null;
}
