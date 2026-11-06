import { resolveNumber } from "../resolve/animation.ts";

/** The colour chain of a layer as the compositor takes it. Steps that are identity are `null` and cost no work. */
export type ColorChain = {
  lut: { textureId: string; size: number; intensity: number } | null;
  /** exposure, brightness, contrast, highlights, shadows, whites, blacks, temperature, tint, saturation, vibrance as slider / 100, then hue in degrees. */
  basic: number[] | null;
  /** Lift, gamma, gain per channel. */
  wheels: number[] | null;
  curvesTextureId: string | null;
  /** Eight bands × (hue, saturation, lightness) as slider / 100. */
  hsl: number[] | null;
  /** Fade and vignette as slider / 100. */
  spatial: number[] | null;
  /** Sharpness, clarity and grain as slider / 100, then the frame index the grain is seeded with. */
  detail?: number[] | null;
};

const BASIC_ORDER = ["exposure", "brightness", "contrast", "highlights", "shadows", "whites", "blacks", "temperature", "tint", "saturation", "vibrance"] as const;
const BANDS = ["red", "orange", "yellow", "green", "aqua", "blue", "purple", "magenta"] as const;
type Puck = { x: number; y: number; luminance: number };

/**
 * Colour wheel puck mapping: hue angle `θ = atan2(y, x)`, amount `a = min(1, |(x, y)|)`, chroma vector
 * `k = (cos θ, cos(θ − 120°), cos(θ + 120°))`; `lift = 0.25 (a k + L/100)`, `gamma = 2^(a k + L/100)`,
 * `gain = 2^(a k + L/100)`. Returns `[lift rgb, gamma rgb, gain rgb]`, or `null` when every wheel is centred.
 */
export function wheelValues(shadows: Puck, midtones: Puck, highlights: Puck): number[] | null {
  const term = (puck: Puck): [number, number, number] => {
    const amount = Math.min(1, Math.hypot(puck.x, puck.y));
    if (amount === 0) return [puck.luminance / 100, puck.luminance / 100, puck.luminance / 100];
    const theta = Math.atan2(puck.y, puck.x), third = (2 * Math.PI) / 3;
    return [amount * Math.cos(theta) + puck.luminance / 100, amount * Math.cos(theta - third) + puck.luminance / 100, amount * Math.cos(theta + third) + puck.luminance / 100];
  };
  const identity = [shadows, midtones, highlights].every((puck) => puck.x === 0 && puck.y === 0 && puck.luminance === 0);
  if (identity) return null;
  return [...term(shadows).map((value) => 0.25 * value), ...term(midtones).map((value) => 2 ** value), ...term(highlights).map((value) => 2 ** value)];
}
/** The wheel transfer of one channel: `clamp(gain (in + lift (1 − in)), 0, 1)^(1 / gamma)`. */
export const wheelTransfer = (input: number, lift: number, gamma: number, gain: number): number => Math.min(Math.max(gain * (input + lift * (1 - input)), 0), 1) ** (1 / gamma);

type CurvePoint = { x: number; y: number };
/** A colour curve sampled at `i / 255`: a monotone cubic Hermite spline with Fritsch–Carlson tangents, held beyond its end points. */
export function curveTable(points: CurvePoint[]): Float32Array {
  const table = new Float32Array(256);
  const count = points.length;
  const secants: number[] = [];
  for (let index = 0; index < count - 1; index++) secants.push((points[index + 1].y - points[index].y) / (points[index + 1].x - points[index].x));
  const slopes = new Array<number>(count).fill(0);
  slopes[0] = secants[0] ?? 0;
  slopes[count - 1] = secants[count - 2] ?? 0;
  for (let index = 1; index < count - 1; index++) slopes[index] = secants[index - 1] * secants[index] <= 0 ? 0 : (secants[index - 1] + secants[index]) / 2;
  for (let index = 0; index < count - 1; index++) {
    if (secants[index] === 0) { slopes[index] = 0; slopes[index + 1] = 0; continue; }
    const alpha = slopes[index] / secants[index], beta = slopes[index + 1] / secants[index], length = alpha * alpha + beta * beta;
    if (length > 9) { const scale = 3 / Math.sqrt(length); slopes[index] = scale * alpha * secants[index]; slopes[index + 1] = scale * beta * secants[index]; }
  }
  for (let entry = 0; entry < 256; entry++) {
    const x = entry / 255;
    let value: number;
    if (x <= points[0].x) value = points[0].y;
    else if (x >= points[count - 1].x) value = points[count - 1].y;
    else {
      let index = 0;
      while (index < count - 2 && x > points[index + 1].x) index++;
      const width = points[index + 1].x - points[index].x, t = (x - points[index].x) / width, t2 = t * t, t3 = t2 * t;
      value = (2 * t3 - 3 * t2 + 1) * points[index].y + (t3 - 2 * t2 + t) * width * slopes[index] + (3 * t2 - 2 * t3) * points[index + 1].y + (t3 - t2) * width * slopes[index + 1];
    }
    table[entry] = Math.min(Math.max(value, 0), 1);
  }
  return table;
}
const isIdentityCurve = (points: CurvePoint[] | undefined): boolean => !points || (points.length === 2 && points[0].x === 0 && points[0].y === 0 && points[1].x === 1 && points[1].y === 1);

