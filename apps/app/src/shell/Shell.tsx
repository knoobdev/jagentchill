import { usePathname, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { ScrollView, View } from "react-native";
import {
  clampSidebarWidth, DESTINATIONS, destinationById, listHeight, LOCAL_HOST, pickPromo, PREFS, PRIMARY, promoEligibility, promoFits, relativeTime,
  routeAfterHostSwitch, secondaryList, sectionOf, SIDEBAR, unreadCount, type Destination, type PromoId,
} from "@jagentchill/app-core";
import {
  AdaptiveSheet, Avatar, Badge, Button, Card, ConfirmDialog, Dot, Drawer, EdgePanel, Icon, IconButton, ListRow, Menu, MenuList, Modal, Popover, SearchField, Segmented, StatusPill, Tap, Text, control, motion, radius, space, useTheme,
  type IconName, type MenuItem,
} from "@jagentchill/ui";
import { useHost } from "../host";
import type { HostRecord } from "@jagentchill/client";
import { removeHost } from "../identity";
import { ExportsButton } from "../editor/export/Indicators";
import { useT } from "../locale";
import { bindSplitter, downloadUrl, isDesktopOs, onWindowKey, openExternal } from "../platform/store";
import { desktop } from "../platform/desktop";
import { useForegroundActive } from "../platform/foreground";
import { useProjectActions } from "../projects/actions";
import { useNotifications } from "../notifications";
import { NotificationList } from "./NotificationCentre";
import { setPref, useLibraryState, usePref } from "../state";
import { appRoute, SettingsNav } from "../settings/nav";
import { SecondaryList } from "./SecondaryList";
import { connectionFooterParts } from "./connection-footer";
import { hostRowStatus, hostSwitcherConnection, uniqueHostRecords } from "./host-switcher";
import { ShellContext, requiresHostHandle, useShell, type ShellState } from "./ShellState";
export { useShell, requiresHostHandle } from "./ShellState";
export { Screen, useHostScopeState } from "./Screen";

export function connectionLabel(status: "local" | "connecting" | "connected" | "unavailable"): { label: string; tone: "success" | "danger" | "off" | "accent" } {
  if (status === "connected") return { label: "Connected", tone: "success" };
  if (status === "connecting") return { label: "Connecting…", tone: "accent" };
  if (status === "unavailable") return { label: "Host unavailable", tone: "danger" };
  return { label: "Local only", tone: "off" };
}

/** The host switcher: paired hosts carry their connection endpoint and a direct route to that host's settings. */
export function HostSwitcher(props: { open: boolean; onClose(): void; anchor: RefObject<View | null> }) {
  const t = useT();
  const theme = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const { host, hosts, status, connection, localOnly, selectHost, refreshHosts } = useHost();
  const [hostQuery, setHostQuery] = useState("");
  const [pendingDisconnect, setPendingDisconnect] = useState<HostRecord | null>(null);
  const state = connectionLabel(status);
  const choose = (id: string) => {
    selectHost(id);
    const next = routeAfterHostSwitch(pathname, id);
    if (next !== pathname) router.replace(next as never);
  };
  const endpoint = (record: HostRecord) => {
    if ((record as { builtIn?: boolean }).builtIn) return t("Local");
    try { return new URL(record.origin).host; } catch { return record.origin; }
  };
  const uniqueHosts = uniqueHostRecords(hosts);
  const shownHosts = uniqueHosts.filter((record) => !hostQuery.trim() || `${record.gatewayName} ${endpoint(record)}`.toLowerCase().includes(hostQuery.trim().toLowerCase()));
  const items: MenuItem[] = [
    { id: "local", label: t("This device only"), icon: "monitor", checked: localOnly || uniqueHosts.length === 0, description: t("Works without any host"), onSelect: () => choose(LOCAL_HOST) },
    { type: "separator" },
    { id: "add", label: t("Add a host…"), icon: "plus", onSelect: () => router.push("/host/add-connection" as never) },
    ...(desktop() && !uniqueHosts.some((record) => (record as { builtIn?: boolean }).builtIn) ? [{ id: "enable-built-in", label: t("Enable built-in host"), icon: "monitor" as IconName, onSelect: () => { void desktop()?.gateway.setEnabled(true); } }] : []),
  ];
  return (
    <Popover open={props.open} onClose={props.onClose} anchor={props.anchor} label={t("Hosts")} title={t("Hosts")} wide align="start" initialFocus='[tabindex="0"]'>
      {host ? (
        <View style={{ padding: space[2], gap: space[2], borderBottomWidth: 1, borderBottomColor: theme.color("border/hairline"), marginBottom: space[1] }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
            <Avatar name={host.gatewayName} id={host.gatewayId} square size={24} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text variant="body-medium" numberOfLines={1}>{host.gatewayName}</Text>
              <Text variant="meta" color="text/secondary" numberOfLines={1}>{t("This device's role: {role}", { role: connection?.ready.role ?? host.role })}</Text>
            </View>
            <StatusPill label={t(state.label)} tone={status === "connected" ? "success" : status === "connecting" ? "info" : "danger"} />
          </View>
          <View style={{ flexDirection: "row", gap: space[2] }}>
            <Button size="xs" icon="qr" label={t("Pair a device")} onPress={() => { props.onClose(); router.push("/devices?pair=1" as never); }} />
          </View>
        </View>
      ) : null}
      <View testID="host-switcher-list">
        {hosts.length > 10 ? <View style={{ paddingHorizontal: space[2], paddingVertical: space[1] }}><SearchField label={t("Search hosts")} placeholder={t("Search hosts")} size="sm" value={hostQuery} onChangeText={setHostQuery} debounce={0} /></View> : null}
        {shownHosts.map((record) => {
          const active = record.gatewayId === host?.gatewayId;
          const hostState = hostRowStatus(active, status);
          const builtIn = !!(record as { builtIn?: boolean }).builtIn;
          const tone = hostState === "Connected" ? "success" : hostState === "Connecting…" ? "accent" : hostState === "Not in use" ? "off" : "danger";
          const saved = record.connections?.find((item) => item.id === record.preferredConnectionId) ?? record.connections?.[0];
          const transport = active && connection ? connection.ready.transport : builtIn ? "loopback" : saved?.kind === "tailnet" ? "tailnet" : saved?.kind === "direct" ? "lan" : saved?.kind === "local" ? "loopback" : undefined;
          const presentation = hostSwitcherConnection(record, transport);
          const description = [t(presentation.address), t(hostState)].join(" · ");
          return <ListRow key={record.gatewayId} title={record.gatewayName} icon="device" selected={active} current="page" meta={description} metaLeading={<View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}><Badge label={t(presentation.type)} /><Dot tone={tone} label={t(hostState)} /></View>} testID={`host-row-${record.gatewayId}`} onPress={() => { choose(record.gatewayId); props.onClose(); }}
            trailing={<View style={{ flexDirection: "row", alignItems: "center" }}>
              <IconButton icon="gear" size="xs" label={t("Settings for {host}", { host: record.gatewayName })} testID={`host-settings-${record.gatewayId}`} onPress={() => { choose(record.gatewayId); props.onClose(); router.push(`/settings/host/${record.gatewayId}/connections` as never); }} />
              <IconButton icon="x-c" size="xs" label={t("Disconnect from {host}", { host: record.gatewayName })} testID={`host-disconnect-${record.gatewayId}`} onPress={() => setPendingDisconnect(record)} />
            </View>} />;
        })}
      </View>
      <MenuList items={items} onClose={props.onClose} onCloseAll={props.onClose} label={t("Hosts")} />
      <ConfirmDialog open={pendingDisconnect !== null} title={pendingDisconnect ? t("Disconnect from {host}", { host: pendingDisconnect.gatewayName }) : t("Disconnect")} confirmLabel={t("Disconnect")}
        onClose={() => setPendingDisconnect(null)} onConfirm={() => { if (!pendingDisconnect) return; const id = pendingDisconnect.gatewayId; setPendingDisconnect(null); void removeHost(id).then(refreshHosts); }} />
    </Popover>
  );
}

function RequiresHostSheet(props: { feature: string | null; onClose(): void }) {
  const t = useT();
  const router = useRouter();
  return (
    <AdaptiveSheet open={props.feature !== null} onClose={props.onClose} title={props.feature || t("Requires a host")} width={360}
      footer={<><Button kind="ghost" label={t("Not now")} onPress={props.onClose} /><Button kind="primary" label={t("Connect a host")} onPress={() => { props.onClose(); router.push("/pair/start" as never); }} /></>}>
      <Text variant="body-medium">{t("Requires a host")}</Text>
      <Text color="text/secondary">{t("A host is the JAgentChill desktop app on a Mac, Windows or Linux computer, or the JAgentChill container on your own server. Agents, workflows, Film Studio, automations and sync run there; editing works without one.")}</Text>
    </AdaptiveSheet>
  );
}

/** The eight destinations of the sidebar as one roving-focus list: Up and Down move. */
function Navigation(props: { drawer?: boolean; onNavigate?(destination: Destination): void }) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const { host, approvals, localOnly } = useHost();
  const [focused, setFocused] = useState(0);
  const section = sectionOf(pathname);
  const counts: Record<string, number> = { sessions: new Set(approvals.map((approval) => approval.sessionKey)).size };
  const go = (destination: Destination) => {
    const target = destination.route(!localOnly && host ? host.gatewayId : LOCAL_HOST);
    router.push((destination.id === "home" ? "/home?focus=1" : target) as never);
    props.onNavigate?.(destination);
  };
  const refs = useRef(new Map<number, View | null>());
  const focusRow = (index: number) => (refs.current.get(index) as unknown as { focus?(): void } | null)?.focus?.();
  const key = (index: number) => (info: { key: string; preventDefault(): void }) => {
    const move = info.key === "ArrowDown" ? 1 : info.key === "ArrowUp" ? -1 : 0;
    if (move) { info.preventDefault(); const next = (index + move + PRIMARY.length) % PRIMARY.length; setFocused(next); focusRow(next); }
  };
  return (
    <View role="navigation" aria-label={t("Primary")} accessibilityLabel={t("Primary")}>
      {PRIMARY.map((destination, index) => (
        // A row that needs a host looks like every other row and opens the requires-host sheet when none is connected.
        <ListRow key={destination.id} title={t(destination.label)} icon={destination.icon as IconName} selected={section === destination.id} current="page" requiresHost={destination.needsHost} hideBadge
          rowRef={(node) => { refs.current.set(index, node); }} tabIndex={index === focused ? 0 : -1} onKeyDown={key(index)} onPress={() => go(destination)} testID={`nav-${destination.id}`}
          count={counts[destination.id] || undefined} />
      ))}
    </View>
  );
}

