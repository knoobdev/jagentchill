/**
 * The export settings of `export-share`: every option of the export dialog with its values and defaults, the built-in
 * presets, the resolution, frame-rate and bitrate rules, the size estimate, the codec and container rules and the
 * stored form of `exportSettings` in the project document. Pure rules: no DOM, no engine.
 */
import type { Rational as RationalValue } from "@jagentchill/protocol";

type Rational = RationalValue;
export type Size = { width: number; height: number };

export const EXPORT_TYPES = ["video", "gif", "audio", "image-sequence", "still", "captions"] as const;
export type ExportType = (typeof EXPORT_TYPES)[number];
export const EXPORT_TYPE_LABELS: Record<ExportType, string> = { video: "Video", gif: "GIF", audio: "Audio", "image-sequence": "Image sequence", still: "Still frame", captions: "Captions only" };

export const VIDEO_CODECS = ["h264", "hevc", "vp9", "av1"] as const;
export type VideoCodec = (typeof VIDEO_CODECS)[number];
/** Intermediate codecs that only a host encodes. */
export const HOST_CODECS = ["prores-422hq", "prores-4444"] as const;
export type HostCodec = (typeof HOST_CODECS)[number];
export type AnyVideoCodec = VideoCodec | HostCodec;
export const CODEC_LABELS: Record<AnyVideoCodec, string> = { h264: "H.264", hevc: "HEVC", vp9: "VP9", av1: "AV1", "prores-422hq": "ProRes 422 HQ", "prores-4444": "ProRes 4444" };
export const CONTAINERS = ["mp4", "mov", "webm"] as const;
export type Container = (typeof CONTAINERS)[number];
export const CONTAINER_LABELS: Record<Container, string> = { mp4: "MP4", mov: "MOV", webm: "WebM" };
export const CONTAINER_MIME: Record<Container, string> = { mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm" };
export type AudioCodec = "aac" | "opus" | "pcm";
export const AUDIO_CODEC_LABELS: Record<AudioCodec, string> = { aac: "AAC", opus: "Opus", pcm: "PCM" };
export const BITRATE_LEVELS = ["lower", "recommended", "higher", "maximum", "custom"] as const;
export type BitrateLevel = (typeof BITRATE_LEVELS)[number];
export const BITRATE_LEVEL_LABELS: Record<BitrateLevel, string> = { lower: "Lower", recommended: "Recommended", higher: "Higher", maximum: "Maximum", custom: "Custom" };
export const RESOLUTION_MODES = ["project", "480p", "720p", "1080p", "1440p", "2160p", "custom"] as const;
export type ResolutionMode = (typeof RESOLUTION_MODES)[number];
export const RESOLUTION_SHORT_SIDE: Record<Exclude<ResolutionMode, "project" | "custom">, number> = { "480p": 480, "720p": 720, "1080p": 1080, "1440p": 1440, "2160p": 2160 };
export const RESOLUTION_LABELS: Record<ResolutionMode, string> = { project: "Project", "480p": "480p", "720p": "720p", "1080p": "1080p", "1440p": "2K (1440p)", "2160p": "4K (2160p)", custom: "Custom" };
export const EXPORT_FRAME_RATES = [24, 25, 30, 50, 60] as const;
export const AAC_BITRATES = [96, 128, 192, 256, 320] as const;
export const OPUS_BITRATES = [64, 96, 128, 192, 256] as const;
export const SAMPLE_RATES = [44_100, 48_000] as const;
export const GIF_SIDES = [240, 320, 480, 640] as const;
export const GIF_FRAME_RATES = [10, 12, 15, 20, 25] as const;
export const GIF_MAX_SECONDS = 60;
export const AUDIO_ONLY_FORMATS = ["mp3", "wav", "m4a", "flac"] as const;
export type AudioOnlyFormat = (typeof AUDIO_ONLY_FORMATS)[number];
export const AUDIO_ONLY_LABELS: Record<AudioOnlyFormat, string> = { mp3: "MP3", wav: "WAV", m4a: "AAC (M4A)", flac: "FLAC" };
export const AUDIO_ONLY_MIME: Record<AudioOnlyFormat, string> = { mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", flac: "audio/flac" };
export const MP3_BITRATES = [128, 192, 256, 320] as const;
export const SIDECAR_FORMATS = ["srt", "vtt", "ass", "txt"] as const;
export type SidecarFormat = (typeof SIDECAR_FORMATS)[number];
export type AudioFallback = "host" | "webm" | "opus-mp4" | "pcm-mov";
export const SEQUENCE_CONFIRM_FRAMES = 18_000;
export const TICKS_PER_SECOND = 120_000;

export type ExportSettings = {
  type: ExportType;
  presetId: string | null;
  resolution: { mode: ResolutionMode; width: number; height: number };
  frameRate: "project" | Rational;
  bitrateLevel: BitrateLevel;
  customMbps: number;
  rateControl: "vbr" | "cbr";
  videoCodec: AnyVideoCodec;
  container: Container;
  hardwareAcceleration: "auto" | "prefer-hardware" | "prefer-software";
  smoothMotion: boolean;
  includeAudio: boolean;
  audioCodec: AudioCodec;
  audioBitrateKbps: number;
  sampleRate: 44_100 | 48_000;
  channels: 1 | 2;
  /** The explicit choice made when the target has no AAC encoder; nothing is applied silently. */
  audioFallback: AudioFallback | null;
  burnCaptions: boolean;
  sidecar: { enabled: boolean; format: SidecarFormat; trackIds: string[] | null; content: "primary" | "translation" | "both" };
  embedCover: boolean;
  aiLabel: boolean;
  creditsFile: boolean;
  range: "all" | "in-out";
  includeTransparency: boolean;
  gif: { shortSide: number; frameRate: number; loop: "forever" | "once" | number; palette: "per-frame" | "global"; dither: "floyd-steinberg" | "none" };
  imageSequence: { format: "png" | "jpeg"; quality: number };
  still: { format: "png" | "jpeg"; quality: number };
  audioOnly: { format: AudioOnlyFormat; bitrateKbps: number; bitDepth: 16 | 24 };
  target: "device" | "host";
};

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  type: "video", presetId: "match-project", resolution: { mode: "project", width: 1920, height: 1080 }, frameRate: "project", bitrateLevel: "recommended", customMbps: 10,
  rateControl: "vbr", videoCodec: "h264", container: "mp4", hardwareAcceleration: "auto", smoothMotion: false, includeAudio: true, audioCodec: "aac", audioBitrateKbps: 192,
  sampleRate: 48_000, channels: 2, audioFallback: null, burnCaptions: true, sidecar: { enabled: false, format: "srt", trackIds: null, content: "primary" }, embedCover: true,
  aiLabel: false, creditsFile: true, range: "all", includeTransparency: false, gif: { shortSide: 480, frameRate: 15, loop: "forever", palette: "per-frame", dither: "floyd-steinberg" },
  imageSequence: { format: "png", quality: 90 }, still: { format: "png", quality: 90 }, audioOnly: { format: "mp3", bitrateKbps: 192, bitDepth: 16 }, target: "device",
};

// ---- resolution -------------------------------------------------------------------------------------------------------

/** The nearest even integer; a value half-way between two (an odd integer) goes up. */
export const evenRound = (value: number): number => { const down = Math.floor(value / 2) * 2; return value - down >= 1 ? down + 2 : down; };
/** The size whose short side is `side` with the long side from the aspect ratio of `canvas`, rounded to even. */
export function shortSideSize(canvas: Size, side: number): Size {
  const landscape = canvas.width >= canvas.height, ratio = landscape ? canvas.width / canvas.height : canvas.height / canvas.width;
  const long = evenRound(side * ratio);
  return landscape ? { width: long, height: side } : { width: side, height: long };
}
/** A typed custom side: an even integer from 128 to 4 096. */
export const fixCustomSide = (value: number): number => Math.min(4096, Math.max(128, evenRound(Number.isFinite(value) ? Math.round(value) : 128)));
export function outputSize(settings: Pick<ExportSettings, "resolution">, canvas: Size): Size {
  const { mode, width, height } = settings.resolution;
  if (mode === "project") return { width: evenRound(canvas.width), height: evenRound(canvas.height) };
  if (mode === "custom") return { width: fixCustomSide(width), height: fixCustomSide(height) };
  return shortSideSize(canvas, RESOLUTION_SHORT_SIDE[mode]);
}
const sameRatio = (a: Size, b: Size) => Math.abs(a.width * b.height - b.width * a.height) <= Math.max(a.width, b.width) * 2;
/** A preset or custom size whose aspect ratio is not the project's: the picture is contain-fitted with bars. */
export const aspectDiffers = (settings: Pick<ExportSettings, "resolution">, canvas: Size): boolean => !sameRatio(outputSize(settings, canvas), canvas);
export const ASPECT_WARNING = "Aspect ratio differs from the project; the picture is fitted with bars";
/** "Upscaled": the output is larger than the canvas and some raster source is smaller than it is shown. */
export const isUpscaled = (output: Size, canvas: Size, rasterSources: Size[]): boolean =>
  output.width * output.height > canvas.width * canvas.height && rasterSources.some((source) => source.width < output.width && source.height < output.height);

// ---- frame rate -------------------------------------------------------------------------------------------------------

export const outputFrameRate = (settings: Pick<ExportSettings, "frameRate">, project: Rational): Rational => (settings.frameRate === "project" ? project : settings.frameRate);
export const rateValue = (rate: Rational): number => rate.numerator / rate.denominator;
/** "29.97", "30", "23.976". */
export function rateLabel(rate: Rational): string {
  const value = rateValue(rate);
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 1000) / 1000).replace(/(\.\d{2})\d$/, (all, head: string) => (all.endsWith("6") && head === ".97" ? all : head));
}
/** The project frame a given output frame shows: the one whose interval contains the output frame time (no blending). */
export const projectFrameOf = (outputIndex: number, output: Rational, project: Rational): number =>
  Math.floor((outputIndex * output.denominator * project.numerator) / (output.numerator * project.denominator));
