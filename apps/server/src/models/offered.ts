import { APP_NAME, ModelIdSchema, type OfferedModel } from "@amc/contracts";
import type { AskCli } from "./cli";

/*
 * The models each CLI offers, asked of the CLI itself the way Realm asks (its
 * `packages/adapters/src/claude/claude-adapter.ts` and `codex/probe.ts` at 790f35b46): Claude Code
 * lists them in the answer to the handshake every client opens with, and Codex's app server has a
 * call for it. Neither sends anything to a model. Both shapes are a CLI's own and may drift, so a row
 * that is not what was expected is left out and never guessed at.
 */

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value.trim() : null);
const parsed = (line: string): Record<string, unknown> | null => {
  try {
    const value: unknown = JSON.parse(line);
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

/**
 * Claude Code's rows (`value`, `resolvedModel`, `displayName`, recorded from 2.1.322). A row is an
 * alias as often as an id (`default`, `opus`, `opus[1m]`), so each is filed under the model it
 * resolves to, without the context-window variant: that is a way of running a model, not another
 * model. The CLI's order is kept. `default` names no model of its own, so its label ("Default
 * (recommended)") gives way to the model's.
 */
export function claudeOffered(rows: unknown): OfferedModel[] {
  const byId = new Map<string, OfferedModel>();
  for (const row of Array.isArray(rows) ? rows : []) {
    const r = (row ?? {}) as { value?: unknown; resolvedModel?: unknown; displayName?: unknown };
    const id = (text(r.resolvedModel) ?? text(r.value))?.replace(/\[[^\]]*\]$/, "");
    if (!id || !/^claude-[a-z]+-\d/.test(id) || !ModelIdSchema.safeParse(id).success) continue;
    const label = r.value === "default" ? null : text(r.displayName);
    const held = byId.get(id);
    if (!held) byId.set(id, { id, label: label ?? id });
    else if (held.label === id && label) held.label = label;
  }
  return [...byId.values()];
}

/** One page of Codex's `model/list` (`{ data, nextCursor }`, recorded from codex-cli 0.169.0). A row
 *  marked `hidden` is one Codex keeps out of its own picker. */
export function codexOffered(page: unknown): { models: OfferedModel[]; nextCursor: string | null } {
  const { data, nextCursor } = (page ?? {}) as { data?: unknown; nextCursor?: unknown };
  const models: OfferedModel[] = [];
  for (const row of Array.isArray(data) ? data : []) {
    const r = (row ?? {}) as { id?: unknown; displayName?: unknown; hidden?: unknown };
    const id = text(r.id);
    if (!id || r.hidden === true || !ModelIdSchema.safeParse(id).success) continue;
    models.push({ id, label: text(r.displayName) ?? id });
  }
  return { models, nextCursor: text(nextCursor) };
}

export type AskFor = { askCli: AskCli; bin: string; cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number };

const HANDSHAKE = "offered-models";

/**
 * Open Claude Code the way a client does and read the models out of its answer to the handshake. No
 * prompt is ever written, so nothing reaches a model. The flags are the runner's own: no tools, none
 * of the person's settings, MCP servers or skills, and no session file.
 */
export async function askClaude({ askCli, bin, cwd, env, timeoutMs }: AskFor): Promise<OfferedModel[] | null> {
  const models = await askCli({
    command: bin, cwd, env, timeoutMs,
    args: ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--tools", "", "--setting-sources", "",
      "--strict-mcp-config", "--disable-slash-commands", "--no-session-persistence"],
    opening: [JSON.stringify({ type: "control_request", request_id: HANDSHAKE, request: { subtype: "initialize" } })],
    onLine: (line) => {
      const said = parsed(line);
      if (said?.type !== "control_response") return undefined;
      const answer = (said.response ?? {}) as { response?: { models?: unknown } };
      return claudeOffered(answer.response?.models);
    },
  });
  return models !== null && models.length > 0 ? models : null;
}

/** A catalogue is one page of a handful; a cursor that goes on past this is not a catalogue. */
const MAX_PAGES = 8;

/** Start Codex's app server, greet it, and ask for its model list, a page at a time. No thread is started. */
export async function askCodex({ askCli, bin, cwd, env, timeoutMs }: AskFor): Promise<OfferedModel[] | null> {
  const request = (id: number, method: string, params: Record<string, unknown>): string => JSON.stringify({ id, method, params });
  const found: OfferedModel[] = [];
  const models = await askCli({
    command: bin, args: ["app-server"], cwd, env, timeoutMs,
    opening: [request(0, "initialize", { clientInfo: { name: APP_NAME.toLowerCase(), title: APP_NAME, version: "1" } })],
    onLine: (line, say) => {
      const said = parsed(line);
      // What the server asks or announces of its own accord carries a method; an answer does not.
      if (said === null || typeof said.id !== "number" || "method" in said) return undefined;
      // A build with no such call says so here, and so does one that would not be greeted.
      if (said.error !== undefined) return found;
      if (said.id === 0) {
        say(JSON.stringify({ method: "initialized" }));
        say(request(1, "model/list", {}));
        return undefined;
      }
      const page = codexOffered(said.result);
      found.push(...page.models);
      if (page.nextCursor === null || said.id >= MAX_PAGES) return found;
      say(request(said.id + 1, "model/list", { cursor: page.nextCursor }));
      return undefined;
    },
  });
  return models !== null && models.length > 0 ? models : null;
}

const KEPT_MS = 5 * 60_000;

/** Keep an answer for five minutes: asking starts a process, and the page asks every time it is
 *  opened. A CLI that gains a model is asked again soon enough; one that would not say is asked again
 *  next time. */
export function keptFor<T>(ask: () => Promise<T | null>, now: () => number = Date.now): () => Promise<T | null> {
  let held: { at: number; answer: T } | null = null;
  return async () => {
    if (held !== null && now() - held.at < KEPT_MS) return held.answer;
    const answer = await ask();
    if (answer !== null) held = { at: now(), answer };
    return answer;
  };
}
