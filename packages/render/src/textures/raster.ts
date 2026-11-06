import type { LayerQuad } from "../resolve/layout.ts";

/**
 * Rasterisation of graphics and mask shapes into canvases. Canvas2D is used only as a polygon rasteriser for
 * these textures; compositing happens in the wasm compositor.
 */

function polygon(path: Path2D, points: [number, number][]): void {
  points.forEach(([x, y], index) => (index === 0 ? path.moveTo(x, y) : path.lineTo(x, y)));
  path.closePath();
}

function roundedRect(path: Path2D, x: number, y: number, width: number, height: number, radius: number): void {
  const r = Math.min(Math.max(radius, 0), width / 2, height / 2);
  if (r <= 0) { path.rect(x, y, width, height); return; }
  path.moveTo(x + r, y);
  path.arcTo(x + width, y, x + width, y + height, r);
  path.arcTo(x + width, y + height, x, y + height, r);
  path.arcTo(x, y + height, x, y, r);
  path.arcTo(x, y, x + width, y, r);
  path.closePath();
}

/** The outline of a shape inside the box `[−w/2, w/2] × [−h/2, h/2]`. */
export function shapePath(shape: string, width: number, height: number, params: Record<string, unknown>): Path2D | null {
  const path = new Path2D();
  const number = (key: string, fallback: number) => (typeof params[key] === "number" ? params[key] as number : fallback);
  const hw = width / 2, hh = height / 2;
  if (shape === "rectangle") roundedRect(path, -hw, -hh, width, height, (number("cornerRadius", 0) / 100) * Math.min(hw, hh));
  else if (shape === "ellipse") path.ellipse(0, 0, hw, hh, 0, 0, Math.PI * 2);
  else if (shape === "diamond") polygon(path, [[0, -hh], [hw, 0], [0, hh], [-hw, 0]]);
  else if (shape === "polygon" || shape === "star") {
    const count = Math.round(number(shape === "star" ? "points" : "sides", 5));
    const inner = shape === "star" ? (params.innerRatio !== undefined ? number("innerRatio", 0.45) : 1 - number("depth", 45) / 100) : 1;
    const points: [number, number][] = [];
    for (let index = 0; index < count * (shape === "star" ? 2 : 1); index++) {
      const angle = -Math.PI / 2 + (index * Math.PI * 2) / (count * (shape === "star" ? 2 : 1));
      const radius = shape === "star" && index % 2 === 1 ? inner : 1;
      points.push([Math.cos(angle) * hw * radius, Math.sin(angle) * hh * radius]);
    }
    polygon(path, points);
  } else return null;
  return path;
}

/**
 * The arrow outline inside the box `[−w/2, w/2] × [−h/2, h/2]`, pointing right: a shaft `shaftWidth` % of the height
 * thick and a head as high as the box and `headSize` % of the height long, at one end or at both.
 */
export function arrowPath(width: number, height: number, params: Record<string, unknown>): Path2D {
  const number = (key: string, fallback: number) => (typeof params[key] === "number" ? params[key] as number : fallback);
  const double = params.doubleHeaded === true;
  const hw = width / 2, hh = height / 2;
  const head = Math.min((Math.min(Math.max(number("headSize", 40), 10), 90) / 100) * height, double ? width / 2 : width);
  const shaft = ((Math.min(Math.max(number("shaftWidth", 30), 5), 90) / 100) * height) / 2;
  const path = new Path2D();
  const points: [number, number][] = double
    ? [[-hw, 0], [-hw + head, -hh], [-hw + head, -shaft], [hw - head, -shaft], [hw - head, -hh], [hw, 0], [hw - head, hh], [hw - head, shaft], [-hw + head, shaft], [-hw + head, hh]]
    : [[-hw, -shaft], [hw - head, -shaft], [hw - head, -hh], [hw, 0], [hw - head, hh], [hw - head, shaft], [-hw, shaft]];
  polygon(path, points);
  return path;
}

/**
 * A graphic element drawn into a texture of the element's displayed aspect (a square when it is scaled evenly), the
 * shape filling it minus its stroke. `unit` is the px of one shape unit (1/200 of the unscaled shape): the stroke
 * width and the corner radius are laid on after the geometry is scaled, so a stretched shape keeps them undistorted.
 */
