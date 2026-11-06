import { DIRECTION4, effectDefinition, timeline, transitionDefinition } from "@jagentchill/editor-core";
import { parseHexColor, resolveColor, resolveNumber } from "../resolve/animation.ts";
import { gaussianBlurPasses, type EffectPass } from "./descriptor.ts";

/**
 * The catalogue side of the shader library: turns the stored params of an effect entry or of a transition record
 * into the passes and uniforms of `render-wasm/crates/effects/src/library`. A uniform is `u_<param key>`; a number
 * goes as it is stored, a colour as RGB, a boolean as 0 or 1, a select as the index of its option — except
 * left / right / up / down, which goes as the unit vector of the direction the content travels in.
 */

type ElementParamDefinition = timeline.ElementParamDefinition;
const { evaluateParam } = timeline;
type Uniforms = Record<string, number | number[]>;
const DIRECTION_VECTORS: Record<string, [number, number]> = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };
const isDirection4 = (definition: ElementParamDefinition): boolean => definition.options?.length === 4 && DIRECTION4.every((option, index) => definition.options![index] === option);

export function paramUniforms(params: readonly ElementParamDefinition[], value: (definition: ElementParamDefinition) => number | boolean | string): Uniforms {
  const uniforms: Uniforms = {};
  for (const definition of params) {
    const resolved = value(definition);
    if (definition.type === "number") uniforms[`u_${definition.key}`] = Number(resolved);
    else if (definition.type === "boolean") uniforms[`u_${definition.key}`] = resolved === true ? 1 : 0;
    else if (definition.type === "color") uniforms[`u_${definition.key}`] = parseHexColor(String(resolved)).slice(0, 3);
    else if (definition.type === "select") uniforms[`u_${definition.key}`] = isDirection4(definition) ? DIRECTION_VECTORS[String(resolved)] ?? DIRECTION_VECTORS.left : Math.max(0, (definition.options ?? []).indexOf(String(resolved)));
  }
  return uniforms;
}

/** `cubic-bezier(x1, y1, x2, y2)` evaluated at `x` in 0…1. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const curve = (a: number, b: number, s: number) => 3 * (1 - s) * (1 - s) * s * a + 3 * (1 - s) * s * s * b + s * s * s;
  let low = 0, high = 1;
  for (let step = 0; step < 48; step++) {
    const middle = (low + high) / 2;
    if (curve(x1, x2, middle) < x) low = middle; else high = middle;
  }
  return curve(y1, y2, (low + high) / 2);
}
/** The easings of a transition record (`transitions.Transition rendering`). */
export const TRANSITION_EASING: Record<string, (p: number) => number> = {
  linear: (p) => p,
  "ease-in": (p) => cubicBezier(0.42, 0, 1, 1, p),
  "ease-out": (p) => cubicBezier(0, 0, 0.58, 1, p),
  "ease-in-out": (p) => cubicBezier(0.42, 0, 0.58, 1, p),
};

/** Bright-pass, its Gaussian and the addition: the glow of an effect or of a glow dissolve. `threshold` is 0…1. */
function glowPasses(threshold: number, sigma: number, intensity: number): EffectPass[] {
  return [{ shader: "bright-pass", uniforms: { u_threshold: threshold } }, ...gaussianBlurPasses(sigma), { shader: "glow", uniforms: { u_intensity: intensity } }];
}

export type TransitionShader = { shader: string; uniforms: Uniforms; postPasses: EffectPass[] };
/**
 * The shader, uniforms and post passes of a transition at an eased progress. A type the library does not register
 * keeps its id, so that the compositor renders a cross-dissolve and reports it once.
 */
export function transitionShader(type: string, params: Record<string, unknown>, progress: number, timing: { seconds: number; frame: number; scale: number }): TransitionShader {
  const definition = transitionDefinition(type);
  if (!definition) return { shader: type, uniforms: {}, postPasses: [] };
  const value = (param: ElementParamDefinition) => evaluateParam(param, params[param.key] ?? param.default);
  const uniforms: Uniforms = { ...paramUniforms(definition.params, value), u_time: timing.seconds, u_frame: timing.frame };
  const number = (key: string) => Number(uniforms[`u_${key}`] ?? 0);
  const swell = Math.sin(Math.PI * progress);
  let postPasses: EffectPass[] = [];
  if (progress > 0 && progress < 1) {
    if (type === "pull-focus" || type === "blur-dissolve") postPasses = gaussianBlurPasses((number("blur") / 5) * timing.scale * swell);
    else if (type === "glow-dissolve" && number("intensity") > 0) postPasses = glowPasses(0.6, 12 * timing.scale, number("intensity") * swell);
  }
  return { shader: type, uniforms, postPasses };
}

