import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import {
  clampClipAnimation, clipAnimationLimit, clipAnimationsOf, CLIP_ANIMATION_GROUPS, MOTION_BLUR_SAMPLES, motionBlurOf, setClipAnimation, setMotionBlur, timeline,
  type ClipAnimationGroup, type ClipAnimationSlot,
} from "@jagentchill/editor-core";
import type { Rational } from "@jagentchill/protocol";
import { Input, NumberField, Select, Slider, Tabs, Tap, Text, radius, space, useTheme } from "@jagentchill/ui";
import { useT } from "../../locale";
import { useEditor } from "../context";
import { KeyToggle } from "./keys";
import { Note, objectOf, Row, Section, shared, shownAt, writePath } from "./parts";

type El = timeline.El;
const SECOND = 120_000, HOVER_PREVIEW_MS = 300;
const GROUP_LABELS: Record<ClipAnimationGroup, string> = { in: "In", out: "Out", combo: "Combo" };
const seconds = (ticks: number): number => Math.round((ticks / SECOND) * 10) / 10;

/**
 * The Animation tab of a video, image, sticker, shape or compound clip: In, Out and Combo, each "None" plus the
 * bundled animations of the group with a search, and the duration and the strength of the chosen one; under them the
 * motion blur of the clip. Resting on a tile loops the affected part of the clip with that animation in the preview;
 * a click records it for every selected clip and plays that part once.
 */
