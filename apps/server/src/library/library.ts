import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, statSync } from "node:fs";
import { basename, isAbsolute, join, posix } from "node:path";
import {
  LIBRARY_EXTERNAL_UNCONFIRMED, LIBRARY_FILE_MAX, LIBRARY_GROUP_LABEL, libraryId, parseLibraryId,
  type LibraryEntry, type LibraryFile, type LibraryFilter, type LibraryProject, type LibrarySource, type MemoryType,
} from "@amc/contracts";
import { RpcError } from "../rpc/error";
import { secretShapeIn } from "../secret-shapes";
import { claudeSources } from "./agents/claude";
import { codexSources } from "./agents/codex";
import { cursorSources, geminiSources, hermesSources, openclawSources, opencodeSources } from "./agents/others";
import { realmSources } from "./agents/realm";
import { claudeFact, claudeFactFile, claudeIndexTarget, withClaudeIndexLine, withoutClaudeIndexLine } from "./claude-facts";
import { fieldOf, firstProse, readFrontmatter, short } from "./frontmatter";
import { commitFiles, revertCommit } from "./git";
import { knownFolders } from "./known-folders";
import { MEMORY_INDEX_FILE, wikiLinkTarget, withIndexLink, withoutIndexLink } from "./memory-index";
import { readOr, realOr, tildify, within } from "./paths";
import { projectRoot, projectsOf, type Project } from "./projects";
import { readRealmNames, realmDb } from "./realm-names";
import { backUp, writeFileAtomic } from "./safe-write";
import { MemorySearch } from "./search";
import type { Discovery, Source } from "./source";
import type { TagStore } from "./tags";

type LibraryDeps = {
  /** The home folder whose agent files are read. */
  home: string;
  /** Where a file is copied before the app changes or deletes it. */
  backups: string;
  tags: TagStore;
  trash: (path: string) => Promise<void>;
};

/** One file with what the list shows of it and what copies are matched on. */
export type HeldFile = {
  source: Source;
  entry: LibraryEntry;
  text: string;
  /** The text's hash, or null for an empty file: empty files are not copies of one another. */
  hash: string | null;
  /** The memory's name and the session it came from, which a copy keeps when its text is edited. */
  origin: string | null;
  real: string;
};

type Snapshot = { at: number; sources: Source[]; projects: Project[]; held: HeldFile[]; byId: Map<string, HeldFile> };

/** One file's text as a proposal would leave it (null: gone), and the hash of the text it was drawn from. */
export type Change = { id: string; baseHash: string; text: string | null };

/** What a change did, with what undoing it needs: the commit in a repository, the backup anywhere else. */
export type Applied =
  | { kind: "commit"; repo: string; sha: string }
  | { kind: "file"; path: string; backup: string; afterHash: string | null };

/** A file written this recently may still be in an agent's hands, so a proposal leaves it alone. */
export const HOLD_MS = 60 * 60_000;

export const textHash = (text: string): string => createHash("sha1").update(text).digest("hex");

/** How long a listing of the disk is reused. Long enough that a search typed letter by letter reads
 *  the files once, short enough that a file an agent just wrote is there on the next look. */
const SNAPSHOT_MS = 2_000;

/** Which copy of a memory a list of everything shows: the one in a repo, then Claude's own, and
 *  Realm's imported copy last. */
const copyRank = (s: Source): number => (s.repo !== null ? 0 : s.kind === "imported" ? 3 : s.kind === "project-memory" ? 1 : 2);

const notInLibrary = (what: string): RpcError => new RpcError("LIBRARY_FILE_NOT_FOUND", `${what} is not a file in the library`);

function refuseSecret(rel: string, text: string | null): void {
  const secret = text === null ? null : secretShapeIn(text);
  if (secret) throw new RpcError("LIBRARY_SECRET", `${rel} looks like it holds ${secret}. This repository can be pushed to a remote, so it never holds credentials.`);
}

function refuseLink(rel: string, abs: string): void {
  if (lstatSync(abs).isSymbolicLink()) throw new RpcError("LIBRARY_PATH", `${rel} is a link. Delete what it points at in the Finder.`);
}

