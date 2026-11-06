import { useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { findModel, formatUsd, relativeTime } from "@jagentchill/app-core";
import { workflow as wf } from "@jagentchill/editor-core";
import { AUTOMATION_COST_LIMITS, AUTOMATION_LIMITS, automationCostProblems, type AutomationDraft, type AutomationInstruction, type AutomationRecord, type AutomationRun, type AutomationSchedule, type WorkflowParameter } from "@jagentchill/protocol";
import { useLibraryState } from "../state";
import { EVENT_SHORT_LABELS, EventTriggerBlock, PendingExports, eventProblem, eventText, firstSchedule, newEventTrigger, runTriggerText } from "./EventTrigger";
import {
  Badge, Button, Callout, Chip, Composer, ConfirmDialog, DestructiveConfirmDialog, Disclosure, EmptyState, Icon, IconButton, Input, MenuButton, Menu, NoResultsState, NumberField, SearchField, Select, LoadingSkeleton, Skeleton, Switch,
  Table, Tabs, Text, Textarea, compactScale, radius, space, useTheme, useToast, type Column, type MenuItem,
} from "@jagentchill/ui";
import { useAgentData } from "../agents/data";
import { ModelBrowser } from "../agents/ModelBrowser";
import { useHost } from "../host";
import { useT } from "../locale";
import { saveBlob } from "../platform/media";
import { guardUnload } from "../platform/store";
import { Screen, useHostScopeState } from "../shell/Shell";
import { failureOf, useWorkflowCalls, useWorkflowIndex } from "./data";
import { ScheduleEditor, ScheduleSentence, defaultSchedule, deviceZone, whenText } from "./Schedule";
import { AUTOMATION_RUN_LABELS, CATCH_UP_LABELS, CONCURRENCY_LABELS, INSTRUCTION_LABELS, NOTIFY_LABELS, PAUSED_LABELS, RUN_REASON_LABELS, clock } from "./strings";
import { RunStatus } from "./WorkflowsScreen";
import { automationListLayout } from "./automationMobileLayout";

/** What the index hands to the editor when it opens it from a prompt: read once. */
let prefill: AutomationDraft | null = null;
const ADVANCED: AutomationDraft["advanced"] = { concurrency: "skip", catchUp: "skip", timeoutMinutes: 120, parkedTimeoutHours: 72, notify: "on_failure" };
const triggerId = (taken: readonly string[]): string => { for (let index = taken.length + 1; ; index++) if (!taken.includes(`t${index}`)) return `t${index}`; };
/** The draft a prompt becomes: a "Start session" instruction holding it and, when it names a cadence, a schedule. */
export function draftOfPrompt(prompt: string): { draft: AutomationDraft; raised: boolean } {
  const cadence = wf.cadenceOf(prompt);
  return {
    raised: cadence?.raised === true,
    draft: { name: prompt.trim().slice(0, 60), triggers: cadence ? [{ id: "t1", type: "schedule", schedule: defaultSchedule(cadence.rrule) }] : [], instructions: [{ kind: "start_session", prompt: prompt.trim(), role: "director", reuse: "new", continueOnFailure: false }], advanced: ADVANCED },
  };
}
const draftOf = (record: AutomationRecord): AutomationDraft => ({ name: record.name, ...(record.description ? { description: record.description } : {}), triggers: record.triggers, instructions: record.instructions, advanced: record.advanced });

/** A schedule as the chip of a table row: its sentence without the time zone. */
const shortSchedule = (schedule: AutomationSchedule): string => wf.describeSchedule(schedule).slice(0, -1).map((piece) => piece.text).join(" ");
/** The last 14 days of an automation: a tall success bar, a short danger bar or a dot per day, so tone is not the only signal. */
function Spark(props: { record: AutomationRecord }) {
  const t = useT(), theme = useTheme();
  const days = props.record.spark ?? [];
  const succeeded = days.reduce((sum, day) => sum + day[0], 0), failed = days.reduce((sum, day) => sum + day[1], 0);
  const summary = t("{ok} succeeded, {failed} failed in the last 14 days", { ok: succeeded, failed });
  return (
    <View accessible role="img" accessibilityLabel={summary} aria-label={summary} style={{ flexDirection: "row", alignItems: "flex-end", gap: 2, height: 14 }}>
      {days.map((day, at) => <View key={at} style={{ width: 3, height: day[1] > 0 ? 6 : day[0] > 0 ? 12 : 2, borderRadius: 1, backgroundColor: theme.color(day[1] > 0 ? "danger" : day[0] > 0 ? "success" : "border/control") }} />)}
    </View>
  );
}
function lastRunText(record: AutomationRecord): string { return record.pausedReason ? PAUSED_LABELS[record.pausedReason] : ""; }

// ── Index ────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The Automations area: the prompt composer, the automations with their triggers, runs and Active switch, and all runs. */
export function AutomationsScreen() {
  const t = useT(), theme = useTheme(), router = useRouter(), toast = useToast();
  const { host, can } = useHost();
  const scope = useHostScopeState(t("Automations"));
  const index = useWorkflowIndex();
  const calls = useWorkflowCalls();
  const [prompt, setPrompt] = useState("");
  const [tab, setTab] = useState("automations");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const [disable, setDisable] = useState<AutomationRecord | null>(null);
  const mayWrite = can("jagentchill.projects.write");
  const base = `/h/${host?.gatewayId}/automations`;
  const now = Date.now();
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...(index.automations ?? [])].filter((record) => (kind === "all" || record.kind === kind) && (!needle || `${record.name} ${record.description ?? ""}`.toLowerCase().includes(needle))).sort((a, b) => b.updated_ms - a.updated_ms);
  }, [index.automations, query, kind]);
  if (scope) return <Screen title={t("Automations")}>{scope}</Screen>;
  const fail = (error: unknown) => toast.show({ kind: "error", message: failureOf(error).message });
  const create = (draft: AutomationDraft | null) => { prefill = draft; router.push(`${base}/new` as never); };
  const submit = () => { const text = prompt.trim(); if (!text) return; const made = draftOfPrompt(text); if (made.raised) toast.show({ kind: "info", message: t("The shortest interval is 5 minutes") }); setPrompt(""); create(made.draft); };
  const activeRuns = (record: AutomationRecord) => (index.automationRuns ?? []).filter((run) => run.automationId === record.id && ["queued", "running", "waiting"].includes(run.status)).length;
  const toggle = (record: AutomationRecord, enabled: boolean) => { if (!enabled && activeRuns(record) > 0) { setDisable(record); return Promise.reject(new Error(t("Choose what happens to its runs"))); } return calls.enableAutomation(record.id, enabled); };
  const columns: Column<AutomationRecord>[] = [
    { id: "name", title: t("Name"), flex: 2, text: (row) => row.name, render: (row) => (
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], minWidth: 0 }}>
        <Text variant="body-medium" numberOfLines={1} testID={`automation-row-${row.name}`}>{row.name}</Text>
        {row.kind === "workflow-trigger" ? <Badge label={t("Workflow trigger")} tone="neutral" /> : null}
        {row.warnings?.length ? <Badge label={t("Will not run")} tone="warning" /> : null}
        {lastRunText(row) ? <Badge label={row.pausedReason === "completed" ? t("Completed · {n} of {m} runs", { n: row.stats.runCount, m: row.advanced.maxRuns ?? row.stats.runCount }) : t(lastRunText(row))} tone="warning" /> : null}
      </View>
    ) },
    { id: "triggers", title: t("Triggers"), flex: 3, text: (row) => row.triggers.map((trigger) => (trigger.type === "schedule" ? wf.scheduleText(trigger.schedule) : eventText(t, trigger))).join("; "), render: (row) => <View style={{ flexDirection: "row", gap: space[1], flexWrap: "wrap", overflow: "hidden", paddingVertical: space[1] }}>{row.triggers.map((trigger) => (trigger.type === "schedule" ? <Chip key={trigger.id} size="sm" tone="accent" icon="clock" label={shortSchedule(trigger.schedule)} /> : <Chip key={trigger.id} size="sm" tone="accent" icon="zap" label={t(EVENT_SHORT_LABELS[trigger.event])} />))}</View> },
    { id: "spark", title: t("Last 14 days"), width: 100, text: (row) => `${row.stats.successCount}/${row.stats.runCount}`, render: (row) => <Spark record={row} /> },
    { id: "last", title: t("Last run"), width: 190, text: (row) => (row.stats.lastStatus ? t(AUTOMATION_RUN_LABELS[row.stats.lastStatus]) : t("Never")), render: (row) => (row.stats.lastStatus && row.stats.lastRun_ms
      ? <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}><RunStatus status={row.stats.lastStatus} label={t(AUTOMATION_RUN_LABELS[row.stats.lastStatus])} /><Text variant="meta" color="text/secondary">{relativeTime(row.stats.lastRun_ms, now, theme.locale)}</Text></View> : <Text color="text/secondary">{t("Never")}</Text>) },
    { id: "next", title: t("Next run"), width: 150, text: (row) => (row.enabled && row.stats.nextRun_ms ? whenText(row.stats.nextRun_ms, firstSchedule(row.triggers)?.tzid ?? deviceZone(), theme.locale) : row.enabled ? (row.triggers.some((trigger) => trigger.type === "event") ? t("On an event") : "—") : t("Paused")) },
    { id: "active", title: t("Active"), width: 70, text: (row) => (row.enabled ? t("On") : t("Off")), render: (row) => <View testID={`automation-active-${row.name}`} {...({ dataSet: { on: String(row.enabled) } } as object)}><Switch accessibilityLabel={t("Active: {name}", { name: row.name })} disabled={!mayWrite} value={row.enabled} onChange={(enabled) => toggle(row, enabled)} errorMessage={(error) => failureOf(error).message || (error as Error).message} /></View> },
  ];
  const runColumns: Column<AutomationRun>[] = [
    { id: "automation", title: t("Automation"), flex: 2, text: (row) => `${row.automationName} #${row.number}` },
    { id: "status", title: t("Status"), width: 150, text: (row) => t(AUTOMATION_RUN_LABELS[row.status]), render: (row) => <RunStatus status={row.status} label={t(AUTOMATION_RUN_LABELS[row.status])} /> },
    { id: "trigger", title: t("Trigger"), width: 120, text: (row) => runTriggerText(t, row.trigger) },
    { id: "started", title: t("Started"), width: 130, text: (row) => relativeTime(row.started_ms, now, theme.locale) },
    { id: "duration", title: t("Duration"), width: 100, numeric: true, text: (row) => (row.finished_ms ? clock(row.finished_ms - row.started_ms) : "—") },
  ];
  const loading = index.automations === null && !index.error;
  const none = (index.automations ?? []).length === 0;
  const mobileLayout = automationListLayout(theme.compact);
  return (
    <Screen title={t("Automations")} actions={theme.compact && mayWrite ? <IconButton icon="plus" label={t("Create automation")} testID="automation-create" onPress={() => create(null)} /> : null}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: mobileLayout.padding, gap: theme.compact ? compactScale.space.gapMedium : space[3], maxWidth: 848, width: "100%", alignSelf: "center" }}>
        <View style={{ gap: space[1] }}>
          {theme.compact ? null : <Text variant="h1" level={1}>{t("Automations")}</Text>}
          <Text color="text/secondary">{t("Run sessions and workflows on a schedule, or when something happens.")}</Text>
        </View>
        <PendingExports />
        {theme.compact ? null : <View testID="automation-composer">
          <Composer docked value={prompt} onChangeText={(text) => setPrompt(text.slice(0, AUTOMATION_LIMITS.promptChars))} onSend={submit} disabled={!mayWrite} canSend={mayWrite && !!prompt.trim()} label={t("Describe what to automate")}
            placeholder={t("Describe what to automate, for example: every Monday make a recap from the week's new clips…")} />
        </View>}
        {index.error && index.automations === null ? <EmptyState icon="warn" title={t("Unable to load automations")} description={failureOf(index.error).message} actions={[{ label: t("Retry"), onPress: index.reload }]} />
          : loading ? <LoadingSkeleton style={{ gap: space[1] }}>{Array.from({ length: 4 }, (_, at) => <Skeleton key={at} height={40} />)}</LoadingSkeleton> : (
          <>
            <View style={{ flexDirection: mobileLayout.filterDirection, alignItems: mobileLayout.filterAlign, gap: mobileLayout.filterGap }}>
              {/* The tabs keep their own width: a search field that grows must never squeeze them out of sight. */}
              <View style={mobileLayout.fullWidthControls ? { minWidth: 0 } : { flexGrow: 1, flexShrink: 0 }}><Tabs id="automations" label={t("Automations")} items={[{ id: "automations", label: t("Automations"), count: index.automations?.length ?? 0 }, { id: "runs", label: t("Runs") }]} value={tab} onChange={setTab} /></View>
              {tab === "automations" ? (
                <>
                  <View style={mobileLayout.fullWidthControls ? { width: "100%" } : { width: 220, flexShrink: 1, minWidth: 120 }}><SearchField label={t("Search automations")} placeholder={t("Search automations…")} size="sm" value={query} onChangeText={setQuery} style={{ width: "100%" }} /></View>
                  <Select size="sm" width={mobileLayout.fullWidthControls ? undefined : 170} label={t("Kind")} value={kind} onChange={setKind} options={[{ value: "all", label: t("All") }, { value: "automation", label: t("Automations") }, { value: "workflow-trigger", label: t("Workflow triggers") }]} />
                </>
              ) : null}
              {!theme.compact ? <Button kind="strong" size="sm" icon="plus" label={t("Create automation")} disabled={!mayWrite} testID="automation-create" onPress={() => create(null)} /> : null}
            </View>
            {tab === "automations" ? (
              none ? <EmptyState icon="zap" title={t("No automations yet")} description={t("An automation starts a session or runs a workflow on a schedule, or when a project is created, an export ends or a run ends.")} actions={mayWrite && !theme.compact ? [{ label: t("Create automation"), kind: "strong", onPress: () => create(null) }] : []} />
                : rows.length === 0 ? <NoResultsState title={t("No automations match")} query={query} onClear={() => { setQuery(""); setKind("all"); }} />
                : <Table label={t("Automations")} columns={columns} rows={rows.slice(0, 50)} rowKey={(row) => row.id} rowMenu={(row) => [
                  { id: "open", label: t("Open"), icon: "ext", onSelect: () => router.push(`${base}/${row.id}` as never) },
                  { id: "toggle", label: row.enabled ? t("Pause") : t("Enable"), icon: row.enabled ? "pause" : "play", disabled: !mayWrite, onSelect: () => void toggle(row, !row.enabled).catch(fail) },
                ]} onRowPress={(row) => router.push(`${base}/${row.id}` as never)} />
            ) : (index.automationRuns ?? []).length === 0 ? <EmptyState icon="play" title={t("No runs yet")} description={t("Runs of every automation are listed here.")} />
              : <Table label={t("Runs")} columns={runColumns} rows={(index.automationRuns ?? []).slice(0, 50)} rowKey={(row) => row.id} onRowPress={(row) => router.push(`${base}/${row.automationId}` as never)} />}
          </>
        )}
      </ScrollView>
      <ConfirmDialog open={!!disable} title={disable ? t("Disable '{name}'?", { name: disable.name }) : ""} description={t("It has runs in progress.")} confirmLabel={t("Disable and cancel runs")} onClose={() => setDisable(null)}
        onConfirm={() => { const record = disable; setDisable(null); if (record) void calls.enableAutomation(record.id, false, true).catch(fail); }}>
        <View style={{ alignItems: "flex-start" }}><Button size="sm" label={t("Disable and let them finish")} onPress={() => { const record = disable; setDisable(null); if (record) void calls.enableAutomation(record.id, false, false).catch(fail); }} /></View>
      </ConfirmDialog>
    </Screen>
  );
}

