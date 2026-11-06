import { useRouter } from "expo-router";
import { TokenSaving } from "./TokenSaving";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, View } from "react-native";
import { downloadHostExport } from "@jagentchill/client";
import { preference, relativeTime, tokenCount, formatDateTime, formatUsd, formatDayMonth } from "@jagentchill/app-core";
import type { BudgetState, PlanUsage, SessionUsage, UsageAccuracy, UsageDimension, UsageQueryResult, UsageRecord, UsageRow, UsageTreeNode } from "@jagentchill/protocol";
import {
  AdaptiveSheet, BarChart, Button, Callout, Card, DestructiveConfirmDialog, Disclosure, FormDialog, FormField, Input, ProgressBar, Select, Spinner, StatusPill, Switch, Table, Tabs, Tap, Text,
  space, useTheme, useToast, type Column, type Crumb, SkeletonCards, SkeletonText, inlineIcon } from "@jagentchill/ui";
import { reasonOf } from "../agents/errors";
import { useAgentData } from "../agents/data";
import { useHost } from "../host";
import { loadSigner } from "../identity";
import { useT } from "../locale";
import { saveBlob } from "../platform/media";
import { SettingsPageFrame } from "../settings/SettingsScreen";
import { Screen, useHostScopeState } from "../shell/Shell";
import { useLibraryState, usePref } from "../state";
import { usageFilterLayout } from "./usage-layout";

const RANGES = [{ value: "today", label: "Today" }, { value: "7d", label: "Last 7 days" }, { value: "30d", label: "Last 30 days" }, { value: "month", label: "This month" }, { value: "last-month", label: "Last month" }] as const;
type RangeId = (typeof RANGES)[number]["value"];
const GROUPS: Array<{ value: UsageDimension; label: string; title: string }> = [
  { value: "provider", label: "By provider", title: "Provider" }, { value: "runtime", label: "By runtime", title: "Runtime" }, { value: "model", label: "By model", title: "Model" },
  { value: "project", label: "By project", title: "Project" }, { value: "session", label: "By session", title: "Session" }, { value: "device", label: "By device", title: "Device" },
];
/** The range and the grouping stay as this device left them. */
const RANGE_PREF = preference<string>("usage.range", "30d", (value): value is string => typeof value === "string");
const GROUP_PREF = preference<string>("usage.group", "provider", (value): value is string => typeof value === "string");
const DAY = 86_400_000;

function rangeOf(id: RangeId, now: number): { from_ms: number; to_ms: number } {
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  if (id === "today") return { from_ms: start.getTime(), to_ms: now };
  if (id === "7d") return { from_ms: start.getTime() - 6 * DAY, to_ms: now };
  if (id === "month") { start.setDate(1); return { from_ms: start.getTime(), to_ms: now }; }
  if (id === "last-month") { const end = new Date(start); end.setDate(1); const from = new Date(end); from.setMonth(from.getMonth() - 1); return { from_ms: from.getTime(), to_ms: end.getTime() - 1 }; }
  return { from_ms: start.getTime() - 29 * DAY, to_ms: now };
}
export const usd = (value: number) => formatUsd(value);
const turnsOf = (row: { agent: UsageRow["agent"] }) => row.agent.turns.completed + row.agent.turns.cancelled + row.agent.turns.failed;
const tokensOf = (row: { agent: UsageRow["agent"] }) => row.agent.inputTokens + row.agent.cachedInputTokens + row.agent.cacheWriteTokens + row.agent.outputTokens;
const ACCURACY: Record<UsageAccuracy, string> = { reported: "Reported", estimated: "Estimated", mixed: "Estimated", partial: "Partial" };
/** How a sum of costs is shown: never a bare zero for turns a plan paid for, never a number for turns whose cost is unknown. */
export function costText(t: (text: string, values?: Record<string, string | number>) => string, totals: UsageRow["agent"]): string {
  const turns = totals.turns.completed + totals.turns.cancelled + totals.turns.failed;
  if (turns === 0) return "—";
  if (totals.costUsd > 0) return usd(totals.costUsd);
  if (totals.includedTurns === turns) return t("Included in plan");
  if (totals.unknownCostTurns === turns) return t("Unknown");
  return totals.includedTurns ? t("Included in plan") : usd(0);
}
const duration = (ms: number) => (ms < 60_000 ? `${Math.round(ms / 1000)} s` : ms < 3_600_000 ? `${Math.round(ms / 60_000)} min` : `${(ms / 3_600_000).toFixed(1)} h`);

