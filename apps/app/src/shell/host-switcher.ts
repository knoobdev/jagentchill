import type { HostRecord } from "@jagentchill/client";

export type HostTransport = "loopback" | "lan" | "tailnet";
export type HostRowStatus = "Connected" | "Connecting…" | "Host unavailable" | "Not in use";

/** A host this device is not using right now is not "unavailable": nothing was tried. Only the active host has a live state. */
export function hostRowStatus(active: boolean, status: "local" | "connecting" | "connected" | "unavailable"): HostRowStatus {
  if (!active || status === "local") return "Not in use";
  if (status === "unavailable") return "Host unavailable";
  return status === "connected" ? "Connected" : "Connecting…";
}

/** Remove duplicate registry entries by gateway identity, keeping the most complete record. */
export function uniqueHostRecords<T extends HostRecord>(records: readonly T[]): T[] {
  const unique = new Map<string, T>();
  for (const record of records) {
    const previous = unique.get(record.gatewayId);
    if (!previous || (record.connections?.length ?? 0) > (previous.connections?.length ?? 0)) unique.set(record.gatewayId, record);
  }
  return [...unique.values()];
}

/** The switcher shows a connection type and a useful endpoint label, never a loopback address. */
export function hostSwitcherConnection(record: HostRecord, activeTransport?: HostTransport): { type: "This computer" | "Local network" | "Tailscale"; address: string } {
  const builtIn = Boolean((record as HostRecord & { builtIn?: boolean }).builtIn);
  const selected = record.connections?.find((item) => item.id === record.preferredConnectionId) ?? record.connections?.[0];
  const origin = selected?.origin ?? record.origin;
  const loopback = (() => { try { const hostname = new URL(origin).hostname; return hostname === "localhost" || hostname === "::1" || hostname.startsWith("127."); } catch { return false; } })();
  const transport = activeTransport ?? (builtIn || selected?.kind === "local" || loopback ? "loopback" : selected?.kind === "tailnet" ? "tailnet" : "lan");
  if (transport === "loopback") return { type: "This computer", address: "This computer" };
  if (transport === "tailnet") {
    const tailnet = record.connections?.find((item) => item.kind === "tailnet");
    let address = tailnet?.tailnetAddress;
    if (!address) {
      try { address = new URL(tailnet?.origin ?? record.origin).hostname; }
      catch { address = tailnet?.origin ?? record.origin; }
    }
    return { type: "Tailscale", address };
  }
  let address = selected?.kind === "direct" ? selected.origin : record.origin;
  try { address = new URL(address).host; } catch { /* keep the stored address */ }
  return { type: "Local network", address };
}

/** The home pill's detail: keep identical local type/address labels from being printed twice. */
export function hostSwitcherDetail(connection: ReturnType<typeof hostSwitcherConnection>, translate: (label: string) => string): string {
  const type = translate(connection.type);
  return connection.address === connection.type ? type : `${type} · ${connection.address}`;
}
