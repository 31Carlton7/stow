import { z } from "zod";

/*
 * Sessions: every agent's transcripts, indexed where they lie. Nothing is copied: the index holds
 * where a session's file is, what a first look at it found, and what a slower second look measured.
 * A transcript's text is read from its own file only when the session is opened.
 */

/** Whose transcript format the file is in. A Realm session is one of these too: Realm drives the agent's own CLI. */
export const SessionAgentSchema = z.enum(["claude", "codex"]);
export type SessionAgent = z.infer<typeof SessionAgentSchema>;

/**
 * Who was on the other end. `person`: someone typing into the agent's own terminal or app. `app`:
 * another app holding the conversation for a person (Realm, an editor). `one-shot`: a program that
 * asked once and left. `sub-agent`: a session another session started.
 */
export const SessionOriginSchema = z.enum(["person", "app", "one-shot", "sub-agent"]);
export type SessionOrigin = z.infer<typeof SessionOriginSchema>;

/** What the second, slower look measured. Counts are of the whole file. */
export const SessionMetricsSchema = z.object({
  userTurns: z.number().int(),
  assistantTurns: z.number().int(),
  toolCalls: z.number().int(),
  toolErrors: z.number().int(),
  inputTokens: z.number().int().nullable(),
  outputTokens: z.number().int().nullable(),
  /** What the agent itself recorded the session cost, where it records one. */
  costUsd: z.number().nullable(),
});
export type SessionMetrics = z.infer<typeof SessionMetricsSchema>;

/** What Realm knows of a session it drove, read from Realm's own database when that can be read. */
export const RealmSessionSchema = z.object({ title: z.string().nullable(), space: z.string().nullable(), teammate: z.string().nullable() });
export type RealmSession = z.infer<typeof RealmSessionSchema>;

export const SessionSchema = z.object({
  id: z.string(),
  agent: SessionAgentSchema,
  origin: SessionOriginSchema,
  /** The app on the other end when `origin` is `app`: "Realm", "Claude Desktop", "VS Code". */
  drivenBy: z.string().nullable(),
  /** The agent's own title for it, else the first thing asked, cut to a line. */
  title: z.string(),
  projectId: z.string().nullable(),
  projectName: z.string().nullable(),
  /** The folder it ran in, from the home folder when it is under it. */
  cwd: z.string().nullable(),
  model: z.string().nullable(),
  startedAt: z.number(),
  /** When the file was last written. */
  endedAt: z.number(),
  sizeBytes: z.number().int(),
  /** Null until the second look has reached this file. */
  metrics: SessionMetricsSchema.nullable(),
  /** The session that started this one, when it is a sub-agent. */
  parentId: z.string().nullable(),
  /** How many sub-agents it started. */
  children: z.number().int(),
  realm: RealmSessionSchema.nullable(),
  /** Absolute path of the transcript, for Show in Finder, and the same from the home folder. */
  path: z.string(),
  displayPath: z.string(),
});
export type Session = z.infer<typeof SessionSchema>;

/** How the list is narrowed. With no `origins` it is the conversations a person had: `person` and `app`. */
export const SessionFilterSchema = z.object({
  agent: SessionAgentSchema.optional(),
  projectId: z.string().optional(),
  origins: z.array(SessionOriginSchema).optional(),
  /** Only the sub-agents of this session. */
  parentId: z.string().optional(),
  /** Words every one of which is in the title, the project or the folder. */
  query: z.string().max(200).optional(),
  /** Only what the person has starred, whoever was on the other end. */
  favorites: z.boolean().optional(),
});
export type SessionFilter = z.infer<typeof SessionFilterSchema>;

export const SessionFacetsSchema = z.object({
  /** Every session the index holds, whatever the filter. */
  total: z.number().int(),
  /** The conversations a person had (`person` and `app`), by whose format they are in. */
  agents: z.array(z.object({ agent: SessionAgentSchema, count: z.number().int() })),
  /** Every session, by who was on the other end. */
  origins: z.array(z.object({ origin: SessionOriginSchema, count: z.number().int() })),
  /** Projects with a conversation a person had, most recent first, each with how many. */
  projects: z.array(z.object({ id: z.string(), name: z.string(), count: z.number().int() })),
});
export type SessionFacets = z.infer<typeof SessionFacetsSchema>;

