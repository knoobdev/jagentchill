import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { clampTextAnimation, setCaptionTrack, setTextAnimation, textAnimationsOf, TEXT_ANIMATIONS, timeline, type TextAnimationGroup, type TextAnimationSlot } from "@jagentchill/editor-core";
import { NumberField, Slider, Tabs, Tap, Text, radius, space, useTheme } from "@jagentchill/ui";
import { useT } from "../../locale";
import { useEditor } from "../context";
import { useCaptionApplyAll } from "./caption-store";
import { Note, objectOf, Row } from "./parts";

type El = timeline.El;
const SECOND = 120_000, HOVER_PREVIEW_MS = 300;
const GROUPS: { id: TextAnimationGroup; label: string }[] = [{ id: "in", label: "In" }, { id: "out", label: "Out" }, { id: "loop", label: "Loop" }];

/**
 * The Animation tab of a text or caption element: In, Out and Loop, each "None" plus the bundled animations of the
 * group, with the duration (or the period of a loop) and the strength of the chosen one. Hovering a tile loops the
 * affected part of the clip with that animation; a click records it.
 */
export function AnimationTab(props: { element: El }) {
  const t = useT();
  const theme = useTheme();
  const runtime = useEditor();
  const applyAll = useCaptionApplyAll();
  const [group, setGroup] = useState<TextAnimationGroup>("in");
  const { controller } = runtime, { element } = props, caption = element.type === "caption";
  const track = caption ? timeline.locate(controller.document, element.id)?.track : undefined;
  // A caption shows its own animation when it has one, the animation of its track otherwise.
  const own = objectOf(caption ? objectOf(element.style).textAnimation : element.textAnimation), ofTrack = objectOf(objectOf(objectOf(track?.caption).style).textAnimation);
  const stored = caption && Object.keys(own).length === 0 ? ofTrack : own, slot = objectOf(stored[group]), current = typeof slot.id === "string" ? slot.id : null;
  const write = (next: TextAnimationSlot, live = false) => controller.external((doc, ctx) => {
    if (!caption || !applyAll || !track) return setTextAnimation(doc, ctx, element.id, group, next);
    const before = objectOf(objectOf(objectOf(timeline.locate(doc, element.id)?.track.caption).style).textAnimation);
    return setCaptionTrack(doc, ctx, track.id, { style: { textAnimation: clampTextAnimation(element.duration, before, group, next) ?? {} } }, "Text animation");
  }, live);
  const slotOf = (id: string): TextAnimationSlot => (current === id ? { id, duration: Number(slot.duration ?? 60_000), period: Number(slot.period ?? SECOND), strength: Number(slot.strength ?? 100) } : { id });
  /** The part of the clip an animation of this group plays in, on the timeline. */
  const range = (id: string | null) => {
    const length = group === "loop" ? Math.min(element.duration, 2 * Number(current === id ? slot.period ?? SECOND : SECOND)) : Math.min(element.duration, Number(current === id ? slot.duration ?? 60_000 : 60_000));
    const inEnd = Number(objectOf(stored.in).duration ?? 0);
    const start = group === "out" ? element.startTime + element.duration - length : group === "loop" ? element.startTime + Math.min(inEnd, element.duration - length) : element.startTime;
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
  const hover = (id: string | null, inside: boolean) => {
    if (!inside) { if (chosen.current === id) chosen.current = undefined; stop(); return; }
    if (id === null || chosen.current === id) return;
    // A pointer that rests on a tile for 300 ms previews it; one that only passes, or presses at once, does not.
    if (dwell.current) clearTimeout(dwell.current);
    dwell.current = setTimeout(() => { dwell.current = null; if (runtime.transport.playing) return; previewing.current = true; write(slotOf(id), true); runtime.previewLoop(range(id)); }, HOVER_PREVIEW_MS);
  };
  const choose = (id: string | null) => { chosen.current = id; stop(); write(id === null ? null : slotOf(id)); };
  const tile = (id: string | null, name: string) => (
    <Tap key={id ?? "none"} role="button" label={name} pressedState={current === id} testID={`text-animation-${group}-${id ?? "none"}`} onPress={() => choose(id)} onHoverIn={() => hover(id, true)} onHoverOut={() => hover(id, false)}
      style={(state) => ({ width: "31%", height: 36, alignItems: "center", justifyContent: "center", paddingHorizontal: space[1], borderRadius: radius.sm, borderWidth: current === id ? 2 : 1, borderColor: theme.color(current === id ? "accent/text" : state.hovered ? "border/strong" : "border/hairline"), backgroundColor: theme.color("bg/subtle") })}>
      <Text variant="meta" numberOfLines={1}>{name}</Text>
    </Tap>
  );
  const unknown = (["in", "out", "loop"] as const).some((entry) => { const id = objectOf(stored[entry]).id; return typeof id === "string" && !TEXT_ANIMATIONS.some((animation) => animation.id === id); });
  const seconds = (ticks: unknown, fallback: number) => Math.round((Number(ticks ?? fallback) / SECOND) * 10) / 10;
  const time = group === "loop" ? { label: "Period", key: "period" as const, min: 0.2, max: 5, value: seconds(slot.period, SECOND) } : { label: "Duration", key: "duration" as const, min: 0.1, max: Math.max(0.1, Math.round((element.duration / SECOND) * 10) / 10), value: seconds(slot.duration, 60_000) };
  const change = (fields: { duration?: number; period?: number; strength?: number }, live = false) => { if (current) write({ ...slotOf(current)!, ...fields }, live); };
  return (
    <View testID="animation-tab" style={{ padding: space[3], gap: space[2] }}>
      <Tabs id="text-animation-groups" label={t("Animation")} variant="pill" size="xs" items={GROUPS.map((entry) => ({ id: entry.id, label: t(entry.label) }))} value={group} onChange={(id) => { stop(); setGroup(id as TextAnimationGroup); }} />
      {unknown ? <Note tone="warning" testID="animation-missing">{t("Animation not available in this version")}</Note> : null}
      <View testID={`text-animations-${group}`} style={{ flexDirection: "row", flexWrap: "wrap", columnGap: "3.5%", rowGap: space[2] }}>
        {tile(null, t("None"))}
        {textAnimationsOf(group).map((animation) => tile(animation.id, t(animation.name)))}
      </View>
      {current ? (
        <View style={{ gap: space[1.5], paddingTop: space[1] }}>
          <Row label={t(time.label)} testID="text-animation-time">
            <View style={{ flex: 1 }}><Slider label={t(time.label)} min={time.min} max={time.max} step={0.1} value={Math.min(time.max, Math.max(time.min, time.value))} defaultValue={group === "loop" ? 1 : 0.5} onChange={(next) => change({ [time.key]: Math.round((next as number) * SECOND) }, true)} onCommit={(next) => change({ [time.key]: Math.round((next as number) * SECOND) })} /></View>
            <NumberField label={t(time.label)} hideLabel size="sm" width={64} unit="s" min={time.min} max={time.max} step={0.1} value={time.value} onCommit={(next) => change({ [time.key]: Math.round(next * SECOND) })} />
          </Row>
          <Row label={t("Strength")} testID="text-animation-strength">
            <View style={{ flex: 1 }}><Slider label={t("Strength")} min={0} max={100} step={1} value={Number(slot.strength ?? 100)} defaultValue={100} onChange={(next) => change({ strength: next as number }, true)} onCommit={(next) => change({ strength: next as number })} /></View>
            <NumberField label={t("Strength")} hideLabel size="sm" width={64} unit="%" min={0} max={100} step={1} value={Number(slot.strength ?? 100)} onCommit={(next) => change({ strength: Math.round(next) })} />
          </Row>
        </View>
      ) : null}
    </View>
  );
}
