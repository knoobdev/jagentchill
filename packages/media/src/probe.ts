import { fpsToRational, secondsToTicks } from "@jagentchill/editor-core";
import type { Rational } from "@jagentchill/protocol";
import { ALL_FORMATS, CustomSource, Input } from "mediabunny";
import { detectMediaType, extensionOf, type MediaFormat, type MediaType } from "./detect.ts";
import type { ByteSource } from "./hash.ts";
import { probeImageBytes } from "./image-probe.ts";

/**
 * What probing reads. Video and audio facts come from the container (headers and index only) through mediabunny,
 * the demuxer OpenCut classic uses; image facts come from the file header. `canDecode` is `null` when the runtime
 * that probes has no WebCodecs (the host, a test process): decodability is then decided on the device that plays.
 */
export type ProbeResult = {
  type: MediaType;
  container?: string;
  /** Pixels after rotation. */
  width?: number;
  height?: number;
  /** Ticks, 120 000 per second. */
  duration?: number;
  fps?: Rational;
  hasAudio?: boolean;
  videoCodec?: string;
  audioCodec?: string;
  rotation: 0 | 90 | 180 | 270;
  sampleRate?: number;
  channels?: number;
  hasAlpha?: boolean;
  canDecode: boolean | null;
  /** A video's SOUND track: whether this runtime can decode it (`null` when it cannot tell); absent when the file has no sound track or is not a video. */
  canDecodeSound?: boolean | null;
};
export class ProbeError extends Error {
  readonly code = "media/unreadable";
  readonly fileName: string;
  constructor(fileName: string, cause?: unknown) {
    super(`Unable to read ${fileName}`, { cause });
    this.name = "ProbeError";
    this.fileName = fileName;
  }
}
/** A local file is probed within this time or rejected. */
export const PROBE_TIMEOUT_MS = 5000;
/** The frame rate is the average packet rate over this many packets. */
export const FPS_PACKET_SAMPLE = 100;

const CONTAINER_NAMES: Record<string, string> = { MP4: "mp4", QuickTime: "mov", WebM: "webm", Matroska: "mkv", MP3: "mp3", WAVE: "wav", Ogg: "ogg", ADTS: "aac", FLAC: "flac" };
const ISO_FAMILY = new Set(["mp4", "mov", "m4v", "m4a", "3gp"]);
/** Codec names as stored: `h264` (not `avc`) to match the proxy fields of the device-local section; every PCM flavour is `pcm`. */
export const normaliseCodec = (codec: string | null | undefined): string | undefined =>
  codec == null ? undefined : codec === "avc" ? "h264" : codec.startsWith("pcm-") || codec === "ulaw" || codec === "alaw" ? "pcm" : codec;
const CODEC_LABELS: Record<string, string> = {
  h264: "H.264", hevc: "HEVC", vp8: "VP8", vp9: "VP9", av1: "AV1", prores: "ProRes", gif: "GIF",
  aac: "AAC", mp3: "MP3", opus: "Opus", vorbis: "Vorbis", flac: "FLAC", pcm: "PCM", alac: "ALAC",
};
export const codecLabel = (codec: string | undefined): string => (codec ? CODEC_LABELS[codec] ?? codec.toUpperCase() : "Unknown codec");

const hasWebCodecs = (): boolean => typeof (globalThis as { VideoDecoder?: unknown }).VideoDecoder === "function";

export type ProbeOptions = {
  name: string;
  type: MediaType;
  source: ByteSource;
  format?: MediaFormat | null;
  timeoutMs?: number;
};

function withTimeout<T>(work: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => { onTimeout(); reject(new Error(`probe timed out after ${ms} ms`)); }, ms);
    work.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

/** Largest image header we read; the pixel data behind it is never needed. */
const IMAGE_HEADER_BYTES = 16 * 1024 * 1024;
async function probeImage({ name, source }: ProbeOptions): Promise<ProbeResult> {
  const info = probeImageBytes(await source.read(0, Math.min(source.size, IMAGE_HEADER_BYTES)));
  if (!info) throw new ProbeError(name);
  // An animated GIF is imported as video.
  if (info.format === "gif" && (info.frameCount ?? 1) > 1 && info.durationSeconds) {
    return {
      type: "video", container: "gif", videoCodec: "gif", width: info.width, height: info.height, rotation: 0, hasAudio: false, hasAlpha: info.hasAlpha,
      duration: secondsToTicks(info.durationSeconds), fps: fpsToRational(info.frameCount! / info.durationSeconds),
      canDecode: typeof (globalThis as { ImageDecoder?: unknown }).ImageDecoder === "function" ? true : null,
    };
  }
  return { type: "image", container: info.format, width: info.width, height: info.height, rotation: info.rotation, hasAlpha: info.hasAlpha, canDecode: null };
}

