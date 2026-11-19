import type { Db } from "../db/database";

/** The person's tags on library files. They live here and are never written into a file. */
export class TagStore {
  constructor(private db: Db) {}

  /** Every tagged file's tags, by file id. */
  all(): Map<string, string[]> {
    const byFile = new Map<string, string[]>();
    for (const row of this.db.prepare("SELECT item_id, tag FROM item_tags ORDER BY tag").all() as { item_id: string; tag: string }[]) {
      byFile.set(row.item_id, [...(byFile.get(row.item_id) ?? []), row.tag]);
    }
    return byFile;
  }

  set(itemId: string, tags: readonly string[]): string[] {
    const kept = [...new Set(tags.map((t) => t.toLowerCase()))].sort();
    this.db.exec("BEGIN");
    try {
      this.db.prepare("DELETE FROM item_tags WHERE item_id = ?").run(itemId);
      const add = this.db.prepare("INSERT INTO item_tags (item_id, tag) VALUES (?, ?)");
      for (const tag of kept) add.run(itemId, tag);
      this.db.exec("COMMIT");
    } catch (e) { this.db.exec("ROLLBACK"); throw e; }
    return kept;
  }

  /** A file that moved or was deleted leaves its tags behind; they go with it. */
  forget(itemId: string): void {
    this.db.prepare("DELETE FROM item_tags WHERE item_id = ?").run(itemId);
  }
}
