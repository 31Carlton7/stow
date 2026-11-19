import { MCP_AGENT_LABEL, type McpAgent, type McpHealth, type McpServer } from "@amc/contracts";
import type { Project } from "../library/projects";
import { lastLines } from "../models/runner";
import { maskCommandLine } from "../setup/mask";
import type { AgentCli } from "./mcp-changes";

type State = McpHealth["state"];
export type Reading = { name: string; state: State; detail: string | null };

const LIST_TIMEOUT_MS = 90_000;
const SIGN_IN_TIMEOUT_MS = 300_000;
/** How long a sign-in is watched before the call answers: long enough for a tool to refuse, which it does at once. */
const SIGN_IN_SETTLE_MS = 1_500;

/** What Claude Code says of a server after its mark: `✓ Connected`, `! Needs authentication`, `✘ Failed to connect — why`. */
function claudeState(said: string): { state: State; detail: string | null } {
  const why = /(?:—|-)\s+(.+)$/.exec(said)?.[1]?.trim() ?? null;
  if (/needs auth/i.test(said)) return { state: "needs-sign-in", detail: null };
  if (/failed to connect/i.test(said) || /^\s*[✘✗]/.test(said)) return { state: "failed", detail: why };
  if (/connected/i.test(said)) return { state: "connected", detail: /·\s*(.+)$/.exec(said)?.[1]?.trim() ?? null };
  if (/pending approval|disabled/i.test(said)) return { state: "off", detail: said.replace(/^\W+/, "") };
  return { state: "unknown", detail: null };
}

/**
 * The lines of `claude mcp list` that are a server: `name: command or URL - ✓ Connected`. The name
 * ends at the first `: ` and the status starts after the last ` - `, since a command line may hold
 * either. Headings, warnings and anything else are passed over.
 */
export function readClaudeList(printed: string): Reading[] {
  const readings: Reading[] = [];
  for (const row of printed.split("\n")) {
    const colon = row.indexOf(": "), dash = row.lastIndexOf(" - ");
    if (colon <= 0 || dash < colon || /^\s/.test(row)) continue;
    readings.push({ name: row.slice(0, colon), ...claudeState(row.slice(dash + 3)) });
  }
  return readings;
}

/** `claude mcp get <name>`: a `Status:` line, and an `Issue:` line when it failed. */
export function readClaudeGet(name: string, printed: string): Reading | null {
  const status = /^\s*Status:\s*(.+)$/m.exec(printed)?.[1];
  if (!status) return null;
  const reading = claudeState(status);
  const issue = /^\s*Issue:\s*(.+)$/m.exec(printed)?.[1]?.trim();
  return { name, ...reading, detail: reading.detail ?? issue ?? null };
}

/**
 * `codex mcp list --json`. Codex says whether a server is switched on and where its sign-in
 * stands; it does not try the connection, so a server that is on and signed in is `unknown`.
 */
export function readCodexList(printed: string): Reading[] {
  let rows: unknown;
  try { rows = JSON.parse(printed); } catch { return []; }
  if (!Array.isArray(rows)) return [];
  const readings: Reading[] = [];
  for (const row of rows as { name?: unknown; enabled?: unknown; disabled_reason?: unknown; auth_status?: unknown }[]) {
    if (typeof row?.name !== "string") continue;
    const auth = typeof row.auth_status === "string" ? row.auth_status : "";
    if (row.enabled === false) readings.push({ name: row.name, state: "off", detail: typeof row.disabled_reason === "string" ? row.disabled_reason : null });
    else if (/not.?logged.?in/i.test(auth)) readings.push({ name: row.name, state: "needs-sign-in", detail: null });
    else readings.push({ name: row.name, state: "unknown", detail: "Codex has it switched on; it only tries the connection in a session" });
  }
  return readings;
}

type HealthDeps = {
  home: string;
  cli: AgentCli;
  projects: () => readonly Project[];
  servers: () => McpServer[];
  now?: () => number;
};

type Target = { name: string; agent: McpAgent; projectId: string | null; disabled: boolean };

const keyOf = (t: { name: string; agent: string; projectId: string | null }): string => `${t.agent}\n${t.projectId ?? ""}\n${t.name}`;

/**
 * What each agent's own tool says of its servers, kept from the last time the person asked.
 * Asking starts the tools in the background, one run at a time for an agent, and `report` answers
 * at once with what is known and the names still being asked.
 */
export class McpHealthChecks {
  private readonly known = new Map<string, McpHealth>();
  private readonly asking = new Map<string, Target>();
  private readonly queue: Record<"claude" | "codex", Promise<void>> = { claude: Promise.resolve(), codex: Promise.resolve() };
  private readonly signingIn = new Set<string>();
  private readonly now: () => number;

  constructor(private readonly d: HealthDeps) { this.now = d.now ?? Date.now; }

  report(check: boolean, name?: string): { health: McpHealth[]; checking: string[] } {
    if (check) this.check(name);
    return { health: [...this.known.values()], checking: [...new Set([...this.asking.values()].map((t) => t.name))].sort() };
  }

  /** Resolves when nothing is being asked any more. */
  async settled(): Promise<void> { await Promise.all(Object.values(this.queue)); }

  private targets(name: string | undefined): Target[] {
    const agents = Object.keys(MCP_AGENT_LABEL) as McpAgent[];
    const targets = new Map<string, Target>();
    for (const server of this.d.servers()) {
      if (name !== undefined && server.name !== name) continue;
      for (const definition of server.definitions) {
        const agent = agents.find((a) => MCP_AGENT_LABEL[a] === definition.agent);
        if (!agent) continue;
        const target = { name: server.name, agent, projectId: definition.projectId, disabled: definition.disabled };
        targets.set(keyOf(target), target);
      }
    }
    return [...targets.values()];
  }