export type PassEntry = { id: string; type: string; kind: string; enabled?: boolean; params: Record<string, unknown> };
export type EffectTiming = {
  /** Element-local time in seconds. */
  seconds: number;
  /** `floor(frameTime / frameDuration)`. */
  frame: number;
  /** 0 on the element's first frame, 1 on its last. */
  progress: number;
  /** The pixel scale factor. */
  scale: number;
  /** Whether the layer carries a person matte for this frame. */
  matte: boolean;
};

/**
 * The pass group of one effect entry at a clip time. An entry whose type is not registered keeps its type as the
 * shader id (the compositor skips it and reports it once); a body effect without its matte renders as pass-through.
 */
export function effectPasses(element: { animations?: Record<string, unknown> }, entry: PassEntry, clipTime: number, timing: EffectTiming): EffectPass[] {
  const definition = effectDefinition(entry.type);
  if (!definition || definition.kind !== "effect") return [{ shader: entry.type, uniforms: {} }];
  if (definition.requires === "person-matte" && !timing.matte) return [];
  const path = (key: string) => `effects.${entry.id}.params.${key}`;
  const value = (param: ElementParamDefinition): number | boolean | string => {
    const stored = evaluateParam(param, entry.params?.[param.key] ?? param.default);
    if (param.type === "number") return resolveNumber(element, path(param.key), clipTime, stored as number);
    if (param.type === "color") return resolveColor(element, path(param.key), clipTime, stored as string);
    return stored;
  };
  const all = paramUniforms(definition.params, value);
  const pick = (...keys: string[]): Uniforms => Object.fromEntries(keys.map((key) => [`u_${key}`, all[`u_${key}`]]));
  const number = (key: string) => Number(all[`u_${key}`] ?? 0);
  const engine: Uniforms = { u_time: timing.seconds, u_frame: timing.frame, u_progress: timing.progress };
  const s = timing.scale;
  const matte = { aux: "@matte" };
  switch (entry.type) {
    case "blur": return gaussianBlurPasses((number("intensity") / 5) * s);
    case "tilt-shift": {
      // `half` (sigma intensity / 10) is kept; `full` (sigma intensity / 5) is `half` blurred by the remaining sigma.
      const half = gaussianBlurPasses((number("intensity") / 10) * s);
      if (half.length === 0) return [];
      half[half.length - 1] = { ...half[half.length - 1], store: "half" };
      return [...half, ...gaussianBlurPasses((Math.sqrt(3) * number("intensity") / 10) * s), { shader: "tilt-shift", uniforms: pick("position", "width", "angle"), textures: { aux: "@half" } }];
    }
    case "glow": return glowPasses(number("threshold") / 100, (number("radius") / 2) * s, number("intensity"));
    case "neon-edges": {
      const blur = gaussianBlurPasses((number("glow") / 5) * s);
      return [{ shader: "neon-edges-edge", uniforms: pick("threshold", "color"), store: "edges" }, ...blur, { shader: "neon-edges", uniforms: { u_blurred: blur.length > 0 ? 1 : 0 }, textures: { aux: "@edges" } }];
    }
    case "body-outline": {
      const blur = gaussianBlurPasses((number("glow") / 5) * s);
      return [{ shader: "body-outline-stroke", uniforms: pick("width", "color"), textures: matte, store: "stroke" }, ...blur, { shader: "body-outline", uniforms: { u_blurred: blur.length > 0 ? 1 : 0 }, textures: { aux: "@stroke" } }];
    }
    case "body-glow": return [{ shader: "matte-copy", uniforms: {}, textures: matte }, ...gaussianBlurPasses((number("radius") / 2) * s), { shader: "body-glow", uniforms: pick("intensity", "color"), textures: matte }];
    case "background-blur": {
      const blur = gaussianBlurPasses((number("intensity") / 5) * s);
      return blur.length === 0 ? [] : [...blur, { shader: "background-blur", uniforms: {}, textures: matte }];
    }
    case "background-mono":
    case "body-echo": return [{ shader: entry.type, uniforms: all, textures: matte }];
    default: return [{ shader: entry.type, uniforms: { ...all, ...engine } }];
  }
}

/** Shader ids a definition's passes may name, for the catalogue check against the registry. */
export const EFFECT_PASS_SHADERS: Record<string, readonly string[]> = {
  blur: ["gaussian-blur"], "tilt-shift": ["gaussian-blur", "tilt-shift"], glow: ["bright-pass", "gaussian-blur", "glow"],
  "neon-edges": ["neon-edges-edge", "gaussian-blur", "neon-edges"], "body-outline": ["body-outline-stroke", "gaussian-blur", "body-outline"],
  "body-glow": ["matte-copy", "gaussian-blur", "body-glow"], "background-blur": ["gaussian-blur", "background-blur"],
};
