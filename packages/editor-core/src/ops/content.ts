import { createElement, createTrack, type GraphicDefinitionId, type ProjectDocument, type Stroke, type Track } from "@jagentchill/protocol";
import { isObject, type Json } from "../model.ts";
import { roundStored } from "../canonical.ts";
import { writeKey } from "./animation.ts";
import { edit, editable, elementIn, sortElements, trackIn, type Commit, type CommitContext } from "./shared.ts";

type Placement = { startTime: number; duration: number; name?: string };

/** A default text element: every style field written at its default, no bubble, animation or tracking. */
export function addText(doc: ProjectDocument, ctx: CommitContext, trackId: string, at: Placement, fields: Record<string, unknown> = {}): Commit {
  return edit(doc, ctx, { commandType: "text.add", label: "Add text" }, (draft) => {
    const { track } = trackIn(draft, trackId);
    (track.elements as unknown[]).push(createElement("text", { id: ctx.newId(), name: at.name ?? "Text", startTime: at.startTime, duration: at.duration, ...fields }));
    sortElements(track);
  });
}

/** Attaches a text, sticker or graphic to a motion track of a video element. No position keyframe is created. */
export function attachTracking(doc: ProjectDocument, ctx: CommitContext, elementId: string, targetElementId: string, trackId: string, offset = { x: 0, y: 0 }): Commit {
  return edit(doc, ctx, { commandType: "tracking.attach", label: "Track" }, (draft) => {
    const element = editable(elementIn(draft, elementId));
    // Text follows position only; stickers and shapes also follow scale and rotation.
    const followShape = element.type !== "text";
    element.tracking = { targetElementId, trackId, followPosition: true, followScale: followShape, followRotation: followShape, offset };
  });
}

/** A sticker from a catalogue provider (`flags:JP`) or an imported one (`user:<sha256>`). */
export function addSticker(doc: ProjectDocument, ctx: CommitContext, trackId: string, stickerId: string, at: Placement, size = { width: 200, height: 200 }): Commit {
  return edit(doc, ctx, { commandType: "sticker.add", label: "Add sticker" }, (draft) => {
    const { track } = trackIn(draft, trackId);
    (track.elements as unknown[]).push(createElement("sticker", { id: ctx.newId(), name: at.name ?? stickerId, startTime: at.startTime, duration: at.duration, stickerId, intrinsicWidth: size.width, intrinsicHeight: size.height }));
    sortElements(track);
  });
}

/** A shape with the parameter defaults of its definition and no key of another definition. */
export function addShape(doc: ProjectDocument, ctx: CommitContext, trackId: string, definitionId: Exclude<GraphicDefinitionId, "drawing">, at: Placement, params: Record<string, unknown> = {}): Commit {
  return edit(doc, ctx, { commandType: "shape.add", label: "Add shape" }, (draft) => {
    const { track } = trackIn(draft, trackId);
    (track.elements as unknown[]).push(createElement("graphic", { id: ctx.newId(), name: at.name ?? definitionId, startTime: at.startTime, duration: at.duration, definitionId, params }));
    sortElements(track);
  });
}

type DrawnStroke = { points: [number, number][]; width: number; color?: string; brush?: "pen" | "marker" };
type Box = { left: number; top: number; right: number; bottom: number };
/** The bounding box of strokes, expanded by half the largest stroke width on every side. */
function boundingBox(strokes: { points: [number, number][]; width: number }[]): Box {
  const xs = strokes.flatMap((stroke) => stroke.points.map((point) => point[0])), ys = strokes.flatMap((stroke) => stroke.points.map((point) => point[1]));
  const pad = Math.max(...strokes.map((stroke) => stroke.width)) / 2;
  return { left: Math.min(...xs) - pad, top: Math.min(...ys) - pad, right: Math.max(...xs) + pad, bottom: Math.max(...ys) + pad };
}
const centre = (box: Box) => ({ x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 });
const local = (stroke: DrawnStroke, origin: { x: number; y: number }, id: string): Stroke => ({
  id, width: stroke.width, color: stroke.color ?? "#ffffff", brush: stroke.brush ?? "pen",
  points: stroke.points.map(([x, y]) => [roundStored(x - origin.x, 2), roundStored(y - origin.y, 2)] as [number, number]),
} as Stroke);

