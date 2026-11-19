import { closeSync, openSync } from "node:fs";
import type { SessionAgent, SessionBlock } from "@amc/contracts";
import { RpcError } from "../rpc/error";
import { LineReader } from "./lines";
import { readingFor } from "./scan";

/** How many lines past a stretch's end are read for the results of the tool calls it left open. */
const RESULT_LINES = 400;
/** How many of a Codex file's first lines are read for the model before a later stretch: it is named once, near the top. */
const MODEL_LINES = 40;

type ToolBlock = Extract<SessionBlock, { kind: "tool" }>;

/**
 * A stretch of a transcript's blocks, in file order, starting where the last one stopped.
 *
 * The cursor is `<byte>.<n>`: the byte the line holding the next block starts at, and how many of
 * that line's blocks were already given, since one record can hold several. Nothing else is carried
 * between calls. A tool call near a stretch's end would lose its result to the next stretch, so the
 * lines after the end are read on, for results only, until every open call has one. The next stretch
 * reads those lines again and passes over the results, which then answer no call it holds.
 */
export function readStretch(path: string, agent: SessionAgent, cursor: string | undefined, limit: number): { blocks: SessionBlock[]; next: string | null } {
  const from = /^(\d+)\.(\d+)$/.exec(cursor ?? "0.0");
  if (!from) throw new RpcError("SESSION_CURSOR", "that is not a cursor this server gave");
  const offset = Number(from[1]);
  const alreadyGiven = Number(from[2]);

  const reading = readingFor(agent);
  const fd = openSync(path, "r");
  try {
    if (agent === "codex" && offset > 0) {
      const top = new LineReader(fd);
      for (let n = 0; n < MODEL_LINES && reading.facts.model === null; n++) {
        const line = top.next();
        if (line === null || line.start >= offset) break;
        reading.feed(line);
      }
    }
    const lines = new LineReader(fd, offset);
    const blocks: SessionBlock[] = [];
    const open = new Map<string, ToolBlock>();
    let next: string | null = null;
    for (let past = 0; ;) {
      const line = lines.next();
      // A last line with no newline is still being written.
      if (line === null || !line.ended) break;
      let nth = 0;
      for (const piece of reading.feed(line)) {
        if ("resultFor" in piece) {
          const call = open.get(piece.resultFor);
          if (call) Object.assign(call, { output: piece.output, outputCut: piece.outputCut, failed: piece.failed });
          open.delete(piece.resultFor);
          continue;
        }
        if (next !== null) continue;
        if (line.start === offset && nth < alreadyGiven) { nth++; continue; }
        if (blocks.length === limit) { next = `${line.start}.${nth}`; continue; }
        blocks.push(piece.block);
        if (piece.block.kind === "tool" && piece.callId) open.set(piece.callId, piece.block);
        nth++;
      }
      if (next !== null && (open.size === 0 || ++past >= RESULT_LINES)) break;
    }
    return { blocks, next };
  } finally { closeSync(fd); }
}