// ── Editor ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * An amount of money a person must set themselves: there is no default (nobody is there to confirm a cost when the
 * automation runs, so this is the confirmation). Empty, or outside the range, it is "not set" and the form says so.
 */
function AmountField(props: { title: string; hint: string; value: number | undefined; min: number; max: number; required: boolean; submitted: boolean; missing: string; disabled?: boolean; testID: string; onChange(value: number | undefined): void }) {
  const t = useT();
  const [text, setText] = useState(props.value === undefined ? "" : String(props.value));
  // The amount changed from outside this field (a draft loaded, a template applied): show it.
  const shown = useRef(props.value);
  useEffect(() => { if (props.value !== shown.current) { shown.current = props.value; if (props.value !== undefined) setText(String(props.value)); } }, [props.value]);
  const read = (typed: string): number | undefined => { const amount = Number(typed.trim().replace(",", ".")); return typed.trim() !== "" && Number.isFinite(amount) && amount >= props.min && amount <= props.max ? Math.round(amount * 100) / 100 : undefined; };
  const outside = text.trim() !== "" && read(text) === undefined;
  return (
    <View style={{ gap: space[1] }}>
      <Text variant="meta" color="text/secondary">{props.required ? `${props.title} · ${t("required")}` : props.title}</Text>
      <View style={{ maxWidth: 220 }}>
        <Input size="sm" disabled={props.disabled} testID={props.testID} value={text} inputMode="decimal" maxLength={12} placeholder={t("Amount in US dollars")} accessibilityLabel={props.title} aria-label={props.title}
          error={outside ? t("Enter an amount between {min} and {max}", { min: formatUsd(props.min), max: formatUsd(props.max) }) : props.required && props.submitted && props.value === undefined ? props.missing : undefined}
          onChangeText={(typed) => { const next = typed.replace(/[^0-9.,]/g, ""); setText(next); const amount = read(next); shown.current = amount; props.onChange(amount); }} />
      </View>
      <Text variant="meta" color="text/tertiary">{props.hint}</Text>
    </View>
  );
}

