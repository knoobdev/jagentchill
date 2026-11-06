import { z } from "zod";
import type { ProjectDocument } from "@jagentchill/protocol";
import { allElements } from "../model.ts";

/**
 * A project template: a manifest (what the gallery lists and what a project created from it copies into its `template`
 * object) and a snapshot (a single-scene project document whose slot elements have no media).
 */
export const TEMPLATE_PACKAGE_VERSION = 1;
export const TEMPLATE_CATEGORIES = ["Vlog", "Promo", "Slideshow", "Intro and outro", "Social short", "Quote", "Other"] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];
export const TEMPLATE_RATIOS = ["9:16", "16:9", "1:1", "4:5"] as const;
export type TemplateRatio = (typeof TEMPLATE_RATIOS)[number];
export const TEMPLATE_LIMITS = { name: 80, tags: 20, tag: 40, themeColors: 6, label: 80, textMax: 500, previewSeconds: 60, previewLongSide: 720, previewBytes: 12 * 1024 * 1024, embeddedBytes: 2 * 1024 ** 3 } as const;

const id = z.string().min(1).max(200);
const ticks = z.number().int().nonnegative();
const color = z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/);
const label = z.string().max(TEMPLATE_LIMITS.label);
/** A package of an earlier build names the element `elementRef`; it is read as `elementId` and never written. */
const renamed = (value: unknown): unknown => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  const { elementRef, ...rest } = value as Record<string, unknown>;
  return elementRef !== undefined && rest.elementId === undefined ? { ...rest, elementId: elementRef } : rest;
};
const entry = <T extends z.ZodRawShape>(shape: T) => z.preprocess(renamed, z.object(shape).strict());

export const mediaSlotSchema = entry({ slotId: id, elementId: id, index: z.number().int().min(1).max(200), accepts: z.enum(["video", "image", "any"]), duration: ticks, required: z.boolean(), label });
export const templateVariableSchema = entry({
  id, label, type: z.enum(["text", "color", "image", "number"]),
  defaultValue: z.union([z.string().max(10_000), color, id, z.number().finite(), z.null()]), maxLength: z.number().int().min(1).max(10_000).optional(),
  bindings: z.array(entry({ elementId: id, field: z.string().min(1).max(200) })).max(500),
});
export const templateManifestSchema = z.object({
  id,
  name: z.string().trim().min(1).max(TEMPLATE_LIMITS.name),
  category: z.enum(TEMPLATE_CATEGORIES),
  tags: z.array(z.string().min(1).max(TEMPLATE_LIMITS.tag)).max(TEMPLATE_LIMITS.tags),
  canvas: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
  frameRate: z.object({ numerator: z.number().int().positive(), denominator: z.number().int().positive() }),
  duration: ticks,
  slots: z.array(mediaSlotSchema).max(200),
  editableTexts: z.array(entry({ elementId: id, label, maxLength: z.number().int().min(1).max(10_000) })).max(200),
  audioSlots: z.array(entry({ elementId: id, label, replaceable: z.boolean() })).max(50),
  themeColors: z.array(color).max(TEMPLATE_LIMITS.themeColors),
  colorBindings: z.array(entry({ colorIndex: z.number().int().min(0).max(5), elementId: id, field: z.string().min(1).max(200) })).max(500),
  variables: z.array(templateVariableSchema).max(200).default([]),
  thumbnail: z.string().max(200).nullable(),
  preview: z.string().max(200).nullable(),
  author: z.string().max(200),
  license: z.string().max(200),
  sources: z.array(z.object({ file: z.string().max(400), author: z.string().max(200), license: z.string().max(200) })).max(5000),
  schemaVersion: z.number().int().min(1),
  packageVersion: z.literal(TEMPLATE_PACKAGE_VERSION),
  created_ms: z.number().int().nonnegative(),
  appVersionMin: z.string().max(40),
});
export type TemplateManifest = z.infer<typeof templateManifestSchema>;
export type MediaSlot = TemplateManifest["slots"][number];

export class TemplateInvalid extends Error {
  reason: string;
  constructor(reason: string) { super(reason); this.name = "TemplateInvalid"; this.reason = reason; }
}

/** The manifest as this build stores it, or `TemplateInvalid` naming the first field that is wrong. */
export function readTemplateManifest(value: unknown): TemplateManifest {
  const parsed = templateManifestSchema.safeParse(value);
  if (!parsed.success) { const issue = parsed.error.issues[0]; throw new TemplateInvalid(`manifest.${issue.path.join(".") || "json"}: ${issue.message}`); }
  return parsed.data;
}

/**
 * What ties a manifest to its snapshot: unique slot ids, indexes 1…n in order, and every named element present in the
 * snapshot with the type its list asks for. An empty list is a template that can be listed and used.
 */
export function templateProblems(manifest: TemplateManifest, snapshot: ProjectDocument): string[] {
  const problems: string[] = [];
  const types = new Map([...allElements(snapshot)].map((ref) => [ref.element.id, ref.element.type as string]));
  if (new Set(manifest.slots.map((slot) => slot.slotId)).size !== manifest.slots.length) problems.push("slot ids repeat");
  manifest.slots.forEach((slot, position) => {
    if (slot.index !== position + 1) problems.push(`slot ${slot.slotId} has index ${slot.index}, expected ${position + 1}`);
    const type = types.get(slot.elementId);
    if (type !== "video" && type !== "image") problems.push(`slot ${slot.slotId} names no video or image element`);
  });
  for (const text of manifest.editableTexts) if (types.get(text.elementId) !== "text") problems.push(`editable text ${text.elementId} names no text element`);
  for (const audio of manifest.audioSlots) if (types.get(audio.elementId) !== "audio") problems.push(`audio slot ${audio.elementId} names no audio element`);
  for (const binding of manifest.colorBindings) {
    if (!types.has(binding.elementId)) problems.push(`colour binding names no element (${binding.elementId})`);
    if (binding.colorIndex >= manifest.themeColors.length) problems.push(`colour binding ${binding.colorIndex} has no theme colour`);
  }
  return problems;
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
/** "9:16" for 1080×1920: the ratio a card shows and the ratio filter matches. */
export function ratioLabel(canvas: { width: number; height: number }): string {
  const divisor = gcd(canvas.width, canvas.height) || 1;
  return `${canvas.width / divisor}:${canvas.height / divisor}`;
}

export type TemplateFilter = { category: TemplateCategory | null; ratio: TemplateRatio | null; query: string };
export const NO_TEMPLATE_FILTER: TemplateFilter = { category: null, ratio: null, query: "" };
/** The templates a gallery lists: by category, by aspect ratio, and by a case-insensitive part of the name or of a tag. */
export function filterTemplates<T extends Pick<TemplateManifest, "name" | "tags" | "category" | "canvas">>(templates: readonly T[], filter: TemplateFilter): T[] {
  const needle = filter.query.trim().toLowerCase();
  return templates.filter((template) => (filter.category === null || template.category === filter.category)
    && (filter.ratio === null || ratioLabel(template.canvas) === filter.ratio)
    && (needle === "" || template.name.toLowerCase().includes(needle) || template.tags.some((tag) => tag.toLowerCase().includes(needle))));
}
