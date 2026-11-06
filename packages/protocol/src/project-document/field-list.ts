import { z } from "zod";
import {
  CHANNEL_SCHEMAS, pathKeySchema, pathPointSchema, scalarKeySchema,
} from "./animation.ts";
import {
  adjustmentsSchema, aiMotionSchema, AUDIO_SHAPE, autoReframeSchema, backgroundSchema, chromaKeySchema, clipAnimationSchema, clipAnimationSlotSchema,
  cropSchema, cutoutSchema, deflickerSchema, effectsSchema, eyeContactSchema, faceSettingsSchema, flipSchema, freezeSchema, MASK_PARAM_SHAPE, masksSchema,
  motionBlurSchema, processedSourceSchema, relightSchema, retimeSchema, retouchSchema, stabilizationSchema, trackingSchema, transformSchema,
} from "./element-fields.ts";
import { COMMON_SHAPE, ELEMENT_SHAPES, ELEMENT_TYPES, GRAPHIC_PARAM_SHAPE, strokeSchema } from "./elements.ts";
import { oneOf, unwrap, type SchemaTag } from "./kit.ts";
import {
  assetRecordSchema, captionTrackSchema, coverSchema, exportSettingsSchema, localAssetSchema, localSchema, lutRecordSchema, mediaSectionSchema,
  multicamSchema, provenanceSchema, ROOT_SHAPE, sceneSchema, settingsSchema, templateSchema, TRACK_SHAPE, transitionRecordSchema,
} from "./structure.ts";
import { TEXT_STYLE_SHAPE } from "./text-style.ts";

/** One stored field as the schemas define it; the CI test compares these rows with the tables of `catalog.md`. */
export type FieldRow = {
  section: string;
  key: string;
  /** Catalogue-style type: a value type, `boolean`, `integer`, `number`, `string`, a literal union, `array`, `map`, `object`, `union`. */
  type: string;
  nullable: boolean;
  /** Numeric range, string length (strings and `Text`) or entry count (arrays). */
  min?: number;
  max?: number;
  presence: "required" | "absent" | "default";
  /** The default as written in the schema (`{}` for "the members' own defaults"). */
  default?: unknown;
  /** The value a reader ends up with: the default with every member default filled in. */
  resolvedDefault?: unknown;
  /** Member keys of an object row, or of the entries of an array or map row. */
  members?: string[];
};

type Shape = z.ZodRawShape;
const typeName = (schema: z.ZodTypeAny): string => (schema._def as { typeName: string }).typeName;
const shapeOf = (schema: z.ZodTypeAny): Shape | undefined => {
  const { inner, tags } = unwrap(schema);
  if (tags.variants) return mergedVariantShape(tags);
  return typeName(inner) === "ZodObject" ? (inner as z.ZodObject<Shape>).shape : undefined;
};

/** The keys of every member of a keyed union, each with the first schema that declares it; the key itself becomes the union of member names. */
function mergedVariantShape(tags: SchemaTag): Shape {
  const merged: Record<string, z.ZodTypeAny> = {};
  const names = Object.keys(tags.variants!) as [string, ...string[]];
  for (const member of Object.values(tags.variants!)) {
    for (const [key, schema] of Object.entries(shapeOf(member) ?? {})) if (!(key in merged)) merged[key] = schema;
  }
  const discriminator = oneOf(...names);
  merged[tags.variantKey!] = tags.defaultVariant ? discriminator.default(tags.defaultVariant) : discriminator;
  return merged;
}

