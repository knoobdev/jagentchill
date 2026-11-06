import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { exporting, formatDateTime, formatDay } from "@jagentchill/app-core";
import { Button, Callout, Checkbox, ConfirmDialog, EmptyState, IconButton, MenuButton, ProgressBar, RequiresHostState, SearchField, Select, SkeletonList, Tabs, Text, radius, space, useTheme, useToast, type MenuItem } from "@jagentchill/ui";
import { useHost } from "../../host";
import { useT } from "../../locale";
import { Screen } from "../../shell/Shell";
import { requestExportAgain, useExports, useHostCapabilities } from "./hooks";
import { ExportAnnouncer, JobDialog, stateLabel } from "./JobViews";
import { copyToClipboard, download, exportPlatform } from "./platform";
import { usePrefValue } from "./prefs";
import { exportService } from "./service";

type Job = exporting.ExportJob;
export const EXPORT_TABS = ["queue", "history", "links"] as const;
export type ExportTab = (typeof EXPORT_TABS)[number];
export const isExportTab = (value: unknown): value is ExportTab => (EXPORT_TABS as readonly string[]).includes(value as string);

/** The Exports screen: the queue of this device (and of the host), the history, and the share links. */
export function ExportsScreen(props: { tab: ExportTab }) {
  const t = useT();
  const theme = useTheme();
  const router = useRouter();
  const toast = useToast();
  const params = useLocalSearchParams<{ job?: string }>();
  const state = useExports();
  const host = useHostCapabilities();
  const { connection } = useHost();
  const [userPresets, setUserPresets] = usePrefValue("presets");
  const [openJob, setOpenJob] = useState<string | null>(typeof params.job === "string" ? params.job : null);
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<exporting.JobState | "all">("all");
  const [typeFilter, setTypeFilter] = useState<exporting.ExportType | "all">("all");
  const [removing, setRemoving] = useState<Job | null>(null);
  const [deleteFile, setDeleteFile] = useState(false);
  const [links, setLinks] = useState<exporting.ShareLink[] | null>(null);
  useEffect(() => { if (typeof params.job === "string") setOpenJob(params.job); }, [params.job]);
  // Host jobs are listed from the host; events are not replayed, so the list is read again on every connection.
  const [hostRead, setHostRead] = useState<"loading" | "ready" | "error">("loading");
  const [linksFailed, setLinksFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!connection || !host?.remoteExport) { exportService.setHostJobs([]); setHostRead("ready"); return; }
    let cancelled = false;
    setHostRead("loading");
    connection.call<{ jobs: exporting.RemoteJob[] }>(exporting.EXPORT_RPC.list, { limit: 50 }).then((answer) => { if (!cancelled) { exportService.setHostJobs(answer.jobs.map((job) => exporting.hostJobRow(job, { hostName: host.name }))); setHostRead("ready"); } }, () => { if (!cancelled) setHostRead("error"); });
    return () => { cancelled = true; };
  }, [connection, host?.remoteExport, host?.name, attempt]);
  useEffect(() => {
    setLinksFailed(false);
    if (props.tab !== "links" || !connection || !host?.shareLinks) { setLinks(null); return; }
    let cancelled = false;
    connection.call<{ links: exporting.ShareLink[] }>(exporting.EXPORT_RPC.shareList, { limit: 50 }).then((answer) => { if (!cancelled) setLinks(answer.links); }, () => { if (!cancelled) setLinksFailed(true); });
    return () => { cancelled = true; };
  }, [props.tab, connection, host?.shareLinks, attempt]);
  // Waiting for the queue of this device or for the host's list shows a skeleton shaped like the rows; a failed read shows its error with a retry.
  const reading = !state.ready || hostRead === "loading";
  const retry = <Callout tone="danger" actions={[{ label: t("Retry"), onPress: () => setAttempt((count) => count + 1) }]}>{t("The export list could not be read from the host.")}</Callout>;
  const rowsSkeleton = <SkeletonList rows={4} meta testID="exports-skeleton" style={{ paddingHorizontal: space[2] }} />;

  const queue = [...state.queue.jobs, ...state.hostJobs.filter((job) => !exporting.isFinished(job))];
  const history = exporting.filterHistory([...state.queue.history, ...state.hostJobs.filter(exporting.isFinished)], { query, state: stateFilter, type: typeFilter });
  const again = (job: Job) => { requestExportAgain(job.projectId, job.settings); router.push(`/editor/${job.projectId}` as never); };
  const copyPreset = (job: Job) => {
    const result = exporting.saveUserPreset(userPresets, `${job.projectName} ${formatDay(job.created_ms)}`.slice(0, 40), job.settings, { newId: () => job.id });
    if (result.state === "saved") { setUserPresets(result.presets); toast.show({ kind: "success", message: t("Preset saved") }); } else toast.show({ kind: "warning", message: t(result.state === "duplicate" ? "A preset with this name exists" : result.message) });
  };
  const downloadJob = async (job: Job) => { const file = await exportService.file(job.id); if (file && job.output) download(file, job.output.fileName); else toast.show({ kind: "warning", message: t("File missing") }); };
  const historyMenu = (job: Job): MenuItem[] => exporting.historyActions(job, exportPlatform).map((action): MenuItem | null => (
    action === "open-view" || action === "view-details" ? { id: action, label: t(action === "open-view" ? "Open" : "View details"), onSelect: () => setOpenJob(job.id) }
      : action === "download" ? { id: action, label: t("Download"), icon: "download", onSelect: () => void downloadJob(job) }
      : action === "retry" ? { id: action, label: t("Retry"), icon: "refresh", onSelect: () => setOpenJob(job.id) }
      : action === "export-again" ? { id: action, label: t("Export again"), icon: "export", onSelect: () => again(job) }
      : action === "copy-settings" ? { id: action, label: t("Copy settings as preset"), icon: "copy", onSelect: () => copyPreset(job) }
      : action === "remove" ? { id: action, label: t("Remove from history"), icon: "trash", danger: true, onSelect: () => { setDeleteFile(false); setRemoving(job); } } : null
  )).filter((item): item is MenuItem => item !== null);
  const row = (job: Job, children: React.ReactNode) => (
    <View key={job.id} testID={`export-row-${job.id}`} role="listitem" style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: space[3], rowGap: space[1], minHeight: 56, paddingVertical: space[2], paddingHorizontal: space[4], borderBottomWidth: 1, borderBottomColor: theme.color("border/hairline"), backgroundColor: openJob === job.id ? theme.color("bg/hover") : "transparent" }}>
      {children}
    </View>
  );
  const titleOf = (job: Job) => (
    <View style={theme.compact ? { width: "100%" } : { flex: 1, minWidth: 0 }}>
      <Text variant="body-medium" numberOfLines={1}>{job.output?.fileName || job.fileName || job.projectName}</Text>
      <Text variant="meta" color="text/secondary" numberOfLines={1}>{`${job.projectName} · ${job.settingsSummary} · ${job.target === "host" ? t("Host: {name}", { name: job.hostName ?? "" }) : t("This device")}`}</Text>
    </View>
  );
  return (
    <Screen title={t("Exports")}>
      <ExportAnnouncer />
      <View style={{ paddingHorizontal: space[4], paddingTop: space[2] }}>
        <Tabs id="exports" label={t("Exports")} value={props.tab} onChange={(tab) => router.replace(`/exports/${tab}` as never)}
          items={[{ id: "queue", label: t("Queue"), count: queue.length || undefined }, { id: "history", label: t("History") }, { id: "links", label: t("Links") }]} />
      </View>
      {props.tab === "queue" ? (
        queue.length === 0 && reading ? rowsSkeleton : queue.length === 0 && hostRead === "error" ? <View style={{ padding: space[4] }}>{retry}</View>
        : queue.length === 0 ? <EmptyState icon="export" title={t("Nothing is exporting")} description={t("Exports you start in the editor run here, one at a time.")} actions={[{ label: t("Go to projects"), onPress: () => router.push("/projects") }]} /> : (
          <ScrollView testID="export-queue" role="list" aria-label={t("Queue")}>
            {queue.map((job) => {
              const waiting = job.state === "queued" && job.target === "device";
              return row(job, <>
                {titleOf(job)}
                <View style={{ width: theme.compact ? 140 : 220, gap: space[1] }}>
                  <View style={{ flexDirection: "row", gap: space[2] }}><Text variant="meta" testID={`export-row-state-${job.id}`} style={{ flex: 1 }}>{job.state === "running" ? t(job.stage) : t(stateLabel[job.state])}</Text><Text variant="meta" color="text/secondary" tabular>{t("{n}%", { n: Math.floor(job.percent) })}</Text></View>
                  <ProgressBar thin value={job.percent} label={t("Export progress")} />
                </View>
                {waiting ? <IconButton icon="chev-u" size="sm" label={t("Move up")} disabled={!exporting.canMove(state.queue, job.id, -1)} onPress={() => exportService.move(job.id, -1)} /> : null}
                {waiting ? <IconButton icon="chev-d" size="sm" label={t("Move down")} disabled={!exporting.canMove(state.queue, job.id, 1)} onPress={() => exportService.move(job.id, 1)} /> : null}
                {job.target === "device" && job.state === "running" && job.stage !== "Finalising" && job.stage !== "Saving" && job.type !== "still" && job.type !== "captions" ? <IconButton icon="pause" size="sm" label={t("Pause")} onPress={() => exportService.pause(job.id)} /> : null}
                {job.state === "paused" ? <IconButton icon="play" size="sm" label={t("Resume")} onPress={() => exportService.resume(job.id)} /> : null}
                <Button size="sm" kind="ghost" label={t("Details")} testID={`export-row-open-${job.id}`} onPress={() => setOpenJob(job.id)} />
                <IconButton icon="x" size="sm" label={waiting ? t("Remove from queue") : t("Cancel export")} testID={`export-row-cancel-${job.id}`} onPress={() => (job.target === "host" ? void connection?.call(exporting.EXPORT_RPC.cancel, { jobId: job.hostJobId }).catch(() => undefined) : exporting.cancelNeedsConfirmation(job) ? setOpenJob(job.id) : exportService.cancel(job.id))} />
              </>);
            })}
          </ScrollView>
        )
      ) : null}
      {props.tab === "history" ? (
        <View style={{ flex: 1, minHeight: 0 }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[2], paddingHorizontal: space[4], paddingVertical: space[2] }}>
            <View style={{ flex: 1, minWidth: 200, maxWidth: 360 }}><SearchField label={t("Search exports")} placeholder={t("Search by project or file name…")} value={query} onChangeText={setQuery} /></View>
            <Select size="sm" width={150} label={t("State")} value={stateFilter} onChange={(value) => setStateFilter(value as exporting.JobState | "all")} options={[{ value: "all", label: t("All states") }, { value: "succeeded", label: t("Finished") }, { value: "failed", label: t("Failed") }, { value: "cancelled", label: t("Cancelled") }]} />
            <Select size="sm" width={170} label={t("Type")} value={typeFilter} onChange={(value) => setTypeFilter(value as exporting.ExportType | "all")} options={[{ value: "all", label: t("All types") }, ...exporting.EXPORT_TYPES.map((type) => ({ value: type, label: t(exporting.EXPORT_TYPE_LABELS[type]) }))]} />
          </View>
          {state.queue.history.length === 0 && state.hostJobs.length === 0 && reading ? rowsSkeleton : state.queue.history.length === 0 && state.hostJobs.length === 0 && hostRead === "error" ? <View style={{ padding: space[4] }}>{retry}</View>
            : state.queue.history.length === 0 && state.hostJobs.length === 0 ? <EmptyState icon="clock" title={t("No exports yet")} actions={[{ label: t("Go to projects"), onPress: () => router.push("/projects") }]} />
            : history.length === 0 ? <EmptyState icon="search" title={t("No results found")} actions={[{ label: t("Clear filters"), onPress: () => { setQuery(""); setStateFilter("all"); setTypeFilter("all"); } }]} /> : (
              <ScrollView testID="export-history" role="list" aria-label={t("History")}>
                {history.map((job) => row(job, <>
                  {titleOf(job)}
                  <View style={{ width: theme.compact ? 110 : 150 }}>
                    <Text variant="meta" color={job.state === "failed" ? "danger/text" : "text/primary"} testID={`export-row-state-${job.id}`}>{job.fileMissing ? t("File missing") : t(stateLabel[job.state])}</Text>
                    <Text variant="meta" color="text/secondary" numberOfLines={1}>{job.error ? job.error.code : job.output ? exporting.formatFileSize(job.output.size) : ""}</Text>
                  </View>
                  {theme.compact ? <View style={{ flex: 1 }} /> : <Text variant="meta" color="text/secondary" style={{ width: 150 }} numberOfLines={1}>{formatDateTime(job.finished_ms ?? job.created_ms)}</Text>}
                  <Button size="sm" kind="ghost" label={t("Details")} testID={`export-row-open-${job.id}`} onPress={() => setOpenJob(job.id)} />
                  <MenuButton label={t("Actions")} kind="ghost" size="sm" icon="more" items={historyMenu(job)} />
                </>))}
              </ScrollView>
            )}
        </View>
      ) : null}
      {props.tab === "links" ? (
        !host ? <View testID="export-links-no-host" style={{ flex: 1 }}><RequiresHostState feature={t(exporting.SHARE_NO_HOST)} onConnect={() => router.push("/devices" as never)} /></View>
          : !host.shareLinks ? <EmptyState icon="link" title={t("This host does not offer share links")} description={t("Share links need a host that advertises them.")} />
          : linksFailed ? <View style={{ padding: space[4] }}><Callout tone="danger" actions={[{ label: t("Retry"), onPress: () => setAttempt((count) => count + 1) }]}>{t("The share links could not be read from the host.")}</Callout></View>
          : links === null ? rowsSkeleton
          : links.length === 0 ? <EmptyState icon="link" title={t("No share links")} description={t("Create a link from a finished export.")} />
          : (
            <ScrollView testID="export-links" role="list" aria-label={t("Links")}>
              {links.map((link) => (
                <View key={link.linkId} role="listitem" style={{ flexDirection: "row", alignItems: "center", gap: space[3], minHeight: 56, paddingHorizontal: space[4], borderBottomWidth: 1, borderBottomColor: theme.color("border/hairline"), borderRadius: radius.none }}>
                  <View style={{ flex: 1, minWidth: 0 }}><Text variant="body-medium" numberOfLines={1}>{link.fileName}</Text><Text variant="meta" color="text/secondary" numberOfLines={1}>{t("Created {created} · expires {expires} · {n} views", { created: formatDateTime(link.created_ms), expires: formatDateTime(link.expires_ms), n: link.views })}</Text></View>
                  <Button size="sm" kind="ghost" icon="copy" label={t("Copy link")} onPress={() => void copyToClipboard(link.url).then(() => toast.show({ kind: "success", message: t("Link copied") }))} />
                  <Button size="sm" kind="ghost" tone="danger" label={t("Revoke")} onPress={() => void connection?.call(exporting.EXPORT_RPC.shareRevoke, { linkId: link.linkId }).then(() => setLinks((current) => (current ?? []).filter((entry) => entry.linkId !== link.linkId)), () => toast.show({ kind: "error", message: t("The link could not be revoked") }))} />
                </View>
              ))}
            </ScrollView>
          )
      ) : null}
      {openJob ? <JobDialog jobId={openJob} onClose={() => { setOpenJob(null); if (params.job) router.setParams({ job: undefined } as never); }} /> : null}
      <ConfirmDialog open={removing !== null} title={t("Remove from history?")} confirmLabel={t("Remove")} onClose={() => setRemoving(null)}
        onConfirm={() => { if (removing) { if (removing.target === "host") void connection?.call(exporting.EXPORT_RPC.delete, { jobId: removing.hostJobId }).catch(() => undefined); else exportService.remove(removing.id, deleteFile); } setRemoving(null); }}>
        {removing?.output?.privateName ? <Checkbox label={t("Also delete the file this app holds")} checked={deleteFile} onChange={setDeleteFile} /> : null}
      </ConfirmDialog>
    </Screen>
  );
}

