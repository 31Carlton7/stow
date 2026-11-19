import {
  LIBRARY_GROUP_LABEL, LIBRARY_KIND_LABEL, LibraryGroupSchema, LibraryKindSchema,
  type LibraryEntry, type LibraryFile, type LibraryFilter, type LibraryGroup, type LibraryKind, type LibraryProject, type LibrarySource, type MemoryType,
} from "@amc/contracts";

/** What the list is narrowed to by the sidebar. The search narrows it further. */
export type Scope = Pick<LibraryFilter, "group" | "kind" | "projectId" | "tag"> & { favorites?: true };

export const sameScope = (a: Scope, b: Scope): boolean =>
  a.group === b.group && a.kind === b.kind && a.projectId === b.projectId && a.tag === b.tag && a.favorites === b.favorites;

/** The part of a scope the server narrows by. What is starred is narrowed in the window, which holds the set. */
export const askedOf = (scope: Scope): Pick<LibraryFilter, "group" | "kind" | "projectId" | "tag"> =>
  ({ group: scope.group, kind: scope.kind, projectId: scope.projectId, tag: scope.tag });

export const MEMORY_TYPES: readonly { id: MemoryType; label: string; title: string }[] = [
  { id: "user", label: "About you", title: "Who you are and how you like to work" },
  { id: "feedback", label: "Feedback", title: "How an agent should or should not do something" },
  { id: "project", label: "Project", title: "A fact about the work: a decision, a convention, a date" },
  { id: "reference", label: "Reference", title: "Where something is kept: a link, a folder, a dashboard" },
];

/** A file's `type` as it is shown: one of the four by its label, anything else as written. */
export const typeLabel = (type: string): string => MEMORY_TYPES.find((t) => t.id === type)?.label ?? type;

export type AgentRows = { group: LibraryGroup; label: string; count: number; kinds: { kind: LibraryKind; label: string; count: number }[] };

/** The sidebar by agent: each agent that has files, and under it each kind of file it has, with the
 *  summed count of that agent's sources of that kind. */
export function agentRows(sources: readonly LibrarySource[]): AgentRows[] {
  const out: AgentRows[] = [];
  for (const group of LibraryGroupSchema.options) {
    const kinds = LibraryKindSchema.options
      .map((kind) => ({ kind, label: LIBRARY_KIND_LABEL[kind], count: sources.filter((s) => s.group === group && s.kind === kind).reduce((sum, s) => sum + s.count, 0) }))
      .filter((k) => k.count > 0);
    if (kinds.length === 0) continue;
    out.push({ group, label: LIBRARY_GROUP_LABEL[group], count: kinds.reduce((sum, k) => sum + k.count, 0), kinds });
  }
  return out;
}

/** What the list is showing, as its head names it: a name, and for one agent's files whose they are
 *  and which kind when the sidebar has picked one. */
export type ScopeHeading = { name: string; agent?: LibraryGroup; kind?: string };

export function scopeHeading(scope: Scope, projects: readonly LibraryProject[]): ScopeHeading {
  if (scope.favorites) return { name: "Favorites" };
  if (scope.tag !== undefined) return { name: `Tagged ${scope.tag}` };
  if (scope.projectId !== undefined) return { name: projects.find((p) => p.id === scope.projectId)?.name ?? "Project" };
  if (scope.group === undefined) return { name: "All memories" };
  return { name: LIBRARY_GROUP_LABEL[scope.group], agent: scope.group, kind: scope.kind === undefined ? undefined : LIBRARY_KIND_LABEL[scope.kind] };
}

/** The same in one line, for what is read out and not seen. */
export function scopeTitle(scope: Scope, projects: readonly LibraryProject[]): string {
  const { name, kind } = scopeHeading(scope, projects);
  return kind === undefined ? name : `${name} ${kind}`;
}

/**
 * Where a file is, in a row's few words: whose it is and the folder it sits in. The agent is left out
 * of a list that is already one agent's, and an index's folder out of a title that already says it.
 */
export function whereOf(e: LibraryEntry, source: LibrarySource | undefined, scope: Scope): string {
  const place = e.folder !== null && !e.index ? e.folder : source?.label ?? null;
  const parts = [scope.group === undefined ? LIBRARY_GROUP_LABEL[e.group] : null, place];
  return parts.filter((p): p is string => p !== null).join(" · ");
}

/** `[[a link]]` as a Markdown link whose target is what was written, so the reader draws it as a link
 *  and a click on it can be looked up in the file's `links`. Fenced code is left as it is. */
export function linkWikiLinks(body: string): string {
  let fenced = false;
  return body.split("\n").map((line) => {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; return line; }
    return fenced ? line : line.replace(/\[\[([^[\]\n]+)\]\]/g, (_, t: string) => `[${t}](<${t}>)`);
  }).join("\n");
}

/** The body without its opening `# Title` line when that is the title the head already shows. */
export function withoutTitle(body: string, title: string): string {
  const m = /^\s*#{1,6}\s+(.+?)\s*\n/.exec(body.endsWith("\n") ? body : `${body}\n`);
  return m && m[1] === title ? body.slice(m[0].length).replace(/^\n+/, "") : body;
}

/** The file's own record of a link, by the `href` the reader drew it with. Markdown escapes what a
 *  link's target may not hold (a space), so the target as written is tried both ways. */
export function linkOf(links: LibraryFile["links"], href: string): LibraryFile["links"][number] | null {
  let written = href;
  try { written = decodeURI(href); } catch { /* not an escaped target */ }
  return links.find((l) => l.target === href || l.target === written) ?? null;
}

/** What was typed into the tag field, as tags: one word each, split on spaces and commas. */
export function tagsTyped(text: string): string[] {
  return text.split(/[\s,]+/).map((t) => t.replace(/^#/, "").slice(0, 40)).filter((t) => t !== "");
}