/** What an index lists, by its link lines: `- [[x]]` in a repo's root, `- [X](x.md) — …` in a folder's
 *  and Claude's. A line that leads to another index is not a memory of its own. */
function memoriesListed(body: string): string {
  const n = body.split("\n").filter((l) => /^\s*[-*+]\s+\[/.test(l) && !/(?:^|[/[(])MEMORY(?:\.md)?(?:\]\]|\))/.test(l)).length;
  return n === 0 ? "No memories yet" : n === 1 ? "1 memory" : `${n} memories`;
}

/** An index after the memories of its own source and folder, the rest left in the order they came. */
function indexesAfterTheirMemories(entries: LibraryEntry[]): LibraryEntry[] {
  const out = entries.filter((e) => !e.index);
  for (const ix of entries.filter((e) => e.index)) {
    let last = -1;
    out.forEach((e, i) => { if (e.sourceId === ix.sourceId && e.folder === ix.folder) last = i; });
    const at = last >= 0 ? last + 1 : out.findIndex((e) => e.updatedAt < ix.updatedAt);
    out.splice(at < 0 ? out.length : at, 0, ix);
  }
  return out;
}

/**
 * The library: every Markdown memory and instruction file an agent on this Mac reads, listed by
 * where it is kept, and read, written, made and deleted through the rules of the place it is kept in.
 *
 * - **A git repository** (Realm's memory repos) takes every change as one commit, staged by path,
 *   with the folder's `MEMORY.md` kept in step: a line added for a new memory, rewritten for a renamed
 *   one, dropped for a deleted one.
 * - **Everything else** is a plain file. It is written only with the person's yes
 *   (`confirmExternal`), copied to the backup folder first, and deleted only to the Trash.
 *
 * Nothing is reachable but a file a discovered source lists: an id names a source and a path inside
 * it, the path is checked against that source's own listing, and its real path must stay inside the
 * source's folder, so a link cannot lead out of it.
 */
export class Library {
  private readonly finder = new MemorySearch();
  private snapshot: Snapshot | null = null;

  constructor(private d: LibraryDeps) {}

  // ─── What is on the disk ──────────────────────────────────────────────────────────────────────

  private current(): Snapshot {
    if (this.snapshot && Date.now() - this.snapshot.at < SNAPSHOT_MS) return this.snapshot;
    const names = readRealmNames(realmDb(this.d.home));
    const projects = projectsOf(knownFolders(this.d.home, names), this.d.home);
    const byRoot = new Map(projects.map((p) => [p.root, p]));
    const discovery: Discovery = { home: this.d.home, names, projects, projectAt: (folder) => byRoot.get(projectRoot(realOr(folder))) ?? null };
    const sources = [
      ...realmSources(discovery), ...claudeSources(discovery), ...codexSources(discovery), ...cursorSources(discovery),
      ...geminiSources(discovery), ...opencodeSources(discovery), ...hermesSources(discovery), ...openclawSources(discovery),
    ].filter((s) => s.files().length > 0 || s.folders().length > 0);

    const tags = this.d.tags.all();
    const held: HeldFile[] = [];
    for (const source of sources) {
      for (const rel of source.files()) {
        const abs = join(source.root, rel);
        const text = readOr(abs);
        if (text === null) continue;
        const st = statSync(abs, { throwIfNoEntry: false });
        if (!st) continue;
        const { fields } = readFrontmatter(text);
        const session = fieldOf(fields, "originSessionId", "metadata.originSessionId");
        const name = fieldOf(fields, "name");
        held.push({
          source, real: realOr(abs),
          entry: this.describe(source, rel, abs, text, st.mtimeMs, st.size, tags.get(libraryId(source.id, rel)) ?? []),
          text, hash: text.trim() === "" ? null : textHash(text),
          origin: session && name ? `${name}\n${session}` : null,
        });
      }
    }
    this.countCopies(held);
    this.snapshot = { at: Date.now(), sources, projects, held, byId: new Map(held.map((h) => [h.entry.id, h])) };
    return this.snapshot;
  }

