import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { tempDir } from "@amc/test-utils";
import type { McpServer } from "@amc/contracts";
import { moveToTrash } from "../library/trash";
import { McpServers } from "../setup/mcp";
import { Skills } from "../setup/skills";
import { skillHealth } from "./skills-health";
import { SkillImports } from "./skills-imports";
import { cloneShallow, readSource, SKILL_LIBRARIES } from "./skills-source";

let home: string, shelf: string;
beforeEach(() => {
  // macOS's temp folder is behind a link, and a skills folder behind a link is reported as linked.
  home = realpathSync(tempDir("amc-skills-"));
  shelf = join(home, "Downloads", "shelf");
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}
const skillText = (name: string, description: string, body = "Do the thing.") => `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`;

/** Two skills on a shelf: one with a script that can run, one plain. */
function fillShelf(): void {
  write(join(shelf, "skills/changelog/SKILL.md"), skillText("changelog", "Write a changelog from merged pull requests"));
  write(join(shelf, "skills/changelog/scripts/collect.sh"), "#!/bin/sh\necho collected\n");
  chmodSync(join(shelf, "skills/changelog/scripts/collect.sh"), 0o755);
  write(join(shelf, "skills/changelog/reference/tone.md"), "Plain words.\n");
  write(join(shelf, "skills/standup/SKILL.md"), skillText("standup", "Draft a standup note"));
  write(join(shelf, "README.md"), "# A shelf of skills\n");
}

function workbench(clone?: typeof cloneShallow) {
  const skills = new Skills({ home, projects: () => [] });
  const imports = new SkillImports({ home, folder: join(home, "app-data", "skill-sources"), skills, trash: (path) => moveToTrash(path, home), clone });
  return { skills, imports };
}

describe("where skills are published", () => {
  it("offers only https repositories", () => {
    expect(SKILL_LIBRARIES.length).toBeGreaterThan(0);
    for (const library of SKILL_LIBRARIES) expect(readSource(library.url, home)).toMatchObject({ kind: "repository", url: library.url });
  });
});

describe("reading what a person pasted", () => {
  it("takes a folder, a repository, a folder of one, and owner/repo", () => {
    expect(readSource("~/Downloads/shelf", home)).toEqual({ kind: "folder", folder: join(home, "Downloads/shelf") });
    expect(readSource("https://github.com/example/shelf.git", home)).toEqual({ kind: "repository", url: "https://github.com/example/shelf", ref: null, sub: "" });
    expect(readSource("https://github.com/example/shelf/tree/main/skills/changelog", home)).toEqual({ kind: "repository", url: "https://github.com/example/shelf", ref: "main", sub: "skills/changelog" });
    expect(readSource("https://github.com/example/shelf/blob/main/skills/changelog/SKILL.md", home)).toMatchObject({ ref: "main", sub: "skills/changelog" });
    expect(readSource("https://gitlab.com/group/team/shelf/-/tree/v2/skills", home)).toEqual({ kind: "repository", url: "https://gitlab.com/group/team/shelf", ref: "v2", sub: "skills" });
    expect(readSource("example/shelf", home)).toMatchObject({ url: "https://github.com/example/shelf" });
  });

  it("refuses anything that is not https or a folder", () => {
    for (const from of ["http://github.com/example/shelf", "git@github.com:example/shelf.git", "ssh://git@github.com/example/shelf", "file:///etc", "https://sam:hunter2@github.com/example/shelf", "shelf"]) {
      expect(() => readSource(from, home), from).toThrow(expect.objectContaining({ code: "SKILLS_SOURCE" }));
    }
    expect(() => readSource("https://github.com/example/shelf/tree/main/skills/..%2F..%2Fprivate", home)).toThrow(/outside its repository/);
    expect(() => readSource("https://github.com/example/shelf/tree/--upload-pack=x", home)).toThrow(/not a branch name/);
  });
});

describe("looking at a source", () => {
  it("lists the skills in a local folder and says which files could be run", async () => {
    fillShelf();
    const { imports } = workbench();
    const source = await imports.inspect(shelf);
    expect(source.version).toBeNull();
    expect(source.offers).toEqual([
      { path: "skills/changelog", name: "changelog", description: "Write a changelog from merged pull requests", files: 3, bytes: expect.any(Number), runnable: ["scripts/collect.sh"], installed: "no" },
      { path: "skills/standup", name: "standup", description: "Draft a standup note", files: 1, bytes: expect.any(Number), runnable: [], installed: "no" },
    ]);
    expect(readdirSync(home).sort()).toEqual(["Downloads"]);
  });

  it("says when a skill of that name is installed in any home, and whether it is the same", async () => {
    fillShelf();
    write(join(home, ".agents/skills/changelog/SKILL.md"), skillText("changelog", "Write a changelog from merged pull requests"));
    write(join(home, ".codex/skills/standup/SKILL.md"), skillText("standup", "An older standup"));
    const source = await workbench().imports.inspect(shelf);
    expect(source.offers.map((offer) => offer.installed)).toEqual(["same", "different"]);
  });

  it("shows one offer's SKILL.md and its files", async () => {
    fillShelf();
    const { imports } = workbench();
    const { token } = await imports.inspect(shelf);
    const preview = imports.preview(token, "skills/changelog");
    expect(preview.text).toContain("name: changelog");
    expect(preview.files).toEqual(["reference/tone.md", "scripts/collect.sh", "SKILL.md"]);
    expect(() => imports.preview(token, "../..")).toThrow(expect.objectContaining({ code: "SKILLS_UNSAFE" }));
    expect(() => imports.preview("no-such-token", "skills/changelog")).toThrow(expect.objectContaining({ code: "SKILLS_SOURCE_GONE" }));
  });

  it("clones a repository's one folder at its branch, without its history", async () => {
    fillShelf();
    const quiet = { cwd: shelf, stdio: "ignore" as const };
    execFileSync("git", ["init", "-q", "-b", "main"], quiet);
    execFileSync("git", ["add", "."], quiet);
    execFileSync("git", ["-c", "user.name=Sam", "-c", "user.email=sam@example.com", "-c", "commit.gpgsign=false", "commit", "-q", "-m", "A shelf"], quiet);
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: shelf, encoding: "utf8" }).trim();

    const asked: { url: string; ref: string | null }[] = [];
    const { imports } = workbench((url, ref, into) => { asked.push({ url, ref }); return cloneShallow(`file://${shelf}`, ref, into); });
    const source = await imports.inspect("https://github.com/example/shelf/tree/main/skills");
    expect(asked).toEqual([{ url: "https://github.com/example/shelf", ref: "main" }]);
    expect(source.version).toBe(head);
    expect(source.offers.map((offer) => offer.path)).toEqual(["skills/changelog", "skills/standup"]);
    const [cloned] = readdirSync(join(home, "app-data", "skill-sources"));
    expect(existsSync(join(home, "app-data", "skill-sources", cloned!, ".git"))).toBe(false);

    await expect(imports.inspect("https://github.com/example/shelf/tree/main/nowhere")).rejects.toThrow(/no folder nowhere/);
    expect(readdirSync(join(home, "app-data", "skill-sources"))).toEqual([cloned]);
  });

  it("says why a repository could not be fetched", async () => {
    await expect(cloneShallow(`file://${join(home, "no-such-repo")}`, null, join(home, "clone"))).rejects.toMatchObject({ code: "SKILLS_FETCH" });
  });
});

