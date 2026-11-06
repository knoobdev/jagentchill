import { effectDefinition, frameDuration, mediaTimeToFrame, mediaTimeToSeconds, retimeClipOf, sourceTimeAt, template } from "@jagentchill/editor-core";
import type { ProjectDocument, TimelineElement } from "@jagentchill/protocol";
import { parseHexColor, resolveColor, resolveNumber } from "../resolve/animation.ts";
import { resolveClipAnimation, type ClipPose } from "../resolve/clip-animation.ts";
import { boxInverse, clampCrop, coverFit, layerQuad, type LayerQuad, type Size } from "../resolve/layout.ts";
import { buildScene, type BackgroundNode, type Diagnose, type ElementNode, type RootNode, type TransitionNode } from "../scene/build.ts";
import { parseGradient } from "../scene/gradient.ts";
import type { TextSpec } from "../text/layout.ts";
import type { DrawingStroke } from "../textures/raster.ts";
import { blockPose, motionSlots, rasterMotion, rotateHue } from "../text/motion.ts";
import { fnv1a, highlightRanges, synthesiseWords, textSpec } from "../text/spec.ts";
import { colorChain, type ColorChain, type CurveSet } from "./color.ts";
import { gaussianBlurPasses, layerItem, pixelScaleFactor, type EffectPass, type FrameDescriptor, type FrameItem, type LayerItem, type LutItem, type MaskItem, type PersonMatteItem } from "./descriptor.ts";
import { cubicBezier, effectPasses, transitionShader, TRANSITION_EASING, type PassEntry } from "./library.ts";
import { BAKED_LUT_SIZE } from "./recipe.ts";

/** A texture a frame needs, described by what it is made from. The texture sync step turns each into an upload. */
export type TextureRequest =
  | { id: string; kind: "color"; rgba: [number, number, number, number] }
  | { id: string; kind: "image"; assetId: string; maxLongSide: number; elementId?: string }
  /** `next`: the source frame after the one that contains `sourceTime` (the second frame of a frame blend). */
  | { id: string; kind: "video"; assetId: string; elementId: string; sourceTime: number; blur?: boolean; next?: boolean }
  | { id: string; kind: "gradient"; css: string; width: number; height: number }
  | { id: string; kind: "text"; spec: TextSpec; elementId: string }
  /** `animation` is present while the sticker may be an animated image: the time into its frames (seconds) and whether it loops. */
  | { id: string; kind: "sticker"; stickerId: string; size: number; elementId: string; animation?: { time: number; loop: boolean } }
  /** An emoji sticker, drawn from the colour font: the emoji sequence, the loaded font ids and the square side in px. */
  | { id: string; kind: "emoji"; text: string; fonts: string[]; size: number; elementId: string }
  /** A freehand drawing: its strokes at `width × height` px of an `intrinsic` box. */
  | { id: string; kind: "drawing"; strokes: DrawingStroke[]; colorOverride?: string; intrinsic: Size; width: number; height: number; elementId: string }
  | { id: string; kind: "curves"; curves: CurveSet }
  | { id: string; kind: "lut"; lutId: string }
  /** The baked table of a bundled filter. */
  | { id: string; kind: "filter"; filterId: string }
  /** The person matte of a source frame (`sourceTime` is `null` for a still). */
  | { id: string; kind: "person-matte"; assetId: string; elementId: string; sourceTime: number | null }
  | { id: string; kind: "graphic"; definitionId: string; params: Record<string, unknown>; width: number; height: number }
  | { id: string; kind: "mask"; shape: string; params: Record<string, unknown>; quad: LayerQuad; width: number; height: number; text?: TextSpec };

export type BuiltFrame = {
  descriptor: FrameDescriptor;
  textures: TextureRequest[];
  /** Canvas-space quad of every visible element, for `layout.query`. */
  layouts: Map<string, LayerQuad>;
  /** Element ids whose node type this build of the engine does not draw. */
  undrawn: { elementId: string; type: string }[];
};

export type FrameOptions = {
  document: ProjectDocument; sceneId: string;
  /** Frame START time in ticks. */
  time: number;
  render: Size;
  /** `preview` caps images at 2 048 px on the long side; `export` uses the full resolution. */
  quality?: "preview" | "export";
  overrides?: Record<string, Record<string, unknown>>;
  includeCaptions?: boolean;
  diagnose?: Diagnose;
  /** The loaded table size of a LUT id; `null` while the table is not available (the step is then identity). */
  lutSize?: (lutId: string) => number | null;
  /** The stored size of the person matte of an asset; `null` while none is available (body effects then pass through). */
  personMatte?: (assetId: string) => { width: number; height: number } | null;
  /** Whether a sticker is an animated image: `undefined` until its file has been read once. */
  stickerAnimated?: (stickerId: string) => boolean | undefined;
  /** The engine's text services: font chains and synchronous layout through the wasm shaper. Without them text is not drawn. */
  text?: TextServices;
};

export type TextServices = {
  /** Loaded font ids for a family, weight and style, the element's face first; `fallback` when that face is missing. */
  chain(fontFamily: string, weight?: number, style?: "normal" | "italic"): { ids: string[]; fallback: boolean; family: string };
  /** Texture size of a text and the offset of its block centre from the texture centre, in raster px. */
  measure(spec: TextSpec): { width: number; height: number; offsetX: number; offsetY: number; blockWidth?: number; blockHeight?: number } | null;
};

const MAX_COMPOUND_DEPTH = 8;
type Context = FrameOptions & {
  textures: Map<string, TextureRequest>; layouts: Map<string, LayerQuad>; undrawn: BuiltFrame["undrawn"]; diagnose: Diagnose;
  roots: Map<string, RootNode>;
};

const visibleAt = (node: { startTime: number; duration: number }, time: number): boolean => time >= node.startTime && time - node.startTime < node.duration;
const want = (context: Context, request: TextureRequest): string => { if (!context.textures.has(request.id)) context.textures.set(request.id, request); return request.id; };
const fullCanvas = (render: Size): LayerQuad => ({ centerX: render.width / 2, centerY: render.height / 2, width: render.width, height: render.height, rotationDegrees: 0, flipX: false, flipY: false });
const colorId = (rgba: number[]): string => `color:${rgba.map((value) => Math.round(value * 255)).join(",")}`;