function PromoCard(props: { id: PromoId; onDismiss(): void }) {
  const t = useT();
  const router = useRouter();
  const copy = props.id === "desktop" ? { title: t("Install the desktop app"), body: t("Edit with the full editor and run a host on this computer."), action: t("Download"), icon: "download" as IconName, run: () => { const url = downloadUrl(); if (url) openExternal(url); } }
    : props.id === "pair-phone" ? { title: t("Pair your phone"), body: t("Review and approve edits from anywhere on your network."), action: t("Pair a device"), icon: "qr" as IconName, run: () => router.push("/devices?pair=1" as never) } : null;
  if (!copy) return null;
  return (
    <Card padding={space[2]} style={{ marginBottom: space[2], gap: space[1] }}>
      <View testID={`promo-${props.id}`} style={{ flexDirection: "row", alignItems: "center" }}>
        <Text variant="body-medium" style={{ flex: 1 }}>{copy.title}</Text>
        <IconButton icon="x" size="xs" label={t("Dismiss")} onPress={props.onDismiss} />
      </View>
      <Text variant="meta" color="text/secondary">{copy.body}</Text>
      <View style={{ alignItems: "flex-start", marginTop: space[1] }}><Button size="xs" icon={copy.icon} label={copy.action} onPress={copy.run} /></View>
    </Card>
  );
}

