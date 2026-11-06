import { z } from "zod";
import type { ChannelShape } from "./animation.ts";
import { BASIC_KEYS, BODY_KEYS, FACE_KEYS, faceSettingsSchema, HSL_BANDS, MASK_PARAM_KEYS, MASK_PARAM_SHAPE, RESHAPE_KEYS, WHEELS, type MaskParamKey, type MaskType } from "./element-fields.ts";
import { ELEMENT_SHAPES, GRAPHIC_PARAM_KEYS, graphicParamSchema, type ElementType, type GraphicDefinitionId, type GraphicParamKey } from "./elements.ts";
import { unwrap } from "./kit.ts";

type Types = readonly ElementType[];
const VISUAL: Types = ["video", "image", "text", "sticker", "graphic", "compound"];
const ADJUSTABLE: Types = ["video", "image", "sticker", "graphic", "compound", "adjustment"];
const PICTURE: Types = ["video", "image"];
const fixed = (group: number, shape: ChannelShape, types: Types, paths: string[]) => paths.map((path) => ({ path, group, shape, types }));

/** The animatable paths of fixed name (catalogue §11.2), in lane order. Paths through an id-keyed collection are resolved by `animatablePath`. */
export const STATIC_ANIMATABLE_PATHS: readonly { path: string; group: number; shape: ChannelShape; types: Types }[] = [
  ...fixed(1, "scalar", VISUAL, ["transform.position.x", "transform.position.y", "transform.scale.x", "transform.scale.y", "transform.rotation"]),
  ...fixed(1, "scalar", [...VISUAL, "adjustment"], ["opacity"]),
  ...fixed(2, "scalar", ["audio", "video", "compound"], ["volume", "pan"]),
  ...fixed(3, "color", ["text"], ["color", "fill.gradientColor"]),
  ...fixed(3, "scalar", ["text"], ["fontSize", "letterSpacing", "lineHeight", "fill.gradientAngle", "box.width", "curve"]),
  ...fixed(3, "color", ["text"], ["background.color"]),
  ...fixed(3, "scalar", ["text"], ["background.cornerRadius", "background.paddingX", "background.paddingY", "background.offsetX", "background.offsetY"]),
  ...fixed(3, "color", ["text"], ["stroke.color", "shadow.color", "glow.color", "bubble.color"]),
  ...fixed(3, "scalar", ["text"], ["stroke.width", "shadow.opacity", "shadow.blur", "shadow.distance", "shadow.angle", "glow.intensity", "glow.radius"]),
  ...fixed(5, "scalar", VISUAL, ["motionBlur.strength"]),
  ...fixed(7, "scalar", ADJUSTABLE, BASIC_KEYS.map((key) => `adjustments.basic.${key}`)),
  ...fixed(7, "scalar", ADJUSTABLE, HSL_BANDS.flatMap((band) => ["hue", "saturation", "lightness"].map((key) => `adjustments.hsl.${band}.${key}`))),
  ...fixed(7, "scalar", ADJUSTABLE, WHEELS.flatMap((wheel) => ["x", "y", "luminance"].map((key) => `adjustments.wheels.${wheel}.${key}`))),
  ...fixed(7, "scalar", ADJUSTABLE, ["adjustments.lut.intensity"]),
  ...fixed(8, "scalar", PICTURE, ["chromaKey.strength", "chromaKey.edge", "chromaKey.shadow", "chromaKey.spill", "cutout.stroke.width", "cutout.stroke.offset", "cutout.stroke.opacity"]),
  ...fixed(8, "color", PICTURE, ["cutout.stroke.color"]),
  ...fixed(8, "scalar", ["video", "image", "compound"], ["crop.left", "crop.top", "crop.right", "crop.bottom"]),
  ...fixed(9, "scalar", PICTURE, BODY_KEYS.map((key) => `retouch.body.${key}`)),
  ...fixed(9, "scalar", PICTURE, ["relight.azimuth", "relight.elevation", "relight.intensity", "relight.temperature", "relight.ambient"]),
];
const STATIC = new Map(STATIC_ANIMATABLE_PATHS.map((entry) => [entry.path, entry]));

export const MASK_SCALAR_KEYS: readonly MaskParamKey[] = ["feather", "opacity", "strokeWidth", "centerX", "centerY", "rotation", "width", "height", "scale", "cornerRadius", "innerRatio", "size", "fontSize", "letterSpacing", "lineHeight"];
export const GRAPHIC_SCALAR_KEYS: readonly GraphicParamKey[] = ["strokeWidth", "cornerRadius", "sides", "points", "depth", "dash", "headSize", "shaftWidth"];
export const GRAPHIC_COLOR_KEYS: readonly GraphicParamKey[] = ["fill", "stroke", "colorOverride"];
const MASKABLE: Types = ["video", "image", "sticker", "graphic", "compound", "adjustment"];
const EFFECT_STACK: Types = ["video", "image", "text", "sticker", "graphic", "compound", "effect", "adjustment"];

