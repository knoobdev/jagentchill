import { canonicalJson, withoutLocal } from "./canonical.ts";
import { documentError, DocumentRejected } from "./errors.ts";

/** One entry of a state patch over the canonical project document. */
export type PatchEntry = { op: "add" | "remove" | "replace"; path: string; value?: unknown; before?: string };
export type StatePatch = PatchEntry[];

/** Arrays whose members are addressed by `@<id>`, by the key that holds them. */
export const ID_KEYED_ARRAYS = new Set(["scenes", "overlay", "audio", "elements", "markers", "transitions", "effects", "masks", "path", "strokes", "angles", "slots", "texts", "assets", "folders", "luts", "keys"]);
/** Id-keyed arrays with a canonical order: an `add` is placed by that order, never by `before`. */
const SORTED: Record<string, (a: Entry, b: Entry) => number> = {
  elements: (a, b) => (a.startTime as number) - (b.startTime as number) || compareIds(a.id as string, b.id as string),
  markers: (a, b) => (a.time as number) - (b.time as number),
  keys: (a, b) => (a.time as number) - (b.time as number),
  assets: (a, b) => compareIds(a.id as string, b.id as string),
};
type Entry = Record<string, unknown>;
export const compareIds = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
/** The id a member of an id-keyed array is addressed by (template slots are keyed by `slotId`). */
export const entryId = (entry: unknown): string | undefined => {
  const value = entry as Entry | null;
  const id = value && typeof value === "object" ? value.id ?? value.slotId : undefined;
  return typeof id === "string" ? id : undefined;
};
const isObject = (value: unknown): value is Entry => value !== null && typeof value === "object" && !Array.isArray(value);
const isIdKeyed = (key: string, array: unknown[]) => ID_KEYED_ARRAYS.has(key) && array.every((entry) => entryId(entry) !== undefined);

export const escapeSegment = (segment: string): string => segment.replaceAll("~", "~0").replaceAll("/", "~1");
export const unescapeSegment = (segment: string): string => segment.replaceAll("~1", "/").replaceAll("~0", "~");
const NEEDS_ESCAPE = /[~/]/;
export function pointer(...segments: (string | number)[]): string {
  let out = "";
  for (const segment of segments) { const text = String(segment); out += `/${NEEDS_ESCAPE.test(text) ? escapeSegment(text) : text}`; }
  return out;
}
export function parsePointer(path: string): string[] {
  if (path === "") return [];
  if (!path.startsWith("/")) throw invalid(path, "a path is a JSON Pointer");
  return path.slice(1).split("/").map(unescapeSegment);
}

const invalid = (path: string, message: string) => new DocumentRejected([documentError("document/patch-invalid", path, message)]);
function indexOfId(array: unknown[], id: string, path: string): number {
  const found = array.reduce<number[]>((hits, entry, index) => (entryId(entry) === id ? [...hits, index] : hits), []);
  if (found.length > 1) throw invalid(path, `@${id} matches ${found.length} entries`);
  return found.length ? found[0] : -1;
}
/** Resolves one segment against a container: an object key, an `@<id>` member or a zero-based index. */
function childIndex(container: unknown, segment: string, path: string): string | number {
  if (Array.isArray(container)) {
    if (segment.startsWith("@")) {
      const index = indexOfId(container, segment.slice(1), path);
      if (index < 0) throw invalid(path, `${segment} does not resolve`);
      return index;
    }
    if (!/^(?:0|[1-9]\d*)$/.test(segment) || Number(segment) >= container.length) throw invalid(path, `index ${segment} does not resolve`);
    return Number(segment);
  }
  if (!isObject(container) || !Object.hasOwn(container, segment)) throw invalid(path, `"${segment}" does not resolve`);
  return segment;
}

