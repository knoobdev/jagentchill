/**
 * The client side of export on a host, share links and publishing (`export-share.Remote export contract` and the
 * requirements that use it): method names, request shapes, what the dialog shows for a host, and the share targets of
 * each platform. The server answers these methods; nothing here runs on it.
 */
import type { ExportErrorCode } from "./errors.ts";
import type { ExportJob, ExportStage, JobState } from "./queue.ts";
import type { ExportSummary } from "./provenance.ts";
import type { ExportSettings, HostCapabilities, HostCodecRow } from "./settings.ts";
import type { Waiver } from "./preflight.ts";

export const EXPORT_RPC = {
  capabilities: "jagentchill.export.capabilities", create: "jagentchill.export.create", get: "jagentchill.export.get", list: "jagentchill.export.list", cancel: "jagentchill.export.cancel",
  delete: "jagentchill.export.delete", shareCreate: "jagentchill.share.create", shareList: "jagentchill.share.list", shareRevoke: "jagentchill.share.revoke", publish: "jagentchill.connector.publish",
} as const;
export const JOB_UPDATED_EVENT = "jagentchill.job.updated";
export const EXPORT_SCOPE = "jagentchill.export.run";
export const exportFileRoute = (jobId: string): string => `/jagentchill/v1/exports/${encodeURIComponent(jobId)}/file`;
export const FEATURE_REMOTE_EXPORT = "remote-export", FEATURE_SHARE_LINKS = "share-links", FEATURE_CONNECTORS = "connectors";
export const UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024;

export type RemoteCapabilities = { encoders: Record<"h264" | "hevc" | "vp9" | "av1" | "aac" | "opus", HostCodecRow>; containers: string[]; proRes: boolean };
export type RemoteJob = {
  jobId: string; kind: "export.remote" | "export.sequence"; state: "queued" | "running" | "succeeded" | "failed" | "cancelled"; stage?: string; framesDone: number; frameCount: number; encodedBytes: number;
  createdBy: { kind: "device" | "agent" | "workflow" | "film" | "automation"; id: string }; created_ms: number; started_ms?: number; finished_ms?: number;
  output?: { fileName: string; mime: string; size: number; sha256: string; expires_ms?: number }; codecUsed?: { video: string; audio: string; container: string }; summary?: ExportSummary;
  error?: { code: string; message: string; details?: Record<string, unknown> };
};
export type CodecPreference = { video: string; audio: string; container: string };
/** With a preset and no preference of its own, a host-initiated job prefers H.264 with AAC and falls back to VP9 with Opus. */
export const DEFAULT_CODEC_PREFERENCE: CodecPreference[] = [{ video: "h264", audio: "aac", container: "mp4" }, { video: "vp9", audio: "opus", container: "webm" }];
/** The first preference whose codecs are all `available` on the host; `null` fails the job with `export/codec-unavailable`. */
export function resolveCodecPreference(preference: CodecPreference[], encoders: RemoteCapabilities["encoders"]): CodecPreference | null {
  const available = (codec: string) => encoders[codec as keyof RemoteCapabilities["encoders"]]?.state === "available";
  return preference.slice(0, 6).find((entry) => available(entry.video) && available(entry.audio)) ?? null;
}
/** `details` of `export/codec-unavailable`: what was asked, what is available, what an admin could download. */
export function codecUnavailableDetails(requested: string, encoders: RemoteCapabilities["encoders"]): { requested: string; available: string[]; downloadRequired: string[] } {
  const video = ["h264", "hevc", "vp9", "av1"] as const;
  return { requested, available: video.filter((codec) => encoders[codec]?.state === "available"), downloadRequired: video.filter((codec) => encoders[codec]?.state === "download_required") };
}

