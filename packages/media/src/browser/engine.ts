import { TICKS_PER_SECOND, type Rational } from "@jagentchill/protocol";
import {
  ALL_FORMATS, AudioSampleSink, BlobSource, BufferTarget, CanvasSink, Conversion, Input, Mp4OutputFormat, Output, VideoSampleSink, WebMOutputFormat,
  canEncodeAudio, canEncodeVideo,
} from "mediabunny";
import { detectMediaType, SNIFF_BYTES, SVG_MIME, type Detected } from "../detect.ts";
import { filmstripFrameSize } from "../filmstrip.ts";
import { blobSource, hashSource, sha256Hex } from "../hash.ts";
import { probeMedia, type ProbeResult } from "../probe.ts";
import { decodeTestRange, proxySpec, type EncoderSupport, type ProxyForm } from "../proxy.ts";
import { thumbnailEncoding, thumbnailSize, thumbnailTimeTicks, type Thumbnail } from "../thumbnail.ts";
import { WaveformBuilder, type WaveformSummary } from "../waveform.ts";

/**
 * The decode-dependent half of the media engine, for runtimes with WebCodecs and a canvas: browsers, the desktop
 * shell and the engine WebView on mobile. It runs unchanged in a dedicated worker (see `worker.ts`); only SVG
 * rasterisation needs a document. [PORT: `readVideoFile`, `generateImageThumbnail` and `renderThumbnailDataUrl` of
 * OpenCut classic, with thumbnails returned as bytes for the thumbnail store instead of data URLs.]
 */
type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;
function createCanvas(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  return canvas;
}
async function encodeCanvas(canvas: AnyCanvas, mimeType: string, quality?: number): Promise<Uint8Array> {
  const blob = "convertToBlob" in canvas
    ? await canvas.convertToBlob({ type: mimeType, quality })
    : await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => (result ? resolve(result) : reject(new Error("canvas could not be encoded"))), mimeType, quality));
  return new Uint8Array(await blob.arrayBuffer());
}
const context2d = (canvas: AnyCanvas): OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D => {
  const context = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
  if (!context) throw new Error("Could not get canvas context");
  return context;
};
const openInput = (blob: Blob): Input => new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
const seconds = (ticks: number): number => ticks / TICKS_PER_SECOND;
const yieldToLoop = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

export type Probed = { detected: Detected; probe: ProbeResult };
/** Detects and probes one file. `null` detection: unsupported type. Throws `ProbeError` for an unreadable file. */
export async function probeBlob(blob: Blob, name: string, mimeType = blob.type): Promise<Probed | null> {
  const head = new Uint8Array(await blob.slice(0, SNIFF_BYTES).arrayBuffer());
  const detected = detectMediaType({ name, mimeType, head });
  if (!detected) return null;
  return { detected, probe: await probeMedia({ name, type: detected.type, format: detected.format, source: blobSource(blob) }) };
}
export const hashBlob = (blob: Blob, onProgress?: (fraction: number) => void): Promise<string> => hashSource(blobSource(blob), { onProgress });

async function drawToThumbnail(source: CanvasImageSource, width: number, height: number, hasAlpha: boolean): Promise<Thumbnail> {
  const size = thumbnailSize({ width, height }), canvas = createCanvas(size.width, size.height), encoding = thumbnailEncoding(hasAlpha);
  context2d(canvas).drawImage(source, 0, 0, size.width, size.height);
  return { bytes: await encodeCanvas(canvas, encoding.mimeType, encoding.quality), mimeType: encoding.mimeType, ...size };
}
/**
 * Rasterises an SVG in an image context: an `<img>` never runs the document's scripts and never fetches what it
 * references, so nothing inside the file executes or reaches the network. Needs a document (not available in a worker).
 */