function assetSize(document: ProjectDocument, assetId: string): Size | undefined {
  const asset = document.media.assets.find((candidate) => candidate.id === assetId);
  if (!asset?.width || !asset.height) return undefined;
  return asset.rotation === 90 || asset.rotation === 270 ? { width: asset.height, height: asset.width } : { width: asset.width, height: asset.height };
}

function rootOf(context: Context, sceneId: string, asCompoundSource: boolean): RootNode {
  const key = `${sceneId}:${asCompoundSource}`;
  let root = context.roots.get(key);
  if (!root) context.roots.set(key, root = buildScene(context.document, sceneId, { overrides: context.overrides, includeCaptions: context.includeCaptions, asCompoundSource, diagnose: context.diagnose }));
  return root;
}

/** The colour chain of an element at a clip time, with the textures it needs requested. */
function chainOf(context: Context, element: Record<string, any>, clipTime: number, elementId: string): ColorChain | null {
  return colorChain(element, clipTime, {
    curves: (curves) => want(context, { id: `curves:${fnv1a(JSON.stringify(curves)).toString(16)}`, kind: "curves", curves }),
    lut: (lutId) => {
      const size = context.lutSize?.(lutId) ?? null;
      return size === null ? null : { textureId: want(context, { id: `lut:${lutId}`, kind: "lut", lutId }), size };
    },
    unsupported: (step) => { context.undrawn.push({ elementId, type: step }); },
    frameIndex: mediaTimeToFrame(context.time, context.document.settings.fps),
  });
}

const STROKE_KEYS = new WeakMap<object, string>();
/** A content key of the strokes of a drawing, computed once per stored array. */
function strokesKey(strokes: object): string {
  let key = STROKE_KEYS.get(strokes);
  if (!key) STROKE_KEYS.set(strokes, key = fnv1a(JSON.stringify(strokes)).toString(16));
  return key;
}

/** The emoji sequence of an `emoji:<code points>` sticker id (lower-case hex joined by `-`), or `null` for another provider. */
export function emojiText(stickerId: unknown): string | null {
  const match = typeof stickerId === "string" ? /^emoji:([0-9a-f]{2,6}(?:-[0-9a-f]{2,6})*)$/.exec(stickerId) : null;
  if (!match) return null;
  try { return String.fromCodePoint(...match[1].split("-").map((code) => parseInt(code, 16))); } catch { return null; }
}

const entriesOf = (element: unknown): PassEntry[] => ((element as { effects?: PassEntry[] }).effects ?? []);

/** Enabled effect entries of kind `effect` of an element as pass groups, in array order. */
function effectGroups(context: Context, element: TimelineElement, clipTime: number, matte = false): EffectPass[][] {
  const frame = frameDuration(context.document.settings.fps);
  const last = Math.max((element as { duration: number }).duration - frame, 0);
  const timing = { seconds: mediaTimeToSeconds(clipTime), frame: mediaTimeToFrame(context.time, context.document.settings.fps), progress: last > 0 ? Math.min(Math.max(mediaTimeToSeconds(clipTime) / mediaTimeToSeconds(last), 0), 1) : 0, scale: pixelScaleFactor(context.render), matte };
  const groups: EffectPass[][] = [];
  for (const entry of entriesOf(element)) {
    if (entry.enabled === false || entry.kind !== "effect") continue;
    const passes = effectPasses(element as { animations?: Record<string, unknown> }, entry, clipTime, timing);
    if (passes.length > 0) groups.push(passes);
  }
  return groups;
}

/** The `filter` stage of an element: the baked table of its one enabled filter entry, at its intensity. */
function filterOf(context: Context, element: TimelineElement, clipTime: number): LutItem | null {
  const entry = entriesOf(element).find((candidate) => candidate.kind === "filter" && candidate.enabled !== false);
  if (!entry || effectDefinition(entry.type)?.kind !== "filter") return null;
  const intensity = Math.min(Math.max(resolveNumber(element as { animations?: Record<string, unknown> }, `effects.${entry.id}.params.intensity`, clipTime, Number(entry.params?.intensity ?? 100)), 0), 100) / 100;
  // Intensity 0 is a bit-exact pass-through: the stage is not run.
  if (intensity === 0) return null;
  return { textureId: want(context, { id: `filter:${entry.type}`, kind: "filter", filterId: entry.type }), size: BAKED_LUT_SIZE, intensity };
}

/** The person matte of a layer, when one of its enabled effects needs it and the matte of its asset is available. */
function personMatteOf(context: Context, element: TimelineElement, elementId: string, assetId: string, sourceTime: number | null): PersonMatteItem | null {
  if (!entriesOf(element).some((entry) => entry.enabled !== false && effectDefinition(entry.type)?.requires === "person-matte")) return null;
  const size = context.personMatte?.(assetId) ?? null;
  if (!size) return null;
  return { textureId: want(context, { id: `person-matte:${elementId}`, kind: "person-matte", assetId, elementId, sourceTime }), ...size };
}

type PathPoint = Record<string, unknown>;
type PathKey = { time: number; value: { points: PathPoint[] }; segmentToNext?: string; easing?: [number, number, number, number] };
function maskNumber(element: { animations?: Record<string, unknown> }, maskId: string, key: string, clipTime: number, stored: number): number {
  const channel = element.animations?.[`masks.${maskId}.params.${key}`] as { keys?: unknown[] } | undefined;
  return channel?.keys?.length ? resolveNumber(element, `masks.${maskId}.params.${key}`, clipTime, stored) : stored;
}
/** The pen path of a freeform mask at a clip time, from its path channel: every point is interpolated on its own at the eased progress. */
function maskPath(element: { animations?: Record<string, unknown> }, maskId: string, clipTime: number): PathPoint[] | null {
  const keys = (element.animations?.[`masks.${maskId}.params.path`] as { keys?: PathKey[] } | undefined)?.keys;
  if (!keys?.length) return null;
  if (clipTime <= keys[0].time) return keys[0].value.points;
  const last = keys[keys.length - 1];
  if (clipTime >= last.time) return last.value.points;
  let index = 0;
  while (keys[index + 1].time <= clipTime) index++;
  const from = keys[index], to = keys[index + 1];
  if (from.segmentToNext === "step") return from.value.points;
  const linear = (clipTime - from.time) / (to.time - from.time);
  const progress = from.segmentToNext === "bezier" && from.easing ? cubicBezier(from.easing[0], from.easing[1], from.easing[2], from.easing[3], linear) : linear;
  return from.value.points.map((point, at) => {
    const other = to.value.points.find((candidate) => candidate.id !== undefined && candidate.id === point.id) ?? to.value.points[at];
    if (!other) return point;
    const out: PathPoint = { ...point };
    for (const [name, value] of Object.entries(point)) if (typeof value === "number" && typeof other[name] === "number") out[name] = value + ((other[name] as number) - value) * progress;
    return out;
  });
}

