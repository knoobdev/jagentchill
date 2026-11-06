import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import Svg, { Path, Polyline } from "react-native-svg";
import { chainCommits, TIMELINE_FRAME, type TimelineRow } from "@jagentchill/app-core";
import { addBeats, beatTimelineTime, deleteBeatAt, FADE_GAINS, keysOfPath, removeKeyframe, setElementFields, setFade, timeline, upsertKeyframe, volumeAtLineY, volumeLabel, volumeLineY, type Commit, type CommitContext } from "@jagentchill/editor-core";
import type { ProjectDocument } from "@jagentchill/protocol";
import { Text, radius, space, useTheme, dragHandle } from "@jagentchill/ui";
import { useStickerSources } from "../assets/sticker-sources";
import { useLoudnessWatcher } from "../audio/loudness";
import { useT } from "../../locale";
import { bindClipHover, bindHandle } from "../content-dom";
import { useEditor, useEditorVersion } from "../context";

type El = timeline.El;
type Obj = Record<string, unknown>;
const objectOf = (value: unknown): Obj => (value !== null && typeof value === "object" ? (value as Obj) : {});
const HIT = 14, SNAP = 3, DOT = 6, FADE_HANDLE = 10, FADE_MIN_WIDTH = 48;
/** The part of a clip's box its sound is drawn in: the body of an audio clip, the 16 px waveform strip of a picture clip. */
const soundArea = (element: El, row: TimelineRow): { top: number; height: number } => {
  const body = Math.max(8, row.baseHeight - TIMELINE_FRAME.clipHeader);
  return element.type === "audio" ? { top: TIMELINE_FRAME.clipHeader, height: body } : { top: row.baseHeight - Math.min(16, body / 2), height: Math.min(16, body / 2) };
};

/**
 * What the content capabilities draw over the clips of the tracks: the shaded In and Out zones of a text animation,
 * the volume line of a sounding clip (an envelope with a point per key once the volume has keyframes), its beat
 * markers, and the stretch a ducked track is lowered under a voice.
 */
export function ContentTimelineLayer(props: { rows: TimelineRow[]; zoomLevel: number; scrollLeft: number; viewportWidth: number }) {
  const runtime = useEditor();
  useEditorVersion();
  useLoudnessWatcher();
  useStickerSources();
  // The clip under the pointer shows its fade handles, like the selected ones.
  const [hovered, setHovered] = useState<string | null>(null);
  useEffect(() => bindClipHover(setHovered), []);
  const { controller } = runtime, document = controller.document, scene = timeline.sceneById(document, controller.session.sceneId);
  const x = (time: number) => timeline.ticksToPixels(time, props.zoomLevel);
  const from = timeline.pixelsToTicks(Math.max(0, props.scrollLeft - 200), props.zoomLevel), to = timeline.pixelsToTicks(props.scrollLeft + props.viewportWidth + 200, props.zoomLevel);
  // The voice clips of each track: a track with ducking on is lowered while a voice of another track sounds.
  const tracks = timeline.tracksOfScene(scene);
  const voices = tracks.flatMap((track) => (objectOf(track).muted === true ? [] : track.elements.filter((element) => element.isVoice === true && element.muted !== true).map((element) => ({ trackId: track.id, start: element.startTime, end: element.startTime + element.duration }))));
  return (
    <>
      {props.rows.map((row) => {
        const track = timeline.trackById(scene, row.trackId);
        if (!track) return null;
        const locked = objectOf(track).locked === true;
        const ducking = objectOf(objectOf(track).ducking), ducked = track.type === "audio" && ducking.enabled === true ? voices.filter((voice) => voice.trackId !== track.id) : [];
        return track.elements.filter((element) => element.startTime < to && element.startTime + element.duration > from).map((element) => {
          const left = x(element.startTime), width = Math.max(1, x(element.duration));
          const animation = objectOf(element.type === "text" ? element.textAnimation : element.type === "caption" ? objectOf(element.style).textAnimation ?? objectOf(objectOf(objectOf(track).caption).style).textAnimation : undefined);
          const sounding = timeline.isAudioCapable(document, element) && !timeline.isFreeze(element);
          if (!sounding && Object.keys(animation).length === 0) return null;
          return (
            <View key={element.id} pointerEvents="box-none" style={{ position: "absolute", left, top: row.top, width, height: row.baseHeight, zIndex: 3 }}>
              {(["in", "out"] as const).map((side) => {
                const length = Number(objectOf(animation[side]).duration ?? 0);
                return length > 0 ? <AnimationZone key={side} side={side} width={Math.min(width, x(length))} height={row.baseHeight} /> : null;
              })}
              {sounding ? ducked.filter((voice) => voice.start < element.startTime + element.duration && voice.end > element.startTime).map((voice) => {
                const start = Math.max(voice.start, element.startTime), end = Math.min(voice.end + Number(ducking.release ?? 500) * 120, element.startTime + element.duration), area = soundArea(element, row);
                return <View key={`${voice.trackId}-${voice.start}`} pointerEvents="none" testID="ducked-zone" style={{ position: "absolute", left: x(start - element.startTime), width: Math.max(1, x(end - start)), top: area.top, height: area.height, backgroundColor: "black", opacity: 0.35, borderRadius: radius.sm }} />;
              }) : null}
              {sounding && row.baseHeight >= 24 ? <VolumeLine element={element} row={row} width={width} zoomLevel={props.zoomLevel} /> : null}
              {sounding ? <Fades element={element} row={row} width={width} zoomLevel={props.zoomLevel} handles={width >= FADE_MIN_WIDTH && !locked && (hovered === element.id || controller.session.selection.selectedElements.includes(element.id))} /> : null}
              {sounding ? <Beats element={element} row={row} width={width} zoomLevel={props.zoomLevel} fps={document.settings.fps as { numerator: number; denominator: number }} /> : null}
            </View>
          );
        });
      })}
    </>
  );
}

