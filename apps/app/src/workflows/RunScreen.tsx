import { useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { film, promptVideo, workflow as wf } from "@jagentchill/editor-core";
import type { WorkflowDocument, WorkflowExecution, WorkflowLogEntry, WorkflowNodeAggregate, WorkflowTimelineEntry } from "@jagentchill/protocol";
import { formatLogTime, formatUsd } from "@jagentchill/app-core";
import {
  BottomSheet, Button, Callout, ConfirmDialog, DestructiveConfirmDialog, EmptyState, Icon, IconButton, Input, Menu, Segmented, Select, Skeleton, Spinner, Switch, Tabs, Text, Textarea, radius, space, useInsets, useTheme, useToast, type MenuItem, SkeletonList,
} from "@jagentchill/ui";
import { usePermissionCardsOf } from "../agents/PermissionCards";
import { HandbackCard } from "../agents/team/Cards";
import { useHost } from "../host";
import { useT } from "../locale";
import { copyText } from "../platform/media";
import { useForegroundActive } from "../platform/foreground";
import { onWindowKey } from "../platform/store";
import { Screen, useHostScopeState } from "../shell/Shell";
import { screenScaffoldMetrics } from "../shell/safeArea.ts";
import { limitChanged, limitKind, parseNewLimit, raiseOnHost, stoppedBudget, type BudgetRow } from "./budgetStop";
import { Canvas, NO_SELECTION, type CanvasSelection } from "./Canvas";
import { failureOf, useRun, useWorkflowCalls, type RunData, type RunSnapshot } from "./data";
import { NODE_LABELS, NODE_STATUS_ICONS, NODE_STATUS_LABELS, NODE_STATUS_TOKENS, ORIGIN_LABELS, RUN_STATUS_LABELS, clock, preview } from "./strings";
import { isShown } from "./platform";
import { handoffAsHandback } from "./handoffCard";
import { outlineText } from "./WorkflowEditorScreen";
import { useRunStarter } from "./RunSetup";
import { EdgePanel, inlineIcon } from "@jagentchill/ui";
import { WORKFLOW_AGENT_PANEL, WorkflowAgentPanel, WorkflowAgentSlot } from "./WorkflowAgentPanel";
import { RunStatus } from "./WorkflowsScreen";

const STEPS_WIDTH = 232, DETAIL_WIDTH = 360;
const ACTIVE = new Set(["queued", "running", "paused", "waiting_approval"]);
const CANCEL_REASONS: Record<string, string> = { user: "Cancelled by a person", device_revoked: "Cancelled: the device that started it was revoked", timeout: "Cancelled: the run took too long", parent: "Cancelled with its parent run" };
const timeOf = (ms: number, locale: string): string => formatLogTime(ms, locale);
/** Money a person is asked about: to the tenth of a cent below ten cents, so a confirmed $0.015 and a new $0.018 do not both read "$0.02". */
const money = (amount: number): string => formatUsd(amount, { fine: true });

/** A value of a run: text as it is, anything else as indented JSON. */
/** A step's hand-off package is shown on the card of team hand-backs; nobody decides on it here. */
const NO_DECISION = { resolveHandback: async () => false };
function ValueView(props: { name: string; value: unknown; testID?: string }) {
  const theme = useTheme();
  const text = typeof props.value === "string" ? props.value : JSON.stringify(props.value, null, 2) ?? "";
  return (
    <View style={{ gap: space[1] }}>
      <Text variant="meta" color="text/secondary">{props.name}</Text>
      <View style={{ padding: space[2], borderRadius: radius.md, backgroundColor: theme.color("bg/subtle") }}><Text variant={typeof props.value === "string" ? "body" : "mono"} selectable testID={props.testID}>{text.length > 4000 ? `${text.slice(0, 4000)}…` : text}</Text></View>
    </View>
  );
}

/** Which limit holds a step, said in words (the host's own message is a code-like phrase, never shown). */
const LIMIT_SENTENCES: Record<string, string> = {
  host: "“{step}” is waiting: going on would spend more than the limit set for this host.",
  provider: "“{step}” is waiting: going on would spend more than the limit set for the provider {id}.",
  project: "“{step}” is waiting: going on would spend more than the limit set for this project.",
  run: "“{step}” is waiting: going on would spend more than the limit set for this run.",
  session: "“{step}” is waiting: going on would spend more than the limit set for this chat session.",
  unknown: "“{step}” is waiting: going on would spend more than a spending limit allows.",
  unpriced: "“{step}” is waiting: it uses a model whose price is not known, and this spending limit only allows models with a known price.",
};
/** The sentence for a step a spending limit holds. */
function limitSentence(t: ReturnType<typeof useT>, stepName: string, details: unknown, runId: string): string {
  const stopped = stoppedBudget(details, runId, null);
  return t(LIMIT_SENTENCES[stopped?.unpriced ? "unpriced" : limitKind(stopped)], { step: stepName, id: stopped?.scopeId ?? "" });
}
/**
 * A run a hard-stop budget paused. The refusal names the budget by scope and id: an admin device raises THAT limit here
 * (the amount is the person's — nothing is proposed), or removes the run's own budget, and the run goes on by itself;
 * any other device is told to ask an admin device. The limit is read again at the moment of applying and while the
 * block is shown: this action never lowers a limit someone else raised meanwhile, and a limit raised somewhere else
 * shows as the one way on ("Continue the run"). No hard stop can be passed any other way.
 */
function BudgetStop(props: { runId: string; stepName: string; error: WorkflowExecution["error"]; mayRaise: boolean; mayRun: boolean; run: RunData }) {
  const t = useT(), toast = useToast();
  const { connection } = useHost();
  const foreground = useForegroundActive();
  const [budgets, setBudgets] = useState<BudgetRow[] | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState<"raise" | "remove" | "continue" | null>(null);
  /** The limit someone else set while this block was open, met when "Raise budget" was pressed with a lower amount. */
  const [changedTo, setChangedTo] = useState<number | null>(null);
  useEffect(() => {
    if (!foreground) return;
    let alive = true;
    const read = () => void connection?.call<{ budgets: BudgetRow[] }>("jagentchill.provider.budget.list", {}).then((listed) => { if (alive) setBudgets(listed.budgets); }, () => undefined);
    read();
    // Another admin, or Settings on this device, can change the limit while the run waits here.
    const timer = setInterval(read, 5000);
    return () => { alive = false; clearInterval(timer); };
  }, [connection, foreground]);
  const stopped = stoppedBudget(props.error?.details, props.runId, budgets), budget = stopped?.budget;
  const refusedAt = (props.error?.details as { limitUsd?: unknown } | undefined)?.limitUsd;
  // A refusal that does not name the limit it met: the limit this block first saw stands in for it.
  const firstSeen = useRef<number | undefined>(undefined);
  if (firstSeen.current === undefined && budget) firstSeen.current = budget.limitUsd;
  const changed = limitChanged(stopped, typeof refusedAt === "number" ? refusedAt : firstSeen.current, budgets !== null);
  const next = budget ? parseNewLimit(typed, budget.limitUsd) : null;
  const resume = async () => { const resumed = await props.run.act("jagentchill.workflow.run.resume"); if (!resumed.ok) toast.show({ kind: "error", message: resumed.message }); };
  const act = async (kind: "raise" | "remove" | "continue") => {
    if (!connection || !stopped || busy || (kind === "raise" && !next?.ok)) return;
    setBusy(kind);
    try {
      if (kind === "raise" && next?.ok) {
        // The host decides against the limit it holds at that moment: this action only ever raises.
        const done = await raiseOnHost((method, params) => connection.call(method, params), stopped, next.limitUsd);
        void connection.call<{ budgets: BudgetRow[] }>("jagentchill.provider.budget.list", {}).then((listed) => setBudgets(listed.budgets), () => undefined);
        if (done.kind === "not_higher") { setChangedTo(done.current.limitUsd); setBusy(null); return; }
      } else if (kind === "remove" && budget) await connection.call("jagentchill.provider.budget.remove", { scope: budget.scope, ...(budget.scopeId ? { scopeId: budget.scopeId } : {}) });
      setChangedTo(null);
      // The limit that held the step is no longer in its way: the run goes on (and stops again if another limit is).
      await resume();
    } catch (error) { toast.show({ kind: "error", message: failureOf(error).message }); }
    setBusy(null);
  };
  return (
    <View testID="run-budget-stop" {...({ dataSet: { scope: stopped?.scope ?? "", budget: stopped?.scopeId ?? "", unpriced: String(!!stopped?.unpriced), own: String(!!stopped?.ownRun), limit: budget ? String(budget.limitUsd) : "", changed: String(changed) } } as object)} style={{ gap: space[2] }}>
      <Callout tone="warning" title={t("Spending limit reached")}>{[
        limitSentence(t, props.stepName, props.error?.details, props.runId),
        budget ? t("{spent} has been spent. The limit is {limit}.", { spent: money(budget.spentUsd ?? 0), limit: money(budget.limitUsd) }) : "",
        stopped?.unpriced ? "" : changed ? t("The limit was changed after this step stopped. You can continue the run.") : t("What was already made is kept. Nothing more is spent until the limit is raised; the run then continues by itself."),
      ].filter(Boolean).join("\n")}</Callout>
      {changedTo !== null ? <Text variant="meta" color="text/secondary" testID="run-budget-changed">{t("Someone changed this limit to {limit} while this screen was open, so nothing was changed. Type an amount above {limit}, or continue the run with the limit as it is.", { limit: money(changedTo) })}</Text> : null}
      <View style={{ flexDirection: "row", alignItems: "flex-start", flexWrap: "wrap", gap: space[2] }}>
        {changed && props.mayRun ? <Button size="sm" kind="primary" icon="play" label={t("Continue the run")} testID="run-budget-continue" disabled={busy !== null} loading={busy === "continue"} onPress={() => void act("continue")} /> : null}
        {!props.mayRaise ? <Text variant="meta" color="text/secondary" testID="run-budget-ask-admin">{changed ? "" : t("Ask an admin device")}</Text> : budget && !stopped?.unpriced ? (<>
          <View style={{ width: 200 }}>
            <Input size="sm" value={typed} onChangeText={(text) => { setTyped(text); setChangedTo(null); }} inputMode="decimal" prefix="$" accessibilityLabel={t("New limit (USD)")} aria-label={t("New limit (USD)")} placeholder={t("New limit (USD)")} testID="run-budget-limit" invalid={!!typed.trim() && !next?.ok}
              error={typed.trim() && next && !next.ok ? (next.reason === "range" ? t("Budget must be between $0.01 and $100,000.") : t("Enter an amount above {limit}", { limit: money(budget.limitUsd) })) : undefined} onSubmitEditing={() => void act("raise")} />
          </View>
          <Button size="sm" kind={changed ? "secondary" : "primary"} label={t("Raise budget")} testID="run-budget-raise" disabled={!next?.ok || busy !== null} loading={busy === "raise"} onPress={() => void act("raise")} />
          {stopped?.ownRun ? <Button size="sm" label={t("Remove the run budget")} testID="run-budget-remove" disabled={busy !== null} loading={busy === "remove"} onPress={() => void act("remove")} /> : null}
        </>) : null}
      </View>
    </View>
  );
}

/** One step waiting for a person: an approval with its subject, or a form. Answered in place. */
function Waiting(props: { exec: WorkflowExecution; name: string; run: RunData; mayAnswer: boolean }) {
  const t = useT(), toast = useToast();
  const request = (props.exec.request ?? {}) as { kind?: string; title?: string; instructions?: string; subject?: unknown; allowEdit?: boolean; fields?: Array<{ id: string; label: string; type: string; required?: boolean; options?: string[] }>; submitLabel?: string };
  const [notes, setNotes] = useState("");
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [subject, setSubject] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const answer = async (params: Record<string, unknown>) => {
    setBusy(true);
    setError(undefined);
    const result = await props.run.act("jagentchill.workflow.node.resolve", { nodeId: props.exec.nodeId, path: props.exec.path, ...params });
    setBusy(false);
    if (!result.ok) { setError(result.message); toast.show({ kind: "error", message: result.message }); }
  };
  const editable = request.allowEdit !== false && typeof request.subject === "string";
  const edited = subject !== null && subject !== request.subject ? { subject } : {};
  return (
    <View testID={`needs-${props.exec.nodeId}`} {...({ dataSet: { kind: request.kind ?? "" } } as object)} style={{ gap: space[2], paddingVertical: space[3] }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}><Icon name="hand" size={14} color="warning/text" /><Text variant="body-medium" style={{ flex: 1 }}>{request.title || props.name}</Text><Text variant="meta" color="text/secondary">{props.name}</Text></View>
      {request.instructions ? <Text color="text/secondary">{request.instructions}</Text> : null}
      {request.kind === "input" ? (
        <>
          {(request.fields ?? []).map((field) => (
            <View key={field.id} style={{ gap: space[1] }}>
              <Text variant="meta" color="text/secondary">{field.required ? `${field.label} *` : field.label}</Text>
              {field.type === "boolean" ? <Switch accessibilityLabel={field.label} disabled={!props.mayAnswer} value={values[field.id] === true} onChange={(on) => setValues({ ...values, [field.id]: on })} />
                : field.type === "select" ? <Select label={field.label} disabled={!props.mayAnswer} placeholder={t("Choose")} value={typeof values[field.id] === "string" ? String(values[field.id]) : null} options={(field.options ?? []).map((value) => ({ value, label: value }))} onChange={(value) => setValues({ ...values, [field.id]: value })} />
                : field.type === "multi_select" ? <View style={{ gap: space[1] }}>{(field.options ?? []).map((option) => { const list = Array.isArray(values[field.id]) ? (values[field.id] as string[]) : []; return <Switch key={option} label={option} disabled={!props.mayAnswer} value={list.includes(option)} onChange={(on) => setValues({ ...values, [field.id]: on ? [...list, option] : list.filter((entry) => entry !== option) })} />; })}</View>
                : field.type === "long_text" ? <Textarea testID={`needs-field-${field.id}`} disabled={!props.mayAnswer} value={String(values[field.id] ?? "")} onChangeText={(text) => setValues({ ...values, [field.id]: text })} />
                : <Input testID={`needs-field-${field.id}`} disabled={!props.mayAnswer} value={String(values[field.id] ?? "")} placeholder={field.type === "date" ? "2026-01-31" : undefined} onChangeText={(text) => setValues({ ...values, [field.id]: field.type === "number" && text.trim() !== "" && Number.isFinite(Number(text)) ? Number(text) : text })} />}
            </View>
          ))}
          {error ? <Text variant="meta" color="danger/text" role="alert">{error}</Text> : null}
          {props.mayAnswer ? <View style={{ alignItems: "flex-start" }}><Button kind="primary" label={request.submitLabel || t("Continue")} loading={busy} testID={`needs-submit-${props.exec.nodeId}`} onPress={() => void answer({ values })} /></View> : null}
        </>
      ) : (
        <>
          {editable && props.mayAnswer ? <Textarea value={subject ?? String(request.subject)} onChangeText={setSubject} accessibilityLabel={t("Value to approve")} aria-label={t("Value to approve")} testID={`needs-subject-${props.exec.nodeId}`} maxLines={10} />
            : request.subject !== null && request.subject !== undefined ? <ValueView name={t("Value to approve")} value={request.subject} /> : null}
          {props.mayAnswer ? (
            <>
              <Input value={notes} onChangeText={setNotes} placeholder={t("Notes (needed to ask for changes)")} accessibilityLabel={t("Notes")} aria-label={t("Notes")} testID={`needs-notes-${props.exec.nodeId}`} />
              {error ? <Text variant="meta" color="danger/text" role="alert">{error}</Text> : null}
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
                <Button kind="primary" icon="check" label={t("Approve")} loading={busy} testID={`needs-approve-${props.exec.nodeId}`} onPress={() => void answer({ outcome: "approved", ...edited, ...(notes.trim() ? { notes } : {}) })} />
                <Button label={t("Request changes")} disabled={busy || !notes.trim()} testID={`needs-changes-${props.exec.nodeId}`} onPress={() => void answer({ outcome: "changes_requested", notes })} />
                <Button kind="ghost" tone="danger" label={t("Reject")} disabled={busy} testID={`needs-reject-${props.exec.nodeId}`} onPress={() => void answer({ outcome: "rejected", ...(notes.trim() ? { notes } : {}) })} />
              </View>
            </>
          ) : <Text variant="meta" color="text/secondary">{t("Your role on this host does not allow this")}</Text>}
        </>
      )}
    </View>
  );
}

/** The detail of the selected step: what went in, what came out, its log, and the actions its status allows. */
function NodeDetail(props: { snapshot: RunSnapshot; nodeId: string; run: RunData; mayRun: boolean; now: number; onClose(): void; onNeeds(): void }) {
  const t = useT(), theme = useTheme(), toast = useToast(), router = useRouter();
  const { host } = useHost();
  const node = props.snapshot.document.nodes.find((entry) => entry.id === props.nodeId);
  const aggregate = props.snapshot.nodes.find((entry) => entry.nodeId === props.nodeId);
  const [tab, setTab] = useState("outputs");
  const [executions, setExecutions] = useState<WorkflowExecution[] | null>(null);
  const [logs, setLogs] = useState<WorkflowLogEntry[]>([]);
  const [path, setPath] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"skip" | "cancel" | null>(null);
  useEffect(() => { setExecutions(null); setPath(null); }, [props.nodeId]);
  useEffect(() => {
    let alive = true;
    void props.run.executions(props.nodeId).then((list) => { if (alive) setExecutions(list); }).catch(() => undefined);
    void props.run.logs({ nodeId: props.nodeId }).then((list) => { if (alive) setLogs(list); }).catch(() => undefined);
    return () => { alive = false; };
  }, [props.nodeId, props.run.version]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!node) return null;
  const exec = executions?.find((entry) => entry.path === (path ?? aggregate?.latest.path ?? "")) ?? executions?.at(-1);
  const status = exec?.status ?? aggregate?.status ?? "pending";
  const act = async (action: "retry" | "skip" | "cancel") => { const result = await props.run.act(`jagentchill.workflow.node.${action}`, { nodeId: node.id, path: exec?.path ?? "" }); if (!result.ok) toast.show({ kind: "error", message: result.message }); };
  const entries = (record?: Record<string, unknown>) => Object.entries(record ?? {}).filter(([, value]) => value !== undefined);
  const elapsed = exec?.started_ms ? (exec.finished_ms ?? props.now) - exec.started_ms : null;
  // The package between agent steps (`Hand-off package between agents`): what this step was handed, and what it hands on.
  const handed = wf.handoffOf(exec?.outputs?.handoff), received = wf.handoffsOf(exec?.inputs?.handoff);
  const doc = props.snapshot.document;
  const stepName = (nodeId: string): string => doc.nodes.find((entry) => entry.id === nodeId)?.name ?? nodeId;
  const consumers = doc.edges.filter((edge) => edge.from.node === node.id && edge.from.port === "handoff").map((edge) => stepName(edge.to.node));
  // (It has its own tab: it is not listed again as raw data under Inputs and Outputs.)
  const shown = (which: string) => entries(which === "inputs" ? exec?.inputs : exec?.outputs).filter(([name]) => name !== "handoff");
  return (
    <View testID="run-node-detail" {...({ dataSet: { node: node.id, status } } as object)} style={{ flex: 1, minHeight: 0 }}>
      <View style={{ padding: space[4], paddingBottom: space[2], gap: space[2] }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
          <Text variant="title-sm" level={2} numberOfLines={1} style={{ flex: 1 }}>{node.name}</Text>
          <IconButton icon="x" size="sm" label={t("Close details")} onPress={props.onClose} />
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space[2] }}>
          <RunStatus status={status} label={t(NODE_STATUS_LABELS[status])} />
          <Text variant="meta" color="text/secondary">{[t(NODE_LABELS[node.type]), exec ? t("Attempt {n}", { n: exec.attempt }) : null, elapsed !== null ? clock(elapsed) : null].filter(Boolean).join(" · ")}</Text>
        </View>
        {executions && executions.length > 1 ? <Select size="sm" label={t("Execution")} value={exec?.path ?? ""} onChange={setPath} options={executions.map((entry) => ({ value: entry.path, label: entry.path ? `${entry.path} · ${t(NODE_STATUS_LABELS[entry.status])}` : t(NODE_STATUS_LABELS[entry.status]) }))} /> : null}
        {exec?.error ? <Callout tone={exec.blockedBy === "budget_exceeded" ? "warning" : "danger"} title={exec.blockedBy === "budget_exceeded" ? t("Spending limit reached") : exec.error.code}>{exec.blockedBy === "budget_exceeded" && stoppedBudget(exec.error.details, props.snapshot.run.id, null) ? limitSentence(t, node.name, exec.error.details, props.snapshot.run.id) : exec.error.message}</Callout> : null}
        {exec?.blockedBy && exec.blockedBy !== "budget_exceeded" ? <Text variant="meta" color="text/secondary">{t("Waiting: {reason}", { reason: exec.blockedBy })}</Text> : null}
      </View>
      <View style={{ paddingHorizontal: space[4] }}><Tabs id="run-node" label={t("Step details")} size="sm" items={[{ id: "inputs", label: t("Inputs") }, { id: "outputs", label: t("Outputs") }, ...(node.type === "agent" || received.length ? [{ id: "handoff", label: t("Hand-off") }] : []), { id: "logs", label: t("Logs") }]} value={tab} onChange={setTab} /></View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: space[4], gap: space[3] }}>
        {executions === null ? <SkeletonList rows={3} />
          : tab === "handoff" ? (handed || received.length ? (
            <View testID="run-handoff" {...({ dataSet: { synthesised: String(!!handed?.synthesised), received: String(received.length) } } as object)} style={{ gap: space[3] }}>
              {received.map((pkg, at) => (
                <View key={`in-${at}`} testID="run-handoff-received" style={{ gap: space[1] }}>
                  <Text variant="meta" color="text/secondary">{t("Received from “{step}”", { step: stepName(pkg.from.nodeId) })}</Text>
                  <HandbackCard handback={handoffAsHandback(pkg, { from: stepName(pkg.from.nodeId), to: node.name }, `${node.id}-in-${at}`, t("kept with the run"))} mayAct={false} api={NO_DECISION} title={t("Hand-off")} hidePill />
                </View>
              ))}
              {handed ? (
                <View testID="run-handoff-made" style={{ gap: space[1] }}>
                  <Text variant="meta" color="text/secondary">{consumers.length ? t("Handed on to {steps}", { steps: consumers.map((name) => `“${name}”`).join(", ") }) : t("What this step hands on. No step is connected to it.")}</Text>
                  {handed.synthesised ? <Text variant="meta" color="text/secondary" testID="run-handoff-synthesised">{t("The agent wrote no hand-off of its own, so the workflow put this one together from the step's result.")}</Text> : null}
                  <HandbackCard handback={handoffAsHandback(handed, { from: node.name, to: consumers.join(", ") || t("the next step") }, `${node.id}-out`, t("kept with the run"))} mayAct={false} api={NO_DECISION} title={t("Hand-off")} hidePill />
                </View>
              ) : null}
            </View>
          ) : <Text color="text/secondary">{t("Nothing here yet")}</Text>)
          : tab === "logs" ? (logs.length ? logs.map((entry) => <Text key={entry.seq} variant="mono" color={entry.level === "error" ? "danger/text" : entry.level === "warn" ? "warning/text" : "text/primary"} selectable>{`${timeOf(entry.ts_ms, theme.locale)}  ${entry.message}`}</Text>) : <Text color="text/secondary">{t("Nothing here yet")}</Text>)
          : shown(tab).length ? shown(tab).map(([name, value]) => <ValueView key={name} name={name} value={value} testID={`run-${tab}-${name}`} />)
          : <Text color="text/secondary">{t("Nothing here yet")}</Text>}
      </ScrollView>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2], padding: space[3], borderTopWidth: 1, borderTopColor: theme.color("border/hairline") }}>
        {exec?.sessionKey ? <Button size="sm" icon="chat" label={t("Open session")} testID="run-open-session" onPress={() => router.push(`/h/${host!.gatewayId}/sessions/${encodeURIComponent(exec.sessionKey!)}` as never)} /> : null}
        {status === "waiting_approval" ? <Button size="sm" kind="primary" icon="hand" label={t("Answer")} testID="run-answer" onPress={props.onNeeds} /> : null}
        {props.mayRun && status === "failed" ? <><Button size="sm" icon="refresh" label={t("Retry")} testID="run-retry" onPress={() => void act("retry")} /><Button size="sm" kind="ghost" label={t("Skip")} testID="run-skip" onPress={() => setConfirm("skip")} /></> : null}
        {props.mayRun && (status === "running" || status === "waiting_approval") ? <Button size="sm" kind="ghost" tone="danger" label={t("Cancel step")} testID="run-cancel-step" onPress={() => setConfirm("cancel")} /> : null}
        <Button size="sm" kind="ghost" icon="copy" label={t("Copy log")} disabled={!logs.length} onPress={() => void copyText(logs.map((entry) => `${new Date(entry.ts_ms).toISOString()} ${entry.level} ${entry.message}`).join("\n"))} />
      </View>
      <ConfirmDialog open={confirm !== null} title={confirm === "skip" ? t("Skip this step?") : t("Cancel this step?")} description={confirm === "skip" ? t("The run goes on without its output.") : t("The step stops; the run fails unless the step has an error route.")} confirmLabel={confirm === "skip" ? t("Skip") : t("Cancel step")} onClose={() => setConfirm(null)}
        onConfirm={() => { const action = confirm; setConfirm(null); if (action) void act(action); }} />
    </View>
  );
}

