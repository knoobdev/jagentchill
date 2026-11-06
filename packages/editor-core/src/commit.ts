import { computeMinReaderSchemaVersion, findUnknownFields, projectDocumentSchema, projectDuration, type ProjectDocument } from "@jagentchill/protocol";
import { canonicalize, MAX_DOCUMENT_BYTES, normalizeDocumentValues, withoutLocal } from "./canonical.ts";
import { documentError, DocumentRejected, type DocumentError } from "./errors.ts";
import { allElements, clone, isObject, type Json } from "./model.ts";
import { applyPatch, diffDocuments, type StatePatch } from "./patch.ts";
import type { Registries } from "./registries.ts";
import { utf8 } from "./sha256.ts";
import { validateProjectDocument, type ValidationResult } from "./validate.ts";

/** Who writes. Every writer passes the same validator; the only privilege is "Apply brand" on a locked template. */
export type Writer = { id: string; applyBrand?: boolean };
export type CommitContext = {
  now_ms: number;
  /** The id source: lowercase UUID v4 in the app, a seeded generator in tests. */
  newId: () => string;
  writer?: Writer;
  registries?: Registries;
};
export type CommitMeta = { commandType: string; label: string; /** `false`: a non-history update — it emits a patch and adds no undo step. */ history?: boolean };
/** The result of one committed change: the new document and the one state patch that describes it. */
export type Commit = {
  document: ProjectDocument;
  patch: StatePatch;
  commandType: string;
  label: string;
  history: boolean;
  /** The canonical form reached 80 % of the byte limit: "This project is close to its size limit". */
  nearSizeLimit: boolean;
};

const ELEMENT_FIELD = /^\/scenes\/@[^/]+\/tracks\/(?:main|overlay\/@[^/]+|audio\/@[^/]+)\/elements\/@([^/]+)(\/.*)?$/;
const OPEN_ROOTS = ["/media", "/cover", "/exportSettings", "/publish", "/filmLink", "/workflowLink"];
const SLOT_FIELDS = ["mediaId", "sourceDuration", "trimStart", "trimEnd", "volume", "muted", "name"];
// A slot that accepts any media holds a video or an image element: filling it with the other kind changes the element's
// type and the fields only a video carries, and nothing else of it.
const SLOT_KIND_FIELDS = ["type", "retime", "freeze", "stabilization", "deflicker", "pan", "fadeIn", "fadeOut", "isVoice", "isSourceAudioEnabled", "beats", "noiseReduction", "enhanceVoice", "vocalIsolation", "voiceEffect", "pitch", "normalize", "eq", "compressor"];
const within = (path: string, root: string) => path === root || path.startsWith(`${root}/`);

/**
 * Template lock: while `template.locked` is true only slot media, editable text, audio-slot levels, theme colours and
 * the project-level data named by the requirement may differ. Evaluated on the two documents, so it binds every writer.
 */
