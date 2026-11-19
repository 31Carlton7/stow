import { Icon, type IconName } from "@amc/ui";

/** Each agent's mark, by the first word of its name in lower case: "claude" for the library's group
 *  and for "Claude Code" alike. */
const MARK_OF = new Map<string, IconName>([
  ["realm", "realm"], ["claude", "claude"], ["codex", "openai"], ["cursor", "cursor"], ["gemini", "gemini"], ["opencode", "opencode"],
  ["hermes", "hermes"], ["openclaw", "openclaw"], ["copilot", "githubCopilot"], ["goose", "goose"], ["qwen", "qwen"],
]);

/** The folders under the home folder that are one agent's own, and the files in a project that are. */
const AGENT_FOLDERS: readonly [start: string, agent: string][] = [
  ["~/Realm/", "realm"], ["~/.claude", "claude"], ["~/Library/Application Support/Claude/", "claude"], ["~/.codex/", "codex"],
  ["~/.cursor/", "cursor"], ["~/.gemini/", "gemini"], ["~/.config/opencode/", "opencode"], ["~/.hermes/", "hermes"], ["~/.openclaw/", "openclaw"],
];
const AGENT_FILES: readonly [part: string, agent: string][] = [
  ["/.claude/", "claude"], ["/CLAUDE.md", "claude"], ["/.mcp.json", "claude"], ["/.codex/", "codex"], ["/.cursor/", "cursor"],
  ["/.cursorrules", "cursor"], ["/GEMINI.md", "gemini"], ["/.gemini/", "gemini"],
];

/** Whose a file is, read off its path as the app shows it (`~/.claude/…`), or null when the path
 *  does not say: an `AGENTS.md` is every agent's. */
export function agentOfPath(displayPath: string): string | null {
  return AGENT_FOLDERS.find(([start]) => displayPath.startsWith(start))?.[1]
    ?? AGENT_FILES.find(([part]) => displayPath.includes(part))?.[1]
    ?? null;
}

/**
 * The mark of the agent a file, a session or a setting came from, in the agent's own colour. `of` is
 * the agent as the app has it at that place: the library's group, or a name that starts with the
 * agent's ("Claude Code", "Realm · Atlas"). A name no agent here answers to draws `fallback`, or nothing.
 */
export function SourceMark({ of, size = 14, className, fallback }: { of: string | null; size?: number; className?: string; fallback?: IconName }) {
  const mark = of === null ? undefined : MARK_OF.get(of.trim().split(/[^A-Za-z]/, 1)[0]!.toLowerCase());
  if (mark === undefined) return fallback === undefined ? null : <Icon name={fallback} size={size} className={className} />;
  return <Icon name={mark} size={size} className={className} colored />;
}
