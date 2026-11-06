import { z } from "zod";
import { backgroundSchema, FADE_SHAPES, paramsSchema } from "./element-fields.ts";
import { elementSchema } from "./elements.ts";
import { bool, both, fail, int, limited, num, obj, oneOf, row, str, variants } from "./kit.ts";
import { captionTrackStyleSchema, coverTextStyleSchema } from "./text-style.ts";
import {
  colorRgbSchema, colorSchema, db, degrees, fraction, idSchema, langSchema, msSchema, percent, rationalSchema, sha256Schema, text, ticks, vec2Schema,
} from "./values.ts";

const zero = { x: 0, y: 0 };

// §3.1
const even = (ctx: z.RefinementCtx, value: number, key: string) => {
  if (value % 2 !== 0) fail(ctx, "document/out-of-range", [key], `${key} is an even number of pixels`);
};
export const canvasSizeSchema = obj({ width: int(16, 7680).default(1920), height: int(16, 7680).default(1080) }).superRefine((size, ctx) => {
  even(ctx, size.width, "width");
  even(ctx, size.height, "height");
  if (size.width * size.height > 33_177_600) fail(ctx, "document/out-of-range", ["height"], "width × height ≤ 33 177 600");
});
export type CanvasSize = { width: number; height: number };
export const settingsSchema = obj({
  fps: rationalSchema.default({ numerator: 30, denominator: 1 }),
  canvasSize: canvasSizeSchema.default({}),
  canvasSizeMode: oneOf("preset", "custom").default("preset"),
  lastCustomCanvasSize: row(canvasSizeSchema).nullable().default(null),
  originalCanvasSize: row(canvasSizeSchema).nullable().default(null),
  adoptCanvasFromFirstMedia: bool().default(true),
  adoptFrameRateFromFirstMedia: bool().default(true),
  background: backgroundSchema.default({ kind: "color", color: "#000000" }),
  useProxies: bool().default(true),
  // Constant at schema 32. Another value is an unknown union member: the validator reports it and the app opens read-only.
  colorPipeline: z.literal("sdr-rec709-8bit").default("sdr-rec709-8bit"),
});
export type ProjectSettings = z.infer<typeof settingsSchema>;

// §3.3
export const coverTextSchema = obj({
  id: idSchema,
  style: coverTextStyleSchema,
  content: text(500),
  position: vec2Schema.default(zero),
  scale: num(0.01, 100).default(1),
  rotation: degrees(-3600, 3600).default(0),
});
export const coverSchema = obj({
  source: oneOf("frame", "image"),
  sceneId: idSchema.optional(),
  time: ticks().optional(),
  mediaId: idSchema.optional(),
  crop: row(obj({ x: fraction().default(0.5), y: fraction().default(0.5), zoom: num(1, 8).default(1) })).default({}),
  texts: both(z.array(coverTextSchema).max(5)).default([]),
  image: obj({ sha256: sha256Schema, mime: oneOf("image/jpeg", "image/png"), width: int(1, 1920), height: int(1, 1920) }),
});
export type Cover = z.infer<typeof coverSchema>;

// §3.4
export const templateSlotSchema = obj({
  slotId: idSchema,
  elementId: idSchema,
  index: int(1, 200),
  accepts: oneOf("video", "image", "any").default("any"),
  duration: ticks(),
  required: bool().default(true),
  label: text(80).default(""),
  filled: bool().default(false),
  framing: obj({ zoom: num(1, 5).default(1), panX: num(-1, 1).default(0), panY: num(-1, 1).default(0) }).default({}),
  sourceOffset: ticks().default(0),
});
export const templateVariableSchema = obj({
  id: idSchema, label: text(80), type: oneOf("text", "color", "image", "number"),
  defaultValue: z.union([text(10_000), colorSchema, idSchema, z.number().finite(), z.null()]), maxLength: int(1, 10_000).optional(),
  value: z.union([text(10_000), colorSchema, idSchema, z.number().finite(), z.null()]),
  bindings: row(z.array(obj({ elementId: idSchema, field: str(200, 1) })).max(500)),
});
export const templateSchema = obj({
  templateId: idSchema,
  locked: bool(),
  sceneId: idSchema,
  slots: both(limited(templateSlotSchema, 200, "templateSlots")).default([]),
  editableTexts: row(limited(obj({ elementId: idSchema, label: text(80), maxLength: int(1, 10_000) }), 200, "templateEditableTexts")).default([]),
  audioSlots: row(limited(obj({ elementId: idSchema, label: text(80), replaceable: bool() }), 50, "templateAudioSlots")).default([]),
  themeColors: row(limited(colorSchema, 6, "templateThemeColors")).default([]),
  colorBindings: row(z.array(obj({ colorIndex: int(0, 5), elementId: idSchema, field: str(200, 1) })).max(500)).default([]),
  variables: row(limited(templateVariableSchema, 200, "templateVariables")).default([]),
});
export type TemplateMode = z.infer<typeof templateSchema>;

