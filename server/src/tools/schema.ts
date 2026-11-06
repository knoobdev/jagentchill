/**
 * The tables of the agent tools: proposals (with their recorded tool calls and, once applied, the inverse batch),
 * idempotency keys and the notices a refused tool leaves in a chat. This file imports nothing, so the database module
 * can list it among its migrations.
 */
export const TOOLS_MIGRATION = `
  CREATE TABLE tool_proposals (
    proposal_id TEXT PRIMARY KEY, session_key TEXT NOT NULL, project_id TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('open', 'pending', 'applying', 'accepted', 'partially_accepted', 'rejected', 'stale', 'expired', 'failed', 'discarded')),
    base_revision INTEGER NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL, created_ms INTEGER NOT NULL, submitted_ms INTEGER, resolved_ms INTEGER,
    json TEXT NOT NULL
  ) STRICT;
  CREATE INDEX tool_proposals_session ON tool_proposals (session_key, state);
  CREATE INDEX tool_proposals_project ON tool_proposals (project_id, state);
  CREATE TABLE tool_idempotency (session_key TEXT NOT NULL, key TEXT NOT NULL, hash TEXT NOT NULL, result TEXT NOT NULL, ts_ms INTEGER NOT NULL, PRIMARY KEY (session_key, key)) STRICT;
  CREATE TABLE tool_notices (notice_id TEXT PRIMARY KEY, session_key TEXT NOT NULL, json TEXT NOT NULL, created_ms INTEGER NOT NULL) STRICT;
  CREATE INDEX tool_notices_session ON tool_notices (session_key);`;

/** Requests a tool puts to a person: permissions for effects outside the project, and questions. */
export const TOOL_REQUESTS_MIGRATION = `
  CREATE TABLE tool_requests (
    request_id TEXT PRIMARY KEY, session_key TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('permission', 'question')), state TEXT NOT NULL,
    hash TEXT NOT NULL, json TEXT NOT NULL, created_ms INTEGER NOT NULL, expires_ms INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX tool_requests_session ON tool_requests (session_key, kind, hash);`;
