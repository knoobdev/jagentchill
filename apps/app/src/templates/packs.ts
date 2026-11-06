import { FX_PREFS, preference, type Preference } from "@jagentchill/app-core";
import { template, uuidV4 } from "@jagentchill/editor-core";
import { FILE_FORMATS, openPackage, PackageError, writePackage, type PackageSink, type ZipSource } from "@jagentchill/storage";
import { SAVED_TEXT_PRESETS } from "../editor/assets/text-store";
import { INSPECTOR_PREFS } from "../editor/inspector/prefs";
import { getPref, setPref } from "../state";

/**
 * Preset packs: the presets the user saved in the editor's own libraries — text presets, effect and filter presets,
 * transition presets, colour adjustment presets — exchanged as a `.jcpack` file. An imported preset lives in the same
 * library as a saved one, marked with its pack, so the editor lists and applies it where it lists the user's own.
 */
const PACK_FORMAT = "jagentchill-pack";
const LIBRARIES: Record<template.PackKind, Preference<template.PackPreset[]>> = {
  "text-preset": SAVED_TEXT_PRESETS as unknown as Preference<template.PackPreset[]>,
  "effect-preset": FX_PREFS.effectPresets as unknown as Preference<template.PackPreset[]>,
  "transition-preset": FX_PREFS.transitionPresets as unknown as Preference<template.PackPreset[]>,
  "adjustment-preset": INSPECTOR_PREFS.adjustmentPresets as unknown as Preference<template.PackPreset[]>,
};
export const PACK_KIND_LABEL: Record<template.PackKind, string> = { "text-preset": "Text presets", "effect-preset": "Effect and filter presets", "transition-preset": "Transition presets", "adjustment-preset": "Adjustment presets" };
const isPacks = (value: unknown): value is template.InstalledPack[] => Array.isArray(value) && value.every((entry) => entry !== null && typeof entry === "object" && typeof (entry as template.InstalledPack).id === "string" && typeof (entry as template.InstalledPack).name === "string");
/** The packs imported on this device. */
export const INSTALLED_PACKS = preference<template.InstalledPack[]>("library.packs", [], isPacks);

export type OwnPreset = { kind: template.PackKind; key: string; preset: template.PackPreset };
const keyOf = (kind: template.PackKind, preset: template.PackPreset): string => `${kind}:${typeof preset.id === "string" ? preset.id : preset.name}`;
/** The presets the user saved themselves: what "Export as pack" offers. A preset that came from a pack is not the user's to export. */
export function ownPresets(): OwnPreset[] {
  return template.PACK_KINDS.flatMap((kind) => getPref(LIBRARIES[kind]).filter((preset) => typeof preset.pack !== "string").map((preset) => ({ kind, key: keyOf(kind, preset), preset })));
}
export const packFileName = (name: string): string => `${name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim().slice(0, 100) || "presets"}${FILE_FORMATS.pack.extension}`;

/** "Export as pack": the chosen presets as one `.jcpack` — `manifest.json` and one JSON file per preset. */
export async function exportPack(chosen: readonly OwnPreset[], name: string, sink: PackageSink): Promise<template.PackManifest> {
  let built;
  try {
    const presets: Partial<Record<template.PackKind, template.PackPreset[]>> = {};
    for (const entry of chosen) (presets[entry.kind] ??= []).push(entry.preset);
    built = template.buildPack(presets, { id: uuidV4(), name });
  } catch (error) { await sink.abort().catch(() => undefined); throw error; }
  await writePackage(sink, { format: PACK_FORMAT, formatVersion: FILE_FORMATS.pack.formatVersion, ...built.manifest }, built.files.map((file) => ({ path: file.path, data: new TextEncoder().encode(file.text) })));
  return built.manifest;
}

export type PackImport = { pack: template.InstalledPack; imported: number; replaced: boolean; refused: template.PackRefusal[] };
/**
 * Imports a `.jcpack`. The archive and its manifest are checked first; then every item is read — an item of an
 * unknown kind, a file that is code and a preset its library would not accept are refused and named — and only then
 * are the libraries written, so a pack that cannot be read changes nothing.
 */
export async function importPack(source: ZipSource): Promise<PackImport> {
  const opened = await openPackage(source, { format: PACK_FORMAT, formatVersion: FILE_FORMATS.pack.formatVersion }).catch((error: unknown) => {
    if (error instanceof PackageError && /unsafe entry/.test(error.message)) throw new PackageError("invalid", "Package contains unsafe paths");
    throw error;
  });
  let manifest;
  try { manifest = template.readPackManifest(opened.manifest); } catch (error) { throw new PackageError("invalid", error instanceof template.PackInvalid ? error.reason : "the pack manifest is not valid"); }
  const entries = (opened.manifest.entries as { path: string }[]).map((entry) => entry.path);
  const read = await template.readPackItems(manifest, entries, async (file) => (opened.has(file) ? opened.text(file) : undefined));
  const refused = [...read.refused], counts: Partial<Record<template.PackKind, number>> = {};
  const accepted: Partial<Record<template.PackKind, template.PackPreset[]>> = {};
  for (const kind of template.PACK_KINDS) {
    // A preset is kept only when its library would read it back: one bad preset must not cost the user the whole library.
    accepted[kind] = read.presets[kind].filter((preset) => { const ok = LIBRARIES[kind].validate([preset]); if (!ok) refused.push({ name: preset.name, reason: "invalid" }); return ok; });
    if (accepted[kind]!.length > 0) counts[kind] = accepted[kind]!.length;
  }
  const imported = Object.values(counts).reduce((sum, count) => sum + (count ?? 0), 0);
  if (imported === 0) throw new PackageError("invalid", "The pack holds no preset this version can use");
  const installed = getPref(INSTALLED_PACKS), replaced = installed.some((entry) => entry.id === manifest.id);
  for (const kind of template.PACK_KINDS) if (accepted[kind]!.length > 0 || replaced) setPref(LIBRARIES[kind], template.mergePackPresets(getPref(LIBRARIES[kind]), accepted[kind]!, manifest, () => uuidV4()));
  const pack: template.InstalledPack = { id: manifest.id, name: manifest.name, author: manifest.author, license: manifest.license, itemCount: imported, counts, addedAt_ms: Date.now() };
  setPref(INSTALLED_PACKS, [...installed.filter((entry) => entry.id !== manifest.id), pack]);
  return { pack, imported, replaced, refused };
}
/** "Remove pack": the pack's presets leave the libraries. Projects keep what they applied. */
export function removePack(packId: string): void {
  for (const kind of template.PACK_KINDS) { const current = getPref(LIBRARIES[kind]), next = template.withoutPack(current, packId); if (next.length !== current.length) setPref(LIBRARIES[kind], next); }
  setPref(INSTALLED_PACKS, getPref(INSTALLED_PACKS).filter((entry) => entry.id !== packId));
}
