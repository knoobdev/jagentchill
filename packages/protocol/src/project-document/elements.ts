import { z } from "zod";
import { animationsSchema } from "./animation.ts";
import {
  adjustmentsSchema, aiMotionSchema, AUDIO_SHAPE, autoReframeSchema, backgroundSchema, BLEND_MODES, chromaKeySchema, clipAnimationSchema, cropSchema,
  cutoutSchema, deflickerSchema, effectsSchema, eyeContactSchema, flipSchema, freezeSchema, masksSchema, motionBlurSchema, processedSourceSchema,
  relightSchema, retimeSchema, retouchSchema, stabilizationSchema, trackingSchema, transformSchema,
} from "./element-fields.ts";
import { bool, both, fail, int, limited, num, obj, oneOf, row, variants } from "./kit.ts";
import { captionStyleOverrideSchema, captionTransformSchema, TEXT_STYLE_SHAPE } from "./text-style.ts";
import { colorSchema, fraction, idSchema, MAX_ELEMENT_DURATION, MAX_TICKS, sha256Schema, text, ticks } from "./values.ts";

export const ELEMENT_TYPES = ["video", "image", "audio", "text", "caption", "sticker", "graphic", "effect", "adjustment", "compound"] as const;
export type ElementType = (typeof ELEMENT_TYPES)[number];

// §6 — provenance links are document data: never interpreted, kept by every copy.
export const elementFilmLinkSchema = row(obj({ filmId: idSchema, episodeId: idSchema, panelId: idSchema.optional(), lineId: idSchema.optional(), cueId: idSchema.optional(), assetVersionId: idSchema }));
export const elementWorkflowLinkSchema = row(obj({ runId: idSchema, stepId: idSchema, shotId: idSchema.optional(), artifactVersionId: idSchema }));
export const elementScriptLinkSchema = row(obj({ scriptId: idSchema, sceneId: idSchema, shotId: idSchema.optional(), lineId: idSchema.optional(), versionId: idSchema, syncedHash: sha256Schema }));

const nullableId = () => idSchema.nullable().default(null);
/** §6 rows present on every element type. */
export const COMMON_SHAPE = {
  id: idSchema,
  name: text(200, 1),
  startTime: ticks(),
  duration: ticks(MAX_ELEMENT_DURATION, 1),
  timingAnchor: row(obj({ elementId: idSchema, edge: oneOf("start", "end"), offsetTicks: z.number().int().min(-MAX_TICKS).max(MAX_TICKS) })).optional(),
  trimStart: ticks().default(0),
  trimEnd: ticks().default(0),
  groupId: nullableId(),
  linkId: nullableId(),
  filmLink: elementFilmLinkSchema.optional(),
  workflowLink: elementWorkflowLinkSchema.optional(),
  scriptLink: elementScriptLinkSchema.optional(),
  animations: animationsSchema.optional(),
};
const HIDDEN = { hidden: bool().default(false) };
const SOURCE = { sourceDuration: ticks().optional() };
const TRANSITIONS = { transitionIn: nullableId(), transitionOut: nullableId() };
const PLACED = { transform: transformSchema.default({}), opacity: fraction().default(1), blendMode: oneOf(...BLEND_MODES).default("normal"), flip: flipSchema.default({}) };
const FRAMED = { crop: cropSchema.default({}), background: backgroundSchema.optional() };
const STACK = { effects: effectsSchema };
const SHAPED = { masks: masksSchema, adjustments: adjustmentsSchema.optional() };
const MOVING = { motionBlur: motionBlurSchema.optional(), clipAnimation: clipAnimationSchema.optional() };
const FACE_TOOLS = { retouch: retouchSchema.optional(), relight: relightSchema.optional(), eyeContact: eyeContactSchema.optional(), aiMotion: aiMotionSchema.optional(), processedSource: processedSourceSchema.optional() };
const KEYED = { chromaKey: chromaKeySchema.optional(), cutout: cutoutSchema.optional() };
const SOUND = { ...AUDIO_SHAPE, isSourceAudioEnabled: bool().default(true) };

