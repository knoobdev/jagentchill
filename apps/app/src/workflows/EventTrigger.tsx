import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { View } from "react-native";
import { AUTOMATION_EVENTS, AUTOMATION_OPERATORS, type AutomationCondition, type AutomationEventName, type AutomationEventTrigger, type AutomationRun, type AutomationSchedule, type AutomationScheduleTrigger, type AutomationTrigger } from "@jagentchill/protocol";
import { Button, IconButton, Input, Select, Text, radius, space, useTheme, useToast } from "@jagentchill/ui";
import { exportService } from "../editor/export/service";
import { useHost } from "../host";
import { useT } from "../locale";
import { notifications } from "../notifications";
import { preferenceStore } from "../platform/store";
import { createEventOutbox, refusalKind, type PendingEvent } from "./eventOutbox";
/** How many exports wait for a host, by why: not told yet, refused for a permission, not accepted. */
const pendingSummary = (list: readonly PendingEvent[]): string => [list.filter((entry) => !entry.refused).length, list.filter((entry) => entry.refused && refusalKind(entry.refused.code) === "permission").length, list.filter((entry) => entry.refused && refusalKind(entry.refused.code) === "not_accepted").length].join(",");
import { useLibraryState } from "../state";

/**
 * Project event triggers of an automation: an event the host observes (a project came to the host, an export of this
 * device finished or failed, a workflow run ended), any project or one, and up to five conditions that must all hold.
 */
const EVENT_LABELS: Record<AutomationEventName, string> = {
  "project.created": "A project is created", "export.finished": "An export finishes", "export.failed": "An export fails", "workflow.finished": "A workflow run finishes", "workflow.failed": "A workflow run fails",
};
const EVENT_SHORT_LABELS: Record<AutomationEventName, string> = { "project.created": "Project created", "export.finished": "Export finished", "export.failed": "Export failed", "workflow.finished": "Run finished", "workflow.failed": "Run failed" };
const OPERATOR_LABELS: Record<(typeof AUTOMATION_OPERATORS)[number], string> = { equals: "Equals", not_equals: "Does not equal", contains: "Contains", greater_than: "Is greater than", less_than: "Is less than" };
const FIELD_LABELS: Record<string, string> = {
  projectId: "Project", name: "Name", origin: "Made by", presetId: "Preset", container: "Format", durationSeconds: "Duration (seconds)", width: "Width", height: "Height", fileName: "File name", sizeBytes: "Size (bytes)",
  errorCode: "Error code", workflowId: "Workflow", runId: "Run", templateId: "Template", costUsd: "Cost (USD)", failedNodeId: "Failed step",
};
export { EVENT_LABELS, EVENT_SHORT_LABELS, FIELD_LABELS, OPERATOR_LABELS };

export const scheduleTriggers = (triggers: readonly AutomationTrigger[]): AutomationScheduleTrigger[] => triggers.filter((trigger): trigger is AutomationScheduleTrigger => trigger.type === "schedule");
export const firstSchedule = (triggers: readonly AutomationTrigger[]): AutomationSchedule | undefined => scheduleTriggers(triggers)[0]?.schedule;
const fieldsOf = (event: AutomationEventName): Record<string, "string" | "number"> => AUTOMATION_EVENTS[event];
const operatorsOf = (type: "string" | "number") => AUTOMATION_OPERATORS.filter((operator) => (type === "number" ? operator !== "contains" : operator !== "greater_than" && operator !== "less_than"));
/** What a run's trigger was, in a word or two. */
export function runTriggerText(t: ReturnType<typeof useT>, trigger: AutomationRun["trigger"]): string {
  if (trigger.type === "manual") return t("Manual");
  if (trigger.type === "schedule") return t("Schedule");
  const name = (trigger.detail as { name?: AutomationEventName } | undefined)?.name;
  return name && EVENT_SHORT_LABELS[name] ? t(EVENT_SHORT_LABELS[name]) : t("Event");
}
/** A trigger of this kind as one line: "An export finishes · Promo · Preset equals 1080p". */
export function eventText(t: ReturnType<typeof useT>, trigger: AutomationEventTrigger, projectName?: string): string {
  return [t(EVENT_LABELS[trigger.event]), trigger.projectId ? projectName ?? t("One project") : "projectId" in fieldsOf(trigger.event) ? t("Any project") : "", ...trigger.conditions.map((condition) => `${t(FIELD_LABELS[condition.field] ?? condition.field)} ${t(OPERATOR_LABELS[condition.operator]).toLowerCase()} ${condition.value}`)].filter(Boolean).join(" · ");
}
export const newEventTrigger = (id: string): AutomationEventTrigger => ({ id, type: "event", event: "export.finished", conditions: [] });
/** What is wrong with a trigger of this kind, in the form's words; undefined when it can be saved. */
export function eventProblem(trigger: AutomationEventTrigger): string | undefined {
  const fields = fieldsOf(trigger.event);
  for (const condition of trigger.conditions) {
    if (!(condition.field in fields)) return "Choose a field of this event";
    if (condition.value === "" || (fields[condition.field] === "number" && typeof condition.value !== "number")) return "Give every condition a value";
  }
  return undefined;
}