export async function rasteriseSvg(blob: Blob, width: number, height: number): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob.type === SVG_MIME ? blob : new Blob([blob], { type: SVG_MIME }));
  try {
    const image = new Image(width, height);
    image.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Could not load image"));
      image.src = url;
    });
    return image;
  } finally {
    // The decoded picture stays usable after the URL is revoked.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
async function gifFrame(blob: Blob, timeSeconds: number, fps: Rational | undefined): Promise<CanvasImageSource> {
  const Decoder = (globalThis as { ImageDecoder?: new (init: { data: ReadableStream<Uint8Array>; type: string }) => { decode(options: { frameIndex: number }): Promise<{ image: VideoFrame }>; close(): void; tracks: { ready: Promise<void>; selectedTrack: { frameCount: number } | null } } }).ImageDecoder;
  if (!Decoder || !fps) return createImageBitmap(blob);
  const decoder = new Decoder({ data: blob.stream(), type: "image/gif" });
  try {
    await decoder.tracks.ready;
    const count = decoder.tracks.selectedTrack?.frameCount ?? 1;
    const index = Math.max(0, Math.min(count - 1, Math.floor((timeSeconds * fps.numerator) / fps.denominator)));
    return (await decoder.decode({ frameIndex: index })).image;
  } finally {
    decoder.close();
  }
}

/**
 * The library thumbnail of a visual asset: the video frame at `min(1 s, duration / 2)`, or the image itself, scaled
 * to fit 1280 × 720 and encoded as JPEG quality 0.8 (PNG when the picture has alpha). `null` when no picture can be
 * decoded on this device; audio has no thumbnail.
 */
export async function makeThumbnail(blob: Blob, probe: ProbeResult): Promise<Thumbnail | null> {
  if (probe.type === "audio" || !probe.width || !probe.height) return null;
  const hasAlpha = probe.hasAlpha === true;
  if (probe.type === "image") {
    if (probe.container === "svg") {
      if (typeof document === "undefined") throw new Error("SVG rasterisation needs a document");
      return drawToThumbnail(await rasteriseSvg(blob, probe.width, probe.height), probe.width, probe.height, true);
    }
    const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
    try { return await drawToThumbnail(bitmap, bitmap.width, bitmap.height, hasAlpha); } finally { bitmap.close(); }
  }
  const at = seconds(thumbnailTimeTicks(probe.duration ?? 0));
  if (probe.container === "gif") {
    const frame = await gifFrame(blob, at, probe.fps);
    try { return await drawToThumbnail(frame, probe.width, probe.height, hasAlpha); } finally { (frame as { close?: () => void }).close?.(); }
  }
  if (probe.canDecode === false) return null;
  const input = openInput(blob);
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) return null;
    const size = thumbnailSize({ width: track.displayWidth, height: track.displayHeight });
    const sink = new CanvasSink(track, { ...size, fit: "fill", alpha: hasAlpha, poolSize: 1 });
    const frame = await sink.getCanvas(at) ?? await sink.getCanvas(await track.getFirstTimestamp());
    if (!frame) return null;
    const encoding = thumbnailEncoding(hasAlpha);
    return { bytes: await encodeCanvas(frame.canvas, encoding.mimeType, encoding.quality), mimeType: encoding.mimeType, ...size };
  } finally {
    input.dispose();
  }
}

export const FILMSTRIP_JPEG_QUALITY = 0.7;
/** Decodes filmstrip frames 90 px high for the given source times (ticks). One input serves all of them. */
export async function decodeFilmstripFrames(blob: Blob, times: number[]): Promise<{ time: number; bytes: Uint8Array | null; width: number; height: number }[]> {
  const input = openInput(blob);
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) throw new Error("video cannot be decoded on this device");
    const size = filmstripFrameSize({ width: track.displayWidth, height: track.displayHeight });
    const sink = new CanvasSink(track, { ...size, fit: "fill", poolSize: 1 });
    const frames: { time: number; bytes: Uint8Array | null; width: number; height: number }[] = [];
    for (const time of times) {
      const frame = await sink.getCanvas(seconds(time));
      frames.push({ time, bytes: frame ? await encodeCanvas(frame.canvas, "image/jpeg", FILMSTRIP_JPEG_QUALITY) : null, ...size });
    }
    return frames;
  } finally {
    input.dispose();
  }
}

/** Longest stretch of work between yields: no task this engine causes on its thread exceeds 50 ms. */
const SLICE_MS = 16;
/**
 * Decodes the audio of a file and builds its waveform summary. Progress 0–1 is reported at least once per second
 * of work; the loop yields often, so it is safe on a UI thread as well as in a worker.
 */
export async function computeWaveform(blob: Blob, onProgress?: (fraction: number) => void): Promise<WaveformSummary> {
  const input = openInput(blob);
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error("the file has no audio");
    if (!(await track.canDecode())) throw new Error("audio cannot be decoded on this device");
    const duration = await track.computeDuration(), builder = new WaveformBuilder(track.sampleRate), sink = new AudioSampleSink(track);
    let sliceStart = performance.now(), lastReport = sliceStart, planes: Float32Array[] = [];
    onProgress?.(0);
    for await (const sample of sink.samples()) {
      const frames = sample.numberOfFrames, channels = sample.numberOfChannels;
      if (planes.length !== channels || planes[0].length !== frames) planes = Array.from({ length: channels }, () => new Float32Array(frames));
      for (let channel = 0; channel < channels; channel++) sample.copyTo(planes[channel], { planeIndex: channel, format: "f32-planar" });
      const end = sample.timestamp + sample.duration;
      sample.close();
      builder.push(planes);
      const now = performance.now();
      if (now - lastReport >= 250) { onProgress?.(duration > 0 ? Math.min(0.999, end / duration) : 0); lastReport = now; }
      if (now - sliceStart >= SLICE_MS) { await yieldToLoop(); sliceStart = performance.now(); }
    }
    onProgress?.(1);
    return builder.finish();
  } finally {
    input.dispose();
  }
}

