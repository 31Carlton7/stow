import { copyFileSync, mkdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/** `20261117-193005`, for a backup folder's name. */
const stamp = (d: Date): string => d.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);

/**
 * Copy a file into the app's backup folder before it is changed, under the file's own path, so a
 * backup says where it came from. Returns the copy's path.
 */
export function backUp(abs: string, backupRoot: string, now = new Date()): string {
  const to = join(backupRoot, stamp(now), abs);
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(abs, to);
  return to;
}

/**
 * Replace a file's text in one step: written beside it, then renamed over it. An agent reading the
 * file sees the old text or the new, never half of one. The file keeps its mode.
 */
export function writeFileAtomic(abs: string, text: string): void {
  const tmp = join(dirname(abs), `.${basename(abs)}.${process.pid}.tmp`);
  let mode: number | undefined;
  try { mode = statSync(abs).mode; } catch { /* a new file takes the default */ }
  writeFileSync(tmp, text, mode === undefined ? {} : { mode });
  renameSync(tmp, abs);
}
