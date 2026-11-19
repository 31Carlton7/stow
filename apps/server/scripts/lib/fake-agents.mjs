/**
 * Stand-ins for `claude` and `codex` that do what the real `mcp` subcommands do to the files under
 * $HOME, and nothing else: a live check adds and removes servers through them without the real tools
 * and without the person's home. Each start is written to $AMC_FAKE_AGENT_LOG, one JSON line of its
 * arguments and folder, so a check can read what was run.
 *
 * The messages and exit codes are the real tools' (claude 2.1.322, codex-cli 0.169.0), Codex's exit 0
 * for a name it does not have included.
 */
import fs from "node:fs";
import path from "node:path";

const LOG = `
const fs = require("node:fs"), path = require("node:path");
const args = process.argv.slice(2);
if (process.env.AMC_FAKE_AGENT_LOG) fs.appendFileSync(process.env.AMC_FAKE_AGENT_LOG, JSON.stringify({ tool: TOOL, args, cwd: process.cwd() }) + "\\n");
const home = process.env.HOME;
const fail = (said) => { process.stderr.write(said + "\\n"); process.exit(1); };
`;

const CLAUDE = `#!/usr/bin/env node
const TOOL = "claude";
${LOG}
const file = path.join(home, ".claude.json");
const state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
const scopeAt = args.indexOf("-s");
const scope = scopeAt === -1 ? null : args.splice(scopeAt, 2)[1];
const serversOf = (which) => {
  if (which === "user") return (state.mcpServers ??= {});
  const project = ((state.projects ??= {})[fs.realpathSync(process.cwd())] ??= {});
  return (project.mcpServers ??= {});
};
const [, verb, name, json] = args;
if (args[0] !== "mcp") fail("unknown command");
if (verb === "add-json") {
  const servers = serversOf(scope ?? "local");
  if (name in servers) fail("MCP server " + name + " already exists in " + scope + " config");
  const entry = JSON.parse(json);
  servers[name] = entry;
  fs.writeFileSync(file, JSON.stringify(state, null, 2));
  console.log("Added " + entry.type + " MCP server " + name + " to " + scope + " config");
} else if (verb === "remove") {
  const servers = serversOf(scope ?? "local");
  if (!(name in servers)) fail('No MCP server named "' + name + '" in ' + scope + " scope");
  delete servers[name];
  fs.writeFileSync(file, JSON.stringify(state, null, 2));
  console.log("Removed MCP server " + name + " from " + scope + " config");
} else if (verb === "list") {
  console.log("Checking MCP server health…\\n");
  for (const [server, entry] of Object.entries({ ...serversOf("user"), ...serversOf("local") })) {
    const target = entry.url ? entry.url + " (" + String(entry.type).toUpperCase() + ")" : [entry.command, ...(entry.args ?? [])].join(" ");
    console.log(server + ": " + target + " - " + (entry.url ? "! Needs authentication" : "✓ Connected"));
  }
} else if (verb === "login") {
  console.log("Authentication successful.");
} else fail("unknown command");
`;

const CODEX = `#!/usr/bin/env node
const TOOL = "codex";
${LOG}
const file = path.join(home, ".codex", "config.toml");
const toml = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
/** The file as its tables, each from its heading to the next. */
const tables = toml.split(/^(?=\\[)/m);
const isOf = (table, name) => table.startsWith("[mcp_servers." + name + "]") || table.startsWith("[mcp_servers." + name + ".");
const [, verb, name, ...rest] = args;
if (args[0] !== "mcp") fail("unknown command");
if (verb === "add") {
  const split = rest.indexOf("--");
  const flags = split === -1 ? rest : rest.slice(0, split), command = split === -1 ? [] : rest.slice(split + 1);
  const env = [];
  let url = null;
  for (let i = 0; i < flags.length; i += 2) {
    if (flags[i] === "--env") env.push(flags[i + 1]);
    else if (flags[i] === "--url") url = flags[i + 1];
    else fail("error: unexpected argument '" + flags[i] + "' found");
  }
  const lines = ["[mcp_servers." + name + "]"];
  if (url) lines.push("url = " + JSON.stringify(url));
  else lines.push("command = " + JSON.stringify(command[0]), "args = " + JSON.stringify(command.slice(1)));
  if (env.length > 0) lines.push("", "[mcp_servers." + name + ".env]", ...env.map((pair) => pair.slice(0, pair.indexOf("=")) + " = " + JSON.stringify(pair.slice(pair.indexOf("=") + 1))));
  const kept = tables.filter((table) => !isOf(table, name)).join("");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, kept + (kept && !kept.endsWith("\\n\\n") ? "\\n" : "") + lines.join("\\n") + "\\n");
  console.log("Added global MCP server '" + name + "'.");
} else if (verb === "remove") {
  if (!tables.some((table) => isOf(table, name))) { console.log("No MCP server named '" + name + "' found."); process.exit(0); }
  fs.writeFileSync(file, tables.filter((table) => !isOf(table, name)).join(""));
  console.log("Removed global MCP server '" + name + "'.");
} else if (verb === "list") {
  const names = tables.map((table) => /^\\[mcp_servers\\.([^.\\]]+)\\]/.exec(table)?.[1]).filter(Boolean);
  console.log(JSON.stringify(names.map((server) => ({ name: server, enabled: true, disabled_reason: null, auth_status: "unsupported" }))));
} else if (verb === "login") {
  fail("Error: OAuth login is only supported for streamable HTTP servers.");
} else fail("unknown command");
`;

/** Write both stand-ins into `dir` and answer with the environment that points the server at them. */
export function writeFakeAgents(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const log = path.join(dir, "started.jsonl");
  const bins = { claude: path.join(dir, "claude"), codex: path.join(dir, "codex") };
  fs.writeFileSync(bins.claude, CLAUDE, { mode: 0o755 });
  fs.writeFileSync(bins.codex, CODEX, { mode: 0o755 });
  const started = () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((row) => JSON.parse(row)) : []);
  return { env: { AMC_CLAUDE_BIN: bins.claude, AMC_CODEX_BIN: bins.codex, AMC_FAKE_AGENT_LOG: log }, started };
}
