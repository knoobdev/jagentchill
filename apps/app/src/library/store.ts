import { preference, type LibraryCategory, formatFileSize } from "@jagentchill/app-core";
import { bakeRecipe, LUT_LIMITS, LutRejected, lutIdOf, parseLut, parseRecipe } from "@jagentchill/editor-core";
import type { StoragePort } from "@jagentchill/storage";
import { STICKER_MAX_BYTES } from "../editor/assets/sticker-store";
import { sha256Hex } from "../editor/dom";
import { BUNDLED_FACES } from "../editor/fonts.gen";
import { BUILT_IN_LUTS, builtInLutId } from "../editor/inspector/luts";

/**
 * The device's library: the reusable items every project of this device can use. An imported item is one record of its
 * category's library record plus its file under `<category>/` in the library files; the fonts and LUTs the app ships
 * are listed with them and cannot be renamed or removed. Templates, preset packs and brand kits have no items yet.
 */

/** The categories that hold items in this build. */
export const ITEM_CATEGORIES = ["fonts", "luts", "sounds", "stickers"] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];
export const isItemCategory = (category: LibraryCategory): category is ItemCategory => (ITEM_CATEGORIES as readonly string[]).includes(category);

/** One imported item as its record holds it. `file` is the name of its bytes in the library files. */
export type StoredItem = { id: string; name: string; file: string; sha256: string; size: number; addedAt_ms: number; folderId?: string | null; width?: number; height?: number; animated?: boolean; format?: string; mime?: string };
export type LibraryShelf = { id: string; name: string; category: ItemCategory };
/** An item as the screen lists it: imported, or shipped with the app. */
export type LibraryItem = { id: string; category: ItemCategory; name: string; builtIn: boolean; size: number; addedAt_ms: number; folderId: string | null; stored?: StoredItem; /** Fonts: the family and how many faces it has. */ family?: string; faces?: number };

const RECORD = { luts: ["luts", "luts"], sounds: ["saved-sounds", "sounds"], stickers: ["stickers", "stickers"] } as const;
const AUDIO = /\.(mp3|wav|m4a|aac|ogg|oga|opus|flac)$/i, STICKER = /\.(png|jpe?g|webp|gif|apng|svg)$/i, LUT = /\.(cube|3dl)$/i;
/** What the Import button of the Library offers to the file picker. */
export const LIBRARY_ACCEPT = ".cube,.3dl,.png,.jpg,.jpeg,.webp,.gif,.apng,.svg,.mp3,.wav,.m4a,.aac,.ogg,.oga,.opus,.flac";
export const SOUND_MAX_BYTES = 200 * 1024 * 1024;
export const NAME_MAX = 120;

/** The category a file belongs to by its name, or `null` when the Library keeps no such file. */
export const categoryOfFile = (name: string): Exclude<ItemCategory, "fonts"> | null => (LUT.test(name) ? "luts" : AUDIO.test(name) ? "sounds" : STICKER.test(name) ? "stickers" : null);
const extensionOf = (name: string): string => name.slice(name.lastIndexOf(".") + 1).toLowerCase();
const baseName = (name: string): string => name.replace(/\.[a-z0-9]+$/i, "").slice(0, NAME_MAX) || name;

type Stored = Exclude<ItemCategory, "fonts">;
async function readStored(storage: StoragePort, category: Stored): Promise<StoredItem[]> {
  const [record, key] = RECORD[category];
  const value = await storage.readLibrary<Record<string, unknown>>(record as never).catch(() => undefined);
  const list = value?.[key];
  // A record of an older build or of another device may hold entries without a file: they are not items of this library.
  return Array.isArray(list) ? (list as Partial<StoredItem>[]).filter((entry): entry is StoredItem => typeof entry?.id === "string" && typeof entry.file === "string" && typeof entry.name === "string").map((entry) => ({ ...entry, size: Number(entry.size) || 0, addedAt_ms: Number(entry.addedAt_ms ?? (entry as { savedAt_ms?: number }).savedAt_ms) || 0 })) : [];
}
async function writeStored(storage: StoragePort, category: Stored, change: (items: StoredItem[]) => StoredItem[]): Promise<void> {
  const [record, key] = RECORD[category];
  const value = (await storage.readLibrary<Record<string, unknown>>(record as never).catch(() => undefined)) ?? {};
  const list = Array.isArray(value[key]) ? (value[key] as StoredItem[]) : [];
  // Entries this build does not list (no file) are kept as they are.
  const mine = list.filter((entry) => typeof entry?.file === "string"), others = list.filter((entry) => typeof entry?.file !== "string");
  // Saved sounds carry `savedAt_ms`, the field their record has always had.
  const next = change(mine).map((entry) => (category === "sounds" ? { ...entry, savedAt_ms: entry.addedAt_ms } : entry));
  await storage.writeLibrary(record as never, { ...value, [key]: [...others, ...next], lastModified_ms: Date.now() });
}

