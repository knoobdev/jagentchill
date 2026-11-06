import { useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Platform, ScrollView, View } from "react-native";
import { decodeOffer, encodeOfferUrl } from "@jagentchill/protocol";
import { migrateHostRecord, offerAtDirectOrigin, upsertHostConnectionInProfiles, type HostRecord } from "@jagentchill/client";
import { AdaptiveSheet, Button, Callout, Card, Icon, Input, ListRow, Switch, Tap, Text, compactScale, radius, space, useTheme } from "@jagentchill/ui";
import { useHost } from "../host";
import { listHosts, saveHost } from "../identity";
import { useT } from "../locale";
import { ConnectHost } from "../pairing/ConnectHost";
import { connectionMethods } from "./connection-methods";
import { desktop } from "../platform/desktop";
import { Screen } from "../shell/Shell";

type Method = "direct" | "scan" | "tailscale" | "paste";
type Health = { gatewayId: string; gatewayPublicKey: string };

const normalizedOrigin = (rawHost: string, rawPort: string, ssl: boolean): string => {
  const trimmed = rawHost.trim();
  if (!trimmed) throw new Error("Enter a host.");
  const hasScheme = /^https?:\/\//i.test(trimmed);
  const url = new URL(hasScheme ? trimmed : `${ssl ? "https" : "http"}://${trimmed}${rawPort.trim() ? `:${rawPort.trim()}` : ""}`);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Use an HTTP or HTTPS host address.");
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("Enter a host name or an origin only.");
  return url.origin;
};

