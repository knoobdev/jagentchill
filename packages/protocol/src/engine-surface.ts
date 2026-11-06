import { z } from "zod";

/**
 * The `EngineSurface` port: the messages exchanged between the app and the render engine on the three surface
 * variants (same-thread, mobile native view, render host). Messages are JSON; binary data travels beside them.
 */
export const ENGINE_PROTOCOL_VERSION = 1;
/** Reply deadline of a command; `export.start` and `still.render` have none (they report through events). */
export const ENGINE_REPLY_TIMEOUT_MS = 10_000;
/** Largest UTF-8 encoding of one envelope on the mobile bridge. */
export const ENGINE_BRIDGE_MAX_BYTES = 262_144;
/** Largest UTF-8 encoding of one envelope on the render-host pipe. */
export const ENGINE_HOST_MAX_BYTES = 1_048_576;
/** Largest sink chunk outside the base64 fallback. */
export const ENGINE_SINK_CHUNK_BYTES = 4 * 1024 * 1024;

// ---- codes -----------------------------------------------------------------------------------------------------------

/** Failure codes the engine uses in replies and in `engine.error`, `still.failed` and `export.failed`. */
export const ENGINE_ERROR_CODES = [
  "engine/unsupported-runtime", "engine/init-timeout", "engine/no-gpu", "engine/device-lost", "engine/wasm-panic", "engine/wasm-panic-loop",
  "engine/restart-loop", "engine/encoder-unavailable", "engine/sink-sequence", "engine/sink-timeout",
  "surface/unknown-command", "surface/unsupported-version", "surface/invalid-payload", "surface/timeout", "surface/unsupported-on-host",
  "scene/revision-mismatch", "scene/patch-invalid",
  "descriptor/invalid",
  "time/non-integer-ticks", "time/invalid-frame-rate", "time/out-of-range",
  "media/unavailable", "media/original-unavailable",
  // Owned by `export-share.Export error codes`; raised by the engine.
  "export/font-unavailable", "export/matte-unavailable", "export/derived-unavailable", "export/engine-panic", "export/device-lost", "export/interrupted", "export/finalising-timeout",
  "export/write-failed",
] as const;
export type EngineErrorCode = (typeof ENGINE_ERROR_CODES)[number];

/** Ids of non-failing diagnostics. */
export const ENGINE_DIAGNOSTIC_IDS = [
  "scene/unknown-element-type", "scene/compound-cycle", "scene/compound-depth", "scene/multicam-angle", "scene/empty-slot", "derived/unavailable",
  "scene/crop-clamped", "scene/background-layer-skipped", "scene/background-unparsable", "scene/transition-held-frame", "shader/unsupported",
  "shader/unknown-transition", "blend/unknown", "mask/limit-exceeded", "mask/unsupported-element", "matte/unavailable", "font/fallback",
  "color/hdr-tonemapped", "engine/flow-fallback", "surface/navigation-blocked",
] as const;
export type EngineDiagnosticId = (typeof ENGINE_DIAGNOSTIC_IDS)[number];

/** The closed set of code prefixes of the engine. */
export const ENGINE_CODE_PREFIXES = ["surface/", "scene/", "descriptor/", "shader/", "blend/", "mask/", "matte/", "font/", "media/", "color/", "engine/", "export/", "time/"] as const;

export const engineErrorCodeSchema = z.enum(ENGINE_ERROR_CODES);
// A diagnostic reports a recoverable problem; a failure that also ends an operation may be mirrored as a diagnostic
// of severity `error` (for example a command that timed out), so a diagnostic id is either set.
export const engineDiagnosticIdSchema = z.union([z.enum(ENGINE_DIAGNOSTIC_IDS), engineErrorCodeSchema]);
export const engineErrorSchema = z.object({ code: engineErrorCodeSchema, message: z.string(), details: z.record(z.unknown()).optional() }).strict();
export type EngineError = z.infer<typeof engineErrorSchema>;

// ---- shared leaves ---------------------------------------------------------------------------------------------------

