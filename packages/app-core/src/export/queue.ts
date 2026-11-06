/** The export queue and history of a device (`export-share.Export queue`, `Export history`) and the progress rules of a job. Pure state transitions. */
import type { ExportFailure } from "./errors.ts";
import type { Waiver } from "./preflight.ts";
import type { ExportSummary } from "./provenance.ts";
import type { ExportSettings, ExportType } from "./settings.ts";

export const DEVICE_JOB_STATES = ["queued", "running", "paused", "succeeded", "failed", "cancelled"] as const;
/** A host job is never `paused`. */
export const HOST_JOB_STATES = ["queued", "running", "succeeded", "failed", "cancelled"] as const;
export type JobState = (typeof DEVICE_JOB_STATES)[number];
export const EXPORT_STAGES = ["Preparing", "Preparing audio", "Smoothing motion", "Mixing audio", "Rendering", "Finalising", "Saving", "Uploading media", "Queued", "Downloading"] as const;
export type ExportStage = (typeof EXPORT_STAGES)[number];
export const QUEUE_LIMIT = 20;
export const HISTORY_LIMIT = 200;
export const QUEUE_FULL_MESSAGE = "Export queue is full (20)";

export type JobOutput = {
  fileName: string; mime: string; size: number;
  /** Where the file went: the browser's downloads, a file or folder the user chose, or (desktop) a path. */
  location: "downloads" | "chosen-file" | "chosen-folder" | "path" | "host"; path?: string; files?: number;
  /** The name of the copy in the app's private storage while it still exists. */
  privateName?: string; sha256?: string; expires_ms?: number;
};
export type ExportJob = {
  id: string; projectId: string; projectName: string; type: ExportType; settings: ExportSettings; settingsSummary: string; fileName: string;
  target: "device" | "host"; hostName?: string; hostJobId?: string; createdBy?: { kind: "device" | "agent" | "workflow" | "film" | "automation"; id: string };
  state: JobState; stage: ExportStage; percent: number; framesDone: number; frameCount: number; detail?: string;
  /** Ticks of the exported span. */
  duration: number; range: { start: number; end: number }; sceneId: string;
  created_ms: number; started_ms?: number; finished_ms?: number; elapsed_ms: number; eta_ms?: number | null;
  waivers?: Partial<Record<Waiver, boolean>>; /** With the missing-media waiver: the assets the person was shown by name and waived; only these are left out of the export. */ waivedAssetIds?: string[]; notice?: string; softwareRetry?: boolean;
  output?: JobOutput; summary?: ExportSummary; error?: ExportFailure; publishedUrl?: string; fileMissing?: boolean;
};
export type ExportQueue = { jobs: ExportJob[]; history: ExportJob[] };
export const EMPTY_QUEUE: ExportQueue = { jobs: [], history: [] };
export const isFinished = (job: Pick<ExportJob, "state">): boolean => job.state === "succeeded" || job.state === "failed" || job.state === "cancelled";

const record = (history: ExportJob[], job: ExportJob): ExportJob[] => [job, ...history.filter((entry) => entry.id !== job.id)].slice(0, HISTORY_LIMIT);
/** Adds a job to the history: the newest first, the oldest dropped beyond 200. */
export const recordHistory = (queue: ExportQueue, job: ExportJob): ExportQueue => ({ ...queue, history: record(queue.history, job) });