/** Host ▸ Usage and limits: what the agents of this host used, by provider, runtime, model, project, session and device, and the limits set on it. */
export function UsageScreen(props: { tab?: string; settings?: boolean }) {
  const t = useT();
  const theme = useTheme();
  const filtersLayout = usageFilterLayout(theme.compact);
  const toast = useToast();
  const router = useRouter();
  const scope = useHostScopeState(t("Usage"));
  const { host, connection, onEvent, can, sessions } = useHost();
  const library = useLibraryState();
  const agents = useAgentData();
  const admin = can("jagentchill.config.write");
  const [tab, setTab] = useState(props.tab === "limits" || props.tab === "plan" ? "limits" : "usage");
  const [rangeId, setRangeId] = usePref(RANGE_PREF);
  const [groupId, setGroupId] = usePref(GROUP_PREF);
  const range = (RANGES.find((entry) => entry.value === rangeId)?.value ?? "30d") as RangeId;
  const group = GROUPS.find((entry) => entry.value === groupId) ?? GROUPS[0];
  const [data, setData] = useState<{ byGroup: UsageQueryResult; byDay: UsageQueryResult; ledger: UsageQueryResult; providers: UsageQueryResult } | null>(null);
  const [budgets, setBudgets] = useState<BudgetState[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [about, setAbout] = useState(false);
  const last = useRef(0);

  const load = useCallback(async () => {
    if (!connection) return;
    const bounds = rangeOf(range, Date.now());
    last.current = Date.now();
    try {
      const ask = (groupBy: UsageDimension[], extra: object = {}) => connection.call<UsageQueryResult>("jagentchill.usage.query", { groupBy, ...bounds, ...extra });
      const [byGroup, byDay, ledger, providers, limits] = await Promise.all([
        ask([group.value]), ask(["day", group.value], { limit: 1000 }), ask(["day", "session", "model"], { limit: 200 }), ask(["model", "provider"], { limit: 1000 }),
        connection.call<{ budgets: BudgetState[] }>("jagentchill.provider.budget.list", {}),
      ]);
      setData({ byGroup, byDay, ledger, providers });
      setBudgets(limits.budgets);
      setError(null);
    } catch (err) { setError(err); }
  }, [connection, range, group.value]);
  useEffect(() => { setData(null); void load(); }, [load]);
  // Open aggregate views follow the `usage` stream and refresh at most once in ten seconds.
  useEffect(() => {
    if (!connection) return;
    void connection.call("jagentchill.usage.subscribe", { aggregate: true }).catch(() => undefined);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = onEvent((event) => {
      if (event.event !== "jagentchill.usage.updated" || timer) return;
      timer = setTimeout(() => { timer = undefined; void load(); }, Math.max(500, 10_000 - (Date.now() - last.current)));
    });
    return () => { off(); if (timer) clearTimeout(timer); void connection.call("jagentchill.usage.unsubscribe", { aggregate: true }).catch(() => undefined); };
  }, [connection, onEvent, load]);

  const projectName = useCallback((id: string | undefined) => (id ? library.projects.find((project) => project.id === id)?.name ?? id : t("No project")), [library.projects, t]);
  const labelOf = useCallback((row: UsageRow, index = 0) => (group.value === "project" && index === 0 ? projectName(row.keys[0] || undefined) : t(row.labels[index] ?? "")), [group.value, projectName, t]);
  // Every day of the range has its place on the axis, also the days nothing was used.
  const days = useMemo(() => {
    const used = [...new Set((data?.byDay.rows ?? []).map((row) => row.keys[0]))].sort();
    if (!used.length) return used;
    const bounds = rangeOf(range, Date.now()), all: string[] = [];
    const key = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    for (const cursor = new Date(bounds.from_ms); cursor.getTime() <= bounds.to_ms && all.length < 62; cursor.setDate(cursor.getDate() + 1)) all.push(key(cursor));
    return [...new Set([...all, ...used])].sort();
  }, [data, range]);
  const totals = data?.byGroup.totals;
  const spend = totals?.agent.costUsd ?? 0;
  // With nothing to pay per call in the range, the chart plots tokens, and says so.
  const plotTokens = !!totals && spend === 0;
  const series = useMemo(() => (data?.byGroup.rows ?? []).slice(0, 8).map((row) => ({
    name: group.value === "project" ? projectName(row.keys[0] || undefined) : t(row.labels[0]),
    values: days.map((day) => { const found = data!.byDay.rows.find((entry) => entry.keys[0] === day && entry.keys[1] === row.keys[0]); return found ? (plotTokens ? tokensOf(found) : found.totalCostUsd) : 0; }),
  })), [data, days, group.value, plotTokens, projectName, t]);
  const dayLabel = (day: string) => formatDayMonth(new Date(`${day}T12:00:00`).getTime(), theme.locale);
  // A long range names its first, middle and last day, as the axis has no room for more; the other ticks stay blank
  // (each a distinct empty label). The tables below the chart carry every value.
  const axisLabel = (day: string, index: number) => (days.length <= 10 || index === 0 || index === days.length - 1 || index === Math.floor(days.length / 2) ? dayLabel(day) : "\u200b".repeat(index));
  const global = budgets.find((budget) => budget.scope === "global" && budget.period === "month");
  const providerOf = (model: string) => data?.providers.rows.find((row) => row.keys[0] === model)?.labels[1];

  async function exportCsv() {
    if (!connection || !host) return;
    setExporting(true);
    try {
      const exported = await connection.call<{ blobSha256: string; fileName: string; rowCount: number; truncated: boolean }>("jagentchill.usage.export", { query: { groupBy: ["day"], ...rangeOf(range, Date.now()) }, detail: "records", idempotencyKey: `csv-${Date.now()}` });
      saveBlob(exported.fileName, await downloadHostExport(host, await loadSigner(), "usage", exported.blobSha256));
      toast.show({ kind: exported.truncated ? "warning" : "success", message: exported.truncated ? t("Export limited to 1,000,000 rows — narrow the range") : exported.rowCount === 1 ? t("1 row exported") : t("{n} rows exported", { n: exported.rowCount }) });
    } catch (err) { toast.show({ kind: "error", message: reasonOf(err) }); }
    finally { setExporting(false); }
  }

  if (scope) return <Screen title={t("Usage and limits")}>{scope}</Screen>;
  const hostName = host?.gatewayName ?? t("the host");
  const crumbs: Crumb[] = [{ id: "settings", label: t("Settings"), onPress: () => router.push("/settings" as never) }, { id: "host", label: hostName }, { id: "usage", label: t("Usage and limits") }];
  const tile = (id: string, label: string, value: string, caption: string) => (
    <Card key={id} style={{ flex: 1, minWidth: theme.compact ? "45%" : 150, gap: space[0.5] }} padding={space[3]}>
      <View testID={`usage-tile-${id}`} style={{ gap: space[0.5] }}>
        <Text variant="meta" color="text/secondary">{label}</Text>
        <Text variant="title-md" tabular>{value}</Text>
        <Text variant="meta" color="text/secondary" numberOfLines={2}>{caption}</Text>
      </View>
    </Card>
  );
  const breakdown: Array<Column<UsageRow>> = [
    { id: "name", title: t(group.title), flex: 2, text: (row) => labelOf(row) },
    { id: "turns", title: t("Turns"), width: 64, numeric: true, text: (row) => String(turnsOf(row)) },
    { id: "tokens", title: t("Tokens"), width: 88, numeric: true, text: (row) => (row.agent.unreportedTurns === turnsOf(row) ? t("Not reported") : tokenCount(tokensOf(row))) },
    { id: "cost", title: t("Est. cost"), width: 124, numeric: true, text: (row) => costText(t, row.agent) },
    { id: "accuracy", title: t("Accuracy"), width: 96, text: (row) => t(ACCURACY[row.accuracy]) },
  ];
  const ledger: Array<Column<UsageRow>> = [
    { id: "time", title: t("Time"), width: 72, text: (row) => dayLabel(row.keys[0]) },
    { id: "kind", title: t("Kind"), width: 56, text: () => "LLM" },
    { id: "model", title: t("Provider · model"), flex: 2, text: (row) => [providerOf(row.keys[2]), row.keys[2] || t("Unknown")].filter(Boolean).join(" · ") },
    { id: "project", title: t("Project"), flex: 1, text: (row) => (row.keys[1] ? projectName(sessions.find((session) => session.sessionKey === row.keys[1])?.projectId) : "—") },
    { id: "quantity", title: t("Quantity"), width: 124, numeric: true, text: (row) => (row.agent.unreportedTurns === turnsOf(row) ? (turnsOf(row) === 1 ? t("1 turn") : t("{n} turns", { n: turnsOf(row) })) : `${tokenCount(tokensOf(row))} ${t("tokens")}`) },
    { id: "cost", title: t("Est. cost"), width: 92, numeric: true, text: (row) => (row.agent.costUsd === 0 && row.agent.includedTurns === turnsOf(row) ? t("In plan") : costText(t, row.agent)) },
    { id: "status", title: t("Status"), width: 120, text: (row) => (row.agent.turns.failed ? t("Failed") : row.agent.turns.cancelled ? t("Stopped") : t("Succeeded")), render: (row) => <StatusPill label={row.agent.turns.failed ? t("Failed") : row.agent.turns.cancelled ? t("Stopped") : t("Succeeded")} tone={row.agent.turns.failed ? "danger" : row.agent.turns.cancelled ? "warning" : "success"} /> },
    { id: "view", title: "", width: 76, text: () => t("View"), render: (row) => (row.keys[1] ? <Button size="xs" kind="link" label={t("View")} trailingIcon={inlineIcon(theme.rtl, "arrow-r")} testID="usage-view" onPress={() => setOpen(row.keys[1])} /> : <Text color="text/secondary">—</Text>) },
  ];
  return (
    <SettingsPageFrame crumbs={crumbs} title={t("Usage and limits")} width={760} description={t("Estimated spend and generation volume on {host}.", { host: hostName })}
      actions={Platform.OS === "web" ? <Button kind="secondary" size="sm" icon="download" label={t("Export CSV")} testID="usage-export" loading={exporting} onPress={() => void exportCsv()} /> : undefined}>
      <View style={{ flexDirection: filtersLayout.direction, alignItems: filtersLayout.alignItems, flexWrap: "wrap", gap: space[2] }}>
        <View style={{ flex: 1, minWidth: 160 }}><Tabs id="usage" label={t("Usage and limits")} value={tab} onChange={setTab} items={[{ id: "usage", label: t("Usage") }, { id: "limits", label: t("Limits") }]} /></View>
        {tab === "usage" ? (
          <View style={{ flexDirection: theme.compact ? "column" : "row", alignSelf: filtersLayout.controlsAlign, gap: space[2], paddingBottom: space[1] }}>
            <Select label={t("Group by")} size="sm" width={theme.compact ? undefined : 130} value={group.value} onChange={(value) => setGroupId(value)} options={GROUPS.map((entry) => ({ value: entry.value, label: t(entry.label) }))} />
            <Select label={t("Range")} size="sm" width={theme.compact ? undefined : 140} value={range} onChange={(value) => setRangeId(value)} options={RANGES.map((entry) => ({ value: entry.value, label: t(entry.label), icon: "calendar" as const }))} />
          </View>
        ) : null}
      </View>
      {tab === "limits" ? <Limits admin={admin} budgets={budgets} reload={load} hostName={hostName} providerLabel={agents.providerLabel} /> : error && !data ? <Callout tone="danger" actions={[{ label: t("Retry"), onPress: () => void load() }]}>{t("Unable to load usage")}</Callout>
        : !data || !totals ? <SkeletonCards cards={2} rows={3} style={{ padding: space[4] }} /> : (
          <View testID="usage-overview" style={{ gap: space[3] }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[3] }}>
              {tile("spend", t("Estimated spend"), costText(t, totals.agent), global ? t("of {limit} monthly limit", { limit: usd(global.limitUsd) }) : turnsOf(totals) ? `${turnsOf(totals) === 1 ? t("1 turn") : t("{n} turns", { n: turnsOf(totals) })} · ${t(ACCURACY[totals.accuracy])}` : t("No usage in this period"))}
              {tile("generations", t("Generations"), totals.generation.calls ? String(totals.generation.calls) : "—", t("images, clips, voice"))}
              {tile("tokens", t("LLM tokens"), turnsOf(totals) ? tokenCount(tokensOf(totals)) : "—", `${t("in {n}", { n: tokenCount(totals.agent.inputTokens + totals.agent.cachedInputTokens + totals.agent.cacheWriteTokens) })} · ${t("out {n}", { n: tokenCount(totals.agent.outputTokens) })}`)}
              {tile("media", t("Media minutes"), "—", t("video · audio"))}
            </View>
            {totals.agent.unknownCostTurns ? <Text variant="meta" color="text/secondary">{totals.agent.unknownCostTurns === 1 ? t("1 turn with unknown cost not included") : t("{n} turns with unknown cost not included", { n: totals.agent.unknownCostTurns })}</Text> : null}
            <Card padding={space[3]} style={{ gap: space[2] }}>
              <View testID="usage-chart" style={{ gap: space[2] }}>
                <Text variant="body-medium" level={2}>{plotTokens ? t("Tokens per day") : t("Estimated spend per day")}</Text>
                {plotTokens && totals.agent.includedTurns ? <Text variant="meta" color="text/secondary">{t("Cost is included in the plan — showing tokens")}</Text> : null}
                <BarChart stacked label={plotTokens ? t("Tokens per day") : t("Estimated spend per day")} height={160} categories={days.map(axisLabel)} series={series} emptyMessage={t("No usage in this period")} formatValue={(value) => (plotTokens ? tokenCount(value) : `est. ${usd(value)}`)} />
                <Text variant="meta" color="text/secondary">{t("Days are in {zone} (the host's time zone)", { zone: data.byGroup.timeZone })}</Text>
              </View>
            </Card>
            <Table dense label={t(group.label)} rows={data.byGroup.rows} rowKey={(row) => row.keys.join("|") || "other"} columns={breakdown}
              onRowPress={group.value === "session" ? (row) => { if (row.keys[0]) setOpen(row.keys[0]); } : undefined}
              empty={{ icon: "graph", title: t("No usage in this period"), description: t("Usage appears after your first agent message.") }} />
            <Table dense label={t("Usage by day and session")} rows={[...data.ledger.rows].reverse()} rowKey={(row) => row.keys.join("|")} columns={ledger} maxHeight={420}
              empty={{ icon: "graph", title: t("No usage in this period") }} />
            <Disclosure title={t("About these numbers")} open={about} onToggle={setAbout}>
              <View style={{ gap: space[1] }}>
                {["Token counts are reported by each runtime. Stopped and failed turns are included with the usage reported before they ended.",
                  "Estimated: calculated from token counts and list prices. Your provider's invoice is the source of truth.",
                  "Included in plan: the runtime is billed through a subscription. Cost per turn is not available; tokens are shown instead.",
                  "Unknown: the model has no price, or the runtime reports no tokens. Such turns are counted, never shown as zero.",
                  "A session's usage belongs to the project it was in when each turn ran."].map((line) => <Text key={line} variant="meta" color="text/secondary">{t(line)}</Text>)}
              </View>
            </Disclosure>
          </View>
        )}
      <SessionUsageSheet sessionKey={open} onClose={() => setOpen(null)} onOpen={setOpen} />
    </SettingsPageFrame>
  );
}

