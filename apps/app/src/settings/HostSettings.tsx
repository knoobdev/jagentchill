import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { migrateHostRecord, type HostConnectionRecord, type HostSecretInfo } from "@jagentchill/client";
import { relativeTime } from "@jagentchill/app-core";
import { Button, Callout, Card, ConfirmDialog, DestructiveConfirmDialog, SettingRow, Spinner, Text, space, useTheme, useToast, type Crumb, SkeletonList } from "@jagentchill/ui";
import { reasonOf } from "../agents/errors";
import { useHost } from "../host";
import { removeHost, saveHost } from "../identity";
import { useT } from "../locale";
import { stacksSettingsRows } from "../pairing/mobile-settings-layout";
import { TeamsScreen } from "../agents/team/TeamsScreen";
import { OrcScreen } from "../providers/OrcScreen";
import { ProvidersScreen } from "../providers/ProvidersScreen";
import { NotFoundScreen } from "../shell/NotFound";
import { Screen, useHostScopeState } from "../shell/Shell";
import { SettingsPageFrame } from "./SettingsScreen";
import { SkillsScreen } from "../skills/SkillsScreen";
import { UsageScreen } from "../usage/UsageScreen";
import { HostSpaceScreen } from "../sync/HostSpace";
import { desktop, type TailnetStatus } from "../platform/desktop";
import { copyText } from "../platform/media";
import { DevicesContent } from "../pairing/Devices";
import { builtInConnectionRows, canRemoveBuiltInConnection } from "./host-connection-rows";
import { useForegroundActive } from "../platform/foreground";

/** A page of the host group of Settings. It needs the host it names to be connected. */
export function HostSettingsRoute(props: { section: string; item?: string }) {
  const t = useT();
  const scope = useHostScopeState(t("Settings"));
  if (scope) return <Screen title={t("Settings")}>{scope}</Screen>;
  if (props.section === "runtimes") return <ProvidersScreen tab={props.item} />;
  if (props.section === "model-routing") return <OrcScreen />;
  if (props.section === "teams") return <TeamsScreen teamId={props.item} />;
  if (props.section === "secrets") return <SecretsScreen />;
  if (props.section === "usage") return <UsageScreen tab={props.item} />;
  if (props.section === "skills") return <SkillsScreen skillId={props.item} />;
  if (props.section === "host-storage") return <HostSpaceScreen />;
  if (props.section === "connections" || props.section === "devices") return <ConnectionsScreen />;
  return <NotFoundScreen />;
}

