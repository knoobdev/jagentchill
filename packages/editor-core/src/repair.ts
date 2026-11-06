import { animatablePath, createTrack, gcd, localDefaults, localSchema, projectDocumentSchema, unwrap, type ProjectDocument, type Scene } from "@jagentchill/protocol";
import type { z } from "zod";
import type { DocumentError } from "./errors.ts";
import { allElements, allTracks, asArray, clone, isObject, tracksIn, type Json } from "./model.ts";
import { compareIds, entryId, parsePointer } from "./patch.ts";
import { roundHalfAway } from "./time.ts";

/** One thing load-time repair changed, in the order it was applied. */
export type Repair = {
  kind: "rounded-ticks" | "reduced-rational" | "kept-first-entries" | "sorted" | "cleared-reference" | "removed-transition" | "removed-animation-path"
    | "removed-element" | "recreated-main-scene" | "recreated-main-track" | "reset-local";
  path: string;
  message: string;
  /** The validation code that led to the repair, where one did. */
  code?: string;
};

const typeName = (schema: z.ZodTypeAny) => (schema._def as { typeName: string }).typeName;
/** Step (a): non-integer ticks are rounded half away from zero; a rational that is not reduced is reduced. Unknown keys are not touched. */
function roundTicks(value: unknown, schema: z.ZodTypeAny | undefined, path: string, repairs: Repair[]): unknown {
  if (!schema || value === null || value === undefined) return value;
  const { inner, tags } = unwrap(schema);
  if (tags.kind === "Ticks") {
    if (typeof value === "number" && Number.isFinite(value) && !Number.isInteger(value)) {
      repairs.push({ kind: "rounded-ticks", path, message: `${value} rounded to ${roundHalfAway(value)}`, code: "document/not-integer-ticks" });
      return roundHalfAway(value);
    }
    return value;
  }
  if (tags.kind === "Rational" && isObject(value)) {
    const { numerator, denominator } = value as { numerator: number; denominator: number };
    const divisor = Number.isInteger(numerator) && Number.isInteger(denominator) && numerator > 0 && denominator > 0 ? gcd(numerator, denominator) : 1;
    if (divisor > 1) {
      repairs.push({ kind: "reduced-rational", path, message: `${numerator}/${denominator} reduced`, code: "document/invalid-rational" });
      return { ...value, numerator: numerator / divisor, denominator: denominator / divisor };
    }
    return value;
  }
  if (typeof value !== "object") return value;
  if (tags.variants) {
    const name = (value as Json)[tags.variantKey!] ?? tags.defaultVariant;
    return typeof name === "string" && tags.variants[name] ? roundTicks(value, tags.variants[name], path, repairs) : value;
  }
  if (Array.isArray(value)) {
    if (typeName(inner) !== "ZodArray") return value;
    const item = (inner._def as { type: z.ZodTypeAny }).type;
    return value.map((entry, index) => roundTicks(entry, item, `${path}/${entryId(entry) !== undefined ? `@${entryId(entry)}` : index}`, repairs));
  }
  const members = typeName(inner) === "ZodObject" ? (inner as z.ZodObject<z.ZodRawShape>).shape : undefined;
  const valueType = typeName(inner) === "ZodRecord" ? (inner._def as { valueType: z.ZodTypeAny }).valueType : undefined;
  if (!members && !valueType) return value;
  const out: Json = {};
  for (const [key, entry] of Object.entries(value)) out[key] = roundTicks(entry, members ? members[key] : valueType, `${path}/${key}`, repairs);
  return out;
}

/** The value an id path names, or `undefined`. */
export function valueAt(root: unknown, path: string): unknown {
  let current = root;
  for (const segment of parsePointer(path)) {
    if (Array.isArray(current)) current = segment.startsWith("@") ? current.find((entry) => entryId(entry) === segment.slice(1)) : current[Number(segment)];
    else if (isObject(current)) current = current[segment];
    else return undefined;
  }
  return current;
}

const byTime = (a: Json, b: Json) => (a.time as number) - (b.time as number);
/** Sorts in place when needed and drops entries that share a sort key with an earlier one; reports whether anything changed. */
function sortUnique(list: Json[], compare: (a: Json, b: Json) => number, unique: boolean): boolean {
  const sorted = [...list].sort(compare);
  const kept = unique ? sorted.filter((entry, index) => index === 0 || compare(sorted[index - 1], entry) !== 0) : sorted;
  const changed = kept.length !== list.length || kept.some((entry, index) => entry !== list[index]);
  if (changed) list.splice(0, list.length, ...kept);
  return changed;
}