// §3.5 — the last export settings; never a path, a share-link token or a passcode.
const ABSOLUTE_PATH = /^(?:\/|~\/|[A-Za-z]:[\\/]|\\\\|file:)/;
const evenSide = () => int(16, 7680).refine((value) => value % 2 === 0, { message: "an even number of pixels", params: { code: "document/out-of-range" } });
export const exportValuesSchema = obj({
  resolution: row(z.union([obj({ width: evenSide(), height: evenSide() }), z.literal("match")])).default("match"),
  frameRate: row(z.union([rationalSchema, z.literal("match")])).default("match"),
  bitrateMode: oneOf("auto", "cbr", "vbr").default("auto"),
  bitrate: int(100_000, 200_000_000).optional(),
  codec: str(40).optional(),
  container: str(40).optional(),
  audio: row(obj({ enabled: bool(), codec: str(40).optional(), bitrate: z.number().int().positive().optional(), sampleRate: z.number().int().positive().optional(), channels: z.union([z.literal(1), z.literal(2)]).optional() })).default({ enabled: true }),
  captions: row(obj({ burnIn: bool(), sidecar: oneOf("none", "srt", "vtt", "ass") })).default({ burnIn: true, sidecar: "none" }),
  embedCover: bool().default(false),
  aiLabel: bool().default(false),
  creditsFile: bool().default(false),
  scope: oneOf("project", "range", "scene").default("project"),
  target: oneOf("device", "host").default("device"),
  smoothMotion: bool().default(false),
}, ["path", "token", "passcode"]).superRefine((values, ctx) => {
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === "string" && ABSOLUTE_PATH.test(value)) fail(ctx, "document/field-not-allowed", [key], "export settings never hold a file-system path");
  }
});
export const exportSettingsSchema = obj({
  type: oneOf("video", "audio", "gif", "sequence", "still").optional(),
  presetId: idSchema.optional(),
  values: both(exportValuesSchema).default({}),
});

// §5.1 — picture transitions and audio crossfades share one array on the track.
const TRANSITION_ONLY = ["type", "params", "easing", "audioCrossfade"];
const transitionBase = { id: idSchema, fromElementId: idSchema, toElementId: idSchema, duration: ticks().default(60_000), shape: oneOf(...FADE_SHAPES).default("equal-power") };
export const TRANSITION_VARIANTS = {
  transition: obj({
    ...transitionBase, kind: z.literal("transition"), type: idSchema, params: row(paramsSchema).default({}),
    easing: oneOf("linear", "ease-in", "ease-out", "ease-in-out").default("ease-in-out"), audioCrossfade: bool().default(true),
  }),
  crossfade: obj({ ...transitionBase, kind: z.literal("crossfade") }, TRANSITION_ONLY),
};
export const transitionRecordSchema = variants("kind", TRANSITION_VARIANTS);
export type TransitionRecord = z.infer<(typeof TRANSITION_VARIANTS)["transition"]> | z.infer<(typeof TRANSITION_VARIANTS)["crossfade"]>;

