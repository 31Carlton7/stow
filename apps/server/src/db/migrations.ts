/** One entry per schema version, applied in order and never edited once shipped. */
export const migrations: string[] = [
  // v1
  `CREATE TABLE item_tags (item_id TEXT NOT NULL, tag TEXT NOT NULL, PRIMARY KEY (item_id, tag));`,
  // v2
  `CREATE TABLE settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
   CREATE TABLE model_calls (
     id INTEGER PRIMARY KEY,
     ts INTEGER NOT NULL,
     runner TEXT NOT NULL,
     model TEXT NOT NULL,
     tier TEXT NOT NULL,
     purpose TEXT NOT NULL,
     sent_json TEXT NOT NULL,
     prompt_chars INTEGER NOT NULL,
     input_tokens INTEGER,
     output_tokens INTEGER,
     cost_usd REAL,
     duration_ms INTEGER,
     ok INTEGER NOT NULL,
     error TEXT
   );
   CREATE INDEX model_calls_ts ON model_calls (ts);`,
  // v3
  `CREATE TABLE review_rejections (fingerprint TEXT PRIMARY KEY, type TEXT NOT NULL, title TEXT NOT NULL, at INTEGER NOT NULL);
   CREATE TABLE review_applies (
     id INTEGER PRIMARY KEY,
     fingerprint TEXT NOT NULL,
     type TEXT NOT NULL,
     title TEXT NOT NULL,
     at INTEGER NOT NULL,
     applied_json TEXT NOT NULL,
     undone_at INTEGER
   );`,
  // v4
  `CREATE TABLE model_findings (
     fingerprint TEXT PRIMARY KEY,
     type TEXT NOT NULL,
     title TEXT NOT NULL,
     detail TEXT NOT NULL,
     model TEXT NOT NULL,
     files_json TEXT NOT NULL,
     drafted_json TEXT,
     found_at INTEGER NOT NULL
   );`,
  // v5
  `CREATE TABLE sessions (
     path TEXT PRIMARY KEY,
     size INTEGER NOT NULL,
     mtime_ms INTEGER NOT NULL,
     id TEXT NOT NULL,
     agent TEXT NOT NULL,
     origin TEXT NOT NULL,
     driven_by TEXT,
     title TEXT NOT NULL,
     cwd TEXT,
     project_id TEXT,
     project_name TEXT,
     model TEXT,
     started_at INTEGER NOT NULL,
     parent_id TEXT,
     realm_json TEXT,
     metrics_json TEXT
   );
   CREATE INDEX sessions_id ON sessions (id);
   CREATE INDEX sessions_parent ON sessions (parent_id);
   CREATE INDEX sessions_newest ON sessions (mtime_ms);`,
  // v6
  `CREATE TABLE session_context (
     path TEXT PRIMARY KEY,
     size INTEGER NOT NULL,
     mtime_ms INTEGER NOT NULL,
     recorded INTEGER NOT NULL,
     files_json TEXT NOT NULL
   );`,
  // v7
  `CREATE TABLE favorites (kind TEXT NOT NULL, key TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (kind, key));`,
];
