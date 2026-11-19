export type TomlValue = string | number | boolean | TomlValue[] | { [key: string]: TomlValue };
export type TomlTable = { path: string[]; values: Record<string, TomlValue> };

/**
 * The tables of a TOML file, each with its `key = value` pairs. It reads what Codex's `config.toml`
 * uses (strings in every quoting, arrays over several lines, inline tables, booleans and numbers) and
 * is not a full TOML parser: dates and special floats come back as the text they were written as.
 * Keys set before the first header are the table with an empty path. Throws on text it cannot read.
 */
export function readTomlTables(text: string): TomlTable[] {
  let at = 0;
  const tables: TomlTable[] = [{ path: [], values: {} }];

  const fail = (what: string): never => { throw new Error(`TOML: ${what} at offset ${at}`); };
  const skipBlank = (newlines: boolean): void => {
    for (;;) {
      const c = text[at];
      if (c === " " || c === "\t" || (newlines && (c === "\n" || c === "\r"))) at++;
      else if (c === "#") { while (at < text.length && text[at] !== "\n") at++; }
      else return;
    }
  };

  const basicString = (): string => {
    const multi = text.startsWith('"""', at);
    at += multi ? 3 : 1;
    if (multi && text[at] === "\n") at++;
    let out = "";
    for (;;) {
      if (at >= text.length) fail("unterminated string");
      if (multi ? text.startsWith('"""', at) : text[at] === '"') { at += multi ? 3 : 1; return out; }
      if (text[at] === "\\") {
        const next = text[at + 1]!;
        if (next === "u" || next === "U") {
          const digits = next === "u" ? 4 : 8;
          out += String.fromCodePoint(parseInt(text.slice(at + 2, at + 2 + digits), 16));
          at += 2 + digits;
        } else {
          out += ({ n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", '"': '"', "\\": "\\" } as Record<string, string>)[next] ?? next;
          at += 2;
        }
      } else out += text[at++];
    }
  };
  const literalString = (): string => {
    const multi = text.startsWith("'''", at);
    const close = multi ? "'''" : "'";
    at += close.length;
    const end = text.indexOf(close, at);
    if (end === -1) fail("unterminated string");
    const out = text.slice(at, end);
    at = end + close.length;
    return multi && out.startsWith("\n") ? out.slice(1) : out;
  };

  const key = (): string => {
    if (text[at] === '"') return basicString();
    if (text[at] === "'") return literalString();
    const m = /^[A-Za-z0-9_-]+/.exec(text.slice(at, at + 200));
    if (!m) fail("expected a key");
    at += m![0].length;
    return m![0];
  };
  const keyPath = (): string[] => {
    const path = [key()];
    for (skipBlank(false); text[at] === "."; skipBlank(false)) { at++; skipBlank(false); path.push(key()); }
    return path;
  };

  const value = (): TomlValue => {
    const c = text[at];
    if (c === '"') return basicString();
    if (c === "'") return literalString();
    if (c === "[") {
      at++;
      const items: TomlValue[] = [];
      for (skipBlank(true); text[at] !== "]"; skipBlank(true)) {
        items.push(value());
        skipBlank(true);
        if (text[at] === ",") at++;
        else if (text[at] !== "]") fail("expected , or ] in an array");
      }
      at++;
      return items;
    }
    if (c === "{") {
      at++;
      const table: Record<string, TomlValue> = {};
      for (skipBlank(true); text[at] !== "}"; skipBlank(true)) {
        assign(table);
        skipBlank(true);
        if (text[at] === ",") at++;
        else if (text[at] !== "}") fail("expected , or } in an inline table");
      }
      at++;
      return table;
    }
    const m = /^[^\s,\]}#]+/.exec(text.slice(at, at + 200));
    if (!m) fail("expected a value");
    at += m![0].length;
    const bare = m![0];
    if (bare === "true" || bare === "false") return bare === "true";
    const n = Number(bare.replaceAll("_", ""));
    return Number.isNaN(n) ? bare : n;
  };

  /** `a.b = v` into `into`, a dotted key making the tables on the way. */
  const assign = (into: Record<string, TomlValue>): void => {
    const path = keyPath();
    skipBlank(false);
    if (text[at] !== "=") fail("expected =");
    at++;
    skipBlank(false);
    let table = into;
    for (const part of path.slice(0, -1)) {
      const next = table[part];
      table = (typeof next === "object" && !Array.isArray(next) ? next : (table[part] = {})) as Record<string, TomlValue>;
    }
    table[path.at(-1)!] = value();
  };

  for (skipBlank(true); at < text.length; skipBlank(true)) {
    if (text[at] === "[") {
      const double = text[at + 1] === "[";
      at += double ? 2 : 1;
      skipBlank(false);
      const path = keyPath();
      skipBlank(false);
      if (!text.startsWith(double ? "]]" : "]", at)) fail("unterminated table header");
      at += double ? 2 : 1;
      tables.push({ path, values: {} });
    } else {
      assign(tables.at(-1)!.values);
    }
  }
  return tables;
}
