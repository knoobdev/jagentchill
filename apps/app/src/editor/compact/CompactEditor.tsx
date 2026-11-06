import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useNavigation } from "expo-router";
import { Animated, BackHandler, Keyboard, Platform, ScrollView, View } from "react-native";
import { PLAYBACK_RATES, rateLabel } from "@jagentchill/app-core";
import { timeline } from "@jagentchill/editor-core";
import type { ProjectDocument } from "@jagentchill/protocol";
import { Button, ConfirmDialog, EdgePanel, Icon, IconButton, Menu, SchemeScope, Slider, Tap, Text, compactScale, radius, space, useInsets, useTheme, useToast, useToastClearance, type MenuItem, inlineIcon } from "@jagentchill/ui";
import { useT } from "../../locale";
import type { CommitFn } from "../../media/MediaPanel";
import { MediaSheet } from "../../media/MediaSheet";
import { Recorder } from "../../media/Recorder";
import type { MediaSession } from "../../media/session";
import { asVoice } from "../audio/voice";
import { useEditor, useEditorVersion, useTransport } from "../context";
import { useSelectedTransition } from "../fx/inspector";
import { shownAt } from "../inspector/parts";
import { Player } from "../Player";
import { MarkerPopover, RenameElementDialog, ReplaceMediaDialog, ScenesSheet } from "../TimelineDialogs";
import { CompactTimeline } from "./CompactTimeline";
import { clampCompactZoom, clock, COMPACT, compactLandscapeHeights, compactLandscapeSheetWidth, compactRegionHeights, GROUP_TRACK_TYPES, stepCompactZoom, zoomRange, type LaneGroup } from "./layout";
import { AssetSheet, GraphSheet, GuidesSheet, InspectorSheet, MarkerFieldSheet, MarkersSheet, MoreSheet, ToolSheet, TracksSheet, TransitionSheet } from "./sheets";
import { groupTools, markerTools, rootTools, selectionTools, type Sheet, type Tool, type ToolGroup, type ToolHost } from "./tools";
import { lockOrientation, ownTouches, unlockOrientation } from "./touch";
import { createNativeImportPlacement } from "./native-import-placement";

const TRANSFORM_PATHS = ["transform.position.x", "transform.position.y", "transform.scale.x", "transform.scale.y", "transform.rotation"] as const;
const TIPS = {
  "Scroll the timeline": "Drag the timeline sideways. The frame under the centre line is the one shown.",
  "Zoom the timeline": "Pinch with two fingers on the timeline. The time under the centre line stays in place.",
  "Select and trim": "Tap a clip to select it, then drag one of its handles to trim that edge.",
  "Move a clip": "Press and hold a clip, then drag it to a new time or lane.",
  "Select several": "Press and hold empty lane space and drag a rectangle, or use Select in More.",
  "Edit on the preview": "Drag an element to move it. Drag a corner to scale it and the round handle to rotate it.",
};
const SHEET_TITLES: Record<string, string> = { transition: "Transition", more: "More", tracks: "Tracks", markers: "Markers", graph: "Graph editor", guides: "Guides", marker: "Marker" };
/** The sheets that change the project: ✕ takes their changes back, ✓ makes them one undo step. The others only show or switch things. */
const edits = (sheet: Sheet): boolean => sheet.kind === "inspector" || sheet.kind === "asset" || sheet.kind === "transition" || sheet.kind === "graph" || sheet.kind === "marker";
// The sheets whose tool works on the preview itself keep its touches; a tap on the preview puts every other sheet away, confirmed.
const INTERACTIVE_TITLES = ["Transform", "Crop", "Mask", "Remove BG", "Edit", "Style", "Edit captions", "Stickers"];
const canvasInteractive = (sheet: Sheet): boolean => sheet.kind === "guides" || sheet.kind === "graph" || ("title" in sheet && INTERACTIVE_TITLES.includes(sheet.title));

