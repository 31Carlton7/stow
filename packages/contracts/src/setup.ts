import { z } from "zod";

/*
 * What agents are set up with besides their memory: the skills they can load, the MCP servers they
 * can call and the hooks that run around their work. Read-only here. A config file's secret values
 * are never part of any of these: only names, commands and the names of keys.
 */

/** One place a skill's folder is reachable from: an agent's skills folder, a plugin, a project. */
export const SkillPlaceSchema = z.object({
  /** Whose folder: "Claude", "Codex", "figma plugin", "atlas · .claude". */
  label: z.string(),
  /** The skill's folder there, from the home folder (`~/…`) when it is under it. */
  displayPath: z.string(),
  /** A link to the folder the skill really lives in. */
  linked: z.boolean(),
});
export type SkillPlace = z.infer<typeof SkillPlaceSchema>;

/** One skill folder, however many agents reach it. `id` names its real folder. */
export const SkillSchema = z.object({
  id: z.string(),
  /** Frontmatter `name`, else the folder's name. */
  name: z.string(),
  description: z.string().nullable(),
  /** Absolute path of its `SKILL.md`, for Show in Finder. */
  path: z.string(),
  places: z.array(SkillPlaceSchema),
  /** How many separate folders on this Mac hold a byte-identical `SKILL.md`, this one included. */
  copies: z.number().int(),
  /** How many other skills carry this name with different text. */
  variants: z.number().int(),
  /** False when its `SKILL.md` is missing the name or description an agent picks it by. */
  valid: z.boolean(),
  updatedAt: z.number(),
});
export type Skill = z.infer<typeof SkillSchema>;

export const SkillDetailSchema = SkillSchema.extend({
  /** `SKILL.md` after its frontmatter. */
  body: z.string(),
  /** The other files in the skill's folder, by path from it. */
  files: z.array(z.string()),
});
export type SkillDetail = z.infer<typeof SkillDetailSchema>;

/** One place an MCP server is defined. */
export const McpDefinitionSchema = z.object({
  /** Whose config: "Claude Code", "Codex", "Cursor", "Claude Desktop", "Realm", "Gemini", "opencode". */
  agent: z.string(),
  /** The project it is defined for, or null for one every session of that agent gets. */
  projectId: z.string().nullable(),
  projectName: z.string().nullable(),
  /** The config file, from the home folder when it is under it. */
  file: z.string(),
  transport: z.enum(["stdio", "http", "sse", "unknown"]),
  /** The command line, or the URL, with anything shaped like a secret masked. */
  target: z.string(),
  /** The names of the environment variables and headers it is given. Never their values. */
  envKeys: z.array(z.string()),
  headerKeys: z.array(z.string()),
  disabled: z.boolean(),
  /** Equal for two definitions that start the same server the same way. */
  fingerprint: z.string(),
});
export type McpDefinition = z.infer<typeof McpDefinitionSchema>;

/** One server name, with every place it is defined. */
export const McpServerSchema = z.object({
  name: z.string(),
  definitions: z.array(McpDefinitionSchema),
  /** Defined in more than one place, and not the same way in all of them. */
  conflict: z.boolean(),
});
export type McpServer = z.infer<typeof McpServerSchema>;

/** One command an agent runs around its own work. */
export const HookSchema = z.object({
  agent: z.string(),
  projectId: z.string().nullable(),
  projectName: z.string().nullable(),
  file: z.string(),
  /** When it runs: `PostToolUse`, `Stop`, `beforeSubmitPrompt`. */
  event: z.string(),
  /** What it is limited to (a tool name or pattern), where the agent supports that. */
  matcher: z.string().nullable(),
  /** The command, with anything shaped like a secret masked. */
  command: z.string(),
});
export type Hook = z.infer<typeof HookSchema>;

export const SetupMethods = {
  "setup.skills": { params: z.object({}), result: z.object({ skills: z.array(SkillSchema) }) },
  "setup.skill": { params: z.object({ id: z.string().min(1).max(200) }), result: SkillDetailSchema },
  "setup.mcp": { params: z.object({}), result: z.object({ servers: z.array(McpServerSchema) }) },
  "setup.hooks": { params: z.object({}), result: z.object({ hooks: z.array(HookSchema) }) },
} as const;
