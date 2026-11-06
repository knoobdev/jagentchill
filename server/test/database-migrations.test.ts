import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { openDatabase } from "../src/store/database.ts";
import { SYNC_MIGRATION } from "../src/sync/schema.ts";
import { TOOL_REQUESTS_MIGRATION, TOOLS_MIGRATION } from "../src/tools/schema.ts";

// Positional migration history as of schema version 10. Keep this fixture frozen: existing entries may not move or
// change their opening statement. New migrations belong after this entire prefix.
const POSITIONAL_PREFIX = [
  "CREATE TABLE devices",
  "CREATE TABLE agent_sessions",
  "ALTER TABLE agent_sessions ADD COLUMN gateway_key",
  "CREATE TABLE sync_docs",
  "CREATE TABLE tool_proposals",
  "ALTER TABLE agent_sessions ADD COLUMN script_id",
  "CREATE TABLE tool_requests",
  "ALTER TABLE agent_sessions ADD COLUMN tool_surface",
  "CREATE TABLE session_attachments",
  "ALTER TABLE agent_sessions ADD COLUMN pinned",
];

const migrationFirstStatements = (source: string): string[] => {
  const body = source.match(/const MIGRATIONS: string\[\] = \[([\s\S]*?)\n\];/)?.[1];
  assert.ok(body, "database.ts must declare its positional MIGRATIONS array");
  const refs: string[] = [];
  const uncommented = body.replace(/^\s*\/\/.*$/gm, "");
  for (const match of uncommented.matchAll(/`([\s\S]*?)`|\b([A-Z][A-Z0-9_]*)\b/g)) {
    const sql = match[1] ?? ({ SYNC_MIGRATION, TOOLS_MIGRATION, TOOL_REQUESTS_MIGRATION } as Record<string, string>)[match[2]!];
    assert.ok(sql, `unknown migration entry ${match[2] ?? "(inline SQL)"}`);
    const first = sql.trim().split(";", 1)[0]!.replace(/\s+/g, " ").trim();
    const identity = /^(CREATE TABLE \w+|ALTER TABLE \w+ ADD COLUMN \w+)/.exec(first)?.[1];
    assert.ok(identity, `unrecognized migration opening statement: ${first}`);
    refs.push(identity);
  }
  return refs;
};

const assertStablePrefix = (actual: string[]) => {
  assert.ok(actual.length >= POSITIONAL_PREFIX.length, "the history cannot lose an existing migration");
  assert.deepEqual(actual.slice(0, POSITIONAL_PREFIX.length), POSITIONAL_PREFIX);
};

test("database migrations keep their positional prefix; new migrations append after it", () => {
  const source = readFileSync(new URL("../src/store/database.ts", import.meta.url), "utf8");
  const actual = migrationFirstStatements(source);
  assertStablePrefix(actual);
  assert.doesNotThrow(() => assertStablePrefix([...actual, "CREATE TABLE future_migration"]), "an appended migration is allowed");
  assert.throws(() => assertStablePrefix([actual[0]!, "CREATE TABLE inserted_in_the_middle", ...actual.slice(1)]), "an inserted migration shifts the positional history");
});

test("the appended account snapshot migration opens a version-10 database", () => {
  const dir = mkdtempSync(join(tmpdir(), "jagentchill-migration-"));
  const file = join(dir, "jagentchill.sqlite");
  let db = openDatabase(file);
  db.exec("DROP TABLE usage_plan_snapshots; DROP TABLE media_jobs; DROP TABLE session_engine_errors; ALTER TABLE devices DROP COLUMN last_transport; ALTER TABLE agent_sessions DROP COLUMN runtime_handle; PRAGMA user_version = 10;");
  db.close();
  db = openDatabase(file);
  assert.ok((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version >= 11);
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'usage_plan_snapshots'").get());
  db.close();
  rmSync(dir, { recursive: true });
});

test("the appended device transport migration preserves version-11 databases", () => {
  const dir = mkdtempSync(join(tmpdir(), "jagentchill-device-path-migration-"));
  const file = join(dir, "jagentchill.sqlite");
  let db = openDatabase(file);
  db.exec("DROP TABLE media_jobs; DROP TABLE session_engine_errors; ALTER TABLE devices DROP COLUMN last_transport; ALTER TABLE agent_sessions DROP COLUMN runtime_handle; PRAGMA user_version = 11;");
  db.close();
  db = openDatabase(file);
  const columns = db.prepare("PRAGMA table_info(devices)").all() as Array<{ name: string }>;
  assert.ok(columns.some((column) => column.name === "last_transport"));
  db.close();
  rmSync(dir, { recursive: true });
});

test("the appended media jobs migration opens a version-12 database", () => {
  const dir = mkdtempSync(join(tmpdir(), "jagentchill-media-jobs-migration-"));
  const file = join(dir, "jagentchill.sqlite");
  let db = openDatabase(file);
  db.exec("DROP TABLE media_jobs; DROP TABLE session_engine_errors; ALTER TABLE agent_sessions DROP COLUMN runtime_handle; PRAGMA user_version = 12;");
  db.close();
  db = openDatabase(file);
  assert.equal((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, 17);
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'media_jobs'").get());
  db.close();
  rmSync(dir, { recursive: true });
});

test("the appended remote export migration opens a database at version 14", () => {
  const dir = mkdtempSync(join(tmpdir(), "jagentchill-remote-export-migration-"));
  const file = join(dir, "jagentchill.sqlite");
  let db = openDatabase(file);
  db.exec("DROP INDEX media_jobs_output; DROP TABLE session_engine_errors; ALTER TABLE media_jobs DROP COLUMN output_size; ALTER TABLE media_jobs DROP COLUMN output_mime; ALTER TABLE media_jobs DROP COLUMN output_name; ALTER TABLE media_jobs DROP COLUMN output_sha256; ALTER TABLE media_jobs DROP COLUMN cancelled; ALTER TABLE media_jobs DROP COLUMN encoded_bytes; ALTER TABLE media_jobs DROP COLUMN frame_count; ALTER TABLE media_jobs DROP COLUMN frames_done; ALTER TABLE media_jobs DROP COLUMN stage; ALTER TABLE media_jobs DROP COLUMN started_ms; ALTER TABLE media_jobs DROP COLUMN created_by; ALTER TABLE media_jobs DROP COLUMN payload; ALTER TABLE media_jobs DROP COLUMN revision; ALTER TABLE media_jobs DROP COLUMN project_id; ALTER TABLE agent_sessions DROP COLUMN runtime_handle; PRAGMA user_version = 14;");
  db.close();
  db = openDatabase(file);
  assert.equal((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, 17);
  const columns = db.prepare("PRAGMA table_info(media_jobs)").all() as Array<{ name: string }>;
  assert.ok(columns.some((column) => column.name === "project_id"));
  db.close();
  rmSync(dir, { recursive: true });
});