/** The parameters of the workflow an instruction runs, one field each; values are kept as the text that was typed. */
function WorkflowParams(props: { workflowId: string; params: Record<string, unknown>; onChange(params: Record<string, unknown>): void; disabled?: boolean }) {
  const calls = useWorkflowCalls();
  const [parameters, setParameters] = useState<WorkflowParameter[]>([]);
  useEffect(() => { let alive = true; setParameters([]); if (props.workflowId) void calls.get(props.workflowId).then((got) => { if (alive) setParameters(got.document.parameters); }).catch(() => undefined); return () => { alive = false; }; }, [props.workflowId, calls]);
  if (!parameters.length) return null;
  return (
    <View style={{ gap: space[2] }}>
      {parameters.map((param) => (
        <View key={param.name} style={{ gap: space[1] }}>
          <Text variant="meta" color="text/secondary">{param.required ? `${param.label} *` : param.label}</Text>
          {param.type === "boolean" ? <Switch accessibilityLabel={param.label} disabled={props.disabled} value={props.params[param.name] === true} onChange={(on) => props.onChange({ ...props.params, [param.name]: on })} />
            : <Input size="sm" disabled={props.disabled} testID={`automation-param-${param.name}`} value={props.params[param.name] === undefined ? "" : String(props.params[param.name])}
              onChangeText={(text) => { const next = { ...props.params }; if (text === "") delete next[param.name]; else next[param.name] = (param.type === "number" || param.type === "integer") && Number.isFinite(Number(text)) ? Number(text) : text; props.onChange(next); }} />}
        </View>
      ))}
    </View>
  );
}

