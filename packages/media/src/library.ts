import { allElements, libraryAssets } from "@jagentchill/editor-core";
import type { AssetRecord, LibraryFolder, LocalAsset, ProjectDocument } from "@jagentchill/protocol";
import { baseNameOf, type MediaType } from "./detect.ts";

/**
 * The media library as the panel reads it: which assets are listed, in which folder and order, what a search or a
 * filter keeps, how often an asset is used. Pure functions over the project document — no screen, no storage.
 */
export const MAX_FOLDER_DEPTH = 4;
export const FOLDER_NAME_MAX = 80;
export const ASSET_NAME_MAX = 200;
export const MAX_TAGS = 20;
export const TAG_MAX = 32;
export const SEARCH_DEBOUNCE_MS = 150;
export const GRID_MIN_COLUMN_PX = 112;

type Json = Record<string, unknown>;
const mediaIdsOf = (element: Json): string[] => {
  const ids: string[] = [];
  if (typeof element.mediaId === "string") ids.push(element.mediaId);
  const freeze = element.freeze as Json | undefined;
  if (freeze && typeof freeze.mediaId === "string" && freeze.mediaId !== element.mediaId) ids.push(freeze.mediaId);
  return ids;
};
/** Number of timeline elements, across all scenes, that reference each asset. Assets with no reference are absent. */
export function usageCounts(doc: ProjectDocument): Map<string, number> {
  const counts = new Map<string, number>();
  for (const ref of allElements(doc)) for (const id of mediaIdsOf(ref.element as unknown as Json)) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
}
/** "Select clips in timeline": the referencing elements of one scene and the earliest of their start times. */
export function clipsUsingAsset(doc: ProjectDocument, sceneId: string, assetId: string): { elementIds: string[]; earliestStart: number | null } {
  const elementIds: string[] = [];
  let earliestStart: number | null = null;
  for (const ref of allElements(doc)) {
    if (ref.scene.id !== sceneId || !mediaIdsOf(ref.element as unknown as Json).includes(assetId)) continue;
    elementIds.push(ref.element.id);
    if (earliestStart === null || ref.element.startTime < earliestStart) earliestStart = ref.element.startTime;
  }
  return { elementIds, earliestStart };
}
/** Ephemeral tool assets no element references any more: removed at project close. */
export function unreferencedEphemeralAssets(doc: ProjectDocument): string[] {
  const used = usageCounts(doc);
  return doc.media.assets.filter((asset) => asset.ephemeral && !used.has(asset.id)).map((asset) => asset.id);
}

// ---------------------------------------------------------------------------------------------------------- folders
export const findFolder = (doc: ProjectDocument, id: string | null): LibraryFolder | undefined => (id === null ? undefined : doc.media.folders.find((folder) => folder.id === id));
/** 1 for a top-level folder; 0 for the library root. */
export function folderLevel(doc: ProjectDocument, folderId: string | null): number {
  let level = 0;
  for (let id = folderId, guard = 0; id !== null && guard < 64; guard++) { level++; id = findFolder(doc, id)?.parentId ?? null; }
  return level;
}
/** Folder names from the root to the folder: the breadcrumb, and the path shown next to a search hit. */
export function folderPath(doc: ProjectDocument, folderId: string | null): LibraryFolder[] {
  const path: LibraryFolder[] = [];
  for (let folder = findFolder(doc, folderId), guard = 0; folder && guard < 64; folder = findFolder(doc, folder.parentId), guard++) path.unshift(folder);
  return path;
}
export const folderPathText = (doc: ProjectDocument, folderId: string | null): string => folderPath(doc, folderId).map((folder) => folder.name).join(" / ");
const subtreeHeight = (doc: ProjectDocument, folderId: string): number => 1 + Math.max(0, ...doc.media.folders.filter((folder) => folder.parentId === folderId).map((child) => subtreeHeight(doc, child.id)));
const isInside = (doc: ProjectDocument, folderId: string | null, ancestorId: string): boolean => folderPath(doc, folderId).some((folder) => folder.id === ancestorId);

