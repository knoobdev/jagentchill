import { createElement, type ProjectDocument } from "@jagentchill/protocol";
import { findElement } from "../model.ts";
import { edit, elementIn, reject, type Commit, type CommitContext } from "../ops/shared.ts";
import type { BrandKit } from "./brand.ts";

type Json = Record<string, any>;
/** The furthest a slot's source may start: the source has to reach the end of the slot. */
export const maxSourceOffset = (sourceDuration: number, slotDuration: number): number => Math.max(0, sourceDuration - slotDuration);
const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));
const slotOf = (draft: ProjectDocument, slotId: string) => draft.template?.slots.find((entry) => entry.slotId === slotId) ?? reject("document/template-invalid", "/template/slots", `slot "${slotId}" does not exist`);

/** What only a video element carries: an image element has none of it. */
const VIDEO_ONLY = ["sourceDuration", "retime", "freeze", "stabilization", "deflicker", "volume", "muted", "pan", "fadeIn", "fadeOut", "isVoice", "isSourceAudioEnabled", "beats", "noiseReduction", "enhanceVoice", "vocalIsolation", "voiceEffect", "pitch", "normalize", "eq", "compressor"];
export class SlotRefused extends Error {
  needs: "video" | "image";
  constructor(needs: "video" | "image") { super(`This slot needs ${needs === "image" ? "an image" : "a video"}`); this.name = "SlotRefused"; this.needs = needs; }
}
/**
 * Fills or replaces a slot: the element takes the asset, from `sourceOffset` for a video, and keeps its timing, track,
 * transform and effects. A slot that accepts any media becomes a video or an image element as the asset is one; a
 * slot that accepts one kind refuses the other (`SlotRefused`). A video shorter than the slot holds its last frame.
 */
export function fillSlot(doc: ProjectDocument, ctx: CommitContext, slotId: string, assetId: string, options: { sourceOffset?: number } = {}): Commit {
  const asset = doc.media.assets.find((entry) => entry.id === assetId) ?? reject("document/unknown-asset", "/media/assets", `asset "${assetId}" does not exist`);
  const accepts = slotOf(doc, slotId).accepts;
  if (asset.type === "audio") throw new SlotRefused(accepts === "image" ? "image" : "video");
  if (accepts !== "any" && accepts !== asset.type) throw new SlotRefused(accepts);
  return edit(doc, ctx, { commandType: "template.slot.fill", label: "Replace" }, (draft) => {
    const slot = slotOf(draft, slotId);
    const ref = elementIn(draft, slot.elementId);
    let element = ref.element as unknown as Json;
    if (element.type !== asset.type) {
      const { type: _type, mediaId: _mediaId, ...rest } = element;
      for (const key of VIDEO_ONLY) delete rest[key];
      element = createElement(asset.type as "video" | "image", { ...rest, mediaId: assetId, ...(asset.type === "video" ? { sourceDuration: asset.duration ?? slot.duration } : {}) } as never) as unknown as Json;
      (ref.track.elements as unknown[])[ref.index] = element;
    }
    element.mediaId = assetId;
    if (asset.type === "video") {
      const source = asset.duration ?? slot.duration, offset = Math.round(clamp(options.sourceOffset ?? 0, 0, maxSourceOffset(source, slot.duration)));
      Object.assign(element, { sourceDuration: source, trimStart: offset, trimEnd: Math.max(0, source - slot.duration - offset) });
      slot.sourceOffset = offset;
    } else { element.trimStart = 0; element.trimEnd = 0; slot.sourceOffset = 0; }
    slot.filled = true;
    slot.framing = { zoom: 1, panX: 0, panY: 0 };
  });
}
/** A filled video slot whose source is shorter than the slot: it holds its last frame and shows "Shorter than slot". */
export function shorterThanSlot(doc: ProjectDocument, slotId: string): boolean {
  const slot = doc.template?.slots.find((entry) => entry.slotId === slotId);
  const element = slot?.filled ? (findElement(doc, slot.elementId)?.element as unknown as Json | undefined) : undefined;
  return element?.type === "video" && typeof element.sourceDuration === "number" && element.sourceDuration < slot!.duration;
}