// §5.2
export const captionTrackSchema = obj({
  language: langSchema.default("und"),
  translationLanguage: langSchema.optional(),
  sourceId: idSchema.optional(),
  mode: oneOf("speech", "lyrics").default("speech"),
  burnIn: bool().default(true),
  showSpeakerLabels: bool().default(false),
  styleId: idSchema.optional(),
  style: captionTrackStyleSchema,
  layout: obj({
    anchor: oneOf("top", "middle", "bottom").default("bottom"),
    marginY: percent(0, 50).default(5),
    maxWidth: percent(20, 100).default(80),
    offset: vec2Schema.default(zero),
    scale: num(0.01, 100).default(1),
  }).default({}),
  highlight: obj({
    style: oneOf("none", "color", "background", "scale", "underline", "karaoke", "reveal").default("none"),
    color: colorSchema.default("#ffd400"),
    textColor: colorSchema.default("#000000"),
    scale: num(1, 2).default(1.2),
  }).default({}),
  bilingual: obj({
    visible: bool().default(true),
    order: oneOf("below", "above").default("below"),
    scale: percent(50, 150).default(80),
    color: colorSchema.optional(),
  }).default({}),
});

// §5
export const TRACK_TYPES = ["video", "text", "audio", "graphic", "effect", "adjustment", "caption"] as const;
export type TrackType = (typeof TRACK_TYPES)[number];
const TRACK_BASE = {
  id: idSchema,
  name: text(80, 1),
  locked: bool().default(false),
  pinned: bool().default(false),
  transitions: both(limited(transitionRecordSchema, 2000, "transitionsPerTrack")).default([]),
  elements: row(limited(elementSchema, 5000, "elementsPerTrack")).default([]),
};
const TRACK_HIDDEN = { hidden: bool().default(false) };
const TRACK_SOUND = { muted: bool().default(false), solo: bool().default(false), volume: db(-60, 12).default(0), pan: int(-100, 100).default(0) };
const DUCKING = { ducking: obj({ enabled: bool().default(false), amount: num(0, 30).default(12), attack: int(10, 1000).default(200), release: int(50, 3000).default(500), mode: oneOf("full", "voice-band").default("full") }).default({}) };
const CAPTION = { caption: captionTrackSchema };
// `zone` and `crossfades` never exist: the zone is the container, and crossfades are records of `transitions`.
const TRACK_OPTIONAL = ["hidden", "muted", "solo", "volume", "pan", "ducking", "caption", "zone", "crossfades"];
const trackOf = <T extends TrackType, S extends z.ZodRawShape>(type: T, extra: S) => {
  const shape = { ...TRACK_BASE, type: z.literal(type) as z.ZodLiteral<T>, ...extra };
  return obj(shape, TRACK_OPTIONAL.filter((key) => !(key in shape)));
};
/** The stored keys of every track type, for the field list. */
export const TRACK_SHAPE = { ...TRACK_BASE, type: oneOf(...TRACK_TYPES), ...TRACK_HIDDEN, ...TRACK_SOUND, ...DUCKING, caption: captionTrackSchema.optional() };
export const TRACK_VARIANTS = {
  video: trackOf("video", { ...TRACK_HIDDEN, ...TRACK_SOUND }),
  text: trackOf("text", TRACK_HIDDEN),
  audio: trackOf("audio", { ...TRACK_SOUND, ...DUCKING }),
  graphic: trackOf("graphic", TRACK_HIDDEN),
  effect: trackOf("effect", TRACK_HIDDEN),
  adjustment: trackOf("adjustment", TRACK_HIDDEN),
  caption: trackOf("caption", { ...TRACK_HIDDEN, ...CAPTION }),
};
export const trackSchema = variants("type", TRACK_VARIANTS);
export type Track = { [K in TrackType]: z.infer<(typeof TRACK_VARIANTS)[K]> }[TrackType];

/** Which element types a track type accepts. */
export const TRACK_ELEMENT_TYPES: Record<TrackType, readonly string[]> = {
  video: ["video", "image", "compound"], text: ["text"], audio: ["audio"], graphic: ["sticker", "graphic"],
  effect: ["effect"], adjustment: ["adjustment"], caption: ["caption"],
};

