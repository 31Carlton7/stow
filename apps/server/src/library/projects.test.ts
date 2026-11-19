import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir } from "@amc/test-utils";
import { realOr } from "./paths";
import { isScratchPath, projectRoot, projectsOf } from "./projects";

/** A home with a repository, a worktree of it, a second folder of the same name, and a plain folder. */
function home(): string {
  const root = realOr(tempDir("amc-projects-"));
  mkdirSync(join(root, "work/realm/.git/worktrees/fix-a"), { recursive: true });
  mkdirSync(join(root, "work/realm/apps/desktop"), { recursive: true });
  mkdirSync(join(root, "worktrees/fix-a"), { recursive: true });
  writeFileSync(join(root, "worktrees/fix-a/.git"), `gitdir: ${join(root, "work/realm/.git/worktrees/fix-a")}\n`);
  mkdirSync(join(root, "old/realm/.git"), { recursive: true });
  mkdirSync(join(root, "notes"), { recursive: true });
  return root;
}

describe("projectRoot", () => {
  it("is the top of the repository, from any folder inside it", () => {
    const root = home();
    expect(projectRoot(join(root, "work/realm/apps/desktop"))).toBe(join(root, "work/realm"));
  });

  it("takes a worktree to the checkout it is a worktree of", () => {
    const root = home();
    // THE MUTANT: stop at the worktree's own `.git` file, and every worktree is a project of its own.
    expect(projectRoot(join(root, "worktrees/fix-a"))).toBe(join(root, "work/realm"));
  });

  it("leaves a folder in no repository as its own top", () => {
    const root = home();
    expect(projectRoot(join(root, "notes"))).toBe(join(root, "notes"));
  });
});

describe("projectsOf", () => {
  it("is one project per repository, with scratch, missing and home folders left out", () => {
    const root = home();
    const projects = projectsOf([
      join(root, "work/realm"), join(root, "work/realm/apps/desktop"), join(root, "worktrees/fix-a"),
      join(root, "old/realm"), join(root, "notes"), join(root, "gone"), root, "/tmp/scratch-run",
    ], root);
    expect(projects.map((p) => p.root)).toEqual([join(root, "notes"), join(root, "old/realm"), join(root, "work/realm")]);
    expect(projects.map((p) => p.name)).toEqual(["notes", "realm · old", "realm · work"]);
  });
});

describe("isScratchPath", () => {
  it("knows both spellings of a Mac's temp folders", () => {
    expect(isScratchPath("/var/folders/n6/x/T/run")).toBe(true);
    expect(isScratchPath("/private/var/folders/n6/x/T/run")).toBe(true);
    expect(isScratchPath("/Users/me/work")).toBe(false);
    expect(isScratchPath("relative/path")).toBe(true);
  });
});