/** "Remove": the slot is empty again; its element keeps its timing, track and effects. */
export function clearTemplateSlot(doc: ProjectDocument, ctx: CommitContext, slotId: string): Commit {
  return edit(doc, ctx, { commandType: "template.slot.clear", label: "Remove" }, (draft) => {
    const slot = slotOf(draft, slotId);
    const element = elementIn(draft, slot.elementId).element as unknown as Json;
    delete element.mediaId;
    delete element.sourceDuration;
    element.trimStart = 0;
    element.trimEnd = 0;
    slot.filled = false;
    slot.sourceOffset = 0;
    slot.framing = { zoom: 1, panX: 0, panY: 0 };
  });
}

/** "Adjust": the framing inside the slot (zoom 1–5×, pan −1…1 of the room the zoom leaves) and, for a video, where its source starts. */
export function adjustTemplateSlot(doc: ProjectDocument, ctx: CommitContext, slotId: string, change: { zoom?: number; panX?: number; panY?: number; sourceOffset?: number }): Commit {
  return edit(doc, ctx, { commandType: "template.slot.adjust", label: "Adjust" }, (draft) => {
    const slot = slotOf(draft, slotId);
    if (!slot.filled) reject("document/template-invalid", `/template/slots/@${slotId}`, "an empty slot has nothing to adjust");
    slot.framing = { zoom: clamp(change.zoom ?? slot.framing.zoom, 1, 5), panX: clamp(change.panX ?? slot.framing.panX, -1, 1), panY: clamp(change.panY ?? slot.framing.panY, -1, 1) };
    if (change.sourceOffset === undefined) return;
    const element = elementIn(draft, slot.elementId).element as unknown as Json;
    const asset = draft.media.assets.find((entry) => entry.id === element.mediaId);
    if (asset?.type !== "video" || typeof element.sourceDuration !== "number") return;
    const offset = Math.round(clamp(change.sourceOffset, 0, maxSourceOffset(element.sourceDuration, slot.duration)));
    slot.sourceOffset = offset;
    element.trimStart = offset;
    element.trimEnd = Math.max(0, element.sourceDuration - slot.duration - offset);
  });
}

/** The content of an editable text, cut at its limit: input stops there. */
export function setTemplateText(doc: ProjectDocument, ctx: CommitContext, elementId: string, content: string): Commit {
  return edit(doc, ctx, { commandType: "template.text", label: "Edit text" }, (draft) => {
    const entry = draft.template?.editableTexts.find((text) => text.elementId === elementId) ?? reject("document/template-invalid", "/template/editableTexts", `"${elementId}" is not an editable text`);
    (elementIn(draft, elementId).element as unknown as Json).content = [...content].slice(0, entry.maxLength).join("");
  });
}

/** Fill several typed template variables as one command and one undo step. */
export function fillTemplateVariables(doc: ProjectDocument, ctx: CommitContext, values: Record<string, unknown>): Commit {
  return edit(doc, ctx, { commandType: "template.variables.fill", label: "Fill template variables" }, (draft) => {
    const variables = draft.template?.variables ?? reject("document/template-invalid", "/template/variables", "the project has no template variables");
    const unknown = Object.keys(values).filter((key) => !variables.some((variable) => variable.id === key));
    if (unknown.length) reject("document/template-invalid", "/template/variables", `unknown variable "${unknown[0]}"`);
    for (const variable of variables) {
      if (!Object.hasOwn(values, variable.id)) continue;
      const value = values[variable.id];
      if (variable.type === "text" && (typeof value !== "string" || [...value].length > (variable.maxLength ?? 10_000))) reject("document/template-invalid", `/template/variables/@${variable.id}`, `expected text of at most ${variable.maxLength ?? 10_000} characters`);
      if (variable.type === "color" && (typeof value !== "string" || !/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(value))) reject("document/template-invalid", `/template/variables/@${variable.id}`, "expected a hex colour");
      if (variable.type === "number" && (typeof value !== "number" || !Number.isFinite(value))) reject("document/template-invalid", `/template/variables/@${variable.id}`, "expected a finite number");
      if (variable.type === "image" && (typeof value !== "string" || !draft.media.assets.some((asset) => asset.id === value && asset.type === "image"))) reject("document/template-invalid", `/template/variables/@${variable.id}`, "expected an image asset in this project");
      for (const binding of variable.bindings) {
        const ref = findElement(draft, binding.elementId) ?? reject("document/template-invalid", `/template/variables/@${variable.id}/bindings`, `element "${binding.elementId}" does not exist`);
        setPath(ref.element as unknown as Json, binding.field, value);
      }
      variable.value = value as never;
      if (variable.type === "color") {
        const colorIndex = /^color-(\d+)$/.exec(variable.id);
        if (colorIndex) { const index = Number(colorIndex[1]) - 1; if (index >= 0 && index < (draft.template?.themeColors.length ?? 0)) draft.template!.themeColors[index] = String(value); }
      }
    }
  });
}

