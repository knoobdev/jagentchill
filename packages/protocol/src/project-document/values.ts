import { z } from "zod";
import { fail, tag } from "./kit.ts";

/** Schema version of documents this build writes. */
export const PROJECT_SCHEMA_VERSION = 33;
export const TICKS_PER_SECOND = 120_000;
export const MAX_TICKS = 10_368_000_000;
export const MAX_ELEMENT_DURATION = 2_592_000_000;
export const MAX_MS = 8_640_000_000_000_000;

const ID_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;
export const isId = (value: unknown): value is string => typeof value === "string" && ID_PATTERN.test(value);
// Hot leaves use Zod's native checks; the message carries the document code (`code:<document/…>`) for the validator.
export const idSchema = tag(z.string().regex(ID_PATTERN, "code:document/invalid-id"), { kind: "Id" });

const NOT_TICKS = "code:document/not-integer-ticks";
/** Integer media time. A fractional or negative value is not a tick at all; a value past `max` is out of range. */
export const ticks = (max = MAX_TICKS, min = 0) => {
  const base = z.number().int(NOT_TICKS).nonnegative(NOT_TICKS).max(max);
  return tag(min > 0 ? base.min(min) : base, { kind: "Ticks", min, max });
};
export const ticksSchema = ticks();

export const msSchema = tag(z.number().int().min(0).max(MAX_MS), { kind: "Ms" });

export const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b));
const rationalPart = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 1_000_000;
export const rationalSchema = tag(z.object({ numerator: z.number(), denominator: z.number() }).passthrough().superRefine((value, ctx) => {
  if (!rationalPart(value.numerator) || !rationalPart(value.denominator)) fail(ctx, "document/invalid-rational", [], "numerator and denominator are integers 1…1 000 000");
  else if (gcd(value.numerator, value.denominator) !== 1) fail(ctx, "document/invalid-rational", [], "a rational is reduced by its greatest common divisor");
}), { kind: "Rational", list: "row" });
export type Rational = { numerator: number; denominator: number };

const colour = (pattern: RegExp, kind: string) => tag(z.string().regex(pattern, "code:document/invalid-color"), { kind });
// Readers accept upper case; `normalizeDocumentValues` of editor-core stores lower case.
export const colorSchema = colour(/^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, "Color");
export const colorRgbSchema = colour(/^#[0-9a-fA-F]{6}$/, "ColorRgb");

export const sha256Schema = tag(z.string().regex(/^[0-9a-f]{64}$/), { kind: "Sha256" });
export const langSchema = tag(z.string().regex(/^(?:und|[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*)$/), { kind: "Lang" });

export const codePoints = (value: string): number => { let count = 0; for (const _ of value) count++; return count; };
/** `Text(n)`: at most `max` Unicode code points. */
export const text = (max: number, min = 0) => tag(z.string().superRefine((value, ctx) => {
  // A string has at most as many code points as UTF-16 units, so a short one needs no counting.
  if (min === 0 && value.length <= max) return;
  const length = codePoints(value);
  if (length < min || length > max) fail(ctx, "document/out-of-range", [], `expected ${min}–${max} characters`, { min, max });
}), { kind: "Text", min, max });

const finite = () => z.number().finite();
export const vec2Schema = tag(z.object({ x: finite(), y: finite() }).passthrough(), { kind: "Vec2", list: "row" });
export const db = (min: number, max: number) => tag(finite().min(min).max(max), { kind: "Db" });
export const percent = (min = 0, max = 100) => tag(finite().min(min).max(max), { kind: "Percent" });
export const fraction = (min = 0, max = 1) => tag(finite().min(min).max(max), { kind: "Fraction" });
export const degrees = (min: number, max: number) => tag(finite().min(min).max(max), { kind: "Degrees" });
