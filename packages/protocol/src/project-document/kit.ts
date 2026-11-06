import { z } from "zod";

/**
 * Building blocks of the project-document schemas. Every schema is a Zod schema; the tags recorded here let the
 * field-list generator, the validator and the unknown-field scanner read what a schema means without a second
 * declaration of the document.
 */
export type SchemaTag = {
  /** Catalogue value type (`Id`, `Ticks`, `Color`, `Text`, …) of a leaf. */
  kind?: string;
  min?: number;
  max?: number;
  /** Variant table of a union keyed by `variantKey`. */
  variantKey?: string;
  variants?: Record<string, z.ZodTypeAny>;
  defaultVariant?: string;
  /** Catalogue presentation: `row` = listed as one row and not expanded, `both` = listed and expanded. */
  list?: "row" | "both";
  /** Keys of schema 32 that must be absent on this object. */
  forbid?: readonly string[];
};

const TAGS = new WeakMap<z.ZodTypeAny, SchemaTag>();
export function tag<T extends z.ZodTypeAny>(schema: T, value: SchemaTag): T {
  TAGS.set(schema, { ...TAGS.get(schema), ...value });
  return schema;
}
export const tagOf = (schema: z.ZodTypeAny): SchemaTag => TAGS.get(schema) ?? {};
/** Lists a structure as one catalogue row (its members are described by the row's type). */
export const row = <T extends z.ZodTypeAny>(schema: T): T => listed(schema, "row");
/** Lists a structure as a row and also lists its members. */
export const both = <T extends z.ZodTypeAny>(schema: T): T => listed(schema, "both");
// The presentation belongs to one use of a schema, so it is recorded on a copy: the shared schema keeps its own tags.
const listed = <T extends z.ZodTypeAny>(schema: T, list: "row" | "both"): T => tag(schema.describe(schema.description ?? "") as T, { ...tagOf(schema), list });

/** Adds an issue that already carries its `document/<kebab>` code. */
export function fail(ctx: z.RefinementCtx, code: string, path: (string | number)[], message: string, details?: Record<string, unknown>): void {
  ctx.addIssue({ code: "custom", path, message, params: { code, ...(details ? { details } : {}) } });
}

export const num = (min: number, max: number) => z.number().finite().min(min).max(max);
export const int = (min: number, max: number) => z.number().int().min(min).max(max);
export const bool = z.boolean;
export const oneOf = <T extends [string, ...string[]]>(...values: T) => z.enum(values);
/** A closed union of numbers, such as the font weights. */
export const oneOfNumbers = <T extends [number, number, ...number[]]>(...values: T) =>
  z.union(values.map((value) => z.literal(value)) as unknown as [z.ZodLiteral<T[number]>, z.ZodLiteral<T[number]>]);
/** A free string that is not a `Text(n)`: at most 4 000 characters. */
export const str = (max = 4000, min = 0) => z.string().min(min).max(max);

/**
 * An object that keeps the keys it does not know. `forbid` names schema-32 keys that belong to another variant or to
 * the classic shape: their presence is `document/field-not-allowed`.
 */
export function obj<S extends z.ZodRawShape>(shape: S, forbid: readonly string[] = []): z.ZodObject<S, "passthrough"> {
  const base = z.object(shape).passthrough();
  if (forbid.length === 0) return base;
  const refined = base.superRefine((value, ctx) => {
    for (const key of forbid) if (key in value) fail(ctx, "document/field-not-allowed", [key], `"${key}" does not exist here`);
  });
  // Typed as the object it wraps so that callers compose it like one; read its members with `unwrap`, never `.shape`.
  return tag(refined, { forbid }) as unknown as z.ZodObject<S, "passthrough">;
}

/** An array whose upper bound is a named limit of the catalogue (`document/limit-exceeded`). */
export const limited = <T extends z.ZodTypeAny>(item: T, max: number, limit: string, min = 0) => {
  const array = z.array(item).max(max, `limit:${limit}`);
  return min > 0 ? array.min(min) : array;
};

type VariantOutput<V extends Record<string, z.ZodTypeAny>> = { [K in keyof V]: z.output<V[K]> }[keyof V];
type VariantInput<V extends Record<string, z.ZodTypeAny>> = { [K in keyof V]: z.input<V[K]> }[keyof V];

/**
 * A union discriminated by `key`. Unlike `z.discriminatedUnion` the members may be refined objects, a missing
 * discriminator can fall back to `defaultVariant`, and an unknown member is reported with `unknownCode` so that the
 * validator can keep it on a document written by a newer app.
 */
export function variants<V extends Record<string, z.ZodTypeAny>>(
  key: string, table: V, options: { defaultVariant?: keyof V & string; unknownCode?: string } = {},
): z.ZodType<VariantOutput<V>, z.ZodTypeDef, VariantInput<V>> {
  const schema = z.any().transform((value, ctx) => {
    if (value === undefined) { ctx.addIssue({ code: "invalid_type", expected: "object", received: "undefined" }); return z.NEVER; }
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      ctx.addIssue({ code: "invalid_type", expected: "object", received: value === null ? "null" : Array.isArray(value) ? "array" : typeof value as "string" });
      return z.NEVER;
    }
    const name = (value as Record<string, unknown>)[key] ?? options.defaultVariant;
    if (name === undefined) { ctx.addIssue({ code: "invalid_type", expected: "string", received: "undefined", path: [key] }); return z.NEVER; }
    const member = typeof name === "string" && Object.hasOwn(table, name) ? table[name] : undefined;
    if (!member) {
      fail(ctx, options.unknownCode ?? "document/wrong-type", [key], `unknown ${key} ${JSON.stringify(name)}`, { unknownMember: true });
      return z.NEVER;
    }
    const result = member.safeParse(value);
    if (result.success) return result.data;
    for (const found of result.error.issues) ctx.addIssue(found);
    return z.NEVER;
  });
  return tag(schema, { variantKey: key, variants: table, defaultVariant: options.defaultVariant }) as never;
}

/** Peels optional, nullable, default and refinement wrappers; reports what it removed. */
export type Unwrapped = { inner: z.ZodTypeAny; optional: boolean; nullable: boolean; hasDefault: boolean; defaultValue?: unknown; tags: SchemaTag };
// Schemas are built once and tagged before first use, so what a schema unwraps to never changes.
const UNWRAPPED = new WeakMap<z.ZodTypeAny, Unwrapped>();
export function unwrap(schema: z.ZodTypeAny): Unwrapped {
  let known = UNWRAPPED.get(schema);
  if (!known) UNWRAPPED.set(schema, known = unwrapOnce(schema));
  return known;
}
function unwrapOnce(schema: z.ZodTypeAny): Unwrapped {
  let optional = false, nullable = false, hasDefault = false, defaultValue: unknown;
  let tags: SchemaTag = {};
  let current = schema;
  for (;;) {
    tags = { ...tagOf(current), ...tags };
    const def = current._def as { typeName: string; innerType?: z.ZodTypeAny; schema?: z.ZodTypeAny; defaultValue?: () => unknown };
    if (def.typeName === "ZodOptional") { optional = true; current = def.innerType!; }
    else if (def.typeName === "ZodNullable") { nullable = true; current = def.innerType!; }
    else if (def.typeName === "ZodDefault") { hasDefault = true; defaultValue = def.defaultValue!(); current = def.innerType!; }
    else if (def.typeName === "ZodEffects" && !tagOf(current).variants && !tagOf(current).kind) current = def.schema!;
    else break;
  }
  return { inner: current, optional, nullable, hasDefault, defaultValue, tags };
}
