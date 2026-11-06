import { TICKS_PER_SECOND, type LocalAsset, type Rational } from "@jagentchill/protocol";
import { frameToTicks } from "@jagentchill/editor-core";
import { sha256Hex } from "./hash.ts";

/** The one proxy format of the product, and the policy that decides when and where a proxy is made. */
export type ProxyForm = "mp4" | "webm";
export type ProxyState = LocalAsset["proxy"];
export const PROXY_FORMS: Record<ProxyForm, { container: ProxyForm; videoCodec: "h264" | "vp9"; audioCodec: "aac" | "opus" }> = {
  mp4: { container: "mp4", videoCodec: "h264", audioCodec: "aac" },
  webm: { container: "webm", videoCodec: "vp9", audioCodec: "opus" },
};
/** H.264 profiles tried in order: High, Main, Constrained Baseline (level 3.1 covers 1280 × 720 at 60 fps… 4.0 for headroom). */
export const PROXY_H264_CODEC_STRINGS = ["avc1.640028", "avc1.4d0028", "avc1.42e028"] as const;
export const PROXY_VP9_CODEC_STRING = "vp09.00.31.08";
export const PROXY_MAX_FPS = 60;
export const PROXY_KEYFRAME_INTERVAL_SECONDS = 1;
export const PROXY_LONG_SIDE = 1280;
export const PROXY_SHORT_SIDE = 720;

const even = (value: number): number => Math.max(2, Math.floor(value / 2) * 2);
/** Fit 1280 × 720 for landscape and square sources, 720 × 1280 for portrait; even dimensions; never upscaled. */
export function proxyTargetSize({ width, height }: { width: number; height: number }): { width: number; height: number } {
  const [boxWidth, boxHeight] = height > width ? [PROXY_SHORT_SIDE, PROXY_LONG_SIDE] : [PROXY_LONG_SIDE, PROXY_SHORT_SIDE];
  const scale = Math.min(1, boxWidth / width, boxHeight / height);
  return { width: even(Math.round(width * scale)), height: even(Math.round(height * scale)) };
}
const rate = (fps: Rational): number => fps.numerator / fps.denominator;
/** Sources above 60 fps keep every n-th frame, n the smallest integer that brings them to 60 fps or below. */
export const proxyDecimation = (fps: Rational): number => Math.max(1, Math.ceil(rate(fps) / PROXY_MAX_FPS - 1e-9));
export function proxyFrameRate(fps: Rational): Rational {
  const factor = proxyDecimation(fps), denominator = fps.denominator * factor;
  const divisor = gcd(fps.numerator, denominator);
  return { numerator: fps.numerator / divisor, denominator: denominator / divisor };
}
const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
/** 4 Mbit/s at 30 fps or below, linear to 8 Mbit/s at 60 fps; the `webm` form uses 80 %. */
export function proxyVideoBitrate(proxyFps: Rational, form: ProxyForm): number {
  const fps = Math.min(PROXY_MAX_FPS, rate(proxyFps));
  const base = fps <= 30 ? 4_000_000 : 4_000_000 + ((fps - 30) / 30) * 4_000_000;
  return Math.round(form === "webm" ? base * 0.8 : base);
}
/** Frame correspondence: the proxy frame with the greatest presentation timestamp ≤ the source time. */
export const proxyFrameForSourceFrame = (sourceFrame: number, decimation: number): number => Math.floor(sourceFrame / decimation);
export function proxyFrameForSourceTime(sourceTicks: number, sourceFps: Rational): number {
  const decimation = proxyDecimation(sourceFps);
  // The greatest source frame whose start is ≤ the time, then the proxy frame that holds it.
  let frame = Math.floor((sourceTicks * sourceFps.numerator) / (TICKS_PER_SECOND * sourceFps.denominator));
  while (frameToTicks(frame + 1, sourceFps) <= sourceTicks) frame++;
  while (frame > 0 && frameToTicks(frame, sourceFps) > sourceTicks) frame--;
  return proxyFrameForSourceFrame(frame, decimation);
}

export type ProxyReason = "resolution" | "frame-rate" | "slow-decode" | "undecodable" | "requested";
export const PROXY_AUTO_SHORT_SIDE = 1080;
/** The import decode test: 60 frames starting at 1 s, or the whole file when it is shorter. */
export const DECODE_TEST_FRAMES = 60;
export function decodeTestRange(durationTicks: number, fps: Rational): { start: number; frames: number } {
  const total = Math.max(1, Math.floor((durationTicks * fps.numerator) / (TICKS_PER_SECOND * fps.denominator)));
  const needed = TICKS_PER_SECOND + frameToTicks(DECODE_TEST_FRAMES, fps);
  return durationTicks >= needed ? { start: TICKS_PER_SECOND, frames: DECODE_TEST_FRAMES } : { start: 0, frames: total };
}
/**
 * Why a video gets a proxy automatically, or `null`. The SHORT side after rotation decides, so 1080 × 1920 portrait
 * and 1920 × 1080 landscape footage are treated alike and neither is proxied for its size.
 */
