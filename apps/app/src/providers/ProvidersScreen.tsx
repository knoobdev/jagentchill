import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { ACCESS_METHOD_LABEL, type AccessMethod, formatList } from "@jagentchill/app-core";
import type { ProviderGroup, ProviderListing, RuntimeCapabilities } from "@jagentchill/protocol";
import { Avatar, Button, Callout, Card, Chip, Dot, Icon, SearchField, Spinner, Tabs, Tap, Text, size, space, useTheme, type Crumb, SkeletonCards, SkeletonTable, inlineIcon } from "@jagentchill/ui";
import { useAgentData } from "../agents/data";
import { reasonOf } from "../agents/errors";
import { hostSettingsRoute } from "../agents/ModelBrowser";
import { useHost } from "../host";
import { useT } from "../locale";
import { providerCatalogLayout, stacksSettingsRows } from "../pairing/mobile-settings-layout";
import { SettingsPageFrame } from "../settings/SettingsScreen";
import { ConnectSheet } from "./ConnectSheet";
import { EndpointsTab } from "./EndpointsTab";
import { GenerationTab } from "../generation/GenerationTab";
import { GROUP_LABEL, PROVIDER_TABS, accessWords, groupFilters, healthOf, otherProviders, type ProviderTabId } from "./providers-model";
import { RuntimesTab } from "./RuntimesTab";

// Agents run through the CLIs installed on the host. Each CLI runs on its own account, or on an API key or a custom
// endpoint stored on the host and chosen for it under CLI runtimes (the host hands it to the CLI's process only).
export { PROVIDER_TABS };
type TabId = ProviderTabId;

/** What a row is used through: an installed CLI, a custom endpoint, or a key / sign-in stored on the host. */
type RowMethod = AccessMethod | "api-key" | "sign-in";
const ROW_METHOD_LABEL: Record<RowMethod, string> = { ...ACCESS_METHOD_LABEL, "api-key": "API key", "sign-in": "Account sign-in" };
type VendorRow = { id: string; label: string; methods: RowMethod[]; connection: string; tone: "success" | "warning" | "danger" | "off"; models: number; open(): void };

