/**
 * A small fake home folder with each agent's layout, for tests and live checks: nothing here ever
 * reads or writes the person's own home.
 *
 * What is seeded on purpose:
 *   - one memory in three places with the same text: Realm's repo, Claude's project memory, and
 *     Realm's imported copy of it;
 *   - a copy whose text has since changed (`release-day`), in the repo and in Claude's folder;
 *   - an index line that links a file that is not there (`[[missing-note]]`);
 *   - a 0-byte `~/.codex/AGENTS.md` and `~/.gemini/GEMINI.md`;
 *   - a worktree of a project, whose own `CLAUDE.md` must not be listed as a second project's;
 *   - an `AGENTS.md` Realm manages, which must stay read-only;
 *   - one skill reached three ways (its own folder, a link to it, a copied folder) and a different
 *     skill of the same name; one with no frontmatter;
 *   - an MCP server defined the same way twice (`notes`) and one defined two ways (`search`);
 *   - secret values in every config (each starts `fixture-secret`), which nothing may ever show;
 *   - six transcripts, every word invented: a Claude session typed at a terminal, with a tool that
 *     worked, one that failed, a sub-agent and its instructions recorded (one of them since edited);
 *     a one-shot SDK call; a Codex session at its terminal; and a Claude session Realm drove, with
 *     a Codex session that one dispatched.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const PROFILE_ID = "01PROFILE00000000000000000";
export const SPACE_ID = "01SPACE0000000000000000000";

/** The fixture's sessions, by the id each agent gave its own. */
export const SESSIONS = {
  typed: "11111111-1111-4111-8111-111111111111",
  subAgent: "11111111-1111-4111-8111-111111111111:agent-a7c2",
  oneShot: "22222222-2222-4222-8222-222222222222",
  codex: "33333333-3333-4333-8333-333333333333",
  realm: "44444444-4444-4444-8444-444444444444",
  dispatched: "55555555-5555-4555-8555-555555555555",
};

const fact = (name, description, type, session, body) =>
  `---\nname: ${name}\ndescription: ${description}\nmetadata:\n  type: ${type}\n  originSessionId: ${session}\n---\n\n${body}\n`;

export const DEPLOY_STEPS = fact("deploy-steps", "How Atlas ships: sign, notarize, then publish", "project", "session-a",
  "Atlas ships from `main`. Sign the build, notarize it, then publish the release.\n\nSee [[team]] for who approves.");

/** Claude's own slug for a folder: every character that is not a letter or a digit becomes `-`. */
export const claudeSlug = (folder) => folder.replace(/[^a-zA-Z0-9]/g, "-");

