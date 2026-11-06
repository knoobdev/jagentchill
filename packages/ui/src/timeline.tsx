/**
 * Timeline atoms: appearance only. Row heights, ruler and marker sizes, playhead and handle sizes and every touch dimension
 * belong to `timeline-editing` and `mobile-editor`; the atoms take them as props and state none of them.
 */
import { useState, type ReactNode } from "react";
import { TextInput, View, type ViewStyle } from "react-native";
import Svg, { Path, Polygon, Rect } from "react-native-svg";
import { Icon, type IconName } from "./Icon.tsx";
import { IconButton, ToggleButton } from "./button.tsx";
import { clipName, rulerStep } from "./logic/content.ts";
import { Slider } from "./slider.tsx";
import { Tap, keyOf, type ForcedState, type KeyEvent } from "./tap.tsx";
import { Text } from "./text.tsx";
import { useTheme } from "./theme.tsx";
import { MARKER_COLORS, borderWidth, opacity, radius, size, space, type ClipType, type ColorToken } from "./tokens.ts";
import type { StringKey } from "./strings.ts";

const FILL: ViewStyle = { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 };
// `backgroundImage` on web, `experimental_backgroundImage` on native.
const image = (value: string): object => ({ experimental_backgroundImage: value, backgroundImage: value });

/** Major ticks 8 px, minor ticks 4 px, labels in `type/caption` `timeline/ruler-text`; tick spacing never falls below 6 px. */
export function Ruler(props: { width: number; height: number; pixelsPerUnit: number; minorSteps: readonly number[]; majorEvery: number; label(unit: number): string }) {
  const theme = useTheme();
  const step = rulerStep(props.pixelsPerUnit, props.minorSteps, size.rulerMinGap);
  const count = Math.floor(props.width / (step * props.pixelsPerUnit)) + 1;
  const line = theme.color("border/strong");
  return (
    <View accessible={false} style={{ width: props.width, height: props.height, borderBottomWidth: borderWidth.hairline, borderBottomColor: theme.color("border/hairline") }}>
      {Array.from({ length: count }, (_, index) => {
        const major = index % props.majorEvery === 0;
        const x = index * step * props.pixelsPerUnit;
        return (
          <View key={index} pointerEvents="none" style={{ position: "absolute", start: x, bottom: 0, top: 0 }}>
            <View style={{ position: "absolute", bottom: 0, width: borderWidth.hairline, height: major ? size.rulerMajor : size.rulerMinor, backgroundColor: line }} />
            {major ? <Text variant="caption" color="timeline/ruler-text" tabular numberOfLines={1} style={{ position: "absolute", top: space[0.5], start: space[1] }}>{props.label(index * step)}</Text> : null}
          </View>
        );
      })}
    </View>
  );
}

/** The playhead: line and round handle in `timeline/playhead`. */
export function Playhead(props: { height: number; lineWidth: number; handle: number; label?: string }) {
  const theme = useTheme();
  const colour = theme.color("timeline/playhead");
  return (
    <View accessible accessibilityLabel={props.label ?? theme.t("playhead")} pointerEvents="none" style={{ width: props.lineWidth, height: props.height, backgroundColor: colour }}>
      <View testID="playhead-handle" style={{ position: "absolute", top: 0, start: -(props.handle - props.lineWidth) / 2, width: props.handle, height: props.handle, borderRadius: radius.full, backgroundColor: colour }} />
    </View>
  );
}

