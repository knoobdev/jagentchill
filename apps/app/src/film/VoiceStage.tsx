import { useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { film as fm } from "@jagentchill/editor-core";
import { Avatar, Button, Callout, Checkbox, Chip, EmptyState, FormDialog, Icon, IconButton, Input, Menu, NumberField, Select, Tap, Text, Textarea, radius, space, useTheme, useToast, type MenuItem } from "@jagentchill/ui";
import { useT } from "../locale";
import { CAN_PLAY, Field, Picture, Pill, usePlayer } from "./parts";
import { useSampleUpload } from "./data";
import { failed, running, useAct, type StageProps } from "./stage";
import { CAN_PICK_SAMPLE, CAN_RECORD_SAMPLE, pickSample, recordSample, type SampleRecording } from "./voiceSample";
import { EMOTION_ROWS, KIND_ROWS, TICKS, kindLabel, ratioOf, short, usd } from "./strings";

type Draft = { id: string | null; speakerId: string; kind: fm.LineKind; text: string; panelId: string };
/** The columns of the lines table. The header and every row are laid out from this ONE list, so a label always sits over its field. */
const COLUMNS = [
  { id: "n", label: "", width: 28 }, { id: "kind", label: "Kind", width: 96 }, { id: "text", label: "Text", width: 0 }, { id: "panel", label: "Panel", width: 68 }, { id: "emotion", label: "Emotion", width: 112 },
  { id: "intensity", label: "Intensity", width: 64 }, { id: "rate", label: "Rate", width: 68 }, { id: "takes", label: "Takes", width: 0 }, { id: "menu", label: "", width: 24 },
] as const;
type ColumnId = (typeof COLUMNS)[number]["id"];
const COLS = Object.fromEntries(COLUMNS.map((column) => [column.id, column.width])) as Record<ColumnId, number>;
/** The box of one column: a fixed width (wide enough for its header and its values in the three languages), or (Text, Takes) an equal share of what is left. On a narrow screen those two take a row of their own. */
const cell = (id: ColumnId, compact = false): object => (COLS[id] ? { width: COLS[id], flexShrink: 0 } : compact ? { width: "100%" } : { flex: 1, minWidth: 0 });
/** Why a recording is not its line, in the words a person uses (the check itself is `fm.checkSpeech`: measured, never judged by ear). */
const CHECK_WORDS: Record<string, string> = {
  words: "Heard different words", too_long: "Too long for this line", too_short: "Too short for this line", silent: "Nothing can be heard", voice: "Voice differs from this speaker's other lines",
};
/** The check of the recording in use, when it still is a recording of this text. */
const checkOf = (line: fm.Line): fm.Take["check"] => { const take = fm.activeTake(line); return take && !take.stale ? take.check : undefined; };
/** Why nobody listened to the recording in use (it has no verdict: it is neither checked nor failed). */
const uncheckedOf = (line: fm.Line): fm.Take["unchecked"] => { const take = fm.activeTake(line); return take && !take.stale && !take.check ? take.unchecked : undefined; };
/** A speaker's lines of one rate are recorded as ONE recording, followed under the id of the first of them (`speaker:<line id>`). */
const inSpeakerJob = (data: StageProps["data"], film: fm.Film, line: fm.Line, state: "running" | "failed"): boolean => film.lines.some((other) => other.speakerId === line.speakerId && other.rate === line.rate && data.activity[`speaker:${other.id}`]?.state === state);

/** An accent as a person reads it: the listed name in their language, or (a language without a list) their own words. */
const accentLabel = (t: (text: string) => string, language: string, accent: string): string => { const listed = fm.accentsOf(language).find((entry) => entry.id === accent); return listed ? t(listed.label) : accent; };
const megabytes = (bytes: number): string => `${(bytes / 1_048_576).toFixed(bytes < 1_048_576 ? 2 : 1)} MB`;

/**
 * How a speaker speaks, under their name: the ACCENT their lines are asked in (their own, or the film's one default —
 * the narrator's row holds that default), and for a character a SAMPLE of a person's own voice to speak in. Each is
 * offered only where it reaches the voice model in use (`estimate.voice`, from the provider's documentation); where
 * it does not, the control is off and says so — nothing is set that would be ignored.
 */
function SpeakerVoice(props: StageProps & { speakerId: string; name: string }) {
  const t = useT(), act = useAct(), toast = useToast(), upload = useSampleUpload();
  const { film, data, speakerId } = props, facts = props.estimate?.voice, narrator = speakerId === fm.NARRATOR, character = narrator ? undefined : film.characters.find((entry) => entry.id === speakerId);
  const listed = fm.accentsOf(film.language), own = narrator ? film.accent ?? "" : character?.accent ?? "", auto = narrator ? film.accentAuto === true : character?.accentAuto === true;
  const [words, setWords] = useState(own), [recording, setRecording] = useState<SampleRecording | null>(null), [sending, setSending] = useState(false);
  const typed = useRef(own);
  if (typed.current !== own) { typed.current = own; if (words !== own) setWords(own); }
  const player = usePlayer();
  if (!facts || (!narrator && !character)) return null;
  const setAccent = (accent: string) => void act(data.apply([narrator ? { op: "film.set", fields: { accent } } : { op: "asset.update", kind: "character", id: speakerId, fields: { accent } }]));
  const sample = character?.voiceSample, model = facts.model || t("The voice model in use");
  const keep = async (file: (Blob & { name?: string }) | null) => {
    if (!file) return;
    if (file.size > fm.VOICE_SAMPLE_LIMITS.maxBytes) return toast.show({ kind: "error", message: t("A voice sample is at most {size}.", { size: megabytes(fm.VOICE_SAMPLE_LIMITS.maxBytes) }) });
    setSending(true);
    try { const stored = await upload(file); await act(data.apply([{ op: "voice.sample", id: speakerId, sample: stored }])); } catch (error) { toast.show({ kind: "error", message: (error as { message?: string }).message || t("The recording could not be sent to the host.") }); } finally { setSending(false); }
  };
  const stop = async () => { const going = recording; setRecording(null); if (!going) return; try { await keep(await going.stop()); } catch (error) { toast.show({ kind: "error", message: (error as Error).message }); } };
  const record = async () => { try { let made: SampleRecording | null = null; made = await recordSample(fm.VOICE_SAMPLE_LIMITS.maxBytes, () => { if (made) { setRecording(null); void made.stop().then(keep, () => undefined); } }); setRecording(made); } catch (error) { toast.show({ kind: "error", message: (error as Error).message || t("The microphone could not be opened.") }); } };
  return (
    <View testID={`film-speaker-voice-${speakerId}`} {...({ dataSet: { accent: fm.accentOf(film, speakerId), sample: sample ? "1" : "0", instructions: facts.instructions ? "1" : "0", clone: facts.clone ? "1" : "0" } } as object)} style={{ width: "100%", flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[2] }}>
      <Text variant="meta" color="text/secondary">{narrator ? t("Accent of the film") : t("Accent")}</Text>
      {listed.length ? (
        <View testID={`film-speaker-accent-${speakerId}`}><Select size="sm" width={168} label={narrator ? t("Accent of the film") : t("Accent of {name}", { name: props.name })} disabled={!props.mayEdit || !facts.instructions} value={own || "-"}
          options={[{ value: "-", label: narrator ? t("Not set") : t("The film's accent") }, ...listed.map((entry) => ({ value: entry.id, label: t(entry.label) }))]} onChange={(value) => setAccent(value === "-" ? "" : value)} /></View>
      ) : (
        <View testID={`film-speaker-accent-${speakerId}`} style={{ width: 168 }}><Input size="sm" accessibilityLabel={narrator ? t("Accent of the film") : t("Accent of {name}", { name: props.name })} value={words} onChangeText={setWords} maxLength={fm.ACCENT_MAX} readOnly={!props.mayEdit || !facts.instructions} placeholder={narrator ? t("Not set") : t("The film's accent")} onBlur={() => { if (words.trim() !== own) setAccent(words.trim()); }} /></View>
      )}
      {own && auto ? <Chip size="sm" label={t("From the story")} /> : null}
      {!facts.instructions ? <Text variant="meta" color="text/secondary" testID={`film-speaker-accent-off-${speakerId}`} style={{ flexShrink: 1 }}>{t("{model} takes no accent: it speaks the way its voice does.", { model })}</Text>
        : narrator && !own ? <Text variant="meta" color="text/secondary" style={{ flexShrink: 1 }}>{t("With no accent set, the voice model decides for each line by itself.")}</Text> : null}
      {character ? (
        <View testID={`film-speaker-sample-${speakerId}`} {...({ dataSet: { state: sample ? "set" : recording ? "recording" : facts.clone ? "ready" : "off" } } as object)} style={{ width: "100%", flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[2] }}>
          <Text variant="meta" color="text/secondary">{t("Own voice")}</Text>
          {sample ? <>
            {CAN_PLAY ? <IconButton icon={player.playing === sample.blobId ? "pause" : "play"} size="xs" label={player.playing === sample.blobId ? t("Pause") : t("Play the sample")} onPress={() => player.toggle(sample.blobId)} /> : null}
            <Text variant="meta" numberOfLines={1} style={{ flexShrink: 1 }} testID={`film-speaker-sample-name-${speakerId}`}>{`${sample.name} · ${megabytes(sample.bytes)}`}</Text>
            {props.mayEdit ? <Button size="xs" kind="ghost" tone="danger" icon="trash" label={t("Delete the sample")} testID={`film-speaker-sample-remove-${speakerId}`} onPress={() => { player.stop(); void act(data.apply([{ op: "voice.sample", id: speakerId, sample: null }])); }} /> : null}
          </> : props.mayEdit ? <>
            {CAN_PICK_SAMPLE ? <Button size="xs" icon="folder" label={t("Choose a recording")} testID={`film-speaker-sample-pick-${speakerId}`} disabled={!facts.clone || !!recording} loading={sending} onPress={() => void pickSample().then(keep)} /> : null}
            {CAN_RECORD_SAMPLE ? <Button size="xs" icon={recording ? "stop" : "mic"} label={recording ? t("Stop recording") : t("Record")} testID={`film-speaker-sample-record-${speakerId}`} disabled={!facts.clone || sending} onPress={() => void (recording ? stop() : record())} /> : null}
          </> : null}
          <Text variant="meta" color="text/secondary" testID={`film-speaker-sample-note-${speakerId}`} style={{ flexShrink: 1 }}>
            {!facts.clone ? (sample ? t("The sample is kept but not used: {model} cannot speak in the voice of a sample. Choose a voice model that can in Settings ▸ Model routing.", { model }) : t("{model} cannot speak in the voice of a sample. Choose a voice model that can in Settings ▸ Model routing.", { model }))
              : sample ? t("{name} speaks in the voice of this sample. It is sent to the voice provider with every line of theirs.", { name: props.name })
                : t("A short recording of your own voice: {name} then speaks in it. The sample is sent to the voice provider with every line of theirs.", { name: props.name })}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** Voice: every speaker with the voice that reads them, their lines under them, and for each line whether its recording is the line. */

export function VoiceStage(props: StageProps) {
  const t = useT(), theme = useTheme(), act = useAct(), player = usePlayer();
  const { film, data } = props;
  const [keep, setKeep] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [picked, setPicked] = useState<{ lineId: string; takeId: string } | null>(null);
  const [attention, setAttention] = useState(false);
  const counts = fm.counts(film), voices = props.estimate?.voices ?? [], noSpeech = props.estimate?.capabilities.speech === false;
  const ordered = fm.orderedPanels(film), numberOf = new Map(ordered.map((panel, index) => [panel.id, index + 1]));
  if (!film.panels.length && !film.lines.length) return <EmptyState icon="voice" title={t("No voice lines yet")} description={t("Create the script from the story first")} actions={[{ label: t("Go to Story"), onPress: () => props.go("story") }]} />;
  const speakers = fm.speakers(film);
  // A line needs attention when its recording was checked and is not the line, or when it could not be recorded at all.
  const needs = (entry: fm.Line): boolean => checkOf(entry)?.ok === false || failed(data, `line:${entry.id}`) !== null;
  const needing = film.lines.filter(needs).length, onlyNeeding = attention && needing > 0;
  // The lines under their speaker, in the film's order; a line of someone no longer in the cast is the narrator's.
  const known = new Set(speakers.map((speaker) => speaker.id));
  const groups = [...speakers, ...(film.lines.some((entry) => !known.has(entry.speakerId)) && !known.has(fm.NARRATOR) ? [{ id: fm.NARRATOR, name: "Narrator", voiceId: film.narratorVoiceId }] : [])]
    .map((speaker) => ({ speaker, lines: film.lines.filter((entry) => (entry.speakerId === speaker.id || (speaker.id === fm.NARRATOR && !known.has(entry.speakerId))) && (!onlyNeeding || needs(entry))) }))
    .filter((group) => group.lines.length > 0 || !onlyNeeding);
  const setVoice = (speakerId: string, voiceId: string) => void act(data.apply([speakerId === fm.NARRATOR ? { op: "film.set", fields: { narratorVoiceId: voiceId } } : { op: "asset.update", kind: "character", id: speakerId, fields: { voiceId } }]));
  const update = (id: string, fields: Record<string, unknown>) => void act(data.apply([{ op: "line.update", id, fields }]));
  const submit = async () => {
    if (!draft) return;
    const fields = { speakerId: draft.speakerId, kind: draft.speakerId === fm.NARRATOR && draft.kind === "dialogue" ? "narration" as const : draft.kind, text: draft.text, panelId: draft.panelId === "-" ? null : draft.panelId };
    if (await act(data.apply([draft.id ? { op: "line.update", id: draft.id, fields } : { op: "line.add", fields }]))) setDraft(null);
  };
  const line = picked ? film.lines.find((entry) => entry.id === picked.lineId) : undefined, take = line?.takes.find((entry) => entry.id === picked?.takeId);
  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: space[4], gap: space[3] }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[2] }}>
          <View style={{ flexGrow: 1, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[2] }}>
            {needing > 0 ? <View testID="film-voice-attention" {...({ dataSet: { on: onlyNeeding ? "1" : "0", count: String(needing) } } as object)}><Chip size="md" icon="warn" label={t("Needs attention ({n})", { n: needing })} selected={onlyNeeding} onPress={() => setAttention(!onlyNeeding)} /></View> : null}
          </View>
          <Checkbox label={t("Keep current take")} checked={keep} onChange={setKeep} />
          {props.mayEdit ? <Button size="sm" icon="plus" label={t("Add line")} testID="film-line-add" onPress={() => setDraft({ id: null, speakerId: fm.NARRATOR, kind: "narration", text: "", panelId: "-" })} /> : null}
          {props.mayRun ? <Button kind="strong" size="sm" icon="wave" label={t("Generate all ({n})", { n: counts.linesMissing })} testID="film-voice-all" disabled={!counts.linesMissing || noSpeech} onPress={() => void act(data.generate({ kind: "lines", scope: "missing", keepCurrent: keep }))} /> : null}
        </View>
        {noSpeech ? <Callout tone="warning">{t("No way to obtain speech: connect a speech provider under Settings, Providers, Generation.")}</Callout> : null}
        {!film.lines.length ? <Text color="text/secondary">{t("This film has no spoken lines.")}</Text> : (
          <View testID="film-lines" style={{ borderTopWidth: 1, borderTopColor: theme.color("border/hairline") }}>
            {theme.compact ? null : (
              <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], paddingVertical: space[1], paddingHorizontal: space[2], backgroundColor: theme.color("bg/subtle") }}>
                {COLUMNS.map((column) => <View key={column.id} testID={`film-lines-head-${column.id}`} style={cell(column.id)}>{column.id === "n" || column.label ? <Text variant="meta" color="text/secondary" numberOfLines={1}>{column.id === "n" ? "#" : t(column.label)}</Text> : null}</View>)}
              </View>
            )}
            {groups.map(({ speaker, lines }) => {
              // A voice automatic casting gave carries a small tag; a pick by hand clears it.
              const auto = speaker.id === fm.NARRATOR ? film.narratorVoiceAuto : film.characters.find((entry) => entry.id === speaker.id)?.voiceAuto;
              // Every line of this speaker, whatever the filter shows: "Record this speaker again" is about all of them.
              const own = film.lines.filter((entry) => entry.speakerId === speaker.id);
              const recording = own.some((entry) => running(data, `line:${entry.id}`) || running(data, `speaker:${entry.id}`)), stopped = own.map((entry) => failed(data, `speaker:${entry.id}`)).find((message) => message !== null) ?? null;
              return (
                <View key={speaker.id} testID={`film-speaker-group-${speaker.id}`}>
                  <View testID={`film-speaker-${speaker.id}`} style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[2], paddingVertical: space[2], paddingHorizontal: space[2], borderBottomWidth: 1, borderBottomColor: theme.color("border/hairline") }}>
                    <Avatar name={t(speaker.name)} id={speaker.id} size={20} />
                    <Text variant="body-medium" numberOfLines={1}>{t(speaker.name)}</Text>
                    <Text variant="meta" color="text/secondary">{lines.length === 1 ? t("1 voice line") : t("{n} voice lines", { n: lines.length })}</Text>
                    <View style={{ flex: 1 }} />
                    {speaker.voiceId && auto ? <Chip size="sm" label={t("Auto")} /> : null}
                    <Select size="sm" width={188} label={t("Voice of {name}", { name: t(speaker.name) })} disabled={!props.mayEdit || !voices.length} value={speaker.voiceId || "-"}
                      options={[{ value: "-", label: (voices.length ? t("Default voice") : t("No voice")) }, ...voices.map((voice) => ({ value: voice.voiceId, label: voice.name }))]} onChange={(voiceId) => setVoice(speaker.id, voiceId === "-" ? "" : voiceId)} />
                    {props.mayRun && own.length ? <Button size="sm" icon="refresh" label={t("Record this speaker again")} testID={`film-speaker-rerecord-${speaker.id}`} loading={recording} disabled={noSpeech} onPress={() => void act(data.generate({ kind: "speaker", speakerId: speaker.id }))} /> : null}
                    {stopped ? <Text variant="meta" color="danger/text" style={{ width: "100%" }} testID={`film-speaker-error-${speaker.id}`}>{stopped}</Text> : null}
                    <SpeakerVoice {...props} speakerId={speaker.id} name={t(speaker.name)} />
                  </View>
                  {lines.map((entry) => { const index = film.lines.indexOf(entry); return <LineRow key={entry.id} {...props} line={entry} index={index} keep={keep} panelNumber={entry.panelId ? numberOf.get(entry.panelId) : undefined} picked={picked?.lineId === entry.id ? picked.takeId : null}
              playing={player.playing} onTake={(found) => { setPicked({ lineId: entry.id, takeId: found.id }); if (CAN_PLAY) player.toggle(found.media.blobId); }} onEdit={() => setDraft({ id: entry.id, speakerId: entry.speakerId, kind: entry.kind, text: entry.text, panelId: entry.panelId ?? "-" })} onUpdate={(fields) => update(entry.id, fields)} />; })}
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
      {line && take ? (
        <View testID="film-take-bar" style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[3], margin: space[4], marginTop: 0, padding: space[2], borderWidth: 1, borderColor: theme.color("border/hairline"), borderRadius: radius.md, backgroundColor: theme.color("bg/elevated") }}>
          {CAN_PLAY ? <IconButton icon={player.playing === take.media.blobId ? "pause" : "play"} variant="outline" label={(player.playing === take.media.blobId ? t("Pause") : t("Play"))} testID="film-take-play" onPress={() => player.toggle(take.media.blobId)} /> : null}
          <View style={{ flex: 1, minWidth: 160 }}>
            <Text variant="body-medium" numberOfLines={1}>{`${t("Line {n}", { n: film.lines.indexOf(line) + 1 })} · ${t(fm.speakerName(film, line.speakerId))} · ${t("Take {n}", { n: line.takes.length - line.takes.indexOf(take) })}`}</Text>
            <Text variant="meta" color="text/secondary" numberOfLines={1}>{[`${(take.duration_ticks / TICKS).toFixed(1)} s`, take.media.provenance?.model ? String(take.media.provenance.model) : "", usd(take.costUsd), take.stale ? t("outdated") : ""].filter(Boolean).join(" · ")}</Text>
          </View>
          {take.accent ? <Text variant="meta" color="text/secondary" testID="film-take-accent" style={{ width: "100%" }}>{t("Accent asked: {accent}. Not verifiable — the check listens for the words, nothing here measures an accent.", { accent: accentLabel(t, film.language, take.accent) })}</Text> : null}
          {take.voiceSampleId ? <Text variant="meta" color="text/secondary" testID="film-take-sample" style={{ width: "100%" }}>{t("Spoken in the voice of this speaker's sample.")}</Text> : null}
          <Text variant="meta" color="text/secondary" tabular>{`${short(Math.round((player.playing === take.media.blobId ? player.position : 0) * TICKS))} / ${short(take.duration_ticks)}`}</Text>
          {line.panelId ? <Button kind="ghost" size="sm" label={t("Locate panel")} testID="film-take-locate" onPress={() => props.go("storyboard")} /> : null}
          {props.mayEdit && line.activeTakeId !== take.id ? <Button size="sm" label={t("Use this take")} testID="film-take-use" onPress={() => void act(data.apply([{ op: "line.take.use", id: line.id, takeId: take.id }]))} /> : null}
          {props.mayEdit ? <IconButton icon="trash" size="sm" label={t("Delete take")} testID="film-take-delete" onPress={() => { player.stop(); setPicked(null); void act(data.apply([{ op: "line.take.remove", id: line.id, takeId: take.id }])); }} /> : null}
        </View>
      ) : null}
      <FormDialog open={!!draft} title={t(draft?.id ? "Edit line" : "Add line")} submitLabel={t(draft?.id ? "Save" : "Add")} dirty={!!draft?.text.trim()} canSubmit={!!draft?.text.trim()} onClose={() => setDraft(null)} onSubmit={() => void submit()}>
        {draft ? <View style={{ gap: space[3] }}>
          <View style={{ flexDirection: "row", gap: space[3] }}>
            <Field label={t("Speaker")} grow><Select size="sm" label={t("Speaker")} value={draft.speakerId} options={[...film.characters.map((entry) => ({ value: entry.id, label: entry.name })), { value: fm.NARRATOR, label: t("Narrator") }]} onChange={(speakerId) => setDraft({ ...draft, speakerId })} /></Field>
            <Field label={t("Kind")} grow><Select size="sm" label={t("Kind")} value={draft.kind} options={KIND_ROWS.map((row) => ({ value: row.id, label: t(row.label) }))} onChange={(kind) => setDraft({ ...draft, kind })} /></Field>
          </View>
          <Field label={t("Text")}><Textarea testID="film-line-text" value={draft.text} onChangeText={(text) => setDraft({ ...draft, text })} maxLength={fm.LIMITS.lineText} minLines={3} maxLines={6} autoFocus /></Field>
          <Field label={t("Panel")}><Select size="sm" label={t("Panel")} value={draft.panelId} options={[{ value: "-", label: t("Not placed") }, ...ordered.map((panel, at) => ({ value: panel.id, label: `${at + 1} · ${panel.action.slice(0, 60)}` }))]} onChange={(panelId) => setDraft({ ...draft, panelId })} /></Field>
        </View> : null}
      </FormDialog>
    </View>
  );
}