/** Copies the containers along `segments` and returns the copy of the last one, so that the input stays untouched. */
function descend(root: Entry, segments: string[], path: string): Entry | unknown[] {
  let current: Entry | unknown[] = root;
  for (const segment of segments) {
    const key = childIndex(current, segment, path);
    const child: unknown = (current as Entry)[key as string];
    if (!isObject(child) && !Array.isArray(child)) throw invalid(path, `"${segment}" is not a container`);
    const copy: Entry | unknown[] = Array.isArray(child) ? [...child] : { ...child };
    (current as Entry)[key as string] = copy;
    current = copy;
  }
  return current;
}

function applyEntry(root: Entry, entry: PatchEntry): void {
  const segments = parsePointer(entry.path);
  if (segments[0] === "local") throw new DocumentRejected([documentError("document/device-local-in-patch", entry.path, "a state patch never addresses device-local data")]);
  if (segments.length === 0) throw invalid(entry.path, "a patch never replaces the whole document");
  if (!["add", "remove", "replace"].includes(entry.op)) throw invalid(entry.path, `unknown op "${String(entry.op)}"`);
  const last = segments[segments.length - 1], parentKey = segments[segments.length - 2] ?? "";
  const parent = descend(root, segments.slice(0, -1), entry.path);
  if (Array.isArray(parent)) {
    if (entry.op === "add") {
      if (last.startsWith("@")) {
        const id = last.slice(1);
        if (entryId(entry.value) !== id) throw invalid(entry.path, "the value's id differs from the path's");
        if (indexOfId(parent, id, entry.path) >= 0) throw invalid(entry.path, `@${id} already exists`);
        const order = SORTED[parentKey];
        if (order) {
          let at = parent.length;
          while (at > 0 && order(parent[at - 1] as Entry, entry.value as Entry) > 0) at--;
          parent.splice(at, 0, entry.value);
        } else if (entry.before !== undefined) {
          if (!entry.before.startsWith("@")) throw invalid(entry.path, "\"before\" names an entry as @<id>");
          const at = indexOfId(parent, entry.before.slice(1), entry.path);
          if (at < 0) throw invalid(entry.path, `before ${entry.before} does not resolve`);
          parent.splice(at, 0, entry.value);
        } else parent.push(entry.value);
      } else if (last === "-") parent.push(entry.value);
      else {
        if (!/^(?:0|[1-9]\d*)$/.test(last) || Number(last) > parent.length) throw invalid(entry.path, `index ${last} does not resolve`);
        parent.splice(Number(last), 0, entry.value);
      }
      return;
    }
    const index = childIndex(parent, last, entry.path) as number;
    if (entry.op === "remove") parent.splice(index, 1);
    else {
      if (last.startsWith("@") && entryId(entry.value) !== last.slice(1)) throw invalid(entry.path, "the value's id differs from the path's");
      parent[index] = entry.value;
    }
    return;
  }
  if (last.startsWith("@")) throw invalid(entry.path, `${last} does not address an array`);
  if (entry.op === "add") { parent[last] = entry.value; return; }
  if (!Object.hasOwn(parent, last)) throw invalid(entry.path, `"${last}" does not resolve`);
  if (entry.op === "remove") delete parent[last];
  else parent[last] = entry.value;
}

/**
 * Applies a state patch to a document and returns the result; the input is not modified and `local` is carried over
 * untouched. Needs no editor logic: `@<id>` is a linear lookup of `id`. Throws `DocumentRejected` with
 * `document/patch-invalid` or `document/device-local-in-patch`, leaving nothing half applied.
 */
export function applyPatch<T extends object>(document: T, patch: StatePatch): T {
  if (!Array.isArray(patch)) throw invalid("", "a state patch is a list of entries");
  const root = { ...(document as Entry) };
  for (const entry of patch) {
    if (!isObject(entry) || typeof entry.path !== "string") throw invalid("", "a patch entry is {op, path, value?, before?}");
    applyEntry(root, entry as PatchEntry);
  }
  return root as T;
}

const same = (a: unknown, b: unknown) => a === b || canonicalJson(a) === canonicalJson(b);

