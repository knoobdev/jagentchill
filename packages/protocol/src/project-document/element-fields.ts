import { z } from "zod";
import { bool, both, int, limited, num, obj, oneOf, oneOfNumbers, row, str, variants } from "./kit.ts";
import { pathPointSchema } from "./animation.ts";
import { colorRgbSchema, colorSchema, db, degrees, fraction, idSchema, msSchema, percent, rationalSchema, text, ticks, vec2Schema } from "./values.ts";

const zero = { x: 0, y: 0 };

// §3.2 — the canvas background union, shared by `settings.background` and the per-clip `background`.
const BACKGROUND_KEYS = ["color", "css", "blurIntensity", "mediaId", "fit"];
const backgroundKind = <S extends z.ZodRawShape>(kind: string, shape: S) =>
  obj({ kind: z.literal(kind), ...shape }, BACKGROUND_KEYS.filter((key) => !(key in shape)));
export const BACKGROUND_VARIANTS = {
  color: backgroundKind("color", { color: colorRgbSchema }),
  gradient: backgroundKind("gradient", { css: text(4000, 1) }),
  blur: backgroundKind("blur", { blurIntensity: int(0, 1000).default(200) }),
  image: backgroundKind("image", { mediaId: idSchema, fit: oneOf("cover", "contain", "stretch").default("cover") }),
  transparent: backgroundKind("transparent", {}),
};
export const backgroundSchema = row(variants("kind", BACKGROUND_VARIANTS));
export type Background =
  | { kind: "color"; color: string } | { kind: "gradient"; css: string } | { kind: "blur"; blurIntensity: number }
  | { kind: "image"; mediaId: string; fit: "cover" | "contain" | "stretch" } | { kind: "transparent" };

// §7.1
export const BLEND_MODES = ["normal", "darken", "multiply", "color-burn", "lighten", "screen", "plus-lighter", "color-dodge", "overlay", "soft-light",
  "hard-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity"] as const;
export const transformSchema = obj({
  position: obj({ x: num(-100_000, 100_000).default(0), y: num(-100_000, 100_000).default(0) }).default({}),
  scale: obj({ x: num(0.01, 100).default(1), y: num(0.01, 100).default(1) }).default({}),
  rotation: degrees(-3600, 3600).default(0),
}, ["rotate", "scaleX", "scaleY", "positionX", "positionY"]);
const cropSide = () => fraction(0, 0.99).default(0);
export const cropSchema = obj({ left: cropSide(), top: cropSide(), right: cropSide(), bottom: cropSide() }).superRefine((crop, ctx) => {
  if (crop.left + crop.right > 0.99) ctx.addIssue({ code: "custom", path: ["right"], message: "left + right ≤ 0.99", params: { code: "document/out-of-range" } });
  if (crop.top + crop.bottom > 0.99) ctx.addIssue({ code: "custom", path: ["bottom"], message: "top + bottom ≤ 0.99", params: { code: "document/out-of-range" } });
});
export const flipSchema = obj({ horizontal: bool().default(false), vertical: bool().default(false) });

// §7.2
export const motionBlurSchema = obj({ enabled: bool().default(false), strength: percent().default(50), samples: oneOfNumbers(4, 8, 16).default(8) });
const clipSlot = { type: idSchema, duration: ticks().default(60_000), strength: percent().default(100) };
export const clipAnimationSlotSchema = obj({ ...clipSlot, followsDuration: bool().default(true) });
export const clipAnimationSchema = obj({
  in: row(obj(clipSlot, ["followsDuration"])).optional(),
  out: row(obj(clipSlot, ["followsDuration"])).optional(),
  combo: row(clipAnimationSlotSchema).optional(),
}).superRefine((value, ctx) => {
  if (value.combo === undefined) return;
  for (const key of ["in", "out"] as const) {
    if (value[key] !== undefined) ctx.addIssue({ code: "custom", path: [key], message: `"${key}" is exclusive with "combo"`, params: { code: "document/field-not-allowed" } });
  }
});