const FAMILIES = [...new Set(BUNDLED_FACES.map((face) => face.family))].sort((a, b) => a.localeCompare(b));
const builtIn = (category: ItemCategory): LibraryItem[] => category === "fonts" ? FAMILIES.map((family) => ({ id: `bundled:${family}`, category, name: family, builtIn: true, size: 0, addedAt_ms: 0, folderId: null, family, faces: BUNDLED_FACES.filter((face) => face.family === family).length }))
  : category === "luts" ? BUILT_IN_LUTS.map((lut) => ({ id: builtInLutId(lut.id), category, name: lut.name, builtIn: true, size: 0, addedAt_ms: 0, folderId: null }))
  : [];

/** Every item of a category: the imported ones, then what the app ships. */
export async function listItems(storage: StoragePort, category: ItemCategory): Promise<LibraryItem[]> {
  const stored = category === "fonts" ? [] : await readStored(storage, category);
  return [...stored.map((entry): LibraryItem => ({ id: entry.id, category, name: entry.name, builtIn: false, size: entry.size, addedAt_ms: entry.addedAt_ms, folderId: entry.folderId ?? null, stored: entry })), ...builtIn(category)];
}
/** How many items each category lists: the number the sidebar shows beside it. */
export async function countItems(storage: StoragePort): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const category of ITEM_CATEGORIES) counts[category] = (await listItems(storage, category)).length;
  return counts;
}
export const itemBytes = (storage: StoragePort, item: StoredItem): Promise<Uint8Array | undefined> => storage.readLibraryFile(item.file);
const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", apng: "image/apng", svg: "image/svg+xml", mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg", flac: "audio/flac", cube: "text/plain", "3dl": "text/plain" };
/** The media type of a library file, by its extension. */
export const mimeOfFile = (name: string): string => MIME[extensionOf(name)] ?? "application/octet-stream";
/** An imported item as the file it was imported from, under its current name: what a project's own import takes. `null` when its bytes are gone. */
export async function itemFile(storage: StoragePort, item: LibraryItem): Promise<File | null> {
  if (!item.stored) return null;
  const bytes = await itemBytes(storage, item.stored).catch(() => undefined);
  if (!bytes) return null;
  return new File([bytes as unknown as BlobPart], `${item.name}.${extensionOf(item.stored.file)}`, { type: item.stored.mime ?? mimeOfFile(item.stored.file) });
}

export type ImportOutcome = { added: { category: Stored; name: string }[]; existing: string[]; rejected: { name: string; reason: string; params?: Record<string, string | number> }[] };
/**
 * Keeps picked files in the library, each in the category of its type: a LUT is read first (a file that is not a table
 * is refused with the reason), a sticker and a sound are kept as they are. The same bytes are listed once.
 */
