import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { McpDefinition, McpDraft, McpHealth, McpServer, McpStep, McpSuggestion, Skill, SkillDetail, SkillHealth, SkillOffer } from "@amc/contracts";
import { Toasts } from "../components/Toasts";
import { SetupDetail } from "./SetupDetail";
import { SetupList } from "./SetupList";
import { SetupSheets } from "./SetupSheets";
import { McpSidebar, SkillsSidebar } from "./SetupSidebar";
import { commandLine, commandWords, healthSummary, runnableSaid } from "./setup-model";
import { HEALTH_POLL_MS, useSetup, type SetupRpc } from "./use-setup";

beforeAll(async () => { await import("../editors/RichTextEditor"); }, 60_000);
afterEach(() => { vi.useRealTimers(); });

const definition = (over: Partial<McpDefinition> & Pick<McpDefinition, "agent" | "file">): McpDefinition => ({
  projectId: null, projectName: null, transport: "stdio", target: "npx -y @example/tracker-mcp", fingerprint: "t", envKeys: [], headerKeys: [], disabled: false, ...over,
});
const TRACKER: McpServer = { name: "tracker", conflict: false, definitions: [
  definition({ agent: "Claude Code", file: "~/.claude.json" }), definition({ agent: "Codex", file: "~/.codex/config.toml" }),
] };
const NOTES: McpServer = { name: "notes", conflict: false, definitions: [
  definition({ agent: "Claude Code", file: "~/.claude.json", transport: "http", target: "https://notes.example/mcp", fingerprint: "n" }),
] };
const DESKTOP: McpServer = { name: "files", conflict: false, definitions: [definition({ agent: "Claude Desktop", file: "~/Library/Application Support/Claude/config.json", fingerprint: "f" })] };

const health = (name: string, agent: string, state: McpHealth["state"], detail: string | null = null): McpHealth => ({ name, agent, projectId: null, state, detail, tools: state === "connected" ? 4 : null, checkedAt: 1 });

const skill = (over: Partial<Skill> & Pick<Skill, "id" | "name">): Skill => ({
  description: "Ship a release", path: `/home/skills/${over.name}/SKILL.md`, places: [{ label: "Claude", displayPath: `~/.claude/skills/${over.name}`, linked: false }],
  copies: 1, variants: 0, valid: true, updatedAt: Date.now() - 60_000, ...over,
});
const RELEASE = skill({ id: "s-release", name: "release", places: [
  { label: "Claude", displayPath: "~/.claude/skills/release", linked: false }, { label: "Codex", displayPath: "~/.codex/skills/release", linked: true },
] });
const LINT = skill({ id: "s-lint", name: "lint", description: "Run the linters" });

const offer = (over: Partial<SkillOffer> & Pick<SkillOffer, "name">): SkillOffer => ({
  path: `skills/${over.name}`, description: `What ${over.name} does`, files: 3, bytes: 12_288, runnable: [], installed: "no", ...over,
});
const OFFERS = [
  offer({ name: "changelog", runnable: ["scripts/tag.sh", "scripts/notes.py"] }),
  offer({ name: "lint", installed: "same" }),
  offer({ name: "release", installed: "different" }),
  offer({ name: "broken" }),
];

const SUGGESTION: McpSuggestion = {
  draft: { name: "tracker", transport: "stdio", command: "npx", args: ["-y", "@example/tracker-mcp"], env: { TRACKER_TOKEN: "" }, headers: {} },
  needs: ["TRACKER_TOKEN"], source: "the npm package @example/tracker-mcp", model: "claude-test-model",
};

type Call = { method: string; params: Record<string, unknown> };

