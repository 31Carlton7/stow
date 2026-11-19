import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { LIBRARY_EXTERNAL_UNCONFIRMED, libraryId } from "@amc/contracts";
import { tempDir } from "@amc/test-utils";
import { DEPLOY_STEPS, PROFILE_ID, SPACE_ID, buildFixtureHome, claudeSlug } from "../../../../fixtures/home.mjs";
import { openDatabase } from "../db/database";
import { Library } from "./library";
import { projectId } from "./projects";
import { TagStore } from "./tags";

const REPO = `realm-repo-profile-${PROFILE_ID}`;

let at: ReturnType<typeof buildFixtureHome>;
let library: Library;
let backups: string;
let trashed: string[];

beforeEach(() => {
  at = buildFixtureHome(tempDir("amc-library-"));
  backups = tempDir("amc-backups-");
  trashed = [];
  library = new Library({
    home: at.home, backups, tags: new TagStore(openDatabase(":memory:")),
    trash: async (path) => { trashed.push(path); rmSync(path); },
  });
});

const git = (...args: string[]): string => execFileSync("git", args, { cwd: at.repo, encoding: "utf8" }).trim();
const repoFact = (name: string): string => libraryId(REPO, `spaces/atlas/${name}.md`);
const claudeFactId = (name: string): string => libraryId("claude-projects", `${claudeSlug(at.atlas)}/memory/${name}.md`);
const backedUp = (): string[] => readdirSync(backups, { recursive: true, encoding: "utf8" }).filter((p) => p.endsWith(".md"));

describe("what the library finds", () => {
  it("lists each agent's sources with how many files each holds", () => {
    const { sources } = library.sources();
    const counts = Object.fromEntries(sources.map((s) => [s.id, s.count]));
    const atlas = projectId(at.atlas), beacon = projectId(at.beacon);
    expect(counts).toEqual({
      [REPO]: 5, "realm-documents": 1, "realm-imported": 1,
      "claude-user": 1, "claude-projects": 4, [`claude-project-${atlas}`]: 1,
      "codex-user": 1, "codex-automations": 1, [`codex-project-${atlas}`]: 1, [`codex-project-${beacon}`]: 1,
      "cursor-user": 1, [`cursor-project-${atlas}`]: 1,
      "gemini-user": 1, "opencode-user": 1, "hermes-user": 1, "openclaw-workspace": 1,
    });
    const repo = sources.find((s) => s.id === REPO)!;
    expect(repo).toMatchObject({ label: "Sam's memory", external: false, folders: [{ rel: "", label: "Shared by every space" }, { rel: "spaces/atlas", label: "Atlas" }] });
  });

  it("counts a worktree as the project it is a worktree of", () => {
    const { projects, sources } = library.sources();
    // THE MUTANT: a project per recorded folder, and the worktree's CLAUDE.md is listed as a second project's.
    expect(projects.map((p) => p.name)).toEqual(["atlas", "beacon"]);
    expect(sources.filter((s) => s.kind === "project-instructions" && s.group === "claude")).toHaveLength(1);
  });

  it("names Realm's files by what Realm calls them", () => {
    const document = library.list({ kind: "documents" })[0]!;
    expect(document.title).toBe("Atlas");
    expect(library.list({ group: "realm", kind: "memory" }).find((e) => e.rel === "spaces/atlas/deploy-steps.md")!.folder).toBe("Atlas");
    expect(library.list({ kind: "imported" })[0]!.folder).toBe("Atlas · atlas");
  });

  it("reads a fact's type from either place Claude has kept it", () => {
    const facts = library.list({ group: "claude", kind: "project-memory" });
    expect(facts.find((e) => e.title === "old-flag")!.type).toBe("feedback");
    expect(facts.find((e) => e.title === "deploy-steps")!.type).toBe("project");
  });
});

