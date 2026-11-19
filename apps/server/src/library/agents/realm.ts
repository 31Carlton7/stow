import { existsSync } from "node:fs";
import { basename, join, posix } from "node:path";
import { claudeProjectFolder, claudeSlugLabel } from "../claude-projects";
import { MEMORY_INDEX_FILE } from "../memory-index";
import { childFolders, walk } from "../paths";
import { MD, once, plainSource, type Discovery, type Source } from "../source";

const SPACES_DIR = "spaces";

/**
 * Realm's memory, under `~/Realm/memory`: a git repository per profile and per team (`repos/`), the
 * memory documents it puts at the start of each session, and the copies it took of Claude's own
 * project memory (`imported/`).
 */
export function realmSources(d: Discovery): Source[] {
  const memory = join(d.home, "Realm", "memory");
  const out: Source[] = [];

  for (const dir of childFolders(join(memory, "repos"))) {
    const repo = join(memory, "repos", dir);
    if (!existsSync(join(repo, ".git")) || !existsSync(join(repo, MEMORY_INDEX_FILE))) continue;
    const [scope, ownerId = ""] = dir.split(/-(.*)/, 2) as [string, string | undefined];
    const profileId = scope === "profile" ? ownerId : null;
    const spaceOf = (folder: string) => (profileId ? d.names.spaces.get(d.names.spaceOfFolder.get(`${profileId}/${folder}`) ?? "") : undefined);
    const spaceFolders = once(() => childFolders(join(repo, SPACES_DIR)));
    const team = scope === "space" ? d.names.spaces.get(ownerId) : undefined;
    out.push({
      id: `realm-repo-${dir}`, group: "realm", kind: "memory",
      label: profileId ? `${d.names.profiles.get(profileId) ?? ownerId.slice(0, 8)}'s memory` : `${team?.name ?? ownerId.slice(0, 8)} team memory`,
      path: repo, root: repo, repo,
      files: once(() => walk(repo, (rel) => MD.test(rel))),
      projectId: team ? d.projectAt(team.folderPath)?.id ?? null : null,
      projectOf: (rel) => {
        const parts = rel.split("/");
        const space = parts[0] === SPACES_DIR && parts.length >= 3 ? spaceOf(parts[1]!) : undefined;
        return space ? d.projectAt(space.folderPath)?.id ?? null : null;
      },
      folderOf: (rel) => {
        const dirname = posix.dirname(rel);
        if (dirname === ".") return null;
        const parts = dirname.split("/");
        if (parts[0] !== SPACES_DIR || parts.length < 2) return dirname;
        return [spaceOf(parts[1]!)?.name ?? parts[1]!, ...parts.slice(2)].join("/");
      },
      folders: () => [
        { rel: "", label: "Shared by every space" },
        ...spaceFolders().map((folder) => ({ rel: `${SPACES_DIR}/${folder}`, label: spaceOf(folder)?.name ?? folder })),
      ],
      by: "Realm starts each session with its MEMORY.md, and agents reach the rest through Realm's memory tools.",
    });
  }

  out.push(plainSource({
    id: "realm-documents", group: "realm", kind: "documents", label: "Memory documents", path: memory, root: memory,
    files: () => walk(memory, (rel) => MD.test(rel), 0),
    titleOf: (rel) => {
      const id = rel.replace(/\.md$/, "");
      return id.startsWith("profile-") ? d.names.profiles.get(id.slice("profile-".length)) ?? null : d.names.spaces.get(id)?.name ?? null;
    },
    lockedNote: () => "Realm keeps this document and rewrites what depends on it. Edit it in Realm, in the space's memory settings.",
    by: "Realm puts them at the start of every new session.",
  }));

  const imported = join(memory, "imported");
  out.push(plainSource({
    id: "realm-imported", group: "realm", kind: "imported", label: "Imported copies", path: imported, root: imported,
    files: () => walk(imported, (rel) => MD.test(rel) && rel.split("/").length === 3, 2),
    folderOf: (rel) => {
      // Realm names the folder by Claude's slug for the project, without the dash a slug starts with.
      const [spaceId, folder] = rel.split("/") as [string, string];
      const slug = `-${folder}`;
      const onDisk = claudeProjectFolder(slug);
      return `${d.names.spaces.get(spaceId)?.name ?? spaceId.slice(0, 8)} · ${onDisk ? basename(onDisk) : claudeSlugLabel(slug)}`;
    },
    projectOf: (rel) => {
      const space = d.names.spaces.get(rel.split("/")[0]!);
      return space ? d.projectAt(space.folderPath)?.id ?? null : null;
    },
    by: "Copies Realm took of Claude's project memory when it brought it into a memory repo. No agent reads them.",
  }));
  return out;
}
