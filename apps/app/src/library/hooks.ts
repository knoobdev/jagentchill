import { useEffect, useMemo, useState } from "react";
import type { StoragePort } from "@jagentchill/storage";
import { useDevice, usePref } from "../state";
import { countBrandKits, onBrandChange } from "../templates/brand-store";
import { INSTALLED_PACKS } from "../templates/packs";
import { countTemplates, onTemplatesChange } from "../templates/store";
import { countItems, listFolders, listItems, onLibraryChange, type ItemCategory, type LibraryShelf, type LibraryItem } from "./store";

export type LibraryListing = { items: LibraryItem[]; folders: LibraryShelf[] };
/** The last listing read per category: switching back to a category shows it at once while the fresh read runs. */
const lastListing = new Map<string, LibraryListing>();
/** The items and folders of a library category, read again whenever the library changes; `null` while the first read runs. */
export function useLibraryListing(category: ItemCategory | null): { storage: StoragePort | null; listing: LibraryListing | null; failed: boolean; retry(): void } {
  const { storage, storageError } = useDevice();
  const [listing, setListing] = useState<LibraryListing | null>(category ? lastListing.get(category) ?? null : null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    // Storage that is still opening is a wait (a skeleton); storage that cannot open, or no category, is an empty library.
    if (!category || (!storage && storageError)) { setListing({ items: [], folders: [] }); return; }
    if (!storage) { setListing(null); return; }
    let cancelled = false;
    // A failed read keeps `listing` null with `failed` set: the screen shows its error with a retry, not a skeleton.
    const load = () => void Promise.all([listItems(storage, category), listFolders(storage, category)]).then(([items, folders]) => { if (!cancelled) { setFailed(false); lastListing.set(category, { items, folders }); setListing({ items, folders }); } }).catch(() => { if (!cancelled) setFailed(true); });
    setListing(lastListing.get(category) ?? null); setFailed(false);
    load();
    const off = onLibraryChange(load);
    return () => { cancelled = true; off(); };
  }, [storage, storageError, category, attempt]);
  return { storage: storage ?? null, listing, failed, retry: () => setAttempt((count) => count + 1) };
}
/** The imported items of a category: what the editor's own pickers offer from the library. */
export function useLibraryImports(category: ItemCategory): { storage: StoragePort | null; items: LibraryItem[] } {
  const { storage, listing } = useLibraryListing(category);
  return { storage, items: (listing?.items ?? []).filter((item) => !item.builtIn) };
}
/** The number of items of every category, for the sidebar. */
export function useLibraryCounts(active: boolean): Record<string, number> {
  const { storage } = useDevice();
  const [counts, setCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!active || !storage) return;
    let cancelled = false;
    const load = () => void Promise.all([countItems(storage), countTemplates(storage), countBrandKits(storage)]).then(([next, templates, kits]) => { if (!cancelled) setCounts({ ...next, templates, "brand-kits": kits }); }).catch(() => undefined);
    load();
    const off = onLibraryChange(load), offTemplates = onTemplatesChange(load), offBrand = onBrandChange(load);
    return () => { cancelled = true; off(); offTemplates(); offBrand(); };
  }, [active, storage]);
  // The packs are a preference of the device: their count follows it.
  const [packs] = usePref(INSTALLED_PACKS);
  return useMemo(() => ({ ...counts, packs: packs.length }), [counts, packs.length]);
}