export function rasterGraphic(definitionId: string, params: Record<string, unknown>, side: number, height = side, unit = Math.min(side, height) / 200): OffscreenCanvas | null {
  const width = Math.max(1, Math.round(side)), tall = Math.max(1, Math.round(height));
  if (!Number.isFinite(width) || !Number.isFinite(tall)) return null;
  const canvas = new OffscreenCanvas(width, tall);
  const context = canvas.getContext("2d")!;
  const strokeWidth = typeof params.strokeWidth === "number" ? Math.max(params.strokeWidth, 0) * unit : 0;
  context.translate(width / 2, tall / 2);
  if (definitionId === "line") {
    // A line runs along the middle of its box, from edge to edge; round and square caps stay inside the box.
    const thickness = Math.max(strokeWidth, unit), cap = params.lineCap === "butt" || params.lineCap === "square" ? params.lineCap : "round";
    const inset = cap === "butt" ? 0 : Math.min(thickness / 2, width / 2);
    const dash = typeof params.dash === "number" ? Math.max(params.dash, 0) * unit : 0;
    context.strokeStyle = typeof params.stroke === "string" ? params.stroke : "#ffffff";
    context.lineWidth = thickness;
    context.lineCap = cap;
    if (dash > 0) context.setLineDash([dash, dash + (cap === "butt" ? 0 : thickness)]);
    context.beginPath();
    context.moveTo(-width / 2 + inset, 0);
    context.lineTo(width / 2 - inset, 0);
    context.stroke();
    return canvas;
  }
  const inset = params.strokeAlign === "inside" ? 0 : params.strokeAlign === "outside" ? strokeWidth * 2 : strokeWidth;
  const boxWidth = Math.max(width - inset, 1), boxHeight = Math.max(tall - inset, 1);
  let path: Path2D | null;
  if (definitionId === "arrow") path = arrowPath(boxWidth, boxHeight, params);
  else if (definitionId === "rectangle" && width !== tall) {
    // The corner radius is a share of the shorter half side, in px after scaling: the corners stay circular.
    const radius = ((typeof params.cornerRadius === "number" ? params.cornerRadius : 0) / 100) * Math.min(boxWidth, boxHeight);
    path = new Path2D();
    roundedRect(path, -boxWidth / 2, -boxHeight / 2, boxWidth, boxHeight, radius);
  } else path = shapePath(definitionId, boxWidth, boxHeight, params);
  if (!path) return null;
  if (typeof params.fill === "string") { context.fillStyle = params.fill; context.fill(path); }
  if (strokeWidth > 0 && typeof params.stroke === "string") {
    context.lineJoin = definitionId === "arrow" ? "miter" : "round";
    context.strokeStyle = params.stroke;
    context.lineWidth = strokeWidth;
    if (params.strokeAlign === "inside") { context.save(); context.clip(path); context.lineWidth = strokeWidth * 2; context.stroke(path); context.restore(); }
    else context.stroke(path);
  }
  return canvas;
}

export type DrawingStroke = { id?: string; points: [number, number][]; width: number; color: string; brush?: "pen" | "marker" };

/** A centripetal Catmull–Rom spline through the points of a stroke, as cubic Bézier segments. */
export function strokePath(points: readonly (readonly [number, number])[]): Path2D {
  const path = new Path2D();
  if (points.length === 0) return path;
  path.moveTo(points[0][0], points[0][1]);
  if (points.length === 2) { path.lineTo(points[1][0], points[1][1]); return path; }
  const at = (index: number) => points[Math.min(Math.max(index, 0), points.length - 1)];
  for (let index = 0; index < points.length - 1; index++) {
    const p0 = at(index - 1), p1 = at(index), p2 = at(index + 1), p3 = at(index + 2);
    // Knot intervals are the square roots of the chord lengths (alpha = 0.5): no cusps and no loops inside a segment.
    const d1 = Math.sqrt(Math.hypot(p1[0] - p0[0], p1[1] - p0[1])), d2 = Math.sqrt(Math.hypot(p2[0] - p1[0], p2[1] - p1[1])), d3 = Math.sqrt(Math.hypot(p3[0] - p2[0], p3[1] - p2[1]));
    if (d2 < 1e-6) continue;
    const control = (a: readonly [number, number], b: readonly [number, number], c: readonly [number, number], da: number, db: number, sign: number): [number, number] => {
      // Tangent at `b` of the non-uniform spline, scaled to a third of this segment.
      if (da < 1e-6) return [b[0] + (sign * (c[0] - b[0])) / 3, b[1] + (sign * (c[1] - b[1])) / 3];
      const tx = (b[0] - a[0]) / da - (c[0] - a[0]) / (da + db) + (c[0] - b[0]) / db, ty = (b[1] - a[1]) / da - (c[1] - a[1]) / (da + db) + (c[1] - b[1]) / db;
      return [b[0] + (sign * tx * d2) / 3, b[1] + (sign * ty * d2) / 3];
    };
    const c1 = control(p0, p1, p2, d1, d2, 1);
    // At the far end the tangent is taken from the next span, mirrored.
    const far = d3 < 1e-6 ? [p2[0] - (p2[0] - p1[0]) / 3, p2[1] - (p2[1] - p1[1]) / 3] as [number, number]
      : (() => { const tx = (p2[0] - p1[0]) / d2 - (p3[0] - p1[0]) / (d2 + d3) + (p3[0] - p2[0]) / d3, ty = (p2[1] - p1[1]) / d2 - (p3[1] - p1[1]) / (d2 + d3) + (p3[1] - p2[1]) / d3; return [p2[0] - (tx * d2) / 3, p2[1] - (ty * d2) / 3] as [number, number]; })();
    path.bezierCurveTo(c1[0], c1[1], far[0], far[1], p2[0], p2[1]);
  }
  return path;
}