/** A server that holds its own lists, so a removal or an install shows when the section reads again. */
function fakeServer(start: { servers?: McpServer[]; skills?: Skill[]; health?: McpHealth[]; issues?: SkillHealth[]; runners?: boolean } = {}) {
  const calls: Call[] = [];
  const held = {
    servers: start.servers ?? [TRACKER, NOTES], skills: start.skills ?? [RELEASE, LINT], health: start.health ?? [], issues: start.issues ?? [],
    /** What each answer to `mcp.health` says is still being checked, one per call, then nothing. */
    checking: [] as string[][],
    afterCheck: [] as McpHealth[],
    steps: null as McpStep[] | null,
    signIn: { started: true, detail: null as string | null },
    removal: { ok: true, detail: null as string | null },
  };
  const answers: Record<string, (params: any) => unknown> = {
    "setup.skills": () => ({ skills: held.skills }),
    "setup.mcp": () => ({ servers: held.servers }),
    "setup.hooks": () => ({ hooks: [{ agent: "Codex", projectId: "p-atlas", projectName: "atlas", file: "~/work/atlas/.codex/hooks.json", event: "Stop", matcher: null, command: "say done" }] }),
    "setup.skill": ({ id }) => ({ ...held.skills.find((s) => s.id === id)!, body: "# Skill\n\nDo the thing.\n", files: [] } satisfies SkillDetail),
    "mcp.health": ({ check }) => {
      if (check) return { health: held.health, checking: held.checking.shift() ?? [] };
      const checking = held.checking.shift() ?? [];
      if (checking.length === 0 && held.afterCheck.length > 0) held.health = held.afterCheck;
      return { health: held.health, checking };
    },
    "mcp.icon": ({ name }) => ({ icon: name === "tracker" ? "data:image/png;base64,AAAA" : null }),
    "mcp.signIn": () => held.signIn,
    "mcp.remove": ({ name, agent }) => {
      if (held.removal.ok) held.servers = held.servers.map((s) => (s.name !== name ? s : { ...s, definitions: s.definitions.filter((d) => d.agent !== (agent === "claude" ? "Claude Code" : "Codex")) })).filter((s) => s.definitions.length > 0);
      return { agent, ...held.removal };
    },
    "models.status": () => ({ runners: start.runners ? [{ runner: "claude", probe: { installed: true }, settings: { allowed: true, models: { scan: "claude-small", write: "claude-test-model" } } }] : [], spentTodayUsd: 0, dailyCapUsd: 5 }),
    "mcp.suggest": () => SUGGESTION,
    "mcp.preview": ({ draft, placement }: { draft: McpDraft; placement: { agents: string[] } }) => ({
      steps: held.steps ?? placement.agents.map((agent) => ({ agent, how: "command", shows: `${agent} mcp add ${draft.name} --env TRACKER_TOKEN=•••• -- ${draft.command} ${draft.args.join(" ")}`, refused: null })),
    }),
    "mcp.add": ({ placement }: { placement: { agents: string[] } }) => ({ outcomes: placement.agents.map((agent) => ({ agent, ok: true, detail: null })) }),
    "skills.health": () => ({ skills: held.issues }),
    "skills.libraries": () => ({ libraries: [{ name: "Example skills", url: "https://example.com/skills", about: "A vendor's own skills" }] }),
    "skills.inspect": ({ from }) => {
      if (from === "nowhere") throw new Error("There is no folder there.");
      return { token: "fetched-1", from, version: "abc1234", offers: OFFERS };
    },
    "skills.preview": ({ path }) => ({ text: `---\nname: ${path}\n---\nSteps for ${path}.`, files: ["scripts/tag.sh"] }),
    "skills.install": ({ paths }: { paths: string[] }) => ({
      installed: paths.map((path) => (path === "skills/broken" ? { path, id: null, ok: false, detail: "Its SKILL.md has no name." } : { path, id: `s-${path}`, ok: true, detail: null })),
    }),
    "skills.remove": ({ id, place }) => {
      held.skills = held.skills.map((s) => (s.id !== id ? s : { ...s, places: place === undefined ? [] : s.places.filter((p) => p.displayPath !== place) })).filter((s) => s.places.length > 0);
      return {};
    },
  };
  const rpc = {
    call: async (method: string, params: Record<string, unknown>) => {
      calls.push({ method, params });
      const answer = answers[method];
      if (!answer) throw new Error(`no answer for ${method}`);
      return answer(params);
    },
  } as unknown as SetupRpc;
  const sent = (method: string) => calls.filter((c) => c.method === method).map((c) => c.params);
  return { rpc, calls, held, sent };
}

function Section({ rpc, tab, onOpenModels = () => {} }: { rpc: SetupRpc; tab: "mcp" | "skills"; onOpenModels?: () => void }) {
  const setup = useSetup(rpc);
  if (setup.tab !== tab) setup.setTab(tab);
  return (
    <>
      {tab === "mcp" ? <McpSidebar setup={setup} /> : <SkillsSidebar setup={setup} />}
      <SetupList setup={setup} /><SetupDetail setup={setup} />
      <SetupSheets setup={setup} rpc={rpc} onOpenModels={onOpenModels} />
      <Toasts />
    </>
  );
}