/** The JAgentDesk add-connection methods and the JAgentChill direct probe/pairing path. */
export function AddConnection() {
  const t = useT();
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ hostId?: string }>();
  const { hosts, refreshHosts, selectHost } = useHost();
  const [method, setMethod] = useState<Method | null>(null);
  const [hostName, setHostName] = useState("");
  const [port, setPort] = useState("");
  const [ssl, setSsl] = useState(false);
  const [password, setPassword] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [connectionUri, setConnectionUri] = useState("");
  const [pairingLink, setPairingLink] = useState("");
  const [origin, setOrigin] = useState("");
  const [health, setHealth] = useState<Health | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const done = async (gatewayId: string, pairedNewHost: boolean) => {
    await refreshHosts();
    selectHost(gatewayId);
    router.replace(pairedNewHost || !params.hostId ? "/home" : `/settings/host/${gatewayId}/connections` as never);
  };

  const close = () => {
    if (health) void desktop()?.secureStore.delete(`pending-direct/${health.gatewayId}`);
    if (router.canGoBack()) router.back(); else router.replace("/home");
  };

  const probe = async () => {
    setError(""); setHealth(null); setPairingLink(""); setBusy(true);
    try {
      const target = connectionUri.trim() ? new URL(connectionUri.trim()).origin : normalizedOrigin(hostName, port, ssl);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8_000);
      let response: Response;
      try { response = await fetch(`${target}/jagentchill/v1/health`, { signal: controller.signal, headers: password ? { authorization: `Bearer ${password}` } : {} }); }
      finally { clearTimeout(timeout); }
      if (!response.ok) throw new Error(t("The host answered HTTP {status}.", { status: response.status }));
      const body = await response.json() as Health;
      if (!body.gatewayId || !body.gatewayPublicKey) throw new Error(t("The response did not identify a JAgentChill host."));
      const existing = hosts.find((record) => record.gatewayId === body.gatewayId);
      if (existing && existing.gatewayPublicKey !== body.gatewayPublicKey) throw new Error(t("The host identity does not match the paired host."));
      setOrigin(target); setHealth(body);
      if (existing && params.hostId === body.gatewayId) {
        const candidate: HostRecord = { ...existing, origin: target, connections: [{ id: `origin:${target}`, kind: "direct", origin: target, ...(password ? { password } : {}) }], preferredConnectionId: `origin:${target}` };
        const merged = upsertHostConnectionInProfiles(hosts, candidate).find((record) => record.gatewayId === body.gatewayId)!;
        await saveHost(migrateHostRecord(merged));
        await done(body.gatewayId, false);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  const pair = async () => {
    if (!health || !origin) return;
    const decoded = decodeOffer(pairingLink.trim());
    if (!decoded.ok) { setError(t("Paste a valid pairing link from this host.")); return; }
    if (decoded.offer.gatewayId !== health.gatewayId || decoded.offer.gatewayPublicKey !== health.gatewayPublicKey) {
      setError(t("The pairing link is for a different host.")); return;
    }
    try {
      const offer = encodeOfferUrl(offerAtDirectOrigin(decoded.offer, origin));
      if (password && desktop()) await desktop()!.secureStore.set(`pending-direct/${health.gatewayId}`, JSON.stringify({ origin, password }));
      setPairingLink(offer);
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  if (pairingLink.startsWith("jagentchill://pair#offer=") && health) {
    return <Screen title={t("Add connection")}><View style={{ flex: 1 }} /><ConnectHost initialLink={pairingLink} onClose={close} onPaired={(gatewayId) => { if (gatewayId) void done(gatewayId, true); }} /></Screen>;
  }

  return <Screen title={t("Add connection")}>
    <AdaptiveSheet open onClose={close} title={method === "direct" ? t("Direct connection") : t("Add connection")} description={method === "direct" ? t("Local network or VPN.") : undefined} width={480}
      footer={method === "direct" ? <><Button kind="ghost" label={t("Cancel")} onPress={close} /><Button kind="primary" label={health ? t("Continue to pairing") : t("Probe host")} busy={busy} disabled={busy || (!hostName.trim() && !connectionUri.trim()) || Boolean(health && !pairingLink.trim())} onPress={() => health ? void pair() : void probe()} /></> : undefined}>
      {method === null ? <View style={{ gap: space[1] }}>
        {connectionMethods(Platform.OS === "ios" || Platform.OS === "android").map(({ id, title, description, icon }) => theme.compact ? (
          <Tap key={id} role="button" testID={`add-connection-method-${id}`} label={t(title)} onPress={() => {
          if (id === "scan") { router.replace("/pair-scan" as never); return; }
          if (id === "paste") { router.replace("/pair/start" as never); return; }
          if (id === "tailscale") {
            if (Platform.OS === "ios" || Platform.OS === "android") { router.replace("/pair-scan" as never); return; }
            if (params.hostId) selectHost(params.hostId);
            router.replace("/settings/devices?pair=1" as never);
            return;
          }
          setMethod(id);
        }} style={(state) => ({ minHeight: 64, flexDirection: "row", alignItems: "center", gap: compactScale.space.gapMedium, paddingHorizontal: compactScale.space.card, paddingVertical: compactScale.space.gapSmall, borderRadius: radius.md, backgroundColor: state.hovered || state.pressed ? theme.color("bg/hover") : "transparent" })}>
            <Icon name={icon} size={compactScale.control.icon} color="text/secondary" />
            <View style={{ flex: 1, minWidth: 0, gap: space[0.5] }}>
              <Text variant="body-medium">{t(title)}</Text>
              <Text color="text/secondary" numberOfLines={2}>{t(description)}</Text>
            </View>
            <Icon name="chev-r" size={compactScale.control.icon} color="text/tertiary" />
          </Tap>
        ) : <ListRow key={id} title={t(title)} meta={t(description)} icon={icon} onPress={() => {
          if (id === "scan") { router.replace("/pair-scan" as never); return; }
          if (id === "paste") { router.replace("/pair/start" as never); return; }
          if (id === "tailscale") { if (params.hostId) selectHost(params.hostId); router.replace("/settings/devices?pair=1" as never); return; }
          setMethod(id);
        }} testID={`add-connection-method-${id}`} />)}
      </View> : <ScrollView contentContainerStyle={{ gap: space[2] }}>
        {error ? <Callout tone="danger">{error}</Callout> : null}
        {health ? <Callout tone="success">{t("Host identity confirmed: {gatewayId}.", { gatewayId: health.gatewayId })}</Callout> : null}
        <View style={{ gap: space[1] }}><Text variant="body-medium">{t("Host")}</Text><Input accessibilityLabel={t("Host")} placeholder="host.local or 192.168.1.20" value={hostName} onChangeText={setHostName} autoCapitalize="none" autoCorrect={false} /></View>
        <View style={{ gap: space[1] }}><Text variant="body-medium">{t("Port")}</Text><Input accessibilityLabel={t("Port")} value={port} onChangeText={setPort} keyboardType="number-pad" /></View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}><Switch accessibilityLabel={t("Use SSL")} label={t("Use SSL")} value={ssl} onChange={setSsl} /></View>
        <View style={{ gap: space[1] }}><Text variant="body-medium">{t("Password (optional)")}</Text><Input accessibilityLabel={t("Password (optional)")} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false} /></View>
        {!health ? <View>
          <Button kind="ghost" label={advanced ? t("Hide advanced") : t("Advanced")} onPress={() => setAdvanced(!advanced)} />
          {advanced ? <View style={{ gap: space[1] }}><Text variant="body-medium">{t("Connection URI")}</Text><Input accessibilityLabel={t("Connection URI")} mono placeholder="https://host.example:port" value={connectionUri} onChangeText={setConnectionUri} autoCapitalize="none" autoCorrect={false} /></View> : null}
        </View> : <Card padding={space[2]} style={{ gap: space[1] }}>
          <Text variant="body-medium">{t("Pair this host")}</Text>
          <Text color="text/secondary">{t("Use a pairing link created by a trusted device on this host. The six-digit confirmation still applies.")}</Text>
          <Input accessibilityLabel={t("Pairing link")} mono multiline numberOfLines={3} value={pairingLink} onChangeText={setPairingLink} placeholder="jagentchill://pair#offer=…" autoCapitalize="none" autoCorrect={false} />
        </Card>}
      </ScrollView>}
    </AdaptiveSheet>
    <View style={{ flex: 1 }} />
  </Screen>;
}