/** The import decode test: decodes 60 frames starting at 1 s (the whole file when shorter) and returns the average rate in frames per second. */
export async function decodeTest(blob: Blob, probe: { duration?: number; fps?: Rational }): Promise<number | undefined> {
  if (!probe.duration || !probe.fps) return undefined;
  const input = openInput(blob);
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) return undefined;
    const range = decodeTestRange(probe.duration, probe.fps), sink = new VideoSampleSink(track);
    let decoded = 0, started = 0;
    for await (const sample of sink.samples(seconds(range.start))) {
      // The clock starts with the first frame out, so decoder start-up is not counted against the file.
      if (decoded === 0) started = performance.now();
      sample.close();
      if (++decoded > range.frames) break;
    }
    const elapsed = (performance.now() - started) / 1000;
    return decoded > 1 && elapsed > 0 ? (decoded - 1) / elapsed : undefined;
  } finally {
    input.dispose();
  }
}

/** Which proxy encoders this device has, asked at the proxy's own size and rate. */
export async function encoderSupport(): Promise<EncoderSupport> {
  if (typeof (globalThis as { VideoEncoder?: unknown }).VideoEncoder !== "function") return { h264: false, aac: false, vp9: false, opus: false };
  const video = { width: 1280, height: 720, bitrate: 4_000_000 }, audio = { numberOfChannels: 2, sampleRate: 48_000, bitrate: 128_000 };
  const [h264, vp9, aac, opus] = await Promise.all([
    canEncodeVideo("avc", video).catch(() => false), canEncodeVideo("vp9", video).catch(() => false),
    canEncodeAudio("aac", audio).catch(() => false), canEncodeAudio("opus", audio).catch(() => false),
  ]);
  return { h264, vp9, aac, opus };
}

export type GeneratedProxy = { bytes: Uint8Array; size: number; sha256: string; form: ProxyForm; width: number; height: number; fps: Rational };
/**
 * Makes the proxy of a decodable video on this device with WebCodecs, in the form given (see `selectProxyProducer`).
 * Every source frame and its timestamp is kept up to 60 fps; faster sources are decimated by the spec's factor.
 */
export async function generateProxy(blob: Blob, source: { width: number; height: number; fps: Rational; hasAudio?: boolean }, form: ProxyForm, options: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {}): Promise<GeneratedProxy> {
  const spec = proxySpec(source, form), input = openInput(blob), target = new BufferTarget();
  const output = new Output({ format: form === "mp4" ? new Mp4OutputFormat({ fastStart: "in-memory" }) : new WebMOutputFormat(), target });
  try {
    const conversion = await Conversion.init({
      input, output, tracks: "primary",
      video: {
        width: spec.width, height: spec.height, fit: "fill", codec: form === "mp4" ? "avc" : "vp9", bitrate: spec.videoBitrate,
        keyFrameInterval: spec.keyFrameIntervalSeconds, forceTranscode: true, alpha: "discard",
        ...(spec.decimation > 1 ? { frameRate: spec.fps.numerator / spec.fps.denominator } : {}),
      },
      audio: spec.audio
        ? { codec: form === "mp4" ? "aac" : "opus", bitrate: spec.audio.bitrate, numberOfChannels: spec.audio.channels, forceTranscode: true, ...(spec.audio.sampleRate === "source" ? {} : { sampleRate: spec.audio.sampleRate }) }
        : { discard: true },
    });
    if (!conversion.isValid) throw new Error(`proxy cannot be produced on this device: ${conversion.discardedTracks.map((entry) => entry.reason).join(", ") || "no usable track"}`);
    conversion.onProgress = (fraction) => options.onProgress?.(fraction);
    const onAbort = () => void conversion.cancel();
    options.signal?.addEventListener("abort", onAbort);
    try { await conversion.execute(); } finally { options.signal?.removeEventListener("abort", onAbort); }
    if (options.signal?.aborted || !target.buffer) throw new Error("cancelled");
    const bytes = new Uint8Array(target.buffer);
    return { bytes, size: bytes.length, sha256: sha256Hex(bytes), form, width: spec.width, height: spec.height, fps: spec.fps };
  } finally {
    input.dispose();
  }
}