export type CreateParams = {
  projectId: string; revision: number; sceneId?: string; range?: { start: number; end: number }; settings: ExportSettings; codecPreference?: CodecPreference[];
  sequence?: { projectIds: string[]; gapTicks: number }; aiLabel?: boolean; idempotencyKey: string;
} & Partial<Record<Waiver, boolean>>;
/** The one create request of a host export; the same key within 24 h yields the same job. */
export function createParams(input: Omit<CreateParams, "idempotencyKey"> & { idempotencyKey: string }): { method: string; params: CreateParams } {
  if (input.idempotencyKey.trim() === "") throw new Error("an export create request carries an idempotency key");
  return { method: EXPORT_RPC.create, params: { ...input } };
}
export type SequenceCheck = { ok: true } | { ok: false; code: "export/sequence-mismatch" | "INVALID_PARAMS"; projectId?: string; message: string };
/** A sequence holds 2–200 projects of one canvas size and frame rate, joined by a cut or by 0.5–3 s of black. */
export function checkSequence(projects: { id: string; width: number; height: number; fps: { numerator: number; denominator: number } }[], gapTicks: number): SequenceCheck {
  if (projects.length < 2 || projects.length > 200) return { ok: false, code: "INVALID_PARAMS", message: "a sequence has 2 to 200 projects" };
  if (gapTicks !== 0 && (gapTicks < 60_000 || gapTicks > 360_000)) return { ok: false, code: "INVALID_PARAMS", message: "a gap is 0, or 60 000 to 360 000 ticks" };
  const [first] = projects;
  const other = projects.find((project) => project.width !== first.width || project.height !== first.height || project.fps.numerator * first.fps.denominator !== first.fps.numerator * project.fps.denominator);
  return other ? { ok: false, code: "export/sequence-mismatch", projectId: other.id, message: `project ${other.id} differs in canvas size or frame rate from the first` } : { ok: true };
}
/** Total ticks of a sequence: the projects plus a gap at each join. */
export const sequenceDuration = (durations: number[], gapTicks: number): number => durations.reduce((sum, value) => sum + value, 0) + gapTicks * Math.max(0, durations.length - 1);
/** Rendering progress of a sequence, weighted by segment duration. */
export const sequenceProgress = (durations: number[], finishedSegments: number, currentPart = 0): number => {
  const total = durations.reduce((sum, value) => sum + value, 0);
  return total === 0 ? 0 : (durations.slice(0, finishedSegments).reduce((sum, value) => sum + value, 0) + (durations[finishedSegments] ?? 0) * currentPart) / total;
};

const STAGES: Record<string, ExportStage> = { queued: "Queued", preparing: "Preparing", uploading: "Uploading media", rendering: "Rendering", audio: "Mixing audio", finalising: "Finalising", downloading: "Downloading" };
/** A host job as a row of the device's queue: the host's five states, never `paused`. */
export function hostJobRow(job: RemoteJob, context: { hostName: string; projectId?: string; projectName?: string; settings?: ExportSettings }): ExportJob {
  const stage = STAGES[(job.stage ?? "").toLowerCase()] ?? (job.state === "queued" ? "Queued" : "Rendering");
  const percent = job.state === "succeeded" ? 100 : job.frameCount > 0 ? Math.min(98, 5 + (job.framesDone / job.frameCount) * 93) : 0;
  const expired = job.error?.code === "export/output-expired";
  return {
    id: `host:${job.jobId}`, hostJobId: job.jobId, projectId: context.projectId ?? "", projectName: context.projectName ?? "", type: job.kind === "export.sequence" ? "video" : context.settings?.type ?? "video",
    settings: context.settings as ExportSettings, settingsSummary: job.codecUsed ? `${job.codecUsed.video} · ${job.codecUsed.audio} · ${job.codecUsed.container}` : job.kind,
    fileName: job.output?.fileName ?? "", target: "host", hostName: context.hostName, createdBy: job.createdBy, state: job.state as JobState, stage, percent, framesDone: job.framesDone, frameCount: job.frameCount,
    duration: 0, range: { start: 0, end: 0 }, sceneId: "", created_ms: job.created_ms, started_ms: job.started_ms, finished_ms: job.finished_ms, elapsed_ms: job.started_ms ? (job.finished_ms ?? job.created_ms) - job.started_ms : 0,
    output: job.output ? { fileName: job.output.fileName, mime: job.output.mime, size: job.output.size, location: "host", sha256: job.output.sha256, expires_ms: job.output.expires_ms } : undefined,
    summary: job.summary, error: job.error ? { code: job.error.code as ExportErrorCode, message: expired ? "Output expired" : job.error.message, details: job.error.details } : undefined,
  };
}
/** Events are not replayed: after a reconnect or a gap the queue is rebuilt from `export.list`, keeping local jobs. */
export function reconcileHostJobs(local: ExportJob[], listed: ExportJob[]): ExportJob[] {
  return [...local.filter((job) => job.target === "device"), ...listed];
}
/** An interrupted download continues from the bytes already written. */
export const resumeRange = (bytesWritten: number): { Range: string } | Record<string, never> => (bytesWritten > 0 ? { Range: `bytes=${bytesWritten}-` } : {});
/** "Download when finished": on for desktop and web, off for a phone on a metered connection. */
export const downloadWhenFinished = (platform: "web" | "desktop" | "mobile", metered: boolean): boolean => platform !== "mobile" || !metered;
/** Which blobs a hand-off uploads: only those the host does not hold. */
export const blobsToUpload = (needed: string[], onHost: ReadonlySet<string>): string[] => needed.filter((sha) => !onHost.has(sha));
/** The first chunk to send when an upload resumes: the one after the last acknowledged. */
export const resumeChunk = (acknowledgedBytes: number): number => Math.floor(acknowledgedBytes / UPLOAD_CHUNK_BYTES);