/** Build the home under `root` (an empty folder) and return what a check needs to find in it. */
export function buildFixtureHome(root) {
  const home = fs.realpathSync(root);
  const write = (rel, text) => {
    const abs = path.join(home, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text);
    return abs;
  };
  const atlas = path.join(home, "work/atlas");
  const beacon = path.join(home, "work/beacon");
  const worktree = path.join(home, "worktrees/atlas-fix");

  // Projects: a repository, a worktree of it, and a second repository.
  fs.mkdirSync(path.join(atlas, ".git/worktrees/atlas-fix"), { recursive: true });
  write("work/atlas/CLAUDE.md", "# Atlas\n\nUse pnpm. Run the tests before you say a change works.\n");
  write("work/atlas/AGENTS.md", "# Atlas\n\nUse pnpm.\n");
  write("work/atlas/.cursor/rules/api.mdc", "---\ndescription: API conventions\nglobs: src/api/**\n---\n\nEvery handler validates its params.\n");
  write("worktrees/atlas-fix/.git", `gitdir: ${path.join(atlas, ".git/worktrees/atlas-fix")}\n`);
  write("worktrees/atlas-fix/CLAUDE.md", "# Atlas\n\nA worktree's copy.\n");
  fs.mkdirSync(path.join(beacon, ".git"), { recursive: true });
  write("work/beacon/AGENTS.md", "<!-- Managed by Realm. Edit this space's memory in Realm instead. -->\n\nBeacon's rules.\n");

  // Realm: its database, a profile's memory repo, a memory document and an imported copy.
  fs.mkdirSync(path.join(home, "Realm"), { recursive: true });
  const db = new DatabaseSync(path.join(home, "Realm/realm.db"));
  db.exec(`
    CREATE TABLE profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE spaces (id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, name TEXT NOT NULL, folder_path TEXT NOT NULL);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
    CREATE TABLE mcp_servers (name TEXT PRIMARY KEY, transport TEXT, command TEXT, args_json TEXT, url TEXT, secrets_json TEXT);
    CREATE TABLE team_roles (id TEXT PRIMARY KEY, space_id TEXT NOT NULL, name TEXT NOT NULL);
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY, provider_session_id TEXT, title TEXT, space_id TEXT, teammate_id TEXT,
      dispatched_by_kind TEXT, dispatched_by_session_id TEXT
    );
  `);
  db.prepare("INSERT INTO team_roles VALUES (?, ?, ?)").run("role-release", SPACE_ID, "Release captain");
  const realmSession = db.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?)");
  realmSession.run("realm-1", SESSIONS.realm, "Plan the 2.4 release", SPACE_ID, "role-release", null, null);
  realmSession.run("realm-2", SESSIONS.dispatched, "Check the changelog", SPACE_ID, null, "agent_run", "realm-1");
  realmSession.run("realm-3", SESSIONS.typed, "Imported from the terminal", SPACE_ID, null, "import", null);
  db.prepare("INSERT INTO mcp_servers VALUES (?, ?, ?, ?, ?, ?)").run("realm-tools", "http", null, "[]", "http://127.0.0.1:8123/mcp", JSON.stringify({ TOKEN: "fixture-secret-realm" }));
  db.prepare("INSERT INTO profiles VALUES (?, ?)").run(PROFILE_ID, "Sam");
  db.prepare("INSERT INTO spaces VALUES (?, ?, ?, ?)").run(SPACE_ID, PROFILE_ID, "Atlas", atlas);
  db.prepare("INSERT INTO settings VALUES (?, ?)").run(`memory.spaceFolder:${SPACE_ID}`, JSON.stringify({ folder: "atlas", profileId: PROFILE_ID }));
  db.close();

  const repo = `Realm/memory/repos/profile-${PROFILE_ID}`;
  write(`${repo}/MEMORY.md`, "# Memory\n\n- Sam ships on Mondays\n\n## Index\n- [[spaces/atlas/MEMORY]]\n- [[team]]\n- [[missing-note]]\n");
  write(`${repo}/team.md`, "# Team\n\nRiley approves releases.\n");
  write(`${repo}/spaces/atlas/MEMORY.md`, "- [deploy-steps](deploy-steps.md) — How Atlas ships: sign, notarize, then publish\n- [release-day](release-day.md) — Releases go out on Mondays\n");
  write(`${repo}/spaces/atlas/deploy-steps.md`, DEPLOY_STEPS);
  write(`${repo}/spaces/atlas/release-day.md`, fact("release-day", "Releases go out on Mondays", "project", "session-b", "Releases go out on Mondays, after the weekly review."));
  const git = (...args) => execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@localhost", "-c", "commit.gpgsign=false", ...args], { cwd: path.join(home, repo), stdio: "ignore" });
  git("init", "-q", "-b", "main");
  git("add", "--all");
  git("commit", "-q", "-m", "Create memory repo");

  write(`Realm/memory/${SPACE_ID}.md`, "Atlas is the release tool. Keep answers short.\n");
  // Realm names an imported folder by Claude's slug without its leading dash.
  write(`Realm/memory/imported/${SPACE_ID}/${claudeSlug(atlas).slice(1)}/deploy-steps.md`, DEPLOY_STEPS);

  // Claude Code.
  write(".claude/CLAUDE.md", "Prefer small commits.\n");
  const notesServer = { command: "npx", args: ["-y", "@example/notes-mcp"], env: { NOTES_TOKEN: "fixture-secret-env" } };
  write(".claude.json", JSON.stringify({
    mcpServers: { notes: notesServer, search: { command: "npx", args: ["-y", "@example/search-mcp", "--api-key", "fixture-secret-arg"] } },
    projects: {
      [atlas]: { mcpServers: { atlasdb: { type: "http", url: "https://db.example.com/mcp?token=fixture-secret-url", headers: { Authorization: "Bearer fixture-secret-header" } } } },
      [worktree]: {},
    },
  }));
  write(".claude/settings.json", JSON.stringify({
    env: { DEPLOY_KEY: "fixture-secret-settings" },
    hooks: {
      PostToolUse: [{ matcher: "Edit|Write", hooks: [{ type: "command", command: "pnpm lint --fix" }] }],
      Stop: [{ hooks: [{ type: "command", command: "notify --token fixture-secret-hook done" }] }],
    },
  }));
  const claudeMemory = `.claude/projects/${claudeSlug(atlas)}/memory`;
  write(`${claudeMemory}/MEMORY.md`, "- [deploy-steps](deploy-steps.md) — How Atlas ships: sign, notarize, then publish\n- [release-day](release-day.md) — Releases go out on Mondays\n- [old-flag](old-flag.md) — The beta flag\n");
  write(`${claudeMemory}/deploy-steps.md`, DEPLOY_STEPS);
  write(`${claudeMemory}/release-day.md`, fact("release-day", "Releases go out on Mondays", "project", "session-b", "Releases go out on Mondays."));
  write(`${claudeMemory}/old-flag.md`, "---\nname: old-flag\ndescription: The beta flag\ntype: feedback\noriginSessionId: session-c\n---\n\nThe beta flag is `ATLAS_BETA`.\n");

  // Codex, Cursor, Gemini and the rest.
  write(".codex/AGENTS.md", "");
  write(".codex/config.toml", [
    'model = "example"', "",
    `[projects."${beacon}"]`, 'trust_level = "trusted"', "",
    "[mcp_servers.search]", 'command = "npx"', 'args = ["-y", "@example/search-mcp@2"]', "",
    "[mcp_servers.search.env]", 'SEARCH_KEY = "fixture-secret-codex"', "",
  ].join("\n"));
  write(".codex/hooks.json", JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "say done" }] }] } }));
  write(".codex/automations/daily-brief/memory.md", "Yesterday's brief covered the release.\n");
  write(".cursor/mcp.json", JSON.stringify({ mcpServers: { notes: notesServer } }));
  write(".cursor/hooks.json", JSON.stringify({ version: 1, hooks: { beforeSubmitPrompt: [{ command: "./check.sh" }] } }));
  write(".cursor/rules/style.mdc", "---\ndescription: House style\nalwaysApply: true\n---\n\nSentence case in headings.\n");
  write(".gemini/GEMINI.md", "");
  write(".config/opencode/AGENTS.md", "Keep diffs small.\n");
  write(".hermes/SOUL.md", "# Soul\n\nYou are a careful assistant.\n");
  write(".openclaw/workspace/USER.md", "# User\n\nSam, who ships on Mondays.\n");

  // Skills.
  const skill = (name, description, body) => `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`;
  const releaseNotes = skill("release-notes", "Write the notes for a release from its merged pull requests", "Group changes by what a person will notice.");
  write(".agents/skills/release-notes/SKILL.md", releaseNotes);
  write(".agents/skills/release-notes/reference/tone.md", "Plain words.\n");
  fs.mkdirSync(path.join(home, ".claude/skills"), { recursive: true });
  fs.symlinkSync(path.join(home, ".agents/skills/release-notes"), path.join(home, ".claude/skills/release-notes"));
  write("Realm/skills/release-notes/SKILL.md", releaseNotes);
  write(".codex/skills/release-notes/SKILL.md", skill("release-notes", "Draft release notes", "List every commit."));
  write(".claude/skills/scratch/SKILL.md", "Notes with no frontmatter.\n");
  write(".hermes/skills/writing/tone/SKILL.md", skill("tone", "Match the house tone", "Short sentences."));
  write("work/atlas/.claude/skills/ship/SKILL.md", skill("ship", "Ship Atlas", "Run the release script."));

  writeTranscripts(home, write, { atlas, beacon });

  return { home, atlas, beacon, worktree, repo: path.join(home, repo), claudeMemory: path.join(home, claudeMemory) };
}

