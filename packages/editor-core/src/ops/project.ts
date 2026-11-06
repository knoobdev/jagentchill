import { assetRecordSchema, type Background, type CanvasSize, type Cover, type ProjectDocument, type Rational } from "@jagentchill/protocol";
import { allElements, findElement, isObject, type Json } from "../model.ts";
import { edit, elementIn, reject, type Commit, type CommitContext } from "./shared.ts";

/** An explicit canvas choice: adoption from the first media is disarmed for the canvas in the same undo step. */
export function setCanvasSize(doc: ProjectDocument, ctx: CommitContext, canvasSize: CanvasSize, mode: "preset" | "custom" = "preset"): Commit {
  return edit(doc, ctx, { commandType: "project.canvas", label: "Canvas size" }, (draft) => {
    draft.settings.canvasSize = canvasSize;
    draft.settings.canvasSizeMode = mode;
    if (mode === "custom") draft.settings.lastCustomCanvasSize = canvasSize;
    draft.settings.adoptCanvasFromFirstMedia = false;
  });
}
export const setFrameRate = (doc: ProjectDocument, ctx: CommitContext, fps: Rational): Commit =>
  edit(doc, ctx, { commandType: "project.fps", label: "Frame rate" }, (draft) => {
    draft.settings.fps = fps;
    draft.settings.adoptFrameRateFromFirstMedia = false;
  });
/** The project default background. The value carries only the keys of its kind: switching kind discards the previous kind's keys. */
export const setProjectBackground = (doc: ProjectDocument, ctx: CommitContext, background: Background): Commit =>
  edit(doc, ctx, { commandType: "project.background", label: "Background" }, (draft) => { draft.settings.background = background as never; });
/** Saves the cover; `null` is "Reset". */
export const setCover = (doc: ProjectDocument, ctx: CommitContext, cover: Cover | null | Record<string, unknown>): Commit =>
  edit(doc, ctx, { commandType: "project.cover", label: "Cover" }, (draft) => { draft.cover = cover as never; });
/** Pins or unpins the project. The pin is part of the document (it syncs); it is not an undo step. */
export const setProjectPinned = (doc: ProjectDocument, ctx: CommitContext, pinned: boolean): Commit =>
  edit(doc, ctx, { commandType: "project.pin", label: pinned ? "Pin" : "Unpin", history: false }, (draft) => {
    const metadata = draft.metadata as unknown as Record<string, unknown>;
    if (pinned) metadata.pinned_ms = ctx.now_ms; else delete metadata.pinned_ms;
  });
export const renameProject = (doc: ProjectDocument, ctx: CommitContext, name: string): Commit =>
  edit(doc, ctx, { commandType: "project.rename", label: "Rename" }, (draft) => { draft.metadata.name = name; });

/** Adds a glossary pair for a target language. */
export const addGlossaryPair = (doc: ProjectDocument, ctx: CommitContext, language: string, source: string, target: string): Commit =>
  edit(doc, ctx, { commandType: "glossary.add", label: "Glossary" }, (draft) => {
    (draft.glossaries[language] ?? (draft.glossaries[language] = [])).push({ source, target });
  });
export const setExportSettings = (doc: ProjectDocument, ctx: CommitContext, exportSettings: Record<string, unknown>): Commit =>
  edit(doc, ctx, { commandType: "export.settings", label: "Export settings", history: false }, (draft) => { (draft as unknown as Json).exportSettings = exportSettings; });
/** The publish caption of `export-share.Publishing hand-off`: a title and a description saved with the project, outside the undo history. */
export const setPublishCaption = (doc: ProjectDocument, ctx: CommitContext, publish: { title: string; description: string }): Commit =>
  edit(doc, ctx, { commandType: "publish.caption", label: "Publish caption", history: false }, (draft) => { (draft as unknown as Json).publish = publish; });

export type Credit = { assetId: string; name: string; author?: string; licence?: string; sourceUrl?: string };
/**
 * The credits of an export range. Nothing is stored: the list is derived from the provenance of the assets the
 * elements of the main scene use inside the range.
 */
export function deriveCredits(doc: ProjectDocument, range?: { start: number; end: number }): Credit[] {
  const used = new Set<string>();
  const main = doc.scenes.find((scene) => scene.isMain);
  for (const ref of allElements(doc)) {
    const element = ref.element as { mediaId?: string; startTime: number; duration: number };
    if (ref.scene !== main && main) continue;
    if (element.mediaId && (!range || (element.startTime < range.end && element.startTime + element.duration > range.start))) used.add(element.mediaId);
  }
  return doc.media.assets.filter((asset) => used.has(asset.id) && asset.provenance.attributionRequired)
    .map((asset) => ({ assetId: asset.id, name: asset.name, author: asset.provenance.author, licence: asset.provenance.licence, sourceUrl: asset.provenance.sourceUrl }));
}

