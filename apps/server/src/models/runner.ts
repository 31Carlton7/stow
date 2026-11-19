import type { OfferedModel, RunnerId, RunnerProbe } from "@amc/contracts";
import type { AskCli, RunCli } from "./cli";

export type RunRequest = {
  system: string;
  prompt: string;
  /** A JSON Schema object. The CLI holds the model to it; Codex needs every property listed in
   *  `required` and `additionalProperties: false`. */
  schema: Record<string, unknown>;
  model: string;
  /** The most this one call may cost. Claude Code enforces it; Codex has no such switch. */
  maxCostUsd: number;
  signal?: AbortSignal;
};

export type RunSpend = { inputTokens: number; outputTokens: number; costUsd: number | null };
export type RunOutcome = RunSpend & { output: unknown; durationMs: number };

export interface ModelRunner {
  readonly id: RunnerId;
  probe(): Promise<RunnerProbe>;
  /** The models the CLI offers, or null when it is not there or would not say. No model is called. */
  offered(): Promise<OfferedModel[] | null>;
  run(request: RunRequest): Promise<RunOutcome>;
}

export type CliRunnerDeps = {
  /** An empty folder the app owns. The CLI starts there, so it finds no project files to load. */
  cwd: string;
  env: NodeJS.ProcessEnv;
  runCli?: RunCli;
  askCli?: AskCli;
  /** The binary to run, or null when there is none. */
  locate?: () => string | null;
};

export type RunFailure = "missing" | "signed-out" | "no-output" | "invalid-output" | "aborted" | "failed";

/** Why a run produced no output. `spend` is what it used anyway, when the CLI said. */
export class RunnerError extends Error {
  constructor(public kind: RunFailure, message: string, public spend: RunSpend | null = null) { super(message); this.name = "RunnerError"; }
}

export const PROBE_TIMEOUT_MS = 8_000;
export const RUN_TIMEOUT_MS = 180_000;

export const NOT_INSTALLED: RunnerProbe = { installed: false, version: null, signedIn: null, plan: null };

/** A token count as a CLI reported it, or 0 for a field it left out. */
export const tokenCount = (n: unknown): number => (typeof n === "number" && Number.isFinite(n) ? n : 0);

/** The end of what a CLI printed, short enough for a ledger row. */
export const lastLines = (text: string): string => text.trim().split("\n").slice(-3).join(" ").slice(-400);
