import { droppedCount, migrateV31toV32, validateProjectDocument, type ClassicMediaRecord, type MigrationReportEntry, type Registries } from "@jagentchill/editor-core";
import { CLASSIC_STEPS } from "./classic/chain.ts";
import { isStorageError } from "./errors.ts";
import { fromBase64 } from "./mobile.ts";
import type { StoragePort } from "./port.ts";
import { evaluateStorageCapacity } from "./quota.ts";
import { CURRENT_SCHEMA_VERSION, detectVersion, serializeProjectRecord } from "./records.ts";
import { storageString } from "./strings.ts";

export { migrateV31toV32 };
export type MigrationContext = {
  now_ms: number; newId: () => string; registries?: Registries; mediaRecords: ClassicMediaRecord[];
  /** Legacy per-scene timeline records of the v1 era (`video-editor-timelines-*`), by scene id. */
  legacyTracksBySceneId?: Record<string, unknown[]>;
  /** The provider whose bundled sticker catalogue contains an un-prefixed id (v4→v5). */
  stickerProviderOf?: (id: string) => string | null;
};
/** One step of the chain: a pure transformer from one version to the next. `skipped` stops that project's chain. */
export type MigrationStep = {
  from: number; to: number; name: string;
  run(record: Record<string, unknown>, context: MigrationContext): { record: Record<string, unknown>; skipped?: boolean; report?: MigrationReportEntry[]; thumbnails?: { owner: "project" | "asset"; id: string; dataUrl: string }[] };
};

/** The classic steps v0→v1 … v30→v31 of the chain, with the behaviour of OpenCut classic. */
export const CLASSIC_CHAIN: MigrationStep[] = CLASSIC_STEPS.map((step) => ({
  from: step.from, to: step.to, name: step.name,
  run(record, context) {
    const mediaTypesById = Object.fromEntries(context.mediaRecords.map((media) => [media.id, media.type]));
    const result = step.run(record, { newId: context.newId, now_ms: context.now_ms, stickerProviderOf: context.stickerProviderOf, legacyTracksBySceneId: context.legacyTracksBySceneId ?? {}, mediaTypesById });
    return { record: result.project, skipped: result.skipped };
  },
}));

/** The v31→v32 step of the chain: the mapping of `project-document.Classic v31 mapping`, applied as one pure function. */
export const STEP_V31_TO_V32: MigrationStep = {
  from: 31, to: 32, name: "v31→v32",
  run(record, context) {
    const { document, report, thumbnails } = migrateV31toV32(record, context.mediaRecords, context);
    return { record: JSON.parse(serializeProjectRecord(document)) as Record<string, unknown>, report, thumbnails };
  },
};
/**
 * The v32→v33 step: schema 33 only adds optional content (template variables, relative timing anchors, voice-band
 * ducking). A v32 document is a valid v33 document with those absent, so the step raises the version and keeps every
 * field as it was.
 */
export const STEP_V32_TO_V33: MigrationStep = {
  from: 32, to: 33, name: "v32→v33",
  run(record) {
    return { record: { ...record, schemaVersion: 33, minReaderSchemaVersion: typeof record.minReaderSchemaVersion === "number" ? record.minReaderSchemaVersion : 32 } };
  },
};
/** The whole ordered chain, from a classic v0 record to the current schema. */
export const MIGRATION_CHAIN: MigrationStep[] = [...CLASSIC_CHAIN, STEP_V31_TO_V32, STEP_V32_TO_V33];

/** Applies the chain to one record in memory. Pure: nothing is read from or written to a store. */
export function migrateRecord(record: Record<string, unknown>, context: MigrationContext, steps: MigrationStep[] = MIGRATION_CHAIN, onStep?: (name: string) => void): { record: Record<string, unknown>; from: number; to: number; skipped: boolean; report: MigrationReportEntry[]; thumbnails: { owner: "project" | "asset"; id: string; dataUrl: string }[] } {
  const from = detectVersion(record), report: MigrationReportEntry[] = [], thumbnails: { owner: "project" | "asset"; id: string; dataUrl: string }[] = [];
  let version = from, current = record;
  while (version < CURRENT_SCHEMA_VERSION) {
    const next = steps.find((candidate) => candidate.from === version);
    if (!next) throw new Error(`no migration step from version ${version}`);
    onStep?.(next.name);
    const result = next.run(current, context);
    if (result.skipped) return { record, from, to: version, skipped: true, report, thumbnails };
    current = result.record;
    report.push(...(result.report ?? []));
    thumbnails.push(...(result.thumbnails ?? []));
    version = next.to;
  }
  onStep?.("validate");
  // The final result of the chain passes the validator in strict mode, or the project is not migrated.
  const strict = validateProjectDocument(current, { mode: "strict", registries: context.registries });
  if (!strict.ok) throw new Error(`the migrated document is not valid: ${strict.errors.slice(0, 3).map((error) => `${error.code} at ${error.path}`).join("; ")}`);
  return { record: current, from, to: version, skipped: false, report, thumbnails };
}