const setPath = (target: Json, field: string, value: unknown) => {
  const parts = field.split(".");
  let current = target;
  for (const part of parts.slice(0, -1)) { if (current[part] === null || typeof current[part] !== "object") return; current = current[part] as Json; }
  current[parts[parts.length - 1]] = value;
};
/**
 * "Apply brand", one undo step: the editable text with the largest font size takes the Heading font (ties: the
 * earliest), every other editable text the Body font; theme colour i becomes brand colour i wherever a binding names
 * it. A role without a font, a theme colour without a brand colour and a field without a binding stay as they are.
 */
export function applyBrandKit(doc: ProjectDocument, ctx: CommitContext, kit: Pick<BrandKit, "colors" | "fonts">): Commit {
  return edit(doc, { ...ctx, writer: { id: ctx.writer?.id ?? "apply-brand", applyBrand: true } }, { commandType: "template.apply-brand", label: "Apply brand" }, (draft) => {
    const template = draft.template ?? reject("document/template-invalid", "/template", "the project has no template");
    const count = Math.min(kit.colors.length, template.themeColors.length);
    for (const binding of template.colorBindings) {
      if (binding.colorIndex >= count) continue;
      const ref = findElement(draft, binding.elementId);
      if (ref) setPath(ref.element as unknown as Json, binding.field, kit.colors[binding.colorIndex].value);
    }
    for (let index = 0; index < count; index++) template.themeColors[index] = kit.colors[index].value;
    const texts = template.editableTexts.map((entry) => findElement(draft, entry.elementId)?.element as unknown as Json | undefined).filter((element): element is Json => element !== undefined && element.type === "text");
    const heading = [...texts].sort((a, b) => (b.fontSize ?? 0) - (a.fontSize ?? 0) || a.startTime - b.startTime)[0];
    const family = (role: "heading" | "body") => kit.fonts.find((font) => font.roles.includes(role))?.family;
    for (const text of texts) { const next = family(text === heading ? "heading" : "body"); if (next) text.fontFamily = next; }
  });
}

type Crop = { left: number; top: number; right: number; bottom: number };
/**
 * The part of a slot's media that is shown: the media covers the canvas frame (centre crop), enlarged by the slot's
 * zoom and moved by its pan within the room that leaves, so the frame is always covered. `null` when the element is
 * not a filled slot, or has a crop of its own (set after the project was opened in the full editor).
 */
export function slotCrop(doc: ProjectDocument, elementId: string, source: { width: number; height: number }, own?: Crop): Crop | null {
  const slot = doc.template?.slots.find((entry) => entry.elementId === elementId);
  if (!slot?.filled || !(source.width > 0) || !(source.height > 0)) return null;
  if (own && (own.left !== 0 || own.top !== 0 || own.right !== 0 || own.bottom !== 0)) return null;
  const canvas = doc.settings.canvasSize, ratio = (source.width / source.height) / (canvas.width / canvas.height);
  const zoom = clamp(slot.framing.zoom, 1, 5);
  // The share of the source's width and height that the frame shows; never less than a hundredth of it.
  const shownX = Math.max(0.01, (ratio > 1 ? 1 / ratio : 1) / zoom), shownY = Math.max(0.01, (ratio > 1 ? 1 : ratio) / zoom);
  const left = (1 - shownX) * (0.5 + clamp(slot.framing.panX, -1, 1) / 2), top = (1 - shownY) * (0.5 + clamp(slot.framing.panY, -1, 1) / 2);
  return { left, top, right: 1 - shownX - left, bottom: 1 - shownY - top };
}

