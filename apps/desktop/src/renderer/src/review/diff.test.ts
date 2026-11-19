import { describe, expect, it } from "vitest";
import { diffLines, fileDiff, hunkEmphasis, pairEmphasis, splitLines, toHunks } from "./diff";

/** A diff as a compact string, one line per row: `+`/`-`/` ` then the text. Comparing these rather
 *  than object literals keeps the expectations readable as the diffs they describe. */
const shape = (lines: { kind: string; text: string }[]) =>
  lines.map((l) => `${l.kind === "add" ? "+" : l.kind === "del" ? "-" : " "}${l.text}`).join("\n");

describe("splitLines", () => {
  it("counts lines the way a diff does: empty is nothing, a trailing newline invents nothing", () => {
    expect(splitLines("")).toEqual([]);
    expect(splitLines("a")).toEqual(["a"]);
    expect(splitLines("a\nb")).toEqual(["a", "b"]);
    expect(splitLines("a\nb\n")).toEqual(["a", "b"]);
    expect(splitLines("\n")).toEqual([""]);
  });
});

describe("diffLines", () => {
  it("keeps unchanged lines as context and marks only what moved", () => {
    expect(shape(diffLines("one\ntwo\nthree", "one\nTWO\nthree"))).toBe(" one\n-two\n+TWO\n three");
  });

  it("numbers each side independently — a deletion advances the old side only", () => {
    const lines = diffLines("a\nb\nc", "a\nc");
    expect(lines.map((l) => [l.kind, l.oldNo, l.newNo])).toEqual([
      ["ctx", 1, 1], ["del", 2, null], ["ctx", 3, 2],
    ]);
  });

  it("an empty side is a pure insertion or a pure deletion", () => {
    expect(shape(diffLines("", "x\ny"))).toBe("+x\n+y");
    expect(shape(diffLines("x\ny", ""))).toBe("-x\n-y");
    expect(diffLines("same", "same")).toEqual([{ kind: "ctx", text: "same", oldNo: 1, newNo: 1 }]);
  });

  it("finds the common subsequence rather than replacing wholesale", () => {
    // The shared `keep` lines must survive as context; a naive prefix/suffix diff would delete and
    // re-add them, and the card would claim a five-line change where one line moved.
    expect(shape(diffLines("keep1\nold\nkeep2", "keep1\nnew\nkeep2"))).toBe(" keep1\n-old\n+new\n keep2");
    expect(shape(diffLines("a\nb\nc\nd", "a\nc"))).toBe(" a\n-b\n c\n-d");
  });
});

describe("toHunks", () => {
  const lines = (n: number) => Array.from({ length: n }, (_, i) => `l${i + 1}`).join("\n");

  it("keeps three lines of context either side and elides the rest, counting what it elided", () => {
    const hunks = toHunks(diffLines(lines(30), lines(30).replace("l15", "CHANGED")));
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.skipped).toBe(11); // lines 1..11 before the l12 context line
    expect(shape(hunks[0]!.lines)).toBe(" l12\n l13\n l14\n-l15\n+CHANGED\n l16\n l17\n l18");
  });

  it("changes closer together than two context spans stay ONE hunk", () => {
    const after = lines(30).replace("l10", "X").replace("l14", "Y");
    expect(toHunks(diffLines(lines(30), after))).toHaveLength(1);
  });

  it("changes further apart split, and the second hunk reports the gap", () => {
    const after = lines(40).replace("l5", "X").replace("l30", "Y");
    const hunks = toHunks(diffLines(lines(40), after));
    expect(hunks).toHaveLength(2);
    expect(hunks[0]!.skipped).toBe(1);
    expect(hunks[1]!.skipped).toBe(18); // l9..l26 between the two context windows
  });

  it("a diff with no changes has no hunks at all", () => {
    expect(toHunks(diffLines("a\nb", "a\nb"))).toEqual([]);
  });
});

describe("intra-line emphasis", () => {

  it("declines when the two lines share too little to be one line edited", () => {
    expect(pairEmphasis("completely different", "nothing alike here")).toBeNull();
    expect(pairEmphasis("same", "same")).toBeNull();
  });

  it("only pairs a lone deletion with the lone insertion that follows it", () => {
    const paired = hunkEmphasis(diffLines("const a = 1;", "const a = 2;"));
    expect([...paired.keys()]).toEqual([0, 1]);
    // Two-for-two has no line-to-line correspondence to draw, so nothing is marked.
    expect(hunkEmphasis(diffLines("aaa\nbbb", "xxx\nyyy")).size).toBe(0);
  });
});

describe("fileDiff", () => {
  it("counts add and del off the hunks it kept, so the header and the body cannot disagree", () => {
    const f = fileDiff("/x", "a\nb\nc", "a\nB\nc\nd");
    expect([f.add, f.del]).toEqual([2, 1]);
    expect(f.hunks.reduce((n, h) => n + h.lines.filter((l) => l.kind === "add").length, 0)).toBe(f.add);
  });
});