/** Write the transcripts, each line a record in its agent's own shape, with file times a minute apart so their order is fixed. */
function writeTranscripts(home, write, { atlas, beacon }) {
  const minute = (n) => new Date(Date.UTC(2026, 2, 2, 9, n)).toISOString();
  const transcript = (rel, endedMinute, records) => {
    const abs = write(rel, records.map((record) => `${JSON.stringify(record)}\n`).join(""));
    const ended = new Date(Date.UTC(2026, 2, 2, 9, endedMinute));
    fs.utimesSync(abs, ended, ended);
  };

  const claude = (sessionId, entrypoint, cwd, sidechain = false) => {
    let n = 0;
    const base = () => ({ parentUuid: null, isSidechain: sidechain, uuid: `${sessionId.slice(0, 8)}-${n}` });
    const tail = () => ({ timestamp: minute(n++), cwd, sessionId, entrypoint, version: "9.9.9" });
    return {
      user: (content, more = {}) => ({ ...base(), type: "user", message: { role: "user", content }, ...more, ...tail() }),
      assistant: (id, content, usage) => ({ ...base(), type: "assistant", message: { id, type: "message", role: "assistant", model: "claude-fixture-1", content, usage }, ...tail() }),
      attachment: (attachment) => ({ ...base(), type: "attachment", attachment, ...tail() }),
      record: (type, fields) => ({ type, ...fields, sessionId }),
    };
  };
  const slug = `.claude/projects/${claudeSlug(atlas)}`;

  const typed = claude(SESSIONS.typed, "cli", atlas);
  transcript(`${slug}/${SESSIONS.typed}.jsonl`, 10, [
    typed.record("session-owner", { pid: 4242 }),
    typed.attachment({ type: "hook_additional_context", hookName: "SessionStart:startup", hookEvent: "SessionStart", toolUseID: "hook-1", content: ["Today is release day."] }),
    typed.user("Tag the 2.4 release and tell me what is in it"),
    typed.attachment({ type: "instructions", files: [
      { path: path.join(home, ".claude/CLAUDE.md"), type: "User", content: "Prefer small commits." },
      { path: path.join(atlas, "CLAUDE.md"), type: "User", content: "# Atlas\n\nUse npm.\n" },
      { path: path.join(home, slug, "memory/MEMORY.md"), type: "AutoMem", content: "- [deploy-steps](deploy-steps.md) — How Atlas ships: sign, notarize, then publish\n- [release-day](release-day.md) — Releases go out on Mondays\n- [old-flag](old-flag.md) — The beta flag\n" },
    ] }),
    typed.attachment({ type: "skill_listing", content: "- release-notes: Write the notes for a release from its merged pull requests\n- ship: Ship Atlas", names: ["release-notes", "ship"], skillCount: 2, isInitial: true }),
    typed.attachment({ type: "mcp_instructions_delta", addedNames: ["notes"], addedBlocks: ["Search the notes before you answer from memory."], removedNames: [] }),
    typed.record("api-request", { body: "what was sent to the model, which is no part of the conversation" }),
    typed.assistant("msg-1", [{ type: "thinking", thinking: "The tag has to exist before the notes can name it." }], { input_tokens: 1200, output_tokens: 20 }),
    typed.assistant("msg-1", [{ type: "tool_use", id: "tool-1", name: "Bash", input: { command: "git tag v2.4.0" } }], { input_tokens: 1200, output_tokens: 48 }),
    typed.user([{ type: "tool_result", tool_use_id: "tool-1", content: "" }]),
    typed.assistant("msg-2", [{ type: "tool_use", id: "tool-2", name: "Bash", input: { command: "git push origin v2.4.0" } }], { input_tokens: 1300, output_tokens: 30 }),
    typed.user([{ type: "tool_result", tool_use_id: "tool-2", content: "fatal: could not read from remote repository", is_error: true }]),
    typed.user("<task-notification>\nThe nightly build finished.\n</task-notification>"),
    typed.assistant("msg-3", [{ type: "tool_use", id: "tool-3", name: "Agent", input: { description: "Read the changelog", prompt: "List what changed since 2.3" } }], { input_tokens: 1400, output_tokens: 25 }),
    typed.user([{ type: "tool_result", tool_use_id: "tool-3", content: [{ type: "text", text: "Two fixes and the new signing step." }] }]),
    typed.assistant("msg-4", [{ type: "text", text: "Tagged **v2.4.0**. The push failed: the remote did not answer.\n\nIt holds two fixes and the new signing step." }], { input_tokens: 1500, output_tokens: 60 }),
    typed.record("ai-title", { aiTitle: "Tagging the 2.4 release" }),
    typed.user("Try the push again"),
    typed.assistant("msg-5", [{ type: "text", text: "Pushed." }], { input_tokens: 1600, output_tokens: 8 }),
    typed.record("cost-state", { totalCostUSD: 0.42 }),
  ]);

  const helper = claude(SESSIONS.typed, "cli", atlas, true);
  transcript(`${slug}/${SESSIONS.typed}/subagents/agent-a7c2.jsonl`, 8, [
    helper.user("List what changed since 2.3", { agentId: "a7c2" }),
    helper.assistant("msg-s1", [{ type: "tool_use", id: "tool-s1", name: "Read", input: { file_path: "CHANGELOG.md" } }], { input_tokens: 300, output_tokens: 12 }),
    helper.user([{ type: "tool_result", tool_use_id: "tool-s1", content: "## 2.4\n- Fix the stalled upload\n- Fix the date on the receipt\n- Sign before notarizing" }], { agentId: "a7c2" }),
    helper.assistant("msg-s2", [{ type: "text", text: "Two fixes and the new signing step." }], { input_tokens: 420, output_tokens: 14 }),
  ]);

  const once = claude(SESSIONS.oneShot, "sdk-ts", atlas);
  transcript(`${slug}/${SESSIONS.oneShot}.jsonl`, 20, [
    once.user("Give this commit a one-line summary: fix the date on the receipt"),
    once.assistant("msg-o1", [{ type: "text", text: "Fix the receipt's date" }], { input_tokens: 90, output_tokens: 6 }),
  ]);

  const driven = claude(SESSIONS.realm, "sdk-ts", atlas);
  transcript(`${slug}/${SESSIONS.realm}.jsonl`, 40, [
    driven.user("Plan the 2.4 release with me"),
    driven.assistant("msg-r1", [{ type: "text", text: "What has to ship, and by when?" }], { input_tokens: 800, output_tokens: 12 }),
    driven.user("The signing step, by Monday"),
    driven.assistant("msg-r2", [{ type: "text", text: "Then the changelog comes first. I will have it checked." }], { input_tokens: 900, output_tokens: 18 }),
  ]);

  const codex = (file, endedMinute, meta, records) => {
    let n = 0;
    transcript(`.codex/sessions/2026/03/02/${file}.jsonl`, endedMinute, [
      { timestamp: minute(0), type: "session_meta", payload: { timestamp: minute(0), cli_version: "9.9.9", ...meta } },
      { timestamp: minute(0), type: "turn_context", payload: { cwd: meta.cwd, model: "gpt-fixture-1" } },
      ...records.map((record) => ({ timestamp: minute(++n), ...record })),
    ]);
  };
  const item = (payload) => ({ type: "response_item", payload });
  const message = (role, text) => item({ type: "message", role, content: [{ type: role === "assistant" ? "output_text" : "input_text", text }] });

  codex(`rollout-2026-03-02T09-00-00-${SESSIONS.codex}`, 30, { id: SESSIONS.codex, cwd: beacon, originator: "codex-tui", source: "cli" }, [
    message("developer", "Follow the rules in AGENTS.md."),
    message("user", `<environment_context>\n<cwd>${beacon}</cwd>\n</environment_context>`),
    message("user", "Why is the beacon dark?"),
    item({ type: "reasoning", summary: [{ type: "summary_text", text: "Look at the power before the lamp." }], encrypted_content: "fixture" }),
    item({ type: "function_call", name: "shell", arguments: JSON.stringify({ command: ["cat", "fuse.log"] }), call_id: "call-1" }),
    item({ type: "function_call_output", call_id: "call-1", output: "Exit code: 0\nWall time: 0.1 seconds\nOutput:\nfuse 3 blew at 02:10" }),
    item({ type: "custom_tool_call", name: "apply_patch", input: "*** Begin Patch\n*** Update File: fuses.md\n+Fuse 3 replaced.\n*** End Patch", call_id: "call-2" }),
    item({ type: "custom_tool_call_output", call_id: "call-2", output: "Exit code: 1\nOutput:\nfuses.md: no such file" }),
    { type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 2100, output_tokens: 140 } } } },
    message("assistant", "Fuse 3 blew at 02:10. I could not note it: there is no fuses.md."),
  ]);

  codex(`rollout-2026-03-02T09-00-00-${SESSIONS.dispatched}`, 35, { id: SESSIONS.dispatched, cwd: atlas, originator: "realm", source: "exec" }, [
    message("user", "Check the changelog names the signing step"),
    message("assistant", "It does, under 2.4."),
  ]);
}
