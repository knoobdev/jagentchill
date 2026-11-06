import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import Svg, { Circle, Line, Path } from "react-native-svg";
import {
  addColorCurvePoint, addLut, ADJUSTMENT_SECTIONS, adjustmentValue, applyLookToAll, applyLut, autoAdjustValues, BASIC_SLIDERS, COLOR_CURVE, colorCurveAt, colorMatchValues, copyLook, CURVES, hasAdjustmentKeyframes, HSL_BANDS, HSL_LABELS, isAdjustable,
  isDefaultCurve, moveColorCurvePoint, pasteLook, pictureStats, removeColorCurvePoint, resetAdjustments, sectionEnabled, sectionModified, setAdjustment, setBasicValues, setColorCurve, setSectionEnabled, setWheel, timeline, WHEEL_LABELS, WHEELS,
  type AdjustmentSection, type CopiedLook, type CurvePoint2, type PictureStats,
} from "@jagentchill/editor-core";
import { Button, ConfirmDialog, IconButton, Input, Menu, NumberField, Segmented, Slider, Switch, Tap, Text, radius, space, useTheme, type MenuItem } from "@jagentchill/ui";
import { useLibraryImports } from "../../library/hooks";
import { itemFile, type LibraryItem } from "../../library/store";
import { useT } from "../../locale";
import { pickFiles } from "../../platform/store";
import { getPref, setPref } from "../../state";
import { useEditor, useHeldTransport } from "../context";
import { bindPointer, decodePixels, setCursor } from "../dom";
import type { EditorRuntime } from "../runtime";
import { KeyToggle } from "./keys";
import { BUILT_IN_LUTS, builtInLutId } from "./luts";
import { Section } from "./parts";
import { INSPECTOR_PREFS } from "./prefs";

type El = timeline.El;
type Json = Record<string, unknown>;
/** The labels the Adjustment tab takes from the engine's tables, listed for the locale resources. */
const ADJUSTMENT_STRINGS = {
  sliders: ["Exposure", "Brightness", "Contrast", "Saturation", "Vibrance", "Highlights", "Shadows", "Whites", "Blacks", "Temperature", "Tint", "Hue", "Sharpness", "Clarity", "Fade", "Vignette", "Grain"],
  bands: ["Red", "Orange", "Yellow", "Green", "Aqua", "Blue", "Purple", "Magenta"], wheels: ["Shadows (lift)", "Midtones (gamma)", "Highlights (gain)"], curves: ["Master", "Lightness"],
  luts: ["Neutral", "Log to Display", "Soft S-Curve", "Strong S-Curve", "Warm Film", "Cool Film", "Teal & Orange", "High Key", "Day for Night", "Faded Matte", "Vivid", "Display Gamma 2.4"],
  reasons: ["Unsupported LUT size", "File is larger than 32 MiB", "Not a .cube or .3dl file", "LUT limit reached (500)", "Maximum of 16 points"],
};
void ADJUSTMENT_STRINGS;
const SECTION_TITLES: Record<AdjustmentSection, string> = { basic: "Basic", hsl: "HSL", curves: "Curves", wheels: "Colour wheels", lut: "LUT" };
/** Sliders the renderer draws; the others of the Basic section are stored but not yet rendered. */
const RENDERED = new Set(["exposure", "brightness", "contrast", "saturation", "vibrance", "highlights", "shadows", "whites", "blacks", "temperature", "tint", "hue", "fade", "vignette", "sharpness", "clarity", "grain"]);
/** The look copied by "Copy" of this tab, kept for the session. */
let copied: CopiedLook | null = null;

/** Statistics of the frame the preview shows now, read from a still of it. */
export async function frameStats(runtime: EditorRuntime, time = runtime.transport.time): Promise<{ stats: PictureStats; histogram: number[][] } | null> {
  const still = await runtime.engine?.still(time, "png");
  const picture = still ? await decodePixels(still, "image/png", 192) : null;
  if (!picture) return null;
  const histogram = [0, 1, 2, 3].map(() => new Array<number>(64).fill(0));
  for (let index = 0; index + 3 < picture.data.length; index += 4) {
    const [r, g, b] = [picture.data[index], picture.data[index + 1], picture.data[index + 2]];
    histogram[0][Math.min(63, Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b) >> 2)]++; histogram[1][r >> 2]++; histogram[2][g >> 2]++; histogram[3][b >> 2]++;
  }
  return { stats: pictureStats(picture.data), histogram };
}

