import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { basename, posix } from "node:path";
import { LIBRARY_GROUP_LABEL, type Finding, type FindingSeverity, type FindingSubject, type FindingType, type McpServer, type SkillPlace } from "@amc/contracts";
import { claudeIndexTarget, withClaudeIndexLine } from "../library/claude-facts";
import { readFrontmatter } from "../library/frontmatter";
import { textHash, type Change, type HeldFile } from "../library/library";
import { wikiLinkTarget, withIndexLink } from "../library/memory-index";
import { tildify } from "../library/paths";

/** A finding, the changes approving it would make, and the commit message they go under in a repository. */
export type Draft = Finding & { changes: Change[]; commit: string };

export type RuleInput = {
  home: string;
  files: readonly HeldFile[];
  skillCopies: readonly { name: string; folders: SkillPlace[] }[];
  mcp: readonly McpServer[];
};

/** Past this an index is long enough that Realm tidies its own. */
const INDEX_MAX = 32_000;
/** How alike two memories' wording must be to be worth a look, and how long before likeness means anything. */
const NEAR_SHARE = 0.85;
const NEAR_MIN_WORDS = 30;
const NEAR_MAX_FINDINGS = 40;
const SUBJECTS_MAX = 50;

const SEVERITY_ORDER: Record<FindingSeverity, number> = { high: 0, medium: 1, low: 2 };

export const fingerprintOf = (type: FindingType, ...parts: string[]): string =>
  createHash("sha1").update([type, ...parts].join("\n")).digest("hex").slice(0, 16);
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
/** "A", "A and B", "A, B and C". */
const listed = (names: readonly string[]): string =>
  names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
/** The places by name while they fit a title, and by their number past that. */
const placesNamed = (places: readonly string[]): string => (places.length <= 3 ? listed(places) : `${places.length} places`);

export const isMemoryKind = (file: HeldFile): boolean => file.source.kind === "memory" || file.source.kind === "project-memory";
const isLive = (file: HeldFile): boolean => file.source.kind !== "imported";
const isLocked = (file: HeldFile): boolean => Boolean(file.source.lockedNote?.(file.entry.rel));
/** Where a file is kept, as a person would say it: "Claude · atlas". */
export const placeOf = (file: HeldFile): string => `${LIBRARY_GROUP_LABEL[file.source.group]} · ${file.entry.folder ?? file.source.label}`;

