import type { z } from "zod";
import type { Db } from "./database";

/** The stored value under `key`, or `fallback` when nothing is stored or what is stored no longer
 *  fits the schema (a setting written by an older build). */
export function readSetting<S extends z.ZodTypeAny>(db: Db, key: string, schema: S, fallback: z.output<S>): z.output<S> {
  const row = db.prepare("SELECT value_json FROM settings WHERE key = ?").get(key) as { value_json: string } | undefined;
  if (!row) return fallback;
  try {
    const parsed = schema.safeParse(JSON.parse(row.value_json));
    return parsed.success ? parsed.data : fallback;
  } catch { return fallback; }
}

export function writeSetting(db: Db, key: string, value: unknown): void {
  db.prepare("INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json").run(key, JSON.stringify(value));
}
