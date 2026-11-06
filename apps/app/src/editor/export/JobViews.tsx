import { useRouter } from "expo-router";
import { useEffect, useState, type ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { exporting, formatDateTime } from "@jagentchill/app-core";
import { uuidV4 } from "@jagentchill/editor-core";
import { Announce, Button, Callout, Checkbox, ConfirmDialog, FormField, Icon, Input, Modal, ProgressBar, Segmented, Select, Tap, Text, Textarea, radius, space, useTheme, useToast } from "@jagentchill/ui";
import { useHost } from "../../host";
import { useT } from "../../locale";
import { useDevice } from "../../state";
import { useExports, useHostCapabilities } from "./hooks";
import { appVersion, canShareFile, copyToClipboard, download, exportPlatform, freeBytes, openPage, platformName, shareFile } from "./platform";
import { exportService } from "./service";

type Job = exporting.ExportJob;
const line = (t: ReturnType<typeof useT>, value: { text: string; values?: Record<string, string | number> }) => t(value.text, value.values);
export const stateLabel: Record<exporting.JobState, string> = { queued: "Queued", running: "Running", paused: "Paused", succeeded: "Finished", failed: "Failed", cancelled: "Cancelled" };

/** Progress of a running, paused or queued job: stage, percentage, frames, elapsed time, time remaining, and its controls. */
export function JobProgress(props: { job: Job; compact?: boolean }) {
  const t = useT();
  const { job } = props;
  const [confirming, setConfirming] = useState(false);
  const cancel = () => (exporting.cancelNeedsConfirmation(job) ? setConfirming(true) : exportService.cancel(job.id));
  const frames = job.frameCount > 0 ? t("{done} of {total} frames", { done: job.framesDone, total: job.frameCount }) : null;
  const remaining = job.state === "running" && job.eta_ms != null ? line(t, exporting.remainingLabel(job.eta_ms)) : null;
  const pauseUnavailable = job.state === "running" && job.frameCount > 0 && job.framesDone >= job.frameCount;
  // The clock keeps going while the job runs, also in stages that send no progress (finalising, saving): a time that
  // stops reads as a frozen export.
  const [, tick] = useState(0);
  useEffect(() => { if (job.state !== "running") return; const id = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(id); }, [job.state]);
  const elapsed = job.state === "running" && job.started_ms != null ? Math.max(job.elapsed_ms, Date.now() - job.started_ms) : job.elapsed_ms;
  return (
    <View testID="export-progress-view" style={{ gap: space[2] }}>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: space[2] }}>
        <Text variant="body-medium" testID="export-stage">{job.state === "paused" ? t("Paused") : job.state === "queued" ? t("Queued") : t(job.stage)}</Text>
        <Text variant="meta" color="text/secondary" tabular testID="export-percent">{t("{n}%", { n: Math.floor(job.percent) })}</Text>
        <View style={{ flex: 1 }} />
        {job.target === "device" && job.state === "running" && job.type !== "still" && job.type !== "captions" ? <Button size="sm" kind="ghost" icon="pause" label={t("Pause")} disabled={pauseUnavailable} testID="export-pause" onPress={() => exportService.pause(job.id)} /> : null}
        {job.state === "paused" ? <Button size="sm" kind="ghost" icon="play" label={t("Resume")} testID="export-resume" onPress={() => exportService.resume(job.id)} /> : null}
        <Button size="sm" kind="ghost" label={t("Cancel export")} testID="export-cancel" onPress={cancel} />
      </View>
      <ProgressBar value={job.state === "queued" ? 0 : job.percent} label={t("Export progress")} />
      <Text variant="meta" color="text/secondary" tabular testID="export-progress">
        {[frames, t("Elapsed {time}", { time: exporting.elapsedText(elapsed) }), remaining].filter(Boolean).join(" · ")}
      </Text>
      {pauseUnavailable ? <Text variant="meta" color="text/secondary" testID="export-pause-reason">{t("Frames are complete; there is nothing left to pause.")}</Text> : null}
      {job.notice ? <Text variant="meta" color="text/secondary" testID="export-notice">{t(job.notice)}</Text> : null}
      {job.detail && job.state === "queued" ? <Text variant="meta" color="text/secondary">{t(job.detail)}</Text> : null}
      {props.compact ? null : <Text variant="meta" color="text/secondary">{t("You can close this dialog; the export keeps running.")}</Text>}
      <ConfirmDialog open={confirming} title={t(exporting.CANCEL_CONFIRMATION)} confirmLabel={t("Cancel export")} onClose={() => setConfirming(false)} onConfirm={() => { setConfirming(false); exportService.cancel(job.id); }} />
    </View>
  );
}

