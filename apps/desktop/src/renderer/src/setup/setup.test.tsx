import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { Hook, McpDefinition, McpServer, Skill, SkillDetail } from "@amc/contracts";
import type { HandedOut } from "../components/hand-out";
import { SetupDetail } from "./SetupDetail";
import { SetupList } from "./SetupList";
import { SETUP_TAB_LABEL, definedIn, hookText, reachedBy, serverText, skillsKept, waysOf, type SetupTab } from "./setup-model";
import { useSetup, type SetupRpc } from "./use-setup";

// The skill's text is drawn by the rich editor, which is split out of the window's chunk.
beforeAll(async () => { await import("../editors/RichTextEditor"); }, 60_000);

const skill = (over: Partial<Skill> & Pick<Skill, "id" | "name">): Skill => ({
  description: "Ship a release", path: `/home/skills/${over.name}/SKILL.md`, places: [{ label: "Claude", displayPath: `~/.claude/skills/${over.name}`, linked: false }],
  copies: 1, variants: 0, valid: true, updatedAt: Date.now() - 60_000, ...over,
});
const RELEASE = skill({ id: "s-release", name: "release", copies: 2, places: [
  { label: "Claude", displayPath: "~/.claude/skills/release", linked: false }, { label: "Codex", displayPath: "~/.codex/skills/release", linked: true },
] });
const LINT = skill({ id: "s-lint", name: "lint", description: "Run the linters", variants: 1 });
const BROKEN = skill({ id: "s-broken", name: "broken", description: null, valid: false });

const definition = (over: Partial<McpDefinition> & Pick<McpDefinition, "agent" | "file" | "target" | "fingerprint">): McpDefinition => ({
  projectId: null, projectName: null, transport: "stdio", envKeys: [], headerKeys: [], disabled: false, ...over,
});
const SEARCH: McpServer = { name: "search", conflict: true, definitions: [
  definition({ agent: "Claude Code", file: "~/.claude.json", target: "npx -y @example/search-mcp --api-key ••••", fingerprint: "one", envKeys: ["SEARCH_TOKEN"] }),
  definition({ agent: "Codex", file: "~/.codex/config.toml", target: "npx -y @example/search-mcp@2", fingerprint: "two" }),
  definition({ agent: "Cursor", file: "~/.cursor/mcp.json", target: "npx -y @example/search-mcp@2", fingerprint: "two", disabled: true }),
] };
const NOTES: McpServer = { name: "notes", conflict: false, definitions: [
  definition({ agent: "Claude Code", projectId: "p-atlas", projectName: "atlas", file: "~/work/atlas/.mcp.json", transport: "http", target: "https://notes.example/mcp", fingerprint: "n", headerKeys: ["Authorization"] }),
] };
const HOOKS: Hook[] = [
  { agent: "Claude Code", projectId: null, projectName: null, file: "~/.claude/settings.json", event: "PostToolUse", matcher: "Edit|Write", command: "pnpm lint --fix" },
  { agent: "Codex", projectId: "p-atlas", projectName: "atlas", file: "~/work/atlas/.codex/hooks.json", event: "Stop", matcher: null, command: "say done" },
];

function fakeSetupServer() {
  const asked: string[] = [];
  const rpc = {
    call: async (method: string, params: { id?: string }) => {
      asked.push(method);
      if (method === "setup.skills") return { skills: [RELEASE, LINT, BROKEN] };
      if (method === "setup.mcp") return { servers: [SEARCH, NOTES] };
      if (method === "setup.hooks") return { hooks: HOOKS };
      if (method === "setup.skill") {
        const found = [RELEASE, LINT, BROKEN].find((s) => s.id === params.id)!;
        return { ...found, body: "# Release\n\nTag the build, then publish.\n", files: ["scripts/tag.sh", "notes.md"] } satisfies SkillDetail;
      }
      throw new Error(`no answer for ${method}`);
    },
  } as unknown as SetupRpc;
  return { rpc, asked };
}

function Section({ rpc }: { rpc: SetupRpc }) {
  const setup = useSetup(rpc);
  // The app's sidebar chooses the section; here a plain row of buttons stands in for it.
  return (
    <>
      <nav aria-label="Sections">
        {(Object.keys(SETUP_TAB_LABEL) as SetupTab[]).map((tab) => <button key={tab} type="button" onClick={() => setup.setTab(tab)}>{SETUP_TAB_LABEL[tab]}</button>)}
      </nav>
      <SetupList setup={setup} /><SetupDetail setup={setup} />
    </>
  );
}

async function mount() {
  const server = fakeSetupServer();
  render(<Section rpc={server.rpc} />);
  await screen.findByRole("option", { name: /release/ });
  return server;
}