/** The Adjustment tab: the toolbar and the five sections of `adjustments`, editing every selected clip at once. */
export function AdjustmentTab(props: { elements: El[] }) {
  const t = useT();
  const theme = useTheme();
  const runtime = useEditor();
  const transport = useHeldTransport();
  const { controller } = runtime, elements = props.elements.filter(isAdjustable), first = elements[0], ids = elements.map((element) => element.id);
  const [confirm, setConfirm] = useState(false);
  const [presetMenu, setPresetMenu] = useState(false);
  const [naming, setNaming] = useState<string | null>(null);
  const [, bump] = useState(0);
  const presetRef = useRef<View>(null);
  const playhead = transport.time, tool = runtime.tool;
  // Compare is a view of this selection: it ends with it.
  const key = ids.join("|");
  useEffect(() => () => { if (runtime.tool.compare !== "off") runtime.setTool({ compare: "off" }); }, [key, runtime]);
  if (!first) return null;
  const run = (change: Parameters<typeof controller.external>[0], live = false) => controller.external(change, live);
  const modified = ADJUSTMENT_SECTIONS.some((section) => elements.some((element) => sectionModified(element, section)));
  const resetAll = () => run((doc, ctx) => resetAdjustments(doc, ctx, ids));
  const auto = async () => { const frame = await frameStats(runtime); if (frame) run((doc, ctx) => setBasicValues(doc, ctx, ids, autoAdjustValues(frame.stats), "Auto adjust", { autoStrength: 100 })); };
  /** Matches this clip to the clip before it on its track: both frames are read at their own first second. */
  const match = async () => {
    const located = timeline.locate(controller.stored, first.id), before = located?.track.elements.filter((element) => element.startTime < first.startTime && isAdjustable(element)).at(-1);
    if (!before) { runtime.host.message?.(t("Colour match needs a clip before this one on its track")); return; }
    const time = runtime.transport.time, reference = await frameStats(runtime, before.startTime + Math.min(before.duration - 1, 60_000)), target = await frameStats(runtime, first.startTime + Math.min(first.duration - 1, 60_000));
    void runtime.engine?.seek(time, "exact");
    if (reference && target) run((doc, ctx) => setBasicValues(doc, ctx, [first.id], colorMatchValues(target.stats, reference.stats), "Colour match"));
  };
  const presets = getPref(ADJUSTMENT_PRESETS);
  const savePreset = (name: string) => {
    const clean = name.trim().slice(0, 60);
    if (!clean) return;
    if (presets.length >= 200) { runtime.host.message?.(t("Preset limit reached (200)")); return; }
    let unique = clean, suffix = 2;
    while (presets.some((preset) => preset.name === unique)) unique = `${clean} (${suffix++})`;
    setPref(ADJUSTMENT_PRESETS, [...presets, { name: unique, adjustments: (first.adjustments ?? {}) as Json }].sort((a, b) => a.name.localeCompare(b.name)));
    bump((value) => value + 1);
  };
  const presetItems: MenuItem[] = [
    { id: "save", label: t("Save current as preset…"), icon: "plus", disabled: !modified, onSelect: () => setNaming(t("Preset {n}", { n: presets.length + 1 })) },
    ...(presets.length > 0 ? [{ type: "separator" } as MenuItem] : []),
    ...presets.map((preset): MenuItem => ({ id: `p-${preset.name}`, label: preset.name, submenu: [
      { id: "apply", label: t("Apply"), onSelect: () => run((doc, ctx) => pasteLook(doc, ctx, ids, { adjustments: preset.adjustments, animations: {} }, "Apply preset")) },
      { id: "delete", label: t("Delete"), danger: true, onSelect: () => { setPref(ADJUSTMENT_PRESETS, presets.filter((entry) => entry.name !== preset.name)); bump((value) => value + 1); } },
    ] })),
  ];
  const action = (id: string, label: string, onPress: () => void, options: { disabled?: boolean; on?: boolean } = {}) => <Button key={id} kind={options.on ? "secondary" : "ghost"} size="xs" label={label} pressed={options.on} disabled={options.disabled} testID={`adjust-${id}`} onPress={onPress} />;
  return (
    <View testID="adjustment-tab">
      <View role="toolbar" aria-label={t("Adjustment")} style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[0.5], paddingHorizontal: space[2], paddingVertical: space[1] }}>
        {action("auto", t("Auto adjust"), () => void auto())}
        {action("compare", t("Compare"), () => runtime.setTool({ compare: tool.compare === "split" ? "off" : "split" }), { on: tool.compare === "split" })}
        {action("copy", t("Copy"), () => { copied = copyLook(first); bump((value) => value + 1); })}
        {action("paste", t("Paste"), () => run((doc, ctx) => pasteLook(doc, ctx, ids, copied!)), { disabled: copied === null })}
        <View ref={presetRef}>{action("presets", t("Presets"), () => setPresetMenu(true))}</View>
        {action("match", t("Colour match"), () => void match(), { disabled: elements.length !== 1 })}
        {action("apply-all", t("Apply to all"), () => { let count = 0; if (run((doc, ctx) => { const made = applyLookToAll(doc, ctx, first.id); count = made.count; return made.commit; })) runtime.host.message?.(t("Applied to {n} clips", { n: count })); }, { disabled: elements.length !== 1 || !modified })}
        {action("reset-all", t("Reset all"), () => (elements.some(hasAdjustmentKeyframes) ? setConfirm(true) : resetAll()), { disabled: !modified })}
        <Menu open={presetMenu} anchor={presetRef} items={presetItems} label={t("Presets")} onClose={() => setPresetMenu(false)} />
      </View>
      {naming !== null ? (
        <View style={{ flexDirection: "row", gap: space[1.5], paddingHorizontal: space[3], paddingBottom: space[2] }}>
          <View style={{ flex: 1 }}><Input accessibilityLabel={t("Preset name")} value={naming} onChangeText={(text) => setNaming(text.slice(0, 60))} onSubmitEditing={() => { savePreset(naming); setNaming(null); }} /></View>
          <Button size="sm" kind="primary" label={t("Save")} testID="adjust-preset-save" onPress={() => { savePreset(naming); setNaming(null); }} /><Button size="sm" label={t("Cancel")} onPress={() => setNaming(null)} />
        </View>
      ) : null}
      {ADJUSTMENT_SECTIONS.map((section) => {
        const changed = elements.some((element) => sectionModified(element, section)), enabled = elements.every((element) => sectionEnabled(element, section));
        return (
          <Section key={section} id={`adjust.${section}`} title={t(SECTION_TITLES[section])} testID={`adjust-section-${section}`} enabled={enabled}
            trailing={<>{changed ? <View testID={`adjust-dot-${section}`} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: theme.color("accent") }} /> : null}
              <IconButton icon="rotate" size="xs" label={t("Reset {name}", { name: t(SECTION_TITLES[section]) })} testID={`adjust-reset-${section}`} disabled={!changed} onPress={() => run((doc, ctx) => resetAdjustments(doc, ctx, ids, section))} /></>}
            onToggle={(on) => run((doc, ctx) => setSectionEnabled(doc, ctx, ids, section, on))}>
            {section === "basic" ? <BasicSection elements={elements} playhead={playhead} /> : null}
            {section === "hsl" ? <HslSection elements={elements} playhead={playhead} /> : null}
            {section === "curves" ? <CurvesSection elements={elements} /> : null}
            {section === "wheels" ? <WheelsSection elements={elements} playhead={playhead} /> : null}
            {section === "lut" ? <LutSection elements={elements} playhead={playhead} /> : null}
          </Section>
        );
      })}
      <ConfirmDialog open={confirm} title={t("Reset all adjustments?")} description={t("Their keyframes are removed too.")} confirmLabel={t("Reset all")} onClose={() => setConfirm(false)} onConfirm={() => { setConfirm(false); resetAll(); }} />
    </View>
  );
}
const ADJUSTMENT_PRESETS = INSPECTOR_PREFS.adjustmentPresets;