/** The usage of one session: its totals, each turn, and the agents it started. */
function SessionUsageSheet(props: { sessionKey: string | null; onClose(): void; onOpen(sessionKey: string): void }) {
  const t = useT();
  const theme = useTheme();
  const router = useRouter();
  const { connection, host, sessions } = useHost();
  const agents = useAgentData();
  const [data, setData] = useState<{ session: SessionUsage; tree?: UsageTreeNode } | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    setData(null); setError(null);
    if (!props.sessionKey || !connection) return;
    void connection.call<{ session: SessionUsage; tree?: UsageTreeNode }>("jagentchill.usage.session.get", { sessionId: props.sessionKey, includeTree: true }).then(setData).catch(setError);
  }, [props.sessionKey, connection]);
  const session = data?.session;
  const runtime = (id: string | null) => agents.catalogue?.groups.find((group) => group.runtimeId === id)?.label ?? id ?? t("Unknown");
  const exists = sessions.some((entry) => entry.sessionKey === props.sessionKey);
  const costOf = (record: UsageRecord) => (record.costSource === "included" ? t("Included in plan") : record.costSource === "unknown" ? t("Unknown") : `${usd(record.costUsd ?? 0)} · ${t(record.costSource === "reported" ? "Reported" : "Estimated")}`);
  const node = (entry: UsageTreeNode, depth: number): React.ReactNode => (
    <View key={entry.sessionKey}>
      <Tap role="button" label={entry.label} onPress={() => props.onOpen(entry.sessionKey)} style={{ flexDirection: "row", alignItems: "center", gap: space[2], minHeight: 28, paddingStart: depth * space[4] }}>
        <Text numberOfLines={1} style={{ flex: 1 }}>{entry.label}</Text>
        <Text variant="meta" color="text/secondary" tabular>{tokenCount(entry.subtree.inputTokens + entry.subtree.cachedInputTokens + entry.subtree.cacheWriteTokens + entry.subtree.outputTokens)} · {entry.sharePct} %</Text>
      </Tap>
      {entry.children.map((child) => node(child, depth + 1))}
    </View>
  );
  return (
    <AdaptiveSheet open={props.sessionKey !== null} onClose={props.onClose} title={session?.title ?? t("Session usage")} width={640}
      footer={exists && host ? <Button size="sm" label={t("Open session")} onPress={() => { props.onClose(); router.push(`/h/${host.gatewayId}/sessions/${encodeURIComponent(props.sessionKey!)}` as never); }} /> : undefined}>
      {error ? <Callout tone="danger">{reasonOf(error)}</Callout> : !session ? <SkeletonText lines={4} /> : (
        <View testID="session-usage" style={{ gap: space[3] }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[4] }}>
            {[[t("Turns"), String(session.turns.completed + session.turns.cancelled + session.turns.failed)], [t("Input"), tokenCount(session.inputTokens)], [t("Cached input"), tokenCount(session.cachedInputTokens + session.cacheWriteTokens)], [t("Output"), tokenCount(session.outputTokens)],
              [t("Cost"), session.agentCostUsd > 0 ? `${usd(session.agentCostUsd)} · ${t(ACCURACY[session.accuracy])}` : session.includedTurns ? t("Included in plan") : session.unknownCostTurns ? t("Unknown") : "—"], [t("Active time"), duration(session.duration_ms)]].map(([label, value]) => (
              <View key={label}><Text variant="meta" color="text/secondary">{label}</Text><Text variant="body-medium" tabular>{value}</Text></View>
            ))}
          </View>
          {session.equivalentCostUsd > 0 && session.includedTurns ? <Text variant="meta" color="text/secondary">{t("Equivalent API cost (estimate) {amount}", { amount: usd(session.equivalentCostUsd) })}</Text> : null}
          {session.unknownCostTurns ? <Text variant="meta" color="text/secondary">{session.unknownCostTurns === 1 ? t("1 turn with unknown cost not included") : t("{n} turns with unknown cost not included", { n: session.unknownCostTurns })}</Text> : null}
          {session.context.source === "reported" ? (
            <View style={{ gap: space[1] }}>
              <Text variant="meta" color="text/secondary">{t("Context: {used} of {max} tokens ({pct} %)", { used: tokenCount(session.context.usedTokens), max: tokenCount(session.context.maxTokens), pct: session.context.pct })}</Text>
              <ProgressBar thin value={session.context.pct / 100} label={t("Context window")} tone={session.context.pct >= 95 ? "danger" : session.context.pct >= 80 ? "warning" : undefined} />
            </View>
          ) : <Text variant="meta" color="text/secondary">{t("Context size is not reported for this session yet")}</Text>}
          <Text variant="body-medium" level={3}>{t("Per turn")}</Text>
          {session.records.length === 0 ? <Text color="text/secondary">{t("No turn has finished in this session yet.")}</Text> : (
            <View>
              {session.records.map((record, index) => (
                <View key={record.id} testID="usage-turn" style={{ flexDirection: "row", alignItems: "center", gap: space[2], minHeight: 32, borderTopWidth: index ? 1 : 0, borderTopColor: theme.color("border/hairline") }}>
                  <Text variant="meta" color="text/secondary" style={{ width: 84 }}>{relativeTime(record.started_ms, Date.now(), theme.locale)}</Text>
                  <Text variant="meta" numberOfLines={1} style={{ flex: 1 }}>{runtime(record.runtimeId)} · {record.modelId ?? t("Unknown")}</Text>
                  <Text variant="meta" tabular color="text/secondary">{record.tokenSource === "none" ? t("Not reported") : `${tokenCount((record.inputTokens ?? 0) + (record.cachedInputTokens ?? 0) + (record.cacheWriteTokens ?? 0))} ${t("in")} · ${tokenCount(record.outputTokens ?? 0)} ${t("out")}`}</Text>
                  <Text variant="meta" tabular style={{ width: 128 }} align="right">{costOf(record)}</Text>
                  <Text variant="meta" color={record.outcome === "completed" ? "text/secondary" : "warning/text"} style={{ width: 64 }} align="right">{t(record.outcome === "completed" ? "Done" : record.outcome === "cancelled" ? "Stopped" : "Failed")}</Text>
                </View>
              ))}
            </View>
          )}
          <Text variant="body-medium" level={3}>{t("Agents")}</Text>
          {data?.tree && data.tree.children.length ? node(data.tree, 0) : <Text color="text/secondary">{t("This session did not start other agents")}</Text>}
        </View>
      )}
    </AdaptiveSheet>
  );
}