const sidebar = () => screen.getByRole("navigation", { name: "Sections" });
const reader = () => screen.getByRole("region", { name: "Reader" });
const rows = () => screen.queryAllByRole("option");
const titles = () => rows().map((row) => row.querySelector(".lib-row-title")!.textContent);
const tab = (name: RegExp) => within(sidebar()).getByRole("button", { name });

describe("the setup model", () => {
  it("keeps the skills that hold every word typed, in name, description or owner", () => {
    expect(skillsKept("", [RELEASE, LINT]).map((s) => s.name)).toEqual(["release", "lint"]);
    expect(skillsKept("ship", [RELEASE, LINT]).map((s) => s.name)).toEqual(["release"]);
    expect(skillsKept("codex REL", [RELEASE, LINT]).map((s) => s.name)).toEqual(["release"]);
    expect(skillsKept("nothing", [RELEASE, LINT])).toEqual([]);
  });

  it("names who reaches a skill once each, and counts them past three", () => {
    expect(reachedBy(RELEASE)).toBe("Claude, Codex");
    const many = skill({ id: "m", name: "m", places: ["Claude", "Codex", "Cursor", "Gemini", "Claude"].map((label, at) => ({ label, displayPath: `~/${at}`, linked: true })) });
    expect(reachedBy(many)).toBe("Claude, Codex and 2 more");
  });

  it("gathers a server's definitions by how they start it", () => {
    expect(waysOf(SEARCH).map((way) => [way.target, way.places.map((p) => p.agent)])).toEqual([
      ["npx -y @example/search-mcp --api-key ••••", ["Claude Code"]], ["npx -y @example/search-mcp@2", ["Codex", "Cursor"]],
    ]);
    expect(definedIn(SEARCH)).toBe("3 places: Claude Code, Codex, Cursor");
    expect(definedIn(NOTES)).toBe("Claude Code");
  });
});

describe("the Setup section", () => {
  it("lists the skills first, each with what is unusual about it", async () => {
    await mount();
    expect(titles()).toEqual(["release", "lint", "broken"]);
    expect(rows()[0]!.textContent).toContain("2 copies");
    expect(rows()[1]!.textContent).toContain("1 other version");
    expect(rows()[2]!.textContent).toContain("Cannot be picked");
  });

  it("filters the skills as words are typed", async () => {
    await mount();
    fireEvent.change(screen.getByRole("searchbox", { name: "Filter the skills" }), { target: { value: "lint" } });
    expect(titles()).toEqual(["lint"]);
    fireEvent.change(screen.getByRole("searchbox", { name: "Filter the skills" }), { target: { value: "zzz" } });
    expect(screen.getByText("Nothing matches")).toBeTruthy();
  });

  it("opens a skill with every place it is reached from, and says which are links", async () => {
    const server = await mount();
    fireEvent.click(rows()[0]!);
    await within(reader()).findByRole("heading", { name: "release", level: 2 });
    expect(server.asked.filter((m) => m === "setup.skill")).toHaveLength(1);
    const places = [...reader().querySelectorAll(".setup-places > li")].map((li) => li.textContent);
    expect(places).toEqual(["Claude~/.claude/skills/releaseIts own folder", "Codex~/.codex/skills/releaseLink"]);
    expect(within(reader()).getByText(/2 folders on this Mac hold exactly this skill/)).toBeTruthy();
    expect(within(reader()).getByText("scripts/tag.sh, notes.md")).toBeTruthy();
    await within(reader()).findByText("Tag the build, then publish.");
  });

  it("says when no agent will load a skill", async () => {
    await mount();
    fireEvent.click(rows()[2]!);
    await within(reader()).findByText(/missing the name or the description an agent picks a skill by/);
  });

  it("shows a server under each way it is started, with the names of what it is given and never a value", async () => {
    await mount();
    fireEvent.click(tab(/MCP servers/));
    expect(titles()).toEqual(["search", "notes"]);
    expect(rows()[0]!.textContent).toContain("Defined two ways");
    fireEvent.click(rows()[0]!);

    expect(within(reader()).getByText(/It is started 2 different ways/)).toBeTruthy();
    const first = within(reader()).getByRole("region", { name: "Way 1" });
    const second = within(reader()).getByRole("region", { name: "Way 2" });
    expect(within(first).getByText("npx -y @example/search-mcp --api-key ••••")).toBeTruthy();
    expect(within(first).getByText(/Given SEARCH_TOKEN\. Their values are never read into this app\./)).toBeTruthy();
    expect([...second.querySelectorAll(".setup-place-who")].map((el) => el.textContent)).toEqual(["Codex", "Cursor"]);
    expect(within(second).getByText("stdio · switched off")).toBeTruthy();

    fireEvent.click(rows()[1]!);
    expect(within(reader()).getByText("https://notes.example/mcp")).toBeTruthy();
    expect(within(reader()).getByText("Claude Code · atlas")).toBeTruthy();
    expect(within(reader()).getByText(/Sends the header Authorization\./)).toBeTruthy();
    expect(within(reader()).queryByText(/different ways/)).toBeNull();
  });

  it("lists each hook by when it runs, and opens its command", async () => {
    await mount();
    fireEvent.click(tab(/Hooks/));
    expect(titles()).toEqual(["PostToolUse · Edit|Write", "Stop"]);
    fireEvent.click(rows()[1]!);
    expect(within(reader()).getByRole("heading", { name: "Stop", level: 2 })).toBeTruthy();
    expect(within(reader()).getByText("Hook · Codex · atlas")).toBeTruthy();
    expect(reader().querySelector(".setup-code")!.textContent).toBe("say done");
    expect(within(reader()).queryByText("Only for")).toBeNull();
  });
});