/** The shaded end of a clip whose text animates in or out there. */
function AnimationZone(props: { side: "in" | "out"; width: number; height: number }) {
  const theme = useTheme();
  return <View pointerEvents="none" testID={`animation-zone-${props.side}`} style={[{ position: "absolute", top: 0, width: props.width, height: props.height, backgroundColor: theme.color("clip/label"), opacity: 0.28 }, props.side === "in" ? { left: 0, borderTopLeftRadius: radius.sm, borderBottomLeftRadius: radius.sm } : { right: 0, borderTopRightRadius: radius.sm, borderBottomRightRadius: radius.sm }]} />;
}

function VolumeLine(props: { element: El; row: TimelineRow; width: number; zoomLevel: number }) {
  const theme = useTheme();
  const runtime = useEditor();
  const { controller } = runtime, { element } = props, area = soundArea(element, props.row);
  const keys = keysOfPath(element, "volume") as { id: string; time: number; value: number }[];
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const line = useRef<View>(null);
  const live = useRef({ element, area });
  live.current = { element, area };
  const select = () => { if (!controller.session.selection.selectedElements.includes(live.current.element.id)) controller.select(timeline.selectElements([live.current.element.id])); };
  /** The dB under a pointer y of the drawing area: 0.1 dB steps, 0 dB within 3 px unless Shift is held. */
  const valueAt = (y: number, shift: boolean): number => { const height = live.current.area.height, zero = volumeLineY(0, height); return !shift && Math.abs(y - zero) <= SNAP ? 0 : volumeAtLineY(Math.min(height, Math.max(0, y)), height); };
  const write = (db: number, isLive: boolean) => controller.external((doc, ctx) => setElementFields(doc, ctx, live.current.element.id, { volume: db }, { commandType: "element.volume", label: "Volume" }), isLive);
  const y = volumeLineY(Number(element.volume ?? 0), area.height);
  useEffect(() => {
    if (keys.length > 0) return;
    // The handle is 14 px high around the line: a pointer y inside it maps to the drawing area.
    const toArea = (info: { y: number }) => info.y - HIT / 2 + volumeLineY(Number(live.current.element.volume ?? 0), live.current.area.height);
    return bindHandle(line.current, {
      down(info) {
        select();
        // The line follows the value while it is dragged, so the drag is measured in viewport pixels, not from the line itself.
        const start = toArea(info), origin = info.clientY, left = info.x;
        const at = (now: { clientY: number; shift: boolean }) => valueAt(start + (now.clientY - origin), now.shift);
        return {
          move(now) { const db = at(now); setTip({ x: left + (now.clientX - info.clientX), y: volumeLineY(db, live.current.area.height), text: volumeLabel(db).replace(/^\+/, "") }); write(db, true); },
          up(now) { setTip(null); controller.discardPreview(); if (now.clientY !== origin) write(at(now), false); },
          cancel() { setTip(null); controller.discardPreview(); },
        };
      },
      double() { select(); write(0, false); },
    });
  }, [keys.length, runtime]); // eslint-disable-line react-hooks/exhaustive-deps
  const colour = theme.color("waveform/fill");
  if (keys.length > 0) {
    const points = keys.map((key) => ({ ...key, x: timeline.ticksToPixels(key.time, props.zoomLevel), y: volumeLineY(Number(key.value), area.height) }));
    const path = [{ x: 0, y: points[0].y }, ...points, { x: props.width, y: points[points.length - 1].y }].map((point) => `${point.x},${point.y}`).join(" ");
    return (
      <View pointerEvents="box-none" testID="volume-envelope" style={{ position: "absolute", left: 0, top: area.top, width: props.width, height: area.height }}>
        <Svg width={props.width} height={area.height} style={{ position: "absolute", left: 0, top: 0 }} pointerEvents="none"><Polyline points={path} stroke={colour} strokeWidth={1.5} fill="none" /></Svg>
        {points.map((point) => <VolumePoint key={point.id} element={element} keyId={point.id} time={point.time} x={point.x} y={point.y} height={area.height} />)}
      </View>
    );
  }
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", left: 0, top: area.top, width: props.width, height: area.height }}>
      <View {...dragHandle("ns-resize")} ref={line} testID="volume-line" style={[{ position: "absolute", left: TIMELINE_FRAME.trimHandle, right: TIMELINE_FRAME.trimHandle, top: y - HIT / 2, height: HIT, justifyContent: "center" }]}>
        <View pointerEvents="none" style={{ height: 1.5, backgroundColor: colour, opacity: 0.9 }} />
      </View>
      {tip ? <View pointerEvents="none" testID="volume-tooltip" style={{ position: "absolute", left: Math.max(0, tip.x + 16), top: Math.max(-area.top, tip.y - 22), paddingHorizontal: space[1.5], borderRadius: radius.sm, backgroundColor: theme.color("clip/label-scrim") }}><Text variant="caption" color="clip/label" tabular>{tip.text}</Text></View> : null}
    </View>
  );
}

