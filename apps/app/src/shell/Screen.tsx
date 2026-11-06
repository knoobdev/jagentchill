import { usePathname, useRouter } from "expo-router";
import { useEffect, type ReactNode } from "react";
import { View } from "react-native";
import { documentTitle, hostScope } from "@jagentchill/app-core";
import { Breadcrumb, Button, Icon, IconButton, Text, compactScale, layout, space, useInsets, useTheme, type Crumb } from "@jagentchill/ui";
import { useHost } from "../host";
import { useT } from "../locale";
import { setDocumentTitle } from "../platform/store";
import { screenScaffoldMetrics } from "./safeArea.ts";
import { useShell } from "./ShellState";

export type ScreenProps = {
  /** The title of the screen, or its breadcrumb. */
  title: ReactNode;
  crumbs?: Crumb[];
  actions?: ReactNode;
  children: ReactNode;
  /** "<item or screen> — JAgentChill"; defaults to the title when it is text. */
  documentTitle?: string;
  /** Screens of the editor draw their own bar. */
  bare?: boolean;
};

/** A screen of the content region: the 48 px top bar (56 px on compact form factors) above its content. */
export function Screen(props: ScreenProps) {
  const t = useT();
  const theme = useTheme();
  const insets = useInsets();
  const barHeight = theme.compact ? layout.topBarTouch : layout.topBar;
  const safe = screenScaffoldMetrics(insets, theme.compact, barHeight);
  const shell = useShell();
  const pathname = usePathname();
  const name = props.documentTitle ?? (typeof props.title === "string" ? props.title : undefined);
  useEffect(() => { if (name) setDocumentTitle(documentTitle(name)); }, [name]);
  if (props.bare) return <View style={{ flex: 1, minHeight: 0 }}>{props.children}</View>;
  const editor = /^\/editor\//.test(pathname);
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      <View testID="top-bar" style={{ height: safe.headerHeight, paddingTop: safe.headerPaddingTop, borderBottomWidth: 1, borderBottomColor: theme.color("border/hairline") }}>
        <View style={{ height: safe.barHeight, flexDirection: "row", alignItems: "center", gap: theme.compact ? compactScale.space.gapSmall : space[2], paddingStart: theme.compact ? compactScale.space.side : space[4], paddingEnd: theme.compact ? compactScale.space.side : space[3] }}>
          {theme.compact ? <IconButton icon="menu" label={t("Open navigation")} onPress={shell.openDrawer} />
            : !shell.sidebarShown && !shell.focusMode ? <IconButton icon="panel" size="sm" label={t("Show sidebar")} shortcut="view.sidebar.toggle" onPress={shell.toggleSidebar} /> : null}
          {theme.compact && !shell.focusMode ? <IconButton icon="search" size="sm" label={t("Search")} testID="mobile-global-search" onPress={shell.openSearch} /> : null}
          <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: space[2], minWidth: 0 }}>
            {props.crumbs ? <Breadcrumb segments={props.crumbs} /> : typeof props.title === "string" ? <Text variant="body-medium" numberOfLines={1} level={editor ? undefined : 1} style={theme.compact ? compactScale.type.title : undefined}>{props.title}</Text> : props.title}
          </View>
          {shell.focusMode ? null : <View style={{ flexDirection: "row", alignItems: "center", gap: space[1] }}>{props.actions}</View>}
        </View>
      </View>
      <View style={{ flex: 1, minHeight: 0, paddingBottom: safe.contentPaddingBottom }}>{props.children}</View>
    </View>
  );
}

/** What a host-scoped route shows when its host is not paired or not connected; `null` when the screen itself may render. */
export function useHostScopeState(feature: string): ReactNode | null {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const shell = useShell();
  const { hosts, host, status, error, hostsLoaded } = useHost();
  if (!hostsLoaded) return <View />;
  const scope = hostScope(pathname, hosts.map((record) => record.gatewayId), status === "connected" && host ? host.gatewayId : null);
  if (scope === "ok" || scope === "local-route") return null;
  if (scope === "not-paired") {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space[2], padding: space[4] }}>
        <Icon name="device" size={32} color="text/secondary" />
        <Text variant="title-sm" level={2} align="center">{t("This host is not paired on this device")}</Text>
        <View style={{ flexDirection: "row", gap: space[2], marginTop: space[2] }}>
          <Button kind="primary" size="sm" label={t("Pair")} onPress={() => router.push("/pair/start" as never)} />
          <Button size="sm" label={t("Go home")} onPress={() => router.replace("/home")} />
        </View>
      </View>
    );
  }
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space[1], padding: space[4] }}>
      <Icon name="device" size={32} color="text/secondary" />
      <Text variant="title-sm" level={2} align="center">{feature}</Text>
      <Text color="text/secondary">{status === "connecting" ? t("Connecting…") : status === "unavailable" ? error instanceof Error ? t("Host unavailable — {reason}", { reason: error.message }) : t("Host offline — reconnecting…") : t("Requires a host")}</Text>
      <View style={{ marginTop: space[2] }}><Button kind="primary" size="sm" label={t("Connect a host")} onPress={() => (status === "local" ? router.push("/pair/start" as never) : shell.requireHost(feature))} /></View>
    </View>
  );
}
