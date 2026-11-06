import { useRouter } from "expo-router";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { View } from "react-native";
import { preference } from "@jagentchill/app-core";
import { captionTracksOf, fillCaptionTexts, importCaptions, translateCaptions, translatedCues } from "@jagentchill/editor-core";
import type { ProjectDocument } from "@jagentchill/protocol";
import { Button, Callout, Modal, ProgressBar, Select, Text, space, useToast } from "@jagentchill/ui";
import { useAgentData } from "../../agents/data";
import { hostSettingsRoute } from "../../agents/ModelBrowser";
import { useHost } from "../../host";
import { useModelNames } from "../../generation/data";
import { useT } from "../../locale";
import { getPref, setPref, usePref } from "../../state";
import { useEditor } from "../context";
import { failureText } from "./AutoCaptions";
import { LANGUAGES } from "./languages";
import { isProgress, progressKey, runtimeModelName, translateBatches, translationEstimate, wholeOf, type Progress } from "./answers";
import { EstimateLine, usePaid } from "./Paid";
import { askEstimate, needsConfirming, useCaptionsStatus, useEstimate, type Grants } from "./run";

type Caption = { id: string; startTime: number; duration: number; text: string; translation?: string };
type Track = { id: string; name: string; caption: { language?: string; translationLanguage?: string }; elements: Caption[] };
type Mode = "bilingual" | "track";
const BATCH = 40;
const TRANSLATE = preference<{ target: string; mode: Mode }>("captions.translate", { target: "en", mode: "bilingual" }, (value): value is { target: string; mode: Mode } =>
  value !== null && typeof value === "object" && typeof (value as { target?: unknown }).target === "string" && ["bilingual", "track"].includes(String((value as { mode?: unknown }).mode)));
/**
 * The captions the last run could not translate and where their translations belong: under the captions of the source
 * track (`bilingual`), or in the captions of the track that run made (`track`: source caption id → its caption there).
 */
type Failed = { ids: string[]; language: string; languageName: string } & ({ into: "bilingual"; trackId: string } | { into: "track"; trackId: string; places: Record<string, string> });
const cleaned = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 500);
/**
 * Where a translation of a track stopped (a money question, Cancel, a reload, a lost connection): kept on the device
 * with the project's other editing state, so the batches that were translated — and paid for — are never sent again.
 */
const progressOf = (projectId: string, trackId: string) => preference<Progress | null>(`captions.translate.progress.${projectId}.${trackId}`, null, (value): value is Progress | null => value === null || isProgress(value));

/**
 * "Translate" of the Captions list: the captions of a track in another language, one for one and with their times,
 * written by the Translation role's model as paid work of the host (one confirmation of the estimate, budget).
 * "Bilingual" stores each translation on its caption; "New track" makes a second caption track with EVERY cue of the
 * source in place. A batch the model did not answer one-for-one stays untranslated, and "Retry failed" fills the same
 * place the first run wrote to.
 */
