/** Direct listener configuration visible to an admin device. */
export type DirectConnectionStatus = {
  enabled: boolean;
  address: string;
  port: number | null;
  passwordEnabled: boolean;
};

/** Admin RPC names for enabling the optional local-network/VPN listener. */
export const DIRECT_CONNECTION_METHODS = {
  statusGet: "jagentchill.directConnection.status.get",
  statusSet: "jagentchill.directConnection.status.set",
} as const;