  /** Mark how many files hold each text, and which of them a list of everything shows. A link and
   *  the file it points at are one file, not two copies. */
  private countCopies(held: HeldFile[]): void {
    const byHash = new Map<string, HeldFile[]>();
    const seenReal = new Set<string>();
    for (const h of held) {
      if (h.hash === null || seenReal.has(h.real)) continue;
      seenReal.add(h.real);
      byHash.set(h.hash, [...(byHash.get(h.hash) ?? []), h]);
    }
    for (const copies of byHash.values()) {
      if (copies.length === 1) continue;
      const first = [...copies].sort((a, b) => copyRank(a.source) - copyRank(b.source) || a.entry.path.localeCompare(b.entry.path))[0]!;
      for (const h of copies) { h.entry.copies = copies.length; h.entry.canonical = h === first; }
    }
  }

  private describe(s: Source, rel: string, abs: string, text: string, updatedAt: number, size: number, tags: string[]): LibraryEntry {
    const { fields, body } = readFrontmatter(text);
    const heading = /^#{1,6}\s+(.+)$/m.exec(body)?.[1]?.trim() ?? null;
    const name = basename(rel);
    const folder = s.folderOf?.(rel) ?? null;
    // Every folder's index is a MEMORY.md, so the name alone would draw them as one file many times.
    const index = s.kind !== "documents" && name === MEMORY_INDEX_FILE;
    const title = s.titleOf?.(rel)
      ?? (index ? (folder ? `Index · ${folder}` : "Index") : fieldOf(fields, "name") ?? heading ?? name.replace(/\.mdc?$/i, ""));
    return {
      id: libraryId(s.id, rel), sourceId: s.id, group: s.group, kind: s.kind, path: abs, rel, title,
      description: fieldOf(fields, "description") ?? (index ? memoriesListed(body) : firstProse(body)),
      type: fieldOf(fields, "type", "metadata.type"),
      folder, projectId: s.projectOf?.(rel) ?? s.projectId, index, updatedAt, size,
      copies: 1, canonical: true, tags, match: null,
    };
  }

  /** Every project agents have worked in, whether or not the library holds a file of it. */
  projects(): readonly Project[] {
    return this.current().projects;
  }

  projectAt(folder: string): Project | null {
    const root = projectRoot(realOr(folder));
    return this.current().projects.find((p) => p.root === root) ?? null;
  }

  // ─── Listing ──────────────────────────────────────────────────────────────────────────────────

  /** Every source that has files or can take a new one, the projects their files belong to, and the tags in use. */
  sources(): { sources: LibrarySource[]; projects: LibraryProject[]; tags: { tag: string; count: number }[] } {
    const now = this.current();
    const perSource = new Map<string, number>();
    const perProject = new Map<string, number>();
    const perTag = new Map<string, number>();
    for (const { entry } of now.held) {
      perSource.set(entry.sourceId, (perSource.get(entry.sourceId) ?? 0) + 1);
      if (entry.projectId && entry.canonical) perProject.set(entry.projectId, (perProject.get(entry.projectId) ?? 0) + 1);
      for (const tag of entry.tags) perTag.set(tag, (perTag.get(tag) ?? 0) + 1);
    }
    return {
      sources: now.sources.map((s) => ({
        id: s.id, group: s.group, kind: s.kind, label: s.label, path: s.path, projectId: s.projectId,
        external: s.repo === null, folders: s.folders(), count: perSource.get(s.id) ?? 0, by: s.by,
      })),
      projects: now.projects.filter((p) => perProject.has(p.id)).map((p) => ({ ...p, count: perProject.get(p.id)! })),
      tags: [...perTag].map(([tag, count]) => ({ tag, count })).sort((a, b) => a.tag.localeCompare(b.tag)),
    };
  }

