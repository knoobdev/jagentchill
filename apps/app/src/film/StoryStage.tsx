import { formatAmount } from "@jagentchill/app-core";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { film as fm } from "@jagentchill/editor-core";
import { Button, Callout, Card, Icon, Input, Select, Spinner, Switch, Text, Textarea, space, useTheme } from "@jagentchill/ui";
import { useT } from "../locale";
import { pickFiles } from "../platform/store";
import { usePref } from "../state";
import type { RunData } from "../workflows/data";
import type { PipelineState } from "./Pipeline";
import { NO_WRITER, filmFailure, missingText, routeMissing } from "./paid";
import { STOP_FOR_CHECK_PREF, runLine } from "./Progress";
import { failed, running, useAct, type StageProps } from "./stage";
import { STYLE_ROWS, usd } from "./strings";

/** Story: one input, the story the film is made from; logline and synopsis are the breakdown's own output, shown back
 *  as a summary once it exists. "Make the film" is the one start of the film: it continues at the first missing step
 *  and turns into "Stop" while the film is being made; what it will cost and whether it stops for a check sit beside it. */
export function StoryStage(props: StageProps & {
  /** Opened from the Home composer with a short idea: the film's assistant opens so the person writes it there. */
  startWithIdea?: boolean;
  /** Opens the film's agent panel with an empty composer. The button never writes or sends a request itself. */
  onWriteWithAI?(): void;
  /** The run that makes this film: "Make the film" starts it, "Stop" cancels it. */
  run?: RunData;
  pipeline?: PipelineState;
  /** What the run asks of the person or why it stopped (an approval, a missing provider): said beside the button. */
  notice?: ReactNode;
  /** The ways out of "nothing makes pictures" and "no model writes": given only to a device that may open those settings. */
  onOpenProviders?(): void;
  onOpenRouting?(): void;
}) {
  const t = useT(), theme = useTheme(), act = useAct();
  const { film, data } = props;
  const [draft, setDraft] = useState(film.sourceText);
  const [rowWidth, setRowWidth] = useState(0);
  const [saved, setSaved] = useState<"saved" | "saving" | "error">("saved");
  const [custom, setCustom] = useState(film.artStyleText);
  const dirty = useRef(false), timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), latest = useRef(draft);
  // What the host holds replaces the text unless this device is in the middle of typing.
  useEffect(() => { if (!dirty.current) { setDraft(film.sourceText); latest.current = film.sourceText; } }, [film.sourceText]);
  const save = async () => {
    const text = latest.current;
    const result = await data.apply([{ op: "film.set", fields: { sourceText: text } }]);
    if (latest.current === text) { dirty.current = false; setSaved(result.ok ? "saved" : "error"); }
    return result.ok;
  };
  const change = (text: string) => {
    setDraft(text); latest.current = text; dirty.current = true; setSaved("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), 600);
  };
  useEffect(() => () => { if (timer.current) { clearTimeout(timer.current); if (dirty.current) void save(); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const flush = async () => { if (timer.current) clearTimeout(timer.current); return dirty.current ? save() : true; };
  const counts = fm.storyCounts(draft), over = draft.length > fm.LIMITS.sourceText;
  const busyScript = running(data, "breakdown"), wrote = failed(data, "breakdown");
  // Why the script could not be written, in the film's own words (`filmFailure`) — and said ONCE: when the run failed
  // on it, the run's notice below the story says it (with "Try again"), and this line gives way.
  const problem = wrote === null || props.pipeline?.record?.status === "failed" ? null : data.activity.breakdown?.code === "NO_ROUTE" && /^Choose a model/.test(wrote) ? NO_WRITER(t) : filmFailure(t, { code: data.activity.breakdown?.code, message: wrote, details: data.activity.breakdown?.details }, wrote);
  // "Write with AI" opens the film's assistant alone: no prompt is built and nothing is sent until the person writes it.
  const openAssistant = () => props.onWriteWithAI?.();
  // Arriving from the Home composer with an idea opens the same panel once; still nothing is written or sent for the person.
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !props.onWriteWithAI || !props.startWithIdea || !props.mayRun) return;
    started.current = true;
    props.onWriteWithAI();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const importFile = async () => {
    const [file] = await pickFiles(".txt,.md,.fountain,text/plain", false);
    if (!file) return;
    const text = (await file.text()).replace(/\r\n/g, "\n");
    if (text.length > fm.LIMITS.sourceText) { void act(Promise.resolve({ ok: false, message: t("Episode text limit reached — split into episodes") })); return; }
    change(text);
  };
  const filmActive = props.pipeline?.active === true;
  // "Stop for my check after each step" is remembered per film on this device; off, the film is made in one go.
  const [stops, setStops] = usePref(STOP_FOR_CHECK_PREF);
  const stopForCheck = stops[film.id] === true;
  // The film's own run: its first step reads the story (only when the script is missing), the later steps make
  // only what is missing, so this button continues from wherever the film stopped.
  const makeFilm = async () => { if (!(await flush())) return; await act(data.makeFilm({ mode: stopForCheck ? "checkpoints" : "auto" }).then((result) => (!result.ok && routeMissing(result) ? { ok: true } : result))); };
  const stopFilm = async () => { if (props.run) await act(props.run.act("jagentchill.workflow.run.cancel")); };
  const summary = film.panels.length > 0;
  // The script is still to be written and no model is set to write it: said here, with the way to Model routing — the film is not started into a failure.
  const noWriter = props.writer === false && (film.panels.length === 0 || film.scriptStale === true);
  // The look is named in full in every language: 250 px holds the English names; a longer name widens the field (a wide letter counts twice).
  // A phone has no room for "Art style · " in front of the name (its larger type would cut it): there the field holds the name alone.
  const styleName = `${t("Art style")} · ${t(STYLE_ROWS.find((row) => row.id === film.artStyle)?.label ?? "")}`, styleUnits = [...styleName].reduce((sum, letter) => sum + (letter.codePointAt(0)! > 0x2e7f ? 2 : 1), 0);
  const styleWidth = theme.compact ? 250 : Math.min(380, 250 + Math.max(0, styleUnits - 31) * 7);
  // The counts, the estimate, the switch and the button need about 700 px in the longest of the three languages; under that the row wraps.
  const oneLine = !theme.compact && (rowWidth === 0 || rowWidth >= 700);
  const estimate = props.estimate, line = props.pipeline ? runLine(t, film, props.pipeline) : null;
  const routeProblems = Object.entries(estimate?.capabilityProblems ?? {}).map(([capability, reason]) => ({
    label: t(({ image: "Pictures", video: "Video", tts: "Voice", music: "Music", transcription: "Recording check" } as const)[capability as "image" | "video" | "tts" | "music" | "transcription"]), reason,
  }));
  // A failed run says why in the notice (with the way out); the line is for everything else.
  const said = line && !(line.kind === "stopped" && props.pipeline?.record?.status === "failed") && !(line.kind === "needs_you" && props.notice) ? line : null;
  return (
    <View testID="film-story" style={{ flex: 1, minHeight: 0, paddingVertical: space[4], paddingHorizontal: space[6], gap: space[3] }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[2] }}>
        <View testID="film-aspect"><Select size="sm" width={92} label={t("Aspect ratio")} disabled={!props.mayEdit} value={film.aspectRatio} options={fm.FILM_ASPECT_RATIOS.map((value) => ({ value, label: value, icon: "aspect" as const }))} onChange={(aspectRatio) => void act(data.apply([{ op: "film.set", fields: { aspectRatio } }]))} /></View>
        <View testID="film-style"><Select size="sm" width={styleWidth} label={t("Art style")} disabled={!props.mayEdit} value={film.artStyle} options={STYLE_ROWS.map((row) => ({ value: row.id, label: theme.compact ? t(row.label) : `${t("Art style")} · ${t(row.label)}`, icon: "palette" as const }))}
          onChange={(artStyle) => { if (artStyle === "custom" && !custom.trim()) { setCustom(" "); return; } void act(data.apply([{ op: "film.set", fields: { artStyle } }])); }} /></View>
        {film.artStyle === "custom" || custom === " " ? <Input size="sm" testID="film-style-text" style={{ width: 260 }} placeholder={t("Describe the custom style")} maxLength={fm.LIMITS.artStyleText} value={custom.trimStart()} onChangeText={setCustom}
          onBlur={() => { if (custom.trim()) void act(data.apply([{ op: "film.set", fields: { artStyle: "custom", artStyleText: custom.trim() } }])); }} /> : null}
        <View style={{ flex: 1 }} />
        {props.mayRun ? <Button size="sm" icon="sparkles" label={t("Write with AI")} testID="film-write-ai" onPress={openAssistant} /> : null}
        {props.mayEdit ? <Button size="sm" icon="download" label={t("Import")} testID="film-import" onPress={() => void importFile()} /> : null}
      </View>
      {/* A step held by a spending limit is not an error of the story: the notice below says what holds the film and the way on. */}
      {problem && !props.pipeline?.limit && !props.pipeline?.over ? <View testID="film-story-error"><Callout tone="danger">{problem}</Callout></View> : null}
      {props.mayRun && !filmActive && routeProblems.length ? <View testID="film-route-problems">
        <Callout tone="warning" actions={props.onOpenRouting ? [{ label: t("Open Model routing"), onPress: props.onOpenRouting }] : undefined}>
          {routeProblems.map((entry) => t("{label}: {reason}", entry)).join(" · ")}
        </Callout>
      </View> : null}
      <ScrollView style={{ flex: 1, minHeight: 0 }} contentContainerStyle={{ gap: space[4], paddingBottom: space[4] }} testID="film-story-scroll">
        <Card padding={space[5]} style={{ minHeight: 260 }}>
          <Textarea testID="film-story-text" value={draft} onChangeText={change} readOnly={!props.mayEdit} placeholder={t("Write, paste or import a story")} invalid={over} style={{ flex: 1 }} minLines={12} maxLines={400} />
        </Card>
        {/* One line while there is room for it (also with the Progress panel open): the limit text gives way first — the counts stay whole. A narrow stage puts the counts and the limit on a line each, above the controls. */}
        <View testID="film-story-row" onLayout={(event) => setRowWidth(event.nativeEvent.layout.width)} style={{ flexDirection: "row", flexWrap: oneLine ? "nowrap" : "wrap", alignItems: "center", gap: space[3] }}>
          <View style={oneLine ? { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: space[3], overflow: "hidden" } : { width: "100%", gap: 2 }}>
            <Text variant="meta" color={over ? "danger/text" : "text/secondary"} testID="film-story-counts" numberOfLines={oneLine ? 1 : undefined} style={oneLine ? { flexShrink: 0 } : undefined}>
              {`${t("{n} characters", { n: formatAmount(counts.characters) })} · ${t("{n} words", { n: formatAmount(counts.words) })} · ${over ? t("Episode text limit reached — split into episodes") : t(saved === "saved" ? "Saved" : saved === "saving" ? "Saving…" : "Not saved")}`}
            </Text>
            {oneLine ? <View style={{ flexGrow: 1 }} /> : null}
            <Text variant="meta" color="text/secondary" testID="film-story-limit" numberOfLines={oneLine ? 1 : undefined} style={oneLine ? { flexShrink: 1, minWidth: 0 } : undefined}>{t("Limit 60,000 characters per episode")}</Text>
          </View>
          {busyScript && !filmActive ? <View style={{ flexDirection: "row", alignItems: "center", gap: space[1] }}><Spinner size={14} /><Text variant="meta" color="text/secondary">{t("Writing the script…")}</Text></View> : null}
          {/* Before the script is written the only figure there is belongs to the question "Make the film" asks (the most the story may need); a figure here would be of the music alone. */}
          {props.mayRun && !filmActive && estimate && estimate.totalUsd > 0 && props.film.panels.length > 0 ? <Text variant="meta" color="text/secondary" tabular testID="film-estimate-total" style={{ flexShrink: 0 }}>{`≈ ${usd(estimate.totalUsd)}`}</Text> : null}
          {props.mayRun && !filmActive ? <View testID="film-stop-for-check" {...({ dataSet: { on: stopForCheck ? "1" : "0" } } as object)}><Switch label={t("Stop for my check after each step")} value={stopForCheck} onChange={(value) => setStops({ ...stops, [film.id]: value })} /></View> : null}
          {props.mayRun ? (filmActive
            ? <Button kind="strong" size="sm" icon="stop" label={t("Stop")} testID="film-make" onPress={() => void stopFilm()} />
            : <Button kind="strong" size="sm" icon="play" label={t("Make the film")} testID="film-make" disabled={!draft.trim() || over || noWriter} onPress={() => void makeFilm()} />) : null}
        </View>
        {said ? (
          <View testID="film-run-line" {...({ dataSet: { tone: said.kind } } as object)} style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: space[2] }}>
            {said.kind === "working" ? <Spinner size={14} /> : said.kind === "done" ? null : <Icon name={said.kind === "needs_you" ? "warn" : "minus"} size="sm" color={said.kind === "needs_you" ? "warning/text" : "text/tertiary"} />}
            {said.kind === "done" ? <Button kind="ghost" size="sm" icon="check-c" label={said.text} testID="film-run-open-timeline" onPress={() => props.go("timeline")} /> : <Text variant="meta" color="text/secondary" numberOfLines={2}>{said.text}</Text>}
          </View>
        ) : null}
        {props.notice}
        {props.mayRun && !filmActive && estimate?.blocked ? <Callout tone="warning">{t("A spending limit of this host is reached. Raise it under Settings, Providers, Generation.")}</Callout> : null}
        {props.mayRun && !filmActive && noWriter ? <View testID="film-no-writer"><Callout tone="warning" actions={props.onOpenRouting ? [{ label: t("Open Model routing"), onPress: props.onOpenRouting }] : undefined}>{NO_WRITER(t)}</Callout></View> : null}
        {props.mayRun && !filmActive && data.missing ? <View testID="film-route-missing" {...({ dataSet: { missing: data.missing.join(",") } } as object)}><Callout tone="warning" actions={props.onOpenProviders ? [{ label: t("Open Providers"), onPress: props.onOpenProviders }] : undefined}>{missingText(t, data.missing)}</Callout></View> : null}
        {props.mayRun && !filmActive && !props.notice && !data.missing && estimate && !estimate.capabilities.image ? <View testID="film-no-image-provider"><Callout tone="warning">{t("No way to obtain pictures: connect an image provider under Settings, Providers, Generation.")}</Callout></View> : null}
        {summary ? (
          <View testID="film-story-summary">
            <Card padding={space[4]} style={{ gap: space[3] }}>
              <Text variant="body-medium">{t("Summary")}</Text>
              <View style={{ gap: space[1] }}>
                <Text variant="meta" color="text/secondary">{t("Logline")}</Text>
                <Text>{film.logline}</Text>
              </View>
              <View style={{ gap: space[1] }}>
                <Text variant="meta" color="text/secondary">{t("Synopsis")}</Text>
                <Text>{film.synopsis}</Text>
              </View>
            </Card>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
