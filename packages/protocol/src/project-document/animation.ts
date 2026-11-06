import { z } from "zod";
import { limited, obj, oneOf, row, tag } from "./kit.ts";
import { idSchema, ticks } from "./values.ts";

const finite = () => z.number().finite();

/** A point of a freeform mask path: an anchor and its two tangent handles, relative to the anchor. */
export const pathPointSchema = obj({
  id: idSchema,
  x: finite(), y: finite(),
  inX: finite().default(0), inY: finite().default(0),
  outX: finite().default(0), outY: finite().default(0),
});
export type PathPoint = z.infer<typeof pathPointSchema>;

export const SEGMENT_TYPES = ["step", "linear", "bezier"] as const;
const handle = (sign: -1 | 1) => row(obj({ dt: z.number().int().refine((dt) => dt * sign >= 0, sign < 0 ? "dt ≤ 0" : "dt ≥ 0"), dv: finite() }));

export const scalarKeySchema = obj({
  id: idSchema,
  time: ticks(),
  value: finite(),
  segmentToNext: oneOf(...SEGMENT_TYPES).default("linear"),
  tangentMode: oneOf("auto", "aligned", "broken", "flat").default("auto"),
  leftHandle: handle(-1).optional(),
  rightHandle: handle(1).optional(),
});
export type ScalarKey = z.infer<typeof scalarKeySchema>;

export const scalarChannelSchema = obj({
  keys: row(limited(scalarKeySchema, 1000, "keysPerChannel", 1)),
  extrapolation: obj({ before: oneOf("hold", "linear").default("hold"), after: oneOf("hold", "linear").default("hold") }).default({}),
});
export type ScalarChannel = z.infer<typeof scalarChannelSchema>;

export const discreteChannelSchema = obj({
  keys: row(limited(obj({ id: idSchema, time: ticks(), value: z.union([z.boolean(), z.string().max(4000)]) }), 1000, "keysPerChannel", 1)),
});
export type DiscreteChannel = z.infer<typeof discreteChannelSchema>;

/** Linear-light components; the four channels share key ids and times (checked by the validator). */
export const colorChannelSchema = obj({ r: row(scalarChannelSchema), g: row(scalarChannelSchema), b: row(scalarChannelSchema), a: row(scalarChannelSchema) });
export type ColorChannel = z.infer<typeof colorChannelSchema>;

export const pathKeySchema = obj({
  id: idSchema,
  time: ticks(),
  value: obj({ points: row(limited(pathPointSchema, 256, "pointsPerPath")) }),
  segmentToNext: oneOf(...SEGMENT_TYPES).default("linear"),
  easing: row(z.tuple([finite().min(0).max(1), finite(), finite().min(0).max(1), finite()])).default([0.25, 0.1, 0.25, 1]),
});
export const pathChannelSchema = obj({ keys: row(limited(pathKeySchema, 1000, "keysPerChannel", 1)) });
export type PathChannel = z.infer<typeof pathChannelSchema>;

export type ChannelShape = "scalar" | "discrete" | "color" | "path";
export const CHANNEL_SCHEMAS = { scalar: scalarChannelSchema, discrete: discreteChannelSchema, color: colorChannelSchema, path: pathChannelSchema } as const;
export type AnimationChannel = ScalarChannel | DiscreteChannel | ColorChannel | PathChannel;

/** The shape a stored channel has, read from its own data; the validator compares it with the shape its path demands. */
export function channelShapeOf(channel: unknown): ChannelShape | null {
  if (channel === null || typeof channel !== "object" || Array.isArray(channel)) return null;
  const record = channel as Record<string, unknown>;
  if ("r" in record || "g" in record || "b" in record || "a" in record) return "color";
  if (!Array.isArray(record.keys)) return null;
  const value = (record.keys[0] as { value?: unknown } | undefined)?.value;
  if (typeof value === "boolean" || typeof value === "string") return "discrete";
  if (value !== null && typeof value === "object") return "path";
  return "scalar";
}

const channelSchema = z.any().transform((value, ctx) => {
  const shape = channelShapeOf(value);
  if (!shape) { ctx.addIssue({ code: "custom", message: "not an animation channel", params: { code: "document/animation-channel-invalid" } }); return z.NEVER; }
  const result = CHANNEL_SCHEMAS[shape].safeParse(value);
  if (result.success) return result.data as AnimationChannel;
  for (const found of result.error.issues) ctx.addIssue(found);
  return z.NEVER;
});

/** `animations`: property path → channel. At most 256 animated paths per element. */
export const animationsSchema = tag(z.record(channelSchema).superRefine((value, ctx) => {
  const count = Object.keys(value).length;
  if (count > 256) ctx.addIssue({ code: "custom", message: "limit:animatedPathsPerElement", params: { code: "document/limit-exceeded", details: { limit: "animatedPathsPerElement", value: 256 } } });
}), { kind: "AnimationStore" });
export type AnimationStore = z.infer<typeof animationsSchema>;