/**
 * The fades of a sounding clip: each one a curve of its shape over the stretch it lasts, with the area above the curve
 * shaded, and — on a selected or hovered clip — a round handle at each top corner. Dragging the left handle to the
 * right lengthens the fade in, the right one to the left the fade out, on the frame grid, as one step; a double-click
 * resets that fade.
 */
function Fades(props: { element: El; row: TimelineRow; width: number; zoomLevel: number; handles: boolean }) {
  const t = useT();
  const theme = useTheme();
  const runtime = useEditor();
  const { element, width } = props, area = soundArea(element, props.row);
  const [tip, setTip] = useState<{ side: "fadeIn" | "fadeOut"; text: string } | null>(null);
  const fade = (side: "fadeIn" | "fadeOut") => ({ duration: Math.min(element.duration, Math.max(0, Number(objectOf(element[side]).duration ?? 0))), shape: String(objectOf(element[side]).shape ?? "equal-power") });
  const fadeIn = fade("fadeIn"), fadeOut = fade("fadeOut");
  const inWidth = Math.min(width, timeline.ticksToPixels(fadeIn.duration, props.zoomLevel)), outWidth = Math.min(width - inWidth, timeline.ticksToPixels(fadeOut.duration, props.zoomLevel));
  /** The shaded area above the gain curve of one fade, in the box of the clip's sound. */
  const shade = (side: "fadeIn" | "fadeOut", span: number, shape: string): { area: string; curve: string } => {
    const gain = FADE_GAINS[shape] ?? FADE_GAINS["equal-power"], steps = Math.max(4, Math.min(48, Math.round(span / 3)));
    const points = Array.from({ length: steps + 1 }, (_, index) => { const p = index / steps, x = side === "fadeIn" ? p * span : width - p * span; return `${x.toFixed(1)} ${((1 - gain(p)) * area.height).toFixed(1)}`; });
    const corner = side === "fadeIn" ? 0 : width;
    return { area: `M${corner} 0 L${points.join(" L")} Z`, curve: `M${points.join(" L")}` };
  };
  const shapes = [inWidth >= 1 ? { side: "fadeIn" as const, ...shade("fadeIn", inWidth, fadeIn.shape) } : null, outWidth >= 1 ? { side: "fadeOut" as const, ...shade("fadeOut", outWidth, fadeOut.shape) } : null].filter((entry) => entry !== null);
  const label = (side: "fadeIn" | "fadeOut", ticks: number) => (side === "fadeIn" ? t("Fade in {seconds}s", { seconds: (ticks / 120_000).toFixed(1) }) : t("Fade out {seconds}s", { seconds: (ticks / 120_000).toFixed(1) }));
  const inset = FADE_HANDLE / 2 + 1;
  return (
    <>
      {shapes.length > 0 ? (
        <Svg width={width} height={area.height} style={{ position: "absolute", left: 0, top: area.top }} pointerEvents="none">
          {shapes.map((entry) => <Path key={`${entry.side}-area`} d={entry.area} fill={theme.color("clip/label-scrim")} fillOpacity={0.55} />)}
          {shapes.map((entry) => <Path key={`${entry.side}-curve`} d={entry.curve} stroke={theme.color("clip/label")} strokeWidth={1.25} fill="none" />)}
        </Svg>
      ) : null}
      {shapes.map((entry) => <View key={entry.side} pointerEvents="none" testID={entry.side === "fadeIn" ? "fade-zone-in" : "fade-zone-out"} {...({ dataSet: { width: String(Math.round(entry.side === "fadeIn" ? inWidth : outWidth)) } } as object)} style={{ position: "absolute", top: area.top, height: area.height, width: entry.side === "fadeIn" ? inWidth : outWidth, ...(entry.side === "fadeIn" ? { left: 0 } : { right: 0 }) }} />)}
      {props.handles ? (["fadeIn", "fadeOut"] as const).map((side) => {
        const at = side === "fadeIn" ? Math.min(width - inset, Math.max(inset, inWidth)) : Math.max(inset, Math.min(width - inset, width - outWidth));
        return <FadeHandle key={side} element={element} side={side} x={at} zoomLevel={props.zoomLevel} label={label(side, fade(side).duration)} onTip={(ticks) => setTip(ticks === null ? null : { side, text: label(side, ticks) })} />;
      }) : null}
      {tip ? <View pointerEvents="none" testID="fade-tooltip" style={[{ position: "absolute", top: -20, paddingHorizontal: space[1.5], borderRadius: radius.sm, backgroundColor: theme.color("clip/label-scrim") }, tip.side === "fadeIn" ? { left: 0 } : { right: 0 }]}><Text variant="caption" color="clip/label" tabular numberOfLines={1}>{tip.text}</Text></View> : null}
    </>
  );
}
function FadeHandle(props: { element: El; side: "fadeIn" | "fadeOut"; x: number; zoomLevel: number; label: string; onTip(ticks: number | null): void }) {
  const theme = useTheme();
  const runtime = useEditor();
  const node = useRef<View>(null);
  const live = useRef(props);
  live.current = props;
  useEffect(() => bindHandle(node.current, {
    down(info) {
      const { controller } = runtime, state = live.current, id = state.element.id, side = state.side, origin = info.clientX;
      const start = Number(objectOf(state.element[side]).duration ?? 0);
      if (!controller.session.selection.selectedElements.includes(id)) controller.select(timeline.selectElements([id]));
      // The left handle lengthens its fade to the right, the right one to the left.
      const wanted = (now: { clientX: number }) => Math.max(0, start + (side === "fadeIn" ? 1 : -1) * timeline.pixelsToTicks(Math.abs(now.clientX - origin), live.current.zoomLevel) * Math.sign(now.clientX - origin));
      const write = (now: { clientX: number }, isLive: boolean) => controller.external((doc, ctx) => setFade(doc, ctx, [id], side, { duration: Math.round(wanted(now)) }), isLive);
      const shown = () => Number(objectOf(timeline.locate(controller.document, id)?.element[side]).duration ?? 0);
      return {
        move(now) { write(now, true); live.current.onTip(shown()); },
        up(now) { live.current.onTip(null); controller.discardPreview(); if (now.clientX !== origin) write(now, false); },
        cancel() { live.current.onTip(null); controller.discardPreview(); },
      };
    },
    double() { runtime.controller.external((doc, ctx) => setFade(doc, ctx, [live.current.element.id], live.current.side, { duration: 0 })); },
  }), [runtime]);
  return (
    <View {...dragHandle("ew-resize")} ref={node} nativeID={`${props.side === "fadeIn" ? "fade-in" : "fade-out"}-${props.element.id}`} testID={props.side === "fadeIn" ? "fade-handle-in" : "fade-handle-out"} role="slider" aria-label={props.label}
      aria-valuemin={0} aria-valuemax={props.element.duration} aria-valuenow={Number(objectOf(props.element[props.side]).duration ?? 0)} aria-valuetext={props.label}
      {...({ title: props.label } as object)} style={[{ position: "absolute", left: props.x - HIT / 2, top: 0, width: HIT, height: HIT, alignItems: "center", justifyContent: "center", zIndex: 2 }]}>
      <View pointerEvents="none" style={[{ width: FADE_HANDLE, height: FADE_HANDLE, borderRadius: FADE_HANDLE / 2, backgroundColor: theme.color("bg/elevated"), borderWidth: 1.5, borderColor: theme.color("timeline/selection") }, theme.elevation(1)]} />
    </View>
  );
}