/** One instruction of the editor: its kind, its controls, and its options (continue on failure, move, remove). */
function InstructionBlock(props: { instruction: AutomationInstruction; index: number; count: number; onChange(next: AutomationInstruction): void; onMove(by: -1 | 1): void; onRemove(): void; disabled?: boolean; submitted: boolean; allowUnpriced: boolean }) {
  const t = useT(), theme = useTheme(), calls = useWorkflowCalls();
  const index = useWorkflowIndex();
  const agents = useAgentData();
  const [options, setOptions] = useState(false);
  const [browser, setBrowser] = useState(false);
  const [priceWarnings, setPriceWarnings] = useState<string[]>([]);
  const optionsRef = useRef<View>(null), modelRef = useRef<View>(null);
  const { instruction } = props;
  const paramsKey = instruction.kind === "run_workflow" ? JSON.stringify(instruction.params) : "{}";
  useEffect(() => {
    let alive = true;
    setPriceWarnings([]);
    if (instruction.kind !== "run_workflow" || !instruction.workflowId || props.allowUnpriced) return () => { alive = false; };
    void calls.estimate(instruction.workflowId, instruction.params).then(({ estimate }) => {
      if (alive && estimate.unpricedModels.length) setPriceWarnings(estimate.unpricedModels.map((model) => t("This workflow uses {model}, whose price is not known — allow models without a known price, or it will not run", { model })));
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [instruction.kind, instruction.kind === "run_workflow" ? instruction.workflowId : "", paramsKey, props.allowUnpriced, calls, t]);
  // The model browser may answer after the block was drawn again: its choice is merged into the instruction as it is then.
  const latest = useRef(instruction);
  latest.current = instruction;
  const items: MenuItem[] = [
    { id: "continue", label: t("Continue if this fails"), switch: true, checked: instruction.continueOnFailure, onSelect: () => props.onChange({ ...instruction, continueOnFailure: !instruction.continueOnFailure }) },
    { type: "separator" },
    { id: "up", label: t("Move up"), icon: "arrow-up", disabled: props.index === 0, onSelect: () => props.onMove(-1) },
    { id: "down", label: t("Move down"), icon: "arrow-d", disabled: props.index === props.count - 1, onSelect: () => props.onMove(1) },
  ];
  const model = instruction.kind === "start_session" && instruction.ref ? findModel(agents.catalogue, instruction.ref) : undefined;
  return (
    <View testID={`automation-instruction-${props.index}`} {...({ dataSet: { kind: instruction.kind } } as object)} style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: theme.color("border/hairline") }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], height: 36, paddingStart: space[3], paddingEnd: space[1], borderBottomWidth: 1, borderBottomColor: theme.color("border/hairline") }}>
        <Icon name={instruction.kind === "start_session" ? "chat" : "flow"} size={14} />
        <Text variant="body-medium" style={{ flex: 1 }}>{t(INSTRUCTION_LABELS[instruction.kind])}</Text>
        <View ref={optionsRef}><IconButton icon="sliders" size="sm" label={t("Instruction options")} disabled={props.disabled} expanded={options} testID={`automation-instruction-options-${props.index}`} onPress={() => setOptions(true)} /></View>
        <IconButton icon="x" size="sm" label={t("Remove instruction")} disabled={props.disabled} onPress={props.onRemove} />
      </View>
      <View style={{ padding: space[3], gap: space[2] }}>
        {instruction.kind === "start_session" ? (
          <>
            <Textarea value={instruction.prompt} disabled={props.disabled} minLines={3} maxLines={10} testID={`automation-prompt-${props.index}`} accessibilityLabel={t("Prompt")} aria-label={t("Prompt")} placeholder={t("What should the agent do?")}
              onChangeText={(prompt) => props.onChange({ ...instruction, prompt })} error={props.submitted && !instruction.prompt.trim() ? t("Prompt is required") : instruction.prompt.length > AUTOMATION_LIMITS.promptChars ? t("Prompt must be 8,000 characters or fewer") : undefined} />
            <View ref={modelRef} style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
              <Chip size="md" icon="bot" label={model ? t("Model · {model}", { model: model.label }) : instruction.ref ? t("Model · {model}", { model: instruction.ref.modelId }) : t("Role · {role}", { role: instruction.role })} disabled={props.disabled} onPress={() => setBrowser(true)} />
              {instruction.ref ? <Chip size="md" label={t("Use the host's routing")} disabled={props.disabled} onPress={() => { const { ref: _ref, ...rest } = instruction; props.onChange(rest); }} /> : null}
              <Chip size="md" label={instruction.reuse === "continue" ? t("Continue the last session") : t("New session each run")} disabled={props.disabled} onPress={() => props.onChange({ ...instruction, reuse: instruction.reuse === "continue" ? "new" : "continue" })} />
            </View>
            <ModelBrowser open={browser} onClose={() => setBrowser(false)} anchor={modelRef} current={instruction.ref ?? null} catalogue={agents.catalogue} onSelect={(next) => { const now = latest.current; if (now.kind === "start_session") props.onChange({ ...now, ref: next.ref }); }} />
          </>
        ) : (
          <>
            <Select label={t("Workflow")} placeholder={t("Choose a workflow")} disabled={props.disabled || !(index.workflows ?? []).length} invalid={props.submitted && !instruction.workflowId} value={(index.workflows ?? []).some((item) => item.id === instruction.workflowId) ? instruction.workflowId : null}
              options={(index.workflows ?? []).map((item) => ({ value: item.id, label: item.name }))} onChange={(workflowId) => props.onChange({ ...instruction, workflowId, params: {} })} />
            {(index.workflows ?? []).length === 0 ? <Text variant="meta" color="text/secondary">{t("There is no workflow on this host yet.")}</Text> : props.submitted && !instruction.workflowId ? <Text variant="meta" color="danger/text">{t("Choose a workflow")}</Text> : null}
            <WorkflowParams workflowId={instruction.workflowId} params={instruction.params} disabled={props.disabled} onChange={(params) => props.onChange({ ...instruction, params })} />
            <AmountField title={t("Most one run may cost")} testID={`automation-max-cost-${props.index}`} required submitted={props.submitted} missing={t("Set the most one run may cost")} disabled={props.disabled} value={instruction.maxCostUsd} min={AUTOMATION_COST_LIMITS.maxCostUsd.min} max={AUTOMATION_COST_LIMITS.maxCostUsd.max}
              hint={t("Nobody is asked when an automation runs: a run estimated above this amount is not started, and a run that reaches it is stopped.")}
              onChange={(maxCostUsd) => { const { maxCostUsd: _before, ...rest } = instruction; props.onChange(maxCostUsd === undefined ? rest : { ...rest, maxCostUsd }); }} />
            {priceWarnings.map((warning, at) => <Text key={at} variant="meta" color="warning/text" testID={`automation-unpriced-warning-${props.index}-${at}`}>{warning}</Text>)}
          </>
        )}
        {instruction.continueOnFailure ? <Text variant="meta" color="text/secondary">{t("The run goes on if this fails.")}</Text> : null}
      </View>
      <Menu open={options} anchor={optionsRef} items={items} label={t("Instruction options")} align="end" onClose={() => setOptions(false)} />
    </View>
  );
}

/**
 * The automation editor: a title, the triggers as sentences of token chips, the instructions in the order they run,
 * and the advanced settings. Nothing is saved until "Create automation" or "Save changes" is pressed.
 */