/** Track header: an inline-renamable name and the icon toggles hide, lock and mute. */
export function TrackHeader(props: { name: string; onRename?(name: string): void; width: number; height: number; hidden: boolean; locked: boolean; muted: boolean; onToggle(what: "hidden" | "locked" | "muted", on: boolean): void; hasAudio?: boolean }) {
  const theme = useTheme();
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => { if (draft !== null && draft.trim() && draft !== props.name) props.onRename?.(draft.trim()); setDraft(null); };
  return (
    <View style={{ width: props.width, height: props.height, flexDirection: "row", alignItems: "center", paddingStart: space[2], borderEndWidth: borderWidth.hairline, borderEndColor: theme.color("border/hairline") }}>
      {draft !== null ? (
        <TextInput autoFocus selectTextOnFocus accessibilityLabel={theme.t("rename")} aria-label={theme.t("rename")} value={draft} onChangeText={setDraft} onBlur={commit}
          {...({ "data-escape": "", onKeyPress: (event: KeyEvent) => { const key = keyOf(event); if (key.key === "Enter") { key.preventDefault(); commit(); } if (key.key === "Escape") { key.preventDefault(); setDraft(null); } } } as object)}
          style={[theme.type("meta"), { flex: 1, minWidth: 0, padding: 0, color: theme.color("text/primary"), outlineWidth: 0 }]} />
      ) : (
        <Tap label={props.name} onDoublePress={props.onRename ? () => setDraft(props.name) : undefined} onPress={() => {}} onKeyDown={(key) => { if (key.key === "F2" && props.onRename) setDraft(props.name); }} style={{ flex: 1, minWidth: 0, borderRadius: radius.xs }}>
          <Text variant="meta" color="text/secondary" numberOfLines={1}>{props.name}</Text>
        </Tap>
      )}
      <ToggleButton icon={props.hidden ? "eye-off" : "eye"} size="xs" label={theme.t("hideTrack")} on={props.hidden} onChange={(on) => props.onToggle("hidden", on)} />
      <ToggleButton icon="lock" size="xs" label={theme.t("lockTrack")} on={props.locked} onChange={(on) => props.onToggle("locked", on)} />
      {props.hasAudio === false ? null : <ToggleButton icon={props.muted ? "mute" : "vol"} size="xs" label={theme.t("muteTrack")} on={props.muted} onChange={(on) => props.onToggle("muted", on)} />}
    </View>
  );
}

/** A lane: `timeline/track-bg` or its alternate; a locked track is hatched at 45° in `border/strong` at an 8 px pitch; a lane that would accept the current drag is outlined in `timeline/selection`. */
export function TrackLane(props: { height: number; alt?: boolean; locked?: boolean; dropTarget?: boolean; children?: ReactNode; style?: ViewStyle }) {
  const theme = useTheme();
  return (
    <View style={[{ height: props.height, backgroundColor: theme.color(props.alt ? "timeline/track-bg-alt" : "timeline/track-bg"), flexGrow: 1 }, props.style]}>
      {props.children}
      {props.locked ? <View pointerEvents="none" testID="lane-hatch" style={[FILL, image(`repeating-linear-gradient(45deg, ${theme.color("border/strong")} 0 ${borderWidth.hairline}px, transparent ${borderWidth.hairline}px ${size.hatchPitch}px)`)]} /> : null}
      {props.dropTarget ? <View pointerEvents="none" testID="drop-highlight" style={[FILL, { borderWidth: size.selectionOutline, borderColor: theme.color("timeline/selection") }]} /> : null}
    </View>
  );
}

/** A label or badge of a clip. Over a filmstrip or waveform it sits on a `clip/label-scrim` pill; on a flat fill it is drawn directly. */
function OnClip(props: { scrim: boolean; children: ReactNode; opaque?: boolean }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space[0.5], borderRadius: radius.xs, paddingVertical: props.scrim ? space[0.5] : 0, paddingHorizontal: props.scrim ? space[1] : 0, backgroundColor: props.scrim ? theme.color("clip/label-scrim") : "transparent", flexShrink: 0 }}>
      {props.children}
    </View>
  );
}