const setPath = (target: Json, field: string, value: unknown) => {
  const parts = field.split(".");
  let current = target;
  for (const part of parts.slice(0, -1)) { if (!isObject(current[part])) return; current = current[part] as Json; }
  current[parts[parts.length - 1]] = value;
};
/**
 * "Apply brand": for each colour binding the brand colour at its position is written into the bound field and into
 * `themeColors`; a colour field without a binding is never changed.
 */
export function applyBrand(doc: ProjectDocument, ctx: CommitContext, colors: (string | undefined)[], fontFamily?: string): Commit {
  return edit(doc, { ...ctx, writer: { id: ctx.writer?.id ?? "apply-brand", applyBrand: true } }, { commandType: "template.apply-brand", label: "Apply brand" }, (draft) => {
    const template = draft.template ?? reject("document/template-invalid", "/template", "the project has no template");
    for (const binding of template.colorBindings) {
      const color = colors[binding.colorIndex];
      const ref = findElement(draft, binding.elementId);
      if (color === undefined || !ref) continue;
      setPath(ref.element as unknown as Json, binding.field, color);
      template.themeColors[binding.colorIndex] = color;
    }
    if (fontFamily) for (const text of template.editableTexts) { const ref = findElement(draft, text.elementId); if (ref) (ref.element as unknown as Json).fontFamily = fontFamily; }
  });
}

/** Fills (or re-frames) a template slot: the element's media and trim, and the slot's `filled`, `framing` and `sourceOffset`. */
export function fillTemplateSlot(doc: ProjectDocument, ctx: CommitContext, slotId: string, assetId: string, options: { sourceOffset?: number; framing?: { zoom?: number; panX?: number; panY?: number } } = {}): Commit {
  return edit(doc, ctx, { commandType: "template.slot.fill", label: "Replace" }, (draft) => {
    const slot = draft.template?.slots.find((entry) => entry.slotId === slotId) ?? reject("document/template-invalid", "/template/slots", `slot "${slotId}" does not exist`);
    const element = elementIn(draft, slot.elementId).element as unknown as Json;
    const asset = draft.media.assets.find((entry) => entry.id === assetId) ?? reject("document/unknown-asset", "/media/assets", `asset "${assetId}" does not exist`);
    const offset = options.sourceOffset ?? 0;
    element.mediaId = assetId;
    if (element.type === "video") {
      const source = asset.duration ?? slot.duration;
      Object.assign(element, { sourceDuration: source, trimStart: offset, trimEnd: Math.max(0, source - slot.duration - offset) });
    }
    slot.filled = true;
    slot.sourceOffset = offset;
    slot.framing = { ...slot.framing, ...options.framing };
  });
}

/**
 * "Edit in full editor": the lock is released, every unfilled slot gets a slate asset, and the `template` object
 * stays as a record of origin.
 */
export function leaveTemplateMode(doc: ProjectDocument, ctx: CommitContext): Commit {
  return edit(doc, ctx, { commandType: "template.unlock", label: "Edit in full editor" }, (draft) => {
    const template = draft.template ?? reject("document/template-invalid", "/template", "the project has no template");
    template.locked = false;
    for (const slot of template.slots) {
      if (slot.filled) continue;
      const element = elementIn(draft, slot.elementId).element as unknown as Json;
      const asset = assetRecordSchema.parse({
        id: ctx.newId(), name: slot.label || `Slot ${slot.index}`, type: "image", kind: "slate", size: 0, created_ms: ctx.now_ms,
        width: draft.settings.canvasSize.width, height: draft.settings.canvasSize.height, provenance: { source: "bundled" },
      });
      draft.media.assets.push(asset);
      draft.media.assets.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      // A slate is a still: a video slot element becomes an image element and loses what only a video carries.
      if (element.type === "video") { element.type = "image"; for (const key of ["sourceDuration", "retime", "freeze", "stabilization", "deflicker", "volume", "muted", "pan", "fadeIn", "fadeOut", "isVoice", "isSourceAudioEnabled", "beats", "noiseReduction", "enhanceVoice", "vocalIsolation", "voiceEffect", "pitch", "normalize", "eq", "compressor"]) delete element[key]; element.trimStart = 0; element.trimEnd = 0; }
      element.mediaId = asset.id;
      slot.filled = true;
    }
  });
}
