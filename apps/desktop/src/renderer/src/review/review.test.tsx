import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { AppliedFix, Finding, ModelsStatus, PassScope, PassStatus, ProposedChange, RunnerStatus } from "@amc/contracts";
import { Toasts } from "../components/Toasts";
import { clearToasts } from "../toasts";
import { ReviewDetail } from "./ReviewDetail";
import { ReviewList } from "./ReviewList";
import { ReviewSidebar } from "./ReviewSidebar";
import { useReview, type ReviewRpc } from "./use-review";

afterEach(() => { act(() => { clearToasts(); }); });

const finding = (over: Partial<Finding> & Pick<Finding, "fingerprint" | "title">): Finding => ({
  type: "broken-link", severity: "medium", detail: "Missing: missing-note.", subjects: [{ id: "repo:MEMORY.md", label: "Index", displayPath: "~/memory/MEMORY.md" }],
  fix: "Remove 1 line from the index.", judgedBy: null, needsDraft: false, ...over,
});
const DEAD_LINK = finding({ fingerprint: "a".repeat(16), title: "Index links to 1 file that is not there" });
const CONFLICT = finding({ fingerprint: "b".repeat(16), type: "mcp-conflict", title: "The search MCP server is set up 2 ways", fix: null,
  subjects: [{ id: null, label: "Claude Code: npx search", displayPath: "~/.claude.json" }, { id: null, label: "Codex: npx search@2", displayPath: "~/.codex/config.toml" }] });
const MERGE = finding({ fingerprint: "c".repeat(16), type: "merge", severity: "low", title: "2 memories say how Atlas ships", fix: "Keep one memory with what both say.",
  judgedBy: "claude-haiku-5-5", needsDraft: true });

const CHANGE: ProposedChange = { id: "repo:MEMORY.md", label: "Index", displayPath: "~/memory/MEMORY.md", before: "- [[team]]\n- [[missing-note]]\n", after: "- [[team]]\n", removal: null };
const IDLE: PassStatus = { running: false, runner: null, model: null, finishedAt: null, calls: 0, callsDone: 0, callsFailed: 0, found: 0, dropped: 0, spentUsd: 0, error: null };
const SCOPE: PassScope = { sources: [{ id: "repo", label: "Realm · Sam's memory", files: 12, chars: 36_000, neverSend: false }], files: 12, chars: 36_000, calls: 2, withheld: 0 };
const runner = (id: RunnerStatus["runner"], allowed: boolean): RunnerStatus => ({
  runner: id, probe: { installed: true, version: "1.0.0", signedIn: true, plan: null },
  settings: { allowed, models: id === "claude" ? { scan: "claude-haiku-5-5", write: "claude-opus-5-5" } : { scan: "gpt-6-luna", write: "gpt-6.1-sol" } },
});

/** A review server in memory: what a scan finds, what has been applied, and every call it was sent. */
function fakeReviewServer({ findings, allowed = [] }: { findings: Finding[]; allowed?: RunnerStatus["runner"][] }) {
  let found = [...findings];
  let rejected = 0;
  const applied: AppliedFix[] = [];
  const models: ModelsStatus = { runners: [runner("claude", allowed.includes("claude")), runner("codex", allowed.includes("codex"))], spentTodayUsd: 0, dailyCapUsd: 1 };
  const calls: { method: string; params: unknown }[] = [];
  const answers: Record<string, (params: never) => unknown> = {
    "review.scan": () => ({ findings: found, rejected }),
    "review.history": () => ({ applied: [...applied].reverse() }),
    "review.passStatus": () => IDLE,
    "review.passScope": () => SCOPE,
    "models.status": () => structuredClone(models),
    "review.proposal": () => ({ changes: [CHANGE] }),
    "review.approve": ({ fingerprint }: { fingerprint: string }) => {
      const fixed = found.find((f) => f.fingerprint === fingerprint)!;
      found = found.filter((f) => f !== fixed);
      const fix: AppliedFix = { id: applied.length + 1, fingerprint, type: fixed.type, title: fixed.title, at: Date.now(), undoneAt: null };
      applied.push(fix);
      return fix;
    },
    "review.undo": ({ id }: { id: number }) => {
      const fix = applied.find((f) => f.id === id)!;
      fix.undoneAt = Date.now();
      found = [...findings];
      return fix;
    },
    "review.reject": ({ fingerprint }: { fingerprint: string }) => { found = found.filter((f) => f.fingerprint !== fingerprint); rejected += 1; return {}; },
    "review.startPass": () => ({ ...IDLE, running: true, runner: "claude", model: "claude-haiku-5-5", calls: 2 }),
    "review.draft": () => ({ changes: [CHANGE] }),
  };
  const rpc = {
    call: async (method: string, params: unknown) => {
      calls.push({ method, params });
      const answer = answers[method];
      if (!answer) throw new Error(`no answer for ${method}`);
      return answer(params as never);
    },
  } as unknown as ReviewRpc;
  return {
    rpc, sent: (method: string) => calls.filter((c) => c.method === method).map((c) => c.params),
    /** What the Models page does when a runner's switch is turned on. */
    allow(id: RunnerStatus["runner"]): void { models.runners.find((r) => r.runner === id)!.settings.allowed = true; },
  };
}