/** Every rule's findings. Pure over its input, apart from asking the disk whether a path a memory names is still there. */
export function findProblems(input: RuleInput): Draft[] {
  const subject = (file: HeldFile): FindingSubject => ({ id: file.entry.id, label: file.entry.title, displayPath: tildify(file.entry.path, input.home) });
  const remove = (file: HeldFile): Change => ({ id: file.entry.id, baseHash: textHash(file.text), text: null });
  const draft = (d: Omit<Draft, "changes" | "commit" | "fix" | "judgedBy" | "needsDraft"> & Partial<Pick<Draft, "changes" | "commit" | "fix">>): Draft =>
    ({ changes: [], commit: "", fix: null, judgedBy: null, needsDraft: false, ...d, subjects: d.subjects.slice(0, SUBJECTS_MAX) });

  const live = input.files.filter(isLive);
  const out: Draft[] = [];

  // ── Copies ──────────────────────────────────────────────────────────────────────────────────

  // One file reached twice (a link and its target) is not two copies. Only memories are matched: the
  // same CLAUDE.md in two checkouts of one repository is how instruction files are meant to be.
  const distinct = (files: readonly HeldFile[]): HeldFile[] => [...new Map(files.map((f) => [f.real, f])).values()];
  const memories = distinct(live).filter(isMemoryKind);
  const byHash = new Map<string, HeldFile[]>();
  for (const file of memories) if (file.hash !== null) byHash.set(file.hash, [...(byHash.get(file.hash) ?? []), file]);

  const deadByFolder = new Map<string, HeldFile[]>();
  for (const file of input.files) {
    if (isLive(file) || file.hash === null || !byHash.has(file.hash)) continue;
    const folder = posix.dirname(file.entry.rel);
    deadByFolder.set(folder, [...(deadByFolder.get(folder) ?? []), file]);
  }
  for (const [folder, copies] of deadByFolder) {
    out.push(draft({
      fingerprint: fingerprintOf("dead-copy", folder), type: "dead-copy", severity: "low",
      title: `${plural(copies.length, "imported copy", "imported copies")} in ${copies[0]!.entry.folder ?? folder} that no agent reads`,
      detail: "Realm copied these out of Claude's project memory when it brought them into a memory repo. Each is word for word a memory agents still read, and nothing reads the copy.",
      subjects: copies.map(subject), fix: `Move ${plural(copies.length, "file")} to the Trash.`, changes: copies.map(remove),
    }));
  }

  /** Sets of files, collected by the places they are kept in: one finding per pair of places, not per memory. */
  const byPlaces = (sets: readonly HeldFile[][]): Map<string, HeldFile[][]> => {
    const grouped = new Map<string, HeldFile[][]>();
    for (const set of sets) {
      const places = [...new Set(set.map(placeOf))].sort().join("\n");
      grouped.set(places, [...(grouped.get(places) ?? []), set]);
    }
    return grouped;
  };

  for (const [places, sets] of byPlaces([...byHash.values()].filter((set) => set.length > 1))) {
    out.push(draft({
      fingerprint: fingerprintOf("duplicate", places), type: "duplicate", severity: "low",
      title: `${plural(sets.length, "memory is", "memories are")} word for word in ${placesNamed(places.split("\n"))}`,
      detail: "Each place is read by different sessions, so nothing is removed for you. Delete a copy from the library if one of the places should not have it.",
      subjects: sets.map((set) => subject(set.find((f) => f.entry.canonical) ?? set[0]!)),
    }));
  }

  const byOrigin = new Map<string, HeldFile[]>();
  for (const file of memories) if (file.origin !== null) byOrigin.set(file.origin, [...(byOrigin.get(file.origin) ?? []), file]);
  const diverged = [...byOrigin.values()].filter((set) => new Set(set.map((f) => f.hash)).size > 1);
  for (const [places, sets] of byPlaces(diverged)) {
    out.push(draft({
      fingerprint: fingerprintOf("diverged-copy", places), type: "diverged-copy", severity: "medium",
      title: `${plural(sets.length, "memory differs", "memories differ")} between ${placesNamed(places.split("\n"))}`,
      detail: "Each has the same name and came from the same session, but its text has been edited in one place since. Agents reading each place are told different things.",
      subjects: sets.flat().map(subject),
    }));
  }

  // ── Nearly the same memory ──────────────────────────────────────────────────────────────────

  const facts = memories.filter((f) => !f.entry.index && f.hash !== null);
  const wording = new Map(facts.map((f) => [f, shingles(readFrontmatter(f.text).body)]));
  const sameBucket = new Map<string, HeldFile[]>();
  for (const fact of facts) {
    const bucket = fact.entry.projectId ?? fact.source.id;
    sameBucket.set(bucket, [...(sameBucket.get(bucket) ?? []), fact]);
  }
  const near: { a: HeldFile; b: HeldFile; share: number }[] = [];
  for (const bucket of sameBucket.values()) {
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const [a, b] = [bucket[i]!, bucket[j]!].sort((x, y) => x.entry.title.localeCompare(y.entry.title)) as [HeldFile, HeldFile];
        // Word-for-word copies and edited copies of one memory are already findings of their own.
        if (a.hash === b.hash || (a.origin !== null && a.origin === b.origin)) continue;
        const share = sharedWording(wording.get(a)!, wording.get(b)!);
        if (share >= NEAR_SHARE) near.push({ a, b, share });
      }
    }
  }
  for (const { a, b, share } of near.sort((x, y) => y.share - x.share).slice(0, NEAR_MAX_FINDINGS)) {
    out.push(draft({
      fingerprint: fingerprintOf("near-duplicate", ...[a.entry.id, b.entry.id].sort()), type: "near-duplicate", severity: "low",
      title: `${a.entry.title} and ${b.entry.title} say nearly the same thing`,
      detail: share === 1 ? "Their text is the same. Only the properties above it differ." : `${Math.round(share * 100)}% of their wording is shared.`,
      subjects: [subject(a), subject(b)],
    }));
  }

  // ── Links and indexes ───────────────────────────────────────────────────────────────────────

  const listing = new Map<string, Set<string>>();
  const filesOf = (file: HeldFile): Set<string> => {
    if (!listing.has(file.source.id)) listing.set(file.source.id, new Set(file.source.files()));
    return listing.get(file.source.id)!;
  };
  /**
   * The files a line links to that are in the source, and the ones that are not. A `[[name]]` counts
   * only in an index: in a memory's own text it names another memory, and one that names a memory not
   * written yet is a note to write it, not a mistake.
   */
  const linksIn = (file: HeldFile, line: string): { found: string[]; missing: string[] } => {
    const found: string[] = [], missing: string[] = [];
    const judge = (written: string, target: string | null): void => {
      if (target !== null && filesOf(file).has(target)) found.push(target);
      else missing.push(written);
    };
    if (file.entry.index) for (const m of line.matchAll(/\[\[([^[\]\n]+)\]\]/g)) judge(m[1]!, wikiLinkTarget(m[1]!));
    for (const m of line.matchAll(/\]\(([^)\s]+)\)/g)) {
      const href = m[1]!.split("#")[0]!;
      if (/^[a-z][a-z0-9+.-]*:|^\//i.test(href) || !/\.mdc?$/i.test(href)) continue;
      const target = posix.normalize(posix.join(posix.dirname(file.entry.rel), href));
      judge(m[1]!, target.startsWith("..") ? null : target);
    }
    return { found, missing };
  };
  /** A line of an index that is one link and nothing an agent would miss: the line can go when its file has. */
  const isIndexLine = (line: string): boolean => /^\s*[-*+]\s+\[\[[^\]]*\]\](\s.*)?$/.test(line) || claudeIndexTarget(line) !== null;

  for (const file of live) {
    const lines = file.text.split("\n");
    const inFence = fencedLines(lines);
    const dead = lines.map((line, at) => ({ at, line, missing: inFence[at] ? [] : linksIn(file, line).missing })).filter((l) => l.missing.length > 0);
    if (dead.length === 0) continue;
    const targets = [...new Set(dead.flatMap((l) => l.missing))];
    const removable = file.entry.index && !isLocked(file) ? dead.filter((l) => isIndexLine(l.line)) : [];
    const gone = new Set(removable.map((l) => l.at));
    out.push(draft({
      fingerprint: fingerprintOf("broken-link", file.entry.id, ...[...targets].sort()), type: "broken-link", severity: "medium",
      title: `${placeOf(file)}: ${file.entry.title} links to ${plural(targets.length, "file")} that ${targets.length === 1 ? "is" : "are"} not there`,
      detail: `Missing: ${targets.slice(0, 5).join(", ")}${targets.length > 5 ? ` and ${targets.length - 5} more` : ""}. An agent that follows the link finds nothing.`,
      subjects: [subject(file)],
      ...(removable.length > 0 ? {
        fix: `Remove ${plural(removable.length, "line")} from the index.`,
        commit: `Drop ${plural(removable.length, "dead link")} from ${file.entry.rel}`,
        changes: [{ id: file.entry.id, baseHash: textHash(file.text), text: lines.filter((_, at) => !gone.has(at)).join("\n") }],
      } : {}),
    }));
  }

  for (const index of live.filter((f) => f.entry.index && isMemoryKind(f))) {
    const folder = posix.dirname(index.entry.rel);
    const listedFiles = new Set(index.text.split("\n").flatMap((line) => linksIn(index, line).found));
    const orphans = live.filter((f) => f.source === index.source && !f.entry.index && posix.dirname(f.entry.rel) === folder && !listedFiles.has(f.entry.rel));
    if (orphans.length === 0) continue;
    const atRepoTop = index.source.repo !== null && folder === ".";
    const withLines = orphans.reduce((text, orphan) => (atRepoTop
      ? withIndexLink(text, orphan.entry.rel)
      : withClaudeIndexLine(text, basename(orphan.entry.rel), orphan.entry.title, orphan.entry.description ?? orphan.entry.title)), index.text);
    out.push(draft({
      fingerprint: fingerprintOf("orphan", index.entry.id, ...orphans.map((o) => o.entry.rel).sort()), type: "orphan", severity: "low",
      title: `${plural(orphans.length, "memory is", "memories are")} not in the index of ${placeOf(index)}`,
      detail: "A session starts from the index and opens what it lists. These files are in the folder but not in the index, so an agent only comes across them by searching.",
      subjects: orphans.map(subject),
      ...(isLocked(index) ? {} : {
        fix: `Add ${plural(orphans.length, "line")} to the index.`,
        commit: `List ${plural(orphans.length, "memory", "memories")} in ${index.entry.rel}`,
        changes: [{ id: index.entry.id, baseHash: textHash(index.text), text: withLines }],
      }),
    }));
  }

  for (const index of live.filter((f) => f.entry.index && f.text.length > INDEX_MAX)) {
    out.push(draft({
      fingerprint: fingerprintOf("oversized-index", index.entry.id), type: "oversized-index", severity: "medium",
      title: `${placeOf(index)}: the index is ${index.text.length.toLocaleString("en-US")} characters long`,
      detail: "Every session that starts with this index pays for all of it, and an index this long can be cut off when it is loaded, which hides the memories listed at its end.",
      subjects: [subject(index)],
    }));
  }

  // ── Files that say nothing, and paths that are gone ─────────────────────────────────────────

  for (const file of live) {
    if (isMemoryKind(file) || file.source.kind === "documents" || file.text.trim() !== "" || isLocked(file)) continue;
    out.push(draft({
      fingerprint: fingerprintOf("empty-file", file.entry.id), type: "empty-file", severity: "low",
      title: `${tildify(file.entry.path, input.home)} is empty`,
      detail: `${file.source.by} There is nothing in it to load.`,
      subjects: [subject(file)], fix: "Move it to the Trash.", changes: [remove(file)],
    }));
  }

  for (const fact of facts) {
    const gone = missingPaths(fact.text, input.home);
    if (gone.length === 0) continue;
    out.push(draft({
      fingerprint: fingerprintOf("dead-reference", fact.entry.id, ...gone), type: "dead-reference", severity: "low",
      title: `${fact.entry.title} names ${plural(gone.length, "path")} that ${gone.length === 1 ? "is" : "are"} gone`,
      detail: `Not on this Mac any more: ${gone.slice(0, 3).map((p) => tildify(p, input.home)).join(", ")}${gone.length > 3 ? ` and ${gone.length - 3} more` : ""}. The memory may describe work that has moved or finished.`,
      subjects: [subject(fact)],
    }));
  }

  // ── Setup ───────────────────────────────────────────────────────────────────────────────────

  // One finding per set of skills folders, not per skill: a library of copies is one decision.
  const copiedBetween = new Map<string, RuleInput["skillCopies"][number][]>();
  for (const copies of input.skillCopies) {
    const places = [...new Set(copies.folders.map((folder) => folder.label))].sort().join("\n");
    copiedBetween.set(places, [...(copiedBetween.get(places) ?? []), copies]);
  }
  for (const [places, sets] of copiedBetween) {
    out.push(draft({
      fingerprint: fingerprintOf("duplicate-skill", places), type: "duplicate-skill", severity: "low",
      title: `${plural(sets.length, "skill is", "skills are")} copied, not linked, in ${placesNamed(places.split("\n"))}`,
      detail: "Each copy is a folder of its own with the same SKILL.md, so an edit to one leaves the others behind. A link to one folder keeps them a single skill.",
      subjects: sets.flatMap((copies) => copies.folders.map((folder) => ({ id: null, label: copies.name, displayPath: folder.displayPath }))),
    }));
  }

  for (const server of input.mcp) {
    const whose = (d: McpServer["definitions"][number]): string => (d.projectName ? `${d.agent} (${d.projectName})` : d.agent);
    const subjects = server.definitions.map((d) => ({ id: null, label: `${whose(d)}: ${d.target}`, displayPath: d.file }));
    if (server.conflict) {
      out.push(draft({
        fingerprint: fingerprintOf("mcp-conflict", server.name, ...server.definitions.map((d) => d.fingerprint).sort()), type: "mcp-conflict", severity: "medium",
        title: `The ${server.name} MCP server is set up ${plural(new Set(server.definitions.map((d) => d.fingerprint)).size, "way")}`,
        detail: `${listed([...new Set(server.definitions.map(whose))])} do not start it the same way, so the same name gives agents different tools.`,
        subjects,
      }));
      continue;
    }
    // The same server in two agents' configs is how each agent comes to have it. Twice in one agent's is once too many.
    const perAgent = new Map<string, number>();
    for (const d of server.definitions) perAgent.set(d.agent, (perAgent.get(d.agent) ?? 0) + 1);
    const repeated = [...perAgent].filter(([, count]) => count > 1).map(([agent]) => agent);
    if (repeated.length === 0) continue;
    out.push(draft({
      fingerprint: fingerprintOf("mcp-duplicate", server.name, ...repeated.sort()), type: "mcp-duplicate", severity: "low",
      title: `The ${server.name} MCP server is defined more than once for ${listed(repeated)}`,
      detail: "It is defined the same way each time. One definition for every session of that agent would do.",
      subjects: subjects.filter((_, at) => repeated.includes(server.definitions[at]!.agent)),
    }));
  }

  return out;
}

