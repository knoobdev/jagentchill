import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { exporting } from "@jagentchill/app-core";
import { useHost } from "../../host";
import { useDevice } from "../../state";
import { exportService, type ServiceState } from "./service";

/** The export queue and history of this device. Whoever reads them also opens them: the stored queue is read once the store is. */
export function useExports(): ServiceState {
  const { storage } = useDevice();
  useEffect(() => { if (storage) void exportService.open(storage); }, [storage]);
  return useSyncExternalStore(exportService.subscribe, exportService.getState, exportService.getState);
}

/**
 * What the connected host can do for an export: its feature flags, the role of this device and its codec table. `null`
 * with no host connected. The codec table is asked once per connection; a host that does not answer has none.
 */
export function useHostCapabilities(): exporting.HostCapabilities | null {
  const { host, connection, status } = useHost();
  const [remote, setRemote] = useState<exporting.RemoteCapabilities | null>(null);
  const features = connection?.ready.features, flags = useMemo(() => Object.keys(features ?? {}).filter((key) => (features as Record<string, unknown>)[key] !== false), [features]);
  const canExport = flags.includes(exporting.FEATURE_REMOTE_EXPORT);
  useEffect(() => {
    setRemote(null);
    if (!connection || !canExport) return;
    let cancelled = false;
    connection.call<exporting.RemoteCapabilities>(exporting.EXPORT_RPC.capabilities).then((answer) => { if (!cancelled) setRemote(answer); }, () => undefined);
    return () => { cancelled = true; };
  }, [connection, canExport]);
  return useMemo(() => (status === "connected" && host && connection ? exporting.hostCapabilities({ name: host.gatewayName, features: flags, role: connection.ready.role, remote }) : null), [status, host, connection, flags, remote]);
}

/** A request to open the export dialog of a project with given settings ("Export again"), taken by that project's editor. */
let pending: { projectId: string; settings: exporting.ExportSettings } | null = null;
export const requestExportAgain = (projectId: string, settings: exporting.ExportSettings): void => { pending = { projectId, settings }; };
export const peekExportAgain = (projectId: string): boolean => pending?.projectId === projectId;
export function takeExportAgain(projectId: string): exporting.ExportSettings | null {
  if (pending?.projectId !== projectId) return null;
  const { settings } = pending;
  pending = null;
  return settings;
}
