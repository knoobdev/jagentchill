import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { binarySize, PREFS } from "@jagentchill/app-core";
import {
  CACHE_BUDGET_MAX, CACHE_BUDGET_MIN, CACHE_CATEGORIES, createPersistenceRequest, PREFERENCES, SNAPSHOT_INTERVALS, storageString, storageUsage, USAGE_CATEGORIES, type CacheCategory, type PersistenceView, type SnapshotInterval,
  type StorageLocale, type StorageUsage, type UsageCategory,
} from "@jagentchill/storage";
import { Button, Callout, GroupedSettingCard, languageOf, Segmented, Select, SettingRow, SkeletonCards, Tabs, Text, space, useTheme, useToast, type Crumb } from "@jagentchill/ui";
import { useAgentData } from "../agents/data";
import { useHost } from "../host";
import { useT } from "../locale";
import { AboutSettings, UpdatesSettings } from "../platform/AppInfoSettings";
import { persistenceEnvironment } from "../platform/media";
import { systemLanguage } from "../platform/store";
import { NotificationSettings } from "./NotificationSettings";
import { Screen } from "../shell/Shell";
import { SETTINGS_PAGES, settingsRoute } from "./nav";
import { SyncSettings } from "../sync/SyncSettings";
import { storagePrefs, useDevice, useLibraryState, usePref, useStoragePref } from "../state";

export const SETTINGS_SECTIONS = [{ id: "general", label: "General", icon: "gear" }, { id: "editing", label: "Editing", icon: "film" }, { id: "storage", label: "Storage", icon: "box" }, { id: "sync", label: "Sync", icon: "cloud" }, { id: "notifications", label: "Notifications", icon: "bell" }, { id: "updates", label: "Updates", icon: "refresh" }, { id: "about", label: "About", icon: "info" }] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]["id"];
export const isSettingsSection = (id: string | undefined): id is SettingsSection => SETTINGS_SECTIONS.some((section) => section.id === id);
const USAGE_KEY: Record<UsageCategory, Parameters<typeof storageString>[0]> = {
  Projects: "usageProjects", Media: "usageMedia", Scripts: "usageScripts", Proxies: "usageProxies", "Thumbnails and filmstrips": "usageThumbnails", Waveforms: "usageWaveforms", "Render cache": "usageRenderCache",
  "AI results": "usageAiResults", "Snapshots and backups": "usageSnapshots", Trash: "usageTrash", Caches: "usageCaches",
};
const GIB = 1024 ** 3, MIB = 1024 ** 2;
const BUDGETS = [256 * MIB, 512 * MIB, GIB, 2 * GIB, 5 * GIB, 10 * GIB, 20 * GIB, 50 * GIB, 100 * GIB].filter((bytes) => bytes >= CACHE_BUDGET_MIN && bytes <= CACHE_BUDGET_MAX);

/** The column every settings page is drawn in: the breadcrumb in the top bar, then a title, a description and the page's cards. */
export function SettingsPageFrame(props: { crumbs: Crumb[]; title: string; description?: string; actions?: ReactNode; children: ReactNode; width?: number; documentTitle?: string; /** The page draws its own title block. */ bare?: boolean }) {
  const theme = useTheme();
  return (
    <Screen title={props.title} crumbs={props.crumbs} documentTitle={props.documentTitle ?? props.title}>
      <ScrollView style={{ flex: 1, minHeight: 0 }} contentContainerStyle={{ flexGrow: 1, alignItems: "center", paddingVertical: theme.compact ? space[3] : space[6], paddingHorizontal: theme.compact ? space[3] : space[5] }}>
        <View style={{ width: "100%", maxWidth: props.width ?? 720, gap: space[3] }}>
          {/* On a narrow screen the actions wrap under the title block instead of squeezing its description into a sliver. */}
          {props.bare ? null : <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", gap: space[3] }}>
            <View style={{ flexGrow: 1, flexShrink: 1, flexBasis: 240, minWidth: 0, gap: space[1] }}>
              <Text variant="h1" level={1}>{props.title}</Text>
              {props.description ? <Text color="text/secondary">{props.description}</Text> : null}
            </View>
            {props.actions ? <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[2] }}>{props.actions}</View> : null}
          </View>}
          {props.children}
        </View>
      </ScrollView>
    </Screen>
  );
}

