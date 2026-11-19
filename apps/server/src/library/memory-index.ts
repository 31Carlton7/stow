export const MEMORY_INDEX_FILE = "MEMORY.md";

/**
 * The file a cross-link points at, from the repo root: `[[projects/payments]]` is
 * `projects/payments.md`, and a name with an extension keeps it (`[[metrics/keep_rate.sql]]`). A bare
 * path is taken as the inside of a link.
 */
export function wikiLinkTarget(link: string): string | null {
  const m = /^\[\[([^[\]]*)\]\]$/.exec(link.trim());
  const p = (m ? m[1]! : link).trim().replace(/^\/+/, "");
  if (p === "" || /[[\]]/.test(p)) return null;
  return /\.[A-Za-z0-9]+$/.test(p.split("/").at(-1)!) ? p : `${p}.md`;
}

/** The cross-link for a repo path: `.md` dropped, any other extension kept. */
export function wikiLinkFor(path: string): string {
  return `[[${path.replace(/\.md$/i, "")}]]`;
}

const INDEX_HEADING = /^##\s+Index\s*$/i;
const HEADING = /^#{1,6}\s/;

/** `MEMORY.md` with a link to `path` under `## Index` (the heading added if it is missing). A link
 *  already there anywhere in the file leaves it as it was. */
export function withIndexLink(index: string, path: string): string {
  const link = wikiLinkFor(path);
  if (index.includes(link)) return index;
  if (index.trim() === "") return `## Index\n- ${link}\n`;
  const lines = index.replace(/\n+$/, "").split("\n");
  const at = lines.findIndex((l) => INDEX_HEADING.test(l));
  if (at === -1) return `${lines.join("\n")}\n\n## Index\n- ${link}\n`;
  let end = at + 1;
  for (let i = at + 1; i < lines.length; i++) {
    if (HEADING.test(lines[i]!)) break;
    if (lines[i]!.trim() !== "") end = i + 1;
  }
  lines.splice(end, 0, `- ${link}`);
  return `${lines.join("\n")}\n`;
}

/** `MEMORY.md` without the index line that links `path`: the line `withIndexLink` adds, and any line
 *  that is that link and a note after it. Nothing else changes. */
export function withoutIndexLink(index: string, path: string): string {
  const link = wikiLinkFor(path);
  const lines = index.split("\n");
  const kept = lines.filter((l) => {
    const m = /^\s*[-*+]\s+(\[\[[^\]]*\]\])(?:\s.*)?$/.exec(l);
    return !m || m[1] !== link;
  });
  return kept.length === lines.length ? index : kept.join("\n");
}
