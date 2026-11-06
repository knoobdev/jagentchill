import { useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, Image, ScrollView, View } from "react-native";
import { exporting, presetOf, usePrefValue } from "./prefs";
import { captionTracksOf, creditsText, formatTimecode, licenceCheck, parseTimecode, setExportSettings, setPublishCaption, timeline, uuidV4 } from "@jagentchill/editor-core";
import type { ProjectDocument } from "@jagentchill/protocol";
import { Button, Checkbox, FormDialog, Icon, IconButton, Input, Menu, Segmented, Select, Surface, Switch, Tap, Text, radius, space, useTheme, useToast, type MenuItem } from "@jagentchill/ui";
import { useT } from "../../locale";
import { imageUrl, releaseImageUrl } from "../../platform/store";
import { useDevice, useProjectImage } from "../../state";
import { useEditor } from "../context";
import { useExports, useHostCapabilities, takeExportAgain } from "./hooks";
import { JobCompletion, JobFailure, JobProgress } from "./JobViews";
import { createHostExport, downloadHostExport, exportPlatform, hasDirectoryPicker, hasSavePicker, pickFolder, pickSaveFile, probeAudioEncoders, probeVideoEncoders, saveHostExportToPhotos, shareHostExport, type FolderHandle, type SaveHandle } from "./platform";
import { exportService } from "./service";
import { useHost } from "../../host";
import { loadSigner } from "../../identity";
import { cancelHostExport as requestHostExportCancel, watchHostExport } from "./remote-client";

type Settings = exporting.ExportSettings;
type Line = { text: string; values?: Record<string, string | number> };
const OPEN_DEFAULT: Record<string, boolean> = { video: true, audio: true, captions: true, gif: false, destination: true, provenance: false };

/** A collapsible section of the settings column: a 32 px header over a hairline, with an optional control at its end. */
function Section(props: { id: string; title: string; open: boolean; onToggle(): void; end?: ReactNode; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View testID={`export-section-${props.id}`} style={{ borderTopWidth: 1, borderTopColor: theme.color("border/hairline") }}>
      <View style={{ height: 32, flexDirection: "row", alignItems: "center", paddingEnd: space[3] }}>
        <Tap role="button" label={props.title} expanded={props.open} onPress={props.onToggle} style={{ flex: 1, height: 32, flexDirection: "row", alignItems: "center", gap: space[1.5], paddingStart: space[3] }}>
          <Icon name={props.open ? "chev-d" : "chev-r"} size={14} color="text/secondary" />
          <Text variant="body-medium" level={3}>{props.title}</Text>
        </Tap>
        {props.end}
      </View>
      {props.open ? <View style={{ paddingTop: space[1], paddingHorizontal: space[3], paddingBottom: space[3], gap: space[1.5] }}>{props.children}</View> : null}
    </View>
  );
}
/** A settings row: an 80 px label and its control. */
const Field = (props: { label: string; children: ReactNode }) => (
  <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: space[2], minHeight: 28, minWidth: 0 }}>
    <Text variant="meta" color="text/secondary" style={{ width: 80 }}>{props.label}</Text>
    {props.children}
  </View>
);
/** Two fields side by side; one under the other where the dialog is narrow. */
function Pair(props: { children: ReactNode }) {
  const theme = useTheme();
  return <View style={theme.width < 600 ? { gap: space[1.5] } : { flexDirection: "row", gap: space[3] }}>{props.children}</View>;
}
/** A segmented control that scrolls sideways where the dialog is too narrow for its options. */
function Scrolling(props: { children: ReactNode }) {
  const theme = useTheme();
  return theme.width < 600 ? <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 1, flexShrink: 1 }}>{props.children}</ScrollView> : <>{props.children}</>;
}
const Grow = (props: { children: ReactNode; testID?: string }) => <View testID={props.testID} style={{ flex: 1, minWidth: 0 }}>{props.children}</View>;

/**
 * The export dialog of the editor: the export type, the cover and the output summary beside the settings of the chosen
 * type, and — once Export is pressed — the pre-flight list, the progress of the job and its completion or failure.
 * Closing it never cancels a running export.
 */
