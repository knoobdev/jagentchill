import { RESOLUTION_MODES, type ExportSettings, type ResolutionMode } from "./settings.ts";
/** The closed set of export failure codes (`export-share.Export error codes`), each with one message and one primary remedy. */
export const EXPORT_DOMAIN_CODES = [
  "export/empty", "export/range-too-short", "export/no-gpu", "export/write-failed", "export/insufficient-space", "export/encoder-unsupported", "export/encoder-error",
  "export/codec-unavailable", "export/font-unavailable", "export/device-font", "export/matte-unavailable", "export/derived-unavailable", "export/slates-present",
  "export/resource-missing", "export/template-incomplete", "export/device-lost", "export/engine-panic", "export/interrupted", "export/out-of-memory", "export/queue-full",
  "export/host-restarted", "export/upload-failed", "export/download-failed", "export/output-expired", "export/sequence-mismatch", "export/share-disabled", "export/publish-rejected",
  "export/connector-not-authorised", "export/finalising-timeout",
] as const;
/** Engine codes that export operations surface unchanged. */
export const EXPORT_ENGINE_CODES = ["media/unavailable", "media/original-unavailable", "engine/encoder-unavailable"] as const;
export const EXPORT_GENERAL_CODES = ["RENDERER_UNAVAILABLE", "FFMPEG_UNAVAILABLE", "QUOTA_EXCEEDED", "SCOPE_DENIED", "INVALID_PARAMS", "NOT_FOUND", "CONFLICT", "CANCELLED", "RATE_LIMITED"] as const;
export const EXPORT_ERROR_CODES = [...EXPORT_DOMAIN_CODES, ...EXPORT_ENGINE_CODES, ...EXPORT_GENERAL_CODES] as const;
export type ExportErrorCode = (typeof EXPORT_ERROR_CODES)[number];
export const isExportErrorCode = (code: string): code is ExportErrorCode => (EXPORT_ERROR_CODES as readonly string[]).includes(code);

export const EXPORT_ERROR_MESSAGES: Record<ExportErrorCode, string> = {
  "export/empty": "Project is empty", "export/range-too-short": "The range is shorter than one frame", "export/no-gpu": "This device cannot render the export",
  "export/write-failed": "The file could not be written", "export/insufficient-space": "Not enough free space", "export/encoder-unsupported": "This device cannot encode this format",
  "export/encoder-error": "The encoder failed", "export/codec-unavailable": "The codec is not available on this target", "export/font-unavailable": "A font could not be loaded",
  "export/device-font": "A device font is not available on the host", "export/matte-unavailable": "A cutout is still processing", "export/derived-unavailable": "A processed clip is not ready",
  "export/slates-present": "Placeholder shots are still in the timeline", "export/resource-missing": "A resource is missing", "export/template-incomplete": "A required template slot is empty",
  "export/device-lost": "The graphics device was lost", "export/engine-panic": "The render engine stopped", "export/interrupted": "The export was interrupted",
  "export/out-of-memory": "The device ran out of memory", "export/queue-full": "Export queue is full (20)", "export/host-restarted": "The host restarted too many times",
  "export/upload-failed": "Media could not be uploaded to the host", "export/download-failed": "The file could not be downloaded", "export/output-expired": "Output expired",
  "export/sequence-mismatch": "The projects of a sequence need the same size and frame rate", "export/share-disabled": "Share links are turned off on this host",
  "export/publish-rejected": "The destination rejected the upload", "export/connector-not-authorised": "The connection to the destination expired",
  "export/finalising-timeout": "Export finalising did not make progress for 60 seconds. Retry the export.",
  "media/unavailable": "A media file is missing", "media/original-unavailable": "Only a proxy is on this device", "engine/encoder-unavailable": "No encoder is available for this format",
  RENDERER_UNAVAILABLE: "The host cannot render right now", FFMPEG_UNAVAILABLE: "The host has no FFmpeg", QUOTA_EXCEEDED: "The host's export storage is full", SCOPE_DENIED: "This device is not allowed to export on the host",
  INVALID_PARAMS: "The export request is not valid", NOT_FOUND: "The export no longer exists", CONFLICT: "The export is still running", CANCELLED: "The export was cancelled", RATE_LIMITED: "Too many requests; try again shortly",
};
export type ExportRemedy = "Export on host" | "Choose another codec" | "Choose another location" | "Retry" | "Review the project" | "Export again" | "Turn on" | "Reconnect" | "Open host diagnostics" | "Close";
const REMEDY: Partial<Record<ExportErrorCode, ExportRemedy>> = {
  "export/no-gpu": "Export on host", "export/encoder-unsupported": "Export on host", "export/out-of-memory": "Export on host", "export/codec-unavailable": "Choose another codec",
  "engine/encoder-unavailable": "Choose another codec", "export/write-failed": "Choose another location", "export/insufficient-space": "Choose another location",
  "export/interrupted": "Retry", "export/finalising-timeout": "Retry", "export/host-restarted": "Retry", "export/device-lost": "Retry", "export/engine-panic": "Retry", "export/encoder-error": "Retry", "export/upload-failed": "Retry", "export/download-failed": "Retry",
  "export/font-unavailable": "Review the project", "export/device-font": "Review the project", "export/matte-unavailable": "Review the project", "export/derived-unavailable": "Review the project",
  "export/slates-present": "Review the project", "export/resource-missing": "Review the project", "export/template-incomplete": "Review the project", "media/unavailable": "Review the project",
  "media/original-unavailable": "Review the project", "export/empty": "Review the project", "export/range-too-short": "Review the project",
  "export/output-expired": "Export again", "export/share-disabled": "Turn on", "export/connector-not-authorised": "Reconnect", RENDERER_UNAVAILABLE: "Open host diagnostics", FFMPEG_UNAVAILABLE: "Open host diagnostics",
};
/** The primary remedy of a code; codes without one of their own offer "Close". */
export const exportRemedy = (code: ExportErrorCode): ExportRemedy => REMEDY[code] ?? "Close";

