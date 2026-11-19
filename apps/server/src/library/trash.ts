import { execFile } from "node:child_process";
import { existsSync, mkdirSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
/** macOS's own command (macOS 15 and later): the Finder's move, so Put Back knows where the file was. */
const TRASH_BIN = "/usr/bin/trash";

/**
 * Move a file to the Trash of the home folder it was read from. In the person's own home that is the
 * Finder's move. Where the Mac has no `trash` command, or the home is a check's fixture, the file
 * goes into that home's `.Trash` under a name of its own, the way the Finder names a second file of
 * one name: kept, but without Put Back.
 */
export async function moveToTrash(path: string, home: string): Promise<void> {
  if (home === homedir() && existsSync(TRASH_BIN)) {
    await run(TRASH_BIN, [path]);
    return;
  }
  const bin = join(home, ".Trash");
  mkdirSync(bin, { recursive: true });
  const ext = extname(path);
  const stem = basename(path, ext);
  let to = join(bin, basename(path));
  for (let n = 2; existsSync(to); n++) to = join(bin, `${stem} ${n}${ext}`);
  renameSync(path, to);
}
