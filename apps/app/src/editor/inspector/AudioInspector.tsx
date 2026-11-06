import { useState } from "react";
import { View } from "react-native";
import { addBeats, clearBeats, deleteBeatAt, EQ_BAND_KEYS, FADE_SHAPE_LABELS, recoverAudio, setEq, setFade, setTrackDucking, storedVolume, timeline, upsertKeyframe, volumeLabel } from "@jagentchill/editor-core";
import { FADE_SHAPES, VOICE_EFFECTS } from "@jagentchill/protocol";
import { Button, ConfirmDialog, NumberField, Select, Slider, Switch, Text, space } from "@jagentchill/ui";
import { useT } from "../../locale";
import { loudnessSettled } from "../audio/loudness";
import { useEditor } from "../context";
import { KeyToggle } from "./keys";
import { Note, objectOf, Row, Section, shared, writeFields } from "./parts";

type El = timeline.El;
const SECOND = 120_000;
const keysOf = (element: El, path: string): unknown[] => ((objectOf(objectOf(element.animations)[path]).keys as unknown[] | undefined) ?? []);

/**
 * The Audio tab of audio-capable elements: Volume (with its keyframe toggle), Mute, Pan, Fade in and Fade out with
 * their shapes, and for a video Extract or Recover audio. Several elements are edited together; a value they do not
 * share shows as mixed.
 */
export function AudioInspector(props: { elements: El[]; playhead: number }) {
  const t = useT();
  const runtime = useEditor();
  const { controller } = runtime, { elements } = props, ids = elements.map((element) => element.id), [first] = elements, single = elements.length === 1;
  const volume = shared(elements.map((element) => Number(element.volume ?? 0))), pan = shared(elements.map((element) => Number(element.pan ?? 0)));
  const muted = elements.every((element) => element.muted === true);
  const fade = (side: "fadeIn" | "fadeOut") => ({ duration: shared(elements.map((element) => Number(objectOf(element[side]).duration ?? 0))), shape: shared(elements.map((element) => String(objectOf(element[side]).shape ?? "equal-power"))) });
  /** A keyframed volume is edited at the playhead; a plain one is the element's value. */
  const setVolume = (db: number, live: boolean) => {
    const value = storedVolume(db);
    if (single && keysOf(first, "volume").length > 0) controller.external((doc, ctx) => upsertKeyframe(doc, ctx, first.id, "volume", { time: Math.max(0, Math.round(props.playhead - first.startTime)), value }), live);
    else writeFields(runtime, ids, { volume: value }, "Volume", live);
  };
  const shownVolume = single && keysOf(first, "volume").length > 0 ? Number(timeline.valueAt(keysOf(first, "volume") as never, Math.max(0, props.playhead - first.startTime)) ?? volume ?? 0) : volume;
  const setFadeOf = (side: "fadeIn" | "fadeOut", change: { duration?: number; shape?: string }, live = false) => controller.external((doc, ctx) => setFade(doc, ctx, ids, side, change), live);
  const longest = Math.max(...elements.map((element) => element.duration)) / SECOND;
  const video = single && first.type === "video" ? first : null;
  return (
    <View testID="audio-inspector">
    <View style={{ padding: space[3], gap: space[1.5] }}>
      <Row label={t("Volume")} testID="audio-volume">
        <View style={{ flex: 1 }}><Slider label={t("Volume")} min={-60} max={20} step={0.1} value={shownVolume ?? 0} defaultValue={0} onChange={(next) => setVolume(next as number, true)} onCommit={(next) => setVolume(next as number, false)} /></View>
        <NumberField label={t("Volume")} hideLabel size="sm" width={76} unit="dB" min={-60} max={20} step={0.1} value={shownVolume === null ? null : Math.round(shownVolume * 10) / 10} onCommit={(next) => setVolume(next, false)} />
        {single ? <KeyToggle element={first} path="volume" value={shownVolume ?? 0} label={t("Volume")} playhead={props.playhead} testID="kf-volume" /> : null}
      </Row>
      {shownVolume !== null && shownVolume <= -60 ? <Text variant="meta" color="text/secondary" testID="audio-silent">{volumeLabel(shownVolume)}</Text> : null}
      <Row label={t("Mute")}><View testID="clip-mute"><Switch accessibilityLabel={t("Mute")} value={muted} onChange={() => { runtime.act("audio.mute.toggle"); }} /></View></Row>
      <Row label={t("Pan")} testID="audio-pan">
        <View style={{ flex: 1 }}><Slider label={t("Pan")} min={-100} max={100} step={1} centre value={pan ?? 0} defaultValue={0} onChange={(next) => writeFields(runtime, ids, { pan: next as number }, "Pan", true)} onCommit={(next) => writeFields(runtime, ids, { pan: next as number }, "Pan")} /></View>
        <NumberField label={t("Pan")} hideLabel size="sm" width={76} min={-100} max={100} step={1} value={pan} onCommit={(next) => writeFields(runtime, ids, { pan: Math.round(next) }, "Pan")} />
      </Row>
      {(["fadeIn", "fadeOut"] as const).map((side) => {
        const current = fade(side), label = side === "fadeIn" ? "Fade in" : "Fade out";
        return (
          <Row key={side} label={t(label)} testID={side === "fadeIn" ? "audio-fade-in" : "audio-fade-out"}>
            <View style={{ flex: 1 }}><Slider label={t(label)} min={0} max={10} step={0.1} value={Math.min(10, (current.duration ?? 0) / SECOND)} defaultValue={0} onChange={(next) => setFadeOf(side, { duration: (next as number) * SECOND }, true)} onCommit={(next) => setFadeOf(side, { duration: (next as number) * SECOND })} /></View>
            <NumberField label={t(label)} hideLabel size="sm" width={64} unit="s" min={0} max={Math.round(longest * 10) / 10} step={0.1} value={current.duration === null ? null : Math.round((current.duration / SECOND) * 10) / 10} onCommit={(next) => setFadeOf(side, { duration: next * SECOND })} />
            <View style={{ width: 96 }}><Select label={t("{name} shape", { name: t(label) })} size="sm" value={current.shape} placeholder="—" options={FADE_SHAPES.map((shape) => ({ value: shape, label: t(FADE_SHAPE_LABELS[shape]) }))} onChange={(shape) => setFadeOf(side, { shape })} /></View>
          </Row>
        );
      })}
      {video ? (
        <View style={{ flexDirection: "row", paddingTop: space[1] }}>
          {video.isSourceAudioEnabled === false
            ? <Button size="sm" kind="outline" icon="music" label={t("Recover audio")} testID="audio-recover" onPress={() => { controller.external((doc, ctx) => recoverAudio(doc, ctx, video.id)); }} />
            : <Button size="sm" kind="outline" icon="music" label={t("Extract audio")} testID="audio-extract" onPress={() => { runtime.act("audio.extract"); }} />}
        </View>
      ) : null}
    </View>
    <Processing elements={elements} playhead={props.playhead} />
    </View>
  );
}

