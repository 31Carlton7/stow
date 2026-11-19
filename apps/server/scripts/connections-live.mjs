/**
 * Live check for managing MCP servers (run with: pnpm --filter @amc/server build && node apps/server/scripts/connections-live.mjs)
 *
 * Boots the BUILT server on the fixture home, with stand-ins for `claude` and `codex` that change the
 * fixture's files the way the real tools do, and asks over the real socket what the window asks:
 *
 *   1. A preview says what each agent would be given, with the token masked, and changes nothing.
 *   2. Adding runs each agent's own tool, or edits the one key of its file, and `setup.mcp` shows it.
 *   3. The token is in the agents' own files and nowhere in what the server answered or kept.
 *   4. A health check answers at once and comes to rest with what each tool said.
 *   5. Removing takes the server out again, and `setup.mcp` no longer shows it.
 *
 * It makes no model call, starts neither real tool and reads nothing of the person's own home.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checks } from "../../../fixtures/checks.mjs";
import { buildFixtureHome } from "../../../fixtures/home.mjs";
import { writeFakeAgents } from "./lib/fake-agents.mjs";
import { startLiveServer } from "./lib/live-server.mjs";

const { check, finish } = checks();
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "amc-connections-fixture-"));
const fixture = buildFixtureHome(fixtureRoot);
const agents = writeFakeAgents(fs.mkdtempSync(path.join(os.tmpdir(), "amc-connections-agents-")));

const TOKEN = "live-check-token-7c1e9a";
const draft = { name: "ledger", transport: "stdio", command: "npx", args: ["-y", "@example/ledger-mcp"], env: { LEDGER_TOKEN: TOKEN } };
const everywhere = { agents: ["claude", "codex", "cursor"], projectId: null };
const read = (rel) => fs.readFileSync(path.join(fixture.home, rel), "utf8");
const said = [];

const server = await startLiveServer({ name: "connections", sourceHome: fixture.home, env: agents.env });
const result = async (method, params) => { const answer = await server.result(method, params); said.push(JSON.stringify(answer)); return answer; };
const definitionsOf = async (name) => (await result("setup.mcp")).servers.find((s) => s.name === name)?.definitions ?? [];

try {
  const { steps } = await result("mcp.preview", { draft, placement: { agents: ["claude", "codex", "cursor", "gemini"], projectId: null } });
  for (const step of steps) console.log(`     ${step.agent} ${step.how}: ${step.refused ? `refused, ${step.refused}` : step.shows}`);
  check("a preview shows a command for Claude Code and Codex and a file for Cursor", steps.slice(0, 3).map((s) => `${s.how}:${s.refused}`).join() === "command:null,command:null,file:null" && steps[2].shows === "~/.cursor/mcp.json");
  check("Gemini would have its settings file changed", steps[3].how === "file" && steps[3].shows === "~/.gemini/settings.json" && steps[3].refused === null);
  check("a preview runs nothing and adds nothing", agents.started().length === 0 && (await definitionsOf("ledger")).length === 0);

  const { outcomes } = await result("mcp.add", { draft, placement: everywhere });
  for (const outcome of outcomes) console.log(`     ${outcome.agent}: ${outcome.ok ? "added" : "failed"} ${outcome.detail ?? ""}`);
  check("the server is added to all three agents", outcomes.every((o) => o.ok));
  const ran = agents.started();
  check("Claude Code was given the server as one JSON value for every project", ran[0]?.tool === "claude" && ran[0].args.slice(0, 5).join(" ") === "mcp add-json -s user ledger" && JSON.parse(ran[0].args[5]).env.LEDGER_TOKEN === TOKEN);
  check("Codex was given the command after `--`", ran[1]?.tool === "codex" && ran[1].args.join(" ") === `mcp add ledger --env LEDGER_TOKEN=${TOKEN} -- npx -y @example/ledger-mcp`);
  check("both tools ran on the fixture home", ran.every((run) => run.cwd === fixture.home));

  const added = await definitionsOf("ledger");
  for (const d of added) console.log(`     ${d.agent} ${d.file} ${d.target} env=${d.envKeys}`);
  check("`setup.mcp` shows it for each agent, with the name of its token only", added.map((d) => d.agent).sort().join() === "Claude Code,Codex,Cursor" && added.every((d) => d.envKeys.join() === "LEDGER_TOKEN"));
  check("the token is in each agent's own file", [".claude.json", ".codex/config.toml", ".cursor/mcp.json"].every((rel) => read(rel).includes(TOKEN)));
  const cursor = JSON.parse(read(".cursor/mcp.json"));
  check("Cursor's other server is as it was", cursor.mcpServers.notes.command === "npx" && Object.keys(cursor.mcpServers).join() === "notes,ledger");

  const again = await result("mcp.add", { draft, placement: everywhere });
  check("adding the same name again is refused for every agent, and runs nothing", again.outcomes.every((o) => !o.ok && /already has a server named ledger/.test(o.detail)) && agents.started().length === 2);

  let health = await result("mcp.health", { check: true });
  check("a health check answers at once with who is being asked", health.checking.includes("ledger"));
  for (let waited = 0; health.checking.length > 0 && waited < 100; waited++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    health = await result("mcp.health", {});
  }
  const ledger = health.health.filter((h) => h.name === "ledger").map((h) => `${h.agent}:${h.state}`).sort().join();
  console.log(`     health: ${ledger}`);
  check("it comes to rest with what each agent's tool said", health.checking.length === 0 && ledger === "Claude Code:connected,Codex:unknown,Cursor:unknown");

  const signIn = await result("mcp.signIn", { name: "ledger", agent: "codex" });
  check("a sign-in the tool refuses says why", signIn.started === false && /only supported for streamable HTTP/.test(signIn.detail));
  check("a server started by a command has no icon to fetch", (await result("mcp.icon", { name: "ledger" })).icon === null);

  for (const agent of everywhere.agents) {
    const removed = await result("mcp.remove", { name: "ledger", agent });
    check(`it is removed from ${agent}`, removed.ok, removed.detail ?? "");
  }
  check("`setup.mcp` no longer shows it", (await definitionsOf("ledger")).length === 0);
  check("the fixture's own servers are still there", (await definitionsOf("notes")).length >= 2 && (await definitionsOf("search")).length >= 2);
  const gone = await result("mcp.remove", { name: "ledger", agent: "codex" });
  check("removing what is not there says so", gone.ok === false);

  check("the token is in nothing the server answered", !said.join("\n").includes(TOKEN));
  const kept = fs.readdirSync(server.scratch, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => path.join(entry.parentPath, entry.name));
  const holding = kept.filter((file) => fs.readFileSync(file).includes(TOKEN)).map((file) => path.relative(server.scratch, file));
  console.log(`     the app's data folder holds ${kept.length} files; with the token: ${holding.length}`);
  check("the token is in nothing the app keeps", holding.length === 0, holding.join());
} finally {
  await server.stop();
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
  fs.rmSync(path.dirname(agents.env.AMC_CLAUDE_BIN), { recursive: true, force: true });
}
finish();