export type EnqueueResult = { ok: true; queue: ExportQueue } | { ok: false; code: "export/queue-full"; message: string };
/** Adds an on-device job behind the others. Twenty non-finished on-device jobs is the limit; host jobs are not counted. */
export function enqueue(queue: ExportQueue, job: ExportJob): EnqueueResult {
  if (job.target === "device" && queue.jobs.filter((entry) => entry.target === "device").length >= QUEUE_LIMIT) return { ok: false, code: "export/queue-full", message: QUEUE_FULL_MESSAGE };
  return { ok: true, queue: { ...queue, jobs: [...queue.jobs, { ...job, state: "queued", stage: job.target === "host" ? "Queued" : "Preparing" }] } };
}
/** The job to start now: the first queued on-device job, when none is running or paused. */
export function nextToRun(queue: ExportQueue): ExportJob | null {
  const device = queue.jobs.filter((job) => job.target === "device");
  return device.some((job) => job.state === "running" || job.state === "paused") ? null : device.find((job) => job.state === "queued") ?? null;
}
export const updateJob = (queue: ExportQueue, id: string, patch: Partial<ExportJob>): ExportQueue => ({ ...queue, jobs: queue.jobs.map((job) => (job.id === id ? { ...job, ...patch } : job)) });
/** A job reached a terminal state: it leaves the queue and is recorded in the history. */
export function finishJob(queue: ExportQueue, id: string, patch: Partial<ExportJob> & { state: "succeeded" | "failed" | "cancelled" }): ExportQueue {
  const job = queue.jobs.find((entry) => entry.id === id);
  if (!job) return queue;
  const done = { ...job, ...patch, percent: patch.state === "succeeded" ? 100 : job.percent, eta_ms: null };
  return { jobs: queue.jobs.filter((entry) => entry.id !== id), history: record(queue.history, done) };
}
/** Queued jobs in the order they will run. */
export const queuedJobs = (queue: ExportQueue): ExportJob[] => queue.jobs.filter((job) => job.state === "queued" && job.target === "device");
/** Moves a queued job one place towards the front (-1) or the back (+1) among the queued jobs. */
export function moveJob(queue: ExportQueue, id: string, direction: -1 | 1): ExportQueue {
  const waiting = queuedJobs(queue), from = waiting.findIndex((job) => job.id === id), to = from + direction;
  if (from < 0 || to < 0 || to >= waiting.length) return queue;
  return reorderJob(queue, id, to);
}
/** Places a queued job at `index` of the queued jobs (drag on desktop and web). */
export function reorderJob(queue: ExportQueue, id: string, index: number): ExportQueue {
  const waiting = queuedJobs(queue), moved = waiting.find((job) => job.id === id);
  if (!moved) return queue;
  const order = waiting.filter((job) => job.id !== id);
  order.splice(Math.min(order.length, Math.max(0, index)), 0, moved);
  let next = 0;
  return { ...queue, jobs: queue.jobs.map((job) => (job.state === "queued" && job.target === "device" ? order[next++] : job)) };
}
export const canMove = (queue: ExportQueue, id: string, direction: -1 | 1): boolean => { const waiting = queuedJobs(queue), at = waiting.findIndex((job) => job.id === id); return at >= 0 && at + direction >= 0 && at + direction < waiting.length; };
export const CANCEL_CONFIRMATION = "Cancel export? The partial file is deleted.";
/** Cancelling asks first once more than 10 % is done; a queued job is removed without asking. */
export const cancelNeedsConfirmation = (job: Pick<ExportJob, "state" | "percent">): boolean => job.state !== "queued" && job.percent > 10;
/** Marks a job cancelled: it leaves the queue and stays in the history with "Export again". */
export const cancelJob = (queue: ExportQueue, id: string, now_ms: number): ExportQueue => finishJob(queue, id, { state: "cancelled", finished_ms: now_ms });
/**
 * The queue after an app restart: queued jobs keep their place; a job that was running or paused is `failed` with
 * `export/interrupted` and offers "Retry".
 */
export function restoreQueue(queue: ExportQueue, now_ms: number): ExportQueue {
  let next: ExportQueue = { jobs: [...queue.jobs], history: [...queue.history] };
  for (const job of queue.jobs) {
    if (job.target === "device" && (job.state === "running" || job.state === "paused")) next = finishJob(next, job.id, { state: "failed", finished_ms: now_ms, error: { code: "export/interrupted", message: "The export was interrupted", stage: job.stage, frameIndex: job.framesDone } });
  }
  return next;
}
export const removeFromHistory = (queue: ExportQueue, id: string): ExportQueue => ({ ...queue, history: queue.history.filter((job) => job.id !== id) });
export type HistoryFilter = { query?: string; state?: JobState | "all"; type?: ExportType | "all" };
/** History search by project and file name, filtered by state and type. */
export function filterHistory(history: ExportJob[], filter: HistoryFilter): ExportJob[] {
  const needle = (filter.query ?? "").trim().toLocaleLowerCase();
  return history.filter((job) => (!needle || job.projectName.toLocaleLowerCase().includes(needle) || job.fileName.toLocaleLowerCase().includes(needle) || (job.output?.fileName ?? "").toLocaleLowerCase().includes(needle))
    && (!filter.state || filter.state === "all" || job.state === filter.state) && (!filter.type || filter.type === "all" || job.type === filter.type));
}
export type HistoryAction = "open-view" | "download" | "show-in-folder" | "open" | "share" | "copy-link" | "publish" | "export-again" | "copy-settings" | "view-details" | "remove" | "retry";
/** The row actions of a history entry: a succeeded entry whose file is gone offers only "Export again" and "Remove from history". */
export function historyActions(job: Pick<ExportJob, "state" | "fileMissing" | "output">, platform: "web" | "desktop" | "mobile"): HistoryAction[] {
  if (job.state === "succeeded" && job.fileMissing) return ["export-again", "remove"];
  const file: HistoryAction[] = job.state !== "succeeded" ? [] : platform === "desktop" ? ["show-in-folder", "open", "share"] : job.output?.privateName ? ["download", "share"] : [];
  return [...(job.state === "succeeded" ? (["open-view"] as HistoryAction[]) : []), ...file, ...(job.state === "failed" ? (["retry"] as HistoryAction[]) : []), "export-again", "copy-settings", "view-details", "remove"];
}
/** The badge of the Exports button: queued and running jobs on this device and on the active host. */
export const badgeCount = (device: Pick<ExportJob, "state">[], host: Pick<ExportJob, "state">[] = []): number =>
  [...device, ...host].filter((job) => job.state === "queued" || job.state === "running" || job.state === "paused").length;

