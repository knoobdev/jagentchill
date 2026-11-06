import { validateProjectDocument, type Registries } from "@jagentchill/editor-core";
import type { ProjectDocument } from "@jagentchill/protocol";
import { splitRecord, systemClock, withLocalSection, type Clock, type SaveStatus } from "./autosave.ts";
import { StorageError } from "./errors.ts";
import type { Snapshot, SnapshotInfo, StoragePort } from "./port.ts";
import { evaluateStorageCapacity } from "./quota.ts";
import type { SnapshotInterval } from "./preferences.ts";
import { storageString, type StorageLocale } from "./strings.ts";

/** Up to this many manual snapshots per project; creating one more requires deleting one. */
export const MANUAL_SNAPSHOT_LIMIT = 50;
export const SNAPSHOT_LABEL_MAX = 80;
export const DEFAULT_AUTOMATIC_SNAPSHOTS = 20;

export type SnapshotSettings = { interval: SnapshotInterval; keepAutomatic: number };
/** Who may write a synced project: restoring one requires the edit lease. */
export type LeaseState = { held: boolean; holder?: string };
/** A named version kept by the host, created on this or another device. */
export type RemoteVersion = { id: string; label: string; created_ms: number; device: string };
export type VersionEntry = (SnapshotInfo & { source: "local" }) | (RemoteVersion & { source: "host"; kind: "manual" });

export type SnapshotManagerOptions = {
  port: StoragePort;
  projectId: string;
  newId: () => string;
  clock?: Clock;
  locale?: StorageLocale;
  registries?: Registries;
  settings: () => SnapshotSettings;
  /** The save manager of the open project: flushed before a snapshot, and the source of "storage is full". */
  autosave?: { flush(): Promise<void>; readonly status: SaveStatus };
  /** A synced project: "Save version" also creates a host named version, and Restore needs the edit lease. */
  sync?: { lease(): LeaseState; createNamedVersion(label: string): Promise<void>; listNamedVersions?(): Promise<RemoteVersion[]>; recordRestore?(snapshotId: string): Promise<void> };
};

const assetIdsOf = (recordText: string): string[] => {
  try { return (((JSON.parse(recordText) as { media?: { assets?: { id?: unknown }[] } }).media?.assets ?? []).map((asset) => asset.id).filter((id): id is string => typeof id === "string")); } catch { return []; }
};
/** The asset ids that the project record or any retained snapshot of the project references. */
export async function referencedAssetIds(port: StoragePort, projectId: string): Promise<Set<string>> {
  const ids = new Set<string>();
  if (await port.hasProject(projectId)) for (const id of assetIdsOf(await port.readProjectText(projectId))) ids.add(id);
  for (const info of await port.listSnapshots(projectId)) for (const id of assetIdsOf((await port.readSnapshot(projectId, info.id)).record)) ids.add(id);
  return ids;
}
/** A media file younger than this is never taken for an orphan: its asset record may not have been saved yet. */
export const ORPHAN_MIN_AGE_MS = 24 * 3_600_000;
/**
 * Removes the media of a project that neither its record nor any retained snapshot references any more. Media that a
 * retained snapshot references is not purged while that snapshot exists, so a restore finds its bytes. With `only`
 * (assets the user just removed, after the record was saved) the named assets go at once; otherwise only files older
 * than 24 hours go, because a file is written before its asset record.
 */
export async function purgeUnreferencedMedia(port: StoragePort, projectId: string, options: { now: number; only?: string[] }): Promise<string[]> {
  const referenced = await referencedAssetIds(port, projectId), removed: string[] = [];
  for (const file of (await port.listMediaFiles()).filter((entry) => entry.projectId === projectId)) {
    if (referenced.has(file.assetId)) continue;
    if (options.only ? !options.only.includes(file.assetId) : options.now - file.modified_ms <= ORPHAN_MIN_AGE_MS) continue;
    await port.discardMediaFile(projectId, file.assetId);
    removed.push(file.assetId);
  }
  return removed;
}

/**
 * Version snapshots of one project's record (media bytes are referenced, not copied): automatic ones on open, at the
 * interval and on Exit project, and manual ones through "Save version".
 */
