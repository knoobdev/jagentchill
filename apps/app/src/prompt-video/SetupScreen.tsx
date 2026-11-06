import { useRouter } from "expo-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { formatAmount } from "@jagentchill/app-core";
import { promptVideo as pv, workflow as wf } from "@jagentchill/editor-core";
import { Button, Callout, Icon, Input, Segmented, Select, Spinner, Switch, Tap, Text, Textarea, radius, space, useTheme, useToast } from "@jagentchill/ui";
import { useHost } from "../host";
import { useT } from "../locale";
import { Screen, useHostScopeState } from "../shell/Shell";
import { Canvas, NO_SELECTION } from "../workflows/Canvas";
import { failureOf } from "../workflows/data";
import { clock } from "../workflows/strings";
import { useEstimate, useStart } from "./data";
import { takeHandoff } from "./handoff";
import { LANGUAGE_LABELS, MOOD_LABELS, PRESET_LABELS, STAGE_LABELS, STYLE_OPTIONS, partUsd, stageCost, usd, usdRange } from "./strings";

const MODE_TEXT: Record<pv.VideoParams["mode"], string> = {
  checkpoints: "Checkpoints pauses after the brief, the script, the shot list and the review.",
  auto: "Auto runs to the end without asking: you review the finished video.",
};

function Field(props: { label: string; children: ReactNode; flex?: number; error?: string }) {
  return (
    <View style={{ flex: props.flex ?? 1, minWidth: 132, gap: space[1] }}>
      <Text variant="body-medium">{props.label}</Text>
      {props.children}
      {props.error ? <Text variant="meta" color="danger/text">{props.error}</Text> : null}
    </View>
  );
}

/**
 * The setup of a prompt-to-video run: the prompt and its settings on one side, the host's estimate on the other. Nothing
 * is generated and nothing is billed until "Start run".
 */