function maskItems(context: Context, node: ElementNode, quad: LayerQuad, clipTime: number): MaskItem[] {
  const scale = pixelScaleFactor(context.render);
  const items: MaskItem[] = [];
  for (const mask of node.masks as { id: string; type: string; combine: MaskItem["combine"]; params: Record<string, any> }[]) {
    // The document's animatable path is `masks.<maskId>.params.<key>`; `masks` is a list, so the stored value is read from the entry.
    const number = (key: string, fallback: number) => maskNumber(node.element, mask.id, key, clipTime, Number(mask.params?.[key] ?? fallback));
    const params: Record<string, unknown> = { centerX: number("centerX", 0), centerY: number("centerY", 0), width: number("width", 0.6), height: number("height", 0.6), rotation: number("rotation", 0), scale: number("scale", 1), cornerRadius: number("cornerRadius", 0), size: number("size", 0.4) };
    if (mask.type === "star") Object.assign(params, { points: mask.params?.points ?? 5, innerRatio: number("innerRatio", 0.45) });
    if (mask.type === "freeform") {
      // An open path does not mask: the element renders unmasked.
      if (mask.params?.closed !== true || (mask.params?.path ?? []).length < 3) continue;
      Object.assign(params, { closed: true, path: maskPath(node.element, mask.id, clipTime) ?? mask.params.path });
    }
    let text: TextSpec | undefined;
    if (mask.type === "text") {
      // Blank content makes the mask inactive: the element renders unmasked.
      const content = String(mask.params?.content ?? "Mask");
      if (content.trim() === "" || !context.text) continue;
      const chain = context.text.chain(mask.params?.fontFamily ?? "Arial", mask.params?.fontWeight === "bold" ? 700 : 400, mask.params?.fontStyle === "italic" ? "italic" : "normal");
      if (chain.ids.length === 0) continue;
      // `fontSize` is the em height as a percentage of the element's short side.
      const size = (number("fontSize", 15) / 100) * Math.min(quad.width, quad.height) * number("scale", 1);
      text = { content, fonts: chain.ids, size, letterSpacing: (number("letterSpacing", 0) / 1000) * size, lineHeight: number("lineHeight", 1.2), align: "center", color: "#ffffff", underline: mask.params?.textDecoration === "underline", strikethrough: mask.params?.textDecoration === "line-through" };
    }
    const id = `mask:${mask.type}:${JSON.stringify(params)}:${JSON.stringify(quad)}:${context.render.width}x${context.render.height}${text ? `:${fnv1a(JSON.stringify(text)).toString(16)}` : ""}`;
    want(context, { id, kind: "mask", shape: mask.type, params, quad, width: context.render.width, height: context.render.height, ...(text ? { text } : {}) });
    items.push({ textureId: id, feather: number("feather", 0) * scale, inverted: mask.params?.inverted === true, opacity: number("opacity", 100) / 100, combine: mask.combine ?? "add" });
  }
  return items;
}