/** The 44 pt phone top bar: Back, project name, undo, redo and Export. */
export function CompactTopBar(props: { projectId: string; exiting: boolean; indicator: string; failed: boolean; readOnly: boolean; items: MenuItem[]; exportDisabled: boolean; onClose(): void; onRetry(): void; onExport(): void; onRename(): void; extra?: ReactNode }) {
  const t = useT();
  const theme = useTheme();
  const insets = useInsets();
  const runtime = useEditor();
  const toast = useToast();
  useEditorVersion();
  const session = runtime.controller.session;
  const name = runtime.controller.stored.metadata.name;
  const history = (action: "edit.undo" | "edit.redo") => {
    const label = action === "edit.undo" ? session.undoLabel : session.redoLabel;
    if (runtime.act(action) && label) toast.show({ kind: "info", message: t(action === "edit.undo" ? "Undo: {label}" : "Redo: {label}", { label: t(label) }) });
  };
  return (
    <View testID="editor-bar" style={{ paddingTop: insets.top, borderBottomWidth: 1, borderBottomColor: theme.color("border/hairline"), backgroundColor: theme.color("bg/app") }}>
      <View style={{ height: COMPACT.topBar, flexDirection: "row", alignItems: "center", paddingHorizontal: compactScale.space.gapSmall, gap: 2 }}>
        <IconButton icon="x" label={t("Back")} testID="compact-close" disabled={props.exiting} onPress={props.onClose} />
        <Tap role="button" label={t("Rename: {name}", { name })} testID="project-name" onPress={props.onRename} style={{ flex: 1, minWidth: 0, height: COMPACT.topBar, justifyContent: "center", paddingHorizontal: space[1], borderRadius: radius.sm }}>
          <View style={{ minWidth: 0 }}>
            <Text variant="body-medium" numberOfLines={1}>{name}</Text>
            <Text variant="caption" color={props.failed ? "danger/text" : "text/secondary"} numberOfLines={1} live="polite" testID="save-state">{props.failed ? props.indicator : props.readOnly ? t("Read-only") : props.exiting ? t("Exiting project…") : props.indicator}</Text>
          </View>
        </Tap>
        <IconButton icon="undo" label={session.undoLabel ? t("Undo {label}", { label: t(session.undoLabel) }) : t("Undo")} testID="bar-undo" disabled={!session.canUndo || props.readOnly} onPress={() => history("edit.undo")} />
        <IconButton icon="redo" label={session.redoLabel ? t("Redo {label}", { label: t(session.redoLabel) }) : t("Redo")} testID="bar-redo" disabled={!session.canRedo || props.readOnly} onPress={() => history("edit.redo")} />
        <Button kind="primary" size="md" label={t("Export")} testID="open-export" disabled={props.exportDisabled} onPress={props.onExport} />
      </View>
    </View>
  );
}

/**
 * The phone layout of the editor under its top bar: the preview, the transport row, the fixed-playhead timeline and the
 * two-level bottom toolbar, with the panels of the wide layout opening as sheets under the preview. It is a layout
 * over the same runtime, commands, engine and panels — it holds no editing logic of its own.
 */