/** Settings of this device: appearance and language, editing defaults, and the personal storage page. Works without a host. */
export function SettingsScreen(props: { section: SettingsSection }) {
  const t = useT();
  const theme = useTheme();
  const router = useRouter();
  const page = SETTINGS_PAGES.find((entry) => entry.id === props.section)!;
  const crumbs: Crumb[] = [{ id: "settings", label: t("Settings"), onPress: () => router.push("/settings" as never) }, { id: page.id, label: t(page.label) }];
  const tabs = theme.compact ? <ScrollView horizontal showsHorizontalScrollIndicator={false}><Tabs id="settings-section" variant="pill" label={t("Settings")} value={props.section} onChange={(id) => router.push(`/settings/${id}` as never)} items={SETTINGS_SECTIONS.map((section) => ({ id: section.id, label: t(SETTINGS_PAGES.find((entry) => entry.id === section.id)!.label) }))} /></ScrollView> : null;
  return (
    <SettingsPageFrame crumbs={crumbs} title={t(page.label)}>
      {tabs}
      {props.section === "general" ? <General /> : props.section === "editing" ? <Editing /> : props.section === "sync" ? <SyncSettings /> : props.section === "updates" ? <UpdatesSettings /> : props.section === "notifications" ? <NotificationSettings /> : props.section === "about" ? <AboutSettings /> : <Storage />}
    </SettingsPageFrame>
  );
}

/** The landing page: every page of the tree as a row, personal pages first. */
export function SettingsLanding() {
  const t = useT();
  const router = useRouter();
  const { host, status } = useHost();
  const agents = useAgentData();
  const [orc, setOrc] = useState<{ roles: Array<{ state: string }> } | null>(null);
  const [secrets, setSecrets] = useState<number | null>(null);
  const { connection, secrets: secretRoute, can } = useHost();
  useEffect(() => {
    if (!connection) { setOrc(null); setSecrets(null); return; }
    void connection.call<{ roles: Array<{ state: string }> }>("jagentchill.orc.config.get", {}).then(setOrc).catch(() => undefined);
    if (can("jagentchill.secrets.manage")) void secretRoute?.list().then((list) => setSecrets(list.length)).catch(() => undefined);
  }, [connection]); // eslint-disable-line react-hooks/exhaustive-deps
  const connected = agents.catalogue ? agents.providers.filter((provider) => provider.connected).length + agents.catalogue.groups.filter((group) => group.kind === "cli" && group.readiness === "ready").length + agents.endpoints.length : null;
  const failing = orc?.roles.filter((role) => role.state === "primary_failing").length ?? 0;
  const summary: Record<string, string | undefined> = {
    runtimes: connected === null ? undefined : t("{n} providers · {m} connected", { n: agents.providers.length + (agents.catalogue?.groups.filter((group) => group.kind === "cli").length ?? 0) + agents.endpoints.length, m: connected }),
    "model-routing": orc ? (failing ? t("{n} roles · {m} primary failing", { n: orc.roles.length, m: failing }) : t("{n} roles · {m} configured", { n: orc.roles.length, m: orc.roles.filter((role) => role.state === "ready").length })) : undefined,
    secrets: secrets === null ? undefined : secrets === 1 ? t("1 secret") : t("{n} secrets", { n: secrets }),
  };
  const rows = (group: "personal" | "host") => SETTINGS_PAGES.filter((page) => page.group === group).map((page, index, all) => (
    <SettingRow key={page.id} icon={page.icon} label={t(page.label)} testID={`settings-landing-${page.id}`} description={summary[page.id] ?? t(page.description)} last={index === all.length - 1} requiresHost={group === "host"}
      onPress={() => { const route = settingsRoute(page, host?.gatewayId); if (route) router.push(route as never); }} />
  ));
  return (
    <SettingsPageFrame crumbs={[{ id: "settings", label: t("Settings") }]} title={t("Settings")} width={560}
      description={host ? t("Personal settings stay on this device. Host settings are stored on {host} and shared with every paired device.", { host: host.gatewayName }) : t("Personal settings stay on this device. Host settings appear when a host is connected.")}>
      <Text variant="body-medium" level={2} style={{ marginTop: space[3] }}>{t("Personal · stored on this device")}</Text>
      <GroupedSettingCard>{rows("personal")}</GroupedSettingCard>
      <Text variant="body-medium" level={2} style={{ marginTop: space[3] }}>{host ? `${t("Host")} · ${host.gatewayName}` : t("Host")}</Text>
      {status === "connected" || host ? <GroupedSettingCard>{rows("host")}</GroupedSettingCard> : <Callout tone="info" actions={[{ label: t("Connect a host"), onPress: () => router.push("/pair/start" as never) }]}>{t("Providers, model routing and secrets belong to a host. Connect one to set them up.")}</Callout>}
    </SettingsPageFrame>
  );
}