export function TranslateDialog(props: { document: ProjectDocument; track: Track; onClose(): void; onTrack(trackId: string): void }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const { connection, host, status: link, can } = useHost();
  const { controller } = useEditor(), sceneId = controller.session.sceneId;
  const { status } = useCaptionsStatus();
  // The model is named as the catalogue calls it, not by its id.
  const nameOf = useModelNames(), agents = useAgentData();
  const [choice, setChoice] = usePref(TRANSLATE);
  const [phase, setPhase] = useState<{ step: "idle" } | { step: "running"; done: number; total: number } | { step: "failed"; message: string; settings?: boolean }>({ step: "idle" });
  const [failed, setFailed] = useState<Failed | null>(null);
  const retrying = useRef<Failed | null>(null);
  const current = useRef(0);
  const own = props.track.caption.language ?? "und";
  const targets = LANGUAGES.filter((entry) => entry.value !== "auto" && entry.value !== own);
  const target = targets.find((entry) => entry.value === choice.target) ?? targets[0];
  const captions = props.track.elements.filter((caption) => caption.text.trim().length > 0);
  const todo = failed ? captions.filter((caption) => failed.ids.includes(caption.id)) : captions;
  const lines = (list: readonly Caption[]) => list.map((caption) => ({ id: caption.id, text: cleaned(caption.text) }));
  const whole = wholeOf(lines(todo)), characters = whole.characters;
  const usable = link === "connected" && status?.translation.available === true && characters > 0;
  // Asked with the captions themselves, as Translate will send them: the host prices the real batches.
  const estimate = useEstimate(usable ? translationEstimate(lines(todo), failed?.languageName ?? target.label, own) : null);
  // A run of these captions into this language that stopped half-way: Translate goes on from there.
  const store = progressOf(props.document.metadata.id, props.track.id);
  const [progress] = usePref(store);
  const kept = progress && progress.at > 0 && progress.key === progressKey(lines(todo), failed?.language ?? target.value) ? progress : null;

  const run = useCallback(async (grants: Grants) => {
    if (!connection) return;
    const only = retrying.current, mine = ++current.current, live = () => current.current === mine;
    const language = only?.language ?? target.value, languageName = only?.languageName ?? target.label;
    const list = lines(only ? captions.filter((caption) => only.ids.includes(caption.id)) : captions), key = progressKey(list, language), all = wholeOf(list);
    setPhase({ step: "running", done: 0, total: list.length });
    // Every batch names the whole it is a part of and carries the complete answer: the host approved ONE action.
    const result = await translateBatches({
      list, size: BATCH, key, answer: grants, kept: getPref(store), live, asks: needsConfirming, save: (next) => setPref(store, next),
      send: async (texts, answer) => (await connection.call<{ translations: string[] }>("jagentchill.captions.translate", { texts, target: language, targetName: languageName, projectId: props.document.metadata.id, ...(own !== "und" ? { source: own } : {}), whole: all, ...answer })).translations,
      onProgress: (done, total) => { if (live()) setPhase({ step: "running", done, total }); },
    });
    if (result.status === "stopped") return;
    // The host wants the cost confirmed — before anything is sent, or again when a further paid call would pass what was confirmed: the run stops so the person can be asked.
    if (result.status === "asked") { setPhase({ step: "idle" }); throw result.asked; }
    const { done, missed, lastError } = result;
    if (!live()) return;
    setPhase({ step: "idle" });
    if (done.size === 0) { setPhase({ step: "failed", ...failureText(t, lastError) }); return; }
    let next: Failed | null = null;
    if (only?.into === "track") {
      // The retried captions go into the track the first run made, each into its own caption there.
      const texts: Record<string, string> = {};
      for (const [id, text] of done) if (only.places[id]) texts[only.places[id]] = text;
      controller.external((doc, ctx) => fillCaptionTexts(doc, ctx, texts));
      if (missed.length) next = { ...only, ids: missed };
    } else if (only?.into === "bilingual" || (!only && choice.mode === "bilingual")) {
      const trackId = only?.trackId ?? props.track.id, live_ = captionTracksOf(controller.stored, sceneId).find((entry) => entry.id === trackId) as unknown as Track | undefined;
      if (!live_) return;
      // Captions translated before keep their translation; the ones that failed keep an empty one.
      const all: Record<string, string> = {};
      for (const caption of live_.elements) all[caption.id] = done.get(caption.id) ?? (only || live_.caption.translationLanguage === language ? caption.translation ?? "" : "");
      controller.external((doc, ctx) => translateCaptions(doc, ctx, trackId, language, all));
      if (missed.length) next = { into: "bilingual", trackId, ids: missed, language, languageName };
    } else {
      // Every cue of the source keeps its place in the new track; a caption that was not translated is there without text.
      const result = controller.run(importCaptions({ sceneId, parsed: { format: "srt", cues: translatedCues(captions, done), skipped: 0, trimmed: 0, warnings: [] }, language, name: `${props.track.name} (${language})`.slice(0, 60), origin: "translation" }));
      if (!result.ok || !result.info) return;
      props.onTrack(result.info.trackId);
      const ordered = [...captions].sort((a, b) => a.startTime - b.startTime), places: Record<string, string> = {};
      ordered.forEach((caption, index) => { places[caption.id] = result.info!.elementIds[index]; });
      if (missed.length) next = { into: "track", trackId: result.info.trackId, places, ids: missed, language, languageName };
    }
    retrying.current = null;
    setFailed(next);
    toast.show({ kind: "success", message: (done.size === 1 ? t("1 caption translated", { n: done.size }) : t("{n} captions translated", { n: done.size })) });
    if (!next) props.onClose();
  }, [connection, captions, target, choice.mode, own, props, controller, sceneId, t, toast]); // eslint-disable-line react-hooks/exhaustive-deps
  const paid = usePaid({
    kind: "translation", run, onError: (error) => setPhase({ step: "failed", ...failureText(t, error) }),
    // The estimate of the dialog is asked now, for exactly the captions Translate sends: its ids are the answer's.
    quote: async () => { const only = retrying.current, list = lines(only ? captions.filter((caption) => only.ids.includes(caption.id)) : captions), all = wholeOf(list); return connection && all.characters > 0 ? askEstimate(connection, translationEstimate(list, only?.languageName ?? target.label, own)) : null; },
    resume: () => { const only = retrying.current, found = getPref(store); return found && found.at > 0 && found.key === progressKey(lines(only ? captions.filter((caption) => only.ids.includes(caption.id)) : captions), only?.language ?? target.value) ? found.answer : null; },
  });

  const running = phase.step === "running";
  const blocked = link !== "connected" || !connection ? t("Connect to a host to use this tool")
    : !can("jagentchill.generation.run") ? t("This device cannot start jobs")
    : status && !status.translation.available ? t("No translation model is connected")
    : captions.length === 0 ? t("There are no captions to translate") : null;
  const close = () => { current.current++; props.onClose(); };
  return (
    <Modal title={t("Translate captions")} width={480} onClose={close}
      footer={<><View style={{ flex: 1 }} /><Button size="sm" label={running ? t("Cancel") : t("Close")} testID="translate-cancel" onPress={() => { if (running) { current.current++; setPhase({ step: "idle" }); } else props.onClose(); }} /><Button size="sm" kind="primary" label={t("Translate")} disabled={running || blocked !== null || failed !== null} testID="translate-run" onPress={() => { retrying.current = null; paid.start(); }} /></>}>
      <View testID="translate-dialog" style={{ gap: space[2] }}>
        <Text variant="meta" color="text/secondary">{(captions.length === 1 ? t("1 caption of {track}", { n: captions.length, track: props.track.name }) : t("{n} captions of {track}", { n: captions.length, track: props.track.name }))}</Text>
        <Row label={t("Translate to")}><View testID="translate-target"><Select label={t("Translate to")} size="sm" value={target.value} disabled={running || failed !== null} options={targets.map((entry) => ({ value: entry.value, label: t(entry.label) }))} onChange={(next) => setChoice({ ...choice, target: next })} /></View></Row>
        <Row label={t("Output")}><View testID="translate-mode"><Select label={t("Output")} size="sm" value={choice.mode} disabled={running || failed !== null} options={[{ value: "bilingual", label: t("Bilingual") }, { value: "track", label: t("New track") }]} onChange={(next) => setChoice({ ...choice, mode: next as Mode })} /></View></Row>
        {status?.translation.available ? <Text variant="meta" color="text/secondary" testID="translate-runs-on">{t("Runs on: Host · {model}", { model: runtimeModelName(agents.catalogue?.groups, status.translation.provider, status.translation.model) ?? `${status.translation.label} · ${nameOf(status.translation.model ?? "")}` })}</Text> : null}
        {!blocked && !running && !kept ? <EstimateLine estimate={estimate} testID="translate-estimate" /> : null}
        {!blocked && !running && kept ? <Text variant="meta" color="text/secondary" testID="translate-kept">{t("{n} of {m} captions were already translated. Translate goes on from there; they are not sent or paid for again.", { n: Math.min(kept.at, todo.length), m: todo.length })}</Text> : null}
        {blocked ? <View testID="translate-blocked"><Callout tone="info" actions={status && !status.translation.available && host && can("jagentchill.config.read") ? [{ label: t("Open provider settings"), onPress: () => { props.onClose(); router.push(hostSettingsRoute(host.gatewayId, "runtimes", "generation") as never); } }, { label: t("Open Model routing"), onPress: () => { props.onClose(); router.push(hostSettingsRoute(host.gatewayId, "model-routing") as never); } }] : undefined}>{status && !status.translation.available && link === "connected" ? t("No translation model is connected. Turn one on under Providers, Generation, or give the Translation role a model of a connected generation provider.") : blocked}</Callout></View> : null}
        {running ? <View testID="translate-progress" style={{ gap: space[1] }}><ProgressBar value={phase.total ? phase.done / phase.total : null} label={t("Translating…")} /><Text variant="meta" color="text/secondary">{t("Translating… {n} of {m}", { n: phase.done, m: phase.total })}</Text></View> : null}
        {phase.step === "failed" ? <View testID="translate-error"><Callout tone="danger">{phase.message}</Callout></View> : null}
        {failed && !running ? <View testID="translate-failed"><Callout tone="warning" actions={[{ label: t("Retry failed"), onPress: () => { retrying.current = failed; paid.start(); } }]}>{(failed.ids.length === 1 ? t("1 caption was not translated", { n: failed.ids.length }) : t("{n} captions were not translated", { n: failed.ids.length }))}</Callout></View> : null}
        {paid.dialogs}
      </View>
    </Modal>
  );
}
function Row(props: { label: string; children: ReactNode }) {
  return <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}><Text variant="meta" color="text/secondary" numberOfLines={1} style={{ width: 96 }}>{props.label}</Text><View style={{ flex: 1 }}>{props.children}</View></View>;
}
