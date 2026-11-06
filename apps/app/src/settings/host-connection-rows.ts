import type { HostConnectionRecord } from "@jagentchill/client";

export type BuiltInConnectionState = {
  gatewayId: string;
  localOrigin: string;
  port: number | null;
  mode: "tailscale" | "local" | null;
  tailnet: { connected: boolean; host: string | null; port: number | null } | null;
};

/** The bundled host rows come from live listener state; saved tailnet records can be stale after a restart. */
export function builtInConnectionRows(state: BuiltInConnectionState): HostConnectionRecord[] {
  const rows: HostConnectionRecord[] = [{ id: `local:${state.gatewayId}`, kind: "local", origin: state.localOrigin }];
  if (state.mode === "tailscale" && state.tailnet?.connected && state.tailnet.host && state.tailnet.port) {
    const address = `${state.tailnet.host}:${state.tailnet.port}`;
    rows.push({ id: `tailnet:${address}`, kind: "tailnet", origin: `http://${address}`, tailnetAddress: address });
  }
  return rows;
}

export function canRemoveBuiltInConnection(kind: HostConnectionRecord["kind"], rowCount: number): boolean {
  return kind === "tailnet" || rowCount === 1;
}