const id = z.string().min(1).max(64);
const ticksValue = z.number().int().nonnegative();
/** Every `time` field is an integer tick value. */
const time = ticksValue;
const size = z.number().int().positive();
const url = z.string().min(1).max(8192);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const rational = z.object({ numerator: z.number().int().min(1).max(1_000_000), denominator: z.number().int().min(1).max(1_000_000) }).strict();
const empty = z.object({}).strict();
// Binary content never rides inside the JSON envelope: a field that would hold it holds a resource reference.
const BASE64 = /^(?:data:[^,]*;base64,)?[A-Za-z0-9+/]{256,}={0,2}$/;
const resourceRef = z.string().min(1).max(8192).refine((value) => !BASE64.test(value), "binary content travels outside the JSON envelope");

export const ENGINE_BACKENDS = ["webgpu", "webgl2", "none"] as const;
export const MEDIA_VARIANTS = ["original", "proxy", "mezzanine"] as const;
export const PREVIEW_QUALITIES = ["auto", "full", "half", "quarter"] as const;
export const EFFECTIVE_QUALITIES = ["full", "half", "quarter"] as const;
export const MEMORY_CLASSES = ["desktop", "web", "mobile", "host"] as const;
export const SURFACE_KINDS = ["same-thread", "mobile", "render-host"] as const;
export const ENGINE_PLATFORMS = ["web", "macos", "windows", "linux", "ios", "android", "host"] as const;
export const DERIVED_KINDS = ["matte", "person-matte", "stabilise", "deflicker", "retouch", "relight", "motion-track", "lut", "sticker", "image"] as const;
/** Forward rates are positive, reverse rates negative. */
export const TRANSPORT_RATES = [0.25, 0.5, 1, 1.5, 2, 4, 8, -1, -2, -4, -8] as const;
export const VIDEO_CODECS = ["avc", "hevc", "vp9", "av1"] as const;
export const AUDIO_CODECS = ["aac", "opus", "flac", "pcm"] as const;
// `wav` and `flac` hold audio alone (`export-share.Audio-only export`); an `.m4a` file is the `mp4` container without a video track.
// `gif` and `image-sequence` are written by project code from the rendered frames: `video.codec` is not read for them, and an
// image sequence leaves the engine one encoded frame per `export.chunk`, in frame order.
export const EXPORT_CONTAINERS = ["mp4", "mov", "webm", "wav", "flac", "gif", "image-sequence"] as const;

export const engineConstraintsSchema = z.object({
  calibrated: z.boolean(),
  proxyEditing: z.enum(["optional", "required"]),
  hevcDecode: z.boolean(),
  onDeviceVideoExport: z.boolean(),
  audioEncode: z.enum(["aac", "opus", "pcm-mov", "gateway-only"]),
  cachePoolScale: z.union([z.literal(1), z.literal(0.5)]),
  binarySink: z.enum(["port", "scheme", "base64", "direct"]),
  timeEventsPerSecond: z.union([z.literal(30), z.literal(15)]),
}).strict();
export type EngineConstraints = z.infer<typeof engineConstraintsSchema>;

const codecSupport = z.object({ supported: z.boolean(), hardware: z.boolean().optional() }).strict();
const videoCodecs = z.object({ avc: codecSupport, hevc: codecSupport, vp9: codecSupport, av1: codecSupport }).strict();
export const engineReadySchema = z.object({
  backend: z.enum(ENGINE_BACKENDS),
  software: z.boolean(),
  maxTextureSize: z.number().int().nonnegative(),
  secureContext: z.boolean(),
  decoders: videoCodecs,
  encoders: videoCodecs,
  audioDecoder: z.boolean(),
  audioEncoders: z.object({ aac: z.boolean(), opus: z.boolean(), flac: z.boolean() }).strict(),
  audioOutput: z.boolean(),
  offscreenCanvas: z.boolean(),
  fileSystemAccess: z.boolean(),
  memoryClass: z.enum(MEMORY_CLASSES),
  surface: z.enum(SURFACE_KINDS),
  constraints: engineConstraintsSchema,
  engineVersion: z.string().min(1),
  protocolVersion: z.literal(ENGINE_PROTOCOL_VERSION),
}).strict();
export type EngineReady = z.infer<typeof engineReadySchema>;