async function mount(tab: "mcp" | "skills", server = fakeServer(), onOpenModels?: () => void) {
  render(<Section rpc={server.rpc} tab={tab} onOpenModels={onOpenModels} />);
  await screen.findAllByRole("option");
  return server;
}

const sidebar = (name: string) => screen.getByRole("navigation", { name });
const reader = () => screen.getByRole("region", { name: "Reader" });
const rows = () => screen.queryAllByRole("option");
const row = (name: string) => rows().find((r) => r.querySelector(".lib-row-title")!.textContent === name)!;
const dialog = () => screen.getByRole("dialog");
const press = (name: string | RegExp, inside: HTMLElement = document.body) => fireEvent.click(within(inside).getByRole("button", { name }));
const type = (label: string | RegExp, value: string) => fireEvent.change(within(dialog()).getByLabelText(label), { target: { value } });

describe("the model for connections", () => {
  it("cuts a command line into its words and back, keeping a quoted argument whole", () => {
    expect(commandWords(`npx -y @example/mcp --root "/Users/me/My Files"`)).toEqual(["npx", "-y", "@example/mcp", "--root", "/Users/me/My Files"]);
    expect(commandLine(["npx", "--root", "/Users/me/My Files"])).toBe(`npx --root "/Users/me/My Files"`);
  });

  it("says nothing of health until a check has been made", () => {
    expect(healthSummary([], [TRACKER, NOTES])).toBeNull();
    expect(healthSummary([health("tracker", "claude", "connected"), health("notes", "Claude Code", "needs-sign-in")], [TRACKER, NOTES])).toBe("1 connected, 0 failed, 1 wants a sign-in");
  });

  it("says in words whether an offered skill holds anything to run", () => {
    expect(runnableSaid([])).toBe("Holds nothing an agent could run.");
    expect(runnableSaid(["a.sh", "b.py"])).toBe("Holds 2 scripts. Installing does not run them, but an agent may.");
  });
});