/**
 * A freehand drawing from strokes given in canvas pixels (from the canvas centre). The intrinsic size is the bounding
 * box; `transform.position` is its centre, so the drawing appears where it was drawn at scale 1.
 */
export function addDrawing(doc: ProjectDocument, ctx: CommitContext, trackId: string, strokes: DrawnStroke[], at: Placement): Commit {
  return edit(doc, ctx, { commandType: "drawing.add", label: "Draw" }, (draft) => {
    const { track } = trackIn(draft, trackId);
    const box = boundingBox(strokes), origin = centre(box);
    (track.elements as unknown[]).push(createElement("graphic", {
      id: ctx.newId(), name: at.name ?? "Drawing", startTime: at.startTime, duration: at.duration, definitionId: "drawing", params: { colorOverride: "" },
      intrinsicWidth: box.right - box.left, intrinsicHeight: box.bottom - box.top,
      transform: { position: origin, scale: { x: 1, y: 1 }, rotation: 0 },
      strokes: strokes.map((stroke) => local(stroke, origin, ctx.newId())),
    }));
    sortElements(track);
  });
}

/**
 * Adds a stroke (canvas pixels, the drawing at scale 1 and no rotation). The box is recomputed and
 * `transform.position` shifts by the move of its centre, so the existing strokes stay on the same canvas pixels.
 */
export function addStroke(doc: ProjectDocument, ctx: CommitContext, elementId: string, stroke: DrawnStroke): Commit {
  return edit(doc, ctx, { commandType: "drawing.stroke.add", label: "Draw" }, (draft) => {
    const element = editable(elementIn(draft, elementId));
    const position = (element.transform as { position: { x: number; y: number } }).position;
    const existing = (element.strokes as Stroke[]).map((entry) => ({ ...entry, points: entry.points.map(([x, y]) => [x + position.x, y + position.y] as [number, number]) }));
    const all = [...existing, { ...stroke, id: ctx.newId() }];
    const box = boundingBox(all), origin = centre(box);
    element.strokes = all.map((entry) => local(entry, origin, (entry as { id: string }).id));
    element.intrinsicWidth = box.right - box.left;
    element.intrinsicHeight = box.bottom - box.top;
    position.x = origin.x;
    position.y = origin.y;
  });
}

/** A caption track with the style `classic` and the default layout. */
export function addCaptionTrack(doc: ProjectDocument, ctx: CommitContext, sceneId: string, options: { language: string; mode?: "speech" | "lyrics"; sourceId?: string; name?: string }): Commit & { trackId: string } {
  const trackId = ctx.newId();
  const commit = edit(doc, ctx, { commandType: "caption.track.add", label: "Add captions" }, (draft) => {
    const scene = draft.scenes.find((candidate) => candidate.id === sceneId)!;
    (scene.tracks.overlay as Track[]).unshift(createTrack("caption", {
      id: trackId, name: options.name ?? "Captions",
      caption: { language: options.language, mode: options.mode ?? "speech", ...(options.sourceId ? { sourceId: options.sourceId } : {}), style: {} },
    }));
  });
  return { ...commit, trackId };
}

type CaptionInput = { startTime: number; duration: number; text: string; words?: { text: string; start: number; end: number }[]; speaker?: string };
export function addCaptions(doc: ProjectDocument, ctx: CommitContext, trackId: string, captions: CaptionInput[]): Commit {
  return edit(doc, ctx, { commandType: "caption.generate", label: "Generate captions" }, (draft) => {
    const { track } = trackIn(draft, trackId);
    for (const caption of captions) (track.elements as unknown[]).push(createElement("caption", { id: ctx.newId(), name: caption.text.slice(0, 200) || "Caption", ...caption }));
    sortElements(track);
  });
}
/** A user or tool edit of a generated caption: the text changes and `edited` records it. */
export const editCaption = (doc: ProjectDocument, ctx: CommitContext, elementId: string, change: { text?: string; translation?: string; words?: CaptionInput["words"] }): Commit =>
  edit(doc, ctx, { commandType: "caption.edit", label: "Edit caption" }, (draft) => {
    Object.assign(editable(elementIn(draft, elementId)), change, { edited: true });
  });
