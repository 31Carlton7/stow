import { lstatSync, readdirSync, realpathSync, statSync, type Dirent } from "node:fs";
import { basename, dirname, extname, join, relative } from "node:path";
import type { SkillLibrary } from "@amc/contracts";
import { git } from "../library/git";
import { within } from "../library/paths";
import { RpcError } from "../rpc/error";

export const SKILL_FILE = "SKILL.md";

/** Repositories that hold skill folders and can be cloned without signing in. Checked by hand in
 *  November 2026; a directory that only lists other people's repositories is not one of these. */
export const SKILL_LIBRARIES: readonly SkillLibrary[] = [
  {
    name: "Anthropic",
    url: "https://github.com/anthropics/skills",
    about: "Anthropic's own examples: documents, spreadsheets and slides, design, testing a web app, building an MCP server. Most are Apache 2.0.",
  },
  {
    name: "Vercel",
    url: "https://github.com/vercel-labs/agent-skills",
    about: "Vercel's collection for coding agents, mostly React, Next.js and web design review. The skills.sh directory lists many more repositories: paste one's GitHub address to look inside.",
  },
];

/** What a person pasted, understood: a folder on this Mac, or a repository to clone and the folder of it they mean. */
export type SourceRequest =
  | { kind: "folder"; folder: string }
  | { kind: "repository"; url: string; ref: string | null; sub: string };

const refuse = (why: string): RpcError => new RpcError("SKILLS_SOURCE", why);
const REF = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;
const SHORTHAND = /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9_.-]+$/;

/** `tree/<branch>/<folder…>` or `blob/<branch>/<folder…>/SKILL.md`, as GitHub and GitLab write a folder's address. */
function branchAndFolder(kind: string, rest: string[]): { ref: string | null; sub: string } {
  const [ref, ...folders] = rest;
  if (!ref) return { ref: null, sub: "" };
  if (!REF.test(ref)) throw refuse(`“${ref}” is not a branch name this can fetch.`);
  const segments = (kind === "blob" ? folders.slice(0, -1) : folders).map((segment) => decodeURIComponent(segment));
  if (segments.some((segment) => segment === ".." || segment === "." || segment.includes("/"))) throw refuse("That address names a folder outside its repository.");
  return { ref, sub: segments.join("/") };
}

/**
 * Only a folder on this Mac or an https address is taken. `http`, `ssh`, `git@` and `file:` are
 * refused, and so is an address with a name or password in it: nothing is fetched with credentials.
 */
export function readSource(from: string, home: string): SourceRequest {
  const pasted = from.trim();
  if (pasted === "~" || pasted.startsWith("~/")) return { kind: "folder", folder: join(home, pasted.slice(1)) };
  if (pasted.startsWith("/")) return { kind: "folder", folder: pasted };
  let address: URL;
  try { address = new URL(SHORTHAND.test(pasted) ? `https://github.com/${pasted}` : pasted); } catch {
    throw refuse("That is not a folder on this Mac or an https address of a repository.");
  }
  if (address.protocol !== "https:") throw refuse("Only https addresses and folders on this Mac can be looked at.");
  if (address.username || address.password) throw refuse("That address has a sign-in in it. Only repositories anyone can read are fetched.");

  const segments = address.pathname.split("/").filter(Boolean);
  if (address.hostname === "github.com" && segments.length >= 2) {
    const [owner, repo, kind, ...rest] = segments as [string, string, ...string[]];
    const url = `https://github.com/${owner}/${repo.replace(/\.git$/, "")}`;
    return kind === "tree" || kind === "blob" ? { kind: "repository", url, ...branchAndFolder(kind, rest) } : { kind: "repository", url, ref: null, sub: "" };
  }
  const dash = segments.indexOf("-");
  if (address.hostname === "gitlab.com" && dash >= 2 && (segments[dash + 1] === "tree" || segments[dash + 1] === "blob")) {
    return { kind: "repository", url: `https://gitlab.com/${segments.slice(0, dash).join("/")}`, ...branchAndFolder(segments[dash + 1]!, segments.slice(dash + 2)) };
  }
  return { kind: "repository", url: `${address.origin}${address.pathname}`, ref: null, sub: "" };
}

/**
 * On top of the hardening `git` adds itself: no hooks, no credential helper (so the person's saved
 * sign-ins are never offered to the host), and no LFS download.
 */
const CLONE_CONFIG = ["-c", "core.hooksPath=/dev/null", "-c", "credential.helper=", "-c", "filter.lfs.smudge=", "-c", "filter.lfs.process=", "-c", "filter.lfs.required=false"];