/** The notification centre behind the bell: a popover on wide screens (a phone opens the `/notifications` screen instead). */
function Inbox(props: { open: boolean; onClose(): void; anchor: RefObject<View | null> }) {
  const t = useT();
  return (
    <Popover open={props.open} onClose={props.onClose} anchor={props.anchor} label={t("Notifications")} title={t("Notifications")} wide align="end" padded={false}>
      <NotificationList onNavigate={props.onClose} />
    </Popover>
  );
}

/** The command palette: go to a section, open a project, or run one of the app's commands. */
function CommandPalette(props: { open: boolean; onClose(): void }) {
  const t = useT();
  const theme = useTheme();
  const router = useRouter();
  const actions = useProjectActions();
  const library = useLibraryState();
  const { host, localOnly } = useHost();
  const [query, setQuery] = useState("");
  useEffect(() => { if (props.open) setQuery(""); }, [props.open]);
  if (!props.open) return null;
  const needle = query.trim().toLowerCase(), matches = (text: string) => needle === "" || text.toLowerCase().includes(needle);
  const go = (route: string) => () => { props.onClose(); router.push(route as never); };
  const commands: MenuItem[] = [
    { id: "new-project", label: t("New project"), icon: "plus", onSelect: () => { props.onClose(); void actions.create(null); } },
    { id: "import-project", label: t("Import project"), icon: "download", onSelect: () => { props.onClose(); void actions.importPackage(); } },
    ...(host && !localOnly ? [{ id: "video-from-prompt", label: t("Generate video from prompt"), icon: "wand", onSelect: go(`/h/${host.gatewayId}/workflows/video`) }] : []),
    { id: "settings", label: t("Settings"), icon: "gear", onSelect: go("/settings") },
    { id: "storage", label: t("Manage storage"), icon: "box", onSelect: go("/settings/storage") },
    { id: "trash", label: t("Trash"), icon: "trash", onSelect: go("/projects/trash") },
    { id: "theme-light", label: `${t("Theme")}: ${t("Light")}`, icon: "sun", onSelect: () => { theme.setPreference("light"); props.onClose(); } },
    { id: "theme-dark", label: `${t("Theme")}: ${t("Dark")}`, icon: "sun", onSelect: () => { theme.setPreference("dark"); props.onClose(); } },
    { id: "theme-system", label: `${t("Theme")}: ${t("System")}`, icon: "sun", onSelect: () => { theme.setPreference("system"); props.onClose(); } },
  ].filter((item) => needle.length > 0 && matches(item.label)) as MenuItem[];
  // Skills and Usage have routes of their own and no sidebar row: the palette is how they are reached from anywhere.
  const sections: MenuItem[] = [...PRIMARY, ...DESTINATIONS.filter((destination) => destination.id === "skills" || destination.id === "usage" || destination.id === "scripts")].filter((destination) => needle.length > 0 && matches(t(destination.label)) && (!destination.needsHost || (host && !localOnly)))
    .map((destination) => ({ id: `go-${destination.id}`, label: t(destination.label), icon: destination.icon as IconName, onSelect: go(destination.route(host && !localOnly ? host.gatewayId : LOCAL_HOST)) }));
  const projects: MenuItem[] = library.projects.filter((project) => needle.length > 0 && project.trash === null && !project.unreadable && !project.needsNewerApp && matches(project.name)).sort((a, b) => b.updated_ms - a.updated_ms).slice(0, 8)
    .map((project) => ({ id: `project-${project.id}`, label: project.name, icon: "film" as IconName, onSelect: go(`/editor/${project.id}`) }));
  const items: MenuItem[] = [
    ...(projects.length ? [{ type: "caption" as const, label: t("Projects") }, ...projects] : []),
    ...(sections.length ? [{ type: "caption" as const, label: t("Go to") }, ...sections] : []),
    ...(commands.length ? [{ type: "caption" as const, label: t("Commands") }, ...commands] : []),
  ];
  return (
    <Modal title={t("Search")} width={480} onClose={props.onClose} hideClose>
      <View testID="command-palette" style={{ gap: space[2] }}>
        <SearchField label={t("Search projects and commands")} placeholder={t("Search projects and commands…")} value={query} onChangeText={setQuery} debounce={0} autoFocus onEscape={props.onClose} />
        <ScrollView testID="command-palette-results" style={{ flexShrink: 1, maxHeight: 360 }}>
          {items.length ? <MenuList autoFocus={false} label={t("Search")} items={items} onClose={props.onClose} onCloseAll={props.onClose} />
            : <View testID={needle ? "command-palette-no-results" : "command-palette-empty"} style={{ minHeight: 88, padding: space[4], alignItems: "center", justifyContent: "center" }}><Text color="text/secondary">{needle ? t("No results found") : t("Search projects and commands…")}</Text></View>}
        </ScrollView>
      </View>
    </Modal>
  );
}