export function CompactEditor(props: { document: ProjectDocument; media: MediaSession | null; commit: CommitFn; readOnly: boolean; onOpenSettings(tab: "info" | "background"): void }) {
  const t = useT();
  const theme = useTheme();
  const toast = useToast();
  const navigation = useNavigation();
  const insets = useInsets();
  const runtime = useEditor();
  useEditorVersion();
  const { controller } = runtime, session = controller.session, selectedIds = session.selection.selectedElements, selection = selectedIds.length;
  const [group, setGroup] = useState<ToolGroup | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [sheetRest, setSheetRest] = useState(true);
  const [multi, setMulti] = useState(false);
  const [picker, setPicker] = useState<"main" | "overlay" | null>(null);
  const [recording, setRecording] = useState<number | null>(null);
  const [marker, setMarker] = useState<string | null>(null);
  const [flag, setFlag] = useState<string | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const importPlacement = useRef<ReturnType<typeof createNativeImportPlacement> | null>(null);
  importPlacement.current ??= createNativeImportPlacement((assetIds, overlay) => runtime.addAssets(assetIds, overlay));
  const transitionId = useSelectedTransition();
  const stage = useRef<View>(null);
  useEffect(() => ownTouches(stage.current), []);
  useEffect(() => {
    if (Platform.OS === "web") return;
    const show = Keyboard.addListener("keyboardWillShow", (event) => setKeyboardHeight(event.endCoordinates.height));
    const hide = Keyboard.addListener("keyboardWillHide", () => setKeyboardHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, []);
  // A phone import is committed by the host, then reaches this device through sync. Place its clip only after
  // that patch is in the local document; the import RPC response can beat the sync event by a few milliseconds.
  useEffect(() => {
    importPlacement.current?.flush((assetId) => props.document.media.assets.some((asset) => asset.id === assetId));
  }, [props.document]);

  // A selected transition shows its sheet; the sheets of a selection close with it.
  useEffect(() => { if (transitionId && selection === 0) setSheet({ kind: "transition" }); else setSheet((current) => (current?.kind === "transition" ? null : current)); }, [transitionId, selection]);
  useEffect(() => { if (selection === 0) setSheet((current) => (current?.kind === "inspector" || current?.kind === "graph" ? null : current)); }, [selection]);
  // "Crop" from a menu or a key is edited in the inspector, as on the wide layout.
  const cropping = runtime.tool.crop !== null;
  useEffect(() => { if (cropping && selection > 0) setSheet((current) => current ?? { kind: "inspector", title: "Crop" }); }, [cropping]); // eslint-disable-line react-hooks/exhaustive-deps

  // — A sheet that edits remembers where the history was when it opened: put away, its steps become one; cancelled, they are taken back. —
  const opened = useRef<{ sheet: Sheet; mark: number } | null>(null);
  useEffect(() => {
    const before = opened.current;
    if (before && before.sheet !== sheet) controller.squashSince(before.mark, "title" in before.sheet ? before.sheet.title : SHEET_TITLES[before.sheet.kind]);
    if (before?.sheet !== sheet) opened.current = sheet && edits(sheet) ? { sheet, mark: controller.historyMark() } : null;
  }, [sheet, controller]);
  // A selected marker is a marker of this scene: deleting it, or selecting a clip, ends its strip.
  const flagged = flag !== null && selection === 0 && (timeline.sceneById(controller.document, session.sceneId).markers as { id: string }[]).some((entry) => entry.id === flag) ? flag : null;
  useEffect(() => { if (flag !== null && flagged === null) { setFlag(null); setSheet((current) => (current?.kind === "marker" ? null : current)); } }, [flag, flagged]);

  const host = useMemo<ToolHost>(() => ({
    runtime, open: setSheet, setGroup, pickMedia: setPicker, openSettings: props.onOpenSettings, setMulti, editMarker: setMarker,
    record: () => { runtime.pause(); setRecording(controller.session.playhead); },
    addText: () => void controller.run(timeline.addDefaultText({ sceneId: controller.session.sceneId, time: controller.session.playhead, fields: { content: t("Default text") } })),
    toast: (message) => toast.show({ kind: "info", message: t(message) }),
  }), [runtime, controller, props.onOpenSettings, t, toast]);
  const level = selection > 0 ? "selection" : flagged ? "marker" : group ? "group" : "root";
  const tools: Tool[] = level === "selection" ? selectionTools(host) : level === "marker" ? markerTools(flagged!, host) : level === "group" ? groupTools(group!, host) : rootTools(host);
  const back = level === "selection" ? () => { setMulti(false); setSheet(null); controller.select(timeline.deselectAll()); } : level === "marker" ? () => setFlag(null) : level === "group" ? () => setGroup(null) : multi ? () => setMulti(false) : null;
  const laneGroup: LaneGroup | null = group && group in GROUP_TRACK_TYPES ? (group as LaneGroup) : null;

  // — Region heights: the preview keeps 35 % of the screen whatever is open under it —
  const landscape = theme.width > theme.height;
  const keyboardVisible = keyboardHeight > 0;
  const visibleWindowHeight = Math.max(0, theme.height - keyboardHeight);
  const layoutInsets = { ...insets, bottom: keyboardVisible ? 0 : insets.bottom };
  const regions = landscape ? compactLandscapeHeights(theme.width, visibleWindowHeight, layoutInsets) : compactRegionHeights(visibleWindowHeight, layoutInsets);
  const previewMin = landscape ? 0 : regions.preview;
  const timelineHeight = regions.timeline, sheetHeight = regions.sheet;
  const sideSheetWidth = compactLandscapeSheetWidth(theme.width);
  const landscapeTimelineWidth = Math.max(48, Math.round(theme.width / 2.2) - sideSheetWidth);

  // Toasts are drawn above whatever is docked at the bottom edge.
  useToastClearance(sheet ? sheetHeight : COMPACT.toolbar);
  const sheetTitle = sheet ? ("title" in sheet ? sheet.title : SHEET_TITLES[sheet.kind]) : "";
  // Closing the sheet of a transition deselects it; closing the inspector ends a crop that was open in it.
  const closeSheet = useCallback(() => { Keyboard.dismiss(); if (sheet?.kind === "transition") runtime.act("selection.none"); if (runtime.tool.crop) runtime.setTool({ crop: null }); setSheet(null); }, [runtime, sheet]);
  useEffect(() => {
    if (!sheet) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => { closeSheet(); return true; });
    return () => subscription.remove();
  }, [sheet, closeSheet]);
  useEffect(() => navigation.addListener("beforeRemove", (event) => {
    if (!sheet) return;
    event.preventDefault();
    closeSheet();
  }), [navigation, sheet, closeSheet]);
  // ✕: what the sheet changed since it opened is taken back, and no undo step is left.
  const cancelSheet = () => { const before = opened.current; opened.current = null; if (before) controller.revertSince(before.mark); closeSheet(); };
  const dialog = runtime.dialog;
  const previewRegion = (
    <SchemeScope scheme="dark">
      <View ref={stage} testID="compact-preview" style={{ flex: 1, minHeight: previewMin }}>
        <Player pinch onOpenCanvasSettings={() => props.onOpenSettings("info")} surface="bg/editor" bar={(state) => (state.fullscreen ? <FullscreenBar shown={state.shown} onExit={state.toggleFullscreen} /> : null)} />
        {sheet && !canvasInteractive(sheet) ? <Tap role="button" label={t("Close")} testID="preview-dismiss" focusable={false} noRing onPress={closeSheet} style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }} /> : null}
      </View>
    </SchemeScope>
  );
  const transportRegion = <TransportRow />;
  const breadcrumb = session.sceneStack.length > 0 ? (
    <View testID="compound-breadcrumb" style={{ height: 20, justifyContent: "center", paddingHorizontal: space[3], backgroundColor: theme.color("bg/editor") }}>
      <Text variant="caption" color="timeline/ruler-text" numberOfLines={1}>{timeline.breadcrumb(controller.document, session.sceneStack[0].sceneId, [...session.sceneStack]).map((crumb) => crumb.name).join(" › ")}</Text>
    </View>
  ) : null;
  const timelineRegion = (
    <SchemeScope scheme="dark">
      <View testID="compact-timeline-region" style={landscape ? { flex: 1, minHeight: 0 } : { height: sheet ? COMPACT.compactTimeline : timelineHeight }}>
        <CompactTimeline group={laneGroup} small={sheet !== null} multi={multi} onAddMedia={() => setPicker("main")} onOpenGroup={(next) => setGroup(next)} onOpenTracks={(trackId) => setSheet({ kind: "tracks", trackId })} onMarker={(id) => { controller.select(timeline.deselectAll()); setFlag(id); }} selectedMarker={flagged} onCover={() => runtime.setDialog({ kind: "cover" })} />
      </View>
    </SchemeScope>
  );
  const toolSheet = (
    <EdgePanel open={sheet !== null} edge={landscape ? "end" : "bottom"} overlay={landscape} size={landscape ? sideSheetWidth : sheetHeight} testID="tool-sheet-slot" onSettled={(open) => setSheetRest(!open)}>
      {sheet ? (
        <ToolSheet title={t(sheetTitle)} height={sheetHeight} width={sideSheetWidth} landscape={landscape} onClose={closeSheet} onCancel={edits(sheet) ? cancelSheet : undefined}>
          {sheet.kind === "inspector" ? <InspectorSheet onModify={() => props.onOpenSettings("info")} /> : null}
          {sheet.kind === "asset" ? <AssetSheet tab={sheet.tab} document={props.document} readOnly={props.readOnly} onOpenCaptions={() => setSheet({ kind: "asset", tab: "captions", title: "Captions" })} /> : null}
          {sheet.kind === "transition" && transitionId ? <TransitionSheet transitionId={transitionId} readOnly={props.readOnly} /> : null}
          {sheet.kind === "more" ? <MoreSheet multi={multi} onOpen={setSheet} onClose={() => setSheet(null)} onSelectMode={() => { setMulti(true); setSheet(null); }} onOpenSettings={() => props.onOpenSettings("info")} /> : null}
          {sheet.kind === "tracks" ? <TracksSheet trackId={sheet.trackId} onClose={() => setSheet(null)} /> : null}
          {sheet.kind === "markers" ? <MarkersSheet onEdit={setMarker} /> : null}
          {sheet.kind === "graph" ? <GraphSheet /> : null}
          {sheet.kind === "guides" ? <GuidesSheet /> : null}
          {sheet.kind === "marker" ? <MarkerFieldSheet markerId={sheet.markerId} field={sheet.field} /> : null}
        </ToolSheet>
      ) : null}
    </EdgePanel>
  );
  const toolbarRegion = sheet || !sheetRest ? null : <Toolbar level={`${level}:${group ?? ""}:${multi}`} tools={tools} back={back} hint={multi && selection === 0 ? t("Tap clips to select them") : null} />;
  return (
    <View testID="compact-editor" style={{ flex: keyboardVisible ? undefined : 1, height: keyboardVisible ? Math.max(0, visibleWindowHeight - insets.top - COMPACT.topBar) : undefined, minHeight: 0, paddingBottom: keyboardVisible ? 0 : insets.bottom, flexDirection: landscape ? "row" : "column", backgroundColor: theme.color("bg/app") }}>
      {landscape ? (
        <>
          <View testID="compact-preview-pane" style={{ flex: 1.2, minWidth: 0, minHeight: 0 }}>{previewRegion}{transportRegion}</View>
          <View testID="compact-timeline-pane" style={{ flex: 1, minWidth: 0, minHeight: 0, position: "relative" }}>
            <View style={{ flex: 1, minWidth: 0, minHeight: 0, width: sheet ? landscapeTimelineWidth : undefined }}>{breadcrumb}{timelineRegion}{toolbarRegion}</View>
            {toolSheet}
          </View>
        </>
      ) : (
        <>{previewRegion}{transportRegion}{breadcrumb}{timelineRegion}{toolSheet}{toolbarRegion}</>
      )}
      {props.media ? <MediaSheet open={picker !== null} onClose={() => setPicker(null)} session={props.media} document={props.document} commit={props.commit} readOnly={props.readOnly} onPick={(assetIds) => { const overlay = picker === "overlay"; setPicker(null); importPlacement.current?.request(assetIds, overlay, (assetId) => controller.stored.media.assets.some((asset) => asset.id === assetId)); }} /> : null}
      {recording !== null ? <Recorder session={runtime.media} source="voice" onClose={() => setRecording(null)} onDone={(result) => {
        const at = recording;
        setRecording(null);
        const ids = result ? [...result.imported, ...result.reused].map((entry) => entry.assetId) : [];
        // The take lands on an audio track where the recording started.
        if (ids.length > 0) controller.run(asVoice(timeline.addToTimeline({ sceneId: session.sceneId, items: ids.map((assetId) => ({ kind: "media" as const, assetId })), time: at, label: "Record voiceover" })));
      }} /> : null}
      {marker ? <MarkerPopover markerId={marker} onClose={() => setMarker(null)} /> : null}
      {dialog?.kind === "scenes" ? <ScenesSheet onClose={() => runtime.setDialog(null)} /> : null}
      {dialog?.kind === "rename-element" ? <RenameElementDialog elementId={dialog.elementId} onClose={() => runtime.setDialog(null)} /> : null}
      {dialog?.kind === "replace-media" ? <ReplaceMediaDialog elementId={dialog.elementId} onClose={() => runtime.setDialog(null)} /> : null}
      {dialog?.kind === "delete-track" ? <ConfirmDialog open title={t("Delete track")} description={dialog.text} confirmLabel={t("Delete")} onClose={() => runtime.setDialog(null)} onConfirm={() => { const id = dialog.trackId; runtime.setDialog(null); controller.run(timeline.deleteTrack({ trackId: id })); }} /> : null}
    </View>
  );
}

