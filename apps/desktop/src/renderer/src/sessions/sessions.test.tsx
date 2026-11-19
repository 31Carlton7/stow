import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Session, SessionBlock, SessionContext, SessionFacets, SessionFilter, SessionIndexStatus } from "@amc/contracts";
import type { HandedOut } from "../components/hand-out";
import { SessionReader } from "./SessionReader";
import { SessionsList } from "./SessionsList";
import { SessionsSidebar } from "./SessionsSidebar";
import { useSessions, type SessionsRpc } from "./use-sessions";

const HOUR = 3_600_000;
const session = (over: Partial<Session> & Pick<Session, "id" | "title">): Session => ({
  agent: "claude", origin: "person", drivenBy: null, projectId: "p-atlas", projectName: "atlas", cwd: "~/work/atlas", model: "claude-opus-4",
  startedAt: Date.now() - 3 * HOUR, endedAt: Date.now() - 2 * HOUR, sizeBytes: 48_200, metrics: null, parentId: null, children: 0, realm: null,
  path: `/home/.claude/projects/atlas/${over.id}.jsonl`, displayPath: `~/.claude/projects/atlas/${over.id}.jsonl`, ...over,
});
const DEPLOY = session({
  id: "s-deploy", title: "Fix the deploy script", children: 2,
  metrics: { userTurns: 4, assistantTurns: 9, toolCalls: 12, toolErrors: 1, inputTokens: 182_000, outputTokens: 9400, costUsd: 0.42 },
});
const TEAMS = session({ id: "s-teams", title: "Plan the teams tab", agent: "codex", origin: "app", drivenBy: "Realm", projectId: "p-realm", projectName: "realm", cwd: "~/work/realm", startedAt: Date.now() - 30 * HOUR, endedAt: Date.now() - 29 * HOUR });
const NOTES = session({ id: "s-notes", title: "Tidy the notes", projectId: null, projectName: null, cwd: "~/notes", startedAt: Date.now() - 50 * HOUR, endedAt: Date.now() - 49 * HOUR });
const TITLE_CALL = session({ id: "s-title", title: "Write a title for this chat", origin: "one-shot", startedAt: Date.now() - 60 * HOUR, endedAt: Date.now() - 60 * HOUR });
const CHILD_ONE = session({ id: "s-child-1", title: "Find the failing step", origin: "sub-agent", parentId: "s-deploy", startedAt: Date.now() - 2.5 * HOUR });
const CHILD_TWO = session({ id: "s-child-2", title: "Read the release notes", origin: "sub-agent", parentId: "s-deploy", startedAt: Date.now() - 2.4 * HOUR });
const EVERY = [DEPLOY, TEAMS, NOTES, TITLE_CALL, CHILD_ONE, CHILD_TWO];

const IDLE: SessionIndexStatus = { state: "idle", files: 6, listed: 6, measured: 6, pausedWhy: null };

const FIRST_STRETCH: SessionBlock[] = [
  { kind: "user", at: 1, text: "Why does the deploy fail?", cut: 1200 },
  { kind: "thinking", at: 2, text: "The script exits before the build step.", cut: 0 },
  { kind: "assistant", at: 3, text: "It fails in **step two**.\n\n```sh\npnpm build\n```", cut: 0, model: "claude-opus-4" },
  { kind: "tool", at: 4, name: "Bash", input: "pnpm build\n--filter web", inputCut: 0, output: "built in 4s", outputCut: 5300, failed: false },
  { kind: "tool", at: 5, name: "Read", input: '{"file_path":"deploy.sh"}', inputCut: 40, output: "ENOENT: no such file", outputCut: 0, failed: true },
  { kind: "tool", at: 6, name: "Task", input: "Find the failing step", inputCut: 0, output: null, outputCut: 0, failed: false },
  { kind: "note", at: 7, label: "Compacted", text: "The conversation so far was summarised.", cut: 0 },
];
const SECOND_STRETCH: SessionBlock[] = [{ kind: "assistant", at: 8, text: "The script is fixed.", cut: 0, model: "claude-opus-4" }];

const CONTEXT: SessionContext = {
  recorded: false, chars: 18_204,
  files: [
    { role: "Instructions", displayPath: "~/work/atlas/CLAUDE.md", chars: 4210, libraryId: "f-claude-md", changedSince: true },
    { role: "Memory", displayPath: "~/.claude/projects/atlas/memory/MEMORY.md", chars: 900, libraryId: null, changedSince: null },
  ],
};

