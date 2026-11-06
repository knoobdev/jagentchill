import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Platform, View } from "react-native";
import { formatDateTime } from "@jagentchill/app-core";
import { updateControls } from "@jagentchill/desktop-core/renderer";
import { Button, Callout, GroupedSettingCard, ProgressBar, SearchField, SettingRow, Switch, Text, space, useTheme, useToast } from "@jagentchill/ui";
import { useT } from "../locale";
import { APP_VERSION, buildInfo, licenceList, type BuildInfo, type LicenceEntry } from "./build";
import { desktop, type UpdateState } from "./desktop";
import { openExternal } from "./store";
import { webUpdate } from "./webUpdate";
import { useReloadToUpdate } from "./WebUpdateNotice";

function useBuild(): BuildInfo | null {
  const [build, setBuild] = useState<BuildInfo | null>(null);
  useEffect(() => { void buildInfo().then(setBuild); }, []);
  return build;
}
const platformName = (): string => {
  const bridge = desktop();
  if (bridge) return `${bridge.app.platform === "darwin" ? "macOS" : bridge.app.platform === "win32" ? "Windows" : "Linux"} (${bridge.app.arch})`;
  return Platform.OS === "ios" ? "iOS" : Platform.OS === "android" ? "Android" : "Web";
};

/** Version, build and build date: the rows About and Updates both start with. The build rows exist only where the build wrote its record. */
function VersionRows(props: { last?: boolean }) {
  const t = useT();
  const theme = useTheme();
  const build = useBuild();
  return (
    <>
      <SettingRow label={t("Version")} last={props.last && !build}><Text tabular color="text/secondary" testID="app-version">{build?.version ?? APP_VERSION}</Text></SettingRow>
      {build ? <SettingRow label={t("Build")}><Text tabular color="text/secondary" testID="app-build">{build.buildId}</Text></SettingRow> : null}
      {build ? <SettingRow label={t("Build date")} last={props.last}><Text tabular color="text/secondary" testID="app-build-date">{formatDateTime(build.builtAt_ms, theme.locale)}</Text></SettingRow> : null}
    </>
  );
}

/** Personal ▸ Updates. Works without a host. Each platform shows what it can really do; there is one release channel and no selector. */
export function UpdatesSettings() {
  const bridge = desktop();
  return (
    <>
      <GroupedSettingCard><VersionRows last /></GroupedSettingCard>
      {bridge ? <DesktopUpdates /> : Platform.OS === "web" ? <WebUpdates /> : null}
    </>
  );
}

function WebUpdates() {
  const t = useT();
  const reload = useReloadToUpdate();
  const update = useSyncExternalStore(webUpdate.subscribe, webUpdate.getState, webUpdate.getState);
  if (!update.supported) return null;
  return (
    <GroupedSettingCard>
      <SettingRow label={update.waiting ? t("A new version is available") : t("Up to date")} description={update.offlineReady ? t("This version is kept on this device and opens without a network.") : undefined} last>
        {update.waiting ? <Button size="sm" kind="primary" label={t("Reload to update")} testID="web-reload-to-update" onPress={reload} /> : null}
      </SettingRow>
    </GroupedSettingCard>
  );
}

function DesktopUpdates() {
  const t = useT();
  const theme = useTheme();
  const toast = useToast();
  const bridge = desktop()!;
  const [state, setState] = useState<UpdateState | null>(null);
  useEffect(() => { void bridge.updates.getState().then(setState); return bridge.updates.onState(setState); }, [bridge]);
  if (!state) return null;
  // A build without an update feed has nothing to check against: it says so and offers no control.
  if (state.mode === "off") return <Callout tone="info">{t("This build has no update feed. Install a newer version by downloading it.")}</Callout>;
  const busy = state.status === "checking" || state.status === "downloading";
  const controls = updateControls(state);
  const line =
    state.status === "checking" ? t("Checking for updates…")
    : state.status === "up-to-date" ? t("Up to date")
    : state.status === "available" ? t("Update available {version}", { version: state.version ?? "" })
    : state.status === "downloading" ? t("Downloading {percent}%", { percent: state.progress ?? 0 })
    : state.status === "ready" ? t("Ready to install")
    : state.status === "downloaded" ? t("Version {version} was downloaded and verified", { version: state.version ?? "" })
    : state.status === "error" ? (state.reason === "verification" || state.reason === "download" ? t("The update could not be downloaded") : t("Unable to check for updates"))
    : t("Not checked yet");
  const detail = [state.status === "error" ? state.error : undefined, state.lastChecked_ms ? t("Last checked {time}", { time: formatDateTime(state.lastChecked_ms, theme.locale) }) : undefined].filter(Boolean).join(" · ");
  return (
    <>
      {controls.note === "unsigned" ? <Callout tone="info">{t("This build is not signed, so it cannot install an update by itself. A new version is downloaded and verified; open the downloaded file to install it.")}</Callout> : null}
      {controls.note === "package-manager" ? <Callout tone="info">{t("Updates are installed by your package manager")}</Callout> : null}
      <GroupedSettingCard>
        <SettingRow label={t("Check for updates automatically")}><Switch accessibilityLabel={t("Check for updates automatically")} value={state.autoCheck !== false} onChange={(value) => bridge.updates.setOptions({ autoCheck: value })} /></SettingRow>
        {controls.autoDownload ? <SettingRow label={t("Download updates automatically")}><Switch accessibilityLabel={t("Download updates automatically")} value={state.autoDownload !== false} onChange={(value) => bridge.updates.setOptions({ autoDownload: value })} /></SettingRow> : null}
        <SettingRow label={line} description={detail || undefined} last>
          <View testID="update-state" style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
            {state.status === "downloading" ? <ProgressBar value={state.progress ?? 0} label={t("Downloading {percent}%", { percent: state.progress ?? 0 })} style={{ width: 120 }} /> : null}
            {controls.download === "package" ? <Button size="sm" label={t("Download")} testID="update-download" onPress={() => void bridge.updates.download()} /> : null}
            {controls.download === "link" ? <Button size="sm" label={t("Download")} testID="update-download-link" onPress={() => openExternal(state.downloadUrl!)} /> : null}
            {controls.retry ? <Button size="sm" label={t("Try again")} testID="update-retry" onPress={() => void bridge.updates.download()} /> : null}
            {state.status === "ready" ? <Button size="sm" kind="primary" label={t("Restart and install")} testID="update-install" onPress={() => void bridge.updates.install().then((result) => { if (!result.restarted && result.blockers.length) toast.show({ kind: "info", message: t("The update will be installed when you quit") }); })} /> : null}
            {state.status === "downloaded" ? <Button size="sm" kind="primary" label={t("Show in folder")} testID="update-reveal" onPress={() => void bridge.updates.reveal()} /> : null}
            <Button size="sm" label={t("Check now")} testID="update-check" loading={state.status === "checking"} disabled={busy} onPress={() => void bridge.updates.check()} />
          </View>
        </SettingRow>
      </GroupedSettingCard>
      {state.status === "downloaded" && state.file ? <Text color="text/secondary" selectable testID="update-file">{state.file}</Text> : null}
    </>
  );
}

/** Personal ▸ About: what this app is. Works without a host and without a network. */
export function AboutSettings() {
  const t = useT();
  return (
    <>
      <GroupedSettingCard>
        <SettingRow label={t("App")}><Text color="text/secondary">JAgentChill</Text></SettingRow>
        <VersionRows />
        <SettingRow label={t("Platform")} last><Text color="text/secondary" testID="app-platform">{platformName()}</Text></SettingRow>
      </GroupedSettingCard>
    </>
  );
}
