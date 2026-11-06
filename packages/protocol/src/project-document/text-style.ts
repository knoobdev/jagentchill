import { z } from "zod";
import { bool, num, obj, oneOf, oneOfNumbers, row, str } from "./kit.ts";
import { colorSchema, degrees, idSchema, percent, ticks, vec2Schema } from "./values.ts";

export const FONT_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const;

/** What a text style starts from: the text-element defaults, or the caption style `classic`. */
type StyleDefaults = { fontWeight: (typeof FONT_WEIGHTS)[number]; fontSize: number; strokeEnabled: boolean };
const TEXT_DEFAULTS: StyleDefaults = { fontWeight: 400, fontSize: 15, strokeEnabled: false };
const CAPTION_CLASSIC: StyleDefaults = { fontWeight: 700, fontSize: 5, strokeEnabled: true };

const textAnimationSlot = row(obj({ id: idSchema, duration: ticks(), strength: percent().default(100) }));
export const textAnimationSchema = obj({
  in: textAnimationSlot.optional(),
  out: textAnimationSlot.optional(),
  loop: row(obj({ id: idSchema, period: ticks(600_000, 24_000), strength: percent().default(100) })).optional(),
});

export const bubbleSchema = obj({
  id: idSchema,
  color: colorSchema.optional(),
  strokeColor: colorSchema.optional(),
  strokeWidth: num(0, 20).optional(),
  flipHorizontal: bool().default(false),
});

/**
 * The TextStyle rows of catalogue §10.4. `partial` builds the per-caption override shape: the same keys and ranges,
 * every key optional and none defaulted, so that a present key overrides the track style and an absent one inherits.
 */
function textStyleShape(defaults: StyleDefaults, partial: boolean) {
  const field = <T extends z.ZodTypeAny>(schema: T, value: z.input<T>) => (partial ? schema.optional() : schema.default(value)) as z.ZodDefault<T>;
  const group = <S extends z.ZodRawShape>(shape: S) => (partial ? obj(shape).optional() : obj(shape).default({} as never)) as unknown as z.ZodDefault<z.ZodObject<S, "passthrough">>;
  return {
    fontFamily: field(str(200, 1), "Arial"),
    fontSize: field(num(1, 500), defaults.fontSize),
    fontWeight: field(oneOfNumbers(...FONT_WEIGHTS), defaults.fontWeight),
    fontStyle: field(oneOf("normal", "italic"), "normal"),
    underline: field(bool(), false),
    strikethrough: field(bool(), false),
    textCase: field(oneOf("none", "upper", "lower", "title"), "none"),
    color: field(colorSchema, "#ffffff"),
    fill: group({
      type: field(oneOf("solid", "gradient"), "solid"),
      gradientColor: field(colorSchema, "#ffd400"),
      gradientAngle: field(degrees(0, 360), 90),
    }),
    textAlign: field(oneOf("left", "center", "right", "justify"), "center"),
    letterSpacing: field(num(-100, 500), 0),
    lineHeight: field(num(0.1, 10), 1.2),
    box: group({ mode: field(oneOf("auto", "fixed"), "auto"), width: field(percent(5, 400), 80) }),
    curve: field(degrees(-360, 360), 0),
    background: group({
      enabled: field(bool(), false),
      color: field(colorSchema, "#000000"),
      cornerRadius: field(num(0, 100), 0),
      paddingX: field(num(0, 1000), 30),
      paddingY: field(num(0, 1000), 42),
      offsetX: field(num(-100_000, 100_000), 0),
      offsetY: field(num(-100_000, 100_000), 0),
    }),
    stroke: group({
      enabled: field(bool(), defaults.strokeEnabled),
      color: field(colorSchema, "#000000"),
      width: field(num(0, 50), 6),
      position: field(oneOf("outside", "center"), "outside"),
    }),
    shadow: group({
      enabled: field(bool(), false),
      color: field(colorSchema, "#000000"),
      opacity: field(percent(), 80),
      blur: field(percent(), 10),
      distance: field(percent(), 5),
      angle: field(degrees(-180, 180), -45),
    }),
    glow: group({
      enabled: field(bool(), false),
      color: field(colorSchema, "#ffffff"),
      intensity: field(percent(), 50),
      radius: field(percent(), 20),
    }),
    bubble: bubbleSchema.optional(),
    textAnimation: textAnimationSchema.optional(),
    stylePresetId: idSchema.optional(),
  };
}

/** TextStyle as stored at the top level of a text element. */
export const TEXT_STYLE_SHAPE = textStyleShape(TEXT_DEFAULTS, false);
export const TEXT_STYLE_KEYS = Object.keys(TEXT_STYLE_SHAPE);

const { bubble: _bubble, ...captionStyle } = textStyleShape(CAPTION_CLASSIC, false);
/** The style of a caption track: a complete TextStyle without `bubble`, starting from the style `classic`. */
export const captionTrackStyleSchema = row(obj(captionStyle, ["bubble", "tracking"]));

const { bubble: _b, ...captionOverride } = textStyleShape(TEXT_DEFAULTS, true);
/** Per-caption overrides: any subset of the track style's keys. */
export const captionStyleOverrideSchema = row(obj(captionOverride, ["bubble", "tracking"]));

const { bubble: _c, textAnimation: _t, ...coverStyle } = textStyleShape(TEXT_DEFAULTS, false);
/** The style of a cover text: no animation, tracking or bubble. */
export const coverTextStyleSchema = row(obj(coverStyle, ["bubble", "tracking", "textAnimation"]));

export const captionTransformSchema = row(obj({ position: vec2Schema, scale: vec2Schema, rotation: degrees(-3600, 3600) }));
