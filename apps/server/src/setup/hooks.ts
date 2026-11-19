import { join } from "node:path";
import type { Hook } from "@amc/contracts";
import { tildify } from "../library/paths";
import type { Project } from "../library/projects";
import { readJson, record } from "./json";
import { maskCommandLine } from "./mask";

/**
 * The commands each agent runs around its own work. Claude Code and Codex write an event as a list
 * of `{ matcher, hooks: [{ command }] }`; Cursor writes it as a list of `{ command }`. Both shapes
 * are read from every file, so a file in either shape lists what it runs. Only a file's `hooks` key
 * is read, never the settings beside it. (Codex's `config.toml` has `[hooks.state.*]` tables too:
 * those record which hooks it trusts, and define none.)
 */
export class Hooks {
  constructor(private d: { home: string; projects: () => readonly Project[] }) {}

  list(): Hook[] {
    const { home } = this.d;
    const out: Hook[] = [];
    const add = (agent: string, file: string, project: Project | null, event: string, matcher: string | null, command: unknown): void => {
      const line = Array.isArray(command) ? command.filter((part) => typeof part === "string").join(" ") : command;
      if (typeof line !== "string" || line.trim() === "") return;
      out.push({ agent, file: tildify(file, home), projectId: project?.id ?? null, projectName: project?.name ?? null, event, matcher, command: maskCommandLine(line) });
    };
    const addEvents = (agent: string, file: string, project: Project | null, events: unknown): void => {
      for (const [event, entries] of Object.entries(record(events) ?? {})) {
        for (const entry of Array.isArray(entries) ? entries : []) {
          const group = record(entry);
          if (!group) continue;
          const matcher = typeof group.matcher === "string" && group.matcher !== "" ? group.matcher : null;
          if (Array.isArray(group.hooks)) for (const hook of group.hooks) add(agent, file, project, event, matcher, record(hook)?.command);
          else add(agent, file, project, event, matcher, group.command);
        }
      }
    };
    const addFile = (agent: string, file: string, project: Project | null = null): void => addEvents(agent, file, project, record(readJson(file))?.hooks);

    addFile("Claude Code", join(home, ".claude", "settings.json"));
    addFile("Codex", join(home, ".codex", "hooks.json"));
    addFile("Cursor", join(home, ".cursor", "hooks.json"));
    for (const project of this.d.projects()) {
      addFile("Claude Code", join(project.root, ".claude", "settings.json"), project);
      addFile("Claude Code", join(project.root, ".claude", "settings.local.json"), project);
      addFile("Cursor", join(project.root, ".cursor", "hooks.json"), project);
    }

    return out;
  }
}
