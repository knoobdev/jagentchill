/**
 * The tables of media generation: the model overlay (what an admin enabled, added or edited over the bundled
 * catalogue), provider jobs, the append-only cost ledger and the result cache. `budget_commits` is the table the usage
 * service keeps budgets in; a generation job reserves and settles its cost there under the reference `gen:<jobId>`,
 * so one budget counts agent turns and generation together. Every statement is safe to run again.
 */
export const GENERATION_MIGRATION = `
  CREATE TABLE IF NOT EXISTS gen_models (provider TEXT NOT NULL, model TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY (provider, model)) STRICT;
  CREATE TABLE IF NOT EXISTS gen_jobs (
    job_id TEXT PRIMARY KEY, kind TEXT NOT NULL, state TEXT NOT NULL, project_id TEXT, batch_id TEXT, json TEXT NOT NULL, created_ms INTEGER NOT NULL, finished_ms INTEGER
  ) STRICT;
  CREATE INDEX IF NOT EXISTS gen_jobs_state ON gen_jobs (state, created_ms);
  CREATE TABLE IF NOT EXISTS gen_ledger (
    id TEXT PRIMARY KEY, ts_ms INTEGER NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, capability TEXT NOT NULL, project_id TEXT, session_id TEXT, job_id TEXT, tool_call_id TEXT,
    units TEXT NOT NULL, estimate_usd REAL, actual_usd REAL, price_source TEXT NOT NULL, outcome TEXT NOT NULL, error_class TEXT, cache_hit INTEGER NOT NULL, used_fallback INTEGER NOT NULL, duration_ms INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS gen_ledger_ts ON gen_ledger (ts_ms);
  CREATE TABLE IF NOT EXISTS gen_cache (key TEXT PRIMARY KEY, capability TEXT NOT NULL, results TEXT NOT NULL, bytes INTEGER NOT NULL, created_ms INTEGER NOT NULL, used_ms INTEGER NOT NULL) STRICT;
  CREATE TABLE IF NOT EXISTS budget_commits (ref TEXT PRIMARY KEY, provider_id TEXT, project_id TEXT, session_key TEXT, amount_usd REAL NOT NULL, unpriced INTEGER NOT NULL DEFAULT 0, ts_ms INTEGER NOT NULL) STRICT;
`;
