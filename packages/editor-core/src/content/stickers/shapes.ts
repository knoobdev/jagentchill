import { createElement, GRAPHIC_PARAM_KEYS, graphicParamSchema, type GraphicDefinitionId, type GraphicParamKey, type ProjectDocument } from "@jagentchill/protocol";
import type { Json } from "../../model.ts";
import { edit, editable, elementIn, reject, type Commit, type CommitContext } from "../../ops/shared.ts";
import { snapToFrame } from "../../time.ts";
import type { TimelineCommand } from "../../timeline/command.ts";
import { fpsOf, sceneById, type El } from "../../timeline/model.ts";
import { FACTORY_INSERT_DEFAULTS, placeElements } from "../../timeline/placement.ts";

/** `stickers-shapes`: the `shapes` provider — six items, one per shape definition of a graphic element (a drawing is not a shape item). */
export type ShapeItem = { id: Exclude<GraphicDefinitionId, "drawing">; name: string; keywords: string[] };
export const SHAPE_ITEMS: readonly ShapeItem[] = [
  { id: "rectangle", name: "Rectangle", keywords: ["square", "box", "rect"] }, { id: "ellipse", name: "Ellipse", keywords: ["circle", "oval", "round"] },
  { id: "polygon", name: "Polygon", keywords: ["triangle", "hexagon", "pentagon", "diamond"] }, { id: "star", name: "Star", keywords: ["favourite", "rating"] },
  { id: "line", name: "Line", keywords: ["stroke", "divider", "rule"] }, { id: "arrow", name: "Arrow", keywords: ["pointer", "direction"] },
];
/** The classic shape ids still resolve to a definition and the parameters that make the same shape. */
const LEGACY: Record<string, { definitionId: ShapeItem["id"]; params?: Record<string, number> }> = {
  square: { definitionId: "rectangle" }, circle: { definitionId: "ellipse" }, triangle: { definitionId: "polygon", params: { sides: 3 } },
  hexagon: { definitionId: "polygon", params: { sides: 6 } }, diamond: { definitionId: "polygon", params: { sides: 4 } }, star: { definitionId: "star" },
};
export function resolveShapeId(id: string): { definitionId: ShapeItem["id"]; params: Record<string, number> } | null {
  const name = id.replace(/^shapes:/, "");
  const item = SHAPE_ITEMS.find((entry) => entry.id === name);
  if (item) return { definitionId: item.id, params: {} };
  return LEGACY[name] ? { definitionId: LEGACY[name].definitionId, params: LEGACY[name].params ?? {} } : null;
}
export function searchShapes(query: string): ShapeItem[] {
  const needle = query.trim().toLowerCase();
  return needle === "" ? [...SHAPE_ITEMS] : SHAPE_ITEMS.filter((item) => item.name.toLowerCase().includes(needle) || item.keywords.some((keyword) => keyword.includes(needle)));
}
/** The initial scale of a sticker or shape: its longer side is 25 % of the canvas's shorter side. */
export const initialStickerScale = (intrinsic: { width: number; height: number }, canvas: { width: number; height: number }): number =>
  Math.round(((0.25 * Math.min(canvas.width, canvas.height)) / Math.max(intrinsic.width, intrinsic.height)) * 1000) / 1000;

/** Adds a shape item as a graphic element at a time (and, for a drop on the canvas, at a canvas point), selected, one step. */
export function addShapeItem(options: { sceneId: string; shapeId: string; time: number; duration?: number; position?: { x: number; y: number } }): TimelineCommand<{ elementId: string }> {
  return {
    type: "shape.add", label: "Add shape", sceneId: options.sceneId,
    run(draft, env) {
      const resolved = resolveShapeId(options.shapeId);
      if (!resolved) return reject("document/unknown-definition", "", `"${options.shapeId}" is not a shape`);
      const fps = fpsOf(draft), scale = initialStickerScale({ width: 200, height: 200 }, draft.settings.canvasSize);
      const item = SHAPE_ITEMS.find((entry) => entry.id === resolved.definitionId)!;
      const element = createElement("graphic", {
        id: env.newId(), name: item.name, startTime: snapToFrame(Math.max(0, options.time), fps), duration: snapToFrame(options.duration ?? FACTORY_INSERT_DEFAULTS.stickerDuration, fps), definitionId: resolved.definitionId, params: resolved.params,
        transform: { position: options.position ?? { x: 0, y: 0 }, scale: { x: scale, y: scale }, rotation: 0 },
      }) as unknown as El;
      placeElements(sceneById(draft, options.sceneId), [element], { strategy: "firstAvailable" }, env);
      return { selection: [element.id], info: { elementId: element.id } };
    },
  };
}

