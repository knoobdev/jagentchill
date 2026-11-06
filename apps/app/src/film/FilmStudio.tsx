import { useRouter } from "expo-router";
import { filmFailure } from "./paid";
import { useEffect, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { film as fm } from "@jagentchill/editor-core";
import { BottomSheet, Button, Callout, DestructiveConfirmDialog, EmptyState, FormDialog, IconButton, Input, Kbd, Segmented, Select, Skeleton, Spinner, Tap, Text, Tooltip, space, useTheme, useToast } from "@jagentchill/ui";
import { useHost } from "../host";
import { useT } from "../locale";
import { Screen, useHostScopeState } from "../shell/Shell";
import { hostSettingsRoute } from "../agents/ModelBrowser";
import { CostDialog, costAsk } from "../generation/CostDialog";
import { useRun } from "../workflows/data";
import { AssetsStage } from "./AssetsStage";
import { useFilm, useFilmEstimate, useFilmModelNames, useWritingRouted } from "./data";
import { FILM_AGENT_WIDTH, FilmAgentPanel } from "./FilmAgentPanel";
import { Field, Pill } from "./parts";
import { usePipeline } from "./Pipeline";
import { COST_CHECKPOINT, overAnswer, overOf, type OverEstimate } from "./pipelineState";
import { PROGRESS_WIDTH, ProgressPanel, limitText, limitTitle, overAction, overText, overTitle } from "./Progress";
import type { StageProps } from "./stage";
import { StoryboardStage } from "./StoryboardStage";
import { StoryStage } from "./StoryStage";
import { LANGUAGE_ROWS, STAGE_ROWS, filmRoute, runLabel, usd } from "./strings";
import { TimelineStage } from "./TimelineStage";
import { VoiceStage } from "./VoiceStage";
import { filmStageStrip } from "./mobileLayout";

/** The studio of one film: the top bar, the stage tabs with their outdated marks, the stage itself, the film assistant at the start side and the progress of its run at the end side. */
export function FilmStudio(props: { filmId: string; stage: string; /** Opened from the Home composer with a short idea: "Write with AI" starts with it. */ idea?: boolean }) {
  const t = useT(), theme = useTheme(), router = useRouter(), toast = useToast();
  const { host, can } = useHost();
  const scope = useHostScopeState(t("Film Studio"));
  // The models a money question names are called as a person knows them (the catalogue's names), not by their ids.
  const names = useRef<(name: string) => string>((name) => name);
  const data = useFilm(scope ? null : props.filmId, (name) => names.current(name));
  const film = data.film, estimate = useFilmEstimate(film), writer = useWritingRouted(estimate);
  const nameOf = useFilmModelNames(estimate, writer);
  names.current = nameOf;
  const run = useRun(film?.pipelineRunId ?? null), pipeline = usePipeline(run);
  const [agent, setAgent] = useState(false);
  const [side, setSide] = useState(false);
  const [settings, setSettings] = useState<{ title: string; language: string; frameRate: string; narratorVoiceId: string } | null>(null);
  const [gone, setGone] = useState(false);
  // The run whose money question was answered on this device (its dialog closes at once), and the one whose over-estimate question was put away.
  const [answered, setAnswered] = useState<string | null>(null);
  const [putAway, setPutAway] = useState<string | null>(null);
  const [continuing, setContinuing] = useState(false);
  // What the host said still stands after an answer (an amount was confirmed, and the next step also needs a model whose price is not known): the question shown next.
  const [standing, setStanding] = useState<{ runId: string; over: OverEstimate } | null>(null);
  const [width, setWidth] = useState(0);
  const stage = (fm.STAGES as readonly string[]).includes(props.stage) ? (props.stage as fm.StageId) : "story";
  const go = (next: fm.StageId) => router.setParams({ stage: next } as never);
  // Mod+1 … Mod+5 switch the stage, as the hint at the end of the tab strip says.
  useEffect(() => {
    const target = globalThis as unknown as { addEventListener?(type: string, listener: (event: KeyboardEvent) => void): void; removeEventListener?(type: string, listener: (event: KeyboardEvent) => void): void };
    if (!target.addEventListener) return;
    const onKey = (event: KeyboardEvent) => { const at = Number(event.key); if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && at >= 1 && at <= fm.STAGES.length) { event.preventDefault(); go(fm.STAGES[at - 1]); } };
    target.addEventListener("keydown", onKey);
    return () => target.removeEventListener?.("keydown", onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const crumbs = [{ id: "films", label: t("Film Studio"), onPress: () => router.replace(`/h/${host?.gatewayId}/film` as never) }];
  if (scope) return <Screen title={t("Film Studio")}>{scope}</Screen>;
  if (data.error && !film) return <Screen title={t("Film Studio")} crumbs={crumbs}><EmptyState icon="warn" title={t(data.error.code === "NOT_FOUND" ? "This film is no longer on the host" : "Unable to load the film")} description={data.error.message} actions={[{ label: t("Film Studio"), onPress: crumbs[0].onPress }, { label: t("Retry"), onPress: data.reload, kind: "secondary" }]} /></Screen>;
  if (!film) return <Screen title={t("Film Studio")} crumbs={crumbs}><View style={{ padding: space[5], gap: space[2] }}>{Array.from({ length: 5 }, (_, at) => <Skeleton key={at} height={40} />)}</View></Screen>;

  const mayEdit = can("jagentchill.projects.write"), mayRun = can("jagentchill.generation.run");
  const stageProps: StageProps = { data, film, estimate, mayEdit, mayRun, writer, go };
  const context = `[Film Studio] The person is working on the film "${film.title}" (id ${film.id}), stage ${stage}. Logline: ${film.logline || "not written yet"}. It has ${film.characters.length} characters, ${film.locations.length} locations, ${film.panels.length} storyboard panels and ${film.lines.length} voice lines.${film.sourceText.trim() ? `\nStory:\n"""${film.sourceText.trim().slice(0, 4000)}"""` : ""}`;
  const saveSettings = async () => {
    if (!settings) return;
    const result = await data.apply([{ op: "film.set", fields: { title: settings.title, language: settings.language, frameRate: Number(settings.frameRate) as fm.Film["frameRate"], narratorVoiceId: settings.narratorVoiceId } }]);
    if (result.ok) setSettings(null); else toast.show({ kind: "error", message: result.message });
  };
  const remove = async () => { setGone(false); const result = await data.call("delete"); if (result.ok) router.replace(`/h/${host!.gatewayId}/film` as never); else toast.show({ kind: "error", message: result.message }); };
  const hasStory = !!film && (film.sourceText.trim().length > 0 || film.panels.length > 0);
  // Progress exists only once there is something to follow: a run of this film, or a script made from its story.
  const hasProgress = hasStory && (!!film.pipelineRunId || film.panels.length > 0);
  const narrow = theme.compact || (width > 0 && width - (agent ? FILM_AGENT_WIDTH : 0) - (side && hasProgress ? PROGRESS_WIDTH : 0) < 520);
  const tabStrip = filmStageStrip(theme.compact);
  // The stage the run is on right now: its tab carries a spinner, so a run started from "Make the film" is visible.
  const runningStudio = pipeline.active ? pipeline.stages.find((entry) => entry.status === "running")?.studio ?? null : null;
  const assistant = <FilmAgentPanel filmId={film.id} filmTitle={film.title} context={context} sheet={narrow} onClose={() => setAgent(false)} />;

  // A run that stopped on a missing provider offers the way to connect one; a run with no writing model offers the
  // runtime settings. The message itself is the stage's own "connect a provider/model" sentence.
  const failedRun = pipeline.record?.status === "failed" ? pipeline.record.error : undefined;
  const missingCapability = failedRun?.code === "NO_ROUTE" && failedRun.details?.capability ? String(failedRun.details.capability) : null;
  const failedActions = [
    ...(host && missingCapability ? [{ label: t("Open Providers"), onPress: () => router.push(hostSettingsRoute(host.gatewayId, "runtimes", "generation") as never) }] : []),
    // No model writes: the one place a model is given a job is Model routing.
    ...(host && failedRun?.code === "NO_ROUTE" && !missingCapability ? [{ label: t("Open Model routing"), onPress: () => router.push(hostSettingsRoute(host.gatewayId, "model-routing") as never) }] : []),
    // A script that came out too large is written again on "Try again".
    ...(mayRun && failedRun?.code === "PLAN_EXCEEDED" && pipeline.record?.failedNodeId ? [{ label: t("Try again"), onPress: () => askAgain(pipeline.record!.failedNodeId!) }] : []),
    { label: t("Progress"), onPress: () => setSide(true) },
  ];
  // What the run asks or why it stopped: beside "Make the film" on Story, above the stage elsewhere.
  const resolve = (nodeId: string, outcome: "approved" | "rejected") => void run.act("jagentchill.workflow.node.resolve", { nodeId, path: "", outcome }).then((result) => { if (!result.ok) toast.show({ kind: "error", message: result.message }); });
  const askAgain = (nodeId: string) => void run.act("jagentchill.workflow.node.retry", { nodeId, path: "" }).then((result) => { if (!result.ok) toast.show({ kind: "error", message: result.message }); });
  const band = stage === "story" ? undefined : { paddingHorizontal: space[4], paddingTop: space[3] };
  const waiting = pipeline.waiting, rejected = pipeline.rejected, limit = pipeline.limit, runId = pipeline.record?.id ?? "";
  const over = pipeline.over && standing?.runId === runId ? standing.over : pipeline.over;
  const mayRaise = can("jagentchill.config.write");
  // The ONE money question of a run that began with only a story: the script is written, the estimate is known, and the
  // run waits. It is the same dialog as at "Make the film"; Start lets the run go on, Cancel stops it with nothing made.
  const costWaits = waiting?.nodeId === COST_CHECKPOINT ? waiting : null;
  // (It is asked only when the script that was written needs more than 120 % of what was confirmed at the start: the
  // amount is then the new total — what was spent and what is still to make.)
  const asksAgain = typeof costWaits?.subject.spentUsd === "number" && typeof costWaits.subject.remainsUsd === "number";
  const runAsk = costWaits && mayRun && answered !== runId ? costAsk(t, "film", { ...((costWaits.subject.estimate ?? {}) as Record<string, unknown>), ...(asksAgain ? { amountUsd: Number(costWaits.subject.spentUsd) + Number(costWaits.subject.remainsUsd), remainsUsd: costWaits.subject.remainsUsd } : {}) }, costWaits.subject, nameOf) : null;
  const answerRun = (start: boolean) => { setAnswered(runId); void (start ? run.act("jagentchill.workflow.node.resolve", { nodeId: COST_CHECKPOINT, path: "", outcome: "approved" }) : run.act("jagentchill.workflow.run.cancel")).then((result) => { if (!result.ok) { setAnswered(null); toast.show({ kind: "error", message: result.message }); } }); };
  // The run was about to cost more than was confirmed: the person confirms the new amount and the stopped step is run again.
  const continueFilm = async () => {
    if (!over || continuing) return;
    setContinuing(true);
    // The answer names the question it answers (`overAnswer`: the host's own ids, as they came): the host takes no other.
    const confirmed = await data.call<{ pending?: Record<string, unknown> }>("pipeline.confirm", overAnswer(over));
    // One question answered, another still stands (the amount is confirmed, and the next step needs a model whose price is not known): it is shown, not answered unseen.
    const pending = confirmed.ok ? confirmed.value?.pending : undefined;
    setStanding(pending ? { runId, over: overOf(pending, over.nodeId, over.how) } : null);
    // A run that waits (paused) goes on by the confirmation alone; one that failed at the step has that step run again.
    const result = confirmed.ok && !pending && over.how === "rerun" ? await run.act("jagentchill.workflow.node.rerun", { nodeId: over.nodeId }) : confirmed;
    if (confirmed.ok) run.reload();
    setContinuing(false);
    if (!result.ok) toast.show({ kind: "error", message: result.message });
  };
  // "Stop here": a run that waits for the answer is stopped for good (what was made is kept); one that already ended only puts the question away.
  const stopHere = () => { setPutAway(runId); if (over?.how === "resume") void run.act("jagentchill.workflow.run.cancel").then((result) => { if (!result.ok) toast.show({ kind: "error", message: result.message }); }); };
  // A spending limit of the host holds the run: once it is raised, the run goes on (a run that failed there has its step tried again).
  const resumeFilm = async () => {
    if (!limit || continuing) return;
    setContinuing(true);
    const result = limit.how === "resume" ? await run.act("jagentchill.workflow.run.resume") : await run.act("jagentchill.workflow.node.retry", { nodeId: limit.nodeId, path: "" });
    setContinuing(false);
    if (!result.ok) toast.show({ kind: "error", message: result.message });
  };
  const stopAtLimit = () => { if (limit?.how === "resume") void run.act("jagentchill.workflow.run.cancel").then((result) => { if (!result.ok) toast.show({ kind: "error", message: result.message }); }); else setPutAway(runId); };
  const notice = costWaits ? (mayRun ? null : (
    <View testID="film-checkpoint-banner" {...({ dataSet: { kind: "cost" } } as object)} style={band}>
      <Callout tone="warning" actions={[{ label: t("Progress"), onPress: () => setSide(true) }]}>{t("The script is ready. The film waits for its cost to be confirmed.")}</Callout>
    </View>
  )) : waiting ? (
    <View testID="film-checkpoint-banner" {...({ dataSet: { kind: "check" } } as object)} style={band}>
      <Callout tone="warning" title={t(waiting.title)} actions={[...(mayRun ? [{ label: t("Approve"), onPress: () => resolve(waiting.nodeId, "approved") }] : []), { label: t("Progress"), onPress: () => setSide(true) }]}>{t(waiting.instructions)}</Callout>
    </View>
  ) : rejected ? (
    // A person said no at a checkpoint: what was not done because of it, and how the film goes on.
    <View testID="film-run-declined" {...({ dataSet: { kind: "check", step: rejected.stage } } as object)} style={band}>
      <Callout tone="info" title={t("Not approved: {step}", { step: t(rejected.title) })} actions={[...(mayRun ? [{ label: t("Ask me again"), onPress: () => askAgain(rejected.nodeId) }] : []), { label: t("Progress"), onPress: () => setSide(true) }]}>
        {`${t("The film stopped at this check, and the steps after it were not made. What was made before is kept.")} ${t("To go on, change what needs changing, then choose “Ask me again” and approve.")}`}
      </Callout>
    </View>
  ) : over && putAway !== runId ? (
    // The same question, in the same form, as the run view of a workflow asks it: the figures, then ONE button that names the amount.
    <View testID="film-run-over" {...({ dataSet: { state: "asking", spent: String(over.spentUsd), confirmed: String(over.confirmedUsd), total: String(over.nextUsd) } } as object)} style={[band, { gap: space[2] }]}>
      <Callout tone="warning" title={overTitle(t, over)}>{overText(t, over, nameOf)}</Callout>
      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space[2] }}>
        {mayRun ? <Button size="sm" kind="primary" icon="check-c" label={overAction(t, over)} testID="film-run-over-confirm" loading={continuing} onPress={() => void continueFilm()} /> : <Text variant="meta" color="text/secondary">{t("Your role on this host does not allow this")}</Text>}
        {mayRun ? <Button size="sm" label={t("Stop here")} testID="film-run-over-stop" disabled={continuing} onPress={stopHere} /> : null}
        <Button size="sm" kind="ghost" icon="flow" label={t("Progress")} onPress={() => setSide(true)} />
      </View>
    </View>
  ) : over ? (
    <View testID="film-run-over" {...({ dataSet: { state: "stopped" } } as object)} style={band}>
      <Callout tone="info">{t("Stopped at {spent}. What was made is kept. “Make the film” goes on from here and tells you the cost first.", { spent: usd(over.spentUsd) })}</Callout>
    </View>
  ) : limit && putAway !== runId ? (
    // A spending limit of the host: not a failure and not a bare "Paused" — what holds the film, and the way on.
    <View testID="film-run-limit" {...({ dataSet: { scope: limit.scope, how: limit.how } } as object)} style={[band, { gap: space[2] }]}>
      <Callout tone="warning" title={limitTitle(t)}>{limitText(t, limit, mayRaise)}</Callout>
      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space[2] }}>
        {mayRaise && host ? limit.unpriced ? <>
          <Button size="sm" kind="primary" label={t("Allow unknown-cost models")} testID="film-run-limit-allow-unknown" onPress={() => router.push(hostSettingsRoute(host.gatewayId, "usage", "limits") as never)} />
          <Button size="sm" label={t("Remove budget")} testID="film-run-limit-remove" onPress={() => router.push(hostSettingsRoute(host.gatewayId, "usage", "limits") as never)} />
        </> : <Button size="sm" kind="primary" label={t("Raise budget")} testID="film-run-limit-raise" onPress={() => router.push(hostSettingsRoute(host.gatewayId, "usage", "limits") as never)} /> : <Text variant="meta" color="text/secondary" testID="film-run-limit-ask-admin">{t("Ask an admin device")}</Text>}
        {mayRun ? <Button size="sm" icon="play" label={t("Continue")} testID="film-run-limit-continue" loading={continuing} onPress={() => void resumeFilm()} /> : null}
        {mayRun ? <Button size="sm" label={t("Stop here")} testID="film-run-limit-stop" disabled={continuing} onPress={stopAtLimit} /> : null}
        <Button size="sm" kind="ghost" icon="flow" label={t("Progress")} onPress={() => setSide(true)} />
      </View>
    </View>
  ) : pipeline.record?.status === "failed" ? (
    <View testID="film-run-failed" style={band}><Callout tone="danger" actions={failedActions}>{filmFailure(t, pipeline.record.error, t("The film stopped."))}</Callout></View>
  ) : null;
  const progressPanel = <ProgressPanel {...stageProps} run={run} sheet={narrow} onClose={() => setSide(false)} onContinue={mayRun && over ? () => void continueFilm() : undefined} onResume={mayRun && limit ? () => void resumeFilm() : undefined} continuing={continuing} nameOf={nameOf} pipeline={over && pipeline.over ? { ...pipeline, over } : pipeline} />;
  const body = stage === "story" ? <StoryStage {...stageProps} onOpenProviders={host && can("jagentchill.config.read") ? () => router.push(hostSettingsRoute(host.gatewayId, "runtimes", "generation") as never) : undefined} onOpenRouting={host && can("jagentchill.config.read") ? () => router.push(hostSettingsRoute(host.gatewayId, "model-routing") as never) : undefined} startWithIdea={props.idea} onWriteWithAI={() => setAgent(true)} run={run} pipeline={pipeline} notice={notice} /> : stage === "assets" ? <AssetsStage {...stageProps} /> : stage === "storyboard" ? <StoryboardStage {...stageProps} /> : stage === "voice" ? <VoiceStage {...stageProps} /> : <TimelineStage {...stageProps} />;
  return (
    <Screen title={film.title} crumbs={[...crumbs, { id: "film", label: film.title }]} documentTitle={film.title}
      actions={<>
        {pipeline.record && !theme.compact && (over || limit || costWaits || pipeline.record.status === "waiting_approval") ? <Pill tone="warning" label={t("Needs you")} testID="film-run-status" /> : pipeline.record && !theme.compact ? <Pill tone={pipeline.record.status === "failed" ? "danger" : pipeline.record.status === "succeeded" ? "success" : pipeline.record.status === "waiting_approval" ? "warning" : "accent"} label={t(runLabel(pipeline.record.status))} testID="film-run-status" /> : null}
        {/* Nothing about a run is offered before there is a story to make a film from. */}
        {!hasProgress ? null : theme.compact ? <IconButton icon="flow" size="sm" label={t("Progress")} on={side} toggle testID="film-progress-toggle" onPress={() => setSide(!side)} /> : <Button kind="ghost" size="sm" icon="flow" label={t("Progress")} pressed={side} testID="film-progress-toggle" onPress={() => setSide(!side)} />}
        {mayEdit ? <IconButton icon="gear" size="sm" label={t("Film settings")} testID="film-settings" onPress={() => setSettings({ title: film.title, language: film.language, frameRate: String(film.frameRate), narratorVoiceId: film.narratorVoiceId })} /> : null}
        <IconButton icon="bot" size="sm" label={t("Film assistant")} on={agent} toggle testID="film-toggle-agent" onPress={() => setAgent(!agent)} />
      </>}>
      <View style={{ flex: 1, minHeight: 0, flexDirection: "row" }} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        {agent && !narrow ? assistant : null}
        <View style={{ flex: 1, minWidth: 0 }}>
          {/* The strip holds the tab list and, beside it, the shortcut hint: a tab list may own tabs only. */}
          <ScrollView horizontal={tabStrip.horizontal} showsHorizontalScrollIndicator={!theme.compact} style={{ flexGrow: 0, height: tabStrip.height, borderBottomWidth: 1, borderBottomColor: theme.color("border/hairline") }} contentContainerStyle={{ minWidth: "100%", flexDirection: "row", alignItems: "stretch", gap: theme.compact ? space[2] : space[3], paddingHorizontal: theme.compact ? space[3] : space[4] }}>
          <View testID="film-tabs" role="tablist" aria-label={t("Stages")} style={{ flexDirection: "row", alignItems: "stretch", gap: theme.compact ? space[2] : space[3] }}>
            {STAGE_ROWS.map((row) => {
              const on = row.id === stage, ready = fm.stageReady(film, row.id), stale = film.stale.includes(row.id), running = row.id === runningStudio;
              const blocked = !ready.ready && !on;
              const tab = (
                <View key={row.id} testID={`film-tab-${row.id}`} {...({ dataSet: { selected: on ? "1" : "0", stale: stale ? "1" : "0", ready: ready.ready ? "1" : "0", running: running ? "1" : "0" } } as object)} style={{ minHeight: tabStrip.tabMinHeight }}>
                  <Tap role="tab" label={t(row.label)} selected={on} disabled={blocked} onPress={() => go(row.id)} style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: space[1], borderBottomWidth: 2, borderBottomColor: on ? theme.color("text/primary") : "transparent" }}>
                    <Text variant={on ? "body-medium" : "body"} color={on ? "text/primary" : ready.ready ? "text/secondary" : "text/tertiary"}>{t(row.label)}</Text>
                    {running ? <Spinner size={12} /> : null}
                    {stale ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: theme.color("purple") }} /> : null}
                  </Tap>
                </View>
              );
              // A stage that cannot be opened yet says why: the tooltip's wrapper is what focus lands on (the tab itself is disabled).
              return blocked ? <Tooltip key={row.id} label={t(ready.reason)}>{tab}</Tooltip> : tab;
            })}
          </View>
            {theme.compact ? null : <View style={{ flex: 1 }} />}
            {theme.compact ? null : <View style={{ flexDirection: "row", alignItems: "center", gap: space[1] }}><Kbd keys={["Mod", "1"]} /><Text variant="meta" color="text/tertiary">…</Text><Kbd keys={["Mod", String(fm.STAGES.length)]} /></View>}
          </ScrollView>
          {stage === "story" ? null : notice}
          <View testID={`film-stage-${stage}`} style={{ flex: 1, minHeight: 0 }}>{body}</View>
        </View>
        {side && hasProgress && !narrow ? progressPanel : null}
      </View>
      {narrow ? <BottomSheet open={agent} onClose={() => setAgent(false)} title={t("Film assistant")}><View style={{ height: 560 }}>{assistant}</View></BottomSheet> : null}
      {narrow ? <BottomSheet open={side && hasProgress} onClose={() => setSide(false)} title={t("Progress")}><View style={{ height: 560 }}>{progressPanel}</View></BottomSheet> : null}
      <FormDialog open={!!settings} title={t("Film settings")} submitLabel={t("Save")} dirty={!!settings && (settings.title !== film.title || settings.language !== film.language || settings.frameRate !== String(film.frameRate) || settings.narratorVoiceId !== film.narratorVoiceId)} canSubmit={!!settings?.title.trim()} onClose={() => setSettings(null)} onSubmit={() => void saveSettings()}>
        {settings ? <View style={{ gap: space[3] }}>
          <Field label={t("Title")}><Input size="sm" testID="film-settings-title" value={settings.title} onChangeText={(title) => setSettings({ ...settings, title })} maxLength={fm.LIMITS.title} /></Field>
          <Field label={t("Language")}><Select size="sm" label={t("Language")} value={settings.language} options={(LANGUAGE_ROWS.some((row) => row.id === settings.language) ? LANGUAGE_ROWS : [...LANGUAGE_ROWS, { id: settings.language, label: settings.language }]).map((row) => ({ value: row.id, label: t(row.label) }))} onChange={(language) => setSettings({ ...settings, language })} /></Field>
          <Field label={t("Frame rate")}><Segmented size="sm" label={t("Frame rate")} value={settings.frameRate} onChange={(frameRate) => setSettings({ ...settings, frameRate })} options={fm.FRAME_RATES.map((rate) => ({ value: String(rate), label: `${rate} fps` }))} /></Field>
          {estimate?.voices.length ? <Field label={t("Narrator voice")}><Select size="sm" label={t("Narrator voice")} value={settings.narratorVoiceId || "-"} options={[{ value: "-", label: t("Default voice") }, ...estimate.voices.map((voice) => ({ value: voice.voiceId, label: voice.name }))]} onChange={(voiceId) => setSettings({ ...settings, narratorVoiceId: voiceId === "-" ? "" : voiceId })} /></Field> : null}
          {/* Which model makes what is decided in ONE place, Model routing (ORC): its roles Image, Voice and Music, each with its profiles and fallbacks. */}
          {estimate && host ? <Field label={t("Models")}>
            <View style={{ gap: space[1] }}>
              {([["panels", t("Pictures")], ["voice", t("Voice")], ["listening", t("Recording check")], ["music", t("Music")]] as const).map(([row, label]) => { const found = estimate.rows.find((entry) => entry.id === row); if (row === "listening" && !found?.model) return null; return <Text key={row} variant="meta" color="text/secondary">{`${label}: ${found?.model || t("No provider")}`}</Text>; })}
              {/* Who writes the script and the storyboard, and who looks at the drawn frames: the roles of Model routing as they resolve now. */}
              {(estimate.writing ?? []).map((entry) => (
                <Text key={entry.role} variant="meta" color={entry.problem ? "danger/text" : "text/secondary"} testID={`film-settings-model-${entry.role}`}>
                  {`${entry.role === "screenwriter" ? t("Screenwriter") : entry.role === "storyboard" ? t("Storyboard") : t("Picture check")}: ${entry.problem ?? entry.model?.label ?? (entry.role === "vision" ? t("Off — drawn frames are not checked") : writer === false ? t("Not set") : t("The Director role's model"))}`}
                </Text>
              ))}
              <View style={{ flexDirection: "row" }}><Button kind="ghost" size="sm" icon="flow" label={t("Change in Model routing")} testID="film-settings-routing" onPress={() => { setSettings(null); router.push(hostSettingsRoute(host.gatewayId, "model-routing") as never); }} /></View>
            </View>
          </Field> : null}
          <View style={{ flexDirection: "row" }}><Button kind="ghost" tone="danger" size="sm" icon="trash" label={t("Delete film")} testID="film-delete" onPress={() => { setSettings(null); setGone(true); }} /></View>
        </View> : null}
      </FormDialog>
      {/* Money is the person's decision: one question for the action they started — a picture, a batch, or the whole film. */}
      {data.cost ? <CostDialog ask={data.cost} onClose={() => void data.answerCost(false)} onStart={(answer) => void data.answerCost(true, answer).then((result) => { if (!result.ok) toast.show({ kind: "error", message: result.message }); })} />
        : runAsk ? <CostDialog ask={runAsk} onClose={() => answerRun(false)} onStart={() => answerRun(true)} /> : null}
      <DestructiveConfirmDialog open={gone} title={t("Delete {name}?", { name: film.title })} description={t("The film leaves Film Studio. Projects assembled from it stay in Projects.")} confirmLabel={t("Delete")} onClose={() => setGone(false)} onConfirm={() => void remove()} />
    </Screen>
  );
}