/** How far the index has got. `listing` is the first look at each file; `measuring` is the second. */
export const SessionIndexStatusSchema = z.object({
  state: z.enum(["idle", "listing", "measuring", "paused"]),
  files: z.number().int(),
  listed: z.number().int(),
  measured: z.number().int(),
  /** Why the second look is waiting: "on battery", "the Mac is busy". Null unless `paused`. */
  pausedWhy: z.string().nullable(),
});
export type SessionIndexStatus = z.infer<typeof SessionIndexStatusSchema>;

const BlockBase = { at: z.number().nullable() };
/** A long text is cut to what a window can draw; `cut` says how many characters were left out. */
const Text = { text: z.string(), cut: z.number().int() };

/**
 * One thing in a transcript, in the order it happened, the same shape whichever agent wrote the file.
 * `note` is what the agent's own machinery put in: a compaction, a hook's output, a change of model.
 */
export const SessionBlockSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user"), ...BlockBase, ...Text }),
  z.object({ kind: z.literal("assistant"), ...BlockBase, ...Text, model: z.string().nullable() }),
  z.object({ kind: z.literal("thinking"), ...BlockBase, ...Text }),
  z.object({
    kind: z.literal("tool"), ...BlockBase,
    name: z.string(),
    /** What it was called with, as JSON or as the command line, cut like any text. */
    input: z.string(), inputCut: z.number().int(),
    /** What came back, or null when the file holds no result for the call. */
    output: z.string().nullable(), outputCut: z.number().int(),
    failed: z.boolean(),
  }),
  z.object({ kind: z.literal("note"), ...BlockBase, label: z.string(), ...Text }),
]);
export type SessionBlock = z.infer<typeof SessionBlockSchema>;

/** One file a session had in its context when it started or picked up along the way. */
export const SessionContextFileSchema = z.object({
  /** What it was loaded as: "Instructions", "Memory", "Skill list", "MCP instructions". */
  role: z.string(),
  displayPath: z.string(),
  chars: z.number().int(),
  /** The same file in the library now, when it is still there. */
  libraryId: z.string().nullable(),
  /** Whether the file now reads differently from what the session loaded. Null when the transcript did not keep the text. */
  changedSince: z.boolean().nullable(),
});
export type SessionContextFile = z.infer<typeof SessionContextFileSchema>;

export const SessionContextSchema = z.object({
  files: z.array(SessionContextFileSchema),
  /** True when the transcript itself records what was loaded; false when it is worked out from where the session ran. */
  recorded: z.boolean(),
  /** Characters of context loaded before the person's first word. */
  chars: z.number().int(),
});
export type SessionContext = z.infer<typeof SessionContextSchema>;

const SessionId = z.string().min(1).max(200);

export const SessionMethods = {
  "sessions.list": {
    params: z.object({ filter: SessionFilterSchema.default({}), limit: z.number().int().min(1).max(500).default(200), offset: z.number().int().min(0).default(0) }),
    /** Newest first. `matched` is how many the filter keeps in all. */
    result: z.object({ sessions: z.array(SessionSchema), matched: z.number().int() }),
  },
  "sessions.facets": { params: z.object({}), result: SessionFacetsSchema },
  "sessions.status": { params: z.object({}), result: SessionIndexStatusSchema },
  "sessions.get": { params: z.object({ id: SessionId }), result: SessionSchema },
  /** A stretch of one transcript. `next` is what to pass as `cursor` for the stretch after it, or null at the end. */
  "sessions.read": {
    params: z.object({ id: SessionId, cursor: z.string().max(100).optional(), limit: z.number().int().min(1).max(400).default(120) }),
    result: z.object({ blocks: z.array(SessionBlockSchema), next: z.string().nullable() }),
  },
  "sessions.context": { params: z.object({ id: SessionId }), result: SessionContextSchema },
} as const;