export type NumberRange = { min: number; max: number };
/** The numeric range a Zod leaf accepts, when it has one. */
export function numberRange(schema: z.ZodTypeAny | undefined): NumberRange | undefined {
  if (!schema) return undefined;
  const { inner, tags } = unwrap(schema);
  if (tags.min !== undefined && tags.max !== undefined) return { min: tags.min, max: tags.max };
  const checks = (inner._def as { checks?: { kind: string; value?: number }[] }).checks;
  if ((inner._def as { typeName: string }).typeName !== "ZodNumber" || !checks) return undefined;
  const min = checks.find((check) => check.kind === "min")?.value, max = checks.find((check) => check.kind === "max")?.value;
  return min !== undefined && max !== undefined ? { min, max } : undefined;
}
/** The schema of the stored field a dotted path names inside a shape. */
export function fieldSchema(shape: z.ZodRawShape, segments: string[]): z.ZodTypeAny | undefined {
  let current: z.ZodTypeAny | undefined;
  let members: z.ZodRawShape | undefined = shape;
  for (const segment of segments) {
    current = members?.[segment];
    if (!current) return undefined;
    const { inner } = unwrap(current);
    members = (inner._def as { typeName: string }).typeName === "ZodObject" ? (inner as z.ZodObject<z.ZodRawShape>).shape : undefined;
  }
  return current;
}

export type AnimatablePath = {
  group: number;
  /** `null` = decided by the effect definition (scalar, colour or discrete). */
  shape: ChannelShape | null;
  range?: NumberRange;
  /** The id-keyed entry the path passes through. */
  entry?: { collection: "effects" | "masks" | "faces"; id: string; key: string };
};
type ElementLike = { type: string; definitionId?: string; effects?: { id: string }[]; masks?: { id: string; type: string }[] };

/**
 * Resolves an animation path against an element: `null` when the path is not animatable on that element (not in the
 * table, a type that does not carry the field, a key the mask or shape does not declare, an entry that does not exist).
 */
export function animatablePath(element: ElementLike, path: string): AnimatablePath | null {
  const type = element.type as ElementType;
  const shape = ELEMENT_SHAPES[type] as z.ZodRawShape | undefined;
  if (!shape) return null;
  const known = STATIC.get(path);
  if (known) return known.types.includes(type) ? { group: known.group, shape: known.shape, range: numberRange(fieldSchema(shape, path.split("."))) } : null;
  const parts = path.split(".");
  if (parts[0] === "params" && parts.length === 2 && type === "graphic") {
    const key = parts[1] as GraphicParamKey, definition = element.definitionId as GraphicDefinitionId;
    if (!GRAPHIC_PARAM_KEYS[definition]?.includes(key)) return null;
    if (GRAPHIC_COLOR_KEYS.includes(key)) return { group: 4, shape: "color" };
    return GRAPHIC_SCALAR_KEYS.includes(key) ? { group: 4, shape: "scalar", range: numberRange(graphicParamSchema(definition, key)) } : null;
  }
  if (parts[0] === "effects" && parts.length === 4 && parts[2] === "params" && EFFECT_STACK.includes(type)) {
    return element.effects?.some((entry) => entry.id === parts[1]) ? { group: 5, shape: null, entry: { collection: "effects", id: parts[1], key: parts[3] } } : null;
  }
  if (parts[0] === "masks" && parts.length === 4 && parts[2] === "params" && MASKABLE.includes(type)) {
    const mask = element.masks?.find((entry) => entry.id === parts[1]);
    const key = parts[3] as MaskParamKey;
    if (!mask || !MASK_PARAM_KEYS[mask.type as MaskType]?.includes(key)) return null;
    const entry = { collection: "masks" as const, id: parts[1], key };
    if (key === "path") return { group: 6, shape: "path", entry };
    if (key === "strokeColor") return { group: 6, shape: "color", entry };
    return MASK_SCALAR_KEYS.includes(key) ? { group: 6, shape: "scalar", range: numberRange(MASK_PARAM_SHAPE[key]), entry } : null;
  }
  if (parts[0] === "retouch" && parts[1] === "faces" && PICTURE.includes(type)) {
    const face = faceSettingsSchema.shape as z.ZodRawShape;
    const entry = { collection: "faces" as const, id: parts[2], key: parts.slice(3).join(".") };
    if (parts.length === 4 && (FACE_KEYS as readonly string[]).includes(parts[3])) return { group: 9, shape: "scalar", range: numberRange(face[parts[3]]), entry };
    if (parts.length === 5 && parts[3] === "reshape" && (RESHAPE_KEYS as readonly string[]).includes(parts[4])) return { group: 9, shape: "scalar", range: { min: -100, max: 100 }, entry };
  }
  return null;
}
