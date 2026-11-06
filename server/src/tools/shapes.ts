import { z } from "zod";
import { addDrawingAt, addShapeItem, addStickerItem, drawingGeometry, frameTicks, parseStickerId, setElementFields, setShapeParams, SHAPE_ITEMS, simplifyStroke, snapToFrame, STICKER_PROVIDERS, timeline } from "@jagentchill/editor-core";
import { GRAPHIC_DEFINITIONS, GRAPHIC_PARAM_KEYS, graphicParamSchema, numberRange, type GraphicDefinitionId, type GraphicParamKey } from "@jagentchill/protocol";
import { SCENE, WRITE, assetIn, checkRange, clip, color, elementLabel, elementsIn, fail, id, ids, outOfRange, seconds, ticks, trackIn, unlocked, writeTool, type El, type ToolContext } from "./kit.ts";

const stroke = () => z.object({ points: z.array(z.tuple([z.number(), z.number()])).min(2).max(200_000), width: z.number(), color: color(), brush: z.enum(["pen", "marker"]) }).strict();
const paramValue = () => z.union([z.number(), z.boolean(), z.string().max(40)]);
/** Checks graphic params against the keys and ranges of the shape's definition. */
function checkParams(definition: GraphicDefinitionId, params: Record<string, unknown> | undefined): void {
  for (const [key, value] of Object.entries(params ?? {})) {
    if (!GRAPHIC_PARAM_KEYS[definition].includes(key as GraphicParamKey)) fail("INVALID_PARAMS", `A ${definition} has no "${key}". Its parameters are: ${GRAPHIC_PARAM_KEYS[definition].join(", ")}.`, { field: `params.${key}`, allowed: GRAPHIC_PARAM_KEYS[definition] });
    const schema = graphicParamSchema(definition, key as GraphicParamKey), range = numberRange(schema);
    if (typeof value === "number" && range) checkRange(`params.${key}`, value, range.min, range.max);
    const parsed = schema.safeParse(value);
    if (!parsed.success) { const issue = parsed.error.issues[0]; fail("INVALID_PARAMS", `params.${key}: ${issue.code === "invalid_enum_value" ? `must be one of ${issue.options.join(", ")}` : issue.message}.`, { field: `params.${key}`, ...(issue.code === "invalid_enum_value" ? { allowed: issue.options } : {}) }); }
  }
}
function checkStrokes(strokes: z.infer<ReturnType<typeof stroke>>[]): void {
  if (strokes.reduce((sum, entry) => sum + entry.points.length, 0) > 200_000) outOfRange("strokes", 1, 200_000, strokes.reduce((sum, entry) => sum + entry.points.length, 0), "points in all strokes together");
  strokes.forEach((entry, index) => checkRange(`strokes.${index}.width`, entry.width, 1, 200));
}
function placeAfter(ctx: ToolContext, elementId: string, trackId: string | undefined, fields: Record<string, unknown>): void {
  const placed = timeline.located(ctx.doc, elementId);
  if (trackId && placed.track.id !== trackId) {
    const target = trackIn(ctx, trackId);
    unlocked(target.track);
    if (!timeline.canHold(target.track, placed.element.type)) fail("TRACK_KIND_MISMATCH", `The track "${target.track.name}" is a ${target.track.type} track; stickers and shapes go on a graphic track.`, { trackId, trackType: target.track.type });
    if (!timeline.isFree(target.track, placed.element.startTime, placed.element.startTime + placed.element.duration)) fail("OVERLAP_NOT_ALLOWED", `The range is occupied on the track "${target.track.name}". Choose another time, or leave trackId out.`, { trackId });
    ctx.run(timeline.move({ sceneId: placed.scene.id, elementIds: [elementId], time: placed.element.startTime, target: { kind: "track", trackId } }));
  }
  if (Object.keys(fields).length > 0) ctx.apply((doc, c) => setElementFields(doc, c, elementId, fields, { commandType: "element.update", label: "Edit" }));
}
const timing = (ctx: ToolContext, duration: number | undefined): void => { const frame = frameTicks(ctx.doc.settings.fps); if (duration !== undefined && duration < frame) outOfRange("duration", frame, 2_592_000_000, duration, "at least one frame"); };
const graphic = (ctx: ToolContext, elementIds: string[], type: "graphic" | "sticker") => {
  const found = elementsIn(ctx, elementIds);
  for (const hit of found.hits) { unlocked(hit.track); if (hit.element.type !== type) fail("UNSUPPORTED_FOR_ELEMENT", `${elementLabel(hit.element)} is not a ${type === "graphic" ? "shape" : "sticker"}.`, { elementId: hit.element.id }); }
  return found;
};

