import { useEffect, useState } from "react";
import { template } from "@jagentchill/editor-core";
import type { StoragePort } from "@jagentchill/storage";
import { sha256Hex } from "../editor/dom";
import { useDevice } from "../state";

/**
 * The brand kit of this device: one library record (`brand-kits`), its logos as library files under `brand/`, like
 * imported stickers. Every screen that shows the kit reads it again after a change.
 */
type BrandRecord = { kits?: unknown[]; lastModified_ms?: number };
export const LOGO_ACCEPT = ".png,.jpg,.jpeg,.webp,.svg";
export const LOGO_MAX_BYTES = 20 * 1024 * 1024;
const listeners = new Set<() => void>();
export const onBrandChange = (listener: () => void): (() => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
let cached: template.BrandKit | null = null;

export async function loadBrandKit(storage: StoragePort): Promise<template.BrandKit> {
  const record = await storage.readLibrary<BrandRecord>("brand-kits").catch(() => undefined);
  cached = template.readBrandKit(Array.isArray(record?.kits) ? record.kits[0] : undefined);
  return cached;
}
async function store(storage: StoragePort, kit: template.BrandKit): Promise<void> {
  await storage.writeLibrary("brand-kits", { kits: [kit], lastModified_ms: kit.updated_ms });
  cached = kit;
  for (const listener of [...listeners]) listener();
}
/** One change of the kit, stored. A refusal (`BrandRefused`) changes nothing. */
export async function changeBrand(storage: StoragePort, change: template.BrandChange): Promise<template.BrandKit> {
  const next = template.changeBrandKit(await loadBrandKit(storage), change, Date.now());
  await store(storage, next);
  return next;
}
/** Keeps a picked image as a logo of the kit. The same picture is kept once. */
export async function addLogo(storage: StoragePort, file: File, size: { width: number; height: number }): Promise<template.BrandKit> {
  if (file.size > LOGO_MAX_BYTES) throw new template.BrandRefused("Logos can be up to 20 MB");
  const bytes = new Uint8Array(await file.arrayBuffer()), sha256 = await sha256Hex(bytes), extension = file.name.slice(file.name.lastIndexOf(".") + 1).toLowerCase();
  const logo: template.BrandLogo = { id: sha256, name: file.name.replace(/\.[a-z0-9]+$/i, "").slice(0, 120) || "Logo", file: `brand/${sha256}.${extension}`, sha256, size: bytes.length, width: size.width, height: size.height, mime: file.type || "image/png", addedAt_ms: Date.now() };
  const next = template.changeBrandKit(await loadBrandKit(storage), { kind: "add-logo", logo }, Date.now());
  await storage.writeLibraryFile(logo.file, bytes);
  await store(storage, next);
  return next;
}
export async function removeLogo(storage: StoragePort, logo: template.BrandLogo): Promise<void> {
  await changeBrand(storage, { kind: "remove-logo", id: logo.id });
  await storage.deleteLibraryFile(logo.file).catch(() => undefined);
}
export const countBrandKits = async (storage: StoragePort): Promise<number> => (template.isEmptyBrandKit(await loadBrandKit(storage)) ? 0 : 1);

/** The brand kit, read again whenever it changes; `null` while the first read runs. */
export function useBrandKit(): { storage: StoragePort | null; kit: template.BrandKit | null } {
  const { storage, storageError } = useDevice();
  const [kit, setKit] = useState<template.BrandKit | null>(cached);
  useEffect(() => {
    if (!storage) { if (storageError) setKit(template.EMPTY_BRAND_KIT); return; }
    let cancelled = false;
    const load = () => void loadBrandKit(storage).then((next) => { if (!cancelled) setKit(next); }).catch(() => { if (!cancelled) setKit(template.EMPTY_BRAND_KIT); });
    load();
    const off = onBrandChange(load);
    return () => { cancelled = true; off(); };
  }, [storage, storageError]);
  return { storage: storage ?? null, kit };
}
/** The colours of the brand kit, for the "Brand" row of a colour picker: nothing while the kit has none. */
export function useBrandColors(): string[] | undefined {
  const { kit } = useBrandKit();
  return kit && kit.colors.length > 0 ? kit.colors.map((color) => color.value.toUpperCase()) : undefined;
}
