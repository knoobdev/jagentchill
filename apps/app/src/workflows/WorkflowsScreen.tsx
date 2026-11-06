import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { relativeTime } from "@jagentchill/app-core";
import type { WorkflowDocument, WorkflowListItem, WorkflowRunRecord } from "@jagentchill/protocol";
import { Badge, Button, DestructiveConfirmDialog, EmptyState, FormDialog, FormField, IconButton, Input, NoResultsState, SearchField, Select, LoadingSkeleton, Skeleton, StatusPill, Tabs, Table, Text, compactScale, space, useTheme, useToast, type Column, type MenuItem } from "@jagentchill/ui";
import { useHost } from "../host";
import { useT } from "../locale";
import { saveBlob } from "../platform/media";
import { pickFiles } from "../platform/store";
import { Screen, useHostScopeState } from "../shell/Shell";
import { failureOf, useWorkflowCalls, useWorkflowIndex } from "./data";
import { readFileText } from "./platform";
import { ORIGIN_LABELS, RUN_STATUS_LABELS, STATUS_TONES, clock } from "./strings";
import { useRunStarter } from "./RunSetup";

const PAGE = 50;
/** The status of a run as a pill with a shape and text: never by colour alone. */
export function RunStatus(props: { status: string; label: string }) {
  return <View testID="run-status" {...({ dataSet: { status: props.status } } as object)}><StatusPill label={props.label} tone={STATUS_TONES[props.status] ?? "neutral"} active={props.status === "running"} /></View>;
}

