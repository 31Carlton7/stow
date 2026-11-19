const CUT = Symbol("cut");

const SCALAR = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/y;

/**
 * Read the start of a JSON text that stops anywhere: what a line over the reader's limit leaves.
 * Everything whole is kept, a string that was cut keeps what there is of it, and every object and
 * list still open is closed where the text ends. `JSON.parse` cannot do this: it refuses the lot.
 */
export function parseCutJson(text: string): unknown {
  let i = 0;
  const skipSpace = (): void => { while (text[i] === " " || text[i] === "\n" || text[i] === "\r" || text[i] === "\t") i++; };
  const stop = (): void => { i = text.length; };

  const string = (): string => {
    const start = ++i;
    for (;;) {
      const quote = text.indexOf('"', i);
      if (quote === -1) { stop(); return unescaped(text.slice(start), true); }
      let slashes = 0;
      while (text[quote - 1 - slashes] === "\\") slashes++;
      i = quote + 1;
      if (slashes % 2 === 0) return unescaped(text.slice(start, quote), false);
    }
  };

  const value = (): unknown => {
    skipSpace();
    const ch = text[i];
    if (ch === undefined) return CUT;
    if (ch === '"') return string();
    if (ch === "{") {
      i++;
      const fields: Record<string, unknown> = {};
      for (;;) {
        skipSpace();
        if (text[i] === "}") { i++; return fields; }
        if (text[i] === ",") { i++; continue; }
        if (text[i] !== '"') { stop(); return fields; }
        const key = string();
        skipSpace();
        if (text[i] !== ":") { stop(); return fields; }
        i++;
        const held = value();
        if (held === CUT) return fields;
        fields[key] = held;
      }
    }
    if (ch === "[") {
      i++;
      const entries: unknown[] = [];
      for (;;) {
        skipSpace();
        if (text[i] === "]") { i++; return entries; }
        if (text[i] === ",") { i++; continue; }
        const held = value();
        if (held === CUT) return entries;
        entries.push(held);
      }
    }
    SCALAR.lastIndex = i;
    const scalar = SCALAR.exec(text)?.[0];
    // A number that runs to the very end may have lost its last digits.
    if (scalar === undefined || i + scalar.length === text.length) { stop(); return CUT; }
    i += scalar.length;
    return JSON.parse(scalar) as unknown;
  };

  const whole = value();
  return whole === CUT ? null : whole;
}

/** A JSON string's text from between its quotes. A cut one may end part way through an escape,
 *  which is dropped: the longest escape, `\uXXXX`, is six characters. */
function unescaped(raw: string, cut: boolean): string {
  if (!raw.includes("\\")) return raw;
  for (let dropped = 0; dropped <= (cut ? 6 : 0); dropped++) {
    try { return JSON.parse(`"${raw.slice(0, raw.length - dropped)}"`) as string; } catch { /* try one shorter */ }
  }
  return raw;
}