/** Connection addresses of the selected paired host; identity and device role stay on the host record. */
function ConnectionsScreen() {
  const t = useT();
  const theme = useTheme();
  const toast = useToast();
  const router = useRouter();
  const { host, refreshHosts } = useHost();
  const foreground = useForegroundActive();
  const [removing, setRemoving] = useState<HostConnectionRecord | "last-local" | null>(null);
  const [tailnetStatus, setTailnetStatus] = useState<TailnetStatus | null>(null);
  const [connectionMode, setConnectionMode] = useState<"tailscale" | "local" | null>(null);
  const [hostPort, setHostPort] = useState<number | null>(null);
  const bridge = desktop();
  const connections = host ? migrateHostRecord(host).connections ?? [] : [];
  const builtIn = (host as { builtIn?: boolean } | undefined)?.builtIn === true;
  const crumbs: Crumb[] = [{ id: "settings", label: t("Settings"), onPress: () => router.push("/settings" as never) }, { id: "host", label: host?.gatewayName ?? t("Host") }, { id: "connections", label: t("Connections and devices") }];
  useEffect(() => {
    if (!bridge || !builtIn || !foreground) return;
    let active = true;
    const refresh = () => {
      void bridge.tailnet.getStatus().then((value) => { if (active) setTailnetStatus(value); }).catch(() => { if (active) setTailnetStatus(null); });
      void bridge.gateway.getStatus().then((value) => { if (active) setHostPort(value.port ?? null); }).catch(() => { if (active) setHostPort(null); });
    };
    void bridge.connectionMode.get().then((value) => { if (active) setConnectionMode(value); });
    refresh();
    const off = bridge.gateway.onStatus(refresh);
    const timer = setInterval(refresh, 5000);
    return () => { active = false; off(); clearInterval(timer); };
  }, [bridge, builtIn, foreground]);
  const liveConnections: HostConnectionRecord[] = builtIn && host
    ? builtInConnectionRows({ gatewayId: host.gatewayId, localOrigin: host.origin, port: hostPort, mode: connectionMode, tailnet: tailnetStatus })
    : connections;
  const addressOf = (target: HostConnectionRecord) => target.kind === "local" && builtIn
    ? `127.0.0.1:${hostPort ?? (new URL(target.origin).port || "—")}`
    : target.tailnetAddress ?? endpointOf(target.origin);
  const remove = async (target: HostConnectionRecord | "last-local") => {
    if (!host) return;
    if (builtIn) {
      await bridge?.connectionMode.set(null);
      router.replace("/join-tailnet" as never);
      return;
    }
    if (target === "last-local") return;
    const rest = connections.filter((connection) => connection.id !== target.id);
    const preferred = rest.find((connection) => connection.id === host.preferredConnectionId) ?? rest[0];
    try {
      if (!preferred) { await removeHost(host.gatewayId); router.replace("/settings" as never); }
      else await saveHost(migrateHostRecord({ ...host, connections: rest, preferredConnectionId: preferred.id, origin: preferred.origin }));
      await refreshHosts();
      toast.show({ kind: "success", message: t("Connection removed") });
    } catch (error) { toast.show({ kind: "error", message: error instanceof Error ? error.message : String(error) }); }
  };
  return <SettingsPageFrame crumbs={crumbs} title={t("Connections and devices")} width={960}>
    <View testID="connections-section" style={{ gap: space[2] }}>
    <Text variant="title-md" level={2}>{t("Connections")}</Text>
    <Text color="text/secondary" style={{ marginTop: -6, marginBottom: 6 }}>{t(builtIn ? "How {host} can be reached. Tailscale is what lets your phone and other devices in." : "Addresses this device can use to reach {host}.", { host: host?.gatewayName ?? t("the host") })}</Text>
    <Card padding={0}>
      {liveConnections.map((connection, index) => (
        <View key={connection.id} testID={`host-connection-${connection.id}`} style={{ flexDirection: stacksSettingsRows(theme.width) ? "column" : "row", alignItems: stacksSettingsRows(theme.width) ? "stretch" : "center", gap: space[2], minHeight: 48, paddingHorizontal: space[3], paddingVertical: stacksSettingsRows(theme.width) ? space[2] : 0, borderTopWidth: index ? 1 : 0, borderTopColor: theme.color("border/hairline") }}>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text variant="body-medium" numberOfLines={stacksSettingsRows(theme.width) ? 2 : 1}>{connection.kind === "local" ? builtIn ? `${t("Local")} · ${t("This computer")}` : t("Local") :connection.kind === "tailnet" ? t("Tailscale") : t("Local network")}</Text>
            <Text variant="mono" color="text/secondary" selectable>{addressOf(connection)}</Text>
          </View>
          <Button size={stacksSettingsRows(theme.width) ? "sm" : "xs"} kind="ghost" icon="copy" label={t("Copy address")} onPress={() => void copyText(addressOf(connection)).then((copied) => toast.show({ kind: copied ? "success" : "warning", message: t(copied ? "Address copied" : "Could not copy") }))} />
          {builtIn
            ? canRemoveBuiltInConnection(connection.kind, liveConnections.length)
              ? <Button size={stacksSettingsRows(theme.width) ? "sm" : "xs"} kind="ghost" tone="danger" label={t("Remove")} onPress={() => setRemoving(connection.kind === "local" ? "last-local" : connection)} />
              : null
            : <Button size={stacksSettingsRows(theme.width) ? "sm" : "xs"} kind="ghost" tone="danger" label={t("Remove")} onPress={() => setRemoving(connection)} />}
        </View>
      ))}
      {!liveConnections.length ? <View style={{ padding: space[3] }}><Text color="text/secondary">{t("No connections are saved for this host.")}</Text></View> : null}
    </Card>
    {/* This computer's host has two kinds of connection, Local and Tailscale: once both are listed there is nothing to
        add, and the sign-in screen would only bounce back. The button is offered while Tailscale is missing. */}
    {!builtIn || !liveConnections.some((connection) => connection.kind === "tailnet") ? <View style={{ alignItems: "flex-start", marginTop: space[2] }}><Button icon="plus" label={t("Add connection")} onPress={() => builtIn ? router.push(`/join-tailnet?manage=1&returnTo=${encodeURIComponent("/settings/host/" + host?.gatewayId + "/connections")}` as never) : router.push(`/host/add-connection?hostId=${encodeURIComponent(host?.gatewayId ?? "")}` as never)} /></View> : null}
    </View>
    <ConfirmDialog open={removing !== null} title={t("Remove this connection?")} description={removing === "last-local" ? t("Removing the last connection signs this desktop out of its current connection mode and returns to the Tailscale sign-in screen.") : removing?.kind === "tailnet" ? t("Phones will no longer reach this computer until they sign in to Tailscale again.") : t("This removes the saved address from this device.")} confirmLabel={t("Remove")} onClose={() => setRemoving(null)} onConfirm={() => { const target = removing; setRemoving(null); if (target) void remove(target); }} />
    <View style={{ height: space[5] }} />
    <View testID="devices-section"><DevicesContent title={t("Devices")} frame={(content) => <View>{content}</View>} /></View>
  </SettingsPageFrame>;
}