/** A failure whose code is outside the listed sets is a defect: test builds fail on it. */
export class UnknownExportCode extends Error {
  readonly code: string;
  constructor(code: string) { super(`export failure code "${code}" is not in the registered sets`); this.name = "UnknownExportCode"; this.code = code; }
}
/**
 * The code a job fails with, from what the engine or the host replied: `engine/no-gpu` is reported as `export/no-gpu`,
 * a lost device and a panic take their export codes, and anything unregistered throws in a strict (test) build.
 */
export function exportCodeOf(code: string, strict = false): ExportErrorCode {
  const mapped = code === "engine/no-gpu" ? "export/no-gpu" : code === "engine/device-lost" ? "export/device-lost" : code === "engine/wasm-panic" || code === "engine/wasm-panic-loop" ? "export/engine-panic" : code;
  if (isExportErrorCode(mapped)) return mapped;
  if (strict) throw new UnknownExportCode(code);
  return "export/encoder-error";
}
export type ExportFailure = { code: ExportErrorCode; message: string; stage?: string; frameIndex?: number; details?: Record<string, unknown> };
/** A clip the engine could not draw, as its failure names it (`details.clips`). */
export type FailedClip = { elementId: string; assetId?: string; elementName?: string; assetName?: string };
export const failedClips = (failure: Pick<ExportFailure, "details">): FailedClip[] => {
  const clips = failure.details?.clips;
  return Array.isArray(clips) ? clips.filter((clip): clip is FailedClip => typeof clip === "object" && clip !== null && typeof (clip as FailedClip).elementId === "string") : [];
};
type NamedDocument = { media?: { assets?: ReadonlyArray<{ id: string; name?: string }> }; scenes?: ReadonlyArray<{ tracks: { overlay: ReadonlyArray<{ elements: ReadonlyArray<object> }>; main: { elements: ReadonlyArray<object> }; audio: ReadonlyArray<{ elements: ReadonlyArray<object> }> } }> };
/**
 * A failure of the engine that names its clip or file only by id (`details.elementId`, `details.assetId`) — "asset
 * a1b2 has no source on this device" — gets the names from the exported document, as `details.clips`, so that the one
 * sentence a person reads says WHICH clip or file. A failure that already names its clips, or names none, is returned as it is.
 */
