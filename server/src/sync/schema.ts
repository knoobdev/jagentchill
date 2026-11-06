/**
 * The tables of cross-device sync: synced documents with their operation log, snapshots and versions; blobs; comments;
 * library items. This file imports nothing, so the database module can list it among its migrations.
 */
export const SYNC_MIGRATION = `
  CREATE TABLE sync_docs (
    kind TEXT NOT NULL, id TEXT NOT NULL, head INTEGER NOT NULL, schema_version INTEGER NOT NULL, min_reader INTEGER NOT NULL,
    name TEXT NOT NULL, duration INTEGER NOT NULL, cover_sha256 TEXT, updated_ms INTEGER NOT NULL, created_ms INTEGER NOT NULL,
    last_author TEXT NOT NULL, state TEXT NOT NULL CHECK (state IN ('active', 'trash', 'purged')), trashed_ms INTEGER, trashed_by TEXT,
    head_json TEXT NOT NULL, ops_since_snapshot INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (kind, id)
  ) STRICT;
  CREATE TABLE sync_ops (kind TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL, op_id TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY (kind, id, revision)) STRICT;
  CREATE UNIQUE INDEX sync_ops_op ON sync_ops (kind, id, op_id);
  CREATE TABLE sync_snapshots (kind TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL, sha256 TEXT NOT NULL, size INTEGER NOT NULL, created_ms INTEGER NOT NULL, PRIMARY KEY (kind, id, revision)) STRICT;
  CREATE TABLE sync_versions (
    version_id TEXT PRIMARY KEY, kind TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL, name TEXT NOT NULL, created_ms INTEGER NOT NULL,
    author_device TEXT NOT NULL, source TEXT NOT NULL, expires_ms INTEGER, sha256 TEXT NOT NULL, size INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX sync_versions_doc ON sync_versions (kind, id);
  CREATE TABLE sync_doc_blobs (kind TEXT NOT NULL, id TEXT NOT NULL, sha256 TEXT NOT NULL, PRIMARY KEY (kind, id, sha256)) STRICT;
  CREATE INDEX sync_doc_blobs_sha ON sync_doc_blobs (sha256);
  CREATE TABLE sync_version_blobs (version_id TEXT NOT NULL, sha256 TEXT NOT NULL, PRIMARY KEY (version_id, sha256)) STRICT;
  CREATE INDEX sync_version_blobs_sha ON sync_version_blobs (sha256);
  CREATE TABLE sync_continuity (project_id TEXT NOT NULL, device_id TEXT NOT NULL, scene_id TEXT NOT NULL, playhead_ticks INTEGER NOT NULL, updated_ms INTEGER NOT NULL, PRIMARY KEY (project_id, device_id)) STRICT;
  CREATE TABLE sync_idempotency (device_id TEXT NOT NULL, method TEXT NOT NULL, key TEXT NOT NULL, result TEXT NOT NULL, ts_ms INTEGER NOT NULL, PRIMARY KEY (device_id, method, key)) STRICT;
  CREATE TABLE blobs (
    sha256 TEXT PRIMARY KEY, size INTEGER NOT NULL, mime TEXT NOT NULL, name TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('uploading', 'complete', 'unavailable')),
    purpose TEXT NOT NULL DEFAULT 'media', linked_path TEXT, linked_mtime_ms REAL, link_verified INTEGER NOT NULL DEFAULT 0,
    variant_of TEXT, variant TEXT, uploader TEXT NOT NULL, created_ms INTEGER NOT NULL, touched_ms INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE blob_chunks (sha256 TEXT NOT NULL, idx INTEGER NOT NULL, size INTEGER NOT NULL, PRIMARY KEY (sha256, idx)) STRICT;
  CREATE TABLE blob_variants (sha256 TEXT NOT NULL, variant TEXT NOT NULL, variant_sha256 TEXT NOT NULL, size INTEGER NOT NULL, PRIMARY KEY (sha256, variant)) STRICT;
  CREATE TABLE sync_comments (
    comment_id TEXT PRIMARY KEY, target_type TEXT NOT NULL, target_id TEXT NOT NULL, revision INTEGER, time_ticks INTEGER, anchor TEXT, point TEXT,
    body TEXT NOT NULL, author_device TEXT NOT NULL, author_name TEXT NOT NULL, created_ms INTEGER NOT NULL, edited_ms INTEGER, resolved INTEGER NOT NULL DEFAULT 0, parent_id TEXT
  ) STRICT;
  CREATE INDEX sync_comments_target ON sync_comments (target_type, target_id);
  CREATE TABLE sync_library (
    item_id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, updated_ms INTEGER NOT NULL, server_updated_ms INTEGER NOT NULL,
    blob_sha256 TEXT, payload TEXT NOT NULL, updated_by TEXT NOT NULL, deleted_ms INTEGER
  ) STRICT;
  CREATE TABLE sync_device_schema (device_id TEXT PRIMARY KEY, project INTEGER NOT NULL, script INTEGER NOT NULL, workflow INTEGER NOT NULL, updated_ms INTEGER NOT NULL) STRICT;`;
