import { useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { View } from "react-native";
import { HostError } from "@jagentchill/client";
import { captionsFromSpeech, captionTracksOf, importCaptions, sourceRangeOf, SpeechCancelled, speechPieces, timeline, type Cue } from "@jagentchill/editor-core";
import type { ProjectDocument } from "@jagentchill/protocol";
import { Button, Callout, Modal, ProgressBar, Text, space, useToast } from "@jagentchill/ui";
import { hostSettingsRoute } from "../../agents/ModelBrowser";
import { useHost } from "../../host";
import { useModelNames } from "../../generation/data";
import { useT } from "../../locale";
import { useEditor } from "../context";
import { canDecodeSpeech, decodeSpeech, SPEECH_RATE } from "./dom";
import { EstimateLine, usePaid } from "./Paid";
import { wholeSeconds } from "./answers";
import { askEstimate, base64, speechClips, useCaptionsStatus, useEstimate, type Grants, type SpeechSource } from "./run";

type Phase = { step: "idle" } | { step: "running"; done: number; total: number } | { step: "failed"; message: string; settings?: boolean };

/** The sentence a failed host call is shown as. */
export function failureText(t: ReturnType<typeof useT>, error: unknown): { message: string; settings?: boolean } {
  if (!(error instanceof HostError)) return { message: t("Something went wrong. Try again.") };
  if (error.code === "NO_ROUTE") return error.details?.role === "translation" ? { message: t("No translation model is connected"), settings: true } : { message: t("No provider is connected for this"), settings: true };
  if (error.code === "BUDGET_EXCEEDED") return { message: t("A budget has been reached") };
  if (error.code === "SCOPE_DENIED") return { message: t("This device cannot start jobs") };
  if (error.code === "CONNECTION_CLOSED") return { message: t("The connection to the host was lost") };
  return { message: error.details?.reason === "bad_answer" ? t("The model did not answer with one translation per caption") : t("The provider failed. Try again.") };
}

/**
 * "Generate" of the Auto captions section: the speech of the chosen clips, heard by the host's transcription model
 * (the Transcription role of Model routing decides which), becomes a caption track as one undo step. While nothing can
 * listen the control says why and leads to the provider settings; it is never a dead button.
 */
export function AutoCaptions(props: { document: ProjectDocument; readOnly: boolean; source: SpeechSource; language: string; hasAudio: boolean; onTrack(trackId: string): void }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const { connection, host, status: link, can } = useHost();
  const runtime = useEditor();
  const { status, reload } = useCaptionsStatus();
  // The model is named as the catalogue calls it, not by its id.
  const nameOf = useModelNames();
  const [phase, setPhase] = useState<Phase>({ step: "idle" });
  const [found, setFound] = useState<{ cues: Cue[]; replaceId: string } | null>(null);
  /** The run in flight: Cancel, or a newer run, makes every later answer of an older one void. */
  const current = useRef(0);
  const { controller } = runtime, sceneId = controller.session.sceneId;
  const openSettings = () => { if (host) router.push(hostSettingsRoute(host.gatewayId, "runtimes", "generation") as never); };
  const clips = speechClips(props.document, sceneId, props.source, controller.session.selection.selectedElements);
  // What would be listened to: the stretch of its file every clip plays.
  const lengthOf = (list: typeof clips) => wholeSeconds(list.reduce((sum, clip) => { const range = sourceRangeOf(clip.element); return sum + (range.end - range.start) / 120_000; }, 0));
  const seconds = lengthOf(clips);
  // The recording the last estimate was asked for — its length and how many pieces it is sent in: every piece names
  // that whole, so the host sees ONE action, quoted for exactly the requests that follow.
  const quoted = useRef<{ seconds: number; pieces: number } | null>(null);
  // The sounds read for that estimate: the run that follows uses them and does not read the files again.
  const sounds = useRef(new Map<string, Int16Array | null>());
  const read = async (assetId: string): Promise<Int16Array | null> => {
    if (!sounds.current.has(assetId)) { const url = await runtime.media.mediaUrl(assetId).catch(() => null); sounds.current.set(assetId, url ? await decodeSpeech(url).catch(() => null) : null); }
    return sounds.current.get(assetId) ?? null;
  };
  const usable = props.hasAudio && link === "connected" && status?.transcription.available === true;
  const estimate = useEstimate(usable && seconds > 0 ? { kind: "transcription", seconds } : null);

  /** The cues become a caption track; `replaceId` removes that track in the same step. */
  const insert = (cues: Cue[], replaceId?: string) => {
    const count = captionTracksOf(controller.stored, sceneId).length - (replaceId ? 1 : 0);
    const made = importCaptions({ sceneId, parsed: { format: "srt", cues, skipped: 0, trimmed: 0, warnings: [] }, language: props.language === "auto" ? "und" : props.language, name: count === 0 ? "Captions" : `Captions ${count + 1}`, origin: "speech" });
    const command: timeline.TimelineCommand<{ trackId: string; elementIds: string[] }> = !replaceId ? made : { ...made, run(draft, env) {
      const scene = timeline.sceneById(draft, sceneId), at = scene.tracks.overlay.findIndex((track) => track.id === replaceId);
      if (at >= 0) scene.tracks.overlay.splice(at, 1);
      return made.run(draft, env);
    } };
    const result = controller.run(command);
    if (!result.ok || !result.info) return;
    props.onTrack(result.info.trackId);
    runtime.seek(Math.round(cues[0].start_ms * 120));
    toast.show({ kind: "success", message: (cues.length === 1 ? t("1 caption generated", { n: cues.length }) : t("{n} captions generated", { n: cues.length })) });
  };
  const run = useCallback(async (grants: Grants) => {
    if (!connection) return;
    const mine = ++current.current, live = () => current.current === mine;
    const chosen = speechClips(controller.stored, sceneId, props.source, controller.session.selection.selectedElements);
    setPhase({ step: "running", done: 0, total: 0 });
    try {
      const result = await captionsFromSpeech({
        clips: chosen, rate: SPEECH_RATE, cancelled: () => !live(),
        decode: read,
        hear: (wav) => connection.call<{ text: string; model: string; costUsd: number }>("jagentchill.captions.transcribe", { audio: base64(wav), projectId: props.document.metadata.id, ...(props.language !== "auto" ? { language: props.language } : {}), ...(quoted.current ? { wholeSeconds: quoted.current.seconds, wholePieces: quoted.current.pieces } : {}), ...grants }),
        onProgress: (done, total) => { if (live()) setPhase({ step: "running", done, total }); },
      });
      // Cancelled (or started again) while the last answers came in: nothing of this run is used.
      if (!live()) return;
      setPhase({ step: "idle" });
      if (result.undecoded === chosen.length) return setPhase({ step: "failed", message: t("The sound of these clips could not be read on this device") });
      if (result.cues.length === 0) { toast.show({ kind: "info", message: t("No speech was detected") }); return; }
      const existing = captionTracksOf(controller.stored, sceneId)[0];
      if (existing) setFound({ cues: result.cues, replaceId: existing.id }); else insert(result.cues);
    } catch (error) {
      if (error instanceof SpeechCancelled || !live()) return;
      setPhase({ step: "idle" });
      throw error;
    }
  }, [connection, controller, sceneId, props.source, props.language, props.document.metadata.id, runtime]); // eslint-disable-line react-hooks/exhaustive-deps
  const paid = usePaid({
    kind: "captions", run, onError: (error) => { setPhase({ step: "failed", ...failureText(t, error) }); reload(); },
    // Asked at Generate, for the clips as they are now: the estimate's ids are what the answer sends back.
    // The host is paid per request: the estimate is of the pieces that will really be sent — the sound is read first,
    // cut at its pauses as the run cuts it, and the same piece of two clips counted once.
    quote: async () => {
      if (!connection) return null;
      const mine = ++current.current, live = () => current.current === mine;
      setPhase({ step: "running", done: 0, total: 0 });
      sounds.current = new Map();
      const keys = new Set<string>();
      let spoken = 0;
      for (const clip of speechClips(controller.stored, sceneId, props.source, controller.session.selection.selectedElements)) {
        const sound = await read(clip.assetId);
        if (!live()) return "stop";
        if (!sound) continue;
        const range = sourceRangeOf(clip.element), first = Math.max(0, Math.min(sound.length, Math.round((range.start / 120_000) * SPEECH_RATE))), last = Math.max(first, Math.min(sound.length, Math.round((range.end / 120_000) * SPEECH_RATE)));
        for (const piece of speechPieces(sound.subarray(first, last), SPEECH_RATE)) { const key = `${clip.assetId}:${first + piece.from}:${first + piece.to}`; if (!keys.has(key)) { keys.add(key); spoken += (piece.to - piece.from) / SPEECH_RATE; } }
      }
      setPhase({ step: "idle" });
      // Nothing to send (no sound could be read, or no speech in it): the run says which.
      if (!keys.size) { quoted.current = null; return null; }
      quoted.current = { seconds: wholeSeconds(spoken), pieces: keys.size };
      return askEstimate(connection, { kind: "transcription", seconds: quoted.current.seconds, pieces: quoted.current.pieces });
    },
  });
  /** Cancel: the run is void from this moment and Generate is there again; answers still on their way are dropped. */
  const cancel = () => { current.current++; setPhase({ step: "idle" }); };

  // A device that cannot decode sound has nothing to send: the tool is not there.
  if (!canDecodeSpeech) return null;
  const running = phase.step === "running";
  // Why Generate cannot run right now, most basic reason first.
  const blocked = !props.hasAudio ? t("There is no audio to transcribe")
    : link !== "connected" || !connection ? t("Connect to a host to use this tool")
    : !can("jagentchill.generation.run") ? t("This device cannot start jobs")
    : status && !status.transcription.available ? t("No transcription provider is connected")
    : null;
  const needsProvider = link === "connected" && !!status && !status.transcription.available && props.hasAudio;
  return (
    <View testID="auto-captions-run" style={{ gap: space[1.5] }}>
      {status?.transcription.available ? <Text variant="meta" color="text/secondary" testID="captions-runs-on">{t("Runs on: Host · {model}", { model: `${status.transcription.label} · ${nameOf(status.transcription.model ?? "")}` })}</Text> : null}
      {!blocked && !running ? <EstimateLine estimate={estimate} testID="captions-estimate" /> : null}
      {running ? (
        <View testID="captions-progress" style={{ gap: space[1] }}>
          <ProgressBar value={phase.total ? phase.done / phase.total : null} label={t("Transcribing…")} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
            <Text variant="meta" color="text/secondary" style={{ flex: 1 }}>{phase.total ? t("Transcribing… {n} of {m}", { n: phase.done, m: phase.total }) : t("Reading the sound…")}</Text>
            <Button size="xs" kind="ghost" label={t("Cancel")} testID="captions-cancel" onPress={cancel} />
          </View>
        </View>
      ) : (
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
          <Button size="sm" kind="strong" icon="cc" label={t("Generate")} disabled={props.readOnly || blocked !== null} testID="captions-generate" onPress={paid.start} />
          {blocked && !needsProvider ? <Text variant="meta" color="text/secondary" style={{ flex: 1 }} testID="captions-generate-note">{blocked}</Text> : null}
        </View>
      )}
      {needsProvider ? <View testID="captions-no-provider"><Callout tone="info" actions={can("jagentchill.config.read") ? [{ label: t("Open provider settings"), onPress: openSettings }] : undefined}>{t("No transcription provider is connected")}</Callout></View> : null}
      {phase.step === "failed" ? <View testID="captions-error"><Callout tone="danger" actions={phase.settings ? [{ label: t("Open provider settings"), onPress: openSettings }] : [{ label: t("Retry"), onPress: paid.start }]}>{phase.message}</Callout></View> : null}
      {paid.dialogs}
      {found ? (
        <Modal title={t("Captions already exist")} width={480} onClose={() => setFound(null)}
          footer={<><View style={{ flex: 1 }} /><Button size="sm" label={t("Cancel")} onPress={() => setFound(null)} /><Button size="sm" label={t("Add as new track")} testID="captions-add-track" onPress={() => { const { cues } = found; setFound(null); insert(cues); }} /><Button size="sm" kind="primary" label={t("Replace")} testID="captions-replace" onPress={() => { const { cues, replaceId } = found; setFound(null); insert(cues, replaceId); }} /></>}>
          <Text testID="captions-exist-dialog">{(found.cues.length === 1 ? t("1 caption was generated. Replace the existing caption track or add a new one?", { n: found.cues.length }) : t("{n} captions were generated. Replace the existing caption track or add a new one?", { n: found.cues.length }))}</Text>
        </Modal>
      ) : null}
    </View>
  );
}
