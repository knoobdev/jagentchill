import { useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import Svg, { Circle, G, Line, Path, Rect } from "react-native-svg";
import { chainCommits, TIMELINE_FRAME } from "@jagentchill/app-core";
import {
  applyEasing, bezierProgress, clampEasing, clickKeySelection, EASING_PRESETS, EASING_REASONS, easingState, insertKeyOnCurve, keysOfPath, lanePaths, matchingPreset, moveHandle, moveKeys, pathLabel, removeAllKeys, removeKeys, sameBezier, scalarAt,
  setExtrapolation, setKeyValue, setSegmentType, setTangentMode, storedPaths, timeline, type Bezier, type Commit, type CommitContext, type KeyRef,
} from "@jagentchill/editor-core";
import type { ProjectDocument } from "@jagentchill/protocol";
import { Button, Checkbox, IconButton, Input, Menu, Segmented, Tap, Text, Tooltip, radius, space, useTheme, type ColorToken, type MenuItem, dragHandle } from "@jagentchill/ui";
import { useT } from "../../locale";
import { usePref } from "../../state";
import { useEditor, useEditorVersion, useTransport } from "../context";
import { bindCursorHitTest, bindPointer, bindWheel, setCursor } from "../dom";
import { INSPECTOR_PREFS, type SavedEasing } from "../inspector/prefs";

type El = timeline.El;
type Key = { id: string; time: number; value: number; segmentToNext?: string; tangentMode?: string; leftHandle?: { dt: number; dv: number }; rightHandle?: { dt: number; dv: number } };
/** The names the graph editor takes from the engine's tables, listed for the locale resources. */
const GRAPH_STRINGS = {
  presets: ["Linear", "Smooth", "Pop", "Ease in", "Quad in", "Cubic in", "Ease out", "Quad out", "Cubic out", "In out", "Quad in out", "Cubic in out", "Expo in out"], groups: ["Basic", "In", "Out", "Ease"],
  channels: ["Position X", "Position Y", "Scale", "Rotation", "Opacity", "Volume", "Pan"], modes: ["Auto", "Free", "Aligned", "Flat"],
  reasons: ["Select a keyframe to edit its curve.", "Selected keyframes must be on the same element.", "Select a keyframe that has an outgoing segment.", "Hold segments have a fixed value - easing has no effect here.", "Cannot edit a segment where both keyframes are at the same time.", "Selected properties do not share a graph-editable channel.", "Keyframe limit reached (1000 per property)"],
};
void GRAPH_STRINGS;
const COLOURS: ColorToken[] = ["chart/1", "chart/4", "chart/3", "chart/5", "danger", "chart/2", "chart/6", "chart/7"];
const EASING_PANEL = 184, HEADER = TIMELINE_FRAME.headerWidth, BAR = 28;
const TANGENTS = [["auto", "Auto"], ["broken", "Free"], ["aligned", "Aligned"], ["flat", "Flat"]] as const;
const sameRef = (a: KeyRef, b: KeyRef): boolean => a.elementId === b.elementId && a.path === b.path && a.keyId === b.keyId;

/** The element the graph editor shows: the one of the selected keyframes, else the single selected element. */
function graphElement(document: ProjectDocument, sceneId: string, selection: timeline.SelectionState): El | null {
  const ids = selection.selectedKeyframes.length > 0 ? [...new Set(selection.selectedKeyframes.map((key) => key.elementId))] : selection.selectedElements;
  if (ids.length !== 1) return null;
  return timeline.elementsOfScene(timeline.sceneById(document, sceneId)).find((element) => element.id === ids[0]) ?? null;
}
/** Why the "Graph editor" button is off, or `null` when it can open. */
export function graphUnavailable(document: ProjectDocument, sceneId: string, selection: timeline.SelectionState): string | null {
  if (selection.selectedKeyframes.length > 0) return null;
  const elements = timeline.elementsOfScene(timeline.sceneById(document, sceneId)).filter((element) => selection.selectedElements.includes(element.id));
  return elements.some((element) => Object.keys((element.animations ?? {}) as object).length > 0) ? null : EASING_REASONS.none;
}

/** The graph editor, docked above the tracks: value-over-time curves of the selected clip that share the timeline's zoom, scroll and playhead, and the easing of the selected segments. */
export function GraphEditor() {
  const t = useT();
  const theme = useTheme();
  const runtime = useEditor();
  useEditorVersion();
  const transport = useTransport();
  const { controller } = runtime, session = controller.session, document = controller.document;
  const [prefs, setPrefs] = usePref(INSPECTOR_PREFS.graph);
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [range, setRange] = useState<{ min: number; max: number } | null>(null);
  const [size, setSize] = useState({ width: 800 });
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; items: MenuItem[] } | null>(null);
  const [box, setBox] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const plot = useRef<View>(null), grip = useRef<View>(null);
  const element = graphElement(document, session.sceneId, session.selection);
  const selected = session.selection.selectedKeyframes as KeyRef[];
  const height = Math.min(480, Math.max(160, prefs.height)), plotHeight = height - BAR;
  const zoomLevel = session.view.zoomLevel, scrollLeft = session.view.scrollLeft;
  const paths = element ? lanePaths(element) : [];
  // Scalar channels are curves; colour, discrete and path channels are step rows without a value axis.
  const scalar = (path: string): boolean => { const first = element ? (keysOfPath(element, path)[0] as unknown as Key | undefined) : undefined, channel = element ? ((element.animations ?? {}) as Record<string, object>)[storedPaths(path)[0]] : undefined; return typeof first?.value === "number" && !(channel && "r" in channel); };
  const shown = paths.filter((path) => scalar(path) && !hidden[path]);
  const keysOf = (path: string): Key[] => (element ? (keysOfPath(element, path) as unknown as Key[]) : []);
  const channelOf = (path: string) => (element!.animations as Record<string, { keys: Key[]; extrapolation?: { before?: string; after?: string } }>)[storedPaths(path)[0]];
  const fitted = useMemo(() => {
    const values = shown.flatMap((path) => keysOf(path).map((key) => key.value));
    if (values.length === 0) return { min: 0, max: 1 };
    const low = Math.min(...values), high = Math.max(...values), pad = (high - low || Math.abs(high) || 1) * 0.1;
    return { min: low - pad, max: high + pad };
  }, [element, shown.join("|"), controller.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const axis = range ?? fitted, plotWidth = Math.max(100, size.width - HEADER - EASING_PANEL);
  const xOf = (local: number) => timeline.ticksToPixels((element?.startTime ?? 0) + local, zoomLevel) - scrollLeft;
  const yOf = (value: number) => plotHeight - 8 - ((value - axis.min) / (axis.max - axis.min || 1)) * (plotHeight - 16);
  const live = useRef({ element, shown, axis, zoomLevel, scrollLeft, selected, plotHeight, plotWidth, fitted });
  live.current = { element, shown, axis, zoomLevel, scrollLeft, selected, plotHeight, plotWidth, fitted };
  const select = (keys: KeyRef[], anchor?: KeyRef) => controller.select(timeline.selectKeyframes(controller.session.selection, keys as never, anchor as never));
  /** Applies an operation to every stored channel a presented key stands for (the two of a grouped Scale). */
  const each = (ref: KeyRef, change: (doc: ProjectDocument, ctx: CommitContext, stored: KeyRef) => Commit | null, label: string, isLive = false) => controller.external((doc, ctx) => {
    const target = timeline.locate(doc, ref.elementId)?.element;
    if (!target) return null;
    const time = keysOfPath(target, ref.path).find((key) => key.id === ref.keyId)?.time;
    return chainCommits(doc, ctx, label, "keyframe.curve", storedPaths(ref.path).map((path) => (before: ProjectDocument, context: CommitContext) => { const own = timeline.locate(before, ref.elementId)?.element, id = own ? keysOfPath(own, path).find((key) => key.time === time)?.id : undefined; return id ? change(before, context, { elementId: ref.elementId, path, keyId: id }) : null; }));
  }, isLive);

  useEffect(() => bindPointer(plot.current, {
    hover(info) {
      const state = live.current, target = state.element;
      if (!info || !target) { setCursor(plot.current, "default"); return; }
      const x = (local: number) => timeline.ticksToPixels(target.startTime + local, state.zoomLevel) - state.scrollLeft;
      const y = (value: number) => state.plotHeight - 8 - ((value - state.axis.min) / (state.axis.max - state.axis.min || 1)) * (state.plotHeight - 16);
      let hit = false;
      for (const ref of state.selected.filter((entry) => state.shown.includes(entry.path))) {
        const key = (keysOfPath(target, ref.path) as unknown as Key[]).find((entry) => entry.id === ref.keyId);
        if (key && [key.leftHandle, key.rightHandle].some((handle) => handle && Math.hypot(x(key.time + handle.dt) - info.x, y(key.value + handle.dv) - info.y) <= 7)) { hit = true; break; }
      }
      if (!hit) hit = state.shown.some((path) => (keysOfPath(target, path) as unknown as Key[]).some((key) => Math.abs(x(key.time) - info.x) <= 6 && Math.abs(y(key.value) - info.y) <= 6));
      setCursor(plot.current, hit ? "grab" : "default");
    },
    down(info) {
      const state = live.current, target = state.element;
      if (!target) return null;
      const x = (local: number) => timeline.ticksToPixels(target.startTime + local, state.zoomLevel) - state.scrollLeft;
      const y = (value: number) => state.plotHeight - 8 - ((value - state.axis.min) / (state.axis.max - state.axis.min || 1)) * (state.plotHeight - 16);
      const perPx = (state.axis.max - state.axis.min || 1) / (state.plotHeight - 16), ticksPerPx = 1 / timeline.ticksToPixels(1, state.zoomLevel);
      // A tangent handle of a selected key comes first, then a key, then the empty plot.
      for (const ref of state.selected.filter((entry) => state.shown.includes(entry.path))) {
        const key = (keysOfPath(target, ref.path) as unknown as Key[]).find((entry) => entry.id === ref.keyId);
        if (!key) continue;
        for (const side of ["left", "right"] as const) {
          const handle = side === "left" ? key.leftHandle : key.rightHandle;
          if (!handle || Math.hypot(x(key.time + handle.dt) - info.x, y(key.value + handle.dv) - info.y) > 7) continue;
          const drag = (pointer: { x: number; y: number; alt: boolean }, isLive: boolean) => each(ref, (doc, ctx, stored) => moveHandle(doc, ctx, stored, side, { dt: (pointer.x - x(key.time)) * ticksPerPx, dv: -(pointer.y - y(key.value)) * perPx }, { breakTangent: pointer.alt }), "Tangent", isLive);
          return { move: (pointer) => { drag(pointer, true); }, up: (pointer) => { controller.discardPreview(); drag(pointer, false); }, cancel: () => controller.discardPreview() };
        }
      }
      for (const path of state.shown) {
        const key = (keysOfPath(target, path) as unknown as Key[]).find((entry) => Math.abs(x(entry.time) - info.x) <= 6 && Math.abs(y(entry.value) - info.y) <= 6);
        if (!key) continue;
        const ref: KeyRef = { elementId: target.id, path, keyId: key.id }, already = state.selected.some((entry) => sameRef(entry, ref));
        const next = info.mod || info.shift || !already ? clickKeySelection(target, state.selected, controller.session.selection.keyframeAnchor as KeyRef | undefined, ref, { mod: info.mod, shift: info.shift }) : { keys: state.selected, anchor: ref };
        select(next.keys, next.anchor);
        if (info.mod) return null;
        const moving = next.keys.filter((entry) => entry.elementId === target.id);
        let moved = false;
        const drag = (pointer: { x: number; y: number; shift: boolean }, isLive: boolean) => {
          const dx = pointer.x - info.x, dy = pointer.y - info.y;
          if (!moved && Math.hypot(dx, dy) < 5) return;
          moved = true;
          // Shift keeps the drag on one axis: time or value.
          const timeOnly = pointer.shift && Math.abs(dx) >= Math.abs(dy), valueOnly = pointer.shift && !timeOnly;
          controller.external((doc, ctx) => chainCommits(doc, ctx, "Move keyframe", "keyframe.retime", [
            (before, context) => (valueOnly ? null : moveKeys(before, context, moving, dx * ticksPerPx)),
            ...(timeOnly ? [] : storedPaths(path).map((stored) => (before: ProjectDocument, context: CommitContext) => { const own = timeline.locate(before, target.id)?.element, id = stored === storedPaths(path)[0] ? key.id : own ? keysOfPath(own, stored).find((entry) => entry.time === keysOfPath(own, storedPaths(path)[0]).find((first) => first.id === key.id)?.time)?.id : undefined; return id ? setKeyValue(before, context, { elementId: target.id, path: stored, keyId: id }, key.value - dy * perPx) : null; })),
          ]), isLive);
        };
        return { move: (pointer) => drag(pointer, true), up: (pointer) => { if (moved) { controller.discardPreview(); drag(pointer, false); } else controller.seek(timeline.seekTime(target.startTime + key.time, runtime.duration(), runtime.fps())); }, cancel: () => controller.discardPreview() };
      }
      // Empty plot: a rectangle selects the keys it covers; a click clears the selection.
      const base = info.mod ? state.selected : [];
      return {
        move: (pointer) => { if (Math.hypot(pointer.x - info.x, pointer.y - info.y) >= 5) setBox({ x1: info.x, y1: info.y, x2: pointer.x, y2: pointer.y }); },
        up: (pointer) => {
          setBox(null);
          if (Math.hypot(pointer.x - info.x, pointer.y - info.y) < 5) { select([]); return; }
          const [left, right, top, bottom] = [Math.min(info.x, pointer.x), Math.max(info.x, pointer.x), Math.min(info.y, pointer.y), Math.max(info.y, pointer.y)];
          const found = state.shown.flatMap((path) => (keysOfPath(target, path) as unknown as Key[]).filter((key) => x(key.time) + 7 >= left && x(key.time) - 7 <= right && y(key.value) + 7 >= top && y(key.value) - 7 <= bottom).map((key) => ({ elementId: target.id, path, keyId: key.id })));
          select([...base, ...found.filter((key) => !base.some((entry) => sameRef(entry, key)))]);
        },
        cancel: () => setBox(null),
      };
    },
    double(info) {
      const state = live.current, target = state.element;
      if (!target) return;
      const local = (info.x + state.scrollLeft) / timeline.ticksToPixels(1, state.zoomLevel) - target.startTime;
      const y = (value: number) => state.plotHeight - 8 - ((value - state.axis.min) / (state.axis.max - state.axis.min || 1)) * (state.plotHeight - 16);
      // The curve nearest the pointer at that time receives the key.
      const near = state.shown.map((path) => ({ path, distance: Math.abs(y(scalarAt((target.animations as Record<string, { keys: unknown[] }>)[storedPaths(path)[0]], local)) - info.y) })).sort((a, b) => a.distance - b.distance)[0];
      if (near && near.distance <= 10 && local >= 0 && local <= target.duration) controller.external((doc, ctx) => insertKeyOnCurve(doc, ctx, target.id, near.path, local));
    },
    context(info) {
      const state = live.current, target = state.element;
      if (!target) return;
      const x = (local: number) => timeline.ticksToPixels(target.startTime + local, state.zoomLevel) - state.scrollLeft;
      const y = (value: number) => state.plotHeight - 8 - ((value - state.axis.min) / (state.axis.max - state.axis.min || 1)) * (state.plotHeight - 16);
      for (const path of state.shown) {
        const key = (keysOfPath(target, path) as unknown as Key[]).find((entry) => Math.abs(x(entry.time) - info.x) <= 6 && Math.abs(y(entry.value) - info.y) <= 6);
        if (!key) continue;
        const ref: KeyRef = { elementId: target.id, path, keyId: key.id }, refs = state.selected.some((entry) => sameRef(entry, ref)) ? state.selected : [ref];
        select(refs, ref);
        setMenu({ at: { x: info.clientX, y: info.clientY }, items: [
          ...(["linear", "hold", "bezier"] as const).map((type): MenuItem => ({ id: type, label: t(type === "linear" ? "Linear" : type === "hold" ? "Hold" : "Bezier"), checked: (key.segmentToNext ?? "linear") === (type === "hold" ? "step" : type), onSelect: () => controller.external((doc, ctx) => setSegmentType(doc, ctx, refs, type)) })),
          { type: "separator" },
          ...TANGENTS.map(([mode, name]): MenuItem => ({ id: mode, label: t(name), checked: (key.tangentMode ?? "auto") === mode, onSelect: () => controller.external((doc, ctx) => setTangentMode(doc, ctx, refs, mode)) })),
          { type: "separator" },
          { id: "delete", label: t("Delete keyframe"), danger: true, icon: "trash", onSelect: () => removeSelected(refs) },
        ] });
        return;
      }
    },
  }), [runtime, controller]); // eslint-disable-line react-hooks/exhaustive-deps
  // Mod + wheel zooms the value axis about the pointer.
  useEffect(() => bindWheel(plot.current, (wheel) => {
    if (!(wheel.ctrlKey || wheel.metaKey)) return;
    const state = live.current, current = state.axis, at = current.max - (wheel.y / state.plotHeight) * (current.max - current.min), factor = Math.exp(wheel.deltaY * 0.002);
    setRange({ min: at - (at - current.min) * factor, max: at + (current.max - at) * factor });
  }), []);
  useEffect(() => bindPointer(grip.current, { down(info) { const start = live.current.plotHeight + BAR, from = info.clientY; return { move: (pointer) => setPrefs({ ...prefs, height: Math.min(480, Math.max(160, start + (pointer.clientY - from))) }) }; } }), [prefs, setPrefs]);
  // A new clip fits the axis anew.
  useEffect(() => setRange(null), [element?.id]);

  const local = (id: string) => ({ [id]: Math.min(element?.duration ?? 0, Math.max(0, transport.time - (element?.startTime ?? 0))) });
  const removeSelected = (refs: KeyRef[]) => { if (refs.length > 0) controller.external((doc, ctx) => removeKeys(doc, ctx, refs, { localTimes: local(refs[0].elementId) })); };
  const channelMenu = (path: string, at: { x: number; y: number }) => {
    const channel = channelOf(path), set = (change: { before?: "hold" | "linear"; after?: "hold" | "linear" }) => controller.external((doc, ctx) => setExtrapolation(doc, ctx, element!.id, path, change));
    setMenu({ at, items: [
      { id: "before-hold", label: t("Before first key: Hold"), checked: (channel.extrapolation?.before ?? "hold") === "hold", onSelect: () => set({ before: "hold" }) }, { id: "before-linear", label: t("Before first key: Linear"), checked: channel.extrapolation?.before === "linear", onSelect: () => set({ before: "linear" }) },
      { id: "after-hold", label: t("After last key: Hold"), checked: (channel.extrapolation?.after ?? "hold") === "hold", onSelect: () => set({ after: "hold" }) }, { id: "after-linear", label: t("After last key: Linear"), checked: channel.extrapolation?.after === "linear", onSelect: () => set({ after: "linear" }) },
      { type: "separator" }, { id: "remove-all", label: t("Remove all keyframes"), danger: true, onSelect: () => controller.external((doc, ctx) => removeAllKeys(doc, ctx, element!.id, path, local(element!.id)[element!.id])) },
    ] });
  };
  const easing = easingState(document, selected);
  const tangent = selected.length > 0 && element ? [...new Set(selected.filter((ref) => ref.elementId === element.id).map((ref) => keysOf(ref.path).find((key) => key.id === ref.keyId)?.tangentMode ?? "auto"))] : [];
  const curve = (path: string): string => {
    const channel = channelOf(path), from = Math.max(0, Math.floor((scrollLeft) / timeline.ticksToPixels(1, zoomLevel) - element!.startTime)), to = Math.min(element!.duration, Math.ceil((scrollLeft + plotWidth) / timeline.ticksToPixels(1, zoomLevel) - element!.startTime));
    if (to <= from) return "";
    const steps = Math.max(2, Math.min(600, Math.round(xOf(to) - xOf(from)) >> 1)), times = new Set<number>(keysOf(path).map((key) => key.time).filter((time) => time >= from && time <= to));
    for (let step = 0; step <= steps; step++) times.add(from + ((to - from) * step) / steps);
    return [...times].sort((a, b) => a - b).map((time, index) => `${index === 0 ? "M" : "L"}${xOf(time).toFixed(1)} ${yOf(scalarAt(channel, time)).toFixed(1)}`).join(" ");
  };
  const labels = [axis.max - (axis.max - axis.min) * 0.1, (axis.max + axis.min) / 2, axis.min + (axis.max - axis.min) * 0.1];
  const format = (value: number) => (Math.abs(value) >= 100 ? String(Math.round(value)) : Math.abs(value) >= 10 ? value.toFixed(1) : value.toFixed(2));
  const playheadX = timeline.ticksToPixels(transport.time, zoomLevel) - scrollLeft;
  return (
    <View testID="graph-editor" style={{ height, borderBottomWidth: 1, borderBottomColor: theme.color("border/hairline"), backgroundColor: theme.color("bg/app") }} onLayout={(event) => setSize({ width: event.nativeEvent.layout.width })}>
      <View style={{ height: BAR, flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[2], borderBottomWidth: 1, borderBottomColor: theme.color("border/hairline") }}>
        <Text variant="body-medium">{t("Graph editor")}</Text>
        <Segmented label={t("Graph view")} size="xs" value={prefs.view} onChange={(view) => setPrefs({ ...prefs, view })} options={[{ value: "curves", label: t("Curves") }, { value: "easing", label: t("Easing") }]} />
        <Text variant="meta" color="text/secondary" numberOfLines={1} style={{ flex: 1 }} testID="graph-summary">{element ? `${element.name} · ${shown.length === 1 ? t("1 channel visible") : t("{n} channels visible", { n: shown.length })}` : ""}</Text>
        {TANGENTS.map(([mode, name]) => <Button key={mode} size="xs" kind={tangent.length === 1 && tangent[0] === mode ? "secondary" : "ghost"} pressed={tangent.length === 1 && tangent[0] === mode} label={t(name)} disabled={selected.length === 0} testID={`graph-tangent-${mode}`} onPress={() => controller.external((doc, ctx) => setTangentMode(doc, ctx, selected.flatMap((ref) => storedPaths(ref.path).map((path) => ({ ...ref, path }))), mode))} />)}
        <Button size="xs" kind="ghost" label={t("Fit")} testID="graph-fit" onPress={() => setRange(null)} />
        <IconButton icon="x" size="xs" label={t("Close graph editor")} testID="graph-close" onPress={() => runtime.setTool({ graph: false })} />
      </View>
      <View style={{ flex: 1, flexDirection: "row", minHeight: 0 }}>
        <View testID="graph-channels" style={{ width: HEADER, borderEndWidth: 1, borderEndColor: theme.color("border/hairline"), paddingVertical: space[1] }}>
          {paths.map((path, index) => (
            <Tap key={path} label={t(pathLabel(path))} onContextMenu={scalar(path) ? (at) => channelMenu(path, at) : undefined} testID={`graph-channel-${path}`} style={{ flexDirection: "row", alignItems: "center", gap: space[1], height: 20, paddingHorizontal: space[1.5] }}>
              <Checkbox accessibilityLabel={t(pathLabel(path))} checked={scalar(path) && !hidden[path]} disabled={!scalar(path)} onChange={(on) => setHidden({ ...hidden, [path]: !on })} />
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: theme.color(COLOURS[index % COLOURS.length]) }} />
              <Text variant="meta" numberOfLines={1} style={{ flex: 1 }}>{t(pathLabel(path))}</Text>
            </Tap>
          ))}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
        <View ref={plot} testID="graph-plot" style={{ flex: 1, overflow: "hidden", backgroundColor: theme.color("bg/subtle") }}>
          {!element || paths.length === 0 ? (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: space[3] }}><Text color="text/secondary" align="center" testID="graph-empty">{t(!element && selected.length > 1 ? EASING_REASONS.elements : "No keyframes on this clip. Add a keyframe from the inspector.")}</Text></View>
          ) : prefs.view === "easing" ? null : (
            <>
              <Svg width={plotWidth} height={plotHeight} style={{ position: "absolute", left: 0, top: 0 }}>
                {labels.map((value) => <Line key={value} x1={0} x2={plotWidth} y1={yOf(value)} y2={yOf(value)} stroke={theme.color("border/hairline")} strokeWidth={1} />)}
                <Rect x={xOf(0)} y={0} width={Math.max(0, xOf(element.duration) - xOf(0))} height={plotHeight} fill={theme.color("accent/subtle")} opacity={0.25} />
                {shown.map((path) => <Path key={path} testID={`graph-curve-${path}`} d={curve(path)} stroke={theme.color(COLOURS[paths.indexOf(path) % COLOURS.length])} strokeWidth={1.5} fill="none" />)}
                {shown.flatMap((path) => keysOf(path).map((key) => {
                  const on = selected.some((ref) => ref.path === path && ref.keyId === key.id), colour = theme.color(COLOURS[paths.indexOf(path) % COLOURS.length]);
                  return (
                    <G key={`${path}-${key.id}`}>
                      {on && key.leftHandle ? <><Line x1={xOf(key.time)} y1={yOf(key.value)} x2={xOf(key.time + key.leftHandle.dt)} y2={yOf(key.value + key.leftHandle.dv)} stroke={theme.color("text/secondary")} strokeWidth={1} /><Circle cx={xOf(key.time + key.leftHandle.dt)} cy={yOf(key.value + key.leftHandle.dv)} r={3} fill={theme.color("bg/app")} stroke={theme.color("text/primary")} strokeWidth={1} /></> : null}
                      {on && key.rightHandle ? <><Line x1={xOf(key.time)} y1={yOf(key.value)} x2={xOf(key.time + key.rightHandle.dt)} y2={yOf(key.value + key.rightHandle.dv)} stroke={theme.color("text/secondary")} strokeWidth={1} /><Circle cx={xOf(key.time + key.rightHandle.dt)} cy={yOf(key.value + key.rightHandle.dv)} r={3} fill={theme.color("bg/app")} stroke={theme.color("text/primary")} strokeWidth={1} /></> : null}
                      <Rect x={xOf(key.time) - 4} y={yOf(key.value) - 4} width={8} height={8} transform={`rotate(45 ${xOf(key.time)} ${yOf(key.value)})`} fill={on ? colour : theme.color("bg/app")} stroke={colour} strokeWidth={1.5} />
                    </G>
                  );
                }))}
                <Line x1={playheadX} x2={playheadX} y1={0} y2={plotHeight} stroke={theme.color("text/primary")} strokeWidth={1} />
                {box ? <Rect x={Math.min(box.x1, box.x2)} y={Math.min(box.y1, box.y2)} width={Math.abs(box.x2 - box.x1)} height={Math.abs(box.y2 - box.y1)} fill={theme.color("accent/subtle")} opacity={0.5} stroke={theme.color("accent")} strokeWidth={1} /> : null}
              </Svg>
              {labels.map((value) => <View key={value} pointerEvents="none" style={{ position: "absolute", left: 4, top: yOf(value) - 13 }}><Text variant="caption" color="text/tertiary" tabular>{format(value)}</Text></View>)}
              {/* The keys again as hit targets the tests and assistive tools can find. */}
              {shown.flatMap((path) => keysOf(path).map((key) => <View key={`hit-${path}-${key.id}`} pointerEvents="none" testID="graph-key" aria-label={`${pathLabel(path)} ${key.time}`} style={{ position: "absolute", left: xOf(key.time) - 4, top: yOf(key.value) - 4, width: 8, height: 8 }} />))}
            </>
          )}
        </View>
        {/* The Easing view lies over the plot, outside its pointer handling. */}
        {element && paths.length > 0 && prefs.view === "easing" ? <View style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, backgroundColor: theme.color("bg/subtle") }}><EasingTiles state={easing} onApply={(bezier) => { if (easing.ok) controller.external((doc, ctx) => applyEasing(doc, ctx, easing.refs, bezier)); }} /></View> : null}
        </View>
        <EasingPanel state={easing} onChange={(bezier, isLive) => { if (easing.ok) controller.external((doc, ctx) => applyEasing(doc, ctx, easing.refs, bezier), isLive); }} onDiscard={() => controller.discardPreview()} />
      </View>
      <View {...dragHandle("ns-resize")} ref={grip} testID="graph-resize" style={{ position: "absolute", left: 0, right: 0, bottom: -3, height: 6 }} />
      <Menu open={menu !== null} anchor={menu ? { x: menu.at.x, y: menu.at.y, width: 1, height: 1 } : { x: 0, y: 0, width: 1, height: 1 }} items={menu?.items ?? []} label={t("Keyframe")} onClose={() => setMenu(null)} />
    </View>
  );
}