// §4
export const markerSchema = obj({
  id: idSchema,
  time: ticks(),
  note: text(2000).optional(),
  color: z.union([z.number().int().min(1).max(8), colorRgbSchema]).default(1),
  duration: ticks(undefined, 1).optional(),
});
export type Marker = z.infer<typeof markerSchema>;
export const multicamAngleSchema = obj({
  id: idSchema,
  name: text(80, 1),
  trackId: idSchema,
  syncOffset: int(-3_600_000, 3_600_000).default(0),
  syncConfidence: fraction().optional(),
});
export const multicamSchema = obj({
  syncMethod: oneOf("audio", "start", "playhead"),
  angles: both(limited(multicamAngleSchema, 8, "multicamAngles", 2)),
  // Default: the first angle (a reader resolves an absent value; a writer always stores it).
  audioAngleId: idSchema.optional(),
  audioFollowsVideo: bool().default(false),
});
export const sceneSchema = obj({
  id: idSchema,
  name: text(80, 1),
  isMain: bool(),
  kind: oneOf("timeline", "compound", "multicam").default("timeline"),
  compoundBackground: oneOf("none", "own").default("none"),
  tracks: obj({
    overlay: row(limited(trackSchema, 99, "overlayTracksPerScene")).default([]),
    main: row(trackSchema),
    audio: row(limited(trackSchema, 99, "audioTracksPerScene")).default([]),
  }),
  markers: both(limited(markerSchema, 1000, "markersPerScene")).default([]),
  inPoint: ticks().optional(),
  outPoint: ticks().optional(),
  multicam: row(multicamSchema).optional(),
  created_ms: msSchema,
  updated_ms: msSchema,
}, ["bookmarks", "order", "createdAt", "updatedAt"]).superRefine((scene, ctx) => {
  const main = scene.tracks.main as { type?: unknown } | undefined;
  if (main && typeof main.type === "string" && main.type !== "video") fail(ctx, "document/main-track-invalid", ["tracks", "main"], "the main track is a video track");
  scene.tracks.audio.forEach((track, index) => {
    if (track.type !== "audio") fail(ctx, "document/track-zone-mismatch", ["tracks", "audio", index], "the audio zone holds only audio tracks");
  });
  scene.tracks.overlay.forEach((track, index) => {
    if (track.type === "audio") fail(ctx, "document/track-zone-mismatch", ["tracks", "overlay", index], "an audio track lives in the audio zone");
  });
});
export type Scene = z.infer<typeof sceneSchema>;

// §12
export const PROVENANCE_SOURCES = ["imported", "recorded", "url", "stock", "ai", "bundled", "connector", "device", "slate", "derived"] as const;
const PROVENANCE_REQUIRED: Record<string, string[]> = {
  url: ["url"], connector: ["connector", "remoteId"], device: ["deviceId"],
  stock: ["provider", "itemId", "author", "licence", "licenceUrl", "sourceUrl"],
  ai: ["provider", "model", "role", "jobId"], slate: ["scriptId", "sceneId", "versionId"], derived: ["tool"],
};
export const provenanceSchema = row(obj({
  source: oneOf(...PROVENANCE_SOURCES),
  originalFileName: text(255).optional(),
  url: text(2000).optional(),
  connector: str().optional(), remoteId: str().optional(),
  deviceId: idSchema.optional(),
  provider: str().optional(), itemId: str().optional(), author: str().optional(), licence: str().optional(), licenceUrl: str().optional(), sourceUrl: str().optional(),
  attributionRequired: bool().default(false),
  // The credit line the source asks for, complete and as it is to be published (a catalogue track's title, author, licence and page; the lines an NCS release gives).
  credit: text(1000).optional(),
  model: str().optional(), role: str().optional(), prompt: str(20_000).optional(), negativePrompt: str(20_000).optional(), jobId: str().optional(),
  seed: z.number().int().optional(),
  referenceAssetIds: row(z.array(idSchema).max(32)).default([]),
  cost: row(obj({ amount: z.number().finite(), currency: str(16) })).optional(),
  created_ms: msSchema.optional(),
  scriptId: idSchema.optional(), sceneId: idSchema.optional(), shotId: idSchema.optional(), versionId: idSchema.optional(),
  tool: str().optional(),
  // A provenance never holds a provider key, a token or a signed URL.
}, ["apiKey", "token", "authorization", "signature"]).superRefine((value, ctx) => {
  for (const key of PROVENANCE_REQUIRED[value.source] ?? []) {
    if ((value as Record<string, unknown>)[key] === undefined) ctx.addIssue({ code: "invalid_type", expected: "string", received: "undefined", path: [key], message: "Required" });
  }
}));
export type Provenance = z.infer<typeof provenanceSchema>;