export function namedFailure(failure: ExportFailure, document: NamedDocument | null | undefined): ExportFailure {
  if (!document || failedClips(failure).length > 0) return failure;
  const details = failure.details ?? {}, elementId = typeof details.elementId === "string" ? details.elementId : undefined, assetId = typeof details.assetId === "string" ? details.assetId : undefined;
  if (!elementId && !assetId) return failure;
  const elements = (document.scenes ?? []).flatMap((scene) => [...scene.tracks.overlay, scene.tracks.main, ...scene.tracks.audio]).flatMap((track) => track.elements as ReadonlyArray<{ id?: string; name?: string; assetId?: string; mediaId?: string }>);
  const assetOf = (element: { assetId?: string; mediaId?: string }) => element.assetId ?? element.mediaId;
  const found = elementId ? elements.filter((element) => element.id === elementId) : elements.filter((element) => assetOf(element) === assetId);
  const nameOf = (id: string | undefined) => (id ? document.media?.assets?.find((asset) => asset.id === id)?.name : undefined);
  const clips: FailedClip[] = found.slice(0, 20).map((element) => { const asset = assetOf(element) ?? assetId, assetName = nameOf(asset); return { elementId: String(element.id), ...(asset ? { assetId: asset } : {}), ...(element.name ? { elementName: element.name } : {}), ...(assetName ? { assetName } : {}) }; });
  // A file no clip uses any more (or a clip the document no longer has) is still named by the file.
  if (clips.length === 0) { const assetName = nameOf(assetId); if (!assetName) return failure; return { ...failure, details: { ...details, file: assetName } }; }
  return { ...failure, details: { ...details, clips } };
}
/**
 * What a person is told when an export failed: ONE sentence — what failed, which clip, what to do — as a source string
 * and its values. The engine's own words, codes and diagnostics are never part of it; they are behind "Copy details".
 */
export function failureSentence(failure: Pick<ExportFailure, "code" | "details">): { message: string; values?: Record<string, string | number> } {
  const clips = failedClips(failure), first = clips[0];
  if ((failure.code === "media/unavailable" || failure.code === "media/original-unavailable") && first) {
    // The clip by its file's name, which is what the timeline writes on it.
    const clip = first.assetName || first.elementName || "", media = first.assetName || first.elementName || "";
    // A sound that would have been left out of the film (the engine's `details.sound`): said as a sound, not as a picture.
    const sound = (failure.details as { sound?: unknown } | undefined)?.sound;
    if (sound === "undecodable") return { message: "The sound “{clip}” could not be exported: this device cannot decode its audio. Replace it with another file (MP3, WAV or AAC), then export again.", values: { clip } };
    if (sound === "missing") return { message: "The sound “{clip}” could not be exported: its file is not on this device. Wait until it has arrived or replace it, then export again.", values: { clip } };
    if (failure.code === "media/original-unavailable") return { message: "The clip “{clip}” could not be exported: only a preview copy of “{media}” is on this device. Download the original or export on the host.", values: { clip, media } };
    return clips.length === 1
      ? { message: "The clip “{clip}” could not be drawn: its media is missing or is not a picture or video this device can show. Replace or remove the clip, then export again.", values: { clip } }
      : { message: "The clip “{clip}” and {n} more could not be drawn: their media is missing or is not a picture or video this device can show. Replace or remove them, then export again.", values: { clip, n: clips.length - 1 } };
  }
  // A file that is missing and that no clip could be named for: the file itself is named.
  const file = (failure.details as { file?: unknown } | undefined)?.file;
  if ((failure.code === "media/unavailable" || failure.code === "media/original-unavailable") && typeof file === "string" && file) return { message: "The file “{file}” could not be exported: it is not on this device. Wait until it has arrived or replace it, then export again.", values: { file } };
  const known = EXPORT_ERROR_MESSAGES[failure.code];
  return { message: known ?? "The export could not be finished" };
}
export type FailureAction = { id: "retry" | "retry-same-snapshot" | "retry-on-host" | "try-h264" | "lower-resolution" | "copy-details" | "close" | "choose-location" | "open-host-diagnostics" | "export-again"; label: string };
/** The actions of the failure view, in order. */
export function failureActions(failure: Pick<ExportFailure, "code">, context: { hostCanExport: boolean; otherCodec?: string | null; lowerResolution?: string | null }): FailureAction[] {
  const actions: FailureAction[] = [{ id: "retry", label: "Retry" }, { id: "retry-same-snapshot", label: "Retry with the same snapshot" }];
  if (context.hostCanExport) actions.push({ id: "retry-on-host", label: "Retry on host" });
  if (failure.code === "export/encoder-error" && context.otherCodec) actions.push({ id: "try-h264", label: `Try ${context.otherCodec}` });
  if (failure.code === "export/out-of-memory" && context.lowerResolution) actions.push({ id: "lower-resolution", label: `Retry at ${context.lowerResolution}` });
  if (failure.code === "export/write-failed" || failure.code === "export/insufficient-space") actions.push({ id: "choose-location", label: "Choose another location" });
  if (failure.code === "export/output-expired") actions.push({ id: "export-again", label: "Export again" });
  if (failure.code === "RENDERER_UNAVAILABLE" || failure.code === "FFMPEG_UNAVAILABLE") actions.push({ id: "open-host-diagnostics", label: "Open host diagnostics" });
  actions.push({ id: "copy-details", label: "Copy details" }, { id: "close", label: "Close" });
  return actions;
}
/**
 * The actions a failure view DRAWS: each of them starts something real. Not drawn: "Close" (the dialog's footer has the
 * one Close), and the two actions this product cannot carry out yet — "Retry on host" (`export-share.Failure
 * diagnostics and retry`: it starts the hand-off of `export-share.Gateway export hand-off`, which no client or server
 * of this build implements: there is no `jagentchill.export.create`) and "Open host diagnostics" (a failure of such a
 * host job). They come back with the hand-off.
 */