function General() {
  const t = useT();
  const theme = useTheme();
  const [language, setLanguage] = usePref(PREFS.language);
  return (
    <GroupedSettingCard>
      <SettingRow label={t("Theme")} description={t("System follows the appearance of this device.")}>
        <Segmented label={t("Theme")} value={theme.preference} onChange={(value) => theme.setPreference(value)} options={[{ value: "system", label: t("System") }, { value: "light", label: t("Light") }, { value: "dark", label: t("Dark") }]} />
      </SettingRow>
      <SettingRow label={t("Language")} last>
        <Select label={t("Language")} width={180} value={language ?? "system"} onChange={(value) => setLanguage(value === "system" ? null : value)}
          options={[{ value: "system", label: t("System ({language})", { language: languageOf(systemLanguage()).toUpperCase() }) }, { value: "en", label: "English" }, { value: "vi", label: "Tiếng Việt" }, { value: "ja", label: "日本語" }]} />
      </SettingRow>
    </GroupedSettingCard>
  );
}

function Editing() {
  const t = useT();
  const [interval, setInterval] = useStoragePref(PREFERENCES.snapshotInterval);
  const [keep, setKeep] = useStoragePref(PREFERENCES.snapshotsToKeep);
  return (
    <GroupedSettingCard>
      <SettingRow label={t("Version snapshot interval")} description={t("How often an automatic version is kept while a project is open.")}>
        <Select label={t("Version snapshot interval")} width={160} value={String(interval)} onChange={(value) => setInterval((value === "off" ? "off" : Number(value)) as SnapshotInterval)}
          options={SNAPSHOT_INTERVALS.map((value) => ({ value: String(value), label: value === "off" ? t("Off") : value === 1 ? t("1 minute") : t("{n} minutes", { n: value }) }))} />
      </SettingRow>
      <SettingRow label={t("Automatic snapshots to keep")} description={t("Older automatic versions are removed. Saved versions are kept.")} last>
        <Select label={t("Automatic snapshots to keep")} width={160} value={String(keep)} onChange={(value) => setKeep(Number(value))} options={[10, 20, 50, 100, 200].map((value) => ({ value: String(value), label: String(value) }))} />
      </SettingRow>
    </GroupedSettingCard>
  );
}