describe("copies", () => {
  it("shows a memory once in a list of everything, and says how many copies there are", () => {
    const everywhere = library.list({}).filter((e) => e.title === "deploy-steps");
    expect(everywhere).toHaveLength(1);
    // The repo's copy is the one shown: it has history, and it is the one agents in Realm read.
    expect(everywhere[0]).toMatchObject({ id: repoFact("deploy-steps"), copies: 3, canonical: true });
  });

  it("still lists each copy where an agent's own files are asked for", () => {
    const claudes = library.list({ group: "claude", kind: "project-memory" }).find((e) => e.title === "deploy-steps")!;
    expect(claudes).toMatchObject({ copies: 3, canonical: false });
  });

  it("names the other copies of a file, and says which have changed since", () => {
    const same = library.read(repoFact("deploy-steps")).otherCopies;
    expect(same.map((c) => [c.where, c.same])).toEqual([["Realm · Atlas · atlas", true], ["Claude · atlas", true]]);
    // Same name from the same session, different text: a copy that was edited in one place.
    expect(library.read(repoFact("release-day")).otherCopies).toEqual([expect.objectContaining({ id: claudeFactId("release-day"), same: false })]);
  });

  it("does not count empty files, or a link and its target, as copies", () => {
    symlinkSync(join(at.atlas, "CLAUDE.md"), join(at.atlas, "CLAUDE.local.md"));
    const all = library.list({ group: "claude", kind: "project-instructions" });
    expect(all.map((e) => [e.rel, e.copies])).toEqual(expect.arrayContaining([["CLAUDE.md", 1], ["CLAUDE.local.md", 1]]));
    expect(library.list({ group: "codex", kind: "instructions" })[0]).toMatchObject({ size: 0, copies: 1 });
  });
});

describe("reading", () => {
  it("resolves a file's links to the files they open, and leaves a dead one pointing nowhere", () => {
    const index = library.read(libraryId(REPO, "MEMORY.md"));
    expect(index.links).toEqual([
      { target: "spaces/atlas/MEMORY", id: libraryId(REPO, "spaces/atlas/MEMORY.md") },
      { target: "team", id: libraryId(REPO, "team.md") },
      { target: "missing-note", id: null },
    ]);
    expect(index).toMatchObject({ title: "Index", description: "2 memories", deletable: false, writable: true });
  });

  it("reads a memory's [[name]] as the memory of that name beside it", () => {
    writeFileSync(join(at.claudeMemory, "old-flag.md"), "---\nname: old-flag\ndescription: The beta flag\ntype: feedback\n---\n\nSee [[release-day]] and [[not-written-yet]].\n");
    expect(library.read(claudeFactId("old-flag")).links).toEqual([
      { target: "release-day", id: claudeFactId("release-day") },
      { target: "not-written-yet", id: null },
    ]);
  });

  it("gives the frontmatter as properties and the rest as the body", () => {
    const file = library.read(repoFact("deploy-steps"));
    expect(file.frontmatter.map((f) => f.key)).toEqual(["name", "description", "metadata.type", "metadata.originSessionId"]);
    expect(file.body.startsWith("Atlas ships from `main`.")).toBe(true);
    expect(file.displayPath).toBe(`~/Realm/memory/repos/profile-${PROFILE_ID}/spaces/atlas/deploy-steps.md`);
  });

  it("finds a file by a word in it, best match first", () => {
    const hits = library.list({ query: "notarize" });
    expect(hits[0]).toMatchObject({ title: "deploy-steps" });
    expect(hits[0]!.match).toContain("notarize");
  });

  it("keeps a file by project", () => {
    const atlas = library.list({ projectId: projectId(at.atlas) }).map((e) => `${e.group}:${e.rel}`);
    expect(atlas).toEqual(expect.arrayContaining(["claude:CLAUDE.md", "codex:AGENTS.md", "cursor:api.mdc", "realm:spaces/atlas/release-day.md"]));
    expect(library.list({ projectId: projectId(at.beacon) }).map((e) => e.rel)).toEqual(["AGENTS.md"]);
  });

  it("refuses an id that is not a file a source lists", async () => {
    expect(() => library.read(libraryId(REPO, "../../../realm.db"))).toThrowError(/not a file in the library/);
    expect(() => library.read(libraryId(REPO, ".git/config"))).toThrowError(/not a file in the library/);
    expect(() => library.read("nonsense")).toThrowError(/not a file in the library/);
  });
});

