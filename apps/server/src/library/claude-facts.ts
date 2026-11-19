/**
 * Claude Code's own auto-memory format, which a space's folder of the profile repo keeps: one fact per
 * file — frontmatter `name`, `description`, `metadata.type`, then the body — and a `MEMORY.md` of one
 * line per fact, `- [Title](file.md) — what it is`. Claude reads and writes these files itself once its
 * memory directory is pointed at the folder; Realm writes them in the same shape so the two never mix.
 */

export type ClaudeFactType = "user" | "feedback" | "project" | "reference";

/** `- [Title](file.md) — hook`, and the `./file.md` spelling of the same link. */
const INDEX_LINE = /^\s*[-*+]\s+\[[^\]]*\]\(\.?\/?([^)\s]+)\)/;

/** The file a line of a Claude `MEMORY.md` links to, or null for any other line. */
export function claudeIndexTarget(line: string): string | null {
  return INDEX_LINE.exec(line)?.[1] ?? null;
}

/** The file a fact is kept in, from its name. Never `memory.md`, which is `MEMORY.md` on a Mac's disk. */
export function claudeFactFile(name: string): string {
  let stem = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9_]+/g, "-").replace(/^-+/, "").slice(0, 80).replace(/-+$/, "");
  if (stem === "" || stem === "memory") stem = `${stem || "memory"}-note`;
  return `${stem}.md`;
}

/** A frontmatter value as YAML reads it back: bare when it is plainly a word or a phrase, quoted otherwise. */
export const yamlScalar = (s: string): string => (/^[A-Za-z0-9_][A-Za-z0-9_ .-]*$/.test(s) && !s.endsWith(" ") ? s : JSON.stringify(s));

/** One fact as Claude writes one. `source` names the Realm session it came from, when there is one. */
export function claudeFact(f: { name: string; description: string; type: ClaudeFactType; body: string; source?: string }): string {
  const head = ["---", `name: ${yamlScalar(f.name)}`, `description: ${yamlScalar(f.description)}`, "metadata:", `  type: ${f.type}`, ...(f.source ? [`  source: ${yamlScalar(f.source)}`] : []), "---"];
  const body = f.body.trim();
  return `${head.join("\n")}\n${body ? `\n${body}\n` : ""}`;
}

/** `MEMORY.md` with this fact's line: the line already linking `file` is rewritten in place, and a
 *  fact not listed yet is added at the end. */
export function withClaudeIndexLine(index: string, file: string, title: string, hook: string): string {
  const line = `- [${title.replace(/[[\]]/g, "")}](${file}) — ${hook}`;
  const lines = index.trim() === "" ? [] : index.replace(/\n+$/, "").split("\n");
  const at = lines.findIndex((l) => claudeIndexTarget(l) === file);
  if (at === -1) lines.push(line);
  else if (lines[at] === line) return index;
  else lines[at] = line;
  return `${lines.join("\n")}\n`;
}

/** `MEMORY.md` without the line that links `file`, for a fact that is gone. */
export function withoutClaudeIndexLine(index: string, file: string): string {
  const lines = index.split("\n");
  const kept = lines.filter((l) => claudeIndexTarget(l) !== file);
  return kept.length === lines.length ? index : kept.join("\n");
}
