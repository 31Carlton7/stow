import { MCP_AGENT_LABEL, type McpAgent, type McpDraft, type McpOutcome, type McpPlacement, type McpServer, type McpStep } from "@amc/contracts";
import { tildify } from "../library/paths";
import type { Project } from "../library/projects";
import { findExecutable, runCli, type RunCli } from "../models/cli";
import { lastLines } from "../models/runner";
import { RpcError } from "../rpc/error";
import { agentEnv, claudeAdd, claudeRemove, codexAdd, codexRemove, draftProblem, secretsOf, withoutSecrets, type AgentCommand, type Planned } from "./mcp-commands";
import { addToFile, fileAddRefusal, removeFromFile, serversFile, type FileAgent } from "./mcp-file";

const CHANGE_TIMEOUT_MS = 30_000;

export type AgentTools = {
  home: string;
  env: NodeJS.ProcessEnv;
  runCli?: RunCli;
};

/** Where `claude` and `codex` are, and how they are run on the home the app reads. Shared by changes, health and sign-in. */
export class AgentCli {
  private readonly env: NodeJS.ProcessEnv;
  private readonly start: RunCli;

  constructor(private readonly d: AgentTools) {
    this.env = agentEnv(d.env, d.home);
    this.start = d.runCli ?? runCli;
  }

  locate(tool: "claude" | "codex"): string | null {
    return (tool === "claude" ? this.d.env.AMC_CLAUDE_BIN : this.d.env.AMC_CODEX_BIN) || findExecutable(tool, this.d.env);
  }

  run(command: AgentCommand, timeoutMs: number) {
    const bin = this.locate(command.tool);
    if (!bin) return Promise.resolve({ code: null, stdout: "", stderr: "", missing: true, aborted: false, timedOut: false });
    return this.start({ command: bin, args: command.args, cwd: command.cwd, env: this.env, timeoutMs });
  }
}

type ChangeDeps = {
  home: string;
  cli: AgentCli;
  projects: () => readonly Project[];
  servers: () => McpServer[];
};

type Step =
  | { agent: McpAgent; how: "command"; planned: Planned }
  | { agent: FileAgent; how: "file"; file: string; refused: string | null };

/**
 * Adding and removing servers. Claude Code and Codex are changed by their own tools; Cursor and
 * Gemini by an edit of the one key in their file. `preview` and `add` plan from the same steps, so
 * what was shown is what is run.
 */
export class McpChanges {
  constructor(private readonly d: ChangeDeps) {}

  private project(projectId: string | null): Project | null {
    if (projectId === null) return null;
    const project = this.d.projects().find((p) => p.id === projectId);
    if (!project) throw new RpcError("MCP_NO_PROJECT", "that project is no longer in the library");
    return project;
  }

  private has(name: string, agent: McpAgent, projectId: string | null): boolean {
    return this.d.servers().some((server) => server.name === name && server.definitions.some((d) => d.agent === MCP_AGENT_LABEL[agent] && d.projectId === projectId));
  }

  private plan(draft: McpDraft, placement: McpPlacement): Step[] {
    const project = this.project(placement.projectId);
    const problem = draftProblem(draft);
    return [...new Set(placement.agents)].map((agent): Step => {
      if (agent === "cursor" || agent === "gemini") {
        const file = serversFile(agent, project?.root ?? this.d.home);
        return { agent, how: "file", file, refused: problem ?? fileAddRefusal(agent, file, draft.name, project === null) };
      }
      if (problem) return { agent, how: "command", planned: { refused: problem } };
      if (!this.d.cli.locate(agent)) return { agent, how: "command", planned: { refused: `\`${agent}\` is not installed` } };
      // Codex's tool replaces a server of the same name without a word, so the name is checked here.
      if (this.has(draft.name, agent, placement.projectId)) {
        return { agent, how: "command", planned: { refused: `${MCP_AGENT_LABEL[agent]} already has a server named ${draft.name} here: remove it first` } };
      }
      return { agent, how: "command", planned: agent === "claude" ? claudeAdd(draft, project?.root ?? null, this.d.home) : codexAdd(draft, project?.root ?? null, this.d.home) };
    });
  }