export function templateLockViolations(before: ProjectDocument, after: ProjectDocument, writer?: Writer): DocumentError[] {
  const template = before.template;
  if (!template?.locked) return [];
  const slots = new Set(template.slots.map((slot) => slot.elementId));
  const texts = new Set(template.editableTexts.map((entry) => entry.elementId));
  const audio = new Map(template.audioSlots.map((entry) => [entry.elementId, entry.replaceable]));
  const bound = new Set([...template.colorBindings, ...(after.template?.colorBindings ?? [])].map((binding) => `${binding.elementId}/${binding.field.split(".").join("/")}`));
  const variableBindings = new Set([...(template.variables ?? []), ...(after.template?.variables ?? [])].flatMap((variable) => variable.bindings.map((binding) => `${binding.elementId}/${binding.field.split(".").join("/")}`)));
  // "Edit in full editor" releases the lock and fills every unfilled slot with a slate in one change. A slate is a
  // still, so the element of an unfilled video slot becomes an image element in that same change.
  const slated = after.template?.locked === false ? new Set(template.slots.filter((slot) => !slot.filled).map((slot) => slot.elementId)) : new Set<string>();
  // The music of a starter arrives AFTER its draft is made (the track is fetched from the remote catalogue): a draft
  // without any audio slot may gain ONE audio element on an audio track that held nothing, together with its slot.
  const arriving = ((): string | undefined => {
    const added = template.audioSlots.length === 0 && after.template?.audioSlots.length === 1 ? after.template.audioSlots[0].elementId : undefined;
    if (!added) return undefined;
    for (const scene of after.scenes) for (const track of scene.tracks.audio) {
      const was = before.scenes.find((entry) => entry.id === scene.id)?.tracks.audio.find((entry) => entry.id === track.id);
      if (was && was.elements.length === 0 && track.elements.length === 1 && track.elements[0].id === added && (track.elements[0] as { type?: string }).type === "audio") return added;
    }
    return undefined;
  })();
  const errors: DocumentError[] = [];
  for (const entry of diffDocuments(before, after)) {
    const { path } = entry;
    let allowed = (arriving !== undefined && (within(path, "/template/audioSlots") || path.endsWith(`/elements/@${arriving}`) || path.includes(`/elements/@${arriving}/`))) || path === "/metadata/name" || path === "/metadata/updated_ms" || OPEN_ROOTS.some((root) => within(path, root))
      || within(path, "/template/themeColors") || /^\/template\/variables\/(?:@[^/]+|\d+)\/value$/.test(path) || (path === "/template/locked" && entry.op === "replace" && entry.value === false)
      || /^\/template\/slots\/@[^/]+\/(?:filled|sourceOffset|framing(?:\/.*)?)$/.test(path);
    const element = ELEMENT_FIELD.exec(path);
    if (!allowed && element && element[2]) {
      const id = element[1], field = element[2].slice(1);
      allowed = slated.has(id) || (slots.has(id) && (SLOT_FIELDS.includes(field) || (SLOT_KIND_FIELDS.includes(field.split("/")[0]) && template.slots.find((slot) => slot.elementId === id)?.accepts === "any")))
        || (texts.has(id) && (field === "content" || (field === "fontFamily" && writer?.applyBrand === true)))
        || (audio.has(id) && (["volume", "muted"].includes(field) || (audio.get(id) === true && ["mediaId", "sourceType", "sourceDuration", "trimStart", "trimEnd"].includes(field))))
        || bound.has(`${id}/${field}`) || variableBindings.has(`${id}/${field}`);
    }
    if (!allowed) errors.push(documentError("document/template-locked", path, "the project is a locked template draft; only slot media, editable text and theme colours change"));
  }
  return errors;
}

/**
 * The transition validator: the result must be a valid document (`strict`), and the difference from `before` must be
 * allowed while a template is locked. A failed validation changes nothing.
 */
export function validateDocumentChange(before: ProjectDocument, after: ProjectDocument, options: { writer?: Writer; registries?: Registries; scope?: { elementIds: string[] } } = {}): ValidationResult {
  const result = validateProjectDocument(after, { mode: "strict", registries: options.registries, scope: options.scope });
  const locked = templateLockViolations(before, after, options.writer);
  const errors = [...locked, ...result.errors].slice(0, 100);
  return { ...result, ok: errors.length === 0, errors };
}

