import { FILTER_ROWS } from "@jagentchill/content";

type Puck = { x: number; y: number; luminance: number };
type CurvePoint = { x: number; y: number };
export type RecipeCurves = { master?: CurvePoint[]; red?: CurvePoint[]; green?: CurvePoint[]; blue?: CurvePoint[] };
type CurveSet = RecipeCurves;
/** Colour wheel puck mapping (render-engine): `[lift rgb, gamma rgb, gain rgb]`, or `null` when every wheel is centred. */
function wheelValues(shadows: Puck, midtones: Puck, highlights: Puck): number[] | null {
  const term = (puck: Puck): [number, number, number] => {
    const amount = Math.min(1, Math.hypot(puck.x, puck.y));
    if (amount === 0) return [puck.luminance / 100, puck.luminance / 100, puck.luminance / 100];
    const theta = Math.atan2(puck.y, puck.x), third = (2 * Math.PI) / 3;
    return [amount * Math.cos(theta) + puck.luminance / 100, amount * Math.cos(theta - third) + puck.luminance / 100, amount * Math.cos(theta + third) + puck.luminance / 100];
  };
  if ([shadows, midtones, highlights].every((puck) => puck.x === 0 && puck.y === 0 && puck.luminance === 0)) return null;
  return [...term(shadows).map((value) => 0.25 * value), ...term(midtones).map((value) => 2 ** value), ...term(highlights).map((value) => 2 ** value)];
}
const wheelTransfer = (input: number, lift: number, gamma: number, gain: number): number => Math.min(Math.max(gain * (input + lift * (1 - input)), 0), 1) ** (1 / gamma);

/**
 * Filter recipes: the catalogue notation read into `adjustments`, the colour chain evaluated on the CPU in binary64
 * (`color-adjustment.LUT bake procedure`), and the 33-point table baked from it. The same function bakes the
 * committed `.cube` files (`scripts/bake-luts.ts`) and the table the engine samples at the `filter` stage, so a
 * filter needs no file at run time and the two can never differ. Pure TypeScript: the app may import it too.
 */

const BASIC_KEYS = ["exposure", "brightness", "contrast", "highlights", "shadows", "whites", "blacks", "temperature", "tint", "saturation", "vibrance", "hue", "fade"] as const;
const BANDS = ["red", "orange", "yellow", "green", "aqua", "blue", "purple", "magenta"] as const;
const BAND_CENTRES = [0, 30, 60, 120, 180, 240, 270, 300];
const CURVE_CHANNELS: Record<string, keyof CurveSet> = { master: "master", r: "red", g: "green", b: "blue" };
const number = (text: string): number => Number(text.trim().replace("−", "-").replace("°", ""));

export type RecipeAdjustments = {
  basic?: Record<string, number | boolean>;
  wheels?: Record<string, { x: number; y: number; luminance: number } | boolean>;
  curves?: CurveSet & { enabled: boolean };
  hsl?: Record<string, { hue: number; saturation: number; lightness: number } | boolean>;
};