/** The layer of one visual element at a clip time, or `null` when this build does not draw its node type. */
function elementLayer(context: Context, node: ElementNode, clipTime: number, items: FrameItem[], depth: number, chain: string[], translation = false): LayerItem | null {
  const element = node.element as TimelineElement & Record<string, any>;
  const { document, render } = context;
  const canvas = document.settings.canvasSize;
  let textureId: string, source: Size, fit: "contain" | "intrinsic" = "contain";
  let matteSource: { assetId: string; sourceTime: number | null } | null = null;
  let blendSource: LayerItem["blendSource"] = null;
  if (node.type === "Video" || node.type === "Image") {
    const assetId: string | undefined = node.type === "Video" ? element.freeze?.mediaId ?? element.mediaId : element.mediaId;
    if (!assetId) return null;
    source = assetSize(document, assetId) ?? canvas;
    if (node.type === "Image" || document.media.assets.find((asset) => asset.id === assetId)?.type === "image") {
      textureId = want(context, { id: `image:${assetId}:${context.quality === "export" ? 0 : 2048}`, kind: "image", assetId, maxLongSide: context.quality === "export" ? 0 : 2048, elementId: node.elementId });
      matteSource = { assetId, sourceTime: null };
    } else {
      const clip = retimeClipOf(element);
      // A reversed element shows the frame that contains the source time one frame later, so that its first
      // frame is the last visible source frame.
      const sourceTime = sourceTimeAt(clip, clip.retime?.reverse ? clipTime + frameDuration(document.settings.fps) : clipTime);
      textureId = want(context, { id: `video:${node.elementId}`, kind: "video", assetId, elementId: node.elementId, sourceTime });
      matteSource = { assetId, sourceTime };
      blendSource = frameBlend(context, element, clip, assetId, node.elementId, clipTime, sourceTime);
    }
  } else if (node.type === "Graphic") {
    const shown = { x: Math.abs(resolveNumber(element, "transform.scale.x", clipTime, element.transform?.scale?.x ?? 1)), y: Math.abs(resolveNumber(element, "transform.scale.y", clipTime, element.transform?.scale?.y ?? 1)) };
    if (element.definitionId === "drawing") {
      const strokes: DrawingStroke[] = Array.isArray(element.strokes) ? element.strokes : [];
      if (strokes.length === 0 || !(element.intrinsicWidth > 0) || !(element.intrinsicHeight > 0)) return null;
      source = { width: element.intrinsicWidth, height: element.intrinsicHeight };
      fit = "intrinsic";
      // Rasterised at the displayed size, its long side a power of two of at most 4 096 px so that a zoom does not rasterise every frame.
      const displayed = Math.max(source.width * shown.x, source.height * shown.y) * (render.width / canvas.width);
      const long = Math.min(4096, Math.max(64, 2 ** Math.ceil(Math.log2(Math.max(displayed, 1)))));
      const factor = long / Math.max(source.width, source.height);
      const override = resolveColor(element, "params.colorOverride", clipTime, typeof element.params?.colorOverride === "string" ? element.params.colorOverride : "");
      textureId = want(context, {
        id: `drawing:${node.elementId}:${strokesKey(strokes)}:${override}:${long}`, kind: "drawing", strokes, ...(override ? { colorOverride: override } : {}), intrinsic: source,
        width: Math.max(1, Math.round(source.width * factor)), height: Math.max(1, Math.round(source.height * factor)), elementId: node.elementId,
      });
    } else {
      const long = Math.max(element.intrinsicWidth ?? 200, element.intrinsicHeight ?? 200);
      const params: Record<string, unknown> = { ...element.params };
      for (const key of ["fill", "stroke"]) if (typeof params[key] === "string") params[key] = resolveColor(element, `params.${key}`, clipTime, params[key] as string);
      for (const key of ["strokeWidth", "cornerRadius", "sides", "points", "depth", "dash", "headSize", "shaftWidth"]) if (typeof params[key] === "number") params[key] = resolveNumber(element, `params.${key}`, clipTime, params[key] as number);
      // A line always has a stroke: its defaults are white and 8 units when the document leaves them out.
      if (element.definitionId === "line") { params.stroke ??= "#ffffff"; params.strokeWidth ??= 8; }
      source = { width: element.intrinsicWidth ?? 200, height: element.intrinsicHeight ?? 200 };
      fit = "intrinsic";
      const side = Math.min(2048, Math.max(512, 2 ** Math.ceil(Math.log2(long * Math.max(element.transform.scale.x, element.transform.scale.y) * (render.width / canvas.width)))));
      // A shape stretched on one axis is rasterised at its displayed aspect, so that its stroke and corners are
      // laid on after the stretch; the aspect is kept to 1/64 steps so that a scale animation reuses textures.
      const most = Math.max(shown.x, shown.y, 1e-6), least = Math.min(shown.x, shown.y);
      const ratio = Math.max(Math.round((least / most) * 64) / 64, 1 / 64);
      if (ratio === 1) textureId = want(context, { id: `graphic:${element.definitionId}:${JSON.stringify(params)}:${side}`, kind: "graphic", definitionId: element.definitionId, params, width: side, height: side });
      else {
        const width = shown.x >= shown.y ? side : Math.max(1, Math.round(side * ratio)), height = shown.x >= shown.y ? Math.max(1, Math.round(side * ratio)) : side;
        textureId = want(context, { id: `graphic:${element.definitionId}:${JSON.stringify(params)}:${width}x${height}`, kind: "graphic", definitionId: element.definitionId, params, width, height });
      }
    }
  } else if (node.type === "Sticker") {
    source = { width: element.intrinsicWidth ?? 200, height: element.intrinsicHeight ?? 200 };
    fit = "intrinsic";
    // Rasterised at the displayed pixel size rounded up to a power of two, between 128 and 2 048 px.
    const shown = Math.max(source.width * Math.abs(element.transform?.scale?.x ?? 1), source.height * Math.abs(element.transform?.scale?.y ?? 1)) * (render.width / canvas.width);
    const size = Math.min(2048, Math.max(128, 2 ** Math.ceil(Math.log2(Math.max(1, shown)))));
    const emoji = emojiText(element.stickerId);
    if (emoji !== null) {
      // An emoji sticker is the glyph of the bundled colour font, drawn by the engine's own text path.
      const chain = context.text?.chain("Noto Color Emoji");
      if (!chain || chain.ids.length === 0) return null;
      textureId = want(context, { id: `emoji:${element.stickerId}:${size}:${chain.ids[0]}`, kind: "emoji", text: emoji, fonts: chain.ids, size, elementId: node.elementId });
    } else {
      // An animated sticker shows the frame at clip time × speed, modulo its own duration (or holding its last frame).
      const animated = context.stickerAnimated ? context.stickerAnimated(element.stickerId) : false;
      const speed = Math.min(Math.max(typeof element.playbackSpeed === "number" ? element.playbackSpeed : 1, 0.1), 4);
      textureId = want(context, {
        // Two elements of one animated sticker show different frames: each has its own texture.
        id: `sticker:${element.stickerId}:${size}${animated === true ? `:${node.elementId}` : ""}`, kind: "sticker", stickerId: element.stickerId, size, elementId: node.elementId,
        ...(animated === false ? {} : { animation: { time: mediaTimeToSeconds(clipTime) * speed, loop: element.loop !== false } }),
      });
    }
  } else if (node.type === "Text" || node.type === "Caption") {
    const services = context.text;
    const caption = node.type === "Caption" ? node.caption ?? {} : undefined;
    // A caption is drawn in its track style with the caption's own overrides on top.
    const style = caption ? { ...caption.style, ...(element.style ?? {}), animations: element.animations } : element;
    // A translated caption is two blocks, the text and its translation, stacked about the caption's anchor.
    const bilingual = caption && typeof element.translation === "string" && element.translation !== "" && caption.bilingual?.visible !== false ? { order: caption.bilingual?.order === "above" ? "above" : "below", scale: (caption.bilingual?.scale ?? 80) / 100, color: caption.bilingual?.color as string | undefined } : null;
    if (translation && !bilingual) return null;
    const content: string = translation ? element.translation : caption ? element.text ?? "" : element.content ?? "";
    if (!services || content === "") return null;
    const chain = services.chain(style.fontFamily ?? "Arial", style.fontWeight, style.fontStyle);
    if (chain.ids.length === 0) return null;
    if (chain.fallback) context.diagnose({ id: "font/fallback", severity: "caution", message: `text ${node.elementId} is drawn in a fallback font`, elementId: node.elementId, details: { family: chain.family } });
    const spec = textSpec(style, content, chain.ids, clipTime, render);
    const primaryLine = spec.size * spec.lineHeight;
    if (translation && bilingual) { spec.size *= bilingual.scale; spec.letterSpacing *= bilingual.scale; if (bilingual.color) spec.color = bilingual.color; }
    if (caption) spec.maxWidth = ((caption.layout?.maxWidth ?? 80) / 100) * render.width;
    if (caption && !translation) {
      // A caption without word timings spreads its duration over its words by their character counts.
      const words = element.words?.length ? element.words : caption.highlight?.style && caption.highlight.style !== "none" ? synthesiseWords(spec.content, node.duration) : undefined;
      spec.ranges = highlightRanges(spec.content, words, clipTime, { style: caption.highlight?.style ?? "none", color: caption.highlight?.color ?? "#ffd400", textColor: caption.highlight?.textColor ?? "#000000", scale: caption.highlight?.scale });
    }
    // Text animations: the block ones move the layer, the unit ones are drawn into the texture.
    const slots = motionSlots(style.textAnimation, clipTime, node.duration);
    const motion = rasterMotion(slots, node.elementId);
    if (motion) spec.motion = motion;
    if (slots.loop?.id === "loop-rainbow") {
      spec.color = rotateHue(spec.color, 360 * slots.loop.p);
      if (spec.gradient) spec.gradient = { ...spec.gradient, color: rotateHue(spec.gradient.color, 360 * slots.loop.p) };
    }
    // A blur animation needs room around the ink for as long as it runs: its largest radius.
    const blurSlot = [slots.in, slots.out].find((slot) => slot?.id === "in-blur" || slot?.id === "out-blur");
    if (blurSlot) spec.pad = Math.ceil(0.4 * spec.size * blurSlot.strength * 1.5);
    const measured = services.measure(spec);
    if (!measured) return null;
    textureId = want(context, { id: `text:${fnv1a(JSON.stringify(spec)).toString(16)}:${measured.width}x${measured.height}`, kind: "text", spec, elementId: node.elementId });
    const kx = render.width / canvas.width, ky = render.height / canvas.height;
    source = { width: measured.width / kx, height: measured.height / ky };
    fit = "intrinsic";
    const blockWidthPx = measured.blockWidth ?? measured.width - 2 * Math.abs(measured.offsetX), blockHeightPx = measured.blockHeight ?? measured.height - 2 * Math.abs(measured.offsetY);
    // The anchored height of a caption is the texture height less twice the offset of its block centre, as it always was.
    const ownHeight = (measured.height - 2 * Math.abs(measured.offsetY)) / ky;
    let blockHeight = ownHeight, stackOffset = 0;
    if (bilingual) {
      // The other block is measured the same way, without highlight or animation: the two share the anchor as one stack.
      const other = textSpec(style, translation ? element.text ?? "" : element.translation, chain.ids, clipTime, render);
      other.maxWidth = spec.maxWidth;
      if (!translation) { other.size *= bilingual.scale; other.letterSpacing *= bilingual.scale; }
      const otherMeasured = services.measure(other);
      if (otherMeasured) {
        // The stack is made of the two line blocks themselves, not of their textures' padding.
        const mine = blockHeightPx / ky, otherHeight = (otherMeasured.blockHeight ?? otherMeasured.height - 2 * Math.abs(otherMeasured.offsetY)) / ky, gap = (0.3 * primaryLine) / ky;
        blockHeight = mine + gap + otherHeight;
        // The upper block sits at the top of the stack, the lower one at its bottom.
        const upper = translation === (bilingual.order === "above");
        stackOffset = upper ? -(blockHeight - mine) / 2 : (blockHeight - mine) / 2;
      }
    }
    let placement = { position: { x: resolveNumber(element, "transform.position.x", clipTime, 0), y: resolveNumber(element, "transform.position.y", clipTime, 0) }, scale: { x: resolveNumber(element, "transform.scale.x", clipTime, 1), y: resolveNumber(element, "transform.scale.y", clipTime, 1) }, rotation: resolveNumber(element, "transform.rotation", clipTime, 0) };
    if (caption && !element.transform) {
      // Anchored by the track layout: the block sits a margin away from the top or the bottom, or in the middle.
      const layout = caption.layout ?? {};
      const margin = ((layout.marginY ?? 5) / 100) * canvas.height;
      const y = layout.anchor === "top" ? margin + blockHeight / 2 : layout.anchor === "middle" ? canvas.height / 2 : canvas.height - margin - blockHeight / 2;
      placement = { position: { x: layout.offset?.x ?? 0, y: y - canvas.height / 2 + (layout.offset?.y ?? 0) }, scale: { x: layout.scale ?? 1, y: layout.scale ?? 1 }, rotation: 0 };
    }
    if (stackOffset !== 0) {
      const turn = (placement.rotation * Math.PI) / 180, along = stackOffset * placement.scale.y;
      placement = { ...placement, position: { x: placement.position.x - along * Math.sin(turn), y: placement.position.y + along * Math.cos(turn) } };
    }
    // The animation is applied on top of the resolved transform and opacity, in the element's own frame.
    const pose = blockPose(slots, { blockWidth: blockWidthPx, blockHeight: blockHeightPx, fontSize: spec.size });
    {
      const turn = (placement.rotation * Math.PI) / 180;
      // Raster px of the block → canvas px, scaled like the block and turned with the element.
      let moveX = (pose.dx / kx) * placement.scale.x, moveY = (pose.dy / ky) * placement.scale.y;
      if (pose.pivot === "top" && pose.rotate !== 0) {
        // A swing turns about the top centre of the block: the block centre travels on a circle of half its height.
        const swing = (pose.rotate * Math.PI) / 180, half = (blockHeight * placement.scale.y) / 2;
        moveX += -Math.sin(swing) * half;
        moveY += Math.cos(swing) * half - half;
      }
      placement = {
        position: { x: placement.position.x + moveX * Math.cos(turn) - moveY * Math.sin(turn), y: placement.position.y + moveX * Math.sin(turn) + moveY * Math.cos(turn) },
        scale: { x: placement.scale.x * pose.scaleX, y: placement.scale.y * pose.scaleY }, rotation: placement.rotation + pose.rotate,
      };
    }
    const quad = layerQuad({ source, crop: { left: 0, top: 0, right: 0, bottom: 0 }, canvas, render, fit, placement: { ...placement, flip: element.flip } });
    // The texture carries padding for shadow and glow; the block, not the texture, sits at the element position.
    const radians = (quad.rotationDegrees * Math.PI) / 180;
    const dx = -measured.offsetX * placement.scale.x, dy = -measured.offsetY * placement.scale.y;
    quad.centerX += dx * Math.cos(radians) - dy * Math.sin(radians);
    quad.centerY += dx * Math.sin(radians) + dy * Math.cos(radians);
    if (!translation) context.layouts.set(node.elementId, quad);
    const groups = effectGroups(context, element, clipTime);
    // The blur radius of the animation is twice the Gaussian sigma.
    const blur = pose.blur > 0 ? gaussianBlurPasses(pose.blur / 2) : [];
    if (blur.length > 0) groups.push(blur);
    // Motion blur of a text follows its keyframed transform: the same raster under the transform at the shutter's start.
    const textBlur = motionBlurPass(element, clipTime, frameDuration(document.settings.fps), quad, (time) => {
      const at = (path: string, fallback: number) => resolveNumber(element, path, time, fallback) - resolveNumber(element, path, clipTime, fallback);
      const ratio = (path: string) => { const now = resolveNumber(element, path, clipTime, 1); return now === 0 ? 1 : resolveNumber(element, path, time, 1) / now; };
      return { ...quad, centerX: quad.centerX + at("transform.position.x", 0) * kx, centerY: quad.centerY + at("transform.position.y", 0) * ky, width: quad.width * Math.abs(ratio("transform.scale.x")), height: quad.height * Math.abs(ratio("transform.scale.y")), rotationDegrees: quad.rotationDegrees + at("transform.rotation", 0) };
    });
    return layerItem(textureId, quad, boxInverse(quad), {
      filter: filterOf(context, element, clipTime), effectPassGroups: groups, opacity: Math.min(Math.max(resolveNumber(element, "opacity", clipTime, 1) * pose.opacity, 0), 1), blendMode: element.blendMode ?? "normal",
      ...(textBlur ? { postPasses: [textBlur] } : {}),
    });
  } else if (node.type === "Compound") {
    const sceneId: string = element.sceneId;
    if (chain.includes(sceneId)) {
      context.diagnose({ id: "scene/compound-cycle", severity: "error", message: `compound ${node.elementId} refers back to a scene that contains it`, elementId: node.elementId, details: { elementIds: [...chain, node.elementId] } });
      return null;
    }
    if (depth >= MAX_COMPOUND_DEPTH) {
      context.diagnose({ id: "scene/compound-depth", severity: "error", message: `compound ${node.elementId} is nested deeper than ${MAX_COMPOUND_DEPTH}`, elementId: node.elementId });
      return null;
    }
    if (!document.scenes.some((scene) => scene.id === sceneId)) return null;
    const inner = rootOf(context, sceneId, true);
    const innerTime = sourceTimeAt(retimeClipOf(element), clipTime);
    textureId = `compound:${node.elementId}`;
    items.push({ type: "group", items: sceneItems(context, inner, innerTime, depth + 1, [...chain, sceneId]).items, targetTextureId: textureId });
    source = canvas;
  } else {
    return null;
  }

  const stored = clampCrop({ left: resolveNumber(element, "crop.left", clipTime, 0), top: resolveNumber(element, "crop.top", clipTime, 0), right: resolveNumber(element, "crop.right", clipTime, 0), bottom: resolveNumber(element, "crop.bottom", clipTime, 0) });
  // The media of a filled template slot covers the canvas frame, framed as its slot says.
  if (document.template && (node.type === "Video" || node.type === "Image")) { const framed = template.slotCrop(document, node.elementId, source, stored.crop); if (framed) stored.crop = framed; }
  if (stored.clamped) context.diagnose({ id: "scene/crop-clamped", severity: "caution", message: `the crop of element ${node.elementId} was clamped into range`, elementId: node.elementId });
  // An id that is not in the library animates nothing, like an unknown text animation.
  /** The layer's rectangle at an element-local time: the element transform composed with the clip-animation transform. */
  const quadAt = (time: number): { quad: LayerQuad; pose: ClipPose | null } => {
    const pose = resolveClipAnimation(element.clipAnimation, time, node.duration, node.elementId);
    const quad = layerQuad({
      source, crop: stored.crop, canvas, render, fit,
      placement: {
        position: { x: resolveNumber(element, "transform.position.x", time, 0), y: resolveNumber(element, "transform.position.y", time, 0) },
        scale: { x: resolveNumber(element, "transform.scale.x", time, 1), y: resolveNumber(element, "transform.scale.y", time, 1) },
        rotation: resolveNumber(element, "transform.rotation", time, 0), flip: element.flip,
      },
      ...(pose ? { animation: { x: (pose.x / 100) * canvas.width, y: (pose.y / 100) * canvas.height, scaleX: pose.scaleX / 100, scaleY: pose.scaleY / 100, rotation: pose.rotation } } : {}),
    });
    if (pose?.pivot === "top" && pose.rotation !== 0) {
      // A pendulum turns about the centre of the element's top edge: the box centre travels on a circle of half its height.
      const own = ((quad.rotationDegrees - pose.rotation) * Math.PI) / 180, turned = (quad.rotationDegrees * Math.PI) / 180, half = quad.height / 2;
      quad.centerX += half * (Math.sin(own) - Math.sin(turned));
      quad.centerY += half * (Math.cos(turned) - Math.cos(own));
    }
    return { quad, pose };
  };
  const { quad, pose } = quadAt(clipTime);
  context.layouts.set(node.elementId, quad);
  const chroma = element.chromaKey;
  const key = chroma?.enabled ? {
    keyColor: parseHexColor(chroma.color).slice(0, 3) as [number, number, number],
    similarity: resolveNumber(element, "chromaKey.strength", clipTime, 40) / 100, smoothness: resolveNumber(element, "chromaKey.edge", clipTime, 10) / 100,
    shadow: resolveNumber(element, "chromaKey.shadow", clipTime, 0) / 100, spill: resolveNumber(element, "chromaKey.spill", clipTime, 50) / 100,
    // "Show matte" is view state: it reaches the frame only as a preview override, never from the stored document.
    ...(chroma.showMatte === true ? { showMatte: true } : {}),
  } : null;
  const personMatte = matteSource ? personMatteOf(context, element, node.elementId, matteSource.assetId, matteSource.sourceTime) : null;
  const groups = effectGroups(context, element, clipTime, personMatte !== null);
  // The blur of a clip animation runs after the element's last effect; its value is a sigma on the reference canvas.
  const blur = pose && pose.blur > 0 ? gaussianBlurPasses(pose.blur * pixelScaleFactor(render)) : [];
  if (blur.length > 0) groups.push(blur);
  const postPasses: EffectPass[] = [];
  if (pose && pose.reveal < 1) postPasses.push({ shader: "wipe-reveal", uniforms: { u_reveal: pose.reveal, u_angle: 0, u_softness: 0.1 } });
  const blurPass = motionBlurPass(element, clipTime, frameDuration(document.settings.fps), quad, (time) => quadAt(time).quad);
  if (blurPass) postPasses.push(blurPass);
  return layerItem(textureId, quad, boxInverse(quad), {
    crop: stored.crop, key, color: chainOf(context, element, clipTime, node.elementId), filter: filterOf(context, element, clipTime), personMatte,
    effectPassGroups: groups, masks: maskItems(context, node, quad, clipTime),
    opacity: Math.min(Math.max(resolveNumber(element, "opacity", clipTime, 1) * (pose?.opacity ?? 1), 0), 1), blendMode: element.blendMode ?? "normal",
    ...(blendSource ? { blendSource } : {}), ...(postPasses.length > 0 ? { postPasses } : {}),
  });
}

