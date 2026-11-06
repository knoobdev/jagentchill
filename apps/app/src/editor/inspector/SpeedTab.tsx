import { useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import Svg, { Circle, Line, Path } from "react-native-svg";
import { curveRateAt, pitchPreservation, retimeClipOf, retimedDuration, timeline, type CurvePoint } from "@jagentchill/editor-core";
import { TICKS_PER_SECOND, type Rational } from "@jagentchill/protocol";
import { Button, ConfirmDialog, IconButton, NumberField, Select, Slider, Switch, Tabs, Tap, Text, Tooltip, radius, space, useTheme } from "@jagentchill/ui";
import { useT } from "../../locale";
import { usePref } from "../../state";
import { EDITOR_PREFS, formatSeconds } from "@jagentchill/app-core";
import { useEditor, useHeldTransport } from "../context";
import { bindPointer, setCursor, type KeyInfo } from "../dom";
import { Note, Row } from "./parts";

type El = timeline.El;
/** The names the Speed tab shows from the engine's tables, listed for the locale resources. */
const SPEED_STRINGS = { tiles: ["None", "Custom", "Montage", "Hero", "Bullet", "Jump Cut", "Flash In", "Flash Out"], patterns: ["Slow–fast", "Fast–slow", "Pulse"], steps: ["Every beat", "Every 2 beats", "Every 4 beats"] };
void SPEED_STRINGS;
const seconds = (ticks: number): string => formatSeconds(Math.round((ticks / TICKS_PER_SECOND) * 10) / 10);
const LOG_MIN = Math.log10(0.1), LOG_SPAN = Math.log10(10) - LOG_MIN;
/** Rate ↔ height on the logarithmic axis of the curve graph (0.1× at the bottom, 10× at the top). */
const rateToY = (rate: number, height: number): number => height - ((Math.log10(Math.min(10, Math.max(0.1, rate))) - LOG_MIN) / LOG_SPAN) * height;
const yToRate = (y: number, height: number): number => 10 ** (LOG_MIN + ((height - y) / height) * LOG_SPAN);
const curvePath = (points: CurvePoint[], width: number, height: number, inset = 0): string =>
  Array.from({ length: 65 }, (_, index) => { const u = index / 64; return `${index === 0 ? "M" : "L"}${(inset + u * (width - inset * 2)).toFixed(1)} ${rateToY(curveRateAt(points, u), height).toFixed(1)}`; }).join(" ");

/** The Speed tab of a retimable clip: Normal (constant speed, duration, reverse), Curve (presets and the curve editor) and Velocity (a curve from beat markers). */
export function SpeedTab(props: { elements: El[] }) {
  const t = useT();
  const runtime = useEditor();
  const { controller } = runtime, sceneId = controller.session.sceneId;
  const [tabs, setTabs] = usePref(EDITOR_PREFS.inspectorTabs);
  const [confirm, setConfirm] = useState<number | null>(null);
  const elements = props.elements, first = elements[0], single = elements.length === 1;
  const compound = first.type === "compound";
  const wanted = tabs["speed.sub"] ?? "normal", active = !single || compound ? "normal" : wanted;
  const ids = elements.map((element) => element.id);
  /** One speed change of the selection: a refusal says why, a caption remap is reported. */
  const change = (edit: timeline.SpeedChange, live = false) => {
    const command = timeline.setSpeed({ sceneId, elementIds: ids, change: edit });
    const result = live ? controller.preview(command) : controller.run(command);
    if (!live && result.ok && result.info) {
      if (result.info.captionsRetimed > 0) runtime.host.message?.(t("{n} captions retimed", { n: result.info.captionsRetimed }));
      if (result.info.captionsLocked > 0) runtime.host.message?.(t("{n} captions not retimed (track locked)", { n: result.info.captionsLocked }));
    }
    return result.ok;
  };
  const setRate = (rate: number) => { if (elements.some((element) => timeline.speedCurveOf(element))) setConfirm(rate); else change({ rate: timeline.clampRate(rate) }); };
  const reason = !single ? t("Select a single clip") : compound ? t("Not available for compound clips") : null;
  return (
    <View testID="speed-tab" style={{ paddingHorizontal: space[3], paddingTop: space[2], gap: space[2] }}>
      <Tabs id="speed" variant="pill" size="xs" label={t("Speed")} value={active} onChange={(id) => { if (id !== "normal" && reason) { runtime.host.message?.(reason); return; } setTabs({ ...tabs, "speed.sub": id }); }}
        items={[{ id: "normal", label: t("Normal") }, { id: "curve", label: t("Curve"), disabled: reason !== null }, { id: "velocity", label: t("Velocity"), disabled: reason !== null }]} />
      {reason && wanted !== "normal" ? <Note testID="speed-note">{reason}</Note> : null}
      {active === "normal" ? <NormalTab elements={elements} setRate={setRate} change={change} /> : null}
      {active === "curve" && single ? <CurveTab element={first} change={change} /> : null}
      {active === "velocity" && single ? <VelocityTab element={first} change={change} /> : null}
      {timeline.hasInvalidCurve(first) ? <Note tone="warning" testID="speed-invalid-curve">{t("This speed curve was invalid and has been reset")}</Note> : null}
      <ConfirmDialog open={confirm !== null} title={t("Replace the speed curve with a constant speed?")} confirmLabel={t("Replace")} onClose={() => setConfirm(null)} onConfirm={() => { const rate = confirm!; setConfirm(null); change({ rate: timeline.clampRate(rate), curve: null }); }} />
    </View>
  );
}

type Change = (edit: timeline.SpeedChange, live?: boolean) => boolean;
/** Constant speed on a logarithmic slider with its stops, the Duration field linked to it, and Reverse. */
function NormalTab(props: { elements: El[]; setRate(rate: number): void; change: Change }) {
  const t = useT();
  const theme = useTheme();
  const runtime = useEditor();
  const fps = runtime.fps(), first = props.elements[0];
  const rates = props.elements.map(timeline.effectiveRate), same = rates.every((rate) => Math.abs(rate - rates[0]) < 1e-6);
  const rate = same ? rates[0] : null, span = timeline.sourceSpanOf(first), reversed = props.elements.every((element) => (element.retime as { reverse?: boolean } | undefined)?.reverse === true);
  // Keep pitch belongs to clips that sound; the note says when the speed, or the speed with the pitch shift, leaves what a stretch can do.
  const audible = props.elements.filter((element) => timeline.isAudioCapable(runtime.controller.document, element) && !timeline.isFreeze(element));
  const keepPitch = audible.length > 0 && audible.every((element) => (element.retime as { maintainPitch?: boolean } | undefined)?.maintainPitch === true);
  const dropped = audible.some((element) => pitchPreservation(element as never, retimeClipOf(element as never)).dropped);
  const WIDTH = 220;
  const fromSlider = (position: number, free: boolean) => timeline.clampRate(timeline.snapSlider(position / 1000, WIDTH, free));
  return (
    <View style={{ gap: space[2] }}>
      <Row label={t("Speed")}>
        <View style={{ flex: 1 }} testID="speed-slider">
          <Slider label={t("Speed")} min={0} max={1000} step={1} value={Math.round(timeline.rateToSlider(rate ?? 1) * 1000)} defaultValue={Math.round(timeline.rateToSlider(1) * 1000)} formatValue={(position) => `${timeline.clampRate(timeline.sliderToRate(position / 1000))}x`}
            onChange={(position) => { props.change({ rate: fromSlider(position as number, false) }, true); }} onCommit={(position) => { runtime.controller.discardPreview(); props.setRate(fromSlider(position as number, false)); }} />
        </View>
        <View testID="speed-field"><NumberField label={t("Speed")} hideLabel size="sm" width={76} unit="x" min={0.01} max={1000} step={0.01} value={rate === null ? null : Math.round(rate * 100) / 100} onCommit={props.setRate} /></View>
      </Row>
      <View style={{ marginStart: 72, marginEnd: 84, height: 14 }}>
        {timeline.SPEED_STOPS.map((stop) => <Tap key={stop} role="button" label={`${stop}x`} testID={`speed-stop-${stop}`} onPress={() => props.setRate(stop)} style={{ position: "absolute", start: `${timeline.rateToSlider(stop) * 100}%`, marginStart: -12, width: 24, alignItems: "center" } as object}><Text variant="caption" color="text/secondary" tabular>{`${stop}×`}</Text></Tap>)}
      </View>
      <Row label={t("Duration")}>
        <View testID="speed-duration"><NumberField label={t("Duration")} hideLabel size="sm" width={96} unit="s" min={0.03} max={21600} step={0.1} value={props.elements.length === 1 ? Math.round((first.duration / TICKS_PER_SECOND) * 100) / 100 : null}
          onCommit={(value) => { if (span > 0) props.setRate(timeline.rateForDuration(span, Math.round(value * TICKS_PER_SECOND), fps).rate); }} /></View>
        <Text variant="meta" color="text/secondary" style={{ flex: 1 }} numberOfLines={1} testID="speed-source">{props.elements.length === 1 ? t("of {source} source", { source: seconds(span) }) : ""}</Text>
      </Row>
      {audible.length > 0 ? (
        <Row label={t("Keep pitch")}>
          <View testID="speed-keep-pitch"><Switch accessibilityLabel={t("Keep pitch")} value={keepPitch} onChange={(on) => { props.change({ maintainPitch: on }); }} /></View>
          {dropped ? <View style={{ flex: 1 }}><Note testID="speed-pitch-note">{t("Pitch is kept between 0.25x and 4x")}</Note></View> : null}
        </Row>
      ) : null}
      <Row label={t("Reverse")}><View testID="speed-reverse"><Switch label={t("Reverse")} value={reversed} onChange={(on) => { props.change({ reverse: on }); }} /></View></Row>
      <SmoothRow elements={props.elements} change={props.change} />
      <View style={{ height: 1, backgroundColor: theme.color("border/hairline") }} />
    </View>
  );
}

const SMOOTH_LABELS: Record<"none" | "blend" | "flow", string> = { none: "Off", blend: "Frame blending", flow: "Optical flow" };
/**
 * Smooth slow-mo of video clips: Off repeats source frames, Frame blending mixes the two neighbours. Optical flow is
 * not synthesised by this build on any backend, so its option is disabled; a clip that already asks for it is drawn
 * with frame blending, and says so once the engine has reported it.
 */
function SmoothRow(props: { elements: El[]; change: Change }) {
  const t = useT();
  const runtime = useEditor();
  const videos = props.elements.filter((element) => element.type === "video");
  if (videos.length === 0) return null;
  const values = videos.map((element) => String((element.retime as { smooth?: string } | undefined)?.smooth ?? "none")), value = values.every((entry) => entry === values[0]) ? (values[0] as keyof typeof SMOOTH_LABELS) : null;
  // The control is for clips slowed down at any point of their length.
  const slowed = videos.some((element) => timeline.rateRange(element).min < 1 - 1e-6);
  const fallback = videos.some((element) => (element.retime as { smooth?: string } | undefined)?.smooth === "flow" && runtime.diagnosed("engine/flow-fallback", element.id));
  const select = (
    <Select label={t("Smooth slow-mo")} size="sm" width={150} value={value} placeholder="—" disabled={!slowed}
      options={(Object.keys(SMOOTH_LABELS) as (keyof typeof SMOOTH_LABELS)[]).map((id) => ({ value: id, label: t(SMOOTH_LABELS[id]), ...(id === "flow" ? { disabled: true, description: t("Optical flow is not available on this device") } : {}) }))}
      onChange={(smooth) => { props.change({ smooth }); }} />
  );
  return (
    <View style={{ gap: space[1] }}>
      <View testID="speed-smooth" style={{ flexDirection: "row", alignItems: "center", gap: space[2], minHeight: 28 }}>
        <Text variant="meta" color="text/secondary" numberOfLines={1}>{t("Smooth slow-mo")}</Text>
        <View style={{ flex: 1 }} />
        {slowed ? select : <Tooltip label={t("Available when the clip is slowed down")}><View>{select}</View></Tooltip>}
      </View>
      {!slowed ? <Note testID="speed-smooth-note">{t("Available when the clip is slowed down")}</Note> : null}
      {value === "flow" ? <Note tone="warning" testID="speed-flow-fallback">{fallback ? t("Optical flow is not available on this device. This clip is rendered with frame blending.") : t("Optical flow is not available on this device")}</Note> : null}
    </View>
  );
}

/** The preset tiles, and under them the editor of the clip's curve. */
function CurveTab(props: { element: El; change: Change }) {
  const t = useT();
  const theme = useTheme();
  const runtime = useEditor();
  const { element } = props, retime = element.retime as { curve?: { preset: string; points: CurvePoint[] } } | undefined;
  const points = timeline.speedCurveOf(element), selected = points ? retime!.curve!.preset : "none";
  const play = () => { const start = element.startTime; runtime.pause(); runtime.seek(start); runtime.play(); };
  const pick = (id: string) => { const done = id === "none" ? props.change({ curve: null }) : props.change({ curve: { preset: id } }); if (done && id !== "none") play(); };
  return (
    <View style={{ gap: space[2] }}>
      <View role="radiogroup" aria-label={t("Speed curve")} style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
        {timeline.SPEED_CURVE_TILES.map((tile) => {
          const shape = tile.id === "none" || tile.id === "custom" ? [{ u: 0, rate: 1 }, { u: 1, rate: 1 }] : timeline.SPEED_CURVE_PRESETS[tile.id].points, on = selected === tile.id;
          return (
            <Tap key={tile.id} role="radio" label={t(tile.name)} checked={on} testID={`speed-preset-${tile.id}`} onPress={() => pick(tile.id)} style={{ width: 64, gap: space[1] }}>
              <View style={{ height: 36, borderRadius: radius.sm, borderWidth: on ? 2 : 1, borderColor: theme.color(on ? "accent" : "border/control"), backgroundColor: theme.color("bg/subtle"), overflow: "hidden" }}>
                <Svg width={64} height={36}><Line x1={0} x2={64} y1={rateToY(1, 28) + 3} y2={rateToY(1, 28) + 3} stroke={theme.color("border/strong")} strokeWidth={0.5} strokeDasharray="2 2" /><Path d={curvePath(shape, 64, 28, 6)} transform="translate(0 3)" stroke={theme.color(on ? "accent" : "text/primary")} strokeWidth={1.25} fill="none" /></Svg>
              </View>
              <Text variant="meta" numberOfLines={1}>{t(tile.name)}</Text>
            </Tap>
          );
        })}
      </View>
      {points ? <CurveEditor element={element} points={points} preset={selected} change={props.change} /> : null}
      <SmoothRow elements={[element]} change={props.change} />
    </View>
  );
}

const GRAPH = { height: 116, hit: 10 };
/** The curve editor: rate over the clip's source span on a logarithmic axis, points that drag, "+", "−" and Reset, and the resulting duration. */
function CurveEditor(props: { element: El; points: CurvePoint[]; preset: string; change: Change }) {
  const t = useT();
  const theme = useTheme();
  const runtime = useEditor();
  const transport = useHeldTransport();
  const { element, points } = props, fps = runtime.fps() as Rational;
  const [width, setWidth] = useState(280);
  const [chosen, setChosen] = useState<number | null>(null);
  const [tip, setTip] = useState<{ index: number; rate: number } | null>(null);
  const node = useRef<View>(null), live = useRef({ points, width, chosen });
  live.current = { points, width, chosen };
  const yAt = (rate: number) => rateToY(rate, GRAPH.height);
  const span = timeline.sourceSpanOf(element), local = Math.min(element.duration, Math.max(0, transport.time - element.startTime));
  const playheadU = timeline.sourcePositionAt(element, local);
  const write = (next: CurvePoint[], isLive: boolean) => props.change({ curve: { preset: "custom", points: next } }, isLive);
  const xOf = (u: number) => u * width, shown = tip ? timeline.moveCurvePoint(points, tip.index, { rate: tip.rate }, true) : points;
  useEffect(() => bindPointer(node.current, {
    hover(info) {
      const state = live.current;
      const hit = !!info && state.points.some((point) => Math.hypot(point.u * state.width - info.x, yAt(point.rate) - info.y) <= GRAPH.hit);
      setCursor(node.current, hit ? "grab" : "default");
    },
    down(info) {
      const state = live.current, at = state.points.findIndex((point) => Math.hypot(point.u * state.width - info.x, rateToY(point.rate, GRAPH.height) - info.y) <= GRAPH.hit);
      if (at < 0) { setChosen(null); return null; }
      setChosen(at);
      const from = state.points;
      const next = (pointer: { x: number; y: number; shift: boolean }) => timeline.moveCurvePoint(from, at, { u: pointer.x / state.width, rate: yToRate(Math.min(GRAPH.height, Math.max(0, pointer.y)), GRAPH.height) }, pointer.shift);
      return {
        move: (pointer) => { const moved = next(pointer); setTip({ index: at, rate: moved[at].rate }); write(moved, true); },
        up: (pointer) => { const moved = next(pointer); setTip(null); runtime.controller.discardPreview(); if (JSON.stringify(moved) !== JSON.stringify(from)) write(moved, false); },
        cancel: () => { setTip(null); runtime.controller.discardPreview(); },
      };
    },
    double(info) { const added = timeline.addCurvePoint(live.current.points, info.x / live.current.width); if (added) write(added, false); },
  }), [runtime]); // eslint-disable-line react-hooks/exhaustive-deps
  const canAdd = timeline.addCurvePoint(points, playheadU) !== null, canRemove = chosen !== null && timeline.removeCurvePoint(points, chosen) !== null;
  const nudge = (key: KeyInfo | { key: string }) => {
    if (chosen === null) return;
    const point = points[chosen], step = { ArrowUp: { rate: point.rate + 0.1 }, ArrowDown: { rate: point.rate - 0.1 }, ArrowLeft: { u: point.u - 0.01 }, ArrowRight: { u: point.u + 0.01 } }[key.key];
    if (step) write(timeline.moveCurvePoint(points, chosen, step, true), false);
    if (key.key === "Delete" || key.key === "Backspace") { const fewer = timeline.removeCurvePoint(points, chosen); if (fewer) { write(fewer, false); setChosen(null); } }
  };
  const reset = () => write(props.preset !== "custom" && timeline.SPEED_CURVE_PRESETS[props.preset] ? timeline.SPEED_CURVE_PRESETS[props.preset].points : timeline.CUSTOM_CURVE_POINTS, false);
  const result = useMemo(() => retimedDuration(span, { curve: shown }, fps), [span, shown, fps]);
  return (
    <View style={{ gap: space[2] }}>
      <View ref={node} testID="speed-curve" tabIndex={0} accessibilityLabel={t("Speed curve")} onLayout={(event) => setWidth(Math.max(120, event.nativeEvent.layout.width))} {...({ onKeyDown: (event: { key: string; preventDefault(): void }) => { if (event.key === "Tab") return; nudge(event); if (event.key.startsWith("Arrow") || event.key === "Delete") event.preventDefault(); } } as object)}
        style={{ height: GRAPH.height, borderRadius: radius.sm, borderWidth: 1, borderColor: theme.color("border/hairline"), backgroundColor: theme.color("bg/subtle"), overflow: "hidden", outlineWidth: 0 } as object}>
        <Svg width={width} height={GRAPH.height}>
          {[0.25, 0.5, 0.75].map((u) => <Line key={u} x1={xOf(u)} x2={xOf(u)} y1={0} y2={GRAPH.height} stroke={theme.color("border/hairline")} strokeWidth={1} />)}
          <Line x1={0} x2={width} y1={rateToY(1, GRAPH.height)} y2={rateToY(1, GRAPH.height)} stroke={theme.color("border/strong")} strokeWidth={1} strokeDasharray="4 3" />
          <Line testID="speed-curve-playhead" x1={xOf(playheadU)} x2={xOf(playheadU)} y1={0} y2={GRAPH.height} stroke={theme.color("text/primary")} strokeWidth={1} />
          <Path d={curvePath(shown, width, GRAPH.height)} stroke={theme.color("accent")} strokeWidth={1.5} fill="none" />
          {shown.map((point, index) => <Circle key={index} cx={Math.min(width - 5, Math.max(5, xOf(point.u)))} cy={Math.min(GRAPH.height - 5, Math.max(5, rateToY(point.rate, GRAPH.height)))} r={chosen === index ? 5 : 4} fill={theme.color(chosen === index ? "accent" : "bg/app")} stroke={theme.color("accent")} strokeWidth={1.5} />)}
        </Svg>
        <Text variant="caption" color="text/secondary" style={{ position: "absolute", left: 4, top: 2 }}>10×</Text>
        <Text variant="caption" color="text/secondary" style={{ position: "absolute", left: 4, top: rateToY(1, GRAPH.height) - 14 }}>1×</Text>
        <Text variant="caption" color="text/secondary" style={{ position: "absolute", left: 4, bottom: 2 }}>0.1×</Text>
        {tip ? <View pointerEvents="none" testID="speed-curve-tip" style={{ position: "absolute", left: Math.min(width - 48, xOf(shown[tip.index].u) + 8), top: Math.max(2, rateToY(tip.rate, GRAPH.height) - 10), paddingHorizontal: space[1.5], borderRadius: radius.sm, backgroundColor: theme.color("clip/label-scrim") }}><Text variant="caption" color="clip/label" tabular>{`${tip.rate.toFixed(1)}x`}</Text></View> : null}
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[1.5] }}>
        <IconButton icon="plus" size="sm" variant="outline" label={t("Add point")} testID="speed-curve-add" disabled={!canAdd} onPress={() => { const added = timeline.addCurvePoint(points, playheadU); if (added) write(added, false); }} />
        <IconButton icon="minus" size="sm" variant="outline" label={t("Delete point")} testID="speed-curve-remove" disabled={!canRemove} onPress={() => { const fewer = timeline.removeCurvePoint(points, chosen!); if (fewer) { write(fewer, false); setChosen(null); } }} />
        <Button size="sm" kind="ghost" label={t("Reset")} testID="speed-curve-reset" onPress={reset} />
        <View style={{ flex: 1 }} />
        <Text variant="meta" color="text/secondary">{t("Duration")}</Text>
        <Text variant="mono" testID="speed-curve-duration">{`${seconds(span)} → ${seconds(result)}`}</Text>
      </View>
    </View>
  );
}

