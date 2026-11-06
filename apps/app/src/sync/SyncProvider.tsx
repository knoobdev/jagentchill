import { carryThroughPortals, useToast, type IconName } from "@jagentchill/ui";
import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createSyncEngine, type SyncEngine, type SyncStatus } from "@jagentchill/client";
import { uuidV4 } from "@jagentchill/editor-core";
import { MAX_SCHEMA_VERSION, PROJECT_SCHEMA_VERSION, type ProjectDocument } from "@jagentchill/protocol";
import { findArrivedMedia, markArrivedMedia, type ArrivedProbe } from "@jagentchill/media";
import { loadProject, saveProject, serializeProjectRecord, type StoragePort } from "@jagentchill/storage";
import { useHost } from "../host";
import { loadSigner } from "../identity";
import { useT, type T } from "../locale";
import { getPref, useDevice, useLibraryState, usePref } from "../state";
import { SYNCED_LIBRARY, SYNC_PREFS } from "./prefs";
import { useForegroundActive } from "../platform/foreground";

type SyncState = {
  /** `null` until the device's store is open. */
  engine: SyncEngine | null;
  /** The paired host's name, or null when this device is paired with none ("Connect a host"). */
  hostName: string | null;
  connected: boolean;
  /** This device's role lets it turn sync on, edit and delete synced projects. */
  canWrite: boolean; isAdmin: boolean;
  /** The sync status of every project of the library, by id. */
  statuses: Record<string, SyncStatus>;
  /** A number that changes with every change of a status, a transfer or a record. */
  version: number;
};
const SyncContext = createContext<SyncState>({ engine: null, hostName: null, connected: false, canWrite: false, isAdmin: false, statuses: {}, version: 0 });
carryThroughPortals(SyncContext);
// EditorScreen needs the engine for project I/O, but must not subscribe to the sync generation/status state.
// Keeping that value in its own context prevents a transfer tick from redrawing the editor while someone types.
const SyncEngineContext = createContext<SyncEngine | null>(null);
carryThroughPortals(SyncEngineContext);
const nothing = () => () => {};

/** Owns the sync engine of this app session: created once the store is open, told when the host connection comes and goes. */
export function SyncProvider(props: { children: ReactNode }) {
  const t = useT();
  const toast = useToast();
  const { storage, library } = useDevice();
  const host = useHost();
  const foreground = useForegroundActive();
  const libraryState = useLibraryState();
  const live = useRef(host);
  live.current = host;
  const engine = useMemo(() => (storage ? createSyncEngine({
    storage, connection: () => live.current.connection, host: () => live.current.host, signer: loadSigner, deviceName: () => live.current.connection?.ready.deviceName ?? t("This device"), platform: storage.platform,
    supportedSchemaVersion: { ...MAX_SCHEMA_VERSION, project: PROJECT_SCHEMA_VERSION }, serialize: (document) => serializeProjectRecord(document as ProjectDocument), newId: () => uuidV4(),
    prefs: {
      metered: () => (globalThis.navigator as { connection?: { saveData?: boolean; type?: string } } | undefined)?.connection?.type === "cellular",
      syncOverMobileData: () => getPref(SYNC_PREFS.mobileData),
      uploadLimit: () => { const mbit = getPref(SYNC_PREFS.uploadLimit); return mbit ? mbit * 1_000_000 : undefined; },
      downloadLimit: () => { const mbit = getPref(SYNC_PREFS.downloadLimit); return mbit ? mbit * 1_000_000 : undefined; },
      downloadOriginals: () => getPref(SYNC_PREFS.originals) ?? storage.platform === "desktop",
    },
  }) : null), [storage]); // eslint-disable-line react-hooks/exhaustive-deps
  const version = useSyncExternalStore(engine ? engine.subscribe : nothing, () => engine?.generation ?? 0, () => 0);
  const [statuses, setStatuses] = useState<Record<string, SyncStatus>>({});

  useEffect(() => () => engine?.dispose(), [engine]);
  // Media that arrived for a project that is not open is marked present in its record; an open editor does it itself.
  useEffect(() => engine?.onMediaArrived((projectId) => {
    if (!storage || engine.session(projectId)) return;
    // The store is read against the record as saved; the marks go into the record as it is saved AFTER those reads.
    void (async () => {
      const arrived = await findArrivedMedia(arrivedProbe(storage, projectId), (await loadProject(storage, projectId)).document);
      if (!arrived.length || engine.session(projectId)) return;
      const next = markArrivedMedia((await loadProject(storage, projectId)).document, arrived);
      if (next && !engine.session(projectId)) await saveProject(storage, next);
    })().catch(() => undefined);
  }), [engine, storage]);
  // "Sync new projects": a project created on this device while a host is connected is synced without being asked.
  const [syncNew] = usePref(SYNC_PREFS.newProjects);
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (libraryState.status !== "ready") return;
    const ids = libraryState.projects.filter((project) => project.trash === null && !project.unreadable).map((project) => project.id);
    const before = seen.current;
    seen.current = new Set(ids);
    if (!before || !engine || !syncNew || !host.connection || !host.can("jagentchill.projects.write")) return;
    for (const id of ids) if (!before.has(id)) void engine.record(id).then((stored) => (stored ? undefined : engine.enable(id))).catch(() => undefined);
  }, [libraryState.projects, libraryState.status, engine, syncNew, host.connection]); // eslint-disable-line react-hooks/exhaustive-deps
  // "Sync my library": on connecting and every minute while connected.
  const [syncLibrary] = usePref(SYNC_PREFS.library);
  useEffect(() => {
    if (!foreground || !engine || !storage || !syncLibrary || !host.connection || !host.can("jagentchill.media.write")) return;
    const run = () => void engine.syncLibrary(SYNCED_LIBRARY, { read: (name) => storage.readLibrary(name as never), write: (name, value) => storage.writeLibrary(name as never, value) })
      .then((result) => { if (result.conflicts.length) toast.show({ kind: "info", message: t("Library conflict kept on host: {name}", { name: result.conflicts[0] }) }); }).catch(() => undefined);
    run();
    const timer = setInterval(run, 60_000);
    return () => clearInterval(timer);
  }, [engine, storage, syncLibrary, host.connection, foreground]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!engine) return;
    engine.connectionChanged();
    if (!host.connection) return;
    // Deletions recorded while offline are applied now, or taken back when the project changed on another device.
    void engine.applyTombstones(libraryState.projects.map((project) => project.id)).then(async ({ restored }) => {
      if (restored.length) { await library?.load(true); toast.show({ kind: "warning", message: t("Changed on another device — not deleted") }); }
    }).catch(() => undefined);
  }, [engine, host.connection]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => engine?.onConflict(() => toast.show({ kind: "warning", message: t("Sync paused — conflict"), persist: true } as never)), [engine, toast, t]);
  useEffect(() => {
    if (!engine) return;
    let cancelled = false;
    void Promise.all(libraryState.projects.map(async (project) => [project.id, await engine.statusOf(project.id).catch((): SyncStatus => ({ kind: "local" }))] as const))
      .then((entries) => { if (!cancelled) setStatuses(Object.fromEntries(entries)); });
    return () => { cancelled = true; };
  }, [engine, version, libraryState.projects]);

  const value = useMemo<SyncState>(() => ({
    engine, hostName: host.host?.gatewayName ?? null, connected: host.status === "connected", canWrite: host.can("jagentchill.projects.write"), isAdmin: host.can("jagentchill.devices.manage"), statuses, version,
  }), [engine, host.host?.gatewayName, host.status, host, statuses, version]);
  return <SyncContext.Provider value={value}><SyncEngineContext.Provider value={engine}>{props.children}</SyncEngineContext.Provider></SyncContext.Provider>;
}
export const useSync = (): SyncState => useContext(SyncContext);
export const useSyncEngine = (): SyncEngine | null => useContext(SyncEngineContext);