async function probeTimed(options: ProbeOptions): Promise<ProbeResult> {
  const { name, source, type } = options;
  const input = new Input({ source: new CustomSource({ getSize: () => source.size, read: (start, end) => source.read(start, end) }), formats: ALL_FORMATS });
  try {
    return await withTimeout((async (): Promise<ProbeResult> => {
      const format = await input.getFormat();
      const named = CONTAINER_NAMES[format.name] ?? format.name.toLowerCase();
      // MP4, MOV, M4V, M4A and 3GP share one demuxer: the brand or extension names the container.
      const hinted = options.format ?? detectMediaType({ name })?.format ?? null;
      const container = hinted && ISO_FAMILY.has(named) && ISO_FAMILY.has(hinted) ? hinted : named === "ogg" && (hinted === "opus" || extensionOf(name) === "opus") ? "opus" : named;
      const video = type === "video" ? await input.getPrimaryVideoTrack() : null;
      const audio = await input.getPrimaryAudioTrack();
      const seconds = await input.computeDuration();
      // A "video" container that holds only sound (an audio-only WebM or MP4) is an audio asset.
      if (!(seconds > 0) || (!video && !audio)) throw new Error("no readable track");
      const sound = audio ? { audioCodec: normaliseCodec(audio.codec), sampleRate: audio.sampleRate, channels: audio.numberOfChannels } : {};
      if (!video) return { type: "audio", container, duration: secondsToTicks(seconds), rotation: 0, canDecode: hasWebCodecs() ? await audio!.canDecode() : null, ...sound };
      const stats = await video.computePacketStats(FPS_PACKET_SAMPLE);
      const rotation = (((video.rotation % 360) + 360) % 360) as 0 | 90 | 180 | 270;
      return {
        type: "video", container, duration: secondsToTicks(seconds), width: video.displayWidth, height: video.displayHeight, rotation,
        ...(Number.isFinite(stats.averagePacketRate) && stats.averagePacketRate > 0 ? { fps: fpsToRational(stats.averagePacketRate) } : {}),
        hasAudio: audio !== null, videoCodec: normaliseCodec(video.codec), hasAlpha: await video.canBeTransparent().catch(() => false),
        canDecode: hasWebCodecs() ? await video.canDecode() : null, ...sound,
        ...(audio ? { canDecodeSound: hasWebCodecs() ? await audio.canDecode().catch(() => false) : null } : {}),
      };
    })(), options.timeoutMs ?? PROBE_TIMEOUT_MS, () => input.dispose());
  } finally {
    input.dispose();
  }
}

/**
 * Probes one file. A file that cannot be read at all — corrupt, truncated, or not answering within the timeout — is
 * rejected with `ProbeError` ("Unable to read {name}").
 */
export async function probeMedia(options: ProbeOptions): Promise<ProbeResult> {
  try {
    return options.type === "image" ? await probeImage(options) : await probeTimed(options);
  } catch (error) {
    throw error instanceof ProbeError ? error : new ProbeError(options.name, error);
  }
}

/** The asset-record fields a probe result writes (catalogue §12.2); sample rate, channels and alpha are not record fields. */
export function probeRecordFields(probe: ProbeResult): Record<string, unknown> {
  const fields: Record<string, unknown> = { type: probe.type, rotation: probe.rotation };
  for (const key of ["width", "height", "duration", "fps", "hasAudio", "videoCodec", "audioCodec", "container"] as const) if (probe[key] !== undefined) fields[key] = probe[key];
  return fields;
}
/** While `hasAudio` is undefined (a classic asset whose probe has not completed) the asset is treated as having audio. */
export const assetHasAudio = (asset: { type: MediaType; hasAudio?: boolean }): boolean => asset.type === "audio" || (asset.type === "video" && asset.hasAudio !== false);