/** One key of a volume envelope: dragged up and down it changes that key's value; a double-click removes the key. */
function VolumePoint(props: { element: El; keyId: string; time: number; x: number; y: number; height: number }) {
  const theme = useTheme();
  const runtime = useEditor();
  const node = useRef<View>(null);
  const live = useRef(props);
  live.current = props;
  useEffect(() => bindHandle(node.current, {
    down(info) {
      const { controller } = runtime, origin = info.clientY, start = live.current.y;
      controller.select(timeline.selectElements([live.current.element.id]));
      const write = (now: { clientY: number }, isLive: boolean) => controller.external((doc, ctx) => upsertKeyframe(doc, ctx, live.current.element.id, "volume", { id: live.current.keyId, time: live.current.time, value: volumeAtLineY(Math.min(live.current.height, Math.max(0, start + now.clientY - origin)), live.current.height) }), isLive);
      return { move: (now) => { write(now, true); }, up: (now) => { controller.discardPreview(); if (now.clientY !== origin) write(now, false); }, cancel: () => controller.discardPreview() };
    },
    double() { runtime.controller.external((doc, ctx) => removeKeyframe(doc, ctx, live.current.element.id, "volume", live.current.keyId)); },
  }), [runtime]);
  return <View {...dragHandle("ns-resize")} ref={node} testID="volume-point" style={[{ position: "absolute", left: props.x - 5, top: props.y - 5, width: 10, height: 10, borderRadius: 5, backgroundColor: theme.color("waveform/fill"), borderWidth: 1.5, borderColor: theme.color("keyframe/fill") }]} />;
}

