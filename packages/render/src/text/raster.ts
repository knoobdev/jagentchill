import type { Wasm } from "../engine/wasm.ts";
import { bubbleBox, type MeasuredText, type TextSpec } from "./layout.ts";
import { glitchOf, motionUnits, unitPose, type UnitKind, type UnitPose } from "./motion.ts";
import type { Box, PlacedGlyph } from "./units.ts";

/**
 * Rasterises a laid-out text from its glyph outlines. Canvas2D is used as a polygon rasteriser only (`Path2D`
 * fills and strokes): no `fillText`, `strokeText` or `measureText` is called anywhere.
 */

const PATHS = new Map<string, Path2D | null>();
/** Outline of a glyph in em units, fetched from the font tables once per font and glyph. */
function glyphPath(wasm: Wasm, fontId: string, glyph: number): Path2D | null {
  const key = `${fontId}\n${glyph}`;
  let path = PATHS.get(key);
  if (path === undefined) {
    const data = (wasm.glyphPaths({ fontId, glyphIds: [glyph] }) as string[])[0];
    path = data ? new Path2D(data) : null;
    PATHS.set(key, path);
  }
  return path;
}

type Context = OffscreenCanvasRenderingContext2D;
type Rgba = [number, number, number, number];
type Stops = [number, Rgba][];
type PaintOp =
  | { op: "outline"; path: string } | { op: "solid"; color: Rgba }
  | { op: "linear"; points: number[]; stops: Stops } | { op: "radial"; circles: number[]; stops: Stops } | { op: "sweep"; center: number[]; angles: number[]; stops: Stops }
  | { op: "pushClip" } | { op: "pushClipBox"; rect: number[] } | { op: "popClip" } | { op: "pushLayer"; mode: string } | { op: "popLayer" }
  | { op: "pushTransform"; matrix: number[] } | { op: "popTransform" };
type GlyphPaint = { unitsPerEm: number; ops: PaintOp[] };

const PAINTS = new Map<string, GlyphPaint | null>();
/** The paint program of a colour glyph (`COLR`), or `null` for a glyph drawn from its outline. */
function glyphPaint(wasm: Wasm, fontId: string, glyph: number): GlyphPaint | null {
  const key = `${fontId}\n${glyph}`;
  let paint = PAINTS.get(key);
  if (paint === undefined) {
    const reader = (wasm as { glyphPaint?: (options: { fontId: string; glyphId: number }) => GlyphPaint | undefined }).glyphPaint;
    paint = reader?.({ fontId, glyphId: glyph }) ?? null;
    PAINTS.set(key, paint);
  }
  return paint;
}

const css = ([r, g, b, a]: Rgba): string => `rgba(${r},${g},${b},${a / 255})`;
/** Canvas composite operations by `COLR` composite mode. */
const COMPOSITE: Record<string, GlobalCompositeOperation> = {
  Clear: "destination-out", Source: "copy", Destination: "destination-over", SourceOver: "source-over", DestinationOver: "destination-over", SourceIn: "source-in", DestinationIn: "destination-in",
  SourceOut: "source-out", DestinationOut: "destination-out", SourceAtop: "source-atop", DestinationAtop: "destination-atop", Xor: "xor", Plus: "lighter", Screen: "screen", Overlay: "overlay",
  Darken: "darken", Lighten: "lighten", ColorDodge: "color-dodge", ColorBurn: "color-burn", HardLight: "hard-light", SoftLight: "soft-light", Difference: "difference", Exclusion: "exclusion",
  Multiply: "multiply", Hue: "hue", Saturation: "saturation", Color: "color", Luminosity: "luminosity",
};