export type FolderNameCheck = { ok: true; name: string } | { ok: false; reason: "empty" | "too-long" | "duplicate" };
/** Folder names are trimmed, 1–80 characters and unique among siblings (case-insensitively). */
export function checkFolderName(doc: ProjectDocument, parentId: string | null, raw: string, exceptFolderId?: string): FolderNameCheck {
  const name = raw.trim().normalize("NFC");
  if (name.length === 0) return { ok: false, reason: "empty" };
  if ([...name].length > FOLDER_NAME_MAX) return { ok: false, reason: "too-long" };
  const taken = doc.media.folders.some((folder) => folder.parentId === parentId && folder.id !== exceptFolderId && folder.name.toLowerCase() === name.toLowerCase());
  return taken ? { ok: false, reason: "duplicate" } : { ok: true, name };
}
/** "New folder" is disabled inside a level-4 folder. */
export const canCreateFolderIn = (doc: ProjectDocument, parentId: string | null): boolean => folderLevel(doc, parentId) < MAX_FOLDER_DEPTH;
/** A folder may move anywhere except into itself or its own subtree, as long as the 4-level limit holds. */
export function canMoveFolder(doc: ProjectDocument, folderId: string, targetParentId: string | null): boolean {
  if (!findFolder(doc, folderId) || folderId === targetParentId || isInside(doc, targetParentId, folderId)) return false;
  if (targetParentId !== null && !findFolder(doc, targetParentId)) return false;
  return folderLevel(doc, targetParentId) + subtreeHeight(doc, folderId) <= MAX_FOLDER_DEPTH;
}
/**
 * Folders created by a dropped directory tree: depth capped at 4, deeper files are placed in the level-4 folder.
 * `relativePath` is the path of a file inside the drop ("Trip/Day 1/a.mp4"); the result is the folder chain to use.
 */
export function folderChainForDroppedPath(relativePath: string, baseLevel = 0): string[] {
  const parts = relativePath.split(/[\\/]+/).filter(Boolean).slice(0, -1);
  return parts.slice(0, Math.max(0, MAX_FOLDER_DEPTH - baseLevel)).map((part) => [...part.trim().normalize("NFC")].slice(0, FOLDER_NAME_MAX).join("") || "Folder");
}

// ----------------------------------------------------------------------------------------------------------- search
/** Case-insensitive and diacritic-insensitive form of a text. */
export const foldText = (text: string): string => text.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[đĐ]/g, "d").replace(/ß/g, "ss").toLowerCase().normalize("NFC");
/** Search data that lives outside the asset record: transcript text (captions) and content labels (media indexing). */
export type AssetSearchData = { transcript?: string; labels?: string[]; indexing?: "indexed" | "failed" };
export function assetSearchText(doc: ProjectDocument, asset: AssetRecord, data?: AssetSearchData): string {
  const folder = findFolder(doc, asset.folderId);
  return foldText([asset.name, folder?.name ?? "", ...asset.tags, asset.provenance?.prompt ?? "", data?.transcript ?? "", ...(data?.labels ?? [])].join("\n"));
}
export const matchesSearch = (doc: ProjectDocument, asset: AssetRecord, query: string, data?: AssetSearchData): boolean => {
  const needle = foldText(query.trim());
  return needle === "" || assetSearchText(doc, asset, data).includes(needle);
};
/** An asset whose labelling failed has no labels and is marked "Not indexed" with "Retry"; the other fields still find it. */
export const indexingLabel = (data?: AssetSearchData): { text: "Not indexed"; action: "Retry" } | null => (data?.indexing === "failed" ? { text: "Not indexed", action: "Retry" } : null);