const Row = (props: { label: string; children: ReactNode }) => (
  <View style={{ flexDirection: "row", alignItems: "center", minHeight: 22, gap: space[2] }}>
    <Text variant="meta" color="text/secondary" style={{ width: 96 }}>{props.label}</Text>
    <View style={{ flex: 1, minWidth: 0 }}>{typeof props.children === "string" ? <Text variant="meta" selectable>{props.children}</Text> : props.children}</View>
  </View>
);
export type PublishCaption = { title: string; description: string; onChange(next: { title: string; description: string }): void };

/** The completion view of a succeeded job: what was written, the export summary, and where the file can go from here. */
export function JobCompletion(props: { job: Job; publish?: PublishCaption; /** The credit lines the sounds of the exported scene ask for (the Licence check's "Copy credits"), when there are any. */ credits?: string; onExportAgain?(): void }) {
  const t = useT();
  const toast = useToast();
  const host = useHostCapabilities();
  const { job } = props, output = job.output;
  const [file, setFile] = useState<File | null>(null);
  const [linking, setLinking] = useState(false);
  useEffect(() => { let cancelled = false; void exportService.file(job.id).then((found) => { if (!cancelled) setFile(found); }); return () => { cancelled = true; }; }, [job.id]);
  if (!output) return null;
  const actions = exporting.completionActions({ platform: exportPlatform, host, connectorConnected: false, canShareFile: file !== null && canShareFile(file), savedToChosenFile: output.location === "chosen-file" || output.location === "chosen-folder", outputType: job.type });
  const link = exporting.copyLinkState(host, null);
  const again = () => { if (file) download(file, output.fileName); else toast.show({ kind: "warning", message: t("File missing") }); };
  const handOff = (url: string) => { if (file) download(file, output.fileName); openPage(url); };
  const copy = (value: string) => void copyToClipboard(value).then((ok) => toast.show({ kind: ok ? "success" : "error", message: t(ok ? "Copied" : "Could not copy") }));
  return (
    <View testID="export-completion" style={{ gap: space[3] }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
        <Icon name="check-c" size={20} color="success" />
        <Text variant="title-sm" level={3} testID="export-done">{t("Export finished")}</Text>
      </View>
      <View>
        <Row label={t("File name")}><Text variant="meta" selectable testID="export-done-name">{output.fileName}</Text></Row>
        <Row label={t("Size")}><Text variant="meta" tabular testID="export-done-size">{output.files ? t("{n} files", { n: output.files }) + " · " + exporting.formatFileSize(output.size) : exporting.formatFileSize(output.size)}</Text></Row>
        {job.duration > 0 ? <Row label={t("Duration")}>{exporting.durationLabel(job.duration)}</Row> : null}
        <Row label={t("Export time")}>{exporting.elapsedText(job.elapsed_ms)}</Row>
        <Row label={t("Settings")}>{job.settingsSummary}</Row>
        <Row label={t("Summary")}>
          <View testID="export-summary-lines">{exporting.summaryLines(job.summary).map((entry, index) => <Text key={index} variant="meta">{line(t, entry)}</Text>)}</View>
        </Row>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[2] }}>
        {actions.includes("saved-to") ? <Text variant="meta" testID="export-saved-to">{t("Saved to {name}", { name: output.fileName })}</Text> : null}
        {props.credits ? <Button size="sm" kind="secondary" icon="copy" label={t("Copy credits")} testID="export-copy-credits" onPress={() => void copyToClipboard(props.credits!).then((ok) => toast.show({ kind: ok ? "success" : "error", message: t(ok ? "Credits copied" : "Couldn't copy the credits") }))} /> : null}
        {actions.includes("download") ? <Button size="sm" kind="secondary" icon="download" label={t("Download")} testID="export-download" disabled={!file} onPress={again} /> : null}
        {actions.includes("share") && file ? <Button size="sm" kind="secondary" label={t("Share…")} testID="export-share" onPress={() => void shareFile(file).then((ok) => { if (!ok) toast.show({ kind: "info", message: t("This file cannot be shared from the browser; download it instead.") }); })} /> : null}
        {actions.includes("copy-link") ? (
          link.state === "disabled" ? <View style={{ flexDirection: "row", alignItems: "center", gap: space[1.5] }}><Button size="sm" kind="secondary" icon="link" label={t("Copy link")} testID="export-copy-link" disabled /><Text variant="meta" color="text/secondary" testID="export-copy-link-reason">{t(link.reason)}</Text></View>
            : link.state === "hidden" ? null : <Button size="sm" kind="secondary" icon="link" label={t("Copy link")} testID="export-copy-link" onPress={() => setLinking(true)} />
        ) : null}
        {props.onExportAgain ? <Button size="sm" kind="ghost" label={t("Export again")} onPress={props.onExportAgain} /> : null}
      </View>
      {!file && actions.includes("download") ? <Text variant="meta" color="text/secondary">{t("The file was handed to the browser's downloads; this app keeps no copy after a restart.")}</Text> : null}
      <View style={{ gap: space[1.5] }}>
        <Text variant="body-medium" level={4}>{t("Publish")}</Text>
        <Text variant="meta" color="text/secondary">{t("Opens the destination in your browser and downloads the file; nothing is uploaded by this app.")}</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[1.5] }}>
          {exporting.HANDOFF_DESTINATIONS.map((destination) => <Button key={destination.id} size="sm" kind="outline" trailingIcon="ext" label={destination.name} testID={`handoff-${destination.id}`} onPress={() => handOff(destination.url)} />)}
        </View>
      </View>
      {props.publish ? (
        <View testID="publish-caption" style={{ gap: space[2] }}>
          <FormField label={t("Title")}>
            <View style={{ flexDirection: "row", gap: space[2], alignItems: "center" }}>
              <Input accessibilityLabel={t("Title")} size="sm" style={{ flex: 1 }} value={props.publish.title} onChangeText={(value) => props.publish!.onChange({ title: exporting.clampPublishText(value, exporting.PUBLISH_TITLE_MAX), description: props.publish!.description })} />
              <Text variant="meta" color="text/secondary" tabular testID="publish-title-count">{exporting.counterText(props.publish.title, exporting.PUBLISH_TITLE_MAX)}</Text>
              <Button size="sm" kind="ghost" icon="copy" label={t("Copy")} testID="publish-title-copy" onPress={() => copy(props.publish!.title)} />
            </View>
          </FormField>
          <FormField label={t("Description")}>
            <View style={{ gap: space[1] }}>
              <Textarea accessibilityLabel={t("Description")} minLines={2} maxLines={5} value={props.publish.description} onChangeText={(value) => props.publish!.onChange({ title: props.publish!.title, description: exporting.clampPublishText(value, exporting.PUBLISH_DESCRIPTION_MAX) })} />
              <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
                <Text variant="meta" color="text/secondary" tabular style={{ flex: 1 }}>{exporting.counterText(props.publish.description, exporting.PUBLISH_DESCRIPTION_MAX)}</Text>
                <Button size="sm" kind="ghost" icon="copy" label={t("Copy")} testID="publish-description-copy" onPress={() => copy(props.publish!.description)} />
              </View>
            </View>
          </FormField>
        </View>
      ) : null}
      {linking ? <ShareLinkDialog job={job} onClose={() => setLinking(false)} /> : null}
    </View>
  );
}