export async function importFiles(storage: StoragePort, files: readonly File[], probe: { imageSize(file: File): Promise<{ width: number; height: number } | null> }, folderId: string | null = null): Promise<ImportOutcome> {
  const outcome: ImportOutcome = { added: [], existing: [], rejected: [] };
  for (const file of files) {
    const category = categoryOfFile(file.name);
    if (!category) { outcome.rejected.push({ name: file.name, reason: "This file type cannot be kept in the Library" }); continue; }
    try {
      const limit = category === "luts" ? LUT_LIMITS.maxBytes : category === "stickers" ? STICKER_MAX_BYTES : SOUND_MAX_BYTES;
      if (file.size > limit) throw new LutRejected(category === "luts" ? "File is larger than 32 MiB" : category === "stickers" ? "Stickers can be up to 20 MB" : "Sounds can be up to 200 MB");
      const bytes = new Uint8Array(await file.arrayBuffer()), sha256 = await sha256Hex(bytes), extension = extensionOf(file.name);
      const entry: StoredItem = { id: category === "luts" ? lutIdOf(sha256) : sha256, name: baseName(file.name), file: `${category}/${sha256}.${extension}`, sha256, size: bytes.length, addedAt_ms: Date.now(), folderId, mime: file.type || undefined };
      if (category === "luts") { const parsed = parseLut(file.name, new TextDecoder().decode(bytes), bytes.length); entry.format = parsed.format; if (parsed.title) entry.name = parsed.title.slice(0, NAME_MAX); }
      if (category === "stickers") {
        const size = await probe.imageSize(file);
        if (!size) throw new LutRejected("Couldn't import this sticker");
        entry.width = size.width; entry.height = size.height; entry.animated = /\.(gif|apng)$/i.test(file.name);
      }
      if ((await readStored(storage, category)).some((other) => other.sha256 === sha256)) { outcome.existing.push(file.name); continue; }
      await storage.writeLibraryFile(entry.file, bytes);
      await writeStored(storage, category, (items) => [...items, entry]);
      outcome.added.push({ category, name: entry.name });
    } catch (error) {
      const reason = error instanceof LutRejected ? error.reason : "Couldn't import this file";
      outcome.rejected.push(reason.startsWith("Malformed line") ? { name: file.name, reason: "Malformed line {n}", params: { n: reason.replace(/\D+/g, "") } } : { name: file.name, reason });
    }
  }
  if (outcome.added.length > 0) changed();
  return outcome;
}
/** The name a rename leaves: trimmed, at most 120 characters; `null` when nothing is left. */
export const committedItemName = (draft: string): string | null => { const name = draft.trim().replace(/\s+/g, " ").slice(0, NAME_MAX); return name === "" ? null : name; };
export async function renameItem(storage: StoragePort, item: LibraryItem, name: string): Promise<void> {
  if (item.builtIn || item.category === "fonts") return;
  await writeStored(storage, item.category, (items) => items.map((entry) => (entry.id === item.id ? { ...entry, name } : entry)));
  changed();
}
export async function moveItem(storage: StoragePort, item: LibraryItem, folderId: string | null): Promise<void> {
  if (item.builtIn || item.category === "fonts") return;
  await writeStored(storage, item.category, (items) => items.map((entry) => (entry.id === item.id ? { ...entry, folderId } : entry)));
  changed();
}
export async function deleteItem(storage: StoragePort, item: LibraryItem): Promise<void> {
  if (item.builtIn || item.category === "fonts" || !item.stored) return;
  await writeStored(storage, item.category, (items) => items.filter((entry) => entry.id !== item.id));
  await storage.deleteLibraryFile(item.stored.file).catch(() => undefined);
  changed();
}