/**
 * The `motion-blur` pass of an element (`visual-effects-filters.Motion blur`): a trailing shutter of `strength` % of
 * one frame, between the transform at its start (`quadAt`, never before local time 0) and the transform at the
 * frame time. `null` when the blur is off or the transform does not change within the shutter.
 */
function motionBlurPass(element: Record<string, any>, clipTime: number, frame: number, quad: LayerQuad, quadAt: (time: number) => LayerQuad): EffectPass | null {
  const motion = element.motionBlur;
  if (!motion?.enabled) return null;
  const shutter = (Math.min(Math.max(resolveNumber(element, "motionBlur.strength", clipTime, motion.strength ?? 50), 0), 100) / 100) * frame;
  if (!(shutter > 0)) return null;
  const before = quadAt(Math.max(clipTime - shutter, 0));
  const moved = Math.abs(before.centerX - quad.centerX) + Math.abs(before.centerY - quad.centerY) + Math.abs(before.width - quad.width) + Math.abs(before.height - quad.height) > 1e-3 || Math.abs(before.rotationDegrees - quad.rotationDegrees) > 1e-4;
  if (!moved) return null;
  return { shader: "motion-blur", uniforms: {
    u_current: [quad.centerX, quad.centerY, quad.width, quad.height], u_previous: [before.centerX, before.centerY, before.width, before.height],
    u_turn: [(quad.rotationDegrees * Math.PI) / 180, (before.rotationDegrees * Math.PI) / 180], u_samples: [4, 8, 16].includes(motion.samples) ? motion.samples : 8,
  } };
}