/**
 * The failure view: ONE sentence in the person's words (what failed, which clip or file, what to do), one primary
 * "Try again", and "Copy details" as a text button. Everything technical — the code, the engine's own message, the
 * settings, as the text "Copy details" copies — is folded under "Details", closed until asked for. "Close" is the one
 * button of the dialog this view stands in (its footer): it is not drawn a second time here.
 */
export function JobFailure(props: { job: Job; onRetry(sameSnapshot: boolean): void; /** Retries with the failed job's settings and the one change the button names (`exporting.failureRetrySettings`). */ onRetryWith(change: "try-h264" | "lower-resolution"): void; onClose(): void; /** In the editor: selects the clip the failure names and moves the playhead to it. */ onShowClip?(elementId: string): void }) {
  const t = useT();
  const toast = useToast();
  const host = useHostCapabilities();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const { job } = props, failure = job.error;
  if (!failure) return null;
  const size = job.settings ? exporting.lowerResolutionOf(job.settings) : null;
  // Only what starts something real is drawn (`shownFailureActions`: no "Retry on host" until an export can be handed to a host).
  const actions = exporting.shownFailureActions(exporting.failureActions(failure, {
    hostCanExport: exporting.hostCanExport(host), otherCodec: job.settings?.videoCodec !== "h264" ? "H.264" : null,
    lowerResolution: size ? exporting.RESOLUTION_LABELS[size] : null,
  }));
  const sentence = exporting.failureSentence(failure), clip = exporting.failedClips(failure)[0];
  const technical = async () => exporting.failureDetails({
    failure, settings: job.settings, encoder: job.settings ? { codec: job.settings.videoCodec, container: job.settings.container, hardwareAcceleration: job.softwareRetry ? "prefer-software" : job.settings.hardwareAcceleration, rateControl: job.settings.rateControl } : null,
    backend: "webgl2", platform: platformName(), appVersion: appVersion(), freeBytes: await freeBytes(), diagnostics: [],
  });
  const details = async () => {
    const copied = await copyToClipboard(await technical());
    toast.show({ kind: copied ? "success" : "error", message: t(copied ? "Copied" : "Could not copy") });
  };
  const toggle = () => { const next = !open; setOpen(next); if (next && text === null) void technical().then(setText).catch(() => setText("")); };
  const run = (id: exporting.FailureAction["id"]) => {
    if (id === "retry") props.onRetry(false); else if (id === "retry-same-snapshot") props.onRetry(true); else if (id === "copy-details") void details();
    else if (id === "try-h264" || id === "lower-resolution") props.onRetryWith(id);
    else if (id === "choose-location" || id === "export-again") props.onRetry(false);
  };
  // Another way to try again that this failure offers (another codec, a smaller size, another place): beside the sentence, as links.
  const remedies = actions.filter((action) => !["retry", "retry-same-snapshot", "copy-details"].includes(action.id));
  return (
    <View testID="export-failure" style={{ gap: space[3] }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
        <Icon name="x-c" size={20} color="danger" />
        <Text variant="title-sm" level={3}>{t("Export failed")}</Text>
      </View>
      <Text selectable testID="export-error" {...({ dataSet: { code: failure.code } } as object)}>{t(sentence.message, sentence.values)}</Text>
      {(clip && props.onShowClip) || remedies.length ? (
        <View testID="failure-remedies" style={{ flexDirection: "row", flexWrap: "wrap", gap: space[3] }}>
          {clip && props.onShowClip ? <Button size="sm" kind="link" label={t("Show the clip")} testID="failure-show-clip" onPress={() => props.onShowClip!(clip.elementId)} /> : null}
          {remedies.map((action) => <Button key={action.id} size="sm" kind="link" label={t(action.label)} testID={`failure-${action.id}`} onPress={() => run(action.id)} />)}
        </View>
      ) : null}
      <View testID="failure-actions" style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[2] }}>
        <Button size="sm" kind="primary" label={t("Try again")} testID="failure-retry" onPress={() => run("retry")} />
        <Button size="sm" kind="link" label={t("Copy details")} testID="failure-copy-details" onPress={() => run("copy-details")} />
      </View>
      <View testID="failure-details" style={{ gap: space[2] }}>
        <Tap role="button" label={t("Details")} expanded={open} testID="failure-details-toggle" onPress={toggle} style={{ flexDirection: "row", alignItems: "center", gap: space[1.5], alignSelf: "flex-start", minHeight: 28 }}>
          <Icon name={open ? "chev-d" : "chev-r"} size={14} color="text/secondary" /><Text variant="body-medium" color="text/secondary">{t("Details")}</Text>
        </Tap>
        {open ? (
          <View style={{ gap: space[2] }}>
            {/* The other retry differs in WHAT is exported; a person is told, not left to guess. */}
            <View testID="failure-retry-help" style={{ gap: space[1] }}>
              <Text variant="meta" color="text/secondary">{t("“Try again” exports the project as it is now, with the edits you made since.")}</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[2] }}>
                <Text variant="meta" color="text/secondary" style={{ flexShrink: 1 }}>{t("“Retry with the same snapshot” exports it exactly as it was when this export started.")}</Text>
                <Button size="sm" kind="link" label={t("Retry with the same snapshot")} testID="failure-retry-same-snapshot" onPress={() => run("retry-same-snapshot")} />
              </View>
            </View>
            <ScrollView style={{ maxHeight: 220 }}><Text variant="mono" color="text/secondary" selectable testID="failure-details-text">{text ?? ""}</Text></ScrollView>
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** Creates a share link on the connected host. The link reaches only people who can reach the host's address. */
export function ShareLinkDialog(props: { job: Job; onClose(): void }) {
  const t = useT();
  const toast = useToast();
  const { connection, host } = useHost();
  const capabilities = useHostCapabilities();
  const [options, setOptions] = useState<exporting.ShareOptions>(exporting.DEFAULT_SHARE_OPTIONS);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [off, setOff] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const passcode = exporting.passcodeProblem(options.passcode);
  const create = async () => {
    if (!connection || passcode) return;
    setBusy(true); setProblem(null);
    try {
      if (!props.job.hostJobId) throw Object.assign(new Error(t("Upload of files that exist only on this device needs the host's media store")), { code: "export/upload-failed" });
      const request = exporting.shareCreateParams({ jobId: props.job.hostJobId }, options, uuidV4());
      const answer = await connection.call<{ linkId: string; url: string; expires_ms: number }>(request.method, request.params);
      // The base is the address this device reaches the host through, whatever the host believes its own to be.
      const made = host ? exporting.shareUrl(host.origin, answer.url.split("/").pop() ?? "") : answer.url;
      setUrl(made);
      await copyToClipboard(made);
      toast.show({ kind: "success", message: t("Link copied") });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "export/share-disabled") setOff(true); else setProblem(error instanceof Error ? error.message : String(error));
    } finally { setBusy(false); }
  };
  return (
    <Modal title={t("Share link")} width={480} onClose={props.onClose}
      footer={<><View style={{ flex: 1 }} /><Button kind="ghost" label={t("Close")} onPress={props.onClose} />{off ? null : <Button kind="primary" icon="link" label={t("Create link")} testID="share-create" loading={busy} disabled={Boolean(passcode) || !connection} onPress={() => void create()} />}</>}>
      <View testID="share-link-dialog" style={{ gap: space[3] }}>
        {off ? <Callout tone="warning" title={t(exporting.SHARE_DISABLED)}>{t(capabilities?.admin ? "Turn on" : "Ask an admin")}</Callout> : null}
        <FormField label={t("Expires after")}>
          <Select label={t("Expires after")} value={options.expiresIn} onChange={(value) => setOptions({ ...options, expiresIn: value })} options={(Object.keys(exporting.SHARE_EXPIRY) as exporting.ShareExpiry[]).map((value) => ({ value, label: t(exporting.SHARE_EXPIRY_LABELS[value]) }))} />
        </FormField>
        <FormField label={t("Passcode (optional)")} error={passcode ? t(passcode) : undefined}>
          <Input accessibilityLabel={t("Passcode (optional)")} value={options.passcode} secureTextEntry maxLength={32} invalid={Boolean(passcode)} onChangeText={(value) => setOptions({ ...options, passcode: value })} />
        </FormField>
        <Checkbox label={t("Allow download")} checked={options.allowDownload} onChange={(allowDownload) => setOptions({ ...options, allowDownload })} />
        <FormField label={t("Mode")}>
          <Segmented label={t("Mode")} size="sm" value={options.mode} onChange={(mode) => setOptions({ ...options, mode })} options={[{ value: "review", label: t("Review") }, { value: "presentation", label: t("Presentation") }]} />
        </FormField>
        <Text variant="meta" color="text/secondary" testID="share-reach-note">{t(exporting.SHARE_REACH_NOTE)}</Text>
        {url ? <Text variant="mono" selectable testID="share-url">{url}</Text> : null}
        {problem ? <Text variant="meta" color="danger/text" role="alert">{problem}</Text> : null}
      </View>
    </Modal>
  );
}

