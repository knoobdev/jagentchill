import { useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { captionTracksOf, editCaption, timeline } from "@jagentchill/editor-core";
import type { ProjectDocument } from "@jagentchill/protocol";
import { Button, IconButton, Input, SearchField, Select, Tap, Text, radius, space, useTheme } from "@jagentchill/ui";
import { useT } from "../../locale";
import { useEditor, useEditorVersion, useTransport } from "../context";
import { RemoveSilences } from "../captions/SpeechTools";

type Word = { text: string; start: number; end: number };
type Caption = { id: string; startTime: number; duration: number; text: string; speaker?: string; words?: Word[] };
type Placed = { caption: Caption; index: number; text: string; start: number; end: number };
const PARAGRAPH_GAP = 2 * 120_000;

/**
 * The Transcript tab: the words of the active caption track as flowing paragraphs (a new one after a gap of 2 s or at
 * a speaker change). A click on a word seeks to it, the word under the playhead is highlighted, the search field
 * marks its matches and steps through them, and a double-click edits a word in its caption.
 */
export function TranscriptTab(props: { document: ProjectDocument; readOnly: boolean; onOpenCaptions(): void }) {
  const t = useT();
  const theme = useTheme();
  const runtime = useEditor();
  useEditorVersion();
  const transport = useTransport();
  const { controller } = runtime, sceneId = controller.session.sceneId;
  const tracks = captionTracksOf(props.document, sceneId) as unknown as { id: string; name: string; elements: Caption[] }[];
  const [picked, setPicked] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [match, setMatch] = useState(0);
  const [editing, setEditing] = useState<{ captionId: string; index: number; text: string } | null>(null);
  const track = tracks.find((entry) => entry.id === picked) ?? tracks[0];
  const paragraphs = useMemo(() => {
    const out: Placed[][] = [];
    let last: Placed | null = null, speaker: string | undefined;
    for (const caption of [...(track?.elements ?? [])].sort((a, b) => a.startTime - b.startTime)) for (const [index, word] of (caption.words ?? []).entries()) {
      const placed: Placed = { caption, index, text: word.text, start: caption.startTime + word.start, end: caption.startTime + word.end };
      if (!last || placed.start - last.end >= PARAGRAPH_GAP || caption.speaker !== speaker) out.push([]);
      out[out.length - 1].push(placed);
      last = placed; speaker = caption.speaker;
    }
    return out;
  }, [track]);
  const words = paragraphs.flat(), needle = query.trim().toLowerCase();
  const matches = needle === "" ? [] : words.filter((word) => word.text.toLowerCase().includes(needle));
  const step = (by: number) => { if (matches.length === 0) return; const next = (((match + by) % matches.length) + matches.length) % matches.length; setMatch(next); runtime.seek(matches[next].start); };
  const commit = () => {
    const edit = editing;
    setEditing(null);
    if (!edit) return;
    const caption = track?.elements.find((entry) => entry.id === edit.captionId), text = edit.text.trim().slice(0, 80);
    if (!caption?.words || text.length === 0 || caption.words[edit.index]?.text === text) return;
    // The caption that holds the word takes the new spelling at the same time span.
    const next = caption.words.map((word, index) => (index === edit.index ? { ...word, text } : word));
    controller.external((doc, ctx) => editCaption(doc, ctx, caption.id, { words: next, text: next.map((word) => word.text).join(" ") }));
  };
  if (!track) return (
    <View testID="transcript-tab" style={{ flex: 1, minHeight: 0 }}>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space[2], padding: space[4] }}>
        <Text color="text/secondary" testID="transcript-empty">{t("No transcript yet")}</Text>
        <Button size="sm" kind="outline" label={t("Generate captions")} testID="transcript-open-captions" onPress={props.onOpenCaptions} />
      </View>
      <ScrollView style={{ flexGrow: 0, maxHeight: "70%" }}><RemoveSilences document={props.document} readOnly={props.readOnly} /></ScrollView>
    </View>
  );
  return (
    <View testID="transcript-tab" style={{ flex: 1, minHeight: 0 }}>
      <View style={{ padding: space[2], paddingHorizontal: space[3], gap: space[2] }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[1] }}>
          <View style={{ flex: 1 }}><SearchField label={t("Search transcript")} placeholder={t("Search transcript...")} size="sm" value={query} onChangeText={(text) => { setQuery(text); setMatch(0); }} /></View>
          <IconButton icon="chev-u" size="xs" label={t("Previous match")} disabled={matches.length === 0} testID="transcript-previous" onPress={() => step(-1)} />
          <IconButton icon="chev-d" size="xs" label={t("Next match")} disabled={matches.length === 0} testID="transcript-next" onPress={() => step(1)} />
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
          <Text variant="meta" color="text/secondary" style={{ flex: 1 }} testID="transcript-count">{needle === "" ? t(words.length === 1 ? "1 word" : "{n} words", { n: words.length }) : t("{n} of {total}", { n: matches.length === 0 ? 0 : match + 1, total: matches.length })}</Text>
          {tracks.length > 1 ? <View style={{ width: 112 }}><Select label={t("Caption track")} size="xs" value={track.id} options={tracks.map((entry) => ({ value: entry.id, label: entry.name }))} onChange={setPicked} /></View> : null}
        </View>
      </View>
      {words.length === 0 ? <View style={{ padding: space[3] }}><Text variant="meta" color="text/secondary" testID="transcript-needs-words">{t("Transcript needs word timings — generate captions to use it")}</Text></View> : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: space[3], paddingBottom: space[3], gap: space[3] }}>
          {paragraphs.map((paragraph, at) => (
            <View key={at} testID="transcript-paragraph" style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 4, rowGap: 2 }}>
              {paragraph[0].caption.speaker ? <Text variant="meta" color="text/secondary">{paragraph[0].caption.speaker}:</Text> : null}
              {paragraph.map((word) => {
                const live = transport.time >= word.start && transport.time < word.end, found = needle !== "" && word.text.toLowerCase().includes(needle), current = found && matches[match] === word;
                const key = `${word.caption.id}:${word.index}`;
                if (editing && editing.captionId === word.caption.id && editing.index === word.index) return <View key={key} style={{ width: Math.max(64, editing.text.length * 9 + 24) }}><Input accessibilityLabel={t("Word")} size="sm" autoFocus maxLength={80} testID="transcript-word-edit" value={editing.text} onChangeText={(text) => setEditing({ ...editing, text })} onBlur={commit} onSubmitEditing={commit} /></View>;
                return (
                  <Tap key={key} role="button" label={word.text} testID="transcript-word" onPress={() => runtime.seek(word.start)}
                    style={{ paddingHorizontal: 2, borderRadius: radius.sm, backgroundColor: live ? theme.color("accent/subtle") : current ? theme.color("bg/subtle") : "transparent", borderBottomWidth: found ? 2 : 0, borderBottomColor: theme.color("accent/text") }}>
                    <View {...({ onDoubleClick: () => { if (!props.readOnly) setEditing({ captionId: word.caption.id, index: word.index, text: word.text }); } } as object)}><Text style={live ? { fontWeight: "600" } : undefined}>{word.text}</Text></View>
                  </Tap>
                );
              })}
            </View>
          ))}
        </ScrollView>
      )}
      {/* The tool scrolls on its own: its review list can be longer than the panel. */}
      <ScrollView style={words.length === 0 ? { flex: 1 } : { flexGrow: 0, maxHeight: "55%" }}><RemoveSilences document={props.document} readOnly={props.readOnly} /></ScrollView>
    </View>
  );
}