/** Most serious first, then by kind and title, so a list reads the same on every scan. */
export const bySeverity = (a: Draft, b: Draft): number =>
  SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.type.localeCompare(b.type) || a.title.localeCompare(b.title);

/** For each line, whether it is a fence or inside one: there a link is an example, not a link. */
function fencedLines(lines: readonly string[]): boolean[] {
  let inside = false;
  return lines.map((line) => {
    if (!/^\s*(```|~~~)/.test(line)) return inside;
    inside = !inside;
    return true;
  });
}

/** A text's runs of three words, lower-cased, or null for one too short for likeness to mean anything. */
function shingles(text: string): Set<string> | null {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  if (words.length < NEAR_MIN_WORDS) return null;
  const runs = new Set<string>();
  for (let i = 0; i + 2 < words.length; i++) runs.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
  return runs;
}

/** The share of two texts' three-word runs that both have (Jaccard). */
function sharedWording(a: Set<string> | null, b: Set<string> | null): number {
  if (a === null || b === null) return 0;
  let both = 0;
  for (const run of a) if (b.has(run)) both++;
  return both / (a.size + b.size - both);
}

/**
 * The paths under the home folder a text names that are not on disk. A path with a placeholder or a
 * glob in it stops at that character, so `~/work/<name>` checks `~/work`, which is there.
 */
function missingPaths(text: string, home: string): string[] {
  const gone = new Set<string>();
  for (const m of text.matchAll(/(?:~|\/Users\/[\w.-]+)(?:\/[\w@.+-]+)+/g)) {
    const path = m[0].replace(/^~/, home).replace(/\.+$/, "");
    if (path.startsWith(`${home}/`) && !existsSync(path)) gone.add(path);
  }
  return [...gone].sort().slice(0, 20);
}