/** Step (c): arrays out of canonical order are sorted. */
function sortArrays(doc: ProjectDocument, repairs: Repair[]): void {
  const sorted = (path: string, what: string) => repairs.push({ kind: "sorted", path, message: `${what} sorted into canonical order`, code: "document/elements-unsorted" });
  const assets = doc.media?.assets as unknown as Json[] | undefined;
  if (Array.isArray(assets) && sortUnique(assets, (a, b) => compareIds(String(a.id), String(b.id)), false)) sorted("/media/assets", "assets");
  for (const scene of doc.scenes) {
    const markers = (scene as { markers?: Json[] }).markers;
    if (Array.isArray(markers) && sortUnique(markers, byTime, true)) sorted(`/scenes/@${scene.id}/markers`, "markers");
  }
  for (const ref of allTracks(doc)) {
    const elements = (ref.track as unknown as { elements?: Json[] }).elements;
    if (!Array.isArray(elements)) continue;
    if (sortUnique(elements, (a, b) => (a.startTime as number) - (b.startTime as number) || compareIds(String(a.id), String(b.id)), false)) sorted(`${ref.path}/elements`, "elements");
    for (const element of elements) {
      if (!isObject(element)) continue;
      const at = `${ref.path}/elements/@${String(element.id)}`;
      if (Array.isArray(element.beats) && [...element.beats].some((beat, index, beats) => index > 0 && !(beat > beats[index - 1]))) {
        element.beats = [...new Set(element.beats as number[])].sort((a, b) => a - b);
        sorted(`${at}/beats`, "beats");
      }
      if (Array.isArray(element.words) && sortUnique(element.words as Json[], (a, b) => (a.start as number) - (b.start as number), false)) sorted(`${at}/words`, "words");
      for (const [name, channel] of Object.entries(isObject(element.animations) ? element.animations : {})) {
        const channels = isObject(channel) && "r" in channel ? ["r", "g", "b", "a"].map((part) => channel[part]) : [channel];
        for (const part of channels) if (isObject(part) && Array.isArray(part.keys) && sortUnique(part.keys as Json[], byTime, true)) sorted(`${at}/animations/${name}`, "keys");
      }
    }
  }
}

