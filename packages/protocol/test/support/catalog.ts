import { readFileSync } from "node:fs";
import type { FieldRow } from "../../src/index.ts";

/** A row of a field table of `catalog.md`, expanded to one entry per stored key. */
export type CatalogRow = { section: string; key: string; type: string; range: string; default: string; owner: string };

export const CATALOG_PATH = new URL("../../../../openspec/changes/build-jagentchill/specs/project-document/catalog.md", import.meta.url);
const HSL_BANDS = ["red", "orange", "yellow", "green", "aqua", "blue", "purple", "magenta"];
const cells = (line: string) => line.split(/(?<!\\)\|/).slice(1, -1).map((cell) => cell.trim().replaceAll("\\|", "|"));

/** `a.<x|y>.b` → `a.x.b`, `a.y.b`; `<band>` is the eight HSL bands. */
function expandAlternatives(key: string): string[] {
  const match = /<([^>]+)>/.exec(key);
  if (!match) return [key];
  const options = match[1] === "band" ? HSL_BANDS : match[1].split("|");
  return options.flatMap((option) => expandAlternatives(key.replace(match[0], option)));
}

/** The stored keys a Field cell names: several backticked keys, `.x` continuing the previous key, a structure name as prefix. */
function keysOf(cell: string): string[] {
  const struct = /^([A-Z][A-Za-z]+)\s+`/.exec(cell)?.[1];
  const tokens = [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
  const keys: string[] = [];
  let previous = "";
  for (const token of tokens) {
    let key: string;
    if (token.startsWith(".") && previous) key = previous.slice(0, previous.lastIndexOf(".")) + token;
    else key = struct ? `${struct}${token}` : token;
    previous = key;
    keys.push(...expandAlternatives(key));
  }
  return keys;
}

/** Every field row of the numbered sections of the catalogue that hold field tables (§2–§12 and §16). */
export function parseCatalog(markdown = readFileSync(CATALOG_PATH, "utf8")): CatalogRow[] {
  const rows: CatalogRow[] = [];
  let section = "", inFieldTable = false;
  for (const line of markdown.split("\n")) {
    const heading = /^#{2,3}\s+(\d+(?:\.\d+)?)\.?\s/.exec(line);
    if (heading) { section = heading[1]; inFieldTable = false; continue; }
    if (!line.startsWith("|")) { inFieldTable = false; continue; }
    if (/^\|\s*Field\s*\|\s*Type\s*\|/.test(line)) { inFieldTable = true; continue; }
    if (!inFieldTable || /^\|\s*-/.test(line)) continue;
    const [field, type, range, fallback, , owner] = cells(line);
    for (const key of keysOf(field)) rows.push({ section, key, type, range, default: fallback, owner });
  }
  return rows.filter((entry) => { const major = Number(entry.section.split(".")[0]); return (major >= 2 && major <= 12) || major === 16; });
}

const VALUE_KINDS = ["Id", "Ticks", "Rational", "Ms", "ColorRgb", "Color", "Db", "Percent", "Fraction", "Degrees", "Sha256", "Lang", "Vec2"];
const NUMERIC = ["integer", "number", "Db", "Percent", "Fraction", "Degrees"];
const plain = (value: string) => value.replaceAll("`", "").trim();

/** The comparable class of a catalogue Type cell. Composite types reduce to `object`, `array`, `map`, `union` or `tuple`. */
export function catalogType(cell: string): { type: string; nullable: boolean } {
  let value = plain(cell).replace(/\s+each\b.*$/, "").replace(/\s+\(\d+ fields?[^)]*\)$/, "").trim();
  if (/^same union as/.test(value)) return { type: "same", nullable: false };
  const nullable = /\s+or null$/.test(value);
  if (nullable) value = value.replace(/\s+or null$/, "");
  if (/^array of/.test(value)) return { type: "array", nullable };
  if (/^map\b/.test(value)) return { type: "map", nullable };
  if (/^\[/.test(value)) return { type: "tuple", nullable };
  if (/ or /.test(value)) return { type: "union", nullable };
  if (/^\{/.test(value)) return { type: "object", nullable };
  if (/^Text\(\d+\)$/.test(value) || VALUE_KINDS.includes(value) || ["boolean", "integer", "number", "string"].includes(value)) return { type: value, nullable };
  if (/^(?:"[^"]*"|null|-?\d+)(?: \| (?:"[^"]*"|null|-?\d+))*$/.test(value)) return { type: value, nullable };
  // A named structure of another section (`Settings (§3.1)`, `TextStyle (…)`, `MaskTracking`, `AnimationStore (§11)`).
  return { type: "structure", nullable };
}
/** The comparable class of a generated row's type. */
export function schemaType(row: FieldRow): string {
  if (row.type.startsWith("array of")) return "array";
  return row.type;
}
const COMPOSITE = ["object", "array", "map", "union", "tuple", "custom", "AnimationStore", "Rational", "Vec2"];
export function typesAgree(catalog: { type: string }, row: FieldRow): boolean {
  const actual = schemaType(row);
  if (catalog.type === "same") return true;
  if (catalog.type === "structure") return COMPOSITE.includes(actual);
  if (catalog.type === "union") return actual.includes(" | ") || actual === "union";
  if (catalog.type === "object") return actual === "object" || actual === "union";
  return catalog.type === actual;
}

const NUM = String.raw`[+−-]?\d[\d  ]*(?:\.\d+)?`;
const toNumber = (text: string) => Number(text.replaceAll(/[  ]/g, "").replace("−", "-").replace("+", ""));
/** The numeric bounds a Unit / range cell states, when it states them as numbers. */
export function catalogRange(cell: string): { min?: number; max?: number } {
  const text = plain(cell).replace(/2\^53\s*−\s*1/, String(Number.MAX_SAFE_INTEGER));
  const span = new RegExp(`(${NUM})(?:\\s*\\([^)]*\\))?\\s*(?:–|…)\\s*(${NUM})`).exec(text);
  if (span) return { min: toNumber(span[1]), max: toNumber(span[2]) };
  const min = new RegExp(`(?:≥|>)\\s*(${NUM})`).exec(text), max = new RegExp(`≤\\s*(${NUM})`).exec(text);
  return { ...(min ? { min: toNumber(min[1]) } : {}), ...(max ? { max: toNumber(max[1]) } : {}) };
}
export const isNumericType = (type: string) => NUMERIC.includes(type);
export const impliedRange = (type: string): { min?: number; max?: number } => (type === "Percent" ? { min: 0, max: 100 } : type === "Fraction" ? { min: 0, max: 1 } : {});

export type CatalogDefault = { presence: "required" | "absent" | "conditional" | "described" } | { presence: "default"; value: unknown };
/** The Default cell: required, absent, a literal value, or a description that names no literal ("per catalogue"). */
export function catalogDefault(cell: string): CatalogDefault {
  const text = cell.trim();
  if (text === "required") return { presence: "required" };
  if (/required/.test(text)) return { presence: "conditional" };
  if (/^absent\b/.test(text)) return { presence: "absent" };
  const literal = (/^`([^`]*)`/.exec(text)?.[1] ?? text.replace(/\s*\(.*\)$/, "")).trim();
  if (literal === "true" || literal === "false") return { presence: "default", value: literal === "true" };
  if (literal === "null") return { presence: "default", value: null };
  if (literal === "[]") return { presence: "default", value: [] };
  if (literal === "{}") return { presence: "default", value: {} };
  if (/^"[^"]*"$/.test(literal)) return { presence: "default", value: literal.slice(1, -1) };
  if (/^#[0-9a-f]{6,8}$/.test(literal)) return { presence: "default", value: literal };
  if (new RegExp(`^${NUM}$`).test(literal)) return { presence: "default", value: toNumber(literal) };
  if (/^\[\{/.test(literal)) return { presence: "default", value: [...literal.matchAll(/\{([^}]*)\}/g)].map((match) => match[1].split(",").map((part) => Number(part))) };
  if (/^\{.*:.*\}$/.test(literal)) return { presence: "default", value: JSON.parse(literal.replace(/([{,]\s*)([A-Za-z_]\w*)\s*:/g, '$1"$2":')) };
  // `{30, 1}` — the values of the structure's members in order.
  if (/^\{[^:]*\}$/.test(literal)) return { presence: "default", value: literal.slice(1, -1).split(",").map((part) => Number(part)) };
  return { presence: "described" };
}
const flat = (value: unknown): unknown => (Array.isArray(value) ? value.map(flat) : value !== null && typeof value === "object" ? Object.values(value).map(flat) : value);
/** Whether a schema default equals a catalogue default; the shorthand `{30, 1}` compares member values in order. */
export function defaultsAgree(catalog: unknown, actual: unknown): boolean {
  if (JSON.stringify(catalog) === JSON.stringify(actual)) return true;
  return Array.isArray(catalog) && JSON.stringify(catalog) === JSON.stringify(flat(actual));
}

export type Difference = { section: string; key: string; kind: "in schema, not in catalogue" | "in catalogue, not in schema" | "type" | "range" | "default"; detail: string };

/**
 * Compares the generated field list with the catalogue rows. `accepted` lists the differences that are deliberate,
 * each with its reason (`section|key|kind`).
 */
export function compareFieldLists(schemaRows: FieldRow[], catalogRows: CatalogRow[], accepted: Record<string, string> = {}): { compared: number; differences: Difference[] } {
  const differences: Difference[] = [];
  const report = (difference: Difference) => { if (!accepted[`${difference.section}|${difference.key}|${difference.kind}`]) differences.push(difference); };
  const id = (entry: { section: string; key: string }) => `${entry.section}|${entry.key}`;
  const bySchema = new Map(schemaRows.map((entry) => [id(entry), entry]));
  const byCatalog = new Map<string, CatalogRow>();
  for (const entry of catalogRows) if (!byCatalog.has(id(entry))) byCatalog.set(id(entry), entry);
  for (const entry of schemaRows) if (!byCatalog.has(id(entry))) report({ section: entry.section, key: entry.key, kind: "in schema, not in catalogue", detail: entry.type });
  let compared = 0;
  for (const entry of byCatalog.values()) {
    const row = bySchema.get(id(entry));
    if (!row) { report({ section: entry.section, key: entry.key, kind: "in catalogue, not in schema", detail: entry.type }); continue; }
    compared++;
    const type = catalogType(entry.type);
    if (!typesAgree(type, row) || type.nullable !== row.nullable) report({ section: entry.section, key: entry.key, kind: "type", detail: `catalogue ${entry.type}${type.nullable ? " (nullable)" : ""} ≠ schema ${row.type}${row.nullable ? " or null" : ""}` });
    const countable = type.type === "array" || (/characters/.test(entry.range) && (type.type === "string" || type.type.startsWith("Text(")));
    if (isNumericType(type.type) || countable) {
      const stated = { ...impliedRange(type.type), ...catalogRange(entry.range) };
      for (const bound of ["min", "max"] as const) {
        if (stated[bound] !== undefined && stated[bound] !== (row[bound] ?? (bound === "min" && countable ? 0 : undefined))) {
          report({ section: entry.section, key: entry.key, kind: "range", detail: `${bound}: catalogue ${stated[bound]} ≠ schema ${row[bound]}` });
        }
      }
    }
    const fallback = catalogDefault(entry.default);
    if (fallback.presence === "described") continue;
    if (fallback.presence === "conditional") {
      if (row.presence === "default") report({ section: entry.section, key: entry.key, kind: "default", detail: `catalogue "${entry.default}" ≠ schema default ${JSON.stringify(row.default)}` });
    } else if (fallback.presence !== row.presence || (fallback.presence === "default" && !defaultsAgree(fallback.value, row.default) && !defaultsAgree(fallback.value, row.resolvedDefault))) {
      report({ section: entry.section, key: entry.key, kind: "default", detail: `catalogue ${entry.default} ≠ schema ${row.presence}${row.presence === "default" ? ` ${JSON.stringify(row.default)}` : ""}` });
    }
  }
  return { compared, differences };
}