describe("installing", () => {
  it("copies the chosen skill into the agent's folder, keeping only the run bit the source had", async () => {
    fillShelf();
    write(join(shelf, "skills/changelog/notes.py"), "print('not marked to run')\n");
    const { imports, skills } = workbench();
    const { token } = await imports.inspect(shelf);
    const [outcome] = await imports.install(token, ["skills/changelog"], "claude", false);
    const installed = join(home, ".claude/skills/changelog");
    expect(outcome).toEqual({ path: "skills/changelog", id: expect.any(String), ok: true, detail: null });
    expect(skills.list().find((skill) => skill.id === outcome!.id)).toMatchObject({ name: "changelog", places: [{ label: "Claude", displayPath: "~/.claude/skills/changelog", linked: false }] });
    expect(readFileSync(join(installed, "reference/tone.md"), "utf8")).toBe("Plain words.\n");
    expect(statSync(join(installed, "scripts/collect.sh")).mode & 0o777).toBe(0o755);
    expect(statSync(join(installed, "notes.py")).mode & 0o777).toBe(0o644);
    expect(readdirSync(join(home, ".claude/skills"))).toEqual(["changelog"]);
    expect(existsSync(join(home, ".claude/skills/standup"))).toBe(false);
  });

  it("puts each home's skills where that agent reads them", async () => {
    fillShelf();
    const { imports } = workbench();
    const { token } = await imports.inspect(shelf);
    for (const [into, folder] of [["codex", ".codex/skills"], ["shared", ".agents/skills"], ["realm", "Realm/skills"]] as const) {
      expect((await imports.install(token, ["skills/standup"], into, false))[0]!.ok).toBe(true);
      expect(existsSync(join(home, folder, "standup/SKILL.md"))).toBe(true);
    }
  });

  it("refuses to overwrite, and with replace sends the old folder to the Trash first", async () => {
    fillShelf();
    write(join(home, ".claude/skills/changelog/SKILL.md"), skillText("changelog", "The one that was here"));
    const { imports } = workbench();
    const { token } = await imports.inspect(shelf);

    const [refused] = await imports.install(token, ["skills/changelog"], "claude", false);
    expect(refused).toMatchObject({ ok: false, id: null, detail: expect.stringMatching(/already a changelog there/) });
    expect(readFileSync(join(home, ".claude/skills/changelog/SKILL.md"), "utf8")).toContain("The one that was here");

    const [replaced] = await imports.install(token, ["skills/changelog"], "claude", true);
    expect(replaced!.ok).toBe(true);
    expect(readFileSync(join(home, ".claude/skills/changelog/SKILL.md"), "utf8")).toContain("Write a changelog");
    expect(readFileSync(join(home, ".Trash/changelog/SKILL.md"), "utf8")).toContain("The one that was here");
  });

  it("replaces a link with the folder, leaving what the link led to", async () => {
    fillShelf();
    write(join(home, ".agents/skills/changelog/SKILL.md"), skillText("changelog", "The shared one"));
    mkdirSync(join(home, ".claude/skills"), { recursive: true });
    symlinkSync(join(home, ".agents/skills/changelog"), join(home, ".claude/skills/changelog"));
    const { imports } = workbench();
    const { token } = await imports.inspect(shelf);
    expect((await imports.install(token, ["skills/changelog"], "claude", true))[0]!.ok).toBe(true);
    expect(lstatSync(join(home, ".claude/skills/changelog")).isDirectory()).toBe(true);
    expect(readFileSync(join(home, ".agents/skills/changelog/SKILL.md"), "utf8")).toContain("The shared one");
  });

  it("refuses a path that was not offered or that leaves what was fetched", async () => {
    fillShelf();
    write(join(home, "Downloads/private/SKILL.md"), skillText("private", "Not on the shelf"));
    const { imports } = workbench();
    const { token } = await imports.inspect(shelf);
    const outcomes = await imports.install(token, ["../private", "/etc", "skills/changelog/../../../private", "skills"], "claude", false);
    expect(outcomes.map((outcome) => outcome.ok)).toEqual([false, false, false, false]);
    expect(existsSync(join(home, ".claude/skills"))).toBe(false);
  });

  it("refuses a skill holding a link that leads outside what was fetched, and copies one that stays inside", async () => {
    fillShelf();
    write(join(home, "Downloads/secret.txt"), "a token\n");
    symlinkSync(join(home, "Downloads/secret.txt"), join(shelf, "skills/changelog/notes.txt"));
    symlinkSync(join(shelf, "README.md"), join(shelf, "skills/standup/README.md"));
    const { imports } = workbench();
    const source = await imports.inspect(shelf);
    expect(source.offers.map((offer) => offer.files)).toEqual([3, 2]);
    expect(imports.preview(source.token, "skills/changelog").files).not.toContain("notes.txt");

    const [leaving, staying] = await imports.install(source.token, ["skills/changelog", "skills/standup"], "claude", false);
    expect(leaving).toMatchObject({ ok: false, detail: expect.stringMatching(/notes\.txt is a link that leads outside/) });
    expect(existsSync(join(home, ".claude/skills/changelog"))).toBe(false);
    expect(staying!.ok).toBe(true);
    expect(lstatSync(join(home, ".claude/skills/standup/README.md")).isFile()).toBe(true);
    expect(readdirSync(join(home, ".claude/skills"))).toEqual(["standup"]);
  });

  it("refuses a skill folder that became a link elsewhere after it was looked at", async () => {
    fillShelf();
    write(join(home, "Downloads/private/SKILL.md"), skillText("private", "Not on the shelf"));
    const { imports } = workbench();
    const { token } = await imports.inspect(shelf);
    rmSync(join(shelf, "skills/standup"), { recursive: true });
    symlinkSync(join(home, "Downloads/private"), join(shelf, "skills/standup"));
    expect((await imports.install(token, ["skills/standup"], "claude", false))[0]).toMatchObject({ ok: false, detail: expect.stringMatching(/leads outside what was fetched/) });
  });
});