// ---------------------------------------------------------------------------------------------------------- filters
export type SourceFilter = "imported" | "recorded" | "stock" | "ai" | "connector" | "slate";
export type StatusFilter = "offline" | "has-proxy" | "cant-preview";
export const FILTER_LABELS = {
  type: { video: "Video", image: "Image", audio: "Audio" },
  usage: { used: "Used", unused: "Unused" },
  source: { imported: "Imported", recorded: "Recorded", stock: "Stock", ai: "AI-generated", connector: "Connector", slate: "Slate" },
  status: { offline: "Offline", "has-proxy": "Has proxy", "cant-preview": "Can't preview" },
} as const;
export type LibraryFilters = { types: MediaType[]; usage: "used" | "unused" | null; sources: SourceFilter[]; statuses: StatusFilter[] };
export const NO_FILTERS: LibraryFilters = { types: [], usage: null, sources: [], statuses: [] };
/** The number on the filter chip. */
export const activeFilterCount = (filters: LibraryFilters): number => filters.types.length + (filters.usage ? 1 : 0) + filters.sources.length + filters.statuses.length;

/** The source filter an asset is listed under. Bundled starter items are listed under "Stock"; URL and device imports under "Imported". */
export function sourceFilterOf(asset: AssetRecord): SourceFilter {
  if (asset.kind === "slate") return "slate";
  switch (asset.provenance?.source) {
    case "recorded": return "recorded";
    case "stock": case "bundled": return "stock";
    case "ai": return "ai";
    case "connector": return "connector";
    case "slate": return "slate";
    default: return "imported";
  }
}
/** An asset is offline when the bytes of its original are not on this device. */
export const isOffline = (local: LocalAsset | undefined): boolean => !(local?.present?.original ?? false);
/**
 * The slate "Edit in full editor" gives an empty template slot: a place for media that has no file anywhere (no bytes,
 * no content hash). There is nothing to bring back or relink, so it is never an offline FILE.
 */
export const isEmptySlot = (asset: Pick<AssetRecord, "kind" | "size" | "contentHash">): boolean => asset.kind === "slate" && !asset.contentHash && !asset.size;
/** A file of the library that this device does not have. */
export const isOfflineFile = (asset: AssetRecord, local: LocalAsset | undefined): boolean => isOffline(local) && !isEmptySlot(asset);
export const hasProxy = (local: LocalAsset | undefined): boolean => local?.proxy?.state === "succeeded";
export const cannotPreview = (local: LocalAsset | undefined): boolean => local?.canDecode === false && !hasProxy(local);
export function statusesOf(local: LocalAsset | undefined, asset?: AssetRecord): StatusFilter[] {
  return [...(isOffline(local) && !(asset && isEmptySlot(asset)) ? ["offline" as const] : []), ...(hasProxy(local) ? ["has-proxy" as const] : []), ...(cannotPreview(local) ? ["cant-preview" as const] : [])];
}
export function matchesFilters(asset: AssetRecord, filters: LibraryFilters, context: { used: boolean; local?: LocalAsset }): boolean {
  if (filters.types.length > 0 && !filters.types.includes(asset.type)) return false;
  if (filters.usage === "used" && !context.used) return false;
  if (filters.usage === "unused" && context.used) return false;
  if (filters.sources.length > 0 && !filters.sources.includes(sourceFilterOf(asset))) return false;
  if (filters.statuses.length > 0) {
    const statuses = statusesOf(context.local, asset);
    if (!filters.statuses.some((status) => statuses.includes(status))) return false;
  }
  return true;
}
/**
 * Unused assets offered for clean-up. A slate is left out while the script it was rendered for is still linked to
 * the project, even when no clip uses it.
 */
export function cleanupSuggestions(doc: ProjectDocument): AssetRecord[] {
  const used = usageCounts(doc);
  const linked = new Set(((doc as unknown as { scriptLinks?: { scriptId?: string }[] }).scriptLinks ?? []).map((link) => link.scriptId));
  return libraryAssets(doc).filter((asset) => !used.has(asset.id) && !(asset.kind === "slate" && linked.has(asset.provenance?.scriptId)));
}

