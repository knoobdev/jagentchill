export const HOST_SETTINGS_NAV_ITEMS = [
  { id: "connections", label: "Connections and devices", icon: "device", description: "Addresses this device can use to reach this host", group: "host" },
] as const;

export function connectionsAndDevicesRoute(hostId: string): string {
  return `/settings/host/${encodeURIComponent(hostId)}/connections`;
}