export const assetRecordSchema = obj({
  id: idSchema,
  name: text(255, 1),
  type: oneOf("image", "video", "audio"),
  kind: z.union([z.null(), oneOf("slate", "derived")]).default(null),
  size: int(0, Number.MAX_SAFE_INTEGER),
  lastModified_ms: msSchema.optional(),
  contentHash: sha256Schema.nullable().default(null),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  duration: ticks().optional(),
  fps: rationalSchema.optional(),
  hasAudio: bool().optional(),
  videoCodec: str(40).optional(), audioCodec: str(40).optional(), container: str(40).optional(),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0),
  folderId: idSchema.nullable().default(null),
  tags: row(z.array(text(40)).max(50)).default([]),
  ephemeral: bool().default(false),
  provenance: provenanceSchema.default({ source: "imported" }),
  derived: obj({ role: oneOf("matte", "stem-vocals", "stem-accompaniment"), sourceAssetId: idSchema, sourceStart: ticks().optional(), sourceEnd: ticks().optional() }).optional(),
  motionTracks: row(z.array(obj({ id: idSchema, name: text(80), shape: oneOf("rectangle", "ellipse"), sourceStart: ticks(), sourceEnd: ticks(), dataHash: sha256Schema })).max(50)).default([]),
  faces: row(z.array(obj({ id: idSchema, firstSeen: ticks() })).max(32)).default([]),
  created_ms: msSchema,
}).superRefine((asset, ctx) => {
  if (asset.kind === "derived" && asset.derived === undefined) ctx.addIssue({ code: "invalid_type", expected: "object", received: "undefined", path: ["derived"], message: "Required" });
  if (asset.kind !== "derived" && asset.derived !== undefined) fail(ctx, "document/field-not-allowed", ["derived"], "\"derived\" exists only on a derived asset");
  if (asset.kind === "slate" && asset.type !== "image") fail(ctx, "document/wrong-type", ["type"], "a slate asset is an image");
});
export type AssetRecord = z.infer<typeof assetRecordSchema>;

export const folderSchema = row(obj({ id: idSchema, name: text(80, 1), parentId: idSchema.nullable(), kind: oneOf("user", "ai-generated", "slates") }));
export type LibraryFolder = z.infer<typeof folderSchema>;
export const lutRecordSchema = obj({
  id: z.string().regex(/^user:[0-9a-f]{64}$/),
  name: text(120),
  format: oneOf("cube", "3dl"),
  size: int(0, 33_554_432),
  sha256: sha256Schema,
});
export const mediaSectionSchema = obj({
  assets: row(limited(assetRecordSchema, 10_000, "assetsPerProject")).default([]),
  folders: row(limited(folderSchema, 2000, "foldersPerProject")).default([]),
  luts: row(limited(lutRecordSchema, 500, "lutsPerProject")).default([]),
});

