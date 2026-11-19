import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { TOKEN_STDIN_ENV } from "@amc/contracts";
import { AgentCli, McpChanges } from "./connections/mcp-changes";
import { McpHealthChecks } from "./connections/mcp-health";
import { McpIcons } from "./connections/mcp-icons";
import { registerMcp } from "./connections/mcp-rpc";
import { SkillImports } from "./connections/skills-imports";
import { registerSkills } from "./connections/skills-rpc";
import { openDatabase, schemaVersion } from "./db/database";
import { Health } from "./health/health";
import { registerHealth } from "./health/rpc";
import { FavoriteStore } from "./favorites/favorites";
import { registerFavorites } from "./favorites/rpc";
import { ConnectionGraph } from "./graph/graph";
import { registerGraph } from "./graph/rpc";
import { appHome, sourceHome } from "./home";
import { Library } from "./library/library";
import { registerLibrary } from "./library/rpc";
import { TagStore } from "./library/tags";
import { moveToTrash } from "./library/trash";
import { ClaudeCliRunner } from "./models/claude-runner";
import { withToolFolders } from "./models/cli";
import { CodexCliRunner } from "./models/codex-runner";
import { ModelGate } from "./models/gate";
import { registerModels } from "./models/rpc";
import { ModelPass } from "./review/model-pass";
import { Review } from "./review/review";
import { registerReview } from "./review/rpc";
import { RpcServer } from "./rpc/server";
import { SessionIndex } from "./sessions/index";
import { registerSessions } from "./sessions/rpc";
import { Hooks } from "./setup/hooks";
import { McpServers } from "./setup/mcp";
import { registerSetup } from "./setup/rpc";
import { Skills } from "./setup/skills";

declare const __APP_VERSION__: string;

// Electron's own binary runs this as Node. Nothing spawned from here should inherit that.
delete process.env.ELECTRON_RUN_AS_NODE;

/**
 * The RPC token: the first line of stdin. The pipe stays open after it, because the app holds the
 * other end for as long as it runs. Its closing is how the server learns the app is gone, however
 * it went, so a killed app never leaves a server behind holding the port.
 */
function tokenFromStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let head = "";
    let token: string | null = null;
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
      if (token !== null) return;
      head += chunk;
      const nl = head.indexOf("\n");
      if (nl === -1) return;
      token = head.slice(0, nl).trim();
      if (token) resolve(token);
      else reject(new Error("the app sent an empty token"));
    });
    process.stdin.on("end", () => {
      if (token === null) reject(new Error("stdin closed before a token arrived"));
      else process.exit(0);
    });
  });
}

async function main(): Promise<void> {
  if (process.env[TOKEN_STDIN_ENV] !== "1") throw new Error(`${TOKEN_STDIN_ENV}=1 is required: the server only runs under the app, which hands it a token`);
  const token = await tokenFromStdin();
  const home = appHome(process.env);
  mkdirSync(home, { recursive: true });
  const db = openDatabase(join(home, "index.db"));

  const reads = sourceHome(process.env);

  const rpc = new RpcServer();
  rpc.register("system.info", async () => ({
    version: __APP_VERSION__, home, sourceHome: reads, schemaVersion: schemaVersion(db),
  }));
  const library = new Library({
    home: reads, backups: join(home, "backups"), tags: new TagStore(db), trash: (path) => moveToTrash(path, reads),
  });
  registerLibrary(rpc, library);
  const projects = () => library.projects();
  const skills = new Skills({ home: reads, projects });
  const mcp = new McpServers({ home: reads, projects, projectAt: (folder) => library.projectAt(folder) });
  registerSetup(rpc, { skills, mcp, hooks: new Hooks({ home: reads, projects }) });

  const cwd = join(home, "runner-cwd");
  const toolEnv = withToolFolders(process.env);
  const runners = {
    claude: new ClaudeCliRunner({ cwd, env: toolEnv }),
    codex: new CodexCliRunner({ cwd, scratch: join(home, "runner-scratch"), env: toolEnv }),
  };
  const gate = new ModelGate({ db, runners });
  registerModels(rpc, { db, runners, gate });

  const agentCli = new AgentCli({ home: reads, env: toolEnv });
  const servers = () => mcp.list();
  registerMcp(rpc, {
    changes: new McpChanges({ home: reads, cli: agentCli, projects, servers }),
    health: new McpHealthChecks({ home: reads, cli: agentCli, projects, servers }),
    icons: new McpIcons({ folder: join(home, "mcp-icons"), servers }),
    gate,
  });
  registerSkills(rpc, {
    imports: new SkillImports({ home: reads, folder: join(home, "skill-sources"), skills, trash: (path) => moveToTrash(path, reads) }),
    skills, servers,
  });

  const pass = new ModelPass({ db, home: reads, library, gate });
  const review = new Review({ db, home: reads, library, skills, mcp, pass });
  registerReview(rpc, review, pass);

  const sessions = new SessionIndex({ db, home: reads, library });
  registerSessions(rpc, { index: sessions, home: reads, library });
  registerHealth(rpc, new Health({ db, home: reads, library, review, skills }));
  registerGraph(rpc, new ConnectionGraph({ home: reads, library, skills, mcp, sessions }));

  registerFavorites(rpc, new FavoriteStore(db));

  const port = await rpc.listen(Number(process.env.AMC_PORT ?? 0), {
    token, allowedOrigins: (process.env.AMC_ALLOWED_ORIGINS ?? "").split(",").filter(Boolean),
  });
  process.stdout.write(`${JSON.stringify({ type: "ready", port, home })}\n`);
  // After the port is answering: the first look takes seconds on a home with thousands of transcripts.
  sessions.start();
}

main().catch((e: unknown) => {
  process.stdout.write(`${JSON.stringify({ type: "error", message: e instanceof Error ? e.message : String(e) })}\n`);
  process.exit(1);
});