/** A change of the run as one readable line of the activity feed. */
function activityLine(t: ReturnType<typeof useT>, entry: WorkflowTimelineEntry, name: (nodeId: string) => string): string | null {
  const change = entry.change;
  if (change.kind === "run.status") return t("Run: {status}", { status: t(RUN_STATUS_LABELS[change.status]) });
  if (change.kind === "node.status") return `${name(change.nodeId)}${change.path ? ` (${change.path})` : ""}: ${t(NODE_STATUS_LABELS[change.status])}${change.error ? ` — ${change.error.message}` : ""}`;
  if (change.kind === "log.marker") return `${name(change.nodeId)}: ${change.message}`;
  if (change.kind === "user.action") return t("A person: {action}", { action: `${change.action}${change.nodeId ? ` · ${name(change.nodeId)}` : ""}` });
  return null;
}

/**
 * The viewport a run opens in on a phone: the graph is read from its trigger, so the first two columns of steps are
 * framed whole (at least two full cards on screen) instead of one and a bit.
 */
function phoneView(doc: WorkflowDocument, size: { width: number; height: number }): wf.Viewport {
  const margin = 16;
  const boxes = doc.nodes.map((node) => wf.nodeBox(node)).sort((a, b) => a.x - b.x);
  if (!boxes.length || size.width <= 0 || size.height <= 0) return wf.openView(doc, size, margin, wf.READABLE_ZOOM);
  const first = boxes[0]!, next = boxes.find((box) => box.x > first.x + 1);
  const span = (next ? next.x + next.width : first.x + first.width) - first.x;
  const zoom = Math.max(wf.ZOOM.min, Math.floor(Math.min(1, (size.width - margin * 2) / span) * 100) / 100);
  const bounds = wf.contentBounds(doc) ?? first;
  const tall = bounds.height * zoom > size.height - margin * 2;
  return { zoom, x: margin - first.x * zoom, y: tall ? margin - bounds.y * zoom : (size.height - bounds.height * zoom) / 2 - bounds.y * zoom };
}