// ---- commands (app → engine) -----------------------------------------------------------------------------------------

const patchEntry = z.object({ op: z.enum(["add", "remove", "replace"]), path: z.string(), value: z.unknown().optional(), before: z.string().optional() }).strict();
const sceneBase = { revision: z.number().int().min(1), activeSceneId: id };
const probe = z.object({
  width: size.optional(), height: size.optional(), duration: ticksValue.optional(), fps: rational.optional(), hasAudio: z.boolean().optional(),
  videoCodec: z.string().max(40).optional(), audioCodec: z.string().max(40).optional(), rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional(),
}).strict();
const stillSize = z.number().int().min(16).max(4096);
const exportRange = z.object({ start: time, end: time }).strict().refine((range) => range.end > range.start, "the range is not empty");

export const ENGINE_COMMAND_SCHEMAS = {
  "engine.init": z.object({
    width: size, height: size, devicePixelRatio: z.number().positive().max(8),
    platform: z.enum(ENGINE_PLATFORMS), memoryClass: z.enum(MEMORY_CLASSES), locale: z.string().min(2).max(35),
    forceBackend: z.literal("webgl2").optional(),
    /** The preference "Allow software rendering". */
    allowSoftware: z.boolean().optional(),
    /** Colours of the offline tile (design-system tokens `preview/offline-fill` and `preview/offline-hatch`) and its localised labels. */
    offlineTile: z.object({ fill: z.string(), hatch: z.string(), offlineLabel: z.string().max(80), unsupportedLabel: z.string().max(80) }).strict().optional(),
    scrubAudio: z.boolean().optional(),
  }).strict(),
  "engine.dispose": empty,
  "scene.set": z.union([
    z.object({ ...sceneBase, document: z.record(z.unknown()).refine((document) => !("local" in document), "the engine never receives device-local data") }).strict(),
    z.object({ ...sceneBase, snapshotUrl: url }).strict(),
  ]),
  "scene.patch": z.object({ baseRevision: z.number().int().min(1), revision: z.number().int().min(2), patches: z.array(patchEntry).min(1) }).strict(),
  "scene.setActive": z.object({ sceneId: id }).strict(),
  "media.setSources": z.object({
    sources: z.array(z.object({ assetId: id, original: url.optional(), proxy: url.optional(), mezzanine: url.optional(), probe: probe.optional() }).strict()),
    /** The proxy preference of the device. */
    preferProxies: z.boolean().optional(),
  }).strict(),
  "derived.setSources": z.object({ entries: z.array(z.object({ key: z.string().min(1).max(200), kind: z.enum(DERIVED_KINDS), url, sha256 }).strict()) }).strict(),
  "fonts.setSources": z.object({
    fonts: z.array(z.object({ fontId: id, family: z.string().min(1).max(200), url, sha256: sha256.optional(), weight: z.number().int().min(1).max(1000).optional(), style: z.enum(["normal", "italic"]).optional() }).strict()),
  }).strict(),
  "transport.seek": z.object({ time, mode: z.enum(["scrub", "exact"]), frameStep: z.boolean().optional() }).strict(),
  "transport.play": z.object({ fromTime: time.optional() }).strict(),
  "transport.pause": empty,
  "transport.setRate": z.object({ rate: z.number().refine((rate) => (TRANSPORT_RATES as readonly number[]).includes(rate), "not a supported playback rate") }).strict(),
  "transport.setLoop": z.object({ enabled: z.boolean(), inTime: time.optional(), outTime: time.optional() }).strict(),
  "transport.setVolume": z.object({ volume: z.number().min(0).max(1) }).strict(),
  "transport.setMuted": z.object({ muted: z.boolean() }).strict(),
  "transport.setScrubAudio": z.object({ enabled: z.boolean() }).strict(),
  "view.resize": z.object({ width: z.number().positive(), height: z.number().positive(), devicePixelRatio: z.number().positive().max(8), zoom: z.number().positive().max(64).optional() }).strict(),
  "view.setQuality": z.object({ quality: z.enum(PREVIEW_QUALITIES) }).strict(),
  "view.setVisible": z.object({ visible: z.boolean() }).strict(),
  "preview.setOverride": z.object({ overrides: z.record(id, z.record(z.unknown())) }).strict(),
  "preview.clearOverride": empty,
  "still.render": z.object({
    requestId: id, time, sceneId: id.optional(), width: stillSize.optional(), height: stillSize.optional(),
    format: z.enum(["png", "jpeg"]).default("png"), quality: z.number().int().min(1).max(100).default(90),
    source: z.enum(["original", "preview"]).default("preview"),
    committedOnly: z.boolean().optional(), includeCaptions: z.boolean().optional(), allowMissingMedia: z.boolean().optional(), allowFontFallback: z.boolean().optional(),
    /** Media that is not on the device is drawn as the tile the preview shows in its place, and `still.done` names it: a picture for someone who looks at the layout, never a render to keep. */
    placeholders: z.boolean().optional(),
  }).strict(),
  "thumbnails.request": z.object({ requestId: id, assetId: id, times: z.array(time).min(1).max(2000), longSide: z.number().int().min(64).max(320) }).strict(),
  "thumbnails.cancel": z.object({ requestId: id }).strict(),
  "layout.query": z.object({ elementIds: z.array(id).max(5000), time }).strict(),
  "layout.sampleSource": z.object({
    elementId: id, x: z.number().finite(), y: z.number().finite(),
    size: z.number().int().min(1).max(15).refine((value) => value % 2 === 1, "size is odd").default(5),
  }).strict(),
  "export.start": z.object({
    exportId: id, sceneId: id.optional(), range: exportRange.optional(),
    width: z.number().int().min(16).max(7680), height: z.number().int().min(16).max(7680), frameRate: rational,
    container: z.enum(EXPORT_CONTAINERS),
    video: z.object({
      codec: z.enum(VIDEO_CODECS), bitrate: z.number().int().min(100_000).max(200_000_000).optional(), alpha: z.boolean().optional(),
      /** `export-share.Bitrate modes` (rate control) and `Video codecs with capability detection and fallback` (acceleration). */
      bitrateMode: z.enum(["variable", "constant"]).optional(), hardwareAcceleration: z.enum(["no-preference", "prefer-hardware", "prefer-software"]).optional(),
      // The whole pipeline is SDR BT.709: no other transfer, primaries or matrix can be requested.
      transfer: z.literal("bt709").optional(), primaries: z.literal("bt709").optional(), matrix: z.literal("bt709").optional(),
    }).strict().optional(),
    audio: z.object({
      codec: z.enum(AUDIO_CODECS), sampleRate: z.union([z.literal(44_100), z.literal(48_000)]).default(48_000),
      channels: z.union([z.literal(1), z.literal(2)]).default(2), bitrate: z.number().int().positive().optional(),
      /** PCM sample size; 16 when absent. */
      bitDepth: z.union([z.literal(16), z.literal(24)]).optional(),
    }).strict().optional(),
    /** What the container records about the file: the provenance comment and tags, and the cover as JPEG bytes in base64. */
    metadata: z.object({
      comment: z.string().max(2000).optional(), tags: z.record(z.string().max(2000)).optional(), cover: z.string().max(2_000_000).optional(),
      /** The XMP packet of GIF files and of every frame of an image sequence. */
      xmp: z.string().max(8000).optional(),
    }).strict().optional(),
    /** `export-share.GIF export`: looping, dithering and, for one palette per file, its RGB triples in base64. */
    gif: z.object({ loop: z.union([z.literal("forever"), z.literal("once"), z.number().int().min(2).max(100)]), dither: z.enum(["floyd-steinberg", "none"]), palette: z.string().max(1100).optional() }).strict().optional(),
    /** `export-share.Image sequence export`: the frame format; JPEG quality 1–100. */
    image: z.object({ format: z.enum(["png", "jpeg"]), quality: z.number().int().min(1).max(100).optional() }).strict().optional(),
    /** The visible AI label of `export-share.AI label burn-in`, drawn as the top-most layer of every frame. */
    aiLabel: z.object({ text: z.string().min(1).max(80), fontFamily: z.string().min(1).max(200) }).strict().optional(),
    includeCaptions: z.boolean().optional(), allowFontFallback: z.boolean().optional(), allowMissingMedia: z.boolean().optional(),
    /** With `allowMissingMedia`: the assets the person was shown by name and waived — only these are left out; any other missing or undecodable media still fails the export. Absent: whatever is missing is left out. */
    waivedAssetIds: z.array(id).max(10_000).optional(),
    /** Render host only: the job directory the raw audio mix is written into. */
    jobDirectory: z.string().max(4000).optional(),
  }).strict(),
  "export.pause": z.object({ exportId: id }).strict(),
  "export.resume": z.object({ exportId: id }).strict(),
  "export.cancel": z.object({ exportId: id }).strict(),
  "sink.ack": z.object({ streamId: id, seq: z.number().int().nonnegative(), bytes: z.number().int().nonnegative() }).strict(),
  "perf.setEnabled": z.object({ enabled: z.boolean() }).strict(),
  "memory.trim": empty,
} as const;
export type EngineCommandType = keyof typeof ENGINE_COMMAND_SCHEMAS;
export const ENGINE_COMMAND_TYPES = Object.keys(ENGINE_COMMAND_SCHEMAS) as EngineCommandType[];
export type EngineCommandPayload<T extends EngineCommandType> = z.input<(typeof ENGINE_COMMAND_SCHEMAS)[T]>;
export type EngineCommandParsed<T extends EngineCommandType> = z.output<(typeof ENGINE_COMMAND_SCHEMAS)[T]>;

