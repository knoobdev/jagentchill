import { useEffect, useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import type { ScriptScene, ScriptShot } from "@jagentchill/protocol";
import { script as s } from "@jagentchill/editor-core";
import { Button, EmptyState, IconButton, Select, Slider, Tap, Text, radius, space, useTheme, useToast, inlineIcon } from "@jagentchill/ui";
import { useT } from "../locale";
import { useScriptEditor } from "./context";
import { LABELS } from "./strings";

const ratioOf = (aspect: string): number => { const [width, height] = aspect.split(":").map(Number); return width / height; };
/** A slate drawn on the inset background: the frame of a shot until footage or a reference image stands in for it. */
function Slate(props: { number: string; heading: string; detail: string; description: string; ratio: number; width: number; caption?: string }) {
  const theme = useTheme();
  return (
    <View style={{ width: props.width, aspectRatio: props.ratio, backgroundColor: theme.color("bg/inset"), borderRadius: radius.sm, padding: space[2], justifyContent: "center", gap: space[0.5], overflow: "hidden" }}>
      <Text variant="meta" color="text/secondary" numberOfLines={1}>{props.heading}</Text>
      <Text variant="h1" tabular>{props.number}</Text>
      <Text variant="meta" color="text/secondary" numberOfLines={1}>{props.detail}</Text>
      <Text numberOfLines={3}>{props.description}</Text>
      {props.caption ? <View style={{ position: "absolute", start: space[2], end: space[2], bottom: space[2], alignItems: "center" }}><Text align="center" variant="body-medium" testID="animatic-subtitle" style={{ backgroundColor: theme.color("bg/app"), paddingHorizontal: space[1], borderRadius: radius.xs }}>{props.caption}</Text></View> : null}
    </View>
  );
}

/** The animatic: every frame for its duration with the spoken lines as subtitles, at 1×, with pause, scrub and a jump per scene. */
function Animatic(props: { onClose(): void }) {
  const t = useT(), theme = useTheme(), { document } = useScriptEditor();
  const plan = useMemo(() => s.planTimeline(document, { versionId: document.headVersionId, versionNumber: null, approved: false }), [document]);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(true);
  useEffect(() => {
    if (!playing) return;
    const started = Date.now(), from = time;
    const timer = setInterval(() => { const next = from + ((Date.now() - started) / 1000) * s.TICKS_PER_SECOND; if (next >= plan.duration) { setTime(plan.duration); setPlaying(false); } else setTime(next); }, 100);
    return () => clearInterval(timer);
  }, [playing, plan.duration]); // eslint-disable-line react-hooks/exhaustive-deps
  const slate = [...plan.slates].reverse().find((entry) => entry.start <= time) ?? plan.slates[0];
  const cue = plan.cues.find((entry) => entry.start <= time && time < entry.start + entry.duration);
  const sceneId = [...plan.markers].reverse().find((marker) => marker.time <= time)?.sceneId ?? plan.markers[0]?.sceneId ?? null;
  const seconds = plan.duration / s.TICKS_PER_SECOND;
  // The slate of a project carries the shot's values as written; here they read as in the cards below.
  const shown = slate?.shotId ? s.findShot(document, slate.shotId)?.shot : undefined;
  const detail = shown ? [t(LABELS.size[shown.size]), t(LABELS.angle[shown.angle]), t(LABELS.movement[shown.movement])].join(" · ") : slate?.detail ?? "";
  return (
    <View testID="animatic" style={{ padding: space[3], gap: space[2], alignItems: "center", borderBottomWidth: 1, borderBottomColor: theme.color("border/hairline") }}>
      {slate ? <Slate number={slate.number} heading={slate.heading} detail={detail} description={slate.description} ratio={plan.canvas.width / plan.canvas.height} width={plan.canvas.width >= plan.canvas.height ? Math.min(480, theme.width - space[6]) : 220} caption={cue ? `${cue.speaker ? `${cue.speaker}: ` : ""}${cue.text}` : undefined} /> : null}
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], width: "100%", maxWidth: 640, flexWrap: "wrap" }}>
        <IconButton icon={playing ? "pause" : "play"} size="sm" label={playing ? t("Pause") : t("Play")} testID="animatic-toggle" onPress={() => { if (!playing && time >= plan.duration) setTime(0); setPlaying(!playing); }} />
        <View testID="animatic-time" {...({ dataSet: { shot: slate?.number ?? "" } } as object)}><Text variant="meta" tabular>{`${s.formatClock(time)} / ${s.formatClock(plan.duration)}`}</Text></View>
        <View style={{ flex: 1, minWidth: 160 }}><Slider label={t("Position")} min={0} max={Math.max(0.1, seconds)} step={0.1} value={Math.min(seconds, time / s.TICKS_PER_SECOND)} onChange={(value) => { setPlaying(false); setTime((value as number) * s.TICKS_PER_SECOND); }} formatValue={(value) => s.formatClock(value * s.TICKS_PER_SECOND)} /></View>
        <Select label={t("Jump to scene")} size="sm" width={150} value={sceneId} onChange={(id) => { const marker = plan.markers.find((entry) => entry.sceneId === id); if (marker) setTime(marker.time); }} options={plan.markers.map((marker) => ({ value: marker.sceneId, label: t("Scene {n}", { n: s.sceneNumber(document, marker.sceneId) }) }))} />
        <Button kind="outline" size="sm" label={t("Close")} testID="animatic-close" onPress={props.onClose} />
      </View>
    </View>
  );
}