export type ClipBadges = { speed?: string; duration?: string; muted?: boolean; linked?: boolean; anchored?: boolean; keyframes?: boolean; effects?: boolean };
export type ClipProps = {
  type: ClipType; label: string; width: number; height: number;
  /** Colour token override, for "Timeline clip colours: By track". */
  fill?: ColorToken;
  selected?: boolean; dragging?: boolean; hidden?: boolean; muted?: boolean; locked?: boolean; offline?: boolean; dropTarget?: boolean; forceState?: ForcedState;
  filmstrip?: ReactNode; waveform?: ReactNode; badges?: ClipBadges;
  /** A member of a group: a bar along the top edge, at 60% opacity when the group is not selected. */
  group?: "selected" | "idle";
  provenance?: "script" | "workflow" | "film";
  /** The transient "Trim adjusted" tag, anchored to the trimmed edge. */
  trimAdjusted?: "start" | "end";
  /** Width of the trim handles drawn when selected; owned by the timeline's gesture constants. */
  trimHandleWidth: number; onPress?(): void;
};
const PROVENANCE: Record<NonNullable<ClipProps["provenance"]>, [IconName, StringKey]> = { script: ["doc", "fromScript"], workflow: ["flow", "fromWorkflow"], film: ["film", "fromFilm"] };

