import { dirname, join } from "node:path";
import { isDir, present, realOr, walk } from "../paths";
import { MD, RULES, plainSource, type Discovery, type Source } from "../source";

/** Cursor's rules: the person's own under `~/.cursor/rules`, and each project's `.cursor/rules`. */
export function cursorSources(d: Discovery): Source[] {
  const userRules = join(d.home, ".cursor", "rules");
  const folderOf = (rel: string): string | null => (rel.includes("/") ? dirname(rel) : null);
  const out: Source[] = [plainSource({
    id: "cursor-user", group: "cursor", kind: "rules", label: "User rules", path: userRules, root: userRules,
    files: () => walk(userRules, (rel) => RULES.test(rel)), folderOf,
    by: "Cursor loads the rules that apply in every project.",
  })];
  for (const project of d.projects) {
    const rules = join(project.root, ".cursor", "rules");
    if (!isDir(rules) || realOr(rules) === realOr(userRules)) continue;
    out.push(plainSource({
      id: `cursor-project-${project.id}`, group: "cursor", kind: "project-rules", label: project.name, path: rules, root: rules,
      projectId: project.id, files: () => walk(rules, (rel) => RULES.test(rel)), folderOf,
      by: `Cursor loads the ones that apply in ${project.name}.`,
    }));
  }
  return out;
}

/** Gemini CLI's `GEMINI.md`: the person's own, and each project's. */
export function geminiSources(d: Discovery): Source[] {
  const gemini = join(d.home, ".gemini");
  const out: Source[] = [plainSource({
    id: "gemini-user", group: "gemini", kind: "instructions", label: "User instructions", path: join(gemini, "GEMINI.md"), root: gemini,
    files: () => present(gemini, ["GEMINI.md"]),
    by: "Gemini CLI loads it in every session.",
  })];
  for (const project of d.projects) {
    if (present(project.root, ["GEMINI.md"]).length === 0) continue;
    out.push(plainSource({
      id: `gemini-project-${project.id}`, group: "gemini", kind: "project-instructions", label: project.name, path: join(project.root, "GEMINI.md"), root: project.root,
      projectId: project.id, files: () => ["GEMINI.md"],
      by: `Gemini CLI loads it in ${project.name}.`,
    }));
  }
  return out;
}

/** opencode's global rules. */
export function opencodeSources(d: Discovery): Source[] {
  const config = join(d.home, ".config", "opencode");
  return [plainSource({
    id: "opencode-user", group: "opencode", kind: "instructions", label: "User instructions", path: join(config, "AGENTS.md"), root: config,
    files: () => present(config, ["AGENTS.md"]),
    by: "opencode loads it in every session.",
  })];
}

/** Hermes: the persona it starts every session as, and the memories it keeps. */
export function hermesSources(d: Discovery): Source[] {
  const hermes = join(d.home, ".hermes");
  const memories = join(hermes, "memories");
  return [
    plainSource({
      id: "hermes-user", group: "hermes", kind: "instructions", label: "Persona", path: join(hermes, "SOUL.md"), root: hermes,
      files: () => present(hermes, ["SOUL.md"]),
      by: "Hermes starts every session as the persona it describes.",
    }),
    plainSource({
      id: "hermes-memories", group: "hermes", kind: "memory", label: "Memories", path: memories, root: memories,
      files: () => walk(memories, (rel) => MD.test(rel)),
      by: "Hermes keeps these between sessions.",
    }),
  ];
}

/** OpenClaw's workspace: the files that say who it is, who it works for and what it may use. */
export function openclawSources(d: Discovery): Source[] {
  const workspace = join(d.home, ".openclaw", "workspace");
  return [plainSource({
    id: "openclaw-workspace", group: "openclaw", kind: "instructions", label: "Workspace files", path: workspace, root: workspace,
    files: () => walk(workspace, (rel) => MD.test(rel), 0),
    by: "OpenClaw loads them at the start of a session.",
  })];
}
