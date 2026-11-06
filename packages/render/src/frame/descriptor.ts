import { BLEND_MODES } from "@jagentchill/protocol";
import type { CropSides, LayerQuad } from "../resolve/layout.ts";
import type { ColorChain } from "./color.ts";

/** The JSON a resolved frame is flattened into for the wasm compositor (`FrameDescriptor` version 3). */
export const FRAME_DESCRIPTOR_VERSION = 3;
/** The 17 blend mode ids in shader-code order; the Rust list is `color::BLEND_MODE_IDS`. */
export const BLEND_MODE_IDS: readonly string[] = BLEND_MODES;

/**
 * One shader pass of an effect. `textures.aux` names the third input of a library shader: a texture id, `@matte`
 * (the layer's person matte) or `@<name>` for the output an earlier pass of the group kept with `store`.
 */
export type EffectPass = { shader: string; uniforms: Record<string, number | number[]>; textures?: Record<string, string>; store?: string };
export type LutItem = { textureId: string; size: number; intensity: number };
export type PersonMatteItem = { textureId: string; width: number; height: number };
export type MaskItem = { textureId: string; feather: number; inverted: boolean; opacity: number; combine: "add" | "subtract" | "intersect" | "exclude" };
export type KeyItem = { keyColor: [number, number, number]; similarity: number; smoothness: number; shadow: number; spill: number; /** A view of the key: its alpha as greyscale. */ showMatte?: boolean };
export type LayerItem = {
  type: "layer"; textureId: string;
  stabilise: null; crop: CropSides; transform: LayerQuad; key: KeyItem | null; matte: null; cutoutBackground: null; cutoutStroke: null;
  personMatte: PersonMatteItem | null; boxInverse: number[]; analysis: null; color: ColorChain | null; filter: LutItem | null; effectPassGroups: EffectPass[][]; masks: MaskItem[];
  maskStroke: null; reveal: null; motionBlur: null; opacity: number; blendMode: string;
  /** The next source frame of a frame-blended slow motion and its weight. */
  blendSource?: { textureId: string; mix: number } | null;
  /** Passes run after the masks: the clip-animation reveal (`wipe-reveal`), then the motion blur (`motion-blur`). */
  postPasses?: EffectPass[];
};
export type TransitionItem = {
  type: "transition"; from: LayerItem; to: LayerItem; shader: string; uniforms: Record<string, number | number[]>; progress: number;
  /** Passes run on the shader's result before it is blended. */
  postPasses?: EffectPass[];
  blendModeFrom: string; blendModeTo: string; fromBackground: FrameItem[] | null; toBackground: FrameItem[] | null;
};
export type SceneEffectItem = { type: "sceneEffect"; effectPassGroups: EffectPass[][]; color: ColorChain | null; filter: LutItem | null; masks: MaskItem[]; opacity: number };
export type GroupItem = { type: "group"; items: FrameItem[]; targetTextureId: string };
export type FrameItem = LayerItem | TransitionItem | SceneEffectItem | GroupItem;
export type FrameDescriptor = { version: 3; width: number; height: number; clear: { color: [number, number, number, number] }; items: FrameItem[] };

/** A layer with every optional stage absent. */
export function layerItem(textureId: string, transform: LayerQuad, boxInverse: number[], fields: Partial<LayerItem> = {}): LayerItem {
  return {
    type: "layer", textureId, stabilise: null, crop: { left: 0, top: 0, right: 0, bottom: 0 }, transform, key: null, matte: null, cutoutBackground: null,
    cutoutStroke: null, personMatte: null, boxInverse, analysis: null, color: null, filter: null, effectPassGroups: [], masks: [], maskStroke: null,
    reveal: null, motionBlur: null, opacity: 1, blendMode: "normal", ...fields,
  };
}

/**
 * Pass group of a Gaussian blur of sigma `sigma` px at the render size (classic `effects/definitions/blur.ts`):
 * `iterations = min(8, max(1, ceil(σ² / 40²)))` horizontal-then-vertical pairs, each with the per-pass sigma
 * `σ / √iterations` and tap spacing `max(1, sigma / 10)`. A sigma below 0.001 builds nothing.
 */
export function gaussianBlurPasses(sigma: number): EffectPass[] {
  if (!(sigma >= 0.001)) return [];
  const iterations = Math.min(8, Math.max(1, Math.ceil((sigma * sigma) / 1600)));
  const perPass = sigma / Math.sqrt(iterations);
  const step = Math.max(1, perPass / 10);
  const passes: EffectPass[] = [];
  for (let index = 0; index < iterations; index++) {
    passes.push({ shader: "gaussian-blur", uniforms: { u_sigma: perPass, u_step: step, u_direction: [1, 0] } });
    passes.push({ shader: "gaussian-blur", uniforms: { u_sigma: perPass, u_step: step, u_direction: [0, 1] } });
  }
  return passes;
}

/** `longSide(renderTarget) / 1920`: the factor every pixel-valued parameter is multiplied by. */
export const pixelScaleFactor = (render: { width: number; height: number }): number => Math.max(render.width, render.height) / 1920;