/**
 * Smooth slow motion by frame blending (`speed-retime.Smooth slow motion`): where the clip plays below 1× and the
 * source position falls between two source frames, the next frame is mixed in by the fractional position. `flow`
 * renders as blending wherever optical-flow frames are not available.
 */
function frameBlend(context: Context, element: Record<string, any>, clip: ReturnType<typeof retimeClipOf>, assetId: string, elementId: string, clipTime: number, sourceTime: number): LayerItem["blendSource"] {
  const smooth = element.retime?.smooth;
  if (smooth !== "blend" && smooth !== "flow") return null;
  // Optical-flow frames are not synthesised by this build on any backend: such a clip is blended, and says so.
  if (smooth === "flow") context.diagnose({ id: "engine/flow-fallback", severity: "caution", message: `element ${elementId} is set to optical flow and is rendered with frame blending`, elementId });
  const fps = context.document.media.assets.find((asset) => asset.id === assetId)?.fps;
  if (!fps || !(fps.numerator > 0) || !(fps.denominator > 0)) return null;
  const frame = frameDuration(context.document.settings.fps);
  // Slower than 1×: the source advances less than a frame of the timeline over one.
  const to = Math.min(clipTime + frame, clip.duration), from = Math.max(to - frame, 0);
  if (!(Math.abs(sourceTimeAt(clip, to) - sourceTimeAt(clip, from)) < to - from)) return null;
  const position = (mediaTimeToSeconds(sourceTime) * fps.numerator) / fps.denominator;
  let mix = position - Math.floor(position + 1e-6);
  // A reversed clip moves towards the earlier frame: the pair is the same, the weight is what it is.
  mix = Math.round(Math.min(Math.max(mix, 0), 1) * 1024) / 1024;
  if (mix < 1 / 512 || mix > 1 - 1 / 512) return null;
  return { textureId: want(context, { id: `video:${elementId}:next`, kind: "video", assetId, elementId, sourceTime, next: true }), mix };
}

