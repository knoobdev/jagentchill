import { useEffect, useRef, useState, type ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { preference } from "@jagentchill/app-core";
import {
  addCaptionAt, captionCues, editCaption, captionFileName, captionTracksOf, decodeSubtitle, formatTimecode, importCaptions, parseSubtitles, parseTimecode, setCaptionText, SUBTITLE_MAX_BYTES, SUBTITLE_MESSAGES, subtitleFormatOf, SubtitleError, timeline,
  writeSrt, writeTxt, writeVtt, type ParsedSubtitles,
} from "@jagentchill/editor-core";
import type { ProjectDocument, Rational } from "@jagentchill/protocol";
import { Button, Icon, IconButton, Input, Menu, Modal, Select, Switch, Tap, Text, radius, space, useTheme, useToast } from "@jagentchill/ui";
import { useT } from "../../locale";
import { pickFiles } from "../../platform/store";
import { usePref } from "../../state";
import { saveTextFile } from "../content-dom";
import { useEditor, useEditorVersion, useTransport } from "../context";
import { bindDropZone } from "../dom";
import { AutoCaptions } from "../captions/AutoCaptions";
import { canDecodeSpeech } from "../captions/dom";
import { LANGUAGES } from "../captions/languages";
import { TranslateDialog } from "../captions/TranslateDialog";

type Caption = { id: string; startTime: number; duration: number; text: string; translation?: string; style?: unknown };
type Pending = { name: string; bytes: Uint8Array; parsed: ParsedSubtitles; uncertain: boolean; encoding: string };
const SECOND = 120_000;
const SOURCES = [{ value: "timeline", label: "Whole timeline" }, { value: "main", label: "Main track" }, { value: "audio", label: "Voiceover and audio tracks" }, { value: "selection", label: "Selected clips" }] as const;
const ENCODINGS = ["utf-8", "utf-16le", "windows-1252", "shift_jis", "gbk", "big5", "euc-kr", "windows-1258"] as const;
const ENCODING_NAMES: Record<string, string> = { "utf-8": "UTF-8", "utf-16le": "UTF-16", "windows-1252": "Windows-1252", shift_jis: "Shift_JIS", gbk: "GBK", big5: "Big5", "euc-kr": "EUC-KR", "windows-1258": "Windows-1258" };
/** The choices of the Auto captions section, remembered per device. */
const AUTO_CAPTIONS = preference<{ source: string; language: string }>("captions.auto", { source: "timeline", language: "auto" }, (value): value is { source: string; language: string } =>
  value !== null && typeof value === "object" && ["source", "language"].every((key) => typeof (value as Record<string, unknown>)[key] === "string"));

/**
 * The Captions tab: Auto captions (source and language of speech recognition; the model is the Transcription role's), Import (a subtitle file, picked
 * or dropped, becomes a caption track after its options are confirmed) and Captions — the editable list of the active
 * caption track with its track selector, Translate, Style, Add caption and Export. A row seeks to its caption and
 * selects it; its text is committed on blur.
 */
export function CaptionsTab(props: { document: ProjectDocument; readOnly: boolean }) {
  const t = useT();
  const theme = useTheme();
  const toast = useToast();
  const runtime = useEditor();
  useEditorVersion();
  const transport = useTransport();
  const { controller } = runtime, sceneId = controller.session.sceneId, fps = props.document.settings.fps as Rational;
  const tracks = captionTracksOf(props.document, sceneId) as unknown as { id: string; name: string; caption: { language?: string }; elements: Caption[] }[];
  const [picked, setPicked] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Pending | null>(null);
  const [options, setOptions] = useState({ language: "und", offset: "00:00:00:00", atPlayhead: false });
  const [over, setOver] = useState(false);
  const [auto, setAuto] = usePref(AUTO_CAPTIONS);
  const zone = useRef<View>(null), exportAnchor = useRef<View>(null);
  const [exporting, setExporting] = useState(false);
  const [translating, setTranslating] = useState(false);
  const track = tracks.find((entry) => entry.id === picked) ?? tracks[0];
  const selected = controller.session.selection.selectedElements;

  /** Reads a subtitle file and opens its import options; a file that cannot be imported says why and adds nothing. */
  const open = async (file: File) => {
    try {
      if (!subtitleFormatOf(file.name)) throw new SubtitleError(SUBTITLE_MESSAGES.unsupported);
      if (file.size > SUBTITLE_MAX_BYTES) throw new SubtitleError(SUBTITLE_MESSAGES.tooLarge);
      const bytes = new Uint8Array(await file.arrayBuffer()), decoded = decodeSubtitle(bytes), parsed = parseSubtitles(file.name, decoded.text);
      if (parsed.cues.length === 0) throw new SubtitleError(SUBTITLE_MESSAGES.empty);
      setOptions({ language: "und", offset: "00:00:00:00", atPlayhead: false });
      setPending({ name: file.name, bytes, parsed, uncertain: decoded.uncertain, encoding: "utf-8" });
    } catch (error) {
      toast.show({ kind: "warning", message: error instanceof SubtitleError ? t(error.message) : t("Couldn't read this subtitle file") });
    }
  };
  const importFile = async () => { const [file] = await pickFiles(".srt,.vtt,.ass,.ssa", false); if (file) await open(file); };
  useEffect(() => (props.readOnly ? undefined : bindDropZone(zone.current, {
    over(info) { const files = info.files.length > 0 || info.payload === null; setOver(files); return files; },
    leave() { setOver(false); },
    drop(info) { const [file] = info.files; if (file) void open(file); },
  })), [props.readOnly]); // eslint-disable-line react-hooks/exhaustive-deps
  const reDecode = (encoding: string) => {
    if (!pending) return;
    try { setPending({ ...pending, encoding, parsed: parseSubtitles(pending.name, decodeSubtitle(pending.bytes, encoding).text) }); } catch { toast.show({ kind: "warning", message: t("Couldn't read this subtitle file") }); }
  };
  // The offset is typed as a timecode, with a leading minus for an earlier start: −24 h to +24 h.
  const offsetTicks = (() => { const text = options.offset.trim(), negative = /^[-−]/.test(text), parsed = parseTimecode(text.replace(/^[-−+]/, ""), "HH:MM:SS:FF", fps); return parsed === null ? null : Math.max(-24 * 3600 * SECOND, Math.min(24 * 3600 * SECOND, (negative ? -1 : 1) * Number(parsed))); })();
  const confirmImport = () => {
    if (!pending || offsetTicks === null) return;
    const { parsed } = pending, first = Math.min(...parsed.cues.map((cue) => cue.start_ms));
    const offset_ms = Math.round(offsetTicks / (SECOND / 1000)) + (options.atPlayhead ? Math.round(controller.session.playhead / (SECOND / 1000)) - first : 0);
    const result = controller.run(importCaptions({ sceneId, parsed, language: options.language.trim() || "und", offset_ms, name: tracks.length === 0 ? "Captions" : `Captions ${tracks.length + 1}` }));
    setPending(null);
    if (!result.ok) return;
    setPicked(result.info?.trackId ?? null);
    const count = parsed.cues.length;
    const summary = [t(count === 1 ? "1 caption imported" : "{n} captions imported", { n: count }), ...(parsed.skipped ? [t("{n} skipped", { n: parsed.skipped })] : []), ...(parsed.trimmed ? [t("{n} trimmed", { n: parsed.trimmed })] : [])].join(", ");
    toast.show({ kind: "success", message: parsed.warnings.length ? `${summary}. ${parsed.warnings.join("; ")}` : summary });
  };
  const exportAs = (format: "srt" | "vtt" | "txt", content: "primary" | "both" = "primary") => {
    if (!track) return;
    const cues = captionCues(track);
    if (cues.length === 0) { toast.show({ kind: "warning", message: t("There are no captions to export") }); return; }
    const text = format === "srt" ? writeSrt(cues, { content }) : format === "vtt" ? writeVtt(cues, { content }) : writeTxt(cues, { content });
    saveTextFile(captionFileName(props.document.metadata.name, track.caption.language, format), text, format === "vtt" ? "text/vtt" : "text/plain");
  };
  const commitText = (caption: Caption) => {
    const draft = drafts[caption.id];
    setDrafts(({ [caption.id]: _gone, ...rest }) => rest);
    if (draft !== undefined && draft !== caption.text) controller.external((doc, ctx) => setCaptionText(doc, ctx, caption.id, draft));
  };
  const translated = typeof (track?.caption as { translationLanguage?: string } | undefined)?.translationLanguage === "string";
  const commitTranslation = (caption: Caption) => {
    const key = `${caption.id}:translation`, draft = drafts[key];
    setDrafts(({ [key]: _gone, ...rest }) => rest);
    if (draft !== undefined && draft !== (caption.translation ?? "")) controller.external((doc, ctx) => editCaption(doc, ctx, caption.id, { translation: draft }));
  };
  /** Style: the caption under the playhead (or the first of the track) is selected, and the inspector shows its styles. */
  const openStyle = () => {
    if (!track) return;
    const live = track.elements.find((caption) => transport.time >= caption.startTime && transport.time < caption.startTime + caption.duration) ?? track.elements[0];
    if (!live) return;
    runtime.seek(Math.max(live.startTime, Math.min(transport.time, live.startTime + live.duration - 1)));
    controller.select(timeline.selectElements([live.id]));
  };
  // — Auto captions: what would be transcribed —
  const scene = timeline.sceneById(props.document, sceneId);
  const audible = (element: timeline.El) => timeline.isAudioCapable(props.document, element) && element.muted !== true && element.hidden !== true;
  const sounding = (zoneOf: "main" | "audio" | "all") => [...(zoneOf !== "audio" ? [scene.tracks.main, ...scene.tracks.overlay] : []), ...(zoneOf !== "main" ? scene.tracks.audio : [])].filter((entry) => (entry as { muted?: boolean }).muted !== true).flatMap((entry) => (zoneOf === "main" && entry !== scene.tracks.main ? [] : (entry.elements as unknown as timeline.El[]).filter(audible)));
  const selectionSounds = timeline.elementsOfScene(scene).some((element) => selected.includes(element.id) && audible(element));
  const source = auto.source === "selection" && !selectionSounds ? "timeline" : auto.source;
  const hasAudio = source === "selection" ? selectionSounds : sounding(source === "main" ? "main" : source === "audio" ? "audio" : "all").length > 0;
  return (
    <View testID="captions-tab" style={{ flex: 1, minHeight: 0 }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: space[3], gap: space[2] }}>
        {canDecodeSpeech ? (
          <>
        <Text variant="body-medium">{t("Auto captions")}</Text>
        <View testID="auto-captions" style={{ gap: space[1.5] }}>
          <Field label={t("Source")}><Select label={t("Source")} size="sm" value={source} options={SOURCES.filter((entry) => entry.value !== "selection" || selectionSounds).map((entry) => ({ value: entry.value, label: t(entry.label) }))} onChange={(next) => setAuto({ ...auto, source: next })} /></Field>
          <Field label={t("Language")}><Select label={t("Language")} size="sm" value={auto.language} options={LANGUAGES.map((entry) => ({ value: entry.value, label: t(entry.label) }))} onChange={(next) => setAuto({ ...auto, language: next })} /></Field>
          <AutoCaptions document={props.document} readOnly={props.readOnly} source={source as "timeline" | "main" | "audio" | "selection"} language={auto.language} hasAudio={hasAudio} onTrack={setPicked} />
        </View>
          </>
        ) : null}
        <Text variant="body-medium" style={{ paddingTop: space[2] }}>{t("Import")}</Text>
        <View ref={zone} testID="captions-dropzone" style={{ flexDirection: "row", alignItems: "center", gap: space[2], padding: space[2], borderRadius: radius.md, borderWidth: 1, borderStyle: "dashed", borderColor: theme.color(over ? "accent/text" : "border/control"), backgroundColor: over ? theme.color("accent/subtle") : "transparent" }}>
          <Icon name="download" size={16} color="text/secondary" />
          <Text variant="meta" color="text/secondary" style={{ flex: 1 }}>{t("Drop .srt, .vtt or .ass here")}</Text>
          <Button size="xs" kind="outline" label={t("Choose file")} disabled={props.readOnly} testID="captions-import" onPress={() => void importFile()} />
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[1], paddingTop: space[2] }}>
          <Text variant="body-medium" style={{ flex: 1 }}>{t("Captions")}</Text>
          {tracks.length > 0 ? <View style={{ width: 92 }} testID="captions-track"><Select label={t("Caption track")} size="xs" value={track?.id ?? null} options={tracks.map((entry) => ({ value: entry.id, label: entry.name }))} onChange={setPicked} /></View> : null}
          {track ? <IconButton icon="translate" size="xs" label={t("Translate")} disabled={props.readOnly} testID="captions-translate" onPress={() => setTranslating(true)} /> : null}
          {track ? <IconButton icon="palette" size="xs" label={t("Style")} testID="captions-style" onPress={openStyle} /> : null}
          {track ? <View ref={exportAnchor} testID="captions-export"><IconButton icon="export" size="xs" label={t("Export captions")} onPress={() => setExporting(true)} /></View> : null}
        </View>
        <Menu open={exporting} onClose={() => setExporting(false)} anchor={exportAnchor} label={t("Export captions")} align="end" items={[{ id: "srt", label: "SRT", onSelect: () => exportAs("srt") }, { id: "vtt", label: "WebVTT", onSelect: () => exportAs("vtt") }, { id: "txt", label: "TXT", onSelect: () => exportAs("txt") }, ...(translated ? [{ id: "srt-both", label: t("SRT — both languages"), onSelect: () => exportAs("srt", "both") }, { id: "vtt-both", label: t("WebVTT — both languages"), onSelect: () => exportAs("vtt", "both") }] : [])]} />
        {!track ? <Text variant="meta" color="text/secondary" testID="captions-empty">{t("No captions yet — generate them from speech or import a subtitle file.")}</Text> : null}
        {(track?.elements ?? []).map((caption) => {
          const live = transport.time >= caption.startTime && transport.time < caption.startTime + caption.duration, on = selected.includes(caption.id);
          return (
            <View key={caption.id} testID="caption-row" style={{ flexDirection: "row", alignItems: "center", gap: space[2], padding: space[1], borderRadius: radius.sm, backgroundColor: on ? theme.color("bg/subtle") : live ? theme.color("bg/hover") : "transparent" }}>
              <Tap role="button" label={t("Go to caption at {time}", { time: formatTimecode(caption.startTime, "HH:MM:SS:FF", fps) ?? "" })} testID="caption-seek" onPress={() => { runtime.seek(caption.startTime); controller.select(timeline.selectElements([caption.id])); }}>
                <Text variant="mono" color="text/secondary" style={{ fontSize: 10, lineHeight: 13 }}>{formatTimecode(caption.startTime, "HH:MM:SS:FF", fps)}</Text>
                <Text variant="mono" color="text/secondary" style={{ fontSize: 10, lineHeight: 13 }}>{formatTimecode(caption.startTime + caption.duration, "HH:MM:SS:FF", fps)}</Text>
              </Tap>
              <View style={{ flex: 1, gap: 2 }}>
                <Input accessibilityLabel={t("Caption text")} size="sm" testID="caption-text" editable={!props.readOnly} value={drafts[caption.id] ?? caption.text} onChangeText={(text) => setDrafts({ ...drafts, [caption.id]: text })} onBlur={() => commitText(caption)} onSubmitEditing={() => commitText(caption)} />
                {translated ? <Input accessibilityLabel={t("Translation")} size="sm" testID="caption-translation" editable={!props.readOnly} maxLength={500} value={drafts[`${caption.id}:translation`] ?? caption.translation ?? ""} onChangeText={(text) => setDrafts({ ...drafts, [`${caption.id}:translation`]: text })} onBlur={() => commitTranslation(caption)} onSubmitEditing={() => commitTranslation(caption)} /> : null}
              </View>
              {caption.style !== undefined ? <View testID="caption-override" accessibilityLabel={t("This caption has its own style")} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: theme.color("accent/text") }} /> : null}
            </View>
          );
        })}
        <View style={{ flexDirection: "row" }}><Button size="xs" kind="ghost" icon="plus" label={t("Add caption")} disabled={props.readOnly} testID="captions-add" onPress={() => { const result = controller.run(addCaptionAt({ sceneId, time: controller.session.playhead, trackId: track?.id })); if (result.ok && result.info) setPicked(result.info.trackId); }} /></View>
      </ScrollView>
      {translating && track ? <TranslateDialog document={props.document} track={track as never} onClose={() => setTranslating(false)} onTrack={setPicked} /> : null}
      {pending ? (
        <Modal title={t("Import captions")} width={480} onClose={() => setPending(null)}
          footer={<><View style={{ flex: 1 }} /><Button size="sm" label={t("Cancel")} onPress={() => setPending(null)} /><Button size="sm" kind="primary" label={t("Import")} testID="captions-import-confirm" disabled={offsetTicks === null || pending.parsed.cues.length === 0} onPress={confirmImport} /></>}>
          <View testID="captions-import-dialog" style={{ gap: space[2] }}>
            <Text testID="captions-import-count">{t(pending.parsed.cues.length === 1 ? "1 caption in {name}" : "{n} captions in {name}", { n: pending.parsed.cues.length, name: pending.name })}</Text>
            {pending.uncertain ? (
              <>
                <Field label={t("Encoding")}><Select label={t("Encoding")} size="sm" value={pending.encoding} options={ENCODINGS.map((id) => ({ value: id, label: ENCODING_NAMES[id] }))} onChange={reDecode} /></Field>
                <View testID="captions-import-preview" style={{ padding: space[2], borderRadius: radius.sm, backgroundColor: theme.color("bg/subtle"), gap: 2 }}>{pending.parsed.cues.slice(0, 5).map((cue, index) => <Text key={index} variant="meta" numberOfLines={1}>{cue.text}</Text>)}</View>
              </>
            ) : null}
            <Field label={t("Language")}><Input accessibilityLabel={t("Caption language")} size="sm" testID="captions-import-language" maxLength={35} value={options.language} onChangeText={(language) => setOptions({ ...options, language })} /></Field>
            <Field label={t("Time offset")}><Input accessibilityLabel={t("Time offset")} size="sm" testID="captions-import-offset" value={options.offset} invalid={offsetTicks === null} onChangeText={(offset) => setOptions({ ...options, offset })} /></Field>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}><View testID="captions-import-playhead"><Switch accessibilityLabel={t("Start at playhead")} value={options.atPlayhead} onChange={(atPlayhead) => setOptions({ ...options, atPlayhead })} /></View><Text variant="meta">{t("Start at playhead")}</Text></View>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}
function Field(props: { label: string; children: ReactNode }) {
  return <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}><Text variant="meta" color="text/secondary" numberOfLines={1} style={{ width: 64 }}>{props.label}</Text><View style={{ flex: 1 }}>{props.children}</View></View>;
}