/** Host ▸ Providers: every way a model is reached on this host — installed CLIs, account sign-in, API keys, custom endpoints. */
export function ProvidersScreen(props: { tab?: string }) {
  const t = useT();
  const theme = useTheme();
  const router = useRouter();
  const { host, status, can } = useHost();
  const data = useAgentData();
  const tab: TabId = PROVIDER_TABS.some((entry) => entry.id === props.tab) ? (props.tab as TabId) : "providers";
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<ProviderGroup | "all">("all");
  const [connecting, setConnecting] = useState<ProviderListing | null>(null);
  const admin = can("jagentchill.config.write");
  const go = (id: string) => host && router.push(hostSettingsRoute(host.gatewayId, "runtimes", id === "providers" ? undefined : id) as never);
  const crumbs: Crumb[] = [{ id: "settings", label: t("Settings"), onPress: () => router.push("/settings" as never) }, { id: "host", label: host?.gatewayName ?? t("Host") }, { id: "providers", label: t("Providers") }];
  const needle = query.trim().toLowerCase();

  // One row per agent CLI, per provider with a stored key or sign-in, and per endpoint.
  const connected = useMemo<VendorRow[]>(() => {
    const rows: VendorRow[] = [];
    for (const runtime of data.catalogue?.groups.filter((entry) => entry.kind === "cli") ?? []) {
      const ready = runtime.readiness === "ready";
      rows.push({ id: `cli-${runtime.runtimeId}`, label: runtime.label, methods: ["cli"], connection: ready ? "Signed in" : runtime.readiness === "needs-auth" ? "Signed out" : runtime.readiness === "needs-install" ? "Not installed" : runtime.readiness === "loading" ? "Checking" : "Error",
        tone: ready ? "success" : runtime.readiness === "error" ? "danger" : runtime.readiness === "needs-auth" ? "warning" : "off", models: runtime.providers.reduce((sum, entry) => sum + entry.models.length, 0), open: () => go("runtimes") });
    }
    for (const provider of data.providers.filter((entry) => entry.group !== "custom" && entry.profiles.some((profile) => profile.type !== "cli-login"))) {
      const keys = provider.profiles.filter((profile) => profile.type !== "cli-login");
      const worst = keys.find((profile) => profile.health !== "ok") ?? keys[0];
      const health = healthOf(worst);
      const using = (data.catalogue?.groups ?? []).filter((group) => group.providers.some((entry) => entry.providerId === provider.providerId && entry.models.length));
      rows.push({ id: provider.providerId, label: provider.label, methods: [...new Set(keys.map((profile): RowMethod => (profile.type === "api-key" ? "api-key" : "sign-in")))], connection: health.label,
        tone: health.tone === "success" ? "success" : health.tone === "danger" ? "danger" : health.tone === "warning" ? "warning" : "off", models: using.reduce((sum, group) => sum + (group.providers.find((entry) => entry.providerId === provider.providerId)?.models.length ?? 0), 0), open: () => setConnecting(provider) });
    }
    for (const endpoint of data.endpoints) rows.push({ id: `endpoint-${endpoint.id}`, label: endpoint.label, methods: ["endpoint"], connection: !endpoint.enabled ? "Turned off" : endpoint.projected ? "Connected" : "Not ready", tone: !endpoint.enabled ? "off" : endpoint.projected ? "success" : "warning", models: endpoint.models.filter((model) => model.enabled).length, open: () => go("endpoints") });
    return rows;
  }, [data.catalogue, data.providers, data.endpoints]); // eslint-disable-line react-hooks/exhaustive-deps
  const others = otherProviders(data.providers, { tab, group, needle });
  useEffect(() => { setQuery(""); }, [tab]);

  const table = (rows: VendorRow[]) => stacksSettingsRows(theme.width) ? (
    <Card padding={0}>
      {rows.map((row, index) => (
        <Tap key={row.id} role="button" label={row.label} testID={`provider-row-${row.id}`} onPress={row.open}
          style={(state) => ({ gap: space[2], minHeight: 72, padding: space[3], borderTopWidth: index ? 1 : 0, borderTopColor: theme.color("border/hairline"), backgroundColor: state.hovered || state.pressed ? theme.color("bg/hover") : "transparent" })}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
            <Avatar name={row.label} id={row.id} square size={20} />
            <Text variant="body-medium" numberOfLines={1} style={{ flex: 1 }}>{row.label}</Text>
            <Text numberOfLines={1} color={row.tone === "danger" ? "danger/text" : row.tone === "off" ? "text/secondary" : "text/primary"}>{t(row.connection)}</Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space[1] }}>
            <Text variant="meta" color="text/secondary">{t("Used through")}</Text>
            {row.methods.map((method) => <Chip key={method} size="sm" label={t(ROW_METHOD_LABEL[method])} />)}
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space[1] }}>
            <Dot tone={row.tone} label={t(row.connection)} />
            <Text variant="meta" color="text/secondary" style={{ flex: 1 }}>{t("Health")}</Text>
            <Text variant="meta" color="text/secondary">{t("Models")}: {row.models || "—"}</Text>
          </View>
        </Tap>
      ))}
    </Card>
  ) : (
    <Card padding={0}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], height: 32, paddingHorizontal: space[3], backgroundColor: theme.color("bg/sidebar"), borderBottomWidth: 1, borderBottomColor: theme.color("border/hairline") }}>
        <Text variant="meta" color="text/secondary" style={{ flex: 3 }}>{t("Provider")}</Text>
        <Text variant="meta" color="text/secondary" style={{ flex: 3 }}>{t("Used through")}</Text>
        <Text variant="meta" color="text/secondary" style={{ flex: 2 }}>{t("Connection")}</Text>
        <Text variant="meta" color="text/secondary" style={{ width: 48 }}>{t("Health")}</Text>
        <Text variant="meta" color="text/secondary" style={{ width: 64 }} align="right">{t("Models")}</Text>
      </View>
      {rows.map((row, index) => (
        <Tap key={row.id} role="button" label={row.label} testID={`provider-row-${row.id}`} onPress={row.open}
          style={(state) => ({ flexDirection: "row", alignItems: "center", gap: space[2], minHeight: 36, paddingHorizontal: space[3], borderTopWidth: index ? 1 : 0, borderTopColor: theme.color("border/hairline"), backgroundColor: state.hovered || state.pressed ? theme.color("bg/hover") : "transparent" })}>
          <View style={{ flex: 3, flexDirection: "row", alignItems: "center", gap: space[2], minWidth: 0 }}><Avatar name={row.label} id={row.id} square size={20} /><Text variant="body-medium" numberOfLines={1} style={{ flexShrink: 1 }}>{row.label}</Text></View>
          <View style={{ flex: 3, flexDirection: "row", flexWrap: "wrap", gap: space[1] }}>{row.methods.map((method) => <Chip key={method} size="sm" label={t(ROW_METHOD_LABEL[method])} />)}</View>
          <Text numberOfLines={1} color={row.tone === "danger" ? "danger/text" : row.tone === "off" ? "text/secondary" : "text/primary"} style={{ flex: 2 }}>{t(row.connection)}</Text>
          <View style={{ width: 48 }}><Dot tone={row.tone} label={t(row.connection)} /></View>
          <Text tabular color="text/secondary" style={{ width: 64 }} align="right">{row.models || "—"}</Text>
        </Tap>
      ))}
    </Card>
  );
  const providerList = (list: ProviderListing[]) => (
    <Card padding={0}>
      {list.length === 0 ? <View style={{ padding: space[3] }}><Text color="text/secondary">{t("No providers match your search")}</Text></View> : list.map((provider, index) => {
        const compact = providerCatalogLayout(theme.width) === "stacked";
        const accounts = provider.profiles.length ? (provider.profiles.length === 1 ? t("1 account") : t("{n} accounts", { n: provider.profiles.length })) : null;
        const accessDescription = [...accessWords(provider).map((kind) => t(kind)), accounts].filter(Boolean).join(" · ") || provider.description;
        return (
          <Tap key={provider.providerId} role="button" label={provider.label} testID={`provider-${provider.providerId}`} onPress={() => setConnecting(provider)}
            style={(state) => ({ flexDirection: compact ? "column" : "row", alignItems: compact ? "stretch" : "center", gap: compact ? space[1] : space[2], minHeight: compact ? 76 : 44, paddingHorizontal: space[3], paddingVertical: compact ? space[2] : space[1.5], borderTopWidth: index ? 1 : 0, borderTopColor: theme.color("border/hairline"), backgroundColor: state.hovered || state.pressed ? theme.color("bg/hover") : "transparent" })}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], minWidth: 0, flex: compact ? undefined : 1 }}>
              <Avatar name={provider.label} id={provider.providerId} square size={20} />
              <Text variant="body-medium" numberOfLines={compact ? 2 : 1} style={{ flex: 1, minWidth: 0 }}>{provider.label}</Text>
              {!compact ? <Text variant="meta" color="text/secondary" numberOfLines={1} style={{ flexShrink: 1 }}>{accessDescription}</Text> : null}
              {!compact ? <Text color={provider.connected ? "success/text" : "text/secondary"}>{t(provider.connected ? "Connected" : "Not connected")}</Text> : null}
              <Icon name={inlineIcon(theme.rtl, "chev-r")} size={14} color="text/secondary" />
            </View>
            {compact ? <Text variant="meta" color="text/secondary" numberOfLines={2} style={{ marginStart: 28 }}>{accessDescription}</Text> : null}
            {compact ? <View style={{ flexDirection: "row", alignItems: "center", gap: space[1], marginStart: 28 }}><Dot tone={provider.connected ? "success" : "off"} label={t(provider.connected ? "Connected" : "Not connected")} /><Text variant="meta" color={provider.connected ? "success/text" : "text/secondary"}>{t(provider.connected ? "Connected" : "Not connected")}</Text></View> : null}
          </Tap>
        );
      })}
    </Card>
  );
  const filters = (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[2] }}>
      <View style={{ width: 240 }}><SearchField label={t("Search providers")} placeholder={t("Search providers…")} size="sm" value={query} onChangeText={setQuery} debounce={0} /></View>
      {groupFilters(data.providers).map((id) => <Chip key={id} size="md" label={id === "all" ? t("All") : t(GROUP_LABEL[id])} selected={group === id} onPress={() => setGroup(id)} />)}
    </View>
  );

  let body: React.ReactNode;
  if (status !== "connected") body = <Callout tone="info">{t("Connect to this host to see runtimes")}</Callout>;
  else if (!data.catalogue && data.error) body = <Callout tone="danger" actions={[{ label: t("Retry"), onPress: () => data.reload() }]}>{reasonOf(data.error)}</Callout>;
  else if (!data.catalogue) body = <SkeletonCards cards={2} rows={3} style={{ padding: space[4] }} />;
  else if (tab === "runtimes") body = <RuntimesTab />;
  else if (tab === "endpoints") body = <EndpointsTab />;
  else if (tab === "matrix") body = <Matrix />;
  else if (tab === "generation") body = <GenerationTab />;
  else if (tab === "keys") {
    body = (
      <>
        <Text variant="meta" color="text/secondary">{t("Sign in with your account at the provider, or enter an API key. Both are stored on {host} and never sent to other devices.", { host: host?.gatewayName ?? "" })}</Text>
        <Text variant="meta" color="text/secondary">{t("A CLI runs on a key only when you choose it for that CLI under CLI runtimes; otherwise each CLI uses its own account.")}</Text>
        {filters}
        {providerList(others)}
      </>
    );
  } else {
    body = (
      <>
        {connected.length ? table(connected.filter((row) => !needle || row.label.toLowerCase().includes(needle))) : <Callout tone="info">{t("Nothing is connected yet. Use an installed CLI, sign in to a provider, enter an API key, or add your own endpoint.")}</Callout>}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
          <Button size="sm" icon="kbd" label={t("Use an installed CLI")} onPress={() => go("runtimes")} />
          <Button size="sm" icon="user" label={t("Sign in or add an API key")} testID="open-keys" onPress={() => go("keys")} />
          <Button size="sm" icon="link" label={t("Add a custom endpoint")} testID="open-endpoints" onPress={() => go("endpoints")} />
        </View>
        <Text variant="body-medium" level={2} style={{ marginTop: space[3] }}>{t("More providers")}</Text>
        {filters}
        {providerList(needle || group !== "all" ? others : others.slice(0, 8))}
        {!needle && group === "all" && others.length > 8 ? <Text variant="meta" color="text/secondary">{t("{n} more providers — search to find them", { n: others.length - 8 })}</Text> : null}
      </>
    );
  }
  return (
    <SettingsPageFrame crumbs={crumbs} title={t("Providers")} width={760}
      description={t("Use a provider through an installed CLI, an account sign-in or an API key — or bring your own endpoint. Keys are stored on {host} and are never sent to clients.", { host: host?.gatewayName ?? t("the host") })}
      actions={admin && tab === "providers" ? <Button kind="primary" size="sm" icon="plus" label={t("Add provider")} testID="add-provider" onPress={() => go("keys")} /> : admin && tab === "runtimes" ? <Button kind="primary" size="sm" label={t("Set up models")} onPress={() => router.push("/home?setup=1" as never)} /> : undefined}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}><Tabs id="providers" label={t("Providers")} value={tab} onChange={go} items={PROVIDER_TABS.map((entry) => ({ id: entry.id, label: t(entry.label) }))} /></ScrollView>
      {body}
      <ConnectSheet provider={connecting} onClose={() => setConnecting(null)} onOpenRuntimes={() => { setConnecting(null); go("runtimes"); }} />
    </SettingsPageFrame>
  );
}