function ShotCard(props: { scene: ScriptScene; shot: ScriptShot; number: string; first: boolean; last: boolean; ratio: number }) {
  const t = useT(), theme = useTheme(), editor = useScriptEditor(), { shot, scene } = props, { document } = editor;
  const selected = editor.selection.shotIds.includes(shot.id);
  const line = s.sceneLines(scene).find((entry) => shot.lineIds.includes(entry.id));
  const width = props.ratio >= 1 ? 240 : 150;
  return (
    <View testID={`story-shot-${props.number}`} {...({ dataSet: { shot: shot.id, selected: selected ? "true" : "false" } } as object)} style={{ width, gap: space[1] }}>
      <Tap role="button" label={t("Shot {n}", { n: props.number })} onPress={() => { editor.select({ sceneId: scene.id, shotIds: [shot.id] }); editor.openInspector("selection"); }}
        style={{ borderRadius: radius.sm, borderWidth: 2, borderColor: selected ? theme.color("accent") : "transparent" }}>
        <Slate number={props.number} heading={s.headingText(document, scene)} detail={[t(LABELS.size[shot.size]), t(LABELS.angle[shot.angle]), t(LABELS.movement[shot.movement])].join(" · ")} description={shot.description} ratio={props.ratio} width={width - 4} />
      </Tap>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[0.5] }}>
        <Text variant="meta" color="text/secondary" tabular style={{ flex: 1 }}>{s.formatSeconds(s.shotTicks(document, scene, shot))}</Text>
        {editor.readOnly ? null : <IconButton icon={inlineIcon(theme.rtl, "arrow-l")} size="xs" label={t("Move shot {n} earlier", { n: props.number })} testID={`story-earlier-${props.number}`} disabled={props.first} onPress={() => editor.run(s.moveShot(shot.id, -1))} />}
        {editor.readOnly ? null : <IconButton icon={inlineIcon(theme.rtl, "arrow-r")} size="xs" label={t("Move shot {n} later", { n: props.number })} testID={`story-later-${props.number}`} disabled={props.last} onPress={() => editor.run(s.moveShot(shot.id, 1))} />}
      </View>
      {line ? <Text variant="meta" color="text/secondary" numberOfLines={2}>{line.text}</Text> : null}
    </View>
  );
}

/** The storyboard: the shots as a grid of frames in script order, grouped by scene, and the animatic that plays them. */
export function StoryboardPane() {
  const t = useT(), theme = useTheme(), editor = useScriptEditor(), toast = useToast(), { document } = editor;
  const [playing, setPlaying] = useState(false);
  const count = document.scenes.reduce((sum, scene) => sum + (scene.omitted ? 0 : scene.shots.length), 0), ratio = ratioOf(document.meta.aspectRatio);
  const auto = () => { const made = editor.run(s.autoShots()); if (made) toast.show({ kind: "success", message: made.created === 1 ? t("1 shot created") : t("{n} shots created", { n: made.created }) }); };
  if (count === 0) return <View testID="storyboard" style={{ flex: 1 }}><EmptyState icon="grid" title={t("Add shots to see a storyboard")} actions={editor.readOnly ? [] : [{ label: t("Auto shots"), kind: "strong", onPress: auto }]} /></View>;
  return (
    <View testID="storyboard" style={{ flex: 1, minHeight: 0 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], padding: space[2], borderBottomWidth: 1, borderBottomColor: theme.color("border/hairline") }}>
        <Text variant="body-medium" testID="story-totals">{`${count === 1 ? t("1 shot") : t("{n} shots", { n: count })} · ${s.formatClock(s.totalTicks(document))}`}</Text>
        <View style={{ flex: 1 }} />
        <Button kind="outline" size="sm" icon="play" label={t("Play")} testID="story-play" disabled={playing} onPress={() => setPlaying(true)} />
      </View>
      {playing ? <Animatic onClose={() => setPlaying(false)} /> : null}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: space[3], gap: space[4] }}>
        {document.scenes.map((scene, sceneIndex) => scene.omitted || scene.shots.length === 0 ? null : (
          <View key={scene.id} testID={`story-scene-${sceneIndex + 1}`} style={{ gap: space[2] }}>
            <Text variant="title-sm" level={3}>{`${t("Scene {n}", { n: sceneIndex + 1 })}${s.headingText(document, scene) ? ` — ${s.headingText(document, scene)}` : ""}`}</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[3] }}>
              {scene.shots.map((shot, index) => <ShotCard key={shot.id} scene={scene} shot={shot} number={`${sceneIndex + 1}.${index + 1}`} first={index === 0} last={index === scene.shots.length - 1} ratio={ratio} />)}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
