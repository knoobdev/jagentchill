import { compareNames, FOLDER_NAME_MAX, normalizeName } from "./logic.ts";

/** A node of the project-folder tree, the library-wide record `folders` of the client store. */
export type ProjectFolder = { id: string; name: string; parentId: string | null; created_ms: number };
export const FOLDER_DEPTH_MAX = 4;

export const folderById = (folders: readonly ProjectFolder[], id: string | null): ProjectFolder | undefined => (id === null ? undefined : folders.find((folder) => folder.id === id));
/** The path from the root to a folder, the folder itself last. A folder whose parent is gone hangs from the root. */
export function folderPath(folders: readonly ProjectFolder[], id: string | null): ProjectFolder[] {
  const path: ProjectFolder[] = [];
  for (let current = folderById(folders, id); current && !path.includes(current); current = folderById(folders, current.parentId)) path.unshift(current);
  return path;
}
/** 0 for the root, 1 for a top-level folder. */
export const folderDepth = (folders: readonly ProjectFolder[], id: string | null): number => folderPath(folders, id).length;
/** "New folder" inside `parentId`: refused inside a level-4 folder. */
export const canCreateFolderIn = (folders: readonly ProjectFolder[], parentId: string | null): boolean => folderDepth(folders, parentId) < FOLDER_DEPTH_MAX;
export const childFolders = (folders: readonly ProjectFolder[], parentId: string | null, locale = "en"): ProjectFolder[] =>
  folders.filter((folder) => folder.parentId === parentId).sort((a, b) => compareNames(a.name, b.name, locale));
/** A folder and every folder below it. */
export function folderSubtree(folders: readonly ProjectFolder[], id: string): string[] {
  const ids = [id];
  for (let index = 0; index < ids.length; index++) for (const folder of folders) if (folder.parentId === ids[index] && !ids.includes(folder.id)) ids.push(folder.id);
  return ids;
}
/** How many levels a folder holds below itself, itself included. */
const subtreeHeight = (folders: readonly ProjectFolder[], id: string): number =>
  1 + Math.max(0, ...folders.filter((folder) => folder.parentId === id).map((folder) => subtreeHeight(folders, folder.id)));

export type FolderNameResult = { ok: true; name: string } | { ok: false; reason: "empty" | "duplicate" };
/** A folder name: trimmed, 1–80 characters, unique among its siblings without regard to case. */
export function validateFolderName(folders: readonly ProjectFolder[], parentId: string | null, text: string, ignoreId?: string): FolderNameResult {
  const name = normalizeName(text, FOLDER_NAME_MAX);
  if (name === null) return { ok: false, reason: "empty" };
  const clash = folders.some((folder) => folder.parentId === parentId && folder.id !== ignoreId && folder.name.toLocaleLowerCase() === name.toLocaleLowerCase());
  return clash ? { ok: false, reason: "duplicate" } : { ok: true, name };
}
export type MoveRefusal = "self" | "descendant" | "depth" | "duplicate" | null;
/** Why a folder cannot be moved under `targetId`: into itself, into its own subtree, past the fourth level, or onto a sibling of the same name. */
export function folderMoveRefusal(folders: readonly ProjectFolder[], id: string, targetId: string | null): MoveRefusal {
  const folder = folderById(folders, id);
  if (!folder) return "self";
  if (targetId === id) return "self";
  if (targetId !== null && folderSubtree(folders, id).includes(targetId)) return "descendant";
  if (folderDepth(folders, targetId) + subtreeHeight(folders, id) > FOLDER_DEPTH_MAX) return "depth";
  if (folder.parentId !== targetId && !validateFolderName(folders, targetId, folder.name, id).ok) return "duplicate";
  return null;
}
/** Projects in a folder and all its subfolders; trashed projects are never counted. */
export function countProjectsIn(folders: readonly ProjectFolder[], projects: readonly { folderId: string | null; trash: unknown | null }[], id: string): number {
  const inside = new Set(folderSubtree(folders, id));
  return projects.filter((project) => project.trash === null && project.folderId !== null && inside.has(project.folderId)).length;
}
/** The folder a project is shown in: its own, or the root when that folder no longer exists. */
export const effectiveFolder = (folders: readonly ProjectFolder[], folderId: string | null): string | null => (folderById(folders, folderId) ? folderId : null);

// ── Trash ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const TRASH_KINDS = ["project", "template", "script", "workflow-run", "film", "film-panel-asset"] as const;
export type TrashKind = (typeof TRASH_KINDS)[number];
/** Kinds stored on this device; the others live on the host and are listed only while it is connected. */
export const CLIENT_TRASH_KINDS: readonly TrashKind[] = ["project", "template", "script"];
export type TrashEntry = { kind: TrashKind; id: string; name: string; deleted_ms: number; originalLocation: string | null };
export const TRASH_RETENTION_MS = 2_592_000_000;
export const TRASH_RETENTION_DAYS = 30;
/** Expiry is evaluated at app start and every 6 hours while the app runs. */
export const TRASH_EVALUATION_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const isExpired = (deleted_ms: number, now_ms: number): boolean => now_ms - deleted_ms >= TRASH_RETENTION_MS;
export const daysRemaining = (deleted_ms: number, now_ms: number): number => Math.max(0, Math.ceil((deleted_ms + TRASH_RETENTION_MS - now_ms) / 86_400_000));
/** The kinds present in the trash, in the fixed order of the filter chips. */
export const kindsPresent = (entries: readonly TrashEntry[]): TrashKind[] => TRASH_KINDS.filter((kind) => entries.some((entry) => entry.kind === kind));