// ---- progress ---------------------------------------------------------------------------------------------------------

/**
 * The percentage of a stage: Preparing, Preparing audio, Smoothing motion and Mixing audio share 0–5 %, Rendering is
 * 5–98 % by frames encoded, Finalising 98–100 %, and on a phone the copy-out (Saving) is the last 2 %.
 */
export function stagePercent(stage: ExportStage, done = 0, total = 0): number {
  const part = total > 0 ? Math.min(1, Math.max(0, done / total)) : 0;
  if (stage === "Preparing" || stage === "Queued" || stage === "Uploading media") return 0;
  if (stage === "Preparing audio" || stage === "Smoothing motion") return 1 + part * 2;
  if (stage === "Mixing audio") return 3 + part * 2;
  if (stage === "Rendering") return 5 + part * 93;
  if (stage === "Finalising") return 98;
  if (stage === "Saving" || stage === "Downloading") return 98 + part * 2;
  return 0;
}
/** A reported percentage never decreases. */
export const advancePercent = (previous: number, next: number): number => Math.min(100, Math.max(previous, Math.round(next * 10) / 10));
/** The polite announcement of a progress change: one at each 10 % step. */
export function progressAnnouncement(previous: number, next: number): { text: string; values: { percent: number } } | null {
  const step = Math.floor(next / 10) * 10;
  return step > 0 && step < 100 && Math.floor(previous / 10) * 10 < step ? { text: "Export {percent} percent", values: { percent: step } } : null;
}
export type EtaSample = { at_ms: number; frames: number };
/**
 * Time remaining from the mean frame rate of the last 5 s of rendering; nothing is shown before 3 s of rendering.
 * `samples` grows by one entry per progress report and is trimmed here.
 */
export function estimateRemaining(samples: EtaSample[], frameCount: number, renderingStarted_ms: number, now_ms: number): number | null {
  while (samples.length > 2 && now_ms - samples[0].at_ms > 5000) samples.shift();
  if (now_ms - renderingStarted_ms < 3000 || samples.length < 2) return null;
  const first = samples[0], last = samples[samples.length - 1], span = last.at_ms - first.at_ms;
  if (span <= 0 || last.frames <= first.frames) return null;
  return ((frameCount - last.frames) / ((last.frames - first.frames) / span));
}
/** "About 50 s remaining", "About 3 min remaining". */
export function remainingLabel(ms: number): { text: string; values: { n: number } } {
  const seconds = Math.max(1, Math.round(ms / 1000));
  return seconds < 90 ? { text: "About {n} s remaining", values: { n: seconds } } : { text: "About {n} min remaining", values: { n: Math.round(seconds / 60) } };
}
/** "1:05" for an elapsed time. */
export function elapsedText(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
export const isQueue = (value: unknown): value is ExportQueue =>
  value !== null && typeof value === "object" && Array.isArray((value as ExportQueue).jobs) && Array.isArray((value as ExportQueue).history)
  && [...(value as ExportQueue).jobs, ...(value as ExportQueue).history].every((job) => job !== null && typeof job === "object" && typeof job.id === "string" && typeof job.projectId === "string" && (DEVICE_JOB_STATES as readonly string[]).includes(job.state));