// ---- the target selector ---------------------------------------------------------------------------------------------

export type TargetOption = { value: "device" | "host"; label: { text: string; values?: Record<string, string> }; disabled: boolean; link?: "connection-settings"; reason?: { text: string; values?: Record<string, string> } };
/** "This device" beside the host: "Host: <name>", "Host (not connected)" or "Host: <name> (cannot export)" naming what is missing. */
export function targetOptions(host: HostCapabilities | null, deviceVideo = true, type: ExportSettings["type"] = "video"): TargetOption[] {
  const device: TargetOption = { value: "device", label: { text: "This device" }, disabled: type === "video" && !deviceVideo, ...(type === "video" && !deviceVideo ? { reason: { text: "This device cannot encode video" } } : {}) };
  if (!host) return [device, { value: "host", label: { text: "Host (not connected)" }, disabled: true, link: "connection-settings" }];
  if (!host.remoteExport) return [device, { value: "host", label: { text: "Host: {name} (cannot export)", values: { name: host.name } }, disabled: true, reason: { text: "Missing on this host: {component}", values: { component: host.missing ?? "render host" } } }];
  return [device, { value: "host", label: host.thisComputer ? { text: "Host: This computer" } : { text: "Host: {name}", values: { name: host.name } }, disabled: false }];
}
/** With no on-device video encoder path, the host is preselected for video. */
export const preselectTarget = (settings: ExportSettings, host: HostCapabilities | null, deviceVideo: boolean): ExportSettings =>
  (settings.type === "video" && !deviceVideo && host?.remoteExport ? { ...settings, target: "host" } : settings);
/** Capabilities of a connected host from its feature flags and its codec table. */
export function hostCapabilities(input: { name: string; features: readonly string[]; role: string; remote?: RemoteCapabilities | null; thisComputer?: boolean }): HostCapabilities {
  const remoteExport = input.features.includes(FEATURE_REMOTE_EXPORT);
  return {
    name: input.name, remoteExport, shareLinks: input.features.includes(FEATURE_SHARE_LINKS), connectors: input.features.includes(FEATURE_CONNECTORS), admin: input.role === "admin",
    thisComputer: input.thisComputer, encoders: input.remote?.encoders ?? {}, proRes: input.remote?.proRes ?? false,
    ...(remoteExport ? {} : { missing: input.features.includes("render-host") ? "FFmpeg" : "render host" }),
  };
}

// ---- share links ------------------------------------------------------------------------------------------------------