/** Background items for a frame time: the per-clip background of the visible main-track element, else the default. */
function backgroundItems(context: Context, root: RootNode, time: number, forElementId?: string): { items: FrameItem[]; transparent: boolean } {
  const backgrounds = root.children.filter((node): node is BackgroundNode => "background" in node);
  const own = backgrounds.find((node) => node.elementId !== null && (forElementId ? node.elementId === forElementId : visibleAt(node, time)));
  const chosen = own ?? backgrounds.find((node) => node.elementId === null);
  if (!chosen) return { items: [], transparent: root.transparent };
  const { render } = context;
  const quad = fullCanvas(render);
  const background = chosen.background;
  if (background.kind === "color") {
    const rgba = parseHexColor(background.color);
    return { items: [layerItem(want(context, { id: colorId(rgba), kind: "color", rgba }), quad, boxInverse(quad))], transparent: false };
  }
  const black = layerItem(want(context, { id: colorId([0, 0, 0, 1]), kind: "color", rgba: [0, 0, 0, 1] }), quad, boxInverse(quad));
  if (background.kind === "gradient") {
    const parsed = parseGradient(background.css);
    if (parsed.skipped > 0 && parsed.layers.length > 0) context.diagnose({ id: "scene/background-layer-skipped", severity: "caution", message: "a layer of the background gradient is not supported and was skipped", details: { skipped: parsed.skipped } });
    if (parsed.layers.length === 0) {
      context.diagnose({ id: "scene/background-unparsable", severity: "caution", message: "the background gradient could not be read; the background is black" });
      return { items: [black], transparent: false };
    }
    // Rasterised at the render size and cached by the string and the size.
    const id = `gradient:${fnv1a(background.css).toString(16)}:${background.css.length}:${render.width}x${render.height}`;
    return { items: [black, layerItem(want(context, { id, kind: "gradient", css: background.css, width: render.width, height: render.height }), quad, boxInverse(quad))], transparent: false };
  }
  if (background.kind === "image") {
    const size = assetSize(context.document, background.mediaId);
    if (!size) return { items: [black], transparent: false };
    const fitted = background.fit === "stretch" ? render : coverFit(size, render);
    const imageQuad = { ...quad, width: fitted.width, height: fitted.height };
    return { items: [black, layerItem(want(context, { id: `image:${background.mediaId}:2048`, kind: "image", assetId: background.mediaId, maxLongSide: 2048 }), imageQuad, boxInverse(imageQuad))], transparent: false };
  }
  if (background.kind === "blur") {
    // A cover-fit copy of the current frame of the main-track element, blurred with sigma intensity / 5 × s.
    const main = root.children.find((node): node is ElementNode => "element" in node && node.zone === "main" && (forElementId ? node.elementId === forElementId : visibleAt(node, time)));
    const copy = main && main.type !== "Compound" ? elementLayer(context, main, Math.min(Math.max(time - main.startTime, 0), main.duration - 1), [], MAX_COMPOUND_DEPTH, []) : null;
    if (!copy) return { items: [black], transparent: false };
    const visible = { width: copy.transform.width, height: copy.transform.height };
    const fitted = coverFit(visible, render);
    const blurQuad = { ...quad, width: fitted.width, height: fitted.height };
    const passes = gaussianBlurPasses((background.blurIntensity / 5) * pixelScaleFactor(render));
    return { items: [black, layerItem(copy.textureId, blurQuad, boxInverse(blurQuad), { crop: copy.crop, effectPassGroups: passes.length ? [passes] : [] })], transparent: false };
  }
  return { items: [], transparent: true };
}