/**
 * A freehand drawing rasterised from its strokes: points are element-local px about the centre of the bounding box.
 * Strokes are drawn in array order with round joins; a pen stroke has round caps and its own alpha, a marker stroke
 * has flat caps and is laid down once at half its alpha, so it does not darken where it crosses itself.
 */
export function rasterDrawing(strokes: readonly DrawingStroke[], intrinsic: { width: number; height: number }, width: number, height: number, colorOverride?: string): OffscreenCanvas | null {
  const w = Math.max(1, Math.round(width)), h = Math.max(1, Math.round(height));
  if (!Number.isFinite(w) || !Number.isFinite(h) || !(intrinsic.width > 0) || !(intrinsic.height > 0)) return null;
  const canvas = new OffscreenCanvas(w, h);
  const context = canvas.getContext("2d")!;
  context.translate(w / 2, h / 2);
  context.scale(w / intrinsic.width, h / intrinsic.height);
  context.lineJoin = "round";
  for (const stroke of strokes) {
    if (!Array.isArray(stroke.points) || stroke.points.length < 2) continue;
    const marker = stroke.brush === "marker";
    context.globalAlpha = marker ? 0.5 : 1;
    context.lineCap = marker ? "butt" : "round";
    context.lineWidth = Math.max(stroke.width, 0.01);
    context.strokeStyle = colorOverride || stroke.color || "#ffffff";
    context.stroke(strokePath(stroke.points));
  }
  return canvas;
}