function Footer(props: { onNavigate?(): void } = {}) {
  const t = useT();
  const theme = useTheme();
  const router = useRouter();
  const { status, host, connection } = useHost();
  const desktopBridge = desktop();
  const foreground = useForegroundActive();
  const shell = useShell();
  const entries = useNotifications();
  const [help, setHelp] = useState(false);
  const [inbox, setInbox] = useState(false);
  const helpRef = useRef<View>(null), bellRef = useRef<View>(null);
  const state = connectionLabel(status);
  const endpoint = host ? (() => { try { return new URL(host.origin).host; } catch { return host.origin; } })() : t("This device");
  const [desktopMode, setDesktopMode] = useState<"tailscale" | "local" | null>(null);
  const [tailnet, setTailnet] = useState<{ connected: boolean; host: string | null; port: number | null } | null>(null);
  useEffect(() => {
    if (!desktopBridge || !foreground) return;
    let active = true;
    const refresh = () => void Promise.all([desktopBridge.connectionMode.get(), desktopBridge.tailnet.getStatus()]).then(([mode, next]) => {
      if (active) { setDesktopMode(mode); setTailnet(next); }
    }).catch(() => { if (active) setTailnet(null); });
    refresh();
    const timer = setInterval(refresh, 5000);
    const off = desktopBridge.gateway.onStatus(refresh);
    return () => { active = false; clearInterval(timer); off(); };
  }, [desktopBridge, foreground]);
  const desktopUsesTailnet = !!desktopBridge && desktopMode === "tailscale";
  const builtInHost = !!(host as (HostRecord & { builtIn?: boolean }) | undefined)?.builtIn;
  const preferred = host?.connections?.find((item) => item.id === host.preferredConnectionId) ?? host?.connections?.[0];
  const transport = connection?.ready.transport ?? (preferred?.kind === "local" ? "loopback" : preferred?.kind === "direct" ? "lan" : preferred?.kind === "tailnet" ? "tailnet" : undefined);
  const tailnetAddress = tailnet?.host && tailnet.port ? `${tailnet.host}:${tailnet.port}` : null;
  const footer = connectionFooterParts({
    desktopMode: desktopUsesTailnet ? "tailscale" : desktopBridge ? desktopMode : null,
    builtInHost,
    tailnetConnected: tailnet?.connected ?? false,
    preferredKind: preferred?.kind,
    transport,
    statusLabel: state.label,
  });
  const footerText = footer.path ? `${t(footer.state)} · ${t(footer.path)}` : t(footer.state);
  const footerEndpoint = desktopUsesTailnet
    ? tailnetAddress ? t("This computer's host is reachable at {address}", { address: tailnetAddress }) : t("This computer")
    : endpoint;
  // Requests to pair and approvals are entries of the centre themselves (`NotificationFeeds`): one count.
  const unread = unreadCount(entries);
  return (
    <View style={{ height: SIDEBAR.footer, flexDirection: "row", alignItems: "center", gap: theme.compact ? 0 : space[0.5], paddingStart: space[1], paddingEnd: space[1], minWidth: 0 }}>
      <Tap role="button" label={footerText} onPress={() => { props.onNavigate?.(); router.push("/devices"); }} testID="connection-chip" tooltip={{ label: footerEndpoint }}
        style={(interaction) => ({ height: control.xs, minWidth: 0, flexShrink: 1, flexDirection: "row", alignItems: "center", gap: space[1], paddingHorizontal: space[1], borderRadius: radius.sm, backgroundColor: interaction.hovered || interaction.pressed ? theme.color("bg/hover") : "transparent" })}>
        <Dot tone={state.tone} />
        <Text variant="meta" numberOfLines={1} style={{ flexShrink: 1 }}>{footerText}</Text>
      </Tap>
      <View style={{ flex: 1, minWidth: 0 }} />
      {theme.compact ? null : <ExportsButton />}
      <IconButton icon="gear" size={theme.compact ? "xs" : "sm"} label={t("Settings")} testID="footer-settings" onPress={() => { props.onNavigate?.(); router.push("/settings" as never); }} />
      <IconButton ref={bellRef} icon="bell" size={theme.compact ? "xs" : "sm"} label={unread > 0 ? t("Notifications, {n} unread", { n: unread }) : t("Notifications")} badge={unread || undefined} expanded={inbox} testID="footer-notifications"
        onPress={() => { if (theme.compact) { props.onNavigate?.(); router.push("/notifications" as never); } else setInbox(true); }} />
      <IconButton ref={helpRef} icon="help" size={theme.compact ? "xs" : "sm"} label={t("Help")} expanded={help} testID="footer-help" onPress={() => setHelp(true)} />
      <Inbox open={inbox} onClose={() => setInbox(false)} anchor={bellRef} />
      <Menu open={help} anchor={helpRef} label={t("Help")} align="end" onClose={() => setHelp(false)}
        items={[{ id: "tips", label: t("Starter tips"), icon: "sparkles", onSelect: shell.showStarterTips }, { id: "settings", label: t("Settings"), icon: "gear", onSelect: () => { props.onNavigate?.(); router.push("/settings" as never); } }]} />
    </View>
  );
}