/** One job in a dialog of its own: progress while it runs, the completion or the failure view once it has ended. */
export function JobDialog(props: { jobId: string; onClose(): void }) {
  const t = useT();
  const theme = useTheme();
  const router = useRouter();
  const { library } = useDevice();
  const state = useExports();
  const toast = useToast();
  const job = state.queue.jobs.find((entry) => entry.id === props.jobId) ?? state.queue.history.find((entry) => entry.id === props.jobId) ?? state.hostJobs.find((entry) => entry.id === props.jobId);
  useEffect(() => { exportService.watch(props.jobId, true); return () => exportService.watch(props.jobId, false); }, [props.jobId]);
  if (!job) return null;
  const retry = async (sameSnapshot: boolean, settings = job.settings) => {
    if (sameSnapshot) { const made = await exportService.retrySameSnapshot(job.id); if (!made) toast.show({ kind: "warning", message: t("The snapshot of this export is no longer on this device") }); props.onClose(); return; }
    const opened = await library?.open(job.projectId).catch(() => null);
    if (!opened || opened.state !== "ok") { toast.show({ kind: "error", message: t("Project not found") }); return; }
    const result = exportService.start({ document: opened.loaded.document, sceneId: job.sceneId, settings, fileName: job.fileName, playhead: 0, waivers: job.waivers, waivedAssetIds: job.waivedAssetIds });
    if (!result.ok) toast.show({ kind: "error", message: t(result.message) });
    props.onClose();
  };
  const again = () => { requestExportAgainFor(job); props.onClose(); router.push(`/editor/${job.projectId}` as never); };
  const title = job.state === "succeeded" ? t("Export finished") : job.state === "failed" ? t("Export failed") : job.state === "cancelled" ? t("Export cancelled") : t("Exporting…");
  return (
    <Modal title={title} description={`${job.projectName} · ${job.settingsSummary}`} width={640} onClose={props.onClose} footer={<><View style={{ flex: 1 }} /><Button label={t("Close")} onPress={props.onClose} /></>}>
      <View testID="job-dialog" style={{ gap: space[3], paddingTop: space[1] }}>
        {job.state === "succeeded" ? <JobCompletion job={job} onExportAgain={again} />
          : job.state === "failed" ? <JobFailure job={job} onRetry={(same) => void retry(same)} onRetryWith={(change) => void retry(false, exporting.failureRetrySettings(job.settings, change))} onClose={props.onClose} />
          : job.state === "cancelled" ? <View style={{ gap: space[2] }}><Text>{t("This export was cancelled. The partial file was deleted.")}</Text><View style={{ flexDirection: "row" }}><Button size="sm" kind="secondary" label={t("Export again")} onPress={again} /></View></View>
          : <JobProgress job={job} />}
        <JobDetails job={job} />
      </View>
      <View style={{ height: 0, borderRadius: radius.sm, backgroundColor: theme.color("bg/app") }} />
    </Modal>
  );
}
import { requestExportAgain } from "./hooks";
const requestExportAgainFor = (job: Job) => requestExportAgain(job.projectId, job.settings);

