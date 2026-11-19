import { closeSync, existsSync, openSync, readSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

/**
 * Claude's project-directory names are a lossy encoding of the cwd: every character that is not a
 * letter or a digit becomes `-`. `-Users-name-Projects-atlas` could decode to `/Users/name/Projects/atlas`
 * or `/Users/name/Projects-atlas`, and nothing in the name says which.
 *
 * So the decode is checked against the filesystem, one level at a time, LONGEST RUN FIRST: at each
 * level the actual children are listed and the longest run of remaining parts that names one of them
 * is taken as that segment. A shortest-first walk commits to `School/FA25`, which does not exist,
 * before it can discover that the real child is `FA25-CS-101`.
 *
 * Each child is compared the way Claude wrote it, so a folder like `.verify` is found by its own name.
 * Two children that encode alike (`a_b` beside `a.b`) leave the name ambiguous, and an ambiguous or
 * missing name decodes to nothing rather than to a confident wrong path.
 */
export function decodeClaudeProjectSlug(slug: string, childrenOf: (dir: string) => string[]): string | null {
  if (!slug.startsWith("-")) return null;
  const parts = slug.slice(1).split("-");
  let path = "";
  for (let i = 0; i < parts.length;) {
    const byEncoding = new Map<string, string | null>();
    for (const child of childrenOf(path === "" ? "/" : path)) {
      const encoded = child.replace(/[^a-zA-Z0-9]/g, "-");
      byEncoding.set(encoded, byEncoding.has(encoded) ? null : child);
    }
    let taken = -1;
    let child: string | null | undefined;
    for (let j = parts.length - 1; j >= i; j--) {
      child = byEncoding.get(parts.slice(i, j + 1).join("-"));
      if (child !== undefined) { taken = j; break; }
    }
    if (taken === -1 || !child) return null;
    path = `${path}/${child}`;
    i = taken + 1;
  }
  return path;
}

const childrenOf = (dir: string): string[] => { try { return readdirSync(dir); } catch { return []; } };

/** Slugs already decoded to a folder. A decode lists a folder per path segment, and there are
 *  hundreds of slugs; a folder found once is only checked to still be there. */
const decoded = new Map<string, string>();

/** The folder a Claude project slug was made for, when that folder is on disk now. */
export function claudeProjectFolder(slug: string): string | null {
  const known = decoded.get(slug);
  if (known && existsSync(known)) return known;
  const onDisk = decodeClaudeProjectSlug(slug, childrenOf);
  if (onDisk) decoded.set(slug, onDisk);
  else decoded.delete(slug);
  return onDisk;
}

/**
 * Where a Claude project folder's sessions ran: found on disk when the folder is still there, else
 * from a transcript beside the memory, which records the path whole. Null when neither says.
 */
export function claudeProjectCwd(projectDir: string): string | null {
  const slug = basename(projectDir);
  const onDisk = claudeProjectFolder(slug);
  if (onDisk) return onDisk;
  const recorded = transcriptCwd(projectDir);
  return recorded && recorded.replace(/[^a-zA-Z0-9]/g, "-") === slug ? recorded : null;
}

/**
 * A Claude project folder's name as a person knows it, when its path is not known: the last part of
 * the slug, `-` read back as `/`. That can only be trusted when the final part kept every character
 * (`-a-b-` lost the end of its name and `-a--b` the mark before it), and otherwise the raw name stands.
 */
export function claudeSlugLabel(slug: string): string {
  const parts = slug.split("-");
  const last = parts.at(-1)!;
  return slug.startsWith("-") && last !== "" && (parts.length === 2 || parts.at(-2) !== "") ? last : slug;
}

/** The working folder a Claude project's transcripts record, read from the head of the first that says. */
function transcriptCwd(projectDir: string): string | null {
  let logs: string[];
  try { logs = readdirSync(projectDir).filter((n) => n.endsWith(".jsonl")).sort(); } catch { return null; }
  for (const log of logs.slice(0, 3)) {
    const m = /"cwd"\s*:\s*("(?:[^"\\]|\\.)*")/.exec(fileHead(join(projectDir, log), 64 * 1024));
    if (!m) continue;
    try { return JSON.parse(m[1]!) as string; } catch { /* a line cut off mid-string: try the next log */ }
  }
  return null;
}

function fileHead(path: string, bytes: number): string {
  let fd: number | null = null;
  try {
    fd = openSync(path, "r");
    const buf = Buffer.alloc(bytes);
    return buf.toString("utf8", 0, readSync(fd, buf, 0, bytes, 0));
  } catch { return ""; } finally { if (fd !== null) closeSync(fd); }
}
