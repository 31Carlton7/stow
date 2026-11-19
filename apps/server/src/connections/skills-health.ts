import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { McpServer, Skill, SkillHealth, SkillIssue, SkillPlace } from "@amc/contracts";
import { readOr, within } from "../library/paths";
import { parseSkillDocument } from "../setup/skill-document";

/*
 * Where each limit comes from (read November 2026):
 *  - Codex refuses to load a skill whose name is over 64 characters, or that has no frontmatter or no
 *    description (`codex-rs/skills/src/parser.rs`). A missing name is not a fault: Codex and Claude
 *    Code both fall back to the folder's name.
 *  - Claude Code cuts a description at 1,536 characters in the list it picks skills from
 *    (code.claude.com/docs/en/skills, "Skill descriptions are cut short").
 *  - The Agent Skills format allows a description 1,024 characters and asks for a `SKILL.md` under
 *    500 lines (agentskills.io/specification); Claude Code's page asks for the same 500.
 */
const CODEX_NAME_CHARS = 64;
const CLAUDE_DESCRIPTION_CHARS = 1536;
const FORMAT_DESCRIPTION_CHARS = 1024;
const SKILL_FILE_LINES = 500;
const MISSING_FILES_NAMED = 5;

/** Whose MCP servers a skill reached from this place can use, by the name `setup.mcp` gives the agent. */
const AGENT_OF_FOLDER: Record<string, string> = {
  Claude: "Claude Code", ".claude": "Claude Code", Codex: "Codex", ".codex": "Codex", Cursor: "Cursor", ".cursor": "Cursor",
  Gemini: "Gemini", opencode: "opencode", Realm: "Realm",
};

function agentOf(place: SkillPlace): string | null {
  if (place.label.endsWith(" plugin")) return "Claude Code";
  const split = place.label.lastIndexOf(" · ");
  return AGENT_OF_FOLDER[split === -1 ? place.label : place.label.slice(split + 3)] ?? null;
}

/** The folders whose skills one agent loads together. Codex loads its own folder and the shared one. */
function readers(place: SkillPlace): string[] {
  return place.label === "Shared" ? ["Shared", "Codex"] : [place.label];
}

/** Agents name a server's tools `mcp__<server>__<tool>`, with anything but letters, digits, `_` and `-` in the server's name written as `_`. */
const toolPrefix = (server: string): string => server.replace(/[^A-Za-z0-9_-]/g, "_").toLowerCase();

/**
 * The servers whose tools the text names. Left out: claude.ai's connectors and a plugin's own servers,
 * which are in no file this app reads, and Realm's, which Realm gives its own sessions.
 */
function serversNamed(text: string): string[] {
  const named = new Set<string>();
  for (const match of text.matchAll(/\bmcp__([A-Za-z0-9][A-Za-z0-9_-]*?)__[A-Za-z0-9_*-]/g)) {
    const server = match[1]!.toLowerCase();
    if (!server.startsWith("claude_ai_") && !server.startsWith("plugin_") && !server.startsWith("realm")) named.add(server);
  }
  return [...named].sort();
}

/**
 * The files of its own folder the body points at: the target of a Markdown link, and a path in
 * backticks under one of the folders the format names. Code fences are skipped, since what is in
 * one is usually an example.
 */