/** The sidebar: host header, navigation, the index of the current section, a promo card and the footer. */
function Sidebar(props: { width: number; overlay?: boolean; onCollapse(): void }) {
  const t = useT();
  const theme = useTheme();
  const pathname = usePathname();
  const { host, status } = useHost();
  const [switcher, setSwitcher] = useState(false);
  const [lastSection] = usePref(PREFS.lastSection);
  const [dismissed, setDismissed] = usePref(PREFS.promoDismissed);
  const [palette, setPalette] = useState(false);
  const hostRef = useRef<View>(null);
  // While this computer's own host is still coming up there is no host record yet: name what is being connected to.
  const name = host?.gatewayName ?? (status === "connecting" ? t("This computer") : t("This device"));
  const hostPresentation = host ? hostSwitcherConnection(host) : null;
  const list = secondaryList(pathname, status === "connected", lastSection);
  const promo = pickPromo(promoEligibility({ desktopApp: false, desktopOs: isDesktopOs(), updateReady: false, downloadUrl: downloadUrl(), builtInHostRunning: false, mobilePaired: false, hostConnected: status === "connected" }), dismissed, Date.now());
  const promoShown = promo !== null && promoFits({ windowHeight: theme.height, density: theme.density, moreExpanded: false, promo: 112 });
  useEffect(() => onWindowKey((event) => { if ((event.meta || event.ctrl) && event.key.toLowerCase() === "k") { event.preventDefault(); setPalette(true); } }), []);
  return (
    <View testID="sidebar" style={[{ width: props.width, backgroundColor: theme.color("bg/sidebar"), borderEndWidth: 1, borderEndColor: theme.color("border/hairline"), paddingHorizontal: space[2] }, props.overlay ? [theme.elevation(2), { position: "absolute", top: 0, bottom: 0, start: 0, zIndex: 150 }] : { alignSelf: "stretch" }]}>
      <View style={{ height: SIDEBAR.header, flexDirection: "row", alignItems: "center", gap: space[1] }}>
        <View ref={hostRef} style={{ flex: 1, minWidth: 0 }}>
          <Tap role="button" label={name} expanded={switcher} onPress={() => setSwitcher(true)} testID="host-switcher"
            style={(interaction) => ({ minHeight: control.md, flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[2], borderRadius: radius.sm, backgroundColor: interaction.hovered || interaction.pressed || switcher ? theme.color("bg/hover") : "transparent" })}>
            <Avatar name={name} id={host?.gatewayId} square host decorative />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text variant="body-medium" numberOfLines={1}>{name}</Text>
              {hostPresentation ? <Text variant="meta" color="text/secondary" numberOfLines={1}>{hostPresentation.type === hostPresentation.address ? t(hostPresentation.type) : `${t(hostPresentation.type)} · ${t(hostPresentation.address)}`}</Text> : null}
            </View>
            <Icon name="chev-d" size={14} color="text/secondary" />
          </Tap>
        </View>
        <IconButton icon="search" size="xs" label={t("Search")} keys={["Mod", "K"]} testID="sidebar-search" onPress={() => setPalette(true)} />
        <IconButton icon="panel" size="xs" label={t("Collapse sidebar")} shortcut="view.sidebar.toggle" onPress={props.onCollapse} />
      </View>
      <HostSwitcher open={switcher} onClose={() => setSwitcher(false)} anchor={hostRef} />
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
      <Navigation />
      <View style={{ flex: 1, minHeight: Math.min(SIDEBAR.listMin, Math.max(0, listHeight({ windowHeight: theme.height, density: theme.density, moreExpanded: false }))) }}>
        {list ? <SecondaryList list={list.list} /> : null}
      </View>
      {promoShown && promo ? <PromoCard id={promo} onDismiss={() => setDismissed({ ...dismissed, [promo]: Date.now() })} /> : null}
      <Footer />
    </View>
  );
}