type Described = Pick<FieldRow, "type" | "min" | "max" | "members">;
function describe(schema: z.ZodTypeAny): Described {
  const { inner, tags } = unwrap(schema);
  if (tags.variants) return { type: "union", members: Object.keys(mergedVariantShape(tags)) };
  if (tags.kind === "Text") return { type: `Text(${tags.max})`, min: tags.min, max: tags.max };
  if (tags.kind === "Ticks") return { type: "Ticks", min: tags.min, max: tags.max };
  const def = inner._def as { checks?: { kind: string; value?: number }[]; values?: string[]; value?: unknown; options?: z.ZodTypeAny[]; type?: z.ZodTypeAny; valueType?: z.ZodTypeAny; minLength?: { value: number } | null; maxLength?: { value: number } | null };
  const check = (kind: string) => def.checks?.find((entry) => entry.kind === kind)?.value;
  switch (typeName(inner)) {
    case "ZodBoolean": return { type: "boolean" };
    case "ZodNumber": return { type: tags.kind ?? (def.checks?.some((entry) => entry.kind === "int") ? "integer" : "number"), min: check("min"), max: check("max") };
    case "ZodString": return { type: tags.kind ?? "string", min: check("min"), max: check("max") };
    case "ZodEnum": return { type: def.values!.map((value) => JSON.stringify(value)).join(" | ") };
    case "ZodLiteral": return { type: JSON.stringify(def.value) };
    case "ZodNull": return { type: "null" };
    case "ZodUnion": return { type: def.options!.map((option) => describe(option).type).join(" | ") };
    case "ZodArray": {
      const item = describe(def.type!);
      return { type: `array of ${item.type}`, min: def.minLength?.value, max: def.maxLength?.value, members: item.members };
    }
    case "ZodRecord": return { type: "map", members: describe(def.valueType!).members };
    case "ZodObject": return { type: tags.kind ?? "object", members: Object.keys((inner as z.ZodObject<Shape>).shape) };
    case "ZodTuple": return { type: "tuple" };
    case "ZodEffects": return { type: tags.kind ?? "custom" };
    default: return { type: tags.kind ?? typeName(inner).replace(/^Zod/, "").toLowerCase() };
  }
}

function rowOf(section: string, key: string, schema: z.ZodTypeAny): FieldRow {
  const { inner, optional, nullable, hasDefault, defaultValue } = unwrap(schema);
  const parsed = hasDefault ? inner.safeParse(defaultValue) : undefined;
  const presence = hasDefault ? "default" : optional ? "absent" : "required";
  return { section, key, ...describe(schema), nullable, presence, ...(hasDefault ? { default: defaultValue, resolvedDefault: parsed?.success ? parsed.data : defaultValue } : {}) };
}

/**
 * Lists the fields of a shape the way the catalogue lays them out: an object is expanded into dotted keys, an array
 * or a structure tagged `row` is one row, and one tagged `both` is a row followed by its members.
 */
function walk(section: string, prefix: string, shape: Shape, out: FieldRow[], rows: readonly string[] = []): void {
  for (const [key, schema] of Object.entries(shape)) {
    const { inner, tags } = unwrap(schema);
    if (rows.includes(key)) { out.push(rowOf(section, prefix + key, schema)); continue; }
    const members = shapeOf(schema);
    const item = typeName(inner) === "ZodArray" ? shapeOf((inner._def as { type: z.ZodTypeAny }).type) : undefined;
    if (members && tags.list !== "row") {
      if (tags.list === "both") out.push(rowOf(section, prefix + key, schema));
      walk(section, `${prefix}${key}.`, members, out);
    } else {
      out.push(rowOf(section, prefix + key, schema));
      if (item && tags.list === "both") walk(section, `${prefix}${key}[].`, item, out);
    }
  }
}

/** `rows` names keys the section lists as one row because another section lists their members. */
export type CatalogSection = { section: string; roots: { prefix: string; shape: Shape; rows?: readonly string[] }[] };
const shape = (schema: z.ZodTypeAny): Shape => shapeOf(schema)!;
const without = (source: Shape, ...keys: string[]): Shape => Object.fromEntries(Object.entries(source).filter(([key]) => !keys.includes(key)));
const only = (source: Shape, ...keys: string[]): Shape => Object.fromEntries(keys.map((key) => [key, source[key]]));
const { video, audio, caption, sticker, graphic, compound, effect } = ELEMENT_SHAPES;
const mask = shape((unwrap(masksSchema).inner._def as { type: z.ZodTypeAny }).type);

