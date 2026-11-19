import { readSync } from "node:fs";

/** The most of one line that is ever held. Transcripts here reach 735 MB with single lines over 2 MB. */
export const LINE_MAX = 64 * 1024;

export type Line = {
  /** The line, or its first `LINE_MAX` bytes. */
  text: string;
  /** Where the line starts in the file, and where the line after it does. */
  start: number;
  end: number;
  /** How many of the line's bytes were past the limit and not kept. */
  skipped: number;
  /** False for a last line with no newline yet: its writer may be half way through it. */
  ended: boolean;
};

/**
 * A file's lines from a byte offset, one at a time. A line longer than `LINE_MAX` keeps its start
 * and the rest is passed over to the newline, so memory stays at two 64 KB buffers whatever the file
 * holds.
 */
export class LineReader {
  private readonly chunk = Buffer.allocUnsafe(LINE_MAX);
  private readonly kept = Buffer.allocUnsafe(LINE_MAX);
  private filled = 0;
  private at = 0;
  private offset: number;

  constructor(private fd: number, from = 0) { this.offset = from; }

  next(): Line | null {
    const start = this.offset;
    let keptBytes = 0;
    for (;;) {
      if (this.at === this.filled) {
        this.filled = readSync(this.fd, this.chunk, 0, LINE_MAX, this.offset);
        this.at = 0;
        if (this.filled === 0) return this.offset === start ? null : this.line(start, keptBytes, false);
      }
      const newline = this.chunk.subarray(this.at, this.filled).indexOf(10);
      const stop = newline === -1 ? this.filled : this.at + newline;
      const taken = Math.min(stop - this.at, LINE_MAX - keptBytes);
      this.chunk.copy(this.kept, keptBytes, this.at, this.at + taken);
      keptBytes += taken;
      this.offset += stop - this.at;
      this.at = stop;
      if (newline === -1) continue;
      this.at++;
      this.offset++;
      return this.line(start, keptBytes, true);
    }
  }

  private line(start: number, keptBytes: number, ended: boolean): Line {
    const length = this.offset - start - (ended ? 1 : 0);
    let bytes = keptBytes;
    if (length > keptBytes) {
      // The cut can land inside a character: drop its bytes rather than decode half of it.
      while (bytes > 0 && (this.kept[bytes - 1]! & 0xc0) === 0x80) bytes--;
      if (bytes > 0 && this.kept[bytes - 1]! >= 0xc0) bytes--;
    }
    return { text: this.kept.toString("utf8", 0, bytes), start, end: this.offset, skipped: length - keptBytes, ended };
  }
}
