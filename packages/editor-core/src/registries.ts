/**
 * Open registries the validator consults. Their content is owned by other capabilities (effects and filters,
 * transitions, clip and text animations, bubbles); the validator only needs ids and parameter definitions. A registry
 * that is not supplied is not checked.
 */
export type ParamDefinition = { type: "number" | "boolean" | "string" | "color"; min?: number; max?: number; default: number | boolean | string; keyframable?: boolean };
export type EffectDefinition = { kind: "effect" | "filter"; params: Record<string, ParamDefinition> };
export type Registries = {
  effects?: Record<string, EffectDefinition>;
  transitions?: Record<string, { params?: Record<string, ParamDefinition> }>;
  clipAnimations?: readonly string[];
  textAnimations?: readonly string[];
  bubbles?: readonly string[];
};

/** EQ band values of each preset (`audio-editing`): a preset other than `custom` carries exactly these. */
export const EQ_PRESET_BANDS: Record<string, { low: number; lowMid: number; mid: number; highMid: number; high: number }> = {
  flat: { low: 0, lowMid: 0, mid: 0, highMid: 0, high: 0 },
  "voice-clarity": { low: -3, lowMid: -2, mid: 0, highMid: 4, high: 2 },
  "bass-boost": { low: 6, lowMid: 2, mid: 0, highMid: 0, high: 0 },
  "treble-boost": { low: 0, lowMid: 0, mid: 0, highMid: 2, high: 6 },
  warm: { low: 3, lowMid: 2, mid: 0, highMid: -1, high: -3 },
  radio: { low: -12, lowMid: -3, mid: 3, highMid: 5, high: -9 },
};
