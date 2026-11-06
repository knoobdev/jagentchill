import { Redirect, useLocalSearchParams } from "expo-router";
import { useHost } from "../host";
import { connectionsAndDevicesRoute } from "../settings/host-settings-model";

/** Old device destinations now resolve to Host ▸ Connections and devices. */
export function DeviceSettingsRedirect() {
  const { host } = useHost();
  const params = useLocalSearchParams<{ pair?: string; requestId?: string }>();
  if (!host) return <Redirect href="/settings" />;
  const query = new URLSearchParams();
  if (params.pair === "1") query.set("pair", "1");
  if (typeof params.requestId === "string") query.set("requestId", params.requestId);
  const suffix = query.size ? `?${query.toString()}` : "";
  return <Redirect href={`${connectionsAndDevicesRoute(host.gatewayId)}${suffix}` as never} />;
}