/** A speed curve built from the beat markers of the music under the clip. */
function VelocityTab(props: { element: El; change: Change }) {
  const t = useT();
  const runtime = useEditor();
  const { element } = props, { controller } = runtime;
  const [step, setStep] = useState(2);
  const [pattern, setPattern] = useState<timeline.VelocityPattern>("slow-fast");
  const [intensity, setIntensity] = useState(60);
  const scene = timeline.sceneById(controller.document, controller.session.sceneId);
  // Music: every overlapping sounded element that carries beat markers, the longest first.
  const sources = timeline.elementsOfScene(scene).filter((other) => other.id !== element.id && Array.isArray(other.beats) && (other.beats as number[]).length > 0 && other.startTime < element.startTime + element.duration && other.startTime + other.duration > element.startTime).sort((a, b) => b.duration - a.duration);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const source = sources.find((entry) => entry.id === sourceId) ?? sources[0];
  if (!source) return <View testID="velocity-empty" style={{ gap: space[2] }}><Note>{t("Add music and mark its beats first")}</Note></View>;
  const apply = () => {
    const rate = timeline.effectiveRate(source), span = timeline.sourceSpanOf(element);
    // A beat is a source time of the music; the clip's source position under it is where the speed changes.
    const beats = (source.beats as number[]).map((beat) => source.startTime + (beat - source.trimStart) / rate).filter((time) => time > element.startTime && time < element.startTime + element.duration).map((time) => timeline.sourcePositionAt(element, time - element.startTime));
    const made = timeline.velocityCurve(beats, step, pattern, intensity);
    if (span > 0 && props.change({ curve: { preset: "custom", points: made.points } }) && made.dropped > 0) runtime.host.message?.(t("Speed changes applied to the first {n} beats (limit reached)", { n: made.boundaries }));
  };
  return (
    <View testID="velocity-tab" style={{ gap: space[2] }}>
      <Row label={t("Music")}><View style={{ flex: 1, flexDirection: "row", flexWrap: "wrap", gap: space[1] }}>{sources.map((entry) => <Button key={entry.id} size="xs" kind={entry.id === source.id ? "secondary" : "outline"} pressed={entry.id === source.id} label={entry.name} onPress={() => setSourceId(entry.id)} />)}</View></Row>
      <Row label={t("Beat step")}><View style={{ flexDirection: "row", gap: space[1] }}>{[1, 2, 4].map((value) => <Button key={value} size="xs" kind={step === value ? "secondary" : "outline"} pressed={step === value} label={String(value)} onPress={() => setStep(value)} />)}</View></Row>
      <Row label={t("Pattern")}><View style={{ flexDirection: "row", gap: space[1] }}>{([["slow-fast", "Slow–fast"], ["fast-slow", "Fast–slow"], ["pulse", "Pulse"]] as const).map(([id, name]) => <Button key={id} size="xs" kind={pattern === id ? "secondary" : "outline"} pressed={pattern === id} label={t(name)} onPress={() => setPattern(id)} />)}</View></Row>
      <Row label={t("Intensity")}><View style={{ flex: 1 }}><Slider label={t("Intensity")} min={0} max={100} step={1} value={intensity} defaultValue={60} onChange={(value) => setIntensity(value as number)} onCommit={(value) => setIntensity(value as number)} /></View><Text variant="meta" tabular style={{ width: 32, textAlign: "right" }}>{intensity}</Text></Row>
      <View style={{ flexDirection: "row" }}><Button size="sm" kind="primary" label={t("Apply")} testID="velocity-apply" onPress={apply} /></View>
    </View>
  );
}