/** A clip: radius 4, fill by `clip/*` token, with every state of the timeline. */
export function Clip(props: ClipProps) {
  const theme = useTheme();
  const scrim = Boolean(props.filmstrip || props.waveform || props.offline);
  const fill = theme.color(props.fill ?? `clip/${props.type}`);
  const selection = theme.color("timeline/selection");
  const badges = props.badges ?? {};
  const name = clipName(props.label, { offline: props.offline, muted: props.muted || badges.muted, hidden: props.hidden, locked: props.locked }, theme.t);
  const inset = props.selected ? props.trimHandleWidth + size.clipInset : size.clipInset;
  const badge = (key: string, content: ReactNode) => <OnClip key={key} scrim={scrim}>{content}</OnClip>;
  return (
    <Tap role="button" label={name} selected={props.selected} onPress={props.onPress} forceState={props.forceState} noRing
      style={[{ width: props.width, height: props.height, borderRadius: radius.xs, opacity: props.dragging ? opacity["clip/dragging"] : 1 }, props.dragging ? theme.elevation(2) : null, props.dragging ? { borderWidth: 0 } : null]}>
      {(state) => (
        <>
          {/* A hidden clip renders its whole body at 50%; its label and badges stay at full opacity. */}
          <View style={[FILL, { borderRadius: radius.xs, overflow: "hidden", backgroundColor: fill, opacity: props.hidden ? opacity["clip/hidden"] : 1 }]}>
            {props.filmstrip ? <View style={[FILL, { top: size.clipLabel }]}>{props.filmstrip}</View> : null}
            {/* A muted clip keeps its fill; only its waveform drops to 35%. */}
            {props.waveform ? <View style={[FILL, { top: props.filmstrip ? "50%" : size.clipLabel }]}>{props.waveform}</View> : null}
            {props.offline ? <View testID="offline-stripe" style={[FILL, image(`repeating-linear-gradient(45deg, ${theme.color("danger")} 0 ${size.offlineStripe}px, ${theme.color("preview/offline-fill")} ${size.offlineStripe}px ${2 * size.offlineStripe}px)`)]} /> : null}
            {props.locked ? <View testID="clip-hatch" style={[FILL, image(`repeating-linear-gradient(45deg, ${theme.color("border/strong")} 0 ${borderWidth.hairline}px, transparent ${borderWidth.hairline}px ${size.hatchPitch}px)`)]} /> : null}
          </View>
          {props.group ? <View pointerEvents="none" testID="group-marker" style={{ position: "absolute", top: 0, start: 0, end: 0, height: size.selectionOutline, backgroundColor: selection, opacity: props.group === "selected" ? 1 : opacity["group/idle"] }} /> : null}
          <View pointerEvents="none" style={{ position: "absolute", top: space[0.5], start: inset, end: inset, flexDirection: "row", alignItems: "center", gap: space[1] }}>
            {props.provenance ? (
              <View accessible accessibilityLabel={theme.t(PROVENANCE[props.provenance][1])} style={{ height: size.provenance, minWidth: size.provenance, borderRadius: radius.full, backgroundColor: theme.color("bg/elevated"), alignItems: "center", justifyContent: "center" }}>
                <Icon name={PROVENANCE[props.provenance][0]} size={12} color="text/secondary" />
              </View>
            ) : null}
            {props.offline ? <OnClip scrim><Icon name="warn" size={12} color="clip/label" /></OnClip> : null}
            <View style={{ flexShrink: 1, minWidth: 0 }}><OnClip scrim={scrim}><Text variant="caption" color="clip/label" numberOfLines={1}>{props.label}</Text></OnClip></View>
            <View style={{ flex: 1 }} />
            {/* Badges are 14 px and aligned to the inline-end. */}
            {props.hidden ? <OnClip scrim><Icon name="eye-off" size={14} color="clip/label" label={theme.t("hidden")} /></OnClip> : null}
            {props.muted || badges.muted ? <OnClip scrim><Icon name="mute" size={14} color="clip/label" label={theme.t("muted")} /></OnClip> : null}
            {badges.speed ? badge("speed", <Text variant="caption" color="clip/label" tabular>{badges.speed}</Text>) : null}
            {badges.linked ? badge("link", <Icon name="link" size={14} color="clip/label" label={theme.t("linked")} />) : null}
            {badges.anchored ? badge("anchor", <View testID="timing-anchor-badge"><Icon name="link" size={14} color="clip/label" label={theme.t("linked")} /></View>) : null}
            {badges.keyframes ? badge("kf", <Icon name="keyframe" size={14} color="clip/label" label={theme.t("keyframes")} />) : null}
            {badges.effects ? badge("fx", <Icon name="sparkles" size={14} color="clip/label" label={theme.t("effects")} />) : null}
            {badges.duration ? badge("duration", <Text variant="caption" color="clip/label" tabular>{badges.duration}</Text>) : null}
          </View>
          {props.selected ? (
            <>
              <View pointerEvents="none" testID="clip-selection" style={[FILL, { borderRadius: radius.xs, borderWidth: size.selectionOutline, borderColor: selection }]} />
              <View testID="trim-handle-start" style={{ position: "absolute", top: 0, bottom: 0, start: 0, width: props.trimHandleWidth, backgroundColor: selection, borderTopStartRadius: radius.xs, borderBottomStartRadius: radius.xs }} />
              <View testID="trim-handle-end" style={{ position: "absolute", top: 0, bottom: 0, end: 0, width: props.trimHandleWidth, backgroundColor: selection, borderTopEndRadius: radius.xs, borderBottomEndRadius: radius.xs }} />
            </>
          ) : state.hovered ? <View pointerEvents="none" testID="clip-hover" style={[FILL, { borderRadius: radius.xs, borderWidth: borderWidth.hairline, borderColor: selection, opacity: opacity["clip/hover-outline"] }]} /> : null}
          {props.dropTarget ? <View pointerEvents="none" testID="drop-highlight" style={[FILL, { borderRadius: radius.xs, borderWidth: size.selectionOutline, borderColor: selection }]} /> : null}
          {props.trimAdjusted ? (
            <View pointerEvents="none" style={{ position: "absolute", bottom: space[0.5], [props.trimAdjusted]: space[0.5], backgroundColor: theme.color("warning/subtle"), borderRadius: radius.full, paddingHorizontal: space[1.5] }}>
              <Text variant="caption" color="warning/text" live="polite">{theme.t("trimAdjusted")}</Text>
            </View>
          ) : null}
        </>
      )}
    </Tap>
  );
}

/** Thumbnails that fill the clip height. */
export function Filmstrip(props: { frames: ReactNode[] }) {
  return <View style={[FILL, { flexDirection: "row" }]}>{props.frames.map((frame, index) => <View key={index} style={{ flex: 1, overflow: "hidden" }}>{frame}</View>)}</View>;
}

/**
 * A waveform in `waveform/fill`, with the tips of peaks above 0 dBFS in `waveform/clip` and beat markers as 6 px dots in
 * `waveform/beat` along the bottom. `muted` draws it at 35% opacity: the one muted-waveform opacity.
 */
