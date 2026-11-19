import { describe, expect, it } from "vitest";
import { claudeFactFile, claudeIndexTarget, withClaudeIndexLine } from "./claude-facts";

describe("Claude's memory format", () => {
  it("files a fact under its name, and never as the folder's own MEMORY.md", () => {
    expect(claudeFactFile("Deploy steps")).toBe("deploy-steps.md");
    expect(claudeFactFile("feedback_testing")).toBe("feedback_testing.md");
    expect(claudeFactFile("Café ✓ notes")).toBe("cafe-notes.md");
    // THE MUTANT: no guard — on a Mac's disk memory.md IS MEMORY.md, and the fact would overwrite the index.
    expect(claudeFactFile("Memory")).toBe("memory-note.md");
    expect(claudeFactFile("!!!")).toBe("memory-note.md");
  });

  it("reads index links in both spellings Claude writes", () => {
    expect(claudeIndexTarget("- [Deploy](deploy.md) — how it ships")).toBe("deploy.md");
    expect(claudeIndexTarget("* [Deploy](./deploy.md)")).toBe("deploy.md");
    expect(claudeIndexTarget("# Memory")).toBeNull();
  });

  it("rewrites a fact's line in place and adds a new one at the end", () => {
    const index = "- [A](a.md) — first\n- [B](b.md) — second\n";
    expect(withClaudeIndexLine(index, "a.md", "A", "first, reworded")).toBe("- [A](a.md) — first, reworded\n- [B](b.md) — second\n");
    expect(withClaudeIndexLine(index, "c.md", "C", "third")).toBe(`${index}- [C](c.md) — third\n`);
    expect(withClaudeIndexLine(index, "b.md", "B", "second")).toBe(index);
  });
});