  preview(draft: McpDraft, placement: McpPlacement): McpStep[] {
    return this.plan(draft, placement).map((step): McpStep => {
      if (step.how === "file") return { agent: step.agent, how: "file", shows: tildify(step.file, this.d.home), refused: step.refused };
      return "refused" in step.planned
        ? { agent: step.agent, how: "command", shows: "", refused: step.planned.refused }
        : { agent: step.agent, how: "command", shows: step.planned.shows, refused: null };
    });
  }

  async add(draft: McpDraft, placement: McpPlacement): Promise<McpOutcome[]> {
    const secrets = secretsOf(draft);
    const outcomes: McpOutcome[] = [];
    for (const step of this.plan(draft, placement)) {
      if (step.how === "file") {
        if (step.refused) { outcomes.push({ agent: step.agent, ok: false, detail: step.refused }); continue; }
        try { addToFile(step.agent, step.file, draft); outcomes.push({ agent: step.agent, ok: true, detail: null }); }
        catch (e) { outcomes.push({ agent: step.agent, ok: false, detail: withoutSecrets(e instanceof Error ? e.message : String(e), secrets) }); }
        continue;
      }
      if ("refused" in step.planned) { outcomes.push({ agent: step.agent, ok: false, detail: step.planned.refused }); continue; }
      outcomes.push({ agent: step.agent, ...(await this.run(step.planned.command, secrets)) });
    }
    return outcomes;
  }

  async remove(name: string, agent: McpAgent, projectId: string | null): Promise<McpOutcome> {
    const project = this.project(projectId);
    if (agent === "cursor" || agent === "gemini") {
      try { removeFromFile(agent, serversFile(agent, project?.root ?? this.d.home), name); return { agent, ok: true, detail: null }; }
      catch (e) { return { agent, ok: false, detail: e instanceof Error ? e.message : String(e) }; }
    }
    if (agent === "codex") {
      if (project) return { agent, ok: false, detail: "Codex keeps its servers for every project, not for one" };
      const ran = await this.run(codexRemove(name, this.d.home).command, []);
      // Codex exits 0 for a name it does not have, and says so.
      return { agent, ...(ran.ok && /no mcp server named/i.test(ran.detail ?? "") ? { ok: false, detail: ran.detail } : ran) };
    }
    return { agent, ...(await this.run(claudeRemove(name, this.claudeScope(name, projectId), project?.root ?? null, this.d.home).command, [])) };
  }

  /** A project's server is Claude Code's own for that folder (`local`), unless it is read from the project's `.mcp.json`. */
  private claudeScope(name: string, projectId: string | null): "user" | "local" | "project" {
    if (projectId === null) return "user";
    const definitions = this.d.servers().find((server) => server.name === name)?.definitions ?? [];
    const here = definitions.filter((d) => d.agent === MCP_AGENT_LABEL.claude && d.projectId === projectId);
    return here.length > 0 && here.every((d) => d.file.endsWith("/.mcp.json")) ? "project" : "local";
  }

  private async run(command: AgentCommand, secrets: readonly [string, string][]): Promise<{ ok: boolean; detail: string | null }> {
    const exit = await this.d.cli.run(command, CHANGE_TIMEOUT_MS);
    if (exit.missing) return { ok: false, detail: `\`${command.tool}\` is not installed` };
    if (exit.timedOut) return { ok: false, detail: `\`${command.tool}\` did not answer within ${CHANGE_TIMEOUT_MS / 1000}s` };
    const said = lastLines(withoutSecrets(exit.stderr.trim() || exit.stdout, secrets)) || null;
    return exit.code === 0 ? { ok: true, detail: said } : { ok: false, detail: said ?? `\`${command.tool}\` exited with code ${exit.code}` };
  }
}