export function Waveform(props: { peaks: readonly number[]; width: number; height: number; muted?: boolean; beats?: readonly number[] }) {
  const theme = useTheme();
  const step = props.width / Math.max(1, props.peaks.length);
  const middle = props.height / 2;
  let body = "", tips = "";
  props.peaks.forEach((peak, index) => {
    const x = index * step + step / 2;
    const half = Math.min(1, Math.abs(peak)) * middle;
    body += `M${x} ${middle - half}V${middle + half}`;
    if (Math.abs(peak) > 1) tips += `M${x} 0V${Math.min(middle, 3)}M${x} ${props.height}V${props.height - Math.min(middle, 3)}`;
  });
  return (
    <View style={{ width: props.width, height: props.height }}>
      <View testID="waveform" style={{ opacity: props.muted ? opacity["waveform/muted"] : 1 }}>
        <Svg width={props.width} height={props.height}>
          <Path d={body} stroke={theme.color("waveform/fill")} strokeWidth={Math.max(1, step * 0.6)} fill="none" />
          {tips ? <Path d={tips} stroke={theme.color("waveform/clip")} strokeWidth={Math.max(1, step * 0.6)} fill="none" /> : null}
        </Svg>
      </View>
      {props.beats?.map((beat) => <View key={beat} testID="beat" style={{ position: "absolute", bottom: 0, start: beat * props.width - size.beatDot / 2, width: size.beatDot, height: size.beatDot, borderRadius: radius.full, backgroundColor: theme.color("waveform/beat") }} />)}
    </View>
  );
}

/** A keyframe diamond: 8 px (12 px selected) `keyframe/fill` with a `clip/label` outline at all times — 1 px, 2 px when selected — so it reaches 3:1 on every clip fill. */
export function KeyframeDiamond(props: { selected?: boolean; label?: string; onPress?(): void }) {
  const theme = useTheme();
  const box = props.selected ? size.keyframeSelected : size.keyframe;
  const diamond = <View style={{ width: box, height: box, backgroundColor: theme.color("keyframe/fill"), borderWidth: props.selected ? borderWidth.focus : borderWidth.hairline, borderColor: theme.color("clip/label"), transform: [{ rotate: "45deg" }] }} />;
  return props.onPress ? <Tap role="button" label={props.label} selected={props.selected} onPress={props.onPress} target>{diamond}</Tap> : diamond;
}

/** A marker: a flag filled with its `marker/n` colour and outlined in `timeline/selection`, and a 1 px line of the marker colour through the tracks. The accessible name includes the colour name. */
export function Marker(props: { color: number; flag: { width: number; height: number }; lineHeight: number; name?: string; onPress?(): void }) {
  const theme = useTheme();
  const [token, colourName] = MARKER_COLORS[((props.color % MARKER_COLORS.length) + MARKER_COLORS.length) % MARKER_COLORS.length]!;
  const colour = theme.color(token);
  const { width, height } = props.flag;
  const label = [props.name, theme.t("marker", { color: theme.t(`marker${colourName}` as StringKey) })].filter(Boolean).join(", ");
  const inset = borderWidth.hairline / 2;
  return (
    <Tap role="button" label={label} onPress={props.onPress} style={{ width, alignItems: "center" }}>
      <Svg width={width} height={height}>
        <Polygon points={`${inset},${inset} ${width - inset},${inset} ${width - inset},${height * 0.6} ${width / 2},${height - inset} ${inset},${height * 0.6}`} fill={colour} stroke={theme.color("timeline/selection")} strokeWidth={borderWidth.hairline} />
      </Svg>
      <View style={{ width: size.markerLine, height: props.lineHeight, backgroundColor: colour }} />
    </Tap>
  );
}

/** A 1 px `timeline/snap` line across all tracks. */
export function SnapLine(props: { height: number }) {
  const theme = useTheme();
  return <View pointerEvents="none" testID="snap-line" style={{ width: borderWidth.hairline, height: props.height, backgroundColor: theme.color("timeline/snap") }} />;
}