// §10.6 / §10.7 / §10.8 / §10.9
export const GRAPHIC_DEFINITIONS = ["rectangle", "ellipse", "polygon", "star", "arrow", "line", "drawing"] as const;
export type GraphicDefinitionId = (typeof GRAPHIC_DEFINITIONS)[number];
/** Every graphic `params` key of schema 32 (the rows of §10.8). `line` narrows `stroke` and `strokeWidth`. */
export const GRAPHIC_PARAM_SHAPE = {
  fill: colorSchema.default("#ffffff"),
  stroke: colorSchema.default("#000000"),
  strokeWidth: num(0, 64).default(0),
  strokeAlign: oneOf("inside", "center", "outside").default("center"),
  cornerRadius: num(0, 50).default(0),
  sides: int(3, 12).default(5),
  points: int(3, 12).default(5),
  depth: num(1, 99).default(45),
  lineCap: oneOf("butt", "round", "square").default("round"),
  dash: num(0, 200).default(0),
  headSize: num(10, 90).default(40),
  shaftWidth: num(5, 90).default(30),
  doubleHeaded: bool().default(false),
  colorOverride: z.union([colorSchema, z.literal("")]).default(""),
};
export type GraphicParamKey = keyof typeof GRAPHIC_PARAM_SHAPE;
const FILLED: GraphicParamKey[] = ["fill", "stroke", "strokeWidth", "strokeAlign"];
export const GRAPHIC_PARAM_KEYS: Record<GraphicDefinitionId, GraphicParamKey[]> = {
  rectangle: [...FILLED, "cornerRadius"],
  ellipse: FILLED,
  polygon: [...FILLED, "cornerRadius", "sides"],
  star: [...FILLED, "points", "depth"],
  arrow: [...FILLED, "headSize", "shaftWidth", "doubleHeaded"],
  line: ["stroke", "strokeWidth", "lineCap", "dash"],
  drawing: ["colorOverride"],
};
const LINE_OVERRIDES: Partial<Record<GraphicParamKey, z.ZodTypeAny>> = { stroke: colorSchema.default("#ffffff"), strokeWidth: num(1, 64).default(8) };
export function graphicParamSchema(definition: GraphicDefinitionId, key: GraphicParamKey): z.ZodTypeAny {
  return (definition === "line" && LINE_OVERRIDES[key]) || GRAPHIC_PARAM_SHAPE[key];
}
const graphicParams = (definition: GraphicDefinitionId) => obj(
  Object.fromEntries(GRAPHIC_PARAM_KEYS[definition].map((key) => [key, graphicParamSchema(definition, key)])),
  // The visual keys of the classic flat map never live in `params`.
  [...Object.keys(GRAPHIC_PARAM_SHAPE).filter((key) => !GRAPHIC_PARAM_KEYS[definition].includes(key as GraphicParamKey)), "opacity", "blendMode",
    "transform.positionX", "transform.positionY", "transform.scaleX", "transform.scaleY", "transform.rotate"],
).default({});
export const strokeSchema = obj({
  id: idSchema,
  points: row(z.array(z.tuple([z.number().finite(), z.number().finite()])).min(2).max(10_000)),
  width: num(1, 200).default(12),
  color: colorSchema.default("#ffffff"),
  brush: oneOf("pen", "marker").default("pen"),
});
export type Stroke = z.infer<typeof strokeSchema>;

const TEXT_TRACKING = { tracking: trackingSchema(false).optional() };
const SHAPE_TRACKING = { tracking: trackingSchema(true).optional() };
const type = <T extends ElementType>(name: T) => ({ type: z.literal(name) });

