import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { View } from "react-native";
import {
  Badge, Button, Callout, Card, Dot, Icon, Input, Modal, Segmented, Select, SettingRow, SkeletonList, StatusPill, Text, useTheme, useToast, type IconName,
} from "@jagentchill/ui";
import { formatDay, relativeTime } from "@jagentchill/app-core";
import { fingerprint, useHost, type PairingRequest } from "../host";
import { useT } from "../locale";
import { messageFor } from "../messages";
import { OtpCells } from "../shell/Otp";
import { Qr } from "../shell/Qr";
import { deviceConnectionPath } from "./connection-path";
import { pairingLinkDisplay } from "./link-display";
import { DEVICE_ROLE_OPTIONS, deviceRowsLayout } from "./mobile-settings-layout";
import { useForegroundActive } from "../platform/foreground";

type Role = "admin" | "editor" | "viewer";
type Device = {
  deviceId: string; name: string; platform: string; role: Role; state: "active" | "revoked"; paired_ms: number; lastSeen_ms: number; online: boolean; lastTransport: string | null; thisDevice: boolean;
};
const ROLE_OPTIONS = DEVICE_ROLE_OPTIONS;
const ROLE_TEXT: Record<Role, string> = {
  admin: "Admin can do everything, including terminals, workspace agents, providers, secrets and devices.",
  editor: "Editor can edit projects, run the agent and export. It cannot manage devices, secrets or host settings.",
  viewer: "Viewer can view and comment. It cannot edit, run the agent or export.",
};
// The name of an operating system is a proper name; only the words around it are translated.
const PLATFORM: Record<string, { os: string; icon: IconName; desktop?: boolean }> = {
  ios: { os: "iOS", icon: "phone" }, android: { os: "Android", icon: "phone" }, macos: { os: "macOS", icon: "monitor", desktop: true }, windows: { os: "Windows", icon: "monitor", desktop: true },
  linux: { os: "Linux", icon: "monitor", desktop: true }, web: { os: "Web", icon: "globe" },
};
const COLUMNS = [{ label: "Device", flex: 4.2 }, { label: "Role", flex: 1.3 }, { label: "State", flex: 1 }, { label: "Last seen", flex: 1.1 }, { label: "Paired", flex: 1.1 }, { label: "Connected via", flex: 1.5 }, { label: "Key fingerprint", flex: 1.5 }];
const clock = (ms: number) => `${String(Math.floor(ms / 60_000)).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now());
  const foreground = useForegroundActive();
  useEffect(() => {
    if (!active || !foreground) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active, foreground]);
  return now;
}

function Tile(props: { icon: IconName }) {
  const theme = useTheme();
  return (
    <View style={{ width: 28, height: 28, borderRadius: 6, backgroundColor: theme.color("bg/subtle"), alignItems: "center", justifyContent: "center" }}>
      <Icon name={props.icon} size={16} color="text/secondary" />
    </View>
  );
}

/**
 * Devices paired with the selected host. `?pair=1` opens the host's pairing offer.
 */
export function DevicesContent(props: { title: string; frame(content: ReactNode): ReactNode }) {
  const theme = useTheme();
  const toast = useToast();
  const t = useT();
  const router = useRouter();
  const params = useLocalSearchParams<{ pair?: string; requestId?: string }>();
  const { host, connection, status, can, pairingRequests, dismissPairingRequest } = useHost();
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [offer, setOffer] = useState<{ url: string; expires_ms: number; gatewayId: string; role: Role } | null>(null);
  const [reopenedRequest, setReopenedRequest] = useState<PairingRequest | null>(null);
  const stackedDeviceRows = deviceRowsLayout(theme.width) === "stacked";
  const manage = can("jagentchill.devices.manage");
  const request: PairingRequest | undefined = pairingRequests.find((entry) => entry.requestId === params.requestId) ?? (reopenedRequest?.requestId === params.requestId ? reopenedRequest : undefined) ?? pairingRequests[0];
  const now = useNow(!!offer || !!request);
  const platformOf = (id: string): { label: string; icon: IconName } => {
    const known = PLATFORM[id];
    return known ? { label: known.desktop ? t("{os} · desktop app", { os: known.os }) : known.os === "Web" ? t("Web") : known.os, icon: known.icon } : { label: id, icon: "device" };
  };
  const roleOptions = ROLE_OPTIONS.map((option) => ({ ...option, label: t(option.label) }));
  const roleSelect = roleOptions;

  const load = useCallback(async () => {
    if (!connection || !manage) return;
    try {
      setError(null);
      setDevices((await connection.call<{ devices: Device[] }>("jagentchill.device.list")).devices.filter((device) => device.state === "active"));
    } catch (err) {
      setError(err);
    }
  }, [connection, manage]);
  useEffect(() => void load(), [load, pairingRequests.length]);
  useEffect(() => connection?.on((event) => {
    if (event.event !== "jagentchill.device.presence.changed" || !event.payload?.deviceId) return;
    const { deviceId, online, lastTransport } = event.payload as { deviceId: string; online: boolean; lastTransport: string | null };
    setDevices((current) => current?.map((device) => device.deviceId === deviceId ? { ...device, online, lastTransport } : device) ?? current);
    void load();
  }), [connection, load]);
  useEffect(() => {
    if (!params.requestId || pairingRequests.some((entry) => entry.requestId === params.requestId) || reopenedRequest?.requestId === params.requestId || !connection || !manage) return;
    let cancelled = false;
    void connection.call<{ requests: PairingRequest[] }>("jagentchill.pairing.request.list").then(({ requests }) => {
      if (!cancelled) setReopenedRequest(requests.find((entry) => entry.requestId === params.requestId) ?? null);
    }).catch(() => { if (!cancelled) setReopenedRequest(null); });
    return () => { cancelled = true; };
  }, [params.requestId, pairingRequests, reopenedRequest, connection, manage]);

  const createOffer = useCallback(async (role: Role) => {
    try {
      setOffer(await connection!.call("jagentchill.pairing.offer.create", { role }));
    } catch (err) {
      setError(err);
    }
  }, [connection]);
  useEffect(() => {
    if (params.pair === "1" && connection && manage && !offer) void createOffer("editor");
  }, [params.pair, connection, manage]); // eslint-disable-line react-hooks/exhaustive-deps

  async function setRole(device: Device, role: Role) {
    try {
      await connection!.call("jagentchill.device.role.set", { deviceId: device.deviceId, role });
      await load();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <>
      {props.frame(
        <View testID="devices-content" style={{ width: "100%" }}>
          <View testID="devices-title-block" style={{ flexDirection: stackedDeviceRows ? "column" : "row", alignItems: stackedDeviceRows ? "stretch" : "flex-start", gap: 8, marginBottom: stackedDeviceRows ? 12 : 0 }}>
            <View style={{ flex: 1 }}>
              <Text variant="title-md" level={2}>{props.title}</Text>
              <Text color="text/secondary" style={{ marginTop: 2, marginBottom: 14 }}>
                {host ? t("Devices paired with {host}.", { host: host.gatewayName }) : t("Devices paired with this host.")}
              </Text>
            </View>
            {manage ? <Button kind="strong" size="sm" icon="qr" label={t("Pair a device")} onPress={() => createOffer("editor")} /> : null}
          </View>
          {error ? <View style={{ marginBottom: 12 }}><Callout tone="danger" actions={[{ label: t("Retry"), onPress: () => void load() }]}>{messageFor(error, t)}</Callout></View> : null}

          {manage && stackedDeviceRows ? (
            // Six columns do not fit a phone: each device is a card, its facts one per line.
            <View style={{ gap: 8 }}>
              {devices === null ? (error ? null : <SkeletonList rows={3} leading="avatar" meta testID="devices-skeleton" />) : devices.map((device) => {
                const { label: platformLabel, icon } = platformOf(device.platform);
                const path = t(deviceConnectionPath(device.lastTransport));
                const facts: Array<[string, string]> = [
                  [t("State"), device.online ? t("Online") : t("Offline")], [t("Last seen"), device.online ? t("Now") : relativeTime(device.lastSeen_ms, Date.now(), theme.locale)],
                  [t("Connected via"), device.online ? path : t("Last: {path}", { path })],
                  [t("Paired"), formatDay(device.paired_ms, theme.locale)], [t("Key fingerprint"), fingerprint(device.deviceId)],
                ];
                return (
                  <Card key={device.deviceId} style={{ gap: 8 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Tile icon={icon} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                          <Text variant="body-medium" numberOfLines={1} style={{ flexShrink: 1 }}>{device.name}</Text>
                          {device.thisDevice ? <Badge label={t("This device")} tone="accent" /> : null}
                        </View>
                        <Text variant="meta" color="text/secondary">{platformLabel}</Text>
                      </View>
                    </View>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, zIndex: 1 }}>
                      <Text variant="meta" color="text/secondary" style={{ flex: 1 }}>{t("Role")}</Text>
                      <Select label={t("Role of {name}", { name: device.name })} width={120} options={roleSelect} value={device.role} onChange={(role) => setRole(device, role)} />
                    </View>
                    {facts.map(([label, value]) => (
                      <View key={label} style={{ flexDirection: "row", gap: 8 }}>
                        <Text variant="meta" color="text/secondary" style={{ flex: 1 }}>{label}</Text>
                        <Text variant="meta">{value}</Text>
                      </View>
                    ))}
                  </Card>
                );
              })}
            </View>
          ) : manage ? (
            <View role={"table" as never} aria-label={t("Devices")}>
              <View role={"row" as never} style={{ flexDirection: "row", alignItems: "center", height: 32, backgroundColor: theme.color("bg/sidebar"), borderBottomWidth: 1, borderBottomColor: theme.color("border/hairline") }}>
                {COLUMNS.map((column) => (
                  <View key={column.label} role={"columnheader" as never} style={{ flex: column.flex, paddingHorizontal: 12 }}><Text variant="meta" color="text/secondary">{t(column.label)}</Text></View>
                ))}
              </View>
              {devices === null ? (error ? null : <SkeletonList rows={3} leading="avatar" meta testID="devices-skeleton" />) : devices.map((device) => {
                const { label: platformLabel, icon } = platformOf(device.platform);
                const path = t(deviceConnectionPath(device.lastTransport));
                return (
                  <View key={device.deviceId} role={"row" as never} style={{ flexDirection: "row", alignItems: "center", minHeight: 44, borderBottomWidth: 1, borderBottomColor: theme.color("border/hairline") }}>
                    <View role={"cell" as never} style={{ flex: 4.2, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Tile icon={icon} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <Text variant="body-medium" numberOfLines={1}>{device.name}</Text>
                          {device.thisDevice ? <Badge label={t("This device")} tone="accent" /> : null}
                        </View>
                        <Text variant="meta" color="text/secondary">{platformLabel}</Text>
                      </View>
                    </View>
                    <View role={"cell" as never} style={{ flex: 1.3, paddingHorizontal: 12, zIndex: 1 }}>
                      <Select label={t("Role of {name}", { name: device.name })} width={92} options={roleSelect} value={device.role} onChange={(role) => setRole(device, role)} />
                    </View>
                    <View role={"cell" as never} style={{ flex: 1, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Dot tone={device.online ? "success" : "off"} /><Text>{device.online ? t("Online") : t("Offline")}</Text>
                    </View>
                    <View role={"cell" as never} style={{ flex: 1.1, paddingHorizontal: 12 }}><Text color="text/secondary">{device.online ? t("Now") : relativeTime(device.lastSeen_ms, Date.now(), theme.locale)}</Text></View>
                    <View role={"cell" as never} style={{ flex: 1.1, paddingHorizontal: 12 }}><Text color="text/secondary">{formatDay(device.paired_ms, theme.locale)}</Text></View>
                    <View role={"cell" as never} style={{ flex: 1.5, paddingHorizontal: 12 }}><Text>{device.online ? path : t("Last: {path}", { path })}</Text></View>
                    <View role={"cell" as never} style={{ flex: 1.5, paddingHorizontal: 12 }}><Text variant="mono" color="text/secondary">{fingerprint(device.deviceId)}</Text></View>
                  </View>
                );
              })}
            </View>
          ) : host && status === "connected" ? (
            <Card><Text color="text/secondary">{t("Only an admin device can see and manage the devices of {host}.", { host: host.gatewayName })}</Text></Card>
          ) : null}

        </View>,
      )}

      {offer && !request ? (
        <Modal title={t("Pair a device")} description={t("Scan the code with JAgentChill on the new device, or use the link.")} onClose={() => { setOffer(null); void connection?.call("jagentchill.pairing.offer.cancel").catch(() => undefined); }}>
          <View style={{ alignItems: "center", gap: 12 }}>
            <Qr value={offer.url} size={theme.compact ? 180 : 240} />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <Text variant="meta" color="text/secondary">{t("Offer expires in")}</Text>
              <Text variant="mono" style={{ fontWeight: "500" }}>{clock(Math.max(0, offer.expires_ms - now))}</Text>
              <Button kind="ghost" size="xs" label={t("New offer")} onPress={() => createOffer(offer.role)} />
            </View>
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Input accessibilityLabel={t("Pairing link")} mono editable={false} numberOfLines={1} value={pairingLinkDisplay(offer.url, false)} style={{ flex: 1, backgroundColor: theme.color("bg/inset"), overflow: "hidden" }} />
            <Button icon="copy" label={t("Copy link")} onPress={() => void globalThis.navigator?.clipboard?.writeText(offer.url)} />
          </View>
          <Card padding={0}>
            <SettingRow label={t("Host fingerprint")} description={t("Must match the one shown on the new device.")}>
              <Text variant="mono">{fingerprint(offer.gatewayId).toUpperCase()}</Text>
            </SettingRow>
            <SettingRow label={t("Role for the new device")} last>
              <Segmented size="sm" options={roleOptions} value={offer.role} onChange={(role) => createOffer(role)} />
            </SettingRow>
          </Card>
        </Modal>
      ) : null}

      {request ? (
        <Modal title={t("A new device wants to pair")} description={t("Type this code on the new device. It is shown only here and on the host command line.")}
          onClose={() => { dismissPairingRequest(request.requestId); if (reopenedRequest?.requestId === request.requestId) setReopenedRequest(null); }}
          footer={<>
            <Button kind="ghost" tone="danger" label={t("Decline")} onPress={() => connection!.call("jagentchill.pairing.request.decline", { requestId: request.requestId }).then(() => dismissPairingRequest(request.requestId), setError)} />
            <View style={{ flex: 1 }} />
            <Button label={t("Done")} disabled />
          </>}>
          <Card style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 }}>
            <Tile icon={platformOf(request.platform).icon} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text variant="body-medium">{request.deviceName}</Text>
              <Text variant="meta" color="text/secondary" numberOfLines={1}>{t("{host} · {path} · {role} · key {key}", { host: platformOf(request.platform).label, path: t(deviceConnectionPath(request.transport)), role: t(request.role), key: fingerprint(request.deviceId) })}</Text>
            </View>
            <StatusPill label={t("Verifying")} tone="info" />
          </Card>
          <View style={{ alignItems: "center", gap: 12 }}>
            <OtpCells value={request.code} large />
            <View style={{ flexDirection: "row", gap: 12 }}>
              <Text variant="meta" color="text/secondary">{t("Code valid for")}</Text>
              <Text variant="mono" style={{ fontWeight: "500" }}>{clock(Math.max(0, request.expires_ms - now))}</Text>
              <Text variant="meta" color="text/secondary">·</Text>
              <Text variant="meta" color="text/secondary">{t("{count} attempts allowed", { count: 5 })}</Text>
            </View>
          </View>
          <Card padding={0}>
            <SettingRow label={t("Role")} description={t(ROLE_TEXT[request.role])} last>
              <Segmented size="sm" options={roleOptions} value={request.role}
                onChange={(role) => connection!.call("jagentchill.pairing.request.setRole", { requestId: request.requestId, role }).then(() => { request.role = role; setDevices((list) => (list ? [...list] : list)); }, setError)} />
            </SettingRow>
          </Card>
        </Modal>
      ) : null}
    </>
  );
}