/**
 * Media that is in this device's store but still marked absent in the document's device-local section (it was
 * downloaded while the project was closed, or before its record was read): the document with it marked present, or
 * null when nothing changes.
 */
export const arrivedProbe = (storage: StoragePort, projectId: string): ArrivedProbe => ({
  hasOriginal: (assetId) => storage.hasMedia(projectId, assetId),
  hasProxy: (contentHash) => storage.cache.has({ kind: "proxy", contentHash, variant: "mp4" }),
});

export type StatusView = { text: string; icon: IconName; tone: "neutral" | "warning" | "danger" | "accent"; next?: "retry" | "storage" | "conflict" | "restore" };
/** One status per synced document, said by icon and text — never by colour alone. */
export function statusView(status: SyncStatus, t: T, hostName: string | null): StatusView | null {
  switch (status.kind) {
    case "local": return null;
    case "synced": return { text: t("Synced"), icon: "check", tone: "neutral" };
    case "syncing": return { text: t("Syncing ({n})", { n: status.count }), icon: "refresh", tone: "accent" };
    case "offline": return { text: status.waitingFor ? t("Offline changes ({n}) — waiting for {name}", { n: status.count, name: status.waitingFor }) : t("Offline changes ({n})", { n: status.count }), icon: "cloud", tone: "warning" };
    case "conflict": return { text: t("Sync paused — conflict"), icon: "warn", tone: "warning", next: "conflict" };
    case "viewing": return { text: t("Viewing — {name} is editing", { name: status.name }), icon: "eye", tone: "neutral" };
    case "paused": return { text: t("Sync paused"), icon: "pause", tone: "neutral" };
    case "update-host": return { text: t("Update the host to sync this project"), icon: "warn", tone: "warning" };
    case "update-required": return { text: t("Update required to sync"), icon: "warn", tone: "warning" };
    case "storage-full": return { text: t("Sync error — host storage is full"), icon: "warn", tone: "danger", next: "storage" };
    case "error": return { text: t("Sync error"), icon: "warn", tone: "danger", next: "retry" };
    case "deleted": return { text: t("Deleted on {name}", { name: status.by || (hostName ?? "") }), icon: "warn", tone: "warning", next: "restore" };
  }
}
export function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes, unit = 0;
  while (value >= 1000 && unit < units.length - 1) { value /= 1000; unit += 1; }
  return `${unit === 0 ? value : value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}
