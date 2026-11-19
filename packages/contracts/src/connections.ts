import { z } from "zod";
import { RunnerIdSchema } from "./models";

/*
 * Connections: adding, removing and checking what agents are set up with. `setup.*` reads; these
 * change. Each agent's own tool is used to change that agent's setup wherever it has one (`claude mcp`,
 * `codex mcp`), so the app never rewrites a file a running session also writes.
 *
 * A secret typed into the window (a token for a server's environment, a header) goes from the call
 * straight to the agent's own config. The app keeps it nowhere, logs it nowhere and never sends it
 * back: what these methods return about a server is names, never values.
 */

/** The agents an MCP server can be added to from here. */
export const McpAgentSchema = z.enum(["claude", "codex", "cursor", "gemini"]);
export type McpAgent = z.infer<typeof McpAgentSchema>;

export const MCP_AGENT_LABEL: Record<McpAgent, string> = { claude: "Claude Code", codex: "Codex", cursor: "Cursor", gemini: "Gemini" };

const Name = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);
const Pairs = z.record(z.string().min(1).max(200), z.string().max(4000));

/** A server as a person describes one to add: started by a command, or reached at a URL. */
export const McpDraftSchema = z.object({
  name: Name,
  transport: z.enum(["stdio", "http", "sse"]),
  /** For `stdio`: the program and its arguments, each its own string. */
  command: z.string().max(400).optional(),
  args: z.array(z.string().max(2000)).max(60).default([]),
  /** For `http` and `sse`. */
  url: z.string().url().max(2000).optional(),
  /** Values are secrets: see the note at the top. */
  env: Pairs.default({}),
  headers: Pairs.default({}),
});
export type McpDraft = z.infer<typeof McpDraftSchema>;

/** Where a server is added: for every session of each agent, or for one project. */
export const McpPlacementSchema = z.object({ agents: z.array(McpAgentSchema).min(1), projectId: z.string().nullable().default(null) });
export type McpPlacement = z.infer<typeof McpPlacementSchema>;

/** One thing adding or removing would do, said before it is done. A command is shown with every secret masked. */
export const McpStepSchema = z.object({
  agent: McpAgentSchema,
  how: z.enum(["command", "file"]),
  /** The command line that would be run, or the file that would be changed, from the home folder. */
  shows: z.string(),
  /** Why this agent cannot take the server as described, or null when it can. */
  refused: z.string().nullable(),
});
export type McpStep = z.infer<typeof McpStepSchema>;

export const McpOutcomeSchema = z.object({ agent: McpAgentSchema, ok: z.boolean(), detail: z.string().nullable() });
export type McpOutcome = z.infer<typeof McpOutcomeSchema>;

/**
 * Whether an agent can reach a server right now, as that agent's own tool reports it where it has
 * one. `needs-sign-in` is a server that answered and wants the person to sign in to it.
 */
export const McpHealthSchema = z.object({
  name: z.string(),
  agent: z.string(),
  projectId: z.string().nullable(),
  state: z.enum(["connected", "failed", "needs-sign-in", "off", "unknown"]),
  /** One line of why, with nothing secret in it. */
  detail: z.string().nullable(),
  /** How many tools it offered, where the check learns that. */
  tools: z.number().int().nullable(),
  checkedAt: z.number(),
});
export type McpHealth = z.infer<typeof McpHealthSchema>;

/** A server a model drafted from a request in words. Secrets are never drafted: `needs` names what the person must fill in. */
export const McpSuggestionSchema = z.object({
  draft: McpDraftSchema,
  /** The names of the environment variables or headers that need a value from the person. */
  needs: z.array(z.string()),
  /** Where the model says the server comes from (a package, a vendor's page), for the person to check. */
  source: z.string().nullable(),
  model: z.string(),
});
export type McpSuggestion = z.infer<typeof McpSuggestionSchema>;

/** Where a skill folder can be installed. `shared` is `~/.agents/skills`, which several agents read. */
export const SkillHomeSchema = z.enum(["claude", "codex", "shared", "realm"]);
export type SkillHome = z.infer<typeof SkillHomeSchema>;

export const SKILL_HOME_LABEL: Record<SkillHome, string> = { claude: "Claude Code", codex: "Codex", shared: "Shared by agents", realm: "Realm" };

/** One skill found in something that was looked at but not yet installed. */
export const SkillOfferSchema = z.object({
  /** The skill's folder inside what was fetched. */
  path: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  files: z.number().int(),
  bytes: z.number().int(),
  /** The names of files in it that an agent could run: scripts and binaries. Installing never runs them. */
  runnable: z.array(z.string()),
  /** A skill of this name is already installed in any folder an agent reads (not only the one it
   *  would be installed into), and whether its text is the same. */
  installed: z.enum(["no", "same", "different"]),
});
export type SkillOffer = z.infer<typeof SkillOfferSchema>;