/** Commands whose reply has no deadline: they are accepted at once and report through events. */
export const ENGINE_UNTIMED_COMMANDS: readonly EngineCommandType[] = ["export.start", "still.render"];
/** The only commands a render host accepts; every other one replies `surface/unsupported-on-host`. */
export const RENDER_HOST_COMMANDS: readonly EngineCommandType[] = [
  "engine.init", "engine.dispose", "scene.set", "media.setSources", "derived.setSources", "fonts.setSources", "still.render", "thumbnails.request",
  "thumbnails.cancel", "export.start", "export.cancel", "perf.setEnabled", "memory.trim",
];

// ---- events (engine → app) -------------------------------------------------------------------------------------------

const mediaStatus = z.object({
  assetId: id, status: z.enum(["ready", "decoding", "unsupported", "missing"]), using: z.enum(MEDIA_VARIANTS).optional(),
}).strict();
const spanSummary = z.object({ mean: z.number(), p50: z.number(), p95: z.number(), max: z.number() }).strict();
const poolBytes = z.object({ video: z.number(), textures: z.number(), images: z.number(), text: z.number() }).strict();
const failure = { code: engineErrorCodeSchema, message: z.string(), details: z.record(z.unknown()).optional() };

export const ENGINE_EVENT_SCHEMAS = {
  "engine.ready": engineReadySchema,
  "engine.constraintsChanged": z.object({ constraints: engineConstraintsSchema }).strict(),
  "engine.error": z.object({ ...failure, fatal: z.boolean(), missing: z.array(z.enum(["wasm", "video-decoder", "audio-decoder", "secure-context", "worker"])).optional() }).strict(),
  "engine.backendChanged": z.object({ backend: z.enum(ENGINE_BACKENDS), software: z.boolean() }).strict(),
  "frame.ready": z.object({ time, revision: z.number().int().nonnegative(), exact: z.boolean(), renderMs: z.number().nonnegative() }).strict(),
  "transport.state": z.object({
    playing: z.boolean(), rate: z.number(), loop: z.boolean(),
    reason: z.enum(["audio-interrupted", "reverse-keyframes", "ended", "user"]).optional(),
    effectiveQuality: z.enum(EFFECTIVE_QUALITIES).optional(), audioOutput: z.boolean().optional(),
  }).strict(),
  "transport.time": z.object({ time, rate: z.number(), playing: z.boolean(), audioClock: z.boolean(), hostMono_ms: z.number().optional() }).strict(),
  "transport.ended": z.object({ time }).strict(),
  "media.status": z.object({ assets: z.array(mediaStatus) }).strict(),
  "still.done": z.object({ requestId: id, width: size, height: size, format: z.enum(["png", "jpeg"]), bytes: z.number().int().nonnegative(), resource: resourceRef.optional(), streamId: id.optional(), /** With `placeholders`: the assets drawn as a placeholder. */ missingAssets: z.array(id).max(500).optional() }).strict(),
  "still.failed": z.object({ requestId: id, ...failure }).strict(),
  "thumbnails.ready": z.object({ requestId: id, assetId: id, time, width: size, height: size, resource: resourceRef.optional(), streamId: id.optional() }).strict(),
  "export.progress": z.object({
    exportId: id, stage: z.enum(["preparing", "rendering", "audio", "finalising", "saving", "paused"]), framesDone: z.number().int().nonnegative(),
    frameCount: z.number().int().nonnegative(), bytesDone: z.number().int().nonnegative().optional(), bytesTotal: z.number().int().nonnegative().optional(),
    reason: z.enum(["background", "user"]).optional(),
  }).strict(),
  "export.chunk": z.object({ exportId: id.optional(), streamId: id, seq: z.number().int().nonnegative(), bytes: z.number().int().nonnegative(), position: z.number().int().nonnegative().optional() }).strict(),
  "export.done": z.object({
    exportId: id, frameCount: z.number().int().nonnegative(), duration: ticksValue, bytes: z.number().int().nonnegative(), elapsedMs: z.number().nonnegative(),
    fallbackFonts: z.array(z.string()).default([]), diagnostics: z.array(z.string()).default([]),
  }).strict(),
  "export.failed": z.object({ exportId: id, ...failure }).strict(),
  // The base64 fallback of the mobile binary return path: the one event that carries binary content inside JSON.
  "sink.chunk": z.object({ streamId: id, seq: z.number().int().nonnegative(), base64: z.string().max(ENGINE_BRIDGE_MAX_BYTES) }).strict(),
  "sink.closed": z.object({ streamId: id, totalBytes: z.number().int().nonnegative(), sha256 }).strict(),
  "perf.sample": z.object({
    frames: z.number().int().nonnegative(), path: z.enum(["preview", "still", "export"]),
    spans: z.record(spanSummary), counters: z.record(z.number()), pools: poolBytes, effectiveQuality: z.enum(EFFECTIVE_QUALITIES).optional(),
  }).strict(),
  "memory.pressure": z.object({ bytes: z.number().nonnegative(), ceiling: z.number().positive(), pools: poolBytes }).strict(),
  diagnostic: z.object({
    id: engineDiagnosticIdSchema, severity: z.enum(["caution", "error"]), message: z.string(),
    elementId: z.string().optional(), assetId: z.string().optional(), details: z.record(z.unknown()).optional(),
  }).strict(),
} as const;
export type EngineEventType = keyof typeof ENGINE_EVENT_SCHEMAS;
export const ENGINE_EVENT_TYPES = Object.keys(ENGINE_EVENT_SCHEMAS) as EngineEventType[];
export type EngineEventPayload<T extends EngineEventType> = z.input<(typeof ENGINE_EVENT_SCHEMAS)[T]>;
/** Events a render host never emits. */
export const RENDER_HOST_SILENT_EVENTS: readonly EngineEventType[] = ["transport.state", "transport.time", "transport.ended"];