export class AudioRefused extends Error { constructor(message: string) { super(message); this.name = "AudioRefused"; } }
/**
 * "Replace" on a replaceable audio slot: the slot plays the new audio from its start for the slot's own duration. A
 * sound shorter than the slot is refused: this build does not loop a replacement.
 */
export function replaceTemplateAudio(doc: ProjectDocument, ctx: CommitContext, elementId: string, assetId: string): Commit {
  const entry = doc.template?.audioSlots.find((slot) => slot.elementId === elementId);
  if (!entry?.replaceable) throw new AudioRefused("This audio cannot be replaced");
  const asset = doc.media.assets.find((candidate) => candidate.id === assetId) ?? reject("document/unknown-asset", "/media/assets", `asset "${assetId}" does not exist`);
  if (asset.type !== "audio" && !(asset.type === "video" && asset.hasAudio)) throw new AudioRefused("Choose an audio file");
  const slot = findElement(doc, elementId)?.element as unknown as Json;
  if ((asset.duration ?? 0) < slot.duration) throw new AudioRefused("Choose a sound at least as long as the slot");
  return edit(doc, ctx, { commandType: "template.audio.replace", label: "Replace" }, (draft) => {
    const element = elementIn(draft, elementId).element as unknown as Json;
    Object.assign(element, { mediaId: assetId, sourceType: "upload", sourceDuration: asset.duration, trimStart: 0, trimEnd: Math.max(0, asset.duration! - element.duration) });
  });
}

/**
 * The music of a project made from a starter: `assetId` (a sound the project already holds — the track the starter
 * names, fetched from the remote catalogue) is put on the starter's empty "Music" track from the first frame to the
 * end of the scene (or of the sound, when that is shorter), with a one-second fade-out, and becomes a replaceable audio
 * slot of the template. Nothing happens to a project whose Music track already holds something: null.
 */
export function placeStarterMusic(doc: ProjectDocument, ctx: CommitContext, input: { sceneId: string; assetId: string; title: string; trackId: string; elementId: string }): Commit | null {
  const scene = doc.scenes.find((entry) => entry.id === input.sceneId), asset = doc.media.assets.find((entry) => entry.id === input.assetId);
  if (!scene || !asset || asset.type !== "audio" || !(Number(asset.duration) > 0)) return null;
  const track = scene.tracks.audio.find((entry) => entry.id === input.trackId);
  if (!track || track.elements.length > 0 || findElement(doc, input.elementId)) return null;
  const SECOND = 120_000, frame = Math.round((SECOND * doc.settings.fps.denominator) / doc.settings.fps.numerator) || SECOND / 30;
  const end = Math.max(0, ...[...scene.tracks.overlay, scene.tracks.main, ...scene.tracks.audio].flatMap((entry) => (entry.elements as unknown as Json[]).map((element) => Number(element.startTime) + Number(element.duration))));
  const source = Math.floor(Number(asset.duration) / frame) * frame, played = Math.min(end > 0 ? end : source, source);
  if (played <= 0) return null;
  return edit(doc, ctx, { commandType: "template.music.place", label: "Add music" }, (draft) => {
    const target = draft.scenes.find((entry) => entry.id === input.sceneId)!.tracks.audio.find((entry) => entry.id === input.trackId)!;
    // Placed as a sound of the catalogue ("library"): the licence check then names its licence and asks for the credit.
    (target.elements as unknown as Json[]).push(createElement("audio", { id: input.elementId, name: input.title.slice(0, 200), startTime: 0, duration: played, sourceDuration: source, trimEnd: source - played, mediaId: input.assetId, sourceType: "library", ...(played >= 2 * SECOND ? { fadeOut: { duration: SECOND } } : {}) }));
    if (draft.template && !draft.template.audioSlots.some((slot) => slot.elementId === input.elementId)) (draft.template.audioSlots as unknown as Json[]).push({ elementId: input.elementId, label: "Music", replaceable: true });
  });
}