/** The value all selected clips share at the playhead, or `null` when they differ ("Mixed"). */
function shared(elements: El[], path: string, playhead: number): number | null {
  const values = elements.map((element) => Number(adjustmentValue(element, path, Math.min(element.duration, Math.max(0, playhead - element.startTime)))));
  return values.every((value) => Math.abs(value - values[0]) < 1e-9) ? values[0] : null;
}
/** One slider row: label, track with a centre detent for a bipolar range, the value, and the keyframe toggle. */
function AdjustSlider(props: { elements: El[]; path: string; label: string; min: number; max: number; playhead: number; testID: string; rest?: number }) {
  const t = useT();
  const runtime = useEditor();
  const { elements, path } = props, ids = elements.map((element) => element.id), value = shared(elements, path, props.playhead), bipolar = props.min < 0;
  const write = (next: number, live: boolean) => {
    // A bipolar slider rests on 0 within ±2 of it.
    const snapped = live && bipolar && Math.abs(next) <= 2 ? 0 : Math.round(next);
    runtime.controller.external((doc, ctx) => setAdjustment(doc, ctx, ids, path, Math.min(props.max, Math.max(props.min, snapped)), props.playhead, props.label), live);
  };
  return (
    <View testID={props.testID} style={{ flexDirection: "row", alignItems: "center", gap: space[1.5], minHeight: 26 }}>
      <Tap label={t("Reset {name}", { name: t(props.label) })} onDoublePress={() => write(props.rest ?? 0, false)} style={{ width: 76 }}><Text variant="meta" color="text/secondary" numberOfLines={1}>{t(props.label)}</Text></Tap>
      <View style={{ flex: 1, minWidth: 40 }}><Slider label={t(props.label)} min={props.min} max={props.max} step={1} centre={bipolar} defaultValue={props.rest ?? 0} value={value ?? props.rest ?? 0} onChange={(next) => write(next as number, true)} onCommit={(next) => write(next as number, false)} /></View>
      <View testID={`${props.testID}-value`}><NumberField label={t(props.label)} hideLabel size="xs" width={52} min={props.min} max={props.max} step={1} value={value === null ? null : Math.round(value)} onCommit={(next) => write(next, false)} /></View>
      {elements.length === 1 ? <KeyToggle element={elements[0]} path={path} value={value ?? 0} label={t(props.label)} playhead={props.playhead} /> : <View style={{ width: 20 }} />}
    </View>
  );
}
function BasicSection(props: { elements: El[]; playhead: number }) {
  return <>{BASIC_SLIDERS.filter((slider) => RENDERED.has(slider.key)).map((slider) => <AdjustSlider key={slider.key} elements={props.elements} path={`adjustments.basic.${slider.key}`} label={slider.label} min={slider.min} max={slider.max} playhead={props.playhead} testID={`adjust-${slider.key}`} />)}</>;
}