export type MigrationOutcome =
  | { id: string; status: "migrated"; from: number; to: number; backup: string; report: MigrationReportEntry[]; notice: string | null }
  | { id: string; status: "current" | "skipped"; from: number }
  | { id: string; status: "failed"; from: number; step: string; error: string }
  | { id: string; status: "no-space"; from: number; message: string };
export type MigrationFailure = { step: string; error: string; time_ms: number };
const FAILURES = "migration-failures";
/** The mark of a project whose migration failed, with the failing step and the error text for Info. */
export const migrationFailure = async (port: StoragePort, id: string): Promise<MigrationFailure | undefined> => ((await port.getSession<Record<string, MigrationFailure>>(FAILURES)) ?? {})[id];
const markFailure = async (port: StoragePort, id: string, failure: MigrationFailure | null) => {
  const all = { ...((await port.getSession<Record<string, MigrationFailure>>(FAILURES)) ?? {}) };
  if (failure) all[id] = failure; else delete all[id];
  await port.putSession(FAILURES, all);
};

/** Backups are kept for 30 days or until 3 newer backups of the same project exist, whichever comes first. */
export const BACKUP_RETENTION_MS = 30 * 86_400_000;
export async function pruneBackups(port: StoragePort, projectId: string, now_ms: number): Promise<void> {
  const backups = await port.listBackups(projectId);
  for (const [index, backup] of backups.entries()) if (index >= 3 || now_ms - backup.time_ms > BACKUP_RETENTION_MS) await port.deleteBackup(projectId, backup.name);
}

export type RunnerOptions = {
  /** Default: the whole chain. */
  steps?: MigrationStep[];
  now: () => number;
  newId: () => string;
  registries?: Registries;
  /** The classic media-metadata records of a project, for the v31→v32 step. */
  mediaRecordsFor?: (projectId: string) => Promise<ClassicMediaRecord[]>;
  /** Legacy per-scene timeline records of a v1-era project, by scene id. */
  legacyTimelinesFor?: (projectId: string, record: Record<string, unknown>) => Promise<Record<string, unknown[]>>;
  stickerProviderOf?: (id: string) => string | null;
  /** Only this project (the run on project load); default: every project below the current version. */
  only?: string;
  onProgress?: (progress: { id: string; name: string; index: number; total: number }) => void;
};

/**
 * The migration runner. For every project below the current version: back up the stored record, apply each step in
 * order in memory, and write the result once, atomically, under the project's id, with the migration report stored
 * beside the backup. A failure in one project leaves that project's record unchanged, marks it "Migration failed"
 * and does not stop the others. Re-running migrates only what is still below the current version.
 */
