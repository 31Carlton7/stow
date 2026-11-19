import { z } from "zod";

/*
 * The library: every Markdown memory and instruction file an agent on this Mac reads, in one place.
 * A file is named by its source and its path inside that source, never by an absolute path, so
 * nothing outside a discovered source can be asked for.
 */

/** Whose files a source holds. */
export const LibraryGroupSchema = z.enum(["realm", "claude", "codex", "cursor", "gemini", "opencode", "hermes", "openclaw"]);
export type LibraryGroup = z.infer<typeof LibraryGroupSchema>;

export const LIBRARY_GROUP_LABEL: Record<LibraryGroup, string> = {
  realm: "Realm", claude: "Claude", codex: "Codex", cursor: "Cursor", gemini: "Gemini",
  opencode: "opencode", hermes: "Hermes", openclaw: "OpenClaw",
};

/** What a source's files are to the agent that reads them. Sources of one group and kind are listed
 *  as one row: every project's `CLAUDE.md` under "Project instructions". */
export const LibraryKindSchema = z.enum(["memory", "project-memory", "documents", "imported", "instructions", "project-instructions", "rules", "project-rules"]);
export type LibraryKind = z.infer<typeof LibraryKindSchema>;

export const LIBRARY_KIND_LABEL: Record<LibraryKind, string> = {
  memory: "Memory", "project-memory": "Project memory", documents: "Memory documents", imported: "Imported copies",
  instructions: "Instructions", "project-instructions": "Project instructions", rules: "Rules", "project-rules": "Project rules",
};

/** The `type` a new memory is filed under: Claude's own four. */
export const MemoryTypeSchema = z.enum(["user", "feedback", "project", "reference"]);
export type MemoryType = z.infer<typeof MemoryTypeSchema>;

/** A folder agents have worked in. Worktrees of one repository are one project. */
export const LibraryProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Absolute. */
  root: z.string(),
  /** How many library files belong to it. */
  count: z.number().int(),
});
export type LibraryProject = z.infer<typeof LibraryProjectSchema>;

/**
 * One place files are kept. `by` says who loads them, in a sentence. `external` is a file this app
 * does not manage a history for: writing or deleting one asks first, and a deleted one goes to the
 * Trash. A source that is not `external` is a git repository, where every change is one commit.
 */
export const LibrarySourceSchema = z.object({
  id: z.string(),
  group: LibraryGroupSchema,
  kind: LibraryKindSchema,
  label: z.string(),
  /** The folder the source's files are under, or its one file. */
  path: z.string(),
  projectId: z.string().nullable(),
  external: z.boolean(),
  /** The folders a new memory can be made in, each by its path from the source's root. Empty where
   *  none can. */
  folders: z.array(z.object({ rel: z.string(), label: z.string() })),
  count: z.number().int(),
  by: z.string(),
});
export type LibrarySource = z.infer<typeof LibrarySourceSchema>;

/** One file as the list shows it. `id` is `<sourceId>:<path from the source's root>`. */
export const LibraryEntrySchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  group: LibraryGroupSchema,
  kind: LibraryKindSchema,
  /** Absolute, for Show in Finder. */
  path: z.string(),
  /** From the source's root. */
  rel: z.string(),
  /** Frontmatter `name`, else the first heading, else the file's name. */
  title: z.string(),
  /** Frontmatter `description`, else the first line of prose; null for an empty file. */
  description: z.string().nullable(),
  /** Frontmatter `type` (or `metadata.type`, where Claude keeps it). */
  type: z.string().nullable(),
  /** Where in its source it sits, when that says something: a space's folder of a repo, a Claude project. */
  folder: z.string().nullable(),
  projectId: z.string().nullable(),
  /** A folder's index of memories (its `MEMORY.md`). */
  index: z.boolean(),
  updatedAt: z.number(),
  size: z.number().int(),
  /** How many files on this Mac hold exactly this text, this one included. */
  copies: z.number().int(),
  /** Of a set of copies, the one a list of everything shows. */
  canonical: z.boolean(),
  tags: z.array(z.string()),
  /** A search's best line in the file, when the list was searched. */
  match: z.string().nullable(),
});
export type LibraryEntry = z.infer<typeof LibraryEntrySchema>;

