import type { McpDraft } from "@amc/contracts";
import { maskArgs, maskUrl } from "../setup/mask";

export const MASK = "••••";

/** One run of an agent's own tool. `cwd` matters: Claude Code keeps a project's servers under the folder it is run in. */
export type AgentCommand = { tool: "claude" | "codex"; args: string[]; cwd: string };

export type Planned = { command: AgentCommand; shows: string } | { refused: string };

/**
 * The environment an agent's tool runs under. A check points the app at another home
 * (`AMC_SOURCE_HOME`); the tools must then write there too, and not where the person's own
 * `CLAUDE_CONFIG_DIR` or `CODEX_HOME` would send them.
 */
export function agentEnv(env: NodeJS.ProcessEnv, home: string): NodeJS.ProcessEnv {
  if (!env.AMC_SOURCE_HOME) return env;
  const child: NodeJS.ProcessEnv = { ...env, HOME: home };
  delete child.CLAUDE_CONFIG_DIR;
  delete child.CODEX_HOME;
  return child;
}

const masked = (pairs: Record<string, string>): Record<string, string> => Object.fromEntries(Object.keys(pairs).map((key) => [key, MASK]));

/** What is wrong with a draft whatever agent it is for, or null. */
export function draftProblem(draft: McpDraft): string | null {
  if (draft.transport === "stdio") {
    if (!draft.command?.trim()) return "a server started by a command needs the command";
    if (Object.keys(draft.headers).length > 0) return "headers are for a server reached at a URL";
    return null;
  }
  if (!draft.url) return "a server reached at a URL needs the URL";
  if (!/^https?:$/.test(new URL(draft.url).protocol)) return "the URL must start with http:// or https://";
  if (Object.keys(draft.env).length > 0) return "environment variables are for a server started by a command";
  return null;
}

/** The entry Claude Code keeps for a server, which is also what `claude mcp add-json` takes. */
function claudeEntry(draft: McpDraft, show: boolean): Record<string, unknown> {
  if (draft.transport === "stdio") {
    return { type: "stdio", command: draft.command, args: show ? maskArgs(draft.args) : draft.args, env: show ? masked(draft.env) : draft.env };
  }
  return { type: draft.transport, url: show ? maskUrl(draft.url!) : draft.url, headers: show ? masked(draft.headers) : draft.headers };
}

const quoted = (word: string): string => (/^[A-Za-z0-9_@%+=:,./•-]+$/.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`);
const line = (tool: string, words: readonly string[]): string => [tool, ...words.map(quoted)].join(" ");

/**
 * `claude mcp add-json`: the one form of the tool that takes headers and environment in a single
 * value. A project's server goes in the `local` scope, which is the person's own for that folder
 * and is kept out of the repository: `project` scope would write a token into a `.mcp.json` that
 * gets committed.
 */
export function claudeAdd(draft: McpDraft, projectRoot: string | null, home: string): Planned {
  const scope = projectRoot ? "local" : "user";
  const words = (show: boolean): string[] => ["mcp", "add-json", "-s", scope, draft.name, JSON.stringify(claudeEntry(draft, show))];
  return { command: { tool: "claude", args: words(false), cwd: projectRoot ?? home }, shows: line("claude", words(true)) };
}

export function claudeRemove(name: string, scope: "user" | "local" | "project", projectRoot: string | null, home: string): { command: AgentCommand; shows: string } {
  const args = ["mcp", "remove", "-s", scope, name];
  return { command: { tool: "claude", args, cwd: projectRoot ?? home }, shows: line("claude", args) };
}

/** `codex mcp add`, which knows a command with its environment, or a streamable HTTP URL, and nothing per project. */
export function codexAdd(draft: McpDraft, projectRoot: string | null, home: string): Planned {
  if (projectRoot) return { refused: "Codex keeps its servers for every project, not for one" };
  if (draft.transport === "sse") return { refused: "Codex reaches a URL over streamable HTTP only, not SSE" };
  if (Object.keys(draft.headers).length > 0) return { refused: "Codex's own tool sets no headers: add the server without them and sign in to it from here" };
  const words = (show: boolean): string[] => {
    if (draft.transport === "http") return ["mcp", "add", draft.name, "--url", show ? maskUrl(draft.url!) : draft.url!];
    const env = Object.entries(draft.env).flatMap(([key, value]) => ["--env", `${key}=${show ? MASK : value}`]);
    return ["mcp", "add", draft.name, ...env, "--", draft.command!, ...(show ? maskArgs(draft.args) : draft.args)];
  };
  return { command: { tool: "codex", args: words(false), cwd: home }, shows: line("codex", words(true)) };
}

export function codexRemove(name: string, home: string): { command: AgentCommand; shows: string } {
  const args = ["mcp", "remove", name];
  return { command: { tool: "codex", args, cwd: home }, shows: line("codex", args) };
}

/**
 * What a tool's own words are scrubbed of before they are shown: each value typed for the
 * environment or a header, and each argument or URL that would be shown masked, with what replaces it.
 */
export function secretsOf(draft: McpDraft): [secret: string, shown: string][] {
  const typed = [...Object.values(draft.env), ...Object.values(draft.headers)].filter((value) => value.length >= 4).map((value): [string, string] => [value, MASK]);
  const shownArgs = maskArgs(draft.args);
  const inArgs = draft.args.map((arg, i): [string, string] => [arg, shownArgs[i]!]);
  const inUrl: [string, string][] = draft.url ? [[draft.url, maskUrl(draft.url)]] : [];
  return [...typed, ...inArgs, ...inUrl].filter(([secret, shown]) => secret !== shown).sort((a, b) => b[0].length - a[0].length);
}

export function withoutSecrets(text: string, secrets: readonly [string, string][]): string {
  let scrubbed = text;
  for (const [secret, shown] of secrets) scrubbed = scrubbed.replaceAll(secret, shown);
  return scrubbed;
}
