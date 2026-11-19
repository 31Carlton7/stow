import { describe, expect, it } from "vitest";
import { claudeReading } from "./claude";
import type { Line } from "./lines";
import type { Piece } from "./transcript";

const lineOf = (record: unknown, skipped = 0): Line => {
  const text = typeof record === "string" ? record : JSON.stringify(record);
  return { text, start: 0, end: text.length + 1, skipped, ended: true };
};

const AT = "2026-03-02T09:00:00.000Z";
const at = Date.parse(AT);
const user = (content: unknown, more: object = {}) => ({ type: "user", message: { role: "user", content }, timestamp: AT, sessionId: "s1", cwd: "/work/atlas", entrypoint: "cli", ...more });
const assistant = (id: string, content: unknown[], usage: object = { input_tokens: 10, output_tokens: 5 }) =>
  ({ type: "assistant", message: { id, role: "assistant", model: "claude-test-1", content, usage }, timestamp: AT, sessionId: "s1" });

function read(records: unknown[]): { pieces: Piece[]; facts: ReturnType<typeof claudeReading>["facts"] } {
  const reading = claudeReading();
  return { pieces: records.flatMap((record) => reading.feed(lineOf(record))), facts: reading.facts };
}

describe("a Claude transcript", () => {
  it("reads what was asked and what was answered", () => {
    const { pieces, facts } = read([
      user("Tag the release"),
      assistant("m1", [{ type: "thinking", thinking: "The tag comes first." }, { type: "text", text: "Tagged." }]),
    ]);
    expect(pieces).toEqual([
      { block: { kind: "user", at, text: "Tag the release", cut: 0 } },
      { block: { kind: "thinking", at, text: "The tag comes first.", cut: 0 } },
      { block: { kind: "assistant", at, text: "Tagged.", cut: 0, model: "claude-test-1" } },
    ]);
    expect(facts).toMatchObject({ sessionId: "s1", cwd: "/work/atlas", startedBy: "cli", model: "claude-test-1", startedAt: at, subAgent: false });
  });

  it("reads a tool call, and its result as a piece that names the call", () => {
    const { pieces } = read([
      assistant("m1", [{ type: "tool_use", id: "call-1", name: "Bash", input: { command: "git tag v2" } }]),
      user([{ type: "tool_result", tool_use_id: "call-1", content: [{ type: "text", text: "tagged v2" }, { type: "image" }] }]),
    ]);
    expect(pieces).toEqual([
      { block: { kind: "tool", at, name: "Bash", input: '{"command":"git tag v2"}', inputCut: 0, output: null, outputCut: 0, failed: false }, callId: "call-1" },
      { resultFor: "call-1", output: "tagged v2\n[image]", outputCut: 0, failed: false },
    ]);
  });

  it("marks the result of a tool that failed", () => {
    const { pieces } = read([user([{ type: "tool_result", tool_use_id: "call-2", content: "fatal: tag exists", is_error: true }])]);
    expect(pieces).toEqual([{ resultFor: "call-2", output: "fatal: tag exists", outputCut: 0, failed: true }]);
  });

  it("shows text put in the person's place as a note, never as their words", () => {
    // THE MUTANT: every `user` record is the person, and a hook's output reads as something they typed.
    const { pieces } = read([
      user("<task-notification>\nThe build finished.\n</task-notification>"),
      user("Summary of the session so far.", { isCompactSummary: true }),
      user("Run the nightly check.", { turnOrigin: "scheduled" }),
      user([{ type: "text", text: "Caveat for the model." }], { isMeta: true }),
      user("explain what <div> does"),
    ]);
    expect(pieces.map((piece) => "block" in piece && [piece.block.kind, piece.block.kind === "note" ? piece.block.label : null])).toEqual([
      ["note", "Task notification"], ["note", "Compaction summary"], ["note", "Scheduled prompt"], ["note", "Injected"], ["user", null],
    ]);
  });

  it("counts one API message written as several records once", () => {
    const { facts } = read([
      assistant("m1", [{ type: "thinking", thinking: "Hm." }], { input_tokens: 10, cache_read_input_tokens: 90, output_tokens: 2 }),
      assistant("m1", [{ type: "text", text: "Done." }], { input_tokens: 10, cache_read_input_tokens: 90, output_tokens: 7 }),
      assistant("m2", [{ type: "text", text: "And again." }], { input_tokens: 20, output_tokens: 3 }),
    ]);
    expect(facts).toMatchObject({ assistantTurns: 2, inputTokens: 120, outputTokens: 10 });
  });

  it("takes the title the person gave over the one Claude wrote, and the last cost written", () => {
    const { facts } = read([
      { type: "ai-title", aiTitle: "Tagging a release" },
      { type: "cost-state", totalCostUSD: 0.1 },
      { type: "custom-title", customTitle: "Release day" },
      { type: "ai-title", aiTitle: "Tagging the second release" },
      { type: "cost-state", totalCostUSD: 0.25 },
    ]);
    expect(facts).toMatchObject({ title: "Release day", costUsd: 0.25 });
  });

  it("passes over the bookkeeping records and a line that is not JSON", () => {
    const { pieces } = read([
      '{"type":"api-request","body":"not even closed',
      { type: "session-owner", pid: 1 }, { type: "queue-operation", operation: "enqueue" }, { type: "file-history-snapshot", snapshot: {} },
      "not json",
    ]);
    expect(pieces).toEqual([]);
  });

  it("shows a hook's added context and a compaction as notes", () => {
    const { pieces } = read([
      { type: "attachment", timestamp: AT, attachment: { type: "hook_additional_context", hookEvent: "SessionStart", content: ["Use pnpm."] } },
      { type: "system", subtype: "compact_boundary", content: "Conversation compacted", timestamp: AT },
      { type: "attachment", timestamp: AT, attachment: { type: "queued_command", commandMode: "prompt", prompt: "Also bump the version", origin: { kind: "human" } } },
    ]);
    expect(pieces).toEqual([
      { block: { kind: "note", at, label: "Hook · SessionStart", text: "Use pnpm.", cut: 0 } },
      { block: { kind: "note", at, label: "Compaction", text: "Conversation compacted", cut: 0 } },
      { block: { kind: "user", at, text: "Also bump the version", cut: 0 } },
    ]);
  });

  it("reads a record the line reader cut as far as it goes, and says how much is missing", () => {
    const whole = JSON.stringify(user("The log follows. " + "x".repeat(200)));
    const reading = claudeReading();
    const [piece] = reading.feed(lineOf(whole.slice(0, 80), 5_000));
    expect(piece).toMatchObject({ block: { kind: "user", cut: 5_000 } });
    expect("block" in piece! && piece.block.kind === "user" && piece.block.text.startsWith("The log follows.")).toBe(true);
  });
});
