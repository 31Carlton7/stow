import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { HealthPass, HealthSummary } from "@amc/contracts";
import { HealthPage } from "./HealthPage";
import { useHealth, type HealthRpc } from "./use-health";

afterEach(() => { vi.useRealTimers(); });

const IDLE: HealthPass = { state: "idle", sessions: 40, read: 40, pausedWhy: null };
const MEASURED: HealthSummary = {
  pass: IDLE,
  carried: [
    { agent: "claude", sessions: 30, empty: 2, recorded: true, chars: 48_000, kinds: [{ kind: "instructions", chars: 20_000 }, { kind: "memory", chars: 12_000 }, { kind: "skills", chars: 16_000 }] },
    { agent: "codex", sessions: 8, empty: 0, recorded: false, chars: 6_000, kinds: [{ kind: "instructions", chars: 6_000 }] },
  ],
  contributors: [
    { agent: "claude", kind: "skills", label: "64 skills", libraryId: null, chars: 16_000, sessions: 30 },
    { agent: "claude", kind: "memory", label: "~/.claude/projects/-work-atlas/memory/MEMORY.md", libraryId: "claude-projects:atlas/MEMORY.md", chars: 12_000, sessions: 22 },
  ],
  reach: { findings: 5, files: 7, chars: 9_400, sessions: 22, widest: [{ fingerprint: "aaaaaaaaaaaaaaaa", type: "oversized-index", title: "MEMORY.md is too long to load whole", sessions: 22 }] },
  fixes: { ready: 3, filesRemoved: 2, filesChanged: 1, bytesFreed: 5 * 1024 * 1024, perSession: [{ agent: "claude", chars: 2_000 }, { agent: "codex", chars: 0 }] },
  storage: [
    { kind: "memory", files: 120, bytes: 600 * 1024 },
    { kind: "skills", files: 300, bytes: 4 * 1024 ** 2 },
    { kind: "conversations", files: 900, bytes: 3 * 1024 ** 3 },
    { kind: "one-shot", files: 7000, bytes: 9.5 * 1024 ** 3 },
    { kind: "sub-agents", files: 400, bytes: 512 * 1024 ** 2 },
  ],
};
const NOTHING: HealthSummary = {
  pass: { state: "idle", sessions: 0, read: 0, pausedWhy: null }, carried: [], contributors: [],
  reach: { findings: 0, files: 0, chars: 0, sessions: 0, widest: [] },
  fixes: { ready: 0, filesRemoved: 0, filesChanged: 0, bytesFreed: 0, perSession: [] },
  storage: MEASURED.storage.map((kept) => ({ ...kept, files: 0, bytes: 0 })),
};

/** A health server in memory: it answers with each summary in turn, then keeps giving the last, and with each status the same way. */
function fakeHealthServer(summaries: HealthSummary[], statuses: HealthPass[] = []) {
  const asked: string[] = [];
  const rpc = {
    call: async (method: string) => {
      asked.push(method);
      if (method === "health.summary") return summaries.length > 1 ? summaries.shift() : summaries[0];
      if (method === "health.status") return statuses.length > 1 ? statuses.shift() : statuses[0];
      throw new Error(`no answer for ${method}`);
    },
  } as unknown as HealthRpc;
  return { rpc, asked };
}

const went = { file: vi.fn(), finding: vi.fn(), ready: vi.fn() };
function Page({ rpc }: { rpc: HealthRpc }) {
  return <HealthPage health={useHealth(rpc)} onOpenFile={went.file} onOpenFinding={went.finding} onReviewReady={went.ready} />;
}
const section = (name: string) => screen.getByRole("list", { name });