export function AutomationEditor(props: { record?: AutomationRecord; onDone(record: AutomationRecord | null): void }) {
  const t = useT(), theme = useTheme(), toast = useToast();
  const { can } = useHost();
  const calls = useWorkflowCalls();
  const initial = useRef<AutomationDraft>(props.record ? draftOf(props.record) : prefill ?? { name: "", triggers: [], instructions: [], advanced: ADVANCED }).current;
  useEffect(() => { prefill = null; }, []);
  const [draft, setDraft] = useState<AutomationDraft>(initial);
  const [schedule, setSchedule] = useState<{ id: string | null; value: AutomationSchedule | null } | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [discard, setDiscard] = useState(false);
  const addRef = useRef<View>(null);
  const disabled = !can("jagentchill.projects.write");
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const live = useRef(dirty);
  live.current = dirty;
  useEffect(() => guardUnload(() => live.current), []);
  // Choices that answer late (the model browser) must be merged into the draft as it is now, not as it was when they were drawn.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const set = (patch: Partial<AutomationDraft>) => { const next = { ...draftRef.current, ...patch }; draftRef.current = next; setDraft(next); setError(undefined); };
  const problems = {
    name: !draft.name.trim() ? t("Name is required") : undefined,
    triggers: draft.triggers.length === 0 ? t("Add at least one trigger") : draft.triggers.some((trigger) => trigger.type === "event" && eventProblem(trigger)) ? t("Complete every trigger") : undefined,
    instructions: draft.instructions.length === 0 ? t("Add at least one instruction") : draft.instructions.some((entry) => (entry.kind === "start_session" ? !entry.prompt.trim() || entry.prompt.length > AUTOMATION_LIMITS.promptChars : !entry.workflowId)) ? t("Complete every instruction") : undefined,
  };
  // The amounts nobody can be asked for later: without them the automation is not saved (the host refuses it the same way).
  const costs = automationCostProblems(draft), budgetRequired = draft.instructions.some((entry) => entry.kind === "start_session"), budgetMissing = costs.some((problem) => problem.path === "advanced.budgetUsd");
  const valid = !problems.name && !problems.triggers && !problems.instructions && costs.length === 0;
  const save = async () => {
    setSubmitted(true);
    if (!valid || busy) return;
    setBusy(true);
    try {
      const body: AutomationDraft = { ...draft, name: draft.name.trim() };
      const saved = props.record ? await calls.updateAutomation(props.record.id, body, props.record.revision) : await calls.createAutomation(body);
      live.current = false;
      toast.show({ kind: "success", message: props.record ? t("Changes saved") : t("Automation created") });
      props.onDone(saved.automation);
    } catch (failure) { setError(failureOf(failure).message); } finally { setBusy(false); }
  };
  const addInstruction = (kind: AutomationInstruction["kind"]) => set({ instructions: [...draft.instructions, kind === "start_session" ? { kind, prompt: "", role: "director", reuse: "new", continueOnFailure: false } : { kind, workflowId: "", params: {}, continueOnFailure: false }] });
  const moveInstruction = (at: number, by: -1 | 1) => { const list = [...draft.instructions]; const [entry] = list.splice(at, 1); list.splice(at + by, 0, entry); set({ instructions: list }); };
  const heading = (title: string, action: ReactNode) => <View style={{ flexDirection: "row", alignItems: "center", minHeight: 32, marginTop: space[3] }}><Text variant="title-sm" level={2} style={{ flex: 1 }}>{title}</Text>{action}</View>;
  return (
    <ScrollView testID="automation-editor" contentContainerStyle={{ flexGrow: 1, padding: theme.compact ? space[3] : space[6], gap: space[2], maxWidth: 664, width: "100%", alignSelf: "center" }}>
      <Input value={draft.name} onChangeText={(name) => set({ name })} disabled={disabled} maxLength={80} placeholder={t("Name this automation")} accessibilityLabel={t("Name")} aria-label={t("Name")} testID="automation-name" error={submitted ? problems.name : undefined} />
      {heading(t("Triggers"), <View ref={addRef}><MenuButton size="sm" kind="secondary" icon="plus" label={t("Add trigger")} disabled={disabled || draft.triggers.length >= AUTOMATION_LIMITS.triggers} items={[{ id: "schedule", label: t("Schedule"), icon: "clock", onSelect: () => setSchedule({ id: null, value: null }) }, { id: "event", label: t("Project event"), icon: "zap", onSelect: () => set({ triggers: [...draftRef.current.triggers, newEventTrigger(triggerId(draftRef.current.triggers.map((entry) => entry.id)))] }) }]} /></View>)}
      {draft.triggers.map((trigger) => (trigger.type === "event" ? (
        <EventTriggerBlock key={trigger.id} trigger={trigger} disabled={disabled} submitted={submitted} onChange={(next) => set({ triggers: draftRef.current.triggers.map((entry) => (entry.id === trigger.id ? next : entry)) })} onRemove={() => set({ triggers: draftRef.current.triggers.filter((entry) => entry.id !== trigger.id) })} />
      ) : (
        <View key={trigger.id} testID={`automation-trigger-${trigger.id}`} style={{ flexDirection: "row", alignItems: "center", gap: space[2], minHeight: 40, paddingStart: space[3], paddingEnd: space[1], paddingVertical: space[1], borderRadius: radius.lg, borderWidth: 1, borderColor: theme.color("border/hairline") }}>
          <ScheduleSentence schedule={trigger.schedule} onPress={disabled ? undefined : () => setSchedule({ id: trigger.id, value: trigger.schedule })} />
          <IconButton icon="pencil" size="sm" label={t("Edit trigger")} disabled={disabled} onPress={() => setSchedule({ id: trigger.id, value: trigger.schedule })} />
          <IconButton icon="x" size="sm" label={t("Remove trigger")} disabled={disabled} onPress={() => set({ triggers: draft.triggers.filter((entry) => entry.id !== trigger.id) })} />
        </View>
      )))}
      {problems.triggers ? <Text variant="meta" color={submitted ? "danger/text" : "text/secondary"} testID="automation-no-trigger">{problems.triggers}</Text> : null}
      {heading(t("Instructions"), <MenuButton size="sm" kind="secondary" icon="plus" label={t("Add instruction")} disabled={disabled || draft.instructions.length >= AUTOMATION_LIMITS.instructions}
        items={[{ id: "start_session", label: t("Start session"), icon: "chat", onSelect: () => addInstruction("start_session") }, { id: "run_workflow", label: t("Run workflow"), icon: "flow", onSelect: () => addInstruction("run_workflow") }]} />)}
      {draft.instructions.map((instruction, at) => (
        <InstructionBlock key={at} instruction={instruction} index={at} count={draft.instructions.length} disabled={disabled} submitted={submitted} allowUnpriced={draft.advanced.allowUnpricedModels === true} onChange={(next) => set({ instructions: draftRef.current.instructions.map((entry, index) => (index === at ? next : entry)) })}
          onMove={(by) => moveInstruction(at, by)} onRemove={() => set({ instructions: draft.instructions.filter((_, index) => index !== at) })} />
      ))}
      {problems.instructions && (submitted || draft.instructions.length === 0) ? <Text variant="meta" color={submitted ? "danger/text" : "text/secondary"}>{problems.instructions}</Text> : null}
      <View style={{ marginTop: space[2] }}>
        {budgetMissing && !advanced ? <Text variant="meta" color={submitted ? "danger/text" : "text/secondary"} testID="automation-budget-needed">{t("Set a monthly budget under Advanced: a session has no cost limit of its own.")}</Text> : null}
        <Disclosure title={t("Advanced")} open={advanced} onToggle={setAdvanced} summary={<Text variant="meta" color="text/secondary">{t("concurrency, catch-up, maximum runs, budget, timeout, notifications")}</Text>}>
          <View style={{ gap: space[3], paddingVertical: space[2] }}>
            <AmountField title={t("Monthly budget")} testID="automation-budget" required={budgetRequired} submitted={submitted} missing={t("Set a monthly budget")} disabled={disabled} value={draft.advanced.budgetUsd} min={AUTOMATION_COST_LIMITS.budgetUsd.min} max={AUTOMATION_COST_LIMITS.budgetUsd.max}
              hint={t("The most this automation may spend in a calendar month, over all its runs. When it is reached nothing more is started until the next month.")}
              onChange={(budgetUsd) => { const { budgetUsd: _before, ...rest } = draftRef.current.advanced; set({ advanced: budgetUsd === undefined ? rest : { ...rest, budgetUsd } }); }} />
            {/* Nobody is there to be asked when an automation runs: a model whose price is not known is used only when a person said so HERE. Off unless turned on. */}
            <View testID="automation-allow-unpriced" {...({ dataSet: { on: String(draft.advanced.allowUnpricedModels === true) } } as object)} style={{ gap: space[1] }}>
              <Switch label={t("Allow models whose price is not known")} disabled={disabled} value={draft.advanced.allowUnpricedModels === true} onChange={(on) => { const { allowUnpricedModels: _before, ...rest } = draftRef.current.advanced; set({ advanced: on ? { ...rest, allowUnpricedModels: true } : rest }); }} />
              <Text variant="meta" color="text/secondary">{t("Off: a run that would use a model without a known price (a local model, a custom endpoint) is not started, and its history says why. On: such models are used with nobody asked, and what they cost is not counted against the limits above.")}</Text>
            </View>
            <View style={{ gap: space[1] }}><Text variant="meta" color="text/secondary">{t("If a run is still going")}</Text><Select size="sm" label={t("If a run is still going")} disabled={disabled} value={draft.advanced.concurrency} options={(Object.keys(CONCURRENCY_LABELS) as Array<keyof typeof CONCURRENCY_LABELS>).map((value) => ({ value, label: t(CONCURRENCY_LABELS[value]) }))} onChange={(concurrency) => set({ advanced: { ...draft.advanced, concurrency } })} /></View>
            <View style={{ gap: space[1] }}><Text variant="meta" color="text/secondary">{t("Runs missed while the host was off")}</Text><Select size="sm" label={t("Runs missed while the host was off")} disabled={disabled} value={draft.advanced.catchUp} options={(Object.keys(CATCH_UP_LABELS) as Array<keyof typeof CATCH_UP_LABELS>).map((value) => ({ value, label: t(CATCH_UP_LABELS[value]) }))} onChange={(catchUp) => set({ advanced: { ...draft.advanced, catchUp } })} /></View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space[3], flexWrap: "wrap" }}>
              <Switch label={t("Stop after a number of runs")} disabled={disabled} value={draft.advanced.maxRuns !== undefined} onChange={(on) => { const { maxRuns: _maxRuns, ...rest } = draft.advanced; set({ advanced: on ? { ...rest, maxRuns: 10 } : rest }); }} />
              {draft.advanced.maxRuns !== undefined ? <NumberField label={t("Maximum runs")} size="sm" min={1} max={100_000} step={1} disabled={disabled} value={draft.advanced.maxRuns} onCommit={(maxRuns) => set({ advanced: { ...draft.advanced, maxRuns } })} /> : null}
            </View>
            <NumberField label={t("Time limit (minutes)")} size="sm" min={1} max={1440} step={1} disabled={disabled} value={draft.advanced.timeoutMinutes} onCommit={(timeoutMinutes) => set({ advanced: { ...draft.advanced, timeoutMinutes } })} />
            <View style={{ gap: space[1] }}><Text variant="meta" color="text/secondary">{t("Notify me")}</Text><Select size="sm" label={t("Notify me")} disabled={disabled} value={draft.advanced.notify} options={(Object.keys(NOTIFY_LABELS) as Array<keyof typeof NOTIFY_LABELS>).map((value) => ({ value, label: t(NOTIFY_LABELS[value]) }))} onChange={(notify) => set({ advanced: { ...draft.advanced, notify } })} /></View>
          </View>
        </Disclosure>
      </View>
      {error ? <Callout tone="danger">{error}</Callout> : null}
      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: space[2], marginTop: space[3] }}>
        <Button kind="ghost" label={t("Cancel")} testID="automation-cancel" onPress={() => (dirty ? setDiscard(true) : props.onDone(null))} />
        <Button kind="strong" label={props.record ? t("Save changes") : t("Create automation")} disabled={disabled || !valid} loading={busy} testID="automation-save" onPress={() => void save()} />
      </View>
      <ScheduleEditor open={!!schedule} onClose={() => setSchedule(null)} anchor={schedule?.id ? undefined : addRef} value={schedule?.value ?? null}
        onApply={(next) => { const target = schedule?.id; set({ triggers: target ? draft.triggers.map((entry) => (entry.id === target && entry.type === "schedule" ? { ...entry, schedule: next } : entry)) : [...draft.triggers, { id: triggerId(draft.triggers.map((entry) => entry.id)), type: "schedule", schedule: next }] }); }} />
      <ConfirmDialog open={discard} title={t("Discard changes?")} confirmLabel={t("Discard")} onClose={() => setDiscard(false)} onConfirm={() => { setDiscard(false); live.current = false; props.onDone(null); }} />
    </ScrollView>
  );
}
/** The route of a new automation. */
export function AutomationNewScreen() {
  const t = useT(), router = useRouter();
  const { host } = useHost();
  const scope = useHostScopeState(t("Automations"));
  const base = `/h/${host?.gatewayId}/automations`;
  if (scope) return <Screen title={t("Automations")}>{scope}</Screen>;
  return (
    <Screen title={t("New automation")} crumbs={[{ id: "automations", label: t("Automations"), onPress: () => router.push(base as never) }, { id: "new", label: t("New automation") }]}>
      <AutomationEditor onDone={(record) => router.replace((record ? `${base}/${record.id}` : base) as never)} />
    </Screen>
  );
}