export const SHAPE_TOOLS = [
  writeTool({
    name: "jc_sticker_add", family: "sticker",
    description: "Add a sticker to an overlay track: a sticker id of the form provider:value (for example emoji:1f600 or flags:jp), or an image asset of the project (assetId) used as a sticker. start and duration place it; position (canvas pixels from the centre) and scale are optional.",
    shape: { stickerId: z.string().min(3).max(200).optional(), assetId: id().optional(), start: ticks(), duration: ticks().optional(), position: z.object({ x: z.number(), y: z.number() }).strict().optional(), scale: z.number().optional(), trackId: id().optional(), loop: z.boolean().optional(), playbackSpeed: z.number().optional(), ...SCENE, ...WRITE },
    refine(args) {
      if ((args.stickerId === undefined) === (args.assetId === undefined)) fail("INVALID_PARAMS", "Give either stickerId or assetId, exactly one.", { field: "stickerId" });
      checkRange("playbackSpeed", args.playbackSpeed, 0.1, 4); checkRange("scale", args.scale, 0.01, 100);
    },
    handle(ctx, args) {
      const scene = ctx.scene(args.sceneId);
      timing(ctx, args.duration);
      let stickerId = args.stickerId, size = { width: 512, height: 512 }, name = "Sticker";
      if (args.assetId) { const asset = assetIn(ctx, args.assetId); if (asset.type !== "image") fail("UNSUPPORTED_FOR_ELEMENT", `The asset "${asset.name}" is a ${asset.type}; a sticker is made from an image asset.`, { assetId: asset.id }); stickerId = `user:${asset.id}`; size = { width: asset.width ?? 512, height: asset.height ?? 512 }; name = asset.name; }
      const parsed = parseStickerId(stickerId!);
      if (!parsed || !(STICKER_PROVIDERS as readonly string[]).includes(parsed.provider)) fail("LIBRARY_ITEM_NOT_FOUND", `"${stickerId}" is not a sticker id. A sticker id is provider:value with one of the providers ${STICKER_PROVIDERS.join(", ")} (for example emoji:1f600).`, { field: "stickerId", allowed: [...STICKER_PROVIDERS] });
      const made = ctx.run(addStickerItem({ sceneId: scene.id, stickerId: stickerId!, name, width: size.width, height: size.height, time: args.start, ...(args.position ? { position: args.position } : {}) }));
      const element = timeline.located(ctx.doc, made.elementId).element, fields: Record<string, unknown> = {};
      if (args.duration !== undefined) fields.duration = snapToFrame(args.duration, ctx.doc.settings.fps);
      if (args.scale !== undefined) fields.transform = { ...(element.transform as object), scale: { x: args.scale, y: args.scale } };
      if (args.loop !== undefined) fields.loop = args.loop;
      if (args.playbackSpeed !== undefined) fields.playbackSpeed = args.playbackSpeed;
      placeAfter(ctx, made.elementId, args.trackId, fields);
      const placed = timeline.located(ctx.doc, made.elementId);
      return { data: { elementId: made.elementId, trackId: placed.track.id, stickerId, start: placed.element.startTime, duration: placed.element.duration }, summary: `Added the sticker ${stickerId} at ${seconds(placed.element.startTime)}.`, change: { kind: "add", entity: "element", entityId: made.elementId, label: name } };
    },
  }),
  writeTool({
    name: "jc_sticker_update", family: "sticker",
    description: "Change stickers after creation: replace the sticker itself (stickerId), loop and playbackSpeed (0.1–4). Position, scale, rotation, opacity, effects and animation are set with the tools of those names.",
    shape: { elementIds: ids(), stickerId: z.string().min(3).max(200).optional(), loop: z.boolean().optional(), playbackSpeed: z.number().optional(), ...WRITE },
    refine(args) { checkRange("playbackSpeed", args.playbackSpeed, 0.1, 4); if (args.stickerId === undefined && args.loop === undefined && args.playbackSpeed === undefined) fail("INVALID_PARAMS", "Name what to change: stickerId, loop or playbackSpeed."); },
    handle(ctx, args) {
      const { hits } = graphic(ctx, args.elementIds, "sticker");
      if (args.stickerId) { const parsed = parseStickerId(args.stickerId); if (!parsed || !(STICKER_PROVIDERS as readonly string[]).includes(parsed.provider)) fail("LIBRARY_ITEM_NOT_FOUND", `"${args.stickerId}" is not a sticker id (provider:value, providers ${STICKER_PROVIDERS.join(", ")}).`, { field: "stickerId", allowed: [...STICKER_PROVIDERS] }); }
      const fields = { ...(args.stickerId ? { stickerId: args.stickerId } : {}), ...(args.loop !== undefined ? { loop: args.loop } : {}), ...(args.playbackSpeed !== undefined ? { playbackSpeed: args.playbackSpeed } : {}) };
      for (const hit of hits) ctx.apply((doc, c) => setElementFields(doc, c, hit.element.id, fields, { commandType: "sticker.update", label: "Sticker" }));
      const now = timeline.located(ctx.doc, args.elementIds[0]).element;
      return { data: { elementIds: args.elementIds, stickerId: now.stickerId, loop: now.loop, playbackSpeed: now.playbackSpeed, start: now.startTime, duration: now.duration, transform: now.transform }, summary: `Changed ${hits.length} sticker(s).`, change: { kind: "modify", entity: "element", entityId: hits[0].element.id, label: hits[0].element.name } };
    },
  }),
  writeTool({
    name: "jc_shape_add", family: "shape",
    description: "Add a shape to an overlay track: rectangle, ellipse, polygon, star, arrow, line, or drawing (a freehand drawing given as strokes[] in canvas pixels from the centre). A triangle is a polygon with params.sides: 3. params holds the keys of that shape (fill, stroke, strokeWidth 0–64, strokeAlign, cornerRadius, sides, points, depth, lineCap, dash, headSize, shaftWidth, doubleHeaded).",
    shape: { shape: z.string().min(1).max(40), start: ticks(), duration: ticks().optional(), params: z.record(paramValue()).optional(), strokes: z.array(stroke()).min(1).max(2000).optional(), size: z.object({ width: z.number(), height: z.number() }).strict().optional(), position: z.object({ x: z.number(), y: z.number() }).strict().optional(), trackId: id().optional(), ...SCENE, ...WRITE },
    handle(ctx, args) {
      const scene = ctx.scene(args.sceneId);
      if (!(GRAPHIC_DEFINITIONS as readonly string[]).includes(args.shape)) fail("LIBRARY_ITEM_NOT_FOUND", `"${args.shape}" is not a shape. The shapes are: ${GRAPHIC_DEFINITIONS.join(", ")}${args.shape === "triangle" ? "; a triangle is the polygon with params {sides: 3}" : ""}.`, { field: "shape", allowed: [...GRAPHIC_DEFINITIONS] });
      const definition = args.shape as GraphicDefinitionId;
      timing(ctx, args.duration);
      checkParams(definition, args.params);
      checkRange("size.width", args.size?.width, 2, 100_000); checkRange("size.height", args.size?.height, 2, 100_000);
      let elementId: string;
      const fields: Record<string, unknown> = {};
      if (definition === "drawing") {
        if (!args.strokes) fail("INVALID_PARAMS", "A drawing needs strokes[].", { field: "strokes" });
        checkStrokes(args.strokes!);
        elementId = ctx.run(addDrawingAt({ sceneId: scene.id, strokes: args.strokes! as never, time: args.start, ...(args.duration !== undefined ? { duration: args.duration } : {}) })).elementId;
        if (args.position) fields.transform = { ...(timeline.located(ctx.doc, elementId).element.transform as object), position: args.position };
      } else {
        if (args.strokes) fail("INVALID_PARAMS", "strokes belong to the shape \"drawing\".", { field: "strokes" });
        if (!SHAPE_ITEMS.some((item) => item.id === definition)) fail("LIBRARY_ITEM_NOT_FOUND", `"${args.shape}" is not a shape.`, { field: "shape" });
        elementId = ctx.run(addShapeItem({ sceneId: scene.id, shapeId: definition, time: args.start, ...(args.duration !== undefined ? { duration: args.duration } : {}), ...(args.position ? { position: args.position } : {}) })).elementId;
        // A shape is 200 × 200 px at scale 1.
        if (args.size) fields.transform = { ...(timeline.located(ctx.doc, elementId).element.transform as object), scale: { x: Math.round((args.size.width / 200) * 1e4) / 1e4, y: Math.round((args.size.height / 200) * 1e4) / 1e4 } };
      }
      placeAfter(ctx, elementId, args.trackId, fields);
      if (args.params && Object.keys(args.params).length > 0) ctx.apply((doc, c) => setShapeParams(doc, c, [elementId], args.params as never));
      const placed = timeline.located(ctx.doc, elementId);
      return { data: { elementId, trackId: placed.track.id, shape: definition, start: placed.element.startTime, duration: placed.element.duration, params: placed.element.params }, summary: `Added a ${definition === "polygon" && args.params?.sides === 3 ? "triangle" : definition} at ${seconds(placed.element.startTime)}.`, change: { kind: "add", entity: "element", entityId: elementId, label: placed.element.name } };
    },
  }),
  writeTool({
    name: "jc_shape_update", family: "shape",
    description: "Change shapes after creation: params (the keys of the shape's definition, as in jc_shape_add), or the strokes of a drawing (replaces the stroke list). Position, scale, rotation, opacity, effects, masks and animation are set with the tools of those names.",
    shape: { elementIds: ids(), params: z.record(paramValue()).optional(), strokes: z.array(stroke()).min(1).max(2000).optional(), ...WRITE },
    refine(args) { if (!args.params && !args.strokes) fail("INVALID_PARAMS", "Name what to change: params or strokes."); },
    handle(ctx, args) {
      const { hits } = graphic(ctx, args.elementIds, "graphic");
      for (const hit of hits) {
        checkParams(hit.element.definitionId as GraphicDefinitionId, args.params);
        if (args.strokes && hit.element.definitionId !== "drawing") fail("UNSUPPORTED_FOR_ELEMENT", `${elementLabel(hit.element)} is a ${hit.element.definitionId}, not a drawing: it has no strokes.`, { elementId: hit.element.id });
      }
      if (args.params && Object.keys(args.params).length > 0) ctx.apply((doc, c) => setShapeParams(doc, c, args.elementIds, args.params as never));
      if (args.strokes) {
        checkStrokes(args.strokes);
        for (const hit of hits) {
          const geometry = drawingGeometry(args.strokes.map((entry) => ({ ...entry, points: simplifyStroke(entry.points as [number, number][]) })) as never, ctx.commitContext().newId);
          ctx.apply((doc, c) => setElementFields(doc, c, hit.element.id, { strokes: geometry.strokes, intrinsicWidth: geometry.intrinsicWidth, intrinsicHeight: geometry.intrinsicHeight }, { commandType: "drawing.strokes", label: "Draw" }));
        }
      }
      const now = timeline.located(ctx.doc, args.elementIds[0]).element as El;
      return { data: { elementIds: args.elementIds, params: now.params, ...(args.strokes ? { strokeCount: (now.strokes as unknown[]).length } : {}) }, summary: `Changed ${hits.length} shape(s).`, change: { kind: "modify", entity: "element", entityId: hits[0].element.id, label: hits[0].element.name } };
    },
  }),
  writeTool({
    name: "jc_marker_edit", family: "marker",
    description: "Add, update or remove a timeline marker of a scene. add needs time and returns the new markerId; update and remove address the marker by markerId (never by time). A marker has a note (0–2,000 characters), a color (1–8 or #RRGGBB) and an optional duration. Two markers cannot be on the same frame; a scene holds at most 1,000.",
    shape: { action: z.enum(["add", "update", "remove"]), markerId: id().optional(), ...SCENE, time: ticks().optional(), note: z.string().max(2000).optional(), color: z.union([z.number().int(), color()]).optional(), duration: ticks().optional(), ...WRITE },
    refine(args) {
      if (args.action === "add" && args.time === undefined) fail("INVALID_PARAMS", "add needs time.", { field: "time" });
      if (args.action !== "add" && !args.markerId) fail("INVALID_PARAMS", `${args.action} needs markerId.`, { field: "markerId" });
      if (typeof args.color === "number") checkRange("color", args.color, 1, 8);
      if (typeof args.color === "string" && args.color.length !== 7) fail("INVALID_PARAMS", "A marker colour is a palette index 1–8 or #RRGGBB.", { field: "color" });
    },
    handle(ctx, args) {
      const scene = ctx.scene(args.sceneId), markers = scene.markers as { id: string; time: number; note?: string }[];
      const fields = { ...(args.note !== undefined ? { note: args.note } : {}), ...(args.color !== undefined ? { color: args.color } : {}), ...(args.duration !== undefined ? { duration: args.duration } : {}) };
      const taken = (time: number, except?: string) => markers.some((marker) => marker.id !== except && marker.time === snapToFrame(time, ctx.doc.settings.fps));
      if (args.action === "add") {
        if (markers.length >= 1000) fail("QUOTA_EXCEEDED", "This scene already holds 1,000 markers. Remove some first.", { limit: 1000 });
        if (taken(args.time!)) fail("INVALID_PARAMS", `A marker already exists on the frame at ${args.time} ticks. Update that marker, or choose another time.`, { field: "time", markerId: markers.find((marker) => marker.time === snapToFrame(args.time!, ctx.doc.settings.fps))?.id });
        const made = ctx.run(timeline.addMarkerAt({ sceneId: scene.id, time: args.time!, ...fields }));
        return { data: { markerId: made.markerId, time: made.time, ...fields }, summary: `Added a marker at ${seconds(made.time)}${args.note ? ` — "${clip(args.note, 60)}"` : ""}.`, change: { kind: "add", entity: "marker", entityId: made.markerId, label: args.note ?? "Marker" } };
      }
      const marker = markers.find((entry) => entry.id === args.markerId) ?? fail("NOT_FOUND", `No marker of this scene has the id "${args.markerId}". Markers are addressed by the markerId that add returned, never by time.`, { markerId: args.markerId });
      if (args.action === "remove") { ctx.run(timeline.deleteMarker({ sceneId: scene.id, markerId: marker.id })); return { data: { markerId: marker.id }, summary: `Removed the marker at ${seconds(marker.time)}.`, change: { kind: "remove", entity: "marker", entityId: marker.id, label: marker.note ?? "Marker" } }; }
      if (args.time === undefined && Object.keys(fields).length === 0) fail("INVALID_PARAMS", "Name what to change: time, note, color or duration.");
      if (args.time !== undefined && taken(args.time, marker.id)) fail("INVALID_PARAMS", `Another marker already is on the frame at ${args.time} ticks.`, { field: "time" });
      const made = ctx.run(timeline.updateMarker({ sceneId: scene.id, markerId: marker.id, ...(args.time !== undefined ? { time: args.time } : {}), ...fields }));
      return { data: { markerId: marker.id, time: made.time, ...fields }, summary: `Changed the marker at ${seconds(made.time)}.`, change: { kind: args.time !== undefined ? "move" : "modify", entity: "marker", entityId: marker.id, label: args.note ?? marker.note ?? "Marker" } };
    },
  }),
];
