import { describe, expect, it } from "vitest";
import { claudeSlugLabel, decodeClaudeProjectSlug } from "./claude-projects";

describe("decodeClaudeProjectSlug", () => {
  // The slug is lossy: `/` and `-` both encode as `-`. The decode resolves it against a real tree,
  // longest-run-first, which is the only way to tell the two apart.
  const tree: Record<string, string[]> = {
    "/": ["Users"],
    "/Users": ["me"],
    "/Users/me": ["Desktop", "Realm"],
    "/Users/me/Desktop": ["Home"],
    "/Users/me/Desktop/Home": ["School", "Work"],
    "/Users/me/Desktop/Home/School": ["FA25-CS-101"],
    "/Users/me/Desktop/Home/Work": ["Projects"],
    "/Users/me/Desktop/Home/Work/Projects": ["atlas", "atlas-worktrees", "my-site"],
    "/Users/me/Desktop/Home/Work/Projects/atlas-worktrees": ["durable-runs"],
  };
  const childrenOf = (dir: string): string[] => tree[dir] ?? [];

  it("recovers a path whose own segment contains dashes", () => {
    // The failing case from real data: a shortest-first walk commits to `School/FA25`, which does
    // not exist, and can never recover to find the real child `FA25-CS-101`.
    expect(decodeClaudeProjectSlug("-Users-me-Desktop-Home-School-FA25-CS-101", childrenOf))
      .toBe("/Users/me/Desktop/Home/School/FA25-CS-101");
  });

  it("prefers the longest real child, so a dashed directory beats a nested reading", () => {
    expect(decodeClaudeProjectSlug("-Users-me-Desktop-Home-Work-Projects-my-site", childrenOf))
      .toBe("/Users/me/Desktop/Home/Work/Projects/my-site");
  });

  it("still descends when a dashed name is a real directory with real children", () => {
    expect(decodeClaudeProjectSlug("-Users-me-Desktop-Home-Work-Projects-atlas-worktrees-durable-runs", childrenOf))
      .toBe("/Users/me/Desktop/Home/Work/Projects/atlas-worktrees/durable-runs");
  });

  it("finds a folder whose name holds an underscore, a dot or a space, as Claude encodes them", () => {
    // A GitHub runner's temp folder is `/private/var/folders/n6/hn37q6pj7sj_9dmqqc…/T`, and a worktree
    // checkout can sit in `.verify`: Claude writes both with dashes, so the raw name never matches.
    const odd: Record<string, string[]> = {
      "/": ["private", "Users"],
      "/private": ["var"], "/private/var": ["folders"], "/private/var/folders": ["n6"],
      "/private/var/folders/n6": ["hn37q6pj7sj_9dmqqc2113800000gn"],
      "/private/var/folders/n6/hn37q6pj7sj_9dmqqc2113800000gn": ["T"],
      "/Users": ["me"], "/Users/me": ["atlas-worktrees", "My Notes"], "/Users/me/atlas-worktrees": [".verify"],
    };
    const of = (dir: string): string[] => odd[dir] ?? [];
    // THE MUTANT: compare each child's raw name — every one of these decodes to null.
    expect(decodeClaudeProjectSlug("-private-var-folders-n6-hn37q6pj7sj-9dmqqc2113800000gn-T", of))
      .toBe("/private/var/folders/n6/hn37q6pj7sj_9dmqqc2113800000gn/T");
    expect(decodeClaudeProjectSlug("-Users-me-atlas-worktrees--verify", of)).toBe("/Users/me/atlas-worktrees/.verify");
    expect(decodeClaudeProjectSlug("-Users-me-My-Notes", of)).toBe("/Users/me/My Notes");
  });

  it("gives up rather than guess between two folders that encode alike", () => {
    const twins = (dir: string): string[] => (dir === "/" ? ["a_b", "a.b"] : []);
    expect(decodeClaudeProjectSlug("-a-b", twins)).toBeNull();
  });

  it("resolves the plain case with no ambiguity at all", () => {
    expect(decodeClaudeProjectSlug("-Users-me-Desktop-Home-Work-Projects-atlas", childrenOf))
      .toBe("/Users/me/Desktop/Home/Work/Projects/atlas");
  });

  it("returns null for a directory that is gone rather than inventing a path", () => {
    expect(decodeClaudeProjectSlug("-Users-me-Desktop-Home-Work-Projects-deleted", childrenOf)).toBeNull();
    expect(decodeClaudeProjectSlug("not-a-slug", childrenOf)).toBeNull();
  });
});


describe("claudeSlugLabel", () => {
  it("is the slug's last part only when that part kept every character", () => {
    expect(claudeSlugLabel("-Users-me-Projects-atlas")).toBe("atlas");
    expect(claudeSlugLabel("-Users-me-Projects-")).toBe("-Users-me-Projects-");
    expect(claudeSlugLabel("-Users-me--claude")).toBe("-Users-me--claude");
  });
});
