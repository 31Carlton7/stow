import { z } from "zod";
import { RunnerIdSchema } from "./models";

/*
 * The review inbox: what looks wrong or wasteful across the library and the setup, each with its
 * evidence and, where the fix is mechanical, the exact change approving it would make. Nothing is
 * ever changed without an approval, and an approval can be undone.
 */

export const FindingTypeSchema = z.enum([
  "dead-copy", "duplicate", "diverged-copy", "near-duplicate", "broken-link", "orphan", "oversized-index",
  "empty-file", "dead-reference", "duplicate-skill", "mcp-duplicate", "mcp-conflict",
  "stale", "contradiction", "merge", "dated-prompt", "wrong-claim",
]);
export type FindingType = z.infer<typeof FindingTypeSchema>;

export const FINDING_TYPE_LABEL: Record<FindingType, string> = {
  "dead-copy": "Copies nobody reads", duplicate: "Kept in two places", "diverged-copy": "Two versions of one memory",
  "near-duplicate": "Nearly the same memory", "broken-link": "Link to a missing file", orphan: "Missing from its index",
  "oversized-index": "Index too long to load whole", "empty-file": "Empty file", "dead-reference": "Path that is gone",
  "duplicate-skill": "Skill copied, not linked", "mcp-duplicate": "MCP server defined twice", "mcp-conflict": "MCP server defined two ways",
  stale: "May be out of date", contradiction: "Two memories disagree", merge: "Could be one memory",
  "dated-prompt": "Written for an older model", "wrong-claim": "Names something the project lacks",
};

export const FindingSeveritySchema = z.enum(["high", "medium", "low"]);
export type FindingSeverity = z.infer<typeof FindingSeveritySchema>;

/** One thing a finding is about. `id` is a library file's, or null for something the library does not hold. */
export const FindingSubjectSchema = z.object({ id: z.string().nullable(), label: z.string(), displayPath: z.string() });
export type FindingSubject = z.infer<typeof FindingSubjectSchema>;

export const FindingSchema = z.object({
  /** The same for the same problem on every scan, so a rejected finding stays rejected. */
  fingerprint: z.string(),
  type: FindingTypeSchema,
  severity: FindingSeveritySchema,
  title: z.string(),
  /** The evidence, in a sentence or two. */
  detail: z.string(),
  subjects: z.array(FindingSubjectSchema),
  /** What approving does, in a sentence; null when there is nothing mechanical to do. */
  fix: z.string().nullable(),
  /** The model whose reading this is, or null for a finding worked out by rule. */
  judgedBy: z.string().nullable(),
  /** True when the fix is text a stronger model has to write first (`review.draft`), which costs a call. */
  needsDraft: z.boolean(),
});
export type Finding = z.infer<typeof FindingSchema>;

/** One file as approving a finding would leave it. `after` is null for a file that goes. */
export const ProposedChangeSchema = z.object({
  id: z.string(),
  label: z.string(),
  displayPath: z.string(),
  before: z.string(),
  after: z.string().nullable(),
  /** Where the file goes when it goes: a commit that removes it, or the Trash. */
  removal: z.enum(["commit", "trash"]).nullable(),
});
export type ProposedChange = z.infer<typeof ProposedChangeSchema>;

export const AppliedFixSchema = z.object({
  id: z.number().int(),
  fingerprint: z.string(),
  type: FindingTypeSchema,
  title: z.string(),
  at: z.number(),
  undoneAt: z.number().nullable(),
});
export type AppliedFix = z.infer<typeof AppliedFixSchema>;

const FingerprintSchema = z.string().regex(/^[a-f0-9]{16}$/);

/** One place files are kept, as a model pass would treat it. */
export const PassSourceSchema = z.object({
  id: z.string(),
  label: z.string(),
  /** How many of its files a pass would send, and how many characters they come to. */
  files: z.number().int(),
  chars: z.number().int(),
  /** The person has said nothing of this source is ever sent to a model. */
  neverSend: z.boolean(),
});
export type PassSource = z.infer<typeof PassSourceSchema>;

/** What a model pass would send if it were started now. */
export const PassScopeSchema = z.object({
  sources: z.array(PassSourceSchema),
  files: z.number().int(),
  chars: z.number().int(),
  calls: z.number().int(),
  /** Files left out because their text is shaped like it holds a credential. */
  withheld: z.number().int(),
});
export type PassScope = z.infer<typeof PassScopeSchema>;

export const PassStatusSchema = z.object({
  running: z.boolean(),
  runner: RunnerIdSchema.nullable(),
  model: z.string().nullable(),
  finishedAt: z.number().nullable(),
  calls: z.number().int(),
  callsDone: z.number().int(),
  callsFailed: z.number().int(),
  found: z.number().int(),
  /** What the model reported that did not hold up: a file it was not sent, or a quote that is in no file. */
  dropped: z.number().int(),
  /** API-equivalent dollars the pass has used so far. */
  spentUsd: z.number(),
  /** Why it stopped early, in the server's words, or null. */
  error: z.string().nullable(),
});
export type PassStatus = z.infer<typeof PassStatusSchema>;

export const ReviewMethods = {
  "review.scan": { params: z.object({}), result: z.object({ findings: z.array(FindingSchema), rejected: z.number().int() }) },
  "review.proposal": { params: z.object({ fingerprint: FingerprintSchema }), result: z.object({ changes: z.array(ProposedChangeSchema) }) },
  "review.approve": { params: z.object({ fingerprint: FingerprintSchema }), result: AppliedFixSchema },
  "review.reject": { params: z.object({ fingerprint: FingerprintSchema }), result: z.object({}) },
  "review.undo": { params: z.object({ id: z.number().int() }), result: AppliedFixSchema },
  "review.history": { params: z.object({}), result: z.object({ applied: z.array(AppliedFixSchema) }) },
  "review.passScope": { params: z.object({}), result: PassScopeSchema },
  "review.setNeverSend": { params: z.object({ sourceId: z.string(), neverSend: z.boolean() }), result: z.object({}) },
  "review.startPass": { params: z.object({ runner: RunnerIdSchema }), result: PassStatusSchema },
  "review.stopPass": { params: z.object({}), result: PassStatusSchema },
  "review.passStatus": { params: z.object({}), result: PassStatusSchema },
  /** Have the stronger model write the text a finding's fix needs. One model call. */
  "review.draft": { params: z.object({ fingerprint: FingerprintSchema, runner: RunnerIdSchema }), result: z.object({ changes: z.array(ProposedChangeSchema) }) },
} as const;
