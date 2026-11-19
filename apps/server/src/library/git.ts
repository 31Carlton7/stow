import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { APP_NAME } from "@amc/contracts";
import { RpcError } from "../rpc/error";

/**
 * Prepended to every git invocation. `core.fsmonitor` is repo-local config naming an arbitrary
 * command git runs for status, so a hostile checkout would otherwise get code execution the moment
 * the app looked at it.
 */
const GIT_HARDENING = ["-c", "core.fsmonitor=", "-c", "diff.external="];

/** Every commit is made with an identity passed per command (never the person's global config), no
 *  signing prompt, and no hooks: a repo's `.git/hooks` is code the app did not choose to run. */
const COMMIT_CONFIG = ["-c", `user.name=${APP_NAME}`, "-c", "user.email=stow@localhost", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null"];

const GIT_TIMEOUT_MS = 20_000;

type GitResult = { code: number; stdout: string; stderr: string };

/** Run one git command in `cwd` and report its exit code and output. Never rejects on a non-zero
 *  exit, so the caller can read git's refusal; only a failure to run git at all rejects. Always
 *  execFile: paths are the person's data and must never reach a shell string. */
export function git(cwd: string, args: string[]): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    execFile("git", [...GIT_HARDENING, ...args], { cwd, timeout: GIT_TIMEOUT_MS, encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
      (err, stdout, stderr) => {
        const e = err as (Error & { code?: number | string; killed?: boolean }) | null;
        if (e && (e.code === "ENOENT" || e.killed)) { reject(e); return; }
        resolve({ code: typeof e?.code === "number" ? e.code : e ? 1 : 0, stdout, stderr });
      });
  });
}

async function must(repo: string, args: string[]): Promise<string> {
  const r = await git(repo, args);
  if (r.code !== 0) throw new RpcError("LIBRARY_GIT", (r.stderr || r.stdout).trim() || `git ${args[0]} failed`);
  return r.stdout;
}

/** The paths of `paths` with changes git has not committed, new files included. */
async function uncommitted(repo: string, paths: readonly string[]): Promise<string[]> {
  const out = await must(repo, ["status", "--porcelain", "-z", "--untracked-files=all", "--no-renames", "--", ...paths]);
  return out.split("\0").filter(Boolean).map((entry) => entry.slice(3));
}

/**
 * Write files into a git repository as one commit: `writes` maps a path from the repo's root to its
 * new text, or to null to delete it. Staged by path, so nothing else in the repo rides along.
 *
 * Refused when a file it would change already has uncommitted changes: another writer (Realm, or
 * Claude mid-turn) is not finished with it, and committing now would fold their half-done edit into
 * this one. If the commit fails the files are put back as they were.
 */
export async function commitFiles(repo: string, writes: ReadonlyMap<string, string | null>, message: string): Promise<{ sha: string }> {
  const paths = [...writes.keys()];
  const held = await uncommitted(repo, paths);
  if (held.length > 0) throw new RpcError("LIBRARY_REPO_BUSY", `${held.join(", ")} has changes that are not committed yet. Something else is writing this repo: try again in a moment.`);
  const before = new Map(paths.map((rel) => [rel, existsSync(join(repo, rel)) ? readFileSync(join(repo, rel), "utf8") : null]));
  try {
    for (const [rel, text] of writes) {
      if (text === null) { rmSync(join(repo, rel), { force: true }); continue; }
      mkdirSync(dirname(join(repo, rel)), { recursive: true });
      writeFileSync(join(repo, rel), text);
    }
    await must(repo, ["add", "--all", "--", ...paths]);
    await must(repo, [...COMMIT_CONFIG, "commit", "-q", "-m", message, "--", ...paths]);
  } catch (e) {
    for (const [rel, text] of before) {
      if (text === null) rmSync(join(repo, rel), { force: true });
      else writeFileSync(join(repo, rel), text);
    }
    await git(repo, ["reset", "-q", "--", ...paths]);
    throw e;
  }
  return { sha: (await must(repo, ["rev-parse", "HEAD"])).trim() };
}

/**
 * Undo one commit with a new commit that reverses it. Refused, and the repository left as it was,
 * when later changes to the same lines stand in the way.
 */
export async function revertCommit(repo: string, sha: string): Promise<void> {
  const reverted = await git(repo, [...COMMIT_CONFIG, "revert", "--no-edit", sha]);
  if (reverted.code === 0) return;
  await git(repo, ["revert", "--abort"]);
  throw new RpcError("LIBRARY_GIT", `that change cannot be undone on its own: ${(reverted.stderr || reverted.stdout).trim().split("\n")[0]}`);
}