const OTHER_PAID = ["brief", "script_draft", "shot_list", "voice_check", "picture_check", "captions"] as const;
const OTHER_PAID_LABELS: Record<(typeof OTHER_PAID)[number], string> = { brief: "Brief", script_draft: "Script", shot_list: "Shot list", voice_check: "Voice check", picture_check: "Picture check", captions: "Caption translation" };
export function SetupScreen(props: { prompt?: string; model?: pv.WriterModel | null }) {
  const t = useT(), theme = useTheme(), router = useRouter(), toast = useToast();
  const { host, can, status } = useHost();
  const scope = useHostScopeState(t("Workflows"));
  const start = useStart();
  const language = theme.locale.toLowerCase().split(/[-_]/)[0];
  // What the screen that opened this one handed over: a script of the script studio, or a prompt written in the editor.
  const [handed] = useState(() => takeHandoff());
  const [params, setParams] = useState<pv.VideoParams>(() => ({ ...pv.DEFAULT_PARAMS, prompt: handed?.prompt ?? props.prompt ?? "", language: handed?.language && LANGUAGE_LABELS[handed.language] ? handed.language : LANGUAGE_LABELS[language] ? language : "en", ...(props.model ? { model: props.model } : {}), ...(handed?.script ? { script: handed.script } : {}) }));
  const [duration, setDuration] = useState(String(pv.DEFAULT_PARAMS.targetDuration_s));
  const [custom, setCustom] = useState(false);
  const [preset, setPreset] = useState<string | null>(null);
  const [pipeline, setPipeline] = useState(false);
  const [view, setView] = useState<wf.Viewport>({ x: 0, y: 0, zoom: 0.5 });
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const [ownScript, setOwnScript] = useState(!!handed?.script);
  const [budget, setBudget] = useState("");
  const set = (patch: Partial<pv.VideoParams>) => { setParams((before) => ({ ...before, ...patch })); setPreset(null); };
  const connected = status === "connected";
  const mayRun = can("jagentchill.generation.run");
  const problems = pv.checkInput(params);
  const problemOf = (field: keyof pv.VideoParams) => problems.find((problem) => problem.field === field)?.message;
  const settingsValid = !problems.some((problem) => problem.field !== "prompt" && problem.field !== "script");
  // A person's own script decides the length of the video: it lasts as long as it reads.
  const scriptSeconds = useMemo(() => { if (!params.script?.trim()) return null; try { return pv.scriptDuration_s(pv.scriptFromText(params.script, params)); } catch { return null; } }, [params.script, params.language, params.voice]); // eslint-disable-line react-hooks/exhaustive-deps
  const estimate = useEstimate(scriptSeconds ? { ...params, targetDuration_s: scriptSeconds } : params, connected && settingsValid && !scope);
  const answer = estimate.answer;
  const template = useMemo(() => pv.buildTemplate(0), []);
  // "Auto" narrates when the host has a voice; without one the form says so and the run has no narration.
  const noVoice = !!answer && !answer.capabilities.speech;
  useEffect(() => { if (noVoice && params.voice !== "none") setParams((before) => ({ ...before, voice: "none" })); }, [noVoice, params.voice]);
  if (scope) return <Screen title={t("Workflows")}>{scope}</Screen>;

  const base = `/h/${host?.gatewayId}/workflows`;
  const run = async () => {
    setTouched(true);
    if (problems.length || busy) return;
    setBusy(true);
    try {
      // The press on "Confirm … and start" is the run's one money question: the amount shown goes with the start.
      const record = await start({ ...params, ...(ownScript && params.script?.trim() ? { script: params.script.trim() } : { script: undefined }), ...(params.captions && params.secondCaptionLanguage ? {} : { secondCaptionLanguage: undefined }), ...(params.budgetUsd ? {} : { budgetUsd: undefined }) }, answer?.confirmation?.needed ? answer.estimate.highUsd : undefined, answer?.confirmation?.needed ? answer.confirmation.unpricedModels : undefined);
      router.replace(`${base}/runs/${record.id}` as never);
    } catch (error) {
      const failed = failureOf(error);
      toast.show({ kind: "error", message: (failed.details as { reason?: string } | undefined)?.reason === "confirmation_required" ? t("The estimate changed. Check the new amount, then confirm again.") : failed.message });
    } finally { setBusy(false); }
  };
  const options = <T extends string>(values: readonly T[], labels?: Record<string, string>) => values.map((value) => ({ value, label: labels ? t(labels[value] ?? value) : value }));
  const styleValue = custom ? "custom" : STYLE_OPTIONS.some((option) => option.id === params.style) ? params.style : "custom";
  // While the estimate of the settings as they are now is still being worked out there is no amount to confirm.
  const blockedStart = !connected || !mayRun || !answer || estimate.loading || !answer.capabilities.image;
  const asked = answer?.confirmation?.needed ? answer.confirmation : null;
  // Work on the person's own signed-in account (Claude Code, Codex) is not billed by this app: it is in no amount and asks nothing — one quiet line an account.
  const ownAccounts = [...new Set((answer?.estimate.ownAccount ?? []).map((entry) => entry.account ?? entry.model))].map((account) => ({ account, parts: [...new Set((answer?.estimate.ownAccount ?? []).filter((entry) => (entry.account ?? entry.model) === account).map((entry) => t(entry.label)))] }));
  const ownLine = ownAccounts.length ? <View testID="pv-confirm-own" style={{ gap: space[1] }}>{ownAccounts.map((own) => <Text key={own.account} variant="meta" color="text/secondary">{t("On your own {account} account, not billed by this app: {parts}", { account: own.account, parts: own.parts.join(", ") })}</Text>)}</View> : null;
  const part = (stage: string) => { const found = answer?.estimate.stages.find((entry) => entry.stage === stage); return !found || found.count === 0 ? t("Not used") : found.highUsd === null ? t("Price unknown") : partUsd(found); };
  const calls = answer ? answer.estimate.stages.reduce((sum, stage) => sum + (stage.unitUsd === 0 ? 0 : stage.count), 0) : 0;

  const form = (
    <View style={{ flex: 1, minWidth: 0, gap: space[4] }}>
      <View style={{ gap: space[1] }}>
        <Text variant="title-md" testID="pv-setup-title">{t("New prompt-to-video run")}</Text>
        <Text color="text/secondary">{t("One prompt becomes a finished, editable project. Every step can be reviewed, edited or regenerated.")}</Text>
        {handed?.script ? <Text variant="meta" color="text/secondary" testID="pv-from-script">{t("From the script “{title}”: its narration and dialogue are spoken as written.", { title: handed.title ?? "" })}</Text> : null}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }} role="radiogroup" accessibilityLabel={t("Presets")}>
        {pv.PARAM_PRESETS.map((entry) => (
          <Button key={entry.id} size="sm" {...(preset === entry.id ? { kind: "strong" as const } : {})} pressed={preset === entry.id} label={t(PRESET_LABELS[entry.id])} testID={`pv-preset-${entry.id}`}
            onPress={() => { setParams((before) => ({ ...pv.DEFAULT_PARAMS, prompt: before.prompt, language: before.language, model: before.model, ...(before.script !== undefined ? { script: before.script } : {}), ...(before.secondCaptionLanguage ? { secondCaptionLanguage: before.secondCaptionLanguage } : {}), ...(before.budgetUsd ? { budgetUsd: before.budgetUsd } : {}), ...entry.set })); setDuration(String(entry.set.targetDuration_s)); setCustom(false); setPreset(entry.id); }} />
        ))}
      </View>
      <Field label={ownScript ? t("Prompt (optional with your own script)") : t("Prompt")} error={touched || params.prompt.length > pv.PROMPT_MAX ? (problemOf("prompt") ? t(problemOf("prompt")!) : undefined) : undefined}>
        <Textarea testID="pv-prompt" value={params.prompt} onChangeText={(prompt) => set({ prompt })} placeholder={t("Describe the video you want…")} maxLength={pv.PROMPT_MAX + 200} invalid={(touched || params.prompt.length > pv.PROMPT_MAX) && !!problemOf("prompt")} numberOfLines={4} />
        <Text variant="meta" color="text/secondary" style={{ alignSelf: "flex-end" }} testID="pv-prompt-count">{`${formatAmount(params.prompt.trim().length)} / ${formatAmount(pv.PROMPT_MAX)}`}</Text>
      </Field>
      <View style={{ gap: space[2] }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
          <View testID="pv-own-script"><Switch accessibilityLabel={t("Use my own script")} value={ownScript} onChange={(on) => { setOwnScript(on); if (!on) set({ script: undefined }); }} /></View>
          <Text variant="body-medium">{t("Use my own script")}</Text>
          <Text color="text/secondary" style={{ flex: 1 }}>{t("It is spoken exactly as you wrote it.")}</Text>
        </View>
        {ownScript ? (
          <Field label={t("Script")} error={problemOf("script") ? t(problemOf("script")!) : undefined}>
            <Textarea testID="pv-script" value={params.script ?? ""} onChangeText={(script) => set({ script })} placeholder={t("One or two sentences a line. Start a line with a name and a colon for dialogue: Mai: Is it ready?")} maxLength={pv.SCRIPT_MAX + 200} invalid={!!problemOf("script")} numberOfLines={5} />
            {scriptSeconds ? <Text variant="meta" color="text/secondary" testID="pv-script-seconds">{t("The video lasts as long as your script reads: about {n} s", { n: scriptSeconds })}</Text> : null}
          </Field>
        ) : null}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[3] }}>
        <Field label={t("Target duration")} error={!scriptSeconds && problemOf("targetDuration_s") ? t(problemOf("targetDuration_s")!) : undefined}>
          <Input testID="pv-duration" accessibilityLabel={t("Target duration")} value={scriptSeconds ? String(scriptSeconds) : duration} readOnly={!!scriptSeconds} suffix="s" inputMode="numeric" invalid={!scriptSeconds && !!problemOf("targetDuration_s")} onChangeText={(text) => { const digits = text.replace(/[^0-9]/g, "").slice(0, 3); setDuration(digits); set({ targetDuration_s: digits ? Number(digits) : 0 }); }} />
        </Field>
        <Field label={t("Aspect ratio")}><View testID="pv-aspect"><Select label={t("Aspect ratio")} value={params.aspectRatio} options={options(pv.ASPECT_RATIOS)} onChange={(aspectRatio) => set({ aspectRatio })} /></View></Field>
        <Field label={t("Resolution")}><Select label={t("Resolution")} value={params.resolution} options={options(pv.RESOLUTIONS)} onChange={(resolution) => set({ resolution })} /></Field>
        <Field label={t("Frame rate")}><Select label={t("Frame rate")} value={String(params.frameRate)} options={pv.FRAME_RATES.map((rate) => ({ value: String(rate), label: t("{n} fps", { n: rate }) }))} onChange={(rate) => set({ frameRate: Number(rate) as pv.VideoParams["frameRate"] })} /></Field>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[3] }}>
        <Field label={t("Language")}><Select label={t("Language")} value={params.language} options={options(Object.keys(LANGUAGE_LABELS), LANGUAGE_LABELS)} onChange={(next) => set({ language: next })} /></Field>
        <Field label={t("Style")}>
          <View testID="pv-style"><Select label={t("Style")} value={styleValue} options={STYLE_OPTIONS.map((option) => ({ value: option.id as string, label: t(option.label) }))} onChange={(style) => { if (style === "custom") { setCustom(true); set({ style: "" }); } else { setCustom(false); set({ style }); } }} /></View>
        </Field>
        <Field label={t("Voice")}>
          <View testID="pv-voice"><Select label={t("Voice")} disabled={noVoice} value={params.voice} options={[{ value: "none", label: t("None") }, ...(noVoice ? [] : [{ value: "auto", label: t("Auto") }, ...(answer?.voices ?? []).map((voice) => ({ value: voice.voiceId, label: voice.name }))])]} onChange={(voice) => set({ voice })} /></View>
        </Field>
        <Field label={t("Music mood")}><View testID="pv-music"><Select label={t("Music mood")} value={params.musicMood} options={options(pv.MUSIC_MOODS, MOOD_LABELS)} onChange={(musicMood) => set({ musicMood })} /></View></Field>
      </View>
      {custom ? <Field label={t("Describe the style")} error={problemOf("style") ? t(problemOf("style")!) : undefined}><Textarea testID="pv-style-custom" value={params.style} maxLength={500} counter onChangeText={(style) => set({ style })} numberOfLines={2} /></Field> : null}
      {noVoice ? <Text variant="meta" color="text/secondary" testID="pv-no-voice">{t("No voice available for {language} — the video will have no narration", { language: t(LANGUAGE_LABELS[params.language] ?? params.language) })}</Text> : null}
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
        <Switch accessibilityLabel={t("Captions")} value={params.captions} onChange={(captions) => set({ captions })} />
        <Text variant="body-medium">{t("Captions")}</Text>
        <Text color="text/secondary">{params.captions ? t("On") : t("Off")}</Text>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[3] }}>
        {params.captions ? (
          <Field label={t("Second caption language")} error={problemOf("secondCaptionLanguage") ? t(problemOf("secondCaptionLanguage")!) : undefined}>
            <View testID="pv-caption-language"><Select label={t("Second caption language")} value={params.secondCaptionLanguage ?? "none"} options={[{ value: "none", label: t("None") }, ...Object.keys(LANGUAGE_LABELS).filter((code) => code !== params.language).map((code) => ({ value: code, label: t(LANGUAGE_LABELS[code]) }))]} onChange={(code) => set({ secondCaptionLanguage: code === "none" ? null : code })} /></View>
          </Field>
        ) : null}
        <Field label={t("Budget for this run")} error={problemOf("budgetUsd") ? t(problemOf("budgetUsd")!) : undefined}>
          <Input testID="pv-budget" accessibilityLabel={t("Budget for this run")} value={budget} prefix="$" inputMode="decimal" placeholder={t("No limit")} invalid={!!problemOf("budgetUsd")} onChangeText={(text) => { const clean = text.replace(/[^0-9.]/g, "").slice(0, 9); setBudget(clean); set({ budgetUsd: clean ? Number(clean) : null }); }} />
        </Field>
        <Field label={t("Pictures")}><Text color="text/secondary" testID="pv-visual-source">{t("Generated: one picture per shot, checked against the shot")}</Text></Field>
      </View>
      {params.budgetUsd ? <Text variant="meta" color="text/secondary" testID="pv-budget-note">{t("The run stops before it would spend more than {amount}; you can raise it there.", { amount: usd(params.budgetUsd) })}</Text> : null}
      <View style={{ borderRadius: radius.md, borderWidth: 1, borderColor: theme.color("border/hairline"), padding: space[3], flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[3] }}>
        <View style={{ flex: 1, minWidth: 200 }}>
          <Text variant="body-medium">{t("Run mode")}</Text>
          <Text variant="meta" color="text/secondary" testID="pv-mode-text">{t(MODE_TEXT[params.mode])}</Text>
        </View>
        <View testID="pv-mode"><Segmented<pv.VideoParams["mode"]> size="sm" label={t("Run mode")} value={params.mode} onChange={(mode) => set({ mode })} options={[{ value: "auto", label: t("Auto") }, { value: "checkpoints", label: t("Checkpoints") }]} /></View>
      </View>
      <View style={{ borderRadius: radius.md, borderWidth: 1, borderColor: theme.color("border/hairline") }}>
        <Tap role="button" label={t("Pipeline")} expanded={pipeline} testID="pv-pipeline-toggle" onPress={() => setPipeline(!pipeline)} style={{ flexDirection: "row", alignItems: "center", gap: space[2], padding: space[3] }}>
          <Icon name="flow" size={14} color="text/secondary" />
          <Text variant="body-medium" style={{ flex: 1 }}>{t("Pipeline")}</Text>
          <Text variant="meta" color="text/secondary">{pipeline ? t("Hide") : t("{n} steps", { n: template.nodes.length - 1 })}</Text>
        </Tap>
        {pipeline ? <View testID="pv-pipeline" style={{ height: 300, borderTopWidth: 1, borderTopColor: theme.color("border/hairline") }}><Canvas doc={template} mode="view" view={view} onView={setView} selection={NO_SELECTION} onSelect={() => undefined} minimap={false} onSize={(size) => setView(wf.fitView(template, size, 24))} testID="pv-pipeline-canvas" /></View> : null}
      </View>
    </View>
  );

  const stat = (label: string, value: string, testID: string) => (
    <View style={{ flex: 1, minWidth: 96, padding: space[3], borderRadius: radius.md, borderWidth: 1, borderColor: theme.color("border/hairline"), gap: space[0.5] }}>
      <Text variant="meta" color="text/secondary">{label}</Text>
      <Text variant="title-sm" tabular testID={testID}>{value}</Text>
    </View>
  );
  const card = (
    <View testID="pv-estimate" style={{ width: theme.compact ? "100%" : 400, borderRadius: radius.lg, borderWidth: 1, borderColor: theme.color("border/hairline"), padding: space[3], gap: space[3], alignSelf: "flex-start" }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
        <Text variant="body-medium" style={{ flex: 1 }}>{t("Estimate")}</Text>
        {estimate.loading ? <Spinner size={14} /> : null}
      </View>
      {!connected ? <View testID="pv-offline"><Callout tone="warning">{t("Connect to a host to generate videos")}</Callout></View>
        : !answer ? <Text color="text/secondary" testID="pv-estimate-empty">{estimate.error ?? (settingsValid ? t("Working out the estimate…") : t("Fix the settings to see the estimate"))}</Text>
        : (
          <>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
              {stat(t("Estimated cost"), answer.estimate.lowUsd === answer.estimate.highUsd ? usd(answer.estimate.lowUsd) : usdRange(answer.estimate.lowUsd, answer.estimate.highUsd), "pv-estimate-cost")}
              {stat(t("Estimated time"), `${clock(answer.estimate.low_s * 1000)} – ${clock(answer.estimate.high_s * 1000)}`, "pv-estimate-time")}
              {stat(t("Provider calls"), String(calls), "pv-estimate-calls")}
            </View>
            <View>
              <View style={{ flexDirection: "row", paddingVertical: space[1], borderBottomWidth: 1, borderBottomColor: theme.color("border/hairline") }}>
                <Text variant="meta" color="text/secondary" style={{ flex: 2 }}>{t("Step")}</Text><Text variant="meta" color="text/secondary" style={{ flex: 3 }}>{t("Source")}</Text><Text variant="meta" color="text/secondary" style={{ flex: 2, textAlign: "right" }}>{t("Cost")}</Text>
              </View>
              {/* A step on the person's own account is no money row: it is in the line under the table, never a "$0.00". */}
              {answer.estimate.stages.filter((stage) => !stage.ownAccount).map((stage) => (
                <View key={stage.stage} testID={`pv-estimate-row-${stage.stage}`} style={{ flexDirection: "row", paddingVertical: space[1.5], borderBottomWidth: 1, borderBottomColor: theme.color("border/hairline") }}>
                  <Text style={{ flex: 2 }} numberOfLines={1}>{stage.count > 1 ? `${t(STAGE_LABELS[stage.stage] ?? stage.label)} · ${stage.count}` : t(STAGE_LABELS[stage.stage] ?? stage.label)}</Text>
                  <Text color="text/secondary" style={{ flex: 3 }} numberOfLines={1}>{stage.count === 0 ? t("Not used") : t(stage.source)}</Text>
                  {(() => { const cost = stageCost(stage); return <Text tabular testID="pv-estimate-row-cost" color={cost.kind === "unknown" ? "warning/text" : cost.kind === "none" ? "text/tertiary" : "text/primary"} style={{ flex: 2, textAlign: "right" }}>{cost.kind === "unknown" ? t("Price unknown") : cost.kind === "none" ? "—" : stage.measured ? t("about {cost}", { cost: cost.text }) : cost.text}</Text>; })()}
                </View>
              ))}
            </View>
            {!answer.capabilities.image ? <View testID="pv-no-image"><Callout tone="danger">{t("No way to obtain pictures: connect an image provider under Settings, Providers, Generation.")}</Callout></View> : null}
            {answer.estimate.willRunWithout.length ? <View testID="pv-without"><Callout tone="warning" title={t("Will run without")}>{answer.estimate.willRunWithout.map((line) => t(line)).join("\n")}</Callout></View> : null}
            {answer.estimate.unknown && !answer.confirmation?.unpricedModels?.length ? <Callout tone="warning">{t("A step uses a model with no price in the catalogue. It is excluded from the total.")}</Callout> : null}
            {answer.blocked ? <View testID="pv-blocked"><Callout tone="warning">{t("A spending limit of this host leaves {amount}: the run will stop when it is reached.", { amount: usd(answer.blocked.remainingUsd ?? 0) })}</Callout></View> : null}
            <Text variant="meta" color="text/secondary" testID="pv-assumptions">{`${t("Assumptions")}: ${[t("{n} shots", { n: answer.estimate.stages.find((stage) => stage.stage === "assets")?.count ?? 0 }), t("{n} spoken lines", { n: answer.estimate.stages.find((stage) => stage.stage === "voiceover")?.count ?? 0 }), t("1 picture per shot; the high figure allows each to be made twice")].join(" · ")}`}</Text>
          </>
        )}
      {answer && !asked ? ownLine : null}
      {answer && asked ? (
        <View testID="pv-confirm" {...({ dataSet: { amount: String(asked.amountUsd), stops: String(asked.stopsAtUsd) } } as object)} style={{ gap: space[1], padding: space[3], borderRadius: radius.md, backgroundColor: theme.color("bg/subtle") }}>
          {/* Ruling R10: a writing or looking turn is priced from what a request to its model was measured to carry on this host — the total that has one is said with "about". */}
          <Text variant="body-medium" testID="pv-confirm-amount">{t(answer.estimate.stages.some((stage) => stage.measured && (stage.highUsd ?? 0) > 0) ? "This run may spend about {amount}" : "This run may spend up to {amount}", { amount: usd(asked.amountUsd) })}</Text>
          <Text variant="meta" color="text/secondary" testID="pv-confirm-parts">{t("Pictures {pictures} · Voice {voice} · Music {music}", { pictures: part("assets"), voice: part("voiceover"), music: part("music") })}</Text>
          {/* The rest of what the amount covers: the listening to each recording, the look at each picture, the translation of the captions. */}
          {OTHER_PAID.some((id) => answer.estimate.stages.some((entry) => entry.stage === id && entry.count > 0 && entry.unitUsd !== 0)) ? <Text variant="meta" color="text/secondary" testID="pv-confirm-other">{OTHER_PAID.filter((id) => answer.estimate.stages.some((entry) => entry.stage === id && entry.count > 0 && entry.unitUsd !== 0)).map((id) => `${t(OTHER_PAID_LABELS[id])} ${part(id)}`).join(" · ")}</Text> : null}
          {/* A price that is not known is said plainly, by the model's name: the person's Start is the leave to use it. */}
          {(asked.unpricedModels ?? []).map((model) => <View key={model} testID="pv-confirm-unpriced" {...({ dataSet: { model } } as object)}><Text variant="meta" color="warning/text">{t("The price of {model} is not known. What it costs is not in the amount above. Starting allows this run to use it.", { model })}</Text></View>)}
          {ownLine}
          <Text variant="meta" color="text/secondary" testID="pv-confirm-budget">{answer.budget ? t("Left in this host's budget: {amount}", { amount: usd(answer.budget.remainingUsd) }) : params.budgetUsd ? t("Budget for this run: {amount}", { amount: usd(params.budgetUsd) }) : t("No spending limit is set on this host")}</Text>
          <Text variant="meta" color="text/secondary">{t("You are asked once. After you confirm, the run goes to the end without another money question; it stops and asks again only if it would pass {amount}.", { amount: usd(asked.stopsAtUsd) })}</Text>
        </View>
      ) : null}
      {connected && !mayRun ? <Text variant="meta" color="text/secondary">{t("Your role on this host does not allow this")}</Text> : null}
      <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
        <Button kind="strong" icon="play" label={asked ? t("Confirm {amount} and start", { amount: usd(asked.amountUsd) }) : t("Start run")} testID="pv-start" loading={busy} disabled={blockedStart || (touched && problems.length > 0)} onPress={() => void run()} />
      </View>
    </View>
  );

  return (
    <Screen title={t("New run")} crumbs={[{ id: "workflows", label: t("Workflows"), onPress: () => router.push(base as never) }, { id: "new", label: t("New run") }]} documentTitle={t("New prompt-to-video run")}>
      <ScrollView testID="pv-setup" style={{ flex: 1 }} contentContainerStyle={{ padding: theme.compact ? space[3] : space[5], gap: space[4], flexDirection: theme.compact ? "column" : "row", alignItems: "flex-start", maxWidth: 1180, width: "100%" }}>
        {form}
        {card}
      </ScrollView>
    </Screen>
  );
}
