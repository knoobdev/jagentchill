import { useEffect, useState, useSyncExternalStore } from "react";
import { AppState, View } from "react-native";
import { PICKER_ACCEPT } from "@jagentchill/media";
import type { ProjectDocument } from "@jagentchill/protocol";
import { BottomSheet, Button, Icon, ProgressBar, Tabs, Text, space, useHostGate, useToast } from "@jagentchill/ui";
import { useT } from "../locale";
import { pickFiles, pickNativeMedia } from "../platform/store";
import { nativeMediaReader } from "./remote-media";
import { plainImportFailure } from "./native-import-queue";
import { MediaPanel, type CommitFn, type TimelineBridge } from "./MediaPanel";
import type { MediaSession } from "./session";

/**
 * The media library on a phone: a bottom sheet with the tabs Device (the system picker of the device's photos and
 * files), Project (this project's library) and Library (stock and connectors, which need a host).
 */
export function MediaSheet(props: { open: boolean; onClose(): void; session: MediaSession; document: ProjectDocument; commit: CommitFn; readOnly?: boolean; timeline?: TimelineBridge | null; onPick?(assetIds: string[]): void }) {
  const t = useT();
  const toast = useToast();
  const gate = useHostGate();
  const mediaState = useSyncExternalStore(props.session.subscribe, props.session.getState, props.session.getState);
  const [tab, setTab] = useState<"device" | "project" | "library">("project");
  const fromDevice = async (accept: string) => {
    if (props.session.platform === "mobile") {
      const kind = accept === "video/*" ? "videos" : accept === "image/*" ? "photos" : "files";
      let files;
      try { files = await pickNativeMedia(kind); }
      catch (error) { toast.show({ kind: "error", message: t(plainImportFailure(error)) }); return; }
      if (files.length === 0) return;
      setTab("project");
      const result = await props.session.importNativeFiles(files.map(nativeMediaReader));
      if (result.failures.length) toast.show({ kind: "warning", message: result.failures.map((entry) => `${entry.name}: ${t(entry.error)}`).join(" · ") });
      else if (result.imported.length) toast.show({ kind: "success", message: result.imported.length === 1 ? t("{name} has been uploaded", { name: result.imported[0].name }) : t("{n} media assets have been uploaded", { n: result.imported.length }) });
      props.onPick?.(result.imported.map((entry) => entry.assetId));
      return;
    }
    const files = await pickFiles(accept, true);
    if (files.length === 0) return;
    setTab("project");
    const result = await props.session.importFiles(files.map((file) => ({ file })));
    if (result.imported.length === 0 && result.failures.length === 0 && result.reused.length === 0) return;
    toast.show({ kind: result.imported.length ? "success" : "warning", message: result.imported.length === 1 ? t("{name} has been uploaded", { name: result.imported[0].name }) : result.imported.length > 1 ? t("{n} media assets have been uploaded", { n: result.imported.length }) : t("No media assets were uploaded") });
    props.onPick?.([...result.imported, ...result.reused].map((entry) => entry.assetId));
  };
  useEffect(() => {
    if (props.session.platform !== "mobile") return;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void props.session.resumeNativeImport();
      else if (state === "background" || state === "inactive") props.session.pauseNativeImport();
    });
    return () => subscription.remove();
  }, [props.session]);
  return (
    <BottomSheet open={props.open} onClose={props.onClose} title={t("Media")} snap={0.9} padded={false}>
      <View testID="media-sheet" style={{ flex: 1, minHeight: 420 }}>
        {mediaState.nativeImports.map((row) => (
          <View key={row.id} testID={`media-upload-${row.state}`} accessibilityLabel={`${row.name} ${row.percent}%`} style={{ flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[3], paddingVertical: space[1.5], borderBottomWidth: 1, borderBottomColor: "#00000012" }}>
            <View style={{ flex: 1, minWidth: 0, gap: space[0.5] }}>
              <Text variant="meta" numberOfLines={1}>{row.name} · {row.percent}%</Text>
              <ProgressBar value={row.percent / 100} label={`${row.name} ${row.percent}%`} />
              {row.error ? <Text variant="caption" color="danger" numberOfLines={2}>{t(row.error)}</Text> : null}
            </View>
            {row.state === "failed" ? <Button label={t("Retry")} onPress={() => void props.session.retryNativeImport(row.id)} /> : null}
            {row.state === "uploading" || row.state === "queued" || row.state === "paused" ? <Button label={t("Cancel")} onPress={() => props.session.cancelImport(row.id)} /> : null}
          </View>
        ))}
        {mediaState.importing ? (
          <View testID="media-upload-progress" role="status" style={{ flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[3], paddingVertical: space[2] }}>
            <View style={{ flex: 1, gap: space[1] }}>
              <Text variant="meta" numberOfLines={1}>{t("Processing your files ({percent} %)", { percent: mediaState.importing.percent })} · {t("{n} of {m}", { n: mediaState.importing.completed, m: mediaState.importing.total })}</Text>
              <ProgressBar value={mediaState.importing.percent / 100} label={t("Processing your files ({percent} %)", { percent: mediaState.importing.percent })} />
            </View>
            <Button label={t("Cancel")} onPress={() => props.session.cancelImport()} />
          </View>
        ) : null}
        <View style={{ paddingHorizontal: space[3], paddingBottom: space[2] }}>
          <Tabs id="media-sheet" variant="pill" label={t("Media")} value={tab} onChange={(id) => setTab(id as typeof tab)} items={[{ id: "device", label: t("Device") }, { id: "project", label: t("Project") }, { id: "library", label: t("Library") }]} />
        </View>
        {tab === "device" ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space[2], padding: space[4] }}>
            <Icon name="image" size={32} color="text/secondary" />
            <Text color="text/secondary" align="center">{t("Add photos, videos and audio from this device to the project.")}</Text>
            <Button kind="strong" icon="video" label={t("Videos")} testID="media-pick-videos" disabled={props.readOnly} onPress={() => void fromDevice("video/*")} />
            <Button icon="image" label={t("Photos")} testID="media-pick-photos" disabled={props.readOnly} onPress={() => void fromDevice("image/*")} />
            <Button icon="folder" label={t("Browse files")} testID="media-browse-files" disabled={props.readOnly} onPress={() => void fromDevice(PICKER_ACCEPT)} />
          </View>
        ) : tab === "project" ? <>
          <MediaPanel session={props.session} document={props.document} commit={props.commit} readOnly={props.readOnly} timeline={props.timeline} onPick={props.onPick} />
        </>
          : (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space[2], padding: space[4] }}>
              <Icon name="film" size={32} color="text/secondary" />
              <Text variant="body-medium" align="center">{t("Connect a stock source in Settings")}</Text>
              <Text color="text/secondary" align="center">{t("Stock video and images are searched through a connected host.")}</Text>
              {gate.connected ? null : <Button label={t("Connect a host")} onPress={() => gate.onRequiresHost(t("Stock media"))} />}
            </View>
          )}
      </View>
    </BottomSheet>
  );
}
