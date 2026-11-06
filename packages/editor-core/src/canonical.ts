import { projectDocumentSchema, unwrap, type ProjectDocument } from "@jagentchill/protocol";
import type { z } from "zod";
import { sha256, toHex, utf8 } from "./sha256.ts";
import { roundHalfAway } from "./time.ts";

export const MAX_DOCUMENT_BYTES = 67_108_864;
export class CanonicalError extends Error {
  readonly path: string;
  constructor(path: string, message: string) { super(message); this.name = "CanonicalError"; this.path = path; }
}

/** A number the canonical form can hold: finite, not negative zero, an integer within ±(2^53 − 1) when it is an integer. */
export const isCanonicalNumber = (value: number): boolean =>
  Number.isFinite(value) && !Object.is(value, -0) && (!Number.isInteger(value) || Number.isSafeInteger(value));

function write(value: unknown, path: string, out: string[]): void {
  if (value === null) { out.push("null"); return; }
  switch (typeof value) {
    case "boolean": out.push(value ? "true" : "false"); return;
    case "number":
      if (!isCanonicalNumber(value)) throw new CanonicalError(path, "the canonical form holds no NaN, infinity, negative zero or integer beyond ±(2^53 − 1)");
      out.push(String(value)); return;
    case "string": out.push(JSON.stringify(value.normalize("NFC"))); return;
    case "object": break;
    default: throw new CanonicalError(path, `a ${typeof value} is not JSON`);
  }
  if (Array.isArray(value)) {
    out.push("[");
    value.forEach((entry, index) => { if (index) out.push(","); write(entry === undefined ? null : entry, `${path}/${index}`, out); });
    out.push("]");
    return;
  }
  // Default string order is UTF-16 code unit order, which is the canonical key order.
  const keys = Object.keys(value).filter((key) => (value as Record<string, unknown>)[key] !== undefined).sort();
  out.push("{");
  keys.forEach((key, index) => {
    if (index) out.push(",");
    out.push(JSON.stringify(key.normalize("NFC")), ":");
    write((value as Record<string, unknown>)[key], `${path}/${key}`, out);
  });
  out.push("}");
}

/** The document without its device-local section. */
export function withoutLocal<T extends object>(document: T): Omit<T, "local"> {
  const { local: _local, ...rest } = document as T & { local?: unknown };
  return rest;
}

/**
 * The canonical form: JSON of the document without `local`, keys sorted by UTF-16 code unit at every level, no
 * insignificant whitespace, strings NFC. Two documents are equal exactly when these strings are equal.
 */
export function canonicalize(document: object): string {
  const out: string[] = [];
  write(withoutLocal(document), "", out);
  return out.join("");
}
/** Canonical JSON of any value (a patch, a snapshot manifest); nothing is left out. */
export function canonicalJson(value: unknown): string {
  const out: string[] = [];
  write(value, "", out);
  return out.join("");
}
export const canonicalBytes = (document: object): Uint8Array => utf8(canonicalize(document));
/** SHA-256 of the canonical form, 64 lowercase hexadecimal characters. */
export const documentHash = (document: object): string => toHex(sha256(canonicalBytes(document)));
export const documentsEqual = (a: object, b: object): boolean => canonicalize(a) === canonicalize(b);

/** Rounds a non-integer to at most `digits` fractional digits, half away from zero. */
export function roundStored(value: number, digits = 6): number {
  if (Number.isInteger(value) || !Number.isFinite(value)) return value;
  const scale = 10 ** digits;
  const rounded = roundHalfAway(value * scale) / scale;
  return Object.is(rounded, -0) ? 0 : rounded;
}

type Shape = z.ZodRawShape;
const typeName = (schema: z.ZodTypeAny) => (schema._def as { typeName: string }).typeName;
function normalize(value: unknown, schema: z.ZodTypeAny | undefined, digits: number): unknown {
  if (typeof value === "number") return roundStored(value, schema && unwrap(schema).tags.kind === "Db" ? 2 : digits);
  if (typeof value === "string") {
    const kind = schema ? unwrap(schema).tags.kind : undefined;
    return kind === "Color" || kind === "ColorRgb" ? value.toLowerCase() : value.normalize("NFC");
  }
  if (value === null || typeof value !== "object") return value;
  const { inner, tags } = schema ? unwrap(schema) : { inner: undefined, tags: {} as ReturnType<typeof unwrap>["tags"] };
  if (tags.variants) {
    const name = (value as Record<string, unknown>)[tags.variantKey!] ?? tags.defaultVariant;
    return normalize(value, typeof name === "string" ? tags.variants[name] && withoutVariant(tags.variants[name]) : undefined, digits);
  }
  if (Array.isArray(value)) {
    const item = inner && typeName(inner) === "ZodArray" ? (inner._def as { type: z.ZodTypeAny }).type : inner && typeName(inner) === "ZodTuple" ? undefined : undefined;
    return value.map((entry) => normalize(entry, item, digits));
  }
  // A key no schema declares is carried unchanged: it is never interpreted, not even rounded.
  if (!inner) return value;
  const out: Record<string, unknown> = {};
  const members: Shape | undefined = typeName(inner) === "ZodObject" ? (inner as z.ZodObject<Shape>).shape : undefined;
  const valueType = typeName(inner) === "ZodRecord" ? (inner._def as { valueType: z.ZodTypeAny }).valueType : undefined;
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) continue;
    const member = members ? members[key] : valueType;
    // Stroke points are rounded to 0.01.
    out[key] = member ? normalize(entry, member, key === "points" && members && "brush" in members ? 2 : digits) : entry;
  }
  return out;
}
const withoutVariant = (schema: z.ZodTypeAny): z.ZodTypeAny => schema;

/**
 * What a writer does to values before it stores them: non-integers rounded to 6 fractional digits (decibels and
 * stroke points to 2), strings NFC, colours lower case. Unknown keys are returned untouched.
 */
export function normalizeDocumentValues<T extends ProjectDocument>(document: T): T {
  const { local, ...rest } = document as T & { local?: unknown };
  const out = normalize(rest, projectDocumentSchema, 6) as T;
  return (local === undefined ? out : { ...out, local }) as T;
}
/** `normalizeDocumentValues` for one value of a known schema (an element, a track). */
export const normalizeValue = <T>(value: T, schema: z.ZodTypeAny): T => normalize(value, schema, 6) as T;