/** Indices of a longest subsequence of `order` that is strictly increasing: the entries that keep their place in a reorder. */
function longestIncreasing(order: number[]): Set<number> {
  const tails: number[] = [], previous = new Array<number>(order.length).fill(-1);
  order.forEach((value, index) => {
    let low = 0, high = tails.length;
    while (low < high) { const mid = (low + high) >> 1; if (order[tails[mid]] < value) low = mid + 1; else high = mid; }
    if (low > 0) previous[index] = tails[low - 1];
    tails[low] = index;
  });
  const kept = new Set<number>();
  for (let index = tails.length ? tails[tails.length - 1] : -1; index >= 0; index = previous[index]) kept.add(index);
  return kept;
}

function diffValue(before: unknown, after: unknown, path: string, key: string, out: StatePatch): void {
  if (before === after) return;
  if (isObject(before) && isObject(after)) {
    for (const name of Object.keys(before)) if (after[name] === undefined && before[name] !== undefined) out.push({ op: "remove", path: path + pointer(name) });
    for (const name of Object.keys(after)) {
      if (after[name] === undefined) continue;
      if (before[name] === undefined) out.push({ op: "add", path: path + pointer(name), value: after[name] });
      else diffValue(before[name], after[name], path + pointer(name), name, out);
    }
    return;
  }
  if (Array.isArray(before) && Array.isArray(after) && isIdKeyed(key, before) && isIdKeyed(key, after)) { diffIdKeyed(before, after, path, key, out); return; }
  if (Array.isArray(before) && Array.isArray(after)) {
    // An index-addressed array: members are replaced in place, new ones appended with `-`; any other change of
    // length replaces the array.
    if (before.length <= after.length && before.every((entry, index) => index >= before.length || same(entry, after[index]) || before.length === after.length)) {
      before.forEach((entry, index) => diffValue(entry, after[index], path + pointer(index), "", out));
      for (let index = before.length; index < after.length; index++) out.push({ op: "add", path: `${path}/-`, value: after[index] });
      return;
    }
  }
  if (!same(before, after)) out.push({ op: "replace", path, value: after });
}

function diffIdKeyed(before: unknown[], after: unknown[], path: string, key: string, out: StatePatch): void {
  const at = (id: string) => path + pointer(`@${id}`);
  const beforeIds = before.map((entry) => entryId(entry)!), afterIds = after.map((entry) => entryId(entry)!);
  const afterIndex = new Map(afterIds.map((id, index) => [id, index]));
  const beforeById = new Map(before.map((entry) => [entryId(entry)!, entry]));
  for (const id of beforeIds) if (!afterIndex.has(id)) out.push({ op: "remove", path: at(id) });
  const common = beforeIds.filter((id) => afterIndex.has(id));
  // Entries outside the longest run that keeps its order are the ones that moved: a reorder is a remove and an add.
  const stays = longestIncreasing(common.map((id) => afterIndex.get(id)!));
  const moved = new Set(common.filter((_, index) => !stays.has(index)));
  for (const id of moved) out.push({ op: "remove", path: at(id) });
  const sorted = key in SORTED;
  // Kept entries reach their final values first, so that an add into a sorted array is placed among final sort keys.
  for (const id of common) if (!moved.has(id)) diffValue(beforeById.get(id), after[afterIndex.get(id)!], at(id), "", out);
  for (let index = afterIds.length - 1; index >= 0; index--) {
    const id = afterIds[index];
    if (beforeById.has(id) && !moved.has(id)) continue;
    const next = afterIds[index + 1];
    out.push({ op: "add", path: at(id), value: after[index], ...(!sorted && next !== undefined ? { before: `@${next}` } : {}) });
  }
}

/**
 * The state patch that turns `before` into `after`, computed from the two canonical documents (never from a command).
 * `local` is not part of either side.
 */
export function diffDocuments(before: object, after: object): StatePatch {
  const out: StatePatch = [];
  diffValue(withoutLocal(before), withoutLocal(after), "", "", out);
  // Content first, then the derived metadata (`duration`, `updated_ms`) that the same change rewrote.
  return [...out.filter((entry) => !entry.path.startsWith("/metadata/")), ...out.filter((entry) => entry.path.startsWith("/metadata/"))];
}