/** `B{…}; W{…}; C{…}; H{…}` → the `adjustments` object that renders the same look live. */
export function parseRecipe(recipe: string): RecipeAdjustments {
  const out: RecipeAdjustments = {};
  for (const block of recipe.matchAll(/([BWCH])\{([^}]*)\}/g)) {
    const [, kind, body] = block;
    if (kind === "B") {
      const basic: Record<string, number | boolean> = { enabled: true };
      for (const entry of body.split(",")) {
        const match = /^\s*(\w+)\s+(\S+)\s*$/.exec(entry);
        if (!match || !(BASIC_KEYS as readonly string[]).includes(match[1])) throw new Error(`recipe: "${entry.trim()}" is not a basic slider a filter may use`);
        basic[match[1]] = number(match[2]);
      }
      out.basic = basic;
    } else if (kind === "W") {
      const wheels: NonNullable<RecipeAdjustments["wheels"]> = { enabled: true };
      for (const entry of body.split(";")) {
        const [name, values] = entry.split(":");
        const [angle, amount, luminance] = values.split(",").map(number);
        if (!["shadows", "midtones", "highlights"].includes(name.trim())) throw new Error(`recipe: "${name.trim()}" is not a wheel`);
        const radians = (angle * Math.PI) / 180;
        wheels[name.trim()] = { x: amount * Math.cos(radians), y: amount * Math.sin(radians), luminance };
      }
      out.wheels = wheels;
    } else if (kind === "C") {
      const curves: CurveSet & { enabled: boolean } = { enabled: true };
      for (const entry of body.split(";")) {
        const [name, values] = entry.split(":");
        const channel = CURVE_CHANNELS[name.trim()];
        if (!channel) throw new Error(`recipe: "${name.trim()}" is not a curve`);
        // Extra points between (0, 0) and (1, 1), unless an end point is restated.
        const points = [...values.matchAll(/\(([^)]+)\)/g)].map((point) => { const [x, y] = point[1].split(",").map(number); return { x, y }; });
        if (!points.some((point) => point.x === 0)) points.unshift({ x: 0, y: 0 });
        if (!points.some((point) => point.x === 1)) points.push({ x: 1, y: 1 });
        curves[channel] = points.sort((a, b) => a.x - b.x);
      }
      out.curves = curves;
    } else {
      const hsl: NonNullable<RecipeAdjustments["hsl"]> = { enabled: true };
      for (const entry of body.split(";")) {
        const [name, values] = entry.split(":");
        const [hue, saturation, lightness] = values.split(",").map(number);
        if (!(BANDS as readonly string[]).includes(name.trim())) throw new Error(`recipe: "${name.trim()}" is not a colour band`);
        hsl[name.trim()] = { hue, saturation, lightness };
      }
      out.hsl = hsl;
    }
  }
  if (/sharpness|clarity|vignette|grain/.test(recipe)) throw new Error("recipe: sharpness, clarity, vignette and grain are not allowed in a filter recipe");
  return out;
}

type Rgb = [number, number, number];
const luma = (c: Rgb): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const eotf = (v: number): number => (v <= 0.04045 ? v / 12.92 : Math.pow((Math.max(v, 0) + 0.055) / 1.055, 2.4));
const oetf = (v: number): number => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055);
const clamp01 = (v: number): number => Math.min(Math.max(v, 0), 1);
const smoothstep = (a: number, b: number, x: number): number => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const each = (c: Rgb, f: (v: number) => number): Rgb => [f(c[0]), f(c[1]), f(c[2])];

/** A colour curve evaluated exactly: the monotone cubic Hermite spline with Fritsch–Carlson tangents of `curveTable`. */
export function curveAt(points: { x: number; y: number }[], x: number): number {
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
  if (x <= points[0].x) return clamp01(points[0].y);
  if (x >= points[count - 1].x) return clamp01(points[count - 1].y);
  let index = 0;
  while (index < count - 2 && x > points[index + 1].x) index++;
  const width = points[index + 1].x - points[index].x, t = (x - points[index].x) / width, t2 = t * t, t3 = t2 * t;
  return clamp01((2 * t3 - 3 * t2 + 1) * points[index].y + (t3 - 2 * t2 + t) * width * slopes[index] + (3 * t2 - 2 * t3) * points[index + 1].y + (t3 - t2) * width * slopes[index + 1]);
}