/** "View details": every recorded fact of a job. */
export function JobDetails(props: { job: Job }) {
  const t = useT();
  const { job } = props;
  const time = (ms?: number) => (ms ? formatDateTime(ms) : "—");
  return (
    <View testID="job-details" style={{ gap: 0 }}>
      <Row label={t("Project")}>{job.projectName}</Row>
      <Row label={t("Target")}>{job.target === "host" ? t("Host: {name}", { name: job.hostName ?? "" }) : t("This device")}</Row>
      <Row label={t("State")}>{t(stateLabel[job.state])}</Row>
      <Row label={t("Location")}>{job.output ? t(job.output.location === "downloads" ? "Browser downloads" : job.output.location === "host" ? "On the host" : "A place you chose") : "—"}</Row>
      <Row label={t("Started")}>{time(job.started_ms)}</Row>
      <Row label={t("Finished")}>{time(job.finished_ms)}</Row>
      {job.error ? <Row label={t("Error code")}><Text variant="mono" selectable>{job.error.code}</Text></Row> : null}
    </View>
  );
}

/** The polite live region of exports: "Export 50 percent", "Export finished", "Export failed". */
export function ExportAnnouncer() {
  const t = useT();
  const { announcement } = useExports();
  return announcement ? <Announce key={announcement.id}>{t(announcement.text, announcement.values)}</Announce> : null;
}