/** Which schemas make up each numbered section of `catalog.md` (§2–§12 and §16), and the key prefix the section writes. */
export const CATALOG_SECTIONS: CatalogSection[] = [
  { section: "2", roots: [{ prefix: "", shape: ROOT_SHAPE }] },
  { section: "3.1", roots: [{ prefix: "settings.", shape: shape(settingsSchema) }] },
  { section: "3.2", roots: [{ prefix: "", shape: shape(backgroundSchema) }] },
  { section: "3.3", roots: [{ prefix: "cover.", shape: shape(coverSchema) }] },
  { section: "3.4", roots: [{ prefix: "template.", shape: shape(templateSchema) }] },
  { section: "3.5", roots: [{ prefix: "exportSettings.", shape: shape(exportSettingsSchema) }] },
  { section: "4", roots: [{ prefix: "", shape: shape(sceneSchema) }] },
  { section: "4.1", roots: [{ prefix: "multicam.", shape: shape(multicamSchema) }] },
  { section: "5", roots: [{ prefix: "", shape: TRACK_SHAPE, rows: ["transitions", "caption"] }] },
  { section: "5.1", roots: [{ prefix: "", shape: shape(transitionRecordSchema) }] },
  { section: "5.2", roots: [{ prefix: "caption.", shape: shape(captionTrackSchema) }] },
  { section: "6", roots: [{ prefix: "", shape: { ...COMMON_SHAPE, type: oneOf(...ELEMENT_TYPES), ...only(video, "sourceDuration", "hidden", "transitionIn", "transitionOut") } }] },
  { section: "7.1", roots: [{ prefix: "", shape: { transform: transformSchema, opacity: video.opacity, blendMode: video.blendMode, crop: cropSchema, flip: flipSchema } }] },
  { section: "7.2", roots: [{ prefix: "", shape: { motionBlur: motionBlurSchema, clipAnimation: clipAnimationSchema } }, { prefix: "ClipAnimationSlot.", shape: shape(clipAnimationSlotSchema) }] },
  { section: "7.3", roots: [{ prefix: "", shape: { effects: effectsSchema } }] },
  { section: "7.4", roots: [{ prefix: "", shape: only(video, "background") }] },
  { section: "7.5", roots: [{ prefix: "", shape: { masks: masksSchema } }, { prefix: "masks[].params.", shape: MASK_PARAM_SHAPE }, { prefix: "PathPoint.", shape: shape(pathPointSchema) }] },
  { section: "7.6", roots: [{ prefix: "", shape: { chromaKey: chromaKeySchema, cutout: cutoutSchema } }] },
  {
    section: "7.7", roots: [
      { prefix: "", shape: { stabilization: stabilizationSchema, deflicker: deflickerSchema, eyeContact: eyeContactSchema, relight: relightSchema, retouch: retouchSchema, aiMotion: aiMotionSchema, autoReframe: autoReframeSchema, processedSource: processedSourceSchema } },
      { prefix: "FaceSettings.", shape: shape(faceSettingsSchema) },
    ],
  },
  { section: "7.8", roots: [{ prefix: "tracking.", shape: shape(trackingSchema(true)) }] },
  { section: "7.9", roots: [{ prefix: "adjustments.", shape: shape(adjustmentsSchema) }] },
  { section: "8", roots: [{ prefix: "", shape: { retime: retimeSchema, freeze: freezeSchema } }] },
  { section: "9", roots: [{ prefix: "", shape: { ...AUDIO_SHAPE, isSourceAudioEnabled: video.isSourceAudioEnabled } }] },
  { section: "10.2", roots: [{ prefix: "", shape: { mediaId: video.mediaId, sceneId: compound.sceneId, multicam: compound.multicam, target: effect.target } }] },
  { section: "10.3", roots: [{ prefix: "", shape: only(audio, "sourceType", "mediaId", "sourceUrl") }] },
  { section: "10.4", roots: [{ prefix: "", shape: { content: ELEMENT_SHAPES.text.content, ...TEXT_STYLE_SHAPE } }] },
  { section: "10.5", roots: [{ prefix: "", shape: only(caption, "text", "words", "translation", "speaker", "edited", "style", "transform") }] },
  { section: "10.6", roots: [{ prefix: "", shape: only(sticker, "stickerId", "intrinsicWidth", "intrinsicHeight", "loop", "playbackSpeed") }] },
  { section: "10.7", roots: [{ prefix: "", shape: only(graphic, "definitionId", "params", "intrinsicWidth", "intrinsicHeight", "strokes"), rows: ["strokes"] }] },
  { section: "10.8", roots: [{ prefix: "params.", shape: GRAPHIC_PARAM_SHAPE }] },
  { section: "10.9", roots: [{ prefix: "strokes[].", shape: shape(strokeSchema) }] },
  {
    section: "11.1", roots: [
      { prefix: "ScalarChannel.", shape: shape(CHANNEL_SCHEMAS.scalar) }, { prefix: "ScalarKey.", shape: shape(scalarKeySchema) },
      { prefix: "DiscreteChannel.", shape: shape(CHANNEL_SCHEMAS.discrete) }, { prefix: "ColorChannel.", shape: shape(CHANNEL_SCHEMAS.color) },
      { prefix: "PathChannel.", shape: shape(CHANNEL_SCHEMAS.path) }, { prefix: "PathKey.", shape: shape(pathKeySchema) },
    ],
  },
  { section: "12.1", roots: [{ prefix: "media.", shape: shape(mediaSectionSchema) }] },
  { section: "12.2", roots: [{ prefix: "", shape: shape(assetRecordSchema) }] },
  { section: "12.4", roots: [{ prefix: "media.luts[].", shape: shape(lutRecordSchema) }] },
  { section: "12.5", roots: [{ prefix: "provenance.", shape: shape(provenanceSchema) }] },
  { section: "16", roots: [{ prefix: "local.", shape: shape(localSchema) }, { prefix: "LocalAsset.", shape: shape(localAssetSchema) }] },
];
// The mask entry lists its own keys; its `params` keys are the rows of MASK_PARAM_SHAPE, listed once for every type.
CATALOG_SECTIONS.find((entry) => entry.section === "7.5")!.roots.push({ prefix: "masks[].", shape: without(mask, "params") });