describe("writing into a repository", () => {
  it("makes one commit, as the app, of that file alone", async () => {
    const before = git("rev-list", "--count", "HEAD");
    writeFileSync(join(at.repo, "scratch.md"), "someone else's unfinished note\n");
    await library.write(repoFact("deploy-steps"), DEPLOY_STEPS.replace("then publish the release", "then publish"));
    expect(Number(git("rev-list", "--count", "HEAD"))).toBe(Number(before) + 1);
    expect(git("log", "-1", "--format=%an|%s")).toBe("Stow|Update spaces/atlas/deploy-steps.md");
    // THE MUTANT: `git add -A`, and the note that was lying about goes into the commit too.
    expect(git("show", "--name-only", "--format=", "HEAD")).toBe("spaces/atlas/deploy-steps.md");
    expect(git("status", "--porcelain")).toBe("?? scratch.md");
  });

  it("keeps the folder's index line in step with a redescribed fact", async () => {
    await library.write(repoFact("deploy-steps"), DEPLOY_STEPS.replace("How Atlas ships: sign, notarize, then publish", "How Atlas ships"));
    expect(readFileSync(join(at.repo, "spaces/atlas/MEMORY.md"), "utf8")).toContain("- [deploy-steps](deploy-steps.md) — How Atlas ships\n");
    expect(git("show", "--name-only", "--format=", "HEAD").split("\n").sort()).toEqual(["spaces/atlas/MEMORY.md", "spaces/atlas/deploy-steps.md"]);
  });

  it("leaves a file somebody else is in the middle of writing alone", async () => {
    const path = join(at.repo, "spaces/atlas/deploy-steps.md");
    writeFileSync(path, "half an edit");
    await expect(library.write(repoFact("deploy-steps"), "mine")).rejects.toMatchObject({ code: "LIBRARY_REPO_BUSY" });
    expect(readFileSync(path, "utf8")).toBe("half an edit");
  });

  it("refuses text shaped like a credential", async () => {
    await expect(library.write(repoFact("deploy-steps"), `${DEPLOY_STEPS}\nsk-abcdefghijklmnopqrstuvwxyz012345\n`)).rejects.toMatchObject({ code: "LIBRARY_SECRET" });
    expect(readFileSync(join(at.repo, "spaces/atlas/deploy-steps.md"), "utf8")).toBe(DEPLOY_STEPS);
  });

  it("makes a new memory with its line in the index of the folder it goes in", async () => {
    const inSpace = await library.create({ sourceId: REPO, folder: "spaces/atlas", name: "Staging URL", description: "Where staging lives", type: "reference", body: "https://staging.example" });
    expect(inSpace).toMatchObject({ rel: "spaces/atlas/staging-url.md", title: "Staging URL", type: "reference", folder: "Atlas" });
    expect(readFileSync(join(at.repo, "spaces/atlas/MEMORY.md"), "utf8")).toContain("- [Staging URL](staging-url.md) — Where staging lives\n");
    expect(git("log", "-1", "--format=%s")).toBe("Remember Staging URL");

    await library.create({ sourceId: REPO, folder: "", name: "Timezone", description: "Sam works in Pacific time", type: "user", body: "" });
    expect(readFileSync(join(at.repo, "MEMORY.md"), "utf8")).toContain("- [[missing-note]]\n- [[timezone]]\n");
    await expect(library.create({ sourceId: REPO, folder: "", name: "Timezone", description: "again", type: "user", body: "" })).rejects.toMatchObject({ code: "LIBRARY_EXISTS" });
    await expect(library.create({ sourceId: REPO, folder: "spaces/nowhere", name: "X", description: "y", type: "user", body: "" })).rejects.toMatchObject({ code: "LIBRARY_READ_ONLY" });
  });

  it("deletes a memory with the index lines that name it, and never an index", async () => {
    expect(await library.delete(libraryId(REPO, "team.md"))).toEqual({ trashed: false });
    expect(existsSync(join(at.repo, "team.md"))).toBe(false);
    expect(readFileSync(join(at.repo, "MEMORY.md"), "utf8")).not.toContain("[[team]]");
    await library.delete(repoFact("release-day"));
    expect(readFileSync(join(at.repo, "spaces/atlas/MEMORY.md"), "utf8")).toBe("- [deploy-steps](deploy-steps.md) — How Atlas ships: sign, notarize, then publish\n");
    expect(git("log", "-1", "--format=%s")).toBe("Forget spaces/atlas/release-day.md");
    await expect(library.delete(libraryId(REPO, "MEMORY.md"))).rejects.toMatchObject({ code: "LIBRARY_INDEX_WHOLE" });
    expect(trashed).toEqual([]);
  });
});