// §7.3
export const paramValueSchema = z.union([z.number().finite(), z.boolean(), z.string().max(4000)]);
export const paramsSchema = z.record(paramValueSchema);
export const effectEntrySchema = obj({ id: idSchema, type: idSchema, kind: oneOf("effect", "filter"), enabled: bool().default(true), params: row(paramsSchema) });
export type EffectEntry = z.infer<typeof effectEntrySchema>;
export const effectsSchema = both(limited(effectEntrySchema, 16, "effectsPerElement")).default([]);

// §7.5
export const MASK_TYPES = ["split", "mirror", "cinematic-bars", "rectangle", "ellipse", "heart", "diamond", "star", "text", "freeform"] as const;
export type MaskType = (typeof MASK_TYPES)[number];
/** Every `params` key of a mask at schema 32, with its type, range and default (the rows of §7.5). */
export const MASK_PARAM_SHAPE = {
  feather: num(0, 1000).default(0),
  inverted: bool().default(false),
  opacity: percent().default(100),
  strokeWidth: num(0, 100).default(0),
  strokeColor: colorSchema.default("#ffffff"),
  strokeAlign: oneOf("inside", "center", "outside").default("center"),
  centerX: num(-1, 1).default(0),
  centerY: num(-1, 1).default(0),
  rotation: degrees(0, 360).default(0),
  width: num(0.01, 1_000_000).default(0.6),
  height: num(0.01, 1_000_000).default(0.6),
  scale: num(0.01, 5).default(1),
  cornerRadius: percent().default(0),
  points: int(3, 12).default(5),
  innerRatio: num(0.1, 0.95).default(0.45),
  size: num(0.01, 5).default(0.4),
  content: text(2000).default("Mask"),
  fontFamily: str(200, 1).default("Arial"),
  fontSize: num(5, 300).default(15),
  fontWeight: oneOf("normal", "bold").default("normal"),
  fontStyle: oneOf("normal", "italic").default("normal"),
  textDecoration: oneOf("none", "underline", "line-through").default("none"),
  letterSpacing: num(-100, 500).default(0),
  lineHeight: num(0.1, 10).default(1.2),
  closed: bool().default(false),
  path: row(limited(pathPointSchema, 256, "pointsPerPath")).default([]),
};
export type MaskParamKey = keyof typeof MASK_PARAM_SHAPE;
const MASK_BASE: MaskParamKey[] = ["feather", "inverted", "opacity", "strokeWidth", "strokeColor", "strokeAlign", "centerX", "centerY", "rotation"];
const BOX: MaskParamKey[] = [...MASK_BASE, "width", "height", "scale"];
const TEXT_MASK: MaskParamKey[] = ["content", "fontFamily", "fontSize", "fontWeight", "fontStyle", "textDecoration", "letterSpacing", "lineHeight"];
/** The `params` keys each mask type declares; any other schema-32 mask key on that type is not allowed. */
export const MASK_PARAM_KEYS: Record<MaskType, MaskParamKey[]> = {
  split: MASK_BASE,
  mirror: [...MASK_BASE, "size"],
  "cinematic-bars": BOX,
  rectangle: [...BOX, "cornerRadius"],
  ellipse: BOX,
  heart: BOX,
  diamond: BOX,
  star: [...BOX, "points", "innerRatio"],
  text: [...MASK_BASE, "scale", ...TEXT_MASK],
  freeform: [...MASK_BASE, "scale", "closed", "path"],
};
export const maskTrackingSchema = obj({
  trackId: idSchema,
  followPosition: bool().default(true), followScale: bool().default(true), followRotation: bool().default(true),
  offset: vec2Schema.default(zero),
});
const pick = <K extends string>(shape: Record<string, z.ZodTypeAny>, keys: readonly K[]) => Object.fromEntries(keys.map((key) => [key, shape[key]])) as Record<K, z.ZodTypeAny>;
const maskOfType = (type: MaskType) => obj({
  id: idSchema,
  type: z.literal(type),
  enabled: bool().default(true),
  combine: oneOf("add", "subtract", "intersect", "exclude").default("add"),
  tracking: both(maskTrackingSchema).optional(),
  params: obj(pick(MASK_PARAM_SHAPE, MASK_PARAM_KEYS[type]), Object.keys(MASK_PARAM_SHAPE).filter((key) => !MASK_PARAM_KEYS[type].includes(key as MaskParamKey))).default({}),
});
export const MASK_VARIANTS = Object.fromEntries(MASK_TYPES.map((type) => [type, maskOfType(type)])) as Record<MaskType, ReturnType<typeof maskOfType>>;
export const maskSchema = variants("type", MASK_VARIANTS);
export type Mask = { id: string; type: MaskType; enabled: boolean; combine: "add" | "subtract" | "intersect" | "exclude"; tracking?: z.infer<typeof maskTrackingSchema>; params: Record<string, unknown> };
export const masksSchema = both(limited(maskSchema, 8, "masksPerElement")).default([]);

