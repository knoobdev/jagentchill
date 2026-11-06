import { useEffect, useMemo, useRef, useState } from "react";
import { Image, ScrollView, View } from "react-native";
import { formatLogTime } from "@jagentchill/app-core";
import { fetchVerified } from "@jagentchill/client";
import { promptVideo as pv } from "@jagentchill/editor-core";
import type { WorkflowLogEntry } from "@jagentchill/protocol";
import { Button, Callout, Icon, IconButton, Input, Spinner, Tap, Text, radius, space, useTheme, useToast } from "@jagentchill/ui";
import { useHost } from "../host";
import { loadSigner } from "../identity";
import { useT } from "../locale";
import type { RunData } from "../workflows/data";
import { clock } from "../workflows/strings";
import { useBlobUri, type Spend, type Stage } from "./data";
import { CAN_PLAY_SOUND, soundOf, type Sound } from "./platform";
import { STAGE_LABELS, VERDICT_LABELS, seconds, usd } from "./strings";

/** What the picture check said about a shot, in a few words under its tile. */
export type VerdictKind = "ok" | "warn" | "bad" | "plain";
export function pictureVerdict(entry: pv.ShotMedia | undefined): { text: string; kind: VerdictKind } | null {
  if (!entry) return null;
  const say = (text: keyof typeof VERDICT_LABELS, kind: VerdictKind) => ({ text: VERDICT_LABELS[text], kind });
  if (entry.leftOut) return say("deleted", "plain");
  if (entry.refused && !entry.media) return entry.refused.reason === "picture" ? say("wrong", "bad") : say("refused", "bad");
  if (!entry.media) return null;
  if (entry.replaced) return say("own", "plain");
  if (!entry.check) return say("unchecked", "warn");
  return entry.check.ok ? say("checked", "ok") : say("wrong", "bad");
}
const TONE = { ok: "success", warn: "warning/text", bad: "danger/text", plain: "text/secondary" } as const;
export function Verdict(props: { verdict: { text: string; kind: VerdictKind }; testID?: string }) {
  const t = useT();
  return (
    <View testID={props.testID} {...({ dataSet: { verdict: props.verdict.kind } } as object)} style={{ flexDirection: "row", alignItems: "center", gap: space[1] }}>
      <Icon name={props.verdict.kind === "ok" ? "check-c" : props.verdict.kind === "plain" ? "image" : "warn"} size={12} color={TONE[props.verdict.kind]} />
      <Text variant="meta" color={TONE[props.verdict.kind]} numberOfLines={1}>{t(props.verdict.text)}</Text>
    </View>
  );
}

/** The run asks a person about its pictures: shots that could not be had (the provider refused them, or the picture is not the shot). */
export function PicturesAsk(props: { stage: Stage; run: RunData; mayRun: boolean; onShots(): void }) {
  const t = useT(), toast = useToast();
  const [busy, setBusy] = useState(false);
  const ask = props.stage.check, request = ask?.request as { title?: string; instructions?: string } | undefined;
  if (!ask || ask.status !== "waiting_approval" || !request) return null;
  const approve = async () => { setBusy(true); const result = await props.run.act("jagentchill.workflow.node.resolve", { nodeId: ask.nodeId, path: "", outcome: "approved" }); setBusy(false); if (!result.ok) toast.show({ kind: "error", message: result.message }); };
  return (
    <View testID="pv-pictures-ask" {...({ dataSet: { kind: "refused" } } as object)} style={{ gap: space[2] }}>
      <Callout tone="warning" title={request.title ?? t("The pictures need you")}>{request.instructions ?? ""}</Callout>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
        {props.mayRun ? <Button kind="strong" size="sm" icon="check-c" label={t("Approve")} testID="pv-pictures-approve" loading={busy} onPress={() => void approve()} /> : null}
        <Button size="sm" label={t("Show the shots")} testID="pv-ask-shots" onPress={props.onShots} />
      </View>
    </View>
  );
}