describe("removing", () => {
  it("sends an installed skill's folder to the Trash", async () => {
    write(join(home, ".claude/skills/standup/SKILL.md"), skillText("standup", "Draft a standup note"));
    const { imports, skills } = workbench();
    await imports.remove(skills.list()[0]!.id);
    expect(skills.list()).toEqual([]);
    expect(existsSync(join(home, ".Trash/standup/SKILL.md"))).toBe(true);
  });

  it("removes a link and leaves the folder it leads to", async () => {
    write(join(home, ".agents/skills/standup/SKILL.md"), skillText("standup", "Draft a standup note"));
    mkdirSync(join(home, ".claude/skills"), { recursive: true });
    symlinkSync(join(home, ".agents/skills/standup"), join(home, ".claude/skills/standup"));
    const { imports, skills } = workbench();
    const { id } = skills.list()[0]!;

    await expect(imports.remove(id)).rejects.toMatchObject({ code: "SKILLS_WHICH_PLACE" });
    await imports.remove(id, "~/.claude/skills/standup");
    expect(lstatSync(join(home, ".claude/skills/standup"), { throwIfNoEntry: false })).toBeUndefined();
    expect(skills.list()[0]!.places.map((place) => place.displayPath)).toEqual(["~/.agents/skills/standup"]);
    expect(existsSync(join(home, ".Trash"))).toBe(false);
  });

  it("takes the links to a folder away with the folder", async () => {
    write(join(home, ".agents/skills/standup/SKILL.md"), skillText("standup", "Draft a standup note"));
    mkdirSync(join(home, ".claude/skills"), { recursive: true });
    symlinkSync(join(home, ".agents/skills/standup"), join(home, ".claude/skills/standup"));
    const { imports, skills } = workbench();
    await imports.remove(skills.list()[0]!.id, "~/.agents/skills/standup");
    expect(lstatSync(join(home, ".claude/skills/standup"), { throwIfNoEntry: false })).toBeUndefined();
    expect(existsSync(join(home, ".Trash/standup/SKILL.md"))).toBe(true);
  });

  it("refuses a skill that is not there, and a place it is not reached from", async () => {
    write(join(home, ".claude/skills/standup/SKILL.md"), skillText("standup", "Draft a standup note"));
    const { imports, skills } = workbench();
    await expect(imports.remove("000000000000")).rejects.toMatchObject({ code: "SKILL_NOT_FOUND" });
    await expect(imports.remove(skills.list()[0]!.id, "~/.codex/skills/standup")).rejects.toMatchObject({ code: "SKILL_NOT_FOUND" });
    expect(skills.list()).toHaveLength(1);
  });
});

