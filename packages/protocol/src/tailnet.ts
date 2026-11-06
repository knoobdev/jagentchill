/** Current state of the host's embedded Tailscale bridge. */
export type TailnetStatus = {
  connected: boolean;
  host: string | null;
  loginUrl: string | null;
  port: number | null;
  /** Loopback-only outbound proxy port used by this desktop's embedded tsnet node. */
  proxyPort?: number | null;
  enabled: boolean;
  updatedAt: number;
  unavailableReason?: string | null;
};

export type TailnetProxyCredentials = { port: number; secret: string };

/** Stable host RPC names shared by the server and desktop renderer. */
export const TAILNET_METHODS = {
  statusGet: "jagentchill.tailnet.status.get",
  proxyCredentials: "jagentchill.tailnet.proxy.credentials",
  statusSubscribe: "jagentchill.tailnet.status.subscribe",
  loginStart: "jagentchill.tailnet.login.start",
  authKeyJoin: "jagentchill.tailnet.authKey.join",
  disable: "jagentchill.tailnet.disable",
  statusUpdated: "jagentchill.tailnet.status.updated",
} as const;