export function ExportDialog(props: { onClose(): void }) {
  const t = useT();
  const theme = useTheme();
  const toast = useToast();
  const router = useRouter();
  const runtime = useEditor();
  const { storage } = useDevice();
  const exportsState = useExports();
  const host = useHostCapabilities();
  const hostState = useHost();
  const document = runtime.controller.stored, canvas = document.settings.canvasSize, projectFps = document.settings.fps, sceneId = runtime.controller.session.sceneId;
  const scene = timeline.sceneById(document, sceneId), whole = timeline.sceneDurationOf(scene);
  const [deviceDefault, setDeviceDefault] = usePrefValue("last");
  const [userPresets, setUserPresets] = usePrefValue("presets");
  const [settings, setSettings] = useState<Settings>(() => {
    const again = takeExportAgain(document.metadata.id);
    const stored = (document as { exportSettings?: exporting.StoredExportSettings }).exportSettings;
    return again ?? (stored ? exporting.fromStoredExportSettings(stored, exporting.DEFAULT_EXPORT_SETTINGS) : deviceDefault ? exporting.fromStoredExportSettings(deviceDefault, exporting.DEFAULT_EXPORT_SETTINGS) : exporting.applyPreset("match-project"));
  });
  const [name, setName] = useState(document.metadata.name);
  const [open, setOpen] = useState(OPEN_DEFAULT);
  const [notice, setNotice] = useState<Line | null>(null);
  const [video, setVideo] = useState<Record<exporting.VideoCodec, boolean> | null>(null);
  const [audio, setAudio] = useState<{ aac: boolean; opus: boolean; flac: boolean; mp3: boolean } | null>(null);
  const [unsupportedSizes, setUnsupportedSizes] = useState<Record<string, boolean>>({});
  const [free, setFree] = useState<number | null>(null);
  const [file, setFile] = useState<SaveHandle | null>(null);
  const [folder, setFolder] = useState<FolderHandle | null>(null);
  const [saveCover, setSaveCover] = useState(false);
  const [sequenceConfirmed, setSequenceConfirmed] = useState(false);
  const [outputs, setOutputs] = useState<Settings[]>([]);
  const [preflight, setPreflight] = useState<exporting.PreflightResult | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [hostJob, setHostJob] = useState<exporting.RemoteJob | null>(null), [hostFile, setHostFile] = useState<string | null>(null), [hostTransfer, setHostTransfer] = useState<{ done: number; total: number } | null>(null);
  const [menu, setMenu] = useState(false);
  const [naming, setNaming] = useState<{ name: string; overwrite: boolean; problem: string | null } | null>(null);
  const [publish, setPublish] = useState(() => ({ title: (document as { publish?: { title?: string } }).publish?.title ?? "", description: (document as { publish?: { description?: string } }).publish?.description ?? "" }));
  const [frame, setFrame] = useState<string | null>(null);
  const [rangeDraft, setRangeDraft] = useState<{ start: string; end: string } | null>(null);
  const menuRef = useRef<View>(null);
  // Only a cover counts here: a project without one shows the frame at the start of the range, not its card thumbnail.
  const projectImage = useProjectImage(document.metadata.id, document.cover ? { mime: document.cover.image.mime } : null, 0), coverUrl = document.cover ? projectImage : null;

  // — What the device and the host can encode —
  const size = exporting.outputSize(settings, canvas), rate = settings.type === "gif" ? { numerator: settings.gif.frameRate, denominator: 1 } : exporting.outputFrameRate(settings, projectFps);
  const mbps = exporting.videoBitrateMbps(settings, size, exporting.rateValue(rate));
  useEffect(() => { void probeAudioEncoders(settings.sampleRate, settings.channels).then(setAudio); }, [settings.sampleRate, settings.channels]);
  useEffect(() => {
    // Asked again within 200 ms of a change of size, rate or bitrate.
    let cancelled = false;
    const timer = setTimeout(() => void probeVideoEncoders(size, exporting.rateValue(rate), Math.round(mbps * 1_000_000), settings.hardwareAcceleration).then((answer) => { if (!cancelled) setVideo(answer); }), 120);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [size.width, size.height, rate.numerator, rate.denominator, mbps, settings.hardwareAcceleration]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // Which resolutions the selected codec cannot encode here.
    if (settings.type !== "video" || settings.target !== "device" || !(exporting.VIDEO_CODECS as readonly string[]).includes(settings.videoCodec)) { setUnsupportedSizes({}); return; }
    let cancelled = false;
    const modes = exporting.RESOLUTION_MODES.filter((mode) => mode !== "custom");
    void Promise.all(modes.map(async (mode) => {
      const at = exporting.outputSize({ resolution: { ...settings.resolution, mode } }, canvas), fps = exporting.rateValue(rate);
      const answer = await probeVideoEncoders(at, fps, Math.round(exporting.videoBitrateMbps({ ...settings, bitrateLevel: "recommended" }, at, fps) * 1_000_000), settings.hardwareAcceleration);
      return [mode, !answer[settings.videoCodec as exporting.VideoCodec]] as const;
    })).then((entries) => { if (!cancelled) setUnsupportedSizes(Object.fromEntries(entries)); });
    return () => { cancelled = true; };
  }, [settings.type, settings.target, settings.videoCodec, settings.hardwareAcceleration, canvas.width, canvas.height, rate.numerator, rate.denominator]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void storage?.available().then(setFree, () => setFree(null)); }, [storage]);
  useEffect(() => {
    if (!hostJob || !hostState.connection || ["succeeded", "failed", "cancelled"].includes(hostJob.state)) return;
    const connection = hostState.connection, id = hostJob.jobId;
    let live = true;
    const off = watchHostExport(connection, id, (job) => { if (live) setHostJob(job); });
    const timer = setInterval(() => void connection.call<exporting.RemoteJob>(exporting.EXPORT_RPC.get, { jobId: id }).then((job) => { if (live) setHostJob(job); }, () => undefined), 1000);
    return () => { live = false; clearInterval(timer); off(); void connection.call("jagentchill.export.unsubscribe", { jobId: id }).catch(() => undefined); };
  }, [hostJob?.jobId, hostJob?.state, hostState.connection]);
  const caps = useMemo<exporting.Capabilities>(() => ({
    platform: exportPlatform, host,
    device: { backend: runtime.transport.engine === "no-gpu" ? "none" : "webgl2", video: video ?? { h264: true, hevc: true, vp9: true, av1: true }, audio: audio ?? { aac: true, opus: true, flac: true, mp3: false }, onDeviceVideoExport: exportPlatform !== "mobile" },
  }), [host, video, audio, runtime]);
  useEffect(() => {
    const next = exporting.preselectTarget(settings, host, exporting.anyDeviceVideoEncoder(caps));
    if (next.target !== settings.target) setSettings(next);
  }, [settings, host, caps]);
  // A codec that stopped being encodable after a change falls back, and the change is named.
  useEffect(() => {
    if (!video || settings.type !== "video") return;
    const change = exporting.fallbackCodec(settings, video, size);
    if (change.notice) { setSettings(change.settings); setNotice(change.notice); }
  }, [video]); // eslint-disable-line react-hooks/exhaustive-deps

  // — Derived —
  const resolved = useMemo(() => exporting.resolveH264Aac(settings, caps), [settings, caps]);
  const effective = resolved.settings;
  const range = exporting.exportRange(effective, scene, whole, rate), duration = effective.type === "still" ? 0 : range.end - range.start;
  const estimate = exporting.estimateExport(effective, canvas, projectFps, duration);
  const elements = timeline.elementsOfScene(scene);
  const audible = elements.some((element) => timeline.isAudioCapable(document, element) && element.muted !== true) && ![...scene.tracks.audio, scene.tracks.main, ...scene.tracks.overlay].every((track) => track.muted === true);
  const captionTracks = captionTracksOf(document, sceneId);
  const ranged = exporting.hasRange(scene, whole);
  const transparent = (document.settings.background as { kind?: string }).kind === "transparent";
  const blocker = exporting.exportBlocker(effective, { caps, durationTicks: duration, hasAudibleSource: audible, hasCaptionTrack: captionTracks.length > 0, hasRange: ranged, freeBytes: free, estimateBytes: estimate.bytes, transparentBackground: transparent, sequenceConfirmed, frames: estimate.frames ?? 0 });
  const source = exporting.digitalSourceType(elements as never, document.media.assets as never, range);
  const soloed = [...scene.tracks.audio, scene.tracks.main, ...scene.tracks.overlay].some((track) => track.solo === true);
  const usedAssets = document.media.assets.filter((asset) => elements.some((element) => (element as { mediaId?: string }).mediaId === asset.id && element.startTime < range.end && element.startTime + element.duration > range.start));
  const credits = usedAssets.some((asset) => exporting.needsAttribution(asset as never));
  const extension = exporting.fileExtension(effective);
  const baseName = exporting.sanitiseFileName(name);
  const fileName = effective.type === "still" && name === document.metadata.name ? exporting.stillFileName(document.metadata.name, runtime.controller.session.playhead, projectFps, effective.still.format) : `${baseName}.${extension}`;
  const preset = presetOf(settings, userPresets);
  const job = jobId ? exportsState.queue.jobs.find((entry) => entry.id === jobId) ?? exportsState.queue.history.find((entry) => entry.id === jobId) ?? null : null;
  useEffect(() => { if (!jobId) return; exportService.watch(jobId, true); return () => exportService.watch(jobId, false); }, [jobId]);

  // The thumbnail: the cover, or the frame at the start of the range when the project has none.
  useEffect(() => {
    if (coverUrl || !runtime.engine) return;
    let made: string | null = null, cancelled = false;
    void runtime.engine.still(range.start, "jpeg").then((bytes) => { if (bytes && !cancelled) { made = imageUrl(bytes, "image/jpeg"); setFrame(made); } });
    return () => { cancelled = true; if (made) releaseImageUrl(made); };
  }, [coverUrl, range.start, runtime.engine]);

  const change = (patch: Partial<Settings>) => { setSettings((current) => exporting.edit(current, patch)); setNotice(null); setPreflight(null); };
  const apply = (result: exporting.Change) => { setSettings(result.settings); setNotice(result.notice); setPreflight(null); };
  const choosePreset = (id: string) => {
    const user = userPresets.find((entry) => entry.id === id);
    setSettings(user ? { ...user.settings, presetId: user.id } : exporting.applyPreset(id, settings));
    setNotice(null); setPreflight(null);
  };
  const savePreset = (presetName: string, overwrite: boolean) => {
    const result = exporting.saveUserPreset(userPresets, presetName, settings, { overwrite, newId: () => uuidV4() });
    if (result.state === "saved") { setUserPresets(result.presets); setSettings({ ...settings, presetId: result.preset.id }); setNaming(null); toast.show({ kind: "success", message: t("Preset saved") }); }
    else if (result.state === "duplicate") setNaming({ name: presetName, overwrite: true, problem: t("A preset named “{name}” exists. Save again to overwrite it.", { name: result.existing.name }) });
    else setNaming({ name: presetName, overwrite: false, problem: t(result.message) });
  };
  const chooseDestination = async () => {
    if (effective.type === "image-sequence" || effective.type === "captions") { const picked = await pickFolder(); if (picked && picked !== "cancelled") setFolder(picked); return; }
    const picked = await pickSaveFile(fileName, exporting.mimeOf(effective));
    if (picked && picked !== "cancelled") setFile(picked);
  };

  // — Starting —
  // `undrawable`: the file is here, but this device found it cannot decode it — a video (and no proxy stands in for
  // it), a picture or a sound. What arrived by sync is looked at like what was imported here (`session.ts learnDecodable`).
  const localOf = (assetId: string) => (document as { local?: { media?: Record<string, { canDecode?: boolean | null; canDecodeSound?: boolean | null; proxy?: { state?: string } }> } }).local?.media?.[assetId];
  const mediaStates = async (): Promise<Map<string, "ready" | "missing" | "undrawable">> => new Map(await Promise.all(document.media.assets.map(async (asset) => {
    return [asset.id, exporting.deviceMediaState(asset, localOf(asset.id), (await runtime.media.mediaUrl(asset.id).catch(() => null)) !== null)] as const;
  })));
  // A video's sound is looked at as well as its picture: a sound track this device cannot decode is named before the export.
  const soundState = (assetId: string) => { const asset = document.media.assets.find((entry) => entry.id === assetId); return asset ? exporting.deviceSoundState(asset, localOf(assetId)) : "ok" as const; };
  /** Leaves the dialog for the clip a check or a failure names: selected, with the playhead on it. */
  const showClip = (elementId: string) => {
    const hit = timeline.locate(runtime.controller.stored, elementId);
    if (!hit) return;
    if (hit.scene.id !== runtime.controller.session.sceneId) runtime.controller.switchScene(hit.scene.id);
    runtime.controller.select(timeline.selectElements([elementId]));
    runtime.seek(hit.element.startTime);
    props.onClose();
  };
  const check = async (target: Settings, waivers?: Partial<Record<exporting.Waiver, boolean>>): Promise<exporting.PreflightResult> => {
    // A host export reads the synced project and assets on the host. Asking the phone media store for Blob URLs here
    // can fail on native runtimes that do not implement Blob from ArrayBuffer views, and those URLs are not used by
    // the host renderer in any case.
    const states = target.target === "host" ? new Map(document.media.assets.map((asset) => [asset.id, "ready" as const])) : await mediaStates(), at = exporting.exportRange(target, scene, whole, target.type === "gif" ? { numerator: target.gif.frameRate, denominator: 1 } : exporting.outputFrameRate(target, projectFps));
    return exporting.runPreflight({
      document: document as never, sceneId, range: target.type === "still" ? { start: 0, end: Math.max(1, whole) } : at, frameTicks: Math.round((exporting.TICKS_PER_SECOND * rate.denominator) / rate.numerator), target: target.target, platform: exportPlatform,
      mediaState: (assetId) => states.get(assetId) ?? "missing", soundState: target.target === "host" ? () => "ok" as const : soundState, backend: caps.device.backend, estimateBytes: exporting.estimateExport(target, canvas, projectFps, at.end - at.start).bytes, freeBytes: free, waivers,
    });
  };
  const start = async (waivers?: Partial<Record<exporting.Waiver, boolean>>) => {
    const all = [effective, ...outputs];
    // Each output is checked on its own; what fails is listed and the rest is queued.
    const first = await check(effective, waivers);
    if (!first.ok) { setPreflight(first); return; }
    // "Export anyway" leaves out only the media that was on screen by name when it was pressed (`preflight`).
    const waivedAssetIds = waivers?.allowMissingMedia ? exporting.waivedMediaAssets(preflight, document as never) : undefined;
    if (effective.target === "host") {
      const { connection, host: pairedHost } = hostState;
      if (!connection || !pairedHost || !host?.remoteExport) { toast.show({ kind: "error", message: t("Export on host needs a host that advertises remote export") }); return; }
      try {
        const range = exporting.exportRange(effective, scene, whole, exporting.outputFrameRate(effective, projectFps));
        const made = await createHostExport({ host: pairedHost, connection, signer: await loadSigner(), projectId: document.metadata.id, settings: effective, range, fileName });
        setHostJob(made); setHostFile(null); setHostTransfer(null);
        await connection.call("jagentchill.export.subscribe", { jobId: made.jobId }).then((job) => setHostJob(job as exporting.RemoteJob));
      } catch (error) { toast.show({ kind: "error", message: error instanceof Error ? error.message : String(error) }); }
      return;
    }
    // The browser's save dialog opens with the press of Export, where the browser has one.
    let destination = file, directory = folder;
    if (all.length === 1 && !destination && !directory && effective.type !== "captions") {
      if (effective.type === "image-sequence") { if (hasDirectoryPicker()) { const picked = await pickFolder(); if (picked === "cancelled") return; directory = picked; } }
      else if (hasSavePicker()) { const picked = await pickSaveFile(fileName, exporting.mimeOf(effective)); if (picked === "cancelled") return; destination = picked; }
    }
    const stored = exporting.toStoredExportSettings(effective, canvas, projectFps, (document as { exportSettings?: exporting.StoredExportSettings }).exportSettings);
    runtime.controller.external((doc, ctx) => setExportSettings(doc, ctx, stored as Record<string, unknown>));
    setDeviceDefault(stored);
    const snapshot = runtime.controller.stored;
    let firstJob: string | null = null;
    const used = new Set<string>();
    for (const [index, target] of all.entries()) {
      if (index > 0 && !(await check(target, waivers)).ok) { toast.show({ kind: "warning", message: t("An output was not queued: {reason}", { reason: t("Project is empty") }) }); continue; }
      const outName = exporting.uniqueFileName(target.type === "still" && index === 0 ? fileName.replace(/\.[a-z0-9]+$/i, "") : baseName, exporting.fileExtension(target), (candidate) => used.has(candidate));
      used.add(outName);
      const result = exportService.start({ document: snapshot, sceneId, settings: target, fileName: outName, playhead: runtime.controller.session.playhead, waivers, waivedAssetIds, file: index === 0 ? destination : null, folder: index === 0 ? directory : null, saveCover: index === 0 && saveCover, notice: index === 0 ? resolved.notice ?? undefined : undefined });
      if (!result.ok) { toast.show({ kind: "error", message: t(result.message) }); break; }
      firstJob ??= result.job.id;
    }
    setPreflight(null); setOutputs([]);
    if (firstJob) setJobId(firstJob);
  };
  const retry = (sameSnapshot: boolean, patch?: Partial<Settings>) => {
    if (!job) return;
    if (sameSnapshot) { void exportService.retrySameSnapshot(job.id).then((made) => { if (made) setJobId(made.id); else toast.show({ kind: "warning", message: t("The snapshot of this export is no longer on this device") }); }); return; }
    const result = exportService.start({ document: runtime.controller.stored, sceneId: job.sceneId, settings: { ...job.settings, ...patch }, fileName: job.fileName, playhead: runtime.controller.session.playhead, waivers: job.waivers, waivedAssetIds: job.waivedAssetIds });
    if (result.ok) setJobId(result.job.id); else toast.show({ kind: "error", message: t(result.message) });
  };
  const savePublish = (next: { title: string; description: string }) => { setPublish(next); runtime.controller.external((doc: ProjectDocument, ctx) => setPublishCaption(doc, ctx, next)); };
  const setRangePoint = (point: "in" | "out", value: string) => {
    const time = parseTimecode(value, "HH:MM:SS:FF", projectFps);
    setRangeDraft(null);
    if (time !== null) runtime.controller.run(timeline.setRangePoint({ sceneId, point, time: Math.min(whole, Math.max(0, time)) }));
  };

  // The cover editor is a dialog of its own: this one waits behind it with its state.
  if (runtime.dialog?.kind === "cover") return null;
  const toggle = (id: string) => setOpen({ ...open, [id]: !open[id] });
  const line = (value: Line | null) => (value ? t(value.text, value.values) : "");
  const targets = exporting.targetOptions(host, exporting.anyDeviceVideoEncoder(caps), effective.type);
  const codecRows = exporting.codecOptions(effective, caps);
  const audioChoices = exporting.needsAudioChoice(settings, caps) ? exporting.audioFallbackChoices(caps) : [];
  const audioSummary = effective.includeAudio ? `${exporting.AUDIO_CODEC_LABELS[effective.audioCodec]}${effective.audioCodec === "pcm" ? "" : ` ${effective.audioBitrateKbps} kbps`} · ${effective.sampleRate / 1000} kHz ${t(effective.channels === 2 ? "stereo" : "mono")}` : t("None");
  const rangeText = effective.range === "in-out" && ranged ? t("In/out range") : t("Whole timeline");
  const summary: [string, string][] = effective.type === "video" ? [
    [t("Preset"), t(preset)], [t("Resolution"), `${size.width} × ${size.height}`], [t("Frame rate"), t("{fps} fps", { fps: exporting.rateLabel(rate) })],
    [t("Video"), `${exporting.CODEC_LABELS[effective.videoCodec]} · ${mbps.toFixed(1)} Mbps ${effective.rateControl.toUpperCase()}`], [t("Audio"), audioSummary],
    [t("Captions"), captionTracks.length === 0 ? t("None") : effective.burnCaptions ? t("Burned in") : t("Not burned in")], [t("Range"), rangeText],
  ] : effective.type === "gif" ? [[t("Preset"), t(preset)], [t("Resolution"), `${exporting.gifSize(canvas, effective.gif.shortSide).width} × ${exporting.gifSize(canvas, effective.gif.shortSide).height}`], [t("Frame rate"), t("{fps} fps", { fps: effective.gif.frameRate })], [t("Range"), rangeText]]
    : effective.type === "audio" ? [[t("Preset"), t(preset)], [t("Format"), exporting.AUDIO_ONLY_LABELS[effective.audioOnly.format]], [t("Audio"), `${effective.sampleRate / 1000} kHz ${t(effective.channels === 2 ? "stereo" : "mono")}`], [t("Range"), rangeText]]
    : effective.type === "captions" ? [[t("Format"), effective.sidecar.format.toUpperCase()], [t("Range"), rangeText]]
    : [[t("Preset"), t(preset)], [t("Resolution"), `${size.width} × ${size.height}`], [t("Format"), (effective.type === "still" ? effective.still.format : effective.imageSequence.format).toUpperCase()], ...(effective.type === "image-sequence" ? [[t("Range"), rangeText] as [string, string]] : [])];
  const aspect = (effective.type === "video" || effective.type === "image-sequence" || effective.type === "still") && exporting.aspectDiffers(effective, canvas);
  const messages: { text: string; level?: "danger" | "warning"; id: string }[] = [
    ...(notice ? [{ text: line(notice), id: "notice" }] : []), ...(resolved.notice ? [{ text: t(resolved.notice), id: "codec-notice" }] : []), ...(aspect ? [{ text: t(exporting.ASPECT_WARNING), level: "warning" as const, id: "aspect" }] : []),
    ...(effective.type === "video" && transparent && !effective.includeTransparency ? [{ text: t(exporting.FLATTEN_MESSAGE), id: "flatten" }] : []),
    ...(exportsState.backgroundNotice ? [{ text: t("This tab is in the background: the browser slows the export down."), level: "warning" as const, id: "background" }] : []),
  ];
  const presetOptions = [
    ...exporting.BUILT_IN_PRESETS.map((entry) => ({ value: entry.id, label: t(entry.name) })), ...userPresets.map((entry) => ({ value: entry.id, label: entry.name, group: t("Saved presets") })),
    ...(settings.presetId === null ? [{ value: "custom", label: t("Custom") }] : []),
  ];
  const userPreset = userPresets.find((entry) => entry.id === settings.presetId);
  const presetMenu: MenuItem[] = [
    { id: "save", label: t("Save as preset"), icon: "plus", onSelect: () => (userPresets.length >= exporting.USER_PRESET_LIMIT ? toast.show({ kind: "warning", message: t(exporting.PRESET_LIMIT_MESSAGE) }) : setNaming({ name: "", overwrite: false, problem: null })) },
    { id: "delete", label: t("Delete preset"), icon: "trash", disabled: !userPreset, onSelect: () => { if (userPreset) { setUserPresets(exporting.deleteUserPreset(userPresets, userPreset.id)); setSettings({ ...settings, presetId: null }); } } },
    { type: "separator" },
    { id: "add-output", label: outputs.length >= 4 ? t("5 outputs maximum") : t("Add another output"), icon: "copy", disabled: outputs.length >= 4, onSelect: () => { setOutputs([...outputs, effective]); toast.show({ kind: "info", message: t("Output added: {summary}", { summary: exporting.settingsSummary(effective, canvas, projectFps) }) }); } },
  ];
  const resolutionOptions = exporting.RESOLUTION_MODES.map((mode) => {
    const unsupported = unsupportedSizes[mode] === true;
    return { value: mode, label: mode === "project" ? t("Project ({width} × {height})", { width: canvas.width, height: canvas.height }) : t(exporting.RESOLUTION_LABELS[mode]), disabled: unsupported, ...(unsupported ? { description: line(exporting.resolutionReason(effective.videoCodec)) } : {}) };
  });
  const rateOptions = [{ value: "project", label: t("Project ({fps} fps)", { fps: exporting.rateLabel(projectFps) }) }, ...exporting.EXPORT_FRAME_RATES.map((fps) => ({ value: String(fps), label: t("{fps} fps", { fps }) }))];
  const audioCodecOptions = exporting.audioBitrates(effective.audioCodec).map((kbps) => ({ value: String(kbps), label: `${exporting.AUDIO_CODEC_LABELS[effective.audioCodec]} · ${kbps} kbps` }));
  const sampleOptions = exporting.SAMPLE_RATES.flatMap((sampleRate) => ([2, 1] as const).map((channels) => ({ value: `${sampleRate}/${channels}`, label: `${sampleRate / 1000} kHz ${t(channels === 2 ? "stereo" : "mono")}` })));
  const view = job ? (job.state === "succeeded" ? "done" : job.state === "failed" ? "failed" : job.state === "cancelled" ? "settings" : "progress") : preflight ? "preflight" : "settings";
  const narrow = theme.width < 960;
  const phone = theme.width < 600;
  const destinationText = folder ? folder.name : file ? file.name : effective.type === "image-sequence" ? (hasDirectoryPicker() ? t("Chosen when the export starts") : t("Browser downloads (one ZIP file)")) : hasSavePicker() ? t("Chosen when the export starts") : t("Browser downloads");
  const anyway = preflight ? exporting.exportAnyway(preflight) : null;

  const settingsColumn = (
    <ScrollView style={{ flex: 1, minWidth: 0 }} keyboardShouldPersistTaps="handled">
      <View style={{ paddingVertical: space[3], paddingHorizontal: space[4], gap: space[1.5] }}>
        <Scrolling><Segmented label={t("Export type")} size="sm" block={!narrow} value={settings.type} onChange={(type) => { const next = exporting.edit(settings, { type }); setSettings(type === "captions" && !next.sidecar.enabled ? { ...next, sidecar: { ...next.sidecar, enabled: true } } : next); setFile(null); setFolder(null); setPreflight(null); }}
          options={exporting.EXPORT_TYPES.map((type) => ({ value: type, label: t(exporting.EXPORT_TYPE_LABELS[type]) }))} /></Scrolling>
        <View ref={menuRef} style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
          <Field label={t("Preset")}><Grow><Select label={t("Preset")} value={settings.presetId ?? "custom"} onChange={(id) => { if (id !== "custom") choosePreset(id); }} options={presetOptions} /></Grow></Field>
          <IconButton icon="more" size="sm" label={t("Preset and output actions")} expanded={menu} testID="export-preset-menu" onPress={() => setMenu(true)} />
          <Menu open={menu} anchor={menuRef} align="end" label={t("Preset and output actions")} items={presetMenu} onClose={() => setMenu(false)} />
        </View>
        {outputs.length > 0 ? <Text variant="meta" color="text/secondary" testID="export-outputs">{t("{n} more outputs will be exported", { n: outputs.length })}</Text> : null}
      </View>

      {effective.type === "video" || effective.type === "image-sequence" || effective.type === "still" ? (
        <Section id="video" title={effective.type === "video" ? t("Video") : t("Picture")} open={open.video} onToggle={() => toggle("video")}>
          <Pair>
            <Field label={t("Resolution")}><Grow testID="export-resolution"><Select size="sm" label={t("Resolution")} value={settings.resolution.mode} options={resolutionOptions} onChange={(mode) => change({ resolution: { ...settings.resolution, mode, ...(mode === "custom" ? { width: size.width, height: size.height } : {}) } })} /></Grow></Field>
            {effective.type === "still" ? <Grow><View /></Grow> : <Field label={t("Frame rate")}><Grow><Select size="sm" label={t("Frame rate")} value={settings.frameRate === "project" ? "project" : String(exporting.rateValue(settings.frameRate))} options={rateOptions} onChange={(value) => change({ frameRate: value === "project" ? "project" : { numerator: Number(value), denominator: 1 } })} /></Grow></Field>}
          </Pair>
          {settings.resolution.mode === "custom" ? (
            <Pair>
              <Field label={t("Width")}><Grow><NumberText label={t("Width")} value={settings.resolution.width} suffix="px" onCommit={(width) => change({ resolution: { ...settings.resolution, width: exporting.fixCustomSide(width) } })} /></Grow></Field>
              <Field label={t("Height")}><Grow><NumberText label={t("Height")} value={settings.resolution.height} suffix="px" onCommit={(height) => change({ resolution: { ...settings.resolution, height: exporting.fixCustomSide(height) } })} /></Grow></Field>
            </Pair>
          ) : null}
          {effective.type === "video" ? (
            <>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], minHeight: 28 }}>
                <Text variant="meta" color="text/secondary" numberOfLines={1}>{t("Smooth motion")}</Text>
                <Switch accessibilityLabel={t("Smooth motion")} value={settings.smoothMotion} disabled onChange={(smoothMotion) => change({ smoothMotion })} />
                <Text variant="meta" color="text/secondary" numberOfLines={2} style={{ flex: 1 }} testID="export-smooth-reason">{t("Optical flow is not available on this device")}</Text>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], minHeight: 28 }}>
                <Text variant="meta" color="text/secondary" style={{ width: 80 }}>{t("Bitrate")}</Text>
                <Scrolling><Segmented label={t("Bitrate")} size="sm" value={settings.bitrateLevel} onChange={(bitrateLevel) => change({ bitrateLevel, ...(bitrateLevel === "custom" ? { customMbps: mbps } : {}) })} options={exporting.BITRATE_LEVELS.map((level) => ({ value: level, label: t(exporting.BITRATE_LEVEL_LABELS[level]) }))} /></Scrolling>
                <Text variant="mono" color="text/secondary" testID="export-bitrate">{t("{n} Mbps", { n: mbps.toFixed(1) })}</Text>
              </View>
              {settings.bitrateLevel === "custom" ? <Pair><Field label={t("Custom")}><Grow><NumberText label={t("Custom bitrate")} value={settings.customMbps} suffix="Mbps" decimal onCommit={(value) => change({ bitrateLevel: "custom", customMbps: exporting.clampCustomMbps(value) })} /></Grow></Field><Grow><View /></Grow></Pair> : null}
              <Pair>
                <Field label={t("Codec")}><Grow><Select size="sm" label={t("Codec")} value={effective.videoCodec} onChange={(codec) => apply(exporting.chooseCodec(effective, codec))}
                  options={codecRows.filter((row) => exporting.containerAccepts(effective.container, row.codec, effective.target) || !row.host).map((row) => ({ value: row.codec, label: row.host ? `${row.label} · ${t("Host")}` : row.label, disabled: row.disabled, ...(row.reason ? { description: line(row.reason) } : {}) }))} /></Grow></Field>
                <Field label={t("Format")}><Grow testID="export-format"><Select size="sm" label={t("Format")} value={effective.container} onChange={(container) => apply(exporting.chooseContainer(effective, container))} options={exporting.CONTAINERS.map((container) => ({ value: container, label: exporting.CONTAINER_LABELS[container] }))} /></Grow></Field>
              </Pair>
              <Pair>
                <Field label={t("Rate control")}><Grow><Select size="sm" label={t("Rate control")} value={settings.rateControl} onChange={(rateControl) => change({ rateControl })} options={[{ value: "vbr", label: "VBR" }, { value: "cbr", label: "CBR" }]} /></Grow></Field>
                <Field label={t("Encoder")}><Grow><Select size="sm" label={t("Hardware acceleration")} value={settings.hardwareAcceleration} onChange={(hardwareAcceleration) => change({ hardwareAcceleration })} options={[{ value: "auto", label: t("Auto") }, { value: "prefer-hardware", label: t("Prefer hardware") }, { value: "prefer-software", label: t("Prefer software") }]} /></Grow></Field>
              </Pair>
              <Field label={t("Colour")}><Text variant="meta" testID="export-colour">{line(exporting.colourRow(0))}</Text></Field>
            </>
          ) : (
            <Pair>
              <Field label={t("Format")}><Grow><Select size="sm" label={t("Format")} value={effective.type === "still" ? settings.still.format : settings.imageSequence.format} options={[{ value: "png", label: "PNG" }, { value: "jpeg", label: "JPEG" }]}
                onChange={(format) => change(effective.type === "still" ? { still: { ...settings.still, format } } : { imageSequence: { ...settings.imageSequence, format } })} /></Grow></Field>
              {(effective.type === "still" ? settings.still.format : settings.imageSequence.format) === "jpeg"
                ? <Field label={t("Quality")}><Grow><NumberText label={t("Quality")} value={effective.type === "still" ? settings.still.quality : settings.imageSequence.quality} onCommit={(value) => { const quality = Math.min(100, Math.max(1, Math.round(value))); change(effective.type === "still" ? { still: { ...settings.still, quality } } : { imageSequence: { ...settings.imageSequence, quality } }); }} /></Grow></Field>
                : effective.type === "image-sequence" ? <Grow><Checkbox label={t("Include transparency")} checked={settings.includeTransparency} onChange={(includeTransparency) => change({ includeTransparency })} /></Grow> : <Grow><View /></Grow>}
            </Pair>
          )}
          {effective.type === "image-sequence" && (estimate.frames ?? 0) > exporting.SEQUENCE_CONFIRM_FRAMES ? <Checkbox label={t("Export all {n} frames", { n: estimate.frames ?? 0 })} checked={sequenceConfirmed} onChange={setSequenceConfirmed} /> : null}
        </Section>
      ) : null}

      {effective.type === "video" || effective.type === "audio" ? (
        <Section id="audio" title={t("Audio")} open={open.audio} onToggle={() => toggle("audio")}
          end={effective.type === "video" ? <Switch accessibilityLabel={t("Include audio")} value={settings.includeAudio} onChange={(includeAudio) => change({ includeAudio })} /> : undefined}>
          {effective.type === "audio" ? (
            <>
              <Pair>
                <Field label={t("Format")}><Grow><Select size="sm" label={t("Format")} value={settings.audioOnly.format} onChange={(format) => change({ audioOnly: { ...settings.audioOnly, format, bitrateKbps: 192 } })}
                  options={exporting.AUDIO_ONLY_FORMATS.map((format) => { const ok = format === "wav" || (format === "m4a" ? caps.device.audio.aac : format === "flac" ? caps.device.audio.flac : caps.device.audio.mp3); return { value: format, label: exporting.AUDIO_ONLY_LABELS[format], disabled: !ok, ...(ok ? {} : { description: t("Not supported on this device") }) }; })} /></Grow></Field>
                {settings.audioOnly.format === "wav"
                  ? <Field label={t("Bit depth")}><Grow><Select size="sm" label={t("Bit depth")} value={String(settings.audioOnly.bitDepth)} onChange={(value) => change({ audioOnly: { ...settings.audioOnly, bitDepth: Number(value) as 16 | 24 } })} options={[{ value: "16", label: t("16-bit") }, { value: "24", label: t("24-bit") }]} /></Grow></Field>
                  : settings.audioOnly.format === "flac" ? <Grow><View /></Grow>
                  : <Field label={t("Bitrate")}><Grow><Select size="sm" label={t("Bitrate")} value={String(settings.audioOnly.bitrateKbps)} onChange={(value) => change({ audioOnly: { ...settings.audioOnly, bitrateKbps: Number(value) } })} options={(settings.audioOnly.format === "mp3" ? exporting.MP3_BITRATES : exporting.AAC_BITRATES).map((kbps) => ({ value: String(kbps), label: `${kbps} kbps` }))} /></Grow></Field>}
              </Pair>
              <Pair><Field label={t("Sample rate")}><Grow><Select size="sm" label={t("Sample rate")} value={`${settings.sampleRate}/${settings.channels}`} options={sampleOptions} onChange={(value) => { const [sampleRate, channels] = value.split("/").map(Number); change({ sampleRate: sampleRate as 44_100 | 48_000, channels: channels as 1 | 2 }); }} /></Grow></Field><Grow><View /></Grow></Pair>
            </>
          ) : settings.includeAudio ? (
            <>
              <Pair>
                <Field label={t("Codec")}><Grow>{effective.audioCodec === "pcm" ? <Text variant="meta">{t("16-bit PCM")}</Text> : <Select size="sm" label={t("Audio codec")} value={String(effective.audioBitrateKbps)} options={audioCodecOptions} onChange={(value) => change({ audioBitrateKbps: Number(value), audioCodec: effective.audioCodec, container: effective.container, videoCodec: effective.videoCodec })} />}</Grow></Field>
                <Field label={t("Sample rate")}><Grow><Select size="sm" label={t("Sample rate")} value={`${settings.sampleRate}/${settings.channels}`} options={sampleOptions} onChange={(value) => { const [sampleRate, channels] = value.split("/").map(Number); change({ sampleRate: sampleRate as 44_100 | 48_000, channels: channels as 1 | 2 }); }} /></Grow></Field>
              </Pair>
              {audioChoices.length > 0 ? (
                <View testID="export-audio-choices" style={{ gap: space[1] }}>
                  <Text variant="meta" color="text/secondary">{t("AAC is not supported on this device. Choose how to encode audio:")}</Text>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[1.5] }}>{audioChoices.map((choice) => <Button key={choice.id} size="sm" kind="outline" label={t(choice.label)} onPress={() => { setSettings(exporting.applyAudioFallback(settings, choice.id)); setNotice(choice.warning ? { text: choice.warning } : null); }} />)}</View>
                </View>
              ) : null}
              {settings.audioFallback === "opus-mp4" ? <Text variant="meta" color="warning/text">{t("Some players do not play Opus audio in MP4")}</Text> : null}
            </>
          ) : null}
          {soloed ? <Text variant="meta" color="text/secondary" testID="export-solo">{t("Solo is ignored when exporting")}</Text> : null}
          {credits ? <Checkbox label={t("Save credits file")} checked={settings.creditsFile} onChange={(creditsFile) => change({ creditsFile })} /> : null}
        </Section>
      ) : null}

      {effective.type === "video" || effective.type === "captions" || effective.type === "gif" || effective.type === "image-sequence" || effective.type === "still" ? (
        <Section id="captions" title={t("Captions")} open={open.captions} onToggle={() => toggle("captions")}>
          {captionTracks.length === 0 ? <Text variant="meta" color="text/secondary" testID="export-no-captions">{t(exporting.NO_CAPTIONS_MESSAGE)}</Text> : null}
          {effective.type !== "captions" ? <Checkbox label={t("Burn captions into video")} checked={settings.burnCaptions && captionTracks.length > 0} disabled={captionTracks.length === 0} onChange={(burnCaptions) => change({ burnCaptions })} /> : null}
          {effective.type === "video" || effective.type === "captions" ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], minHeight: 28 }}>
              <View style={{ flex: 1 }}>{effective.type === "captions" ? <Text variant="meta" color="text/secondary">{t("Caption file format")}</Text>
                : <Checkbox label={t("Export caption file")} checked={settings.sidecar.enabled && captionTracks.length > 0} disabled={captionTracks.length === 0} onChange={(enabled) => change({ sidecar: { ...settings.sidecar, enabled } })} />}</View>
              <Select size="xs" width={72} label={t("Caption file format")} value={settings.sidecar.format} disabled={captionTracks.length === 0 || (effective.type === "video" && !settings.sidecar.enabled)} onChange={(format) => change({ sidecar: { ...settings.sidecar, format } })} options={exporting.SIDECAR_FORMATS.map((format) => ({ value: format, label: format.toUpperCase() }))} />
            </View>
          ) : null}
          {captionTracks.length > 0 && (effective.type === "captions" || settings.sidecar.enabled) ? (
            <Pair>
              <Field label={t("Tracks")}><Grow><Select size="sm" label={t("Caption tracks")} value={settings.sidecar.trackIds?.[0] ?? "all"} onChange={(value) => change({ sidecar: { ...settings.sidecar, trackIds: value === "all" ? null : [value] } })} options={[{ value: "all", label: t("All caption tracks") }, ...captionTracks.map((track) => ({ value: track.id, label: track.name }))]} /></Grow></Field>
              <Field label={t("Content")}><Grow><Select size="sm" label={t("Caption content")} value={settings.sidecar.content} onChange={(content) => change({ sidecar: { ...settings.sidecar, content } })} options={[{ value: "primary", label: t("Primary") }, { value: "translation", label: t("Translation") }, { value: "both", label: t("Both") }]} /></Grow></Field>
            </Pair>
          ) : null}
        </Section>
      ) : null}

      {effective.type === "video" || effective.type === "gif" ? (
        <Section id="gif" title={t("GIF")} open={effective.type === "gif" ? true : open.gif} onToggle={() => toggle("gif")}>
          <Pair>
            <Field label={t("Size")}><Grow><Select size="sm" label={t("GIF size")} value={String(settings.gif.shortSide)} onChange={(value) => change({ gif: { ...settings.gif, shortSide: Number(value) }, type: settings.type })} options={exporting.GIF_SIDES.map((side) => { const at = exporting.gifSize(canvas, side); return { value: String(side), label: `${at.width} × ${at.height}` }; })} /></Grow></Field>
            <Field label={t("Frame rate")}><Grow><Select size="sm" label={t("GIF frame rate")} value={String(settings.gif.frameRate)} onChange={(value) => change({ gif: { ...settings.gif, frameRate: Number(value) } })} options={exporting.GIF_FRAME_RATES.map((fps) => ({ value: String(fps), label: t("{fps} fps", { fps }) }))} /></Grow></Field>
          </Pair>
          <Pair>
            <Field label={t("Loop")}><Grow><Select size="sm" label={t("Loop")} value={typeof settings.gif.loop === "number" ? "count" : settings.gif.loop} onChange={(value) => change({ gif: { ...settings.gif, loop: value === "count" ? 2 : (value as "forever" | "once") } })} options={[{ value: "forever", label: t("Forever") }, { value: "once", label: t("Once") }, { value: "count", label: t("A number of times") }]} /></Grow></Field>
            {typeof settings.gif.loop === "number" ? <Field label={t("Times")}><Grow><NumberText label={t("Loop count")} value={settings.gif.loop} onCommit={(value) => change({ gif: { ...settings.gif, loop: Math.min(100, Math.max(2, Math.round(value))) } })} /></Grow></Field> : <Grow><View /></Grow>}
          </Pair>
          <Pair>
            <Field label={t("Palette")}><Grow><Select size="sm" label={t("Palette")} value={settings.gif.palette} onChange={(palette) => change({ gif: { ...settings.gif, palette } })} options={[{ value: "per-frame", label: t("Per frame") }, { value: "global", label: t("Global") }]} /></Grow></Field>
            <Field label={t("Dithering")}><Grow><Select size="sm" label={t("Dithering")} value={settings.gif.dither} onChange={(dither) => change({ gif: { ...settings.gif, dither } })} options={[{ value: "floyd-steinberg", label: "Floyd–Steinberg" }, { value: "none", label: t("None") }]} /></Grow></Field>
          </Pair>
          {effective.type === "video" ? <Text variant="meta" color="text/secondary">{t("Used when the export type is GIF.")}</Text> : null}
        </Section>
      ) : null}

      <Section id="destination" title={t("Destination")} open={open.destination} onToggle={() => toggle("destination")}>
        <Field label={t("File name")}><Grow><Input size="sm" accessibilityLabel={t("File name")} testID="export-file-name" value={name} suffix={`.${extension}`} onChangeText={setName} onBlur={() => setName(exporting.sanitiseFileName(name))} /></Grow></Field>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
          <Field label={t("Folder")}><Grow><Input size="sm" mono readOnly accessibilityLabel={t("Folder")} testID="export-destination" value={destinationText} /></Grow></Field>
          <Button size="sm" kind="secondary" label={t("Choose…")} testID="export-choose" disabled={effective.type === "image-sequence" || effective.type === "captions" ? !hasDirectoryPicker() : !hasSavePicker()} onPress={() => void chooseDestination()} />
        </View>
        {effective.type !== "still" ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], minHeight: 28 }}>
            <Text variant="meta" color="text/secondary" style={{ width: 80 }}>{t("Range")}</Text>
            <Segmented label={t("Range")} size="sm" value={settings.range === "in-out" && ranged ? "in-out" : "all"} onChange={(value) => change({ range: value })} options={[{ value: "all", label: t("Entire timeline") }, { value: "in-out", label: t("In/out range"), disabled: !ranged }]} />
            {!ranged ? <Text variant="meta" color="text/secondary" testID="export-range-hint">{t(exporting.RANGE_HINT)}</Text> : settings.range === "in-out" ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: space[1] }}>
                <Input size="sm" mono style={{ width: 104 }} accessibilityLabel={t("Range start")} testID="export-range-start" value={rangeDraft?.start ?? formatTimecode(range.start, "HH:MM:SS:FF", projectFps) ?? ""} onChangeText={(value) => setRangeDraft({ start: value, end: rangeDraft?.end ?? formatTimecode(range.end, "HH:MM:SS:FF", projectFps) ?? "" })} onBlur={() => { if (rangeDraft) setRangePoint("in", rangeDraft.start); }} />
                <Text variant="meta" color="text/secondary">–</Text>
                <Input size="sm" mono style={{ width: 104 }} accessibilityLabel={t("Range end")} testID="export-range-end" value={rangeDraft?.end ?? formatTimecode(range.end, "HH:MM:SS:FF", projectFps) ?? ""} onChangeText={(value) => setRangeDraft({ end: value, start: rangeDraft?.start ?? formatTimecode(range.start, "HH:MM:SS:FF", projectFps) ?? "" })} onBlur={() => { if (rangeDraft) setRangePoint("out", rangeDraft.end); }} />
              </View>
            ) : null}
          </View>
        ) : null}
        <View style={phone ? { gap: space[1.5] } : { flexDirection: "row", alignItems: "center", gap: space[2], minHeight: 28 }}>
          <Text variant="meta" color="text/secondary" style={phone ? undefined : { width: 80 }}>{t("Export on")}</Text>
          <Segmented label={t("Export on")} size="sm" block={phone} value={effective.target} onChange={(target) => change({ target })} options={targets.map((option) => ({ value: option.value, label: phone && option.value === "host" && option.disabled ? t("Host") : line(option.label), disabled: option.disabled }))} />
          {targets[1].link ? <Button size="sm" kind="link" label={t("Connection settings")} testID="export-connect" onPress={() => { props.onClose(); router.push("/devices" as never); }} /> : targets[1].reason ? <Text variant="meta" color="text/secondary" testID="export-target-reason">{line(targets[1].reason)}</Text> : null}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[4], minHeight: 28 }}>
          <Checkbox label={t("Embed cover")} checked={settings.embedCover && exporting.coverSupported(effective) && document.cover !== null} disabled={!exporting.coverSupported(effective) || document.cover === null} onChange={(embedCover) => change({ embedCover })} />
          {!exporting.coverSupported(effective) ? <Text variant="meta" color="text/secondary" testID="export-cover-reason">{t(exporting.COVER_UNSUPPORTED)}</Text> : document.cover === null ? <Text variant="meta" color="text/secondary">{t("This project has no cover")}</Text> : <Checkbox label={t("Save cover image")} checked={saveCover} onChange={setSaveCover} />}
        </View>
      </Section>

      <Section id="provenance" title={t("Provenance")} open={open.provenance} onToggle={() => toggle("provenance")}>
        <Field label={t("Content")}><Text variant="meta" testID="export-provenance">{t(exporting.provenanceLabel(source))}</Text></Field>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], minHeight: 28 }}>
          <Switch accessibilityLabel={t("Add visible AI label")} value={settings.aiLabel && source !== null} disabled={source === null || effective.type === "audio" || effective.type === "captions"} onChange={(aiLabel) => change({ aiLabel })} />
          <Text variant="meta">{t("Add visible AI label")}</Text>
          {source === null ? <Text variant="meta" color="text/secondary" testID="export-ai-reason">{t(exporting.AI_LABEL_DISABLED)}</Text> : null}
        </View>
        <Text variant="meta" color="text/secondary">{t("Every exported file records how it was made. This cannot be turned off.")}</Text>
      </Section>
    </ScrollView>
  );

  const hostPercent = hostJob?.state === "succeeded" ? 100 : hostJob?.frameCount ? Math.floor(hostJob.framesDone / hostJob.frameCount * 100) : 0;
  const cancelHostExport = async () => {
    if (!hostJob || !hostState.connection) return;
    try { setHostJob(await requestHostExportCancel(hostState.connection, hostJob.jobId)); }
    catch (error) { toast.show({ kind: "error", message: error instanceof Error ? error.message : String(error) }); }
  };
  const receiveHostFile = async () => {
    if (!hostJob || !hostState.host) return;
    const startedAt = Date.now();
    try {
      const signer = await loadSigner();
      const uri = await downloadHostExport({ host: hostState.host, signer, job: hostJob, onProgress: (done, total) => setHostTransfer({ done, total }) });
      setHostFile(uri);
      // Keep the final byte count on screen for one readable beat when a small file finishes in a single request.
      await new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, 500 - (Date.now() - startedAt))));
      setHostTransfer(null);
    }
    catch (error) { setHostTransfer(null); toast.show({ kind: "error", message: error instanceof Error ? error.message : String(error) }); }
  };
  const saveHostPhotos = async () => { if (!hostFile) return; try { await saveHostExportToPhotos(hostFile); toast.show({ kind: "success", message: t("Saved to Photos") }); } catch (error) { toast.show({ kind: "error", message: error instanceof Error ? error.message : String(error) }); } };
  const shareHostFile = async () => { if (!hostFile) return; try { await shareHostExport(hostFile); } catch (error) { toast.show({ kind: "error", message: error instanceof Error ? error.message : String(error) }); } };
  const body = hostJob ? (
    <ScrollView style={{ flex: 1, minWidth: 0 }} contentContainerStyle={{ padding: space[4], gap: space[3] }} testID="host-export-job">
      <Text variant="title-sm" testID="host-export-stage">{hostJob.state === "running" ? `${t("Host")}: ${t("Rendering")}` : hostJob.state === "queued" ? `${t("Host")}: ${t("Queued")}` : t(hostJob.state === "succeeded" ? "Export finished" : hostJob.state === "cancelled" ? "Export cancelled" : "Export failed")}</Text>
      <Text variant="body" testID="host-export-percent">{hostJob.state === "succeeded" || hostJob.state === "running" || hostJob.state === "queued" ? `${hostPercent}% · ${hostJob.framesDone} / ${hostJob.frameCount}` : hostJob.error?.message ?? t("Export cancelled")}</Text>
      {hostJob.state === "succeeded" && hostJob.output?.fileName ? <Text variant="body-medium" testID="host-export-filename">{hostJob.output.fileName}</Text> : null}
      {hostJob.state === "running" || hostJob.state === "queued" ? <Button kind="secondary" label={t("Cancel export")} testID="host-export-cancel" onPress={() => void cancelHostExport()} /> : null}
      {hostJob.state === "succeeded" ? <>
        {hostTransfer ? <Text testID="host-export-download-progress">{t("Downloading")} {hostTransfer.done} / {hostTransfer.total}</Text> : null}
        <Button kind="primary" label={t(hostFile ? "Downloaded" : "Download export")} testID="host-export-download" disabled={hostFile !== null || hostTransfer !== null || !hostState.host || !hostJob.output} onPress={() => void receiveHostFile()} />
        {!hostFile && !hostTransfer ? <Text variant="meta" color="text/secondary" testID="host-export-download-reason">{t(!hostState.host || !hostJob.output ? "No active host connection is available to download this export." : "Download export to enable these actions.")}</Text> : null}
        <Button kind="secondary" label={t("Save to Photos")} testID="host-export-save-photos" disabled={!hostFile || hostJob.output?.mime !== "video/mp4"} onPress={() => void saveHostPhotos()} />
        <Button kind="secondary" label={t("Share export")} testID="host-export-share" disabled={!hostFile} onPress={() => void shareHostFile()} />
      </> : null}
    </ScrollView>
  ) : view === "settings" ? settingsColumn : (
    <ScrollView style={{ flex: 1, minWidth: 0 }} contentContainerStyle={{ padding: space[4], gap: space[3] }}>
      {view === "preflight" && preflight ? (
        <View testID="export-preflight" style={{ gap: space[3] }}>
          <Text variant="title-sm" level={3}>{t("Before exporting")}</Text>
          {preflight.blocking.map((item) => (
            <View key={item.id} testID={`preflight-${item.id}`} style={{ gap: space[0.5] }}>
              <View style={{ flexDirection: "row", gap: space[2], alignItems: "center" }}><Icon name="warn" size={16} color="warning" /><Text variant="body-medium" style={{ flex: 1 }}>{t(item.message, item.values)}</Text><Text variant="mono" color="text/secondary">{item.code}</Text></View>
              {item.names.length > 0 ? <Text variant="meta" color="text/secondary" numberOfLines={3}>{item.names.join(", ")}</Text> : null}
              {item.remedies.length > 0 ? <Text variant="meta" color="text/secondary">{item.remedies.map((remedy) => t(remedy)).join(" · ")}</Text> : null}
              {(item.id === "media-undrawable" || item.id === "media-undecodable-sound" || item.id === "media-missing") && item.elementIds.length > 0 ? <View style={{ flexDirection: "row" }}><Button size="sm" kind="link" label={t("Show the clip")} testID={`preflight-show-${item.id}`} onPress={() => showClip(item.elementIds[0])} /></View> : null}
            </View>
          ))}
          <View style={{ flexDirection: "row", gap: space[2] }}>
            <Button size="sm" kind="secondary" label={t("Back to settings")} testID="preflight-back" onPress={() => setPreflight(null)} />
            {anyway ? <Button size="sm" kind="primary" label={t("Export anyway")} testID="preflight-anyway" onPress={() => void start(anyway)} /> : null}
          </View>
        </View>
      ) : null}
      {view === "progress" && job ? <JobProgress job={job} /> : null}
      {view === "done" && job ? <JobCompletion job={job} publish={{ ...publish, onChange: savePublish }} credits={creditsText(licenceCheck(runtime.controller.stored, job.sceneId))} onExportAgain={() => setJobId(null)} /> : null}
      {view === "failed" && job ? <JobFailure job={job} onShowClip={showClip} onRetry={retry} onRetryWith={(change) => retry(false, exporting.failureRetrySettings(job.settings, change))} onClose={() => setJobId(null)} /> : null}
    </ScrollView>
  );
  const picture = coverUrl ?? frame;
  return (
    <>
      <Surface open onRequestClose={() => props.onClose()} level="modal" scrim="dim" initialFocus='[data-testid="export-file-name"]'>
        {(progress, container) => (
          <View pointerEvents="box-none" style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: narrow ? "stretch" : "center", justifyContent: narrow ? "flex-end" : "center", padding: narrow ? 0 : space[4] }}>
            <Animated.View ref={container} role="dialog" aria-modal aria-label={t("Export")} testID="export-dialog"
              style={[{ width: "100%", maxWidth: narrow ? undefined : 880, maxHeight: narrow ? Math.max(240, theme.height - 72) : "92%", height: narrow ? Math.max(240, Math.min(theme.height - 72, Math.round(theme.height * 0.84))) : undefined, opacity: progress, backgroundColor: theme.color("bg/elevated"), borderTopLeftRadius: narrow ? radius.xl : radius.lg, borderTopRightRadius: narrow ? radius.xl : radius.lg, borderBottomLeftRadius: narrow ? 0 : radius.lg, borderBottomRightRadius: narrow ? 0 : radius.lg, overflow: "hidden" }, theme.elevation(3)]}>
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space[2], paddingTop: space[4], paddingHorizontal: space[4], paddingBottom: space[3] }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text variant="title-sm" level={2}>{t("Export")}</Text>
                  <Text variant="meta" color="text/secondary" testID="export-subtitle">{`${document.metadata.name} · ${exporting.aspectLabel(canvas)} · ${t("{fps} fps", { fps: exporting.rateLabel(projectFps) })}`}</Text>
                </View>
                <IconButton icon="x" label={t("Close")} testID="export-close" onPress={props.onClose} />
              </View>
              <View style={{ flexDirection: narrow ? "column" : "row", alignItems: "stretch", flex: narrow ? 1 : undefined, flexShrink: 1, minHeight: 0, borderTopWidth: 1, borderTopColor: theme.color("border/hairline") }}>
                {narrow ? null : (
                  <View testID="export-summary-pane" style={{ width: 300, padding: space[4], borderEndWidth: 1, borderEndColor: theme.color("border/hairline"), backgroundColor: theme.color("bg/inset") }}>
                    <View style={{ height: 151, borderRadius: radius.sm, overflow: "hidden", backgroundColor: theme.color("bg/subtle") }}>{picture ? <Image source={{ uri: picture }} accessibilityLabel={t("Cover")} resizeMode="cover" style={{ width: "100%", height: "100%" }} /> : null}</View>
                    <View style={{ flexDirection: "row", marginTop: space[2], marginBottom: space[3] }}><Button size="sm" kind="secondary" icon="image" label={t("Edit cover")} testID="export-edit-cover" onPress={() => runtime.setDialog({ kind: "cover" })} /></View>
                    <Text variant="body-medium" level={3} style={{ marginBottom: space[1] }}>{t("Output summary")}</Text>
                    <View testID="export-summary">{summary.map(([label, value]) => (
                      <View key={label} style={{ flexDirection: "row", alignItems: "center", height: 22, gap: space[2] }}><Text variant="meta" color="text/secondary" style={{ flex: 1 }}>{label}</Text><Text variant="meta" numberOfLines={1}>{value}</Text></View>
                    ))}</View>
                  </View>
                )}
                {body}
              </View>
              {messages.length > 0 && view === "settings" ? (
                <View testID="export-notices" style={{ paddingHorizontal: space[4], paddingVertical: space[2], gap: 2, borderTopWidth: 1, borderTopColor: theme.color("border/hairline") }}>
                  {messages.map((message) => <Text key={message.id} variant="meta" color={message.level === "warning" ? "warning/text" : "text/secondary"} testID={`export-${message.id}`}>{message.text}</Text>)}
                </View>
              ) : null}
              <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[2], paddingVertical: space[3], paddingHorizontal: space[4], borderTopWidth: 1, borderTopColor: theme.color("border/hairline") }}>
                <View style={{ flex: 1, flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", columnGap: space[3], rowGap: 2, minWidth: 0 }}>
                  <Text variant="meta" color="text/secondary">{t("Duration")} <Text variant="body-medium" tabular testID="export-duration">{exporting.durationLabel(duration)}</Text></Text>
                  <Text variant="meta" color="text/secondary">{t("Estimated size")} <Text variant="body-medium" tabular color={blocker?.danger ? "danger/text" : "text/primary"} testID="export-estimate">{line(exporting.estimateLabel(estimate))}</Text></Text>
                  <Text variant="meta" color="text/secondary">{t("Target")} <Text variant="body-medium" testID="export-target">{line(resolved.targetLabel)}</Text></Text>
                  {blocker && view === "settings" ? <Text variant="meta" color={blocker.danger ? "danger/text" : "text/secondary"} live="polite" testID="export-blocker">{line(blocker)}</Text> : null}
                </View>
                {view === "settings" && !hostJob ? (
                  <>
                    <Button kind="ghost" label={t("Cancel")} testID="export-dismiss" onPress={props.onClose} />
                    <Button kind="primary" icon="export" label={t("Export")} testID="export-start" disabled={blocker !== null || whole <= 0} onPress={() => void start()} />
                  </>
                ) : <Button kind={view === "progress" || view === "failed" ? "ghost" : "primary"} label={t("Close")} testID="export-dismiss" onPress={props.onClose} />}
              </View>
            </Animated.View>
          </View>
        )}
      </Surface>
      {naming ? (
        <FormDialog open title={t("Save as preset")} submitLabel={naming.overwrite ? t("Overwrite") : t("Save")} dirty={naming.name !== ""} canSubmit={naming.name.trim() !== ""} onClose={() => setNaming(null)} onSubmit={() => savePreset(naming.name, naming.overwrite)} width={360}>
          <Input accessibilityLabel={t("Preset name")} testID="preset-name" autoFocus maxLength={40} value={naming.name} onChangeText={(value) => setNaming({ name: value, overwrite: false, problem: null })} />
          {naming.problem ? <Text variant="meta" color="warning/text" testID="preset-problem">{naming.problem}</Text> : null}
        </FormDialog>
      ) : null}
    </>
  );
}

/** A number typed as text: committed on blur or Enter, restored when it is not a number. */
function NumberText(props: { label: string; value: number; suffix?: string; decimal?: boolean; onCommit(value: number): void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => { if (draft === null) return; const value = Number(draft.replace(",", ".")); setDraft(null); if (Number.isFinite(value)) props.onCommit(value); };
  return <Input size="sm" accessibilityLabel={props.label} keyboardType={props.decimal ? "decimal-pad" : "number-pad"} suffix={props.suffix} value={draft ?? String(props.value)} onChangeText={setDraft} onBlur={commit} onSubmitEditing={commit} />;
}