/** Whether Regroup or re-translate would discard a manual edit on this track (so the UI asks first). */
export const captionTrackHasEdits = (track: Track): boolean => (track.elements as unknown as Json[]).some((element) => element.edited === true);

/** Changes one caption's style with "Apply to all" off: only the given keys are stored, merged per sub-object key. */
export function overrideCaptionStyle(doc: ProjectDocument, ctx: CommitContext, elementId: string, style: Record<string, unknown>): Commit {
  return edit(doc, ctx, { commandType: "caption.style", label: "Caption style" }, (draft) => {
    const element = editable(elementIn(draft, elementId));
    const current = (isObject(element.style) ? element.style : {}) as Json;
    for (const [key, value] of Object.entries(style)) current[key] = isObject(value) && isObject(current[key]) ? { ...(current[key] as Json), ...value } : value;
    element.style = current;
  });
}
/** Bilingual captions: the track names the translation language and every caption carries its translation. */
export function translateCaptions(doc: ProjectDocument, ctx: CommitContext, trackId: string, language: string, translations: Record<string, string>): Commit {
  return edit(doc, ctx, { commandType: "caption.translate", label: "Translate captions" }, (draft) => {
    const { track } = trackIn(draft, trackId);
    ((track as unknown as Json).caption as Json).translationLanguage = language;
    for (const element of track.elements as unknown as Json[]) element.translation = translations[String(element.id)] ?? "";
  });
}

/**
 * "Convert to keyframes": the tracking binding is removed and the positions it resolved to (sampled by the engine,
 * relative to the element start) are written as ordinary position channels.
 */
export function convertTrackingToKeyframes(doc: ProjectDocument, ctx: CommitContext, elementId: string, samples: { time: number; x: number; y: number }[]): Commit {
  return edit(doc, ctx, { commandType: "tracking.convert", label: "Convert to keyframes" }, (draft) => {
    const ref = elementIn(draft, elementId);
    const element = editable(ref);
    delete element.tracking;
    for (const sample of samples) {
      writeKey(element, ref.elementPath, "transform.position.x", { time: sample.time, value: sample.x }, ctx.newId);
      writeKey(element, ref.elementPath, "transform.position.y", { time: sample.time, value: sample.y }, ctx.newId);
    }
  });
}

/** Removes a motion track from an asset and, in the same undo step, every element and mask binding that referenced it. */
export function removeMotionTrack(doc: ProjectDocument, ctx: CommitContext, assetId: string, trackId: string): Commit {
  return edit(doc, ctx, { commandType: "tracking.track.remove", label: "Delete motion track" }, (draft) => {
    const asset = draft.media.assets.find((entry) => entry.id === assetId);
    if (asset) asset.motionTracks = asset.motionTracks.filter((entry) => entry.id !== trackId);
    for (const scene of draft.scenes) {
      const elements = [...scene.tracks.overlay, scene.tracks.main, ...scene.tracks.audio].flatMap((track) => track.elements as unknown as Json[]);
      const own = new Set(elements.filter((element) => element.mediaId === assetId).map((element) => element.id));
      for (const element of elements) {
        if (isObject(element.tracking) && element.tracking.trackId === trackId && own.has(element.tracking.targetElementId)) delete element.tracking;
        if (own.has(element.id)) for (const mask of (Array.isArray(element.masks) ? element.masks : []) as Json[]) if (isObject(mask.tracking) && mask.tracking.trackId === trackId) delete mask.tracking;
      }
    }
  });
}
