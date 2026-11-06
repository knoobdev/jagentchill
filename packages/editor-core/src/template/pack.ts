/**
 * A preset pack: named presets of the editor's own libraries, exchanged as one `.jcpack` file. A pack holds parameters
 * only — an item is a JSON file — and never code or shader source.
 */
export const PACK_PACKAGE_VERSION = 1;
/** The kinds this build keeps presets of. A pack item of another kind is refused and named in the import summary. */
export const PACK_KINDS = ["text-preset", "effect-preset", "transition-preset", "adjustment-preset"] as const;
export type PackKind = (typeof PACK_KINDS)[number];
export const PACK_LIMITS = { name: 80, items: 2000, itemBytes: 1024 * 1024 } as const;
export type PackItem = { kind: PackKind; id: string; name: string; file: string };
export type PackManifest = { id: string; name: string; author: string; license: string; packageVersion: 1; appVersionMin: string; items: PackItem[] };
/** A preset as a pack carries it: the stored preset of its library, whatever its fields. Some libraries know a preset by its name alone. */
export type PackPreset = { id?: string; name: string; [key: string]: unknown };
export type PackContent = { manifest: PackManifest; presets: Record<PackKind, PackPreset[]> };
/** An imported pack as the Library lists it. */
export type InstalledPack = { id: string; name: string; author: string; license: string; itemCount: number; counts: Partial<Record<PackKind, number>>; addedAt_ms: number };

const CODE = /\.(js|mjs|cjs|ts|tsx|jsx|wasm|sh|bat|cmd|ps1|py|rb|pl|php|html?|glsl|frag|vert|wgsl|hlsl|metal|fx|shader|exe|dll|so|dylib|app|jar)$/i;
/** A file a pack may never bring in: script, executable or shader source. */
export const isCodeFile = (name: string): boolean => CODE.test(name);
export const isPackKind = (kind: unknown): kind is PackKind => (PACK_KINDS as readonly unknown[]).includes(kind);
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
export class PackInvalid extends Error { reason: string; constructor(reason: string) { super(reason); this.name = "PackInvalid"; this.reason = reason; } }

/** The pack manifest of chosen presets: one JSON file per item under `items/<kind>/`. */
export function buildPack(presets: Partial<Record<PackKind, readonly PackPreset[]>>, env: { id: string; name: string; author?: string; license?: string; appVersion?: string }): { manifest: PackManifest; files: { path: string; text: string }[] } {
  const name = env.name.trim().replace(/\s+/g, " ").slice(0, PACK_LIMITS.name);
  if (name === "") throw new PackInvalid("Give the pack a name");
  const items: PackItem[] = [], files: { path: string; text: string }[] = [];
  for (const kind of PACK_KINDS) (presets[kind] ?? []).forEach((preset, index) => {
    // The pack an item came from is a fact of the device that imported it, not of the preset.
    const { pack: _pack, packName: _packName, ...own } = preset;
    const file = `items/${kind}/${index + 1}.json`;
    items.push({ kind, id: typeof preset.id === "string" ? preset.id : preset.name, name: preset.name, file });
    files.push({ path: file, text: JSON.stringify(own) });
  });
  if (items.length === 0) throw new PackInvalid("Choose at least one preset");
  if (items.length > PACK_LIMITS.items) throw new PackInvalid("A pack holds up to 2 000 presets");
  return { manifest: { id: env.id, name, author: (env.author ?? "").slice(0, 200), license: (env.license ?? "").slice(0, 200), packageVersion: PACK_PACKAGE_VERSION, appVersionMin: env.appVersion ?? "0.0.0", items }, files };
}

/** The manifest of a pack file; `PackInvalid` when it is not one. Items are checked one by one by `readPackItems`. */
export function readPackManifest(value: unknown): Omit<PackManifest, "items"> & { items: unknown[] } {
  if (!isObject(value) || typeof value.id !== "string" || value.id === "" || typeof value.name !== "string" || value.name.trim() === "" || !Array.isArray(value.items)) throw new PackInvalid("the pack manifest is not valid");
  if (typeof value.packageVersion === "number" && value.packageVersion > PACK_PACKAGE_VERSION) throw new PackInvalid("This pack was made with a newer version of the app");
  return { id: value.id, name: value.name.trim().slice(0, PACK_LIMITS.name), author: typeof value.author === "string" ? value.author.slice(0, 200) : "", license: typeof value.license === "string" ? value.license.slice(0, 200) : "", packageVersion: PACK_PACKAGE_VERSION, appVersionMin: typeof value.appVersionMin === "string" ? value.appVersionMin : "0.0.0", items: value.items };
}

export type PackRefusal = { name: string; reason: "unknown-kind" | "code" | "invalid" };
/**
 * The presets of a pack and what was refused: an item of an unknown kind, an item whose file is code, an item that
 * is not a preset. `read` returns the text of a file of the package, or `undefined` when it has none. Every file of
 * the package that is code is refused too, listed or not.
 */
export async function readPackItems(manifest: { items: unknown[] }, entries: readonly string[], read: (file: string) => Promise<string | undefined>): Promise<{ presets: Record<PackKind, PackPreset[]>; refused: PackRefusal[] }> {
  const presets: Record<PackKind, PackPreset[]> = { "text-preset": [], "effect-preset": [], "transition-preset": [], "adjustment-preset": [] };
  const refused: PackRefusal[] = [], listed = new Set<string>();
  for (const raw of manifest.items) {
    const item = isObject(raw) ? raw : {};
    const name = typeof item.name === "string" && item.name !== "" ? item.name : typeof item.file === "string" ? item.file : "?";
    if (typeof item.file === "string") listed.add(item.file);
    if (!isPackKind(item.kind)) { refused.push({ name, reason: "unknown-kind" }); continue; }
    if (typeof item.file !== "string" || isCodeFile(item.file)) { refused.push({ name, reason: "code" }); continue; }
    let value: unknown;
    try { const text = await read(item.file); value = text === undefined || text.length > PACK_LIMITS.itemBytes ? undefined : JSON.parse(text); } catch { value = undefined; }
    if (!isObject(value) || typeof value.name !== "string" || value.name === "") { refused.push({ name, reason: "invalid" }); continue; }
    presets[item.kind].push(value as PackPreset);
  }
  for (const entry of entries) if (!listed.has(entry) && isCodeFile(entry)) refused.push({ name: entry, reason: "code" });
  return { presets, refused };
}

/**
 * A library after a pack was imported: the pack's presets are added, each marked with the pack. A preset whose id is
 * taken by a preset of another origin gets a fresh id, and one whose name is taken is named after the pack too; an
 * earlier import of the same pack is replaced.
 */
export function mergePackPresets<T extends PackPreset>(existing: readonly T[], incoming: readonly PackPreset[], pack: { id: string; name: string }, newId: () => string): T[] {
  const kept = existing.filter((preset) => preset.pack !== pack.id);
  const ids = new Set(kept.map((preset) => preset.id)), names = new Set(kept.map((preset) => preset.name));
  return [...kept, ...incoming.map((preset) => {
    const name = names.has(preset.name) ? `${preset.name} (${pack.name})` : preset.name;
    names.add(name);
    return { ...preset, ...(typeof preset.id === "string" ? { id: ids.has(preset.id) ? newId() : preset.id } : {}), name, pack: pack.id, packName: pack.name } as unknown as T;
  })];
}
/** "Remove pack": the library without the pack's presets. Projects keep what they applied. */
export const withoutPack = <T extends PackPreset>(existing: readonly T[], packId: string): T[] => existing.filter((preset) => preset.pack !== packId);
