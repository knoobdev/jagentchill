import { usePathname, useRouter } from "expo-router";
import { matchesQuery, relativeTime, rowMeta } from "@jagentchill/app-core";
import { workflow as wf } from "@jagentchill/editor-core";
import { ListCaption, ListRow, Text, space, useTheme } from "@jagentchill/ui";
import { useHost } from "../host";
import { useT } from "../locale";
import { useWorkflowIndex } from "./data";
import { AUTOMATION_RUN_LABELS, RUN_STATUS_LABELS } from "./strings";

/** The sidebar's index of the Workflows and Automations sections: what needs the person first, then the recent items. */
export function WorkflowSidebarRows(props: { list: "workflows" | "automations"; query: string; onNavigate?(): void }) {
  const t = useT(), theme = useTheme(), router = useRouter(), pathname = usePathname();
  const { host, status } = useHost();
  const index = useWorkflowIndex();
  const now = Date.now();
  const go = (route: string) => { router.push(route as never); props.onNavigate?.(); };
  const empty = (text: string) => <Text color="text/secondary" style={{ paddingVertical: space[2], paddingHorizontal: space[2] }}>{text}</Text>;
  if (status !== "connected" || !host) return empty(t("Requires a host"));
  const base = `/h/${host.gatewayId}`;
  if (props.list === "automations") {
    const rows = (index.automations ?? []).filter((record) => matchesQuery(record.name, props.query)).sort((a, b) => b.updated_ms - a.updated_ms);
    if (index.automations === null) return null;
    if (!rows.length) return empty(props.query ? t("No results") : t("No automations yet"));
    return (
      <>
        <ListCaption label={t("Recent")} />
        {rows.slice(0, 30).map((record) => {
          const schedule = record.triggers.find((trigger) => trigger.type === "schedule")?.schedule;
          const meta = rowMeta({
            attention: record.stats.lastStatus === "waiting" ? t("Needs approval") : undefined, failed: record.stats.lastStatus === "failed",
            updated: !record.enabled ? t("Paused") : record.stats.nextRun_ms ? t("Next run {when}", { when: new Intl.DateTimeFormat(theme.locale, { weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: schedule?.tzid }).format(record.stats.nextRun_ms) }) : record.stats.lastStatus ? t(AUTOMATION_RUN_LABELS[record.stats.lastStatus]) : schedule ? wf.scheduleText(schedule) : t("On an event"),
          });
          return <ListRow key={record.id} title={record.name} meta={meta.text} metaTone={meta.tone} testID="automation-side-row" selected={pathname.endsWith(`/automations/${record.id}`)} onPress={() => go(`${base}/automations/${record.id}`)} />;
        })}
      </>
    );
  }
  if (index.workflows === null) return null;
  const waiting = (index.runs ?? []).filter((run) => run.status === "waiting_approval" && matchesQuery(run.workflowName, props.query));
  const rows = (index.workflows ?? []).filter((item) => matchesQuery(item.name, props.query));
  if (!rows.length && !waiting.length) return empty(props.query ? t("No results") : t("No workflows yet"));
  return (
    <>
      {waiting.length ? <><ListCaption label={t("Needs you")} />{waiting.map((run) => <ListRow key={run.id} title={`${run.workflowName} #${run.number}`} meta={t("Waiting for you")} metaTone="warning" testID="workflow-side-needs" selected={pathname.endsWith(`/runs/${run.id}`)} onPress={() => go(`${base}/workflows/runs/${run.id}`)} />)}</> : null}
      {rows.length ? <ListCaption label={t("Recent")} /> : null}
      {rows.slice(0, 30).map((item) => {
        const last = item.lastRun;
        const meta = rowMeta({ running: last?.status === "running" ? t(RUN_STATUS_LABELS.running) : undefined, failed: last?.status === "failed", ready: last?.status === "succeeded" ? t(RUN_STATUS_LABELS.succeeded) : undefined, updated: relativeTime(item.updated_ms, now, theme.locale) });
        return <ListRow key={item.id} title={item.name} meta={meta.text} metaTone={meta.tone} testID="workflow-side-row" selected={pathname.endsWith(`/workflows/${item.id}`)} onPress={() => go(`${base}/workflows/${item.id}`)} />;
      })}
    </>
  );
}
