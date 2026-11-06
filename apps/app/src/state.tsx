import { carryThroughPortals } from "@jagentchill/ui";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  createProjectLibrary, readPreference, TRASH_EVALUATION_INTERVAL_MS, writePreference, type LibraryState, type Preference, type ProjectLibrary,
} from "@jagentchill/app-core";
import { uuidV4 } from "@jagentchill/editor-core";
import { createMigrationDialog, createPreferences, markSessionClean, removeOrphanMedia, type MigrationDialogState, type PreferenceDefinition, type StoragePort } from "@jagentchill/storage";
import { imageUrl, openStorage, preferenceStore, releaseImageUrl } from "./platform/store";

// ── Preferences ──────────────────────────────────────────────────────────────────────────────────────────────────────

const watchers = new Map<string, Set<() => void>>();
const cache = new Map<string, unknown>();
function read<T>(pref: Preference<T>): T {
  if (!cache.has(pref.key)) cache.set(pref.key, readPreference(preferenceStore, pref));
  return cache.get(pref.key) as T;
}
export function setPref<T>(pref: Preference<T>, value: T): void {
  cache.set(pref.key, value);
  writePreference(preferenceStore, pref, value);
  for (const watcher of watchers.get(pref.key) ?? []) watcher();
}
export const getPref = read;
/** A device preference, kept in the preference store and shared by every component that reads it. */
export function usePref<T>(pref: Preference<T>): [T, (value: T) => void] {
  const subscribe = useCallback((listener: () => void) => {
    let set = watchers.get(pref.key);
    if (!set) { set = new Set(); watchers.set(pref.key, set); }
    set.add(listener);
    return () => void set.delete(listener);
  }, [pref]);
  const value = useSyncExternalStore(subscribe, () => read(pref), () => pref.fallback);
  return [value, useCallback((next: T) => setPref(pref, next), [pref])];
}

/** The UI preferences the storage capability defines (media view and sort, snapshot interval, dismissals), in the same store. */
export const storagePrefs = createPreferences({ getItem: (key) => preferenceStore.get(key), setItem: (key, value) => preferenceStore.set(key, value), removeItem: (key) => preferenceStore.remove?.(key) });
export function useStoragePref<T>(definition: PreferenceDefinition<T>): [T, (value: T) => void] {
  const subscribe = useCallback((listener: () => void) => storagePrefs.subscribe(definition, listener), [definition]);
  const value = useSyncExternalStore(subscribe, () => storagePrefs.get(definition), () => definition.defaults);
  return [value, useCallback((next: T) => storagePrefs.set(definition, next), [definition])];
}

// ── Storage and the project library ──────────────────────────────────────────────────────────────────────────────────

type Device = {
  /** `null` while the store opens; `error` when the platform provides none (a private browser mode). */
  storage: StoragePort | null; storageError: unknown; library: ProjectLibrary | null; phone: boolean;
  /** The migration progress dialog and its failure summary; `null` while nothing was migrated. */
  migration: MigrationDialogState | null; restoreBackup(projectId: string): Promise<boolean>; closeMigrationSummary(): void;
};
const NO_MIGRATION = { migration: null, restoreBackup: async () => false, closeMigrationSummary: () => {} };
const DeviceContext = createContext<Device>({ storage: null, storageError: null, library: null, phone: false, ...NO_MIGRATION });
// Drawers, sheets and dialogs are drawn in the overlay stack: the context travels with them.
carryThroughPortals(DeviceContext);

