import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

/** What Realm calls its profiles and spaces, for labelling the memory it keeps. */
export type RealmNames = {
  /** Profile id → name. */
  profiles: Map<string, string>;
  /** Space id → name and the folder it works in. */
  spaces: Map<string, { name: string; profileId: string; folderPath: string }>;
  /** `<profileId>/<folder>` → the space whose folder of the profile's memory repo that is. */
  spaceOfFolder: Map<string, string>;
};

export const realmDb = (home: string): string => join(home, "Realm", "realm.db");

const NONE: RealmNames = { profiles: new Map(), spaces: new Map(), spaceOfFolder: new Map() };

/**
 * Read the names out of Realm's own database, read-only. Its schema is Realm's private business, so
 * any surprise (no file, a renamed table, a locked database) answers with no names at all, and the
 * library falls back to ids and folder names.
 */
export function readRealmNames(dbPath: string): RealmNames {
  let db: DatabaseSync;
  try { db = new DatabaseSync(dbPath, { readOnly: true }); } catch { return NONE; }
  try {
    const names: RealmNames = { profiles: new Map(), spaces: new Map(), spaceOfFolder: new Map() };
    for (const row of db.prepare("SELECT id, name FROM profiles").all() as { id: string; name: string }[]) names.profiles.set(row.id, row.name);
    for (const row of db.prepare("SELECT id, name, profile_id, folder_path FROM spaces").all() as { id: string; name: string; profile_id: string; folder_path: string }[]) {
      names.spaces.set(row.id, { name: row.name, profileId: row.profile_id, folderPath: row.folder_path });
    }
    const prefix = "memory.spaceFolder:";
    for (const row of db.prepare("SELECT key, value_json FROM settings WHERE key LIKE ?").all(`${prefix}%`) as { key: string; value_json: string }[]) {
      const spaceId = row.key.slice(prefix.length);
      const kept = JSON.parse(row.value_json) as { folder?: unknown; profileId?: unknown };
      const profileId = typeof kept.profileId === "string" ? kept.profileId : names.spaces.get(spaceId)?.profileId;
      if (typeof kept.folder === "string" && profileId) names.spaceOfFolder.set(`${profileId}/${kept.folder}`, spaceId);
    }
    return names;
  } catch {
    return NONE;
  } finally {
    db.close();
  }
}