// ------------------------------------------------------------------------------------------------------------- sort
export type SortKey = "name" | "type" | "duration" | "size" | "created";
export type SortState = { key: SortKey; direction: "asc" | "desc" };
export const SORT_LABELS: Record<SortKey, string> = { name: "Name", type: "Type", duration: "Duration", size: "File size", created: "Date added" };
export const DEFAULT_SORT: SortState = { key: "name", direction: "asc" };
/** Choosing the active key flips the direction; a new key starts ascending. */
export const chooseSort = (current: SortState, key: SortKey): SortState => (current.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: "asc" });
const byName = (a: string, b: string): number => a.localeCompare(b, "en", { numeric: true, sensitivity: "base" }) || (a < b ? -1 : a > b ? 1 : 0);
export function sortAssets<T extends AssetRecord>(assets: T[], sort: SortState): T[] {
  const value = (asset: AssetRecord): number => (sort.key === "duration" ? asset.duration ?? 0 : sort.key === "size" ? asset.size : asset.created_ms);
  const compare = (a: AssetRecord, b: AssetRecord): number => {
    const primary = sort.key === "name" ? byName(a.name, b.name) : sort.key === "type" ? byName(a.type, b.type) : value(a) - value(b);
    return (sort.direction === "asc" ? primary : -primary) || byName(a.name, b.name) || byName(a.id, b.id);
  };
  return [...assets].sort(compare);
}
export const sortFolders = (folders: LibraryFolder[], sort: SortState): LibraryFolder[] =>
  [...folders].sort((a, b) => (sort.key === "name" && sort.direction === "desc" ? byName(b.name, a.name) : byName(a.name, b.name)));

// ------------------------------------------------------------------------------------------------------ preferences
export type LibraryViewMode = "grid" | "list";
export type LibraryPreferences = { view: LibraryViewMode; sort: SortState };
export const DEFAULT_LIBRARY_PREFERENCES: LibraryPreferences = { view: "grid", sort: DEFAULT_SORT };
export const LIBRARY_PREFERENCES_KEY = "media-library.view";
/** Reads the persisted UI preference; anything unreadable falls back to grid, Name ascending. */
export function readLibraryPreferences(stored: unknown): LibraryPreferences {
  const value = (stored ?? {}) as { view?: unknown; sort?: { key?: unknown; direction?: unknown } };
  const key = (Object.keys(SORT_LABELS) as SortKey[]).find((candidate) => candidate === value.sort?.key);
  return { view: value.view === "list" ? "list" : "grid", sort: key ? { key, direction: value.sort?.direction === "desc" ? "desc" : "asc" } : DEFAULT_SORT };
}

// ------------------------------------------------------------------------------------------------------------- list
export type LibraryView = { folderId: string | null; query: string; filters: LibraryFilters; sort: SortState };
export type LibraryRow = { asset: AssetRecord; usage: number; /** Shown for search hits, which span all folders. */ folderPath: string | null; statuses: StatusFilter[] };
export type LibraryListing = {
  breadcrumb: LibraryFolder[];
  /** Always listed first; none while searching. */
  folders: LibraryFolder[];
  rows: LibraryRow[];
  /** "No media found" with "Clear search". */
  noResults: boolean;
  /** The library holds no listed asset and no folder: the drop zone is the panel content. */
  empty: boolean;
};
export function listLibrary(doc: ProjectDocument, view: LibraryView, context: { searchData?: Record<string, AssetSearchData | undefined> } = {}): LibraryListing {
  const listed = libraryAssets(doc), used = usageCounts(doc), locals = (doc as unknown as { local?: { media?: Record<string, LocalAsset> } }).local?.media ?? {};
  const searching = view.query.trim() !== "", filtering = activeFilterCount(view.filters) > 0;
  const kept = listed.filter((asset) =>
    (searching || filtering || asset.folderId === view.folderId || (view.folderId === null && !findFolder(doc, asset.folderId))) &&
    matchesSearch(doc, asset, view.query, context.searchData?.[asset.id]) &&
    matchesFilters(asset, view.filters, { used: used.has(asset.id), local: locals[asset.id] }));
  const rows = sortAssets(kept, view.sort).map((asset) => ({
    asset, usage: used.get(asset.id) ?? 0, statuses: statusesOf(locals[asset.id], asset),
    folderPath: searching || filtering ? folderPathText(doc, asset.folderId) : null,
  }));
  const folders = searching || filtering ? [] : sortFolders(doc.media.folders.filter((folder) => folder.parentId === view.folderId), view.sort);
  return { breadcrumb: folderPath(doc, view.folderId), folders, rows, noResults: (searching || filtering) && rows.length === 0, empty: listed.length === 0 && doc.media.folders.length === 0 };
}

