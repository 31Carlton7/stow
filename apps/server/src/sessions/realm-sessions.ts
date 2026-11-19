import { DatabaseSync } from "node:sqlite";
import type { RealmSession } from "@amc/contracts";

/** What Realm's database says of a session it holds, by the id the agent's own CLI gave it. */
export type RealmRow = RealmSession & {
  /** How it was started: `agent_run` for one session starting another, `import` for a transcript Realm only copied in. */
  dispatchedBy: string;
  /** The CLI's id of the session that started it, when one did and Realm still holds it. */
  parentId: string | null;
};

const NEEDED: Record<string, string[]> = {
  sessions: ["id", "provider_session_id", "title", "space_id", "teammate_id", "dispatched_by_kind", "dispatched_by_session_id"],
  spaces: ["id", "name"],
  team_roles: ["id", "name"],
};

/**
 * Realm's sessions by provider session id, read-only. Its schema is Realm's private business, so the
 * columns are checked first, and any surprise (no file, a renamed column, a locked database) answers
 * null: the index then knows nothing of Realm and says so by leaving `realm` empty.
 */
export function readRealmSessions(dbPath: string): Map<string, RealmRow> | null {
  let db: DatabaseSync;
  try { db = new DatabaseSync(dbPath, { readOnly: true }); } catch { return null; }
  try {
    for (const [table, columns] of Object.entries(NEEDED)) {
      const held = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((column) => column.name));
      if (columns.some((column) => !held.has(column))) return null;
    }
    const rows = db.prepare(`
      SELECT s.provider_session_id AS providerId, s.title, spaces.name AS space, team_roles.name AS teammate,
             COALESCE(s.dispatched_by_kind, '') AS dispatchedBy, parent.provider_session_id AS parentId
      FROM sessions s
      LEFT JOIN spaces ON spaces.id = s.space_id
      LEFT JOIN team_roles ON team_roles.id = s.teammate_id
      LEFT JOIN sessions parent ON parent.id = s.dispatched_by_session_id
      WHERE s.provider_session_id IS NOT NULL AND s.provider_session_id != ''
    `).all() as { providerId: string; title: string | null; space: string | null; teammate: string | null; dispatchedBy: string; parentId: string | null }[];
    return new Map(rows.map(({ providerId, ...row }) => [providerId, row]));
  } catch {
    return null;
  } finally {
    db.close();
  }
}