export type CurveSet = { master?: CurvePoint[]; red?: CurvePoint[]; green?: CurvePoint[]; blue?: CurvePoint[] };
/** The 256×1 RGBA texture of a curve set: channel curves in r, g, b; the master curve in alpha. */
export function curvesPixels(curves: CurveSet): Uint8Array {
  const identity = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
  const tables = [curves.red, curves.green, curves.blue, curves.master].map((points) => curveTable(points ?? identity));
  const pixels = new Uint8Array(256 * 4);
  for (let entry = 0; entry < 256; entry++) for (let channel = 0; channel < 4; channel++) pixels[entry * 4 + channel] = Math.round(tables[channel][entry] * 255);
  return pixels;
}

/** A `.cube` 3D table as a 2D-packed RGBA texture: `size × size` wide and `size` tall, slices along blue side by side. */
export function parseCube(text: string): { size: number; pixels: Uint8Array } | null {
  let size = 0;
  const values: number[] = [];
  let low = [0, 0, 0], high = [1, 1, 1];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split("#")[0].trim();
    if (line === "" || line.startsWith("TITLE")) continue;
    const parts = line.split(/\s+/);
    if (parts[0] === "LUT_3D_SIZE") size = Number(parts[1]);
    else if (parts[0] === "LUT_1D_SIZE") return null;
    else if (parts[0] === "DOMAIN_MIN") low = parts.slice(1, 4).map(Number);
    else if (parts[0] === "DOMAIN_MAX") high = parts.slice(1, 4).map(Number);
    else {
      const triple = parts.slice(0, 3).map(Number);
      if (triple.length !== 3 || triple.some((value) => !Number.isFinite(value))) return null;
      values.push(...triple);
    }
  }
  if (!Number.isInteger(size) || size < 2 || size > 65 || values.length !== size * size * size * 3) return null;
  const pixels = new Uint8Array(size * size * size * 4);
  // File order: red fastest, then green, then blue. Texel (r + b × size, g).
  for (let blue = 0; blue < size; blue++) for (let green = 0; green < size; green++) for (let red = 0; red < size; red++) {
    const from = (red + size * (green + size * blue)) * 3, to = (green * size * size + blue * size + red) * 4;
    for (let channel = 0; channel < 3; channel++) {
      const width = high[channel] - low[channel];
      pixels[to + channel] = Math.round(Math.min(Math.max(width > 0 ? (values[from + channel] - low[channel]) / width : values[from + channel], 0), 1) * 255);
    }
    pixels[to + 3] = 255;
  }
  return { size, pixels };
}

export type ChainInputs = {
  /** Asks for a curves texture and returns its id. */
  curves(set: CurveSet): string;
  /** The loaded table of a LUT id, or `null` while it is not available. */
  lut(lutId: string): { textureId: string; size: number } | null;
  /** Called for a step this build does not execute. */
  unsupported(step: string): void;
  /** `floor(frameTime / frameDuration)`: the seed of the grain. */
  frameIndex?: number;
};

/** The colour chain of an element's `adjustments` at a clip time; `null` when every step is identity. */
export function colorChain(element: { adjustments?: Record<string, any>; animations?: Record<string, unknown> }, clipTime: number, inputs: ChainInputs): ColorChain | null {
  const adjustments = element.adjustments;
  if (!adjustments) return null;
  const number = (path: string, fallback: number) => resolveNumber(element, `adjustments.${path}`, clipTime, fallback);
  const chain: ColorChain = { lut: null, basic: null, wheels: null, curvesTextureId: null, hsl: null, spatial: null };
  if (adjustments.lut && adjustments.lut.enabled !== false && adjustments.lut.lutId) {
    const intensity = number("lut.intensity", 100) / 100;
    const table = intensity > 0 ? inputs.lut(adjustments.lut.lutId) : null;
    if (table) chain.lut = { ...table, intensity };
  }
  if (adjustments.basic && adjustments.basic.enabled !== false) {
    const basic = [...BASIC_ORDER.map((key) => number(`basic.${key}`, 0) / 100), number("basic.hue", 0)];
    if (basic.some((value) => value !== 0)) chain.basic = basic;
    const fade = number("basic.fade", 0) / 100, vignette = number("basic.vignette", 0) / 100;
    if (fade !== 0 || vignette !== 0) chain.spatial = [fade, vignette];
    const sharpness = number("basic.sharpness", 0) / 100, clarity = number("basic.clarity", 0) / 100, grain = number("basic.grain", 0) / 100;
    if (sharpness !== 0 || clarity !== 0 || grain !== 0) chain.detail = [sharpness, clarity, grain, inputs.frameIndex ?? 0];
  }
  if (adjustments.wheels && adjustments.wheels.enabled !== false) {
    const puck = (name: string): Puck => ({ x: number(`wheels.${name}.x`, 0), y: number(`wheels.${name}.y`, 0), luminance: number(`wheels.${name}.luminance`, 0) });
    chain.wheels = wheelValues(puck("shadows"), puck("midtones"), puck("highlights"));
  }
  if (adjustments.curves && adjustments.curves.enabled !== false) {
    const { master, red, green, blue } = adjustments.curves as CurveSet;
    if (![master, red, green, blue].every(isIdentityCurve)) chain.curvesTextureId = inputs.curves({ master, red, green, blue });
  }
  if (adjustments.hsl && adjustments.hsl.enabled !== false) {
    const hsl = BANDS.flatMap((band) => [number(`hsl.${band}.hue`, 0) / 100, number(`hsl.${band}.saturation`, 0) / 100, number(`hsl.${band}.lightness`, 0) / 100]);
    if (hsl.some((value) => value !== 0)) chain.hsl = hsl;
  }
  return Object.values(chain).every((step) => step === null || step === undefined) ? null : chain;
}