export function automaticProxyReason(video: { width?: number; height?: number; fps?: Rational; canDecode?: boolean | null; decodeTestFps?: number }): ProxyReason | null {
  if (video.canDecode === false) return "undecodable";
  if (video.width && video.height && Math.min(video.width, video.height) > PROXY_AUTO_SHORT_SIDE) return "resolution";
  if (video.fps && rate(video.fps) > PROXY_MAX_FPS + 1e-9) return "frame-rate";
  if (video.fps && video.decodeTestFps !== undefined && video.decodeTestFps < rate(video.fps) - 1e-6) return "slow-decode";
  return null;
}

export type EncoderSupport = { h264: boolean; aac: boolean; vp9: boolean; opus: boolean };
export type ProxyProducer = { producer: "device"; form: ProxyForm } | { producer: "host"; forms: ProxyForm[] } | { producer: "none" };
/**
 * Where a proxy is produced and in which form: `mp4` when an H.264 and an AAC encoder exist; else `webm` when a VP9
 * and an Opus encoder exist; else the host job `media.proxy`; else none (`proxy.state = "unavailable"`). A source the
 * device cannot decode is always the host's.
 */
export function selectProxyProducer(options: { encoders: EncoderSupport | null; sourceDecodes: boolean; hostConnected: boolean; hostEncoders?: Partial<EncoderSupport> }): ProxyProducer {
  const { encoders } = options;
  if (options.sourceDecodes && encoders) {
    if (encoders.h264 && encoders.aac) return { producer: "device", form: "mp4" };
    if (encoders.vp9 && encoders.opus) return { producer: "device", form: "webm" };
  }
  if (options.hostConnected) {
    const host = options.hostEncoders ?? {};
    // The host applies the same order with its own encoders; it always has VP9 and Opus.
    return { producer: "host", forms: host.h264 && host.aac ? ["mp4", "webm"] : ["webm"] };
  }
  return { producer: "none" };
}

export type ProxySpec = {
  variant: "proxy";
  form: ProxyForm; container: ProxyForm; videoCodec: "h264" | "vp9"; audioCodec: "aac" | "opus";
  videoCodecStrings: readonly string[];
  width: number; height: number;
  fps: Rational; decimation: number;
  videoBitrate: number; keyFrameIntervalSeconds: number;
  /** Absent for a source without audio. */
  audio?: { bitrate: number; channels: 2; sampleRate: number | "source" };
  pixelFormat: "yuv420p"; bitDepth: 8;
};
export function proxySpec(source: { width: number; height: number; fps: Rational; hasAudio?: boolean }, form: ProxyForm): ProxySpec {
  const fps = proxyFrameRate(source.fps);
  return {
    variant: "proxy", form, ...PROXY_FORMS[form],
    videoCodecStrings: form === "mp4" ? PROXY_H264_CODEC_STRINGS : [PROXY_VP9_CODEC_STRING],
    ...proxyTargetSize(source), fps, decimation: proxyDecimation(source.fps),
    videoBitrate: proxyVideoBitrate(fps, form), keyFrameIntervalSeconds: PROXY_KEYFRAME_INTERVAL_SECONDS,
    ...(source.hasAudio === false ? {} : { audio: form === "mp4" ? { bitrate: 128_000, channels: 2 as const, sampleRate: "source" as const } : { bitrate: 96_000, channels: 2 as const, sampleRate: 48_000 } }),
    pixelFormat: "yuv420p", bitDepth: 8,
  };
}
/** The Gateway-only second variant: source resolution capped at 3840 × 2160, same timestamps. */
export function mezzanineSpec(source: { width: number; height: number }, hostHasH264: boolean) {
  const scale = Math.min(1, (source.width >= source.height ? 3840 : 2160) / source.width, (source.width >= source.height ? 2160 : 3840) / source.height);
  return {
    variant: "mezzanine" as const, width: even(Math.round(source.width * scale)), height: even(Math.round(source.height * scale)),
    ...(hostHasH264 ? { videoCodec: "h264" as const, profile: "high", videoBitrate: 40_000_000, container: "mp4" as const } : { videoCodec: "vp9" as const, profile: "0", videoBitrate: 30_000_000, container: "webm" as const }),
  };
}
/** Mezzanine of a HEIC/HEIF still: PNG when it has alpha, otherwise JPEG at quality 0.95; full resolution, orientation applied. */
export const stillMezzanineSpec = (hasAlpha: boolean) => (hasAlpha ? { mimeType: "image/png" as const, extension: "png" } : { mimeType: "image/jpeg" as const, quality: 0.95, extension: "jpg" });