/** The preload bridge with nothing behind it: what the window asked to drag out and to share is kept. */
function standInBridge() {
  const dragOut = vi.fn<(path: string) => void>();
  const share = vi.fn(async (_shared: HandedOut, _at: { x: number; y: number }) => {});
  window.amc = { port: 0, token: "", reveal: async () => {}, dragOut, share, appearance: { choice: { appearance: "system", accent: "system" }, systemAccent: "#007aff" }, chooseAppearance: async () => {}, onSystemAccent: () => () => {} };
  return { dragOut, share };
}
/** A drag's own carrier, as far as a row writes to it. */
const carrier = () => ({ setData: vi.fn<(type: string, text: string) => void>(), effectAllowed: "none" });

const SEARCH_TEXT = [
  "search (MCP server)", "",
  "npx -y @example/search-mcp --api-key ••••", "Claude Code: ~/.claude.json (stdio)", "  Given SEARCH_TOKEN. The values are left out.", "",
  "npx -y @example/search-mcp@2", "Codex: ~/.codex/config.toml (stdio)", "Cursor: ~/.cursor/mcp.json (stdio)",
].join("\n");

describe("handing a skill, a server or a hook to another app", () => {
  it("writes a server and a hook as the text the window shows, a secret masked and a variable by name alone", () => {
    expect(serverText(SEARCH)).toBe(SEARCH_TEXT);
    expect(serverText(NOTES)).toBe("notes (MCP server)\n\nhttps://notes.example/mcp\nClaude Code · atlas: ~/work/atlas/.mcp.json (http)\n  Sends Authorization. The values are left out.");
    expect(hookText(HOOKS[0]!)).toBe("PostToolUse · Edit|Write (hook)\nClaude Code: ~/.claude/settings.json\n\npnpm lint --fix");
  });

  it("drags a skill out as its folder, and shares the folder from its page", async () => {
    const { dragOut, share } = standInBridge();
    await mount();
    expect(fireEvent.dragStart(rows()[0]!, { dataTransfer: carrier() })).toBe(false);
    expect(dragOut.mock.calls).toEqual([["/home/skills/release"]]);
    fireEvent.click(rows()[0]!);
    await within(reader()).findByRole("heading", { name: "release", level: 2 });
    fireEvent.click(within(reader()).getByRole("button", { name: "Share" }));
    expect(share).toHaveBeenCalledWith({ path: "/home/skills/release" }, { x: 0, y: 6 });
  });

  it("drags a server and a hook as text in the page's own drag, and shares the same text", async () => {
    const { dragOut, share } = standInBridge();
    await mount();
    fireEvent.click(tab(/MCP servers/));
    const dataTransfer = carrier();
    // Not cancelled: text is the page's own to carry.
    expect(fireEvent.dragStart(rows()[0]!, { dataTransfer })).toBe(true);
    expect(dataTransfer.setData.mock.calls).toEqual([["text/plain", SEARCH_TEXT]]);
    fireEvent.click(rows()[0]!);
    fireEvent.click(within(reader()).getByRole("button", { name: "Share" }));
    expect(share).toHaveBeenLastCalledWith({ text: SEARCH_TEXT }, { x: 0, y: 6 });

    fireEvent.click(tab(/Hooks/));
    fireEvent.dragStart(rows()[1]!, { dataTransfer });
    expect(dataTransfer.setData).toHaveBeenLastCalledWith("text/plain", "Stop (hook)\nCodex · atlas: ~/work/atlas/.codex/hooks.json\n\nsay done");
    fireEvent.click(rows()[1]!);
    fireEvent.click(within(reader()).getByRole("button", { name: "Share" }));
    expect(share).toHaveBeenLastCalledWith({ text: "Stop (hook)\nCodex · atlas: ~/work/atlas/.codex/hooks.json\n\nsay done" }, { x: 0, y: 6 });
    expect(dragOut).not.toHaveBeenCalled();
  });

  it("has no Share until something is being read", async () => {
    await mount();
    expect(within(reader()).queryByRole("button", { name: "Share" })).toBeNull();
  });
});
