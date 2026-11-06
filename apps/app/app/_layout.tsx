import "../src/platform/cryptoRuntime";
import { Slot, Stack } from "expo-router";
import { Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo } from "react";
import { PREFS, setFormatLocale } from "@jagentchill/app-core";
import { ThemeProvider, useTheme } from "@jagentchill/ui";
import { HostProvider, useHost } from "../src/host";
import { AgentNotices } from "../src/agents/team/AgentNotices";
import { NotificationFeeds } from "../src/shell/NotificationFeeds";
import { AutomationEvents } from "../src/workflows/EventTrigger";
import { preferenceStore, preventStrayDrops, systemLanguage } from "../src/platform/store";
import { ProjectActionsProvider } from "../src/projects/actions";
import { requiresHostHandle, Shell } from "../src/shell/Shell";
import { notifications } from "../src/notifications";
import { MigrationDialog } from "../src/projects/StorageNotices";
import { DesktopShell } from "../src/platform/DesktopShell";
import { DeviceProvider, useDevice, usePref } from "../src/state";
import { ProjectSyncProvider } from "../src/sync/ProjectsSync";
import { SyncProvider } from "../src/sync/SyncProvider";
import { statusBarStyle } from "../src/shell/safeArea.ts";

/** Web bindings of the actions whose hints the shell shows. */
const BINDINGS: Record<string, string[]> = { "view.sidebar.toggle": ["Mod", "\\"], "project.new": ["Alt", "N"], "list.open": ["Enter"], "list.rename": ["F2"], "list.delete": ["Delete"], "list.pin": ["P"] };
const shortcuts = (action: string) => BINDINGS[action] ?? null;

function Screens() {
  const theme = useTheme();
  // A file dropped outside a drop target never makes the browser navigate to it.
  useEffect(() => preventStrayDrops(), []);
  return (
    <DeviceProvider phone={theme.compact}>
      <SyncProvider><ProjectSyncProvider>
      <ProjectActionsProvider>
        <StatusBar style={statusBarStyle(theme.scheme)} />
        <Shell>
          {Platform.OS === "web" ? <Slot /> : <Stack screenOptions={{ headerShown: false, animation: "none", contentStyle: { backgroundColor: theme.color("bg/app") } }} />}
        </Shell>
        <Migration />
        <DesktopShell />
        <NotificationFeeds />
      </ProjectActionsProvider>
      </ProjectSyncProvider></SyncProvider>
    </DeviceProvider>
  );
}

function Migration() {
  const device = useDevice();
  return <MigrationDialog state={device.migration} onRestore={device.restoreBackup} onCloseSummary={device.closeMigrationSummary} />;
}

function Themed() {
  const { status } = useHost();
  const [language] = usePref(PREFS.language);
  // Numbers, money and dates worded outside a component (string tables, error mappers) follow the UI language too.
  setFormatLocale(language ?? systemLanguage());
  // A control that needs a host stays enabled without one and opens the requires-host sheet.
  const gate = useMemo(() => ({ connected: status === "connected", onRequiresHost: (feature?: string) => requiresHostHandle.open?.(feature) }), [status]);
  return (
    <ThemeProvider locale={language ?? systemLanguage()} host={gate} storage={preferenceStore} shortcuts={shortcuts}
      // Errors and results that asked to stay reachable go to the notification inbox when their toast leaves.
      onToastPersist={(toast) => notifications.add({ kind: toast.kind === "progress" ? "info" : toast.kind, message: toast.message })}>
      <Screens />
      <AutomationEvents />
      <AgentNotices />
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return <GestureHandlerRootView style={{ flex: 1 }}><HostProvider><Themed /></HostProvider></GestureHandlerRootView>;
}
