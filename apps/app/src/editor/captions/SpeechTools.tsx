import { useCallback, useRef, useState, type ReactNode } from "react";
import { View } from "react-native";
import { fetchVerified } from "@jagentchill/client";
import { findSilences, formatTimecode, SILENCE_DEFAULTS, SILENCE_LIMITS, frameToTicks, snapToFrame, sourceRangeOf, timeline, timelineRangeOfSource, type SampleRange, type SpeechClip } from "@jagentchill/editor-core";
import type { ProjectDocument, Rational } from "@jagentchill/protocol";
import { Button, Callout, Checkbox, NumberField, ProgressBar, Switch, Tap, Text, radius, space, useTheme, useToast } from "@jagentchill/ui";
import { useHost } from "../../host";
import { loadSigner } from "../../identity";
import { useT } from "../../locale";
import { useEditor, useEditorVersion } from "../context";
import { failureText } from "./AutoCaptions";
import { EstimateLine, usePaid } from "./Paid";
import { canDecodeSpeech, decodeSpeech, SPEECH_RATE } from "./dom";
import { answerOf, partAnswers, sumEstimates, type Answer } from "./answers";
import { askEstimate, needsConfirming, speechClips, useCaptionsStatus, useEstimate, type Grants } from "./run";

const SECOND = 120_000;
type El = timeline.El;
type Spoken = { file: { blobId: string; name: string; mime: string; provenance?: unknown }; seconds: number; check?: { ok: boolean; heard: string; reason?: string }; unchecked?: { why: string } };

/** One tool: its name, where it runs, and what it does or why it cannot run now. */
function Tool(props: { id: string; testID?: string; title: string; where: string; note?: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View testID={props.testID ?? `ai-tool-${props.id}`} style={{ gap: space[1.5], padding: space[2], borderRadius: radius.md, borderWidth: 1, borderColor: theme.color("border/hairline"), margin: space[3] }}>
      <View style={{ gap: 2 }}>
        <Text variant="body-medium">{props.title}</Text>
        <Text variant="meta" color="text/secondary" testID={`ai-where-${props.id}`}>{props.where}</Text>
      </View>
      {props.note ? <Text variant="meta" color="text/secondary">{props.note}</Text> : null}
      {props.children}
    </View>
  );
}

/**
 * "Text to speech": the selected text clips or captions (or a typed text) spoken by the model of the Voice role, each
 * recording put on an audio track where its text starts — all of them as one undo step. The host listens to every
 * recording it makes and says whether it is the text.
 */
