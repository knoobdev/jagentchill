import type { Registries } from "@jagentchill/editor-core";
import { splitRecord, withLocalSection, type SaveStatus } from "./autosave.ts";
import { isStorageError } from "./errors.ts";
import type { StoragePort } from "./port.ts";
import { loadProject, type LoadedProject } from "./records.ts";
import { ORPHAN_MIN_AGE_MS, referencedAssetIds } from "./snapshots.ts";
import { storageString, type StorageLocale } from "./strings.ts";

/** Written when a project opens; `clean` becomes true on Exit project and on an orderly app shutdown. */
export type SessionMarker = {
  projectId: string; opened_ms: number; clean: boolean;
  /** The save state at the last change of it, so that a crash while saving was failing can say what was lost. */
  saveState?: "ok" | "failed" | "storage-full";
  lastSaved_ms?: number | null;
};
const MARKER = "session-marker";

export const readSessionMarker = (port: StoragePort): Promise<SessionMarker | undefined> => port.getSession<SessionMarker>(MARKER);
export const markProjectOpened = (port: StoragePort, projectId: string, now_ms: number): Promise<void> => port.putSession(MARKER, { projectId, opened_ms: now_ms, clean: false, saveState: "ok", lastSaved_ms: null } satisfies SessionMarker);
/** Exit project, or an orderly app shutdown. */
export async function markSessionClean(port: StoragePort): Promise<void> {
  const marker = await readSessionMarker(port);
  if (marker && !marker.clean) await port.putSession(MARKER, { ...marker, clean: true });
}
/** Keeps the marker's save state current. Best effort: when the store is full the marker simply keeps its last state. */
export async function recordSaveState(port: StoragePort, status: Pick<SaveStatus, "state" | "lastSaved_ms">): Promise<void> {
  const marker = await readSessionMarker(port);
  if (!marker || marker.clean) return;
  const saveState = status.state === "storage-full" ? "storage-full" : status.state === "failed" ? "failed" : "ok";
  if (marker.saveState === saveState && marker.lastSaved_ms === status.lastSaved_ms) return;
  await port.putSession(MARKER, { ...marker, saveState, lastSaved_ms: status.lastSaved_ms }).catch(() => undefined);
}

export type CrashPrompt = {
  projectId: string; name: string;
  /** "JAgentChill closed unexpectedly — Reopen '{name}'" */
  text: string;
  /** Set when saving was failing at the time of the crash: "Changes after {time} were not saved". */
  detail: string | null;
  lastSaved_ms: number | null;
  actions: { id: "reopen" | "dismiss"; label: string }[];
};
const clockTime = (time_ms: number): string => { const date = new Date(time_ms); return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`; };
/** On app start: the prompt of the Projects screen when the last session did not end cleanly, else `null`. */
export async function crashPrompt(port: StoragePort, options: { locale?: StorageLocale; formatTime?: (time_ms: number) => string } = {}): Promise<CrashPrompt | null> {
  const marker = await readSessionMarker(port);
  if (!marker || marker.clean || !(await port.hasProject(marker.projectId))) return null;
  const name = (await port.listProjects()).find((entry) => entry.id === marker.projectId)?.name ?? "";
  const lost = marker.saveState === "failed" || marker.saveState === "storage-full";
  const lastSaved = marker.lastSaved_ms ?? null;
  return {
    projectId: marker.projectId, name, lastSaved_ms: lastSaved,
    text: storageString("closedUnexpectedly", { name }, options.locale),
    detail: lost && lastSaved !== null ? storageString("changesAfterNotSaved", { time: (options.formatTime ?? clockTime)(lastSaved) }, options.locale) : null,
    actions: [{ id: "reopen", label: storageString("reopen", {}, options.locale) }, { id: "dismiss", label: storageString("dismiss", {}, options.locale) }],
  };
}
/** "Dismiss". */
export const dismissCrashPrompt = markSessionClean;

export type RestoreOffer = { kind: "snapshot" | "backup"; id: string; time_ms: number; text: string };
export type ReopenResult = { status: "opened"; project: LoadedProject } | { status: "unreadable"; reason: string; offer: RestoreOffer | null };
/**
 * "Reopen": loads the last autosaved record. A record that cannot be read or fails validation is never opened;
 * the most recent snapshot or migration backup is offered instead ("Restore latest version from {time}").
 * No undo history is recovered.
 */
export async function reopenAfterCrash(port: StoragePort, projectId: string, options: { registries?: Registries; locale?: StorageLocale; formatTime?: (time_ms: number) => string } = {}): Promise<ReopenResult> {
  try {
    return { status: "opened", project: await loadProject(port, projectId, options) };
  } catch (error) {
    // A record below the current schema is the runner's business, not a damaged record.
    if (isStorageError(error) && (error.details?.reason === "needs-migration" || error.details?.reason === "needs-newer-app")) throw error;
    const [snapshot] = await port.listSnapshots(projectId), [backup] = await port.listBackups(projectId);
    const pick: RestoreOffer | null = snapshot && (!backup || snapshot.created_ms >= backup.time_ms)
      ? { kind: "snapshot", id: snapshot.id, time_ms: snapshot.created_ms, text: "" }
      : backup ? { kind: "backup", id: backup.name, time_ms: backup.time_ms, text: "" } : null;
    if (pick) pick.text = storageString("restoreLatestVersion", { time: (options.formatTime ?? clockTime)(pick.time_ms) }, options.locale);
    return { status: "unreadable", reason: error instanceof Error ? error.message : String(error), offer: pick };
  }
}
/**
 * Confirms the offer: the project record becomes the snapshot (or the backup, which the migration runner then
 * processes like any record below the current schema).
 */
export async function restoreOffered(port: StoragePort, projectId: string, offer: RestoreOffer): Promise<void> {
  let local: unknown;
  try { local = splitRecord(await port.readProjectText(projectId)).local; } catch { local = undefined; }
  if (offer.kind === "snapshot") await port.writeProjectText(projectId, withLocalSection((await port.readSnapshot(projectId, offer.id)).record, local));
  else await port.writeProjectText(projectId, (await port.readBackup(projectId, offer.id)).record);
}

/**
 * At start: deletes media files that no asset record of any project's `media.assets` — nor any retained snapshot —
 * references and that are older than 24 hours. An interrupted recording or import leaves no orphan file.
 */
export async function removeOrphanMedia(port: StoragePort, now_ms: number): Promise<{ projectId: string; assetId: string }[]> {
  const referenced = new Map<string, Set<string>>(), removed: { projectId: string; assetId: string }[] = [];
  for (const file of await port.listMediaFiles()) {
    if (now_ms - file.modified_ms <= ORPHAN_MIN_AGE_MS) continue;
    let ids = referenced.get(file.projectId);
    if (!ids) { ids = await referencedAssetIds(port, file.projectId); referenced.set(file.projectId, ids); }
    if (ids.has(file.assetId)) continue;
    await port.discardMediaFile(file.projectId, file.assetId);
    removed.push({ projectId: file.projectId, assetId: file.assetId });
  }
  return removed;
}
