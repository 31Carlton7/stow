import { createHash } from "node:crypto";
import { lstatSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { Skill, SkillDetail, SkillPlace } from "@amc/contracts";
import { isDir, readOr, realOr, tildify, walk } from "../library/paths";
import type { Project } from "../library/projects";
import { RpcError } from "../rpc/error";
import { readJson } from "./json";
import { parseSkillDocument } from "./skill-document";

/** A folder agents load skills from, and whose it is. */
type SkillRoot = { label: string; dir: string };

/** Every agent's own skills folder, by the path from the home folder. `~/.agents/skills` is the one
 *  several agents share, and most of the others are links into it. */
const USER_ROOTS: readonly [label: string, rel: string][] = [
  ["Realm", "Realm/skills"], ["Shared", ".agents/skills"], ["Claude", ".claude/skills"], ["Codex", ".codex/skills"],
  ["Cursor", ".cursor/skills"], ["Gemini", ".gemini/skills"], ["opencode", ".config/opencode/skills"],
  ["Windsurf", ".codeium/windsurf/skills"], ["Continue", ".continue/skills"], ["Copilot", ".copilot/skills"],
  ["Factory", ".factory/skills"], ["Goose", ".config/goose/skills"], ["Hermes", ".hermes/skills"], ["Kiro", ".kiro/skills"],
  ["Pi", ".pi/skills"], ["Qwen", ".qwen/skills"],
];
const PROJECT_ROOTS = [".claude/skills", ".agents/skills", ".codex/skills", ".cursor/skills"];
const SKILL_FILE = "SKILL.md";

/**
 * The installed Claude plugins that ship skills, from `installed_plugins.json`, not from globbing
 * `plugins/cache`: the cache is a history, with old versions and plugins that are no longer installed.
 * `settings.json`'s `enabledPlugins` then removes the ones switched off. An absent `enabledPlugins`
 * means nothing has been switched off, not that everything is.
 */
function pluginRoots(home: string): SkillRoot[] {
  const plugins = (readJson(join(home, ".claude", "plugins", "installed_plugins.json")) as { plugins?: Record<string, unknown> } | null)?.plugins;
  if (!plugins || typeof plugins !== "object") return [];
  const enabled = (readJson(join(home, ".claude", "settings.json")) as { enabledPlugins?: Record<string, unknown> } | null)?.enabledPlugins;
  const out: SkillRoot[] = [];
  for (const [fullName, installs] of Object.entries(plugins)) {
    if (enabled && typeof enabled === "object" && enabled[fullName] !== undefined && enabled[fullName] !== true) continue;
    const installPath = Array.isArray(installs) ? (installs[0] as { installPath?: unknown } | undefined)?.installPath : undefined;
    if (typeof installPath !== "string" || !isDir(join(installPath, "skills"))) continue;
    out.push({ label: `${fullName.split("@")[0] || fullName} plugin`, dir: join(installPath, "skills") });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

/** The folders in `dir` that could be a skill, links included: a skills folder is often all links. */
function folderNames(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => !e.name.startsWith(".") && (e.isDirectory() || (e.isSymbolicLink() && isDir(join(dir, e.name)))))
      .map((e) => e.name).sort();
  } catch { return []; }
}

const hasSkillFile = (dir: string): boolean => { try { return statSync(join(dir, SKILL_FILE)).isFile(); } catch { return false; } };

/** The skill folders under a root: each folder with a `SKILL.md`, and, where a folder has none, the
 *  ones directly inside it (an agent that sorts its skills into categories). */
function skillFolders(root: string): string[] {
  return folderNames(root).flatMap((name) => {
    const dir = join(root, name);
    return hasSkillFile(dir) ? [dir] : folderNames(dir).map((inner) => join(dir, inner)).filter(hasSkillFile);
  });
}

type Found = Skill & { real: string; hash: string | null };

/**
 * The skills agents on this Mac can load: one per real folder, however many skills folders link to
 * it, with every place it is reachable from. Read-only, and total: a root that is not there or a
 * `SKILL.md` that cannot be read makes fewer entries, never an error.
 */
export class Skills {
  constructor(private d: { home: string; projects: () => readonly Project[] }) {}

  private roots(): SkillRoot[] {
    return [
      ...USER_ROOTS.map(([label, rel]) => ({ label, dir: join(this.d.home, rel) })),
      ...pluginRoots(this.d.home),
      ...this.d.projects().flatMap((project) => PROJECT_ROOTS.map((rel) => ({ label: `${project.name} · ${rel.split("/")[0]}`, dir: join(project.root, rel) }))),
    ];
  }

  private found(): Found[] {
    const byReal = new Map<string, Found>();
    for (const root of this.roots()) {
      for (const dir of skillFolders(root.dir)) {
        const real = realOr(dir);
        const place: SkillPlace = { label: root.label, displayPath: tildify(dir, this.d.home), linked: lstatSync(dir).isSymbolicLink() || realOr(root.dir) !== root.dir };
        const known = byReal.get(real);
        if (known) { known.places.push(place); continue; }
        const file = join(real, SKILL_FILE);
        const text = readOr(file);
        const frontmatter = text === null ? null : parseSkillDocument(text)?.frontmatter ?? null;
        byReal.set(real, {
          id: createHash("sha1").update(real).digest("hex").slice(0, 12), real,
          name: frontmatter?.name || basename(real), description: frontmatter?.description || null,
          path: file, places: [place], copies: 1, variants: 0,
          valid: Boolean(frontmatter?.name && frontmatter.description),
          updatedAt: statSync(file, { throwIfNoEntry: false })?.mtimeMs ?? 0,
          hash: text === null ? null : createHash("sha1").update(text).digest("hex"),
        });
      }
    }
    const all = [...byReal.values()];
    for (const skill of all) {
      skill.copies = skill.hash === null ? 1 : all.filter((other) => other.hash === skill.hash).length;
      skill.variants = all.filter((other) => other !== skill && other.name === skill.name && other.hash !== skill.hash).length;
    }
    return all.sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
  }

  /** The sets of separate folders that hold a byte-identical `SKILL.md`: copies, where a link would do.
   *  Each folder is given with the first place it is reached from. */
  copySets(): { name: string; folders: SkillPlace[] }[] {
    const byHash = new Map<string, Found[]>();
    for (const skill of this.found()) if (skill.hash !== null) byHash.set(skill.hash, [...(byHash.get(skill.hash) ?? []), skill]);
    return [...byHash.values()].filter((copies) => copies.length > 1)
      .map((copies) => ({ name: copies[0]!.name, folders: copies.map((copy) => copy.places[0]!) }));
  }

  list(): Skill[] {
    return this.found().map(({ real: _real, hash: _hash, ...skill }) => skill);
  }

  read(id: string): SkillDetail {
    const found = this.found().find((s) => s.id === id);
    if (!found) throw new RpcError("SKILL_NOT_FOUND", `there is no skill ${id} on this Mac`);
    const { real, hash: _hash, ...skill } = found;
    const text = readOr(skill.path) ?? "";
    return { ...skill, body: parseSkillDocument(text)?.body ?? text, files: walk(real, (rel) => rel !== SKILL_FILE, 3).slice(0, 200) };
  }
}