// ── Detail ───────────────────────────────────────────────────────────────────────────────────────────────────────────

const DAY = 86_400_000;
/**
 * The runs of each day of a period as one stacked bar: succeeded in the success colour, failed in the danger colour,
 * everything else in grey. Each bar names its day and its counts, and the legend carries the meaning in words.
 */
function DayBars(props: { buckets: AutomationRun[][]; labelOf(index: number): string }) {
  const t = useT(), theme = useTheme();
  const counts = props.buckets.map((list) => ({ ok: list.filter((run) => run.status === "succeeded").length, failed: list.filter((run) => run.status === "failed").length, other: list.filter((run) => run.status !== "succeeded" && run.status !== "failed").length }));
  const high = Math.max(1, ...counts.map((day) => day.ok + day.failed + day.other));
  const HEIGHT = 96;
  if (!props.buckets.some((list) => list.length)) return <View testID="automation-chart" style={{ height: HEIGHT, alignItems: "center", justifyContent: "center", borderRadius: radius.md, borderWidth: 1, borderColor: theme.color("border/hairline") }}><Text color="text/secondary">{t("No runs yet")}</Text></View>;
  const legend = [["success", "Succeeded"], ["danger", "Failed"], ["border/control", "Other"]] as const;
  return (
    <View testID="automation-chart" role="img" accessibilityLabel={t("Runs per day")} aria-label={t("Runs per day")} style={{ gap: space[2] }}>
      <View style={{ flexDirection: "row", gap: space[3] }}>
        {legend.map(([token, label]) => <View key={label} style={{ flexDirection: "row", alignItems: "center", gap: space[1] }}><View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: theme.color(token) }} /><Text variant="meta" color="text/secondary">{label === "Succeeded" ? t("Succeeded") : label === "Failed" ? t("Failed") : t("Other")}</Text></View>)}
        <View style={{ flex: 1 }} />
        <Text variant="meta" color="text/tertiary">{`${props.labelOf(0)} – ${props.labelOf(props.buckets.length - 1)}`}</Text>
      </View>
      <View style={{ height: HEIGHT, flexDirection: "row", alignItems: "flex-end", gap: props.buckets.length > 31 ? 1 : 3, borderBottomWidth: 1, borderBottomColor: theme.color("border/hairline") }}>
        {counts.map((day, at) => {
          const title = `${props.labelOf(at)}: ${t("{ok} succeeded, {failed} failed, {other} other", { ok: day.ok, failed: day.failed, other: day.other })}`;
          return (
            <View key={at} accessibilityLabel={title} aria-label={title} {...({ title } as object)} style={{ flex: 1, height: HEIGHT, justifyContent: "flex-end" }}>
              {day.other ? <View style={{ height: (day.other / high) * HEIGHT, backgroundColor: theme.color("border/control") }} /> : null}
              {day.failed ? <View style={{ height: (day.failed / high) * HEIGHT, backgroundColor: theme.color("danger") }} /> : null}
              {day.ok ? <View style={{ height: (day.ok / high) * HEIGHT, backgroundColor: theme.color("success") }} /> : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}
/** "<n> runs · <p>% success": the rate is succeeded over succeeded plus failed. */
export function successSummary(runs: readonly Pick<AutomationRun, "status">[]): { runs: number; percent: number | null } {
  const succeeded = runs.filter((run) => run.status === "succeeded").length, failed = runs.filter((run) => run.status === "failed").length;
  return { runs: runs.length, percent: succeeded + failed ? Math.round((succeeded / (succeeded + failed)) * 100) : null };
}

/** One automation: its switch, its statistics for a period, "Trigger now", and its run history with the steps of each run. */
export function AutomationDetailScreen(props: { automationId: string }) {
  const t = useT(), theme = useTheme(), router = useRouter(), toast = useToast();
  const { host, can } = useHost();
  const scope = useHostScopeState(t("Automations"));
  const index = useWorkflowIndex();
  const calls = useWorkflowCalls();
  const [runs, setRuns] = useState<AutomationRun[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [period, setPeriod] = useState("30");
  const [status, setStatus] = useState("all");
  const [editing, setEditing] = useState(false);
  const [remove, setRemove] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [disable, setDisable] = useState(false);
  const library = useLibraryState();
  const record = (index.automations ?? []).find((entry) => entry.id === props.automationId);
  const mayWrite = can("jagentchill.projects.write"), mayRun = can("jagentchill.generation.run");
  const base = `/h/${host?.gatewayId}/automations`;
  const now = Date.now();
  useEffect(() => { let alive = true; if (!scope) void calls.automationRuns(props.automationId).then((got) => { if (alive) setRuns(got.runs); }).catch(() => { if (alive) setMissing(true); }); return () => { alive = false; }; }, [props.automationId, calls, index.automationRuns, scope]); // eslint-disable-line react-hooks/exhaustive-deps
  if (scope) return <Screen title={t("Automations")}>{scope}</Screen>;
  const crumbs = [{ id: "automations", label: t("Automations"), onPress: () => router.push(base as never) }, { id: "automation", label: record?.name ?? t("Automation") }];
  if (index.automations !== null && !record) return <Screen title={t("Automation")} crumbs={crumbs}><EmptyState icon="zap" title={t("This automation is not available")} description={missing ? t("It was deleted.") : undefined} actions={[{ label: t("All automations"), onPress: () => router.replace(base as never) }]} /></Screen>;
  if (!record) return <Screen title={t("Automation")} crumbs={crumbs}><LoadingSkeleton style={{ padding: space[5], gap: space[2] }}>{Array.from({ length: 4 }, (_, at) => <Skeleton key={at} height={40} />)}</LoadingSkeleton></Screen>;
  if (editing) return <Screen title={record.name} crumbs={[...crumbs, { id: "edit", label: t("Edit") }]}><AutomationEditor record={record} onDone={() => setEditing(false)} /></Screen>;

  const fail = (error: unknown) => toast.show({ kind: "error", message: failureOf(error).message });
  const days = Number(period);
  const inPeriod = (runs ?? []).filter((run) => run.started_ms >= now - days * DAY);
  const summary = successSummary(inPeriod);
  const buckets = Array.from({ length: days }, (_, at) => { const from = now - (days - at) * DAY; return inPeriod.filter((run) => run.started_ms >= from && run.started_ms < from + DAY); });
  const shown = (runs ?? []).filter((run) => status === "all" || run.status === status);
  const ownedByWorkflow = record.kind === "workflow-trigger" && record.origin.kind === "workflow" ? record.origin.workflowId : null;
  const activeRuns = (runs ?? []).filter((run) => ["queued", "running", "waiting"].includes(run.status)).length;
  const trigger = async () => {
    try { const made = await calls.runAutomation(record.id); if (made.run.status === "skipped") toast.show({ kind: "info", message: t("A run is already in progress") }); else toast.show({ kind: "success", message: t("Run started") }); }
    catch (error) { fail(error); }
  };
  const exportFile = () => saveBlob(`${record.name.replace(/[^\p{L}\p{N} _-]+/gu, "-") || "automation"}.json`, new Blob([JSON.stringify({ format: "jagentchill.automation", version: 1, automation: draftOf(record) }, null, 2)], { type: "application/json" }));
  const menu: MenuItem[] = [
    { id: "duplicate", label: t("Duplicate"), icon: "copy", disabled: !mayWrite || !!ownedByWorkflow, onSelect: () => void calls.duplicateAutomation(record.id).then((made) => router.push(`${base}/${made.automation.id}` as never)).catch(fail) },
    { id: "export", label: t("Export"), icon: "export", onSelect: exportFile },
    { type: "separator" },
    { id: "delete", label: t("Delete"), icon: "trash", danger: true, disabled: !mayWrite || !!ownedByWorkflow, onSelect: () => setRemove(true) },
  ];
  const paused = lastRunText(record);
  return (
    <Screen title={record.name} crumbs={crumbs} documentTitle={record.name}>
      <ScrollView testID="automation-detail" contentContainerStyle={{ flexGrow: 1, padding: theme.compact ? space[3] : space[6], gap: space[3], maxWidth: 848, width: "100%", alignSelf: "center" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
          <View style={{ flex: 1, minWidth: 200, gap: space[1] }}>
            <Text variant="h1" level={1}>{record.name}</Text>
            <Text variant="meta" color="text/secondary">{t("Created on {device} · {date}", { device: record.createdOn || t("a device"), date: new Intl.DateTimeFormat(theme.locale, { dateStyle: "medium" }).format(record.created_ms) })}</Text>
          </View>
          <View testID="automation-active" {...({ dataSet: { on: String(record.enabled) } } as object)}><Switch label={t("Active")} disabled={!mayWrite} value={record.enabled} errorMessage={(error) => failureOf(error).message || (error as Error).message}
            onChange={(enabled) => { if (!enabled && activeRuns > 0) { setDisable(true); return Promise.reject(new Error(t("Choose what happens to its runs"))); } return calls.enableAutomation(record.id, enabled); }} /></View>
          <Button size="sm" icon="play" label={t("Trigger now")} disabled={!mayWrite || !mayRun} testID="automation-trigger-now" onPress={() => void trigger()} />
          {ownedByWorkflow ? <Button size="sm" icon="flow" label={t("Open workflow")} onPress={() => router.push(`/h/${host!.gatewayId}/workflows/${ownedByWorkflow}` as never)} />
            : <Button size="sm" icon="pencil" label={t("Edit")} disabled={!mayWrite} testID="automation-edit" onPress={() => setEditing(true)} />}
          <MenuButton size="sm" kind="ghost" icon="more" label={t("More")} items={menu} />
        </View>
        {paused ? <Callout tone="warning">{record.pausedReason === "completed" ? t("Completed · {n} of {m} runs", { n: record.stats.runCount, m: record.advanced.maxRuns ?? record.stats.runCount }) : t(paused)}</Callout> : null}
        {record.warnings?.map((warning, at) => <Callout key={at} tone="warning">{warning}</Callout>)}
        <View style={{ gap: space[1] }}>
          {record.triggers.map((entry) => (entry.type === "schedule" ? <ScheduleSentence key={entry.id} schedule={entry.schedule} /> : (
            <View key={entry.id} testID={`automation-event-sentence-${entry.id}`} style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}><Icon name="zap" size={14} color="text/secondary" /><Text>{eventText(t, entry, library.projects.find((project) => project.id === entry.projectId)?.name)}</Text></View>
          )))}
          <Text variant="meta" color="text/secondary" testID="automation-next">{record.enabled && record.stats.nextRun_ms ? t("Next run {when}", { when: whenText(record.stats.nextRun_ms, firstSchedule(record.triggers)?.tzid ?? deviceZone(), theme.locale) }) : record.enabled && record.triggers.some((entry) => entry.type === "event") ? t("Runs when its event happens") : t("Next run —")}</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
          <Text variant="body-medium" style={{ flex: 1 }} testID="automation-summary">{summary.percent === null ? (summary.runs === 1 ? t("1 run") : t("{n} runs", { n: summary.runs })) : summary.runs === 1 ? t("1 run · {p}% success", { p: summary.percent }) : t("{n} runs · {p}% success", { n: summary.runs, p: summary.percent })}</Text>
          <Select size="sm" width={130} label={t("Period")} value={period} onChange={setPeriod} options={[{ value: "7", label: t("7 days") }, { value: "30", label: t("30 days") }, { value: "90", label: t("90 days") }]} />
        </View>
        <DayBars buckets={buckets} labelOf={(at) => new Intl.DateTimeFormat(theme.locale, { day: "numeric", month: "short" }).format(now - (days - at - 1) * DAY)} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
          <Text variant="title-sm" level={2} style={{ flex: 1 }}>{t("Run history")}</Text>
          <Select size="sm" width={150} label={t("Status")} value={status} onChange={setStatus} options={[{ value: "all", label: t("All statuses") }, ...Object.keys(AUTOMATION_RUN_LABELS).map((value) => ({ value, label: t(AUTOMATION_RUN_LABELS[value as keyof typeof AUTOMATION_RUN_LABELS]) }))]} />
        </View>
        <View testID="automation-runs">
          {runs === null ? <LoadingSkeleton><Skeleton height={40} /></LoadingSkeleton> : shown.length === 0 ? <Text color="text/secondary">{t("No runs yet")}</Text> : shown.slice(0, 50).map((run) => (
            <View key={run.id} testID={`automation-run-${run.number}`} {...({ dataSet: { status: run.status, trigger: run.trigger.type } } as object)} style={{ borderBottomWidth: 1, borderBottomColor: theme.color("border/hairline"), paddingVertical: space[2], gap: space[2] }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
                <IconButton icon={open === run.id ? "chev-d" : "chev-r"} size="sm" label={open === run.id ? t("Hide steps") : t("Show steps")} expanded={open === run.id} onPress={() => setOpen(open === run.id ? null : run.id)} />
                <Text variant="body-medium" tabular>{`#${run.number}`}</Text>
                <RunStatus status={run.status} label={t(AUTOMATION_RUN_LABELS[run.status])} />
                <Text variant="meta" color="text/secondary" style={{ flex: 1 }}>{[runTriggerText(t, run.trigger), relativeTime(run.started_ms, now, theme.locale), run.finished_ms ? clock(run.finished_ms - run.started_ms) : null, run.reason ? t(RUN_REASON_LABELS[run.reason] ?? run.reason) : null].filter(Boolean).join(" · ")}</Text>
                {["queued", "running", "waiting"].includes(run.status) && mayWrite ? <Button size="sm" kind="ghost" label={t("Cancel")} onPress={() => void calls.cancelAutomationRun(run.id).catch(fail)} /> : null}
              </View>
              {open === run.id ? (
                <View style={{ paddingStart: space[6], gap: space[1] }}>
                  {run.steps.map((step) => (
                    <View key={step.index} style={{ gap: space[0.5] }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
                        <Text>{`${step.index + 1}. ${t(INSTRUCTION_LABELS[step.kind] ?? step.kind)}`}</Text>
                        <Text variant="meta" color={step.status === "failed" ? "danger/text" : "text/secondary"}>{t(AUTOMATION_RUN_LABELS[step.status as keyof typeof AUTOMATION_RUN_LABELS] ?? "Queued")}</Text>
                        {step.runId ? <Button kind="link" size="sm" label={t("Open run")} onPress={() => router.push(`/h/${host!.gatewayId}/workflows/runs/${step.runId}` as never)} /> : null}
                        {step.sessionId ? <Button kind="link" size="sm" label={t("Open session")} onPress={() => router.push(`/h/${host!.gatewayId}/sessions/${encodeURIComponent(step.sessionId!)}` as never)} /> : null}
                      </View>
                      {step.error ? <Text variant="meta" color="danger/text">{`${step.error.code}: ${step.error.message}`}</Text> : null}
                    </View>
                  ))}
                  {run.warnings.map((warning, at) => <Text key={at} variant="meta" color="warning/text">{warning}</Text>)}
                </View>
              ) : null}
            </View>
          ))}
        </View>
      </ScrollView>
      <DestructiveConfirmDialog open={remove} title={t("Delete '{name}'?", { name: record.name })} description={t("Its run history is removed.")} confirmLabel={t("Delete")} onClose={() => setRemove(false)}
        onConfirm={() => { setRemove(false); void calls.removeAutomation(record.id, true).then(() => router.replace(base as never)).catch(fail); }} />
      <ConfirmDialog open={disable} title={t("Disable '{name}'?", { name: record.name })} description={t("It has runs in progress.")} confirmLabel={t("Disable and cancel runs")} onClose={() => setDisable(false)} onConfirm={() => { setDisable(false); void calls.enableAutomation(record.id, false, true).catch(fail); }}>
        <View style={{ alignItems: "flex-start" }}><Button size="sm" label={t("Disable and let them finish")} onPress={() => { setDisable(false); void calls.enableAutomation(record.id, false, false).catch(fail); }} /></View>
      </ConfirmDialog>
    </Screen>
  );
}
