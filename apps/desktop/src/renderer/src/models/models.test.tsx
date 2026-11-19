import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ModelCall, ModelsStatus, OfferedModel, PassScope, RunnerId, RunnerProbe, RunnerStatus } from "@amc/contracts";
import { Toasts } from "../components/Toasts";
import { clearToasts } from "../toasts";
import { ModelsPage, type ModelsPane } from "./ModelsPage";
import { useModels, type ModelsRpc } from "./use-models";

afterEach(() => { act(() => { clearToasts(); }); });

const SIGNED_IN: RunnerProbe = { installed: true, version: "2.1.322", signedIn: true, plan: "max" };
const runner = (id: RunnerId, probe: RunnerProbe = SIGNED_IN): RunnerStatus => ({
  runner: id, probe, settings: { allowed: false, models: id === "claude" ? { scan: "claude-haiku-5-5", write: "claude-opus-5-5" } : { scan: "gpt-6-luna", write: "gpt-6.1-sol" } },
});

/** A models server in memory: the runners' switches, what a reading would send, and the ledger. */
function fakeModelsServer({ runners = [runner("claude"), runner("codex")], ledger = [], offered = {} }: { runners?: RunnerStatus[]; ledger?: ModelCall[]; offered?: Partial<Record<RunnerId, OfferedModel[]>> } = {}) {
  const status: ModelsStatus = { runners, spentTodayUsd: 0, dailyCapUsd: 1 };
  const scope: PassScope = {
    sources: [{ id: "repo", label: "Realm · Sam's memory", files: 9, chars: 27_000, neverSend: false }, { id: "claude-projects", label: "Claude · Project memory", files: 4, chars: 9_000, neverSend: false }],
    files: 13, chars: 36_000, calls: 2, withheld: 1,
  };
  const calls: { method: string; params: unknown }[] = [];
  const of = (id: RunnerId) => status.runners.find((r) => r.runner === id)!;
  const answers: Record<string, (params: never) => unknown> = {
    "models.status": () => structuredClone(status),
    "review.passScope": () => structuredClone(scope),
    "models.ledger": () => ({ calls: ledger }),
    "models.offered": ({ runner: id }: { runner: RunnerId }) => ({ models: offered[id] ?? null }),
    "models.setAllowed": ({ runner: id, allowed }: { runner: RunnerId; allowed: boolean }) => { of(id).settings.allowed = allowed; return of(id).settings; },
    "models.setModel": ({ runner: id, tier, model }: { runner: RunnerId; tier: "scan" | "write"; model: string }) => { of(id).settings.models[tier] = model; return of(id).settings; },
    "models.setDailyCap": ({ usd }: { usd: number }) => { status.dailyCapUsd = usd; return { dailyCapUsd: usd }; },
    "models.test": ({ runner: id }: { runner: RunnerId }) => {
      if (id === "codex") throw new Error("Codex is signed out.");
      return { model: "claude-haiku-5-5", output: { ok: true }, inputTokens: 1840, outputTokens: 12, costUsd: 0.002, durationMs: 3400 };
    },
    "review.setNeverSend": ({ sourceId, neverSend }: { sourceId: string; neverSend: boolean }) => {
      const source = scope.sources.find((s) => s.id === sourceId)!;
      source.neverSend = neverSend;
      scope.files = scope.sources.filter((s) => !s.neverSend).reduce((sum, s) => sum + s.files, 0);
      return {};
    },
  };
  const rpc = {
    call: async (method: string, params: unknown) => {
      calls.push({ method, params });
      const answer = answers[method];
      if (!answer) throw new Error(`no answer for ${method}`);
      return answer(params as never);
    },
  } as unknown as ModelsRpc;
  return { rpc, sent: (method: string) => calls.filter((c) => c.method === method).map((c) => c.params) };
}

function Page({ rpc, pane }: { rpc: ModelsRpc; pane: ModelsPane }) {
  return <><ModelsPage models={useModels(rpc)} pane={pane} /><Toasts /></>;
}