/** The Workflows destination: the workflows of the host and their runs, with search, filters and the row actions. */
export function WorkflowsScreen() {
  const t = useT(), theme = useTheme(), router = useRouter(), toast = useToast();
  const params = useLocalSearchParams<{ tab?: string }>();
  const { host, can } = useHost();
  const scope = useHostScopeState(t("Workflows"));
  const index = useWorkflowIndex();
  const calls = useWorkflowCalls();
  const [tab, setTab] = useState(params.tab === "runs" ? "runs" : "workflows");
  const [query, setQuery] = useState("");
  const [origin, setOrigin] = useState("all");
  const [status, setStatus] = useState("all");
  const [shown, setShown] = useState(PAGE);
  const [rename, setRename] = useState<{ item: WorkflowListItem; name: string } | null>(null);
  const [remove, setRemove] = useState<WorkflowListItem | null>(null);
  const [removeRun, setRemoveRun] = useState<WorkflowRunRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const mayWrite = can("jagentchill.projects.write"), mayRun = can("jagentchill.generation.run");
  const base = `/h/${host?.gatewayId}/workflows`;
  const now = Date.now();
  const fail = (error: unknown) => toast.show({ kind: "error", message: failureOf(error).message });
  // (A hook: it stands before every early return of this screen.)
  const starter = useRunStarter({ onStarted: (made) => router.push(`/h/${host?.gatewayId}/workflows/runs/${made.id}` as never), onError: (error) => fail(error) });

  const workflows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (index.workflows ?? []).filter((item) => (origin === "all" || item.origin === origin) && (!needle || `${item.name} ${item.description}`.toLowerCase().includes(needle)));
  }, [index.workflows, query, origin]);
  const runs = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (index.runs ?? []).filter((run) => (status === "all" || run.status === status) && (!needle || `${run.workflowName} #${run.number}`.toLowerCase().includes(needle)));
  }, [index.runs, query, status]);

  if (scope) return <Screen title={t("Workflows")}>{scope}</Screen>;

  const open = (id: string) => router.push(`${base}/${id}` as never);
  const openRun = (id: string) => router.push(`${base}/runs/${id}` as never);
  const create = async () => { setBusy(true); try { open((await calls.create()).document.id); } catch (error) { fail(error); } finally { setBusy(false); } };
  const importFile = async () => { const [file] = await pickFiles(".jcworkflow,.json,application/json", false); if (!file) return; try { open((await calls.importFile(await readFileText(file))).document.id); } catch (error) { fail(error); } };
  const exportFile = async (id: string) => { try { const file = await calls.exportFile(id); saveBlob(file.fileName, new Blob([file.text], { type: file.mimeType })); } catch (error) { fail(error); } };
  const run = async (item: WorkflowListItem) => {
    try {
      const got = await calls.get(item.id);
      const errors = got.validation.errors.length;
      if (errors) return void toast.show({ kind: "error", message: errors === 1 ? t("Fix 1 problem to run") : t("Fix {n} problems to run", { n: errors }) });
      await starter.begin(got.document);
    } catch (error) { fail(error); }
  };

  const menu = (item: WorkflowListItem): MenuItem[] => [
    { id: "open", label: t("Open"), icon: "ext", onSelect: () => open(item.id) },
    { id: "run", label: t("Run"), icon: "play", disabled: !mayRun, onSelect: () => void run(item) },
    { id: "duplicate", label: t("Duplicate"), icon: "copy", disabled: !mayWrite, onSelect: () => void calls.duplicate(item.id).then(() => toast.show({ kind: "success", message: t("Workflow duplicated") })).catch(fail) },
    { id: "rename", label: t("Rename"), icon: "pencil", disabled: !mayWrite, onSelect: () => setRename({ item, name: item.name }) },
    { id: "export", label: t("Export"), icon: "export", onSelect: () => void exportFile(item.id) },
    { type: "separator" },
    { id: "delete", label: t("Delete"), icon: "trash", danger: true, disabled: !mayWrite, onSelect: () => setRemove(item) },
  ];
  const columns: Column<WorkflowListItem>[] = [
    { id: "name", title: t("Name"), flex: 2, text: (row) => row.name, render: (row) => <Text variant="body-medium" numberOfLines={1} testID={`workflow-row-${row.name}`}>{row.name}</Text> },
    { id: "origin", title: t("Origin"), width: 110, text: (row) => t(ORIGIN_LABELS[row.origin] ?? "You"), render: (row) => <Badge label={t(ORIGIN_LABELS[row.origin] ?? "You")} tone="neutral" /> },
    { id: "steps", title: t("Steps"), width: 70, numeric: true, text: (row) => String(row.nodeCount) },
    { id: "problems", title: t("Problems"), width: 90, numeric: true, text: (row) => (row.problemCount ? String(row.problemCount) : "—"), render: (row) => (row.problemCount ? <Badge count={row.problemCount} tone="danger" accessibilityLabel={t("{n} problems", { n: row.problemCount })} /> : <Text color="text/tertiary">—</Text>) },
    { id: "last", title: t("Last run"), width: 210, text: (row) => (row.lastRun ? `${t(RUN_STATUS_LABELS[row.lastRun.status])} · ${relativeTime(row.lastRun.started_ms ?? row.lastRun.created_ms, now, theme.locale)}` : t("Never")),
      render: (row) => (row.lastRun ? <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}><RunStatus status={row.lastRun.status} label={t(RUN_STATUS_LABELS[row.lastRun.status])} /><Text variant="meta" color="text/secondary">{relativeTime(row.lastRun.started_ms ?? row.lastRun.created_ms, now, theme.locale)}</Text></View> : <Text color="text/secondary">{t("Never")}</Text>) },
    { id: "updated", title: t("Updated"), width: 130, text: (row) => relativeTime(row.updated_ms, now, theme.locale) },
  ];
  const runMenu = (record: WorkflowRunRecord): MenuItem[] => [
    { id: "open", label: t("Open"), icon: "ext", onSelect: () => openRun(record.id) },
    { id: "workflow", label: t("Open workflow"), icon: "flow", disabled: !(index.workflows ?? []).some((item) => item.id === record.workflowId), onSelect: () => open(record.workflowId) },
    { type: "separator" },
    { id: "delete", label: t("Delete"), icon: "trash", danger: true, disabled: !mayRun || !["succeeded", "failed", "cancelled"].includes(record.status), onSelect: () => setRemoveRun(record) },
  ];
  const runColumns: Column<WorkflowRunRecord>[] = [
    { id: "run", title: t("Run"), flex: 2, text: (row) => `${row.workflowName} #${row.number}`, render: (row) => <Text variant="body-medium" numberOfLines={1} testID={`run-row-${row.workflowName}-${row.number}`}>{`${row.workflowName} #${row.number}`}</Text> },
    { id: "status", title: t("Status"), width: 150, text: (row) => t(RUN_STATUS_LABELS[row.status]), render: (row) => <RunStatus status={row.status} label={t(RUN_STATUS_LABELS[row.status])} /> },
    { id: "origin", title: t("Origin"), width: 120, text: (row) => t(ORIGIN_LABELS[row.origin] ?? "You") },
    { id: "started", title: t("Started"), width: 130, text: (row) => relativeTime(row.started_ms ?? row.created_ms, now, theme.locale) },
    { id: "duration", title: t("Duration"), width: 100, numeric: true, text: (row) => (row.started_ms ? clock((row.finished_ms ?? now) - row.started_ms) : "—") },
  ];
  const loading = index.workflows === null && !index.error;
  const none = index.workflows !== null && index.workflows.length === 0;
  const tabs = [{ id: "workflows", label: t("Workflows"), count: index.workflows?.length ?? 0 }, { id: "runs", label: t("Runs") }];
  return (
    <Screen title={t("Workflows")} actions={theme.compact ? <IconButton icon="plus" label={t("New workflow")} testID="workflow-new" disabled={!mayWrite} onPress={() => void create()} /> : null}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: theme.compact ? compactScale.space.side : space[6], gap: theme.compact ? compactScale.space.gapMedium : space[3], maxWidth: 1040, width: "100%", alignSelf: "center" }}>
        {!theme.compact ? <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space[2], flexWrap: "wrap" }}>
          <View style={{ flex: 1, minWidth: 200, gap: space[1] }}>
            <Text variant="h1" level={1}>{t("Workflows")}</Text>
            <Text color="text/secondary">{t("Chain agents, approvals and branches into a pipeline you can run again.")}</Text>
          </View>
          <Button kind="ghost" icon="download" label={t("Import")} disabled={!mayWrite} testID="workflow-import" onPress={() => void importFile()} />
          <Button kind="strong" icon="plus" label={t("New workflow")} disabled={!mayWrite} loading={busy} testID="workflow-new" onPress={() => void create()} />
        </View> : null}
        {index.error && index.workflows === null ? (
          <EmptyState icon="warn" title={t("Unable to load workflows")} description={failureOf(index.error).message} actions={[{ label: t("Retry"), onPress: index.reload }]} />
        ) : loading ? <LoadingSkeleton style={{ gap: space[1] }}>{Array.from({ length: 6 }, (_, at) => <Skeleton key={at} height={40} />)}</LoadingSkeleton> : (
          <>
            <View style={{ flexDirection: theme.compact ? "column" : "row", alignItems: theme.compact ? "stretch" : "center", gap: theme.compact ? compactScale.space.gapSmall : space[2] }}>
              <View style={{ flex: 1, minWidth: 0 }}><Tabs id="workflows" label={t("Workflows")} items={tabs} value={tab} onChange={(next) => { setTab(next); setShown(PAGE); }} /></View>
              <SearchField label={tab === "runs" ? t("Search runs") : t("Search workflows")} placeholder={tab === "runs" ? t("Search runs") : t("Search workflows")} size="sm" value={query} onChangeText={setQuery} style={theme.compact ? { width: "100%" } : { width: 220 }} />
              {tab === "runs"
                ? <Select size="sm" width={150} label={t("Status")} value={status} onChange={setStatus} options={[{ value: "all", label: t("All statuses") }, ...Object.keys(RUN_STATUS_LABELS).filter((value) => value !== "draft").map((value) => ({ value, label: t(RUN_STATUS_LABELS[value as keyof typeof RUN_STATUS_LABELS]) }))]} />
                : <Select size="sm" width={150} label={t("Origin")} value={origin} onChange={setOrigin} options={[{ value: "all", label: t("All origins") }, { value: "user", label: t("You") }, { value: "agent", label: t("Agent") }, { value: "import", label: t("Imported") }]} />}
            </View>
            {tab === "workflows" ? (
              none ? <EmptyState icon="flow" title={t("No workflows yet")} description={t("A workflow is a graph of steps: agents, approvals, branches and loops.")} actions={mayWrite ? [{ label: t("New workflow"), kind: "strong", onPress: () => void create() }, { label: t("Import"), onPress: () => void importFile() }] : []} />
                : workflows.length === 0 ? <NoResultsState title={t("No workflows match")} query={query} onClear={() => { setQuery(""); setOrigin("all"); }} />
                : <Table label={t("Workflows")} columns={columns} rows={workflows.slice(0, shown)} rowKey={(row) => row.id} rowMenu={menu} onRowPress={(row) => open(row.id)} />
            ) : (index.runs ?? []).length === 0 ? <EmptyState icon="play" title={t("No runs yet")} description={t("Run a workflow to see it here.")} />
              : runs.length === 0 ? <NoResultsState title={t("No runs match")} query={query} onClear={() => { setQuery(""); setStatus("all"); }} />
              : <Table label={t("Runs")} columns={runColumns} rows={runs.slice(0, shown)} rowKey={(row) => row.id} rowMenu={runMenu} onRowPress={(row) => openRun(row.id)} />}
            {(tab === "workflows" ? workflows.length : runs.length) > shown ? <View style={{ alignItems: "center" }}><Button kind="ghost" size="sm" label={t("Show more")} onPress={() => setShown(shown + PAGE)} /></View> : null}
          </>
        )}
      </ScrollView>
      {starter.dialog}
      <FormDialog open={!!rename} title={t("Rename workflow")} submitLabel={t("Rename")} dirty={!!rename && rename.name !== rename.item.name} canSubmit={!!rename?.name.trim()} onClose={() => setRename(null)}
        onSubmit={() => { const target = rename; setRename(null); if (target) void calls.rename(target.item.id, target.name.trim()).catch(fail); }}>
        <FormField label={t("Name")}>{() => <Input value={rename?.name ?? ""} maxLength={80} autoFocus onChangeText={(name) => rename && setRename({ ...rename, name })} />}</FormField>
      </FormDialog>
      <DestructiveConfirmDialog open={!!remove} title={remove ? t("Delete '{name}'?", { name: remove.name }) : ""} description={t("Its runs stay in the run history.")} confirmLabel={t("Delete")} onClose={() => setRemove(null)}
        onConfirm={() => { const target = remove; setRemove(null); if (target) void calls.remove(target.id).then(() => toast.show({ kind: "success", message: t("Workflow deleted") })).catch(fail); }} />
      <DestructiveConfirmDialog open={!!removeRun} title={t("Delete this run?")} description={t("Its log and history are removed.")} confirmLabel={t("Delete")} onClose={() => setRemoveRun(null)}
        onConfirm={() => { const target = removeRun; setRemoveRun(null); if (target) void calls.removeRun(target.id).then(index.reload).catch(fail); }} />
    </Screen>
  );
}