/** Replays a paint program into a context whose space is font units with y up. */
function replay(target: Context, paint: GlyphPaint): void {
  const layers: { context: Context; mode: string }[] = [];
  let context = target, outline = new Path2D();
  const reach = paint.unitsPerEm * 8;
  const fill = (style: string | CanvasGradient) => { context.fillStyle = style; context.fillRect(-reach, -reach, reach * 2, reach * 2); };
  const stopped = <T extends CanvasGradient>(gradient: T, stops: Stops, map: (offset: number) => number = (offset) => offset): T => {
    for (const [offset, color] of stops) gradient.addColorStop(Math.min(Math.max(map(offset), 0), 1), css(color));
    return gradient;
  };
  for (const op of paint.ops) {
    if (op.op === "outline") outline = new Path2D(op.path);
    else if (op.op === "pushClip") { context.save(); context.clip(outline); }
    else if (op.op === "pushClipBox") { context.save(); const [x0, y0, x1, y1] = op.rect; const box = new Path2D(); box.rect(x0, y0, x1 - x0, y1 - y0); context.clip(box); }
    else if (op.op === "popClip" || op.op === "popTransform") context.restore();
    else if (op.op === "pushTransform") { context.save(); const [a, b, c, d, e, f] = op.matrix; context.transform(a, b, c, d, e, f); }
    else if (op.op === "solid") fill(css(op.color));
    else if (op.op === "linear") {
      // The third point turns the gradient: the second is projected onto the normal of p0 → p2 through p0.
      const [x0, y0, x1, y1, x2, y2] = op.points;
      const nx = y2 - y0, ny = -(x2 - x0), length = nx * nx + ny * ny;
      const along = length > 0 ? ((x1 - x0) * nx + (y1 - y0) * ny) / length : 0;
      const [ex, ey] = length > 0 ? [x0 + nx * along, y0 + ny * along] : [x1, y1];
      if (op.stops.length > 0) fill(ex === x0 && ey === y0 ? css(op.stops[op.stops.length - 1][1]) : stopped(context.createLinearGradient(x0, y0, ex, ey), op.stops));
    } else if (op.op === "radial") {
      const [x0, y0, r0, x1, y1, r1] = op.circles;
      if (op.stops.length > 0) fill(stopped(context.createRadialGradient(x0, y0, Math.max(r0, 0), x1, y1, Math.max(r1, 0)), op.stops));
    } else if (op.op === "sweep") {
      const [start, end] = op.angles, span = (end - start) / 360;
      if (op.stops.length > 0) fill(stopped(context.createConicGradient((start * Math.PI) / 180, op.center[0], op.center[1]), op.stops, (offset) => offset * span));
    } else if (op.op === "pushLayer") {
      const canvas = new OffscreenCanvas(target.canvas.width, target.canvas.height);
      const layer = canvas.getContext("2d")!;
      layer.setTransform(context.getTransform());
      layers.push({ context, mode: op.mode });
      context = layer;
    } else if (op.op === "popLayer") {
      const below = layers.pop();
      if (!below) continue;
      below.context.save();
      below.context.setTransform(1, 0, 0, 1, 0, 0);
      below.context.globalCompositeOperation = COMPOSITE[below.mode] ?? "source-over";
      below.context.drawImage(context.canvas, 0, 0);
      below.context.restore();
      context = below.context;
    }
  }
}

type ColourGlyph = { canvas: OffscreenCanvas; /** px per em of the bitmap. */ size: number };
const COLOUR_GLYPHS = new Map<string, ColourGlyph>();
/** A colour glyph has room for 0.3 em around its em square: the origin sits at (0.3, 1.3) em of the bitmap. */
const COLOUR_PAD = 0.3;
/** The bitmap of a colour glyph at a pixel size (a power of two at or above the drawn size), drawn once. */
function colourGlyph(paint: GlyphPaint, fontId: string, glyph: number, pixels: number): ColourGlyph {
  const size = Math.min(1024, Math.max(16, 2 ** Math.ceil(Math.log2(Math.max(pixels, 1)))));
  const key = `${fontId}\n${glyph}\n${size}`;
  let entry = COLOUR_GLYPHS.get(key);
  if (!entry) {
    const side = Math.ceil(size * (1 + 2 * COLOUR_PAD));
    const canvas = new OffscreenCanvas(side, side);
    const context = canvas.getContext("2d")!;
    context.translate(size * COLOUR_PAD, size * (1 + COLOUR_PAD));
    context.scale(size / paint.unitsPerEm, -size / paint.unitsPerEm);
    replay(context, paint);
    if (COLOUR_GLYPHS.size > 512) COLOUR_GLYPHS.clear();
    COLOUR_GLYPHS.set(key, entry = { canvas, size });
  }
  return entry;
}

/** Canvas size of a measured text: its texture at the raster scale. */
export const rasterSize = (measured: MeasuredText): { width: number; height: number } => ({ width: Math.max(1, Math.round(measured.width * measured.scale)), height: Math.max(1, Math.round(measured.height * measured.scale)) });