function filesNamed(body: string): string[] {
  const prose = body.replace(/^(```|~~~)[\s\S]*?^\1.*$/gm, "");
  const named = new Set<string>();
  for (const match of prose.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) named.add(match[1]!);
  for (const match of prose.matchAll(/`((?:scripts|references|reference|assets)\/[A-Za-z0-9_./-]+\.[A-Za-z0-9]+)`/g)) named.add(match[1]!);
  const out: string[] = [];
  for (const target of named) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || /^[#/~$<{]/.test(target) || /[*{}]/.test(target)) continue;
    let path = target.split("#")[0]!.split("?")[0]!;
    try { path = decodeURIComponent(path); } catch { continue; }
    if (path !== "") out.push(path);
  }
  return out.sort();
}

type Read = { skill: Skill; text: string | null; folder: string };

function issuesOf(read: Read, all: readonly Read[], servers: readonly McpServer[]): SkillIssue[] {
  const { skill, text, folder } = read;
  if (text === null) return [{ kind: "not-picked", detail: "Its SKILL.md cannot be read, so no agent can use it. Check the file is there and readable." }];
  const issues: SkillIssue[] = [];
  const document = parseSkillDocument(text);
  const description = document?.frontmatter.description ?? "";
  const reachedBy = new Set(skill.places.map(agentOf).filter((agent) => agent !== null));
  const codexLoads = skill.places.some((place) => readers(place).includes("Codex"));

  if (!document) {
    issues.push({ kind: "not-picked", detail: "Its SKILL.md does not start with a block between two `---` lines, so no agent knows when to use it. Add one with a name and a description." });
  } else if (description === "") {
    issues.push({ kind: "not-picked", detail: "Its SKILL.md has no description, so no agent will choose it on its own, and Codex will not load it at all. Add a `description:` line saying what it does and when to use it." });
  }

  const name = document?.frontmatter.name ?? "";
  if (codexLoads && name.length > CODEX_NAME_CHARS) {
    issues.push({ kind: "too-long", detail: `Its name is ${name.length} characters long. Codex does not load a skill whose name is over ${CODEX_NAME_CHARS}: shorten it.` });
  }
  if (reachedBy.has("Claude Code") && description.length > CLAUDE_DESCRIPTION_CHARS) {
    issues.push({ kind: "too-long", detail: `Its description is ${description.length} characters long. Claude Code cuts it at 1,536 when it lists skills, so say when to use it first, or shorten it.` });
  } else if (description.length > FORMAT_DESCRIPTION_CHARS) {
    issues.push({ kind: "too-long", detail: `Its description is ${description.length} characters long, over the 1,024 the Agent Skills format allows. Shorten it.` });
  }
  const lines = text.split("\n").length;
  if (lines > SKILL_FILE_LINES) {
    issues.push({ kind: "too-long", detail: `Its SKILL.md is ${lines} lines long, and an agent loads all of it each time the skill is used. The format asks for under ${SKILL_FILE_LINES}: move reference material into files beside it.` });
  }

  const missing = filesNamed(document?.body ?? text).filter((path) => within(join(folder, path), folder) && !existsSync(join(folder, path)));
  for (const path of missing.slice(0, MISSING_FILES_NAMED)) {
    issues.push({ kind: "missing-file", detail: `Its SKILL.md points at ${path}, which is not in the skill's folder. Add the file or take the mention out.` });
  }

  for (const server of serversNamed(text)) {
    const has = new Set(servers.filter((s) => toolPrefix(s.name) === server).flatMap((s) => s.definitions.map((d) => d.agent)));
    // A skill reached only from the shared folder could be anyone's: it is a fault only when no agent has the server.
    const without = reachedBy.size === 0 ? (has.size === 0 ? ["No agent on this Mac"] : []) : [...reachedBy].filter((agent) => !has.has(agent)).sort();
    if (without.length === 0) continue;
    issues.push({ kind: "missing-server", detail: `It uses tools of an MCP server named ${server}, and ${without.join(" and ")} ${without.length === 1 ? "has" : "have"} no server by that name. Add the server there, or the steps that need it will fail.` });
  }

  for (const other of all) {
    if (other === read || other.skill.name !== skill.name || other.text === text) continue;
    const shared = skill.places.find((place) => other.skill.places.some((theirs) => readers(theirs).some((reader) => readers(place).includes(reader))));
    if (!shared) continue;
    const who = readers(shared).includes("Codex") && other.skill.places.some((theirs) => readers(theirs).includes("Codex")) ? "Codex" : shared.label;
    issues.push({ kind: "name-clash", detail: `${who} also loads another skill named ${skill.name} with different text, at ${other.skill.places[0]!.displayPath}. Rename or remove one, so it is clear which is used.` });
  }
  return issues;
}

/**
 * What will stop each installed skill working, as far as its files show. A finding is something that
 * can be checked by opening the files named in it; anything less certain is left out.
 */
export function skillHealth(skills: readonly Skill[], servers: readonly McpServer[]): SkillHealth[] {
  const all = skills.map((skill) => ({ skill, text: readOr(skill.path), folder: dirname(skill.path) }));
  return all.map((read) => ({ id: read.skill.id, issues: issuesOf(read, all, servers) }));
}