/** A rounded square between adjacent clips: a transition glyph when set, a "+" when empty. */
export function TransitionHandle(props: { size: number; set: boolean; selected?: boolean; label?: string; onPress?(): void }) {
  const theme = useTheme();
  return (
    <Tap role="button" label={props.label ?? theme.t("addTransition")} selected={props.selected} onPress={props.onPress}
      style={[{ width: props.size, height: props.size, borderRadius: radius.xs, backgroundColor: theme.color("bg/elevated"), alignItems: "center", justifyContent: "center" }, theme.elevation(1),
        { borderWidth: props.selected ? borderWidth.focus : borderWidth.hairline, borderColor: theme.color(props.selected ? "timeline/selection" : "border/control") }]}>
      <Icon name={props.set ? "transition" : "plus"} size={12} />
    </Tap>
  );
}

/** The in/out range: a `timeline/range` tint with 2 px edge lines. */
export function RangeBar(props: { width: number; height: number }) {
  const theme = useTheme();
  return <View pointerEvents="none" testID="range-bar" style={{ width: props.width, height: props.height, backgroundColor: theme.color("timeline/range"), borderStartWidth: size.rangeEdge, borderEndWidth: size.rangeEdge, borderColor: theme.color("accent") }} />;
}

/** Drop feedback: a 2 px `accent` line for new-track insertion, an `accent/subtle` ghost for placement. The highlight of a receiving lane or clip is their `dropTarget` state. */
export function DropIndicator(props: { kind: "insert" | "ghost"; width: number; height?: number }) {
  const theme = useTheme();
  return props.kind === "insert"
    ? <View pointerEvents="none" testID="drop-insert" style={{ width: props.width, height: borderWidth.focus, backgroundColor: theme.color("accent") }} />
    : <View pointerEvents="none" testID="drop-ghost" style={{ width: props.width, height: props.height, borderRadius: radius.xs, backgroundColor: theme.color("accent/subtle"), borderWidth: borderWidth.hairline, borderColor: theme.color("accent") }} />;
}

/** A 96 px zoom track in `border/control` with − and + buttons. */
export function ZoomSlider(props: { value: number; min: number; max: number; step?: number; onChange(value: number): void }) {
  const theme = useTheme();
  const step = props.step ?? (props.max - props.min) / 10;
  const set = (value: number) => props.onChange(Math.max(props.min, Math.min(props.max, value)));
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space[0.5] }}>
      <IconButton icon="minus" size="xs" label={theme.t("zoomOut")} disabled={props.value <= props.min} onPress={() => set(props.value - step)} />
      <View style={{ width: size.zoomTrack + size.sliderThumb }}><Slider label={theme.t("zoom")} min={props.min} max={props.max} step={props.step} value={props.value} onChange={(value) => set(value as number)} onCommit={(value) => set(value as number)} /></View>
      <IconButton icon="plus" size="xs" label={theme.t("zoomIn")} disabled={props.value >= props.max} onPress={() => set(props.value + step)} />
    </View>
  );
}

/** Transport: play/pause at `control/md` (`control/touch` at compact-touch density) and the timecode in `type/mono`, with tabular figures so it does not jitter. */
export function Transport(props: { playing: boolean; onToggle(): void; timecode: string; duration?: string; shortcut?: string; children?: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
      <IconButton icon={props.playing ? "pause" : "play"} size="md" label={theme.t(props.playing ? "pause" : "play")} shortcut={props.shortcut} onPress={props.onToggle} color="text/primary" />
      {props.children}
      <Text variant="mono" testID="timecode">{props.timecode}{props.duration ? <Text variant="mono" color="text/secondary">{` / ${props.duration}`}</Text> : null}</Text>
    </View>
  );
}

/** A clip-shaped placeholder: used by the catalogue to show a flat `Rect` thumbnail without any media. */
export function ThumbnailTile(props: { tone: ColorToken }) {
  const theme = useTheme();
  return <Svg width="100%" height="100%"><Rect width="100%" height="100%" fill={theme.color(props.tone)} /></Svg>;
}