type Call = { method: string; params: { filter?: SessionFilter; offset?: number; limit?: number; id?: string; cursor?: string } };

function kept(filter: SessionFilter, all: readonly Session[]): Session[] {
  const origins = filter.origins ?? ["person", "app"];
  const words = (filter.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  return all.filter((s) => origins.includes(s.origin)
    && (filter.agent === undefined || s.agent === filter.agent)
    && (filter.projectId === undefined || s.projectId === filter.projectId)
    && (filter.parentId === undefined || s.parentId === filter.parentId)
    && words.every((word) => `${s.title} ${s.projectName ?? ""} ${s.cwd ?? ""}`.toLowerCase().includes(word)));
}

function facetsOf(all: readonly Session[]): SessionFacets {
  const origins = (["person", "app", "one-shot", "sub-agent"] as const).map((origin) => ({ origin, count: all.filter((s) => s.origin === origin).length }));
  const conversations = kept({}, all);
  return {
    total: all.length,
    agents: (["claude", "codex"] as const).map((agent) => ({ agent, count: conversations.filter((s) => s.agent === agent).length })).filter((a) => a.count > 0),
    origins,
    projects: [{ id: "p-atlas", name: "atlas" }, { id: "p-realm", name: "realm" }]
      .map((p) => ({ ...p, count: conversations.filter((s) => s.projectId === p.id).length })).filter((p) => p.count > 0),
  };
}

/** A server that holds `held` and answers as the contract says. `statuses` are answered in turn, the last one for good. */
function fakeSessionsServer(o: { held?: Session[]; statuses?: SessionIndexStatus[]; failing?: Record<string, string> } = {}) {
  const calls: Call[] = [];
  const index = { held: o.held ?? EVERY, context: CONTEXT };
  const statuses = [...(o.statuses ?? [IDLE])];
  const answers: Record<string, (params: Call["params"]) => unknown> = {
    "sessions.list": ({ filter = {}, offset = 0, limit = 200 }) => {
      const all = kept(filter, index.held);
      return { sessions: all.slice(offset, offset + limit), matched: all.length };
    },
    "sessions.facets": () => facetsOf(index.held),
    "sessions.status": () => (statuses.length > 1 ? statuses.shift() : statuses[0]),
    "sessions.read": ({ cursor }) => (cursor === undefined ? { blocks: FIRST_STRETCH, next: "block-7" } : { blocks: SECOND_STRETCH, next: null }),
    "sessions.context": () => index.context,
  };
  const rpc = {
    call: async (method: string, params: Call["params"]) => {
      calls.push({ method, params });
      const failure = o.failing?.[method];
      if (failure !== undefined) throw new Error(failure);
      const answer = answers[method];
      if (!answer) throw new Error(`no answer for ${method}`);
      // A new object each time, as the socket gives: React must see a fresh answer as one.
      return structuredClone(answer(params));
    },
  } as unknown as SessionsRpc;
  const asked = (method: string) => calls.filter((c) => c.method === method);
  return { rpc, asked, index, lastList: () => asked("sessions.list").at(-1)!.params };
}

const onOpenFile = vi.fn();
function Section({ rpc }: { rpc: SessionsRpc }) {
  const sessions = useSessions(rpc);
  return <><SessionsSidebar sessions={sessions} /><SessionsList sessions={sessions} /><SessionReader sessions={sessions} onOpenFile={onOpenFile} /></>;
}

async function mount(o: Parameters<typeof fakeSessionsServer>[0] = {}) {
  const server = fakeSessionsServer(o);
  render(<Section rpc={server.rpc} />);
  await screen.findByRole("option", { name: /Fix the deploy script/ });
  return server;
}

const sidebar = () => screen.getByRole("navigation", { name: "Sessions" });
const list = () => screen.getByRole("region", { name: "Sessions" });
const reader = () => screen.getByRole("region", { name: "Reader" });
const rows = () => screen.queryAllByRole("option");
const titles = () => rows().map((row) => row.querySelector(".lib-row-title")!.textContent);
const navRow = (name: RegExp) => within(sidebar()).getByRole("button", { name });
const search = () => screen.getByRole("searchbox", { name: "Search the sessions" });

async function open(title: RegExp) {
  fireEvent.click(screen.getByRole("option", { name: title }));
  await within(reader()).findByText("Why does the deploy fail?");
}

afterEach(() => { vi.useRealTimers(); onOpenFile.mockClear(); });

describe("the sidebar and the list", () => {
  it("lists the conversations a person had, newest first, and leaves the rest out", async () => {
    const server = await mount();
    expect(server.asked("sessions.list")[0]!.params).toEqual({ filter: { origins: ["person", "app"] }, limit: 200, offset: 0 });
    expect(titles()).toEqual(["Fix the deploy script", "Plan the teams tab", "Tidy the notes"]);

    expect(navRow(/All conversations/).textContent).toBe("All conversations3");
    expect(within(sidebar()).getByRole("list", { name: "Agents" }).textContent).toBe("Claude2Codex1");
    expect(within(sidebar()).getByRole("list", { name: "Projects" }).textContent).toBe("atlas1realm1");
    expect(within(sidebar()).getByRole("switch", { name: "One-shot calls" })).not.toBeChecked();
    expect(within(sidebar()).getByRole("switch", { name: "Sub-agents" })).not.toBeChecked();
  });

  it("says on a row whose it was, who drove it, what was measured and that it started sub-agents", async () => {
    await mount();
    const [deploy, teams, notes] = rows();
    expect(deploy!.querySelector(".lib-row-line")!.textContent).toBe("atlas · Claude");
    expect(deploy!.querySelector(".lib-row-foot")!.textContent).toBe("4 turns · 12 tool calls2h");
    expect(deploy!.querySelector(".lib-row-copies")!.textContent).toBe("2");
    expect(teams!.querySelector(".lib-row-line")!.textContent).toBe("realm · Codex in Realm");
    expect(teams!.querySelector(".lib-row-foot")!.textContent).toBe("1d");
    expect(teams!.querySelector(".lib-row-copies")).toBeNull();
    expect(notes!.querySelector(".lib-row-line")!.textContent).toBe("~/notes · Claude");
  });

  it("adds the one-shot calls and the sub-agents when their switches are turned on", async () => {
    const server = await mount();
    fireEvent.click(within(sidebar()).getByRole("switch", { name: "One-shot calls" }));
    await screen.findByRole("option", { name: /Write a title for this chat/ });
    expect(server.lastList().filter!.origins).toEqual(["person", "app", "one-shot"]);
    expect(screen.getByRole("option", { name: /Write a title/ }).textContent).toContain("One-shot");

    fireEvent.click(within(sidebar()).getByRole("switch", { name: "Sub-agents" }));
    await screen.findByRole("option", { name: /Find the failing step/ });
    expect(server.lastList().filter!.origins).toEqual(["person", "app", "one-shot", "sub-agent"]);
    expect(rows()).toHaveLength(6);

    fireEvent.click(within(sidebar()).getByRole("switch", { name: "One-shot calls" }));
    await waitFor(() => expect(rows()).toHaveLength(5));
    expect(server.lastList().filter!.origins).toEqual(["person", "app", "sub-agent"]);
  });

  it("narrows to an agent or a project from the sidebar", async () => {
    const server = await mount();
    fireEvent.click(navRow(/Codex/));
    await waitFor(() => expect(titles()).toEqual(["Plan the teams tab"]));
    expect(server.lastList().filter).toEqual({ agent: "codex", origins: ["person", "app"] });
    expect(within(list()).getByRole("heading", { level: 1 }).textContent).toBe("Codex");

    fireEvent.click(navRow(/atlas/));
    await waitFor(() => expect(titles()).toEqual(["Fix the deploy script"]));
    expect(server.lastList().filter).toEqual({ projectId: "p-atlas", origins: ["person", "app"] });
    expect(within(list()).getByRole("heading", { level: 1 }).textContent).toBe("atlas");
  });

  it("sends the words typed to the server once the typing has paused", async () => {
    const server = await mount();
    fireEvent.change(search(), { target: { value: "te" } });
    fireEvent.change(search(), { target: { value: " teams tab " } });
    expect(server.asked("sessions.list")).toHaveLength(1);
    await waitFor(() => expect(titles()).toEqual(["Plan the teams tab"]));
    expect(server.asked("sessions.list").map((c) => c.params.filter!.query)).toEqual([undefined, "teams tab"]);

    fireEvent.change(search(), { target: { value: "zzz" } });
    await screen.findByText("Nothing matches");
  });

  it("loads the next 200 on request, until the list holds every match", async () => {
    const many = Array.from({ length: 450 }, (_, at) => session({ id: `s-${at}`, title: at === 0 ? "Fix the deploy script" : `Session ${at}`, endedAt: Date.now() - at * HOUR }));
    const server = await mount({ held: many });
    expect(rows()).toHaveLength(200);
    expect(within(list()).getByText("200 of 450")).toBeTruthy();

    fireEvent.click(within(list()).getByRole("button", { name: "Show the next 200" }));
    await waitFor(() => expect(rows()).toHaveLength(400));
    expect(server.lastList()).toEqual({ filter: { origins: ["person", "app"] }, limit: 200, offset: 200 });

    fireEvent.click(within(list()).getByRole("button", { name: "Show the next 50" }));
    await waitFor(() => expect(rows()).toHaveLength(450));
    expect(within(list()).queryByRole("button", { name: /Show the next/ })).toBeNull();
  });

  it("says the index is being built, how far it has got, and reads the list again when listing ends", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const server = fakeSessionsServer({
      held: [],
      statuses: [
        { state: "listing", files: 4115, listed: 1204, measured: 0, pausedWhy: null },
        { state: "measuring", files: 4115, listed: 4115, measured: 300, pausedWhy: null },
        { state: "paused", files: 4115, listed: 4115, measured: 300, pausedWhy: "on battery" },
        IDLE,
      ],
    });
    render(<Section rpc={server.rpc} />);
    await screen.findByText("Building the index");
    expect(screen.queryByText("No sessions")).toBeNull();
    expect(within(list()).getByText("Listing 1,204 of 4,115")).toBeTruthy();
    expect(server.asked("sessions.list")).toHaveLength(1);

    server.index.held = EVERY;
    await act(() => vi.advanceTimersByTimeAsync(2000));
    await screen.findByRole("option", { name: /Fix the deploy script/ });
    expect(within(list()).getByText("Measuring 300 of 4,115")).toBeTruthy();
    expect(server.asked("sessions.list")).toHaveLength(2);
    expect(server.asked("sessions.facets")).toHaveLength(2);
    expect(navRow(/All conversations/).textContent).toBe("All conversations3");

    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(within(list()).getByText("Paused: on battery")).toBeTruthy();
    expect(server.asked("sessions.list")).toHaveLength(2);

    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(list().querySelector(".ses-status")).toBeNull();
    expect(server.asked("sessions.status")).toHaveLength(4);
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(server.asked("sessions.status")).toHaveLength(4);
  });

  it("says so when no agent has kept a transcript, and when only what is left out is there", async () => {
    const none = fakeSessionsServer({ held: [] });
    const { unmount } = render(<Section rpc={none.rpc} />);
    await screen.findByText("No sessions");
    expect(screen.getByText("No agent on this Mac has kept a transcript.")).toBeTruthy();
    unmount();

    const calls = fakeSessionsServer({ held: [TITLE_CALL] });
    render(<Section rpc={calls.rpc} />);
    await screen.findByText("No conversations here");
  });

  it("says why when the sessions cannot be read", async () => {
    const server = fakeSessionsServer({ failing: { "sessions.list": "the index is locked" } });
    render(<Section rpc={server.rpc} />);
    await screen.findByText("The sessions could not be read");
    expect(screen.getByText("the index is locked")).toBeTruthy();
  });
});