// §7.6
export const chromaKeySchema = obj({
  enabled: bool().default(false), color: colorRgbSchema.default("#00ff00"),
  strength: percent().default(40), edge: percent().default(10), shadow: percent().default(0), spill: percent().default(50),
});
const CUTOUT_BACKGROUND_KEYS = ["color", "blurIntensity", "mediaId"];
const cutoutBackground = <S extends z.ZodRawShape>(kind: string, shape: S) =>
  obj({ kind: z.literal(kind).default(kind as never), ...shape }, CUTOUT_BACKGROUND_KEYS.filter((key) => !(key in shape)));
export const CUTOUT_BACKGROUND_VARIANTS = {
  none: cutoutBackground("none", {}),
  color: cutoutBackground("color", { color: colorSchema.default("#000000") }),
  blur: cutoutBackground("blur", { blurIntensity: percent().default(50) }),
  media: cutoutBackground("media", { mediaId: idSchema }),
};
export const cutoutSchema = obj({
  mode: oneOf("none", "auto", "custom").default("none"),
  matteAssetId: idSchema.optional(),
  disabled_ms: msSchema.optional(),
  inverted: bool().default(false),
  feather: int(0, 100).default(2),
  shift: int(-50, 50).default(0),
  stroke: obj({
    style: oneOf("none", "solid", "dashed", "glow", "offset-shadow").default("none"),
    width: num(0, 100).default(8), color: colorSchema.default("#ffffff"), offset: num(0, 100).default(0), opacity: percent().default(100),
  }).default({}),
  background: variants("kind", CUTOUT_BACKGROUND_VARIANTS, { defaultVariant: "none" }).default({ kind: "none" }),
}).superRefine((value, ctx) => {
  if (value.disabled_ms !== undefined && value.mode !== "none") {
    ctx.addIssue({ code: "custom", path: ["disabled_ms"], message: "disabled_ms exists only while mode is none", params: { code: "document/field-not-allowed" } });
  }
});