export const SHARE_EXPIRY = { "1h": 3_600_000, "24h": 86_400_000, "7d": 604_800_000, "30d": 2_592_000_000 } as const;
export type ShareExpiry = keyof typeof SHARE_EXPIRY;
export const SHARE_EXPIRY_LABELS: Record<ShareExpiry, string> = { "1h": "1 hour", "24h": "24 hours", "7d": "7 days", "30d": "30 days" };
export type ShareOptions = { expiresIn: ShareExpiry; passcode: string; allowDownload: boolean; mode: "review" | "presentation" };
export const DEFAULT_SHARE_OPTIONS: ShareOptions = { expiresIn: "24h", passcode: "", allowDownload: true, mode: "review" };
export const SHARE_REACH_NOTE = "The link works only for people who can reach the host address (same network or tailnet).";
export const SHARE_NO_HOST = "Connect a host to share by link";
export const SHARE_DISABLED = "Share links are turned off on this host";
/** A passcode is optional; when given it has 4 to 32 characters. */
export const passcodeProblem = (passcode: string): string | null => (passcode === "" || (passcode.length >= 4 && passcode.length <= 32) ? null : "A passcode has 4 to 32 characters");
export type ShareSource = { jobId: string } | { blobSha256: string; fileName: string; mime: string };
export function shareCreateParams(source: ShareSource, options: ShareOptions, idempotencyKey: string): { method: string; params: Record<string, unknown> } {
  if (passcodeProblem(options.passcode)) throw new Error(passcodeProblem(options.passcode)!);
  return { method: EXPORT_RPC.shareCreate, params: { source, expiresIn: SHARE_EXPIRY[options.expiresIn], ...(options.passcode ? { passcode: options.passcode } : {}), allowDownload: options.allowDownload, mode: options.mode, idempotencyKey } };
}
/** `<host base URL>/jagentchill/v1/share/<token>`: the scheme and address are those through which this client reaches the host. */
export function shareUrl(hostBaseUrl: string, token: string): string {
  const base = hostBaseUrl.replace(/^ws(s?):\/\//, "http$1://").replace(/\/+$/, "");
  return `${base}/jagentchill/v1/share/${token}`;
}
export type ShareLink = { linkId: string; url: string; fileName: string; created_ms: number; expires_ms: number; views: number; revoked?: boolean };
/** What "Copy link" does on this device: create a link, or say why not. */
export function copyLinkState(host: HostCapabilities | null, enabled: boolean | null): { state: "ready" } | { state: "hidden" } | { state: "disabled"; reason: string } | { state: "off"; message: string; action: "Turn on" | "Ask an admin" } {
  if (!host) return { state: "disabled", reason: SHARE_NO_HOST };
  if (!host.shareLinks) return { state: "hidden" };
  if (enabled === false) return { state: "off", message: SHARE_DISABLED, action: host.admin ? "Turn on" : "Ask an admin" };
  return { state: "ready" };
}

// ---- publishing -------------------------------------------------------------------------------------------------------

/** Destinations the product hands the file to rather than uploading: plain text labels, no brand image. */
export const HANDOFF_DESTINATIONS = [
  { id: "tiktok", name: "TikTok", url: "https://www.tiktok.com/upload" }, { id: "youtube", name: "YouTube", url: "https://studio.youtube.com" },
  { id: "instagram", name: "Instagram", url: "https://www.instagram.com" }, { id: "facebook", name: "Facebook", url: "https://www.facebook.com" },
  { id: "whatsapp", name: "WhatsApp", url: "https://web.whatsapp.com" },
] as const;
export const PUBLISH_TITLE_MAX = 100, PUBLISH_DESCRIPTION_MAX = 2200;
/** A typed character beyond the limit is not accepted. */
export const clampPublishText = (text: string, max: number): string => [...text].slice(0, max).join("");
export const counterText = (text: string, max: number): string => `${[...text].length} / ${max}`;
export type YouTubeFields = { title: string; description: string; visibility: "private" | "unlisted" | "public"; madeForKids: boolean | null; tags: string };
export const DEFAULT_YOUTUBE: YouTubeFields = { title: "", description: "", visibility: "private", madeForKids: null, tags: "" };
/** Problems of the YouTube form by field; empty when it may be submitted. */
export function youTubeProblems(fields: YouTubeFields): Partial<Record<keyof YouTubeFields, string>> {
  const problems: Partial<Record<keyof YouTubeFields, string>> = {};
  const title = [...fields.title.trim()].length;
  if (title < 1 || title > 100) problems.title = "A title has 1 to 100 characters";
  if ([...fields.description].length > 5000) problems.description = "A description has at most 5 000 characters";
  if (fields.madeForKids === null) problems.madeForKids = "Choose Yes or No";
  if ([...fields.tags].length > 500) problems.tags = "Tags have at most 500 characters in total";
  return problems;
}
export type TikTokAccount = { privacyOptions: string[]; comments: boolean; duets: boolean; stitches: boolean };
export type TikTokFields = { caption: string; privacy: string; allowComments: boolean; allowDuets: boolean; allowStitches: boolean };
const PRIVACY_ORDER = ["SELF_ONLY", "FOLLOWER_OF_CREATOR", "MUTUAL_FOLLOW_FRIENDS", "PUBLIC_TO_EVERYONE"];
/** The TikTok form for an account: the most restrictive privacy preselected, every switch off. */
export const defaultTikTok = (account: TikTokAccount): TikTokFields => ({
  caption: "", privacy: PRIVACY_ORDER.find((option) => account.privacyOptions.includes(option)) ?? account.privacyOptions[0] ?? "", allowComments: false, allowDuets: false, allowStitches: false,
});
export const tikTokProblems = (fields: TikTokFields): Partial<Record<keyof TikTokFields, string>> => ([...fields.caption].length > 2200 ? { caption: "A caption has at most 2 200 characters" } : {});
export function publishParams(connectorId: "youtube" | "tiktok", source: { jobId: string } | { blobSha256: string }, fields: Record<string, unknown>, idempotencyKey: string): { method: string; params: Record<string, unknown> } {
  return { method: EXPORT_RPC.publish, params: { connectorId, source, fields, idempotencyKey } };
}

// ---- completion view --------------------------------------------------------------------------------------------------

export type ShareAction = "download" | "saved-to" | "share" | "show-in-folder" | "open" | "copy-path" | "copy-file" | "open-with" | "copy-link" | "publish" | "save-to-photos" | "save-to-files" | "done";
export type CompletionContext = {
  platform: "web" | "desktop" | "mobile"; os?: "macos" | "windows" | "linux" | "ios" | "android"; host: HostCapabilities | null; connectorConnected: boolean;
  /** Web: `navigator.canShare({files})` accepted the output. */
  canShareFile?: boolean; savedToChosenFile?: boolean; outputType: ExportSettings["type"];
};
/** The actions of the completion view on this platform, in order. "Copy link" is listed when a host is absent too (disabled with the reason). */
export function completionActions(context: CompletionContext): ShareAction[] {
  const link: ShareAction[] = context.host === null || context.host.shareLinks ? ["copy-link"] : [];
  const publish: ShareAction[] = context.connectorConnected && context.host?.connectors ? ["publish"] : [];
  if (context.platform === "desktop") return ["show-in-folder", "open", "copy-path", ...(context.os === "linux" ? (["copy-file", "open-with"] as ShareAction[]) : (["share"] as ShareAction[])), ...link, ...publish];
  if (context.platform === "web") return [context.savedToChosenFile ? "saved-to" : "download", ...(context.canShareFile ? (["share"] as ShareAction[]) : []), ...link, ...publish];
  const picture = context.outputType === "video" || context.outputType === "gif" || context.outputType === "still";
  return [...(picture ? (["save-to-photos"] as ShareAction[]) : []), "share", "save-to-files", ...(picture ? [...link, ...publish] : []), "done"];
}
export const FILE_NOT_FOUND = "File not found at {path}";
