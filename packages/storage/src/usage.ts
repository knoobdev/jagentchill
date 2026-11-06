import { CACHE_CATEGORIES } from "./cache.ts";
import type { StoragePort } from "./port.ts";
import { projectBytes } from "./trash.ts";

/** The rows of the storage page, in its order. */
export const USAGE_CATEGORIES = ["Projects", "Media", "Scripts", "Proxies", "Thumbnails and filmstrips", "Waveforms", "Render cache", "AI results", "Snapshots and backups", "Trash", "Caches"] as const;
export type UsageCategory = (typeof USAGE_CATEGORIES)[number];
export type StorageUsage = { total: number; byCategory: Record<UsageCategory, number>; byProject: Record<string, number> };

const size = (value: unknown): number => JSON.stringify(value)?.length ?? 0;
/**
 * Storage usage by category and per project. A trashed item counts under "Trash", backups and snapshots under
 * "Snapshots and backups", scripts under "Scripts" and the workflow cache under "Caches".
 */
export async function storageUsage(port: StoragePort): Promise<StorageUsage> {
  const byCategory = Object.fromEntries(USAGE_CATEGORIES.map((category) => [category, 0])) as Record<UsageCategory, number>;
  const byProject: Record<string, number> = {};
  for (const project of await port.listProjects()) {
    const bytes = await projectBytes(port, project.id);
    byProject[project.id] = bytes.total;
    if (project.trash) { byCategory.Trash += bytes.total; continue; }
    byCategory.Projects += bytes.record;
    byCategory.Media += bytes.media;
    byCategory["Thumbnails and filmstrips"] += bytes.thumbnails;
    byCategory["Snapshots and backups"] += bytes.snapshots;
  }
  for (const kind of ["script", "template"] as const) {
    for (const id of await port.listDocuments(kind)) {
      const record = await port.getDocument<{ trash?: unknown }>(kind, id);
      const bytes = size(record);
      if (record?.trash) byCategory.Trash += bytes; else if (kind === "script") byCategory.Scripts += bytes; else byCategory.Projects += bytes;
    }
  }
  for (const id of await port.listDocuments("workflow")) byCategory.Caches += size(await peekWorkflow(port, id));
  const cache = await port.cache.usage();
  for (const category of CACHE_CATEGORIES) byCategory[category] += cache.byCategory[category];
  for (const [projectId, bytes] of Object.entries(cache.byProject)) byProject[projectId] = (byProject[projectId] ?? 0) + bytes;
  return { total: Object.values(byCategory).reduce((sum, bytes) => sum + bytes, 0), byCategory, byProject };
}
/** Reading a cached workflow for its size must not make it the most recently opened one. */
const peekWorkflow = async (port: StoragePort, id: string): Promise<unknown> => port.peekDocument("workflow", id);
