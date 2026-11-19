import { createHash } from "node:crypto";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { McpDefinition, McpServer } from "@amc/contracts";
import { readOr, tildify } from "../library/paths";
import type { Project } from "../library/projects";
import { realmDb } from "../library/realm-names";
import { readJson, record } from "./json";
import { maskArgs, maskUrl } from "./mask";
import { readTomlTables, type TomlTable } from "./toml-tables";

type Where = { agent: string; file: string; project: Project | null; projectName?: string };
type Named = McpDefinition & { name: string };

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const keysOf = (v: unknown): string[] => Object.keys(record(v) ?? {}).sort();

/**
 * Where every agent keeps its MCP server definitions, read into one list. Only names leave this
 * module for a definition's environment and headers; a command line or URL leaves masked. The
 * fingerprint is taken over the unmasked definition, so two definitions that differ only in a token
 * still read as different.
 */
export class McpServers {
  constructor(private d: { home: string; projects: () => readonly Project[]; projectAt: (folder: string) => Project | null }) {}

  list(): McpServer[] {
    const { home } = this.d;
    const found: Named[] = [];
    const add = (where: Where, name: string, def: { command?: string; args?: string[]; url?: string; type?: string; env?: string[]; headers?: string[]; disabled?: boolean }): void => {
      const transport: McpDefinition["transport"] = def.url ? (def.type === "sse" ? "sse" : "http") : def.command ? "stdio" : "unknown";
      const envKeys = def.env ?? [], headerKeys = def.headers ?? [];
      found.push({
        name, agent: where.agent, file: tildify(where.file, home),
        projectId: where.project?.id ?? null, projectName: where.project?.name ?? where.projectName ?? null,
        transport, target: def.url ? maskUrl(def.url) : [def.command ?? "", ...maskArgs(def.args ?? [])].join(" ").trim(),
        envKeys, headerKeys, disabled: def.disabled ?? false,
        fingerprint: createHash("sha1").update(JSON.stringify([transport, def.command ?? null, def.args ?? [], def.url ?? null, envKeys, headerKeys])).digest("hex").slice(0, 12),
      });
    };
    /** The `mcpServers` object most agents share: a name to `{ command, args, env }` or `{ url, headers }`. */
    const addServers = (where: Where, servers: unknown): void => {
      for (const [name, raw] of Object.entries(record(servers) ?? {})) {
        const def = record(raw);
        if (!def) continue;
        add(where, name, {
          command: typeof def.command === "string" ? def.command : undefined, args: strings(def.args),
          url: typeof def.url === "string" ? def.url : typeof def.serverUrl === "string" ? def.serverUrl : typeof def.httpUrl === "string" ? def.httpUrl : undefined,
          type: typeof def.type === "string" ? def.type : typeof def.transport === "string" ? def.transport : undefined,
          env: keysOf(def.env), headers: keysOf(def.headers), disabled: def.disabled === true || def.enabled === false,
        });
      }
    };
    const addFile = (agent: string, file: string, project: Project | null = null): void => addServers({ agent, file, project }, record(readJson(file))?.mcpServers);

    const claudeState = join(home, ".claude.json");
    const state = record(readJson(claudeState));
    addServers({ agent: "Claude Code", file: claudeState, project: null }, state?.mcpServers);
    for (const [folder, settings] of Object.entries(record(state?.projects) ?? {})) {
      addServers({ agent: "Claude Code", file: claudeState, project: this.d.projectAt(folder), projectName: basename(folder) }, record(settings)?.mcpServers);
    }
    addFile("Claude Code", join(home, ".claude", "mcp.json"));
    addFile("Cursor", join(home, ".cursor", "mcp.json"));
    addFile("Claude Desktop", join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json"));
    addFile("Gemini", join(home, ".gemini", "settings.json"));
    addFile("Antigravity", join(home, ".gemini", "antigravity", "mcp_config.json"));
    for (const project of this.d.projects()) {
      addFile("Claude Code", join(project.root, ".mcp.json"), project);
      addFile("Cursor", join(project.root, ".cursor", "mcp.json"), project);
      addFile("Gemini", join(project.root, ".gemini", "settings.json"), project);
    }

    const codexConfig = join(home, ".codex", "config.toml");
    for (const server of codexServers(readOr(codexConfig) ?? "")) add({ agent: "Codex", file: codexConfig, project: null }, server.name, server);

    const opencodeConfig = join(home, ".config", "opencode", "opencode.json");
    for (const [name, raw] of Object.entries(record(record(readJson(opencodeConfig))?.mcp) ?? {})) {
      const def = record(raw);
      if (!def) continue;
      const [command, ...args] = strings(def.command);
      add({ agent: "opencode", file: opencodeConfig, project: null }, name, {
        command, args, url: typeof def.url === "string" ? def.url : undefined,
        env: keysOf(def.environment), headers: keysOf(def.headers), disabled: def.enabled === false,
      });
    }

    const realm = realmDb(home);
    for (const server of realmServers(realm)) add({ agent: "Realm", file: realm, project: null }, server.name, server);

    const byName = new Map<string, McpDefinition[]>();
    for (const { name, ...definition } of found) byName.set(name, [...(byName.get(name) ?? []), definition]);
    return [...byName].map(([name, definitions]) => ({
      name, definitions, conflict: new Set(definitions.map((d) => d.fingerprint)).size > 1,
    })).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }
}

type CodexServer = { name: string; command?: string; args: string[]; url?: string; env: string[]; headers: string[]; disabled: boolean };

/** Codex's `[mcp_servers.<name>]` tables, with the `env` and header tables that may sit under each. */
function codexServers(toml: string): CodexServer[] {
  let tables: TomlTable[];
  try { tables = readTomlTables(toml); } catch { return []; }
  const servers = new Map<string, CodexServer>();
  const of = (name: string): CodexServer => {
    if (!servers.has(name)) servers.set(name, { name, args: [], env: [], headers: [], disabled: false });
    return servers.get(name)!;
  };
  for (const { path, values } of tables) {
    if (path[0] !== "mcp_servers" || path.length < 2) continue;
    const server = of(path[1]!);
    if (path.length === 2) {
      if (typeof values.command === "string") server.command = values.command;
      if (typeof values.url === "string") server.url = values.url;
      server.args = strings(values.args);
      server.disabled = values.enabled === false;
      server.env = [...new Set([...server.env, ...keysOf(values.env), ...(typeof values.bearer_token_env_var === "string" ? [values.bearer_token_env_var] : [])])].sort();
      server.headers = [...new Set([...server.headers, ...keysOf(values.http_headers), ...keysOf(values.env_http_headers)])].sort();
    } else if (path[2] === "env") {
      server.env = [...new Set([...server.env, ...Object.keys(values)])].sort();
    } else if (path[2] === "http_headers" || path[2] === "env_http_headers") {
      server.headers = [...new Set([...server.headers, ...Object.keys(values)])].sort();
    }
  }
  return [...servers.values()];
}

/** The servers Realm keeps in its own database. Its secrets column is never selected, and any
 *  surprise in a schema that is Realm's private business answers with no servers. */
function realmServers(dbPath: string): { name: string; command?: string; args: string[]; url?: string; type?: string }[] {
  let db: DatabaseSync;
  try { db = new DatabaseSync(dbPath, { readOnly: true }); } catch { return []; }
  try {
    const rows = db.prepare("SELECT name, transport, command, args_json, url FROM mcp_servers").all() as { name: string; transport: string | null; command: string | null; args_json: string | null; url: string | null }[];
    return rows.map((row) => ({
      name: row.name, command: row.command ?? undefined, url: row.url ?? undefined, type: row.transport ?? undefined,
      args: strings((() => { try { return JSON.parse(row.args_json ?? "[]") as unknown; } catch { return []; } })()),
    }));
  } catch {
    return [];
  } finally {
    db.close();
  }
}
