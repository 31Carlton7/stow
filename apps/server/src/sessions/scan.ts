import { closeSync, openSync } from "node:fs";
import type { SessionAgent } from "@amc/contracts";
import { claudeReading } from "./claude";
import { codexReading } from "./codex";
import { LineReader } from "./lines";
import { firstLine, type Facts, type Reading } from "./transcript";

export const readingFor = (agent: SessionAgent): Reading => (agent === "claude" ? claudeReading() : codexReading());

/**
 * One pass over a transcript that counts what it holds without keeping any of it. It is read a
 * stretch at a time, so the first look can stop after a file's head and the second can let other
 * work in between stretches of a file hundreds of megabytes long.
 */
export class Scan {
  readonly facts: Facts;
  /** The first thing the person's side said, cut to a line. */
  firstAsked: string | null = null;
  userTurns = 0;
  toolCalls = 0;
  toolErrors = 0;
  private readonly reading: Reading;
  private readonly fd: number;
  private readonly lines: LineReader;

  constructor(path: string, agent: SessionAgent) {
    this.reading = readingFor(agent);
    this.facts = this.reading.facts;
    this.fd = openSync(path, "r");
    this.lines = new LineReader(this.fd);
  }

  /**
   * Read on through about `bytes` more of the file. False once the file has ended. No line counts
   * for more than `lineCharge`: a Codex file opens with one line of a few hundred kilobytes, and a
   * first look that stopped there would learn nothing of the session.
   */
  step(bytes: number, lineCharge = Infinity): boolean {
    for (let read = 0; read < bytes;) {
      const line = this.lines.next();
      if (line === null) return false;
      read += Math.min(line.end - line.start, lineCharge);
      for (const piece of this.reading.feed(line)) {
        if ("resultFor" in piece) { if (piece.failed) this.toolErrors++; continue; }
        if (piece.block.kind === "tool") this.toolCalls++;
        if (piece.block.kind !== "user") continue;
        this.userTurns++;
        this.firstAsked ??= firstLine(piece.block.text) || null;
      }
    }
    return true;
  }

  close(): void { closeSync(this.fd); }
}
