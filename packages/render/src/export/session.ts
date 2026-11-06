import { AudioSample, AudioSampleSource, FlacOutputFormat, MovOutputFormat, Mp4OutputFormat, Output, StreamTarget, VideoSample, VideoSampleSource, WavOutputFormat, WebMOutputFormat } from "mediabunny";
import { mediaTimeFromFrame, mediaTimeToFrame, mediaTimeToSeconds } from "@jagentchill/editor-core";
import type { EngineCommandParsed, EngineConstraints, EngineReady } from "@jagentchill/protocol";
import { EngineFailure } from "../surface/errors.ts";
import { createGifWriter } from "./gif.ts";
import { jpegWithXmp, pngWithXmp } from "./metadata.ts";

type ExportRequest = EngineCommandParsed<"export.start">;
type FrameRate = { numerator: number; denominator: number };

/** `floor(rangeDuration / frameDuration)`, computed from the frame grid itself: no accumulated rounding. */
export const exportFrameCount = (rangeDuration: number, frameRate: FrameRate): number => Math.max(0, mediaTimeToFrame(rangeDuration, frameRate));
/** Time of export frame `index`: `rangeStart + frameTime(index)`, one multiplication per index. */
export const exportFrameTime = (rangeStart: number, index: number, frameRate: FrameRate): number => rangeStart + mediaTimeFromFrame(index, frameRate);

/**
 * Refuses, before anything is rendered, a request the device cannot satisfy. Opus is never written where AAC was
 * asked for, PCM is never written into MP4, and an output larger than the texture limit goes to the host.
 */
export function checkExportRequest(request: ExportRequest, ready: Pick<EngineReady, "backend" | "encoders" | "audioEncoders" | "maxTextureSize" | "constraints">): void {
  if (ready.backend === "none") throw new EngineFailure("engine/no-gpu", "no GPU backend is available for an on-device export");
  if (Math.max(request.width, request.height) > ready.maxTextureSize) {
    throw new EngineFailure("engine/encoder-unavailable", "the output is larger than this device can render", { detail: "texture-limit", maxTextureSize: ready.maxTextureSize });
  }
  const constraints: EngineConstraints = ready.constraints;
  // GIF and image sequences are encoded by project code: they need no platform encoder.
  const frames = request.container === "gif" || request.container === "image-sequence";
  if (request.video && !frames) {
    if (!constraints.onDeviceVideoExport) throw new EngineFailure("engine/encoder-unavailable", "this device cannot encode video; export on a paired host", { alternatives: ["host"] });
    if (!ready.encoders[request.video.codec].supported) {
      const alternatives = (Object.keys(ready.encoders) as (keyof EngineReady["encoders"])[]).filter((codec) => ready.encoders[codec].supported);
      throw new EngineFailure("engine/encoder-unavailable", `no ${request.video.codec} encoder is available`, { codec: request.video.codec, alternatives });
    }
  }
  if (request.audio && frames) throw new EngineFailure("surface/invalid-payload", `${request.container} carries no audio`);
  if (request.audio) {
    const { codec } = request.audio;
    // PCM lives in MOV and in WAV, never in MP4; a WAV holds nothing but PCM and a FLAC file nothing but FLAC.
    const pcmHome = request.container === "mov" || request.container === "wav";
    const fits = request.container === "wav" ? codec === "pcm" : request.container === "flac" ? codec === "flac" : true;
    const available = fits && (codec === "pcm" ? pcmHome : codec === "aac" ? ready.audioEncoders.aac : codec === "opus" ? ready.audioEncoders.opus : ready.audioEncoders.flac);
    if (!available) {
      const alternatives: string[] = [];
      if (ready.audioEncoders.opus) alternatives.push("opus in webm");
      if (ready.audioEncoders.aac) alternatives.push("aac in mp4");
      throw new EngineFailure("engine/encoder-unavailable", `no ${codec} encoder is available for ${request.container}`, { codec, alternatives });
    }
  }
}

export type ExportWriter = {
  addVideoFrame(pixels: Uint8Array, index: number): Promise<void>;
  addAudio(block: Float32Array[], firstFrame: number): Promise<void>;
  finalize(): Promise<void>;
  cancel(): Promise<void>;
};