/** The takes of the voice with what the listener said about each. */
export function TakeRows(props: { takes: pv.Take[]; script?: pv.Script }) {
  const t = useT();
  return (
    <View style={{ gap: space[1.5] }} testID="pv-takes">
      {props.takes.map((take, index) => {
        const check = take.check, words = props.script?.segments.find((segment) => segment.id === take.segmentId)?.text;
        const heard: { text: string; kind: VerdictKind } = check ? (check.ok ? { text: t("Matches its words ({percent} %)", { percent: Math.round(check.score * 100) }), kind: "ok" } : { text: t("Heard: “{heard}”", { heard: check.heard.slice(0, 80) }), kind: "bad" }) : { text: t("Not listened to"), kind: "warn" };
        return (
          <View key={take.segmentId} testID={`pv-take-${index}`} {...({ dataSet: { check: check ? (check.ok ? "ok" : "failed") : "unchecked" } } as object)} style={{ gap: space[0.5] }}>
            <Text>{`${index + 1} · ${seconds(take.media.duration_ticks ?? 0)}${words ? ` · ${words.slice(0, 70)}` : ""}`}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space[1] }}>
              <Icon name={heard.kind === "ok" ? "check-c" : "warn"} size={12} color={TONE[heard.kind]} />
              <Text variant="meta" color={TONE[heard.kind]}>{heard.text}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** A budget of the run a person sets or raises where the run stopped on it. */
export function BudgetField(props: { spend: Spend | null; onSet(budgetUsd: number): Promise<{ ok: true } | { ok: false; message: string }> }) {
  const t = useT(), toast = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const amount = Number(text), valid = text.trim() !== "" && Number.isFinite(amount) && amount >= 0.01 && amount <= 100_000 && amount > (props.spend?.spentUsd ?? 0);
  const save = async () => { setBusy(true); const result = await props.onSet(Math.round(amount * 100) / 100); setBusy(false); if (!result.ok) toast.show({ kind: "error", message: result.message }); else { setText(""); toast.show({ kind: "success", message: t("Budget set to {amount}", { amount: usd(Math.round(amount * 100) / 100) }) }); } };
  return (
    <View testID="pv-budget-raise" style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[2] }}>
      <View style={{ width: 140 }}><Input size="sm" testID="pv-budget-input" accessibilityLabel={t("Budget for this run")} value={text} prefix="$" inputMode="decimal" placeholder={props.spend?.budgetUsd ? String(props.spend.budgetUsd) : "5.00"} onChangeText={(next) => setText(next.replace(/[^0-9.]/g, "").slice(0, 9))} /></View>
      <Button size="sm" label={props.spend?.budgetUsd ? t("Raise the budget") : t("Set a budget")} testID="pv-budget-set" loading={busy} disabled={!valid} onPress={() => void save()} />
      {props.spend ? <Text variant="meta" color="text/secondary">{t("Spent {amount}", { amount: usd(props.spend.spentUsd) })}</Text> : null}
    </View>
  );
}

const uris = new Map<string, Promise<string>>();
/** A recording of the host's blob store as something a player can play: fetched once, checked against its hash. */
function soundUri(host: NonNullable<ReturnType<typeof useHost>["host"]>, blobId: string, mime: string): Promise<string> {
  let pending = uris.get(blobId);
  if (!pending) {
    pending = loadSigner().then((signer) => fetchVerified({ host, signer }, blobId)).then((bytes) => URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: mime })));
    uris.set(blobId, pending);
    pending.catch(() => uris.delete(blobId));
  }
  return pending;
}

/**
 * The preview of a run before its project is opened: each shot's picture for as long as the shot lasts, the voice in
 * time with it, and the captions over it. It plays the run's own files; motion, music and titles are the editor's.
 */