export function createSnapshotManager(options: SnapshotManagerOptions) {
  const { port, projectId } = options, clock = options.clock ?? systemClock;
  let timer: unknown = null, lastSnapshot_ms = 0, running = false;
  const suspended = () => options.autosave?.status.snapshotsSuspended === true;
  const latest = async (): Promise<Snapshot | undefined> => { const [info] = await port.listSnapshots(projectId); return info ? port.readSnapshot(projectId, info.id) : undefined; };
  const canonicalOf = (recordText: string) => splitRecord(recordText).canonical;

  async function prune(): Promise<void> {
    const keep = Math.min(200, Math.max(10, options.settings().keepAutomatic || DEFAULT_AUTOMATIC_SNAPSHOTS));
    const automatic = (await port.listSnapshots(projectId)).filter((info) => info.kind === "automatic");
    for (const info of automatic.slice(keep)) await port.deleteSnapshot(projectId, info.id);
    if (automatic.length > keep) await purgeUnreferencedMedia(port, projectId, { now: clock.now() });
  }
  async function take(kind: "automatic" | "manual", label: string, onlyWhenChanged: boolean): Promise<SnapshotInfo | null> {
    const record = await port.readProjectText(projectId);
    if (onlyWhenChanged) { const previous = await latest(); if (previous && canonicalOf(previous.record) === canonicalOf(record)) return null; }
    // A snapshot is the canonical document: device-local state is not part of it.
    const canonical = canonicalOf(record), parsed = JSON.parse(canonical) as { metadata?: { duration?: number }; schemaVersion?: number };
    const space = await evaluateStorageCapacity(port, canonical.length, { kind: "record", evictCache: (needed) => port.cache.evict(needed) });
    if (!space.allowed) throw new StorageError("QuotaExceeded", "not enough storage for a snapshot", { required: space.required, available: space.available });
    const created_ms = Math.max(clock.now(), lastSnapshot_ms + 1);
    const info: SnapshotInfo = { id: options.newId(), kind, created_ms, label, duration: parsed.metadata?.duration ?? 0, schemaVersion: parsed.schemaVersion ?? null };
    await port.putSnapshot(projectId, { ...info, record: canonical });
    lastSnapshot_ms = created_ms;
    if (kind === "automatic") await prune();
    return info;
  }
  const automatic = async (): Promise<SnapshotInfo | null> => {
    if (suspended() || running) return null;
    running = true;
    try { return await take("automatic", "", true); } finally { running = false; }
  };
  const schedule = () => {
    if (timer !== null) { clock.clearTimeout(timer); timer = null; }
    const interval = options.settings().interval;
    if (interval === "off") return;
    timer = clock.setTimeout(() => {
      timer = null;
      // One at the interval while the project has been saved since the last snapshot.
      const saved = options.autosave?.status.lastSaved_ms ?? null;
      const due = saved === null ? Promise.resolve(null) : saved > lastSnapshot_ms ? automatic() : Promise.resolve(null);
      void due.catch(() => null).then(schedule);
    }, interval * 60_000);
  };

  return {
    /** The project was opened: one automatic snapshot when it has changed since its last snapshot; the interval starts. */
    async open(): Promise<SnapshotInfo | null> {
      const [info] = await port.listSnapshots(projectId);
      lastSnapshot_ms = info?.created_ms ?? 0;
      const taken = await automatic();
      schedule();
      return taken;
    },
    /** The interval preference changed. */
    settingsChanged: schedule,
    /** Exit project: the pending save is flushed and one automatic snapshot is taken. */
    async exit(): Promise<SnapshotInfo | null> {
      if (timer !== null) { clock.clearTimeout(timer); timer = null; }
      if (suspended()) return null;
      await options.autosave?.flush();
      return automatic();
    },
    /** "Save version": a manual snapshot with a label of 0–80 characters; a synced project also gets a host named version. */
    async saveVersion(label = ""): Promise<SnapshotInfo> {
      const trimmed = label.trim();
      if ([...trimmed].length > SNAPSHOT_LABEL_MAX) throw new RangeError(`a version label has at most ${SNAPSHOT_LABEL_MAX} characters`);
      const manual = (await port.listSnapshots(projectId)).filter((info) => info.kind === "manual");
      if (manual.length >= MANUAL_SNAPSHOT_LIMIT) throw new StorageError("Unavailable", storageString("manualSnapshotLimit", { max: MANUAL_SNAPSHOT_LIMIT }, options.locale), { reason: "manual-snapshot-limit" });
      await options.autosave?.flush();
      const info = (await take("manual", trimmed, false))!;
      if (options.sync) await options.sync.createNamedVersion(trimmed);
      return info;
    },
    /** The registry action `project.save-version` ("Save now"): flushes autosave and creates a manual snapshot. */
    saveNow(): Promise<SnapshotInfo> { return this.saveVersion(""); },
    /** The one "Version history" list: local snapshots, and for a synced project the host's named versions with their device. */
    async history(): Promise<VersionEntry[]> {
      const local: VersionEntry[] = (await port.listSnapshots(projectId)).map((info) => ({ ...info, source: "local" as const }));
      const remote: VersionEntry[] = ((await options.sync?.listNamedVersions?.()) ?? []).map((version) => ({ ...version, source: "host" as const, kind: "manual" as const }));
      return [...local, ...remote].sort((a, b) => b.created_ms - a.created_ms);
    },
    /** Preview: the snapshot's document, opened read-only. Nothing is written. */
    async preview(snapshotId: string): Promise<{ document: ProjectDocument; readOnly: true }> {
      const snapshot = await port.readSnapshot(projectId, snapshotId);
      const result = validateProjectDocument(JSON.parse(snapshot.record), { mode: "load", registries: options.registries });
      if (!result.document) throw new StorageError("Corrupt", `snapshot "${snapshotId}" cannot be read`, { errors: result.errors });
      return { document: result.document, readOnly: true };
    },
    /** Whether Restore is available, and — when another device holds the edit lease — the tooltip naming it. */
    restoreAvailability(): { enabled: boolean; tooltip: string | null } {
      const lease = options.sync?.lease();
      return lease && !lease.held ? { enabled: false, tooltip: storageString("restoreNeedsLease", { device: lease.holder ?? "" }, options.locale) } : { enabled: true, tooltip: null };
    },
    /**
     * Restore: first an automatic snapshot of the current state, then the project record is replaced. The caller
     * reloads the editor with an empty undo history. Assets missing from the current library come back with the
     * record, and their bytes are still there because a retained snapshot referenced them.
     */
    async restore(snapshotId: string): Promise<{ document: ProjectDocument; safety: SnapshotInfo | null }> {
      const availability = this.restoreAvailability();
      if (!availability.enabled) throw new StorageError("Unavailable", availability.tooltip ?? "", { reason: "edit-lease" });
      const snapshot = await port.readSnapshot(projectId, snapshotId);
      const checked = validateProjectDocument(JSON.parse(snapshot.record), { mode: "load", registries: options.registries });
      if (!checked.document) throw new StorageError("Corrupt", `snapshot "${snapshotId}" cannot be restored`, { errors: checked.errors });
      await options.autosave?.flush();
      const current = await port.readProjectText(projectId);
      const safety = await take("automatic", "", true);
      // The device-local section (folder, view state, per-device media state) stays this device's own.
      await port.writeProjectText(projectId, withLocalSection(snapshot.record, splitRecord(current).local));
      await options.sync?.recordRestore?.(snapshotId);
      const local = splitRecord(current).local;
      return { document: (local === undefined ? checked.document : { ...checked.document, local }) as ProjectDocument, safety };
    },
    /** "Duplicate as new project": a new record from the snapshot; the media bytes are shared by content hash. */
    async duplicateAsNewProject(snapshotId: string, target: { id: string; name: string }): Promise<string> {
      const snapshot = await port.readSnapshot(projectId, snapshotId);
      const record = JSON.parse(snapshot.record) as { metadata: Record<string, unknown>; media?: { assets?: { id: string; contentHash?: string }[] } };
      const now = clock.now();
      record.metadata = { ...record.metadata, id: target.id, name: target.name, created_ms: now, updated_ms: now };
      for (const asset of record.media?.assets ?? []) {
        const source = await port.mediaInfo(projectId, asset.id);
        if (source) await port.writeMediaStream(target.id, asset.id, port.readMediaStream(projectId, asset.id), { contentHash: source.contentHash, extension: source.extension });
      }
      await port.writeProjectText(target.id, withLocalSection(JSON.stringify(record), undefined));
      return target.id;
    },
    async rename(snapshotId: string, label: string): Promise<void> {
      const trimmed = label.trim();
      if ([...trimmed].length > SNAPSHOT_LABEL_MAX) throw new RangeError(`a version label has at most ${SNAPSHOT_LABEL_MAX} characters`);
      await port.putSnapshot(projectId, { ...(await port.readSnapshot(projectId, snapshotId)), label: trimmed });
    },
    async delete(snapshotId: string): Promise<void> {
      await port.deleteSnapshot(projectId, snapshotId);
      await purgeUnreferencedMedia(port, projectId, { now: clock.now() });
    },
    stop(): void { if (timer !== null) { clock.clearTimeout(timer); timer = null; } },
  };
}
export type SnapshotManager = ReturnType<typeof createSnapshotManager>;
