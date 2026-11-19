import { existsSync } from "node:fs";
import { join } from "node:path";
import { claudeProjectFolder } from "./claude-projects";
import { childFolders, readOr } from "./paths";
import type { RealmNames } from "./realm-names";

/** The folders a state file keeps settings for, under `projects`. A file caught mid-rewrite lists none: the next read has it. */
function projectsIn(stateFile: string): string[] {
  try { return Object.keys((JSON.parse(readOr(stateFile) ?? "") as { projects?: Record<string, unknown> }).projects ?? {}); } catch { return []; }
}

/**
 * Every folder an agent has recorded working in: the folders Realm's spaces work in, the projects
 * Claude Code and Codex keep settings for, Gemini's project list, and every folder Claude Code keeps
 * a project directory for (sessions started by another app are only there). Only the paths are read
 * out of each file, never the settings beside them.
 */
export function knownFolders(home: string, names: RealmNames): string[] {
  const folders = [...names.spaces.values()].map((space) => space.folderPath);
  folders.push(...projectsIn(join(home, ".claude.json")));

  for (const m of (readOr(join(home, ".codex", "config.toml")) ?? "").matchAll(/^\[projects\.(?:"((?:[^"\\]|\\.)*)"|'([^']*)')\]\s*$/gm)) {
    folders.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, "$1") : m[2]!);
  }
  folders.push(...projectsIn(join(home, ".gemini", "projects.json")));

  for (const slug of childFolders(join(home, ".claude", "projects"))) {
    const folder = claudeProjectFolder(slug);
    if (folder) folders.push(folder);
  }
  return [...folders, ...folders.flatMap(checkoutsIn)];
}

/**
 * The repositories directly inside a folder that is not one itself. A workspace folder often holds
 * several checkouts side by side, and a session started in the folder never records them.
 */
function checkoutsIn(folder: string): string[] {
  if (existsSync(join(folder, ".git"))) return [];
  return childFolders(folder).map((name) => join(folder, name)).filter((child) => existsSync(join(child, ".git")));
}