/** The 44 pt transport row: time, Play and fullscreen. */
function TransportRow() {
  const t = useT();
  const theme = useTheme();
  const runtime = useEditor();
  const transport = useTransport();
  const duration = runtime.duration();
  const session = runtime.controller.session;
  const fps = runtime.controller.stored.settings.fps;
  const zoomRangeForPhone = zoomRange(duration, theme.width, fps);
  const zoom = clampCompactZoom(session.view.zoomLevel, zoomRangeForPhone);
  return (
    <View testID="transport-row" role="toolbar" aria-label={t("Player")} style={{ height: COMPACT.transport, flexDirection: "row", alignItems: "center", paddingHorizontal: space[1], backgroundColor: theme.color("bg/app"), borderTopWidth: 1, borderBottomWidth: 1, borderColor: theme.color("border/hairline") }}>
      {session.sceneStack.length > 0
        ? <IconButton icon={inlineIcon(theme.rtl, "arrow-l")} label={t("Exit compound")} testID="compound-exit" onPress={() => void runtime.act("timeline.compound.exit")} />
        : <IconButton icon="full" label={t("Fullscreen")} testID="transport-fullscreen" onPress={() => void runtime.act("player.fullscreen")} />}
      <Text variant="mono" color="text/secondary" numberOfLines={1} testID="compact-time" style={{ flex: 1 }}>{`${clock(transport.time)} / ${clock(duration)}`}</Text>
      <IconButton icon="minus" label={t("Zoom out timeline")} testID="timeline-zoom-out" disabled={zoom <= zoomRangeForPhone.min} onPress={() => runtime.controller.setView({ zoomLevel: stepCompactZoom(zoom, "out", zoomRangeForPhone) })} />
      <Text variant="caption" color="text/secondary" tabular testID="timeline-zoom-level">{`${Math.round(zoom * 100)}%`}</Text>
      <IconButton icon="plus" label={t("Zoom in timeline")} testID="timeline-zoom-in" disabled={zoom >= zoomRangeForPhone.max} onPress={() => runtime.controller.setView({ zoomLevel: stepCompactZoom(zoom, "in", zoomRangeForPhone) })} />
      <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center" }}>
        <IconButton icon={transport.playing ? "pause" : "play"} color="text/primary" label={t(transport.playing ? "Pause" : "Play")} testID="player-play" disabled={duration <= 0 || transport.engine !== "ready"} onPress={() => runtime.toggle()} />
      </View>
    </View>
  );
}