function Inbox({ rpc, onOpenFile, onOpenModels }: { rpc: ReviewRpc; onOpenFile: (id: string) => void; onOpenModels: () => void }) {
  const review = useReview(rpc);
  return (
    <>
      <ReviewSidebar review={review} health={{ shown: false, show: () => {} }} />
      <button type="button" onClick={() => void review.refresh()}>Come back to the inbox</button>
      <ReviewList review={review} onOpenModels={onOpenModels} />
      <ReviewDetail review={review} onOpenFile={onOpenFile} onOpenModels={onOpenModels} />
      <Toasts />
    </>
  );
}

async function mount(options: Parameters<typeof fakeReviewServer>[0]) {
  const server = fakeReviewServer(options);
  const onOpenFile = vi.fn<(id: string) => void>();
  const onOpenModels = vi.fn<() => void>();
  render(<Inbox rpc={server.rpc} onOpenFile={onOpenFile} onOpenModels={onOpenModels} />);
  await screen.findByRole("list", { name: "Findings" });
  return { ...server, onOpenFile, onOpenModels };
}

const sidebar = () => screen.getByRole("navigation", { name: "Review" });
const list = () => screen.getByRole("region", { name: "Findings" });
const detail = () => screen.getByRole("region", { name: "Finding" });
const rowTitled = (title: string) => within(list()).getByText(title).closest("button")!;
const titles = () => [...list().querySelectorAll(".rev-row-title")].map((el) => el.textContent);

