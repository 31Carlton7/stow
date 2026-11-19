import type { SessionOrigin } from "@amc/contracts";
import type { RealmRow } from "./realm-sessions";
import { sentence } from "./transcript";

export type Origin = { origin: SessionOrigin; drivenBy: string | null; parentId: string | null };

/** Claude's `entrypoint` and Codex's `originator` for someone typing into the agent's own terminal. */
const TERMINALS = new Set(["cli", "codex-tui", "codex_cli_rs"]);

/** The apps that hold a conversation for a person, by the word they start the agent with. */
const APPS: Record<string, string> = {
  "claude-desktop": "Claude Desktop", "claude-vscode": "VS Code",
  "Codex Desktop": "Codex Desktop", codex_vscode: "VS Code", t3code_desktop: "T3 Code", realm: "Realm",
};

/**
 * Who was on the other end of a session. The rules, in the order they are tried:
 *
 * 1. A file that says another session started it is a `sub-agent`: Claude's `subagents/` folder and
 *    `isSidechain`, Codex's `source.subagent`. Its parent is the folder's session or the named thread.
 * 2. A session Realm's database holds, other than one it only imported, was driven by Realm. One
 *    Realm session starting another (`agent_run`) is a `sub-agent` of its dispatcher; the rest are `app`.
 * 3. Otherwise by the word the agent was started with. A terminal is a `person`. A desktop app or
 *    an editor is an `app`, by name. What is left is a program using the SDK or `exec`: it is a
 *    `one-shot` when it asked once or never, and an `app` nobody can name when it kept talking.
 *    A file too old to say how it was started is taken for a terminal.
 *
 * `userTurns` is how many times the person's side spoke as far as the file has been read. The first
 * look reads only a file's head, so a long SDK session can be listed as a `one-shot` until the
 * second look has counted it whole.
 */
export function originOf(told: {
  subAgent: boolean; parentId: string | null; startedBy: string | null; userTurns: number; realm: RealmRow | null;
}): Origin {
  const drivenByRealm = told.realm !== null && told.realm.dispatchedBy !== "import";
  if (told.subAgent) return { origin: "sub-agent", drivenBy: drivenByRealm ? "Realm" : null, parentId: told.parentId };
  if (drivenByRealm) {
    return told.realm!.dispatchedBy === "agent_run"
      ? { origin: "sub-agent", drivenBy: "Realm", parentId: told.realm!.parentId }
      : { origin: "app", drivenBy: "Realm", parentId: null };
  }
  const startedBy = told.startedBy ?? "";
  if (startedBy === "" || TERMINALS.has(startedBy)) return { origin: "person", drivenBy: null, parentId: null };
  const app = APPS[startedBy] ?? (/desktop|vscode/i.test(startedBy) ? sentence(startedBy) : null);
  if (app !== null) return { origin: "app", drivenBy: app, parentId: null };
  return { origin: told.userTurns <= 1 ? "one-shot" : "app", drivenBy: null, parentId: null };
}

/** The same session once the second look has counted every turn: only rule 3's last case turns on the count. */
export function recounted(listed: { origin: SessionOrigin; drivenBy: string | null }, userTurns: number): SessionOrigin {
  const unnamedProgram = listed.origin === "one-shot" || (listed.origin === "app" && listed.drivenBy === null);
  if (!unnamedProgram) return listed.origin;
  return userTurns <= 1 ? "one-shot" : "app";
}