const EQ_PRESET_NAMES: Record<string, string> = { flat: "Flat", "voice-clarity": "Voice clarity", "bass-boost": "Bass boost", "treble-boost": "Treble boost", warm: "Warm", radio: "Radio", custom: "Custom" };
const EQ_BAND_NAMES: Record<string, string> = { low: "100 Hz", lowMid: "300 Hz", mid: "1 kHz", highMid: "3 kHz", high: "10 kHz" };
const COMPRESSOR = [
  { key: "threshold", label: "Threshold", min: -60, max: 0, step: 1, unit: "dB", fallback: -18 }, { key: "ratio", label: "Ratio", min: 1, max: 20, step: 0.5, unit: ":1", fallback: 3 },
  { key: "attack", label: "Attack", min: 1, max: 200, step: 1, unit: "ms", fallback: 10 }, { key: "release", label: "Release", min: 10, max: 1000, step: 10, unit: "ms", fallback: 120 },
  { key: "makeup", label: "Make-up", min: 0, max: 24, step: 0.5, unit: "dB", fallback: 0 },
] as const;
const VOICE_EFFECT_ROWS = [
  { id: "none", label: "None" }, { id: "deep", label: "Deep" }, { id: "high", label: "High" }, { id: "chipmunk", label: "Chipmunk" }, { id: "giant", label: "Giant" }, { id: "robot", label: "Robot" }, { id: "echo", label: "Echo" }, { id: "hall", label: "Hall" },
  { id: "telephone", label: "Telephone" }, { id: "megaphone", label: "Megaphone" }, { id: "vinyl", label: "Vinyl" }, { id: "synth", label: "Synth" }, { id: "electronic", label: "Electronic" }, { id: "tremble", label: "Tremble" }, { id: "underwater", label: "Underwater" },
] as const;
const TARGETS = [{ value: "-23", label: "−23 LUFS (broadcast)" }, { value: "-16", label: "−16 LUFS (speech)" }, { value: "-14", label: "−14 LUFS (online video)" }] as const;
const signed = (value: number, digits = 1): string => `${value < 0 ? "−" : value > 0 ? "+" : ""}${Math.abs(value).toFixed(digits)}`;