  /**
   * The files a filter keeps, newest first; with a query, best match first. A list that names no
   * agent shows each memory once, however many copies of it there are.
   */
  list(filter: LibraryFilter): LibraryEntry[] {
    const now = this.current();
    const everything = filter.group === undefined && filter.kind === undefined;
    const kept = now.held.filter(({ entry }) =>
      (filter.group === undefined || entry.group === filter.group)
      && (filter.kind === undefined || entry.kind === filter.kind)
      && (filter.projectId === undefined || entry.projectId === filter.projectId)
      && (filter.tag === undefined || entry.tags.includes(filter.tag))
      && (!everything || entry.canonical));
    const entries = kept.map((h) => h.entry);
    const query = filter.query?.trim() ?? "";
    if (query === "") return indexesAfterTheirMemories([...entries].sort((a, b) => b.updatedAt - a.updatedAt || a.title.localeCompare(b.title)));

    const byPath = new Map(entries.map((e) => [e.path, e]));
    const out: LibraryEntry[] = [];
    const seen = new Set<string>();
    for (const hit of this.finder.searchFiles(kept.map((h) => ({ root: h.source.root, abs: h.entry.path })), query, 400)) {
      const entry = byPath.get(join(hit.repo, hit.path));
      if (!entry || seen.has(entry.id)) continue;
      seen.add(entry.id);
      out.push({ ...entry, match: hit.text });
    }
    // A word still being typed ("cam" on the way to "campaign") matches names before the ranking can.
    const typed = query.toLowerCase();
    for (const entry of entries) {
      if (seen.has(entry.id)) continue;
      if (entry.title.toLowerCase().includes(typed) || (entry.description ?? "").toLowerCase().includes(typed) || entry.rel.toLowerCase().includes(typed)) out.push(entry);
    }
    return out;
  }

  // ─── Reading ──────────────────────────────────────────────────────────────────────────────────

  read(id: string): LibraryFile {
    const now = this.current();
    const { held, abs } = this.resolve(id);
    const { source, entry } = held;
    const text = readFileSync(abs, "utf8");
    const { fields, body } = readFrontmatter(text);
    const note = source.lockedNote?.(entry.rel) ?? null;
    const isIndexOfRepo = source.repo !== null && entry.index;
    return {
      ...entry, displayPath: tildify(abs, this.d.home), text, body, frontmatter: fields,
      links: this.linksOf(source, entry.rel, body), readBy: source.by,
      otherCopies: now.held
        .filter((other) => other !== held && other.real !== held.real
          && ((held.hash !== null && other.hash === held.hash) || (held.origin !== null && other.origin === held.origin)))
        .map((other) => ({
          id: other.entry.id, where: `${LIBRARY_GROUP_LABEL[other.source.group]} · ${other.entry.folder ?? other.source.label}`,
          displayPath: tildify(other.entry.path, this.d.home), same: other.hash === held.hash,
        })),
      external: source.repo === null, writable: note === null, deletable: note === null && !isIndexOfRepo, note,
    };
  }