/** The token that draws a band, a curve channel or a wheel: chart colours stand for the hues. */
const BAND_TOKEN = { red: "danger", orange: "chart/3", yellow: "chart/7", green: "chart/5", aqua: "chart/2", blue: "chart/1", purple: "chart/4", magenta: "chart/6" } as const;
function HslSection(props: { elements: El[]; playhead: number }) {
  const t = useT();
  const theme = useTheme();
  const [band, setBand] = useState<(typeof HSL_BANDS)[number]>("red");
  return (
    <>
      <View role="radiogroup" aria-label={t("Colour band")} style={{ flexDirection: "row", gap: space[1.5], paddingVertical: space[1] }}>
        {HSL_BANDS.map((name) => <Tap key={name} role="radio" label={t(HSL_LABELS[name])} checked={band === name} tooltip={{ label: t(HSL_LABELS[name]) }} testID={`adjust-band-${name}`} onPress={() => setBand(name)}
          style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: theme.color(band === name ? "text/primary" : "border/hairline"), backgroundColor: theme.color(BAND_TOKEN[name]) }} />)}
      </View>
      {(["hue", "saturation", "lightness"] as const).map((key) => <AdjustSlider key={`${band}.${key}`} elements={props.elements} path={`adjustments.hsl.${band}.${key}`} label={key === "hue" ? "Hue" : key === "saturation" ? "Saturation" : "Lightness"} min={-100} max={100} playhead={props.playhead} testID={`adjust-hsl-${key}`} />)}
    </>
  );
}

