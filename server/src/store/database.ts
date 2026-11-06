import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SYNC_MIGRATION } from "../sync/schema.ts";
import { TOOL_REQUESTS_MIGRATION, TOOLS_MIGRATION } from "../tools/schema.ts";

const MIGRATIONS: string[] = [
  `CREATE TABLE devices (
     device_id TEXT PRIMARY KEY,
     public_key TEXT NOT NULL UNIQUE,
     name TEXT NOT NULL,
     platform TEXT NOT NULL,
     role TEXT NOT NULL,
     state TEXT NOT NULL,
     key_protection TEXT NOT NULL,
     local_supervisor INTEGER NOT NULL DEFAULT 0,
     paired_ms INTEGER NOT NULL,
     paired_by TEXT NOT NULL,
     last_seen_ms INTEGER NOT NULL
   ) STRICT;
   CREATE TABLE device_tokens (
     device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
     digest TEXT NOT NULL,
     slot TEXT NOT NULL CHECK (slot IN ('current', 'previous')),
     expires_ms INTEGER NOT NULL,
     issued_ms INTEGER NOT NULL,
     invalid_after_ms INTEGER,
     PRIMARY KEY (device_id, slot)
   ) STRICT;
   CREATE TABLE audit (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     ts_ms INTEGER NOT NULL,
     actor TEXT NOT NULL,
     action TEXT NOT NULL,
     details TEXT NOT NULL
   ) STRICT;`,
  `CREATE TABLE agent_sessions (
     session_key TEXT PRIMARY KEY,
     owner_device_id TEXT NOT NULL,
     owner_state TEXT NOT NULL DEFAULT 'active',
     agent_class TEXT NOT NULL,
     access TEXT NOT NULL DEFAULT 'private',
     project_id TEXT,
     workspace_id TEXT,
     origin TEXT NOT NULL,
     title TEXT,
     created_ms INTEGER NOT NULL
   ) STRICT;
   CREATE INDEX agent_sessions_owner ON agent_sessions (owner_device_id);`,
  // Runtime selection per session, ORC, the durable hand-over of a runtime switch and usage per turn.
  `ALTER TABLE agent_sessions ADD COLUMN gateway_key TEXT;
   ALTER TABLE agent_sessions ADD COLUMN agent_id TEXT NOT NULL DEFAULT 'main';
   ALTER TABLE agent_sessions ADD COLUMN runtime_id TEXT;
   ALTER TABLE agent_sessions ADD COLUMN provider_id TEXT;
   ALTER TABLE agent_sessions ADD COLUMN model_id TEXT;
   ALTER TABLE agent_sessions ADD COLUMN mode_id TEXT NOT NULL DEFAULT 'edit';
   ALTER TABLE agent_sessions ADD COLUMN pending_mode_id TEXT;
   ALTER TABLE agent_sessions ADD COLUMN thinking TEXT;
   ALTER TABLE agent_sessions ADD COLUMN features TEXT NOT NULL DEFAULT '{}';
   ALTER TABLE agent_sessions ADD COLUMN unattended INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE agent_sessions ADD COLUMN title_source TEXT;
   ALTER TABLE agent_sessions ADD COLUMN parent_session_key TEXT;
   CREATE TABLE host_documents (key TEXT PRIMARY KEY, revision INTEGER NOT NULL, json TEXT NOT NULL) STRICT;
   CREATE TABLE orc_overrides (
     scope_kind TEXT NOT NULL, scope_id TEXT NOT NULL, route TEXT NOT NULL, target TEXT NOT NULL,
     PRIMARY KEY (scope_kind, scope_id, route)
   ) STRICT;
   CREATE TABLE runtime_handover (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     session_key TEXT NOT NULL,
     from_ref TEXT NOT NULL,
     to_ref TEXT NOT NULL,
     text TEXT NOT NULL,
     item_count INTEGER NOT NULL,
     omitted_count INTEGER NOT NULL,
     created_ms INTEGER NOT NULL,
     status TEXT NOT NULL CHECK (status IN ('staged', 'delivered', 'superseded')),
     delivered_ms INTEGER
   ) STRICT;
   CREATE INDEX runtime_handover_session ON runtime_handover (session_key, status);
   CREATE TABLE session_switches (session_key TEXT NOT NULL, ts_ms INTEGER NOT NULL, idempotency_key TEXT NOT NULL, result TEXT NOT NULL) STRICT;
   CREATE INDEX session_switches_session ON session_switches (session_key, ts_ms);
   CREATE TABLE session_usage (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     session_key TEXT NOT NULL,
     run_id TEXT NOT NULL,
     runtime_id TEXT,
     provider_id TEXT,
     model_id TEXT,
     input_tokens INTEGER,
     output_tokens INTEGER,
     cache_read_tokens INTEGER,
     cache_write_tokens INTEGER,
     total_tokens INTEGER,
     cost REAL,
     reported INTEGER NOT NULL,
     ts_ms INTEGER NOT NULL,
     UNIQUE (session_key, run_id)
   ) STRICT;`,
  // Cross-device sync: documents, operation log, snapshots, versions, blobs, comments, library items.
  SYNC_MIGRATION,
  // Agent tools: proposals, idempotency keys, chat notices.
  TOOLS_MIGRATION,
  // A session can be bound to a script (`script-studio.Screenwriter agent and source material`).
  `ALTER TABLE agent_sessions ADD COLUMN script_id TEXT;`,
  // Agent tools: permission requests and questions put to a person.
  TOOL_REQUESTS_MIGRATION,
  // APPEND ONLY: a migration is identified by its position; a host that is already at a later position never runs an
  // earlier one, and one inserted in the middle makes it run the next one twice ("table … already exists").
  `ALTER TABLE agent_sessions ADD COLUMN tool_surface TEXT;`,
  `CREATE TABLE session_attachments (
     attachment_id TEXT PRIMARY KEY, session_key TEXT NOT NULL REFERENCES agent_sessions(session_key) ON DELETE CASCADE, blob_id TEXT NOT NULL,
     name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, who TEXT NOT NULL, created_ms INTEGER NOT NULL
   ) STRICT;
   CREATE INDEX session_attachments_session ON session_attachments (session_key, created_ms);
   CREATE TABLE session_attachment_messages (
     marker TEXT PRIMARY KEY, session_key TEXT NOT NULL REFERENCES agent_sessions(session_key) ON DELETE CASCADE, attachment_ids TEXT NOT NULL, created_ms INTEGER NOT NULL
   ) STRICT;
   CREATE INDEX session_attachment_messages_session ON session_attachment_messages (session_key, created_ms);`,
  `ALTER TABLE agent_sessions ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE agent_sessions ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;`,
  `CREATE TABLE usage_plan_snapshots (
     provider_id TEXT NOT NULL,
     runtime_id TEXT NOT NULL,
     payload TEXT NOT NULL,
     fetched_ms INTEGER NOT NULL,
     PRIMARY KEY (provider_id, runtime_id)
   ) STRICT;`,
  // The last authenticated path remains useful while a device is offline and across host restarts.
  `ALTER TABLE devices ADD COLUMN last_transport TEXT CHECK (last_transport IS NULL OR last_transport IN ('loopback', 'lan', 'tailnet'));`,
  `CREATE TABLE media_jobs (
     job_id TEXT PRIMARY KEY, kind TEXT NOT NULL, sha256 TEXT NOT NULL, variant TEXT NOT NULL,
     state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'succeeded', 'failed')),
     error TEXT, created_ms INTEGER NOT NULL, finished_ms INTEGER
   ) STRICT;
   CREATE INDEX media_jobs_variant ON media_jobs (sha256, variant, created_ms);`,
  `ALTER TABLE media_jobs ADD COLUMN progress REAL NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 1);`,
  `ALTER TABLE media_jobs ADD COLUMN project_id TEXT;
   ALTER TABLE media_jobs ADD COLUMN revision INTEGER;
   ALTER TABLE media_jobs ADD COLUMN payload TEXT;
   ALTER TABLE media_jobs ADD COLUMN created_by TEXT;
   ALTER TABLE media_jobs ADD COLUMN started_ms INTEGER;
   ALTER TABLE media_jobs ADD COLUMN stage TEXT;
   ALTER TABLE media_jobs ADD COLUMN frames_done INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE media_jobs ADD COLUMN frame_count INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE media_jobs ADD COLUMN encoded_bytes INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE media_jobs ADD COLUMN cancelled INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE media_jobs ADD COLUMN output_sha256 TEXT;
   ALTER TABLE media_jobs ADD COLUMN output_name TEXT;
   ALTER TABLE media_jobs ADD COLUMN output_mime TEXT;
   ALTER TABLE media_jobs ADD COLUMN output_size INTEGER;
   CREATE INDEX media_jobs_output ON media_jobs (output_sha256);`,
  `CREATE TABLE session_engine_errors (
     id TEXT PRIMARY KEY,
     session_key TEXT NOT NULL REFERENCES agent_sessions(session_key) ON DELETE CASCADE,
     run_id TEXT,
     code TEXT NOT NULL,
     message TEXT NOT NULL,
     message_key TEXT NOT NULL,
     action TEXT NOT NULL,
     retryable INTEGER NOT NULL CHECK (retryable IN (0, 1)),
     raw TEXT NOT NULL,
     ts_ms INTEGER NOT NULL
   ) STRICT;
   CREATE UNIQUE INDEX session_engine_errors_run ON session_engine_errors (session_key, run_id) WHERE run_id IS NOT NULL;
   CREATE INDEX session_engine_errors_session ON session_engine_errors (session_key, ts_ms);`,
  // Where the runtime keeps a session's conversation (its own session or thread id), so a turn after a restart resumes it.
  `ALTER TABLE agent_sessions ADD COLUMN runtime_handle TEXT;`,
];

/** Opens the server's own database and brings it to the latest schema. */
export function openDatabase(file: string): DatabaseSync {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL;");
  const { user_version: version } = db.prepare("PRAGMA user_version").get() as { user_version: number };
  for (let i = version; i < MIGRATIONS.length; i++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[i]);
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
  return db;
}

export function transaction<T>(db: DatabaseSync, run: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = run();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function audit(db: DatabaseSync, now: number, actor: string, action: string, details: Record<string, unknown>): void {
  db.prepare("INSERT INTO audit (ts_ms, actor, action, details) VALUES (?, ?, ?, ?)").run(now, actor, action, JSON.stringify(details));
}
