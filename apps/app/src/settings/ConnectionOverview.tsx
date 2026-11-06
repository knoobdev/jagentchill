import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { Platform, View } from "react-native";
import { Button, Card, SettingRow, Switch, Text, useTheme, useToast, space } from "@jagentchill/ui";
import { migrateHostRecord, type HostConnectionRecord } from "@jagentchill/client";
import { useHost } from "../host";
import { saveHost } from "../identity";
import { useT } from "../locale";
import { desktop, type BackgroundState, type HostStatus, type TailnetStatus } from "../platform/desktop";
import { copyText } from "../platform/media";
import { getNativeTailscaleAdapter } from "../tailscale/native";
import { useForegroundActive } from "../platform/foreground";

function endpointOf(origin?: string): string {
  if (!origin) return "—";
  try { return new URL(origin).host; } catch { return origin; }
}

/** Current route everywhere; the desktop also exposes the host's Tailscale and lifecycle controls. */
export function ConnectionOverview() {
  const t = useT();
  const router = useRouter();
  const theme = useTheme();
  const toast = useToast();
  const { host, connection, status, refreshHosts } = useHost();
  const foreground = useForegroundActive();
  const bridge = desktop();
  const [mode, setMode] = useState<"tailscale" | "local" | null>(null);
  const [hostStatus, setHostStatus] = useState<HostStatus | null>(null);
  const [tailnet, setTailnet] = useState<TailnetStatus | null>(null);
  const [background, setBackground] = useState<BackgroundState | null>(null);
  const [mobileTailnet, setMobileTailnet] = useState("unknown");

  useEffect(() => {
    if (!bridge || !foreground) return;
    let active = true;
    const refresh = () => {
      void bridge.gateway.getStatus().then((value) => { if (active) setHostStatus(value); });
      void bridge.tailnet.getStatus().then((value) => { if (active) setTailnet(value); });
    };
    void bridge.connectionMode.get().then((value) => { if (active) setMode(value); });
    void bridge.background.get().then((value) => { if (active) setBackground(value); });
    refresh();
    const off = bridge.gateway.onStatus((value) => { if (active) { setHostStatus(value); refresh(); } });
    const timer = setInterval(refresh, 5000);
    return () => { active = false; off(); clearInterval(timer); };
  }, [bridge, foreground]);

  useEffect(() => {
    if ((Platform.OS !== "ios" && Platform.OS !== "android") || !foreground) return;
    let active = true;
    void getNativeTailscaleAdapter().getStatus().then((value) => { if (active) setMobileTailnet(value); });
    const timer = setInterval(() => void getNativeTailscaleAdapter().getStatus().then((value) => { if (active) setMobileTailnet(value); }), 5000);
    return () => { active = false; clearInterval(timer); };
  }, [foreground]);

  useEffect(() => {
    const builtIn = host as (typeof host & { builtIn?: boolean }) | undefined;
    if (!bridge || !host || !builtIn?.builtIn || !hostStatus?.gatewayId || hostStatus.gatewayId !== host.gatewayId) return;
    const existing = migrateHostRecord(host);
    const connections = existing.connections ?? [];
    const local = connections.find((item) => item.kind === "local") ?? {
      id: `local:${host.gatewayId}`, kind: "local" as const, origin: host.origin,
    } satisfies HostConnectionRecord;
    const nextConnections = connections.filter((item) => item.kind !== "local");
    nextConnections.push(local);
    if (tailnet?.connected && tailnet.host && tailnet.port) {
      const address = `${tailnet.host}:${tailnet.port}`;
      const tailnetConnection: HostConnectionRecord = {
        id: `tailnet:${address}`, kind: "tailnet", origin: `http://${address}`, tailnetAddress: address,
      };
      for (let index = nextConnections.length - 1; index >= 0; index--) {
        if (nextConnections[index]?.kind === "tailnet") nextConnections.splice(index, 1);
      }
      nextConnections.push(tailnetConnection);
    }
    // This desktop currently opens its own host over loopback; keep that as the in-use route and list
    // the tailnet address separately for the other devices which use it to reach this same host.
    const preferredConnectionId = local.id;
    const unchanged = existing.preferredConnectionId === preferredConnectionId
      && JSON.stringify(existing.connections) === JSON.stringify(nextConnections);
    if (!unchanged) {
      void saveHost({ ...existing, origin: local.origin, connections: nextConnections, preferredConnectionId })
        .then(() => refreshHosts()).catch(() => undefined);
    }
  }, [bridge, host, hostStatus?.gatewayId, tailnet, refreshHosts]);

  const path = connection?.ready.transport;
  const pathLabel = path === "tailnet" ? t("Tailscale") : path === "lan" ? t("Local network") : path === "loopback" ? t("Local") : t(status === "connected" ? "Connected" : "Not connected");
  const activeEndpoint = endpointOf(host?.origin);
  const copyAddress = async (address: string) => {
    const copied = await copyText(address);
    toast.show({ kind: copied ? "success" : "warning", message: t(copied ? "Address copied" : "Could not copy") });
  };
  const tailnetState = tailnet?.connected ? t("Connected") : tailnet?.enabled && tailnet.loginUrl ? t("Needs sign-in") : tailnet?.enabled ? t("Connecting…") : t("Unavailable");

  return (
    <View testID="connection-overview">
    <Card style={{ gap: space[2] }}>
      <Text variant="body-medium">{t("Connection")}</Text>
      {bridge ? <>
        <SettingRow label={t("Connect type")} description={t("How this computer's built-in host reaches other devices.")}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
            <Text testID="connection-mode-value">{mode ? t(mode === "tailscale" ? "Tailscale" : "Local") : "—"}</Text>
            <Button size="xs" kind="ghost" label={t("Change")} testID="connection-mode-change" onPress={() => router.push("/join-tailnet?manage=1" as never)} />
          </View>
        </SettingRow>
        <View testID="settings-tailnet-card" style={{ borderWidth: 1, borderColor: theme.color("border/hairline"), borderRadius: 8, padding: space[3], gap: space[2] }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
            <Text variant="body-medium" style={{ flex: 1 }}>{t("Tailscale")}</Text>
            <Text testID="settings-tailnet-status">{tailnetState}</Text>
          </View>
          {tailnet?.unavailableReason ? <Text color="danger/text">{tailnet.unavailableReason}</Text> : null}
          {tailnet?.connected
            ? <Button size="sm" testID="tailnet-manage" label={t("Manage connection")} onPress={() => router.push("/join-tailnet?manage=1" as never)} />
            : <Button size="sm" testID="tailnet-connect" label={t("Connect with Tailscale")} onPress={() => void bridge.tailnet.startLogin({ mode: "interactive" }).then(setTailnet).catch((error: Error) => toast.show({ kind: "error", message: error.message }))} />}
        </View>
        <SettingRow label={t("Manage built-in host")}>
          <Switch accessibilityLabel={t("Manage built-in host")} value={hostStatus?.enabled ?? false} onChange={(enabled) => void bridge.gateway.setEnabled(enabled)} />
        </SettingRow>
        {background ? <SettingRow label={t("Keep host running after quit")}>
          <Switch accessibilityLabel={t("Keep host running after quit")} value={background.keepHostAfterQuit} onChange={(keepHostAfterQuit) => void bridge.background.set({ keepHostAfterQuit }).then(setBackground)} />
        </SettingRow> : null}
        <Text testID="settings-builtin-host-state" color="text/secondary">
          {hostStatus ? `${t(hostStatus.state === "ready" || hostStatus.state === "degraded" ? "Running" : "Stopped")}${hostStatus.port ? ` · ${t("Port {port}", { port: hostStatus.port })}` : ""}` : t("Host status unavailable")}
        </Text>
      </> : <>
        <SettingRow label={t("Active connection")} description={t("How this device reaches the selected host.")}>
          <Text testID="active-connection-path">{pathLabel}</Text>
        </SettingRow>
        <SettingRow label={t("Host address")} description={host?.gatewayName ?? t("This device")}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
            <Text selectable testID="active-connection-endpoint">{activeEndpoint}</Text>
            {host ? <Button size="xs" kind="ghost" icon="copy" label={t("Copy address")} onPress={() => void copyAddress(activeEndpoint)} /> : null}
          </View>
        </SettingRow>
        {Platform.OS === "ios" || Platform.OS === "android" ? <SettingRow label={t("This device's Tailscale")} description={t("Embedded tailnet connection status.")}><Text testID="mobile-tailnet-status">{t(mobileTailnet === "needs-login" ? "Needs sign-in" : mobileTailnet === "connected" ? "Connected" : mobileTailnet === "connecting" ? "Connecting…" : mobileTailnet === "unavailable" ? "Unavailable" : "Not connected")}</Text></SettingRow> : null}
      </>}
    </Card>
    </View>
  );
}
