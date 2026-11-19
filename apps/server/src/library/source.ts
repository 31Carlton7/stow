import type { LibraryGroup, LibraryKind } from "@amc/contracts";
import type { Project } from "./projects";
import type { RealmNames } from "./realm-names";

/** One place files are kept. */
export type Source = {
  id: string;
  group: LibraryGroup;
  kind: LibraryKind;
  label: string;
  /** What the person is shown: the folder, or the one file. */
  path: string;
  /** The folder every file's path is from. */
  root: string;
  files: () => string[];
  /** The project all of its files belong to, where it is one project's. */
  projectId: string | null;
  /** The project one file belongs to, in a source that spans several. */
  projectOf?: (rel: string) => string | null;
  /** Where in the source a file sits, when that says something. */
  folderOf?: (rel: string) => string | null;
  /** A file's title, where its own text does not give the right one. */
  titleOf?: (rel: string) => string | null;
  /** The git repository its files are committed to, or null for plain files. */
  repo: string | null;
  /** The folders a new memory can be made in. */
  folders: () => { rel: string; label: string }[];
  /** Why a file cannot be changed here, or null when it can. */
  lockedNote?: (rel: string) => string | null;
  by: string;
};

export type Discovery = {
  home: string;
  names: RealmNames;
  projects: readonly Project[];
  /** The project a folder is in, or null when it is in none the library knows. */
  projectAt: (folder: string) => Project | null;
};

export const MD = /\.md$/i;
export const RULES = /\.mdc?$/i;

/** A listing worked out once per source object. Sources are built afresh for each snapshot, so it is never stale. */
export const once = <T>(list: () => T): (() => T) => {
  let held: { value: T } | null = null;
  return () => (held ??= { value: list() }).value;
};

/** A source of plain files nobody can add a memory to. */
export function plainSource(s: Omit<Source, "repo" | "folders" | "projectId"> & { projectId?: string | null }): Source {
  return { repo: null, folders: () => [], projectId: null, ...s, files: once(s.files) };
}