  private record(target: Target, state: State, detail: string | null): void {
    this.known.set(keyOf(target), {
      name: target.name, agent: MCP_AGENT_LABEL[target.agent], projectId: target.projectId, state,
      detail: detail === null ? null : maskCommandLine(detail).slice(0, 300), tools: null, checkedAt: this.now(),
    });
  }

  private check(name: string | undefined): void {
    const targets = this.targets(name);
    for (const target of targets) {
      if (target.agent === "cursor" || target.agent === "gemini") {
        if (target.disabled) this.record(target, "off", null);
        else this.record(target, "unknown", `${MCP_AGENT_LABEL[target.agent]} has no command that checks a server`);
      }
    }
    const fresh = (agent: "claude" | "codex"): Target[] => targets.filter((t) => t.agent === agent && !this.asking.has(keyOf(t)));

    const codex = fresh("codex");
    if (codex.length > 0) this.enqueue("codex", codex, () => this.askCodex(codex));

    // Claude Code lists a project's own servers only from inside that project, so each folder is a run of its own.
    const byFolder = new Map<string | null, Target[]>();
    for (const target of fresh("claude")) byFolder.set(target.projectId, [...(byFolder.get(target.projectId) ?? []), target]);
    for (const [projectId, group] of byFolder) this.enqueue("claude", group, () => this.askClaude(projectId, group, name !== undefined));
  }

  private enqueue(agent: "claude" | "codex", group: Target[], ask: () => Promise<void>): void {
    for (const target of group) this.asking.set(keyOf(target), target);
    this.queue[agent] = this.queue[agent].then(ask).catch(() => { /* a run that threw leaves what was known */ }).finally(() => {
      for (const target of group) this.asking.delete(keyOf(target));
    });
  }

  private failure(tool: "claude" | "codex", exit: { missing: boolean; timedOut: boolean }): string | null {
    if (exit.missing) return `\`${tool}\` is not installed`;
    if (exit.timedOut) return `\`${tool}\` did not answer within ${LIST_TIMEOUT_MS / 1000}s`;
    return null;
  }

  private async askCodex(group: Target[]): Promise<void> {
    const exit = await this.d.cli.run({ tool: "codex", args: ["mcp", "list", "--json"], cwd: this.d.home }, LIST_TIMEOUT_MS);
    const readings = readCodexList(exit.stdout);
    const failure = this.failure("codex", exit);
    for (const target of group) {
      const reading = readings.find((r) => r.name === target.name);
      this.record(target, reading?.state ?? "unknown", failure ?? reading?.detail ?? (reading ? null : "Codex did not list it"));
    }
  }

  private async askClaude(projectId: string | null, group: Target[], one: boolean): Promise<void> {
    const cwd = projectId === null ? this.d.home : this.d.projects().find((p) => p.id === projectId)?.root;
    if (!cwd) { for (const target of group) this.record(target, "unknown", "its project is no longer in the library"); return; }
    if (one) {
      for (const target of group) {
        const exit = await this.d.cli.run({ tool: "claude", args: ["mcp", "get", target.name], cwd }, LIST_TIMEOUT_MS);
        const reading = readClaudeGet(target.name, exit.stdout);
        this.record(target, reading?.state ?? "unknown", this.failure("claude", exit) ?? reading?.detail ?? (reading ? null : lastLines(exit.stderr || exit.stdout) || null));
      }
      return;
    }
    const exit = await this.d.cli.run({ tool: "claude", args: ["mcp", "list"], cwd }, LIST_TIMEOUT_MS);
    const readings = readClaudeList(exit.stdout);
    const failure = this.failure("claude", exit);
    for (const target of group) {
      const reading = readings.find((r) => r.name === target.name);
      this.record(target, reading?.state ?? "unknown", failure ?? reading?.detail ?? (reading ? null : "Claude Code did not list it"));
    }
  }

  /**
   * Start the agent's own sign-in, which opens the person's browser and waits for them there. The
   * call answers as soon as the tool has had time to refuse; a sign-in still open is `started`.
   */
  async signIn(name: string, agent: McpAgent): Promise<{ started: boolean; detail: string | null }> {
    if (agent === "cursor" || agent === "gemini") return { started: false, detail: `${MCP_AGENT_LABEL[agent]} signs in to a server from its own window` };
    const key = `${agent}\n${name}`;
    if (this.signingIn.has(key)) return { started: true, detail: "the sign-in is already open in the browser" };
    if (!this.d.cli.locate(agent)) return { started: false, detail: `\`${agent}\` is not installed` };
    this.signingIn.add(key);
    const finished = this.d.cli.run({ tool: agent, args: ["mcp", "login", name], cwd: this.d.home }, SIGN_IN_TIMEOUT_MS).finally(() => this.signingIn.delete(key));
    let settle: NodeJS.Timeout | undefined;
    const exit = await Promise.race([finished, new Promise<null>((resolve) => { settle = setTimeout(() => resolve(null), SIGN_IN_SETTLE_MS); })]);
    clearTimeout(settle);
    if (exit === null) return { started: true, detail: null };
    const said = lastLines(exit.stderr.trim() || exit.stdout) || null;
    return exit.code === 0 ? { started: true, detail: said } : { started: false, detail: said ?? `\`${agent}\` could not start the sign-in` };
  }
}
