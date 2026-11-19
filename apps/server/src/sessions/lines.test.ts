import { closeSync, openSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir } from "@amc/test-utils";
import { LINE_MAX, LineReader, type Line } from "./lines";

function linesOf(bytes: string | Buffer, from = 0): Line[] {
  const file = join(tempDir("amc-lines-"), "lines.jsonl");
  writeFileSync(file, bytes);
  const fd = openSync(file, "r");
  try {
    const reader = new LineReader(fd, from);
    const read: Line[] = [];
    for (let line = reader.next(); line !== null; line = reader.next()) read.push(line);
    return read;
  } finally { closeSync(fd); }
}

describe("the line reader", () => {
  it("gives each line with where it starts and where the next one does", () => {
    expect(linesOf("one\ntwo\n\nfour\n")).toEqual([
      { text: "one", start: 0, end: 4, skipped: 0, ended: true },
      { text: "two", start: 4, end: 8, skipped: 0, ended: true },
      { text: "", start: 8, end: 9, skipped: 0, ended: true },
      { text: "four", start: 9, end: 14, skipped: 0, ended: true },
    ]);
  });

  it("marks a last line with no newline as not ended", () => {
    expect(linesOf("one\nhalf")[1]).toEqual({ text: "half", start: 4, end: 8, skipped: 0, ended: false });
  });

  it("starts from a byte offset", () => {
    expect(linesOf("one\ntwo\nthree\n", 4).map((line) => [line.text, line.start])).toEqual([["two", 4], ["three", 8]]);
  });

  it("keeps a line of exactly the limit whole", () => {
    const [full, after] = linesOf(`${"a".repeat(LINE_MAX)}\nnext\n`);
    expect(full).toMatchObject({ skipped: 0, start: 0, end: LINE_MAX + 1, ended: true });
    expect(full!.text).toHaveLength(LINE_MAX);
    expect(after).toMatchObject({ text: "next", start: LINE_MAX + 1 });
  });

  it("keeps the first 64 KB of a longer line and passes over the rest to the newline", () => {
    // THE MUTANT: the reader holds the whole line, and a 2 MB record is 2 MB of memory.
    const long = "b".repeat(LINE_MAX * 3 + 17);
    const [cut, after] = linesOf(`${long}\nnext\n`);
    expect(cut!.text).toBe("b".repeat(LINE_MAX));
    expect(cut).toMatchObject({ skipped: LINE_MAX * 2 + 17, end: long.length + 1, ended: true });
    expect(after).toMatchObject({ text: "next", start: long.length + 1, skipped: 0 });
  });

  it("does not decode half of a character the cut lands inside", () => {
    const [cut] = linesOf(`${"c".repeat(LINE_MAX - 1)}éééé\n`);
    expect(cut!.text).toBe("c".repeat(LINE_MAX - 1));
    expect(cut!.skipped).toBe(7);
  });
});
