import { randomBytes } from "node:crypto";
import { chmodSync, copyFileSync, lstatSync, mkdirSync, realpathSync, renameSync, rmSync, unlinkSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { Skill, SkillHome, SkillOffer, SkillSource } from "@amc/contracts";
import { isDir, readOr, realOr, within } from "../library/paths";
import { RpcError } from "../rpc/error";
import { parseSkillDocument } from "../setup/skill-document";
import type { Skills } from "../setup/skills";
import { cloneShallow, MAX_BYTES, MAX_FILES, readSource, SKILL_FILE, skillFiles, skillFolders } from "./skills-source";

/**
 * Where an install into each home goes, from the home folder. Codex's documented folder is the shared
 * `~/.agents/skills`; it still loads `~/.codex/skills`, which its source calls deprecated.
 */
const HOME_FOLDER: Record<SkillHome, string> = { claude: ".claude/skills", codex: ".codex/skills", shared: ".agents/skills", realm: "Realm/skills" };

const FOLDER_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const KEPT_SOURCES = 20;
const PREVIEW_CHARS = 200_000;
const PREVIEW_FILES = 500;

/** Something that was looked at: `root` is the folder nothing read or copied may leave. */
type Fetched = { root: string; from: string; cloned: string | null; folderNames: Map<string, string> };
type Installed = { path: string; id: string | null; ok: boolean; detail: string | null };

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * Looking at a source of skills, installing from it, and removing an installed skill. Nothing here
 * runs a file it fetched, and nothing is copied from outside the folder that was fetched.
 */
export class SkillImports {
  private sources = new Map<string, Fetched>();

  /** `folder` is the app's own, for clones. Whatever an earlier run left in it is thrown away. */
  constructor(private d: { home: string; folder: string; skills: Skills; trash: (path: string) => Promise<void>; clone?: typeof cloneShallow }) {
    rmSync(d.folder, { recursive: true, force: true });
  }

  async inspect(from: string): Promise<SkillSource> {
    const request = readSource(from, this.d.home);
    const token = randomBytes(12).toString("hex");
    if (request.kind === "folder") {
      if (!isDir(request.folder)) throw new RpcError("SKILLS_SOURCE", `There is no folder at ${from.trim()}.`);
      const root = realpathSync(request.folder);
      return this.keep(token, { root, from, cloned: null, folderNames: new Map() }, root, null);
    }
    const cloned = join(this.d.folder, token);
    mkdirSync(this.d.folder, { recursive: true });
    try {
      const version = await (this.d.clone ?? cloneShallow)(request.url, request.ref, cloned);
      rmSync(join(cloned, ".git"), { recursive: true, force: true });
      const root = realpathSync(cloned);
      const start = realOr(join(root, request.sub));
      if (!isDir(start) || !within(start, root)) throw new RpcError("SKILLS_SOURCE", `That repository has no folder ${request.sub}.`);
      return this.keep(token, { root, from, cloned, folderNames: new Map() }, start, version);
    } catch (e) {
      rmSync(cloned, { recursive: true, force: true });
      throw e;
    }
  }

  private keep(token: string, fetched: Fetched, start: string, version: string | null): SkillSource {
    const installed = this.d.skills.list();
    const offers: SkillOffer[] = [];
    let files = 0, bytes = 0;
    for (const path of skillFolders(fetched.root, start)) {
      const dir = join(fetched.root, path);
      const text = readOr(join(dir, SKILL_FILE)) ?? "";
      const frontmatter = parseSkillDocument(text)?.frontmatter;
      const inside = skillFiles(dir, fetched.root).files;
      const size = inside.reduce((sum, file) => sum + file.bytes, 0);
      files += inside.length;
      bytes += size;
      if (files > MAX_FILES || bytes > MAX_BYTES) throw new RpcError("SKILLS_TOO_BIG", "The skills in that are too big to take in one go. Point at the folder of the one you want.");
      const folderName = path === "." ? frontmatter?.name || basename(fetched.root) : basename(dir);
      fetched.folderNames.set(path, folderName);
      const name = frontmatter?.name || folderName;
      offers.push({
        path, name, description: frontmatter?.description || null,
        files: inside.length, bytes: size,
        runnable: inside.filter((file) => file.runs).map((file) => file.rel),
        installed: installedAs(installed, name, folderName, text),
      });
    }
    this.sources.set(token, fetched);
    const oldest = this.sources.keys().next().value;
    if (this.sources.size > KEPT_SOURCES && oldest !== undefined) this.forget(oldest);
    return { token, from: fetched.from, version, offers };
  }

  private forget(token: string): void {
    const cloned = this.sources.get(token)?.cloned;
    if (cloned) rmSync(cloned, { recursive: true, force: true });
    this.sources.delete(token);
  }

  /** The folder of one offer, checked again: what was looked at may have changed since. */
  private offered(token: string, path: string): { fetched: Fetched; dir: string; folderName: string } {
    const fetched = this.sources.get(token);
    if (!fetched) throw new RpcError("SKILLS_SOURCE_GONE", "What was looked at is no longer kept. Look at it again.");
    const folderName = fetched.folderNames.get(path);
    if (folderName === undefined) throw new RpcError("SKILLS_UNSAFE", `${path} is not one of the skills that was found there.`);
    const dir = realOr(join(fetched.root, path));
    if (!within(dir, fetched.root) || !isDir(dir)) throw new RpcError("SKILLS_UNSAFE", `${path} leads outside what was fetched.`);
    return { fetched, dir, folderName };
  }

  preview(token: string, path: string): { text: string; files: string[] } {
    const { fetched, dir } = this.offered(token, path);
    return {
      text: (readOr(join(dir, SKILL_FILE)) ?? "").slice(0, PREVIEW_CHARS),
      files: skillFiles(dir, fetched.root).files.map((file) => file.rel).slice(0, PREVIEW_FILES),
    };
  }

  async install(token: string, paths: readonly string[], into: SkillHome, replace: boolean): Promise<Installed[]> {
    if (!this.sources.has(token)) throw new RpcError("SKILLS_SOURCE_GONE", "What was looked at is no longer kept. Look at it again.");
    const home = join(this.d.home, HOME_FOLDER[into]);
    const outcomes: Installed[] = [];
    for (const path of paths) {
      try {
        const to = await this.installOne(token, path, home, replace);
        const skillFile = join(realOr(to), SKILL_FILE);
        outcomes.push({ path, id: this.d.skills.list().find((skill) => skill.path === skillFile)?.id ?? null, ok: true, detail: null });
      } catch (e) {
        outcomes.push({ path, id: null, ok: false, detail: messageOf(e) });
      }
    }
    return outcomes;
  }

  /**
   * Copied beside where it will live and moved into place whole, so an agent never loads half a skill
   * and a copy that fails leaves the old folder where it was.
   */
  private async installOne(token: string, path: string, home: string, replace: boolean): Promise<string> {
    const { fetched, dir, folderName } = this.offered(token, path);
    if (!FOLDER_NAME.test(folderName)) throw new Error(`Its folder is named “${folderName}”, which cannot be used as a skill's folder name.`);
    const { files, leaves } = skillFiles(dir, fetched.root);
    if (leaves.length > 0) throw new Error(`${leaves.slice(0, 3).join(", ")} ${leaves.length === 1 ? "is a link that leads" : "are links that lead"} outside what was fetched, so nothing was installed.`);
    const to = join(home, folderName);
    const taken = lstatSync(to, { throwIfNoEntry: false });
    if (taken && !replace) throw new Error(`There is already a ${folderName} there. Nothing was changed.`);

    mkdirSync(home, { recursive: true });
    const staging = join(home, `.${folderName}.installing-${randomBytes(4).toString("hex")}`);
    try {
      for (const file of files) {
        const copy = join(staging, file.rel);
        mkdirSync(dirname(copy), { recursive: true });
        copyFileSync(file.real, copy);
        chmodSync(copy, (lstatSync(file.real).mode & 0o111) !== 0 ? 0o755 : 0o644);
      }
      if (taken?.isSymbolicLink()) unlinkSync(to);
      else if (taken) await this.d.trash(to);
      renameSync(staging, to);
    } catch (e) {
      rmSync(staging, { recursive: true, force: true });
      throw e;
    }
    return to;
  }

  /**
   * Take a skill out of one place it is reached from. `place` is that place's `displayPath`; it can
   * be left out only when there is one place. A link is removed and its folder left. A folder goes to
   * the Trash, and the links that led to it go with it, since they would lead nowhere.
   */
  async remove(id: string, place?: string): Promise<void> {
    const skill = this.d.skills.list().find((s) => s.id === id);
    if (!skill) throw new RpcError("SKILL_NOT_FOUND", `there is no skill ${id} on this Mac`);
    if (!place && skill.places.length > 1) throw new RpcError("SKILLS_WHICH_PLACE", `${skill.name} is reached from ${skill.places.length} places. Say which one to remove it from.`);
    const chosen = place ? skill.places.find((p) => p.displayPath === place) : skill.places[0];
    if (!chosen) throw new RpcError("SKILL_NOT_FOUND", `${skill.name} is not reached from ${place}`);
    if (chosen.label.endsWith(" plugin")) throw new RpcError("SKILLS_PLUGIN", `${skill.name} belongs to the ${chosen.label}. Turn the plugin off or remove it in Claude Code.`);

    const folder = this.absolute(chosen.displayPath);
    if (lstatSync(folder).isSymbolicLink()) { unlinkSync(folder); return; }
    if (chosen.linked) throw new RpcError("SKILLS_LINKED_FOLDER", `${dirname(chosen.displayPath)} is itself a link to another skills folder. Remove ${skill.name} from that folder.`);
    const links = skill.places.filter((p) => p !== chosen && isLinkTo(this.absolute(p.displayPath), dirname(skill.path)));
    await this.d.trash(folder);
    for (const link of links) unlinkSync(this.absolute(link.displayPath));
  }

  private absolute(displayPath: string): string {
    return displayPath === "~" || displayPath.startsWith("~/") ? join(this.d.home, displayPath.slice(1)) : displayPath;
  }
}

const isLinkTo = (path: string, real: string): boolean => {
  try { return lstatSync(path).isSymbolicLink() && realpathSync(path) === real; } catch { return false; }
};

/** Whether any home an agent reads already holds a skill of this name or folder name, and with the same text. */
function installedAs(installed: readonly Skill[], name: string, folderName: string, text: string): SkillOffer["installed"] {
  const sameName = installed.filter((skill) => skill.name === name || basename(dirname(skill.path)) === folderName);
  if (sameName.length === 0) return "no";
  return sameName.some((skill) => readOr(skill.path) === text) ? "same" : "different";
}