/** The field list of the document, generated from the Zod schemas. */
export function generateFieldList(sections: CatalogSection[] = CATALOG_SECTIONS): FieldRow[] {
  const out: FieldRow[] = [];
  for (const { section, roots } of sections) for (const root of roots) walk(section, root.prefix, root.shape, out, root.rows);
  const seen = new Set<string>();
  return out.filter((entry) => { const id = `${entry.section}|${entry.key}`; if (seen.has(id)) return false; seen.add(id); return true; });
}

/**
 * Keys of a document that no schema declares, as id-free dotted paths. An unknown key is carried unchanged; the editor
 * shows "Some content was made with a newer app version and is kept unchanged" while this list is not empty.
 */
export function findUnknownFields(value: unknown, schema: z.ZodTypeAny, path = "", out: string[] = []): string[] {
  const { inner, tags } = unwrap(schema);
  if (value === null || typeof value !== "object") return out;
  if (tags.variants) {
    const name = (value as Record<string, unknown>)[tags.variantKey!] ?? tags.defaultVariant;
    const member = typeof name === "string" ? tags.variants[name] : undefined;
    if (!member) out.push(`${path}${path ? "." : ""}${tags.variantKey}=${String(name)}`);
    else findUnknownFields(value, member, path, out);
    return out;
  }
  const def = inner._def as { type?: z.ZodTypeAny; valueType?: z.ZodTypeAny };
  if (Array.isArray(value)) {
    if (typeName(inner) === "ZodArray") value.forEach((entry, index) => findUnknownFields(entry, def.type!, `${path}[${index}]`, out));
    return out;
  }
  if (typeName(inner) === "ZodRecord") {
    for (const [key, entry] of Object.entries(value)) findUnknownFields(entry, def.valueType!, `${path}.${key}`, out);
  } else if (typeName(inner) === "ZodObject") {
    const members = (inner as z.ZodObject<Shape>).shape;
    for (const [key, entry] of Object.entries(value)) {
      const next = path ? `${path}.${key}` : key;
      if (!(key in members)) { if (!(tags.forbid ?? []).includes(key)) out.push(next); }
      else findUnknownFields(entry, members[key], next, out);
    }
  }
  return out;
}