// ---- envelope --------------------------------------------------------------------------------------------------------

export type EngineMessage<T extends string = string, P = unknown> = { v: 1; id: string; type: T; payload: P };
export type EngineReply = { v: 1; id: string; type: "reply"; replyTo: string; ok: boolean; payload?: unknown; error?: EngineError };

const envelopeShape = z.object({ v: z.number(), id: z.string().min(1).max(128), type: z.string().min(1).max(64), payload: z.record(z.unknown()).default({}) }).passthrough();
export const engineReplySchema = z.object({
  v: z.literal(1), id: z.string().min(1).max(128), type: z.literal("reply"), replyTo: z.string().min(1).max(128), ok: z.boolean(),
  payload: z.unknown().optional(), error: engineErrorSchema.optional(),
}).strict().refine((reply) => reply.ok === (reply.error === undefined), "a failed reply carries an error and a successful one does not");

export type EngineParseFailure = { ok: false; code: "surface/unknown-command" | "surface/unsupported-version" | "surface/invalid-payload"; message: string; id?: string };

/** JSON-serialisable means plain data: no function, no class instance, no typed array, no cycle. */
export function isJsonSerialisable(value: unknown, seen = new Set<unknown>()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  let ok: boolean;
  if (Array.isArray(value)) ok = value.every((item) => isJsonSerialisable(item, seen));
  else {
    const proto = Object.getPrototypeOf(value);
    ok = (proto === Object.prototype || proto === null) && Object.values(value).every((item) => item === undefined || isJsonSerialisable(item, seen));
  }
  seen.delete(value);
  return ok;
}