export function Preview(props: { stages: Stage[]; params: pv.VideoParams }) {
  const t = useT(), theme = useTheme(), { host } = useHost();
  const stage = (id: string) => props.stages.find((entry) => entry.id === id);
  const timed = stage("timing"), list = (timed?.value as pv.ShotList | undefined)?.shots ?? [], media = (stage("assets")?.value as pv.ShotMedia[] | undefined) ?? [];
  const track = timed?.exec?.outputs?.voiceTrack as pv.VoiceTrack | undefined, captions = stage("captions")?.value as pv.CaptionSet | undefined;
  const total = pv.totalTicks({ shots: list }) / pv.TICKS;
  const [at, setAt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const sounds = useRef(new Map<string, Sound>()), sounding = useRef<string | null>(null), clockRef = useRef({ at: 0, wall: 0 });
  const takes = useMemo(() => (track?.takes ?? []).map((take) => ({ id: take.segmentId, blobId: take.media.blobId, mime: /\.mp3$/i.test(take.media.name) ? "audio/mpeg" : "audio/wav", from: take.start_ticks / pv.TICKS, to: (take.start_ticks + take.duration_ticks) / pv.TICKS })), [track]);
  // The recordings are fetched when the preview opens, so the first second of the first line is not missing.
  useEffect(() => {
    if (!host || !CAN_PLAY_SOUND) return;
    let alive = true;
    for (const take of takes) if (!sounds.current.has(take.id)) void soundUri(host, take.blobId, take.mime).then((uri) => { const sound = alive ? soundOf(uri) : null; if (sound) sounds.current.set(take.id, sound); }, () => undefined);
    return () => { alive = false; };
  }, [host, takes]);
  const quiet = () => { if (sounding.current) sounds.current.get(sounding.current)?.stop(); sounding.current = null; };
  const voice = (time: number) => {
    const take = takes.find((entry) => time >= entry.from && time < entry.to);
    if ((take?.id ?? null) === sounding.current) return;
    quiet();
    if (take) { sounds.current.get(take.id)?.play(time - take.from); sounding.current = take.id; }
  };
  useEffect(() => {
    if (!playing) { quiet(); return; }
    clockRef.current = { at, wall: Date.now() };
    voice(at);
    const timer = setInterval(() => {
      const now = clockRef.current.at + (Date.now() - clockRef.current.wall) / 1000;
      if (now >= total) { setAt(total); setPlaying(false); return; }
      setAt(now); voice(now);
    }, 100);
    return () => { clearInterval(timer); quiet(); };
  }, [playing]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => quiet(), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [w, h] = props.params.aspectRatio.split(":").map(Number);
  let start = 0, current = list[0], currentStart = 0;
  const spans = list.map((shot) => { const span = { shot, from: start, to: start + shot.duration_ticks / pv.TICKS }; start = span.to; return span; });
  for (const span of spans) if (at >= span.from) { current = span.shot; currentStart = span.from; }
  const blobId = media.find((entry) => entry.shotId === current?.id)?.media?.blobId, uri = useBlobUri(blobId);
  const cue = captions?.cues.find((entry) => at * pv.TICKS >= entry.start_ticks && at * pv.TICKS < entry.start_ticks + entry.duration_ticks);
  if (!list.length || !media.some((entry) => entry.media) || timed?.status !== "succeeded") return <View style={{ padding: space[4] }}><Text color="text/secondary" testID="pv-preview-empty">{t("The preview appears here once the pictures and the voice are made.")}</Text></View>;
  const seek = (time: number) => { const next = Math.max(0, Math.min(total, time)); clockRef.current = { at: next, wall: Date.now() }; setAt(next); if (playing) { quiet(); voice(next); } };
  const toggle = () => { if (!playing && at >= total - 0.05) setAt(0); setPlaying(!playing); };
  return (
    <ScrollView testID="pv-preview" {...({ dataSet: { playing: playing ? "1" : "0", shot: String((current?.index ?? 0) + 1), second: at.toFixed(1), voice: sounding.current ?? "" } } as object)} style={{ flex: 1 }} contentContainerStyle={{ padding: space[4], gap: space[3], alignItems: "center" }}>
      <View testID="pv-preview-frame" style={{ width: "100%", maxWidth: w >= h ? 640 : 300, aspectRatio: w / h, borderRadius: radius.md, overflow: "hidden", backgroundColor: theme.color("bg/subtle"), alignItems: "center", justifyContent: "center" }}>
        {uri ? <Image source={{ uri }} resizeMode="cover" style={{ width: "100%", height: "100%" }} /> : <Spinner size={16} />}
        {cue ? (
          <View style={{ position: "absolute", left: space[3], right: space[3], bottom: space[4], alignItems: "center", gap: space[0.5] }}>
            <View style={{ backgroundColor: theme.color("bg/scrim"), borderRadius: radius.sm, paddingHorizontal: space[2], paddingVertical: space[1] }}>
              <Text testID="pv-preview-caption" color="text/on-accent" style={{ textAlign: "center" }}>{cue.text}</Text>
              {cue.translation ? <Text testID="pv-preview-caption-2" variant="meta" color="text/on-accent" style={{ textAlign: "center" }}>{cue.translation}</Text> : null}
            </View>
          </View>
        ) : null}
      </View>
      <View style={{ width: "100%", maxWidth: 640, gap: space[2] }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
          <IconButton icon={playing ? "pause" : "play"} size="sm" label={playing ? t("Pause") : t("Play")} testID="pv-preview-play" onPress={toggle} />
          <Text variant="meta" tabular color="text/secondary" testID="pv-preview-time">{`${clock(at * 1000)} / ${clock(total * 1000)}`}</Text>
          <Text variant="meta" color="text/secondary" style={{ flex: 1, textAlign: "right" }} numberOfLines={1}>{t("Shot {n}", { n: (current?.index ?? 0) + 1 })}</Text>
        </View>
        {/* One segment per shot, as wide as the shot is long: press one to go to it. */}
        <View testID="pv-preview-bar" style={{ flexDirection: "row", gap: 2, height: 16 }}>
          {spans.map((span) => (
            <Tap key={span.shot.id} role="button" label={t("Shot {n}", { n: span.shot.index + 1 })} testID={`pv-preview-seek-${span.shot.index}`} onPress={() => seek(span.from)}
              style={{ flex: Math.max(0.2, span.to - span.from), borderRadius: radius.sm, overflow: "hidden", backgroundColor: theme.color("bg/subtle") }}>
              <View style={{ width: `${Math.max(0, Math.min(1, (at - span.from) / Math.max(0.01, span.to - span.from))) * 100}%`, height: "100%", backgroundColor: theme.color(span.shot.id === current?.id ? "accent" : "border/strong") }} />
            </Tap>
          ))}
        </View>
        <Text variant="meta" color="text/tertiary" testID="pv-preview-note">{CAN_PLAY_SOUND ? t("Pictures, voice and captions. Motion, music and titles are in the editor.") : t("Pictures and captions. Sound, motion, music and titles are in the editor.")}</Text>
        {currentStart >= 0 && current ? <Text variant="meta" color="text/secondary" numberOfLines={2}>{current.description}</Text> : null}
      </View>
    </ScrollView>
  );
}

/** Everything the run wrote down, step by step, newest last. */
export function RunLog(props: { run: RunData }) {
  const t = useT();
  const [entries, setEntries] = useState<WorkflowLogEntry[] | null>(null);
  useEffect(() => { let alive = true; void props.run.logs().then((found) => { if (alive) setEntries(found.slice(-300)); }, () => { if (alive) setEntries([]); }); return () => { alive = false; }; }, [props.run.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const names: Record<string, string> = { ...STAGE_LABELS, pictures: "Pictures", check_brief: "Brief", script_approve: "Script", check_shot_list: "Shot list", check_final: "Review" };
  const nameOf = (nodeId: string): string => t(names[nodeId] ?? (/^(assets_again|fix_pictures|pictures_gate)/.test(nodeId) ? "Pictures" : nodeId));
  if (!entries) return <View style={{ padding: space[4] }}><Spinner size={14} /></View>;
  if (!entries.length) return <View style={{ padding: space[4] }}><Text color="text/secondary" testID="pv-log-empty">{t("Nothing was logged yet.")}</Text></View>;
  return (
    <ScrollView testID="pv-log" {...({ dataSet: { count: String(entries.length) } } as object)} style={{ flex: 1 }} contentContainerStyle={{ padding: space[4], gap: space[1] }}>
      {entries.map((entry) => (
        <View key={entry.seq} testID="pv-log-row" {...({ dataSet: { level: entry.level, node: entry.nodeId } } as object)} style={{ flexDirection: "row", gap: space[2] }}>
          <Text variant="mono" color="text/tertiary" style={{ width: 64 }}>{formatLogTime(entry.ts_ms)}</Text>
          <Text variant="meta" color="text/secondary" style={{ width: 76 }} numberOfLines={1}>{nameOf(entry.nodeId)}</Text>
          <Text variant="mono" selectable style={{ flex: 1 }} color={entry.level === "error" ? "danger/text" : entry.level === "warn" ? "warning/text" : "text/primary"}>{entry.message.slice(0, 400)}</Text>
        </View>
      ))}
    </ScrollView>
  );
}