/** The transport of the full-screen preview: it turns the screen with a wide picture and hides after three seconds without a touch. */
function FullscreenBar(props: { shown: boolean; onExit(): void }) {
  const t = useT();
  const theme = useTheme();
  const runtime = useEditor();
  const transport = useTransport();
  const canvas = runtime.controller.stored.settings.canvasSize, duration = runtime.duration();
  const [rates, setRates] = useState(false);
  const rateRef = useRef<View>(null);
  useEffect(() => { lockOrientation(canvas.width > canvas.height); return () => unlockOrientation(); }, [canvas.width, canvas.height]);
  if (!props.shown) return null;
  return (
    <View testID="fullscreen-bar" style={{ minHeight: 48, flexDirection: "row", alignItems: "center", gap: space[1], paddingHorizontal: space[2], backgroundColor: theme.color("bg/editor") }}>
      <IconButton icon={transport.playing ? "pause" : "play"} color="text/primary" label={t(transport.playing ? "Pause" : "Play")} disabled={duration <= 0 || transport.engine !== "ready"} onPress={() => runtime.toggle()} />
      <View style={{ flex: 1 }}><Slider label={t("Current time")} min={0} max={Math.max(1, duration)} step={1} value={Math.min(duration, transport.time)} onChange={(value) => runtime.seek(value as number)} onCommit={(value) => runtime.seek(value as number)} /></View>
      <Text variant="mono" color="text/secondary">{`${clock(transport.time)} / ${clock(duration)}`}</Text>
      <Tap ref={rateRef} role="button" label={t("Playback rate")} expanded={rates} onPress={() => setRates(true)} style={{ height: 44, justifyContent: "center", paddingHorizontal: space[2] }}><Text variant="meta" style={{ fontWeight: "600" }}>{rateLabel(transport.menuRate)}</Text></Tap>
      <Menu open={rates} anchor={rateRef} label={t("Playback rate")} onClose={() => setRates(false)} items={PLAYBACK_RATES.map((rate) => ({ id: String(rate), label: rateLabel(rate), checked: transport.menuRate === rate, onSelect: () => runtime.setRate(rate) }))} />
      <IconButton icon="full" label={t("Exit fullscreen")} testID="fullscreen-exit" on onPress={props.onExit} />
    </View>
  );
}