const VIDEO = {
  ...COMMON_SHAPE, ...type("video"), ...HIDDEN, ...SOURCE, ...TRANSITIONS, ...PLACED, ...FRAMED, ...STACK, ...SHAPED, ...MOVING, ...KEYED, ...FACE_TOOLS,
  stabilization: stabilizationSchema.optional(), deflicker: deflickerSchema.optional(), autoReframe: autoReframeSchema.optional(),
  retime: retimeSchema.optional(), freeze: freezeSchema.optional(), ...SOUND,
  // Absent only on an unfilled template slot (checked by the validator, which knows the slots).
  mediaId: idSchema.optional(),
};
const IMAGE = {
  ...COMMON_SHAPE, ...type("image"), ...HIDDEN, ...TRANSITIONS, ...PLACED, ...FRAMED, ...STACK, ...SHAPED, ...MOVING, ...KEYED, ...FACE_TOOLS,
  autoReframe: autoReframeSchema.optional(), mediaId: idSchema.optional(),
};
const AUDIO = {
  ...COMMON_SHAPE, ...type("audio"), ...SOURCE, ...TRANSITIONS, retime: retimeSchema.optional(), ...AUDIO_SHAPE,
  sourceType: oneOf("upload", "library", "bundled"), mediaId: idSchema, sourceUrl: text(2000).optional(),
};
const TEXT = { ...COMMON_SHAPE, ...type("text"), ...HIDDEN, ...PLACED, ...STACK, motionBlur: motionBlurSchema.optional(), ...TEXT_TRACKING, content: text(10_000).default("Default text"), ...TEXT_STYLE_SHAPE };
const CAPTION = {
  ...COMMON_SHAPE, ...type("caption"), ...HIDDEN,
  text: text(500).default(""),
  words: row(limited(obj({ text: text(100), start: ticks(), end: ticks() }), 200, "wordsPerCaption")).optional(),
  translation: text(500).optional(),
  speaker: text(80).optional(),
  edited: bool().default(false),
  style: captionStyleOverrideSchema.optional(),
  transform: captionTransformSchema.optional(),
};
const STICKER = {
  ...COMMON_SHAPE, ...type("sticker"), ...HIDDEN, ...PLACED, ...STACK, ...SHAPED, ...MOVING, ...SHAPE_TRACKING,
  // `provider:value`, both parts non-empty.
  stickerId: z.string().regex(/^[^:]+:.+$/).min(3).max(200),
  intrinsicWidth: z.number().finite().positive().default(200),
  intrinsicHeight: z.number().finite().positive().default(200),
  loop: bool().default(true),
  playbackSpeed: num(0.1, 4).default(1),
};
const GRAPHIC_BASE = { ...COMMON_SHAPE, ...type("graphic"), ...HIDDEN, ...PLACED, ...STACK, ...SHAPED, ...MOVING, ...SHAPE_TRACKING };
const graphicShape = (definition: GraphicDefinitionId) => ({
  ...GRAPHIC_BASE,
  definitionId: z.literal(definition),
  params: graphicParams(definition),
  ...(definition === "drawing" ? {
    intrinsicWidth: z.number().finite().positive(),
    intrinsicHeight: z.number().finite().positive(),
    strokes: both(limited(strokeSchema, 2000, "strokesPerDrawing", 1)),
  } : {}),
});
const EFFECT = { ...COMMON_SHAPE, ...type("effect"), ...HIDDEN, ...STACK, target: z.literal("beneath").default("beneath") };
const ADJUSTMENT = { ...COMMON_SHAPE, ...type("adjustment"), ...HIDDEN, opacity: fraction().default(1), ...STACK, ...SHAPED };
const COMPOUND = {
  ...COMMON_SHAPE, ...type("compound"), ...HIDDEN, ...SOURCE, ...TRANSITIONS, ...PLACED, ...FRAMED, ...STACK, ...SHAPED, ...MOVING,
  autoReframe: autoReframeSchema.optional(), retime: retimeSchema.optional(), freeze: freezeSchema.optional(), ...SOUND,
  sceneId: idSchema, multicam: obj({ angleId: idSchema }).optional(),
};

/** The stored keys of each element type; the matrix of catalogue §10.1 in executable form. */
export const ELEMENT_SHAPES = {
  video: VIDEO, image: IMAGE, audio: AUDIO, text: TEXT, caption: CAPTION, sticker: STICKER,
  graphic: { ...graphicShape("drawing"), definitionId: oneOf(...GRAPHIC_DEFINITIONS), params: row(z.record(z.union([z.number(), z.boolean(), z.string()]))) },
  effect: EFFECT, adjustment: ADJUSTMENT, compound: COMPOUND,
} as const satisfies Record<ElementType, z.ZodRawShape>;

/** Keys of the classic element shape that have no place at schema 32. */
const CLASSIC_KEYS = ["effectType", "textDecoration", "zone", "trackId", "order", "keyframes", "bookmarks", "reverse", "params"];
const ALL_KEYS = [...new Set([...Object.values(ELEMENT_SHAPES).flatMap((shape) => Object.keys(shape)), ...CLASSIC_KEYS])];
/** Schema-32 keys an element of this type must not carry (`document/field-not-allowed`). */
const foreign = (shape: z.ZodRawShape) => ALL_KEYS.filter((key) => !(key in shape));
export const ELEMENT_KEYS = Object.fromEntries(ELEMENT_TYPES.map((name) => [name, Object.keys(ELEMENT_SHAPES[name])])) as Record<ElementType, string[]>;

type Ctx = z.RefinementCtx;
const filters = (value: { effects?: { kind?: string }[] }) => (value.effects ?? []).filter((entry) => entry?.kind === "filter").length;
function oneFilter(value: { effects?: { kind?: string }[] }, ctx: Ctx): void {
  if (filters(value) > 1) fail(ctx, "document/effects-limit", ["effects"], "at most one entry of kind \"filter\"", { limit: "filtersPerElement", value: 1 });
}