/** Finishes muxing unless cancellation arrives; cancellation starts writer cleanup without waiting for a stuck flush. */
export type FinaliseOutcome = "done" | "cancelled" | "timed-out";
export const FINALISING_TIMEOUT_MS = 60_000;
export function createFinalisingWatchdog(onTimeout: () => void, timers: Pick<typeof globalThis, "setTimeout" | "clearTimeout"> = globalThis) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    reset() {
      if (timer !== undefined) timers.clearTimeout(timer);
      timer = timers.setTimeout(onTimeout, FINALISING_TIMEOUT_MS);
    },
    clear() {
      if (timer !== undefined) timers.clearTimeout(timer);
      timer = undefined;
    },
  };
}
export async function finalizeOrCancel(
  writer: ExportWriter,
  cancelled: Promise<void>,
  timeoutMs = FINALISING_TIMEOUT_MS,
  timers: Pick<typeof globalThis, "setTimeout" | "clearTimeout"> = globalThis,
): Promise<FinaliseOutcome> {
  let timeout: ReturnType<typeof setTimeout>;
  const timedOut = new Promise<FinaliseOutcome>((resolve) => { timeout = timers.setTimeout(() => resolve("timed-out"), timeoutMs); });
  const outcome = await Promise.race([
    writer.finalize().then(() => "done" as const),
    cancelled.then(() => "cancelled" as const),
    timedOut,
  ]);
  timers.clearTimeout(timeout!);
  if (outcome !== "done") void writer.cancel().catch(() => undefined);
  return outcome;
}

/**
 * The encoder and muxer of an export. Encoded output leaves through `onChunk` as positioned writes of at most
 * 4 MiB, so the file is never held whole in memory and a non-fragmented MP4 can have its `moov` written back.
 */
export async function createExportWriter(request: ExportRequest, onChunk: (data: Uint8Array, position: number) => void): Promise<ExportWriter> {
  if (request.container === "gif" || request.container === "image-sequence") return createFrameWriter(request, onChunk);
  const format = request.container === "webm" ? new WebMOutputFormat() : request.container === "mov" ? new MovOutputFormat({ fastStart: false })
    : request.container === "wav" ? new WavOutputFormat() : request.container === "flac" ? new FlacOutputFormat() : new Mp4OutputFormat({ fastStart: false });
  const target = new StreamTarget(new WritableStream({ write: (chunk) => { onChunk(chunk.data, chunk.position); } }), { chunked: true, chunkSize: 4 * 1024 * 1024 });
  const output = new Output({ format, target });
  const frameSeconds = request.frameRate.denominator / request.frameRate.numerator;
  let video: VideoSampleSource | undefined, audio: AudioSampleSource | undefined;
  if (request.video) {
    video = new VideoSampleSource({
      codec: request.video.codec, bitrate: request.video.bitrate ?? Math.round(request.width * request.height * (request.frameRate.numerator / request.frameRate.denominator) * 0.1),
      keyFrameInterval: 2, alpha: request.video.alpha ? "keep" : "discard",
      ...(request.video.bitrateMode ? { bitrateMode: request.video.bitrateMode } : {}), ...(request.video.hardwareAcceleration ? { hardwareAcceleration: request.video.hardwareAcceleration } : {}),
      // The output is tagged BT.709 primaries, transfer and matrix, limited range.
      onEncoderConfig: (config) => { (config as { colorSpace?: VideoColorSpaceInit }).colorSpace ??= { primaries: "bt709", transfer: "bt709", matrix: "bt709", fullRange: false }; },
    });
    output.addVideoTrack(video, { frameRate: request.frameRate.numerator / request.frameRate.denominator });
  }
  if (request.audio) {
    const codec = request.audio.codec === "pcm" ? (request.audio.bitDepth === 24 ? "pcm-s24" : "pcm-s16") : request.audio.codec;
    audio = new AudioSampleSource({ codec, ...(request.audio.codec === "pcm" || request.audio.codec === "flac" ? {} : { bitrate: request.audio.bitrate ?? 192_000 }) });
    output.addAudioTrack(audio);
  }
  if (request.metadata) {
    const { comment, tags, cover } = request.metadata;
    output.setMetadataTags({
      ...(comment ? { comment } : {}), ...(tags ? { raw: tags } : {}),
      ...(cover ? { images: [{ data: Uint8Array.from(atob(cover), (char) => char.charCodeAt(0)), mimeType: "image/jpeg", kind: "coverFront" as const }] } : {}),
    });
  }
  await output.start();
  const sampleRate = request.audio?.sampleRate ?? 48_000;
  return {
    async addVideoFrame(pixels, index) {
      // Seconds exist only here, at the muxer boundary, derived from the frame index.
      const timestamp = mediaTimeToSeconds(mediaTimeFromFrame(index, request.frameRate));
      const sample = new VideoSample(pixels, {
        format: "RGBA", codedWidth: request.width, codedHeight: request.height, timestamp, duration: frameSeconds,
        colorSpace: { primaries: "bt709", transfer: "iec61966-2-1", matrix: "rgb", fullRange: true },
      });
      try { await video!.add(sample); } finally { sample.close(); }
    },
    async addAudio(block, firstFrame) {
      const frames = block[0].length;
      const planar = new Float32Array(frames * block.length);
      block.forEach((channel, index) => planar.set(channel, index * frames));
      const sample = new AudioSample({ data: planar, format: "f32-planar", numberOfChannels: block.length, sampleRate, timestamp: firstFrame / sampleRate });
      try { await audio!.add(sample); } finally { sample.close(); }
    },
    finalize: () => output.finalize(),
    cancel: () => output.cancel(),
  };
}