type EasingState = ReturnType<typeof easingState>;
const MINI = { width: 140, height: 94, pad: 12 };
const miniPath = (bezier: Bezier, width: number, height: number, pad: number): string => {
  const x = (value: number) => pad + value * (width - pad * 2), y = (value: number) => height - pad - value * (height - pad * 2);
  return `M${x(0)} ${y(0)} C${x(bezier[0])} ${y(bezier[1])} ${x(bezier[2])} ${y(bezier[3])} ${x(1)} ${y(1)}`;
};
/** A preset tile: the curve's shape, outlined while the segment matches it. */
function PresetTile(props: { name: string; bezier: Bezier; active: boolean; disabled: boolean; testID: string; onPress(): void; onLongPress?(): void }) {
  const theme = useTheme();
  return (
    <Tap role="button" label={props.name} pressedState={props.active} disabled={props.disabled} testID={props.testID} onPress={props.onPress} onContextMenu={props.onLongPress ? () => props.onLongPress!() : undefined} style={{ width: 52, gap: 2 }}>
      <View style={{ height: 24, borderRadius: radius.sm, borderWidth: props.active ? 2 : 1, borderColor: theme.color(props.active ? "accent" : "border/control"), backgroundColor: theme.color("bg/app") }}>
        <Svg width={50} height={22}><Path d={miniPath(props.bezier, 50, 22, 3)} stroke={theme.color("text/primary")} strokeWidth={1.25} fill="none" /></Svg>
      </View>
      <Text variant="caption" numberOfLines={1}>{props.name}</Text>
    </Tap>
  );
}
/** The easing of the selected segments: a 140 × 94 graph with two handles, the four numbers, and the most used presets. */
function EasingPanel(props: { state: EasingState; onChange(bezier: Bezier, live: boolean): void; onDiscard(): void }) {
  const t = useT();
  const theme = useTheme();
  const node = useRef<View>(null);
  const [draft, setDraft] = useState<Bezier | null>(null);
  const bezier = draft ?? (props.state.ok ? props.state.bezier : null);
  const live = useRef({ bezier: props.state.ok ? props.state.bezier : null, props });
  live.current = { bezier: props.state.ok ? props.state.bezier : null, props };
  const x = (value: number) => MINI.pad + value * (MINI.width - MINI.pad * 2), y = (value: number) => MINI.height - MINI.pad - value * (MINI.height - MINI.pad * 2);
  useEffect(() => {
    const offPointer = bindPointer(node.current, {
    down(info) {
      const from = live.current.bezier;
      if (!from) return null;
      const second = Math.hypot(x(from[2]) - info.x, y(from[3]) - info.y) < Math.hypot(x(from[0]) - info.x, y(from[1]) - info.y);
      const at = (pointer: { x: number; y: number; shift: boolean }): Bezier => { const px = (pointer.x - MINI.pad) / (MINI.width - MINI.pad * 2), py = (MINI.height - MINI.pad - pointer.y) / (MINI.height - MINI.pad * 2); return clampEasing(second ? [from[0], from[1], px, py] : [px, py, from[2], from[3]], pointer.shift); };
      return {
        move: (pointer) => { const next = at(pointer); setDraft(next); live.current.props.onChange(next, true); },
        up: (pointer) => { const next = at(pointer); setDraft(null); live.current.props.onDiscard(); if (!sameBezier(next, from, 1e-6)) live.current.props.onChange(next, false); },
        cancel: () => { setDraft(null); live.current.props.onDiscard(); },
      };
    },
    });
    const offCursor = bindCursorHitTest(node.current, (event) => {
      const surface = node.current as unknown as HTMLElement | null;
      return !!live.current.bezier && [...(surface?.querySelectorAll("svg circle") ?? [])].some((handle) => {
        const rect = handle.getBoundingClientRect();
        return Math.hypot(rect.left + rect.width / 2 - event.clientX, rect.top + rect.height / 2 - event.clientY) <= 8;
      });
    });
    return () => { offPointer(); offCursor(); };
  }, [!!bezier]);
  const active = matchingPreset(bezier);
  return (
    <View testID="graph-easing" style={{ width: EASING_PANEL, borderStartWidth: 1, borderStartColor: theme.color("border/hairline"), padding: space[2], gap: space[1.5] }}>
      {bezier ? (
        <>
          <View style={{ flexDirection: "row", gap: space[2] }}>
            <View ref={node} testID="graph-easing-curve" style={{ width: MINI.width - 24, height: MINI.height - 12, borderRadius: radius.sm, borderWidth: 1, borderColor: theme.color("border/hairline"), backgroundColor: theme.color("bg/subtle"), overflow: "hidden" }}>
              <Svg width={MINI.width} height={MINI.height} viewBox={`12 6 ${MINI.width - 24} ${MINI.height - 12}`}>
                <Line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} stroke={theme.color("border/strong")} strokeWidth={1} strokeDasharray="2 2" />
                <Line x1={x(0)} y1={y(0)} x2={x(bezier[0])} y2={y(bezier[1])} stroke={theme.color("accent")} strokeWidth={1} /><Line x1={x(1)} y1={y(1)} x2={x(bezier[2])} y2={y(bezier[3])} stroke={theme.color("accent")} strokeWidth={1} />
                <Path d={miniPath(bezier, MINI.width, MINI.height, MINI.pad)} stroke={theme.color("accent")} strokeWidth={1.5} fill="none" />
                <Circle cx={x(bezier[0])} cy={y(bezier[1])} r={3.5} fill={theme.color("bg/app")} stroke={theme.color("accent")} strokeWidth={1.5} /><Circle cx={x(bezier[2])} cy={y(bezier[3])} r={3.5} fill={theme.color("bg/app")} stroke={theme.color("accent")} strokeWidth={1.5} />
              </Svg>
            </View>
            <View testID="graph-easing-values" style={{ gap: 1 }}><Text variant="caption" color="text/secondary">{t("Bezier")}</Text>{bezier.map((value, index) => <Text key={index} variant="mono">{value.toFixed(2)}</Text>)}</View>
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[1] }}>
            {["linear", "smooth", "pop", "ease-in", "ease-out", "in-out"].map((id) => { const preset = EASING_PRESETS.find((entry) => entry.id === id)!; return <PresetTile key={id} name={t(preset.name)} bezier={preset.bezier} active={active === id} disabled={false} testID={`graph-preset-${id}`} onPress={() => props.onChange(preset.bezier, false)} />; })}
          </View>
        </>
      ) : <Text variant="meta" color="text/secondary" testID="graph-easing-reason">{t(props.state.ok ? "" : props.state.reason)}</Text>}
    </View>
  );
}
/** The Easing view: every built-in preset by group, and the curves saved on this device. */
function EasingTiles(props: { state: EasingState; onApply(bezier: Bezier): void }) {
  const t = useT();
  const [saved, setSaved] = usePref(INSPECTOR_PREFS.easings);
  const [tab, setTab] = useState<"presets" | "saved">("presets");
  const [renaming, setRenaming] = useState<{ name: string; draft: string } | null>(null);
  const current = props.state.ok ? props.state.bezier : null, active = matchingPreset(current), off = !props.state.ok;
  const save = () => {
    if (!current || saved.length >= 100) return;
    let number = 1;
    while (saved.some((entry) => entry.name === `Custom ${number}`)) number++;
    setSaved([...saved, { name: `Custom ${number}`, bezier: current }]);
  };
  const rename = (from: string, to: string) => {
    const clean = to.trim().slice(0, 40);
    setRenaming(null);
    if (!clean || clean === from) return;
    let unique = clean, suffix = 2;
    while (saved.some((entry) => entry.name === unique)) unique = `${clean} (${suffix++})`;
    setSaved(saved.map((entry): SavedEasing => (entry.name === from ? { ...entry, name: unique } : entry)));
  };
  return (
    <View testID="graph-easing-view" style={{ flex: 1, padding: space[2], gap: space[1.5] }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
        <Segmented label={t("Easing presets")} size="xs" value={tab} onChange={(next) => setTab(next as "presets" | "saved")} options={[{ value: "presets", label: t("Presets") }, { value: "saved", label: t("Saved") }]} />
        {off ? <Text variant="meta" color="text/secondary" testID="graph-easing-message" numberOfLines={2} style={{ flex: 1 }}>{t(props.state.ok ? "" : props.state.reason)}</Text> : null}
      </View>
      {tab === "presets" ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[1.5] }}>
          {EASING_PRESETS.map((preset) => <PresetTile key={preset.id} name={t(preset.name)} bezier={preset.bezier} active={active === preset.id} disabled={off} testID={`easing-${preset.id}`} onPress={() => props.onApply(preset.bezier)} />)}
        </View>
      ) : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", gap: space[1.5] }}>
          <Tooltip label={saved.length >= 100 ? t("Preset limit reached (100)") : t("Save")}><Button size="sm" kind="outline" icon="plus" label={t("Save")} testID="easing-save" disabled={off || saved.length >= 100} onPress={save} /></Tooltip>
          {saved.length === 0 ? <Text variant="meta" color="text/secondary" testID="easing-saved-empty">{t("Save a curve to reuse it here")}</Text> : null}
          {saved.map((entry) => renaming?.name === entry.name ? (
            <View key={entry.name} style={{ width: 120 }}><Input accessibilityLabel={t("Preset name")} autoFocus value={renaming.draft} onChangeText={(draft) => setRenaming({ name: entry.name, draft: draft.slice(0, 40) })} onBlur={() => rename(entry.name, renaming.draft)} onSubmitEditing={() => rename(entry.name, renaming.draft)} /></View>
          ) : (
            <View key={entry.name} testID="easing-saved" style={{ alignItems: "center" }}>
              <PresetTile name={entry.name} bezier={entry.bezier} active={current !== null && sameBezier(current, entry.bezier)} disabled={off} testID={`easing-saved-${entry.name}`} onPress={() => props.onApply(entry.bezier)} />
              <View style={{ flexDirection: "row" }}>
                <IconButton icon="pencil" size="xs" label={t("Rename: {name}", { name: entry.name })} onPress={() => setRenaming({ name: entry.name, draft: entry.name })} />
                <IconButton icon="trash" size="xs" label={t("Delete: {name}", { name: entry.name })} onPress={() => setSaved(saved.filter((other) => other.name !== entry.name))} />
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
void bezierProgress;
