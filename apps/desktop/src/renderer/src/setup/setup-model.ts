import { MCP_AGENT_LABEL, McpAgentSchema, type Hook, type McpAgent, type McpDefinition, type McpHealth, type McpServer, type Skill, type SkillIssue } from "@amc/contracts";
import type { IconName } from "@amc/ui";

export const MCP_AGENTS: readonly McpAgent[] = McpAgentSchema.options;

export type SetupTab = "skills" | "mcp" | "hooks";

export const SETUP_TAB_LABEL: Record<SetupTab, string> = { skills: "Skills", mcp: "MCP servers", hooks: "Hooks" };

/** "1 place", "3 places". */
export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** The skills whose name, description or owner holds every word typed. */
export function skillsKept(query: string, skills: readonly Skill[]): Skill[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...skills];
  return skills.filter((skill) => {
    const text = [skill.name, skill.description ?? "", ...skill.places.map((p) => p.label)].join("\n").toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

/** Names in the room a row has: each once, all of them when three or fewer, else the first two and a count. */
function named(names: string[]): string {
  const each = [...new Set(names)];
  return each.length <= 3 ? each.join(", ") : `${each.slice(0, 2).join(", ")} and ${each.length - 2} more`;
}

export const reachedBy = (skill: Skill): string => named(skill.places.map((p) => p.label));

/** The agent a skill's place belongs to, for its mark. A place is named for the agent whose folder it
 *  is, for a project and the folder in it ("atlas · .claude"), or for a plugin, which only Claude has. */
export function agentOfPlace(label: string): string {
  const inProject = label.lastIndexOf(" · .");
  if (inProject !== -1) return label.slice(inProject + 4);
  return label.endsWith(" plugin") ? "claude" : label;
}

/** Whose config a definition or a hook is in: the agent, and the project when it is for one. */
export const ownerOf = (at: Pick<McpDefinition | Hook, "agent" | "projectName">): string =>
  at.projectName === null ? at.agent : `${at.agent} · ${at.projectName}`;

/** One way a server is started, with every place that starts it that way. */
type McpWay = { fingerprint: string; transport: McpDefinition["transport"]; target: string; places: McpDefinition[] };

/** A server's definitions gathered by how they start it, in the order the first of each was found. */
export function waysOf(server: McpServer): McpWay[] {
  const ways = new Map<string, McpWay>();
  for (const definition of server.definitions) {
    const way = ways.get(definition.fingerprint);
    if (way) way.places.push(definition);
    else ways.set(definition.fingerprint, { fingerprint: definition.fingerprint, transport: definition.transport, target: definition.target, places: [definition] });
  }
  return [...ways.values()];
}

/** What a server's row says under its name. */
export function definedIn(server: McpServer): string {
  const where = named(server.definitions.map((d) => d.agent));
  return server.definitions.length === 1 ? where : `${plural(server.definitions.length, "place")}: ${where}`;
}

/** What a hook is called in a list: when it runs, and what it is limited to. */
export const hookTitle = (hook: Hook): string => (hook.matcher === null ? hook.event : `${hook.event} · ${hook.matcher}`);

/** A skill is its folder: the `SKILL.md` and whatever scripts and notes lie beside it. */
export const skillFolder = (skill: Pick<Skill, "path">): string => skill.path.slice(0, skill.path.lastIndexOf("/"));

/**
 * A server as text, for a drag or the share sheet: each way it is started, and where. It is made of
 * what the window shows and nothing else, so a secret is masked here as it is there, and a variable
 * or a header is its name alone.
 */
export function serverText(server: McpServer): string {
  const lines = [`${server.name} (MCP server)`];
  for (const way of waysOf(server)) {
    lines.push("", way.target);
    for (const place of way.places) {
      lines.push(`${ownerOf(place)}: ${place.file}${place.transport === "unknown" ? "" : ` (${place.transport})`}`);
      if (place.envKeys.length > 0) lines.push(`  Given ${place.envKeys.join(", ")}. The values are left out.`);
      if (place.headerKeys.length > 0) lines.push(`  Sends ${place.headerKeys.join(", ")}. The values are left out.`);
    }
  }
  return lines.join("\n");
}

/** A hook as text, for a drag or the share sheet. Its command is masked as the window shows it. */
export const hookText = (hook: Hook): string => [`${hookTitle(hook)} (hook)`, `${ownerOf(hook)}: ${hook.file}`, "", hook.command].join("\n");

/** The agents a server can be removed from or signed in to from here, by the name their config goes under. */
const MCP_AGENT_BY_LABEL = new Map(MCP_AGENTS.map((agent) => [MCP_AGENT_LABEL[agent], agent]));
export const mcpAgentOf = (label: string): McpAgent | null => MCP_AGENT_BY_LABEL.get(label) ?? null;

export const AGENT_MARK: Record<string, IconName> = {
  "Claude Code": "claude", "Claude Desktop": "claude", Codex: "openai", Cursor: "cursor", Gemini: "gemini", opencode: "opencode",
};

/** Each agent that defines a server, once, in the order found. */
export const agentsOf = (server: McpServer): string[] => [...new Set(server.definitions.map((d) => d.agent))];

/** Each agent with how many servers it has, most first. */
export function agentCounts(servers: readonly McpServer[]): { agent: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const server of servers) for (const agent of agentsOf(server)) counts.set(agent, (counts.get(agent) ?? 0) + 1);
  return [...counts].map(([agent, count]) => ({ agent, count })).sort((a, b) => b.count - a.count || a.agent.localeCompare(b.agent));
}

export type HealthState = McpHealth["state"];
export const HEALTH_WORD: Record<HealthState, string> = { connected: "Connected", failed: "Failed", "needs-sign-in": "Sign in", off: "Off", unknown: "Not checked" };

/**
 * What was last learned of one place a server is defined. A health names its agent as the check knew
 * it, which may be the config's label ("Claude Code") or the agent's id ("claude"): either is taken.
 */
export function healthAt(health: readonly McpHealth[], name: string, place: Pick<McpDefinition, "agent" | "projectId">): McpHealth | null {
  const id = mcpAgentOf(place.agent);
  return health.find((h) => h.name === name && h.projectId === place.projectId && (h.agent === place.agent || h.agent === id)) ?? null;
}

/** A server's row carries the state that most needs the person, across every place it is defined. */
const HEALTH_FIRST: readonly HealthState[] = ["failed", "needs-sign-in", "connected", "off", "unknown"];
export function healthOf(health: readonly McpHealth[], server: McpServer): HealthState {
  const states = server.definitions.map((place) => healthAt(health, server.name, place)?.state ?? "unknown");
  return HEALTH_FIRST.find((state) => states.includes(state)) ?? "unknown";
}

/** "3 connected, 1 failed, 1 wants a sign-in", of the servers listed, or null before any check. */
export function healthSummary(health: readonly McpHealth[], servers: readonly McpServer[]): string | null {
  const states = servers.map((server) => healthOf(health, server));
  if (states.every((state) => state === "unknown")) return null;
  const count = (state: HealthState) => states.filter((s) => s === state).length;
  const signIns = count("needs-sign-in");
  return [
    `${count("connected")} connected`, `${count("failed")} failed`, `${signIns} ${signIns === 1 ? "wants" : "want"} a sign-in`,
  ].join(", ");
}

/** What the Skills sidebar narrows the list to. */
export type SkillScope = { kind: "all" } | { kind: "favorites" } | { kind: "place"; label: string } | { kind: "issues" };

/** Each place skills are reached from with how many it reaches, most first. */
export function placeCounts(skills: readonly Skill[]): { label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const skill of skills) for (const label of new Set(skill.places.map((p) => p.label))) counts.set(label, (counts.get(label) ?? 0) + 1);
  return [...counts].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function skillsInScope(scope: SkillScope, skills: readonly Skill[], issues: ReadonlyMap<string, SkillIssue[]>, isStarred: (id: string) => boolean): Skill[] {
  if (scope.kind === "favorites") return skills.filter((skill) => isStarred(skill.id));
  if (scope.kind === "place") return skills.filter((skill) => skill.places.some((p) => p.label === scope.label));
  if (scope.kind === "issues") return skills.filter((skill) => issues.has(skill.id));
  return [...skills];
}

/** A command line as typed, cut into the program and its arguments. Quotes keep a spaced argument whole. */
export function commandWords(line: string): string[] {
  const words: string[] = [];
  for (const match of line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) words.push(match[1] ?? match[2] ?? match[3]!);
  return words;
}

/** The line `commandWords` would cut back into these words. */
export const commandLine = (words: readonly string[]): string => words.map((word) => (/\s/.test(word) || word === "" ? `"${word}"` : word)).join(" ");

/** "12 KB", "3.4 MB". */
export function sizeSaid(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Whether an offered skill holds anything an agent could run, in words. */
export function runnableSaid(runnable: readonly string[]): string {
  if (runnable.length === 0) return "Holds nothing an agent could run.";
  return `Holds ${plural(runnable.length, "script")}. Installing does not run ${runnable.length === 1 ? "it" : "them"}, but an agent may.`;
}