/** Opens the client store once and owns the project library of this app session. Needs no host. */
export function DeviceProvider(props: { children: ReactNode; phone: boolean }) {
  const [device, setDevice] = useState<Device>({ storage: null, storageError: null, library: null, phone: props.phone, ...NO_MIGRATION });
  const phone = useRef(props.phone);
  phone.current = props.phone;
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    openStorage().then(async (storage) => {
      if (cancelled) return;
      // `phone` is read at creation time: a project made in a narrow window starts in portrait.
      const library = createProjectLibrary({ storage, newId: () => uuidV4(), get phone() { return phone.current; } } as never);
      // Records below the current schema are migrated before anything lists or opens them, behind the progress dialog.
      const dialog = createMigrationDialog(storage, { onChange: (migration) => { if (!cancelled) setDevice((current) => ({ ...current, migration })); } });
      setDevice({
        storage, storageError: null, library, phone: phone.current, migration: null,
        restoreBackup: async (projectId) => { const restored = await dialog.restoreBackup(projectId); if (restored) await library.refresh(projectId); return restored; },
        closeMigrationSummary: () => dialog.closeSummary(),
      });
      await dialog.run({ now: Date.now, newId: () => uuidV4() }).catch(() => undefined);
      await library.load();
      // Media files no asset record or snapshot references, older than a day: an interrupted import leaves no orphan.
      void removeOrphanMedia(storage, Date.now()).catch(() => undefined);
      // Trash expiry: at app start and every 6 hours while the app runs.
      await library.expireTrash().catch(() => undefined);
      timer = setInterval(() => void library.expireTrash().catch(() => undefined), TRASH_EVALUATION_INTERVAL_MS);
    }, (storageError) => { if (!cancelled) setDevice((current) => ({ ...current, storageError })); });
    return () => { cancelled = true; if (timer) clearInterval(timer); };
  }, []);
  const value = useMemo(() => ({ ...device, phone: props.phone }), [device, props.phone]);
  return <DeviceContext.Provider value={value}>{props.children}</DeviceContext.Provider>;
}
export const useDevice = (): Device => useContext(DeviceContext);

const LOADING: LibraryState = { status: "loading", error: null, projects: [], folders: [] };
/** The project index: `loading` until the store is open and read, then kept current by the library's notifications. */
export function useLibraryState(): LibraryState {
  const { library, storageError } = useDevice();
  const state = useSyncExternalStore(library ? library.subscribe : subscribeNothing, library ? library.getState : () => LOADING, () => LOADING);
  return storageError && !library ? { ...LOADING, status: "error", error: storageError } : state;
}
const subscribeNothing = () => () => {};

/** The card image of a project: its cover when it has one, its frame-0 thumbnail otherwise. `version` re-reads it. */
export function useProjectImage(id: string, cover: { mime: string } | null, version: number, thumbnailAssetId?: string | null): string | null {
  const { storage } = useDevice();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!storage) return;
    let cancelled = false, made: string | null = null;
    (async () => {
      const candidates: Array<["cover" | "thumbnail", string, string]> = [
        ...(cover ? [["cover", cover.mime === "image/png" ? "cover.png" : "cover.jpg", cover.mime] as ["cover", string, string]] : []),
        ...(thumbnailAssetId ? [["thumbnail", `${thumbnailAssetId}.jpg`, "image/jpeg"] as ["thumbnail", string, string], ["thumbnail", `${thumbnailAssetId}.png`, "image/png"] as ["thumbnail", string, string]] : []),
        ["thumbnail", "frame0.jpg", "image/jpeg"], ["thumbnail", "frame0.png", "image/png"],
      ];
      for (const [kind, name, mime] of candidates) {
        const bytes = await storage.getBlob(kind, id, name).catch(() => undefined);
        if (cancelled) return;
        if (bytes) { made = imageUrl(bytes, mime); setUrl(made); return; }
      }
      // Host sync stores media thumbnails by the asset's canonical ID. Recover from any existing image file too,
      // since older project records may not retain the first asset ID in their library summary.
      const alreadyTried = new Set(candidates.map(([, name]) => name));
      const files = await storage.listProjectFiles(id).catch(() => []);
      const images = files.filter((file) => file.path.startsWith("thumbnails/") && /\.(?:jpe?g|png)$/i.test(file.path))
        .sort((a, b) => Number(b.path.slice("thumbnails/".length).startsWith(`${thumbnailAssetId}.`)) - Number(a.path.slice("thumbnails/".length).startsWith(`${thumbnailAssetId}.`)));
      for (const file of images) {
        const name = file.path.slice("thumbnails/".length);
        if (alreadyTried.has(name)) continue;
        const bytes = await storage.getBlob("thumbnail", id, name).catch(() => undefined);
        if (cancelled) return;
        if (bytes) { made = imageUrl(bytes, /\.png$/i.test(name) ? "image/png" : "image/jpeg"); setUrl(made); return; }
      }
      setUrl(null);
    })();
    return () => { cancelled = true; if (made) releaseImageUrl(made); };
  }, [storage, id, cover?.mime, version, thumbnailAssetId]); // eslint-disable-line react-hooks/exhaustive-deps
  return url;
}