function rgbToHsl(c: Rgb): Rgb {
  const high = Math.max(...c), low = Math.min(...c), l = (high + low) / 2, d = high - low;
  if (d <= 0) return [0, 0, l];
  const s = d / Math.max(1 - Math.abs(2 * l - 1), 0.000001);
  let h = high === c[0] ? (c[1] - c[2]) / d : high === c[1] ? 2 + (c[2] - c[0]) / d : 4 + (c[0] - c[1]) / d;
  h *= 60;
  if (h < 0) h += 360;
  return [h, clamp01(s), l];
}
function hslToRgb([hue, s, l]: Rgb): Rgb {
  const h = (((hue / 360) % 1) + 1) % 1;
  if (s <= 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const part = (input: number): number => {
    let t = input;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 0.5) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [part(h + 1 / 3), part(h), part(h - 1 / 3)];
}

/** The colour chain of a recipe on one display-referred colour: basic, wheels, curves, HSL, then the pointwise fade. */
export function applyRecipe(input: Rgb, recipe: RecipeAdjustments): Rgb {
  let c: Rgb = [...input];
  const basic = (key: string): number => Number(recipe.basic?.[key] ?? 0) / 100;
  const exposure = basic("exposure"), brightness = basic("brightness"), contrast = basic("contrast"), highlights = basic("highlights"), shadows = basic("shadows");
  const whites = basic("whites"), blacks = basic("blacks"), temperature = basic("temperature"), tint = basic("tint"), saturation = basic("saturation"), vibrance = basic("vibrance");
  const hue = Number(recipe.basic?.hue ?? 0);
  if (exposure !== 0) c = each(c, (v) => oetf(eotf(v) * 2 ** (2 * exposure)));
  if (brightness !== 0) c = each(c, (v) => v + 0.25 * brightness * 4 * v * (1 - v));
  if (contrast !== 0) c = each(c, (v) => 0.5 + (v - 0.5) * 2 ** contrast);
  if (highlights !== 0) { const l = luma(c); c = each(c, (v) => v + 0.25 * highlights * smoothstep(0.25, 0.75, l) * 4 * l * (1 - l)); }
  if (shadows !== 0) { const l = luma(c); c = each(c, (v) => v + 0.25 * shadows * (1 - smoothstep(0.25, 0.75, l)) * 4 * l * (1 - l)); }
  if (whites !== 0) c = each(c, (v) => v * (1 + 0.2 * whites));
  if (blacks !== 0) c = each(c, (v) => v + 0.2 * blacks * (1 - v));
  const rebalance = (scale: Rgb): void => {
    const linear = each(c, eotf), before = luma(linear);
    let moved: Rgb = [linear[0] * scale[0], linear[1] * scale[1], linear[2] * scale[2]];
    const after = luma(moved);
    if (after > 0) moved = each(moved, (v) => v * (before / after));
    c = each(moved, oetf);
  };
  if (temperature !== 0) rebalance([1 + 0.3 * temperature, 1, 1 - 0.3 * temperature]);
  if (tint !== 0) rebalance([1, 1 - 0.3 * tint, 1]);
  if (saturation !== 0) { const l = luma(c); c = each(c, (v) => l + (v - l) * (1 + saturation)); }
  if (vibrance !== 0) {
    const l = luma(c), high = Math.max(...c), low = Math.min(...c), s = high > 0 ? (high - low) / high : 0;
    c = each(c, (v) => l + (v - l) * (1 + vibrance * (1 - s)));
  }
  if (hue !== 0) {
    // Rotation of the chroma vector about the grey axis (Rodrigues, axis (1, 1, 1) / √3).
    const l = luma(c), chroma: Rgb = [c[0] - l, c[1] - l, c[2] - l], angle = (hue * Math.PI) / 180, k = 0.57735027;
    const cross: Rgb = [k * (chroma[2] - chroma[1]), k * (chroma[0] - chroma[2]), k * (chroma[1] - chroma[0])];
    const along = k * (chroma[0] + chroma[1] + chroma[2]) * (1 - Math.cos(angle));
    c = [0, 1, 2].map((index) => l + chroma[index] * Math.cos(angle) + cross[index] * Math.sin(angle) + k * along) as Rgb;
  }
  if (recipe.wheels) {
    const puck = (name: string) => (recipe.wheels?.[name] as { x: number; y: number; luminance: number } | undefined) ?? { x: 0, y: 0, luminance: 0 };
    const values = wheelValues(puck("shadows"), puck("midtones"), puck("highlights"));
    if (values) c = c.map((v, index) => wheelTransfer(v, values[index], values[3 + index], values[6 + index])) as Rgb;
  }
  if (recipe.curves) {
    const identity = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    const master = recipe.curves.master ?? identity, channels = [recipe.curves.red ?? identity, recipe.curves.green ?? identity, recipe.curves.blue ?? identity];
    c = c.map((v, index) => curveAt(channels[index], curveAt(master, clamp01(v)))) as Rgb;
  }
  if (recipe.hsl) {
    let hsl = rgbToHsl(each(c, clamp01));
    const gate = smoothstep(0.05, 0.15, hsl[1]);
    if (gate > 0) {
      let shift = 0, saturationGain = 0, lightness = 0;
      for (let index = 0; index < 8; index++) {
        const centre = BAND_CENTRES[index], next = BAND_CENTRES[(index + 1) % 8], previous = BAND_CENTRES[(index + 7) % 8];
        let d = hsl[0] - centre;
        if (d > 180) d -= 360;
        if (d < -180) d += 360;
        let reach = d < 0 ? centre - previous : next - centre;
        if (reach <= 0) reach += 360;
        if (Math.abs(d) >= reach) continue;
        const band = (recipe.hsl[BANDS[index]] as { hue: number; saturation: number; lightness: number } | undefined) ?? { hue: 0, saturation: 0, lightness: 0 };
        const w = 0.5 * (1 + Math.cos((Math.PI * Math.abs(d)) / reach)) * gate;
        shift += (band.hue / 100) * 30 * w;
        saturationGain += (band.saturation / 100) * w;
        lightness += 0.25 * (band.lightness / 100) * w;
      }
      hsl = [hsl[0] + shift + 360, clamp01(hsl[1] * (1 + saturationGain)), clamp01(hsl[2] + lightness)];
      c = hslToRgb(hsl);
    }
  }
  const fade = Number(recipe.basic?.fade ?? 0) / 100;
  if (fade !== 0) c = each(c, (v) => v * (1 - 0.25 * fade) + 0.25 * fade);
  return each(c, clamp01);
}

export const BAKED_LUT_SIZE = 33;
/** The 33-point table of a recipe: `size³` RGB triples, red varying fastest, then green, then blue. */
export function bakeRecipe(recipe: RecipeAdjustments, size = BAKED_LUT_SIZE): Float64Array {
  const table = new Float64Array(size * size * size * 3);
  let at = 0;
  for (let blue = 0; blue < size; blue++) for (let green = 0; green < size; green++) for (let red = 0; red < size; red++) {
    const out = applyRecipe([red / (size - 1), green / (size - 1), blue / (size - 1)], recipe);
    table[at++] = out[0]; table[at++] = out[1]; table[at++] = out[2];
  }
  return table;
}
/** A baked table as a `.cube` file: six decimals, single line feeds. */
export function cubeText(table: Float64Array, size = BAKED_LUT_SIZE): string {
  const lines = [`LUT_3D_SIZE ${size}`, "DOMAIN_MIN 0 0 0", "DOMAIN_MAX 1 1 1"];
  for (let at = 0; at < table.length; at += 3) lines.push(`${table[at].toFixed(6)} ${table[at + 1].toFixed(6)} ${table[at + 2].toFixed(6)}`);
  return `${lines.join("\n")}\n`;
}

const RECIPES = new Map(FILTER_ROWS.map((row) => [row.id, row.recipe]));
/** The recipe of a bundled filter as `adjustments`; `undefined` for a type that is not registered. */
export const filterRecipe = (filterId: string): RecipeAdjustments | undefined => (RECIPES.has(filterId) ? parseRecipe(RECIPES.get(filterId)!) : undefined);
/** The `.cube` text of a bundled filter, byte-identical to the committed file. */
export const filterCube = (filterId: string): string | undefined => { const recipe = filterRecipe(filterId); return recipe && cubeText(bakeRecipe(recipe)); };