/** Frames of `duration` ticks at `rate`: `floor(duration / frameDuration)` on the frame grid. */
export const frameCountOf = (durationTicks: number, rate: Rational): number => Math.max(0, Math.floor((durationTicks * rate.numerator) / (TICKS_PER_SECOND * rate.denominator)));
/** "Smooth motion" has something to do when a video element in the range plays a source slower than the export rate without its own smoothing. */
export const smoothMotionAvailable = (sources: { fps?: Rational; smooth?: string }[], output: Rational): boolean =>
  sources.some((source) => source.fps !== undefined && rateValue(source.fps) < rateValue(output) - 1e-6 && (source.smooth ?? "none") === "none");

// ---- bitrate ----------------------------------------------------------------------------------------------------------

const LEVEL_FACTOR: Record<Exclude<BitrateLevel, "custom">, number> = { lower: 0.5, recommended: 1, higher: 1.5, maximum: 2.5 };
const CODEC_FACTOR: Record<AnyVideoCodec, number> = { h264: 1, hevc: 0.65, vp9: 0.7, av1: 0.55, "prores-422hq": 1, "prores-4444": 1 };
const tenth = (value: number) => Math.round(value * 10 + 1e-9) / 10;
export const clampCustomMbps = (value: number): number => tenth(Math.min(200, Math.max(0.2, Number.isFinite(value) ? value : 0.2)));
/** `10 Mbps × (pixels / 2 073 600)^0.75 × (fps / 30)^0.5`, times the level and the codec factor, rounded to 0.1 Mbps. */
export function videoBitrateMbps(settings: Pick<ExportSettings, "bitrateLevel" | "customMbps" | "videoCodec">, size: Size, fps: number): number {
  if (settings.bitrateLevel === "custom") return clampCustomMbps(settings.customMbps);
  const recommended = 10 * ((size.width * size.height) / 2_073_600) ** 0.75 * (fps / 30) ** 0.5;
  return tenth(recommended * LEVEL_FACTOR[settings.bitrateLevel] * CODEC_FACTOR[settings.videoCodec]);
}
/** The classic quality levels, when settings are imported. */
export const CLASSIC_QUALITY: Record<string, BitrateLevel> = { low: "lower", medium: "recommended", high: "higher", very_high: "maximum", "very high": "maximum" };

// ---- size estimate ----------------------------------------------------------------------------------------------------

/** GIF frame delays in 10 ms units whose running sum follows the frame rate exactly: 15 fps repeats 7, 7, 6. */
export const gifDelay = (index: number, fps: number): number => Math.ceil(((index + 1) * 100) / fps - 1e-9) - Math.ceil((index * 100) / fps - 1e-9);
export const gifSize = (canvas: Size, shortSide: number): Size => shortSideSize(canvas, shortSide);
export const wavBytes = (sampleRate: number, channels: number, bitDepth: number, seconds: number): number => Math.round(sampleRate * seconds) * channels * (bitDepth / 8) + 44;