const GRAPH = 240;
const CHANNEL_TOKEN = { master: "text/primary", red: "danger", green: "chart/5", blue: "chart/1" } as const;
const CHANNEL_NAME = { master: "Master", red: "Red", green: "Green", blue: "Blue" } as const;
/** The four curves: a square graph with the picture's histogram behind it; click adds a point, drag moves it, dragging it out removes it. */
function CurvesSection(props: { elements: El[] }) {
  const t = useT();
  const theme = useTheme();
  const runtime = useEditor();
  const transport = useHeldTransport();
  const [channel, setChannel] = useState<(typeof CURVES)[number]>("master");
  const [chosen, setChosen] = useState<number | null>(null);
  const [draft, setDraft] = useState<CurvePoint2[] | null>(null);
  const [histogram, setHistogram] = useState<number[][] | null>(null);
  const first = props.elements[0], ids = props.elements.map((element) => element.id);
  const stored = (channelId: string): CurvePoint2[] => (((first.adjustments as Json | undefined)?.curves as Json | undefined)?.[channelId] as CurvePoint2[] | undefined) ?? [{ x: 0, y: 0 }, { x: 1, y: 1 }];
  const points = draft ?? stored(channel);
  const node = useRef<View>(null), live = useRef({ points, channel });
  live.current = { points: stored(channel), channel };
  const write = (next: CurvePoint2[]) => runtime.controller.external((doc, ctx) => setColorCurve(doc, ctx, ids, live.current.channel, next));
  const preview = (next: CurvePoint2[]) => { setDraft(next); runtime.controller.external((doc, ctx) => setColorCurve(doc, ctx, ids, live.current.channel, next), true); };
  // The histogram is read from the paused frame, a moment after it settles.
  const playing = transport.playing, time = transport.time, revision = runtime.controller.version;
  useEffect(() => {
    if (playing) return;
    let stale = false;
    const timer = setTimeout(() => { void frameStats(runtime, time).then((frame) => { if (!stale && frame) setHistogram(frame.histogram); }); }, 250);
    return () => { stale = true; clearTimeout(timer); };
  }, [runtime, playing, time, revision]);
  useEffect(() => bindPointer(node.current, {
    hover(info) {
      const state = live.current;
      const hit = !!info && state.points.some((point) => Math.hypot(point.x * GRAPH - info.x, (1 - point.y) * GRAPH - info.y) <= 9);
      setCursor(node.current, hit ? "grab" : "default");
    },
    down(info) {
      const current = live.current.points, x = info.x / GRAPH, y = 1 - info.y / GRAPH;
      let at = current.findIndex((point) => Math.hypot((point.x - x) * GRAPH, (point.y - y) * GRAPH) <= 9), from = current;
      if (at < 0) {
        const added = addColorCurvePoint(current, x);
        if (!added) { if (current.length >= COLOR_CURVE.maxPoints) runtime.host.message?.("Maximum of 16 points"); return null; }
        from = added.points; at = added.index;
      }
      setChosen(at);
      const index = at;
      const moved = (pointer: { x: number; y: number }) => {
        // Dragged more than 24 px out of the graph, an interior point is removed.
        const out = Math.max(-pointer.x, pointer.x - GRAPH, -pointer.y, pointer.y - GRAPH) > COLOR_CURVE.removeDistance;
        return out && index > 0 && index < from.length - 1 ? removeColorCurvePoint(from, index) : moveColorCurvePoint(from, index, { x: pointer.x / GRAPH, y: 1 - pointer.y / GRAPH });
      };
      preview(from);
      return {
        move: (pointer) => preview(moved(pointer)),
        up: (pointer) => { const next = moved(pointer); setDraft(null); runtime.controller.discardPreview(); write(next); if (next.length < from.length) setChosen(null); },
        cancel: () => { setDraft(null); runtime.controller.discardPreview(); },
      };
    },
    double(info) { const current = live.current.points, x = info.x / GRAPH, y = 1 - info.y / GRAPH, at = current.findIndex((point) => Math.hypot((point.x - x) * GRAPH, (point.y - y) * GRAPH) <= 9); if (at > 0 && at < current.length - 1) { write(removeColorCurvePoint(current, at)); setChosen(null); } },
  }), [runtime]); // eslint-disable-line react-hooks/exhaustive-deps
  const key = (event: { key: string; shiftKey?: boolean; preventDefault(): void }) => {
    if (chosen === null || !points[chosen]) return;
    const step = event.shiftKey ? COLOR_CURVE.bigNudge : COLOR_CURVE.nudge, point = points[chosen];
    const delta = { ArrowUp: [0, step], ArrowDown: [0, -step], ArrowLeft: [-step, 0], ArrowRight: [step, 0] }[event.key];
    if (delta) { event.preventDefault(); write(moveColorCurvePoint(points, chosen, { x: point.x + delta[0], y: point.y + delta[1] })); }
    else if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); write(removeColorCurvePoint(points, chosen)); setChosen(null); }
  };
  const path = Array.from({ length: 97 }, (_, index) => `${index === 0 ? "M" : "L"}${((index / 96) * GRAPH).toFixed(1)} ${((1 - colorCurveAt(points, index / 96)) * GRAPH).toFixed(1)}`).join(" ");
  const bins = histogram?.[CURVES.indexOf(channel)] ?? null, peak = bins ? Math.max(1, ...bins.slice(1, 63)) : 1;
  const area = bins ? `M0 ${GRAPH} ${bins.map((count, index) => `L${((index / 63) * GRAPH).toFixed(1)} ${(GRAPH - Math.min(1, count / peak) * GRAPH * 0.6).toFixed(1)}`).join(" ")} L${GRAPH} ${GRAPH} Z` : null;
  const selected = chosen !== null ? points[chosen] : null;
  return (
    <View style={{ gap: space[2] }}>
      <Segmented label={t("Curve channel")} size="xs" block value={channel} onChange={(next) => { setChannel(next); setChosen(null); }} options={CURVES.map((name) => ({ value: name, label: t(CHANNEL_NAME[name]) }))} />
      <View ref={node} testID="adjust-curve" tabIndex={0} role="group" accessibilityLabel={t("Curves")} {...({ onKeyDown: key } as object)} style={{ width: GRAPH, height: GRAPH, alignSelf: "center", borderWidth: 1, borderColor: theme.color("border/hairline"), backgroundColor: theme.color("bg/subtle"), outlineWidth: 0 } as object}>
        <Svg width={GRAPH} height={GRAPH}>
          {area ? <Path d={area} fill={theme.color("border/strong")} opacity={0.45} /> : null}
          {[0.25, 0.5, 0.75].map((at) => <Line key={`v${at}`} x1={at * GRAPH} x2={at * GRAPH} y1={0} y2={GRAPH} stroke={theme.color("border/hairline")} strokeWidth={1} />)}
          {[0.25, 0.5, 0.75].map((at) => <Line key={`h${at}`} y1={at * GRAPH} y2={at * GRAPH} x1={0} x2={GRAPH} stroke={theme.color("border/hairline")} strokeWidth={1} />)}
          <Line x1={0} y1={GRAPH} x2={GRAPH} y2={0} stroke={theme.color("border/strong")} strokeWidth={1} strokeDasharray="3 3" />
          <Path d={path} stroke={theme.color(CHANNEL_TOKEN[channel])} strokeWidth={1.5} fill="none" />
          {points.map((point, index) => <Circle key={index} cx={Math.min(GRAPH - 4, Math.max(4, point.x * GRAPH))} cy={Math.min(GRAPH - 4, Math.max(4, (1 - point.y) * GRAPH))} r={chosen === index ? 5 : 4} fill={theme.color(chosen === index ? "accent" : "bg/app")} stroke={theme.color("text/primary")} strokeWidth={1.25} />)}
        </Svg>
      </View>
      <View style={{ flexDirection: "row", gap: space[1.5] }}>
        <View style={{ flex: 1 }} testID="adjust-curve-in"><NumberField label={t("In")} size="sm" min={0} max={1} step={0.01} value={selected ? Math.round(selected.x * 100) / 100 : null} disabled={!selected} onCommit={(x) => selected && write(moveColorCurvePoint(points, chosen!, { x, y: selected.y }))} /></View>
        <View style={{ flex: 1 }} testID="adjust-curve-out"><NumberField label={t("Out")} size="sm" min={0} max={1} step={0.01} value={selected ? Math.round(selected.y * 100) / 100 : null} disabled={!selected} onCommit={(y) => selected && write(moveColorCurvePoint(points, chosen!, { x: selected.x, y }))} /></View>
      </View>
      <Text variant="meta" color="text/secondary" testID="adjust-curve-count">{t("{n} of 16 points. Click the curve to add a point; drag out of the graph or press Delete to remove it. Arrow keys nudge by 0.004.", { n: points.length })}</Text>
      <View style={{ flexDirection: "row", justifyContent: "flex-end" }}><Button size="sm" kind="outline" label={t("Reset {name}", { name: t(CHANNEL_NAME[channel]) })} testID="adjust-curve-reset" disabled={isDefaultCurve(stored(channel))} onPress={() => { write([{ x: 0, y: 0 }, { x: 1, y: 1 }]); setChosen(null); }} /></View>
      <Text variant="meta" color="text/secondary">{t("Channels")}</Text>
      {CURVES.map((name) => (
        <Tap key={name} role="button" label={t(CHANNEL_NAME[name])} onPress={() => { setChannel(name); setChosen(null); }} style={{ flexDirection: "row", alignItems: "center", gap: space[2], height: 24 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.color(CHANNEL_TOKEN[name]) }} /><Text style={{ flex: 1 }}>{t(CHANNEL_NAME[name])}</Text>
          <Text variant="meta" color="text/secondary">{isDefaultCurve(stored(name)) ? t("default") : t("{n} points", { n: stored(name).length })}</Text>
        </Tap>
      ))}
    </View>
  );
}

