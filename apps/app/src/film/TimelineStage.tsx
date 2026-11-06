import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { film as fm, promptVideo as pv } from "@jagentchill/editor-core";
import { Button, Callout, EmptyState, Icon, IconButton, Select, Slider, Switch, Text, radius, space, useTheme, type ColorToken, type IconName } from "@jagentchill/ui";
import { useT } from "../locale";
import { useProjectSync } from "../sync/ProjectsSync";
import { CAN_PLAY, Picture, usePlayer } from "./parts";
import { failed, running, useAct, type StageProps } from "./stage";
import { MOOD_ROWS, TICKS, ratioOf, timecode } from "./strings";

/** Timeline: what the film becomes on the editor's tracks, a preview of it, and the step that makes the project. */
export function TimelineStage(props: StageProps) {
  const t = useT(), theme = useTheme(), act = useAct(), sync = useProjectSync(), player = usePlayer();
  const { film, data } = props;
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState(false);
  const [at, setAt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const placed = useMemo(() => fm.layout(film), [film]);
  // The lanes show every panel in its order: one without media keeps its length as an empty slot, so nothing shifts when it is drawn.
  const lanes = useMemo(() => {
    let cursor = 0;
    const slots = placed.panels.map((entry) => { const start = cursor, length = entry.placed ? entry.duration_ticks : entry.panel.duration_ticks; cursor += length; return { ...entry, shown: start, length }; });
    const byPanel = new Map(slots.map((slot) => [slot.panel.id, slot]));
    const lines = placed.lines.map((entry) => { const slot = byPanel.get(entry.panelId)!; return { ...entry, shown: slot.shown + (entry.start_ticks - slot.start_ticks) }; });
    return { slots, lines, total: Math.max(cursor, 1) };
  }, [placed]);
  const total = placed.total_ticks, shown = placed.panels.filter((entry) => entry.placed);
  const current = shown.find((entry) => at >= entry.start_ticks && at < entry.start_ticks + entry.duration_ticks) ?? shown[shown.length - 1];
  const caption = placed.lines.find((entry) => at >= entry.start_ticks && at < entry.start_ticks + entry.duration_ticks);
  useEffect(() => {
    if (!playing) return;
    const started = Date.now(), from = at >= total ? 0 : at;
    const timer = setInterval(() => { const next = from + ((Date.now() - started) / 1000) * TICKS; if (next >= total) { setAt(total); setPlaying(false); } else setAt(next); }, 80);
    return () => clearInterval(timer);
  }, [playing, total]); // eslint-disable-line react-hooks/exhaustive-deps
  // While the preview plays, the take of the line under the playhead is heard.
  const heard = playing && caption?.spoken ? fm.activeTake(caption.line)?.media.blobId ?? null : null;
  useEffect(() => { if (!CAN_PLAY) return; if (heard) { if (player.playing !== heard) player.toggle(heard); } else if (player.playing) player.stop(); }, [heard]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!film.panels.length) return <EmptyState icon="film" title={t("Nothing to assemble yet")} description={t("Create the script from the story first")} actions={[{ label: t("Go to Story"), onPress: () => props.go("story") }]} />;

  const missing = placed.withoutMedia.length, spoken = placed.lines.filter((entry) => entry.spoken).length, { width, height } = pv.canvasOf(film.aspectRatio, "1080p");
  const assemble = async (withoutMissing: boolean) => { setBusy(true); await act(data.call("assemble", { withoutMissing })); setBusy(false); };
  const open = async () => { if (!film.project) return; setOpening(true); await sync.openFromHost(film.project.projectId); setOpening(false); };
  const musicBusy = running(data, "music"), musicProblem = failed(data, "music"), outdated = !!film.project && film.stale.includes("timeline");
  const row = (icon: IconName, title: string, text: string, ok: boolean, control?: ReactNode, testID?: string) => (
    <View testID={testID} style={{ flexDirection: "row", alignItems: "center", gap: space[3], padding: space[3], borderTopWidth: title === "Main" ? 0 : 1, borderTopColor: theme.color("border/hairline") }}>
      <View style={{ width: 28, height: 28, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", backgroundColor: theme.color("bg/subtle") }}><Icon name={icon} size="sm" color="text/secondary" /></View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}><Text variant="body-medium">{t(title)}</Text><Text variant="meta" color="text/secondary">{text}</Text></View>
      {control}
      {ok ? <Icon name="check" size="sm" color="success/text" /> : null}
    </View>
  );
  const lane = (label: string, color: ColorToken, blocks: { key: string; start: number; length: number; empty?: boolean }[]) => (
    <View key={label} testID={`film-lane-${label.toLowerCase()}`} {...({ dataSet: { blocks: String(blocks.filter((block) => !block.empty).length) } } as object)} style={{ height: label === "Main" ? 22 : 12, borderRadius: radius.xs, backgroundColor: theme.color("timeline/track-bg") }}>
      {blocks.map((block) => <View key={block.key} style={{ position: "absolute", top: 0, bottom: 0, start: `${(block.start / lanes.total) * 100}%`, width: `${Math.max(0.6, (block.length / lanes.total) * 100 - 0.3)}%`, borderRadius: radius.xs, ...(block.empty ? { borderWidth: 1, borderStyle: "dashed", borderColor: theme.color("danger/text") } : { backgroundColor: theme.color(color) }) }} />)}
    </View>
  );
  const settings = (
    <View style={{ gap: space[3], width: theme.compact ? undefined : 336 }}>
      <View style={{ gap: space[1] }}>
        <Text variant="title-sm" level={2}>{t("Assemble episode 1")}</Text>
        <Text color="text/secondary">{t("Creates an editor project from this film: stills with motion, the takes in use, captions and music. Assembling again after a change makes a new project.")}</Text>
      </View>
      {missing ? (
        <View testID="film-timeline-missing" style={{ gap: space[2] }}>
          <Callout tone="warning">{`${missing === 1 ? t("1 panel has no media.") : t("{n} panels have no media.", { n: missing })} ${t("They are listed below and are never replaced by dummy media.")}`}</Callout>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
            {props.mayRun ? <Button size="sm" label={t("Generate missing")} testID="film-timeline-generate" disabled={props.estimate?.capabilities.image === false} onPress={() => void act(data.generate({ kind: "panels", scope: "missing" }))} /> : null}
            {props.mayEdit ? <Button size="sm" kind="ghost" label={t("Assemble without them")} testID="film-assemble-without" loading={busy} disabled={!shown.length} onPress={() => void assemble(true)} /> : null}
          </View>
        </View>
      ) : null}
      {outdated ? <View testID="film-timeline-outdated"><Callout tone="info">{t("The film changed after it was assembled. Assemble again to make a project from what it is now.")}</Callout></View> : null}
      <View style={{ borderWidth: 1, borderColor: theme.color("border/hairline"), borderRadius: radius.md, overflow: "hidden" }}>
        {row("video", "Main", t("{shown} of {all} panels as clips, no gaps · stills with camera motion", { shown: shown.length, all: placed.panels.length }), shown.length > 0)}
        {row("wave", "Dialogue", spoken === 1 ? t("1 line, active take at its panel start") : t("{n} lines, active takes at their panel start", { n: spoken }), spoken > 0)}
        {row("cc", "Captions", film.captions ? t("Subtitles from the voice lines · {n} cues", { n: placed.lines.length }) : t("Off"), film.captions && placed.lines.length > 0, <Switch accessibilityLabel={t("Captions")} value={film.captions} disabled={!props.mayEdit} onChange={(captions: boolean) => void act(data.apply([{ op: "film.set", fields: { captions } }]))} />, "film-row-captions")}
        {row("music", "Music", musicProblem ?? (film.music.mood === "none" ? t("No music") : film.music.current ? t("One track under the whole film, lowered under dialogue") : t("Not generated yet")), !!film.music.current, <View style={{ flexDirection: "row", alignItems: "center", gap: space[1] }}>
          <Select size="xs" width={112} label={t("Music mood")} disabled={!props.mayEdit} value={film.music.mood} options={MOOD_ROWS.map((entry) => ({ value: entry.id, label: t(entry.label) }))} onChange={(musicMood) => void act(data.apply([{ op: "film.set", fields: { musicMood: musicMood as fm.Film["music"]["mood"] } }]))} />
          {props.mayRun && film.music.mood !== "none" && props.estimate?.capabilities.music ? <IconButton icon="refresh" size="xs" label={(film.music.current ? t("Generate the music again") : t("Generate the music"))} testID="film-music-generate" disabled={musicBusy} onPress={() => void act(data.generate({ kind: "music" }))} /> : null}
        </View>, "film-row-music")}
      </View>
      {placed.unbound.length ? <Text variant="meta" color="text/secondary" testID="film-unbound">{`${t("Unbound lines (not placed):")} ${placed.unbound.slice(0, 6).map((line) => `${t("line {n}", { n: film.lines.indexOf(line) + 1 })} “${line.text.slice(0, 40)}”`).join(", ")}`}</Text> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
        {props.mayEdit ? <Button kind="strong" size="sm" icon="layers" label={t("Assemble timeline")} testID="film-assemble" loading={busy} disabled={!!missing || !shown.length} onPress={() => void assemble(false)} /> : null}
        <Button size="sm" icon="ext" label={t("Open in editor")} testID="film-open-editor" loading={opening} disabled={!film.project} onPress={() => void open()} />
      </View>
      {film.project ? <Text variant="meta" color="text/secondary" testID="film-project">{t("Project “{name}”: {clips} clips, {voice} voice clips, {captions} captions, {music} music clips", { name: film.project.name, clips: film.project.clips, voice: film.project.voiceElements, captions: film.project.captionCues, music: film.project.musicElements })}</Text> : null}
    </View>
  );
  const preview = (
    <View style={{ flex: 1, minWidth: 0, gap: space[2] }}>
      <View style={{ alignItems: "center", backgroundColor: theme.color("bg/canvas"), borderRadius: radius.md, overflow: "hidden" }}>
        <View style={{ width: "100%", maxWidth: ratioOf(film.aspectRatio) >= 1 ? undefined : 260 }}>
          <Picture blobId={current?.panel.picture.current?.media.blobId} ratio={ratioOf(film.aspectRatio)} testID="film-preview">
            {film.captions && caption ? <View style={{ position: "absolute", bottom: space[4], start: space[4], end: space[4], alignItems: "center" }}><View style={{ paddingHorizontal: space[2], paddingVertical: 2, borderRadius: radius.xs, backgroundColor: theme.color("clip/label-scrim") }}><Text color="clip/label" align="center" testID="film-preview-caption">{caption.line.text}</Text></View></View> : null}
          </Picture>
        </View>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
        <IconButton icon={playing ? "pause" : "play"} size="sm" label={(playing ? t("Pause") : t("Play"))} testID="film-preview-play" disabled={!total} onPress={() => setPlaying(!playing)} />
        <Text variant="meta" tabular testID="film-preview-time">{`${timecode(at, film.frameRate)} / ${timecode(total, film.frameRate)}`}</Text>
        <View style={{ flex: 1, minWidth: 40 }}><Slider label={t("Position")} min={0} max={Math.max(1, Math.round(total / TICKS * 100) / 100)} step={0.1} disabled={!total} value={Math.min(at, total) / TICKS} onChange={(value) => { setPlaying(false); setAt((value as number) * TICKS); }} /></View>
        <Text variant="meta" color="text/secondary" tabular>{`${width} × ${height} · ${film.frameRate} fps`}</Text>
      </View>
      <View testID="film-lanes" style={{ gap: 3 }}>
        {lane("Main", "clip/video", lanes.slots.map((slot) => ({ key: slot.panel.id, start: slot.shown, length: slot.length, empty: !slot.placed })))}
        {lane("Dialogue", "clip/audio", lanes.lines.filter((entry) => entry.spoken).map((entry) => ({ key: entry.line.id, start: entry.shown, length: entry.duration_ticks })))}
        {film.captions ? lane("Captions", "clip/caption", lanes.lines.map((entry) => ({ key: entry.line.id, start: entry.shown, length: entry.duration_ticks }))) : null}
        {film.music.current ? lane("Music", "clip/effect", [{ key: "music", start: 0, length: lanes.total }]) : null}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[3] }}>
        {["Main", "Dialogue", ...(film.captions ? ["Captions"] : []), ...(film.music.current ? ["Music"] : [])].map((label) => <Text key={label} variant="meta" color="text/secondary">{t(label)}</Text>)}
        <View style={{ flex: 1 }} />
        {missing ? <View style={{ flexDirection: "row", alignItems: "center", gap: space[1] }}><View style={{ width: 12, height: 10, borderRadius: 2, borderWidth: 1, borderStyle: "dashed", borderColor: theme.color("danger/text") }} /><Text variant="meta" color="text/secondary">{t("Panel without media")}</Text></View> : null}
      </View>
    </View>
  );
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: space[4], gap: space[4], flexDirection: theme.compact ? "column" : "row", alignItems: theme.compact ? "stretch" : "flex-start" }}>
      {settings}{preview}
    </ScrollView>
  );
}