/** The drawer of compact form factors: "Menu" and the list of the current section, each with the full height. */
function MobileDrawer(props: { open: boolean; onClose(): void }) {
  const t = useT();
  const theme = useTheme();
  const pathname = usePathname();
  const { host, status } = useHost();
  const [lastSection] = usePref(PREFS.lastSection);
  const [segment, setSegment] = useState<"menu" | "list">("list");
  const [switcher, setSwitcher] = useState(false);
  const hostRef = useRef<View>(null);
  const list = secondaryList(pathname, status === "connected", lastSection);
  // While this computer's own host is still coming up there is no host record yet: name what is being connected to.
  const name = host?.gatewayName ?? (status === "connecting" ? t("This computer") : t("This device"));
  const hostPresentation = host ? hostSwitcherConnection(host) : null;
  const sectionName = t(list ? (list.list === "sessions" ? "Sessions" : list.list === "projects" ? "Projects" : destinationById(list.list)?.label ?? "Projects") : "Projects");
  // The drawer opens on the section's list.
  useEffect(() => { if (props.open) setSegment(list ? "list" : "menu"); }, [props.open]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Drawer open={props.open} onClose={props.onClose} label={t("Navigation")} active={segment === "menu" || !list ? 0 : 1}
      header={(
        <View ref={hostRef} style={{ paddingHorizontal: space[2], paddingTop: space[2] }}>
          <Tap role="button" label={name} expanded={switcher} onPress={() => setSwitcher(true)} testID="host-switcher"
            style={(state) => ({ minHeight: 44, flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[2], borderRadius: radius.sm, backgroundColor: state.hovered || state.pressed || switcher ? theme.color("bg/hover") : "transparent" })}>
            <Avatar name={name} id={host?.gatewayId} square host decorative />
            <View style={{ flex: 1, minWidth: 0 }}><Text variant="body-medium" numberOfLines={1}>{name}</Text>
              {hostPresentation ? <Text variant="meta" color="text/secondary" numberOfLines={1}>{hostPresentation.type === hostPresentation.address ? t(hostPresentation.type) : `${t(hostPresentation.type)} · ${t(hostPresentation.address)}`}</Text> : null}
            </View>
            <Icon name="chev-d" size={14} color="text/secondary" />
          </Tap>
          <HostSwitcher open={switcher} onClose={() => setSwitcher(false)} anchor={hostRef} />
        </View>
      )}
      segmented={list ? <Segmented block label={t("Navigation")} options={[{ value: "menu", label: t("Menu") }, { value: "list", label: sectionName }]} value={segment} onChange={(value) => setSegment(value as "menu" | "list")} /> : undefined}
      footer={<View style={{ paddingHorizontal: space[2] }}><Footer onNavigate={props.onClose} /></View>}
      bodies={[
        <ScrollView key="menu" contentContainerStyle={{ padding: space[2] }}><Navigation drawer onNavigate={() => { setSegment("list"); props.onClose(); }} /></ScrollView>,
        <View key="list" style={{ flex: 1, paddingHorizontal: space[2] }}>{list ? <SecondaryList list={list.list} onNavigate={props.onClose} /> : null}</View>,
      ]} />
  );
}