export async function runMigrations(port: StoragePort, options: RunnerOptions): Promise<MigrationOutcome[]> {
  const pending: { id: string; name: string }[] = [];
  for (const entry of await port.listProjects()) {
    if (options.only && entry.id !== options.only) continue;
    if (entry.unreadable || (entry.schemaVersion ?? 0) < CURRENT_SCHEMA_VERSION) pending.push({ id: entry.id, name: entry.name });
  }
  const outcomes: MigrationOutcome[] = [];
  for (const [index, { id, name }] of pending.entries()) {
    const text = await port.readProjectText(id);
    let from = 0, step = "read", label = name;
    migrating(port).add(id);
    try {
      const record = JSON.parse(text) as Record<string, unknown>;
      from = detectVersion(record);
      // Before v2 the name was a flat field of the record.
      if (!label && typeof record.name === "string") label = record.name;
      if (from >= CURRENT_SCHEMA_VERSION) { outcomes.push({ id, status: "current", from }); continue; }
      options.onProgress?.({ id, name: label, index: index + 1, total: pending.length });
      // The backup is the record's bytes only; media files are not duplicated.
      const space = await evaluateStorageCapacity(port, text.length, { kind: "record" });
      if (!space.allowed) { outcomes.push({ id, status: "no-space", from, message: storageString("migrationNoSpace") }); continue; }
      const context: MigrationContext = {
        now_ms: options.now(), newId: options.newId, registries: options.registries, stickerProviderOf: options.stickerProviderOf,
        mediaRecords: (await options.mediaRecordsFor?.(id)) ?? [], legacyTracksBySceneId: (await options.legacyTimelinesFor?.(id, record)) ?? {},
      };
      const result = migrateRecord(record, context, options.steps, (name) => { step = name; });
      if (result.skipped) { outcomes.push({ id, status: "skipped", from }); continue; }
      step = "write";
      for (const thumbnail of result.thumbnails) {
        const [, mime, data] = /^data:([^;,]+);base64,(.*)$/.exec(thumbnail.dataUrl) ?? [];
        if (data) await port.putBlob("thumbnail", id, `${thumbnail.owner === "project" ? "project" : thumbnail.id}.${mime === "image/png" ? "png" : "jpg"}`, fromBase64(data));
      }
      const backup = await port.putBackup(id, { sourceVersion: from, time_ms: context.now_ms, record: text, report: result.report });
      // Written once, atomically, under the project's own id in the `projects` store.
      await port.writeProjectText(id, JSON.stringify(result.record));
      await markFailure(port, id, null);
      await pruneBackups(port, id, context.now_ms);
      const dropped = droppedCount(result.report);
      const notice = dropped > 0 ? storageString("migrationDropped", { n: dropped }) : null;
      if (result.report.length > 0) await setNotice(port, id, { notice, report: result.report.length, backup: backup.name });
      outcomes.push({ id, status: "migrated", from, to: result.to, backup: backup.name, report: result.report, notice });
    } catch (error) {
      // The stored record was never touched: it is written once, after every step has succeeded.
      const message = isStorageError(error) ? `${error.kind}: ${error.message}` : error instanceof Error ? error.message : String(error);
      await markFailure(port, id, { step, error: message, time_ms: options.now() });
      outcomes.push({ id, status: "failed", from, step, error: message });
    } finally {
      migrating(port).delete(id);
    }
  }
  return outcomes;
}

const MIGRATING = new WeakMap<object, Set<string>>();
const migrating = (port: StoragePort): Set<string> => { let set = MIGRATING.get(port); if (!set) { set = new Set(); MIGRATING.set(port, set); } return set; };
/** Autosave is paused for a project while it is migrating. */
export const isMigrating = (port: StoragePort, projectId: string): boolean => MIGRATING.get(port)?.has(projectId) === true;

export type MigrationNotice = { notice: string | null; report: number; backup: string };
const NOTICES = "migration-notices";
const setNotice = async (port: StoragePort, id: string, notice: MigrationNotice | null) => {
  const all = { ...((await port.getSession<Record<string, MigrationNotice>>(NOTICES)) ?? {}) };
  if (notice) all[id] = notice; else delete all[id];
  await port.putSession(NOTICES, all);
};
/** The notice of a migration whose report is not empty, for the first open of the project; it is returned once. */
export async function takeMigrationNotice(port: StoragePort, projectId: string): Promise<MigrationNotice | undefined> {
  const notice = ((await port.getSession<Record<string, MigrationNotice>>(NOTICES)) ?? {})[projectId];
  if (notice) await setNotice(port, projectId, null);
  return notice;
}

/**
 * When the runner runs: once on the first storage access after app start, for every project below the current
 * version, and again on project load for that project (a restored backup, a record copied in meanwhile).
 */
export function createMigrationGate(port: StoragePort, options: Omit<RunnerOptions, "only">) {
  let first: Promise<MigrationOutcome[]> | null = null;
  return {
    /** Resolves when the start-up run has finished; every caller shares the one run. */
    onFirstAccess: (): Promise<MigrationOutcome[]> => (first ??= runMigrations(port, options)),
    async onProjectLoad(projectId: string): Promise<MigrationOutcome | undefined> {
      await (first ??= runMigrations(port, options));
      return (await runMigrations(port, { ...options, only: projectId }))[0];
    },
  };
}

/** "Restore backup": the project record becomes the backup again, at its old version, until the runner processes it. */
export async function restoreBackup(port: StoragePort, projectId: string, name: string): Promise<void> {
  const backup = await port.readBackup(projectId, name);
  // The record is below the current version again, which is what makes the runner migrate it on the next load.
  await port.writeProjectText(projectId, backup.record);
  await markFailure(port, projectId, null);
  await setNotice(port, projectId, null);
}