export type Estimate = { bytes: number | null; frames: number | null; exact: boolean };
export function estimateExport(settings: ExportSettings, canvas: Size, projectFps: Rational, durationTicks: number): Estimate {
  const seconds = durationTicks / TICKS_PER_SECOND;
  if (settings.type === "video") {
    const size = outputSize(settings, canvas), rate = outputFrameRate(settings, projectFps);
    const audio = settings.includeAudio ? (settings.audioCodec === "pcm" ? settings.sampleRate * settings.channels * 16 : settings.audioBitrateKbps * 1000) : 0;
    return { bytes: ((videoBitrateMbps(settings, size, rateValue(rate)) * 1_000_000 + audio) * seconds) / 8, frames: frameCountOf(durationTicks, rate), exact: false };
  }
  if (settings.type === "gif") {
    const size = gifSize(canvas, settings.gif.shortSide), frames = frameCountOf(durationTicks, { numerator: settings.gif.frameRate, denominator: 1 });
    return { bytes: size.width * size.height * frames * 0.35, frames, exact: false };
  }
  if (settings.type === "audio") {
    const { format, bitrateKbps, bitDepth } = settings.audioOnly;
    if (format === "wav") return { bytes: wavBytes(settings.sampleRate, settings.channels, bitDepth, seconds), frames: null, exact: true };
    // FLAC at level 5 lands near 60 % of the PCM size.
    if (format === "flac") return { bytes: settings.sampleRate * settings.channels * 2 * seconds * 0.6, frames: null, exact: false };
    return { bytes: (bitrateKbps * 1000 * seconds) / 8, frames: null, exact: false };
  }
  if (settings.type === "image-sequence") return { bytes: null, frames: frameCountOf(durationTicks, outputFrameRate(settings, projectFps)), exact: true };
  return { bytes: null, frames: settings.type === "still" ? 1 : null, exact: true };
}
/** The size of a written file: kB below 1 MB, then as `formatBytes`. */
export const formatFileSize = (bytes: number): string => (bytes < 1_000_000 ? `${Math.max(1, Math.round(bytes / 1000))} kB` : formatBytes(bytes));
/** MB below 1 000 MB, GB with two decimals above; decimal units. */
export function formatBytes(bytes: number): string {
  const megabytes = bytes / 1_000_000;
  return megabytes < 1000 ? `${megabytes.toFixed(1)} MB` : `${(megabytes / 1000).toFixed(2)} GB`;
}
export function estimateLabel(estimate: Estimate): { text: string; values?: Record<string, string | number> } {
  if (estimate.bytes === null) return estimate.frames === null ? { text: "—" } : estimate.frames === 1 ? { text: "1 frame" } : { text: "{n} frames", values: { n: estimate.frames } };
  return { text: estimate.exact ? formatBytes(estimate.bytes) : `≈ ${formatBytes(estimate.bytes)}` };
}
/** "00:32" below an hour, "1:02:03" above. */
export function durationLabel(durationTicks: number): string {
  const total = Math.round(durationTicks / TICKS_PER_SECOND), pad = (value: number) => String(value).padStart(2, "0");
  return total >= 3600 ? `${Math.floor(total / 3600)}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}` : `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

// ---- codecs and containers --------------------------------------------------------------------------------------------

const CONTAINER_CODECS: Record<Container, AnyVideoCodec[]> = { mp4: ["h264", "hevc", "av1"], mov: ["h264", "hevc", "prores-422hq", "prores-4444"], webm: ["vp9", "av1"] };
/** VP9 with Opus in MP4 is written only by a host. */
export const containerCodecs = (container: Container, target: "device" | "host" = "device"): AnyVideoCodec[] => (container === "mp4" && target === "host" ? [...CONTAINER_CODECS.mp4, "vp9"] : CONTAINER_CODECS[container]);
export const containerAccepts = (container: Container, codec: AnyVideoCodec, target: "device" | "host" = "device"): boolean => containerCodecs(container, target).includes(codec);
export const defaultAudioCodec = (container: Container, codec: AnyVideoCodec): AudioCodec => (codec === "prores-422hq" || codec === "prores-4444" ? "pcm" : container === "webm" ? "opus" : "aac");
export const audioBitrates = (codec: AudioCodec): readonly number[] => (codec === "opus" ? OPUS_BITRATES : codec === "aac" ? AAC_BITRATES : []);
const withAudio = (settings: ExportSettings, audioCodec: AudioCodec): ExportSettings =>
  (settings.audioCodec === audioCodec ? settings : { ...settings, audioCodec, audioBitrateKbps: audioCodec === "opus" ? 128 : audioCodec === "aac" ? 192 : settings.audioBitrateKbps });
export type Change = { settings: ExportSettings; notice: { text: string; values?: Record<string, string | number> } | null };
/** Choosing a container restricts the codec: an incompatible one becomes the container's first codec, with a notice. */
export function chooseContainer(settings: ExportSettings, container: Container): Change {
  let next: ExportSettings = { ...settings, container, presetId: null }, notice: Change["notice"] = null;
  if (!containerAccepts(container, settings.videoCodec, settings.target)) {
    const codec = container === "webm" ? "vp9" : "h264";
    next = { ...next, videoCodec: codec };
    notice = container === "webm" ? { text: "WebM requires VP9 or AV1; switched to VP9" } : { text: "{container} requires H.264 or HEVC; switched to H.264", values: { container: CONTAINER_LABELS[container] } };
  }
  // An explicit Opus-in-MP4 choice survives only inside MP4.
  const keepOpus = container === "mp4" && settings.audioFallback === "opus-mp4";
  next = withAudio({ ...next, audioFallback: keepOpus ? "opus-mp4" : container === "mov" && settings.audioFallback === "pcm-mov" ? "pcm-mov" : null }, keepOpus ? "opus" : container === "mov" && settings.audioFallback === "pcm-mov" ? "pcm" : defaultAudioCodec(container, next.videoCodec));
  return { settings: next, notice };
}
/** Choosing a codec the container cannot hold switches the container to the first compatible one of MP4, MOV, WebM. */
export function chooseCodec(settings: ExportSettings, codec: AnyVideoCodec): Change {
  let next: ExportSettings = { ...settings, videoCodec: codec, presetId: null }, notice: Change["notice"] = null;
  if (!containerAccepts(settings.container, codec, settings.target)) {
    const container = CONTAINERS.find((candidate) => containerAccepts(candidate, codec, settings.target))!;
    next = { ...next, container, audioFallback: null };
    notice = { text: "{codec} is not available in {from}; switched to {to}", values: { codec: CODEC_LABELS[codec], from: CONTAINER_LABELS[settings.container], to: CONTAINER_LABELS[container] } };
    next = withAudio(next, defaultAudioCodec(container, codec));
  } else if (codec === "prores-422hq" || codec === "prores-4444") next = withAudio(next, "pcm");
  return { settings: next, notice };
}

// ---- capabilities -----------------------------------------------------------------------------------------------------

export type HostCodecRow = { state: "available" | "download_required" | "unavailable"; encoder?: string; hardware?: boolean; reason?: string };
export type HostCapabilities = {
  name: string; remoteExport: boolean; shareLinks: boolean; connectors: boolean; admin: boolean; thisComputer?: boolean; healthy?: boolean;
  /** The component whose absence keeps the host from exporting ("FFmpeg", "render host"). */
  missing?: string;
  encoders: Partial<Record<"h264" | "hevc" | "vp9" | "av1" | "aac" | "opus", HostCodecRow>>; proRes: boolean;
};
export type DeviceCapabilities = {
  backend: "webgpu" | "webgl2" | "none";
  /** The answer of the platform encoder for the exact size, rate and bitrate asked. */
  video: Record<VideoCodec, boolean>;
  audio: { aac: boolean; opus: boolean; flac: boolean; mp3: boolean };
  onDeviceVideoExport: boolean;
  audioEncode?: "aac" | "opus" | "pcm-mov" | "gateway-only";
  opticalFlow?: boolean;
};
export type Capabilities = { device: DeviceCapabilities; host: HostCapabilities | null; platform: "web" | "desktop" | "mobile"; os?: "macos" | "windows" | "linux" | "ios" | "android" };
export const FULL_DEVICE: DeviceCapabilities = { backend: "webgl2", video: { h264: true, hevc: true, vp9: true, av1: true }, audio: { aac: true, opus: true, flac: true, mp3: true }, onDeviceVideoExport: true };
export const hostCanExport = (host: HostCapabilities | null): boolean => host !== null && host.remoteExport;
const hostHas = (host: HostCapabilities | null, codec: "h264" | "hevc" | "vp9" | "av1" | "aac" | "opus"): boolean => hostCanExport(host) && host?.encoders[codec]?.state === "available";

export type CodecOption = { codec: AnyVideoCodec; label: string; host: boolean; disabled: boolean; reason: { text: string; values?: Record<string, string | number> } | null; action: "Export on host" | "Open host diagnostics" | null };
/** The codec list of the dialog for the selected target: what is selectable, and why the rest is not. */
export function codecOptions(settings: Pick<ExportSettings, "target" | "container">, caps: Capabilities): CodecOption[] {
  const rows: CodecOption[] = VIDEO_CODECS.map((codec) => {
    const label = CODEC_LABELS[codec];
    if (settings.target === "host") {
      const row = caps.host?.encoders[codec];
      if (row?.state === "available") return { codec, label, host: false, disabled: false, reason: null, action: null };
      if (row?.state === "download_required") return { codec, label, host: false, disabled: true, reason: { text: "This host needs the OpenH264 encoder" }, action: caps.host?.admin ? "Open host diagnostics" : null };
      return { codec, label, host: false, disabled: true, reason: { text: "This host has no {codec} encoder", values: { codec: label } }, action: null };
    }
    const supported = caps.device.onDeviceVideoExport && caps.device.video[codec];
    return { codec, label, host: false, disabled: !supported, reason: supported ? null : { text: "Not supported on this device" }, action: !supported && hostHas(caps.host, codec) ? "Export on host" : null };
  });
  const proRes = hostCanExport(caps.host) && caps.host?.proRes === true;
  for (const codec of HOST_CODECS) rows.push({ codec, label: CODEC_LABELS[codec], host: true, disabled: !proRes, reason: proRes ? null : { text: "Requires a connected host" }, action: null });
  return rows;
}
export const anyDeviceVideoEncoder = (caps: Capabilities): boolean => caps.device.onDeviceVideoExport && VIDEO_CODECS.some((codec) => caps.device.video[codec]);
/** After a settings change made the codec unsupported: H.264 → VP9 → HEVC → AV1, the first that encodes and fits the container. */
export function fallbackCodec(settings: ExportSettings, supported: Record<VideoCodec, boolean>, size: Size): Change {
  const current = settings.videoCodec;
  if (settings.target === "host" || current === "prores-422hq" || current === "prores-4444" || supported[current]) return { settings, notice: null };
  const order: VideoCodec[] = ["h264", "vp9", "hevc", "av1"];
  const inContainer = order.find((codec) => supported[codec] && containerAccepts(settings.container, codec));
  const anywhere = inContainer ?? order.find((codec) => supported[codec]);
  if (!anywhere) return { settings, notice: null };
  const changed = inContainer ? { ...settings, videoCodec: anywhere } : chooseCodec(settings, anywhere).settings;
  return { settings: { ...changed, presetId: settings.presetId }, notice: { text: "{from} cannot encode {width}×{height} on this device; switched to {to}", values: { from: CODEC_LABELS[current], width: size.width, height: size.height, to: CODEC_LABELS[anywhere] } } };
}
/** The disabled text of a resolution the selected codec cannot encode on this device. */
export const resolutionReason = (codec: AnyVideoCodec): { text: string; values: Record<string, string> } => ({ text: "Not supported by this device's {codec} encoder", values: { codec: CODEC_LABELS[codec] } });

export type AudioChoice = { id: AudioFallback; label: string; warning?: string };
/** With no AAC encoder on the target: the explicit choices, in their fixed order. */
export function audioFallbackChoices(caps: Capabilities): AudioChoice[] {
  const choices: AudioChoice[] = [];
  if (hostHas(caps.host, "aac")) choices.push({ id: "host", label: "Export on host" });
  if (caps.device.audioEncode === "gateway-only") return choices;
  if (caps.device.video.vp9 && caps.device.audio.opus) choices.push({ id: "webm", label: "WebM (VP9 + Opus)" });
  if (caps.device.audio.opus) choices.push({ id: "opus-mp4", label: "Opus in MP4", warning: "Some players do not play Opus audio in MP4" });
  choices.push({ id: "pcm-mov", label: "16-bit PCM in MOV" });
  return choices;
}
/** Applies an explicit audio choice. PCM is written only into MOV; Opus goes into MP4 only by this choice. */
export function applyAudioFallback(settings: ExportSettings, choice: AudioFallback): ExportSettings {
  if (choice === "host") return { ...settings, target: "host", audioFallback: "host" };
  if (choice === "webm") return { ...settings, container: "webm", videoCodec: "vp9", audioCodec: "opus", audioBitrateKbps: 128, audioFallback: "webm", presetId: settings.presetId };
  if (choice === "opus-mp4") return { ...settings, container: "mp4", audioCodec: "opus", audioBitrateKbps: 128, audioFallback: "opus-mp4" };
  return { ...settings, container: "mov", videoCodec: settings.videoCodec === "hevc" ? "hevc" : "h264", audioCodec: "pcm", audioFallback: "pcm-mov" };
}
/** True when the export writes AAC and the selected target cannot encode it. */
export const needsAudioChoice = (settings: ExportSettings, caps: Capabilities): boolean =>
  settings.type === "video" && settings.includeAudio && settings.audioCodec === "aac" && settings.target === "device" && !caps.device.audio.aac;

// ---- presets ----------------------------------------------------------------------------------------------------------

export type BuiltInPreset = { id: string; name: string; apply(base: ExportSettings): ExportSettings };
const video = (base: ExportSettings, patch: Partial<ExportSettings>): ExportSettings => ({
  ...base, type: "video", videoCodec: "h264", container: "mp4", bitrateLevel: "recommended", rateControl: "vbr", includeAudio: true, audioCodec: "aac", audioBitrateKbps: 192, sampleRate: 48_000, channels: 2,
  audioFallback: null, frameRate: "project", resolution: { ...base.resolution, mode: "project" }, includeTransparency: false, ...patch,
});
const fps30: Rational = { numerator: 30, denominator: 1 };
const mode = (base: ExportSettings, value: ResolutionMode) => ({ ...base.resolution, mode: value });
const fixed = (width: number, height: number) => ({ mode: "custom" as const, width, height });
/** The eleven built-in presets; their ids are the only preset identifiers a tool, a workflow node or an automation may name. */
export const BUILT_IN_PRESETS: readonly BuiltInPreset[] = [
  { id: "match-project", name: "Match project", apply: (base) => video(base, {}) },
  { id: "1080p", name: "1080p", apply: (base) => video(base, { resolution: mode(base, "1080p"), frameRate: fps30 }) },
  { id: "4k", name: "4K", apply: (base) => video(base, { resolution: mode(base, "2160p"), bitrateLevel: "higher" }) },
  { id: "small-720p", name: "Small file 720p", apply: (base) => video(base, { resolution: mode(base, "720p"), frameRate: fps30, bitrateLevel: "lower", audioBitrateKbps: 128 }) },
  { id: "vertical-9x16", name: "Vertical 9:16 short video", apply: (base) => video(base, { resolution: fixed(1080, 1920), frameRate: fps30 }) },
  { id: "wide-16x9", name: "Widescreen 16:9", apply: (base) => video(base, { resolution: fixed(1920, 1080) }) },
  { id: "square-1x1", name: "Square 1:1", apply: (base) => video(base, { resolution: fixed(1080, 1080), frameRate: fps30 }) },
  { id: "webm", name: "WebM", apply: (base) => video(base, { videoCodec: "vp9", container: "webm", audioCodec: "opus", audioBitrateKbps: 128 }) },
  { id: "gif", name: "GIF", apply: (base) => ({ ...base, type: "gif", gif: { ...DEFAULT_EXPORT_SETTINGS.gif } }) },
  { id: "audio-only", name: "Audio only", apply: (base) => ({ ...base, type: "audio", audioOnly: { ...DEFAULT_EXPORT_SETTINGS.audioOnly }, sampleRate: 48_000, channels: 2 }) },
  { id: "image-sequence", name: "Image sequence", apply: (base) => ({ ...base, type: "image-sequence", imageSequence: { ...DEFAULT_EXPORT_SETTINGS.imageSequence }, resolution: mode(base, "project"), frameRate: "project" }) },
];
export const BUILT_IN_PRESET_IDS = BUILT_IN_PRESETS.map((preset) => preset.id);
export class ExportParamsError extends Error {
  readonly code = "INVALID_PARAMS"; readonly details: { valid: string[] };
  constructor(message: string, valid: string[]) { super(message); this.name = "ExportParamsError"; this.details = { valid }; }
}
/** A built-in preset by id; an unknown id is refused with `INVALID_PARAMS` listing the valid ones. */
export function builtInPreset(id: string): BuiltInPreset {
  const preset = BUILT_IN_PRESETS.find((candidate) => candidate.id === id);
  if (!preset) throw new ExportParamsError(`unknown export preset "${id}"; valid ids: ${BUILT_IN_PRESET_IDS.join(", ")}`, [...BUILT_IN_PRESET_IDS]);
  return preset;
}
export const applyPreset = (id: string, base: ExportSettings = DEFAULT_EXPORT_SETTINGS): ExportSettings => ({ ...builtInPreset(id).apply(base), presetId: id });

export type PresetResolution = { settings: ExportSettings; notice: string | null; action: "Export on host" | null; targetLabel: { text: string; values?: Record<string, string> } };
export const targetLabel = (settings: Pick<ExportSettings, "target">, host: HostCapabilities | null): { text: string; values?: Record<string, string> } =>
  (settings.target === "host" && host ? (host.thisComputer ? { text: "Host: This computer" } : { text: "Host: {name}", values: { name: host.name } }) : { text: "This device" });
export const H264_AAC_NOTICE = "H.264 with AAC is not available here; exporting VP9 with Opus as WebM";
/**
 * One rule on every target for a preset that names H.264 with AAC in MP4: (1) the selected target encodes both; (2) on
 * the desktop app the healthy built-in host does and is preselected; (3) otherwise VP9 with Opus in WebM on the device,
 * said before the export starts. Opus in MP4 is never the result.
 */
export function resolveH264Aac(settings: ExportSettings, caps: Capabilities): PresetResolution {
  const names = settings.type === "video" && settings.videoCodec === "h264" && settings.container === "mp4" && settings.audioCodec === "aac";
  const plain = (next: ExportSettings): PresetResolution => ({ settings: next, notice: null, action: null, targetLabel: targetLabel(next, caps.host) });
  if (!names || settings.audioFallback !== null) return plain(settings);
  const onHost = hostHas(caps.host, "h264") && hostHas(caps.host, "aac");
  if (settings.target === "host" ? onHost : caps.device.onDeviceVideoExport && caps.device.video.h264 && caps.device.audio.aac) return plain(settings);
  if (caps.platform === "desktop" && caps.host?.thisComputer && caps.host.healthy !== false && onHost) return plain({ ...settings, target: "host" });
  const next: ExportSettings = { ...settings, target: "device", videoCodec: "vp9", container: "webm", audioCodec: "opus", audioBitrateKbps: 128 };
  return { settings: next, notice: H264_AAC_NOTICE, action: hostCanExport(caps.host) && !caps.host?.thisComputer ? "Export on host" : null, targetLabel: targetLabel(next, caps.host) };
}

export type UserPreset = { id: string; name: string; settings: ExportSettings };
export const USER_PRESET_LIMIT = 30;
export const PRESET_LIMIT_MESSAGE = "Preset limit reached (30). Delete a preset to save a new one.";
export type SavePresetResult =
  | { state: "saved"; presets: UserPreset[]; preset: UserPreset } | { state: "duplicate"; existing: UserPreset } | { state: "limit"; message: string } | { state: "invalid"; message: string };
const sameName = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();
/** Saves the settings under a name of 1–40 characters, unique without regard to case; a duplicate asks before it overwrites. */
export function saveUserPreset(presets: UserPreset[], name: string, settings: ExportSettings, options: { overwrite?: boolean; newId(): string }): SavePresetResult {
  const trimmed = name.trim();
  if ([...trimmed].length < 1 || [...trimmed].length > 40) return { state: "invalid", message: "A preset name has 1 to 40 characters" };
  const existing = presets.find((preset) => sameName(preset.name, trimmed));
  if (existing && !options.overwrite) return { state: "duplicate", existing };
  if (existing) { const preset = { ...existing, settings: { ...settings, presetId: existing.id } }; return { state: "saved", preset, presets: presets.map((entry) => (entry.id === existing.id ? preset : entry)) }; }
  if (presets.length >= USER_PRESET_LIMIT) return { state: "limit", message: PRESET_LIMIT_MESSAGE };
  const id = `user-${options.newId()}`, preset = { id, name: trimmed, settings: { ...settings, presetId: id } };
  return { state: "saved", preset, presets: [...presets, preset] };
}
export function renameUserPreset(presets: UserPreset[], id: string, name: string): SavePresetResult {
  const trimmed = name.trim(), target = presets.find((preset) => preset.id === id);
  if (!target || [...trimmed].length < 1 || [...trimmed].length > 40) return { state: "invalid", message: "A preset name has 1 to 40 characters" };
  const clash = presets.find((preset) => preset.id !== id && sameName(preset.name, trimmed));
  if (clash) return { state: "duplicate", existing: clash };
  const preset = { ...target, name: trimmed };
  return { state: "saved", preset, presets: presets.map((entry) => (entry.id === id ? preset : entry)) };
}
export const deleteUserPreset = (presets: UserPreset[], id: string): UserPreset[] => presets.filter((preset) => preset.id !== id);
/** The name the preset field shows: the chosen preset, or "Custom" once any field changed. */
export function presetName(settings: Pick<ExportSettings, "presetId">, user: UserPreset[]): string {
  if (settings.presetId === null) return "Custom";
  return BUILT_IN_PRESETS.find((preset) => preset.id === settings.presetId)?.name ?? user.find((preset) => preset.id === settings.presetId)?.name ?? "Custom";
}
/** A change of one field after a preset was chosen: the preset reads "Custom". */
export const edit = (settings: ExportSettings, patch: Partial<ExportSettings>): ExportSettings => ({ ...settings, ...patch, presetId: null });
export const isUserPresets = (value: unknown): value is UserPreset[] =>
  Array.isArray(value) && value.length <= USER_PRESET_LIMIT && value.every((entry) => entry !== null && typeof entry === "object" && typeof (entry as UserPreset).id === "string" && typeof (entry as UserPreset).name === "string" && typeof (entry as UserPreset).settings === "object");

// ---- range ------------------------------------------------------------------------------------------------------------

export type RangeSource = { inPoint?: number; outPoint?: number };
export const RANGE_HINT = "Set in and out points on the timeline";
export const hasRange = (scene: RangeSource, duration: number): boolean => (scene.inPoint ?? 0) < (scene.outPoint ?? duration) && (scene.inPoint !== undefined || scene.outPoint !== undefined);
const frameTime = (frame: number, rate: Rational) => Math.round((frame * TICKS_PER_SECOND * rate.denominator) / rate.numerator);
const frameAt = (ticks: number, rate: Rational) => Math.round((ticks * rate.numerator) / (TICKS_PER_SECOND * rate.denominator));
/** The exported span in ticks: the whole timeline, or the in/out range snapped to frame boundaries of the output rate. */
export function exportRange(settings: Pick<ExportSettings, "range" | "type">, scene: RangeSource, duration: number, rate: Rational): { start: number; end: number; frames: number } {
  const ranged = settings.range === "in-out" && settings.type !== "still" && hasRange(scene, duration);
  const start = ranged ? frameTime(frameAt(Math.max(0, scene.inPoint ?? 0), rate), rate) : 0;
  const end = ranged ? Math.max(start, frameTime(frameAt(Math.min(duration, scene.outPoint ?? duration), rate), rate)) : duration;
  return { start, end, frames: frameCountOf(end - start, rate) };
}
/** Caption times of a sidecar file are offset so that the range start is 0. */
export const sidecarTime = (ticks: number, range: { start: number }): number => Math.max(0, Math.round(((ticks - range.start) * 1000) / TICKS_PER_SECOND));

// ---- what blocks the Export button ------------------------------------------------------------------------------------

export type Blocker = { text: string; values?: Record<string, string | number>; danger?: boolean };
export type BlockerContext = {
  caps: Capabilities; durationTicks: number; hasAudibleSource: boolean; hasCaptionTrack: boolean; hasRange: boolean; freeBytes: number | null; estimateBytes: number | null;
  transparentBackground: boolean; sequenceConfirmed?: boolean; frames?: number;
};
export const GIF_LIMIT_MESSAGE = "GIF export is limited to 60 seconds. Set an in/out range.";
export const NO_AUDIO_MESSAGE = "Nothing to export: the timeline has no audio.";
export const NO_CAPTIONS_MESSAGE = "This project has no captions";
export const OPAQUE_MESSAGE = "The background is opaque; set the project background to None and remove per-clip backgrounds to export alpha.";
export const FLATTEN_MESSAGE = "Transparent areas will be black in this format";
/** Why the Export button is disabled; `null` when the export may start (pre-flight still runs). */
export function exportBlocker(settings: ExportSettings, context: BlockerContext): Blocker | null {
  const { caps } = context, device = settings.target === "device";
  if (settings.target === "host" && !hostCanExport(caps.host)) return { text: caps.host ? "Host: {name} (cannot export)" : "Host (not connected)", values: caps.host ? { name: caps.host.name } : undefined };
  if (settings.type === "captions") return context.hasCaptionTrack ? null : { text: NO_CAPTIONS_MESSAGE };
  if (settings.type === "gif" && context.durationTicks > GIF_MAX_SECONDS * TICKS_PER_SECOND) return { text: GIF_LIMIT_MESSAGE };
  if (settings.type === "audio") {
    if (!context.hasAudibleSource) return { text: NO_AUDIO_MESSAGE };
    const { format } = settings.audioOnly, ok = format === "wav" || (format === "m4a" ? caps.device.audio.aac : format === "flac" ? caps.device.audio.flac : caps.device.audio.mp3);
    if (device && !ok) return { text: "Not supported on this device" };
  }
  if (settings.type === "video") {
    if (device && !anyDeviceVideoEncoder(caps)) return { text: "This device cannot encode video" };
    if (device && (settings.videoCodec === "prores-422hq" || settings.videoCodec === "prores-4444")) return { text: "Requires a connected host" };
    if (device && !caps.device.video[settings.videoCodec as VideoCodec]) return { text: "Not supported on this device" };
    if (needsAudioChoice(settings, caps)) return { text: "Choose how to encode audio" };
    if (settings.includeTransparency) return { text: context.transparentBackground ? "Transparency needs a PNG sequence or ProRes 4444 on a host" : OPAQUE_MESSAGE };
  }
  if (settings.type === "image-sequence" && settings.includeTransparency && !context.transparentBackground) return { text: OPAQUE_MESSAGE };
  if (settings.type === "image-sequence" && (context.frames ?? 0) > SEQUENCE_CONFIRM_FRAMES && !context.sequenceConfirmed) return { text: "Confirm the {n} frames of this sequence", values: { n: context.frames ?? 0 } };
  if (device && context.freeBytes !== null && context.estimateBytes !== null && context.estimateBytes > context.freeBytes) return { text: "Not enough free space", danger: true };
  return null;
}
/** Formats that carry a cover; the rest disable the toggle with "Not supported for this format". */
export const coverSupported = (settings: ExportSettings): boolean =>
  (settings.type === "video" && settings.container !== "webm") || (settings.type === "audio" && (settings.audioOnly.format === "m4a" || settings.audioOnly.format === "mp3"));
export const COVER_UNSUPPORTED = "Not supported for this format";

// ---- file extension and summary ---------------------------------------------------------------------------------------

export function fileExtension(settings: ExportSettings): string {
  if (settings.type === "video") return settings.container;
  if (settings.type === "gif") return "gif";
  if (settings.type === "audio") return settings.audioOnly.format;
  if (settings.type === "image-sequence") return settings.imageSequence.format === "png" ? "png" : "jpg";
  if (settings.type === "still") return settings.still.format === "png" ? "png" : "jpg";
  return settings.sidecar.format;
}
export function mimeOf(settings: ExportSettings): string {
  if (settings.type === "video") return CONTAINER_MIME[settings.container];
  if (settings.type === "gif") return "image/gif";
  if (settings.type === "audio") return AUDIO_ONLY_MIME[settings.audioOnly.format];
  if (settings.type === "captions") return "text/plain";
  return (settings.type === "still" ? settings.still.format : settings.imageSequence.format) === "png" ? "image/png" : "image/jpeg";
}
/** One line naming what a job produces, for the queue and the history: "1920 × 1080 · 30 fps · H.264 · MP4". */
export function settingsSummary(settings: ExportSettings, canvas: Size, projectFps: Rational): string {
  if (settings.type === "video") {
    const size = outputSize(settings, canvas);
    return `${size.width} × ${size.height} · ${rateLabel(outputFrameRate(settings, projectFps))} fps · ${CODEC_LABELS[settings.videoCodec]} · ${CONTAINER_LABELS[settings.container]}`;
  }
  if (settings.type === "gif") { const size = gifSize(canvas, settings.gif.shortSide); return `GIF · ${size.width} × ${size.height} · ${settings.gif.frameRate} fps`; }
  if (settings.type === "audio") return `${AUDIO_ONLY_LABELS[settings.audioOnly.format]} · ${settings.sampleRate / 1000} kHz · ${settings.channels === 2 ? "stereo" : "mono"}`;
  if (settings.type === "image-sequence") { const size = outputSize(settings, canvas); return `${settings.imageSequence.format.toUpperCase()} sequence · ${size.width} × ${size.height}`; }
  if (settings.type === "still") { const size = outputSize(settings, canvas); return `${settings.still.format.toUpperCase()} still · ${size.width} × ${size.height}`; }
  return `Captions · ${settings.sidecar.format.toUpperCase()}`;
}

// ---- stored form (`exportSettings` of the project document, catalogue §3.5) ------------------------------------------

export type StoredExportSettings = { type?: string; presetId?: string; values?: Record<string, unknown>; [key: string]: unknown };
const STORED_TYPE: Record<ExportType, string | undefined> = { video: "video", gif: "gif", audio: "audio", "image-sequence": "sequence", still: "still", captions: undefined };
const DEVICE_CODEC: Record<string, string> = { h264: "h264", hevc: "hevc", vp9: "vp9", av1: "av1" };
/**
 * The settings as the document holds them. The keys the catalogue names keep its shapes; the remaining options of
 * `export-share` are stored beside them. Unknown keys of what was stored before are preserved, and nothing here is a
 * path, a token or a passcode.
 */
export function toStoredExportSettings(settings: ExportSettings, canvas: Size, projectFps: Rational, previous?: StoredExportSettings | null): StoredExportSettings {
  const size = outputSize(settings, canvas), custom = settings.bitrateLevel === "custom";
  const values: Record<string, unknown> = {
    ...(previous?.values ?? {}),
    resolution: settings.resolution.mode === "project" ? "match" : { width: size.width, height: size.height },
    frameRate: settings.frameRate === "project" ? "match" : { ...settings.frameRate },
    bitrateMode: custom ? settings.rateControl : "auto",
    codec: settings.videoCodec, container: settings.container,
    audio: { enabled: settings.includeAudio, codec: settings.audioCodec, bitrate: settings.audioBitrateKbps * 1000, sampleRate: settings.sampleRate, channels: settings.channels },
    captions: { burnIn: settings.burnCaptions, sidecar: settings.sidecar.enabled && settings.sidecar.format !== "txt" ? settings.sidecar.format : "none" },
    embedCover: settings.embedCover, aiLabel: settings.aiLabel, creditsFile: settings.creditsFile, scope: settings.range === "in-out" ? "range" : "project", target: settings.target, smoothMotion: settings.smoothMotion,
    // Options of `export-share` beyond the catalogue's rows.
    exportType: settings.type, resolutionMode: settings.resolution.mode, bitrateLevel: settings.bitrateLevel, rateControl: settings.rateControl, hardwareAcceleration: settings.hardwareAcceleration,
    audioFallback: settings.audioFallback, sidecar: { ...settings.sidecar }, includeTransparency: settings.includeTransparency, gif: { ...settings.gif }, imageSequence: { ...settings.imageSequence },
    still: { ...settings.still }, audioOnly: { ...settings.audioOnly },
  };
  if (custom) values.bitrate = Math.round(clampCustomMbps(settings.customMbps) * 1_000_000); else delete values.bitrate;
  const stored: StoredExportSettings = { ...(previous ?? {}), values };
  const type = STORED_TYPE[settings.type];
  if (type) stored.type = type; else delete stored.type;
  if (settings.presetId) stored.presetId = settings.presetId; else delete stored.presetId;
  void projectFps;
  return stored;
}
const pick = <T>(value: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback);
const record = (value: unknown): Record<string, unknown> => (value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const numberIn = (value: unknown, min: number, max: number, fallback: number): number => (typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : fallback);
/** The dialog's settings from what a document (or the device default) holds; anything absent or unreadable takes its default. */
export function fromStoredExportSettings(stored: StoredExportSettings | null | undefined, fallback: ExportSettings = DEFAULT_EXPORT_SETTINGS): ExportSettings {
  if (!stored) return fallback;
  const values = record(stored.values), base = fallback;
  const type = pick(values.exportType ?? (stored.type === "sequence" ? "image-sequence" : stored.type), EXPORT_TYPES, base.type);
  const resolution = record(values.resolution), audio = record(values.audio), captions = record(values.captions), sidecar = record(values.sidecar), gif = record(values.gif);
  const sequence = record(values.imageSequence), still = record(values.still), audioOnly = record(values.audioOnly), rate = record(values.frameRate);
  const fixedSize = typeof resolution.width === "number" && typeof resolution.height === "number";
  const resolutionMode = values.resolution === "match" ? "project" : pick(values.resolutionMode, RESOLUTION_MODES, fixedSize ? "custom" : base.resolution.mode);
  const bitrate = typeof values.bitrate === "number" ? values.bitrate / 1_000_000 : base.customMbps;
  const container = pick(values.container, CONTAINERS, base.container);
  const videoCodec = pick(values.codec === "avc" ? "h264" : values.codec, [...VIDEO_CODECS, ...HOST_CODECS] as AnyVideoCodec[], base.videoCodec);
  void DEVICE_CODEC;
  const audioCodec = pick(audio.codec, ["aac", "opus", "pcm"] as AudioCodec[], defaultAudioCodec(container, videoCodec));
  const legacySidecar = pick(captions.sidecar, ["none", ...SIDECAR_FORMATS] as string[], "none");
  return {
    type, presetId: typeof stored.presetId === "string" ? stored.presetId : null,
    resolution: { mode: resolutionMode === "project" && values.resolution !== "match" && fixedSize ? "custom" : resolutionMode, width: numberIn(resolution.width, 16, 7680, base.resolution.width), height: numberIn(resolution.height, 16, 7680, base.resolution.height) },
    frameRate: typeof rate.numerator === "number" && typeof rate.denominator === "number" && rate.numerator > 0 && rate.denominator > 0 ? { numerator: rate.numerator, denominator: rate.denominator } : "project",
    bitrateLevel: pick(values.bitrateLevel, BITRATE_LEVELS, values.bitrateMode === "cbr" || values.bitrateMode === "vbr" ? "custom" : base.bitrateLevel),
    customMbps: clampCustomMbps(bitrate), rateControl: pick(values.rateControl ?? values.bitrateMode, ["vbr", "cbr"] as const, base.rateControl), videoCodec, container,
    hardwareAcceleration: pick(values.hardwareAcceleration, ["auto", "prefer-hardware", "prefer-software"] as const, base.hardwareAcceleration),
    smoothMotion: typeof values.smoothMotion === "boolean" ? values.smoothMotion : base.smoothMotion,
    includeAudio: typeof audio.enabled === "boolean" ? audio.enabled : base.includeAudio, audioCodec,
    audioBitrateKbps: typeof audio.bitrate === "number" ? pick(Math.round(audio.bitrate / 1000), audioBitrates(audioCodec), audioCodec === "opus" ? 128 : 192) : audioCodec === "opus" ? 128 : 192,
    sampleRate: pick(audio.sampleRate, SAMPLE_RATES, base.sampleRate), channels: pick(audio.channels, [1, 2] as const, base.channels),
    audioFallback: pick(values.audioFallback, ["host", "webm", "opus-mp4", "pcm-mov", null] as (AudioFallback | null)[], null),
    burnCaptions: typeof captions.burnIn === "boolean" ? captions.burnIn : base.burnCaptions,
    sidecar: {
      enabled: typeof sidecar.enabled === "boolean" ? sidecar.enabled : legacySidecar !== "none", format: pick(sidecar.format ?? (legacySidecar === "none" ? undefined : legacySidecar), SIDECAR_FORMATS, base.sidecar.format),
      trackIds: Array.isArray(sidecar.trackIds) ? sidecar.trackIds.filter((id): id is string => typeof id === "string") : null, content: pick(sidecar.content, ["primary", "translation", "both"] as const, "primary"),
    },
    embedCover: typeof values.embedCover === "boolean" ? values.embedCover : base.embedCover, aiLabel: typeof values.aiLabel === "boolean" ? values.aiLabel : base.aiLabel,
    creditsFile: typeof values.creditsFile === "boolean" ? values.creditsFile : base.creditsFile, range: values.scope === "range" ? "in-out" : "all",
    includeTransparency: values.includeTransparency === true,
    gif: {
      shortSide: pick(gif.shortSide, GIF_SIDES as readonly number[], base.gif.shortSide), frameRate: pick(gif.frameRate, GIF_FRAME_RATES as readonly number[], base.gif.frameRate),
      loop: gif.loop === "once" || gif.loop === "forever" ? gif.loop : typeof gif.loop === "number" && gif.loop >= 2 && gif.loop <= 100 ? Math.round(gif.loop) : base.gif.loop,
      palette: pick(gif.palette, ["per-frame", "global"] as const, base.gif.palette), dither: pick(gif.dither, ["floyd-steinberg", "none"] as const, base.gif.dither),
    },
    imageSequence: { format: pick(sequence.format, ["png", "jpeg"] as const, base.imageSequence.format), quality: numberIn(sequence.quality, 1, 100, base.imageSequence.quality) },
    still: { format: pick(still.format, ["png", "jpeg"] as const, base.still.format), quality: numberIn(still.quality, 1, 100, base.still.quality) },
    audioOnly: { format: pick(audioOnly.format, AUDIO_ONLY_FORMATS, base.audioOnly.format), bitrateKbps: numberIn(audioOnly.bitrateKbps, 96, 320, base.audioOnly.bitrateKbps), bitDepth: pick(audioOnly.bitDepth, [16, 24] as const, base.audioOnly.bitDepth) },
    target: pick(values.target, ["device", "host"] as const, base.target),
  };
}

/** "16:9", "9:16", "1:1": the aspect ratio of a canvas in lowest terms. */
export function aspectLabel(size: Size): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b)), divisor = gcd(size.width, size.height) || 1;
  return `${size.width / divisor}:${size.height / divisor}`;
}