const SCOPE_LABEL: Record<string, string> = { global: "All usage", provider: "Provider", project: "Project", session: "Session" };

/** Spending limits, how plan-billed turns count toward them, provider plan usage, and the reset of the usage history. */
function Limits(props: { admin: boolean; budgets: BudgetState[]; reload(): Promise<void>; hostName: string; providerLabel(id: string): string }) {
  const t = useT();
  const toast = useToast();
  const { connection, sessions } = useHost();
  const library = useLibraryState();
  const agents = useAgentData();
  const [editing, setEditing] = useState<{ scope: string; scopeId: string; limit: string; period: string; hardStop: boolean; allowUnknownCost: boolean } | null>(null);
  const [plan, setPlan] = useState<{ enabled: boolean; providers: PlanUsage[]; error?: string } | null>(null);
  const [listPrice, setListPrice] = useState(false);
  const [confirmPlan, setConfirmPlan] = useState(false);
  const [reset, setReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const loadPlan = useCallback(async (refresh = false) => {
    if (!connection) return;
    try {
      setPlan(await connection.call("jagentchill.usage.plan.list", refresh ? { refresh: true } : {}));
      setListPrice((await connection.call<{ planTurnsAtListPrice: boolean }>("jagentchill.provider.budget.list", {})).planTurnsAtListPrice);
    } catch { setPlan({ enabled: false, providers: [], error: t("Unable to load usage") }); }
  }, [connection, t]);
  useEffect(() => { void loadPlan(); }, [loadPlan]);
  const patch = async (change: Record<string, boolean>) => { try { await connection!.call("jagentchill.settings.host.patch", { patch: change }); await loadPlan(); await props.reload(); } catch (err) { toast.show({ kind: "error", message: reasonOf(err) }); throw err; } };
  const nameOf = (budget: { scope: string; scopeId?: string }) => (budget.scope === "global" ? t("All usage") : budget.scope === "provider" ? props.providerLabel(budget.scopeId!) : budget.scope === "project" ? library.projects.find((project) => project.id === budget.scopeId)?.name ?? budget.scopeId! : sessions.find((session) => session.sessionKey === budget.scopeId)?.title ?? t("Session"));
  const providers = [...new Map([...agents.providers.map((provider) => [provider.providerId, provider.label] as const), ...(agents.catalogue?.groups.flatMap((entry) => entry.providers.map((provider) => [provider.providerId, provider.label] as const)) ?? [])]).entries()];
  const targets = editing?.scope === "provider" ? providers.map(([value, label]) => ({ value, label })) : editing?.scope === "project" ? library.projects.filter((project) => project.trash === null).map((project) => ({ value: project.id, label: project.name })) : editing?.scope === "session" ? sessions.map((session) => ({ value: session.sessionKey, label: session.title ?? t("Session") })) : [];
  const limit = Number(editing?.limit);
  const valid = !!editing && Number.isFinite(limit) && limit >= 0.01 && limit <= 100_000 && (editing.scope === "global" || !!editing.scopeId);
  async function save() {
    if (!editing || !connection) return;
    setBusy(true);
    try {
      await connection.call("jagentchill.provider.budget.set", { budget: { scope: editing.scope, ...(editing.scope === "global" ? {} : { scopeId: editing.scopeId }), limitUsd: limit, period: editing.scope === "global" || editing.scope === "provider" ? "month" : editing.period, hardStop: editing.hardStop, allowUnknownCost: editing.allowUnknownCost } });
      setEditing(null);
      await props.reload();
    } catch (err) { toast.show({ kind: "error", message: reasonOf(err) }); }
    finally { setBusy(false); }
  }
  const uncounted = props.budgets.reduce((total, budget) => Math.max(total, budget.uncountedTurns), 0);
  return (
    <View testID="usage-limits" style={{ gap: space[3] }}>
      <TokenSaving admin={props.admin} />
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Text variant="body-medium" level={2} style={{ flex: 1 }}>{t("Spending limits")}</Text>
        {props.admin ? <Button size="sm" icon="plus" label={t("Add limit")} testID="budget-add" onPress={() => setEditing({ scope: "global", scopeId: "", limit: "", period: "month", hardStop: true, allowUnknownCost: false })} /> : null}
      </View>
      <Text variant="meta" color="text/secondary">{t("A limit with a hard stop refuses the next message once it is reached. All amounts are in USD.")}</Text>
      {props.budgets.length === 0 ? <Card><Text color="text/secondary">{props.admin ? t("No limit is set. Agents can spend without a ceiling on this host.") : t("No limit is set. Ask an admin device to set one.")}</Text></Card> : props.budgets.map((budget) => (
        <Card key={`${budget.scope}:${budget.scopeId ?? ""}`} style={{ gap: space[1.5] }}>
          <View testID={`budget-${budget.scope}`} style={{ gap: space[1.5] }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
              <Text variant="body-medium" numberOfLines={1} style={{ flex: 1 }}>{budget.scope === "global" ? t("All usage") : `${t(SCOPE_LABEL[budget.scope])}: ${nameOf(budget)}`}</Text>
              <Text tabular>{t("{spent} of {limit}", { spent: usd(budget.spentUsd), limit: usd(budget.limitUsd) })}</Text>
              {budget.exhausted ? <StatusPill label={t("Reached")} tone="danger" /> : budget.warning ? <StatusPill label={t("Above 80 %")} tone="warning" /> : null}
            </View>
            <ProgressBar value={Math.min(1, budget.spentUsd / budget.limitUsd)} label={t("{spent} of {limit}", { spent: usd(budget.spentUsd), limit: usd(budget.limitUsd) })} tone={budget.exhausted ? "danger" : budget.warning ? "warning" : undefined} />
            <Text variant="meta" color="text/secondary">{[t(budget.period === "month" ? "Per calendar month" : "In total"), t(budget.hardStop ? "Hard stop" : "Warning only"), budget.allowUnknownCost ? t("Unknown-cost models allowed") : null, budget.includesUnpriced ? t("includes unpriced usage") : null].filter(Boolean).join(" · ")}</Text>
            {props.admin ? (
              <View style={{ flexDirection: "row", gap: space[2] }}>
                <Button size="xs" label={t("Change")} onPress={() => setEditing({ scope: budget.scope, scopeId: budget.scopeId ?? "", limit: String(budget.limitUsd), period: budget.period, hardStop: budget.hardStop, allowUnknownCost: budget.allowUnknownCost })} />
                <Button size="xs" kind="ghost" tone="danger" label={t("Remove")} onPress={() => void connection!.call("jagentchill.provider.budget.remove", { scope: budget.scope, ...(budget.scopeId ? { scopeId: budget.scopeId } : {}) }).then(props.reload).catch((err) => toast.show({ kind: "error", message: reasonOf(err) }))} />
              </View>
            ) : null}
          </View>
        </Card>
      ))}
      {uncounted && !listPrice ? <Text variant="meta" color="text/secondary">{t("Plan-billed and unreported turns do not count toward budgets")}</Text> : null}
      {props.admin ? <Card><Switch value={listPrice} label={t("Count plan-billed turns at list price toward budgets")} onChange={(on) => patch({ "usage.budgetPlanTurnsAtListPrice": on })} errorMessage={reasonOf} /></Card> : null}

      <Text variant="body-medium" level={2} style={{ marginTop: space[2] }}>{t("Plan usage")}</Text>
      <Text variant="meta" color="text/secondary">{t("Limits are reported by each provider. JAgentChill asks only when you turn this on here.")}</Text>
      <Card style={{ gap: space[2] }}>
        <View testID="plan-usage" style={{ gap: space[2] }}>
          {props.admin ? <Switch value={plan?.enabled ?? false} label={t("Plan usage for all connected providers")} onChange={(on) => { if (on) { setConfirmPlan(true); return Promise.reject(new Error("confirm")); } return patch({ "usage.planUsageAll": false }); }} errorMessage={() => t("Confirm to turn plan usage on")} /> : null}
          {!plan ? <SkeletonText lines={3} /> : !plan.enabled ? <Text color="text/secondary">{props.admin ? t("Plan usage is off") : t("Plan usage is off. Ask an admin device to turn this on.")}</Text>
            : plan.error && plan.providers.length === 0 ? <Callout tone="warning" actions={[{ label: t("Retry"), onPress: () => void loadPlan(true) }]}>{t("Unable to load usage")}</Callout>
            : plan.providers.length === 0 ? <Text color="text/secondary">{t("No connected provider reports plan limits to this host.")}</Text> : plan.providers.map((provider) => (
              <View key={provider.providerId} style={{ gap: space[1.5] }}>
                <Text variant="body-medium">{provider.displayName}{provider.planLabel ? ` · ${provider.planLabel}` : ""}</Text>
                {provider.sourceLabel ? <Text variant="meta" color="text/secondary">{provider.sourceLabel}</Text> : null}
                {provider.error ? <Text variant="meta" color="danger/text">{provider.error}</Text> : null}
                {provider.windows.map((window) => (
                  <View key={window.id} style={{ gap: space[0.5] }}>
                    <Text variant="meta">{window.label} · {window.usedPct === undefined ? t("Not reported") : t("{n} % used", { n: Math.round(window.usedPct) })}{window.resetsAt_ms ? ` · ${t("resets {time}", { time: formatDateTime(window.resetsAt_ms) })}` : ""}</Text>
                    <ProgressBar thin value={window.usedPct === undefined ? 0 : window.usedPct / 100} label={window.label} tone={window.tone === "danger" ? "danger" : window.tone === "warning" ? "warning" : undefined} />
                  </View>
                ))}
                {provider.balances.map((balance) => <Text key={balance.id} variant="meta">{balance.label}: {balance.limit !== undefined ? t("{used} of {limit} {unit}", { used: balance.used ?? 0, limit: balance.limit, unit: balance.unit }) : balance.remaining !== undefined ? t("{n} {unit} left", { n: balance.remaining, unit: balance.unit }) : `${balance.used ?? 0} ${balance.unit}`}</Text>)}
                {provider.details.map((detail) => <Text key={detail.label} variant="meta" color="text/secondary">{detail.label}: {detail.value}</Text>)}
              </View>
            ))}
          {plan?.enabled ? <View style={{ alignItems: "flex-start" }}><Button size="xs" label={t("Refresh")} onPress={() => void loadPlan(true)} /></View> : null}
        </View>
      </Card>

      {props.admin ? (
        <>
          <Text variant="body-medium" level={2} style={{ marginTop: space[2] }}>{t("History")}</Text>
          <Card><View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[3] }}>
            <Text color="text/secondary" style={{ flexGrow: 1, flexShrink: 1, flexBasis: 200 }}>{t("Totals, charts and per-session usage start from zero. Limits keep what they counted this period.")}</Text>
            <Button size="sm" kind="ghost" tone="danger" label={t("Reset usage history…")} testID="usage-reset" onPress={() => setReset(true)} />
          </View></Card>
        </>
      ) : null}

      <FormDialog open={editing !== null} title={t("Spending limit")} submitLabel={t("Save limit")} dirty busy={busy} canSubmit={valid} onSubmit={() => void save()} onClose={() => setEditing(null)}>
        {editing ? (
          <>
            <FormField label={t("Applies to")}>{() => <Select label={t("Applies to")} value={editing.scope} onChange={(scope) => setEditing({ ...editing, scope, scopeId: "", period: scope === "global" || scope === "provider" ? "month" : "total" })} options={Object.entries(SCOPE_LABEL).map(([value, label]) => ({ value, label: t(label) }))} />}</FormField>
            {editing.scope !== "global" ? <FormField label={t(SCOPE_LABEL[editing.scope])}>{() => <Select label={t(SCOPE_LABEL[editing.scope])} value={editing.scopeId || null} placeholder={t("Choose…")} onChange={(scopeId) => setEditing({ ...editing, scopeId })} options={targets} />}</FormField> : null}
            <FormField label={t("Limit in USD")} error={editing.limit && !(limit >= 0.01 && limit <= 100_000) ? t("Between 0.01 and 100,000") : undefined}>{(ids) => <Input testID="budget-limit" prefix="$" inputMode="decimal" value={editing.limit} onChangeText={(value) => setEditing({ ...editing, limit: value })} labelledBy={ids.labelledBy} describedBy={ids.describedBy} />}</FormField>
            {editing.scope === "project" || editing.scope === "session" ? <FormField label={t("Period")}>{() => <Select label={t("Period")} value={editing.period} onChange={(period) => setEditing({ ...editing, period })} options={[{ value: "total", label: t("In total") }, ...(editing.scope === "project" ? [{ value: "month", label: t("Per calendar month") }] : [])]} />}</FormField> : null}
            <Switch value={editing.hardStop} label={t("Hard stop: refuse the next message when the limit is reached")} onChange={(on) => setEditing({ ...editing, hardStop: on })} />
            <Switch value={editing.allowUnknownCost} label={t("Allow unknown-cost models")} onChange={(on) => setEditing({ ...editing, allowUnknownCost: on })} />
          </>
        ) : null}
      </FormDialog>
      <DestructiveConfirmDialog open={confirmPlan} title={t("Show plan usage?")} confirmLabel={t("Turn on")} onClose={() => setConfirmPlan(false)}
        description={t("{host} will use the sign-ins stored on that computer, including those of the CLIs installed there, to ask each connected provider for your plan limits. Nothing is changed in those sign-ins and nothing is sent anywhere else.", { host: props.hostName })}
        onConfirm={() => { setConfirmPlan(false); void patch({ "usage.planUsageAll": true }).catch(() => undefined); }} />
      <DestructiveConfirmDialog open={reset} title={t("Reset usage history?")} confirmLabel={t("Reset")} irreversible confirmWord={props.hostName} onClose={() => setReset(false)}
        description={t("Totals, charts and per-session usage on {host} will start from zero. This cannot be undone.", { host: props.hostName })}
        onConfirm={() => { setReset(false); void connection!.call("jagentchill.usage.history.reset", { confirm: true, scope: "agent" }).then(async () => { toast.show({ kind: "success", message: t("Usage history reset") }); await props.reload(); }).catch((err) => toast.show({ kind: "error", message: reasonOf(err) })); }} />
    </View>
  );
}
