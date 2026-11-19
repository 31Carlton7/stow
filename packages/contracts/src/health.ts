import { z } from "zod";
import { FindingTypeSchema } from "./review";
import { SessionAgentSchema } from "./sessions";

/*
 * Health: measures of what agents carry and keep, each one a count of something on disk or in a
 * transcript. There is no score, and nothing here says a file made a session better or worse: what
 * can be counted is how much a session loaded and how many sessions loaded a file.
 */

/** What a loaded thing was loaded as. `hooks` is text a hook put in front of the model. */
export const HealthKindSchema = z.enum(["instructions", "memory", "skills", "mcp", "hooks"]);
export type HealthKind = z.infer<typeof HealthKindSchema>;

export const HEALTH_KIND_LABEL: Record<HealthKind, string> = {
  instructions: "Instructions", memory: "Memory", skills: "Skills list", mcp: "MCP instructions", hooks: "Hook output",
};

/** Characters to a token, for an estimate that is said to be one. English prose runs near four. */
export const CHARS_PER_TOKEN = 4;

/** How far the reading of recent sessions' context has got. */
export const HealthPassSchema = z.object({
  state: z.enum(["idle", "reading", "paused"]),
  /** The recent conversations the measures are over, and how many of them have been read. */
  sessions: z.number().int(),
  read: z.number().int(),
  /** Why the reading is waiting: "on battery", "the Mac is busy". Null unless `paused`. */
  pausedWhy: z.string().nullable(),
});
export type HealthPass = z.infer<typeof HealthPassSchema>;

/** What one agent's recent sessions loaded, as a mean per session that loaded anything. */
export const HealthCarriedSchema = z.object({
  agent: SessionAgentSchema,
  /** Sessions that loaded something, and those that loaded (or recorded) nothing and are left out of the mean. */
  sessions: z.number().int(),
  empty: z.number().int(),
  /** True when the transcripts record what was loaded; false when it is worked out from the files as they are today. */
  recorded: z.boolean(),
  chars: z.number().int(),
  kinds: z.array(z.object({ kind: HealthKindSchema, chars: z.number().int() })),
});
export type HealthCarried = z.infer<typeof HealthCarriedSchema>;

/** One thing sessions loaded. `libraryId` is null for what is no file the library holds. */
export const HealthContributorSchema = z.object({
  agent: SessionAgentSchema,
  kind: HealthKindSchema,
  label: z.string(),
  libraryId: z.string().nullable(),
  /** Its size as last loaded, and how many of the recent sessions loaded it. */
  chars: z.number().int(),
  sessions: z.number().int(),
});
export type HealthContributor = z.infer<typeof HealthContributorSchema>;

export const HealthReachSchema = z.object({
  findings: z.number().int(),
  /** The library files the findings are about, and the characters in them. */
  files: z.number().int(),
  chars: z.number().int(),
  /** Recent sessions that loaded at least one of those files. */
  sessions: z.number().int(),
  /** The findings whose files the most recent sessions loaded, most first. */
  widest: z.array(z.object({ fingerprint: z.string(), type: FindingTypeSchema, title: z.string(), sessions: z.number().int() })),
});
export type HealthReach = z.infer<typeof HealthReachSchema>;

/** What approving every fix that is ready would do. */
export const HealthFixesSchema = z.object({
  ready: z.number().int(),
  filesRemoved: z.number().int(),
  filesChanged: z.number().int(),
  bytesFreed: z.number().int(),
  /** How many fewer characters an agent's session would load, as a mean over its recent sessions. */
  perSession: z.array(z.object({ agent: SessionAgentSchema, chars: z.number().int() })),
});
export type HealthFixes = z.infer<typeof HealthFixesSchema>;

export const HealthStorageKindSchema = z.enum(["memory", "skills", "conversations", "one-shot", "sub-agents"]);
export type HealthStorageKind = z.infer<typeof HealthStorageKindSchema>;

export const HEALTH_STORAGE_LABEL: Record<HealthStorageKind, string> = {
  memory: "Memory and instructions", skills: "Skills", conversations: "Conversations", "one-shot": "One-shot calls", "sub-agents": "Sub-agents",
};

export const HealthStorageSchema = z.object({ kind: HealthStorageKindSchema, files: z.number().int(), bytes: z.number().int() });
export type HealthStorage = z.infer<typeof HealthStorageSchema>;

export const HealthSummarySchema = z.object({
  pass: HealthPassSchema,
  carried: z.array(HealthCarriedSchema),
  contributors: z.array(HealthContributorSchema),
  reach: HealthReachSchema,
  fixes: HealthFixesSchema,
  storage: z.array(HealthStorageSchema),
});
export type HealthSummary = z.infer<typeof HealthSummarySchema>;

export const HealthMethods = {
  /** Every number on the page. It scans for findings, which reads every file. */
  "health.summary": { params: z.object({}), result: HealthSummarySchema },
  /** Only how far the reading of recent sessions has got, for a page waiting on it. */
  "health.status": { params: z.object({}), result: HealthPassSchema },
} as const;
