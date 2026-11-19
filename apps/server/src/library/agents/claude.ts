import { dirname, join } from "node:path";
import { claudeProjectCwd, claudeSlugLabel } from "../claude-projects";
import { childFolders, present, presentNear, walk } from "../paths";
import { MD, once, plainSource, type Discovery, type Source } from "../source";

/** The folder a nested instruction file is in, or null for one at the project's top. */
const nestedFolder = (rel: string): string | null => {
  const dir = dirname(rel);
  return dir === "." || dir === ".claude" ? null : dir.replace(/\/\.claude$/, "");
};

/** Claude Code's files under `~/.claude`, and the instruction files it loads from a project's folder. */
export function claudeSources(d: Discovery): Source[] {
  const claude = join(d.home, ".claude");
  const projects = join(claude, "projects");
  const out: Source[] = [plainSource({
    id: "claude-user", group: "claude", kind: "instructions", label: "User instructions", path: join(claude, "CLAUDE.md"), root: claude,
    files: () => present(claude, ["CLAUDE.md"]),
    by: "Claude Code loads it in every session.",
  })];

  const memoryFiles = (slug: string): string[] => walk(join(projects, slug, "memory"), (rel) => MD.test(rel), 0);
  /** Each project folder that keeps memory, with where its sessions ran. Worked out once: a slug is decoded against the disk. */
  const memoryFolders = once(() => new Map(childFolders(projects)
    .filter((slug) => memoryFiles(slug).length > 0)
    .map((slug) => {
      const cwd = claudeProjectCwd(join(projects, slug));
      const project = cwd ? d.projectAt(cwd) : null;
      return [slug, { label: project?.name ?? claudeSlugLabel(slug), projectId: project?.id ?? null }] as const;
    })));
  out.push({
    ...plainSource({
      id: "claude-projects", group: "claude", kind: "project-memory", label: "Project memory", path: projects, root: projects,
      files: () => [...memoryFolders().keys()].flatMap((slug) => memoryFiles(slug).map((file) => `${slug}/memory/${file}`)),
      folderOf: (rel) => memoryFolders().get(rel.split("/")[0]!)?.label ?? null,
      projectOf: (rel) => memoryFolders().get(rel.split("/")[0]!)?.projectId ?? null,
      by: "Claude Code keeps these for a project: it starts that project's sessions with the folder's MEMORY.md and opens the rest when it needs them.",
    }),
    folders: () => [...memoryFolders()].map(([slug, folder]) => ({ rel: `${slug}/memory`, label: folder.label })),
  });

  for (const project of d.projects) {
    const names = presentNear(project.root, ["CLAUDE.md", ".claude/CLAUDE.md", "CLAUDE.local.md"]);
    if (names.length === 0) continue;
    out.push(plainSource({
      id: `claude-project-${project.id}`, group: "claude", kind: "project-instructions", label: project.name, path: project.root, root: project.root,
      projectId: project.id, files: () => names, folderOf: nestedFolder,
      by: `Claude Code loads them in ${project.name}: the top one in every session there, a nested one when it works in that folder.`,
    }));
  }
  return out;
}
