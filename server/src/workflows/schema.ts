/**
 * The tables of workflows and automations: documents with their revisions, runs with their checkpoint, logs and
 * timeline, the sessions opened from a workflow's agent panel, and automation records with their run history.
 * The workflow service creates them when it starts: every statement is safe to run again.
 */
export const WORKFLOW_MIGRATION = `
  CREATE TABLE IF NOT EXISTS workflows (
    workflow_id TEXT PRIMARY KEY, name TEXT NOT NULL, revision INTEGER NOT NULL, json TEXT NOT NULL, problems INTEGER NOT NULL DEFAULT 0,
    created_ms INTEGER NOT NULL, updated_ms INTEGER NOT NULL, deleted_ms INTEGER
  ) STRICT;
  CREATE TABLE IF NOT EXISTS workflow_revisions (
    workflow_id TEXT NOT NULL, revision INTEGER NOT NULL, actor TEXT NOT NULL, label TEXT NOT NULL, graph_hash TEXT NOT NULL, json TEXT NOT NULL,
    touched TEXT NOT NULL, version_name TEXT, created_ms INTEGER NOT NULL, PRIMARY KEY (workflow_id, revision)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS workflow_runs (
    run_id TEXT PRIMARY KEY, number INTEGER NOT NULL, workflow_id TEXT NOT NULL, workflow_name TEXT NOT NULL, status TEXT NOT NULL, origin TEXT NOT NULL,
    record TEXT NOT NULL, state TEXT NOT NULL, created_ms INTEGER NOT NULL, started_ms INTEGER, finished_ms INTEGER, deleted_ms INTEGER, idempotency_key TEXT UNIQUE
  ) STRICT;
  CREATE INDEX IF NOT EXISTS workflow_runs_workflow ON workflow_runs (workflow_id, created_ms);
  CREATE INDEX IF NOT EXISTS workflow_runs_status ON workflow_runs (status);
  CREATE TABLE IF NOT EXISTS workflow_run_logs (
    run_id TEXT NOT NULL, seq INTEGER NOT NULL, ts_ms INTEGER NOT NULL, node_id TEXT NOT NULL, path TEXT NOT NULL, level TEXT NOT NULL, source TEXT NOT NULL, message TEXT NOT NULL,
    PRIMARY KEY (run_id, seq)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS workflow_run_timeline (run_id TEXT NOT NULL, seq INTEGER NOT NULL, ts_ms INTEGER NOT NULL, json TEXT NOT NULL, PRIMARY KEY (run_id, seq)) STRICT;
  CREATE TABLE IF NOT EXISTS workflow_sessions (session_key TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, created_ms INTEGER NOT NULL) STRICT;
  CREATE INDEX IF NOT EXISTS workflow_sessions_workflow ON workflow_sessions (workflow_id);
  CREATE TABLE IF NOT EXISTS workflow_idempotency (key TEXT PRIMARY KEY, result TEXT NOT NULL, ts_ms INTEGER NOT NULL) STRICT;
  CREATE TABLE IF NOT EXISTS automations (
    automation_id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, enabled INTEGER NOT NULL, json TEXT NOT NULL, revision INTEGER NOT NULL,
    created_ms INTEGER NOT NULL, updated_ms INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS automation_runs (
    run_id TEXT PRIMARY KEY, automation_id TEXT NOT NULL, number INTEGER NOT NULL, status TEXT NOT NULL, json TEXT NOT NULL, started_ms INTEGER NOT NULL, finished_ms INTEGER
  ) STRICT;
  CREATE INDEX IF NOT EXISTS automation_runs_automation ON automation_runs (automation_id, started_ms);`;