const WHEEL = 96;
/** The hue disc of a wheel: red at the right, green at the upper left, blue at the lower left, fading to neutral at the centre. */
// content-colour: the disc shows the hues themselves, not a colour of the interface.
const DISC: object = { backgroundImage: "radial-gradient(circle closest-side, hsl(0 0% 100%), hsl(0 0% 100% / 0)), conic-gradient(from 90deg, hsl(0 100% 50%), hsl(300 100% 50%), hsl(240 100% 50%), hsl(180 100% 50%), hsl(120 100% 50%), hsl(60 100% 50%), hsl(0 100% 50%))" };
/** Three wheels — Shadows, Midtones, Highlights — each with a puck inside the disc and a luminance slider. */
function WheelsSection(props: { elements: El[]; playhead: number }) {
  return <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-around", gap: space[2] }}>{WHEELS.map((wheel) => <Wheel key={wheel} wheel={wheel} elements={props.elements} playhead={props.playhead} />)}</View>;
}
function Wheel(props: { wheel: (typeof WHEELS)[number]; elements: El[]; playhead: number }) {
  const t = useT();
  const theme = useTheme();
  const runtime = useEditor();
  const { wheel, elements } = props, ids = elements.map((element) => element.id), base = `adjustments.wheels.${wheel}`;
  const x = shared(elements, `${base}.x`, props.playhead) ?? 0, y = shared(elements, `${base}.y`, props.playhead) ?? 0, luminance = shared(elements, `${base}.luminance`, props.playhead);
  const node = useRef<View>(null), live = useRef({ x, y, playhead: props.playhead, ids });
  live.current = { x, y, playhead: props.playhead, ids };
  useEffect(() => bindPointer(node.current, {
    hover(info) {
      const state = live.current;
      const hit = !!info && Math.hypot(WHEEL / 2 + state.x * (WHEEL / 2) - info.x, WHEEL / 2 - state.y * (WHEEL / 2) - info.y) <= 9;
      setCursor(node.current, hit ? "grab" : "default");
    },
    down(info) {
      const start = { ...live.current }, origin = { x: info.x, y: info.y };
      // The puck follows the pointer from where it is; with Shift at a quarter of the speed.
      const at = (pointer: { x: number; y: number; shift: boolean }) => { const scale = (pointer.shift ? 0.25 : 1) / (WHEEL / 2); return { x: start.x + (pointer.x - origin.x) * scale, y: start.y - (pointer.y - origin.y) * scale }; };
      const write = (pointer: { x: number; y: number; shift: boolean }, isLive: boolean) => runtime.controller.external((doc, ctx) => setWheel(doc, ctx, start.ids, wheel, at(pointer), start.playhead), isLive);
      if (info.detail >= 2) { runtime.controller.external((doc, ctx) => setWheel(doc, ctx, start.ids, wheel, { x: 0, y: 0, luminance: 0 }, start.playhead)); return null; }
      return { move: (pointer) => { write(pointer, true); }, up: (pointer) => { runtime.controller.discardPreview(); if (pointer.x !== origin.x || pointer.y !== origin.y) write(pointer, false); }, cancel: () => runtime.controller.discardPreview() };
    },
  }), [runtime, wheel]);
  return (
    <View testID={`adjust-wheel-${wheel}`} style={{ width: WHEEL + 8, alignItems: "center", gap: space[1] }}>
      <View ref={node} testID={`adjust-wheel-${wheel}-disc`} role="img" accessibilityLabel={t(WHEEL_LABELS[wheel])} style={[{ width: WHEEL, height: WHEEL, borderRadius: WHEEL / 2, borderWidth: 1, borderColor: theme.color("border/control") }, DISC]}>
        <View pointerEvents="none" style={{ position: "absolute", left: WHEEL / 2, top: 0, bottom: 0, width: 1, backgroundColor: theme.color("border/strong"), opacity: 0.4 }} />
        <View pointerEvents="none" style={{ position: "absolute", top: WHEEL / 2, left: 0, right: 0, height: 1, backgroundColor: theme.color("border/strong"), opacity: 0.4 }} />
        <View pointerEvents="none" testID={`adjust-wheel-${wheel}-puck`} style={{ position: "absolute", left: WHEEL / 2 + x * (WHEEL / 2) - 5, top: WHEEL / 2 - y * (WHEEL / 2) - 5, width: 10, height: 10, borderRadius: 5, borderWidth: 1.5, borderColor: theme.color("text/primary"), backgroundColor: theme.color("bg/app") }} />
      </View>
      <View style={{ alignSelf: "stretch", flexDirection: "row", alignItems: "center", gap: space[1] }}>
        <View style={{ flex: 1 }}><Slider label={t("{name} luminance", { name: t(WHEEL_LABELS[wheel]) })} min={-100} max={100} step={1} centre defaultValue={0} value={luminance ?? 0}
          onChange={(next) => runtime.controller.external((doc, ctx) => setWheel(doc, ctx, ids, wheel, { luminance: next as number }, props.playhead), true)} onCommit={(next) => runtime.controller.external((doc, ctx) => setWheel(doc, ctx, ids, wheel, { luminance: next as number }, props.playhead))} /></View>
        <Text variant="caption" tabular style={{ width: 26, textAlign: "right" }}>{luminance === null ? "—" : `${luminance > 0 ? "+" : ""}${Math.round(luminance)}`}</Text>
      </View>
      <Text variant="meta" numberOfLines={1}>{t(WHEEL_LABELS[wheel])}</Text>
    </View>
  );
}

