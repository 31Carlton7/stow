import { readdirSync, type Dirent } from "node:fs";
import { basename, join } from "node:path";
import type { SessionAgent } from "@amc/contracts";

/** A transcript where its agent left it. `parentId` is set for a Claude sub-agent, whose folder names the session that started it. */
export type Transcript = { path: string; agent: SessionAgent; parentId: string | null };

const entries = (dir: string): Dirent[] => { try { return readdirSync(dir, { withFileTypes: true }); } catch { return []; } };
const isTranscript = (entry: Dirent): boolean => entry.isFile() && entry.name.endsWith(".jsonl");

/** Every `.jsonl` under a folder, however deep: Codex files by year, month and day, and a sub-agent's own sub-agents. */
function transcriptsUnder(dir: string): string[] {
  return entries(dir).flatMap((entry) => {
    if (entry.isDirectory()) return transcriptsUnder(join(dir, entry.name));
    return isTranscript(entry) ? [join(dir, entry.name)] : [];
  });
}

/**
 * Claude Code keeps `~/.claude/projects/<slug>/<sessionId>.jsonl`, and what a session's sub-agents
 * said under `<slug>/<sessionId>/subagents/`. Codex keeps `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`.
 */
export function findTranscripts(home: string): Transcript[] {
  const found: Transcript[] = [];
  const projects = join(home, ".claude", "projects");
  for (const slug of entries(projects)) {
    if (!slug.isDirectory()) continue;
    const folder = join(projects, slug.name);
    for (const entry of entries(folder)) {
      if (isTranscript(entry)) found.push({ path: join(folder, entry.name), agent: "claude", parentId: null });
      if (!entry.isDirectory()) continue;
      for (const path of transcriptsUnder(join(folder, entry.name, "subagents"))) found.push({ path, agent: "claude", parentId: entry.name });
    }
  }
  for (const path of transcriptsUnder(join(home, ".codex", "sessions"))) {
    if (basename(path).startsWith("rollout-")) found.push({ path, agent: "codex", parentId: null });
  }
  return found;
}