async function mount(options?: Parameters<typeof fakeModelsServer>[0], pane: ModelsPane = "models") {
  const server = fakeModelsServer(options);
  render(<Page rpc={server.rpc} pane={pane} />);
  await screen.findByRole("heading", { level: 1 });
  return server;
}

const card = (name: string) => screen.getByRole("article", { name });
const allow = (name: string) => within(card(name)).getByRole("switch") as HTMLInputElement;
const testButton = (name: string) => within(card(name)).getByRole("button", { name: /^Test/ }) as HTMLButtonElement;

describe("the model settings", () => {
  it("offers each tool's own list of models to pick from, and sends the one picked", async () => {
    const server = await mount({ offered: { claude: [{ id: "claude-opus-5-5", label: "Opus 5.5" }, { id: "claude-sonnet-5-5", label: "Sonnet 5.5" }] } });
    const reads = await within(card("Claude")).findByRole("combobox", { name: "Reads the library" }) as HTMLSelectElement;
    // The model in use is not one the tool lists, so it stays, under its id, ahead of the tool's own.
    expect([...reads.options].map((o) => o.text)).toEqual(["claude-haiku-5-5", "Opus 5.5", "Sonnet 5.5"]);
    expect(reads.value).toBe("claude-haiku-5-5");
    const writes = within(card("Claude")).getByRole("combobox", { name: "Writes a fix" }) as HTMLSelectElement;
    expect([...writes.options].map((o) => o.text)).toEqual(["Opus 5.5", "Sonnet 5.5"]);

    fireEvent.change(writes, { target: { value: "claude-sonnet-5-5" } });
    await vi.waitFor(() => expect(server.sent("models.setModel")).toEqual([{ runner: "claude", tier: "write", model: "claude-sonnet-5-5" }]));
    await vi.waitFor(() => expect((within(card("Claude")).getByRole("combobox", { name: "Writes a fix" }) as HTMLSelectElement).value).toBe("claude-sonnet-5-5"));
    // Codex would not say what it offers, so its models are still typed in.
    expect(within(card("Codex")).getByRole("textbox", { name: "Reads the library" })).toBeTruthy();
  });

  it("starts with every runner off and nothing to press that would make a call", async () => {
    const server = await mount();
    expect(allow("Claude").checked).toBe(false);
    expect(allow("Codex").checked).toBe(false);
    expect(testButton("Claude").disabled).toBe(true);
    expect(within(card("Claude")).getByText("Signed in on the max plan.")).toBeTruthy();
    expect(within(card("Claude")).getByText("2.1.322")).toBeTruthy();
    expect(within(card("Claude")).getByText("Runs with no tools and no saved session.")).toBeTruthy();
    expect(within(card("Codex")).getByText(/^Runs read-only with commands off\./)).toBeTruthy();
    expect(server.sent("models.test")).toEqual([]);
  });

  it("allows a runner only by its own switch, and tests it only after that", async () => {
    const server = await mount();
    fireEvent.click(allow("Claude"));
    await vi.waitFor(() => expect(allow("Claude").checked).toBe(true));
    expect(server.sent("models.setAllowed")).toEqual([{ runner: "claude", allowed: true }]);
    expect(allow("Codex").checked).toBe(false);

    fireEvent.click(testButton("Claude"));
    await within(card("Claude")).findByText("claude-haiku-5-5 answered in 3.4 s: 1840 tokens in, 12 out, under a cent.");
    expect(server.sent("models.test")).toEqual([{ runner: "claude" }]);
  });

  it("says why a test did not answer, beside the button", async () => {
    await mount();
    fireEvent.click(allow("Codex"));
    await vi.waitFor(() => expect(testButton("Codex").disabled).toBe(false));
    fireEvent.click(testButton("Codex"));
    await within(card("Codex")).findByText("Codex is signed out.");
  });

  it("will not switch on a runner that is not there to run", async () => {
    await mount({ runners: [runner("claude", { installed: false, version: null, signedIn: null, plan: null }), runner("codex", { installed: true, version: "0.169.0", signedIn: false, plan: null })] });
    expect(allow("Claude").disabled).toBe(true);
    expect(within(card("Claude")).getByText("The claude command is not installed on this Mac.")).toBeTruthy();
    expect(allow("Codex").disabled).toBe(true);
    expect(within(card("Codex")).getByText("Signed out. Sign in from a terminal, then come back.")).toBeTruthy();
  });

  it("sends a model's name when the field is left, not on each key", async () => {
    const server = await mount();
    const field = within(card("Claude")).getByLabelText("Reads the library") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "claude-sonnet-5-5" } });
    expect(server.sent("models.setModel")).toEqual([]);
    fireEvent.blur(field);
    await vi.waitFor(() => expect(server.sent("models.setModel")).toEqual([{ runner: "claude", tier: "scan", model: "claude-sonnet-5-5" }]));
    await vi.waitFor(() => expect(server.sent("models.status")).toHaveLength(2)); // the page read again, with the name the server kept

    fireEvent.change(field, { target: { value: "  " } });
    fireEvent.blur(field);
    await vi.waitFor(() => expect(field.value).toBe("claude-sonnet-5-5"));
    expect(server.sent("models.setModel")).toHaveLength(1);
  });

  it("keeps a daily limit that is a number, and ignores one that is not", async () => {
    const server = await mount();
    const field = screen.getByLabelText("Stop for the day at (US dollars)") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "lots" } });
    fireEvent.blur(field);
    expect(server.sent("models.setDailyCap")).toEqual([]);
    fireEvent.change(field, { target: { value: "2.5" } });
    fireEvent.blur(field);
    await vi.waitFor(() => expect(server.sent("models.setDailyCap")).toEqual([{ usd: 2.5 }]));
  });

  it("gives each card the same parts in the same order, whatever each says", async () => {
    await mount();
    const parts = (name: string) => [...card(name).children].map((part) => part.className);
    expect(parts("Claude")).toEqual(["models-card-head", "models-card-said", "models-fields", "models-test"]);
    expect(parts("Codex")).toEqual(parts("Claude"));
  });

  it("takes a source out of what a reading sends, and says what is held back", async () => {
    const server = await mount(undefined, "sent");
    expect(screen.getByText(/^13 files in 2 calls\..*1 file is held back for looking like it holds a credential\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: "Send Claude · Project memory to a model" }));
    await screen.findByText(/^9 files in 2 calls\./);
    expect(server.sent("review.setNeverSend")).toEqual([{ sourceId: "claude-projects", neverSend: true }]);
    expect((screen.getByRole("switch", { name: "Send Claude · Project memory to a model" }) as HTMLInputElement).checked).toBe(false);
  });

  it("says so when no call has been made", async () => {
    await mount(undefined, "activity");
    expect(screen.getByText("No call has been made.")).toBeTruthy();
  });

  it("lists each call with what it carried and how it came out", async () => {
    const call = (over: Partial<ModelCall>): ModelCall => ({
      id: 1, ts: Date.UTC(2026, 10, 18, 9, 30), runner: "claude", model: "claude-haiku-5-5", tier: "scan", purpose: "scan", sent: ["~/memory/a.md", "~/memory/b.md"],
      promptChars: 4000, inputTokens: 2000, outputTokens: 150, costUsd: 0.004, apiEquivalentUsd: 0.004, durationMs: 5000, ok: true, error: null, ...over,
    });
    await mount({ ledger: [call({}), call({ id: 2, ok: false, error: "Refused: the daily limit is reached.", sent: [], inputTokens: null, outputTokens: null, apiEquivalentUsd: 0 })] }, "activity");
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText("2,150")).toBeTruthy();
    expect(within(rows[0]!).getByText("Reading the library")).toBeTruthy();
    expect(within(rows[0]!).getByText("Answered")).toBeTruthy();
    const carried = rows[0]!.querySelectorAll("td")[3]!;
    expect([carried.textContent, carried.title]).toEqual(["2", "~/memory/a.md\n~/memory/b.md"]);
    expect(within(rows[1]!).getByText("Refused: the daily limit is reached.")).toBeTruthy();
  });
});