// ------------------------------------------------------------------------------------------------------------ names
/**
 * The card label: a name longer than 22 characters is shown as its first 16 characters, "…" and the last 3 characters
 * before the extension. The full name stays in the tooltip and the accessible name. [PORT M-027]
 */
export function cardLabel(name: string): string {
  const characters = [...name];
  if (characters.length <= 22) return name;
  const base = [...baseNameOf(name)];
  return `${characters.slice(0, 16).join("")}…${base.slice(-3).join("")}`;
}
/** Display name: trimmed, 1–200 characters. `null`: empty input, the rename reverts. */
export function checkAssetName(raw: string): string | null {
  const name = raw.trim().normalize("NFC");
  return name.length === 0 ? null : [...name].slice(0, ASSET_NAME_MAX).join("");
}
export type TagCheck = { ok: true; tags: string[] } | { ok: false; reason: "limit" | "empty" | "too-long" | "duplicate"; message?: "Up to 20 tags" };
/** Tags: up to 20, each 1–32 characters, unique. */
export function addTag(tags: string[], raw: string): TagCheck {
  const tag = raw.trim().normalize("NFC");
  if (tags.length >= MAX_TAGS) return { ok: false, reason: "limit", message: "Up to 20 tags" };
  if (tag.length === 0) return { ok: false, reason: "empty" };
  if ([...tag].length > TAG_MAX) return { ok: false, reason: "too-long" };
  if (tags.some((existing) => existing.toLowerCase() === tag.toLowerCase())) return { ok: false, reason: "duplicate" };
  return { ok: true, tags: [...tags, tag] };
}

// -------------------------------------------------------------------------------------------------------- selection
export type LibrarySelection = { ids: string[]; anchor: string | null };
export const EMPTY_SELECTION: LibrarySelection = { ids: [], anchor: null };
/** Multi-selection over the displayed order. [PORT M-018] */
export const selection = {
  /** Click selects one. */
  click: (_: LibrarySelection, id: string): LibrarySelection => ({ ids: [id], anchor: id }),
  /** Ctrl/Cmd-click toggles; Space toggles the focused asset. */
  toggle: (current: LibrarySelection, id: string): LibrarySelection => ({ ids: current.ids.includes(id) ? current.ids.filter((entry) => entry !== id) : [...current.ids, id], anchor: id }),
  /** Shift-click selects the range from the anchor in displayed order. */
  range(current: LibrarySelection, id: string, displayed: string[]): LibrarySelection {
    const from = displayed.indexOf(current.anchor ?? id), to = displayed.indexOf(id);
    if (to < 0) return current;
    const start = from < 0 ? to : Math.min(from, to), end = from < 0 ? to : Math.max(from, to);
    return { ids: displayed.slice(start, end + 1), anchor: current.anchor ?? id };
  },
  /** A marquee selects the intersecting items; additive with Shift/Ctrl/Cmd. */
  marquee: (current: LibrarySelection, hit: string[], additive: boolean): LibrarySelection => ({ ids: additive ? [...current.ids, ...hit.filter((id) => !current.ids.includes(id))] : hit, anchor: hit[0] ?? current.anchor }),
  all: (displayed: string[]): LibrarySelection => ({ ids: [...displayed], anchor: displayed[0] ?? null }),
  clear: (): LibrarySelection => EMPTY_SELECTION,
  /** Ids that left the listing (removed, filtered out) drop out of the selection. */
  prune: (current: LibrarySelection, displayed: string[]): LibrarySelection => ({ ids: current.ids.filter((id) => displayed.includes(id)), anchor: current.anchor && displayed.includes(current.anchor) ? current.anchor : null }),
};
/** Rectangles that a marquee touches. */
export function marqueeHits(marquee: { x: number; y: number; width: number; height: number }, items: { id: string; x: number; y: number; width: number; height: number }[]): string[] {
  const left = Math.min(marquee.x, marquee.x + marquee.width), right = Math.max(marquee.x, marquee.x + marquee.width);
  const top = Math.min(marquee.y, marquee.y + marquee.height), bottom = Math.max(marquee.y, marquee.y + marquee.height);
  return items.filter((item) => item.x < right && item.x + item.width > left && item.y < bottom && item.y + item.height > top).map((item) => item.id);
}
/** The assets an action on `clicked` targets: the whole selection when the clicked item is in it, else the item alone. */
export const actionTargets = (current: LibrarySelection, clicked: string): string[] => (current.ids.includes(clicked) ? current.ids : [clicked]);
/** Assets "+" inserts: all selected assets in displayed order when the pressed one is selected, else that one. */
export const addTargets = (current: LibrarySelection, pressed: string, displayed: string[]): string[] =>
  current.ids.includes(pressed) ? displayed.filter((id) => current.ids.includes(id)) : [pressed];