/** What looking at a source found. `token` names the fetched copy for `skills.install`; it is thrown away when the app quits. */
export const SkillSourceSchema = z.object({
  token: z.string(),
  /** What was fetched, as the person gave it. */
  from: z.string(),
  /** The commit or version fetched, where there is one. */
  version: z.string().nullable(),
  offers: z.array(SkillOfferSchema),
});
export type SkillSource = z.infer<typeof SkillSourceSchema>;

/** A place skills are published that the window can offer by name. */
export const SkillLibrarySchema = z.object({ name: z.string(), url: z.string(), about: z.string() });
export type SkillLibrary = z.infer<typeof SkillLibrarySchema>;

/** Something about an installed skill that will stop it working, or that an agent will trip on. */
export const SkillIssueSchema = z.object({
  kind: z.enum(["not-picked", "missing-server", "missing-file", "too-long", "name-clash"]),
  /** A sentence a person can act on. */
  detail: z.string(),
});
export type SkillIssue = z.infer<typeof SkillIssueSchema>;

export const SkillHealthSchema = z.object({ id: z.string(), issues: z.array(SkillIssueSchema) });
export type SkillHealth = z.infer<typeof SkillHealthSchema>;

export const ConnectionMethods = {
  /** What adding the server would do, step by step. Changes nothing. */
  "mcp.preview": { params: z.object({ draft: McpDraftSchema, placement: McpPlacementSchema }), result: z.object({ steps: z.array(McpStepSchema) }) },
  "mcp.add": { params: z.object({ draft: McpDraftSchema, placement: McpPlacementSchema }), result: z.object({ outcomes: z.array(McpOutcomeSchema) }) },
  "mcp.remove": { params: z.object({ name: Name, agent: McpAgentSchema, projectId: z.string().nullable().default(null) }), result: McpOutcomeSchema },
  /**
   * What is known of each server's health. With `check`, the named server (or every server) is checked
   * again in the background: the answer comes at once with what was known, and `checking` names the
   * servers still being asked. Ask again until it is empty.
   */
  "mcp.health": {
    params: z.object({ check: z.boolean().default(false), name: z.string().max(100).optional() }),
    result: z.object({ health: z.array(McpHealthSchema), checking: z.array(z.string()) }),
  },
  /** Start the agent's own sign-in for a server that wants one. It opens in the person's browser. */
  "mcp.signIn": { params: z.object({ name: Name, agent: McpAgentSchema }), result: z.object({ started: z.boolean(), detail: z.string().nullable() }) },
  /** Have a model draft a server from a request in words. One model call; nothing is added. */
  "mcp.suggest": { params: z.object({ ask: z.string().min(3).max(600), runner: RunnerIdSchema }), result: McpSuggestionSchema },
  /** A small picture for a server: its vendor's own icon, as a data URL, or null when there is none to be had. */
  "mcp.icon": { params: z.object({ name: z.string().min(1).max(100) }), result: z.object({ icon: z.string().nullable() }) },

  "skills.libraries": { params: z.object({}), result: z.object({ libraries: z.array(SkillLibrarySchema) }) },
  /** Fetch a repository, a folder of one, or a local folder, and list the skills in it. Installs nothing and runs nothing. */
  "skills.inspect": { params: z.object({ from: z.string().min(1).max(2000) }), result: SkillSourceSchema },
  /** Read one offered skill's `SKILL.md` before installing it. */
  "skills.preview": { params: z.object({ token: z.string(), path: z.string() }), result: z.object({ text: z.string(), files: z.array(z.string()) }) },
  /** Copy the chosen skills into an agent's skills folder. A folder already there is refused unless `replace`. */
  "skills.install": {
    params: z.object({ token: z.string(), paths: z.array(z.string()).min(1).max(100), into: SkillHomeSchema, replace: z.boolean().default(false) }),
    result: z.object({ installed: z.array(z.object({ path: z.string(), id: z.string().nullable(), ok: z.boolean(), detail: z.string().nullable() })) }),
  },
  /**
   * Move an installed skill's folder to the Trash. A link is removed and the folder it leads to is left.
   * `place` is the `displayPath` of the place to remove it from, and is needed when the skill is reached
   * from more than one. Links that led to a folder sent to the Trash are removed with it. A plugin's
   * skill is refused.
   */
  "skills.remove": { params: z.object({ id: z.string().min(1).max(200), place: z.string().max(1000).optional() }), result: z.object({}) },
  "skills.health": { params: z.object({}), result: z.object({ skills: z.array(SkillHealthSchema) }) },
} as const;