/** Imports LUT files into the project and reports each file that could not be read. */
export async function importLuts(runtime: EditorRuntime, t: (text: string, values?: Record<string, string | number>) => string, files: File[]): Promise<string[]> {
  const added: string[] = [];
  for (const file of files) {
    const result = await runtime.luts?.importFile(file);
    if (!result) continue;
    if (!result.ok) { runtime.host.message?.(`${result.name}: ${t(result.reason.startsWith("Malformed line") ? "Malformed line {n}" : result.reason, { n: result.reason.replace(/\D+/g, "") })}`); continue; }
    runtime.controller.external((doc, ctx) => addLut(doc, ctx, result.lut));
    added.push(result.lutId);
  }
  if (added.length > 0) runtime.refreshLuts();
  return added;
}
/** The LUT of the selection: built-in and imported tables, the import button, and the intensity. */
function LutSection(props: { elements: El[]; playhead: number }) {
  const t = useT();
  const theme = useTheme();
  const runtime = useEditor();
  const ids = props.elements.map((element) => element.id), first = props.elements[0];
  const current = ((first.adjustments as Json | undefined)?.lut as { lutId?: string } | undefined)?.lutId ?? null;
  const user = ((runtime.controller.document.media as { luts?: { id: string; name: string }[] }).luts ?? []);
  const apply = (lutId: string | null) => { runtime.controller.external((doc, ctx) => applyLut(doc, ctx, ids, lutId)); runtime.refreshLuts(); };
  // The LUTs imported in the Library of this device that the project does not hold yet: choosing one brings its table into the project.
  const library = useLibraryImports("luts");
  const shelved = library.items.filter((item) => !user.some((lut) => lut.id === item.id));
  const applyShelved = async (item: LibraryItem) => { const file = library.storage ? await itemFile(library.storage, item) : null; if (!file) { runtime.host.message?.(`${item.name}: ${t("Not a .cube or .3dl file")}`); return; } const added = await importLuts(runtime, t, [file]); if (added[0]) apply(added[0]); };
  const row = (id: string | null, name: string, kind: string) => (
    <Tap key={id ?? "none"} role="radio" label={name} checked={current === id} testID={`lut-${id ?? "none"}`} onPress={() => apply(id)}
      style={(state) => ({ flexDirection: "row", alignItems: "center", height: 26, paddingHorizontal: space[1.5], borderRadius: radius.sm, backgroundColor: current === id ? theme.color("accent/subtle") : state.hovered ? theme.color("bg/hover") : "transparent" })}>
      <Text style={{ flex: 1 }} numberOfLines={1}>{name}</Text><Text variant="meta" color="text/secondary">{kind}</Text>
    </Tap>
  );
  return (
    <View style={{ gap: space[1] }}>
      <View style={{ flexDirection: "row", alignItems: "center" }}><Text variant="meta" color="text/secondary" style={{ flex: 1 }}>{t("LUT")}</Text><Button size="xs" kind="outline" label={t("Import .cube / .3dl")} testID="lut-import" onPress={() => void pickFiles(".cube,.3dl", true).then(async (files) => { const added = await importLuts(runtime, t, files); if (added[0]) apply(added[0]); })} /></View>
      <View role="radiogroup" aria-label={t("LUT")}>
        {row(null, t("None"), "")}
        {user.map((lut) => row(lut.id, lut.name, t("Imported")))}
        {shelved.map((item) => (
          <Tap key={item.id} role="radio" label={item.name} checked={false} testID={`lut-library-${item.id}`} onPress={() => void applyShelved(item)}
            style={(state) => ({ flexDirection: "row", alignItems: "center", height: 26, paddingHorizontal: space[1.5], borderRadius: radius.sm, backgroundColor: state.hovered ? theme.color("bg/hover") : "transparent" })}>
            <Text style={{ flex: 1 }} numberOfLines={1}>{item.name}</Text><Text variant="meta" color="text/secondary">{t("Library")}</Text>
          </Tap>
        ))}
        {BUILT_IN_LUTS.map((lut) => row(builtInLutId(lut.id), t(lut.name), t("Built-in")))}
      </View>
      <AdjustSlider elements={props.elements} path="adjustments.lut.intensity" label="Intensity" min={0} max={100} rest={100} playhead={props.playhead} testID="adjust-lut-intensity" />
    </View>
  );
}