// ----------------------------------------------------------------------------------------------------------- reveal
export const REVEAL_HIGHLIGHT_MS = 2000;
export type RevealResult =
  | { found: true; view: LibraryView; selection: LibrarySelection; highlight: { assetId: string; until_ms: number }; scrollTo: string }
  | { found: false; toast: "Media not found in this project" };
/**
 * `reveal-media {assetId}`: open the asset's folder, clear the search and the filters that would hide it, select it
 * as the only library selection and highlight it for 2 s. An asset that is gone changes nothing. [PORT M-023]
 */
export function revealAsset(doc: ProjectDocument, view: LibraryView, assetId: string, now_ms: number): RevealResult {
  const asset = libraryAssets(doc).find((entry) => entry.id === assetId);
  if (!asset) return { found: false, toast: "Media not found in this project" };
  const local = (doc as unknown as { local?: { media?: Record<string, LocalAsset> } }).local?.media?.[assetId];
  const keepsFilters = matchesFilters(asset, view.filters, { used: usageCounts(doc).has(assetId), local });
  return {
    found: true, scrollTo: assetId, selection: { ids: [assetId], anchor: assetId }, highlight: { assetId, until_ms: now_ms + REVEAL_HIGHLIGHT_MS },
    view: { ...view, folderId: findFolder(doc, asset.folderId) ? asset.folderId : null, query: "", filters: keepsFilters ? view.filters : NO_FILTERS },
  };
}

// ---------------------------------------------------------------------------------------------------- info and misc
/** The fields the Info panel shows for an asset; absent ones are omitted (an image has no frame rate, duration or audio). */
export function infoFields(asset: AssetRecord, extra: { sampleRate?: number; channels?: number } = {}): string[] {
  const fields = ["name", "type", "container"];
  if (asset.type !== "audio") fields.push("resolution");
  if (asset.type === "video") fields.push("codecs", "frameRate", "duration");
  if (asset.type === "audio") fields.push("codecs", "duration");
  if (asset.type === "audio" || (asset.type === "video" && asset.hasAudio !== false)) { if (extra.sampleRate) fields.push("sampleRate"); if (extra.channels) fields.push("channels"); }
  return [...fields, "fileSize", "dateAdded", "storage", "proxy", "usage", "contentHash", "tags", "provenance"].filter((field) => !(asset.type !== "video" && field === "proxy"));
}
/** First 12 characters of the content hash, as the Info panel shows it. */
export const shortHash = (contentHash: string | null): string => (contentHash ?? "").slice(0, 12);
/** Credits list of a project: every asset whose licence requires attribution. */
export function creditsList(doc: ProjectDocument): { assetId: string; title: string; author: string; licence: string; licenceUrl?: string; sourceUrl?: string }[] {
  return doc.media.assets.filter((asset) => asset.provenance?.attributionRequired).map((asset) => ({
    assetId: asset.id, title: asset.name, author: asset.provenance.author ?? "", licence: asset.provenance.licence ?? "", licenceUrl: asset.provenance.licenceUrl, sourceUrl: asset.provenance.sourceUrl,
  }));
}
