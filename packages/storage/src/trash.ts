import { splitRecord, withLocalSection } from "./autosave.ts";
import type { DocumentKind, StoragePort } from "./port.ts";

/** A trashed item is deleted for good this long after `deleted_ms` (30 days). */
export const TRASH_RETENTION_MS = 2_592_000_000;
export type ClientTrashKind = "project" | "template" | "script";
export type TrashState = { kind: ClientTrashKind; deleted_ms: number; originalFolderId?: string };
export type TrashEntry = { kind: ClientTrashKind; id: string; name: string; deleted_ms: number; expires_ms: number; bytes: number; originalFolderId?: string };

const isTrash = (value: unknown): value is TrashState => value !== null && typeof value === "object" && typeof (value as TrashState).deleted_ms === "number";
const recordBytes = (value: unknown): number => JSON.stringify(value)?.length ?? 0;

/** Everything a project stores on this device: its record, media, thumbnails, cover, snapshots and backups. */
export async function projectBytes(port: StoragePort, projectId: string): Promise<{ record: number; media: number; thumbnails: number; snapshots: number; total: number }> {
  const record = (await port.readProjectText(projectId).catch(() => "")).length;
  let media = 0, thumbnails = 0, snapshots = 0;
  for (const file of await port.listProjectFiles(projectId)) if (file.path.startsWith("media/")) media += file.size; else thumbnails += file.size;
  for (const info of await port.listSnapshots(projectId)) snapshots += (await port.readSnapshot(projectId, info.id)).record.length;
  for (const info of await port.listBackups(projectId)) snapshots += info.bytes;
  return { record, media, thumbnails, snapshots, total: record + media + thumbnails + snapshots };
}

/**
 * Moves a project to the trash: its record, media, snapshots and cover stay intact and only the device-local
 * `local.trash` changes — no canonical document changes and no patch is emitted. Its caches are released at once.
 */
export async function trashProject(port: StoragePort, projectId: string, now_ms: number): Promise<TrashState> {
  const text = await port.readProjectText(projectId), local = (splitRecord(text).local ?? {}) as Record<string, unknown>;
  const state: TrashState = { kind: "project", deleted_ms: now_ms, ...(typeof local.folderId === "string" ? { originalFolderId: local.folderId } : {}) };
  await port.writeProjectText(projectId, withLocalSection(text, { ...local, trash: state }));
  await port.cache.releaseProject(projectId);
  return state;
}
/** Restores a trashed project to the folder it came from. */
export async function restoreProject(port: StoragePort, projectId: string): Promise<void> {
  const text = await port.readProjectText(projectId), local = (splitRecord(text).local ?? {}) as Record<string, unknown>;
  const state = isTrash(local.trash) ? local.trash : null;
  await port.writeProjectText(projectId, withLocalSection(text, { ...local, trash: null, folderId: state?.originalFolderId ?? local.folderId ?? null }));
}

type Trashable = Record<string, unknown> & { trash?: TrashState | null };
/** A script or a user template carries its trash state in the `trash` field of its own record. */
export async function trashDocument(port: StoragePort, kind: "script" | "template", id: string, now_ms: number): Promise<TrashState> {
  const record = await port.getDocument<Trashable>(kind, id);
  if (!record) throw new Error(`${kind} "${id}" does not exist`);
  const state: TrashState = { kind, deleted_ms: now_ms, ...(typeof record.folderId === "string" ? { originalFolderId: record.folderId } : {}) };
  await port.putDocument(kind, id, { ...record, trash: state });
  return state;
}
export async function restoreDocument(port: StoragePort, kind: "script" | "template", id: string): Promise<void> {
  const record = await port.getDocument<Trashable>(kind, id);
  if (record) await port.putDocument(kind, id, { ...record, trash: null });
}

/** The trashed items of the client-side kinds, oldest deletion first. Host-side kinds are listed by the server. */
export async function listTrash(port: StoragePort): Promise<TrashEntry[]> {
  const entries: TrashEntry[] = [];
  for (const project of await port.listProjects()) {
    if (!isTrash(project.trash)) continue;
    entries.push({ kind: "project", id: project.id, name: project.name, deleted_ms: project.trash.deleted_ms, expires_ms: project.trash.deleted_ms + TRASH_RETENTION_MS, bytes: (await projectBytes(port, project.id)).total, ...(project.trash.originalFolderId ? { originalFolderId: project.trash.originalFolderId } : {}) });
  }
  for (const kind of ["script", "template"] as const) {
    for (const id of await port.listDocuments(kind)) {
      const record = await port.getDocument<Trashable & { title?: string; name?: string }>(kind, id);
      if (!record || !isTrash(record.trash)) continue;
      let bytes = recordBytes(record);
      if (kind === "template") for (const file of await port.listLibraryFiles(`templates/${id}`)) bytes += file.size;
      entries.push({ kind, id, name: String(record.title ?? record.name ?? ""), deleted_ms: record.trash.deleted_ms, expires_ms: record.trash.deleted_ms + TRASH_RETENTION_MS, bytes });
    }
  }
  return entries.sort((a, b) => a.deleted_ms - b.deleted_ms);
}
export const trashBytes = async (port: StoragePort): Promise<number> => (await listTrash(port)).reduce((sum, entry) => sum + entry.bytes, 0);

/** The full, permanent deletion of one trashed item. */
export async function deleteTrashed(port: StoragePort, entry: Pick<TrashEntry, "kind" | "id">): Promise<void> {
  if (entry.kind === "project") await port.deleteProject(entry.id);
  else await port.deleteDocument(entry.kind as DocumentKind, entry.id);
}
/** Deletes for good every trashed item whose 30 days have passed. */
export async function expireTrash(port: StoragePort, now_ms: number): Promise<TrashEntry[]> {
  const expired = (await listTrash(port)).filter((entry) => now_ms >= entry.expires_ms);
  for (const entry of expired) await deleteTrashed(port, entry);
  return expired;
}
/** "Empty trash": resolves to the bytes it freed. */
export async function emptyTrash(port: StoragePort): Promise<number> {
  let freed = 0;
  for (const entry of await listTrash(port)) { await deleteTrashed(port, entry); freed += entry.bytes; }
  return freed;
}