export function TextToSpeech(props: { document: ProjectDocument; onOpenSettings(): void }) {
  const t = useT();
  const toast = useToast();
  const { connection, host, status: link, can } = useHost();
  const runtime = useEditor();
  const { status } = useCaptionsStatus();
  const { controller } = runtime, sceneId = controller.session.sceneId;
  const [match, setMatch] = useState(true);
  const [phase, setPhase] = useState<{ step: "idle" } | { step: "running"; done: number; total: number } | { step: "failed"; message: string }>({ step: "idle" });
  const [verdicts, setVerdicts] = useState<{ text: string; ok: boolean | null; heard?: string }[]>([]);
  const scene = timeline.sceneById(props.document, sceneId), selected = controller.session.selection.selectedElements;
  const chosen = timeline.elementsOfScene(scene).filter((element) => selected.includes(element.id) && (element.type === "text" || element.type === "caption"))
    .map((element) => ({ element, text: String(element.type === "text" ? element.content ?? "" : element.text ?? "").replace(/\s+/g, " ").trim() })).filter((entry) => entry.text.length > 0).sort((a, b) => a.element.startTime - b.element.startTime);
  const sources: { element?: El; text: string; time: number }[] = chosen.length ? chosen.map((entry) => ({ element: entry.element, text: entry.text.slice(0, 2000), time: entry.element.startTime })) : [];
  const language = (() => { const track = chosen[0]?.element.type === "caption" ? timeline.locate(props.document, chosen[0].element.id)?.track as unknown as { caption?: { language?: string } } | undefined : undefined; const code = track?.caption?.language; return code && code !== "und" ? code : undefined; })();

  // Every text is a request of its own: each is estimated as it will be sent (speaking it and listening back), and the sum is shown.
  const texts = [...new Set(sources.map((source) => source.text))], asked = texts.map((text) => ({ kind: "speech" as const, text, ...(language ? { language } : {}) }));
  const estimate = useEstimate(link === "connected" && status?.speech.available && sources.length ? asked : null);
  // The answers of this action (one a text), and what it had recorded when the host asked about a further text.
  const answers = useRef<Record<string, Answer>>({});
  const kept = useRef<{ key: string; made: { source: (typeof sources)[number]; assetId: string; ticks: number }[]; heard: { text: string; ok: boolean | null; heard?: string }[]; asking: string } | null>(null);
  const run = useCallback(async (grants: Grants) => {
    if (!connection || !host || sources.length === 0) return;
    // Going on after the host asked about one text: what was recorded before it is kept, never spoken (or paid) again.
    const key = JSON.stringify([language ?? "", sources.map((source) => [source.element?.id ?? "", source.text])]), before = grants.confirmed && kept.current?.key === key ? kept.current : null;
    answers.current = partAnswers(before ? answers.current : {}, grants, before?.asking ?? null);
    kept.current = null;
    setPhase({ step: "running", done: before?.made.length ?? 0, total: sources.length });
    setVerdicts([]);
    const made: { source: (typeof sources)[number]; assetId: string; ticks: number }[] = before?.made ?? [], heard: typeof verdicts = before?.heard ?? [];
    let asking = "";
    try {
      const signer = await loadSigner();
      for (const [index, source] of sources.entries()) {
        if (index < made.length) continue;
        asking = source.text;
        const spoken = await connection.call<Spoken>("jagentchill.captions.speak", { text: source.text, projectId: props.document.metadata.id, ...(language ? { language } : {}), ...answerOf(answers.current, source.text, grants) });
        const bytes = await fetchVerified({ host, signer }, spoken.file.blobId);
        const file = Object.assign(new Blob([bytes as unknown as BlobPart], { type: spoken.file.mime }), { name: spoken.file.name });
        const result = await runtime.media.importFiles([{ file }], spoken.file.provenance ? { provenance: spoken.file.provenance as never } : {});
        const assetId = [...result.imported, ...result.reused][0]?.assetId;
        if (!assetId) throw new Error("import");
        made.push({ source, assetId, ticks: Math.round(spoken.seconds * SECOND) });
        heard.push({ text: source.text, ok: spoken.check ? spoken.check.ok : null, ...(spoken.check && !spoken.check.ok ? { heard: spoken.check.heard } : {}) });
        setPhase({ step: "running", done: index + 1, total: sources.length });
      }
      // Every recording goes on an audio track at the start of its text, and a text clip takes the length of its speech: one step.
      const first = timeline.addToTimeline({ sceneId, items: [{ kind: "media", assetId: made[0].assetId }], time: made[0].source.time, label: "Text to speech" });
      const result = controller.run({ ...first, run(draft, env) {
        let last = first.run(draft, env);
        for (const entry of made.slice(1)) last = timeline.addToTimeline({ sceneId, items: [{ kind: "media", assetId: entry.assetId }], time: entry.source.time }).run(draft, env);
        if (match) for (const entry of made) {
          if (entry.source.element?.type !== "text") continue;
          const located = timeline.locate(draft, entry.source.element.id);
          if (!located) continue;
          const next = located.track.elements.filter((other) => other.startTime > located.element.startTime).sort((a, b) => a.startTime - b.startTime)[0];
          // On the project's frame grid, like every length on the timeline (a recording's own length, or the gap to the next text, need not be): at least one frame.
          const fps = draft.settings.fps as Rational, frame = frameToTicks(1, fps);
          located.element.duration = Math.max(frame, snapToFrame(Math.min(entry.ticks, next ? next.startTime - located.element.startTime : entry.ticks), fps));
        }
        // The text stays selected: its tab goes on showing what was heard.
        const kept = made.flatMap((entry) => (entry.source.element ? [entry.source.element.id] : []));
        return kept.length ? { ...last, selection: kept } : last;
      } });
      // The recordings exist but the timeline did not take them: that is SAID (they stay in the media library) — never a silent end.
      if (!result.ok) { console.error(`[tts] the timeline refused the recordings: ${result.message}`); setPhase({ step: "failed", message: t("The speech was made and is in the media library, but it could not be put on the timeline.") }); return; }
      setPhase({ step: "idle" });
      setVerdicts(heard);
      toast.show({ kind: "success", message: t("Speech added to the timeline") });
    } catch (error) { if (needsConfirming(error)) kept.current = { key, made, heard, asking }; setPhase({ step: "idle" }); throw error; }
  }, [connection, host, sources, language, match, props.document.metadata.id, runtime, controller, sceneId, t, toast]); // eslint-disable-line react-hooks/exhaustive-deps
  const paid = usePaid({ kind: "speech", run, quote: async () => (connection && asked.length ? sumEstimates(await Promise.all(asked.map(async (entry) => ({ key: entry.text, estimate: await askEstimate(connection, entry) })))) : null), onError: (error) => setPhase({ step: "failed", message: error instanceof Error && error.message === "import" ? t("The result could not be added to the media library") : failureText(t, error).message }) });
  const running = phase.step === "running";
  const blocked = link !== "connected" || !connection ? t("Connect to a host to use this tool") : !can("jagentchill.generation.run") ? t("This device cannot start jobs") : status && !status.speech.available ? t("No speech provider is connected") : null;
  return (
    <Tool id="tts" testID="tts-tab" title={t("Text to speech")} where={t("Host · speech model")} note={(chosen.length <= 1 ? t("The selected text is spoken where it starts.", { n: chosen.length }) : t("{n} selected texts are spoken, each where it starts.", { n: chosen.length }))}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}><View testID="tts-match"><Switch accessibilityLabel={t("Match text duration to speech")} value={match} onChange={setMatch} /></View><Text variant="meta" style={{ flex: 1 }}>{t("Match text duration to speech")}</Text></View>
      {!blocked && !running ? <EstimateLine estimate={estimate} testID="tts-estimate" /> : null}
      {running ? <View testID="tts-progress" style={{ gap: space[1] }}><ProgressBar value={phase.done / phase.total} label={t("Speaking…")} /><Text variant="meta" color="text/secondary">{t("Speaking… {n} of {m}", { n: phase.done, m: phase.total })}</Text></View>
        : <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}><Button size="sm" kind="primary" icon="voice" label={t("Generate speech")} disabled={blocked !== null || sources.length === 0} testID="tts-generate" onPress={paid.start} />{blocked ? <Button size="sm" kind="ghost" label={t("Connection settings")} testID="tts-settings" onPress={props.onOpenSettings} /> : null}</View>}
      {blocked ? <Text variant="meta" color="text/secondary" testID="tts-state">{blocked}</Text> : sources.length === 0 ? <Text variant="meta" color="text/secondary">{t("Add text first")}</Text> : null}
      {phase.step === "failed" ? <View testID="tts-error"><Callout tone="danger">{phase.message}</Callout></View> : null}
      {verdicts.map((verdict, index) => (
        <Text key={index} variant="meta" color={verdict.ok === false ? "warning" : "text/secondary"} testID="tts-verdict">
          {verdict.ok === true ? t("Checked: the speech says the text") : verdict.ok === false ? t("The speech may not be the text — heard: “{heard}”", { heard: (verdict.heard ?? "").slice(0, 120) }) : t("Not checked: no transcription provider listened to it")}
        </Text>
      ))}
      {paid.dialogs}
    </Tool>
  );
}