describe("the review inbox", () => {
  it("lists what a scan found under how serious it is, and counts each kind in the sidebar", async () => {
    await mount({ findings: [DEAD_LINK, CONFLICT, MERGE] });
    expect(within(list()).getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Worth a look", "Tidying"]);
    expect(titles()).toEqual([DEAD_LINK.title, CONFLICT.title, MERGE.title]);
    expect(within(sidebar()).getByRole("button", { name: /All findings/ }).textContent).toContain("3");
    expect(within(sidebar()).getByRole("button", { name: /Fix ready/ }).textContent).toContain("1");
    expect(rowTitled(MERGE.title).textContent).toContain("a model's reading");
  });

  it("narrows the list to the sidebar's row", async () => {
    await mount({ findings: [DEAD_LINK, CONFLICT, MERGE] });
    fireEvent.click(within(sidebar()).getByRole("button", { name: /Fix ready/ }));
    expect(titles()).toEqual([DEAD_LINK.title]);
    fireEvent.click(within(sidebar()).getByRole("button", { name: /MCP server defined two ways/ }));
    expect(titles()).toEqual([CONFLICT.title]);
  });

  it("shows the change before anything is approved, and sends nothing until Approve is pressed", async () => {
    const server = await mount({ findings: [DEAD_LINK, CONFLICT] });
    fireEvent.click(rowTitled(DEAD_LINK.title));
    expect(within(detail()).getByText("Remove 1 line from the index.")).toBeTruthy();
    const approve = within(detail()).getByRole("button", { name: "Approve" });
    expect((approve as HTMLButtonElement).disabled).toBe(true); // until the change itself is on screen
    await within(detail()).findByText("- [[missing-note]]");
    expect(server.sent("review.approve")).toEqual([]);

    fireEvent.click(approve);
    await screen.findByText(`Fixed: ${DEAD_LINK.title}`);
    expect(server.sent("review.approve")).toEqual([{ fingerprint: DEAD_LINK.fingerprint }]);
    expect(titles()).toEqual([CONFLICT.title]);
  });

  it("undoes a fix from the applied list, and takes down the receipt that offered the same Undo", async () => {
    const server = await mount({ findings: [DEAD_LINK] });
    fireEvent.click(rowTitled(DEAD_LINK.title));
    await within(detail()).findByText("- [[missing-note]]");
    fireEvent.click(within(detail()).getByRole("button", { name: "Approve" }));
    await screen.findByText(`Fixed: ${DEAD_LINK.title}`);

    fireEvent.click(within(sidebar()).getByRole("button", { name: /Applied fixes/ }));
    fireEvent.click(await within(list()).findByRole("button", { name: "Undo" }));
    await screen.findByText("Undone. The files are as they were.");
    expect(server.sent("review.undo")).toEqual([{ id: 1 }]);
    expect(screen.queryByText(`Fixed: ${DEAD_LINK.title}`)).toBeNull();
    expect(within(list()).queryByRole("button", { name: "Undo" })).toBeNull();
    expect(within(list()).getByText(/^Undone/)).toBeTruthy();
  });

  it("offers no Approve where nothing can be done by rule, and does not raise what was turned down", async () => {
    const server = await mount({ findings: [DEAD_LINK, CONFLICT] });
    fireEvent.click(rowTitled(CONFLICT.title));
    expect(within(detail()).queryByRole("button", { name: "Approve" })).toBeNull();
    expect(within(detail()).getByRole("heading", { name: "What to do" })).toBeTruthy();
    expect(server.sent("review.proposal")).toEqual([]);

    fireEvent.click(within(detail()).getByRole("button", { name: "Not a problem" }));
    await vi.waitFor(() => expect(titles()).toEqual([DEAD_LINK.title]));
    expect(server.sent("review.reject")).toEqual([{ fingerprint: CONFLICT.fingerprint }]);
  });

  it("opens a finding's file in the library, and only a file the library holds", async () => {
    const server = await mount({ findings: [DEAD_LINK, CONFLICT] });
    fireEvent.click(rowTitled(DEAD_LINK.title));
    fireEvent.click(within(detail()).getByRole("button", { name: /Index/ }));
    expect(server.onOpenFile).toHaveBeenCalledWith("repo:MEMORY.md");
    fireEvent.click(rowTitled(CONFLICT.title));
    expect(within(detail()).queryByTitle("Open in the library")).toBeNull();
  });

  it("offers a model's reading only as something to turn on while no runner is allowed", async () => {
    const server = await mount({ findings: [MERGE] });
    expect(within(list()).queryByRole("button", { name: /Read now/ })).toBeNull();
    fireEvent.click(within(list()).getByRole("button", { name: "Open Models" }));
    expect(server.onOpenModels).toHaveBeenCalledTimes(1);

    fireEvent.click(rowTitled(MERGE.title));
    expect(within(detail()).queryByRole("button", { name: /Write the fix/ })).toBeNull();
    expect(within(detail()).getByRole("button", { name: "Turn a model on to write the fix" })).toBeTruthy();
    expect(server.sent("review.startPass")).toEqual([]);
    expect(server.sent("review.draft")).toEqual([]);
  });

  it("offers to read once a runner has been turned on elsewhere, without scanning again", async () => {
    const server = await mount({ findings: [MERGE] });
    server.allow("claude");
    expect(within(list()).queryByRole("button", { name: "Read now" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Come back to the inbox" }));
    await within(list()).findByRole("button", { name: "Read now" });
    expect(server.sent("review.scan")).toHaveLength(1);
  });

  it("says what a reading sends and to which model, and starts it only when asked", async () => {
    const server = await mount({ findings: [MERGE], allowed: ["claude"] });
    expect(within(list()).getByText(/A reading sends 12 files in 2 calls, about 18,000 tokens, to claude-haiku-5-5\./)).toBeTruthy();
    expect(server.sent("review.startPass")).toEqual([]);
    fireEvent.click(within(list()).getByRole("button", { name: "Read now" }));
    await within(list()).findByText("Reading with claude-haiku-5-5");
    expect(within(list()).getByText(/Call 1 of 2/)).toBeTruthy();
    expect(server.sent("review.startPass")).toEqual([{ runner: "claude" }]);
  });

  it("with both tools on, offers each under its own mark and asks the one picked", async () => {
    const server = await mount({ findings: [MERGE], allowed: ["claude", "codex"] });
    const tools = within(within(list()).getByRole("radiogroup", { name: "Ask" })).getAllByRole("radio") as HTMLInputElement[];
    expect(tools.map((tool) => [tool.parentElement!.textContent, tool.checked, tool.parentElement!.querySelector("svg") !== null])).toEqual([["Claude", true, true], ["Codex", false, true]]);
    fireEvent.click(tools[1]!);
    expect(within(list()).getByText(/to gpt-6-luna\./)).toBeTruthy();
    fireEvent.click(within(list()).getByRole("button", { name: "Read now" }));
    await vi.waitFor(() => expect(server.sent("review.startPass")).toEqual([{ runner: "codex" }]));
  });

  it("has the stronger model write a fix only when its button is pressed, and names the model on it", async () => {
    const server = await mount({ findings: [MERGE], allowed: ["claude"] });
    fireEvent.click(rowTitled(MERGE.title));
    expect(within(detail()).getByText(/This is claude-haiku-5-5's reading, not a rule/)).toBeTruthy();
    expect(within(detail()).queryByRole("button", { name: "Approve" })).toBeNull();
    fireEvent.click(within(detail()).getByRole("button", { name: "Write the fix with claude-opus-5-5" }));
    await vi.waitFor(() => expect(server.sent("review.draft")).toEqual([{ fingerprint: MERGE.fingerprint, runner: "claude" }]));
  });
});