/** The heart outline of `masks-blending-keying.Box-like masks` in box coordinates (−0.5…0.5), four cubic segments. */
const HEART: [number, number][][] = [
  [[0, 0.5], [-0.2, 0.3], [-0.5, 0.1], [-0.5, -0.15]],
  [[-0.5, -0.15], [-0.5, -0.6], [-0.05, -0.6], [0, -0.25]],
  [[0, -0.25], [0.05, -0.6], [0.5, -0.6], [0.5, -0.15]],
  [[0.5, -0.15], [0.5, 0.1], [0.2, 0.3], [0, 0.5]],
];
/** Tight bounds of the heart outline, from its curve (not its control points). */
const HEART_BOUNDS = (() => {
  let left = 0, right = 0, top = 0, bottom = 0;
  for (const [a, b, c, d] of HEART) for (let step = 0; step <= 200; step++) {
    const t = step / 200, u = 1 - t;
    const x = u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * d[0], y = u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * d[1];
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  return { left, right, top, bottom };
})();
/** The heart scaled about the box centre so that its tight bounds equal the box `width × height`. */
function heartPath(width: number, height: number): Path2D {
  const path = new Path2D();
  const { left, right, top, bottom } = HEART_BOUNDS;
  const map = ([x, y]: [number, number]): [number, number] => [((x - left) / (right - left) - 0.5) * width, ((y - top) / (bottom - top) - 0.5) * height];
  path.moveTo(...map(HEART[0][0]));
  for (const [, b, c, d] of HEART) path.bezierCurveTo(...map(b), ...map(c), ...map(d));
  path.closePath();
  return path;
}

type PathPoint = { x: number; y: number; inX?: number; inY?: number; outX?: number; outY?: number };
/** A freeform path: anchors with tangent handles relative to the anchor, in fractions of the element's half size. */
function freeformPath(points: PathPoint[], halfWidth: number, halfHeight: number): Path2D {
  const path = new Path2D();
  points.forEach((point, index) => {
    const x = point.x * halfWidth, y = point.y * halfHeight;
    if (index === 0) { path.moveTo(x, y); return; }
    const from = points[index - 1];
    path.bezierCurveTo((from.x + (from.outX ?? 0)) * halfWidth, (from.y + (from.outY ?? 0)) * halfHeight, (point.x + (point.inX ?? 0)) * halfWidth, (point.y + (point.inY ?? 0)) * halfHeight, x, y);
  });
  const first = points[0], last = points[points.length - 1];
  path.bezierCurveTo((last.x + (last.outX ?? 0)) * halfWidth, (last.y + (last.outY ?? 0)) * halfHeight, (first.x + (first.inX ?? 0)) * halfWidth, (first.y + (first.inY ?? 0)) * halfHeight, first.x * halfWidth, first.y * halfHeight);
  path.closePath();
  return path;
}

/**
 * A mask shape as a canvas-size greyscale texture (red = coverage, opaque) in the space of the transformed layer:
 * the centre is offset by `centerX/Y` × the element's half size, `width`/`height` are fractions of its short side.
 * `glyphs` is the rasterised text of a text mask.
 */
export function rasterMask(shape: string, params: Record<string, unknown>, quad: LayerQuad, width: number, height: number, glyphs?: OffscreenCanvas): OffscreenCanvas | null {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#000000";
  context.fillRect(0, 0, width, height);
  const number = (key: string, fallback: number) => (typeof params[key] === "number" ? params[key] as number : fallback);
  const short = Math.min(quad.width, quad.height), reach = Math.hypot(quad.width, quad.height) * 2;
  const scale = number("scale", 1);
  context.translate(quad.centerX, quad.centerY);
  context.rotate((quad.rotationDegrees * Math.PI) / 180);
  context.translate(number("centerX", 0) * (quad.width / 2), number("centerY", 0) * (quad.height / 2));
  context.rotate((number("rotation", 0) * Math.PI) / 180);
  context.fillStyle = "#ffffff";
  if (shape === "text") {
    if (!glyphs) return null;
    // The glyph raster is white on transparent; centred on the mask position.
    context.drawImage(glyphs, -glyphs.width / 2, -glyphs.height / 2);
    return canvas;
  }
  let path: Path2D | null;
  if (shape === "split") {
    // The side in the direction of the line's normal (down the canvas at rotation 0).
    path = new Path2D();
    path.rect(-reach, 0, reach * 2, reach);
  } else if (shape === "mirror") {
    const band = number("size", 0.4) * short;
    path = new Path2D();
    path.rect(-reach, -band / 2, reach * 2, band);
  } else if (shape === "cinematic-bars") {
    // Height only: the band always spans the element.
    const band = number("height", 0.6) * short * scale;
    path = new Path2D();
    path.rect(-reach, -band / 2, reach * 2, band);
  } else if (shape === "heart") path = heartPath(number("width", 0.6) * short * scale, number("height", 0.6) * short * scale);
  else if (shape === "freeform") {
    const points = Array.isArray(params.path) ? params.path as PathPoint[] : [];
    // An open path, or one of fewer than three points, encloses nothing: the mask covers nothing.
    if (params.closed !== true || points.length < 3) return canvas;
    path = freeformPath(points, (quad.width / 2) * scale, (quad.height / 2) * scale);
  } else path = shapePath(shape, number("width", 0.6) * short * scale, number("height", 0.6) * short * scale, params);
  if (!path) return null;
  context.fill(path);
  return canvas;
}

export const RASTER_MASK_SHAPES = ["split", "mirror", "cinematic-bars", "rectangle", "ellipse", "heart", "diamond", "star", "text", "freeform"] as const;
export const RASTER_GRAPHIC_SHAPES = ["rectangle", "ellipse", "polygon", "star", "line", "arrow", "drawing"] as const;

/**
 * The neutral tile drawn in the preview where a clip's media is offline or cannot be decoded: a fill with a 2 px
 * diagonal hatch in the colours the app passed in `engine.init`. The label is drawn by the caller from glyph outlines.
 */
export function rasterOfflineTile(width: number, height: number, fill: string, hatch: string): OffscreenCanvas {
  const canvas = new OffscreenCanvas(Math.max(2, Math.round(width)), Math.max(2, Math.round(height)));
  const context = canvas.getContext("2d")!;
  context.fillStyle = fill;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = hatch;
  context.lineWidth = 2;
  const path = new Path2D();
  for (let offset = -canvas.height; offset < canvas.width; offset += 16) { path.moveTo(offset, canvas.height); path.lineTo(offset + canvas.height, 0); }
  context.stroke(path);
  return canvas;
}
