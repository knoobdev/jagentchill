import type { HostRecord } from "@jagentchill/client";
import type { NativeTailscaleAdapter } from "./adapter";

/** Resolve a persisted tailnet endpoint into this app process's temporary loopback proxy. */
export function hostThroughNativeTailnetProxy(host: HostRecord, adapter: NativeTailscaleAdapter): HostRecord {
  const connection = host.connections?.find((item) => item.id === host.preferredConnectionId) ?? host.connections?.[0];
  if (connection?.kind !== "tailnet") return host;
  const target = connection.tailnetAddress ?? new URL(connection.origin).host;
  const proxy = adapter.getProxyAddress(target);
  if (!proxy) throw new Error("The embedded Tailscale proxy is unavailable.");
  return { ...host, origin: `http://${proxy}` };
}