  /**
   * Each `[[link]]` and each relative `.md` link, with the file it opens. A `[[link]]` is read from
   * the source's root, as a repo's index writes them, and failing that from the file's own folder,
   * which is how one memory names another beside it. A relative link is read from the file's folder,
   * as Claude's index writes them.
   */
  private linksOf(s: Source, rel: string, body: string): LibraryFile["links"] {
    const files = new Set(s.files());
    const out = new Map<string, string | null>();
    const idOf = (target: string | null): string | null => (target !== null && files.has(target) ? libraryId(s.id, target) : null);
    for (const m of body.matchAll(/\[\[([^[\]\n]+)\]\]/g)) {
      if (out.has(m[1]!)) continue;
      const fromRoot = wikiLinkTarget(m[1]!);
      out.set(m[1]!, idOf(fromRoot) ?? idOf(fromRoot === null ? null : posix.normalize(posix.join(posix.dirname(rel), fromRoot))));
    }
    for (const m of body.matchAll(/\]\(([^)\s]+)\)/g)) {
      const href = m[1]!;
      if (out.has(href) || /^[a-z][a-z0-9+.-]*:|^[/#]/i.test(href) || !/\.mdc?$/i.test(href.split("#")[0]!)) continue;
      const target = posix.normalize(posix.join(posix.dirname(rel), href.split("#")[0]!));
      out.set(href, target.startsWith("..") ? null : idOf(target));
    }
    return [...out].map(([target, id]) => ({ target, id }));
  }

  private resolve(id: string): { held: HeldFile; abs: string } {
    const parsed = parseLibraryId(id);
    const held = parsed ? this.current().byId.get(id) : undefined;
    if (!parsed || !held) throw notInLibrary(id);
    if (isAbsolute(parsed.rel) || parsed.rel.split(/[\\/]/).some((part) => part === ".." || part.toLowerCase() === ".git")) {
      throw notInLibrary(parsed.rel);
    }
    const abs = join(held.source.root, parsed.rel);
    if (!within(realOr(abs), realOr(held.source.root))) throw new RpcError("LIBRARY_PATH", `${parsed.rel} leads outside ${held.source.path}`);
    return { held, abs };
  }

  // ─── Writing ──────────────────────────────────────────────────────────────────────────────────

  async write(id: string, text: string, confirmExternal = false): Promise<LibraryEntry> {
    const { held, abs } = this.resolve(id);
    const { source, entry } = held;
    this.mayChange(source, entry.rel, abs, confirmExternal, "write");
    if (text.length > LIBRARY_FILE_MAX) throw new RpcError("LIBRARY_FILE_TOO_LARGE", `a memory file is capped at ${LIBRARY_FILE_MAX} characters`);

    // A fact renamed or redescribed keeps its line in its folder's index saying so.
    const { fields } = readFrontmatter(text);
    const name = fieldOf(fields, "name");
    const hook = fieldOf(fields, "description");
    const dir = posix.dirname(entry.rel);
    const indexRel = dir === "." ? MEMORY_INDEX_FILE : `${dir}/${MEMORY_INDEX_FILE}`;
    const index = indexRel === entry.rel ? null : readOr(join(source.root, indexRel));
    const listed = index !== null && name !== null && hook !== null && index.split("\n").some((l) => claudeIndexTarget(l) === basename(entry.rel));
    const writes = new Map<string, string>([[entry.rel, text]]);
    if (listed) writes.set(indexRel, withClaudeIndexLine(index, basename(entry.rel), name, hook));

    await this.apply(source, writes, `Update ${entry.rel}`);
    return this.current().byId.get(id)!.entry;
  }

  /**
   * A new memory, in the format Claude keeps one in (`claudeFact`), with its line in the folder's
   * index: under `## Index` at a repo's top, a `- [Title](file.md) — hook` line anywhere else.
   */
  async create(o: { sourceId: string; folder: string; name: string; description: string; type: MemoryType; body: string; confirmExternal?: boolean }): Promise<LibraryEntry> {
    const source = this.current().sources.find((s) => s.id === o.sourceId);
    if (!source || !source.folders().some((f) => f.rel === o.folder)) throw new RpcError("LIBRARY_READ_ONLY", "new memories go in a memory folder the library lists");
    if (/[\r\n]/.test(o.name + o.description)) throw new RpcError("LIBRARY_ENTRY_INVALID", "a memory needs a one-line name and a one-line description");
    const file = claudeFactFile(o.name);
    const rel = o.folder === "" ? file : `${o.folder}/${file}`;
    if (existsSync(join(source.root, rel))) throw new RpcError("LIBRARY_EXISTS", `a memory named ${file} is already there. Open it, or choose another name.`);
    if (source.repo === null && !o.confirmExternal) throw this.unconfirmed(source, join(source.root, rel), "write");

    const indexRel = o.folder === "" ? MEMORY_INDEX_FILE : `${o.folder}/${MEMORY_INDEX_FILE}`;
    const index = readOr(join(source.root, indexRel)) ?? "";
    await this.apply(source, new Map([
      [rel, claudeFact({ name: o.name, description: o.description, type: o.type, body: o.body })],
      [indexRel, o.folder === "" && source.repo !== null ? withIndexLink(index, file) : withClaudeIndexLine(index, file, o.name, o.description)],
    ]), `Remember ${short(o.name)}`);
    return this.current().byId.get(libraryId(source.id, rel))!.entry;
  }

  async delete(id: string, confirmExternal = false): Promise<{ trashed: boolean }> {
    const { held, abs } = this.resolve(id);
    const { source, entry } = held;
    this.mayChange(source, entry.rel, abs, confirmExternal, "delete");
    const dir = posix.dirname(entry.rel);
    const folderIndexRel = dir === "." ? null : `${dir}/${MEMORY_INDEX_FILE}`;
    const folderIndex = folderIndexRel && folderIndexRel !== entry.rel ? readOr(join(source.root, folderIndexRel)) : null;
    const withoutLine = folderIndex === null ? null : withoutClaudeIndexLine(folderIndex, basename(entry.rel));

    if (source.repo !== null) {
      if (entry.index) throw new RpcError("LIBRARY_INDEX_WHOLE", "MEMORY.md is the index a session starts with. Edit it rather than delete it.");
      const writes = new Map<string, string | null>([[entry.rel, null]]);
      const rootIndex = readOr(join(source.root, MEMORY_INDEX_FILE));
      if (rootIndex !== null && withoutIndexLink(rootIndex, entry.rel) !== rootIndex) writes.set(MEMORY_INDEX_FILE, withoutIndexLink(rootIndex, entry.rel));
      if (withoutLine !== null && withoutLine !== folderIndex) writes.set(folderIndexRel!, withoutLine);
      await this.apply(source, writes, `Forget ${entry.rel}`);
      this.d.tags.forget(id);
      return { trashed: false };
    }
    refuseLink(entry.rel, abs);
    backUp(abs, this.d.backups);
    await this.d.trash(abs);
    this.snapshot = null;
    if (withoutLine !== null && withoutLine !== folderIndex) await this.apply(source, new Map([[folderIndexRel!, withoutLine]]), "");
    this.d.tags.forget(id);
    return { trashed: true };
  }

  /** Outside a repository, a link is written through to the file it points at. */
  private async apply(source: Source, writes: ReadonlyMap<string, string | null>, message: string): Promise<void> {
    if (source.repo !== null) {
      for (const [rel, text] of writes) refuseSecret(rel, text);
      await commitFiles(source.repo, writes, message);
    } else {
      for (const [rel, text] of writes) {
        const target = realOr(join(source.root, rel));
        if (existsSync(target)) backUp(target, this.d.backups);
        writeFileAtomic(target, text ?? "");
      }
    }
    this.snapshot = null;
  }

  /** Every file with its text, for the rules that look across the whole library. */
  inspect(): readonly HeldFile[] {
    return this.current().held;
  }

  /** Read the disk again on the next look, for a caller that must not act on a listing a moment old. */
  refresh(): void {
    this.snapshot = null;
  }

  /**
   * What removing memories takes: each file gone, its line dropped from its folder's index and, in a
   * repository, its link dropped from the index at the top. Memories of one folder share one change
   * to that folder's index.
   */
  removals(ids: readonly string[]): Change[] {
    const { byId } = this.current();
    const gone: Change[] = [];
    const indexes = new Map<string, { index: HeldFile; text: string }>();
    const editIndex = (sourceId: string, rel: string, edit: (text: string) => string): void => {
      const index = byId.get(libraryId(sourceId, rel));
      if (!index) return;
      indexes.set(index.entry.id, { index, text: edit(indexes.get(index.entry.id)?.text ?? index.text) });
    };
    for (const id of ids) {
      const held = byId.get(id);
      if (!held) throw notInLibrary(id);
      const { source, entry } = held;
      gone.push({ id, baseHash: textHash(held.text), text: null });
      const dir = posix.dirname(entry.rel);
      if (dir !== ".") editIndex(source.id, `${dir}/${MEMORY_INDEX_FILE}`, (text) => withoutClaudeIndexLine(text, basename(entry.rel)));
      if (source.repo !== null) editIndex(source.id, MEMORY_INDEX_FILE, (text) => withoutIndexLink(text, entry.rel));
    }
    const removed = new Set(ids);
    const edited = [...indexes.values()].filter(({ index, text }) => text !== index.text && !removed.has(index.entry.id))
      .map(({ index, text }) => ({ id: index.entry.id, baseHash: textHash(index.text), text }));
    return [...gone, ...edited];
  }

  /**
   * Apply an approved proposal: each file's text replaced or the file removed, as one commit per
   * repository and, elsewhere, a backup followed by an atomic replace or a move to the Trash.
   * Approving is the person's yes, so nothing is asked again here. A file that has changed since the
   * proposal was drawn up, or that was written within the last hour, stops the whole proposal before
   * anything is touched.
   */
  async applyChanges(changes: readonly Change[], message: string, now = Date.now()): Promise<Applied[]> {
    const resolved = changes.map((change) => ({ change, ...this.resolve(change.id) }));
    for (const { change, held, abs } of resolved) {
      const { source, entry } = held;
      const note = source.lockedNote?.(entry.rel);
      if (note) throw new RpcError("LIBRARY_READ_ONLY", note);
      const onDisk = readOr(abs);
      if (onDisk === null || textHash(onDisk) !== change.baseHash) throw new RpcError("REVIEW_STALE", `${entry.title} has changed since this was proposed. Scan again.`);
      if (now - statSync(abs).mtimeMs < HOLD_MS) throw new RpcError("REVIEW_FILE_BUSY", `${entry.title} was written in the last hour, and an agent may still be working with it. Try again later.`);
      if (change.text === null && source.repo === null) refuseLink(entry.rel, abs);
    }

    const applied: Applied[] = [];
    const byRepo = new Map<string, Map<string, string | null>>();
    for (const { change, held } of resolved) {
      const { repo } = held.source;
      if (repo === null) continue;
      refuseSecret(held.entry.rel, change.text);
      byRepo.set(repo, (byRepo.get(repo) ?? new Map()).set(held.entry.rel, change.text));
    }
    for (const [repo, writes] of byRepo) applied.push({ kind: "commit", repo, ...(await commitFiles(repo, writes, message)) });
    for (const { change, held, abs } of resolved) {
      if (held.source.repo !== null) continue;
      const path = realOr(abs);
      const backup = backUp(path, this.d.backups);
      if (change.text === null) await this.d.trash(path);
      else writeFileAtomic(path, change.text);
      applied.push({ kind: "file", path, backup, afterHash: change.text === null ? null : textHash(change.text) });
    }
    for (const { change } of resolved) if (change.text === null) this.d.tags.forget(change.id);
    this.snapshot = null;
    return applied;
  }

  /**
   * Put back what `applyChanges` did: a commit is reverted with a new commit; a plain file gets its
   * backup back, but only if it is still exactly as the change left it. Checked for every file before
   * any is restored.
   */
  async undo(applied: readonly Applied[]): Promise<void> {
    for (const done of applied) {
      if (done.kind !== "file") continue;
      const onDisk = readOr(done.path);
      const untouched = done.afterHash === null ? onDisk === null : onDisk !== null && textHash(onDisk) === done.afterHash;
      if (!untouched) throw new RpcError("REVIEW_UNDO_BLOCKED", `${tildify(done.path, this.d.home)} has changed since, so it was left as it is. Its earlier text is in ${tildify(done.backup, this.d.home)}.`);
    }
    for (const done of applied) {
      if (done.kind === "commit") await revertCommit(done.repo, done.sha);
      else writeFileAtomic(done.path, readFileSync(done.backup, "utf8"));
    }
    this.snapshot = null;
  }

  /** The refusals before any change: a file its owner manages, or a plain file the person has not said yes to. */
  private mayChange(source: Source, rel: string, abs: string, confirmed: boolean, verb: "write" | "delete"): void {
    const note = source.lockedNote?.(rel);
    if (note) throw new RpcError("LIBRARY_READ_ONLY", note);
    if (source.repo === null && !confirmed) throw this.unconfirmed(source, abs, verb);
  }

  private unconfirmed(source: Source, abs: string, verb: "write" | "delete"): RpcError {
    return new RpcError(LIBRARY_EXTERNAL_UNCONFIRMED, `${tildify(abs, this.d.home)} is ${LIBRARY_GROUP_LABEL[source.group]}'s own file. ${verb === "write" ? "Writing" : "Deleting"} it needs your yes first.`);
  }

  setTags(id: string, tags: readonly string[]): string[] {
    this.resolve(id);
    const kept = this.d.tags.set(id, tags);
    this.snapshot = null;
    return kept;
  }
}
