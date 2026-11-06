import type { ElementParamDefinition } from "../timeline/params.ts";

/**
 * Reads the "Params (range, default)" cell of a catalogue table into parameter definitions. The cell is the
 * normative text of the spec; this is the one place its notation is interpreted.
 *
 *   none | seed | cx/cy | direction4 (left) | key select a/b/c (a) | key boolean (false) | key (#rrggbb)
 *   key 0–100 (10) | key −100…100 (0) | key 0.25–4 step 0.25 (1) | key 0–50% of duration (0) | key 4–256 px (64)
 */
const NUMBER = "[−-]?\\d+(?:\\.\\d+)?";
const RANGE = new RegExp(`^(\\w+) (${NUMBER})[–…](${NUMBER})\\s*(°|%|px|Hz)?(?: of duration)?(?: step (${NUMBER}))? \\((${NUMBER})\\)$`);
const number = (text: string): number => Number(text.replace("−", "-"));
export const DIRECTION4 = ["left", "right", "up", "down"] as const;

export function parseParamCell(cell: string, options: { keyframable: boolean }): ElementParamDefinition[] {
  const out: ElementParamDefinition[] = [];
  for (const raw of cell.split(";")) {
    const entry = raw.trim();
    if (entry === "" || entry === "none") continue;
    if (entry === "seed") { out.push({ key: "seed", type: "number", min: 0, max: 9999, step: 1, default: 0, keyframable: false }); continue; }
    if (entry === "cx/cy") {
      for (const key of ["centerX", "centerY"]) out.push({ key, type: "number", min: -100, max: 100, step: 1, default: 0, keyframable: options.keyframable });
      continue;
    }
    let match = /^direction4 \((\w+)\)$/.exec(entry);
    if (match) { out.push({ key: "direction", type: "select", options: DIRECTION4, default: match[1], keyframable: false }); continue; }
    match = /^(\w+) select (.+) \(([^()]+)\)$/.exec(entry);
    if (match) { out.push({ key: match[1], type: "select", options: match[2].split("/").map((option) => option.trim()), default: match[3], keyframable: false }); continue; }
    match = /^(\w+) boolean \((true|false)\)$/.exec(entry);
    if (match) { out.push({ key: match[1], type: "boolean", default: match[2] === "true", keyframable: false }); continue; }
    match = /^(\w+) \((#[0-9a-f]{6})\)$/.exec(entry);
    if (match) { out.push({ key: match[1], type: "color", default: match[2], keyframable: options.keyframable }); continue; }
    match = RANGE.exec(entry);
    if (match) {
      out.push({ key: match[1], type: "number", min: number(match[2]), max: number(match[3]), step: match[5] ? number(match[5]) : 1, default: number(match[6]), ...(match[4] ? { unit: match[4] } : {}), keyframable: options.keyframable });
      continue;
    }
    throw new Error(`catalogue parameter "${entry}" is not in a known notation`);
  }
  for (const definition of out) if (definition.type === "select" && !(definition.options ?? []).includes(String(definition.default))) throw new Error(`default of "${definition.key}" is not one of its options`);
  return out;
}

/** The default value of every parameter of a definition. */
export const paramDefaults = (params: readonly ElementParamDefinition[]): Record<string, number | boolean | string> => Object.fromEntries(params.map((param) => [param.key, param.default]));

/** Case-insensitive, diacritic-insensitive form of a search string. */
export const searchKey = (text: string): string => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
/** Substring match of a query on a localised name, the English name and the keywords. */
export function matchesSearch(query: string, entry: { name: string; keywords: readonly string[] }, localisedName?: string): boolean {
  const needle = searchKey(query);
  if (needle === "") return true;
  return [entry.name, localisedName ?? "", ...entry.keywords].some((text) => searchKey(text).includes(needle));
}

/** Catalogue rows that failed to parse at load, by id; the catalogue test asserts it is empty. */
export const CATALOGUE_LOAD_ERRORS: { id: string; message: string }[] = [];
/**
 * `parseParamCell` for module-level use: the app imports this package at start, so a malformed row is recorded and
 * yields a definition without parameters instead of throwing.
 */
export function safeParams(id: string, cell: string | undefined, keyframable: boolean): ElementParamDefinition[] {
  try {
    return parseParamCell(cell ?? "", { keyframable });
  } catch (error) {
    CATALOGUE_LOAD_ERRORS.push({ id, message: (error as Error).message });
    return [];
  }
}