/** The beat markers of a clip: 6 px dots along the bottom of its waveform, inside the trimmed range; a dot drags along the clip. */
function Beats(props: { element: El; row: TimelineRow; width: number; zoomLevel: number; fps: { numerator: number; denominator: number } }) {
  const { element } = props, beats = Array.isArray(element.beats) ? (element.beats as number[]) : [];
  if (beats.length === 0) return null;
  const end = element.startTime + element.duration;
  return (
    <>
      {beats.map((source) => {
        const time = beatTimelineTime(element as never, source);
        return time < element.startTime || time > end ? null : <BeatDot key={source} element={element} time={time} x={timeline.ticksToPixels(time - element.startTime, props.zoomLevel)} top={props.row.baseHeight - DOT - 1} zoomLevel={props.zoomLevel} fps={props.fps} />;
      })}
    </>
  );
}
function BeatDot(props: { element: El; time: number; x: number; top: number; zoomLevel: number; fps: { numerator: number; denominator: number } }) {
  const theme = useTheme();
  const runtime = useEditor();
  const node = useRef<View>(null);
  const [offset, setOffset] = useState(0);
  const live = useRef(props);
  live.current = props;
  useEffect(() => bindHandle(node.current, {
    down(info) {
      const origin = info.clientX;
      const target = (now: { clientX: number }) => { const state = live.current; return Math.min(state.element.startTime + state.element.duration, Math.max(state.element.startTime, state.time + timeline.pixelsToTicks(now.clientX - origin, state.zoomLevel))); };
      return {
        move(now) { setOffset(timeline.ticksToPixels(target(now) - live.current.time, live.current.zoomLevel)); },
        up(now) {
          setOffset(0);
          const state = live.current, to = target(now), frame = Math.round((120_000 * state.fps.denominator) / state.fps.numerator);
          if (Math.abs(to - state.time) < 1) return;
          // A moved marker is deleted where it was and added where it was dropped, as one step.
          runtime.controller.external((doc, ctx) => chainCommits(doc, ctx, "Move beat", "audio.beat.move", [
            (before: ProjectDocument, context: CommitContext): Commit | null => deleteBeatAt(before, context, state.element.id, state.time, frame),
            (before: ProjectDocument, context: CommitContext): Commit | null => addBeats(before, context, state.element.id, [to]),
          ]));
        },
        cancel() { setOffset(0); },
      };
    },
  }), [runtime]);
  return <View {...dragHandle("ew-resize")} ref={node} testID="beat-dot" style={[{ position: "absolute", left: props.x - DOT / 2 + offset, top: props.top, width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: theme.color("waveform/beat") }]} />;
}