/** Keeps the derived parts of a document in step with its content, in the same change that altered it. */
function settle(before: ProjectDocument, draft: ProjectDocument): void {
  const linked = (doc: ProjectDocument) => new Set([...allElements(doc)].map((ref) => (ref.element as { scriptLink?: { scriptId: string } }).scriptLink?.scriptId).filter((id): id is string => typeof id === "string"));
  const now = linked(draft), was = linked(before);
  // The project entry follows the element links: added with the first link of a script, removed with its last.
  draft.scriptLinks = [...draft.scriptLinks.filter((link) => now.has(link.scriptId) || !was.has(link.scriptId))];
  for (const scriptId of now) if (!draft.scriptLinks.some((link) => link.scriptId === scriptId)) draft.scriptLinks.push({ scriptId });
  for (const ref of allElements(draft)) {
    const element = ref.element as unknown as Json;
    // A channel with no key is not stored, and neither is an empty animation store.
    if (isObject(element.animations)) {
      for (const [path, channel] of Object.entries(element.animations)) {
        const keys = isObject(channel) ? ("r" in channel ? (channel.r as Json | undefined)?.keys : channel.keys) : undefined;
        if (Array.isArray(keys) && keys.length === 0) delete element.animations[path];
      }
      if (Object.keys(element.animations).length === 0) delete element.animations;
    }
  }
  // Resolve relative timing in the same command as the anchor edit. A removed anchor leaves the dependent at its
  // last resolved absolute time. Resolving the graph here covers every writer (UI, tools, sync and undo alike).
  const refs = [...allElements(draft)], byId = new Map(refs.map((ref) => [ref.element.id, ref]));
  for (const ref of refs) {
    const element = ref.element as unknown as Json;
    const anchor = element.timingAnchor as Json | undefined;
    const parent = anchor ? byId.get(String(anchor.elementId)) : undefined;
    if (anchor && (!parent || parent.scene.id !== ref.scene.id)) delete element.timingAnchor;
  }
  const state = new Map<string, "visiting" | "done">();
  const resolve = (id: string): number => {
    const ref = byId.get(id)!;
    const element = ref.element as unknown as Json;
    const status = state.get(id);
    if (status === "visiting") throw new DocumentRejected([documentError("document/compound-cycle", `/scenes/@${ref.scene.id}/tracks/elements/@${id}/timingAnchor`, "relative timing anchors cannot form a cycle")]);
    if (status === "done") return Number(element.startTime);
    state.set(id, "visiting");
    const anchor = element.timingAnchor as Json | undefined;
    if (anchor) {
      const baseRef = byId.get(String(anchor.elementId))!;
      const baseStart = resolve(String(anchor.elementId)), base = baseRef.element as unknown as Json;
      const edge = anchor.edge === "end" ? baseStart + Number(base.duration) : baseStart;
      const next = edge + Number(anchor.offsetTicks);
      if (!Number.isInteger(next) || next < 0) throw new DocumentRejected([documentError("document/out-of-range", `/scenes/@${ref.scene.id}/tracks/elements/@${id}/startTime`, "the resolved anchor time must be a non-negative tick")]);
      element.startTime = next;
    }
    state.set(id, "done");
    return Number(element.startTime);
  };
  for (const ref of refs) resolve(ref.element.id);
  draft.metadata.duration = projectDuration(draft);
}

/**
 * The single entry of every writer — UI command, gesture commit, shortcut, agent tool, host principal, sync
 * application, import, template application, snapshot restore. Applies `mutate` to a copy, settles derived fields,
 * rounds stored numbers, validates the result and the transition, and returns the new document with its state patch.
 * Throws `DocumentRejected` and leaves `before` untouched when the result is not valid.
 */
export function commitChange(before: ProjectDocument, context: CommitContext, meta: CommitMeta, mutate: (draft: ProjectDocument) => void): Commit {
  const { local, ...canonical } = before as ProjectDocument & { local?: unknown };
  let draft = clone(canonical) as ProjectDocument;
  mutate(draft);
  settle(before, draft);
  draft = normalizeDocumentValues(draft);
  const base = { commandType: meta.commandType, label: meta.label, history: meta.history !== false };
  if (canonicalize(draft) === canonicalize(canonical)) return { ...base, document: before, patch: [], nearSizeLimit: false };
  draft.metadata.updated_ms = context.now_ms;
  draft.minReaderSchemaVersion = computeMinReaderSchemaVersion(draft, findUnknownFields(withoutLocal(draft), projectDocumentSchema).length > 0);
  const result = validateDocumentChange(before, draft, { writer: context.writer, registries: context.registries });
  if (!result.ok) throw new DocumentRejected(result.errors);
  const bytes = utf8(canonicalize(draft)).length;
  const document = (local === undefined ? draft : { ...draft, local }) as ProjectDocument;
  return { ...base, document, patch: diffDocuments(before, draft), nearSizeLimit: bytes >= MAX_DOCUMENT_BYTES * 0.8 };
}

/** Changes device-local data only: no undo step, no revision, no patch, no `metadata.updated_ms` change. */
export function setLocal(document: ProjectDocument, mutate: (local: Json) => void): ProjectDocument {
  const local = clone(((document as { local?: unknown }).local ?? {}) as Json);
  mutate(local);
  return { ...document, local } as ProjectDocument;
}

/**
 * Accepts a state patch from outside (another device, a host writer): applies it with the generic applier and passes
 * the result through the same validators as a local command. Throws `DocumentRejected` and applies nothing when the
 * patch does not apply or its result is not a valid document.
 */
export function acceptPatch(before: ProjectDocument, patch: StatePatch, options: { writer?: Writer; registries?: Registries } = {}): ProjectDocument {
  const after = applyPatch(before, patch);
  const result = validateDocumentChange(before, after, options);
  if (!result.ok) throw new DocumentRejected(result.errors);
  return after;
}
