import { z } from "zod";

/** The CLIs a model call can run through. Each is the person's own signed-in binary. */
export const RunnerIdSchema = z.enum(["claude", "codex"]);
export type RunnerId = z.infer<typeof RunnerIdSchema>;
export const RUNNER_IDS: readonly RunnerId[] = RunnerIdSchema.options;

/** `scan` is the cheap model that reads many files; `write` is the stronger one that drafts one proposal. */
export const ModelTierSchema = z.enum(["scan", "write"]);
export type ModelTier = z.infer<typeof ModelTierSchema>;

/** A model id goes onto a command line as its own argument, so it may not start like a flag. */
export const ModelIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,99}$/);

/** What a CLI says about itself. `signedIn` is null when it would not answer, which is not evidence
 *  of being signed out. Codex names no plan. */
export const RunnerProbeSchema = z.object({
  installed: z.boolean(),
  version: z.string().nullable(),
  signedIn: z.boolean().nullable(),
  plan: z.string().nullable(),
});
export type RunnerProbe = z.infer<typeof RunnerProbeSchema>;

/** A model a CLI says it can run: the id its command line takes, and the name its own picker shows. */
export const OfferedModelSchema = z.object({ id: ModelIdSchema, label: z.string() });
export type OfferedModel = z.infer<typeof OfferedModelSchema>;

export const RunnerSettingsSchema = z.object({
  allowed: z.boolean(),
  models: z.object({ scan: ModelIdSchema, write: ModelIdSchema }),
});
export type RunnerSettings = z.infer<typeof RunnerSettingsSchema>;

export const RunnerStatusSchema = z.object({ runner: RunnerIdSchema, probe: RunnerProbeSchema, settings: RunnerSettingsSchema });
export type RunnerStatus = z.infer<typeof RunnerStatusSchema>;

export const ModelsStatusSchema = z.object({
  runners: z.array(RunnerStatusSchema),
  /** API-equivalent dollars recorded since local midnight. Plan logins are not billed per call; this
   *  is what the same tokens would cost on the API, and it is what the cap is held against. */
  spentTodayUsd: z.number(),
  dailyCapUsd: z.number(),
});
export type ModelsStatus = z.infer<typeof ModelsStatusSchema>;

/** One attempted call, refused or not. `sent` labels what went out (file paths), never the bodies. */
export const ModelCallSchema = z.object({
  id: z.number().int(),
  ts: z.number().int(),
  runner: RunnerIdSchema,
  model: z.string(),
  tier: ModelTierSchema,
  purpose: z.string(),
  sent: z.array(z.string()),
  promptChars: z.number().int(),
  inputTokens: z.number().int().nullable(),
  outputTokens: z.number().int().nullable(),
  /** What the CLI reported. Codex reports none. */
  costUsd: z.number().nullable(),
  /** What the call counts against the cap: the reported cost, or an estimate from its tokens. */
  apiEquivalentUsd: z.number(),
  durationMs: z.number().int().nullable(),
  ok: z.boolean(),
  error: z.string().nullable(),
});
export type ModelCall = z.infer<typeof ModelCallSchema>;

export const ModelTestSchema = z.object({
  model: z.string(),
  output: z.object({ ok: z.literal(true) }),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  costUsd: z.number().nullable(),
  durationMs: z.number().int(),
});
export type ModelTest = z.infer<typeof ModelTestSchema>;

export const ModelMethods = {
  "models.status": { params: z.object({}), result: ModelsStatusSchema },
  "models.setAllowed": { params: z.object({ runner: RunnerIdSchema, allowed: z.boolean() }), result: RunnerSettingsSchema },
  "models.setModel": { params: z.object({ runner: RunnerIdSchema, tier: ModelTierSchema, model: ModelIdSchema }), result: RunnerSettingsSchema },
  /** The models a runner's CLI offers, asked of the CLI itself as it starts and with no model call.
   *  Null when it would not say: the window then takes an id typed in. */
  "models.offered": { params: z.object({ runner: RunnerIdSchema }), result: z.object({ models: z.array(OfferedModelSchema).nullable() }) },
  "models.setDailyCap": { params: z.object({ usd: z.number().min(0).max(1000) }), result: z.object({ dailyCapUsd: z.number() }) },
  /** One tiny real call through the gate, asking for `{ "ok": true }`. */
  "models.test": { params: z.object({ runner: RunnerIdSchema }), result: ModelTestSchema },
  "models.ledger": { params: z.object({ limit: z.number().int().min(1).max(500).default(50) }), result: z.object({ calls: z.array(ModelCallSchema) }) },
} as const;
