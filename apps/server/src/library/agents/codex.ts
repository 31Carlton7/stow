import { dirname, join } from "node:path";
import { childFolders, present, presentNear, readOr } from "../paths";
import { plainSource, type Discovery, type Source } from "../source";

/** How a file Realm writes for a space begins. Realm rewrites it from the space's memory document. */
const REALM_MANAGED = "<!-- Managed by Realm.";

/** Codex's files under `~/.codex`, and the `AGENTS.md` it loads from a project's folder. */
export function codexSources(d: Discovery): Source[] {
  const codex = join(d.home, ".codex");
  const automations = join(codex, "automations");
  const out: Source[] = [
    plainSource({
      id: "codex-user", group: "codex", kind: "instructions", label: "User instructions", path: join(codex, "AGENTS.md"), root: codex,
      files: () => present(codex, ["AGENTS.md"]),
      by: "Codex loads it in every session.",
    }),
    plainSource({
      id: "codex-automations", group: "codex", kind: "memory", label: "Automation memory", path: automations, root: automations,
      files: () => childFolders(automations).flatMap((name) => present(join(automations, name), ["memory.md"]).map((file) => `${name}/${file}`)),
      folderOf: (rel) => rel.split("/")[0]!,
      by: "A Codex automation keeps it between its runs.",
    }),
  ];
  for (const project of d.projects) {
    const names = presentNear(project.root, ["AGENTS.md"]);
    if (names.length === 0) continue;
    out.push(plainSource({
      id: `codex-project-${project.id}`, group: "codex", kind: "project-instructions", label: project.name, path: project.root, root: project.root,
      projectId: project.id, files: () => names,
      folderOf: (rel) => (rel.includes("/") ? dirname(rel) : null),
      lockedNote: (rel) => (readOr(join(project.root, rel))?.startsWith(REALM_MANAGED) ? "Realm writes this file from the space's memory document. Edit that in Realm instead." : null),
      by: `Codex loads them in ${project.name}, and so does every other agent that reads AGENTS.md.`,
    }));
  }
  return out;
}
