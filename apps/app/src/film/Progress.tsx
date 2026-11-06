import { useRouter } from "expo-router";
import { filmFailure } from "./paid";
import { useEffect, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { preference } from "@jagentchill/app-core";
import { film as fm } from "@jagentchill/editor-core";
import { Button, Icon, IconButton, Spinner, Text, radius, space, useTheme, useToast, type ColorToken, type IconName } from "@jagentchill/ui";
import { hostSettingsRoute } from "../agents/ModelBrowser";
import { useHost } from "../host";
import { useT } from "../locale";
import { bindSplitter } from "../platform/store";
import { usePref } from "../state";
import type { RunData } from "../workflows/data";
import type { FilmActivity } from "./data";
import { Pill, type PillTone } from "./parts";
import type { PipelineState } from "./Pipeline";
import { COST_CHECKPOINT, stepOf } from "./pipelineState";
import type { StageProps } from "./stage";
import { runLabel, usd } from "./strings";

type T = (key: string, values?: Record<string, string | number>) => string;
/** The progress panel is a narrow list beside the stage: never wider than this. */
export const PROGRESS_WIDTH = 360;
const PROGRESS_MIN = 280;
const PROGRESS_PREF = preference<number>("film.progress-panel.width", PROGRESS_WIDTH, (value): value is number => typeof value === "number" && value >= PROGRESS_MIN && value <= PROGRESS_WIDTH);
/** Films whose owner wants to check every step before the next one starts (the others run through), remembered on this device. */
export const STOP_FOR_CHECK_PREF = preference<Record<string, boolean>>("film.stop-for-check", {}, (value): value is Record<string, boolean> => typeof value === "object" && value !== null && !Array.isArray(value) && Object.values(value).every((entry) => typeof entry === "boolean"));

export type StepState = "waiting" | "working" | "done" | "needs_you" | "skipped" | "failed" | "stopped";
export type StepAction = { kind: "approve"; nodeId: string } | { kind: "open"; studio: fm.StageId } | { kind: "connect"; capability: string | null } | { kind: "ask"; /** The checkpoint that is put to the person again. */ nodeId: string } | { kind: "retry"; /** The step of the run that failed (the storyboard has one per round). */ nodeId: string }
  /** The run stopped because it would cost more than was confirmed: confirm the new amount and go on. */
  | { kind: "continue"; /** The words of the answer: the amount to confirm, or — for a model whose price is not known — no amount. */ label: string }
  /** The run is held by a spending limit of the host: once the limit is raised, the run goes on. */
  | { kind: "resume" };
export type ProgressStep = { id: fm.PipelineStageId; studio: fm.StageId; title: string; icon: IconName; state: StepState; result: string[]; costUsd: number; reason: string | null; action: StepAction | null };

/** The six steps of a film in the words a person uses for them. */
const STEPS: Record<fm.PipelineStageId, { title: string; icon: IconName }> = {
  breakdown: { title: "Script", icon: "wand" }, asset_images: { title: "Characters & places", icon: "image" }, panel_images: { title: "Storyboard", icon: "film" },
  voice: { title: "Voices", icon: "voice" }, music: { title: "Music", icon: "music" }, assemble: { title: "Timeline", icon: "layers" },
};
const STATE: Record<StepState, { label: string; tone: PillTone }> = {
  waiting: { label: "Waiting", tone: "neutral" }, working: { label: "Working", tone: "accent" }, done: { label: "Done", tone: "success" }, needs_you: { label: "Needs you", tone: "warning" },
  skipped: { label: "Skipped", tone: "neutral" }, failed: { label: "Failed", tone: "danger" }, stopped: { label: "Stopped", tone: "neutral" },
};
const ACTION: Record<StepAction["kind"], { label: string; icon: IconName }> = {
  approve: { label: "Approve", icon: "check-c" }, ask: { label: "Ask me again", icon: "refresh" }, open: { label: "Open the stage", icon: "ext" }, connect: { label: "Connect a provider", icon: "link" }, retry: { label: "Try again", icon: "refresh" }, continue: { label: "Confirm {amount} and continue", icon: "check-c" }, resume: { label: "Continue", icon: "play" },
};
/** Pictures the provider refused to draw under its content policy: the film holds the refusal (so it is known after a restart); the last failure of this session counts too. */
const blocked = (activity: FilmActivity, key: string): boolean => activity[key]?.state === "failed" && activity[key]?.code === "CONTENT_BLOCKED";
const refusedAssets = (film: fm.Film, activity: FilmActivity): number => (["character", "location", "prop"] as const).reduce((sum, kind) => sum + (kind === "character" ? film.characters : kind === "location" ? film.locations : film.props).filter((asset: fm.Asset) => !asset.picture.current && (!!asset.refused || blocked(activity, `${kind}:${asset.id}`))).length, 0);
const refusedPanels = (film: fm.Film, activity: FilmActivity): number => film.panels.filter((panel) => !panel.picture.current && !panel.leftOut && ((!!panel.refused && panel.refused.reason !== "picture") || blocked(activity, `panel:${panel.id}`))).length;
/** Frames drawn as often as the check allows and still not the frame: they wait for a person. */
const wrongPanels = (film: fm.Film): number => film.panels.filter((panel) => !panel.picture.current && !panel.leftOut && panel.refused?.reason === "picture").length;
const refusedLine = (t: T, n: number): string[] => (n === 1 ? [t("1 picture refused by the provider")] : n > 1 ? [t("{n} pictures refused by the provider", { n })] : []);
/** Lines whose recording in use was checked and is not the line. */
export const unsureLines = (film: fm.Film): fm.Line[] => film.lines.filter((line) => fm.activeTake(line)?.check?.ok === false);

/**
 * The film's progress as six steps. A step's state is the run's when there is a run; where the run says nothing (no
 * run, or one that ended before the step) it is what the film itself holds, so a film made by hand reads the same.
 * An approval is the "needs you" state of the step it follows, never a step of its own.
 */
export function progressSteps(t: T, film: fm.Film, pipeline: PipelineState, activity: FilmActivity, mayRun: boolean, mayRaise = false, nameOf?: ModelNames): ProgressStep[] {
  const counts = fm.counts(film), record = pipeline.record;
  return pipeline.stages.map((stage): ProgressStep => {
    const meta = STEPS[stage.id];
    const have = stage.id === "breakdown" ? film.panels.length > 0 : stage.id === "asset_images" ? counts.assets > 0 && counts.assetsMissing === 0 : stage.id === "panel_images" ? counts.panels > 0 && counts.panelsMissing === 0
      : stage.id === "voice" ? film.panels.length > 0 && counts.linesMissing === 0 : stage.id === "music" ? !!film.music.current : !!film.project && !film.stale.includes("timeline");
    const noMusic = stage.id === "music" && film.music.mood === "none";
    let state: StepState = noMusic ? "skipped" : have ? "done" : "waiting";
    // A step the engine passed over because an earlier one stopped is not "skipped" to a person: it still waits.
    if (record && !noMusic) {
      if (stage.status === "running") state = "working";
      else if (stage.status === "waiting_approval") state = "needs_you";
      else if (stage.status === "failed") state = "failed";
      else if (stage.status === "succeeded") state = "done";
      else if (stage.status === "cancelled" && !have) state = "stopped";
    }
    // Music the provider could not make is left out and the film goes on: the step did not make anything, so it is "Skipped", with why.
    const musicWhy = stage.id === "music" ? (stage.exec?.outputs?.summary as { skipped?: unknown } | undefined)?.skipped : undefined;
    if (typeof musicWhy === "string" && !film.music.current && state === "done") state = "skipped";
    let result: string[] = [];
    if (stage.id === "breakdown" && film.panels.length) result = [[t("Cast of {n}", { n: film.characters.length }), counts.panels === 1 ? t("1 shot") : t("{n} shots", { n: counts.panels }), counts.lines === 1 ? t("1 voice line") : t("{n} voice lines", { n: counts.lines })].join(", ")];
    else if (stage.id === "asset_images" && counts.assets && (state !== "waiting" || counts.assetsMissing < counts.assets)) result = [t("{n} of {m} pictures", { n: counts.assets - counts.assetsMissing, m: counts.assets }), ...refusedLine(t, refusedAssets(film, activity))];
    else if (stage.id === "panel_images" && counts.panels && (state !== "waiting" || counts.panelsWithImage > 0)) result = [t("{n} of {m} pictures", { n: counts.panelsWithImage, m: counts.panels }), ...refusedLine(t, refusedPanels(film, activity)), ...(wrongPanels(film) === 1 ? [t("1 picture is not its frame")] : wrongPanels(film) > 1 ? [t("{n} pictures are not their frame", { n: wrongPanels(film) })] : []), ...(film.panels.some((panel) => panel.leftOut) ? [t("{n} left out", { n: film.panels.filter((panel) => panel.leftOut).length })] : [])];
    else if (stage.id === "voice" && counts.lines && (state !== "waiting" || counts.linesMissing < counts.lines)) { const unsure = unsureLines(film).length, unheard = film.lines.filter((line) => { const take = fm.activeTake(line); return !!take && !take.check && !!take.unchecked; }).length; result = [t("{n} of {m} lines recorded", { n: counts.lines - counts.linesMissing, m: counts.lines }), ...(unsure ? [t("{n} need attention", { n: unsure })] : []), ...(unheard ? [t("{n} not checked", { n: unheard })] : [])]; }
    else if (stage.id === "voice" && film.panels.length && !counts.lines && state === "done") result = [t("This film has no spoken lines.")];
    else if (stage.id === "music") { const why = (stage.exec?.outputs?.summary as { skipped?: unknown } | undefined)?.skipped; result = film.music.current ? [t("Music added")] : noMusic ? [t("No music chosen")] : typeof why === "string" && state !== "working" ? [t("The music could not be made — the film has none"), why] : []; }
    else if (stage.id === "assemble" && state === "done") result = [t("Film assembled")];
    let reason: string | null = null, action: StepAction | null = null;
    // The run's money question is answered in its own dialog (FilmStudio opens it): the card only says what the film waits for.
    if (state === "needs_you" && pipeline.waiting?.nodeId === COST_CHECKPOINT) reason = t("Waiting for the cost to be confirmed");
    else if (state === "needs_you" && pipeline.waiting) { reason = t(pipeline.waiting.instructions); action = mayRun ? { kind: "approve", nodeId: pipeline.waiting.nodeId } : { kind: "open", studio: pipeline.waiting.studio }; }
    // The step stopped at its checkpoint because a person said no: that is said in plain words, with the way to be asked again.
    if (state === "failed" && stage.stopped) {
      reason = stage.stopped.error?.code === "WORKFLOW_REJECTED" || !stage.stopped.error ? t("This step was not approved, so the film stopped here.") : stage.stopped.error.message;
      action = mayRun ? { kind: "ask", nodeId: stage.stopped.nodeId } : { kind: "open", studio: stage.studio };
    } else if (state === "failed") {
      const error = stage.exec?.error ?? (record?.failedNodeId === stage.id ? record.error : undefined);
      reason = filmFailure(t, error, t("This step could not be finished."));
      action = error?.code === "NO_ROUTE" ? { kind: "connect", capability: error.details?.capability ? String(error.details.capability) : null } : mayRun ? { kind: "retry", nodeId: stage.exec?.status === "failed" ? stage.exec.nodeId : stage.id } : { kind: "open", studio: stage.studio };
    }
    // Not a failure of the step: the film was about to cost more than the person confirmed, and waits for their answer.
    if (pipeline.over && stepOf(pipeline.over.nodeId) === stage.id) { state = "needs_you"; reason = overSentence(t, pipeline.over, nameOf); action = mayRun ? { kind: "continue", label: overAction(t, pipeline.over) } : { kind: "open", studio: stage.studio }; }
    // Nor is this one: a spending limit of the host holds the step until the limit is raised.
    if (pipeline.limit && stepOf(pipeline.limit.nodeId) === stage.id) { state = "needs_you"; reason = limitText(t, pipeline.limit, mayRaise); action = mayRun ? { kind: "resume" } : { kind: "open", studio: stage.studio }; }
    return { id: stage.id, studio: stage.studio, title: t(meta.title), icon: meta.icon, state, result, costUsd: stage.costUsd, reason, action };
  });
}

/**
 * What a run says when it is about to cost more than was confirmed for it — the same words as the run view of a
 * workflow and of a prompt video: what it has cost, the amount it would pass, the new total; then that nothing is lost
 * or spent meanwhile. The title above it is `overTitle`, the action "Confirm {amount} and continue".
 */
type Over = NonNullable<PipelineState["over"]>;
/** How a model the host names (`runtime:provider/model`) is called on screen. */
export type ModelNames = (name: string) => string;
export const overTitle = (t: T, over?: Over): string => (over?.unpriced.length ? t("The next step uses a model whose price is not known") : over?.first ? t("The cost of this film has not been confirmed yet") : t("This film would cost more than you confirmed"));
export const overText = (t: T, over: Over, nameOf: ModelNames = (name) => name): string => {
  const kept = t("What was already made is kept. Nothing more is spent until you confirm.");
  // Not an amount: the step that comes next is done by a model this app has no price for — said by its name.
  if (over.unpriced.length) return `${t("The next step of this film is done by {model}, and this app has no price for it. What it costs is charged to the account that model is used with. The film has cost {spent} so far.", { model: over.unpriced.map(nameOf).join(", "), spent: usd(over.spentUsd) })} ${kept}`;
  if (over.first) return `${t("Making it comes to about {total}.", { total: usd(over.nextUsd) })} ${kept}`;
  return `${t("It has cost {spent} so far and would pass the {confirmed} you confirmed. It now comes to about {total}.", { spent: usd(over.spentUsd), confirmed: usd(over.confirmedUsd), total: usd(over.nextUsd) })} ${kept}`;
};
/** The words of the button that answers it. */
export const overAction = (t: T, over: Over): string => (over.unpriced.length ? t("Confirm and continue") : t("Confirm {amount} and continue", { amount: usd(over.nextUsd) }));
/** The whole question as one sentence — the Progress step says exactly what the notice on the Story stage says (its title, then its text). */
export const overSentence = (t: T, over: Over, nameOf?: ModelNames): string => `${overTitle(t, over)} — ${overText(t, over, nameOf)}`;
/** What a run says when a spending limit of the host holds it: which limit, what it leaves, that nothing is lost or charged, and who can raise it. */
export const limitTitle = (t: T): string => t("Spending limit reached");
export const limitText = (t: T, limit: NonNullable<PipelineState["limit"]>, mayRaise: boolean): string => {
  const amount = limit.remainingUsd === null ? "" : usd(limit.remainingUsd);
  const which = limit.unpriced ? t("A budget of this host does not allow work whose price is not known, and the next step of this film has no listed price.")
    : !amount ? t("A budget of this host is used up, so the next step of this film was not started.")
    : limit.scope === "global" ? t("This host's monthly budget leaves {amount} — less than the next step of this film costs.", { amount })
    : limit.scope === "provider" ? t("The budget set for this provider leaves {amount} — less than the next step of this film costs.", { amount })
    : t("A budget of this host leaves {amount} — less than the next step of this film costs.", { amount });
  // Raising the amount does not help a model with no price: allow unknown-cost models or remove this budget.
  const how = limit.unpriced ? (mayRaise ? t("Allow unknown-cost models for this budget, or remove it, then choose Continue.") : t("Ask an admin device to allow unknown-cost models for this budget or remove it, then choose Continue."))
    : mayRaise ? t("Raise the budget, then choose Continue.") : t("Ask an admin device to raise the budget, then choose Continue.");
  return `${which} ${how} ${t("Until then nothing more is made or charged. What was already made is kept.")}`;
};

/** One line that says what the film's run is doing right now, or how it ended. Null when there is nothing to say. */
export function runLine(t: T, film: fm.Film, pipeline: PipelineState): { text: string; kind: "working" | "done" | "stopped" | "needs_you" } | null {
  const record = pipeline.record, counts = fm.counts(film);
  if (!record) return null;
  if (pipeline.over) return { kind: "needs_you", text: overTitle(t, pipeline.over) };
  if (pipeline.limit) return { kind: "needs_you", text: limitTitle(t) };
  if (pipeline.waiting?.nodeId === COST_CHECKPOINT) return { kind: "needs_you", text: t("Waiting for the cost to be confirmed") };
  if (pipeline.waiting) return { kind: "needs_you", text: t("Waiting for your check — {step}", { step: t(pipeline.waiting.title) }) };
  if (pipeline.active) {
    const at = pipeline.stages.find((stage) => stage.status === "running")?.id;
    const text = at === "breakdown" ? t("Writing the script…") : at === "asset_images" ? t("Drawing the characters and places — {n} of {m}", { n: counts.assets - counts.assetsMissing, m: counts.assets })
      : at === "panel_images" ? t("Drawing the storyboard — {n} of {m}", { n: counts.panelsWithImage, m: counts.panels }) : at === "voice" ? t("Recording the voices — {n} of {m}", { n: counts.lines - counts.linesMissing, m: counts.lines })
      : at === "music" ? t("Composing the music…") : at === "assemble" ? t("Putting the timeline together…") : t("Starting…");
    return { kind: "working", text };
  }
  if (record.status === "succeeded") return { kind: "done", text: t("Film assembled — open Timeline") };
  if (record.status === "failed") return { kind: "stopped", text: filmFailure(t, record.error, t("The film stopped.")) };
  if (record.status === "cancelled") return { kind: "stopped", text: t("Stopped. Make the film continues from where it stopped.") };
  return null;
}

/** The progress of the film's run: six steps in one list, read-only except for the one thing a stopped step asks for. */
export function ProgressPanel(props: StageProps & { run: RunData; pipeline: PipelineState; sheet?: boolean; onClose(): void; /** Confirms the new amount of a run that stopped for money and runs its step again. */ onContinue?(): void; continuing?: boolean; /** Lets a run held by a spending limit go on (the limit was raised). */ onResume?(): void; /** How the models the run names are called on screen. */ nameOf?: ModelNames }) {
  const t = useT(), theme = useTheme(), router = useRouter(), toast = useToast();
  const { host, can } = useHost();
  const { film, pipeline, run } = props, record = pipeline.record;
  // What the film waits for is the person, whatever the run's own status is called: the cost to be confirmed, a higher amount, a raised limit.
  const needsYou = !!pipeline.over || !!pipeline.limit || pipeline.waiting?.nodeId === COST_CHECKPOINT;
  const [busy, setBusy] = useState<string | null>(null);
  const [stored, setStored] = usePref(PROGRESS_PREF);
  const [drag, setDrag] = useState<number | null>(null);
  const splitter = useRef<View>(null);
  const width = Math.min(PROGRESS_WIDTH, Math.max(PROGRESS_MIN, drag ?? stored));
  const live = useRef(width), from = useRef(width);
  live.current = width;
  useEffect(() => (props.sheet ? undefined : bindSplitter(splitter.current, {
    onStart: () => { from.current = live.current; setDrag(from.current); },
    onDrag: (dx) => setDrag(Math.min(PROGRESS_WIDTH, Math.max(PROGRESS_MIN, from.current - dx))),
    onEnd: () => setDrag((value) => { if (value !== null) setStored(value); return null; }),
    onReset: () => setStored(PROGRESS_WIDTH),
  })), [props.sheet, setStored]);
  const steps = progressSteps(t, film, pipeline, props.data.activity, props.mayRun, can("jagentchill.config.write"), props.nameOf);
  const runAct = async (id: string, method: string, params: Record<string, unknown>) => { setBusy(id); const result = await run.act(method, params); setBusy(null); if (!result.ok) toast.show({ kind: "error", message: result.message }); };
  const press = (step: ProgressStep, action: StepAction) => {
    if (action.kind === "continue") props.onContinue?.();
    else if (action.kind === "resume") props.onResume?.();
    else if (action.kind === "approve") void runAct(step.id, "jagentchill.workflow.node.resolve", { nodeId: action.nodeId, path: "", outcome: "approved" });
    else if (action.kind === "ask") void runAct(step.id, "jagentchill.workflow.node.retry", { nodeId: action.nodeId, path: "" });
    else if (action.kind === "retry") void runAct(step.id, "jagentchill.workflow.node.retry", { nodeId: action.nodeId, path: "" });
    else if (action.kind === "connect") { if (host) router.push((action.capability ? hostSettingsRoute(host.gatewayId, "runtimes", "generation") : hostSettingsRoute(host.gatewayId, "runtimes")) as never); }
    else { props.go(action.studio); if (props.sheet) props.onClose(); }
  };
  const spent = pipeline.costUsd > 0 || film.spentUsd > 0;
  return (
    <View testID="film-progress" {...({ dataSet: { status: record?.status ?? "none" } } as object)} style={props.sheet ? { flex: 1, minHeight: 0 } : { width, alignSelf: "stretch", minHeight: 0, borderStartWidth: 1, borderStartColor: theme.color("border/hairline"), backgroundColor: theme.color("bg/app") }}>
      {props.sheet ? null : <View ref={splitter} testID="film-progress-splitter" role="separator" aria-label={t("Resize progress")} aria-orientation="vertical" style={{ position: "absolute", top: 0, bottom: 0, width: space[2], zIndex: 1, ...(theme.rtl ? { right: -space[1] } : { left: -space[1] }) }} />}
      {props.sheet ? null : (
        <View style={{ height: 40, flexDirection: "row", alignItems: "center", gap: space[2], paddingStart: space[3], paddingEnd: space[1], borderBottomWidth: 1, borderBottomColor: theme.color("border/hairline") }}>
          <Icon name="flow" size="sm" color="text/secondary" />
          <Text variant="body-medium" style={{ flex: 1 }}>{t("Progress")}</Text>
          {record && needsYou ? <Pill tone="warning" label={t("Needs you")} testID="film-progress-status" /> : record ? <Pill tone={record.status === "failed" ? "danger" : record.status === "succeeded" ? "success" : record.status === "waiting_approval" ? "warning" : record.status === "cancelled" ? "neutral" : "accent"} label={t(runLabel(record.status))} testID="film-progress-status" /> : null}
          <IconButton icon="x" size="sm" label={t("Close progress")} testID="film-progress-close" onPress={props.onClose} />
        </View>
      )}
      <ScrollView style={{ flex: 1, minHeight: 0 }} contentContainerStyle={{ padding: space[3], gap: space[2] }}>
        <View testID="film-progress-steps" role="list" style={{ gap: space[2] }}>
          {steps.map((step, at) => <StepCard key={step.id} step={step} number={at + 1} busy={busy === step.id || ((step.action?.kind === "continue" || step.action?.kind === "resume") && props.continuing === true)} onAction={(action) => press(step, action)} />)}
        </View>
        {spent ? <Text variant="meta" color="text/secondary" testID="film-progress-cost" style={{ paddingHorizontal: space[1], paddingTop: space[1] }}>{t("Spent on this film {amount}", { amount: usd(film.spentUsd) })}</Text> : null}
      </ScrollView>
    </View>
  );
}

const MARK: Record<StepState, { icon: IconName; color: ColorToken } | null> = {
  waiting: { icon: "circle", color: "text/tertiary" }, working: null, done: { icon: "check-c", color: "success/text" }, needs_you: { icon: "warn", color: "warning/text" },
  skipped: { icon: "minus", color: "text/tertiary" }, failed: { icon: "x-c", color: "danger/text" }, stopped: { icon: "minus", color: "text/tertiary" },
};
/** One step: what it is, where it stands, what it made and cost, and — only when it stopped — why, with the one thing to do about it. */
function StepCard(props: { step: ProgressStep; number: number; busy: boolean; onAction(action: StepAction): void }) {
  const t = useT(), theme = useTheme();
  const { step } = props, state = STATE[step.state], mark = MARK[step.state], action = step.action;
  return (
    <View testID={`film-step-${step.id}`} role="listitem" {...({ dataSet: { state: step.state } } as object)}
      style={[{ gap: space[2], padding: space[3], borderRadius: radius.lg, borderWidth: 1, borderColor: theme.color(step.state === "needs_you" ? "warning/text" : step.state === "failed" ? "danger/text" : "border/hairline"), backgroundColor: theme.color("bg/elevated") }, theme.elevation(1)]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
        <View style={{ width: 24, height: 24, borderRadius: radius.sm, alignItems: "center", justifyContent: "center", backgroundColor: theme.color("bg/subtle") }}><Icon name={step.icon} size="sm" color={step.state === "waiting" || step.state === "skipped" ? "text/tertiary" : "text/secondary"} /></View>
        <Text variant="body-medium" numberOfLines={1} style={{ flex: 1 }} color={step.state === "waiting" || step.state === "skipped" ? "text/secondary" : "text/primary"} testID={`film-step-title-${step.id}`}>{step.title}</Text>
        {step.costUsd > 0 ? <Text variant="meta" color="text/secondary" tabular testID={`film-step-cost-${step.id}`}>{usd(step.costUsd)}</Text> : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[1] }}>
          {mark ? <Icon name={mark.icon} size="sm" color={mark.color} /> : <Spinner size={14} />}
          <Text variant="meta" color={mark?.color === "text/tertiary" || !mark ? "text/secondary" : mark.color} testID={`film-step-state-${step.id}`}>{t(state.label)}</Text>
        </View>
      </View>
      {step.result.length ? <Text variant="meta" color="text/secondary" testID={`film-step-result-${step.id}`}>{step.result.join(" · ")}</Text> : null}
      {step.reason ? <Text variant="meta" testID={`film-step-reason-${step.id}`}>{step.reason}</Text> : null}
      {action ? <View style={{ flexDirection: "row", flexWrap: "wrap" }}><Button kind={action.kind === "approve" ? "strong" : "secondary"} size="sm" icon={ACTION[action.kind].icon} label={action.kind === "continue" ? action.label : t(ACTION[action.kind].label)} loading={props.busy} testID={`film-step-action-${step.id}`} onPress={() => props.onAction(action)} /></View> : null}
    </View>
  );
}
