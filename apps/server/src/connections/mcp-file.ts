import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { McpDraft } from "@amc/contracts";
import { isDir, readOr } from "../library/paths";
import { writeFileAtomic } from "../library/safe-write";
import { record } from "../setup/json";

export type FileAgent = "cursor" | "gemini";

const FOLDER: Record<FileAgent, string> = { cursor: ".cursor", gemini: ".gemini" };
const FILE: Record<FileAgent, string> = { cursor: "mcp.json", gemini: "settings.json" };
const LABEL: Record<FileAgent, string> = { cursor: "Cursor", gemini: "Gemini" };

/** The file an agent keeps its servers in: the home's for every project, or the project's own. */
export const serversFile = (agent: FileAgent, base: string): string => join(base, FOLDER[agent], FILE[agent]);

/**
 * A server as the agent's file holds one. Cursor's entries carry no `type` except to say SSE, the
 * one thing a URL alone cannot. Gemini names the transport by the key the URL is under.
 */
function entryFor(agent: FileAgent, draft: McpDraft): Record<string, unknown> {
  if (draft.transport === "stdio") return { command: draft.command, args: draft.args, ...(Object.keys(draft.env).length > 0 ? { env: draft.env } : {}) };
  const headers = Object.keys(draft.headers).length > 0 ? { headers: draft.headers } : {};
  if (agent === "gemini") return { [draft.transport === "sse" ? "url" : "httpUrl"]: draft.url, ...headers };
  return { url: draft.url, ...(draft.transport === "sse" ? { type: "sse" } : {}), ...headers };
}

type Opened = { root: Record<string, unknown>; servers: Record<string, unknown>; exists: boolean } | { refused: string };

/** The file read for a change. A file that is not the shape expected is refused whole: rewriting it could lose what it holds. */
function open(agent: FileAgent, file: string): Opened {
  const text = readOr(file);
  if (text === null || text.trim() === "") return { root: {}, servers: {}, exists: text !== null };
  let root: Record<string, unknown> | null;
  try { root = record(JSON.parse(text)); } catch { return { refused: `${LABEL[agent]}'s file does not read as JSON, so it was left alone` }; }
  if (!root) return { refused: `${LABEL[agent]}'s file is not a JSON object, so it was left alone` };
  if (root.mcpServers === undefined) return { root, servers: {}, exists: true };
  const servers = record(root.mcpServers);
  if (!servers) return { refused: `\`mcpServers\` in ${LABEL[agent]}'s file is not an object, so it was left alone` };
  return { root, servers, exists: true };
}

/** Why the server cannot be added to this file, or null. `global` is the home's file, which is only written for an agent that is set up. */
export function fileAddRefusal(agent: FileAgent, file: string, name: string, global: boolean): string | null {
  if (global && !isDir(dirname(file))) return `${LABEL[agent]} is not set up on this Mac`;
  const opened = open(agent, file);
  if ("refused" in opened) return opened.refused;
  return name in opened.servers ? `${LABEL[agent]} already has a server named ${name} here: remove it first` : null;
}

/**
 * No copy of the file is kept before it is changed. It holds tokens, and a copy in the app's data
 * would be a second place they live. The write is one rename, so the file is the old text or the new
 * and never half of one, and what was changed is one named server that can be added or removed again.
 */
function write(file: string, opened: Exclude<Opened, { refused: string }>): void {
  if (!opened.exists) mkdirSync(dirname(file), { recursive: true });
  writeFileAtomic(file, `${JSON.stringify({ ...opened.root, mcpServers: opened.servers }, null, 2)}\n`);
}

/** Add one server to the file, leaving every other key as it was. Throws with the reason when it cannot. */
export function addToFile(agent: FileAgent, file: string, draft: McpDraft): void {
  const opened = open(agent, file);
  if ("refused" in opened) throw new Error(opened.refused);
  if (draft.name in opened.servers) throw new Error(`${LABEL[agent]} already has a server named ${draft.name} here: remove it first`);
  opened.servers[draft.name] = entryFor(agent, draft);
  write(file, opened);
}

export function removeFromFile(agent: FileAgent, file: string, name: string): void {
  if (!existsSync(file)) throw new Error(`${LABEL[agent]} has no server named ${name} here`);
  const opened = open(agent, file);
  if ("refused" in opened) throw new Error(opened.refused);
  if (!(name in opened.servers)) throw new Error(`${LABEL[agent]} has no server named ${name} here`);
  delete opened.servers[name];
  write(file, opened);
}