/**
 * The run view: the header with the run's status and controls, the step list, the live diagram with the detail of the
 * selected step, and the tabs "Needs you", "Outputs", "Activity" and "Log". It follows the run's stream, so a change
 * on the host is on screen within the moment it is announced.
 */
export function RunScreen(props: { runId: string; node?: string }) {
  const t = useT(), theme = useTheme(), router = useRouter(), toast = useToast();
  const insets = useInsets();
  const safe = screenScaffoldMetrics(insets, theme.compact, 0);
  const { host, can, status: link, connection } = useHost();
  const scope = useHostScopeState(t("Workflows"));
  const run = useRun(scope ? null : props.runId);
  const calls = useWorkflowCalls();
  const [selection, setSelection] = useState<CanvasSelection>(props.node ? { nodeIds: [props.node], edgeIds: [], noteIds: [] } : NO_SELECTION);
  const [view, setView] = useState<wf.Viewport>({ x: 0, y: 0, zoom: 1 });
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [fitted, setFitted] = useState(false);
  const [tab, setTab] = useState("diagram");
  const [pane, setPane] = useState<"canvas" | "steps" | "needs" | "outputs">("canvas");
  const [now, setNow] = useState(Date.now());
  const [menu, setMenu] = useState(false);
  const [confirm, setConfirm] = useState<"cancel" | "delete" | null>(null);
  // "Run again": the same start as everywhere — the run's one money question first, when it has one.
  const starter = useRunStarter({ onStarted: (made) => router.push(`/h/${host?.gatewayId}/workflows/runs/${made.id}` as never), onError: (error) => toast.show({ kind: "error", message: failureOf(error).message }) });
  const [agent, setAgent] = useState(false);
  const [width, setWidth] = useState(0);
  const [feed, setFeed] = useState<{ timeline: WorkflowTimelineEntry[]; logs: WorkflowLogEntry[] }>({ timeline: [], logs: [] });
  const menuRef = useRef<View>(null), rootRef = useRef<View>(null);
  const snapshot = run.snapshot;
  const record = snapshot?.run;
  const active = !!record && ACTIVE.has(record.status);
  const mayRun = can("jagentchill.generation.run");
  // A run a budget paused: the step it holds carries the refusal. The confirmed-estimate guard comes with the new
  // figure, and the one way on is to confirm that amount; a hard-stop budget is raised by an admin, then the run resumes.
  const heldStep = record?.status === "paused" && record.pauseReason === "budget_exceeded" ? snapshot?.held?.[0] : undefined;
  const over = heldStep?.error?.details as { scope?: string; scopeId?: string | null; filmId?: string; confirmedUsd?: number | null; spentUsd?: number; estimate?: { amountUsd?: number | null; unpricedModels?: string[] } } | undefined;
  const estimate = heldStep && over?.scope === "confirmed_estimate" && typeof over.estimate?.amountUsd === "number" ? { totalUsd: over.estimate.amountUsd, confirmedUsd: over.confirmedUsd ?? 0, spentUsd: over.spentUsd ?? 0, filmId: over.filmId } : null;
  // The same stop for a model whose price is not known: there is no amount to confirm — the person allows the model by its name.
  const unpricedStop = heldStep && over?.scope === "confirmed_estimate" && !estimate && over.estimate?.unpricedModels?.length ? over.estimate.unpricedModels : null;
  // The runs of the two built-in templates confirm through their own services; every other run through the workflow service.
  const ownRun = !!record && record.workflowId !== promptVideo.TEMPLATE_ID && record.workflowId !== film.FILM_TEMPLATE_ID;
  const [budgetBusy, setBudgetBusy] = useState(false);
  // What the sessions of the steps ask a person (a tool permission): answered here, on the same card as in the chat.
  const stepSessions = snapshot?.sessions ?? [];
  const permissions = usePermissionCardsOf(stepSessions.map((entry) => entry.sessionKey));
  const asking = permissions.filter((card) => card.pending).length;
  const live = useRef({ record, mayRun, run, confirm, estimate });
  live.current = { record, mayRun, run, confirm, estimate };

  const foreground = useForegroundActive();
  useEffect(() => { if (!active || link !== "connected" || !foreground) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [active, link, foreground]);
  useEffect(() => { if (!fitted && snapshot && size.width > 0) { setView(theme.compact ? phoneView(snapshot.document, size) : wf.openView(snapshot.document, size, 32, wf.SMALL_GRAPH_ZOOM)); setFitted(true); } }, [snapshot, size, fitted]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (tab !== "activity" && tab !== "log") return;
    let alive = true;
    void Promise.all([run.timeline(), run.logs()]).then(([timeline, logs]) => { if (alive) setFeed({ timeline, logs }); }).catch(() => undefined);
    return () => { alive = false; };
  }, [tab, run.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (method: string) => { const result = await live.current.run.act(method); if (!result.ok) toast.show({ kind: "error", message: result.message }); };
  // Space pauses and resumes; Escape closes an open confirmation without acting.
  useEffect(() => onWindowKey((event) => {
    const current = live.current;
    if (event.inField || !current.record || !current.mayRun || !isShown(rootRef.current)) return;
    if (event.key === " " && !current.confirm) { if (current.record.status === "running") { event.preventDefault(); void act("jagentchill.workflow.run.pause"); } else if (current.record.status === "paused" && current.record.pauseReason !== "budget_exceeded") { event.preventDefault(); void act("jagentchill.workflow.run.resume"); } }
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  const overlay = useMemo(() => (snapshot ? { nodes: Object.fromEntries(snapshot.nodes.map((entry) => [entry.nodeId, entry])) as Record<string, WorkflowNodeAggregate>, edges: snapshot.edges, now } : undefined), [snapshot, now]);
  const base = `/h/${host?.gatewayId}/workflows`;
  if (scope) return <Screen title={t("Workflows")}>{scope}</Screen>;
  const crumbs = [{ id: "workflows", label: t("Workflows"), onPress: () => router.push(`${base}?tab=runs` as never) }, { id: "run", label: record ? `${record.workflowName} #${record.number}` : t("Run") }];
  if (run.error && !snapshot) return <Screen title={t("Run")} crumbs={crumbs}><EmptyState icon="warn" title={t("Unable to load run")} description={failureOf(run.error).message} actions={[{ label: t("Retry"), onPress: run.reload }, { label: t("All runs"), onPress: () => router.replace(`${base}?tab=runs` as never) }]} /></Screen>;
  if (!snapshot || !record) return <Screen title={t("Run")} crumbs={crumbs}><View style={{ padding: space[5], gap: space[2] }}>{Array.from({ length: 5 }, (_, at) => <Skeleton key={at} height={40} />)}</View></Screen>;

  const doc = snapshot.document;
  const nameOf = (nodeId: string) => doc.nodes.find((node) => node.id === nodeId)?.name ?? nodeId;
  const steps = [...snapshot.nodes].sort((a, b) => (a.latest.started_ms ?? Number.MAX_SAFE_INTEGER) - (b.latest.started_ms ?? Number.MAX_SAFE_INTEGER));
  const done = steps.filter((step) => step.status === "succeeded" || step.status === "skipped").length;
  const elapsed = record.started_ms ? (record.finished_ms ?? now) - record.started_ms : 0;
  const selected = selection.nodeIds.length === 1 ? selection.nodeIds[0] : null;
  const compact = theme.compact;
  const banner = link !== "connected" ? { tone: "warning" as const, text: t("Reconnecting… showing last known state") }
    : heldStep ? null
    : record.status === "paused" ? { tone: "info" as const, text: t("Paused") }
    : record.status === "waiting_approval" || asking ? { tone: "warning" as const, text: t("Waiting for you") }
    : record.status === "queued" ? { tone: "info" as const, text: t("Waiting for a free slot") }
    : record.status === "cancelled" ? { tone: "info" as const, text: t(CANCEL_REASONS[record.cancelReason ?? "user"] ?? "Cancelled by a person") }
    : record.status === "failed" && record.error ? { tone: "danger" as const, text: `${record.failedNodeId ? `${nameOf(record.failedNodeId)}: ` : ""}${record.error.message}` } : null;
  const select = (nodeId: string | null) => setSelection(nodeId ? { nodeIds: [nodeId], edgeIds: [], noteIds: [] } : NO_SELECTION);
  const openNeeds = () => { setTab("needs"); setPane("needs"); };
  const confirmBudget = async () => {
    if (!estimate || budgetBusy) return;
    setBudgetBusy(true);
    // One action: the host takes the new amount and lets the paused run go on by itself.
    let refusal: string | undefined;
    if (estimate.filmId) {
      try { if (!connection) throw { code: "UNAVAILABLE" }; await connection.call("jagentchill.film.pipeline.confirm", { filmId: estimate.filmId, confirmedUsd: estimate.totalUsd }); run.reload(); } catch (error) { refusal = failureOf(error).message; }
    } else { const result = await run.act(ownRun ? "jagentchill.workflow.run.confirm" : "jagentchill.workflow.video.confirm", { confirmedUsd: estimate.totalUsd }); if (!result.ok) refusal = result.message; }
    setBudgetBusy(false);
    if (refusal) toast.show({ kind: "error", message: refusal });
  };
  const allowModels = async () => {
    if (!unpricedStop || budgetBusy) return;
    setBudgetBusy(true);
    const result = await run.act(ownRun ? "jagentchill.workflow.run.confirm" : "jagentchill.workflow.video.confirm", { allowUnpriced: unpricedStop });
    setBudgetBusy(false);
    if (!result.ok) toast.show({ kind: "error", message: result.message });
  };
  const mayRaise = can("jagentchill.config.write");
  const budgetAsk = heldStep ? (
    <View testID="run-budget" {...({ dataSet: { scope: over?.scope ?? "", node: heldStep.nodeId, total: estimate ? String(estimate.totalUsd) : "", confirmed: estimate ? String(estimate.confirmedUsd) : "" } } as object)} style={{ paddingHorizontal: space[3], paddingTop: space[2], gap: space[2] }}>
      {estimate ? (
        <Callout tone="warning" title={t("This run would cost more than you confirmed")}>{`${nameOf(heldStep.nodeId)}: ${t("It has cost {spent} so far and would pass the {confirmed} you confirmed. It now comes to about {total}.", { spent: money(estimate.spentUsd), confirmed: money(estimate.confirmedUsd), total: money(estimate.totalUsd) })}\n${t("What was already made is kept. Nothing more is spent until you confirm.")}`}</Callout>
      ) : null}
      {estimate ? (
        <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space[2] }}>
          {mayRun ? <Button size="sm" kind="primary" icon="check-c" label={t("Confirm {amount} and continue", { amount: money(estimate.totalUsd) })} testID="run-budget-confirm" loading={budgetBusy} onPress={() => void confirmBudget()} /> : <Text variant="meta" color="text/secondary">{t("Your role on this host does not allow this")}</Text>}
        </View>
      ) : unpricedStop ? (
        <View testID="run-budget-unpriced" {...({ dataSet: { models: unpricedStop.join(",") } } as object)} style={{ gap: space[2] }}>
          <Callout tone="warning" title={t("This step uses a model without a known price")}>{`${t("“{step}” would use {model}. Its price is not known, so what it costs cannot be shown first.", { step: nameOf(heldStep.nodeId), model: unpricedStop.join(", ") })}\n${t("What was already made is kept. Nothing is sent to it until you allow it.")}`}</Callout>
          <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space[2] }}>
            {mayRun ? <Button size="sm" kind="primary" icon="check-c" label={t("Allow {model} and continue", { model: unpricedStop.join(", ") })} testID="run-budget-allow" loading={budgetBusy} onPress={() => void allowModels()} /> : <Text variant="meta" color="text/secondary">{t("Your role on this host does not allow this")}</Text>}
          </View>
        </View>
      ) : <BudgetStop key={`${over?.scope ?? ""}:${over?.scopeId ?? ""}`} runId={record.id} stepName={nameOf(heldStep.nodeId)} error={heldStep.error} mayRaise={mayRaise} mayRun={mayRun} run={run} />}
    </View>
  ) : null;
  const overflow: MenuItem[] = [
    { id: "workflow", label: t("Open workflow"), icon: "flow", disabled: !snapshot.workflowExists, onSelect: () => router.push(`${base}/${record.workflowId}` as never) },
    { id: "again", label: t("Run again"), icon: "refresh", disabled: !mayRun || !snapshot.workflowExists, onSelect: () => void starter.begin({ id: record.workflowId, name: record.workflowName, parameters: [] }, record.params) },
    { type: "separator" },
    { id: "delete", label: t("Delete"), icon: "trash", danger: true, disabled: !mayRun || active, onSelect: () => setConfirm("delete") },
  ];

  const stepList = (
    <ScrollView testID="run-steps" style={compact ? { flex: 1 } : { width: STEPS_WIDTH, flexGrow: 0, borderEndWidth: 1, borderEndColor: theme.color("border/hairline") }} contentContainerStyle={{ padding: space[2] }}>
      <Text variant="meta" color="text/secondary" style={{ padding: space[2] }} testID="run-steps-count">{t("Steps · {done} of {total} done", { done, total: steps.length })}</Text>
      {steps.map((step) => {
        const duration = step.latest.started_ms ? clock((step.latest.finished_ms ?? now) - step.latest.started_ms) : "";
        const label = `${nameOf(step.nodeId)}, ${t(NODE_STATUS_LABELS[step.status])}`;
        return (
          <View key={step.nodeId} testID={`run-step-${step.nodeId}`} role="button" accessibilityLabel={label} aria-label={label} {...({ dataSet: { status: step.status }, tabIndex: 0, onClick: () => { select(step.nodeId); if (compact) setPane("canvas"); }, onKeyDown: (event: { key: string }) => { if (event.key === "Enter") select(step.nodeId); } } as object)}
            onTouchEnd={() => select(step.nodeId)}
            style={{ flexDirection: "row", alignItems: "center", gap: space[2], minHeight: compact ? 44 : 40, paddingHorizontal: space[2], borderRadius: radius.md, backgroundColor: selected === step.nodeId ? theme.color("bg/subtle") : "transparent", ...({ cursor: "pointer" } as object) }}>
            {step.status === "running" ? <Spinner size={14} /> : <Icon name={NODE_STATUS_ICONS[step.status]} size={14} color={NODE_STATUS_TOKENS[step.status]} />}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text variant="body-medium" numberOfLines={1}>{nameOf(step.nodeId)}</Text>
              <Text variant="caption" color="text/secondary" numberOfLines={1}>{[t(NODE_STATUS_LABELS[step.status]), step.counts ? `${step.counts.succeeded}/${step.counts.total}` : null].filter(Boolean).join(" · ")}</Text>
            </View>
            <Text variant="caption" color="text/secondary" tabular>{duration}</Text>
          </View>
        );
      })}
    </ScrollView>
  );
  const needs = (
    <ScrollView testID="run-needs" style={{ flex: 1 }} contentContainerStyle={{ padding: space[4], maxWidth: 720, width: "100%" }}>
      {snapshot.waiting.length === 0 && permissions.length === 0 ? <Text color="text/secondary">{t("Nothing needs you right now.")}</Text>
        : snapshot.waiting.map((exec) => <Waiting key={wf.execKey(exec.nodeId, exec.path)} exec={exec} name={nameOf(exec.nodeId)} run={run} mayAnswer={mayRun} />)}
      {permissions.map((card) => {
        const step = stepSessions.find((entry) => entry.sessionKey === card.sessionKey);
        return (
          <View key={card.id} testID="needs-permission" {...({ dataSet: { node: step?.nodeId ?? "", pending: String(card.pending) } } as object)} style={{ gap: space[1], paddingVertical: space[2] }}>
            {step ? <Text variant="meta" color="text/secondary">{nameOf(step.nodeId)}</Text> : null}
            {card.node}
          </View>
        );
      })}
    </ScrollView>
  );
  const outputs = (
    <ScrollView testID="run-outputs" style={{ flex: 1 }} contentContainerStyle={{ padding: space[4], gap: space[3], maxWidth: 720, width: "100%" }}>
      {Object.keys(record.outputs ?? {}).length ? Object.entries(record.outputs ?? {}).map(([name, value]) => <ValueView key={name} name={name} value={value} testID={`run-output-${name}`} />) : null}
      {steps.filter((step) => step.status === "succeeded" && doc.nodes.find((node) => node.id === step.nodeId)?.type !== "trigger").map((step) => (
        <View key={step.nodeId} style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
          <Icon name="check-c" size={14} color="success" />
          <Text style={{ flex: 1 }} numberOfLines={1}>{nameOf(step.nodeId)}</Text>
          <Button kind="link" size="sm" label={t("Show")} onPress={() => { select(step.nodeId); setTab("diagram"); setPane("canvas"); }} />
        </View>
      ))}
      {!steps.some((step) => step.status === "succeeded" && doc.nodes.find((node) => node.id === step.nodeId)?.type !== "trigger") && !Object.keys(record.outputs ?? {}).length ? <Text color="text/secondary">{t("Nothing here yet")}</Text> : null}
    </ScrollView>
  );
  const activity = (
    <ScrollView testID="run-activity" style={{ flex: 1 }} contentContainerStyle={{ padding: space[4], gap: space[1] }}>
      {feed.timeline.length === 0 ? <Text color="text/secondary">{t("Nothing here yet")}</Text> : feed.timeline.map((entry) => { const line = activityLine(t, entry, nameOf); return line ? <View key={entry.seq} style={{ flexDirection: "row", gap: space[3] }}><Text variant="meta" color="text/tertiary" tabular>{timeOf(entry.ts_ms, theme.locale)}</Text><Text style={{ flex: 1 }}>{line}</Text></View> : null; })}
    </ScrollView>
  );
  const log = (
    <ScrollView testID="run-log" style={{ flex: 1 }} contentContainerStyle={{ padding: space[4], gap: space[0.5] }}>
      {feed.logs.length === 0 ? <Text color="text/secondary">{t("Nothing here yet")}</Text> : feed.logs.map((entry) => <Text key={entry.seq} variant="mono" selectable color={entry.level === "error" ? "danger/text" : entry.level === "warn" ? "warning/text" : "text/primary"}>{`${timeOf(entry.ts_ms, theme.locale)}  ${nameOf(entry.nodeId)}  ${preview(entry.message, 400)}`}</Text>)}
    </ScrollView>
  );
  const diagram = (
    <View style={{ flex: 1, minHeight: 0 }}>
      <Canvas doc={doc} mode="view" view={view} onView={setView} selection={selection} onSelect={setSelection} run={overlay} minimap={!compact} onSize={setSize} testID="run-canvas" />
      <View style={[{ position: "absolute", top: space[3], start: space[3], flexDirection: "row", alignItems: "center", gap: space[0.5], padding: space[0.5], borderRadius: radius.lg, backgroundColor: theme.color("bg/app"), borderWidth: 1, borderColor: theme.color("border/hairline") }, theme.elevation(1)]}>
        <IconButton icon="minus" size="sm" label={t("Zoom out")} onPress={() => setView(wf.zoomAbout(view, { x: size.width / 2, y: size.height / 2 }, view.zoom / wf.ZOOM.step))} />
        <View style={{ minWidth: 40, alignItems: "center" }}><Text variant="meta" tabular>{`${Math.round(view.zoom * 100)}%`}</Text></View>
        <IconButton icon="plus" size="sm" label={t("Zoom in")} onPress={() => setView(wf.zoomAbout(view, { x: size.width / 2, y: size.height / 2 }, view.zoom * wf.ZOOM.step))} />
        <IconButton icon="fit" size="sm" label={t("Fit to screen")} testID="run-fit" onPress={() => { const readable = wf.fitReadable(doc, size, 48, theme.compact ? wf.READABLE_ZOOM : wf.SMALL_GRAPH_ZOOM), there = Math.abs(view.zoom - readable.zoom) < 0.001 && Math.abs(view.x - readable.x) < 1 && Math.abs(view.y - readable.y) < 1; setView(there ? wf.fitView(doc, size) : readable); }} />
      </View>
    </View>
  );
  const detail: ReactNode = selected ? <NodeDetail snapshot={snapshot} nodeId={selected} run={run} mayRun={mayRun} now={now} onClose={() => select(null)} onNeeds={openNeeds} /> : null;
  const tabItems = [{ id: "diagram", label: t("Diagram") }, { id: "needs", label: t("Needs you"), count: snapshot.waiting.length + asking || undefined }, { id: "outputs", label: t("Outputs") }, { id: "activity", label: t("Activity") }, { id: "log", label: t("Log") }];
  const overlayAgent = width > 0 && width - WORKFLOW_AGENT_PANEL.width - STEPS_WIDTH - (selected ? DETAIL_WIDTH : 0) < 360;

  const title = `${record.workflowName} #${record.number}`;
  const runStatus = <RunStatus status={record.status} label={t(RUN_STATUS_LABELS[record.status])} />;
  const elapsedText = <Text variant="meta" color="text/secondary" tabular testID="run-elapsed">{clock(elapsed)}</Text>;
  const runControls = (<>
    <IconButton icon="bot" size="sm" label={t("Agent")} on={agent} toggle testID="run-toggle-agent" onPress={() => setAgent(!agent)} />
    {mayRun && record.status === "running" ? (compact ? <IconButton icon="pause" size="sm" label={t("Pause")} testID="run-pause" onPress={() => void act("jagentchill.workflow.run.pause")} /> : <Button size="sm" icon="pause" label={t("Pause")} testID="run-pause" onPress={() => void act("jagentchill.workflow.run.pause")} />) : null}
    {mayRun && record.status === "paused" && !heldStep ? (compact ? <IconButton icon="play" size="sm" label={t("Resume")} testID="run-resume" onPress={() => void act("jagentchill.workflow.run.resume")} /> : <Button size="sm" icon="play" label={t("Resume")} testID="run-resume" onPress={() => void act("jagentchill.workflow.run.resume")} />) : null}
    {mayRun && record.status === "cancelled" && record.cancelReason === "user" ? (compact ? <IconButton icon="play" size="sm" label={t("Resume from here")} testID="run-resume" onPress={() => void act("jagentchill.workflow.run.resume")} /> : <Button size="sm" icon="play" label={t("Resume from here")} testID="run-resume" onPress={() => void act("jagentchill.workflow.run.resume")} />) : null}
    {mayRun && active ? (compact ? <IconButton icon="stop" size="sm" label={t("Cancel")} testID="run-cancel" onPress={() => setConfirm("cancel")} /> : <Button size="sm" kind="ghost" label={t("Cancel")} testID="run-cancel" onPress={() => setConfirm("cancel")} />) : null}
    <View ref={menuRef}><IconButton icon="more" size="sm" label={t("Run options")} expanded={menu} testID="run-menu" onPress={() => setMenu(true)} /></View>
  </>);
  // A phone header is two rows: back with the truncated title, then the status, the elapsed time and the controls.
  const phoneBar = (
    <View testID="top-bar" style={{ paddingTop: safe.headerPaddingTop, borderBottomWidth: 1, borderBottomColor: theme.color("border/hairline"), backgroundColor: theme.color("bg/app") }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[1], paddingHorizontal: space[1], paddingTop: space[1], minWidth: 0 }}>
        <IconButton icon={inlineIcon(theme.rtl, "chev-l")} label={t("Back")} testID="run-back" onPress={() => router.replace(`${base}?tab=runs` as never)} />
        <Text variant="body-medium" level={1} numberOfLines={1} testID="run-title" style={{ flex: 1, minWidth: 0 }}>{title}</Text>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space[1], paddingHorizontal: space[2], paddingBottom: space[2], paddingTop: space[1] }}>
        {runStatus}
        {elapsedText}
        {runControls}
      </View>
    </View>
  );
  const body = (<>
      {budgetAsk}
      {banner ? <View testID="run-banner" style={{ paddingHorizontal: space[3], paddingTop: space[2] }}><Callout tone={banner.tone}>{banner.text}</Callout></View> : null}
      {compact ? (
        <View style={{ flex: 1, minHeight: 0 }}>
          <View style={{ padding: space[2] }}><Segmented<"canvas" | "steps" | "needs" | "outputs"> block size="sm" label={t("Run view")} value={pane} onChange={setPane} options={[{ value: "canvas" as const, label: t("Canvas") }, { value: "steps" as const, label: t("Steps") }, { value: "needs" as const, label: snapshot.waiting.length + asking ? `${t("Needs you")} ${snapshot.waiting.length + asking}` : t("Needs you") }, { value: "outputs" as const, label: t("Outputs") }]} /></View>
          {pane === "canvas" ? diagram : pane === "steps" ? stepList : pane === "needs" ? needs : outputs}
          <BottomSheet open={!!selected && pane === "canvas"} onClose={() => select(null)} title={selected ? nameOf(selected) : ""}><View style={{ height: 480 }}>{detail}</View></BottomSheet>
          <BottomSheet open={agent} onClose={() => setAgent(false)} title={t("Agent")}><View style={{ height: 560 }}><WorkflowAgentPanel sheet workflowId={record.workflowId} workflowName={record.workflowName} context={`${outlineText(doc)}\n[Run #${record.number}: ${record.status}]`} overlay={false} onClose={() => setAgent(false)} /></View></BottomSheet>
        </View>
      ) : (
        <View style={{ flex: 1, minHeight: 0, flexDirection: "row" }} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
          {stepList}
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ paddingHorizontal: space[3], borderBottomWidth: 1, borderBottomColor: theme.color("border/hairline") }}><Tabs id="run" label={t("Run view")} items={tabItems} value={tab} onChange={setTab} /></View>
            {tab === "diagram" ? diagram : tab === "needs" ? needs : tab === "outputs" ? outputs : tab === "activity" ? activity : log}
          </View>
          <EdgePanel open={!!detail && tab === "diagram"} edge="end" size={DETAIL_WIDTH}>{detail && tab === "diagram" ? <View style={{ width: DETAIL_WIDTH, borderStartWidth: 1, borderStartColor: theme.color("border/hairline"), minHeight: 0 }}>{detail}</View> : null}</EdgePanel>
          <WorkflowAgentSlot open={agent} overlay={overlayAgent}><WorkflowAgentPanel workflowId={record.workflowId} workflowName={record.workflowName} context={`${outlineText(doc)}\n[Run #${record.number}: ${record.status}]`} overlay={overlayAgent} onClose={() => setAgent(false)} /></WorkflowAgentSlot>
        </View>
      )}
      <View ref={rootRef} testID="run-footer" style={{ height: 32 + safe.contentPaddingBottom, paddingBottom: safe.contentPaddingBottom, flexDirection: "row", alignItems: "center", gap: space[4], paddingHorizontal: space[4], borderTopWidth: 1, borderTopColor: theme.color("border/hairline") }}>
        <Text variant="meta" color="text/secondary">{t("Elapsed {time}", { time: clock(elapsed) })}</Text>
        <Text variant="meta" color="text/secondary" numberOfLines={1} style={{ flex: 1 }}>{`${t(ORIGIN_LABELS[record.origin] ?? "You")} · ${t("revision {n}", { n: record.revision })}`}</Text>
        {active && link === "connected" ? <View style={{ flexDirection: "row", alignItems: "center", gap: space[1] }}><Icon name="refresh" size={12} color="success" /><Text variant="meta" color="text/secondary">{t("Live")}</Text></View> : null}
      </View>
      <Menu open={menu} anchor={menuRef} items={overflow} label={t("Run options")} align="end" onClose={() => setMenu(false)} />
      {starter.dialog}
      <ConfirmDialog open={confirm === "cancel"} title={t("Cancel this run?")} description={t("Steps that are running are stopped. You can resume from where it stopped.")} confirmLabel={t("Cancel run")} onClose={() => setConfirm(null)} onConfirm={() => { setConfirm(null); void act("jagentchill.workflow.run.cancel"); }} />
      <DestructiveConfirmDialog open={confirm === "delete"} title={t("Delete this run?")} description={t("Its log and history are removed.")} confirmLabel={t("Delete")} onClose={() => setConfirm(null)}
        onConfirm={() => { setConfirm(null); void calls.removeRun(record.id).then(() => router.replace(`${base}?tab=runs` as never)).catch((error) => toast.show({ kind: "error", message: failureOf(error).message })); }} />
  </>);
  return compact
    ? <Screen title={title} bare documentTitle={title}>{phoneBar}{body}</Screen>
    : <Screen title={title} crumbs={crumbs} documentTitle={title} actions={<>{runStatus}{elapsedText}{runControls}</>}>{body}</Screen>;
}
