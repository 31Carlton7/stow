/** Diff model behind a proposal's file cards: two whole texts in, the changed lines with their
 *  context out. Both sides are whole files, so every line carries the file's own number. */

export type LineKind = "add" | "del" | "ctx";
/** `oldNo`/`newNo` are the line's position on each side, or null for the side it is not on. */
export type DiffLine = { kind: LineKind; text: string; oldNo: number | null; newNo: number | null };
/** `skipped` is how many unchanged lines were elided immediately before this hunk (0 for the first
 *  hunk of a file, or when the hunks are adjacent). It is what the "⋯ 42 unchanged lines" rail says. */
export type DiffHunk = { lines: DiffLine[]; skipped: number };
export type FileDiff = {
  path: string;
  hunks: DiffHunk[];
  add: number;
  del: number;
};

/** Context lines kept either side of a change. Three is `git diff`'s default and the number every
 *  reader's eye is already calibrated to. */
export const CONTEXT = 3;

/** Above this many cells the LCS table is not worth building (a 2000×2000 diff is 4M cells and
 *  ~32MB of backpointers). Past it the middle section degrades to a straight replace, which is what
 *  a whole-file rewrite looks like anyway. */
const LCS_CELL_LIMIT = 4_000_000;

/** Lines the way a diff counts them: "" is zero lines, and a trailing newline does not invent one. */
export function splitLines(s: string): string[] {
  if (s === "") return [];
  const out = s.split("\n");
  if (out.length > 1 && out[out.length - 1] === "") out.pop();
  return out;
}

/** Longest-common-subsequence line diff, prefix/suffix-trimmed first.
 *
 *  Trimming is not just an optimisation: an Edit usually changes one line inside a fragment that is
 *  otherwise identical on both sides, and the trim alone reduces that to a table small enough that
 *  the cell limit never comes near. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = splitLines(before), b = splitLines(after);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const midA = a.slice(head, a.length - tail), midB = b.slice(head, b.length - tail);

  const out: DiffLine[] = [];
  let oldNo = 1, newNo = 1;
  const ctx = (text: string) => out.push({ kind: "ctx", text, oldNo: oldNo++, newNo: newNo++ });
  const del = (text: string) => out.push({ kind: "del", text, oldNo: oldNo++, newNo: null });
  const add = (text: string) => out.push({ kind: "add", text, oldNo: null, newNo: newNo++ });

  for (let i = 0; i < head; i++) ctx(a[i]!);
  if (midA.length * midB.length > LCS_CELL_LIMIT) {
    for (const l of midA) del(l);
    for (const l of midB) add(l);
  } else {
    // Standard LCS length table; walked forward from (0,0) so deletions precede insertions at every
    // divergence — the order every diff tool prints and the order the paired-line emphasis below
    // depends on.
    const n = midA.length, m = midB.length;
    const table: number[][] = Array.from({ length: n + 1 }, () => Array.from({ length: m + 1 }, () => 0));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        table[i]![j] = midA[i] === midB[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) { ctx(midA[i]!); i++; j++; }
      else if (table[i + 1]![j]! >= table[i]![j + 1]!) { del(midA[i]!); i++; }
      else { add(midB[j]!); j++; }
    }
    while (i < n) del(midA[i++]!);
    while (j < m) add(midB[j++]!);
  }
  for (let i = 0; i < tail; i++) ctx(a[a.length - tail + i]!);
  return out;
}

/** Changed lines plus `context` either side, with the unchanged stretches between them elided.
 *  A file whose changes are all within 2×context of each other stays one hunk — splitting it would
 *  put a "⋯ 2 unchanged lines" rail through the middle of something the reader reads as one edit. */
export function toHunks(lines: readonly DiffLine[], context = CONTEXT): DiffHunk[] {
  const changed = lines.map((l) => l.kind !== "ctx");
  if (!changed.some(Boolean)) return [];
  const keep = lines.map((_, i) => {
    for (let d = -context; d <= context; d++) if (changed[i + d]) return true;
    return false;
  });
  const hunks: DiffHunk[] = [];
  let skipped = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!keep[i]) { skipped++; continue; }
    let end = i;
    while (end < lines.length && keep[end]) end++;
    hunks.push({ lines: lines.slice(i, end), skipped });
    skipped = 0;
    i = end - 1;
  }
  return hunks;
}

const counts = (hunks: readonly DiffHunk[]) => {
  let add = 0, del = 0;
  for (const h of hunks) for (const l of h.lines) { if (l.kind === "add") add++; else if (l.kind === "del") del++; }
  return { add, del };
};

/** A FileDiff from two whole texts. */
export function fileDiff(path: string, before: string, after: string): FileDiff {
  const hunks = toHunks(diffLines(before, after));
  return { path, hunks, ...counts(hunks) };
}

/* ── Unified diff parsing ────────────────────────────────────────────────────


/* ── Intra-line emphasis ─────────────────────────────────────────────────── */

/** The part of one line that differs from its counterpart: `[start, end)` in character offsets. */
export type Span = { start: number; end: number };

/** For a del/add pair that are variations of one line, the spans that actually differ: the common
 *  prefix and suffix are trimmed off and the middles are what get tinted.
 *
 *  Returns null when the pair share too little to be "the same line, edited" (under a quarter of the
 *  shorter line in common) — highlighting nearly the whole line is the same as highlighting none of
 *  it, and it makes a wholly replaced line look like a fiddled one. */
export function pairEmphasis(del: string, add: string): { del: Span; add: Span } | null {
  if (del === add) return null;
  const max = Math.min(del.length, add.length);
  let start = 0;
  while (start < max && del[start] === add[start]) start++;
  let end = 0;
  while (end < max - start && del[del.length - 1 - end] === add[add.length - 1 - end]) end++;
  const common = start + end;
  if (common === 0 || common * 4 < max) return null;
  return { del: { start, end: del.length - end }, add: { start, end: add.length - end } };
}

/** Emphasis spans by line index, for the lines of one hunk. Only where exactly one deletion is
 *  immediately followed by exactly one insertion: a 3-for-2 replacement has no line-to-line
 *  correspondence to draw, and guessing one puts tint on lines that were never edited that way. */
export function hunkEmphasis(lines: readonly DiffLine[]): Map<number, Span> {
  const out = new Map<number, Span>();
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.kind !== "del" || lines[i + 1]?.kind !== "add") continue;
    if (lines[i - 1]?.kind === "del" || lines[i + 2]?.kind === "add") { i++; continue; }
    const e = pairEmphasis(lines[i]!.text, lines[i + 1]!.text);
    if (e) { out.set(i, e.del); out.set(i + 1, e.add); }
    i++;
  }
  return out;
}