function LineRow(props: StageProps & { line: fm.Line; index: number; keep: boolean; panelNumber?: number; picked: string | null; playing: string | null; onTake(take: fm.Take): void; onEdit(): void; onUpdate(fields: Record<string, unknown>): void }) {
  const t = useT(), theme = useTheme(), act = useAct();
  const { film, data, line } = props, key = `line:${line.id}`, busy = running(data, key) || inSpeakerJob(data, film, line, "running"), problem = failed(data, key);
  const [menu, setMenu] = useState(false);
  const anchor = useRef<View>(null);
  const panel = line.panelId ? film.panels.find((entry) => entry.id === line.panelId) : undefined;
  // What a listener made of the recording in use: a quiet mark when it is the line, the reason and a way out when it is not.
  const verdict = busy ? undefined : checkOf(line), unheard = busy ? undefined : uncheckedOf(line), noSpeech = props.estimate?.capabilities.speech === false;
  const generate = () => void act(data.generate({ kind: "line", id: line.id, keepCurrent: props.keep }));
  const emotions = EMOTION_ROWS.some((row) => row.id === line.emotion) ? EMOTION_ROWS : [...EMOTION_ROWS, { id: line.emotion, label: line.emotion.charAt(0).toUpperCase() + line.emotion.slice(1) }];
  const items: MenuItem[] = [
    ...(props.mayEdit ? [{ id: "edit", label: t("Edit line"), icon: "pencil" as const, onSelect: props.onEdit }] : []),
    ...(props.mayRun ? [{ id: "take", label: (line.takes.length ? t("Generate another take") : t("Generate")), icon: "wave" as const, disabled: busy, onSelect: generate }] : []),
    ...(props.mayEdit ? [{ type: "separator" as const }, { id: "delete", label: t("Delete line"), icon: "trash" as const, danger: true, onSelect: () => void act(data.apply([{ op: "line.remove", id: line.id }])) }] : []),
  ];
  const compact = theme.compact;
  return (
    <View testID={`film-line-${line.id}`} {...({ dataSet: { takes: String(line.takes.length), state: busy ? "running" : !fm.activeTake(line) ? "empty" : fm.activeTake(line)!.stale ? "stale" : "ready", check: verdict ? (verdict.ok ? "ok" : verdict.reason ?? "failed") : unheard ? "unchecked" : "none" } } as object)}
      style={{ paddingVertical: space[2], paddingHorizontal: space[2], gap: space[2], borderBottomWidth: 1, borderBottomColor: theme.color("border/hairline") }}>
      <View style={{ flexDirection: "row", flexWrap: compact ? "wrap" : "nowrap", alignItems: "center", gap: space[2] }}>
      <View style={cell("n")} {...({ dataSet: { col: "n" } } as object)}><Text variant="meta" color="text/secondary" tabular>{props.index + 1}</Text></View>
      <View style={[cell("kind"), { alignItems: "flex-start" }]} {...({ dataSet: { col: "kind" } } as object)}><Chip size="sm" label={t(kindLabel(line.kind))} /></View>
      <View style={cell("text", compact)} {...({ dataSet: { col: "text" } } as object)}><Text style={{ overflowWrap: "anywhere" } as object} numberOfLines={3} onPress={props.mayEdit ? props.onEdit : undefined}>{line.text}</Text></View>
      <View style={cell("panel")} {...({ dataSet: { col: "panel" } } as object)}>{panel ? <Picture blobId={panel.picture.current?.media.blobId} ratio={ratioOf(film.aspectRatio)} height={24} /> : <Text variant="meta" color="warning/text">{t("Not placed")}</Text>}</View>
      <View style={cell("emotion")} {...({ dataSet: { col: "emotion" } } as object)}><Select size="xs" width={COLS.emotion} label={t("Emotion")} disabled={!props.mayEdit} value={line.emotion} options={emotions.map((row) => ({ value: row.id, label: t(row.label) }))} onChange={(emotion) => props.onUpdate({ emotion })} /></View>
      <View style={cell("intensity")} {...({ dataSet: { col: "intensity" } } as object)}><NumberField size="xs" width={COLS.intensity} label={t("Intensity")} hideLabel min={0} max={100} step={5} disabled={!props.mayEdit} value={line.intensity} onCommit={(intensity) => props.onUpdate({ intensity })} /></View>
      <View style={cell("rate")} {...({ dataSet: { col: "rate" } } as object)}><NumberField size="xs" width={COLS.rate} label={t("Rate")} hideLabel unit="×" min={0.5} max={2} step={0.05} disabled={!props.mayEdit} value={line.rate} onCommit={(rate) => props.onUpdate({ rate })} /></View>
      <View style={[{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[1] }, cell("takes", compact)]} {...({ dataSet: { col: "takes" } } as object)}>
        {line.takes.map((take, at) => {
          const active = take.id === line.activeTakeId, on = props.picked === take.id;
          return (
            <Tap key={take.id} label={t("Take {n}", { n: line.takes.length - at })} pressedState={active} onPress={() => props.onTake(take)}
              style={{ height: 22, flexDirection: "row", alignItems: "center", gap: space[1], paddingHorizontal: space[2], borderRadius: radius.full, borderWidth: on ? 1 : 0, borderColor: theme.color("accent"), backgroundColor: theme.color(active ? "accent/subtle" : "bg/subtle") }}>
              <Text variant="meta" color={active ? "accent/text" : "text/primary"} tabular>{`${props.playing === take.media.blobId ? "❚❚" : "▶"} ${t("Take {n}", { n: line.takes.length - at })} · ${short(take.duration_ticks)}`}</Text>
              {take.stale ? <Text variant="meta" color="warning/text">{t("outdated")}</Text> : null}
            </Tap>
          );
        })}
        {busy ? <Chip size="sm" label={t("Generating")} /> : !line.takes.length && props.mayRun ? <Button size="xs" icon="wave" label={t("Generate")} testID={`film-line-generate-${line.id}`} disabled={props.estimate?.capabilities.speech === false} onPress={generate} /> : null}
        {verdict?.ok ? <View testID={`film-line-checked-${line.id}`} style={{ flexDirection: "row", alignItems: "center", gap: 2 }}><Icon name="check" size="sm" color="text/tertiary" /><Text variant="meta" color="text/tertiary">{t("Checked")}</Text></View> : null}
        {/* Nobody listened to this recording: it is said, never shown as checked. */}
        {unheard ? <View testID={`film-line-unchecked-${line.id}`} style={{ flexDirection: "row", alignItems: "center", gap: 2 }}><Icon name="minus" size="sm" color="text/tertiary" /><Text variant="meta" color="text/tertiary">{unheard.why === "no_listener" ? t("Not checked — no listener on this host") : t("Not checked — the listener could not be asked")}</Text></View> : null}
        {problem ? <Text variant="meta" color="danger/text">{problem}</Text> : null}
      </View>
      {/* On a narrow screen the row wraps: the menu stays at the top end of the line instead of taking a row of its own. */}
      <View style={[cell("menu"), { alignItems: "flex-end" }, compact ? { position: "absolute", top: 0, end: 0 } : null]} {...({ dataSet: { col: "menu" } } as object)}>
      {items.length ? <IconButton ref={anchor} icon="more" size="xs" label={t("Options of line {n}", { n: props.index + 1 })} testID={`film-line-menu-${line.id}`} expanded={menu} onPress={() => setMenu(true)} /> : null}
      <Menu open={menu} anchor={anchor} items={items} label={t("Options of line {n}", { n: props.index + 1 })} onClose={() => setMenu(false)} />
      </View>
      </View>
      {verdict && !verdict.ok ? (
        <View testID={`film-line-check-${line.id}`} style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[2], paddingStart: compact ? 0 : COLS.n + space[2] }}>
          <Pill tone="warning" label={CHECK_WORDS[verdict.reason ?? ""] ? t(CHECK_WORDS[verdict.reason ?? ""]) : t("Does not sound like this line")} testID={`film-line-check-reason-${line.id}`} />
          <Text variant="meta" color="text/secondary" numberOfLines={2} style={{ flexShrink: 1 }} testID={`film-line-check-detail-${line.id}`}>
            {verdict.reason === "words" && verdict.heard ? t("Heard: “{text}”", { text: verdict.heard }) : verdict.reason === "too_long" || verdict.reason === "too_short" ? t("The recording is {n} s long", { n: verdict.seconds }) : verdict.reason === "voice" && verdict.pitchHz ? t("Pitch {n} Hz", { n: Math.round(verdict.pitchHz) }) : ""}
          </Text>
          {props.mayRun ? <Button size="xs" icon="refresh" label={t("Record again")} testID={`film-line-rerecord-${line.id}`} disabled={noSpeech} onPress={generate} /> : null}
        </View>
      ) : null}
    </View>
  );
}
