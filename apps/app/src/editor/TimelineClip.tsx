import { memo, useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { filmstripTiles, TIMELINE_FRAME, type TimelineRow } from "@jagentchill/app-core";
import { timeline, fadeGain, type Fade } from "@jagentchill/editor-core";
import { filmstripSampleTime, sampleWaveform, wantedFilmstripInterval, type WaveformSummary } from "@jagentchill/media";
import { TICKS_PER_SECOND, type ProjectDocument, type Rational } from "@jagentchill/protocol";
import { Clip, DropIndicator, KeyframeDiamond, Waveform, useTheme, type ClipBadges, type ClipType } from "@jagentchill/ui";
import { useT } from "../locale";
import type { EditorRuntime } from "./runtime";
import { ClipSyncOverlay } from "../sync/SyncPanels";

type Asset = ProjectDocument["media"]["assets"][number];
const CLIP_TYPES: Record<string, ClipType> = { video: "video", image: "image", audio: "audio", text: "text", caption: "caption", sticker: "sticker", graphic: "sticker", effect: "effect", adjustment: "adjustment", compound: "compound" };
/** What a clip's bar reads: text clips show their content, caption clips their text, media clips the asset's name. */
// The kinds the engine names in English when it describes an element (listed so that the locale resources hold them).
const CLIP_KINDS = { video: "Video clip", image: "Image clip", audio: "Audio clip", text: "Text", caption: "Caption", sticker: "Sticker", graphic: "Shape", effect: "Effect", adjustment: "Adjustment layer", compound: "Compound clip", other: "Clip" };
/**
 * The accessible name of a clip in the UI language. The engine words it in English as
 * "<kind>, <name>, starts <timecode>, duration <timecode>[, selected][, hidden][, muted][, locked]"; the name is the
 * user's own text and the timecodes are locale-independent, so only the words around them are translated.
 */
function describeClip(t: (text: string, values?: Record<string, string | number>) => string, english: string): string {
  const parts = /^([^,]+), ([\s\S]*), starts (\S+), duration (\S+?)((?:, (?:selected|hidden|muted|locked))*)$/.exec(english);
  if (!parts) return english;
  const state: Record<string, string> = { selected: t("selected"), hidden: t("hidden"), muted: t("muted"), locked: t("locked") };
  const kind = Object.values(CLIP_KINDS).includes(parts[1]!) ? t(parts[1]!) : parts[1]!;
  return [t("{kind}, {name}, starts at {start}, duration {duration}", { kind, name: parts[2]!, start: parts[3]!, duration: parts[4]! }), ...parts[5]!.split(", ").filter(Boolean).map((word) => state[word] ?? word)].join(", ");
}

export function clipLabel(element: timeline.El, asset: Asset | undefined): string {
  if (element.type === "text") return String(element.content ?? element.name ?? "");
  if (element.type === "caption") return String(element.text ?? element.name ?? "");
  return asset?.name ?? element.name;
}
// `backgroundImage` on web, `experimental_backgroundImage` on native.
const tileImage = (uri: string, sprite?: { index: number; count: number; columns: number }): object => {
  if (!sprite) return { backgroundImage: `url("${uri}")`, experimental_backgroundImage: `url("${uri}")`, backgroundSize: "cover", backgroundPosition: "center" };
  const rows = Math.ceil(sprite.count / sprite.columns), column = sprite.index % sprite.columns, row = Math.floor(sprite.index / sprite.columns);
  const position = (value: number, count: number) => count < 2 ? "0%" : `${value / (count - 1) * 100}%`;
  return { backgroundImage: `url("${uri}")`, experimental_backgroundImage: `url("${uri}")`, backgroundSize: `${sprite.columns * 100}% ${rows * 100}%`, backgroundPosition: `${position(column, sprite.columns)} ${position(row, rows)}` };
};
const waveforms = new Map<string, WaveformSummary | null>();
/** The waveform summary of an asset, computed once by the media session and shared by every clip of it. */
function useWaveform(runtime: EditorRuntime, assetId: string | undefined, wanted: boolean, /** Changes when media arrives on this device: a waveform that could not be made without the file is asked for again. */ arrivals: number): WaveformSummary | null {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!assetId || !wanted || waveforms.has(assetId)) return;
    waveforms.set(assetId, null);
    bump((value) => value + 1);
    runtime.media.waveform(assetId, (state) => { if (state.state === "ready") { waveforms.set(assetId, state.summary); bump((value) => value + 1); } else if (state.state === "failed") { waveforms.delete(assetId); bump((value) => value + 1); } });
  }, [runtime, assetId, wanted, arrivals]);
  return assetId ? waveforms.get(assetId) ?? null : null;
}