/** The frame of every screen: the sidebar (or the drawer on compact form factors) beside the routed content. It stays mounted while the content navigates. */
export function Shell(props: { children: ReactNode }) {
  const t = useT();
  const theme = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const actions = useProjectActions();
  const { host, localOnly } = useHost();
  const [collapsed, setCollapsed] = usePref(PREFS.sidebarCollapsed);
  const [width, setWidth] = usePref(PREFS.sidebarWidth);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [mobileSearch, setMobileSearch] = useState(false);
  const [feature, setFeature] = useState<string | null>(null);
  const [peek, setPeek] = useState(false);
  const [editorSidebar, setEditorSidebar] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [hint, setHint] = useState(false);
  const editor = /^\/editor\//.test(pathname);
  const bare = /^\/(welcome|_catalogue)(\/|$)/.test(pathname) || pathname === "/";
  // Settings replaces the sidebar with its own navigation column.
  const settings = /^\/settings(\/|$)/.test(pathname);
  // Medium form factors pin the sidebar but start with it collapsed.
  const [mediumOpen, setMediumOpen] = useState(false);
  const hidden = focusMode || (editor ? true : theme.formFactor === "medium" ? !mediumOpen : collapsed);
  const shown = !hidden;
  const splitter = useRef<View>(null);
  const live = useRef({ width, pathname, hostId: host?.gatewayId, localOnly });
  live.current = { width, pathname, hostId: host?.gatewayId, localOnly };

  useEffect(() => { requiresHostHandle.open = (name) => { setFeature(name ?? ""); setDrawer(false); }; return () => { requiresHostHandle.open = null; }; }, []);
  // Collapsing slides; entering or leaving the editor swaps the frame at once, so the editor's bar never moves under the pointer.
  const wasEditor = useRef(editor);
  const instant = wasEditor.current !== editor;
  useEffect(() => { wasEditor.current = editor; }, [editor]);
  // The selected section and the last route are remembered per device.
  useEffect(() => {
    const section = sectionOf(pathname);
    if (section) setPref(PREFS.lastSection, section);
    if (!bare && !/^\/pair\//.test(pathname)) setPref(PREFS.lastRoute, pathname);
    if (!bare && !/^\/(pair|settings|devices|join-tailnet)(\/|$)/.test(pathname)) appRoute.last = pathname;
    setDrawer(false); setPeek(false); setEditorSidebar(false);
  }, [pathname, bare]);
  const toggleSidebar = useCallback(() => {
    if (editor) setEditorSidebar((on) => !on);
    else if (theme.formFactor === "medium") setMediumOpen((on) => !on);
    else setCollapsed(!collapsed);
  }, [editor, theme.formFactor, collapsed, setCollapsed]);
  useEffect(() => bindSplitter(splitter.current, {
    onStart: () => setDragWidth(live.current.width), onDrag: (dx) => setDragWidth(clampSidebarWidth(live.current.width + dx)),
    onEnd: () => setDragWidth((value) => { if (value !== null) setWidth(value); return null; }), onReset: () => setWidth(SIDEBAR.width),
  }), [shown, theme.compact, setWidth]);
  // While collapsed, resting the pointer at the inline-start edge shows the sidebar as a temporary overlay.
  // A hidden sidebar no longer slides in when the pointer reaches the window's edge (the owner: in the editor it covered
  // the editor's own panels at every pass of the mouse). It is opened with its button or its shortcut.
  useEffect(() => onWindowKey((event) => {
    const mod = event.meta || event.ctrl;
    if (mod && event.key === "\\") { event.preventDefault(); toggleSidebar(); return; }
    if (event.key === "Escape" && !event.inField) { if (peek || editorSidebar) { setPeek(false); setEditorSidebar(false); } else if (focusMode) setFocusMode(false); return; }
    if (event.inField) return;
    // Web bindings: the browser keeps Ctrl+N and Ctrl+digit for itself.
    if (event.alt && !mod && event.key.toLowerCase() === "n") { event.preventDefault(); void actions.create(/^\/projects\/folder\/([^/]+)/.exec(live.current.pathname)?.[1] ?? null); return; }
    if (event.ctrl && event.alt && /^[1-8]$/.test(event.key)) {
      const destination = PRIMARY[Number(event.key) - 1];
      event.preventDefault();
      router.push(destination.route(!live.current.localOnly && live.current.hostId ? live.current.hostId : LOCAL_HOST) as never);
    }
  }), [toggleSidebar, actions, router, peek, editorSidebar, focusMode]);
  useEffect(() => { if (!focusMode) return; setHint(true); const timer = setTimeout(() => setHint(false), 2000); return () => clearTimeout(timer); }, [focusMode]);

  const shell = useMemo<ShellState>(() => ({
    requireHost: (name) => setFeature(name ?? ""), openDrawer: () => setDrawer(true), openSearch: () => setMobileSearch(true), sidebarShown: shown, toggleSidebar,
    showStarterTips: () => { setPref(PREFS.checklistDismissed, false); setDrawer(false); router.push("/home?tips=1" as never); },
    focusMode, setFocusMode,
  }), [shown, toggleSidebar, router, focusMode]);

  const current = dragWidth ?? width;
  const overlay = (peek || editorSidebar) && hidden && !theme.compact;
  return (
    <ShellContext.Provider value={shell}>
      <View testID="navigation-shell" style={{ flex: 1, flexDirection: "row", backgroundColor: theme.color("bg/app") }}>
        {bare || theme.compact ? null : (
          // A hidden sidebar leaves the tree once it has slid out, so it is neither focusable nor announced.
          <EdgePanel open={shown} edge="start" size={current} instant={instant} testID="sidebar-slot">
            {settings ? <SettingsNav width={current} /> : <Sidebar width={current} onCollapse={toggleSidebar} />}
            <View ref={splitter} role="separator" aria-label={t("Resize sidebar")} aria-orientation="vertical" style={{ position: "absolute", top: 0, bottom: 0, end: 0, width: space[1], zIndex: 1 }} />
          </EdgePanel>
        )}
        <View style={{ flex: 1, minWidth: 0 }}>{props.children}</View>
        {bare ? null : (
          <EdgePanel overlay open={overlay} edge="start" size={width} testID="sidebar-peek">
          <View {...({ onPointerLeave: () => setTimeout(() => setPeek(false), SIDEBAR.revealDelay) } as object)} style={{ flex: 1 }}>
            <Sidebar width={width} overlay onCollapse={() => { setPeek(false); setEditorSidebar(false); if (!editor) toggleSidebar(); }} />
          </View>
          </EdgePanel>
        )}
      </View>
      {theme.compact && !bare ? <MobileDrawer open={drawer} onClose={() => setDrawer(false)} /> : null}
      {theme.compact && !bare ? <CommandPalette open={mobileSearch} onClose={() => setMobileSearch(false)} /> : null}
      <RequiresHostSheet feature={feature} onClose={() => setFeature(null)} />
      {hint ? <View pointerEvents="none" style={{ position: "absolute", top: space[4], start: 0, end: 0, alignItems: "center" }}><Card padding={space[2]}><Text variant="meta">{t("Press Esc to exit focus mode")}</Text></Card></View> : null}
    </ShellContext.Provider>
  );
}

export { motion, DESTINATIONS };
