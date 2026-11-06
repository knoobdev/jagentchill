import { memo, useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { bindingKeys } from "@jagentchill/app-core";
import { timeline } from "@jagentchill/editor-core";
import { Icon, IconButton, Menu, Slider, Tap, Text, radius, space, useTheme, type IconName, type MenuItem } from "@jagentchill/ui";
import { Recorder } from "../media/Recorder";
import { useT } from "../locale";
import { asVoice } from "./audio/voice";
import { useEditor, useEditorVersion } from "./context";
import { isMac, observeSize } from "./dom";

// The action id is held under `run`: the locale collector reads a field named `action` as a screen string.
type Tool = { id: string; icon: IconName; label: string; run: string };
const LEFT: Record<string, Tool> = {
  split: { id: "split", icon: "split", label: "Split", run: "timeline.split" }, "delete-left": { id: "delete-left", icon: "del-l", label: "Delete left", run: "timeline.delete-left" },
  "delete-right": { id: "delete-right", icon: "del-r", label: "Delete right", run: "timeline.delete-right" }, delete: { id: "delete", icon: "trash", label: "Delete", run: "timeline.delete" },
  marker: { id: "marker", icon: "flag", label: "Add marker", run: "marker.toggle" }, freeze: { id: "freeze", icon: "snow", label: "Freeze", run: "timeline.freeze" },
  reverse: { id: "reverse", icon: "reverse", label: "Reverse", run: "timeline.reverse" }, mirror: { id: "mirror", icon: "mirror", label: "Mirror", run: "preview.mirror" },
  "rotate-90": { id: "rotate-90", icon: "rotate", label: "Rotate", run: "preview.rotate-90" }, crop: { id: "crop", icon: "crop", label: "Crop", run: "preview.crop" },
  "extract-audio": { id: "extract-audio", icon: "music", label: "Extract audio", run: "audio.extract.toggle" }, duplicate: { id: "duplicate", icon: "copy", label: "Duplicate", run: "timeline.duplicate" },
  "graph-editor": { id: "graph-editor", icon: "graph", label: "Graph editor", run: "keyframe.graph" },
};
const CURSOR_MODES: { mode: timeline.CursorMode; label: string; icon: IconName; run: string }[] = [
  { mode: "select", label: "Select", icon: "cursor", run: "tools.select" }, { mode: "blade", label: "Split", icon: "split", run: "tools.blade" },
  { mode: "select-left", label: "Select left", icon: "del-l", run: "timeline.cursor.select-left" }, { mode: "select-right", label: "Select right", icon: "del-r", run: "timeline.cursor.select-right" },
];
const BUTTON = 30, SEPARATOR = 9, RIGHT_WIDTH = 30 + SEPARATOR + 5 * BUTTON + SEPARATOR + 24 + 110 + 24 + 8 + BUTTON, CENTRE_WIDTH = 140;

/**
 * A button of the toolbar that runs one action of the editor. It is given what it shows and the action's id — no
 * function made by the toolbar — so it renders again only when its own icon, label or state changes: the toolbar works
 * out the state of every tool on each change of the editor, and thirty buttons were drawn again each time.
 */
const ActButton = memo(function ActButton(props: { testID: string; icon: IconName; size: "xs" | "sm"; label: string; keys?: readonly string[]; disabled?: boolean; on?: boolean; toggle?: boolean; run: string }) {
  const runtime = useEditor();
  const press = useCallback(() => { runtime.act(props.run); }, [runtime, props.run]);
  return <IconButton testID={props.testID} icon={props.icon} size={props.size} label={props.label} keys={props.keys} disabled={props.disabled} on={props.on} toggle={props.toggle} onPress={press} />;
}, (before, after) => before.testID === after.testID && before.icon === after.icon && before.size === after.size && before.label === after.label && before.disabled === after.disabled && before.on === after.on && before.toggle === after.toggle && before.run === after.run && (before.keys ?? []).join("+") === (after.keys ?? []).join("+"));

/** The 36 px toolbar of the timeline: its tools, their states and the overflow menu, as the engine lays them out. */
export const TimelineToolbar = memo(function TimelineToolbar() {
  const t = useT();
  const theme = useTheme();
  const runtime = useEditor();
  useEditorVersion();
  const { controller } = runtime, session = controller.session, doc = controller.stored;
  const [width, setWidth] = useState(1440);
  const [open, setOpen] = useState<"cursor" | "overflow" | null>(null);
  const [recording, setRecording] = useState<number | null>(null);
  const bar = useRef<View>(null), cursorRef = useRef<View>(null), overflowRef = useRef<View>(null);
  useEffect(() => observeSize(bar.current, (size) => setWidth(size.width)), []);
  const mac = isMac(), keys = (action: string) => bindingKeys(action, mac) ?? undefined;
  const selectedIds = session.selection.selectedElements, prefs = runtime.prefs;
  const states = timeline.toolStates(doc, { sceneId: session.sceneId, selectedIds, playhead: session.playhead, selectedKeyframes: session.selection.selectedKeyframes.length, canUndo: session.canUndo, canRedo: session.canRedo, undoLabel: session.undoLabel, redoLabel: session.redoLabel });
  // Cursor mode, Undo and Redo take three slots; two separators sit inside the left group.
  const slots = Math.floor((width - RIGHT_WIDTH - CENTRE_WIDTH - 16 - 2 * SEPARATOR - 14) / BUTTON);
  const layout = timeline.toolbarLayout(doc, selectedIds, slots);
  const scene = timeline.sceneById(doc, session.sceneId), duration = timeline.sceneDurationOf(scene), min = timeline.zoomMin(duration, runtime.viewportWidth);
  const magnet = timeline.magnetButtonState(doc, prefs, session.sceneId);
  const mode = CURSOR_MODES.find((entry) => entry.mode === session.cursorMode) ?? CURSOR_MODES[0];
  const recover = timeline.extractAudioTool(doc, selectedIds) === "recover";
  const labelOf = (tool: Tool): string => (tool.id === "extract-audio" && recover ? "Recover audio" : tool.id === "marker" && states.marker.pressed ? "Remove marker" : tool.label);
  const tip = (tool: Tool): string => { const state = states[tool.id]; return state && !state.enabled && state.reason ? `${t(labelOf(tool))} — ${t(state.reason)}` : t(labelOf(tool)); };
  const vl = <View style={{ width: 1, alignSelf: "stretch", marginVertical: space[2], marginHorizontal: space[1], backgroundColor: theme.color("border/hairline") }} />;
  const tool = (id: string) => {
    const entry = LEFT[id];
    if (!entry) return null;
    const state = states[id] ?? { enabled: true };
    return <ActButton key={id} testID={`tool-${id}`} icon={entry.icon} size="sm" label={tip(entry)} keys={keys(entry.run)} disabled={!state.enabled} on={id === "graph-editor" ? runtime.tool.graph : state.pressed} toggle={id === "marker" || id === "graph-editor"} run={entry.run} />;
  };
  const overflow: MenuItem[] = layout.overflow.filter((id) => LEFT[id]).map((id) => ({ id, label: t(labelOf(LEFT[id])), icon: LEFT[id].icon, disabled: states[id] ? !states[id].enabled : false, keys: keys(LEFT[id].run), onSelect: () => void runtime.act(LEFT[id].run) }));
  const toggles: { id: string; icon: IconName; label: string; run: string; on: boolean; disabled?: boolean }[] = [
    { id: "magnet", icon: "magnet", label: magnet.tooltip, run: "timeline.magnet.toggle", on: magnet.pressed, disabled: magnet.disabled },
    { id: "snapping", icon: "snap", label: "Auto snapping", run: "timeline.snapping.toggle", on: prefs.snapping },
    { id: "linkage", icon: "link", label: "Linkage", run: "timeline.linkage.toggle", on: prefs.linkage },
    { id: "preview-axis", icon: "axis", label: "Preview axis", run: "timeline.preview-axis.toggle", on: prefs.previewAxis },
    { id: "ripple", icon: "ripple", label: "Ripple editing", run: "timeline.ripple.toggle", on: prefs.ripple },
  ];
  return (
    <View ref={bar} testID="timeline-toolbar" role="toolbar" aria-label={t("Timeline toolbar")} style={{ height: 36, flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: space[2], borderTopWidth: 1, borderBottomWidth: 1, borderColor: theme.color("border/hairline") }}>
      <Tap ref={cursorRef} role="button" label={t("Cursor mode: {mode}", { mode: t(mode.label) })} tooltip={{ label: t("Cursor mode: {mode}", { mode: t(mode.label) }) }} expanded={open === "cursor"} testID="tool-cursor-mode" onPress={() => setOpen("cursor")}
        style={(state) => ({ height: 28, flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: space[1], borderRadius: radius.sm, backgroundColor: state.hovered || open === "cursor" ? theme.color("bg/hover") : "transparent" })}>
        <Icon name={mode.icon} size={16} /><Icon name="chev-d" size={12} color="text/secondary" />
      </Tap>
      <Menu open={open === "cursor"} anchor={cursorRef} label={t("Cursor mode")} onClose={() => setOpen(null)} items={CURSOR_MODES.map((entry) => ({ id: entry.mode, label: t(entry.label), icon: entry.icon, checked: entry.mode === session.cursorMode, keys: keys(entry.run), onSelect: () => void runtime.act(entry.run) }))} />
      <ActButton testID="tool-undo" icon="undo" size="sm" label={session.undoLabel ? t("Undo {label}", { label: t(session.undoLabel) }) : t("Undo")} keys={keys("edit.undo")} disabled={!states.undo.enabled} run="edit.undo" />
      <ActButton testID="tool-redo" icon="redo" size="sm" label={session.redoLabel ? t("Redo {label}", { label: t(session.redoLabel) }) : t("Redo")} keys={keys("edit.redo")} disabled={!states.redo.enabled} run="edit.redo" />
      {vl}
      {layout.left.slice(3, 13).map(tool)}
      {layout.left.length > 13 ? vl : null}
      {layout.left.slice(13).map(tool)}
      {overflow.length > 0 ? <><IconButton ref={overflowRef} testID="tool-overflow" icon="more" size="sm" label={t("More tools")} expanded={open === "overflow"} onPress={() => setOpen("overflow")} /><Menu open={open === "overflow"} anchor={overflowRef} label={t("More tools")} items={overflow} onClose={() => setOpen(null)} /></> : null}
      <View style={{ flex: 1 }} />
      <Tap role="button" label={t("Scenes: {name}", { name: t(layout.centre.name) })} tooltip={{ label: t("Scenes") }} testID="tool-scenes" onPress={() => runtime.act("timeline.scenes.open")}
        style={(state) => ({ height: 28, maxWidth: CENTRE_WIDTH, flexDirection: "row", alignItems: "center", gap: space[1.5], paddingHorizontal: space[2], borderRadius: radius.sm, backgroundColor: state.hovered ? theme.color("bg/hover") : "transparent" })}>
        <Text variant="body-medium" numberOfLines={1}>{t(layout.centre.name)}</Text><Icon name="chev-d" size={12} />
      </Tap>
      <View style={{ flex: 1 }} />
      <IconButton testID="tool-record" icon="record" size="sm" label={t("Record voiceover")} onPress={() => { runtime.pause(); setRecording(session.playhead); }} />
      {vl}
      {toggles.map((entry) => <ActButton key={entry.id} testID={`tool-${entry.id}`} icon={entry.icon} size="sm" label={t(entry.label)} keys={keys(entry.run)} on={entry.on} toggle disabled={entry.disabled} run={entry.run} />)}
      {vl}
      <ActButton testID="tool-zoom-out" icon="minus" size="xs" label={t("Zoom out")} keys={keys("timeline.zoom-out")} disabled={session.view.zoomLevel <= min * 1.0001} run="timeline.zoom-out" />
      <View testID="tool-zoom-slider" style={{ width: 110 }}><Slider label={t("Zoom")} min={0} max={1} step={timeline.ZOOM_SLIDER_STEP} value={timeline.zoomToSlider(session.view.zoomLevel, min)} onChange={(value) => runtime.zoom({ slider: value as number })} onCommit={(value) => runtime.zoom({ slider: value as number })} /></View>
      <ActButton testID="tool-zoom-in" icon="plus" size="xs" label={t("Zoom in")} keys={keys("timeline.zoom-in")} disabled={session.view.zoomLevel >= timeline.ZOOM_MAX} run="timeline.zoom-in" />
      <ActButton testID="tool-zoom-fit" icon="fit" size="sm" label={t("Zoom to fit")} keys={keys("timeline.zoom-fit")} run="timeline.zoom-fit" />
      {recording !== null ? <Recorder session={runtime.media} source="voice" onClose={() => setRecording(null)} onDone={(result) => {
        const at = recording;
        setRecording(null);
        const ids = result ? [...result.imported, ...result.reused].map((entry) => entry.assetId) : [];
        // The take lands on an audio track where the recording started.
        if (ids.length > 0) controller.run(asVoice(timeline.addToTimeline({ sceneId: session.sceneId, items: ids.map((assetId) => ({ kind: "media" as const, assetId })), time: at, label: "Record voiceover" })));
      }} /> : null}
    </View>
  );
});