export type TimelineClipProps = {
  runtime: EditorRuntime; document: ProjectDocument; element: timeline.El; row: TimelineRow; zoomLevel: number;
  /** The part of the clip inside the viewport, in clip-local px: only that part gets tiles and bars. */
  visibleFrom: number; visibleTo: number;
  selected: boolean; dragging: boolean; locked: boolean; trimAdjusted: boolean; groupSelected: boolean; thumbnails: number; frames: number;
  /** The phone timeline draws wider trim handles and the length of the selected clip. */
  trimHandle?: number; durationBadge?: string;
};

/** One clip of the timeline: the atom of the design system with the filmstrip, waveform and badges this element has. */
export const TimelineClip = memo(function TimelineClip(props: TimelineClipProps) {
  const { runtime, document, element, row, zoomLevel } = props;
  const t = useT();
  const theme = useTheme();
  const width = Math.max(1, timeline.ticksToPixels(element.duration, zoomLevel)), height = row.baseHeight;
  const asset = typeof element.mediaId === "string" ? document.media.assets.find((entry) => entry.id === element.mediaId) : undefined;
  const shown = timeline.clipPresentation(document, element, width, { trimAdjusted: props.trimAdjusted, selected: props.selected });
  const retime = element.retime as { rate?: number; reverse?: boolean; smooth?: string } | undefined, rate = Number(retime?.rate ?? 1) || 1;
  const pictured = element.type === "video" || element.type === "image" || element.type === "compound";
  const sounded = element.type === "audio" || shown.waveformStrip;
  const summary = useWaveform(runtime, asset?.id, sounded && asset !== undefined && asset.type !== "image", props.thumbnails);
  const fps = document.settings.fps as Rational;
  const stripHeight = Math.max(8, height - TIMELINE_FRAME.clipHeader);

  const placeholder = theme.color("bg/subtle");
  const filmstrip = useMemo(() => {
    if (!pictured || !shown.showHeader) return null;
    const aspect = asset && asset.width && asset.height ? asset.width / asset.height : document.settings.canvasSize.width / document.settings.canvasSize.height;
    const tiles = filmstripTiles({ clipWidth: width, stripHeight, aspect, trimStart: shown.filmstripSourceStart, zoomLevel, rate, visibleFrom: props.visibleFrom, visibleTo: props.visibleTo });
    const fallback = asset ? runtime.media.thumbnail(asset.id) ?? undefined : undefined;
    const remoteFilmstrip = asset?.type === "video" && runtime.media.platform === "mobile" ? runtime.media.filmstrip(asset.id) ?? undefined : undefined;
    const interval = tiles.length > 0 ? wantedFilmstripInterval(timeline.pixelsToTicks(tiles[0].width, zoomLevel) * rate, fps) : TICKS_PER_SECOND;
    const freeze = (element.freeze as { sourceTime?: number } | undefined)?.sourceTime;
    return (
      <>
        {tiles.map((tile) => {
          // An image repeats its thumbnail; a video shows the frame of each tile's own source time.
          const time = freeze ?? Math.min(filmstripSampleTime(tile.sourceTime, interval), Math.max(0, (asset?.duration ?? 0) - 1));
          const uri = remoteFilmstrip ?? (asset && asset.type === "video" && runtime.media.platform !== "mobile" ? runtime.frame(asset.id, time) ?? fallback : fallback);
          const spriteFrames = Math.max(1, Math.min(24, Math.ceil((asset?.duration ?? 0) / TICKS_PER_SECOND)));
          const sprite = remoteFilmstrip ? { index: Math.min(spriteFrames - 1, Math.floor(time / TICKS_PER_SECOND)), count: spriteFrames, columns: Math.min(6, spriteFrames) } : undefined;
          // A plain box with the picture as its background: a tile holds no state of its own, so a scroll mounts hundreds cheaply.
          // A picture still being made is a quiet block of the clip's own tile size, so the strip does not change shape when it arrives.
          return uri ? <View key={tile.x} style={[{ position: "absolute", left: tile.x, top: 0, width: tile.width - 1, height: "100%" }, tileImage(uri, sprite)]} />
            : <View key={tile.x} testID="filmstrip-pending" style={{ position: "absolute", left: tile.x, top: 0, width: tile.width - 1, height: "100%", backgroundColor: placeholder, opacity: 0.5 }} />;
        })}
      </>
    );
    // `thumbnails` and `frames` change when a picture arrives.
  }, [pictured, shown.showHeader, shown.filmstripSourceStart, asset, width, stripHeight, zoomLevel, rate, props.visibleFrom, props.visibleTo, props.thumbnails, props.frames, runtime, fps, placeholder, document.settings.canvasSize, element.freeze]); // eslint-disable-line react-hooks/exhaustive-deps

  const waveform = useMemo(() => {
    if (!sounded || !asset || !shown.showHeader) return null;
    // The sound is being read (a failed read is forgotten, so it shows nothing): a flat band where the waveform will be.
    if (!summary) return waveforms.has(asset.id) ? <View testID="waveform-pending" style={{ position: "absolute", left: Math.max(0, props.visibleFrom), bottom: 0, width: Math.max(0, Math.min(width, props.visibleTo) - Math.max(0, props.visibleFrom)), height: element.type === "audio" ? stripHeight : Math.min(16, stripHeight / 2), backgroundColor: placeholder, opacity: 0.5 }} /> : null;
    const from = Math.max(0, props.visibleFrom), to = Math.min(width, props.visibleTo), span = Math.max(0, to - from);
    const bars = Math.min(1500, Math.floor(span / 4));
    if (bars <= 0) return null;
    const start = (element.trimStart + timeline.pixelsToTicks(from, zoomLevel) * rate) / TICKS_PER_SECOND, end = (element.trimStart + timeline.pixelsToTicks(to, zoomLevel) * rate) / TICKS_PER_SECOND;
    const pairs = sampleWaveform(summary, { startSeconds: start, endSeconds: end, bars });
    // The bars follow the fade gain: a faded stretch tapers as it will sound.
    const fadeIn = element.fadeIn as Fade | undefined, fadeOut = element.fadeOut as Fade | undefined, faded = (fadeIn?.duration ?? 0) > 0 || (fadeOut?.duration ?? 0) > 0;
    const peaks = Array.from({ length: bars }, (_, index) => Math.max(Math.abs(pairs[index * 2]), Math.abs(pairs[index * 2 + 1])) * (faded ? fadeGain(timeline.pixelsToTicks(from + ((index + 0.5) * span) / bars, zoomLevel), element.duration, fadeIn, fadeOut) : 1));
    const waveHeight = element.type === "audio" ? stripHeight : Math.min(16, stripHeight / 2);
    // The loudest and the quietest bar are written on the node: a test tells a drawn waveform from a flat line by them.
    return <View testID="waveform-ready" {...({ dataSet: { peak: Math.max(0, ...peaks).toFixed(3), floor: Math.min(1, ...peaks).toFixed(3), bars } } as object)} style={{ position: "absolute", left: from, bottom: 0 }}><Waveform peaks={peaks} width={span} height={waveHeight} muted={element.muted === true} /></View>;
  }, [sounded, summary, asset, placeholder, shown.showHeader, props.visibleFrom, props.visibleTo, width, zoomLevel, rate, element.trimStart, element.muted, element.type, element.fadeIn, element.fadeOut, element.duration, stripHeight]);

  // "2.0x", "0.25x", a preset's name, or "Curve" for a custom curve.
  const speedName = timeline.speedBadge(element), speedText = speedName && /^[\d.]+x$/.test(speedName) ? speedName : speedName ? t(speedName) : null;
  // A clip that asks for optical flow and is drawn with frame blending carries the warning on its speed badge.
  const flowFallback = retime?.smooth === "flow" && runtime.diagnosed("engine/flow-fallback", element.id), speedLabel = speedText && flowFallback ? `⚠ ${speedText}` : speedText;
  const badges: ClipBadges = {
    ...(shown.badges.includes("speed") && speedLabel ? { speed: speedLabel } : {}), ...(shown.badges.includes("reverse") && !shown.badges.includes("speed") ? { speed: "◀" } : {}),
    muted: shown.badges.includes("muted"), linked: shown.badges.includes("linked"), anchored: Boolean((element as { timingAnchor?: unknown }).timingAnchor), keyframes: shown.badges.includes("keyframes"), effects: shown.badges.includes("effects"),
    ...(props.durationBadge ? { duration: props.durationBadge } : {}),
  };
  // A standalone effect or filter layer reads the name of its entry; a filter says that it is one.
  const bar = element.type === "effect" ? timeline.effectBar(element as never) : null, filter = bar?.kind === "filter";
  const diamonds = shown.inlineDiamonds ? timeline.inlineKeyframeTimes(element, width) : [];
  return (
    <View testID={`clip-${element.id}`} nativeID={`clip-${element.id}`} role="listitem" accessibilityLabel={describeClip(t, timeline.describeElement(document, element, { locked: props.locked }, props.selected))}
      style={{ position: "absolute", left: timeline.ticksToPixels(element.startTime, zoomLevel), top: 0, width, height, zIndex: props.dragging ? 3 : props.selected ? 2 : 1 }}>
      <Clip type={filter ? "filter" : CLIP_TYPES[element.type] ?? "video"} label={shown.showHeader ? (bar ? (bar.kind === "filter" ? t("Filter - {name}", { name: t(bar.label) }) : t(bar.label)) : clipLabel(element, asset)) : ""} width={width} height={height} selected={props.selected} dragging={props.dragging}
        hidden={shown.hidden} muted={element.muted === true && element.type === "audio"} locked={props.locked} offline={shown.badges.includes("media-offline")} filmstrip={filmstrip} waveform={waveform} badges={shown.showHeader ? badges : undefined}
        group={shown.badges.includes("group") ? (props.groupSelected ? "selected" : "idle") : undefined} trimAdjusted={props.trimAdjusted ? "end" : undefined} trimHandleWidth={props.trimHandle ?? TIMELINE_FRAME.trimHandle} />
      <ClipSyncOverlay mediaId={(element as { mediaId?: string }).mediaId} elementId={element.id} name={asset?.name ?? element.name} width={width} height={height} />
      {diamonds.map((time) => <View key={time} pointerEvents="none" style={{ position: "absolute", left: timeline.ticksToPixels(time, zoomLevel) - 4, bottom: 4 }}><KeyframeDiamond /></View>)}
    </View>
  );
}, sameClip);