// §7.7
const amount = () => num(-100, 100).default(0);
export const FACE_KEYS = ["smoothSkin", "brightenSkin", "darkCircles", "smileLines", "whitenTeeth", "blemishes", "brightenEyes", "skinTone"] as const;
export const RESHAPE_KEYS = ["slimFace", "jawWidth", "chinLength", "cheekbones", "foreheadHeight", "eyeSize", "eyeDistance", "noseWidth", "noseLength", "mouthSize", "lipThickness"] as const;
export const BODY_KEYS = ["slimBody", "waist", "hips", "legLength", "legWidth", "shoulderWidth", "armWidth", "headSize", "neckLength"] as const;
export const MAKEUP_LAYERS = ["lipstick", "blush", "eyeshadow", "eyeliner", "eyebrow", "contour"] as const;
const keyed = <K extends string, T extends z.ZodTypeAny>(keys: readonly K[], make: () => T) => Object.fromEntries(keys.map((key) => [key, make()])) as Record<K, T>;
export const faceSettingsSchema = obj({
  ...keyed(FACE_KEYS.slice(0, 7), () => percent().default(0)),
  skinTone: num(-50, 50).default(0),
  reshape: obj(keyed(RESHAPE_KEYS, amount)).default({}),
  makeup: obj({
    look: idSchema.optional(),
    intensity: percent().default(60),
    layers: row(z.record(oneOf(...MAKEUP_LAYERS), obj({ color: colorSchema, intensity: percent() }))).default({}),
  }).default({}),
});
export const stabilizationSchema = obj({ enabled: bool().default(false), level: oneOf("min-crop", "recommended", "max-stable").default("recommended") });
export const deflickerSchema = obj({ enabled: bool().default(false), strength: percent().default(50) });
export const eyeContactSchema = obj({ enabled: bool().default(false), strength: percent().default(70) });
export const relightSchema = obj({
  enabled: bool().default(false), presetId: idSchema.optional(),
  azimuth: degrees(-180, 180).default(0), elevation: degrees(-90, 90).default(0), intensity: percent().default(50),
  temperature: int(2000, 10_000).default(5500), ambient: num(-100, 100).default(0), scope: oneOf("face", "subject", "frame").default("subject"),
});
export const retouchSchema = obj({
  enabled: bool().default(false), applyToAll: bool().default(true),
  autoStyle: row(obj({ id: idSchema, amount: percent() })).optional(),
  faces: row(z.record(faceSettingsSchema).refine((faces) => Object.keys(faces).length <= 6, { message: "at most 6 face entries", params: { code: "document/out-of-range" } })).default({}),
  body: obj(keyed(BODY_KEYS, amount)).default({}),
});
const keyIds = () => row(limited(idSchema, 5000, "keyIds")).default([]);
export const aiMotionSchema = obj({ style: oneOf("zoom-in", "zoom-out", "push", "shake", "soft-sway", "dynamic").optional(), intensity: percent().default(50), keyIds: keyIds() });
export const autoReframeSchema = obj({ aspect: rationalSchema.optional(), keyIds: keyIds() });
export const processedSourceSchema = obj({
  originalMediaId: idSchema.optional(), tool: oneOf("upscale", "lipsync", "object-removal", "restyle", "expand"),
  sourceStart: ticks().optional(), sourceEnd: ticks().optional(),
});

// §7.8 — `followScale` and `followRotation` default per element type.
export const trackingSchema = (followShape: boolean) => obj({
  targetElementId: idSchema, trackId: idSchema,
  followPosition: bool().default(true), followScale: bool().default(followShape), followRotation: bool().default(followShape),
  offset: vec2Schema.default(zero),
});

// §7.9
export const BASIC_SIGNED = ["exposure", "brightness", "contrast", "saturation", "vibrance", "highlights", "shadows", "whites", "blacks", "temperature", "tint", "clarity", "vignette"] as const;
export const BASIC_UNSIGNED = ["sharpness", "fade", "grain"] as const;
export const BASIC_KEYS = [...BASIC_SIGNED, "hue", ...BASIC_UNSIGNED] as const;
export const HSL_BANDS = ["red", "orange", "yellow", "green", "aqua", "blue", "purple", "magenta"] as const;
export const WHEELS = ["shadows", "midtones", "highlights"] as const;
export const CURVES = ["master", "red", "green", "blue"] as const;
const enabled = () => bool().default(true);
const wheel = () => obj({ x: num(-1, 1).default(0), y: num(-1, 1).default(0), luminance: int(-100, 100).default(0) }).superRefine((value, ctx) => {
  if (value.x * value.x + value.y * value.y > 1 + 1e-9) ctx.addIssue({ code: "custom", path: ["x"], message: "x² + y² ≤ 1", params: { code: "document/out-of-range" } });
}).default({});
const curve = () => row(limited(obj({ x: fraction(), y: fraction() }), 16, "colourCurvePoints", 2)).default([{ x: 0, y: 0 }, { x: 1, y: 1 }]);
const band = () => obj({ hue: int(-100, 100).default(0), saturation: int(-100, 100).default(0), lightness: int(-100, 100).default(0) }).default({});
export const LUT_ID_PATTERN = /^(?:bundled:[A-Za-z0-9_.:-]{1,64}|user:[0-9a-f]{64})$/;
export const adjustmentsSchema = obj({
  lut: obj({ enabled: enabled(), lutId: z.string().regex(LUT_ID_PATTERN).optional(), intensity: percent().default(100) }).optional(),
  basic: obj({
    enabled: enabled(),
    ...keyed(BASIC_SIGNED, () => int(-100, 100).default(0)),
    hue: int(-180, 180).default(0),
    ...keyed(BASIC_UNSIGNED, () => int(0, 100).default(0)),
    autoStrength: percent().optional(),
  }).optional(),
  wheels: obj({ enabled: enabled(), ...keyed(WHEELS, wheel) }).optional(),
  curves: obj({ enabled: enabled(), ...keyed(CURVES, curve) }).optional(),
  hsl: obj({ enabled: enabled(), ...keyed(HSL_BANDS, band) }).optional(),
});