/**
 * "Remove silences": the pauses of one selected clip, found on this device from its sound level alone (no model), listed
 * for review and cut out of the clip — the gaps closed — as one undo step.
 */
export function RemoveSilences(props: { document: ProjectDocument; readOnly: boolean }) {
  const t = useT();
  const theme = useTheme();
  const toast = useToast();
  const runtime = useEditor();
  const { controller } = runtime, sceneId = controller.session.sceneId, fps = props.document.settings.fps as Rational;
  const [options, setOptions] = useState({ thresholdDb: SILENCE_DEFAULTS.thresholdDb as number, minSeconds: SILENCE_DEFAULTS.minSeconds as number, paddingSeconds: SILENCE_DEFAULTS.paddingSeconds as number });
  const [found, setFound] = useState<{ clip: SpeechClip; /** The first sample of the clip's stretch in its file. */ first: number; ranges: SampleRange[]; off: Set<number> } | null>(null);
  const [busy, setBusy] = useState(false);
  const token = useRef(0);
  const clips = speechClips(props.document, sceneId, "selection", controller.session.selection.selectedElements), clip = clips.length === 1 ? clips[0] : null;
  // A list belongs to the clip it was made for, as it was then.
  const list = found && clip && found.clip.id === clip.id && JSON.stringify(found.clip.element) === JSON.stringify(clip.element) ? found : null;
  const find = async () => {
    if (!clip) return;
    const mine = ++token.current;
    setBusy(true);
    const url = await runtime.media.mediaUrl(clip.assetId).catch(() => null), sound = url ? await decodeSpeech(url) : null;
    if (mine !== token.current) return;
    setBusy(false);
    if (!sound) { toast.show({ kind: "warning", message: t("The sound of these clips could not be read on this device") }); return; }
    // The stretch of its file the clip plays, whatever order or speed it plays it in.
    const range = sourceRangeOf(clip.element), first = Math.max(0, Math.min(sound.length, Math.round((range.start / SECOND) * SPEECH_RATE))), last = Math.max(first, Math.min(sound.length, Math.round((range.end / SECOND) * SPEECH_RATE)));
    setFound({ clip, first, ranges: findSilences(sound.subarray(first, last), SPEECH_RATE, options), off: new Set() });
  };
  const seconds = (range: SampleRange) => (range.to - range.from) / SPEECH_RATE;
  const kept = list ? list.ranges.filter((_range, index) => !list.off.has(index)) : [];
  const apply = () => {
    if (!list || kept.length === 0) return;
    const sourceTicks = (sample: number) => Math.round(((list.first + sample) / SPEECH_RATE) * SECOND);
    const result = controller.run({ ...timeline.removeSourceRanges({ sceneId, elementId: list.clip.id, ranges: kept.map((range) => ({ sourceStart: sourceTicks(range.from), sourceEnd: sourceTicks(range.to) })) }), label: "Remove silences" });
    if (!result.ok) return;
    setFound(null);
    toast.show({ kind: "success", message: (kept.length === 1 ? t("1 silence removed", { n: kept.length }) : t("{n} silences removed", { n: kept.length })) });
  };
  // The finder reads the sound on the device: where the platform has no decoder the tool is not there.
  if (!canDecodeSpeech) return null;
  const sourceTicksOf = (first: number, sample: number) => Math.round(((first + sample) / SPEECH_RATE) * SECOND);
  const blocked = !clip ? t("Select one clip with sound") : null;
  return (
    <Tool id="silences" title={t("Remove silences")} where={t("On this device")} note={blocked ?? t("Pauses quieter than the threshold for at least the minimum silence are cut; the padding is kept on each side.")}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
        <View testID="silence-threshold"><NumberField label={t("Threshold")} size="sm" width={132} unit="dB" min={SILENCE_LIMITS.thresholdDb[0]} max={SILENCE_LIMITS.thresholdDb[1]} step={1} value={options.thresholdDb} defaultValue={SILENCE_DEFAULTS.thresholdDb} onCommit={(thresholdDb) => { setOptions({ ...options, thresholdDb }); setFound(null); }} /></View>
        <View testID="silence-minimum"><NumberField label={t("Minimum silence")} size="sm" width={168} unit="s" min={SILENCE_LIMITS.minSeconds[0]} max={SILENCE_LIMITS.minSeconds[1]} step={0.1} value={options.minSeconds} defaultValue={SILENCE_DEFAULTS.minSeconds} onCommit={(minSeconds) => { setOptions({ ...options, minSeconds }); setFound(null); }} /></View>
        <View testID="silence-padding"><NumberField label={t("Padding")} size="sm" width={120} unit="s" min={SILENCE_LIMITS.paddingSeconds[0]} max={SILENCE_LIMITS.paddingSeconds[1]} step={0.05} value={options.paddingSeconds} defaultValue={SILENCE_DEFAULTS.paddingSeconds} onCommit={(paddingSeconds) => { setOptions({ ...options, paddingSeconds }); setFound(null); }} /></View>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
        <Button size="sm" label={busy ? t("Reading the sound…") : t("Find silences")} disabled={blocked !== null || busy} testID="silence-find" onPress={() => void find()} />
        <Button size="sm" kind="strong" label={t("Apply")} disabled={props.readOnly || kept.length === 0} testID="silence-apply" onPress={apply} />
      </View>
      {list && list.ranges.length === 0 ? <Text variant="meta" color="text/secondary" testID="silence-none">{t("No silences found with these settings")}</Text> : null}
      {list && list.ranges.length > 0 ? (
        <View testID="silence-list" style={{ gap: 2 }}>
          {list.ranges.map((range, index) => {
            // Where the silence is heard on the timeline, through the clip's own time map.
            const at = timelineRangeOfSource(list.clip.element, sourceTicksOf(list.first, range.from), sourceTicksOf(list.first, range.to)).start;
            return (
              <View key={index} testID="silence-row" style={{ flexDirection: "row", alignItems: "center", gap: space[2], paddingVertical: 2, paddingHorizontal: space[1], borderRadius: radius.sm, backgroundColor: theme.color("bg/subtle") }}>
                <Checkbox accessibilityLabel={t("Cut the silence at {time}", { time: formatTimecode(at, "HH:MM:SS:FF", fps) ?? "" })} checked={!list.off.has(index)} onChange={(checked) => { const off = new Set(list.off); if (checked) off.delete(index); else off.add(index); setFound({ ...list, off }); }} />
                <Tap role="button" label={t("Go to {time}", { time: formatTimecode(at, "HH:MM:SS:FF", fps) ?? "" })} testID="silence-seek" onPress={() => runtime.seek(at)} style={{ flex: 1 }}><Text variant="mono" style={{ fontSize: 11 }}>{formatTimecode(at, "HH:MM:SS:FF", fps)}</Text></Tap>
                <Text variant="meta" color="text/secondary">{t("{n} s", { n: seconds(range).toFixed(2) })}</Text>
              </View>
            );
          })}
          <Text variant="meta" color="text/secondary" testID="silence-total">{t("{n} of {m} cuts, {s} s removed", { n: kept.length, m: list.ranges.length, s: kept.reduce((sum, range) => sum + seconds(range), 0).toFixed(2) })}</Text>
        </View>
      ) : null}
    </Tool>
  );
}
