import { formatTimeOfDay } from "@jagentchill/app-core";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { Button, Callout, GroupedSettingCard, Input, Select, SettingRow, Switch, Text, space, useToast } from "@jagentchill/ui";
import { useHost } from "../host";
import { useT } from "../locale";
import { useDevice, usePref } from "../state";
import { SyncActivity } from "./EditorSync";
import { LIMIT_OPTIONS, SYNCED_LIBRARY, SYNC_PREFS } from "./prefs";
import { useSync } from "./SyncProvider";

/** The Sync card of Settings: the per-device preferences of cross-device sync, and what is moving right now. */
export function SyncSettings() {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const host = useHost();
  const sync = useSync();
  const { storage } = useDevice();
  const [newProjects, setNewProjects] = usePref(SYNC_PREFS.newProjects);
  const [originals, setOriginals] = usePref(SYNC_PREFS.originals);
  const [mobileData, setMobileData] = usePref(SYNC_PREFS.mobileData);
  const [uploadLimit, setUploadLimit] = usePref(SYNC_PREFS.uploadLimit);
  const [downloadLimit, setDownloadLimit] = usePref(SYNC_PREFS.downloadLimit);
  const [library, setLibrary] = usePref(SYNC_PREFS.library);
  const [displayName, setDisplayName] = usePref(SYNC_PREFS.displayName);
  const [syncedAt, setSyncedAt] = useState<number | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void sync.engine?.librarySyncedAt().then(setSyncedAt, () => undefined); }, [sync.engine, sync.version]);
  const mobile = storage?.platform === "mobile";
  const limits = [{ value: "off", label: t("Off") }, ...LIMIT_OPTIONS.map((mbit) => ({ value: String(mbit), label: t("{n} Mbit/s", { n: mbit }) }))];
  const syncLibraryNow = async () => {
    if (!sync.engine || !storage) return;
    setBusy(true);
    try {
      const result = await sync.engine.syncLibrary(SYNCED_LIBRARY, { read: (name) => storage.readLibrary(name as never), write: (name, value) => storage.writeLibrary(name as never, value) });
      setSyncedAt(result.at_ms);
      toast.show({ kind: "success", message: t("Library synced — {up} sent, {down} received", { up: result.pushed.length, down: result.pulled.length }) });
    } catch { toast.show({ kind: "error", message: t("Sync error") }); } finally { setBusy(false); }
  };
  return (
    <View style={{ gap: space[4] }} testID="sync-settings">
      {!host.host ? <Callout tone="info" actions={[{ label: t("Connect a host"), onPress: () => router.push("/pair/start" as never) }]}>{t("Sync projects between your devices through your own host.")}</Callout> : null}
      <GroupedSettingCard>
        <SettingRow label={t("Sync new projects")} description={t("A project created on this device is synced with the connected host.")}>
          <View testID="pref-sync-new"><Switch accessibilityLabel={t("Sync new projects")} value={newProjects && Boolean(host.host)} disabled={!host.host} onChange={setNewProjects} /></View>
        </SettingRow>
        <SettingRow label={t("Download originals automatically")} description={t("Off: this device edits with 720p proxies and downloads an original when an export needs it.")}>
          <View testID="pref-originals"><Switch accessibilityLabel={t("Download originals automatically")} value={originals ?? storage?.platform === "desktop"} onChange={setOriginals} /></View>
        </SettingRow>
        {mobile ? (
          <SettingRow label={t("Sync media over mobile data")} description={t("Off: media waits for Wi-Fi. Edits always sync.")}>
            <Switch accessibilityLabel={t("Sync media over mobile data")} value={mobileData} onChange={setMobileData} />
          </SettingRow>
        ) : null}
        <SettingRow label={t("Upload limit")}>
          <Select label={t("Upload limit")} width={160} options={limits} value={uploadLimit === null ? "off" : String(uploadLimit)} onChange={(value) => setUploadLimit(value === "off" ? null : Number(value))} />
        </SettingRow>
        <SettingRow label={t("Download limit")}>
          <Select label={t("Download limit")} width={160} options={limits} value={downloadLimit === null ? "off" : String(downloadLimit)} onChange={(value) => setDownloadLimit(value === "off" ? null : Number(value))} />
        </SettingRow>
        <SettingRow label={t("Sync my library")} description={syncedAt ? t("Saved sounds, brand kits, styles and LUTs. Last synced {when}.", { when: formatTimeOfDay(syncedAt) }) : t("Saved sounds, brand kits, styles and LUTs.")}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
            <Button size="sm" label={t("Sync now")} loading={busy} disabled={!library || !sync.connected} testID="library-sync-now" onPress={() => void syncLibraryNow()} />
            <View testID="pref-library"><Switch accessibilityLabel={t("Sync my library")} value={library} onChange={setLibrary} /></View>
          </View>
        </SettingRow>
        <SettingRow label={t("Name on review comments")} description={t("Empty: the name of this device.")} last>
          <View style={{ width: 220 }}><Input size="sm" accessibilityLabel={t("Name on review comments")} testID="pref-comment-name" value={displayName} maxLength={80} onChangeText={setDisplayName} /></View>
        </SettingRow>
      </GroupedSettingCard>
      <Text variant="body-medium" level={2}>{t("Sync activity")}</Text>
      <SyncActivity />
    </View>
  );
}