function transitionItem(context: Context, root: RootNode, node: TransitionNode, time: number, depth: number, chain: string[], items: FrameItem[]): FrameItem | null {
  const frame = frameDuration(context.document.settings.fps);
  // Outside its own range a side holds its nearest frame: A its last, B its first.
  const side = (element: ElementNode) => elementLayer(context, element, Math.min(Math.max(time - element.startTime, 0), Math.max(0, element.duration - frame)), items, depth, chain);
  const from = side(node.from), to = side(node.to);
  if (!from || !to) return null;
  if (time >= node.from.startTime + node.from.duration || time < node.to.startTime) {
    context.diagnose({ id: "scene/transition-held-frame", severity: "caution", message: `transition ${node.transitionId} holds a frame of a clip without handle material`, details: { transitionId: node.transitionId } });
  }
  const linear = (time - node.windowStart) / node.windowDuration;
  const progress = (TRANSITION_EASING[node.easing] ?? TRANSITION_EASING["ease-in-out"])(Math.min(Math.max(linear, 0), 1));
  const { shader, uniforms, postPasses } = transitionShader(node.shader, node.params, progress, { seconds: mediaTimeToSeconds(time - node.windowStart), frame: mediaTimeToFrame(time, context.document.settings.fps), scale: pixelScaleFactor(context.render) });
  // On the main track of a presented scene each input carries its own background, so the shader combines two full pictures.
  const withBackground = node.zone === "main" && root.children.some((child) => "background" in child);
  return {
    type: "transition", from, to, shader, uniforms, progress, postPasses, blendModeFrom: from.blendMode, blendModeTo: to.blendMode,
    fromBackground: withBackground ? backgroundItems(context, root, time, node.from.elementId).items : null,
    toBackground: withBackground ? backgroundItems(context, root, time, node.to.elementId).items : null,
  };
}

function sceneItems(context: Context, root: RootNode, time: number, depth: number, chain: string[]): { items: FrameItem[]; transparent: boolean } {
  const transitions = root.children.filter((node): node is TransitionNode => node.type === "Transition" && time >= node.windowStart && time - node.windowStart < node.windowDuration);
  const inTransition = new Set(transitions.flatMap((node) => [node.from.elementId, node.to.elementId]));
  const mainTransition = transitions.some((node) => node.zone === "main");
  const background = backgroundItems(context, root, time);
  // Under a main-track transition window no separate background is drawn: each input carries its own.
  const items: FrameItem[] = mainTransition ? [] : [...background.items];
  for (const node of root.children) {
    if ("background" in node) continue;
    if (node.type === "Transition") {
      if (!transitions.includes(node)) continue;
      const item = transitionItem(context, root, node, time, depth, chain, items);
      if (item) items.push(item);
      continue;
    }
    if (inTransition.has(node.elementId) || !visibleAt(node, time)) continue;
    const clipTime = time - node.startTime;
    if (node.type === "EffectLayer" || node.type === "AdjustmentLayer") {
      const groups = effectGroups(context, node.element, clipTime);
      const quad = fullCanvas(context.render);
      const opacity = node.type === "AdjustmentLayer" ? resolveNumber(node.element, "opacity", clipTime, 1) : 1;
      const color = node.type === "AdjustmentLayer" ? chainOf(context, node.element, clipTime, node.elementId) : null;
      // A standalone filter is an effect element whose one entry has kind `filter`.
      const filter = filterOf(context, node.element, clipTime);
      if (groups.length > 0 || color || filter) items.push({ type: "sceneEffect", effectPassGroups: groups, color, filter, masks: maskItems(context, node, quad, clipTime), opacity });
      continue;
    }
    const layer = elementLayer(context, node, clipTime, items, depth, chain);
    if (layer) items.push(layer);
    if (layer && node.type === "Caption") { const second = elementLayer(context, node, clipTime, items, depth, chain, true); if (second) items.push(second); }
    else if (node.type !== "Compound") context.undrawn.push({ elementId: node.elementId, type: node.type });
  }
  return { items, transparent: background.transparent && !mainTransition };
}

/** Flattens the frame of a scene at a time into a descriptor and the list of textures it needs. */
export function buildFrame(options: FrameOptions): BuiltFrame {
  const context: Context = { ...options, textures: new Map(), layouts: new Map(), undrawn: [], diagnose: options.diagnose ?? (() => undefined), roots: new Map() };
  const root = rootOf(context, options.sceneId, false);
  const { items, transparent } = sceneItems(context, root, options.time, 0, [options.sceneId]);
  return {
    descriptor: { version: 3, width: options.render.width, height: options.render.height, clear: { color: transparent ? [0, 0, 0, 0] : [0, 0, 0, 1] }, items },
    textures: [...context.textures.values()], layouts: context.layouts, undrawn: context.undrawn,
  };
}