export function rasterText(wasm: Wasm, spec: TextSpec, measured: MeasuredText): OffscreenCanvas {
  const { layout, originX, originY, block, placement } = measured;
  const k = measured.scale, { width, height } = rasterSize(measured);
  const range = (cluster: number) => spec.ranges?.find((entry) => cluster >= entry.start && cluster < entry.end);
  /** A canvas of the texture size whose space is layout px. */
  const surface = (): { canvas: OffscreenCanvas; context: Context } => {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d")!;
    context.setTransform(k, 0, 0, k, 0, 0);
    return { canvas, context };
  };
  /** Draws a canvas of the texture size pixel for pixel, moved by layout px. */
  const blit = (context: Context, canvas: OffscreenCanvas, dx = 0, dy = 0) => { context.save(); context.setTransform(1, 0, 0, 1, 0, 0); context.drawImage(canvas, dx * k, dy * k); context.restore(); };

  // The animated unit kind (one slot runs at a time) and the pose of each of its units.
  const kind: UnitKind | undefined = spec.motion ? motionUnits(spec.motion)[0] : undefined;
  const boxWidth = spec.maxWidth ?? layout.width;
  const poses = new Map<number, UnitPose>();
  const poseOf = (placed: PlacedGlyph): { pose: UnitPose; box: Box } | undefined => {
    if (!kind || !spec.motion) return undefined;
    const index = placed[kind];
    let pose = poses.get(index);
    if (!pose) poses.set(index, pose = unitPose(spec.motion, kind, index, placement.counts[kind], spec.size, boxWidth));
    return { pose, box: placement.boxes[kind][index] };
  };
  /** Box of the glyphs of a caption range on one line, the pivot of its scale and the extent of its fill. */
  const rangeBoxes = new Map<string, Box>();
  for (const placed of placement.glyphs) {
    const entry = range(placed.glyph.cluster);
    if (!entry || (entry.scale === undefined && !entry.fill)) continue;
    const key = `${entry.start}:${placed.line}`, line = layout.lines[placed.line], before = rangeBoxes.get(key);
    const x0 = placed.glyph.x, x1 = placed.glyph.x + placed.glyph.advance;
    rangeBoxes.set(key, before ? { ...before, x0: Math.min(before.x0, x0), x1: Math.max(before.x1, x1) } : { x0, x1, y0: line.baseline - line.ascent, y1: line.baseline + line.descent });
  }
  const transformed = spec.motion !== undefined || (spec.curve ?? 0) !== 0 || rangeBoxes.size > 0;

  /** Runs `draw` in the space of one placed glyph's unit: layout px, after its curve move, pose and range scale. */
  const inUnit = (context: Context, placed: PlacedGlyph, draw: (opacity: number) => void) => {
    const posed = poseOf(placed);
    if (posed && posed.pose.opacity <= 0) return;
    context.save();
    context.translate(originX, originY);
    if (placed.curve) { context.translate(placed.curve.x, placed.curve.y); context.rotate(placed.curve.angle); context.translate(-placed.curve.pivotX, -placed.curve.pivotY); }
    if (posed) {
      const { pose, box } = posed, px = (box.x0 + box.x1) / 2, py = (box.y0 + box.y1) / 2;
      context.translate(px + pose.dx, py + pose.dy);
      context.rotate((pose.rotate * Math.PI) / 180);
      context.scale(pose.scale, pose.scale);
      context.translate(-px, -py);
    }
    const entry = range(placed.glyph.cluster);
    if (entry?.scale !== undefined && entry.scale !== 1) {
      const box = rangeBoxes.get(`${entry.start}:${placed.line}`)!, px = (box.x0 + box.x1) / 2, py = (box.y0 + box.y1) / 2;
      context.translate(px, py);
      context.scale(entry.scale, entry.scale);
      context.translate(-px, -py);
    }
    draw(posed?.pose.opacity ?? 1);
    context.restore();
  };
  /** Draws every outline glyph with `draw`, positioned and scaled to the font size. */
  const eachGlyph = (context: Context, draw: (path: Path2D, cluster: number, placed: PlacedGlyph) => void) => {
    for (const placed of placement.glyphs) {
      if (range(placed.glyph.cluster)?.hidden || glyphPaint(wasm, placed.fontId, placed.glyph.id)) continue;
      const path = glyphPath(wasm, placed.fontId, placed.glyph.id);
      if (!path) continue;
      inUnit(context, placed, (opacity) => {
        context.globalAlpha = opacity;
        context.translate(placed.glyph.x, placed.glyph.y);
        context.scale(spec.size, spec.size);
        draw(path, placed.glyph.cluster, placed);
      });
    }
  };
  /** Draws the colour glyphs (emoji) from their paint programs, at the same glyph positions. */
  const colourGlyphs = (context: Context) => {
    for (const placed of placement.glyphs) {
      if (range(placed.glyph.cluster)?.hidden) continue;
      const paint = glyphPaint(wasm, placed.fontId, placed.glyph.id);
      if (!paint) continue;
      const bitmap = colourGlyph(paint, placed.fontId, placed.glyph.id, spec.size * k);
      inUnit(context, placed, (opacity) => {
        context.globalAlpha = opacity;
        const side = spec.size * (1 + 2 * COLOUR_PAD);
        context.imageSmoothingQuality = "high";
        context.drawImage(bitmap.canvas, placed.glyph.x - spec.size * COLOUR_PAD, placed.glyph.y - spec.size * (1 + COLOUR_PAD), side, side);
      });
    }
  };
  const fillStyle = (context: Context): string | CanvasGradient => {
    if (!spec.gradient) return spec.color;
    // A two-stop linear gradient across the text block bounds; 0° points up, angles grow clockwise.
    const radians = (spec.gradient.angle * Math.PI) / 180;
    const dx = Math.sin(radians), dy = -Math.cos(radians);
    const half = (Math.abs(block.width * dx) + Math.abs(block.height * dy)) / 2;
    const cx = originX + block.x + block.width / 2, cy = originY + block.y + block.height / 2;
    const gradient = context.createLinearGradient(cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half);
    gradient.addColorStop(0, spec.color);
    gradient.addColorStop(1, spec.gradient.color);
    return gradient;
  };

  // Fill plus stroke on their own canvas: the shadow and the glow are cast by the two together.
  const { canvas: ink, context: inkContext } = surface();
  inkContext.lineJoin = "round";
  const strokeGlyphs = () => {
    inkContext.strokeStyle = spec.stroke!.color;
    eachGlyph(inkContext, (path) => {
      // The line width is in em units inside the glyph transform.
      inkContext.lineWidth = ((spec.stroke!.position === "outside" ? 2 : 1) * spec.stroke!.width) / spec.size;
      inkContext.stroke(path);
    });
  };
  if (spec.stroke && spec.stroke.width > 0 && spec.stroke.position === "outside") strokeGlyphs();
  const base = fillStyle(inkContext);
  if (spec.gradient) {
    // The gradient spans the block, so it is set in canvas space and the glyphs are filled through a clip.
    const { canvas: glyphs, context: glyphContext } = surface();
    glyphContext.fillStyle = "#000000";
    eachGlyph(glyphContext, (path) => glyphContext.fill(path));
    glyphContext.globalCompositeOperation = "source-in";
    glyphContext.globalAlpha = 1;
    glyphContext.fillStyle = base;
    glyphContext.fillRect(0, 0, measured.width, measured.height);
    blit(inkContext, glyphs);
  } else {
    eachGlyph(inkContext, (path, cluster, placed) => {
      const entry = range(cluster);
      inkContext.fillStyle = entry?.color ?? spec.color;
      inkContext.fill(path);
      if (entry?.fill && entry.fill.progress > 0) {
        // Karaoke: the word is filled again in the highlight colour through a clip that grows from its left edge.
        const box = rangeBoxes.get(`${entry.start}:${placed.line}`)!;
        const clip = new Path2D();
        clip.rect((box.x0 - placed.glyph.x) / spec.size - 1, -4, ((box.x1 - box.x0) * Math.min(entry.fill.progress, 1)) / spec.size + 1, 8);
        inkContext.save();
        inkContext.clip(clip);
        inkContext.fillStyle = entry.fill.color;
        inkContext.fill(path);
        inkContext.restore();
      }
    });
  }
  colourGlyphs(inkContext);
  inkContext.globalAlpha = 1;
  // Decorations: underline and strikethrough, per line; a range may underline its own words.
  const thickness = Math.max(1, spec.size * 0.06);
  const underlineY = spec.size * 0.12, strikeY = -spec.size * 0.28;
  if (transformed) {
    // Moved units carry their own piece of the line, a hair wider than the advance so that the pieces join.
    for (const placed of placement.glyphs) {
      const entry = range(placed.glyph.cluster), baseline = layout.lines[placed.line].baseline;
      if (entry?.hidden || !(spec.underline || spec.strikethrough || entry?.underline)) continue;
      inUnit(inkContext, placed, (opacity) => {
        inkContext.globalAlpha = opacity;
        const piece = (y: number, color: string) => { inkContext.fillStyle = color; inkContext.fillRect(placed.glyph.x - 0.25, baseline + y - thickness / 2, placed.glyph.advance + 0.5, thickness); };
        if (spec.underline) piece(underlineY, spec.color);
        if (spec.strikethrough) piece(strikeY, spec.color);
        if (entry?.underline) piece(underlineY, entry.underlineColor ?? entry.color ?? spec.color);
      });
    }
    inkContext.globalAlpha = 1;
  } else {
    for (const line of layout.lines) {
      const decorate = (from: number, to: number, y: number, color: string) => { inkContext.fillStyle = color; inkContext.fillRect(originX + from, originY + y - thickness / 2, to - from, thickness); };
      if (spec.underline) decorate(line.x, line.x + line.width, line.baseline + underlineY, spec.color);
      if (spec.strikethrough) decorate(line.x, line.x + line.width, line.baseline + strikeY, spec.color);
      for (const run of line.runs) for (const glyph of run.glyphs) if (range(glyph.cluster)?.underline) decorate(glyph.x, glyph.x + glyph.advance, line.baseline + underlineY, range(glyph.cluster)?.underlineColor ?? range(glyph.cluster)?.color ?? spec.color);
    }
  }
  if (spec.stroke && spec.stroke.width > 0 && spec.stroke.position === "center") strokeGlyphs();
  inkContext.globalAlpha = 1;

  if (kind === "line" && spec.motion) {
    // Wipes and the scroll keep only a part of each line: the ink is cut to the visible parts, line by line.
    const keep = new Path2D();
    const scroll = spec.motion.loop?.id === "loop-scroll";
    layout.lines.forEach((line, index) => {
      const pose = poses.get(index) ?? unitPose(spec.motion!, "line", index, placement.counts.line, spec.size, boxWidth);
      // A line owns the band from half-way to the line above to half-way to the line below.
      const above = index === 0 ? -originY : (layout.lines[index - 1].baseline + layout.lines[index - 1].descent + line.baseline - line.ascent) / 2;
      const below = index === layout.lines.length - 1 ? measured.height : (line.baseline + line.descent + layout.lines[index + 1].baseline - layout.lines[index + 1].ascent) / 2;
      let from = -originX, to = measured.width;
      if (pose.reveal) {
        const [start, end] = pose.reveal;
        if (start >= end) return;
        if (start > 0) from = line.x + line.width * start;
        if (end < 1) to = line.x + line.width * end;
      }
      if (scroll) { const centre = layout.width / 2; from = Math.max(from, centre - boxWidth / 2); to = Math.min(to, centre + boxWidth / 2); }
      keep.rect(originX + from, originY + above, to - from, below - above);
    });
    inkContext.save();
    inkContext.globalCompositeOperation = "destination-in";
    inkContext.fillStyle = "#000000";
    inkContext.fill(keep);
    inkContext.restore();
  }

  const { canvas, context } = surface();
  /** The ink's silhouette in one colour. */
  const tinted = (color: string): OffscreenCanvas => {
    const out = new OffscreenCanvas(width, height);
    const tint = out.getContext("2d")!;
    tint.drawImage(ink, 0, 0);
    tint.globalCompositeOperation = "source-in";
    tint.fillStyle = color;
    tint.fillRect(0, 0, width, height);
    return out;
  };
  // Back to front: shadow, glow, bubble or background, then the ink (outside stroke, fill, decorations, centre stroke).
  if (spec.shadow) {
    const radians = (spec.shadow.angle * Math.PI) / 180;
    context.save();
    context.globalAlpha = spec.shadow.opacity;
    context.filter = spec.shadow.blur > 0 ? `blur(${(spec.shadow.blur / 2) * k}px)` : "none";
    blit(context, tinted(spec.shadow.color), Math.cos(radians) * spec.shadow.distance, -Math.sin(radians) * spec.shadow.distance);
    context.restore();
  }
  if (spec.glow && spec.glow.intensity > 0) {
    const silhouette = tinted(spec.glow.color);
    context.save();
    context.globalCompositeOperation = "lighter";
    context.filter = `blur(${spec.glow.sigma * k}px)`;
    // Multiplied by intensity / 50 and clamped: whole copies, then the remainder.
    let remaining = spec.glow.intensity / 50;
    while (remaining > 0) { context.globalAlpha = Math.min(1, remaining); blit(context, silhouette); remaining -= 1; }
    context.restore();
  }
  if (spec.bubble) {
    // The catalogue path, scaled on each axis so that its text area holds the block; the stroke keeps its width.
    const box = bubbleBox(spec.bubble, block);
    const matrix = spec.bubble.flip
      ? new DOMMatrix([-box.scaleX, 0, 0, box.scaleY, originX + box.x + 100 * box.scaleX, originY + box.y])
      : new DOMMatrix([box.scaleX, 0, 0, box.scaleY, originX + box.x, originY + box.y]);
    const path = new Path2D();
    path.addPath(new Path2D(spec.bubble.path), matrix);
    if (!spec.bubble.strokeOnly) { context.fillStyle = spec.bubble.color; context.fill(path, "evenodd"); }
    if (spec.bubble.strokeWidth > 0) { context.lineJoin = "round"; context.lineCap = "round"; context.strokeStyle = spec.bubble.strokeColor; context.lineWidth = spec.bubble.strokeWidth; context.stroke(path); }
  } else if (spec.background) {
    const { paddingX, paddingY, offsetX, offsetY, cornerRadius, color } = spec.background;
    const x = originX + block.x - paddingX + offsetX, y = originY + block.y - paddingY + offsetY, w = block.width + 2 * paddingX, h = block.height + 2 * paddingY;
    const path = new Path2D();
    path.roundRect(x, y, w, h, (cornerRadius / 100) * (Math.min(w, h) / 2));
    context.fillStyle = color;
    context.fill(path);
  }
  // Boxes behind highlighted words.
  for (const placed of placement.glyphs) {
    const box = range(placed.glyph.cluster)?.box;
    if (!box) continue;
    const line = layout.lines[placed.line];
    inUnit(context, placed, () => {
      context.fillStyle = box;
      context.fillRect(placed.glyph.x - 1, line.baseline - line.ascent, placed.glyph.advance + 2, line.ascent + line.descent);
    });
  }
  blit(context, ink);

  const glitch = glitchOf(spec.motion, spec.size);
  return glitch ? glitched(canvas, glitch.channel * k, glitch.slices.map((shift) => shift * k)) : canvas;
}

