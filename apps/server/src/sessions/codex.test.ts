import { describe, expect, it } from "vitest";
import { codexReading } from "./codex";
import type { Line } from "./lines";
import type { Piece } from "./transcript";

const lineOf = (record: unknown): Line => {
  const text = JSON.stringify(record);
  return { text, start: 0, end: text.length + 1, skipped: 0, ended: true };
};

const AT = "2026-03-02T09:00:00.000Z";
const at = Date.parse(AT);
const item = (payload: object) => ({ timestamp: AT, type: "response_item", payload });
const meta = (payload: object) => ({ timestamp: AT, type: "session_meta", payload: { id: "thread-1", cwd: "/work/beacon", originator: "codex-tui", timestamp: AT, ...payload } });

function read(records: unknown[]): { pieces: Piece[]; facts: ReturnType<typeof codexReading>["facts"] } {
  const reading = codexReading();
  return { pieces: records.flatMap((record) => reading.feed(lineOf(record))), facts: reading.facts };
}

describe("a Codex transcript", () => {
  it("reads what was asked and answered, and shows what Codex sent in the person's role as a note", () => {
    const { pieces, facts } = read([
      meta({ source: "cli" }),
      { timestamp: AT, type: "turn_context", payload: { model: "gpt-test-1", cwd: "/work/beacon" } },
      item({ type: "message", role: "developer", content: [{ type: "input_text", text: "Follow the house rules." }] }),
      item({ type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context>\n<cwd>/work/beacon</cwd>\n</environment_context>" }] }),
      item({ type: "message", role: "user", content: [{ type: "input_text", text: "Why is the beacon dark?" }] }),
      item({ type: "reasoning", summary: [{ type: "summary_text", text: "Check the power first." }], encrypted_content: "zzz" }),
      item({ type: "message", role: "assistant", content: [{ type: "output_text", text: "The fuse blew." }] }),
    ]);
    expect(pieces).toEqual([
      { block: { kind: "note", at, label: "Instructions", text: "Follow the house rules.", cut: 0 } },
      { block: { kind: "note", at, label: "Environment context", text: "<environment_context>\n<cwd>/work/beacon</cwd>\n</environment_context>", cut: 0 } },
      { block: { kind: "user", at, text: "Why is the beacon dark?", cut: 0 } },
      { block: { kind: "thinking", at, text: "Check the power first.", cut: 0 } },
      { block: { kind: "assistant", at, text: "The fuse blew.", cut: 0, model: "gpt-test-1" } },
    ]);
    expect(facts).toMatchObject({ sessionId: "thread-1", cwd: "/work/beacon", startedBy: "codex-tui", source: "cli", model: "gpt-test-1", assistantTurns: 1, subAgent: false });
  });

  it("reads both kinds of tool call, and a result as a piece that names the call", () => {
    const { pieces } = read([
      item({ type: "function_call", name: "shell", arguments: '{"command":["ls"]}', call_id: "call-1" }),
      item({ type: "function_call_output", call_id: "call-1", output: "Exit code: 0\nWall time: 0.1 seconds\nOutput:\nfuse.txt" }),
      item({ type: "custom_tool_call", name: "apply_patch", input: "*** Begin Patch", call_id: "call-2" }),
      item({ type: "custom_tool_call_output", call_id: "call-2", output: [{ type: "input_text", text: "Done" }] }),
    ]);
    expect(pieces).toEqual([
      { block: { kind: "tool", at, name: "shell", input: '{"command":["ls"]}', inputCut: 0, output: null, outputCut: 0, failed: false }, callId: "call-1" },
      { resultFor: "call-1", output: "Exit code: 0\nWall time: 0.1 seconds\nOutput:\nfuse.txt", outputCut: 0, failed: false },
      { block: { kind: "tool", at, name: "apply_patch", input: "*** Begin Patch", inputCut: 0, output: null, outputCut: 0, failed: false }, callId: "call-2" },
      { resultFor: "call-2", output: "Done", outputCut: 0, failed: false },
    ]);
  });

  it("takes a command that exited non-zero for a failed tool", () => {
    const { pieces } = read([
      item({ type: "function_call_output", call_id: "a", output: "Process exited with code 2\nOutput:\nno such file" }),
      item({ type: "function_call_output", call_id: "b", output: '{"output":"boom","metadata":{"exit_code":1}}' }),
    ]);
    expect(pieces.map((piece) => "resultFor" in piece && piece.failed)).toEqual([true, true]);
  });

  it("knows a sub-agent and the thread that started it", () => {
    const { facts } = read([meta({ source: { subagent: { thread_spawn: { parent_thread_id: "thread-0", depth: 1 } } } })]);
    expect(facts).toMatchObject({ subAgent: true, parentId: "thread-0", source: null });
  });

  it("keeps the first session_meta when a resumed thread appends another", () => {
    const { facts } = read([meta({}), meta({ id: "thread-9", originator: "codex_exec" })]);
    expect(facts).toMatchObject({ sessionId: "thread-1", startedBy: "codex-tui" });
  });

  it("takes the running token count's last total, and notes an interrupted turn", () => {
    const count = (input: number, output: number) => ({ timestamp: AT, type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: input, output_tokens: output } } } });
    const { pieces, facts } = read([count(100, 10), count(250, 40), { timestamp: AT, type: "event_msg", payload: { type: "turn_aborted", reason: "interrupted" } }]);
    expect(facts).toMatchObject({ inputTokens: 250, outputTokens: 40 });
    expect(pieces).toEqual([{ block: { kind: "note", at, label: "Interrupted", text: "interrupted", cut: 0 } }]);
  });
});