/** The bottom toolbar: a horizontally scrolling strip of tools, with the fixed back button of a sub-level at its start. */
function Toolbar(props: { level: string; tools: Tool[]; back: (() => void) | null; hint: string | null }) {
  const t = useT();
  const theme = useTheme();
  const slide = useRef(new Animated.Value(1)).current;
  // A change of level slides the strip in over 140 ms; with reduced motion it is in place at once.
  useEffect(() => {
    if (theme.reduceMotion) { slide.setValue(1); return; }
    slide.setValue(0);
    Animated.timing(slide, { toValue: 1, duration: 140, useNativeDriver: false }).start();
  }, [props.level, slide, theme.reduceMotion]);
  return (
    <View testID="compact-toolbar" role="toolbar" aria-label={t("Tools")} {...({ dataSet: { level: props.level.split(":")[0] } } as object)} style={{ height: COMPACT.toolbar, flexDirection: "row", alignItems: "stretch", backgroundColor: theme.color("bg/app"), borderTopWidth: 1, borderTopColor: theme.color("border/hairline") }}>
      {props.back ? (
        <Tap role="button" label={t("Back")} testID="tool-back" onPress={props.back} style={{ width: 44, alignItems: "center", justifyContent: "center", borderEndWidth: 1, borderEndColor: theme.color("border/hairline") }}>
          <View style={{ flexDirection: "row" }}><Icon name={inlineIcon(theme.rtl, "chev-l")} size={16} /><View style={{ marginStart: -9 }}><Icon name={inlineIcon(theme.rtl, "chev-l")} size={16} /></View></View>
        </Tap>
      ) : null}
      <Animated.View style={{ flex: 1, minWidth: 0, opacity: slide, transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }] }}>
        {props.hint ? <View style={{ flex: 1, justifyContent: "center", paddingHorizontal: space[4] }}><Text color="text/secondary" testID="toolbar-hint">{props.hint}</Text></View> : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: space[1] }}>
            {props.tools.map((tool) => (
              <Tap key={tool.id} role="button" label={t(tool.label)} pressedState={tool.pressed} testID={`tool-${tool.id}`} nativeID={`tool-${tool.id}`} onPress={tool.run}
                style={{ minWidth: COMPACT.toolWidth, height: COMPACT.toolbar - 1, alignItems: "center", justifyContent: "center", gap: 4, paddingHorizontal: space[1] }}>
                <Icon name={tool.icon} size={22} color={tool.pressed ? "accent" : "text/primary"} />
                <Text variant="caption" color={tool.pressed ? "accent" : "text/secondary"} numberOfLines={1}>{t(tool.label)}</Text>
              </Tap>
            ))}
          </ScrollView>
        )}
      </Animated.View>
    </View>
  );
}