const fromBase64 = (text: string): Uint8Array => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
/** The writers that need no platform encoder: an animated GIF, and an image sequence that leaves one encoded frame per chunk. */
function createFrameWriter(request: ExportRequest, onChunk: (data: Uint8Array, position: number) => void): ExportWriter {
  let position = 0;
  const write = (bytes: Uint8Array) => { onChunk(bytes, position); position += bytes.byteLength; };
  const alpha = request.video?.alpha === true;
  if (request.container === "gif") {
    const gif = createGifWriter({
      width: request.width, height: request.height, frameRate: request.frameRate.numerator / request.frameRate.denominator, loop: request.gif?.loop ?? "forever", dither: request.gif?.dither ?? "floyd-steinberg",
      ...(request.gif?.palette ? { globalPalette: fromBase64(request.gif.palette) } : {}), ...(request.metadata?.xmp ? { xmp: request.metadata.xmp } : {}),
    }, write);
    return { addVideoFrame: async (pixels) => { gif.addFrame(pixels); }, addAudio: async () => undefined, finalize: async () => { gif.finish(); }, cancel: async () => undefined };
  }
  const format = request.image?.format ?? "png", canvas = new OffscreenCanvas(request.width, request.height), context = canvas.getContext("2d")!;
  return {
    async addVideoFrame(pixels) {
      const image = new ImageData(new Uint8ClampedArray(pixels.buffer as ArrayBuffer, pixels.byteOffset, pixels.byteLength), request.width, request.height);
      // Without an alpha channel in the output, uncovered pixels are flattened onto black.
      if (format === "jpeg" || !alpha) { context.fillStyle = "#000000"; context.fillRect(0, 0, request.width, request.height); const layer = new OffscreenCanvas(request.width, request.height); layer.getContext("2d")!.putImageData(image, 0, 0); context.drawImage(layer, 0, 0); } // content-colour
      else context.putImageData(image, 0, 0);
      const blob = await canvas.convertToBlob(format === "png" ? { type: "image/png" } : { type: "image/jpeg", quality: (request.image?.quality ?? 90) / 100 });
      const bytes = new Uint8Array(await blob.arrayBuffer()), xmp = request.metadata?.xmp;
      write(xmp ? (format === "png" ? pngWithXmp(bytes, xmp) : jpegWithXmp(bytes, xmp)) : bytes);
    },
    addAudio: async () => undefined, finalize: async () => undefined, cancel: async () => undefined,
  };
}