describe("writing an agent's own file", () => {
  const userInstructions = libraryId("claude-user", "CLAUDE.md");

  it("asks first, then backs the file up and replaces it", async () => {
    await expect(library.write(userInstructions, "Prefer tiny commits.\n")).rejects.toMatchObject({ code: LIBRARY_EXTERNAL_UNCONFIRMED });
    expect(readFileSync(join(at.home, ".claude/CLAUDE.md"), "utf8")).toBe("Prefer small commits.\n");
    expect(backedUp()).toEqual([]);

    const entry = await library.write(userInstructions, "Prefer tiny commits.\n", true);
    expect(entry.description).toBe("Prefer tiny commits.");
    expect(readFileSync(join(at.home, ".claude/CLAUDE.md"), "utf8")).toBe("Prefer tiny commits.\n");
    const [backup] = backedUp();
    expect(backup).toMatch(/\.claude\/CLAUDE\.md$/);
    expect(readFileSync(join(backups, backup!), "utf8")).toBe("Prefer small commits.\n");
  });

  it("writes through a link to the file it points at, and leaves the link a link", async () => {
    const link = join(at.atlas, "CLAUDE.local.md");
    symlinkSync(join(at.atlas, "CLAUDE.md"), link);
    await library.write(libraryId(`claude-project-${projectId(at.atlas)}`, "CLAUDE.local.md"), "# Atlas\n\nUse bun.\n", true);
    // THE MUTANT: rename the new text over the path that was asked for, and the link becomes a second file.
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(at.atlas, "CLAUDE.md"), "utf8")).toBe("# Atlas\n\nUse bun.\n");
  });

  it("will not change a file its owner rewrites", async () => {
    const managed = libraryId(`codex-project-${projectId(at.beacon)}`, "AGENTS.md");
    expect(library.read(managed)).toMatchObject({ writable: false, deletable: false, note: expect.stringContaining("Realm writes this file") });
    await expect(library.write(managed, "mine", true)).rejects.toMatchObject({ code: "LIBRARY_READ_ONLY" });
    await expect(library.delete(libraryId("realm-documents", `${SPACE_ID}.md`), true)).rejects.toMatchObject({ code: "LIBRARY_READ_ONLY" });
  });

  it("makes a memory in Claude's folder with its line in Claude's index", async () => {
    const folder = `${claudeSlug(at.atlas)}/memory`;
    const made = { sourceId: "claude-projects", folder, name: "Staging URL", description: "Where staging lives", type: "reference" as const, body: "https://staging.example" };
    await expect(library.create(made)).rejects.toMatchObject({ code: LIBRARY_EXTERNAL_UNCONFIRMED });
    const entry = await library.create({ ...made, confirmExternal: true });
    expect(entry).toMatchObject({ rel: `${folder}/staging-url.md`, folder: "atlas" });
    expect(readFileSync(join(at.claudeMemory, "MEMORY.md"), "utf8")).toMatch(/- \[Staging URL\]\(staging-url\.md\) — Where staging lives\n$/);
  });

  it("deletes to the Trash, keeps a backup, and drops the file's line from the index beside it", async () => {
    await expect(library.delete(claudeFactId("old-flag"))).rejects.toMatchObject({ code: LIBRARY_EXTERNAL_UNCONFIRMED });
    expect(await library.delete(claudeFactId("old-flag"), true)).toEqual({ trashed: true });
    expect(trashed).toEqual([join(at.claudeMemory, "old-flag.md")]);
    expect(backedUp().some((p) => p.endsWith("memory/old-flag.md"))).toBe(true);
    expect(readFileSync(join(at.claudeMemory, "MEMORY.md"), "utf8")).not.toContain("old-flag");
    expect(library.list({ group: "claude", kind: "project-memory" }).map((e) => e.title)).not.toContain("old-flag");
  });
});

describe("tags", () => {
  it("are kept beside the library, never in the file", () => {
    const id = repoFact("deploy-steps");
    expect(library.setTags(id, ["Release", "release", "ops"])).toEqual(["ops", "release"]);
    expect(library.list({ tag: "release" }).map((e) => e.id)).toEqual([id]);
    expect(library.sources().tags).toEqual([{ tag: "ops", count: 1 }, { tag: "release", count: 1 }]);
    expect(readFileSync(join(at.repo, "spaces/atlas/deploy-steps.md"), "utf8")).toBe(DEPLOY_STEPS);
  });

  it("go when the file does", async () => {
    library.setTags(claudeFactId("old-flag"), ["beta"]);
    await library.delete(claudeFactId("old-flag"), true);
    expect(library.sources().tags).toEqual([]);
  });
});