export function ClipAnimationTab(props: { elements: El[]; playhead: number }) {
  const t = useT();
  const theme = useTheme();
  const runtime = useEditor();
  const [group, setGroup] = useState<ClipAnimationGroup>("in");
  const [query, setQuery] = useState("");
  const { controller } = runtime, { elements } = props, [first] = elements, ids = elements.map((element) => element.id);
  const fps = controller.document.settings.fps as Rational;
  const stored = objectOf(first.clipAnimation), slot = objectOf(stored[group]);
  // Several clips show a tile as chosen only when all of them have it.
  const current = shared(elements.map((element) => { const type = objectOf(objectOf(element.clipAnimation)[group]).type; return typeof type === "string" ? type : null; }));
  const rows = clipAnimationsOf(group);
  const write = (next: ClipAnimationSlot, live = false) => controller.external((doc, ctx) => setClipAnimation(doc, ctx, ids, group, next), live);
  /** The slot a tile stands for: the chosen one keeps its duration and strength, another starts from the defaults of its group. */
  const slotOf = (type: string): NonNullable<ClipAnimationSlot> => (current === type && typeof slot.duration === "number" ? { type, duration: slot.duration, strength: Number(slot.strength ?? 100) } : { type });
  /** The part of the first clip an animation of this group runs in, on the timeline. */
  const rangeOf = (element: El, next: ClipAnimationSlot) => {
    const after = objectOf(objectOf(clampClipAnimation(element as never, group, next, fps))[group]), length = Math.min(element.duration, Number(after.duration ?? 0));
    const start = group === "out" ? element.startTime + element.duration - length : element.startTime;
    return { start, end: start + length };
  };
  // The tile that was just chosen does not preview again until the pointer has left it: its animation is now the clip's own.
  const chosen = useRef<string | null | undefined>(undefined), previewing = useRef(false), dwell = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stop = () => {
    if (dwell.current) { clearTimeout(dwell.current); dwell.current = null; }
    if (!previewing.current) return;
    previewing.current = false;
    runtime.previewLoop(null); controller.discardPreview();
  };
  useEffect(() => stop, []); // eslint-disable-line react-hooks/exhaustive-deps
  const hover = (type: string | null, inside: boolean) => {
    if (!inside) { if (chosen.current === type) chosen.current = undefined; stop(); return; }
    if (type === null || chosen.current === type) return;
    // A pointer that rests on a tile for 300 ms previews it; one that only passes, or presses at once, does not.
    if (dwell.current) clearTimeout(dwell.current);
    dwell.current = setTimeout(() => { dwell.current = null; if (runtime.transport.playing) return; previewing.current = true; write(slotOf(type), true); runtime.previewLoop(rangeOf(first, slotOf(type))); }, HOVER_PREVIEW_MS);
  };
  const choose = (type: string | null) => {
    chosen.current = type; stop();
    const next = type === null ? null : slotOf(type);
    if (!write(next) || next === null) return;
    // The affected range plays once, and the playhead returns to where it was.
    const after = timeline.locate(controller.stored, first.id)?.element;
    if (after) runtime.previewRange(rangeOf(after, objectOf(objectOf(after.clipAnimation)[group]) as never));
  };
  const tile = (type: string | null, name: string) => (
    <Tap key={type ?? "none"} role="button" label={name} pressedState={current === type} testID={`clip-animation-${group}-${type ?? "none"}`} onPress={() => choose(type)} onHoverIn={() => hover(type, true)} onHoverOut={() => hover(type, false)}
      style={(state) => ({ width: "31%", height: 36, alignItems: "center", justifyContent: "center", paddingHorizontal: space[1], borderRadius: radius.sm, borderWidth: current === type ? 2 : 1, borderColor: theme.color(current === type ? "accent/text" : state.hovered ? "border/strong" : "border/hairline"), backgroundColor: theme.color("bg/subtle") })}>
      <Text variant="meta" numberOfLines={1}>{name}</Text>
    </Tap>
  );
  const unknown = CLIP_ANIMATION_GROUPS.some((entry) => { const type = objectOf(stored[entry]).type; return typeof type === "string" && !clipAnimationsOf(entry).some((row) => row.id === type); });
  const wanted = query.trim().toLowerCase(), found = rows.filter((row) => wanted === "" || t(row.name).toLowerCase().includes(wanted) || row.name.toLowerCase().includes(wanted));
  // In and Out share the clip: the slider of one ends where the other begins.
  const limit = Math.min(...elements.map((element) => clipAnimationLimit(element as never, group))), max = Math.max(0.1, Math.floor((limit / SECOND) * 10) / 10);
  const length = seconds(Number(slot.duration ?? (group === "combo" ? first.duration : SECOND / 2)));
  const change = (fields: { duration?: number; strength?: number }, live = false) => { if (current) write({ ...slotOf(current), duration: Number(slot.duration ?? (group === "combo" ? first.duration : SECOND / 2)), ...fields }, live); };
  const replaces = group === "combo" && elements.some((element) => { const own = objectOf(element.clipAnimation); return own.in !== undefined || own.out !== undefined; });
  return (
    <View testID="clip-animation-tab">
      <View style={{ padding: space[3], gap: space[2] }}>
        <Tabs id="clip-animation-groups" label={t("Animation")} variant="pill" size="xs" items={CLIP_ANIMATION_GROUPS.map((entry) => ({ id: entry, label: t(GROUP_LABELS[entry]) }))} value={group} onChange={(id) => { stop(); setGroup(id as ClipAnimationGroup); }} />
        <View testID="clip-animation-search"><Input accessibilityLabel={t("Search animations")} placeholder={t("Search animations")} leadingIcon="search" size="sm" value={query} onChangeText={setQuery} /></View>
        {replaces ? <Note testID="clip-animation-combo-notice">{t("Combo replaces In and Out")}</Note> : null}
        {unknown ? <Note tone="warning" testID="clip-animation-missing">{t("Animation not available in this version")}</Note> : null}
        <View testID={`clip-animations-${group}`} style={{ flexDirection: "row", flexWrap: "wrap", columnGap: "3.5%", rowGap: space[2] }}>
          {wanted === "" ? tile(null, t("None")) : null}
          {found.map((row) => tile(row.id, t(row.name)))}
        </View>
        {wanted !== "" && found.length === 0 ? <Text variant="meta" color="text/secondary" testID="clip-animation-empty">{t("No animations match")}</Text> : null}
        {current ? (
          <View style={{ gap: space[1.5], paddingTop: space[1] }}>
            <Row label={t("Duration")} testID="clip-animation-duration">
              <View style={{ flex: 1 }}><Slider label={t("Duration")} min={0.1} max={max} step={0.1} value={Math.min(max, Math.max(0.1, length))} defaultValue={group === "combo" ? max : Math.min(max, 0.5)} onChange={(next) => change({ duration: Math.round((next as number) * SECOND) }, true)} onCommit={(next) => change({ duration: Math.round((next as number) * SECOND) })} /></View>
              <NumberField label={t("Duration")} hideLabel size="sm" width={64} unit="s" min={0.1} max={max} step={0.1} value={length} onCommit={(next) => change({ duration: Math.round(next * SECOND) })} />
            </Row>
            <Row label={t("Strength")} testID="clip-animation-strength">
              <View style={{ flex: 1 }}><Slider label={t("Strength")} min={0} max={100} step={1} value={Number(slot.strength ?? 100)} defaultValue={100} onChange={(next) => change({ strength: next as number }, true)} onCommit={(next) => change({ strength: next as number })} /></View>
              <NumberField label={t("Strength")} hideLabel size="sm" width={64} unit="%" min={0} max={100} step={1} value={Number(slot.strength ?? 100)} onCommit={(next) => change({ strength: Math.round(next) })} />
            </Row>
          </View>
        ) : null}
      </View>
      <MotionBlur elements={elements} playhead={props.playhead} />
    </View>
  );
}