function endpointOf(origin: string): string {
  try { return new URL(origin).host; } catch { return origin; }
}

/** Host ▸ Secrets: the names of the keys the host holds, with the last four characters of each. A value is never shown. */
function SecretsScreen() {
  const t = useT();
  const theme = useTheme();
  const toast = useToast();
  const router = useRouter();
  const { host, secrets, can } = useHost();
  const [list, setList] = useState<HostSecretInfo[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [removing, setRemoving] = useState<HostSecretInfo | null>(null);
  const admin = can("jagentchill.secrets.manage");
  const load = useCallback(async () => { if (!secrets || !admin) return; try { setList(await secrets.list()); setError(null); } catch (err) { setError(err); } }, [secrets, admin]);
  useEffect(() => { void load(); }, [load]);
  const crumbs: Crumb[] = [{ id: "settings", label: t("Settings"), onPress: () => router.push("/settings" as never) }, { id: "host", label: host?.gatewayName ?? t("Host") }, { id: "secrets", label: t("Secrets") }];
  return (
    <SettingsPageFrame crumbs={crumbs} title={t("Secrets")} description={t("Keys are typed on a device, sent once over the signed route and stored on {host}. No device can read one back.", { host: host?.gatewayName ?? t("the host") })}>
      {!admin ? <Callout tone="warning">{t("Only admin devices can see and delete secrets")}</Callout>
        : error ? <Callout tone="danger" actions={[{ label: t("Retry"), onPress: () => void load() }]}>{reasonOf(error)}</Callout>
        : !list ? <SkeletonList rows={4} meta style={{ padding: space[2] }} />
        : list.length === 0 ? <Card><Text color="text/secondary">{t("No secret is stored on this host. Keys you enter for a provider or an endpoint appear here.")}</Text></Card> : (
          <Card padding={0}>
            {list.map((secret, index) => (
              <View key={secret.name} testID={`secret-${secret.name}`} style={{ flexDirection: stacksSettingsRows(theme.width) ? "column" : "row", alignItems: stacksSettingsRows(theme.width) ? "stretch" : "center", gap: space[2], minHeight: 44, paddingHorizontal: space[3], paddingVertical: stacksSettingsRows(theme.width) ? space[2] : 0, borderTopWidth: index ? 1 : 0, borderTopColor: theme.color("border/hairline") }}>
                <Text variant="mono" numberOfLines={1} style={{ flex: 1 }}>{secret.name}</Text>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[2] }}>
                  <Text variant="mono" color="text/secondary">{secret.hint ? `••••${secret.hint}` : "••••"}</Text>
                  <Text variant="meta" color="text/secondary" style={stacksSettingsRows(theme.width) ? undefined : { width: 96 }} align="right">{relativeTime(secret.updated_ms, Date.now(), theme.locale)}</Text>
                  <Button size="xs" kind="ghost" tone="danger" label={t("Delete")} onPress={() => setRemoving(secret)} />
                </View>
              </View>
            ))}
          </Card>
        )}
      <DestructiveConfirmDialog open={removing !== null} title={t("Delete secret?")} description={removing ? t("“{name}” is removed from the host. A provider or endpoint that uses it stops working.", { name: removing.name }) : undefined} confirmLabel={t("Delete secret")} irreversible
        onClose={() => setRemoving(null)} onConfirm={() => { const target = removing!; setRemoving(null); void secrets!.remove(target.name).then(() => { toast.show({ kind: "success", message: t("Secret deleted") }); return load(); }).catch((err) => toast.show({ kind: "error", message: reasonOf(err) })); }} />
    </SettingsPageFrame>
  );
}
