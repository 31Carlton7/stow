import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { brandMarks } from "@amc/ui";
import { LibraryGroupSchema } from "@amc/contracts";
import { SourceMark, agentOfPath } from "./SourceMark";

const drawn = (of: string | null) => render(<SourceMark of={of} />).container.querySelector("svg");

describe("a source's mark", () => {
  it("has a mark for every agent the library knows", () => {
    for (const group of LibraryGroupSchema.options) expect(drawn(group)?.getAttribute("data-brand"), group).toBeTruthy();
  });

  it("draws an agent's mark in the agent's own colour, and one with no colour in the text's", () => {
    expect(drawn("claude")!.querySelector("path")!.getAttribute("fill")).toBe(brandMarks.claude.color);
    expect(drawn("realm")!.querySelector("path")!.getAttribute("fill")).toBe(brandMarks.realm.color);
    expect(drawn("codex")!.getAttribute("data-brand")).toBe("openai");
    expect(drawn("codex")!.querySelector("path")!.getAttribute("fill")).toBe("currentColor");
  });

  it("knows an agent by the name a place gives it", () => {
    expect(drawn("Claude Code")!.getAttribute("data-brand")).toBe("claude");
    expect(drawn("Realm · Atlas · atlas")!.getAttribute("data-brand")).toBe("realm");
    expect(drawn("OpenClaw")!.getAttribute("data-brand")).toBe("openclaw");
  });

  it("draws Hermes and OpenClaw from the pictures their own tools ship, Hermes with one for each face", () => {
    const hermes = drawn("Hermes")!;
    expect([...hermes.querySelectorAll("image")].map((picture) => picture.getAttribute("class"))).toEqual(["mark-on-light", "mark-on-dark"]);
    expect(hermes.querySelector("path")).toBeNull();
    expect(drawn("OpenClaw")!.querySelectorAll("image")).toHaveLength(1);
  });

  it("draws nothing for a name that is no agent's, unless given something to draw", () => {
    expect(drawn("Shared")).toBeNull();
    expect(drawn(null)).toBeNull();
    // THE MUTANT: a lookup that walks the prototype.
    expect(drawn("constructor")).toBeNull();
    expect(render(<SourceMark of="Shared" fallback="terminal" />).container.querySelector("svg")).not.toBeNull();
  });

  it("reads whose a file is off its path", () => {
    expect(agentOfPath("~/.claude/projects/-atlas/memory/deploy-steps.md")).toBe("claude");
    expect(agentOfPath("~/.claude.json")).toBe("claude");
    expect(agentOfPath("~/Realm/memory/repos/p1/team.md")).toBe("realm");
    expect(agentOfPath("~/.codex/config.toml")).toBe("codex");
    expect(agentOfPath("~/work/atlas/.cursor/rules/style.mdc")).toBe("cursor");
    expect(agentOfPath("~/work/atlas/CLAUDE.md")).toBe("claude");
    // An AGENTS.md is every agent's, so it is nobody's mark.
    expect(agentOfPath("~/work/atlas/AGENTS.md")).toBeNull();
  });
});