/** The editor of one project event trigger: the event, the project, and its conditions. */
export function EventTriggerBlock(props: { trigger: AutomationEventTrigger; disabled?: boolean; submitted: boolean; onChange(next: AutomationEventTrigger): void; onRemove(): void }) {
  const t = useT(), theme = useTheme();
  const library = useLibraryState();
  const { trigger } = props, fields = fieldsOf(trigger.event), names = Object.keys(fields).filter((name) => name !== "projectId" && name !== "exportId");
  const projects = library.projects.filter((project) => project.trash === null).sort((a, b) => b.updated_ms - a.updated_ms).slice(0, 200);
  const setCondition = (at: number, patch: Partial<AutomationCondition>) => props.onChange({ ...trigger, conditions: trigger.conditions.map((entry, index) => (index === at ? { ...entry, ...patch } : entry)) });
  const problem = eventProblem(trigger);
  return (
    <View testID={`automation-trigger-${trigger.id}`} {...({ dataSet: { kind: "event", event: trigger.event } } as object)} style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: theme.color("border/hairline"), padding: space[3], gap: space[2] }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
        <Text variant="body-medium">{t("When")}</Text>
        <View testID={`automation-event-${trigger.id}`} style={{ flex: 1, minWidth: 180 }}>
          <Select size="sm" label={t("Event")} disabled={props.disabled} value={trigger.event} options={(Object.keys(EVENT_LABELS) as AutomationEventName[]).map((value) => ({ value, label: t(EVENT_LABELS[value]) }))}
            onChange={(event) => { const { projectId, ...rest } = trigger; props.onChange({ ...rest, event, conditions: [], ...(projectId && "projectId" in fieldsOf(event) ? { projectId } : {}) }); }} />
        </View>
        {"projectId" in fields ? (
          <View testID={`automation-event-project-${trigger.id}`} style={{ flex: 1, minWidth: 160 }}>
            <Select size="sm" label={t("Project")} disabled={props.disabled} value={trigger.projectId ?? "any"} options={[{ value: "any", label: t("Any project") }, ...projects.map((project) => ({ value: project.id, label: project.name })), ...(trigger.projectId && !projects.some((project) => project.id === trigger.projectId) ? [{ value: trigger.projectId, label: t("One project") }] : [])]}
              onChange={(projectId) => { const { projectId: _before, ...rest } = trigger; props.onChange(projectId === "any" ? rest : { ...rest, projectId }); }} />
          </View>
        ) : null}
        <IconButton icon="x" size="sm" label={t("Remove trigger")} disabled={props.disabled} onPress={props.onRemove} />
      </View>
      {trigger.conditions.map((condition, at) => {
        const type = fields[condition.field] ?? "string";
        return (
          <View key={at} testID={`automation-condition-${trigger.id}-${at}`} style={{ flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
            <Text variant="meta" color="text/secondary" style={{ width: 28 }}>{at ? t("and") : t("if")}</Text>
            <View style={{ flex: 2, minWidth: 130 }}><Select size="sm" label={t("Field")} disabled={props.disabled} value={condition.field} options={names.map((name) => ({ value: name, label: t(FIELD_LABELS[name] ?? name) }))} onChange={(field) => setCondition(at, { field, operator: "equals", value: fields[field] === "number" ? 0 : "" })} /></View>
            <View style={{ flex: 2, minWidth: 130 }}><Select size="sm" label={t("Comparison")} disabled={props.disabled} value={condition.operator} options={operatorsOf(type).map((operator) => ({ value: operator, label: t(OPERATOR_LABELS[operator]) }))} onChange={(operator) => setCondition(at, { operator })} /></View>
            <View style={{ flex: 2, minWidth: 110 }}><Input size="sm" disabled={props.disabled} testID={`automation-condition-value-${trigger.id}-${at}`} value={String(condition.value)} inputMode={type === "number" ? "decimal" : "text"} maxLength={200} placeholder={t("Value")}
              onChangeText={(text) => setCondition(at, { value: type === "number" ? (text.trim() !== "" && Number.isFinite(Number(text)) ? Number(text) : text.replace(/[^0-9.]/g, "")) : text })} /></View>
            <IconButton icon="x" size="sm" label={t("Remove condition")} disabled={props.disabled} onPress={() => props.onChange({ ...trigger, conditions: trigger.conditions.filter((_, index) => index !== at) })} />
          </View>
        );
      })}
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
        <Button size="sm" kind="ghost" icon="plus" label={t("Add condition")} testID={`automation-condition-add-${trigger.id}`} disabled={props.disabled || trigger.conditions.length >= 5 || names.length === 0} onPress={() => props.onChange({ ...trigger, conditions: [...trigger.conditions, { field: names[0], operator: "equals", value: fields[names[0]] === "number" ? 0 : "" }] })} />
        {props.submitted && problem ? <Text variant="meta" color="danger/text">{t(problem)}</Text> : null}
      </View>
      {trigger.event.startsWith("export.") ? <Text variant="meta" color="text/tertiary">{t("Exports are made on a device: it tells the host when one ends, while it is connected.")}</Text> : null}
    </View>
  );
}

/** The exports this device still has to tell a host (one list for the app: the reporter below fills and empties it, the Automations screen shows it). */
export const exportOutbox = createEventOutbox(preferenceStore);
/**
 * Exports that ended and have not reached the host yet, said where automations are: how many wait, and the person's
 * two choices — try now, or not tell the host about them at all. Nothing is dropped unless they choose so.
 */
export function PendingExports(): React.ReactNode {
  const t = useT();
  const { connection, status, host } = useHost(), hostId = host?.gatewayId ?? "";
  // A line of text is what the store is asked for: the list itself is a new array at every read.
  const state = useSyncExternalStore(exportOutbox.subscribe, () => (hostId ? pendingSummary(exportOutbox.pending(hostId)) : "0,0,0"), () => "0,0,0");
  const [waiting, denied, notTaken] = state.split(",").map(Number), count = waiting + denied + notTaken;
  if (!hostId || !count) return null;
  const send = () => { if (connection && status === "connected") void exportOutbox.flush(hostId, (entry) => connection.call("jagentchill.automation.event.report", { event: entry.event, fields: { ...entry.fields, exportId: entry.id } })).catch(() => undefined); };
  // WHY each still waits: not told yet, or told and refused — and then what would change the host's answer.
  const lines = [
    waiting ? { reason: "waiting", text: waiting === 1 ? t("1 finished export has not reached the host yet. It is told when the host is connected.") : t("{n} finished exports have not reached the host yet. They are told when the host is connected.", { n: waiting }) } : null,
    denied ? { reason: "permission", text: denied === 1 ? t("The host refused 1 finished export: this device is not allowed to tell it about exports. The export is kept here. Once an admin device has given this device that permission, press Try now.") : t("The host refused {n} finished exports: this device is not allowed to tell it about exports. They are kept here. Once an admin device has given this device that permission, press Try now.", { n: denied }) } : null,
    notTaken ? { reason: "not_accepted", text: notTaken === 1 ? t("The host did not accept 1 finished export (it may run another version). The export is kept here. Press Try now after the host was updated.") : t("The host did not accept {n} finished exports (it may run another version). They are kept here. Press Try now after the host was updated.", { n: notTaken }) } : null,
  ].filter((line): line is { reason: string; text: string } => !!line);
  return (
    <View testID="automation-pending-exports" {...({ dataSet: { count: String(count), refused: String(denied + notTaken) } } as object)} style={{ flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
      <View style={{ flex: 1, minWidth: 200, gap: space[1] }}>
        {lines.map((line) => <Text key={line.reason} variant="meta" color={line.reason === "waiting" ? "text/secondary" : "warning/text"} testID={`automation-pending-${line.reason}`}>{line.text}</Text>)}
      </View>
      <Button size="sm" kind="ghost" label={t("Try now")} disabled={status !== "connected"} testID="automation-pending-send" onPress={send} />
      <Button size="sm" kind="ghost" label={t("Do not tell the host")} testID="automation-pending-discard" onPress={() => exportOutbox.remove(hostId)} />
    </View>
  );
}

/**
 * Mounted once for the whole app, for what automations need from a device. Exports are rendered on the device, so only
 * the device knows when one ends: it tells the host, which starts the automations that wait for it. An export is
 * written down on the device BEFORE it is told and crossed out only when the host has answered, so one that ends while
 * the host cannot be reached — or whose answer is lost — is told after the reconnect (`eventOutbox.ts`); the host knows
 * an export by its id and starts nothing twice. And the host's notices about automations are shown here.
 */
export function AutomationEvents(): null {
  const t = useT(), toast = useToast();
  const { connection, status, host, onEvent } = useHost();
  const told = useRef(new Set<string>()), primed = useRef(false);
  const outbox = exportOutbox;
  const hostId = host?.gatewayId;
  /** Tells the host what waits for it; called when an export ends, when the connection is there again, and on a slow clock while something waits. */
  const flush = useCallback(() => {
    if (!connection || status !== "connected" || !hostId || !outbox.pending(hostId).length) return;
    void outbox.flush(hostId, (entry) => connection.call("jagentchill.automation.event.report", { event: entry.event, fields: { ...entry.fields, exportId: entry.id } })).catch(() => undefined);
  }, [connection, status, hostId, outbox]);
  useEffect(() => { flush(); const timer = setInterval(flush, 30_000); return () => clearInterval(timer); }, [flush]);
  // What the host says about this device's automations — a run failed, an automation was paused after repeated
  // failures, a run waits for a person — is shown at once and kept in the notification inbox with the way to it.
  useEffect(() => onEvent((event) => {
    if (event.event !== "jagentchill.automation.notice") return;
    const notice = event.payload as { automationId?: string; kind?: string; title?: string; body?: string } | undefined;
    if (!notice?.title) return;
    const kind = notice.kind === "failed" ? "error" as const : notice.kind === "finished" ? "success" as const : "warning" as const;
    const words = notice.kind === "failed" ? t("Automation failed: {name}", { name: notice.title.replace(/ failed$/, "") }) : notice.kind === "disabled" ? t("Automation paused after 5 failures: {name}", { name: notice.title.replace(/ was paused after 5 failures$/, "") }) : notice.kind === "waiting" ? t("An automation is waiting for you: {name}", { name: notice.title.replace(/ is waiting for a person$/, "") }) : t("Automation finished: {name}", { name: notice.title.replace(/ finished$/, "") });
    const message = notice.body ? `${words} — ${notice.body.slice(0, 200)}` : words;
    notifications.add({ kind, message, ...(host && notice.automationId ? { route: `/h/${host.gatewayId}/automations/${notice.automationId}` } : {}) });
    toast.show({ kind, message });
  }), [onEvent, host, t, toast]);
  useEffect(() => {
    const look = () => {
      const { queue, ready } = exportService.getState();
      if (!ready) return;
      const ended = [...queue.jobs, ...queue.history].filter((job) => job.target === "device" && (job.state === "succeeded" || job.state === "failed"));
      // What had already ended when the app started is history, not news.
      if (!primed.current) { primed.current = true; for (const job of ended) told.current.add(job.id); return; }
      for (const job of ended) {
        if (told.current.has(job.id)) continue;
        told.current.add(job.id);
        // No host: nobody waits for this export. With one — connected or not at this moment — it is kept until that host has it.
        if (!hostId) continue;
        const settings = job.settings as { presetId?: string | null; container?: string; resolution?: { width?: number; height?: number } };
        const fields: Record<string, string | number> = job.state === "succeeded"
          ? { projectId: job.projectId, ...(settings.presetId ? { presetId: settings.presetId } : {}), ...(settings.container ? { container: settings.container } : {}), durationSeconds: Math.round((job.duration / 120_000) * 10) / 10, ...(settings.resolution?.width && settings.resolution.height ? { width: settings.resolution.width, height: settings.resolution.height } : {}), fileName: job.output?.fileName ?? job.fileName, sizeBytes: job.output?.size ?? 0 }
          : { projectId: job.projectId, ...(settings.presetId ? { presetId: settings.presetId } : {}), errorCode: String((job.error as { code?: string } | undefined)?.code ?? "EXPORT_FAILED") };
        outbox.add({ id: job.id, hostId, event: job.state === "succeeded" ? "export.finished" : "export.failed", fields });
      }
      flush();
    };
    look();
    return exportService.subscribe(look);
  }, [hostId, outbox, flush]);
  return null;
}