export function shownFailureActions(actions: FailureAction[]): FailureAction[] {
  return actions.filter((action) => action.id !== "close" && action.id !== "retry-on-host" && action.id !== "open-host-diagnostics");
}
/** The size "Retry at …" goes down to from these settings; null when there is none below. */
export function lowerResolutionOf(settings: Pick<ExportSettings, "resolution">): ResolutionMode | null {
  const size = RESOLUTION_MODES[Math.max(1, RESOLUTION_MODES.indexOf(settings.resolution.mode) - 1)];
  return size && size !== "project" && size !== settings.resolution.mode ? size : null;
}
/** The settings a codec or resolution retry of a failed export runs with: the failed job's, with the one change the button names. */
export function failureRetrySettings(settings: ExportSettings, change: "try-h264" | "lower-resolution"): ExportSettings {
  if (change === "try-h264") return { ...settings, videoCodec: "h264", container: settings.container === "webm" ? "mp4" : settings.container };
  const size = lowerResolutionOf(settings);
  return size ? { ...settings, resolution: { ...settings.resolution, mode: size } } : settings;
}
const SECRET_KEYS = /token|passcode|password|secret|api[-_]?key|authorization|signature/i;
function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) return "[binary omitted]";
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !SECRET_KEYS.test(key)).map(([key, entry]) => [key, scrub(entry)]));
  // A share URL carries its token in the path.
  return typeof value === "string" ? value.replace(/(\/jagentchill\/v1\/share\/)[A-Za-z0-9_-]+/g, "$1[removed]") : value;
}
/**
 * The text of "Copy details": code, message, stage, frame, settings, encoder configuration, backend, platform, app
 * version, free space and the last 50 engine diagnostics — and never media content, file contents, tokens or keys.
 */
export function failureDetails(input: {
  failure: ExportFailure; settings: unknown; encoder: unknown; backend: string; platform: string; appVersion: string; freeBytes: number | null; diagnostics: string[];
}): string {
  return JSON.stringify(scrub({
    code: input.failure.code, message: input.failure.message, stage: input.failure.stage ?? null, frameIndex: input.failure.frameIndex ?? null, details: input.failure.details ?? null, settings: input.settings, encoder: input.encoder,
    engineBackend: input.backend, platform: input.platform, appVersion: input.appVersion, freeDiskBytes: input.freeBytes, diagnostics: input.diagnostics.slice(-50),
  }), null, 2);
}
/** A hardware encoder that throws is retried once, from frame 0, with software encoding and the same codec. */
export const HARDWARE_RETRY_NOTICE = "Hardware encoder failed; retrying with software encoding";
export function encoderRetry(attempt: { hardwareAcceleration: "auto" | "prefer-hardware" | "prefer-software"; retried: boolean }): { retry: true; hardwareAcceleration: "prefer-software"; notice: string } | { retry: false; code: "export/encoder-error" } {
  return attempt.retried || attempt.hardwareAcceleration === "prefer-software" ? { retry: false, code: "export/encoder-error" } : { retry: true, hardwareAcceleration: "prefer-software", notice: HARDWARE_RETRY_NOTICE };
}
