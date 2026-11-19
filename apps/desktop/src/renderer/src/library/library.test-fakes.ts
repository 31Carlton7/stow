import {
  LIBRARY_EXTERNAL_UNCONFIRMED, LIBRARY_GROUP_LABEL, libraryId,
  type LibraryEntry, type LibraryFile, type LibraryFilter, type LibraryProject, type LibrarySource,
} from "@amc/contracts";
import { RpcError } from "../rpc/client";
import type { LibraryRpc } from "./use-library";

export const fakeSource = (o: Partial<LibrarySource> & Pick<LibrarySource, "id" | "group" | "kind" | "label">): LibrarySource => ({
  path: `/home/${o.id}`, projectId: null, external: o.group !== "realm", folders: [], count: 0, by: `${o.label} is loaded.`, ...o,
});

export const fakeFile = (o: Partial<LibraryFile> & Pick<LibraryFile, "sourceId" | "rel" | "title" | "group" | "kind">): LibraryFile => ({
  id: libraryId(o.sourceId, o.rel), path: `/home/${o.rel}`, displayPath: `~/${o.rel}`, description: null, type: null, folder: null, projectId: null,
  index: false, updatedAt: Date.now() - 3_600_000, size: (o.text ?? o.body ?? "x").length, copies: 1, canonical: true, tags: [], match: null,
  text: o.body ?? "", body: "", frontmatter: [], links: [], readBy: "An agent loads it.", otherCopies: [],
  external: o.group !== "realm", writable: true, deletable: true, note: null, ...o,
});

const entryOf = (f: LibraryFile): LibraryEntry => ({
  id: f.id, sourceId: f.sourceId, group: f.group, kind: f.kind, path: f.path, rel: f.rel, title: f.title, description: f.description, type: f.type,
  folder: f.folder, projectId: f.projectId, index: f.index, updatedAt: f.updatedAt, size: f.size, copies: f.copies, canonical: f.canonical, tags: f.tags, match: f.match,
});

/**
 * The library's server, held in memory: it lists, reads and changes the files it was given by the
 * contract's rules that the window depends on. A plain file refuses a change that does not say the
 * person agreed, and a list that names no agent shows each memory once.
 */
export function fakeLibraryServer(seed: { sources: LibrarySource[]; files: LibraryFile[]; projects?: LibraryProject[] }) {
  const sources = seed.sources;
  let files = [...seed.files];
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  /** Answers to `library.list` wait here while a test holds them. */
  let gate: Promise<void> = Promise.resolve();

  const unconfirmed = (path: string, group: LibraryFile["group"], verb: string) =>
    new RpcError(LIBRARY_EXTERNAL_UNCONFIRMED, `${path} is ${LIBRARY_GROUP_LABEL[group]}'s own file. ${verb} it needs your yes first.`);
  const find = (id: string): LibraryFile => {
    const file = files.find((f) => f.id === id);
    if (!file) throw new RpcError("LIBRARY_FILE_NOT_FOUND", `${id} is not a file in the library`);
    return file;
  };
  const listed = (filter: LibraryFilter): LibraryEntry[] => {
    const everything = filter.group === undefined && filter.kind === undefined;
    const words = filter.query?.trim().toLowerCase() ?? "";
    return files
      .filter((f) => (filter.group === undefined || f.group === filter.group) && (filter.kind === undefined || f.kind === filter.kind)
        && (filter.projectId === undefined || f.projectId === filter.projectId) && (filter.tag === undefined || f.tags.includes(filter.tag))
        && (!everything || f.canonical) && (words === "" || `${f.title}\n${f.text}`.toLowerCase().includes(words)))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((f) => ({ ...entryOf(f), match: words ? f.text.split("\n").find((line) => line.toLowerCase().includes(words)) ?? null : null }));
  };

  const answer = async (method: string, params: Record<string, unknown>): Promise<unknown> => {
    calls.push({ method, params });
    switch (method) {
      case "system.info": return { version: "0.1.0", home: "/data", sourceHome: "/home", schemaVersion: 1 };
      case "library.sources": {
        const tags = new Map<string, number>();
        for (const f of files) for (const tag of f.tags) tags.set(tag, (tags.get(tag) ?? 0) + 1);
        return {
          sources: sources.map((s) => ({ ...s, count: files.filter((f) => f.sourceId === s.id).length })),
          projects: (seed.projects ?? []).map((p) => ({ ...p, count: files.filter((f) => f.projectId === p.id && f.canonical).length })),
          tags: [...tags].map(([tag, count]) => ({ tag, count })).sort((a, b) => a.tag.localeCompare(b.tag)),
        };
      }
      case "library.list": await gate; return { entries: listed(params) };
      case "library.read": return find(params.id as string);
      case "library.write": {
        const file = find(params.id as string);
        if (file.external && !params.confirmExternal) throw unconfirmed(file.displayPath, file.group, "Writing");
        const text = params.text as string;
        files = files.map((f) => (f.id === file.id ? { ...f, text, body: text, updatedAt: Date.now() } : f));
        return entryOf(find(file.id));
      }
      case "library.create": {
        const source = sources.find((s) => s.id === params.sourceId)!;
        const name = params.name as string;
        const rel = `${params.folder ? `${params.folder as string}/` : ""}${name.toLowerCase().replace(/\s+/g, "-")}.md`;
        if (source.external && !params.confirmExternal) throw unconfirmed(`${source.path}/${rel}`, source.group, "Writing");
        const made: LibraryFile = {
          ...files[0]!, id: libraryId(source.id, rel), sourceId: source.id, group: source.group, kind: source.kind, rel, path: `${source.path}/${rel}`,
          displayPath: `~/${rel}`, title: name, description: params.description as string, type: params.type as string, body: params.body as string,
          text: params.body as string, frontmatter: [], links: [], otherCopies: [], tags: [], external: source.external, writable: true, deletable: true,
          note: null, copies: 1, canonical: true, index: false, updatedAt: Date.now(), projectId: null, folder: null, size: 1,
        };
        files = [...files, made];
        return entryOf(made);
      }
      case "library.delete": {
        const file = find(params.id as string);
        if (file.external && !params.confirmExternal) throw unconfirmed(file.displayPath, file.group, "Deleting");
        files = files.filter((f) => f.id !== file.id);
        return { trashed: file.external };
      }
      case "library.setTags": {
        const tags = [...new Set((params.tags as string[]).map((t) => t.toLowerCase()))].sort();
        files = files.map((f) => (f.id === params.id ? { ...f, tags } : f));
        return { tags };
      }
      default: throw new RpcError("METHOD_NOT_FOUND", method);
    }
  };

  return {
    rpc: { call: answer } as unknown as LibraryRpc,
    calls,
    callsTo: (method: string) => calls.filter((c) => c.method === method).map((c) => c.params),
    file: (id: string) => files.find((f) => f.id === id),
    /** Hold every list answer from now until the returned function is called. */
    holdLists(): () => void {
      let release = () => {};
      gate = new Promise((resolve) => { release = resolve; });
      return release;
    },
    /** Something outside the app changed the disk. */
    add(file: LibraryFile): void { files = [...files, file]; },
  };
}

export type FakeLibraryServer = ReturnType<typeof fakeLibraryServer>;