const issueText = (error: z.ZodError): string => error.issues.slice(0, 3).map((issue) => `${issue.path.join(".") || "payload"}: ${issue.message}`).join("; ");

function parseEnvelope(message: unknown): { ok: true; id: string; type: string; payload: Record<string, unknown> } | EngineParseFailure {
  const idOf = typeof (message as { id?: unknown } | null)?.id === "string" ? (message as { id: string }).id : undefined;
  const shaped = envelopeShape.safeParse(message);
  if (!shaped.success) return { ok: false, code: "surface/invalid-payload", message: issueText(shaped.error), id: idOf };
  if (shaped.data.v !== ENGINE_PROTOCOL_VERSION) return { ok: false, code: "surface/unsupported-version", message: `protocol version ${shaped.data.v} is not supported`, id: shaped.data.id };
  if (!isJsonSerialisable(shaped.data.payload)) return { ok: false, code: "surface/invalid-payload", message: "a message is plain JSON data", id: shaped.data.id };
  return { ok: true, id: shaped.data.id, type: shaped.data.type, payload: shaped.data.payload };
}

/** Validates a command as the engine receives it. */
export function parseEngineCommand(message: unknown): { ok: true; id: string; type: EngineCommandType; payload: unknown } | EngineParseFailure {
  const envelope = parseEnvelope(message);
  if (!envelope.ok) return envelope;
  if (!Object.hasOwn(ENGINE_COMMAND_SCHEMAS, envelope.type)) return { ok: false, code: "surface/unknown-command", message: `unknown command "${envelope.type}"`, id: envelope.id };
  const type = envelope.type as EngineCommandType;
  const payload = ENGINE_COMMAND_SCHEMAS[type].safeParse(envelope.payload);
  if (!payload.success) return { ok: false, code: "surface/invalid-payload", message: `${type}: ${issueText(payload.error)}`, id: envelope.id };
  return { ok: true, id: envelope.id, type, payload: payload.data };
}

/** Validates an event as the app receives it. An unlisted code or diagnostic id fails here. */
export function parseEngineEvent(message: unknown): { ok: true; id: string; type: EngineEventType; payload: unknown } | EngineParseFailure {
  const envelope = parseEnvelope(message);
  if (!envelope.ok) return envelope;
  if (!Object.hasOwn(ENGINE_EVENT_SCHEMAS, envelope.type)) return { ok: false, code: "surface/unknown-command", message: `unknown event "${envelope.type}"`, id: envelope.id };
  const type = envelope.type as EngineEventType;
  const payload = ENGINE_EVENT_SCHEMAS[type].safeParse(envelope.payload);
  if (!payload.success) return { ok: false, code: "surface/invalid-payload", message: `${type}: ${issueText(payload.error)}`, id: envelope.id };
  return { ok: true, id: envelope.id, type, payload: payload.data };
}

export function parseEngineReply(message: unknown): { ok: true; reply: EngineReply } | EngineParseFailure {
  const parsed = engineReplySchema.safeParse(message);
  if (!parsed.success) return { ok: false, code: "surface/invalid-payload", message: issueText(parsed.error) };
  return { ok: true, reply: parsed.data as EngineReply };
}