/** The host job a device submits when it cannot make the proxy itself (FFmpeg worker; scope `jagentchill.media.write`). */
export type ProxyJob = { kind: "media.proxy" | "media.transcode"; scope: "jagentchill.media.write"; assetId: string; contentHash: string; variant: "proxy" | "mezzanine"; forms: ProxyForm[]; spec?: ProxySpec };
export function proxyJob(asset: { id: string; contentHash: string; width: number; height: number; fps: Rational; hasAudio?: boolean }, forms: ProxyForm[], variant: "proxy" | "mezzanine" = "proxy"): ProxyJob {
  return { kind: variant === "proxy" ? "media.proxy" : "media.transcode", scope: "jagentchill.media.write", assetId: asset.id, contentHash: asset.contentHash, variant, forms, ...(variant === "proxy" ? { spec: proxySpec(asset, forms[0]) } : {}) };
}
/** Proxies and mezzanines live in the cache store, keyed by the original's content hash and shared across projects. */
export const proxyCacheKey = (contentHash: string, form: ProxyForm): string => `proxy/${contentHash}.${form}`;
export const mezzanineCacheKey = (contentHash: string, extension: string): string => `mezzanine/${contentHash}.${extension}`;

export type ProxyEvent =
  | { type: "queue" } | { type: "start" } | { type: "progress"; fraction: number }
  | { type: "succeed"; form: ProxyForm; size: number; sha256: string } | { type: "fail" } | { type: "cancel" } | { type: "unavailable" } | { type: "delete" } | { type: "retry" };
/** The proxy field of the device-local entry after an event. Device-local: no undo step and no patch. */
export function proxyTransition(current: ProxyState, event: ProxyEvent): ProxyState {
  switch (event.type) {
    case "queue": case "retry": return { state: "queued" };
    case "start": case "progress": return current.state === "cancelled" ? current : { state: "running" };
    case "succeed": return { state: "succeeded", size: event.size, sha256: event.sha256, ...PROXY_FORMS[event.form] };
    case "fail": return { state: "failed" };
    case "cancel": return { state: "cancelled" };
    case "unavailable": return { state: "unavailable" };
    case "delete": return { state: "none" };
  }
}
/** A transferred proxy is used only when it matches its recorded size and SHA-256; otherwise it is discarded and fetched again. */
export const verifyProxyBytes = (bytes: Uint8Array, recorded: { size?: number; sha256?: string }): boolean =>
  recorded.sha256 !== undefined && (recorded.size === undefined || recorded.size === bytes.length) && sha256Hex(bytes) === recorded.sha256;

/** A received proxy the device cannot decode: ask the host for the other form when it can make it, else there is no proxy. */
export function resolveUndecodableProxy(received: ProxyForm, hostForms: ProxyForm[]): { action: "request"; form: ProxyForm } | { action: "no-proxy" } {
  const other: ProxyForm = received === "mp4" ? "webm" : "mp4";
  return hostForms.includes(other) ? { action: "request", form: other } : { action: "no-proxy" };
}

export type AssetPlayback = { canDecode: boolean | null; proxy: ProxyState; present: { original: boolean; proxy: boolean; mezzanine: boolean } };
/** What the player, filmstrip and thumbnails read. */
export function previewSource(local: AssetPlayback, useProxies: boolean): "proxy" | "mezzanine" | "original" | "placeholder" {
  const hasProxy = local.proxy.state === "succeeded" && local.present.proxy;
  if (hasProxy && (useProxies || local.canDecode === false || !local.present.original)) return "proxy";
  if (local.present.mezzanine && (local.canDecode === false || !local.present.original)) return "mezzanine";
  return local.present.original && local.canDecode !== false ? "original" : "placeholder";
}
/** Export always reads the original, or the mezzanine when the original is undecodable; otherwise it goes to the Gateway. */
export function exportSource(local: AssetPlayback): "original" | "mezzanine" | "host" | "offline" {
  if (local.present.original && local.canDecode !== false) return "original";
  if (local.present.mezzanine) return "mezzanine";
  return local.present.original ? "host" : "offline";
}
/** Assets that block a local export, by name: undecodable without a mezzanine, or offline. */
export function localExportBlockers(assets: { id: string; name: string }[], locals: Record<string, AssetPlayback | undefined>, usedAssetIds: Iterable<string>): { undecodable: string[]; offline: string[] } {
  const used = new Set(usedAssetIds), undecodable: string[] = [], offline: string[] = [];
  for (const asset of assets) {
    const local = locals[asset.id];
    if (!used.has(asset.id) || !local) continue;
    const source = exportSource(local);
    if (source === "host") undecodable.push(asset.name);
    else if (source === "offline") offline.push(asset.name);
  }
  return { undecodable, offline };
}
