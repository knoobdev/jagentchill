import { usePathname, useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { Badge, ListCaption, ListRow, SearchField, Tap, Text, Icon, control, radius, space, useTheme, type IconName, inlineIcon } from "@jagentchill/ui";
import { useHost } from "../host";
import { useT } from "../locale";
import { HOST_SETTINGS_NAV_ITEMS } from "./host-settings-model";

/** The screen "Back to app" returns to: the last one shown outside Settings. */
export const appRoute = { last: "/home" };
export type SettingsPage = { id: string; label: string; icon: IconName; description: string; group: "personal" | "host"; route?: string; isNew?: boolean };
/** The settings tree: the pages this build has. Personal pages work without a host; host pages belong to the connected host. */
export const SETTINGS_PAGES: readonly SettingsPage[] = [
  { id: "general", label: "Preferences", icon: "sliders", description: "Appearance, language and region, composer", group: "personal" },
  { id: "editing", label: "Editing defaults", icon: "split", description: "Version snapshots and how many are kept", group: "personal" },
  { id: "storage", label: "Storage", icon: "db", description: "Usage on this device, caches", group: "personal" },
  { id: "sync", label: "Sync", icon: "cloud", description: "What syncs with your host, transfer limits, your library", group: "personal" },
  { id: "notifications", label: "Notifications", icon: "bell", description: "What is shown outside the app, and for which kinds", group: "personal" },
  { id: "updates", label: "Updates", icon: "refresh", description: "Installed version, checking for and installing updates", group: "personal" },
  { id: "about", label: "About", icon: "info", description: "Version and build", group: "personal" },
  { id: "runtimes", label: "Providers", icon: "cloud", description: "Installed CLIs, their sign-in and custom endpoints", group: "host" },
  ...HOST_SETTINGS_NAV_ITEMS,
  { id: "model-routing", label: "Model routing (ORC)", icon: "flow", description: "Which model each role uses, with ordered fallbacks", group: "host", isNew: true },
  { id: "secrets", label: "Secrets", icon: "key", description: "Names of the keys stored on the host", group: "host" },
  { id: "usage", label: "Usage and limits", icon: "graph", description: "What agents used, by provider, project and session; spending limits", group: "host" },
  { id: "host-storage", label: "Storage on host", icon: "db", description: "Synced projects, media and the host trash", group: "host" },
  { id: "skills", label: "Skills", icon: "spark", description: "Reusable agent instructions: install, enable, create and train them", group: "host" },
];
export const settingsRoute = (page: SettingsPage, hostId: string | undefined): string | null =>
  page.route ?? (page.group === "personal" ? `/settings/${page.id}` : hostId ? `/settings/host/${hostId}/${page.id}` : null);
export const currentSettingsPage = (pathname: string): string | null => /^\/settings\/host\/[^/]+\/([^/]+)/.exec(pathname)?.[1] ?? /^\/settings\/([^/]+)/.exec(pathname)?.[1] ?? null;

/** The settings navigation column: it replaces the app sidebar while Settings is open. */
export function SettingsNav(props: { width: number }) {
  const t = useT();
  const theme = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const shellHost = useHost();
  const [query, setQuery] = useState("");
  const current = currentSettingsPage(pathname);
  const needle = query.trim().toLowerCase();
  const shown = SETTINGS_PAGES.filter((page) => !needle || t(page.label).toLowerCase().includes(needle) || t(page.description).toLowerCase().includes(needle));
  // "Devices" now lives inside Settings: going "back" to it would land on a settings page again and never leave.
  const back = () => router.push((/^\/(devices|settings|pair)(\/|$)/.test(appRoute.last) ? "/home" : appRoute.last) as never);
  const row = (page: SettingsPage) => {
    const route = settingsRoute(page, shellHost.host?.gatewayId);
    return <ListRow key={page.id} title={t(page.label)} icon={page.icon} selected={current === page.id} current="page" testID={`settings-${page.id}`} requiresHost={page.group === "host"} hideBadge
      trailing={page.isNew ? <Badge kind="new" label={t("New")} /> : undefined} onPress={() => route && router.push(route as never)} />;
  };
  const personal = shown.filter((page) => page.group === "personal"), hostPages = shown.filter((page) => page.group === "host");
  return (
    <View testID="settings-nav" role="navigation" aria-label={t("Settings")} style={{ width: props.width, alignSelf: "stretch", backgroundColor: theme.color("bg/sidebar"), borderEndWidth: 1, borderEndColor: theme.color("border/hairline"), paddingHorizontal: space[2] }}>
      <Tap role="button" label={t("Back to app")} onPress={back} testID="settings-back"
        style={(state) => ({ height: control.md, marginTop: space[2], flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[2], borderRadius: radius.sm, backgroundColor: state.hovered || state.pressed ? theme.color("bg/hover") : "transparent" })}>
        <Icon name={inlineIcon(theme.rtl, "arrow-l")} size={14} color="text/secondary" />
        <Text color="text/secondary">{t("Back to app")}</Text>
      </Tap>
      <View style={{ paddingVertical: space[1] }}><SearchField label={t("Search settings")} placeholder={t("Search settings")} size="sm" value={query} onChangeText={setQuery} debounce={0} /></View>
      <ScrollView>
        {personal.length ? <><ListCaption label={t("Personal")} />{personal.map(row)}</> : null}
        {hostPages.length ? <><ListCaption label={shellHost.host ? `${t("Host")} · ${shellHost.host.gatewayName}` : t("Host")} />{hostPages.map(row)}</> : null}
        {shown.length === 0 ? <View style={{ padding: space[2] }}><Text color="text/secondary">{t("No results")}</Text></View> : null}
      </ScrollView>
    </View>
  );
}
