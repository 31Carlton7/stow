import type { SessionBlock } from "@amc/contracts";
import { parseCutJson } from "./cut-json";
import type { Line } from "./lines";

/** How much of a spoken text a block carries, and how much of what a tool was given or gave back. */
export const TEXT_MAX = 20_000;
export const TOOL_TEXT_MAX = 8_000;

/** What a tool call gave back, on its way to the call it answers. */
export type ToolResult = { resultFor: string; output: string; outputCut: number; failed: boolean };

/** One thing a record holds: a block, with the id a later result will name when it is a tool call, or a result. */
export type Piece = { block: SessionBlock; callId?: string } | ToolResult;

/** What a transcript says of itself, filled in as its records are read. */
export type Facts = {
  sessionId: string | null;
  cwd: string | null;
  /** Who started it, in the file's own word: Claude's `entrypoint`, Codex's `originator`. */
  startedBy: string | null;
  /** Codex's `source` when it is a word: `exec`, `cli`, `vscode`. */
  source: string | null;
  /** The file says another session started this one, and which when it says. */
  subAgent: boolean;
  parentId: string | null;
  model: string | null;
  startedAt: number | null;
  /** The agent's own title, the latest it wrote. */
  title: string | null;
  assistantTurns: number;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
};

export const noFacts = (): Facts => ({
  sessionId: null, cwd: null, startedBy: null, source: null, subAgent: false, parentId: null, model: null,
  startedAt: null, title: null, assistantTurns: 0, inputTokens: null, outputTokens: null, costUsd: null,
});

/** One agent's transcript format: lines in, pieces out, with what the file says of itself kept beside. */
export type Reading = { facts: Facts; feed: (line: Line) => Piece[] };

export const str = (v: unknown): string => (typeof v === "string" ? v : "");
export const rec = (v: unknown): Record<string, unknown> => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** A line as a record, or null when it is not one. A line the reader cut is read as far as it goes. */
export function recordOf(line: Line): Record<string, unknown> | null {
  if (line.skipped > 0) {
    const start = parseCutJson(line.text);
    return start !== null && typeof start === "object" && !Array.isArray(start) ? (start as Record<string, unknown>) : null;
  }
  try {
    const whole: unknown = JSON.parse(line.text);
    return whole !== null && typeof whole === "object" && !Array.isArray(whole) ? (whole as Record<string, unknown>) : null;
  } catch { return null; }
}

/** ISO-8601 or epoch seconds or milliseconds, as epoch milliseconds. */
export function toMs(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v > 1e12 ? v : v * 1000;
  if (typeof v === "string") { const t = Date.parse(v); if (!Number.isNaN(t)) return t; }
  return null;
}

export function clip(text: string, max: number): { text: string; cut: number } {
  return text.length <= max ? { text, cut: 0 } : { text: text.slice(0, max), cut: text.length - max };
}

export const spoken = (kind: "user" | "thinking", at: number | null, text: string): Piece => ({ block: { kind, at, ...clip(text, TEXT_MAX) } });
export const said = (at: number | null, text: string, model: string | null): Piece => ({ block: { kind: "assistant", at, model, ...clip(text, TEXT_MAX) } });
export const note = (at: number | null, label: string, text: string): Piece => ({ block: { kind: "note", at, label, ...clip(text, TEXT_MAX) } });

export function toolCall(at: number | null, name: string, given: unknown, callId: string): Piece {
  const input = clip(typeof given === "string" ? given : JSON.stringify(given ?? {}), TOOL_TEXT_MAX);
  return { block: { kind: "tool", at, name: name || "tool", input: input.text, inputCut: input.cut, output: null, outputCut: 0, failed: false }, ...(callId ? { callId } : {}) };
}

export function toolResult(resultFor: string, text: string, failed: boolean): ToolResult {
  const output = clip(text, TOOL_TEXT_MAX);
  return { resultFor, output: output.text, outputCut: output.cut, failed };
}

/**
 * A line the reader cut lost the end of the last text it holds. Its bytes are added to that text's
 * count of what was left out, so a window can say the text goes on. Bytes, where the rest of the
 * count is characters: the characters were never read.
 */
export function withSkipped(pieces: Piece[], skipped: number): Piece[] {
  const last = pieces.at(-1);
  if (skipped === 0 || !last) return pieces;
  if ("resultFor" in last) last.outputCut += skipped;
  else if (last.block.kind === "tool") last.block.inputCut += skipped;
  else last.block.cut += skipped;
  return pieces;
}

/** The harness tag a text opens with, or null: `<task-notification>` gives `task-notification`. */
function openingTag(text: string): string | null {
  const head = text.trimStart().split("\n", 1)[0]!.trim();
  const tag = /^<\/?([a-z][a-z0-9_-]*)>/i.exec(head);
  if (!tag) return null;
  // A line that is nothing but a tag is an envelope whatever the tag is called. When the line goes
  // on, a hyphen or underscore in the name means a harness made it up: HTML's own names have neither,
  // which keeps "explain what <div> does" a person's words.
  return head === tag[0] || /[-_]/.test(tag[1]!) ? tag[1]! : null;
}

/**
 * What injected a text that arrived where a person's words do, or null when a person wrote it. An
 * agent's harness wraps what it puts in the user's place in a tag of its own (`<task-notification>`,
 * `<environment_context>`, `<local-command-caveat>`), and Claude heads the files a person mentioned
 * with a fixed line.
 */
export function injectedBy(text: string): string | null {
  if (text.trimStart().startsWith("# Files mentioned by the user:")) return "Files mentioned";
  const tag = openingTag(text);
  return tag === null ? null : sentence(tag);
}

/** `task-notification` as `Task notification`. */
export function sentence(word: string): string {
  const spaced = word.replace(/[-_]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** A text's first line with anything in it, cut to what a list row shows. */
export function firstLine(text: string, max = 120): string {
  const line = text.split("\n").find((l) => l.trim() !== "")?.trim() ?? "";
  return line.length <= max ? line : `${line.slice(0, max - 1).trimEnd()}…`;
}