describe("MCP servers", () => {
  it("counts the servers and each agent's in the sidebar, and narrows the list to one agent", async () => {
    await mount("mcp", fakeServer({ servers: [TRACKER, NOTES, DESKTOP] }));
    const nav = sidebar("MCP servers");
    expect([...nav.querySelectorAll(".lib-nav-row")].map((r) => r.textContent)).toEqual(["All servers3", "Favorites0", "Claude Code2", "Claude Desktop1", "Codex1"]);
    expect(nav.querySelector(".setup-nav-health")).toBeNull();
    press(/Codex/, nav);
    expect(rows().map((r) => r.querySelector(".lib-row-title")!.textContent)).toEqual(["tracker"]);
  });

  it("gives each row its icon when there is one, its agents and a word for its health", async () => {
    const server = await mount("mcp", fakeServer({ health: [health("tracker", "claude", "connected"), health("tracker", "codex", "failed", "The command was not found.")] }));
    await waitFor(() => expect(row("tracker").querySelector(".setup-icon img")?.getAttribute("src")).toBe("data:image/png;base64,AAAA"));
    expect(row("notes").querySelector(".setup-icon img")).toBeNull();
    expect(server.sent("mcp.icon")).toHaveLength(2);
    expect(within(row("tracker")).getAllByRole("img").map((mark) => mark.getAttribute("aria-label"))).toEqual(["Claude Code", "Codex"]);
    expect(row("tracker").querySelector(".setup-health")!.textContent).toBe("Failed");
    expect(row("notes").querySelector(".setup-health")!.textContent).toBe("Not checked");
    expect(sidebar("MCP servers").querySelector(".setup-nav-health")!.textContent).toBe("0 connected, 1 failed, 0 want a sign-in");
  });

  it("checks every server, asks again while any is being checked, and stops when none is", async () => {
    const server = fakeServer();
    await mount("mcp", server);
    vi.useFakeTimers();
    server.held.checking = [["tracker", "notes"], ["notes"], []];
    server.held.afterCheck = [health("tracker", "claude", "connected"), health("tracker", "codex", "connected"), health("notes", "claude", "connected")];
    const asked = () => server.sent("mcp.health").length;
    const before = asked();

    press("Check all");
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(server.sent("mcp.health").at(-1)).toEqual({ check: true });
    expect(screen.getByRole("button", { name: "Checking" })).toHaveProperty("disabled", true);
    expect(row("tracker").querySelector(".setup-health")!.textContent).toBe("Checking");

    await act(async () => { await vi.advanceTimersByTimeAsync(HEALTH_POLL_MS); });
    expect(asked()).toBe(before + 2);
    expect(row("tracker").querySelector(".setup-health")!.textContent).toBe("Not checked");
    expect(row("notes").querySelector(".setup-health")!.textContent).toBe("Checking");

    await act(async () => { await vi.advanceTimersByTimeAsync(HEALTH_POLL_MS); });
    expect(asked()).toBe(before + 3);
    expect(row("notes").querySelector(".setup-health")!.textContent).toBe("Connected");
    expect(screen.getByRole("button", { name: "Check all" })).toHaveProperty("disabled", false);

    await act(async () => { await vi.advanceTimersByTimeAsync(HEALTH_POLL_MS * 5); });
    expect(asked()).toBe(before + 3);
  });

  it("offers a sign-in to a server that wants one, and checks one server again", async () => {
    const server = await mount("mcp", fakeServer({ health: [health("notes", "Claude Code", "needs-sign-in", "It answered 401.")] }));
    fireEvent.click(row("notes"));
    expect(within(reader()).getByText("It answered 401.")).toBeTruthy();
    expect(reader().querySelector(".setup-health")!.textContent).toBe("Sign in");
    press("Sign in", reader());
    await screen.findByText(/The sign-in for notes is open in your browser/);
    expect(server.sent("mcp.signIn")).toEqual([{ name: "notes", agent: "claude" }]);

    press("Check again", reader());
    await waitFor(() => expect(server.sent("mcp.health").at(-1)).toEqual({ check: true, name: "notes" }));

    fireEvent.click(row("tracker"));
    expect(within(reader()).queryByRole("button", { name: "Sign in" })).toBeNull();
  });

  it("removes a server from one agent only after asking, naming the agent and its file", async () => {
    const server = await mount("mcp");
    fireEvent.click(row("tracker"));
    press("Remove", within(reader()).getByText("Codex").closest("li")!);
    expect(server.sent("mcp.remove")).toEqual([]);
    expect(dialog().getAttribute("aria-label")).toBe("Remove tracker from Codex?");
    expect(within(dialog()).getByText("~/.codex/config.toml")).toBeTruthy();
    expect(within(dialog()).getByText(/taken out of Codex's config.*Every session of Codex loses it/)).toBeTruthy();

    press("Remove", dialog());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(server.sent("mcp.remove")).toEqual([{ name: "tracker", agent: "codex", projectId: null }]);
    await waitFor(() => expect([...reader().querySelectorAll(".setup-place-who")].map((el) => el.textContent)).toEqual(["Claude Code"]));
  });

  it("keeps the question up with the reason when the agent's tool refuses", async () => {
    const server = fakeServer();
    server.held.removal = { ok: false, detail: "codex is not installed." };
    await mount("mcp", server);
    fireEvent.click(row("tracker"));
    press("Remove", within(reader()).getByText("Codex").closest("li")!);
    press("Remove", dialog());
    expect((await within(dialog()).findByRole("alert")).textContent).toBe("It was not removed: codex is not installed.");
  });

  it("does not offer to remove from an agent the app cannot change", async () => {
    await mount("mcp", fakeServer({ servers: [DESKTOP] }));
    fireEvent.click(row("files"));
    expect(within(reader()).queryByRole("button", { name: "Remove" })).toBeNull();
    expect(within(reader()).getByText("Claude Desktop's servers are changed in Claude Desktop itself.")).toBeTruthy();
  });
});

describe("adding an MCP server", () => {
  it("points at Models when no model is turned on, and leaves filling it in open", async () => {
    let opened = 0;
    const server = await mount("mcp", fakeServer(), () => { opened += 1; });
    press("Add");
    await within(dialog()).findByText(/Nothing is sent until you turn a model on/);
    expect(within(dialog()).queryByLabelText("What to add")).toBeNull();
    press("Open Models", dialog());
    expect(opened).toBe(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(server.sent("mcp.suggest")).toEqual([]);
  });

  it("has a model draft the form from a sentence, and says a model wrote it and where it says the server is from", async () => {
    const server = await mount("mcp", fakeServer({ runners: true }));
    press("Add");
    await within(dialog()).findByLabelText("What to add");
    expect(within(dialog()).queryByRole("form", { name: "The server" })).toBeNull();
    type("What to add", "Add the tracker server to Claude and Codex");
    press("Draft it", dialog());

    const form = await within(dialog()).findByRole("form", { name: "The server" });
    expect(server.sent("mcp.suggest")).toEqual([{ ask: "Add the tracker server to Claude and Codex", runner: "claude" }]);
    expect(within(dialog()).getByRole("status").textContent).toBe(
      "A model (claude-test-model) wrote what is below, and it can be wrong. It says the server comes from the npm package @example/tracker-mcp. Check it before adding.");
    expect(within(form).getByLabelText<HTMLInputElement>("Name").value).toBe("tracker");
    expect(within(form).getByLabelText<HTMLInputElement>("Command, with its arguments").value).toBe("npx -y @example/tracker-mcp");
    expect(within(form).getByLabelText<HTMLInputElement>("Name of the variable").value).toBe("TRACKER_TOKEN");
    const value = within(form).getByLabelText<HTMLInputElement>("Value of TRACKER_TOKEN");
    expect([value.type, value.value, value.placeholder]).toEqual(["password", "", "Needs a value from you"]);
    expect(["Claude Code", "Codex", "Cursor", "Gemini"].map((agent) => within(form).getByLabelText<HTMLInputElement>(agent).checked)).toEqual([true, true, false, false]);
    expect(server.sent("mcp.add")).toEqual([]);
  });

  it("shows what each agent will run before anything is added, then each agent's outcome", async () => {
    const server = await mount("mcp");
    press("Add");
    fireEvent.click(within(dialog()).getByLabelText("Fill it in"));
    type("Name", "tracker2");
    type("Command, with its arguments", "npx -y @example/tracker-mcp");
    press("Add a variable", dialog());
    type("Name of the variable", "TRACKER_TOKEN");
    type("Value of TRACKER_TOKEN", "tok-secret-123");
    fireEvent.click(within(dialog()).getByLabelText("Codex"));
    expect(within(dialog()).queryByRole("button", { name: /^Add to/ })).toBeNull();

    press("Show what it will do", dialog());
    const steps = await within(dialog()).findByRole("region", { name: "What adding it will do" });
    expect([...steps.querySelectorAll(".setup-code")].map((el) => el.textContent)).toEqual([
      "claude mcp add tracker2 --env TRACKER_TOKEN=•••• -- npx -y @example/tracker-mcp", "codex mcp add tracker2 --env TRACKER_TOKEN=•••• -- npx -y @example/tracker-mcp",
    ]);
    expect(server.sent("mcp.add")).toEqual([]);
    const draft = { name: "tracker2", transport: "stdio", command: "npx", args: ["-y", "@example/tracker-mcp"], env: { TRACKER_TOKEN: "tok-secret-123" }, headers: {} };
    expect(server.sent("mcp.preview")).toEqual([{ draft, placement: { agents: ["claude", "codex"], projectId: null } }]);

    press("Add to Claude Code and Codex", dialog());
    await waitFor(() => expect([...dialog().querySelectorAll(".setup-step-outcome")].map((el) => el.textContent)).toEqual(["Added.", "Added."]));
    expect(server.sent("mcp.add")).toEqual([{ draft, placement: { agents: ["claude", "codex"], projectId: null } }]);
    expect(within(dialog()).getByLabelText<HTMLInputElement>("Value of TRACKER_TOKEN").value).toBe("");
    expect(document.body.textContent).not.toContain("tok-secret-123");
    expect(server.sent("setup.mcp").length).toBeGreaterThan(1);
    press("Done", dialog());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("takes the preview away when the form changes, so what is added is what was shown", async () => {
    await mount("mcp");
    press("Add");
    fireEvent.click(within(dialog()).getByLabelText("Fill it in"));
    type("Name", "tracker2");
    type("Command, with its arguments", "npx one");
    press("Show what it will do", dialog());
    await within(dialog()).findByRole("button", { name: "Add to Claude Code" });
    type("Command, with its arguments", "npx two");
    expect(within(dialog()).queryByRole("button", { name: /^Add to/ })).toBeNull();
    expect(within(dialog()).queryByRole("region", { name: "What adding it will do" })).toBeNull();
  });

  it("says which agent refuses a server and why, and adds it only to the ones that take it", async () => {
    const server = fakeServer();
    server.held.steps = [
      { agent: "claude", how: "command", shows: "claude mcp add --transport sse feed https://feed.example/sse", refused: null },
      { agent: "codex", how: "file", shows: "~/.codex/config.toml", refused: "Codex cannot reach a server over SSE." },
    ];
    await mount("mcp", server);
    press("Add");
    fireEvent.click(within(dialog()).getByLabelText("Fill it in"));
    type("Name", "feed");
    fireEvent.click(within(dialog()).getByLabelText("A URL"));
    type("URL", "https://feed.example/sse");
    fireEvent.change(within(dialog()).getByLabelText("Speaks"), { target: { value: "sse" } });
    fireEvent.click(within(dialog()).getByLabelText("Codex"));
    fireEvent.change(within(dialog()).getByLabelText("For"), { target: { value: "p-atlas" } });
    press("Show what it will do", dialog());
    await within(dialog()).findByText("Cannot take it: Codex cannot reach a server over SSE.");

    press("Add to Claude Code", dialog());
    await within(dialog()).findByText("Added.");
    expect(server.sent("mcp.add")).toEqual([{
      draft: { name: "feed", transport: "sse", url: "https://feed.example/sse", args: [], env: {}, headers: {} }, placement: { agents: ["claude"], projectId: "p-atlas" },
    }]);
  });

  it("holds no secret once the sheet has closed", async () => {
    const server = await mount("mcp");
    press("Add");
    fireEvent.click(within(dialog()).getByLabelText("Fill it in"));
    type("Name", "tracker2");
    press("Add a variable", dialog());
    type("Name of the variable", "TRACKER_TOKEN");
    type("Value of TRACKER_TOKEN", "tok-secret-123");
    press("Cancel", dialog());
    expect(screen.queryByRole("dialog")).toBeNull();

    press("Add");
    fireEvent.click(within(dialog()).getByLabelText("Fill it in"));
    expect(within(dialog()).getByLabelText<HTMLInputElement>("Name").value).toBe("");
    expect(within(dialog()).queryByLabelText(/^Value of/)).toBeNull();
    expect(document.body.innerHTML).not.toContain("tok-secret-123");
    expect(JSON.stringify(server.calls)).not.toContain("tok-secret-123");
  });
});

describe("Skills", () => {
  const ISSUES: SkillHealth[] = [{ id: "s-lint", issues: [
    { kind: "missing-server", detail: "It calls the tracker server, which no agent that reaches it has." }, { kind: "too-long", detail: "Its SKILL.md is 900 lines, and an agent reads all of it each time." },
  ] }];

  it("counts each place skills are reached from, and the ones that need a look", async () => {
    await mount("skills", fakeServer({ issues: ISSUES }));
    const nav = sidebar("Skills");
    await waitFor(() => expect([...nav.querySelectorAll(".lib-nav-row")].map((r) => r.textContent)).toEqual(["All skills2", "Favorites0", "Claude2", "Codex1", "Needs a look1"]));
    expect(row("lint").textContent).toContain("Needs a look");
    expect(row("release").textContent).not.toContain("Needs a look");
    press(/Needs a look/, nav);
    expect(rows().map((r) => r.querySelector(".lib-row-title")!.textContent)).toEqual(["lint"]);
    press(/Codex/, nav);
    expect(rows().map((r) => r.querySelector(".lib-row-title")!.textContent)).toEqual(["release"]);
  });

  it("says what is wrong with a skill as sentences", async () => {
    await mount("skills", fakeServer({ issues: ISSUES }));
    fireEvent.click(row("lint"));
    await within(reader()).findByRole("heading", { name: "lint", level: 2 });
    expect([...reader().querySelectorAll(".setup-issue")].map((el) => el.textContent)).toEqual(ISSUES[0]!.issues.map((issue) => issue.detail));
  });

  it("removes a skill after asking, and says its folder goes to the Trash", async () => {
    const server = await mount("skills");
    fireEvent.click(row("lint"));
    await within(reader()).findByRole("heading", { name: "lint", level: 2 });
    press("Remove", reader());
    expect(server.sent("skills.remove")).toEqual([]);
    expect(within(dialog()).getByText("~/.claude/skills/lint")).toBeTruthy();
    expect(within(dialog()).getByText(/folder moves to the Trash, with every file in it/)).toBeTruthy();
    press("Move to Trash", dialog());
    await waitFor(() => expect(rows().map((r) => r.querySelector(".lib-row-title")!.textContent)).toEqual(["release"]));
    expect(server.sent("skills.remove")).toEqual([{ id: "s-lint" }]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("asks which place to remove a skill from when it is reached from several, and says a link leaves its folder", async () => {
    const server = await mount("skills");
    fireEvent.click(row("release"));
    await within(reader()).findByRole("heading", { name: "release", level: 2 });
    press("Remove", reader());
    fireEvent.change(within(dialog()).getByLabelText("Remove it from"), { target: { value: "~/.codex/skills/release" } });
    expect(within(dialog()).getByText(/The link is removed and the folder it leads to is left/)).toBeTruthy();
    press("Remove the link", dialog());
    await waitFor(() => expect(server.sent("skills.remove")).toEqual([{ id: "s-release", place: "~/.codex/skills/release" }]));
  });

  it("looks at a library, shows each skill and its SKILL.md, and installs the ones ticked with each outcome", async () => {
    const server = await mount("skills");
    press("Add skills");
    press(/Example skills/, await within(dialog()).findByRole("list", { name: "Libraries" }));
    const found = await within(dialog()).findByRole("list", { name: "Skills found" });
    expect(server.sent("skills.inspect")).toEqual([{ from: "https://example.com/skills" }]);
    expect(within(dialog()).getByText(/4 skills in/).textContent).toBe("4 skills in https://example.com/skills at abc1234. Installing copies a skill's folder and runs nothing.");

    const offers = [...found.querySelectorAll<HTMLElement>(".setup-offer")];
    expect(offers[0]!.textContent).toContain("3 files, 12 KB. Holds 2 scripts. Installing does not run them, but an agent may.");
    expect(offers[1]!.textContent).toContain("Already installed");
    expect(within(offers[1]!).getByLabelText<HTMLInputElement>("Install lint").disabled).toBe(true);
    expect(offers[2]!.textContent).toContain("Installed with different text");

    press("Read its SKILL.md", offers[0]!);
    await waitFor(() => expect(offers[0]!.querySelector(".setup-offer-text")?.textContent).toBe("---\nname: skills/changelog\n---\nSteps for skills/changelog."));
    expect(server.sent("skills.preview")).toEqual([{ token: "fetched-1", path: "skills/changelog" }]);
    expect(server.sent("skills.install")).toEqual([]);

    for (const name of ["changelog", "release", "broken"]) fireEvent.click(within(found).getByLabelText(`Install ${name}`));
    expect(offers[2]!.textContent).toContain("Installing writes over the one you have.");
    fireEvent.change(within(dialog()).getByLabelText("Install for"), { target: { value: "shared" } });
    press("Install 3 skills", dialog());

    await waitFor(() => expect(offers[3]!.textContent).toContain("Not installed: Its SKILL.md has no name."));
    expect(server.sent("skills.install")).toEqual([
      { token: "fetched-1", paths: ["skills/changelog", "skills/broken"], into: "shared", replace: false },
      { token: "fetched-1", paths: ["skills/release"], into: "shared", replace: true },
    ]);
    expect(within(offers[0]!).getByText("Installed")).toBeTruthy();
    expect(within(offers[2]!).getByText("Installed")).toBeTruthy();
    expect(server.sent("setup.skills").length).toBeGreaterThan(1);
  });

  it("takes a path typed in, and says why it could not be looked at", async () => {
    const server = await mount("skills");
    press("Add skills");
    type("Where to look", "nowhere");
    press("Look", dialog());
    expect((await within(dialog()).findByRole("alert")).textContent).toBe("It could not be looked at: There is no folder there.");
    type("Where to look", "~/Downloads/skills");
    press("Look", dialog());
    await within(dialog()).findByRole("list", { name: "Skills found" });
    expect(server.sent("skills.inspect").at(-1)).toEqual({ from: "~/Downloads/skills" });
  });
});