// — Folders: one level, per category —
const readFolderRecord = async (storage: StoragePort): Promise<LibraryShelf[]> => { const value = await storage.readLibrary<{ folders?: LibraryShelf[] }>("library-folders" as never).catch(() => undefined); return Array.isArray(value?.folders) ? value.folders.filter((folder) => typeof folder?.id === "string" && typeof folder.name === "string") : []; };
const writeFolderRecord = (storage: StoragePort, folders: LibraryShelf[]): Promise<void> => storage.writeLibrary("library-folders" as never, { folders, lastModified_ms: Date.now() });
export const listFolders = async (storage: StoragePort, category: ItemCategory): Promise<LibraryShelf[]> => (await readFolderRecord(storage)).filter((folder) => folder.category === category).sort((a, b) => a.name.localeCompare(b.name));
export async function createFolder(storage: StoragePort, category: ItemCategory, name: string): Promise<LibraryShelf> {
  const folder: LibraryShelf = { id: `f-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, name, category };
  await writeFolderRecord(storage, [...(await readFolderRecord(storage)), folder]);
  changed();
  return folder;
}
export async function renameFolder(storage: StoragePort, folderId: string, name: string): Promise<void> {
  await writeFolderRecord(storage, (await readFolderRecord(storage)).map((folder) => (folder.id === folderId ? { ...folder, name } : folder)));
  changed();
}
/** Removes a folder; its items go back to the category itself. */
export async function deleteFolder(storage: StoragePort, folder: LibraryShelf): Promise<void> {
  if (folder.category !== "fonts") await writeStored(storage, folder.category, (items) => items.map((entry) => (entry.folderId === folder.id ? { ...entry, folderId: null } : entry)));
  await writeFolderRecord(storage, (await readFolderRecord(storage)).filter((entry) => entry.id !== folder.id));
  changed();
}

// — Every list of the library on screen (the category, the sidebar counts, the editor's pickers) reads again after a change —
const listeners = new Set<() => void>();
export const onLibraryChange = (listener: () => void): (() => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
function changed(): void { for (const listener of [...listeners]) listener(); }

// — View preferences, per device —
export type LibrarySortKey = "name" | "added" | "size";
export type LibraryView = { view: "grid" | "list"; sortKey: LibrarySortKey; order: "asc" | "desc" };
export const LIBRARY_VIEW = preference<LibraryView>("library.view", { view: "grid", sortKey: "name", order: "asc" }, (value): value is LibraryView => {
  const view = value as LibraryView | null;
  return view !== null && typeof view === "object" && (view.view === "grid" || view.view === "list") && ["name", "added", "size"].includes(view.sortKey) && (view.order === "asc" || view.order === "desc");
});
export type SourceFilter = "imported" | "built-in";
/** The items a category shows: inside a folder or outside every folder, by source, by a case-insensitive part of the name, in the chosen order. */
export function shownItems(items: readonly LibraryItem[], options: { folderId: string | null; source: SourceFilter | null; query: string; sortKey: LibrarySortKey; order: "asc" | "desc" }): LibraryItem[] {
  const needle = options.query.trim().toLowerCase();
  // A search looks through the whole category, folders included.
  const rows = items.filter((item) => (needle !== "" || item.folderId === options.folderId) && (options.source === null || (options.source === "built-in") === item.builtIn) && (needle === "" || item.name.toLowerCase().includes(needle)));
  const sign = options.order === "asc" ? 1 : -1;
  return rows.sort((a, b) => sign * (options.sortKey === "name" ? a.name.localeCompare(b.name) : options.sortKey === "added" ? a.addedAt_ms - b.addedAt_ms : a.size - b.size) || a.name.localeCompare(b.name));
}

// — LUT previews: reference colours through the table —
const SWATCHES: [number, number, number][] = [[0.1, 0.1, 0.1], [0.35, 0.35, 0.35], [0.6, 0.6, 0.6], [0.9, 0.9, 0.9], [0.8, 0.25, 0.2], [0.9, 0.6, 0.2], [0.85, 0.8, 0.3], [0.3, 0.65, 0.3], [0.25, 0.6, 0.75], [0.25, 0.35, 0.75], [0.6, 0.35, 0.7], [0.85, 0.65, 0.55]];
const css = (rgb: readonly number[]): string => `rgb(${rgb.map((value) => Math.round(Math.min(1, Math.max(0, value)) * 255)).join(", ")})`;
/** The table of a `.cube` text as `size³` triples, red fastest. */
function cubeTable(text: string): { size: number; table: number[] } | null {
  const size = Number(/LUT_3D_SIZE\s+(\d+)/.exec(text)?.[1] ?? 0);
  if (!size) return null;
  const table: number[] = [];
  for (const line of text.split("\n")) { if (!/^[-\d.]/.test(line)) continue; for (const part of line.trim().split(/\s+/)) table.push(Number(part)); }
  return table.length === size ** 3 * 3 ? { size, table } : null;
}
const lookup = (size: number, table: ArrayLike<number>, rgb: readonly number[]): number[] => { const [r, g, b] = rgb.map((value) => Math.round(value * (size - 1))), at = (b * size * size + g * size + r) * 3; return [table[at], table[at + 1], table[at + 2]]; };
/** Twelve reference colours (a grey ramp and eight hues) as a LUT renders them, as CSS colours; `null` when the table cannot be read. */
export function lutSwatches(item: LibraryItem, bytes?: Uint8Array): string[] | null {
  if (item.builtIn) {
    const lut = BUILT_IN_LUTS.find((entry) => builtInLutId(entry.id) === item.id);
    if (!lut) return null;
    if (lut.transfer) return SWATCHES.map((rgb) => css(rgb.map(lut.transfer!)));
    const size = 9, table = bakeRecipe(parseRecipe(lut.recipe!), size);
    return SWATCHES.map((rgb) => css(lookup(size, table, rgb)));
  }
  if (!bytes || !item.stored) return null;
  try { const parsed = cubeTable(parseLut(item.stored.file, new TextDecoder().decode(bytes), bytes.length).cube); return parsed ? SWATCHES.map((rgb) => css(lookup(parsed.size, parsed.table, rgb))) : null; } catch { return null; }
}
/** "1.2 MB": the size a list row reads. */
export const sizeLabel = (bytes: number): string => formatFileSize(bytes);
