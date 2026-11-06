import { canonicalize, validateProjectDocument, type Registries, type Repair, type ValidationResult } from "@jagentchill/editor-core";
import { PROJECT_SCHEMA_VERSION, type ProjectDocument } from "@jagentchill/protocol";
import { StorageError } from "./errors.ts";
import type { StoragePort } from "./port.ts";
import { storageString, type StorageLocale } from "./strings.ts";

/** The schema this build writes. One constant for the whole storage package. */
export const CURRENT_SCHEMA_VERSION = PROJECT_SCHEMA_VERSION;

/**
 * The version of a stored record: `schemaVersion` when present; else the classic numeric `version`; else 1 when a
 * non-empty `scenes` array exists; else 0.
 */
export function detectVersion(record: Record<string, unknown>): number {
  if (typeof record.schemaVersion === "number" && Number.isInteger(record.schemaVersion)) return record.schemaVersion;
  if (typeof record.version === "number" && Number.isFinite(record.version)) return record.version;
  return Array.isArray(record.scenes) && record.scenes.length > 0 ? 1 : 0;
}

export type Openability = "current" | "needs-migration" | "newer-compatible" | "needs-newer-app";
/**
 * How this build treats a record: one below the current schema is migrated first; one above it opens read-write as
 * long as its minimum reader is not above this build; otherwise it is listed "Needs newer app" and never modified.
 */
export function openability(record: Record<string, unknown>, current = CURRENT_SCHEMA_VERSION): Openability {
  const version = detectVersion(record);
  if (version < current) return "needs-migration";
  const minimum = typeof record.minReaderSchemaVersion === "number" ? record.minReaderSchemaVersion : version;
  if (minimum > current) return "needs-newer-app";
  return version > current ? "newer-compatible" : "current";
}
/** The badge of a project card this build cannot open. */
export const NEEDS_NEWER_APP = storageString("needsNewerApp");

/** Keys that only ever hold runtime data (decoded buffers, object URLs, file handles, selection, undo history, preview layer). */
const RUNTIME_KEYS = new Set(["buffer", "file", "objectUrl", "previewElements", "selection", "history"]);
/**
 * The text of a stored project record: the canonical document plus its device-local `local` section, and nothing
 * else. Runtime-only data is never persisted; thumbnails and covers are never embedded as data URLs.
 */
export function serializeProjectRecord(document: ProjectDocument): string {
  const strip = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(strip);
    if (value === null || typeof value !== "object") return typeof value === "function" || typeof value === "symbol" ? undefined : value;
    // Anything that is not a plain object (an AudioBuffer, a File, a Map) is runtime data.
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return undefined;
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (RUNTIME_KEYS.has(key)) continue;
      const kept = strip(entry);
      if (kept !== undefined && !(typeof kept === "string" && kept.startsWith("data:image/"))) out[key] = kept;
    }
    return out;
  };
  const { local, ...canonical } = strip(document) as Record<string, unknown>;
  // The canonical part is written in canonical form, so equal documents are equal bytes; `local` follows it.
  const text = canonicalize(canonical);
  return local === undefined ? text : `${text.slice(0, -1)},"local":${JSON.stringify(local)}}`;
}

export type LoadedProject = {
  document: ProjectDocument;
  /** What load-time repair changed in memory. The stored record is untouched until the next edit. */
  repairs: Repair[];
  /** "{n} items were repaired or skipped while loading". */
  notice: string | null;
  /** Opened without write access: the record needs a newer app. */
  readOnly: boolean;
  unknownFields: string[];
  warnings: ValidationResult["warnings"];
};
/** The notice of a repaired load: "{n} items were repaired or skipped while loading", exactly as the requirement words it. */
export const repairNotice = (count: number, locale: StorageLocale = "en"): string | null => (count === 0 ? null : storageString("repairNotice", { n: count }, locale));

/**
 * Loads a project at the current schema: the record is validated in `load` mode, which repairs what it can in memory.
 * A record that cannot be repaired fails the load and is not modified. A record below the current schema is not
 * loaded here: it goes through the migration runner first.
 */
export async function loadProject(port: StoragePort, id: string, options: { registries?: Registries } = {}): Promise<LoadedProject> {
  const record = await port.readProject(id);
  const state = openability(record);
  if (state === "needs-migration") throw new StorageError("Corrupt", `project "${id}" is at version ${detectVersion(record)} and has not been migrated`, { reason: "needs-migration" });
  if (state === "needs-newer-app") throw new StorageError("Unavailable", NEEDS_NEWER_APP, { reason: "needs-newer-app" });
  const result = validateProjectDocument(record, { mode: "load", registries: options.registries });
  if (!result.ok || !result.document) throw new StorageError("Corrupt", `project "${id}" cannot be loaded`, { errors: result.errors });
  return { document: result.document, repairs: result.repairs ?? [], notice: repairNotice(result.repairs?.length ?? 0), readOnly: result.readOnly, unknownFields: result.unknownFields, warnings: result.warnings };
}

/** Writes the record of a document. The caller (the save manager) has already validated the change that produced it. */
export async function saveProject(port: StoragePort, document: ProjectDocument): Promise<string> {
  const text = serializeProjectRecord(document);
  await port.writeProjectText(document.metadata.id, text);
  return text;
}

export type SavedSound = { id: string; savedAt_ms: number; [key: string]: unknown };
/** Saved sounds are global: one record for the device, shared by every project. */
export async function saveSound(port: StoragePort, sound: SavedSound, now_ms: number): Promise<SavedSound[]> {
  const current = (await port.readLibrary<{ sounds: SavedSound[]; lastModified_ms: number }>("saved-sounds")) ?? { sounds: [], lastModified_ms: 0 };
  const sounds = current.sounds.some((entry) => entry.id === sound.id) ? current.sounds : [...current.sounds, sound];
  await port.writeLibrary("saved-sounds", { sounds, lastModified_ms: now_ms });
  return sounds;
}
export const savedSounds = async (port: StoragePort): Promise<SavedSound[]> => (await port.readLibrary<{ sounds: SavedSound[] }>("saved-sounds"))?.sounds ?? [];

/**
 * Saves a media asset: the file first, the asset record (saved with the project record) second. When either step
 * fails the file is removed and no asset record remains; a store quota error surfaces as `QuotaExceeded`.
 */
export async function saveMediaAsset(port: StoragePort, projectId: string, assetId: string, bytes: Uint8Array, saveRecord: (stored: { contentHash: string; size: number }) => Promise<void>, options: { contentHash?: string; extension?: string } = {}): Promise<{ contentHash: string; size: number }> {
  const stored = await port.writeMedia(projectId, assetId, bytes, options);
  try {
    await saveRecord(stored);
  } catch (error) {
    await port.removeMedia(projectId, assetId).catch(() => undefined);
    throw error;
  }
  return stored;
}

/** `saveMediaAsset` from pieces: the file is streamed and hashed while it is written, the asset record follows, and a failure of either removes the file. */
export async function saveMediaAssetStream(port: StoragePort, projectId: string, assetId: string, source: AsyncIterable<Uint8Array> | Iterable<Uint8Array>, saveRecord: (stored: { contentHash: string; size: number }) => Promise<void>, options: { contentHash?: string; extension?: string } = {}): Promise<{ contentHash: string; size: number }> {
  const stored = await port.writeMediaStream(projectId, assetId, source, options);
  try {
    await saveRecord(stored);
  } catch (error) {
    await port.removeMedia(projectId, assetId).catch(() => undefined);
    throw error;
  }
  return stored;
}
