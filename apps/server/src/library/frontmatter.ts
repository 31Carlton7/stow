const DESCRIPTION_MAX = 200;

export const short = (text: string, n = 60): string => (text.length <= n ? text : `${text.slice(0, n - 1).trimEnd()}…`);

export type FrontmatterField = { key: string; value: string };

/**
 * A leading `---` block as key/value pairs in file order, and the text after it. A key nested under a
 * map is `parent.key` (Claude keeps `type` as `metadata.type`); a list's items are left out. Values are
 * read the way YAML writes a scalar: bare, or quoted in either quote.
 */
export function readFrontmatter(text: string): { fields: FrontmatterField[]; body: string } {
  const lines = text.split("\n");
  if (lines[0]?.trim() !== "---") return { fields: [], body: text };
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (end === -1) return { fields: [], body: text };
  const fields: FrontmatterField[] = [];
  let parent: string | null = null;
  for (const line of lines.slice(1, end)) {
    const m = /^(\s*)([A-Za-z_][\w.-]*):\s*(.*)$/.exec(line);
    if (!m) continue;
    const nested = m[1]!.length > 0 && parent !== null;
    const value = unquote(m[3]!.trim());
    if (!nested) parent = value === "" ? m[2]! : null;
    if (value !== "") fields.push({ key: nested ? `${parent}.${m[2]}` : m[2]!, value });
  }
  return { fields, body: lines.slice(end + 1).join("\n").replace(/^\n+/, "") };
}

function unquote(v: string): string {
  if (v.length >= 2 && v.startsWith("\"") && v.endsWith("\"")) { try { return String(JSON.parse(v)); } catch { return v.slice(1, -1); } }
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replace(/''/g, "'");
  return v;
}

/** The first of `keys` a file states. */
export const fieldOf = (fields: readonly FrontmatterField[], ...keys: string[]): string | null =>
  keys.map((k) => fields.find((f) => f.key === k)?.value).find((v) => v !== undefined && v !== "") ?? null;

/** The first line of prose: past headings, rules and blank lines, with Markdown's marks off. */
export function firstProse(body: string): string | null {
  let fenced = false;
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("```") || line.startsWith("~~~")) { fenced = !fenced; continue; }
    if (fenced || line === "" || /^#{1,6}\s/.test(line) || /^(-{3,}|\*{3,}|_{3,})$/.test(line) || line.startsWith("<!--")) continue;
    const text = line.replace(/^>\s*/, "").replace(/^[-*+]\s+/, "").replace(/^\d+[.)]\s+/, "")
      .replace(/\[\[([^\]]+)\]\]/g, "$1").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`]/g, "").trim();
    if (text !== "") return short(text, DESCRIPTION_MAX);
  }
  return null;
}