const yes = (value: boolean) => (value ? "Yes" : "No");
const MODE_NAMES = [{ id: "ask", label: "Ask" }, { id: "plan", label: "Plan" }, { id: "edit", label: "Edit" }, { id: "auto", label: "Auto" }] as const;
const MATRIX_ROWS: Array<{ label: string; value(flags: RuntimeCapabilities, full: boolean): string | string[] }> = [
  { label: "Editor tools", value: (f) => (f.jcTools === "native" ? "Built in" : f.jcTools === "bridge" ? "Through the tool bridge" : "No") },
  { label: "Messages during a turn", value: (f) => (f.steer ? "Steer" : "Queued until the turn ends") },
  { label: "Ask / Plan / Edit / Auto", value: (f, full) => { if (full) return "Own permissions only"; const modes = MODE_NAMES.filter((mode) => f.productModes[mode.id]?.supported).map((mode) => mode.label); return modes.length ? modes : "None"; } },
  { label: "Mode change during a turn", value: (f) => (f.liveModeChange ? "At once" : "After the turn") },
  { label: "Thinking levels", value: (f) => yes(f.thinking) },
  { label: "Image attachments", value: (f) => yes(f.attachments.image) },
  { label: "Host command approvals", value: (f, full) => (full ? "The runtime decides" : f.approvals === "host" ? "On your devices" : f.approvals === "relayed" ? "Relayed" : f.approvals === "runtime" ? "The runtime decides" : "None") },
  { label: "Fork a session", value: (f) => yes(f.fork) },
  { label: "Usage reported", value: (f) => (f.usage === "tokens-and-cost" ? "Tokens and cost" : f.usage === "tokens" ? "Tokens" : "Not reported") },
  { label: "Sub-agents", value: (f) => yes(f.subAgents) },
];
/** The published capability matrix: what each enabled runtime can do, side by side. */
function Matrix() {
  const t = useT();
  const theme = useTheme();
  const cell = (value: string | string[]) => (typeof value === "string" ? t(value) : formatList(value.map((entry) => t(entry)), "unit", theme.locale));
  const { connection } = useHost();
  const [matrix, setMatrix] = useState<Record<string, { label: string; flags: RuntimeCapabilities; requiresFullAccess: boolean }> | null>(null);
  const [focused, setFocused] = useState(false);
  useEffect(() => { void connection?.call<{ runtimes: Record<string, { label: string; flags: RuntimeCapabilities; requiresFullAccess: boolean }> }>("jagentchill.runtime.matrix.get", {}).then((result) => setMatrix(result.runtimes)).catch(() => setMatrix({})); }, [connection]);
  if (!matrix) return <SkeletonTable rows={5} columns={4} style={{ padding: space[4] }} />;
  const ids = Object.keys(matrix);
  return (
    <ScrollView horizontal {...({ tabIndex: 0, role: "region", "aria-label": t("Capability") } as object)}
      // A scrollable region is a keyboard stop (it scrolls with the arrow keys), so it shows the focus ring — inset, the page clips an offset one.
      onFocus={(event) => setFocused((event.target as unknown as { matches?(selector: string): boolean }).matches?.(":focus-visible") ?? true)} onBlur={() => setFocused(false)}
      style={focused ? { outlineWidth: size.focusRing, outlineColor: theme.color("accent"), outlineStyle: "solid", outlineOffset: -size.focusRing } : null}>
      <View testID="capability-matrix">
        <View style={{ flexDirection: "row", backgroundColor: theme.color("bg/sidebar"), borderBottomWidth: 1, borderBottomColor: theme.color("border/hairline") }}>
          <View style={{ width: 200, padding: space[2] }}><Text variant="meta" color="text/secondary">{t("Capability")}</Text></View>
          {ids.map((id) => <View key={id} style={{ width: 150, padding: space[2] }}><Text variant="body-medium" numberOfLines={1}>{matrix[id].label}</Text></View>)}
        </View>
        {MATRIX_ROWS.map((row) => (
          <View key={row.label} style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: theme.color("border/hairline") }}>
            <View style={{ width: 200, padding: space[2] }}><Text>{t(row.label)}</Text></View>
            {ids.map((id) => <View key={id} style={{ width: 150, padding: space[2] }}><Text variant="meta" color="text/secondary">{cell(row.value(matrix[id].flags, matrix[id].requiresFullAccess))}</Text></View>)}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}