/** The motion blur of the selected clips: its switch, the strength (keyframable) and the number of samples. */
function MotionBlur(props: { elements: El[]; playhead: number }) {
  const t = useT();
  const runtime = useEditor();
  const { elements } = props, [first] = elements, ids = elements.map((element) => element.id), single = elements.length === 1;
  const blur = motionBlurOf(first), enabled = elements.every((element) => motionBlurOf(element).enabled);
  const write = (change: Parameters<typeof setMotionBlur>[3], live = false) => runtime.controller.external((doc, ctx) => setMotionBlur(doc, ctx, ids, change), live);
  const strength = single ? shownAt(first, "motionBlur.strength", blur.strength, props.playhead) : blur.strength;
  // A keyframed strength is written as the key under the playhead.
  const setStrength = (next: number, live = false) => { if (single && enabled) writePath(runtime, first, "motionBlur.strength", Math.round(next), "Motion blur", live); else write({ strength: Math.round(next) }, live); };
  return (
    <Section id="motion-blur" title={t("Motion blur")} testID="motion-blur" enabled={enabled} onToggle={(on) => write({ enabled: on })} onReset={() => write({ strength: 50, samples: 8 })}>
      <Row label={t("Strength")} testID="motion-blur-strength">
        <View style={{ flex: 1 }}><Slider label={t("Motion blur strength")} min={0} max={100} step={1} value={Math.round(strength)} defaultValue={50} onChange={(next) => setStrength(next as number, true)} onCommit={(next) => setStrength(next as number)} /></View>
        <NumberField label={t("Motion blur strength")} hideLabel size="sm" width={64} unit="%" min={0} max={100} step={1} value={Math.round(strength)} onCommit={(next) => setStrength(next)} />
        {single ? <KeyToggle element={first} path="motionBlur.strength" value={strength} label={t("Motion blur strength")} playhead={props.playhead} testID="kf-motion-blur" /> : null}
      </Row>
      <Row label={t("Samples")} testID="motion-blur-samples">
        <View style={{ flex: 1 }}><Select label={t("Motion blur samples")} size="sm" value={String(blur.samples)} options={MOTION_BLUR_SAMPLES.map((count) => ({ value: String(count), label: String(count) }))} onChange={(next) => { write({ samples: Number(next) }); }} /></View>
      </Row>
      <Note>{t("Blurs the clip along its own movement: keyframes and clip animations")}</Note>
    </Section>
  );
}