/** The glitch burst: six horizontal slices shifted sideways, the red and the blue channel pulled apart. */
function glitched(source: OffscreenCanvas, channel: number, slices: number[]): OffscreenCanvas {
  const { width, height } = source;
  const sliced = new OffscreenCanvas(width, height);
  const slicer = sliced.getContext("2d")!;
  const band = height / slices.length;
  slices.forEach((shift, index) => {
    const top = Math.round(index * band), bottom = index === slices.length - 1 ? height : Math.round((index + 1) * band);
    if (bottom > top) slicer.drawImage(source, 0, top, width, bottom - top, shift, top, width, bottom - top);
  });
  const out = new OffscreenCanvas(width, height);
  const context = out.getContext("2d")!;
  context.globalCompositeOperation = "lighter";
  /** One colour channel of the sliced picture, with its coverage. */
  const part = (mask: string, dx: number) => {
    const canvas = new OffscreenCanvas(width, height);
    const one = canvas.getContext("2d")!;
    one.drawImage(sliced, 0, 0);
    one.globalCompositeOperation = "multiply";
    one.fillStyle = mask;
    one.fillRect(0, 0, width, height);
    one.globalCompositeOperation = "destination-in";
    one.drawImage(sliced, 0, 0);
    context.drawImage(canvas, dx, 0);
  };
  part("#ff0000", channel);
  part("#00ff00", 0);
  part("#0000ff", -channel);
  return out;
}