/** The rows are laid out again for every document; a row that came out the same is the same row to what draws it. */
export const sameRow = (a: TimelineRow, b: TimelineRow): boolean => a === b || (Object.keys(a) as (keyof TimelineRow)[]).every((key) => Object.is(a[key], b[key]));
/**
 * A clip is drawn again for its own element, its row and its own state — not for an edit of another clip. Of the
 * document it reads the media library and the project settings (a compound clip reads the scenes too), so another
 * document with the same two is the same document to it.
 */
function sameClip(before: TimelineClipProps, after: TimelineClipProps): boolean {
  for (const key of Object.keys(after) as (keyof TimelineClipProps)[]) {
    if (Object.is(before[key], after[key])) continue;
    if (key === "row" && sameRow(before.row, after.row)) continue;
    if (key === "document" && after.element.type !== "compound" && before.document.media === after.document.media && before.document.settings === after.document.settings) continue;
    return false;
  }
  return Object.keys(before).length === Object.keys(after).length;
}

/** The ghost of a clip that would land on a row, and the line where a new track would open. */
export function DropFeedback(props: { ghost?: { left: number; top: number; width: number; height: number } | null; line?: { top: number; width: number } | null }) {
  return (
    <>
      {props.ghost ? <View pointerEvents="none" style={{ position: "absolute", left: props.ghost.left, top: props.ghost.top, zIndex: 4 }}><DropIndicator kind="ghost" width={props.ghost.width} height={props.ghost.height} /></View> : null}
      {props.line ? <View pointerEvents="none" style={{ position: "absolute", left: 0, top: props.line.top - 1, zIndex: 4 }}><DropIndicator kind="insert" width={props.line.width} /></View> : null}
    </>
  );
}