describe("health", () => {
  const servers = (): McpServer[] => new McpServers({ home, projects: () => [], projectAt: () => null }).list();
  const issuesOf = (name: string, at?: string) => {
    const skills = new Skills({ home, projects: () => [] }).list();
    const skill = skills.find((s) => s.name === name && (!at || s.places.some((place) => place.displayPath.startsWith(at))))!;
    return skillHealth(skills, servers()).find((health) => health.id === skill.id)!.issues;
  };

  it("finds nothing wrong with a skill whose files and servers are all there", () => {
    write(join(home, ".cursor/mcp.json"), JSON.stringify({ mcpServers: { tracker: { command: "npx", args: ["-y", "@example/tracker-mcp"] } } }));
    write(join(home, ".cursor/skills/triage/SKILL.md"), skillText("triage", "Triage new issues", [
      "Read [the labels](reference/labels.md) and run `scripts/sort.py`, then call `mcp__tracker__list_issues`.",
      "See [the docs](https://example.com/docs), [above](#top) and `mcp__claude_ai_Tracker__search`.",
      "```sh", "cat [not a link](reference/not-there.md)", "```",
    ].join("\n")));
    write(join(home, ".cursor/skills/triage/reference/labels.md"), "bug, chore\n");
    write(join(home, ".cursor/skills/triage/scripts/sort.py"), "print('sorted')\n");
    expect(issuesOf("triage")).toEqual([]);
  });

  it("says a skill with no frontmatter or no description will not be picked", () => {
    write(join(home, ".claude/skills/scratch/SKILL.md"), "Notes with no frontmatter.\n");
    write(join(home, ".claude/skills/untold/SKILL.md"), "---\nname: untold\n---\n\nSteps.\n");
    expect(issuesOf("scratch")).toEqual([{ kind: "not-picked", detail: expect.stringMatching(/does not start with a block/) }]);
    expect(issuesOf("untold")).toEqual([{ kind: "not-picked", detail: expect.stringMatching(/has no description/) }]);
  });

  it("names a server whose tools the skill uses and the agent reaching it lacks", () => {
    write(join(home, ".cursor/mcp.json"), JSON.stringify({ mcpServers: { tracker: { command: "npx" } } }));
    const body = "Call `mcp__tracker__list_issues`, then mcp__tracker__close_issue.";
    write(join(home, ".claude/skills/triage/SKILL.md"), skillText("triage", "Triage new issues", body));
    write(join(home, ".agents/skills/sweep/SKILL.md"), skillText("sweep", "Sweep old issues", body));
    write(join(home, ".agents/skills/ledger/SKILL.md"), skillText("ledger", "Balance the ledger", "Call mcp__ledger__balance."));

    expect(issuesOf("triage")).toEqual([{ kind: "missing-server", detail: expect.stringMatching(/server named tracker, and Claude Code has no server by that name/) }]);
    expect(issuesOf("sweep")).toEqual([]);
    expect(issuesOf("ledger")).toEqual([{ kind: "missing-server", detail: expect.stringMatching(/server named ledger, and No agent on this Mac has/) }]);
  });

  it("names a file the skill points at that is not in its folder", () => {
    write(join(home, ".claude/skills/triage/SKILL.md"), skillText("triage", "Triage new issues", "Read [the labels](reference/labels.md#bugs) and run `scripts/sort.py`. See [the repo](../../README.md)."));
    write(join(home, ".claude/skills/triage/scripts/sort.py"), "print('sorted')\n");
    expect(issuesOf("triage")).toEqual([{ kind: "missing-file", detail: expect.stringMatching(/points at reference\/labels\.md, which is not in the skill's folder/) }]);
  });

  it("says what is too long for the agent that reaches it", () => {
    write(join(home, ".claude/skills/wordy/SKILL.md"), skillText("wordy", "w".repeat(1600)));
    write(join(home, ".cursor/skills/wordier/SKILL.md"), skillText("wordier", "w".repeat(1100)));
    write(join(home, ".claude/skills/fine/SKILL.md"), skillText("fine", "w".repeat(1100)));
    write(join(home, ".codex/skills/named/SKILL.md"), skillText("n".repeat(70), "A long name"));
    write(join(home, ".claude/skills/endless/SKILL.md"), skillText("endless", "Goes on", "A step.\n".repeat(520)));
    expect(issuesOf("wordy")).toEqual([{ kind: "too-long", detail: expect.stringMatching(/1600 characters long\. Claude Code cuts it at 1,536/) }]);
    expect(issuesOf("wordier")).toEqual([{ kind: "too-long", detail: expect.stringMatching(/over the 1,024 the Agent Skills format allows/) }]);
    expect(issuesOf("fine")).toEqual([{ kind: "too-long", detail: expect.stringMatching(/1,024/) }]);
    expect(issuesOf("n".repeat(70))).toEqual([{ kind: "too-long", detail: expect.stringMatching(/Codex does not load a skill whose name is over 64/) }]);
    expect(issuesOf("endless")).toEqual([{ kind: "too-long", detail: expect.stringMatching(/lines long/) }]);
  });

  it("says when one agent loads two skills of one name with different text", () => {
    write(join(home, ".agents/skills/release-notes/SKILL.md"), skillText("release-notes", "Write the notes for a release"));
    write(join(home, ".codex/skills/release-notes/SKILL.md"), skillText("release-notes", "Draft release notes"));
    write(join(home, ".claude/skills/release-notes/SKILL.md"), skillText("release-notes", "Claude's own"));
    write(join(home, "Realm/skills/release-notes/SKILL.md"), skillText("release-notes", "Write the notes for a release"));
    expect(issuesOf("release-notes", "~/.agents")).toEqual([{ kind: "name-clash", detail: expect.stringMatching(/^Codex also loads another skill named release-notes with different text, at ~\/\.codex\/skills\/release-notes/) }]);
    expect(issuesOf("release-notes", "~/.codex")).toEqual([{ kind: "name-clash", detail: expect.stringMatching(/at ~\/\.agents\/skills\/release-notes/) }]);
    expect(issuesOf("release-notes", "~/.claude")).toEqual([]);
    expect(issuesOf("release-notes", "~/Realm")).toEqual([]);
  });
});