/** Steps (d) and (e): dangling references are cleared, orphan transition records and unresolved animation paths removed. */
function clearDangling(doc: ProjectDocument, repairs: Repair[]): void {
  const cleared = (path: string, message: string, code: string) => repairs.push({ kind: "cleared-reference", path, message, code });
  const assets = new Map(asArray(doc.media?.assets).map((asset) => [(asset as Json).id, asset as Json]));
  const folders = new Set(asArray(doc.media?.folders).map((folder) => (folder as Json).id));
  for (const asset of assets.values()) if (typeof asset.folderId === "string" && !folders.has(asset.folderId)) { asset.folderId = null; cleared(`/media/assets/@${String(asset.id)}/folderId`, "the folder does not exist", "document/unknown-reference"); }
  for (const folder of asArray(doc.media?.folders) as Json[]) if (typeof folder.parentId === "string" && !folders.has(folder.parentId)) { folder.parentId = null; cleared(`/media/folders/@${String(folder.id)}/parentId`, "the parent folder does not exist", "document/unknown-reference"); }
  for (const scene of doc.scenes) {
    const refs = [...tracksIn(scene, `/scenes/@${scene.id}`)];
    const elements = new Map<string, { element: Json; path: string }>();
    for (const ref of refs) for (const element of asArray((ref.track as { elements?: unknown }).elements).filter(isObject)) elements.set(String(element.id), { element, path: `${ref.path}/elements/@${String(element.id)}` });
    const count = (key: "groupId" | "linkId") => {
      const members = new Map<unknown, { element: Json; path: string }[]>();
      for (const entry of elements.values()) if (typeof entry.element[key] === "string") members.set(entry.element[key], [...(members.get(entry.element[key]) ?? []), entry]);
      return members;
    };
    for (const members of count("groupId").values()) {
      if (members.length < 2) for (const { element, path } of members) { element.groupId = null; cleared(`${path}/groupId`, "the group has a single member", "document/group-invalid"); }
    }
    for (const members of count("linkId").values()) {
      const audio = members.filter(({ element }) => element.type === "audio").length;
      const partners = members.filter(({ element }) => ["video", "compound", "text"].includes(String(element.type))).length;
      if (members.length !== 2 || audio !== 1 || partners !== 1) for (const { element, path } of members) { element.linkId = null; cleared(`${path}/linkId`, "the link does not join exactly one sound and one picture", "document/link-invalid"); }
    }
    for (const ref of refs) {
      const track = ref.track as unknown as Json;
      const own = new Map(asArray(track.elements).filter(isObject).map((element) => [element.id, element]));
      if (Array.isArray(track.transitions)) {
        track.transitions = track.transitions.filter((record: Json) => {
          const from = own.get(record.fromElementId), to = own.get(record.toElementId);
          const sound = isObject(record) && from && to && from.transitionOut === record.id && to.transitionIn === record.id
            && (from.startTime as number) + (from.duration as number) === to.startTime;
          if (!sound) repairs.push({ kind: "removed-transition", path: `${ref.path}/transitions/@${String(record?.id)}`, message: "the record joins no adjacent pair that names it", code: "document/transition-ref-mismatch" });
          return sound;
        });
      }
      const records = new Map(asArray(track.transitions).map((record) => [(record as Json).id, record as Json]));
      for (const element of own.values()) {
        const at = `${ref.path}/elements/@${String(element.id)}`;
        for (const [key, side] of [["transitionIn", "toElementId"], ["transitionOut", "fromElementId"]] as const) {
          if (typeof element[key] === "string" && records.get(element[key])?.[side] !== element.id) { element[key] = null; cleared(`${at}/${key}`, "no transition record names this element", "document/transition-ref-mismatch"); }
        }
        const asset = assets.get(element.mediaId);
        const tracking = element.tracking as Json | undefined;
        if (isObject(tracking)) {
          const target = elements.get(String(tracking.targetElementId))?.element;
          const tracks = asArray(assets.get(target?.mediaId)?.motionTracks) as Json[];
          if (target?.type !== "video" || !tracks.some((entry) => entry.id === tracking.trackId)) { delete element.tracking; cleared(`${at}/tracking`, "the tracking target or motion track does not exist", "document/unknown-reference"); }
        }
        for (const mask of asArray(element.masks).filter(isObject)) {
          const binding = mask.tracking as Json | undefined;
          if (isObject(binding) && !(asArray(asset?.motionTracks) as Json[]).some((entry) => entry.id === binding.trackId)) { delete mask.tracking; cleared(`${at}/masks/@${String(mask.id)}/tracking`, "the motion track does not exist", "document/unknown-reference"); }
        }
        if (isObject(element.animations)) {
          for (const path of Object.keys(element.animations)) {
            if (animatablePath(element as never, path)) continue;
            delete element.animations[path];
            repairs.push({ kind: "removed-animation-path", path: `${at}/animations/${path}`, message: "the path is not animatable on this element", code: "document/animation-path-invalid" });
          }
          if (Object.keys(element.animations).length === 0) delete element.animations;
        }
      }
    }
  }
  const template = (doc as unknown as Json).template as Json | undefined;
  if (isObject(template)) {
    const scene = doc.scenes.find((candidate) => candidate.id === template.sceneId);
    const ids = new Set<unknown>();
    if (scene) for (const ref of tracksIn(scene, "")) for (const element of asArray((ref.track as { elements?: unknown }).elements)) ids.add((element as Json)?.id);
    for (const key of ["slots", "editableTexts", "audioSlots", "colorBindings"]) {
      if (!Array.isArray(template[key])) continue;
      const kept = (template[key] as Json[]).filter((entry) => ids.has(entry?.elementId) || (key === "colorBindings" && [...allElements(doc)].some((ref) => ref.element.id === entry?.elementId)));
      if (kept.length !== (template[key] as Json[]).length) { template[key] = kept; cleared(`/template/${key}`, "an entry names an element that does not exist", "document/template-invalid"); }
    }
    asArray(template.slots).forEach((slot, index) => { (slot as Json).index = index + 1; });
  }
}

const ELEMENT_PATH = /^(\/scenes\/@[^/]+\/tracks\/(?:main|overlay\/@[^/]+|audio\/@[^/]+))\/elements\/@([^/]+)/;
/** Codes that never remove an element: a stored number outside its range is kept, and a warning is not a failure. */
const KEPT = new Set(["document/out-of-range", "document/not-frame-aligned"]);

/** Step (g): a document always has one main scene with a main track. */
function ensureMain(doc: ProjectDocument, repairs: Repair[]): void {
  const taken = new Set<string>();
  for (const scene of doc.scenes) taken.add(scene.id);
  for (const ref of allTracks(doc)) taken.add(ref.track.id);
  const fresh = (base: string) => { let id = base, n = 1; while (taken.has(id)) id = `${base}-${++n}`; taken.add(id); return id; };
  const now = doc.metadata?.updated_ms ?? 0;
  for (const scene of doc.scenes) {
    const tracks = isObject((scene as { tracks?: unknown }).tracks) ? scene.tracks : ((scene as { tracks: unknown }).tracks = { overlay: [], audio: [] } as never);
    if (!isObject(tracks.main)) {
      (tracks as Json).main = createTrack("video", { id: fresh("main-track"), name: "Main Track" });
      repairs.push({ kind: "recreated-main-track", path: `/scenes/@${scene.id}/tracks/main`, message: "the missing main track was recreated empty", code: "document/main-track-invalid" });
    }
  }
  const mains = doc.scenes.filter((scene) => scene.isMain === true);
  mains.slice(1).forEach((scene) => { scene.isMain = false; if (scene.kind === "timeline" || scene.kind === undefined) scene.kind = "compound"; });
  if (mains.length === 0) {
    const scene = { id: fresh("main-scene"), name: "Main scene", isMain: true, kind: "timeline", compoundBackground: "none", tracks: { overlay: [], main: createTrack("video", { id: fresh("main-track"), name: "Main Track" }), audio: [] }, markers: [], created_ms: now, updated_ms: now };
    doc.scenes.unshift(scene as unknown as Scene);
  }
  if (mains.length !== 1) repairs.push({ kind: "recreated-main-scene", path: "/scenes", message: mains.length === 0 ? "the missing main scene was recreated empty" : "one scene was kept as the main scene", code: "document/no-main-scene" });
}