/** One file, read whole. */
export const LibraryFileSchema = LibraryEntrySchema.extend({
  /** `path` from the home folder (`~/…`) when it is under it. */
  displayPath: z.string(),
  /** The whole file, frontmatter included: what the editor edits. */
  text: z.string(),
  /** The file after its frontmatter: what the reader renders. */
  body: z.string(),
  /** The frontmatter's fields in file order, a nested one as `metadata.type`. */
  frontmatter: z.array(z.object({ key: z.string(), value: z.string() })),
  /** Each `[[link]]` and relative `.md` link in the body, as written, with the file it opens (null
   *  when it leads nowhere the library knows). */
  links: z.array(z.object({ target: z.string(), id: z.string().nullable() })),
  /** Who loads it, in a sentence. */
  readBy: z.string(),
  /** The other files that hold this memory: the same text, or the same name from the same session
   *  with text that has since changed. */
  otherCopies: z.array(z.object({ id: z.string(), where: z.string(), displayPath: z.string(), same: z.boolean() })),
  external: z.boolean(),
  writable: z.boolean(),
  deletable: z.boolean(),
  /** Why it cannot be edited or deleted here. */
  note: z.string().nullable(),
});
export type LibraryFile = z.infer<typeof LibraryFileSchema>;

/** Refused because the file is one this app keeps no history for and the call did not say the person agreed. */
export const LIBRARY_EXTERNAL_UNCONFIRMED = "LIBRARY_EXTERNAL_UNCONFIRMED";

/** A memory file is capped where Realm caps its own. */
export const LIBRARY_FILE_MAX = 100_000;

export const libraryId = (sourceId: string, rel: string): string => `${sourceId}:${rel}`;

/** An id's two halves, or null when it is not one. */
export function parseLibraryId(id: string): { sourceId: string; rel: string } | null {
  const at = id.indexOf(":");
  if (at <= 0 || at === id.length - 1) return null;
  return { sourceId: id.slice(0, at), rel: id.slice(at + 1) };
}

const IdSchema = z.string().min(3).max(2000);
const TagSchema = z.string().trim().min(1).max(40).regex(/^[^\s,]+$/, "a tag is one word");

export const LibraryFilterSchema = z.object({
  group: LibraryGroupSchema.optional(),
  kind: LibraryKindSchema.optional(),
  projectId: z.string().optional(),
  tag: z.string().optional(),
  query: z.string().max(500).optional(),
});
export type LibraryFilter = z.infer<typeof LibraryFilterSchema>;

export const LibraryMethods = {
  "library.sources": {
    params: z.object({}),
    result: z.object({ sources: z.array(LibrarySourceSchema), projects: z.array(LibraryProjectSchema), tags: z.array(z.object({ tag: z.string(), count: z.number().int() })) }),
  },
  "library.list": { params: LibraryFilterSchema, result: z.object({ entries: z.array(LibraryEntrySchema) }) },
  "library.read": { params: z.object({ id: IdSchema }), result: LibraryFileSchema },
  "library.write": { params: z.object({ id: IdSchema, text: z.string().max(LIBRARY_FILE_MAX), confirmExternal: z.boolean().optional() }), result: LibraryEntrySchema },
  "library.create": {
    params: z.object({
      sourceId: z.string(), folder: z.string(),
      name: z.string().trim().min(1).max(120), description: z.string().trim().min(1).max(300),
      type: MemoryTypeSchema, body: z.string().max(LIBRARY_FILE_MAX), confirmExternal: z.boolean().optional(),
    }),
    result: LibraryEntrySchema,
  },
  "library.delete": { params: z.object({ id: IdSchema, confirmExternal: z.boolean().optional() }), result: z.object({ trashed: z.boolean() }) },
  "library.setTags": { params: z.object({ id: IdSchema, tags: z.array(TagSchema).max(20) }), result: z.object({ tags: z.array(z.string()) }) },
} as const;