/** Clone the tip of one branch into `into`, which must not exist, and answer with its commit. Stops with `git`'s own timeout. */
export async function cloneShallow(url: string, ref: string | null, into: string): Promise<string | null> {
  const clone = [...CLONE_CONFIG, "clone", "--quiet", "--depth", "1", "--single-branch", "--no-tags", "--no-recurse-submodules", ...(ref ? ["--branch", ref] : []), "--", url, into];
  let cloned;
  try { cloned = await git(dirname(into), clone); } catch (e) {
    if ((e as { code?: unknown }).code === "ENOENT") throw new RpcError("SKILLS_FETCH", "git is not installed on this Mac, so a repository cannot be fetched.");
    throw new RpcError("SKILLS_FETCH", "Fetching that took too long and was stopped. Try the address of one folder, or download it and point at the folder.");
  }
  if (cloned.code !== 0) {
    const said = cloned.stderr.trim().split("\n").find((line) => line.startsWith("fatal:") || line.startsWith("remote:")) ?? "";
    throw new RpcError("SKILLS_FETCH", `That could not be fetched. ${said.replace(/^fatal: /, "")}`.trim());
  }
  const head = await git(into, ["rev-parse", "HEAD"]);
  return head.code === 0 ? head.stdout.trim() : null;
}

export const MAX_FILES = 5_000;
export const MAX_BYTES = 100 * 1024 * 1024;
const MAX_FOLDERS = 20_000;
const MAX_DEPTH = 6;
const SCRIPT_ENDINGS = new Set([".sh", ".bash", ".zsh", ".command", ".py", ".rb", ".pl", ".php", ".js", ".mjs", ".cjs", ".ts", ".applescript", ".scpt", ".swift", ".exe", ".bin"]);

const entriesOf = (dir: string): Dirent[] => { try { return readdirSync(dir, { withFileTypes: true }); } catch { return []; } };
const isPlainFile = (path: string): boolean => { try { return lstatSync(path).isFile(); } catch { return false; } };

/** The folders at or under `start` that hold a `SKILL.md`, as paths from `root`. A skill's own folder
 *  is not searched for more, and a folder that is a link is never followed. */
export function skillFolders(root: string, start: string): string[] {
  const out: string[] = [];
  let seen = 0;
  const visit = (dir: string, left: number): void => {
    if (isPlainFile(join(dir, SKILL_FILE))) { out.push(relative(root, dir) || "."); return; }
    if (left === 0) return;
    for (const entry of entriesOf(dir)) {
      if (!entry.isDirectory() || entry.name === ".git" || entry.name === "node_modules") continue;
      if (++seen > MAX_FOLDERS) throw new RpcError("SKILLS_TOO_BIG", "That folder is too big to look through. Point at the folder that holds the skills.");
      visit(join(dir, entry.name), left - 1);
    }
  };
  visit(start, MAX_DEPTH);
  return out.sort();
}

export type SkillFile = { rel: string; real: string; bytes: number; runs: boolean };

/**
 * Every file of one skill folder. A link is read through only when it leads to a file inside `root`,
 * the folder that was fetched; any other link is named in `leaves` and is not among the files.
 */
export function skillFiles(dir: string, root: string): { files: SkillFile[]; leaves: string[] } {
  const files: SkillFile[] = [];
  const leaves: string[] = [];
  const visit = (folder: string, rel: string): void => {
    for (const entry of entriesOf(folder)) {
      if (entry.name === ".git" || entry.name === ".DS_Store") continue;
      const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
      const path = join(folder, entry.name);
      if (entry.isDirectory()) { visit(path, childRel); continue; }
      let real = path;
      if (entry.isSymbolicLink()) {
        try { real = realpathSync(path); } catch { leaves.push(childRel); continue; }
        if (!within(real, root) || !statSync(real).isFile()) { leaves.push(childRel); continue; }
      } else if (!entry.isFile()) continue;
      const stat = statSync(real);
      files.push({ rel: childRel, real, bytes: stat.size, runs: (stat.mode & 0o111) !== 0 || SCRIPT_ENDINGS.has(extname(entry.name).toLowerCase()) });
      if (files.length > MAX_FILES) throw new RpcError("SKILLS_TOO_BIG", `${basename(dir)} holds more than ${MAX_FILES} files, which is too many for a skill.`);
    }
  };
  visit(dir, "");
  return { files: files.sort((a, b) => a.rel.localeCompare(b.rel)), leaves };
}
