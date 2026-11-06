/** Contain-fit, crop, flip and transform: the base rectangle of a visual layer on the render canvas. */

export type Size = { width: number; height: number };
export type CropSides = { left: number; top: number; right: number; bottom: number };
export type LayerQuad = { centerX: number; centerY: number; width: number; height: number; rotationDegrees: number; flipX: boolean; flipY: boolean };
export type ElementPlacement = {
  position: { x: number; y: number }; scale: { x: number; y: number }; rotation: number;
  flip?: { horizontal?: boolean; vertical?: boolean };
};
/** The clip-animation transform composed after the element transform. */
export type AnimationOffset = { x: number; y: number; scaleX: number; scaleY: number; rotation: number };

const clampSide = (value: number): number => Math.min(Math.max(Number.isFinite(value) ? value : 0, 0), 0.99);

/** Crop clamped into its range (each side 0–0.99, opposite sides summing to at most 0.99); `clamped` tells whether it changed. */
export function clampCrop(crop: Partial<CropSides> | undefined): { crop: CropSides; clamped: boolean } {
  const given = { left: crop?.left ?? 0, top: crop?.top ?? 0, right: crop?.right ?? 0, bottom: crop?.bottom ?? 0 };
  const out = { left: clampSide(given.left), top: clampSide(given.top), right: clampSide(given.right), bottom: clampSide(given.bottom) };
  if (out.left + out.right > 0.99) out.right = 0.99 - out.left;
  if (out.top + out.bottom > 0.99) out.bottom = 0.99 - out.top;
  const clamped = out.left !== given.left || out.top !== given.top || out.right !== given.right || out.bottom !== given.bottom;
  return { crop: out, clamped };
}

/** The largest rectangle of the source aspect that fits the canvas. */
export function containFit(source: Size, canvas: Size): Size {
  const scale = Math.min(canvas.width / source.width, canvas.height / source.height);
  return { width: source.width * scale, height: source.height * scale };
}
/** The smallest rectangle of the source aspect that covers the canvas. */
export function coverFit(source: Size, canvas: Size): Size {
  const scale = Math.max(canvas.width / source.width, canvas.height / source.height);
  return { width: source.width * scale, height: source.height * scale };
}

export type QuadInput = {
  source: Size; crop: CropSides; placement: ElementPlacement;
  /** The project canvas the element was authored on, and the size being rendered. */
  canvas: Size; render: Size;
  /** `contain` for pictures; `intrinsic` for stickers and graphics, which keep their own size. */
  fit: "contain" | "intrinsic";
  animation?: AnimationOffset;
};

/**
 * Crop → contain-fit → scale → position → rotation. A negative scale becomes a positive scale plus a flip on that
 * axis, combined with the element's own flip flags by exclusive-or.
 */
export function layerQuad(input: QuadInput): LayerQuad {
  const { source, crop, placement, canvas, render, animation } = input;
  const cropped = { width: source.width * (1 - crop.left - crop.right), height: source.height * (1 - crop.top - crop.bottom) };
  const base = input.fit === "contain" ? containFit(cropped, canvas) : cropped;
  const scaleX = placement.scale.x * (animation?.scaleX ?? 1), scaleY = placement.scale.y * (animation?.scaleY ?? 1);
  // Everything is authored in project-canvas pixels; the render size scales it uniformly.
  const kx = render.width / canvas.width, ky = render.height / canvas.height;
  return {
    centerX: (canvas.width / 2 + placement.position.x + (animation?.x ?? 0)) * kx,
    centerY: (canvas.height / 2 + placement.position.y + (animation?.y ?? 0)) * ky,
    width: base.width * Math.abs(scaleX) * kx,
    height: base.height * Math.abs(scaleY) * ky,
    rotationDegrees: placement.rotation + (animation?.rotation ?? 0),
    flipX: (scaleX < 0) !== Boolean(placement.flip?.horizontal),
    flipY: (scaleY < 0) !== Boolean(placement.flip?.vertical),
  };
}

/** Row-major 3×3 matrix mapping a render-canvas pixel to the element box (`uv` 0…1 with the axes along the box edges). */
export function boxInverse(quad: LayerQuad): number[] {
  const angle = (quad.rotationDegrees * Math.PI) / 180;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  // uv = R⁻¹ (p − c) / size + 0.5
  // A box collapsed to nothing (a scale of 0) keeps a finite matrix: it covers no pixel.
  const width = Math.max(Math.abs(quad.width), 1e-6), height = Math.max(Math.abs(quad.height), 1e-6);
  const ax = cos / width, bx = sin / width, ay = -sin / height, by = cos / height;
  return [ax, bx, 0.5 - ax * quad.centerX - bx * quad.centerY, ay, by, 0.5 - ay * quad.centerX - by * quad.centerY, 0, 0, 1];
}

/** Axis-aligned bounds of a quad on the canvas, for `layout.query`. */
export function quadBounds(quad: LayerQuad): { x: number; y: number; width: number; height: number } {
  const angle = (quad.rotationDegrees * Math.PI) / 180;
  const cos = Math.abs(Math.cos(angle)), sin = Math.abs(Math.sin(angle));
  const width = quad.width * cos + quad.height * sin, height = quad.width * sin + quad.height * cos;
  return { x: quad.centerX - width / 2, y: quad.centerY - height / 2, width, height };
}