/**
 * The processing sections of the Audio tab, each with its switch and reset: Normalise loudness (target, and what was
 * measured), Voice effects, Pitch, Equaliser (preset and five bands), Compressor, the Voice switch, Ducking of the
 * clip's track, and Beats.
 */
function Processing(props: { elements: El[]; playhead: number }) {
  const t = useT();
  const runtime = useEditor();
  const [clearing, setClearing] = useState(false);
  const { controller } = runtime, { elements } = props, ids = elements.map((element) => element.id), [first] = elements, single = elements.length === 1;
  const part = (key: string) => objectOf(first[key]);
  const on = (key: string) => elements.every((element) => objectOf(element[key]).enabled === true);
  const merge = (key: string, change: Record<string, unknown>, label: string, live = false) => writeFields(runtime, ids, (current) => ({ [key]: { ...objectOf(current[key]), ...change } }), label, live);
  const normalize = part("normalize"), eq = part("eq"), bands = objectOf(eq.bands), compressor = part("compressor");
  const effect = shared(elements.map((element) => String(objectOf(element.voiceEffect).type ?? "none"))) ?? "none";
  const pitched = elements.some((element) => Number(objectOf(element.pitch).semitones ?? 0) !== 0 || Number(objectOf(element.pitch).cents ?? 0) !== 0);
  const target = shared(elements.map((element) => Number(objectOf(element.normalize).target ?? -14)));
  const preset = shared(elements.map((element) => String(objectOf(element.eq).preset ?? "flat")));
  const gain = Number(normalize.gainDb ?? 0), lufs = typeof normalize.measuredLufs === "number" ? normalize.measuredLufs : null;
  const settled = single && loudnessSettled(first);
  const located = timeline.locate(controller.document, first.id), track = located?.track, ducking = objectOf(objectOf(track).ducking);
  const scene = timeline.sceneById(controller.document, controller.session.sceneId);
  const voices = timeline.tracksOfScene(scene).some((entry) => entry.id !== track?.id && entry.elements.some((element) => element.isVoice === true));
  const setDucking = (change: Parameters<typeof setTrackDucking>[3], live = false) => { if (track) controller.external((doc, ctx) => setTrackDucking(doc, ctx, track.id, change), live); };
  const beats = Array.isArray(first.beats) ? (first.beats as number[]) : [];
  const inside = props.playhead >= first.startTime && props.playhead <= first.startTime + first.duration;
  const frame = Math.round((120_000 * controller.stored.settings.fps.denominator) / controller.stored.settings.fps.numerator);
  const slider = (key: string, label: string, value: number, fallback: number, min: number, max: number, step: number, unit: string, write: (next: number, live: boolean) => void) => (
    <Row key={key} label={t(label)} testID={key}>
      <View style={{ flex: 1 }}><Slider label={t(label)} min={min} max={max} step={step} centre={min < 0 && max > 0} value={value} defaultValue={fallback} onChange={(next) => write(next as number, true)} onCommit={(next) => write(next as number, false)} /></View>
      <NumberField label={t(label)} hideLabel size="sm" width={72} unit={unit} min={min} max={max} step={step} value={value} onCommit={(next) => write(next, false)} />
    </Row>
  );
  return (
    <>
      <Section id="audio-normalize" title={t("Normalise loudness")} testID="audio-normalize" enabled={on("normalize")} onToggle={(enabled) => merge("normalize", { enabled }, "Normalise loudness")} onReset={() => merge("normalize", { target: -14 }, "Normalise loudness")}>
        <Row label={t("Target")} testID="normalize-target">
          <View style={{ flex: 1 }}><Slider label={t("Target loudness")} min={-30} max={-5} step={1} value={target ?? -14} defaultValue={-14} onChange={(next) => merge("normalize", { target: next as number }, "Normalise loudness", true)} onCommit={(next) => merge("normalize", { target: next as number }, "Normalise loudness")} /></View>
          <NumberField label={t("Target loudness")} hideLabel size="sm" width={84} unit="LUFS" min={-30} max={-5} step={1} value={target} onCommit={(next) => merge("normalize", { target: Math.round(next) }, "Normalise loudness")} />
        </Row>
        <Row label={t("Preset")}><View style={{ flex: 1 }} testID="normalize-preset"><Select label={t("Loudness preset")} size="sm" value={TARGETS.some((entry) => entry.value === String(target)) ? String(target) : null} placeholder={t("Custom")} options={TARGETS.map((entry) => ({ value: entry.value, label: t(entry.label) }))} onChange={(next) => merge("normalize", { target: Number(next) }, "Normalise loudness")} /></View></Row>
        {single ? <Note testID="normalize-measured">{!settled ? t("Measuring…") : lufs === null ? t("Clip is silent") : t("Measured {lufs} LUFS → {gain} dB", { lufs: signed(lufs), gain: signed(gain) })}</Note> : null}
        {single && settled && lufs !== null && gain < Math.min(24, (target ?? -14) - lufs) - 0.05 ? <Note testID="normalize-limited">{t("Limited by peak level")}</Note> : null}
      </Section>
      <Section id="audio-voice-effects" title={t("Voice effects")} testID="audio-voice-effects" enabled={effect !== "none"} onToggle={(enabled) => merge("voiceEffect", { type: enabled ? "deep" : "none" }, "Voice effect")} onReset={() => merge("voiceEffect", { type: "none", intensity: 100 }, "Voice effect")}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: "3.5%", rowGap: space[1.5] }}>
          {VOICE_EFFECT_ROWS.filter((entry) => (VOICE_EFFECTS as readonly string[]).includes(entry.id)).map((entry) => <Button key={entry.id} size="xs" kind={effect === entry.id ? "strong" : "outline"} label={t(entry.label)} pressed={effect === entry.id} testID={`voice-effect-${entry.id}`} onPress={() => merge("voiceEffect", { type: entry.id }, "Voice effect")} />)}
        </View>
        {slider("voice-intensity", "Intensity", Number(part("voiceEffect").intensity ?? 100), 100, 0, 100, 1, "%", (next, live) => merge("voiceEffect", { intensity: Math.round(next) }, "Voice effect", live))}
      </Section>
      <Section id="audio-pitch" title={t("Pitch")} testID="audio-pitch" enabled={pitched} onToggle={(enabled) => merge("pitch", enabled ? { semitones: 1, cents: 0 } : { semitones: 0, cents: 0 }, "Pitch")} onReset={() => merge("pitch", { semitones: 0, cents: 0 }, "Pitch")}>
        {slider("pitch-semitones", "Semitones", Number(part("pitch").semitones ?? 0), 0, -12, 12, 1, "st", (next, live) => merge("pitch", { semitones: Math.round(next) }, "Pitch", live))}
        {slider("pitch-cents", "Cents", Number(part("pitch").cents ?? 0), 0, -100, 100, 1, "ct", (next, live) => merge("pitch", { cents: Math.round(next) }, "Pitch", live))}
      </Section>
      <Section id="audio-eq" title={t("Equaliser")} testID="audio-eq" enabled={on("eq")} onToggle={(enabled) => { controller.external((doc, ctx) => setEq(doc, ctx, ids, { enabled })); }} onReset={() => { controller.external((doc, ctx) => setEq(doc, ctx, ids, { preset: "flat" })); }}>
        <Row label={t("Preset")}><View style={{ flex: 1 }} testID="eq-preset"><Select label={t("Equaliser preset")} size="sm" value={preset} placeholder="—" options={Object.entries(EQ_PRESET_NAMES).filter(([id]) => id !== "custom" || preset === "custom").map(([id, name]) => ({ value: id, label: t(name) }))} onChange={(next) => { if (next !== "custom") controller.external((doc, ctx) => setEq(doc, ctx, ids, { preset: next })); }} /></View></Row>
        {EQ_BAND_KEYS.map((band) => slider(`eq-${band}`, EQ_BAND_NAMES[band], Number(bands[band] ?? 0), 0, -12, 12, 0.5, "dB", (next, live) => controller.external((doc, ctx) => setEq(doc, ctx, ids, { band: { key: band, value: next } }), live)))}
      </Section>
      <Section id="audio-compressor" title={t("Compressor")} testID="audio-compressor" enabled={on("compressor")} onToggle={(enabled) => merge("compressor", { enabled }, "Compressor")} onReset={() => merge("compressor", Object.fromEntries(COMPRESSOR.map((row) => [row.key, row.fallback])), "Compressor")}>
        {COMPRESSOR.map((row) => slider(`compressor-${row.key}`, row.label, Number(compressor[row.key] ?? row.fallback), row.fallback, row.min, row.max, row.step, row.unit, (next, live) => merge("compressor", { [row.key]: row.step < 1 ? Math.round(next * 2) / 2 : Math.round(next) }, "Compressor", live)))}
      </Section>
      <View style={{ paddingHorizontal: space[3], paddingVertical: space[2], gap: space[1.5] }}>
        <Row label={t("Voice")} testID="audio-voice"><Switch accessibilityLabel={t("Voice")} value={elements.every((element) => element.isVoice === true)} onChange={(next) => { writeFields(runtime, ids, { isVoice: next }, "Voice"); }} /><Text variant="meta" color="text/secondary" style={{ flex: 1 }}>{t("Tracks with ducking lower under this clip")}</Text></Row>
      </View>
      {track?.type === "audio" ? (
        <Section id="audio-ducking" title={t("Ducking")} testID="audio-ducking" enabled={ducking.enabled === true} onToggle={(enabled) => setDucking({ enabled })} onReset={() => setDucking({ amount: 12, attack: 200, release: 500, mode: "full" })}>
          <Note>{ducking.mode === "voice-band" ? t("Lowers the 300 Hz–4 kHz band of track \"{name}\" while a Voice clip of another track sounds", { name: track.name }) : t("Lowers the whole track \"{name}\" while a Voice clip of another track sounds", { name: track.name })}</Note>
          <Row label={t("Ducking mode")} testID="ducking-mode"><View style={{ flex: 1 }}><Select label={t("Ducking mode")} size="sm" value={String(ducking.mode ?? "full")} options={[{ value: "full", label: t("Whole track") }, { value: "voice-band", label: t("Voice band (300 Hz–4 kHz)") }]} onChange={(mode) => setDucking({ mode: mode as "full" | "voice-band" })} /></View></Row>
          {slider("ducking-amount", "Amount", Number(ducking.amount ?? 12), 12, 0, 30, 1, "dB", (next, live) => setDucking({ amount: Math.round(next) }, live))}
          {slider("ducking-attack", "Attack", Number(ducking.attack ?? 200), 200, 10, 1000, 10, "ms", (next, live) => setDucking({ attack: Math.round(next) }, live))}
          {slider("ducking-release", "Release", Number(ducking.release ?? 500), 500, 50, 3000, 10, "ms", (next, live) => setDucking({ release: Math.round(next) }, live))}
          {voices ? null : <Note tone="warning" testID="ducking-no-voice">{t("Mark a clip as Voice to duck under it")}</Note>}
        </Section>
      ) : null}
      {single ? (
        <Section id="audio-beats" title={t("Beats")} testID="audio-beats">
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[2] }}>
            <Button size="sm" kind="outline" icon="plus" label={t("Add beat")} testID="beat-add" disabled={!inside} onPress={() => { controller.external((doc, ctx) => addBeats(doc, ctx, first.id, [props.playhead])); }} />
            <Button size="sm" label={t("Delete beat")} testID="beat-delete" disabled={!inside || beats.length === 0} onPress={() => { controller.external((doc, ctx) => deleteBeatAt(doc, ctx, first.id, props.playhead, 2 * frame)); }} />
            <Button size="sm" kind="ghost" tone="danger" label={t("Clear all")} testID="beat-clear" disabled={beats.length === 0} onPress={() => setClearing(true)} />
          </View>
          <Text variant="meta" color="text/secondary" testID="beat-count">{beats.length === 1 ? t("1 beat marker") : t("{n} beat markers", { n: beats.length })}</Text>
          <ConfirmDialog open={clearing} title={t("Clear all beats")} description={t("All {n} beat markers of this clip will be removed.", { n: beats.length })} confirmLabel={t("Clear all")} onClose={() => setClearing(false)} onConfirm={() => { setClearing(false); controller.external((doc, ctx) => clearBeats(doc, ctx, first.id)); }} />
        </Section>
      ) : null}
    </>
  );
}