/** A parameter value as the definition stores it: numbers clamped to the row's range and rounded to its step of 1. */
export function coerceShapeParam(definitionId: GraphicDefinitionId, key: GraphicParamKey, value: unknown): unknown {
  if (!GRAPHIC_PARAM_KEYS[definitionId].includes(key)) return reject("document/field-not-allowed", "", `a ${definitionId} has no "${key}"`);
  const schema = graphicParamSchema(definitionId, key);
  if (typeof value !== "number") return schema.parse(value);
  // The range comes from the schema of the row: the nearest value inside it is kept.
  const rounded = Math.round(value);
  if (schema.safeParse(rounded).success) return rounded;
  const limits: Record<string, [number, number]> = { strokeWidth: definitionId === "line" ? [1, 64] : [0, 64], cornerRadius: [0, 50], sides: [3, 12], points: [3, 12], depth: [1, 99], dash: [0, 200], headSize: [10, 90], shaftWidth: [5, 90] };
  const [min, max] = limits[key] ?? [rounded, rounded];
  return Math.min(max, Math.max(min, rounded));
}
/** Writes parameters of graphic elements as one step. */
export function setShapeParams(doc: ProjectDocument, ctx: CommitContext, elementIds: string[], params: Partial<Record<GraphicParamKey, unknown>>): Commit {
  return edit(doc, ctx, { commandType: "shape.params", label: "Shape" }, (draft) => {
    for (const id of elementIds) {
      const element = editable(elementIn(draft, id));
      if (element.type !== "graphic") continue;
      const next = { ...(element.params as Json) };
      for (const [key, value] of Object.entries(params)) if (GRAPHIC_PARAM_KEYS[element.definitionId as GraphicDefinitionId].includes(key as GraphicParamKey)) next[key] = coerceShapeParam(element.definitionId as GraphicDefinitionId, key as GraphicParamKey, value);
      element.params = next;
    }
  });
}

/** The outline of a shape on a 100 × 100 box as SVG path data, for tiles that draw the definition itself. */
export function shapeOutline(definitionId: string, params: { sides?: number; points?: number; depth?: number; cornerRadius?: number } = {}): string {
  const ring = (count: number, radius: (index: number) => number) => Array.from({ length: count }, (_, index) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / count, r = radius(index);
    return `${index === 0 ? "M" : "L"}${(50 + r * Math.cos(angle)).toFixed(2)} ${(50 + r * Math.sin(angle)).toFixed(2)}`;
  }).join(" ") + " Z";
  if (definitionId === "ellipse") return "M50 4 A46 46 0 1 1 49.99 4 Z";
  if (definitionId === "polygon") return ring(Math.min(12, Math.max(3, params.sides ?? 5)), () => 46);
  if (definitionId === "star") { const points = Math.min(12, Math.max(3, params.points ?? 5)), inner = (46 * (params.depth ?? 45)) / 100; return ring(points * 2, (index) => (index % 2 === 0 ? 46 : inner)); }
  if (definitionId === "line") return "M6 50 H94";
  if (definitionId === "arrow") return "M4 35 H60 V15 L96 50 L60 85 V65 H4 Z";
  const radius = ((params.cornerRadius ?? 0) / 50) * 46;
  return radius > 0 ? `M${4 + radius} 4 H${96 - radius} A${radius} ${radius} 0 0 1 96 ${4 + radius} V${96 - radius} A${radius} ${radius} 0 0 1 ${96 - radius} 96 H${4 + radius} A${radius} ${radius} 0 0 1 4 ${96 - radius} V${4 + radius} A${radius} ${radius} 0 0 1 ${4 + radius} 4 Z` : "M4 4 H96 V96 H4 Z";
}
