// @vitest-environment node
import { mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir } from "@amc/test-utils";
import { anchorOf, dragOut, pathToHandOut, sharingItem } from "./hand-out";

const root = realpathSync(tempDir("amc-hand-out-"));
const home = join(root, "home");
const elsewhere = join(root, "elsewhere");
const put = (path: string, text = "text") => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
  return path;
};
const memory = put(join(home, ".claude/projects/atlas/memory/release.md"), "# Release\n");
const skill = join(home, ".claude/skills/changelog");
put(join(skill, "SKILL.md"));
put(join(skill, "scripts/list.sh"));
const outside = put(join(elsewhere, "notes.md"));

describe("pathToHandOut", () => {
  it("gives a file under the home, and a skill's folder", () => {
    expect(pathToHandOut(memory, [home])).toBe(memory);
    expect(pathToHandOut(skill, [home])).toBe(skill);
  });

  it("refuses what is not an absolute path to something that exists", () => {
    expect(pathToHandOut(undefined, [home])).toBeNull();
    expect(pathToHandOut({ path: memory }, [home])).toBeNull();
    expect(pathToHandOut(".claude/CLAUDE.md", [home])).toBeNull();
    expect(pathToHandOut(join(home, "gone.md"), [home])).toBeNull();
  });

  it("refuses a path outside the home, however it is written", () => {
    expect(pathToHandOut(outside, [home])).toBeNull();
    expect(pathToHandOut(join(home, "../elsewhere/notes.md"), [home])).toBeNull();
    expect(pathToHandOut(home, [home])).toBeNull();
    expect(pathToHandOut(outside, [])).toBeNull();
  });

  it("follows a link before it decides", () => {
    symlinkSync(outside, join(home, "linked-out.md"));
    symlinkSync(memory, join(home, "linked-in.md"));
    expect(pathToHandOut(join(home, "linked-out.md"), [home])).toBeNull();
    expect(pathToHandOut(join(home, "linked-in.md"), [home])).toBe(memory);
  });

  it("refuses a credentials file and anything in a keychain", () => {
    for (const file of [".claude/.credentials.json", ".codex/auth.json", "Library/Keychains/login.keychain-db", "Library/Keychains/notes.md", "old.keychain/item.md"]) {
      expect(pathToHandOut(put(join(home, file)), [home]), file).toBeNull();
    }
    symlinkSync(join(home, ".codex/auth.json"), join(home, "innocent.md"));
    expect(pathToHandOut(join(home, "innocent.md"), [home])).toBeNull();
  });

  it("refuses a folder that is not a skill's, and one that holds a login", () => {
    expect(pathToHandOut(join(home, ".claude"), [home])).toBeNull();
    expect(pathToHandOut(join(home, ".claude/projects"), [home])).toBeNull();
    put(join(home, ".codex/SKILL.md"));
    expect(pathToHandOut(join(home, ".codex"), [home])).toBeNull();
  });

  it("takes any of the homes it is given", () => {
    expect(pathToHandOut(outside, [home, elsewhere])).toBe(outside);
  });
});

describe("dragOut", () => {
  const stagingDir = join(root, "staging");
  const dragged: string[] = [];
  const d = { homes: [home], stagingDir, startDrag: (file: string) => { dragged.push(file); } };

  it("drags a copy under the file's own name, and leaves the file where it was", () => {
    dragOut(memory, d);
    expect(dragged).toHaveLength(1);
    expect(dragged[0]!.startsWith(stagingDir)).toBe(true);
    expect(basename(dragged[0]!)).toBe("release.md");
    expect(readFileSync(dragged[0]!, "utf8")).toBe("# Release\n");
    expect(readFileSync(memory, "utf8")).toBe("# Release\n");
  });

  it("drags a skill's folder with what is in it", () => {
    dragOut(skill, d);
    expect(basename(dragged[1]!)).toBe("changelog");
    expect(readFileSync(join(dragged[1]!, "scripts/list.sh"), "utf8")).toBe("text");
  });

  it("starts no drag for a path that may not leave", () => {
    dragOut(join(home, ".codex/auth.json"), d);
    dragOut(outside, d);
    expect(dragged).toHaveLength(2);
  });
});

describe("sharingItem", () => {
  it("shares the file itself, or the text as given", () => {
    expect(sharingItem({ path: memory }, [home])).toEqual({ filePaths: [memory] });
    expect(sharingItem({ path: skill }, [home])).toEqual({ filePaths: [skill] });
    expect(sharingItem({ text: "notes (MCP server)" }, [home])).toEqual({ texts: ["notes (MCP server)"] });
  });

  it("shares nothing for a path that may not leave, no text, or more text than the window shows", () => {
    expect(sharingItem({ path: join(home, ".claude/.credentials.json") }, [home])).toBeNull();
    expect(sharingItem({ path: outside }, [home])).toBeNull();
    expect(sharingItem({ text: "" }, [home])).toBeNull();
    expect(sharingItem({ text: "x".repeat(20_001) }, [home])).toBeNull();
    expect(sharingItem(null, [home])).toBeNull();
    expect(sharingItem("text", [home])).toBeNull();
  });
});

describe("anchorOf", () => {
  it("takes a whole point and nothing else", () => {
    expect(anchorOf({ x: 12, y: 40 })).toEqual({ x: 12, y: 40 });
    expect(anchorOf({ x: 12.5, y: 40 })).toBeNull();
    expect(anchorOf({ x: "12", y: 40 })).toBeNull();
    expect(anchorOf(undefined)).toBeNull();
  });
});