/** The personal storage page: usage by category and per project, cache budget, "Clear" per cache category and "Clear all caches". */
function Storage() {
  const t = useT();
  const theme = useTheme();
  const toast = useToast();
  const router = useRouter();
  const { storage } = useDevice();
  const library = useLibraryState();
  const locale = languageOf(theme.locale) as StorageLocale;
  const s = useCallback((key: Parameters<typeof storageString>[0], values?: Record<string, string | number>) => storageString(key, values, locale), [locale]);
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [available, setAvailable] = useState<number | null>(null);
  const [budget, setBudget] = useState<number | null>(null);
  const persistence = useMemo(() => createPersistenceRequest(persistenceEnvironment(), storagePrefs, Date.now, locale), [locale]);
  const [persist, setPersist] = useState<PersistenceView | null>(null);
  const [failed, setFailed] = useState(false);
  const refresh = useCallback(async () => {
    if (!storage) return;
    try {
      setFailed(false);
      setUsage(await storageUsage(storage));
      setAvailable(await storage.available().catch(() => null));
      setBudget(await storage.cache.budget().catch(() => null));
    } catch { setFailed(true); }
  }, [storage]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { void (async () => { await persistence.onProjectsScreen(); setPersist(persistence.view()); })(); }, [persistence]);
  const clear = async (category?: CacheCategory) => {
    if (!storage) return;
    const freed = await storage.cache.clear(category);
    toast.show({ kind: "success", message: t("{size} freed", { size: binarySize(freed) }) });
    await refresh();
  };
  if (failed) return <Callout tone="danger" actions={[{ label: t("Retry"), onPress: () => void refresh() }]}>{t("Storage could not be read.")}</Callout>;
  if (!storage || !usage) return <View testID="storage-skeleton"><SkeletonCards cards={2} rows={3} /></View>;
  const names = new Map(library.projects.map((project) => [project.id, project.name || t("Unreadable project")]));
  const projects = Object.entries(usage.byProject).filter(([, bytes]) => bytes > 0).sort((a, b) => b[1] - a[1]);
  return (
    <>
      <View testID="storage-total" style={{ gap: space[1] }}>
        <Text variant="title-sm" level={2}>{t("{used} used", { used: binarySize(usage.total) })}</Text>
        <Text color="text/secondary">{available === null ? t("This browser does not report free space.") : t("{available} available on this device", { available: binarySize(available) })}</Text>
      </View>
      {persist?.storagePage ? <Callout tone="warning" actions={[{ label: persist.storagePage.action.label, onPress: () => void persistence.requestAgain().then((view) => { setPersist(view); toast.show({ kind: view.persisted ? "success" : "warning", message: view.persisted ? t("Storage is now persistent") : s("browserCanClear") }); }) }]}>{persist.storagePage.text}</Callout> : null}
      <GroupedSettingCard>
        {USAGE_CATEGORIES.filter((category) => category !== "Caches" || usage.byCategory.Caches > 0).map((category, index, all) => (
          <SettingRow key={category} label={s(USAGE_KEY[category])} last={index === all.length - 1}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
              <Text tabular color="text/secondary" testID={`usage-${category}`}>{binarySize(usage.byCategory[category])}</Text>
              {(CACHE_CATEGORIES as readonly string[]).includes(category) ? <Button size="xs" label={s("clear")} disabled={usage.byCategory[category] === 0} onPress={() => void clear(category as CacheCategory)} />
                : category === "Trash" ? <Button size="xs" label={t("Open trash")} onPress={() => router.push("/projects/trash" as never)} /> : null}
            </View>
          </SettingRow>
        ))}
      </GroupedSettingCard>
      <GroupedSettingCard>
        <SettingRow label={t("Cache size limit")} description={t("Proxies, thumbnails, waveforms and render cache are removed, least recently used first, when the limit is reached.")}>
          <Select label={t("Cache size limit")} width={140} value={budget === null ? null : String(BUDGETS.reduce((best, bytes) => (Math.abs(bytes - budget) < Math.abs(best - budget) ? bytes : best), BUDGETS[0]))} options={BUDGETS.map((bytes) => ({ value: String(bytes), label: binarySize(bytes) }))}
            onChange={(value) => void storage.cache.setBudget(Number(value)).then(async (stored) => { setBudget(stored); await refresh(); })} />
        </SettingRow>
        <SettingRow label={s("clearAllCaches")} description={t("Originals, projects, snapshots and backups are never removed.")} last>
          <Button size="sm" label={s("clearAllCaches")} testID="clear-all-caches" onPress={() => void clear()} />
        </SettingRow>
      </GroupedSettingCard>
      {projects.length > 0 ? (
        <View style={{ gap: space[2] }}>
          <Text variant="body-medium" level={2}>{t("By project")}</Text>
          <GroupedSettingCard>
            {projects.map(([id, bytes], index) => <SettingRow key={id} label={names.get(id) ?? id} last={index === projects.length - 1}><Text tabular color="text/secondary">{binarySize(bytes)}</Text></SettingRow>)}
          </GroupedSettingCard>
        </View>
      ) : null}
    </>
  );
}