export const videoElementSchema = obj(VIDEO, foreign(VIDEO)).superRefine((value, ctx) => {
  oneFilter(value, ctx);
  if (value.freeze === undefined) return;
  if (value.retime !== undefined) fail(ctx, "document/field-not-allowed", ["retime"], "a freeze element has no retime");
  if (value.sourceDuration !== undefined) fail(ctx, "document/field-not-allowed", ["sourceDuration"], "a freeze element has no sourceDuration");
  if (value.freeze.mediaId === undefined) ctx.addIssue({ code: "invalid_type", expected: "string", received: "undefined", path: ["freeze", "mediaId"], message: "Required" });
});
export const imageElementSchema = obj(IMAGE, foreign(IMAGE)).superRefine(oneFilter);
export const audioElementSchema = obj(AUDIO, foreign(AUDIO));
export const textElementSchema = obj(TEXT, foreign(TEXT)).superRefine((value, ctx) => {
  oneFilter(value, ctx);
  if (value.bubble !== undefined && value.background.enabled) fail(ctx, "document/field-not-allowed", ["background", "enabled"], "a bubble and a text background are mutually exclusive");
});
export const captionElementSchema = obj(CAPTION, foreign(CAPTION));
export const stickerElementSchema = obj(STICKER, foreign(STICKER)).superRefine(oneFilter);
const graphicOf = (definition: GraphicDefinitionId) => {
  const shape = graphicShape(definition);
  return obj(shape, foreign(shape)).superRefine((value, ctx) => {
    oneFilter(value, ctx);
    const strokes = (value as { strokes?: Stroke[] }).strokes;
    if (strokes && strokes.reduce((total, stroke) => total + stroke.points.length, 0) > 200_000) {
      fail(ctx, "document/limit-exceeded", ["strokes"], "a drawing holds at most 200 000 points", { limit: "pointsPerDrawing", value: 200_000 });
    }
  });
};
export const GRAPHIC_VARIANTS = Object.fromEntries(GRAPHIC_DEFINITIONS.map((definition) => [definition, graphicOf(definition)])) as Record<GraphicDefinitionId, ReturnType<typeof graphicOf>>;
export const graphicElementSchema = variants("definitionId", GRAPHIC_VARIANTS, { unknownCode: "document/unknown-definition" });
export const effectElementSchema = obj(EFFECT, foreign(EFFECT)).superRefine((value, ctx) => {
  if (value.effects.length !== 1) fail(ctx, "document/effects-limit", ["effects"], "an effect element holds exactly one entry", { limit: "effectElementEntries", value: 1 });
});
export const adjustmentElementSchema = obj(ADJUSTMENT, foreign(ADJUSTMENT)).superRefine((value, ctx) => {
  if (value.effects.length > 1 || value.effects.some((entry) => entry.kind !== "filter")) {
    fail(ctx, "document/effects-limit", ["effects"], "an adjustment element holds at most one entry, of kind \"filter\"", { limit: "adjustmentElementEntries", value: 1 });
  }
});
export const compoundElementSchema = obj(COMPOUND, foreign(COMPOUND)).superRefine((value, ctx) => {
  oneFilter(value, ctx);
  if (value.retime?.curve !== undefined) fail(ctx, "document/field-not-allowed", ["retime", "curve"], "a compound element is retimed by a constant rate only");
  if (value.retime && value.retime.smooth !== "none") fail(ctx, "document/field-not-allowed", ["retime", "smooth"], "a compound element has no smoothing");
  if (value.freeze === undefined) return;
  if (value.freeze.mediaId !== undefined) fail(ctx, "document/field-not-allowed", ["freeze", "mediaId"], "a compound freeze names no media");
  if (value.retime !== undefined) fail(ctx, "document/field-not-allowed", ["retime"], "a freeze element has no retime");
  if (value.sourceDuration !== undefined) fail(ctx, "document/field-not-allowed", ["sourceDuration"], "a freeze element has no sourceDuration");
});

export const ELEMENT_VARIANTS = {
  video: videoElementSchema, image: imageElementSchema, audio: audioElementSchema, text: textElementSchema, caption: captionElementSchema,
  sticker: stickerElementSchema, graphic: graphicElementSchema, effect: effectElementSchema, adjustment: adjustmentElementSchema, compound: compoundElementSchema,
};
/** Any element. An element whose `type` this schema does not know is reported so that a newer document can keep it. */
export const elementSchema = variants("type", ELEMENT_VARIANTS);

export type VideoElement = z.infer<typeof videoElementSchema>;
export type ImageElement = z.infer<typeof imageElementSchema>;
export type AudioElement = z.infer<typeof audioElementSchema>;
export type TextElement = z.infer<typeof textElementSchema>;
export type CaptionElement = z.infer<typeof captionElementSchema>;
export type StickerElement = z.infer<typeof stickerElementSchema>;
export type GraphicElement = z.infer<(typeof GRAPHIC_VARIANTS)[GraphicDefinitionId]>;
export type EffectElement = z.infer<typeof effectElementSchema>;
export type AdjustmentElement = z.infer<typeof adjustmentElementSchema>;
export type CompoundElement = z.infer<typeof compoundElementSchema>;
export type TimelineElement = VideoElement | ImageElement | AudioElement | TextElement | CaptionElement | StickerElement | GraphicElement | EffectElement | AdjustmentElement | CompoundElement;