describe("the Health page", () => {
  it("says what each agent's session loads in words and numbers beside the chart, and where the numbers are from", async () => {
    render(<Page rpc={fakeHealthServer([MEASURED]).rpc} />);
    const stacks = await screen.findByRole("list", { name: "Characters loaded per session, by agent" });
    expect(within(stacks).getByText("about 12,000 tokens")).toBeTruthy();
    expect(within(stacks).getByText("about 1,500 tokens")).toBeTruthy();
    expect(within(stacks).getByRole("img", { name: "Instructions 20,000 characters, Memory 12,000 characters, Skills list 16,000 characters" })).toBeTruthy();
    // The stack's parts are in the table under it, so nothing is read off a colour.
    const memory = screen.getByRole("row", { name: /^Memory/ });
    expect(within(memory).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["Memory", "12,000", "0"]);
    expect(screen.getByText(/Claude: from what 30 transcripts recorded loading\. 2 sessions loaded nothing and are left out/)).toBeTruthy();
    expect(screen.getByText(/Codex: worked out from the AGENTS\.md files as they are today/)).toBeTruthy();
  });

  it("opens a file that sessions loaded in the library, and leaves what is no file as a name", async () => {
    render(<Page rpc={fakeHealthServer([MEASURED]).rpc} />);
    const most = await screen.findByRole("list", { name: "What sessions loaded, heaviest first" });
    expect(within(most).queryByRole("button", { name: "64 skills" })).toBeNull();
    fireEvent.click(within(most).getByRole("button", { name: /MEMORY\.md$/ }));
    expect(went.file).toHaveBeenCalledWith("claude-projects:atlas/MEMORY.md");
  });

  it("says how far the findings reach without saying they hurt, and opens one", async () => {
    render(<Page rpc={fakeHealthServer([MEASURED]).rpc} />);
    expect(await screen.findByText(/Review holds 5 findings about 7 files \(9,400 characters\)\. 22 of the last 40 conversations loaded at least one/)).toBeTruthy();
    expect(screen.getByText(/It does not say any session went worse for it/)).toBeTruthy();
    fireEvent.click(within(section("Findings by how many recent sessions loaded their files")).getByRole("button", { name: "MEMORY.md is too long to load whole" }));
    expect(went.finding).toHaveBeenCalledWith("aaaaaaaaaaaaaaaa");
  });

  it("says what the ready fixes would change, and goes to them", async () => {
    render(<Page rpc={fakeHealthServer([MEASURED]).rpc} />);
    expect(await screen.findByText(/Approving the 3 ready fixes would remove 2 files, change 1 and free 5\.0 MB\. A Claude session would load 2,000 characters fewer on average \(about 500 tokens\)\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Review the 3 ready fixes" }));
    expect(went.ready).toHaveBeenCalled();
  });

  it("says so when the fixes would make a session load more, as putting memories back in an index does", async () => {
    // THE MUTANT: a negative saving is dropped, and the page says no session loaded a file the fixes change.
    const longer: HealthSummary = { ...MEASURED, fixes: { ...MEASURED.fixes, perSession: [{ agent: "claude", chars: -724 }] } };
    render(<Page rpc={fakeHealthServer([longer]).rpc} />);
    expect(await screen.findByText(/A Claude session would load 724 characters more on average \(about 181 tokens\)\./)).toBeTruthy();
  });

  it("gives storage in megabytes and gigabytes, and offers no way to delete a transcript", async () => {
    render(<Page rpc={fakeHealthServer([MEASURED]).rpc} />);
    const kept = await screen.findByRole("list", { name: "Kept on disk, by kind" });
    expect(within(kept).getAllByRole("listitem").map((row) => row.textContent)).toEqual([
      "Memory and instructions0.6 MB120 files", "Skills4.0 MB300 files", "Conversations3.00 GB900 files", "One-shot calls9.50 GB7,000 files", "Sub-agents512.0 MB400 files",
    ]);
    expect(screen.getByText(/This app does not delete transcripts/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /delete|remove/i })).toBeNull();
  });

  it("says so plainly when there is nothing to measure", async () => {
    render(<Page rpc={fakeHealthServer([NOTHING]).rpc} />);
    expect(await screen.findByText("No conversation has been indexed yet.")).toBeTruthy();
    expect(screen.getByText("Review holds no findings.")).toBeTruthy();
    expect(screen.getByText("No fix is ready to approve.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Review the/ })).toBeNull();
  });

  it("shows how far the reading has got while it runs, and reads the numbers again when it is done", async () => {
    vi.useFakeTimers();
    const reading = (read: number, more: Partial<HealthPass> = {}): HealthPass => ({ state: "reading", sessions: 40, read, pausedWhy: null, ...more });
    const server = fakeHealthServer(
      [{ ...NOTHING, pass: reading(10) }, MEASURED],
      [reading(25, { state: "paused", pausedWhy: "on battery" }), IDLE],
    );
    render(<Page rpc={server.rpc} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByRole("status").textContent).toContain("Reading what recent sessions loaded: 10 of 40.");
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(screen.getByRole("status").textContent).toContain("Waiting to read what recent sessions loaded (on battery): 25 of 40 read.");
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("list", { name: "Characters loaded per session, by agent" })).toBeTruthy();
    expect(server.asked).toEqual(["health.summary", "health.status", "health.status", "health.summary"]);
  });

  it("says why when the measures cannot be read", async () => {
    const rpc = { call: async () => { throw new Error("The index is locked."); } } as unknown as HealthRpc;
    render(<Page rpc={rpc} />);
    expect((await screen.findByRole("status")).textContent).toContain("The index is locked.");
  });
});