describe("the reader", () => {
  it("opens a session to where and when it ran, what was measured, and its first stretch", async () => {
    const reveal = vi.fn(async () => {});
    window.amc = { port: 0, token: "", reveal, dragOut: vi.fn(), share: vi.fn(async () => {}), appearance: { choice: { appearance: "system", accent: "system" }, systemAccent: "#007aff" }, chooseAppearance: async () => {}, onSystemAccent: () => () => {} };
    const server = await mount();
    expect(within(reader()).getByText("Pick a session")).toBeTruthy();
    await open(/Fix the deploy script/);

    expect(within(reader()).getByRole("heading", { name: "Fix the deploy script", level: 2 })).toBeTruthy();
    const [where, measured] = [...reader().querySelectorAll(".lib-reader-where")].map((p) => p.textContent);
    expect(where).toBe("atlas · ~/work/atlas · claude-opus-4 · Started 3h ago · Ran 1h 0m · 48 KB");
    expect(measured).toBe("4 turns · 12 tool calls · 1 failed · 182K tokens in · 9K out · $0.42");
    expect(server.asked("sessions.read")[0]!.params).toEqual({ id: "s-deploy", cursor: undefined, limit: 120 });

    expect(reader().querySelector(".ses-user")!.textContent).toContain("Why does the deploy fail?");
    const prose = reader().querySelector(".ses-assistant .md")!;
    expect(prose.querySelector("strong")!.textContent).toBe("step two");
    expect(prose.querySelector(".md-code pre")!.textContent).toBe("pnpm build\n");
    expect(reader().querySelector(".ses-note")!.textContent).toBe("CompactedThe conversation so far was summarised.");

    fireEvent.click(within(reader()).getByRole("button", { name: "Show in Finder" }));
    expect(reveal).toHaveBeenCalledWith("/home/.claude/projects/atlas/s-deploy.jsonl");
  });

  it("keeps thinking folded shut until it is opened", async () => {
    await mount();
    await open(/Fix the deploy script/);
    expect(within(reader()).queryByText("The script exits before the build step.")).toBeNull();
    const thinking = within(reader()).getByRole("button", { name: "Thinking" });
    expect(thinking).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(thinking);
    expect(within(reader()).getByText("The script exits before the build step.")).toBeTruthy();
    fireEvent.click(thinking);
    expect(within(reader()).queryByText("The script exits before the build step.")).toBeNull();
  });

  it("loads the next stretch through the cursor, under the first", async () => {
    const server = await mount();
    await open(/Fix the deploy script/);
    const firstProse = reader().querySelector(".ses-assistant")!;
    fireEvent.click(within(reader()).getByRole("button", { name: "Load more" }));
    await within(reader()).findByText("The script is fixed.");
    expect(server.asked("sessions.read")[1]!.params).toEqual({ id: "s-deploy", cursor: "block-7", limit: 120 });
    expect(reader().querySelectorAll(".ses-assistant")).toHaveLength(2);
    expect(reader().querySelector(".ses-assistant")).toBe(firstProse);
    expect(within(reader()).queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("loads the next stretch when the reader is scrolled near the end, once", async () => {
    const server = await mount();
    await open(/Fix the deploy script/);
    const scroller = reader().querySelector(".lib-reader-scroll")!;
    fireEvent.scroll(scroller);
    fireEvent.scroll(scroller);
    await within(reader()).findByText("The script is fixed.");
    fireEvent.scroll(scroller);
    expect(server.asked("sessions.read")).toHaveLength(2);
  });

  it("shows a tool call as one folded row that opens to what it was called with and what came back", async () => {
    await mount();
    await open(/Fix the deploy script/);
    const bash = within(reader()).getByRole("button", { name: /^Bash/ });
    expect(bash.textContent).toBe("Bashpnpm build");
    expect(within(reader()).queryByText("built in 4s")).toBeNull();

    fireEvent.click(bash);
    const [input, output] = [...bash.parentElement!.querySelectorAll("pre")].map((pre) => pre.textContent);
    expect(input).toBe("pnpm build\n--filter web");
    expect(output).toBe("built in 4s");
    expect(within(bash.parentElement!).getByText("It answered")).toBeTruthy();

    fireEvent.click(bash);
    expect(within(reader()).queryByText("built in 4s")).toBeNull();
  });

  it("marks a call that failed, and says when the transcript holds no result", async () => {
    await mount();
    await open(/Fix the deploy script/);
    const read = within(reader()).getByRole("button", { name: /^Read/ });
    expect(within(read).getByText("Failed")).toBeTruthy();
    expect(within(within(reader()).getByRole("button", { name: /^Bash/ })).queryByText("Failed")).toBeNull();
    fireEvent.click(read);
    expect(within(read.parentElement!).getByText("It failed with")).toBeTruthy();
    expect(within(read.parentElement!).getByText("ENOENT: no such file")).toBeTruthy();

    const task = within(reader()).getByRole("button", { name: /^Task/ });
    fireEvent.click(task);
    expect(within(task.parentElement!).getByText("The transcript holds no result for this call.")).toBeTruthy();
  });

  it("says how much was left out wherever a text was cut", async () => {
    await mount();
    await open(/Fix the deploy script/);
    expect(within(reader().querySelector<HTMLElement>(".ses-user")!).getByText("1,200 more characters are not shown.")).toBeTruthy();
    expect(reader().querySelectorAll(".ses-cut")).toHaveLength(1);

    const bash = within(reader()).getByRole("button", { name: /^Bash/ });
    fireEvent.click(bash);
    expect(within(bash.parentElement!).getByText("5,300 more characters are not shown.")).toBeTruthy();
    const read = within(reader()).getByRole("button", { name: /^Read/ });
    fireEvent.click(read);
    expect(within(read.parentElement!).getByText("40 more characters are not shown.")).toBeTruthy();
  });

  it("lists a session's sub-agents, and goes back to the list it came from", async () => {
    const server = await mount();
    await open(/Fix the deploy script/);
    fireEvent.click(within(reader()).getByRole("button", { name: "2 sub-agents" }));
    await screen.findByRole("option", { name: /Find the failing step/ });
    expect(server.lastList().filter).toEqual({ parentId: "s-deploy", origins: ["sub-agent"] });
    expect(titles()).toEqual(["Find the failing step", "Read the release notes"]);
    expect(within(list()).getByRole("heading", { level: 1 }).textContent).toBe("Sub-agents of Fix the deploy script");
    expect(screen.queryByRole("searchbox")).toBeNull();

    fireEvent.click(screen.getByRole("option", { name: /Find the failing step/ }));
    await within(reader()).findByRole("heading", { name: "Find the failing step", level: 2 });
    expect(server.asked("sessions.read").at(-1)!.params.id).toBe("s-child-1");

    fireEvent.click(within(list()).getByRole("button", { name: "Back to the sessions" }));
    await waitFor(() => expect(titles()).toEqual(["Fix the deploy script", "Plan the teams tab", "Tidy the notes"]));
    expect(server.lastList().filter).toEqual({ origins: ["person", "app"] });
    expect(within(reader()).getByRole("heading", { name: "Find the failing step", level: 2 })).toBeTruthy();
  });

  it("shows what a session had loaded: a file to open in the library, one that has changed, and that it was worked out", async () => {
    const server = await mount();
    await open(/Fix the deploy script/);
    expect(server.asked("sessions.context")).toHaveLength(0);
    fireEvent.click(within(reader()).getByRole("radio", { name: "Context" }));
    await within(reader()).findByText("18,204 characters were in context before the person's first word.");
    expect(server.asked("sessions.context")[0]!.params).toEqual({ id: "s-deploy" });
    expect(within(reader()).getByText(/worked out from where the session ran/)).toBeTruthy();

    const [instructions, memory] = within(within(reader()).getByRole("list", { name: "Files in context" })).getAllByRole("listitem");
    expect(instructions!.textContent).toBe("Instructions~/work/atlas/CLAUDE.md4,210 charactersChanged since this session read itOpen in the library");
    expect(memory!.textContent).toBe("Memory~/.claude/projects/atlas/memory/MEMORY.md900 characters");
    fireEvent.click(within(instructions!).getByRole("button", { name: "Open in the library" }));
    expect(onOpenFile).toHaveBeenCalledWith("f-claude-md");

    server.index.context = { ...CONTEXT, recorded: true, files: [] };
    fireEvent.click(screen.getByRole("option", { name: /Tidy the notes/ }));
    await within(reader()).findByText("No file is known to have been loaded.");
    expect(within(reader()).queryByText(/worked out from where the session ran/)).toBeNull();
  });

  it("says why when a transcript or its context cannot be read", async () => {
    await mount({ failing: { "sessions.read": "the file is gone", "sessions.context": "no folder to look in" } });
    fireEvent.click(screen.getByRole("option", { name: /Fix the deploy script/ }));
    await within(reader()).findByText("The transcript could not be read");
    expect(within(reader()).getByText("the file is gone")).toBeTruthy();
    expect(within(reader()).getByRole("heading", { name: "Fix the deploy script", level: 2 })).toBeTruthy();

    fireEvent.click(within(reader()).getByRole("radio", { name: "Context" }));
    await within(reader()).findByText("The context could not be read");
    expect(within(reader()).getByText("no folder to look in")).toBeTruthy();
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

describe("handing a session to another app", () => {
  it("drags a row out as its transcript file, and shares the same file from the reader's bar", async () => {
    const { dragOut, share } = standInBridge();
    await mount();
    const row = screen.getByRole("option", { name: /Fix the deploy script/ });
    expect(fireEvent.dragStart(row, { dataTransfer: carrier() })).toBe(false);
    expect(dragOut.mock.calls).toEqual([["/home/.claude/projects/atlas/s-deploy.jsonl"]]);
    await open(/Fix the deploy script/);
    fireEvent.click(within(reader()).getByRole("button", { name: "Share" }));
    expect(share).toHaveBeenCalledWith({ path: "/home/.claude/projects/atlas/s-deploy.jsonl" }, { x: 0, y: 6 });
  });
});