// §16 — device-local data: stored with the record, never part of the canonical document.
export const localAssetSchema = obj({
  storage: oneOf("managed", "external").default("managed"),
  externalPath: text(4000).optional(),
  externalGrantId: idSchema.optional(),
  externalSize: z.number().int().nonnegative().optional(),
  externalMtime_ms: msSchema.optional(),
  canDecode: bool().nullable().default(null),
  /** A video's sound track on this device: false when it is there and cannot be decoded here (the picture may be fine); null = not looked at, or no sound track. */
  canDecodeSound: bool().nullable().default(null),
  needsProbe: bool().default(false),
  proxy: row(obj({
    state: oneOf("none", "queued", "running", "succeeded", "failed", "cancelled", "unavailable"),
    size: z.number().int().nonnegative().optional(), sha256: sha256Schema.optional(),
    videoCodec: oneOf("h264", "vp9").optional(), audioCodec: oneOf("aac", "opus").optional(), container: oneOf("mp4", "webm").optional(),
  })).default({ state: "none" }),
  present: row(obj({ original: bool(), proxy: bool(), mezzanine: bool() })).default({ original: false, proxy: false, mezzanine: false }),
});
export type LocalAsset = z.infer<typeof localAssetSchema>;
export const localSchema = obj({
  // Default: the main scene (resolved by `localDefaults`, which knows the document).
  currentSceneId: idSchema.optional(),
  timelineViewState: obj({
    zoomLevel: z.number().finite().positive().default(1),
    scrollLeft: z.number().finite().nonnegative().default(0),
    playheadTime: ticks().default(0),
    scenePlayheads: row(z.record(ticks())).default({}),
    expandedKeyframeElementIds: row(z.array(idSchema).max(500)).default([]),
  }).default({}),
  folderId: idSchema.nullable().default(null),
  trash: row(obj({ kind: oneOf("project", "template"), deleted_ms: msSchema, originalFolderId: idSchema.optional() })).nullable().default(null),
  media: row(z.record(localAssetSchema)).default({}),
  exportSavePath: text(4000).optional(),
  uniformScaleLock: row(z.record(bool())).default({}),
});
export type LocalSection = z.infer<typeof localSchema>;

// §2
export const metadataSchema = obj({
  id: idSchema,
  name: text(120, 1).refine((value) => value.trim().length > 0, { message: "a name has at least one visible character", params: { code: "document/out-of-range" } }),
  duration: ticks(),
  created_ms: msSchema,
  updated_ms: msSchema,
  /** When the project was pinned; absent while it is not. Part of the document, so the pin follows the project to every device. */
  pinned_ms: msSchema.optional(),
  importedFrom: row(obj({ source: z.literal("opencut-classic"), id: idSchema })).optional(),
  thumbnail: z.null().default(null),
}, ["createdAt", "updatedAt"]);

export const ROOT_SHAPE = {
  format: z.literal("jagentchill.project"),
  schemaVersion: z.number().int().min(32),
  minReaderSchemaVersion: z.number().int().min(32),
  version: z.number().int().max(31).optional(),
  metadata: metadataSchema,
  settings: row(settingsSchema),
  cover: row(coverSchema).nullable().default(null),
  filmLink: row(obj({ filmId: idSchema, episodeId: idSchema })).optional(),
  workflowLink: row(obj({ runId: idSchema })).optional(),
  scriptLinks: row(limited(obj({ scriptId: idSchema }), 20, "scriptLinksPerProject")).default([]),
  template: row(templateSchema).optional(),
  scenes: row(limited(sceneSchema, 200, "scenesPerProject", 1)),
  media: row(mediaSectionSchema),
  glossaries: row(z.record(langSchema, limited(obj({ source: text(80), target: text(80) }), 200, "glossaryPairsPerLanguage"))
    .refine((value) => Object.keys(value).length <= 24, { message: "at most 24 languages", params: { code: "document/out-of-range" } })).default({}),
  exportSettings: row(exportSettingsSchema).optional(),
  publish: row(obj({ title: text(100), description: text(2200) })).optional(),
  // Device-local: excluded from the canonical form. The validator checks the document without it, and a malformed
  // `local` is reset to defaults on load instead of failing.
  local: row(localSchema).optional(),
};
/** Keys of the classic root that moved or were renamed; a singular `scriptLink` never existed at the root. */
const CLASSIC_ROOT_KEYS = ["currentSceneId", "timelineViewState", "scriptLink", "credits", "id", "name"];
export const projectDocumentSchema = obj(ROOT_SHAPE, CLASSIC_ROOT_KEYS);
export type ProjectDocument = z.infer<typeof projectDocumentSchema>;