/** A malformed `local` is reset to defaults with a diagnostic; it never fails a load. */
export function repairLocal(doc: ProjectDocument, repairs: Repair[]): void {
  const local = (doc as { local?: unknown }).local;
  if (local === undefined) return;
  const result = localSchema.safeParse(local);
  if (!result.success) {
    const where = result.error.issues[0]?.path.join("/") ?? "";
    (doc as { local?: unknown }).local = localDefaults(doc);
    repairs.push({ kind: "reset-local", path: `/local${where ? `/${where}` : ""}`, message: "the device-local section was malformed and was reset to defaults" });
    return;
  }
  // A reader treats an absent member as its default; the current scene defaults to the main scene.
  const filled = { ...localDefaults(doc), ...result.data } as Json;
  (doc as { local?: unknown }).local = filled;
  const ids = new Set([...allElements(doc)].map((ref) => ref.element.id));
  const view = filled.timelineViewState as Json | undefined;
  if (isObject(view) && Array.isArray(view.expandedKeyframeElementIds)) view.expandedKeyframeElementIds = view.expandedKeyframeElementIds.filter((id) => ids.has(id as string));
}

/**
 * Load-time repair in its fixed order: (a) ticks rounded, (b) counts over a limit keep the first entries, (c) arrays
 * sorted, (d) dangling references cleared, (e) unresolved animation paths removed, (f) elements that still fail
 * removed, (g) main scene and main track recreated. Works on a copy; unknown fields are never touched.
 */
export function repairDocument(input: ProjectDocument, validate: (candidate: ProjectDocument) => { errors: DocumentError[] }): { document: ProjectDocument; repairs: Repair[] } {
  const repairs: Repair[] = [];
  const { local, ...canonical } = input as ProjectDocument & { local?: unknown };
  const doc = roundTicks(clone(canonical), projectDocumentSchema, "", repairs) as ProjectDocument;
  if (local !== undefined) (doc as { local?: unknown }).local = clone(local);
  repairLocal(doc, repairs);
  doc.scenes = doc.scenes.filter(isObject) as never;
  ensureMain(doc, repairs);
  for (const error of validate(doc).errors) {
    if (error.code !== "document/limit-exceeded" || typeof error.details?.value !== "number") continue;
    const list = valueAt(doc, error.path);
    if (Array.isArray(list) && list.length > error.details.value) {
      list.length = error.details.value;
      repairs.push({ kind: "kept-first-entries", path: error.path, message: `kept the first ${error.details.value} entries`, code: error.code });
    }
  }
  sortArrays(doc, repairs);
  clearDangling(doc, repairs);
  // (f) An element that still fails is removed; of two overlapping elements the validator names the later one.
  for (let pass = 0; pass < 8; pass++) {
    const failing = new Map<string, { track: string; id: string; code: string }>();
    for (const error of validate(doc).errors) {
      const match = ELEMENT_PATH.exec(error.path);
      if (match && !KEPT.has(error.code) && !failing.has(match[0])) failing.set(match[0], { track: match[1], id: match[2], code: error.code });
    }
    if (failing.size === 0) break;
    for (const [path, { track, id, code }] of failing) {
      const owner = valueAt(doc, track) as Json | undefined;
      if (!owner || !Array.isArray(owner.elements)) continue;
      const index = owner.elements.findIndex((element) => entryId(element) === id);
      // Of two entities that share an id the later one is the failing one.
      const last = owner.elements.map((element) => entryId(element)).lastIndexOf(id);
      if (index < 0) continue;
      owner.elements.splice(code === "document/duplicate-id" ? last : index, 1);
      repairs.push({ kind: "removed-element", path, message: "the element could not be repaired and was skipped", code });
    }
    clearDangling(doc, repairs);
  }
  return { document: doc, repairs };
}

/** The notice of a repaired load: "{n} items were repaired or skipped while loading". */
export const repairCount = (repairs: Repair[]): number => repairs.length;