// §8
export const SPEED_PRESETS = ["custom", "montage", "hero", "bullet", "jump-cut", "flash-in", "flash-out"] as const;
export const retimeSchema = obj({
  // 0.1–100 for a writer; 0.01–0.1 is a migrated classic value and is valid as stored.
  rate: num(0.01, 100).default(1),
  maintainPitch: bool().default(false),
  reverse: bool().default(false),
  smooth: oneOf("none", "blend", "flow").default("none"),
  curve: obj({
    preset: oneOf(...SPEED_PRESETS),
    points: row(limited(obj({ u: fraction(), rate: num(0.1, 10) }), 32, "speedCurvePoints", 2)),
  }).optional(),
});
export const freezeSchema = obj({ mediaId: idSchema.optional(), sourceTime: ticks() });

// §9
export const FADE_SHAPES = ["linear", "equal-power", "s-curve", "logarithmic", "exponential"] as const;
export const VOICE_EFFECTS = ["none", "deep", "high", "chipmunk", "giant", "robot", "echo", "hall", "telephone", "megaphone", "vinyl", "synth", "electronic", "tremble", "underwater"] as const;
export const EQ_PRESETS = ["flat", "voice-clarity", "bass-boost", "treble-boost", "warm", "radio", "custom"] as const;
export const EQ_BANDS = ["low", "lowMid", "mid", "highMid", "high"] as const;
const fade = () => obj({ duration: ticks().default(0), shape: oneOf(...FADE_SHAPES).default("equal-power") }).default({});
const toggled = () => obj({ enabled: bool().default(false), strength: percent().default(50) });
/** The audio rows of §9 shared by audio, video and compound elements. */
export const AUDIO_SHAPE = {
  volume: db(-60, 20).default(0),
  muted: bool().default(false),
  pan: int(-100, 100).default(0),
  fadeIn: fade(),
  fadeOut: fade(),
  isVoice: bool().default(false),
  noiseReduction: toggled().optional(),
  enhanceVoice: toggled().optional(),
  vocalIsolation: obj({ mode: oneOf("off", "keep-vocals", "remove-vocals").default("off"), vocalsAssetId: idSchema.optional(), accompanimentAssetId: idSchema.optional() }).optional(),
  voiceEffect: obj({ type: oneOf(...VOICE_EFFECTS).default("none"), intensity: percent().default(100) }).optional(),
  pitch: obj({ semitones: int(-12, 12).default(0), cents: int(-100, 100).default(0) }).optional(),
  normalize: obj({ enabled: bool().default(false), target: int(-30, -5).default(-14), gainDb: db(-60, 24).default(0), measuredLufs: z.number().finite().optional() }).optional(),
  eq: obj({ enabled: bool().default(false), preset: oneOf(...EQ_PRESETS).default("flat"), bands: obj(keyed(EQ_BANDS, () => num(-12, 12).default(0))).default({}) }).optional(),
  compressor: obj({
    enabled: bool().default(false), threshold: num(-60, 0).default(-18), ratio: num(1, 20).default(3),
    attack: int(1, 200).default(10), release: int(10, 1000).default(120), makeup: num(0, 24).default(0),
  }).optional(),
  beats: row(limited(ticks(), 2000, "beatsPerElement")).default([]),
};
export const AUDIO_KEYS = Object.keys(AUDIO_SHAPE);
