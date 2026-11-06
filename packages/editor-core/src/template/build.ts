import { projectDocumentSchema, tracksOf, type ProjectDocument } from "@jagentchill/protocol";
import { sceneDuration } from "../model.ts";
import { TEMPLATE_LIMITS, TEMPLATE_PACKAGE_VERSION, readTemplateManifest, type TemplateCategory, type TemplateManifest } from "./model.ts";

type Json = Record<string, any>;
type Scene = ProjectDocument["scenes"][number];

/** What the "Save as template" dialog edits: one row per element of the active scene, and the template's own fields. */
export type TemplateDraft = {
  name: string; category: TemplateCategory; tags: string[];
  media: { elementId: string; name: string; type: "video" | "image"; main: boolean; slot: boolean; order: number; label: string; required: boolean }[];
  texts: { elementId: string; content: string; editable: boolean; label: string; maxLength: number }[];
  audio: { elementId: string; name: string; replaceable: boolean; label: string }[];
  themeColors: string[];
  /** The frame the thumbnail shows, in ticks. */
  thumbnailTime: number;
  showMedia: boolean;
};
export type BuiltTemplate = { manifest: TemplateManifest; snapshot: ProjectDocument; /** The assets of the elements that are not slots: their bytes are embedded. */ embeddedAssetIds: string[] };

const SECOND = 120_000;
const PROVENANCE = ["filmLink", "workflowLink", "scriptLink"];
const sceneOf = (doc: ProjectDocument, sceneId: string): Scene => doc.scenes.find((scene) => scene.id === sceneId) ?? doc.scenes.find((scene) => scene.isMain) ?? doc.scenes[0];
const elementsOf = (scene: Scene): Json[] => tracksOf(scene).flatMap((track) => track.elements as Json[]);
/** The default limit of an editable text: the larger of 20 and twice its length, at most 500. */
export const defaultMaxLength = (content: string): number => Math.min(TEMPLATE_LIMITS.textMax, Math.max(20, [...content].length * 2));
/** A template mode project is saved as a template only after it was opened in the full editor. */
export const canSaveAsTemplate = (doc: ProjectDocument): boolean => doc.template?.locked !== true;

/** The colour fields "Apply brand" may rewrite: a text's colour and a shape's fill. */
function colourFields(element: Json): { field: string; color: string }[] {
  if (element.type === "text" && typeof element.color === "string") return [{ field: "color", color: element.color.toLowerCase() }];
  if (element.type === "graphic" && typeof element.params?.fill === "string") return [{ field: "params.fill", color: element.params.fill.toLowerCase() }];
  return [];
}
/** Up to six colours, the most used text and shape colours first (ties: the order they first appear in). */
export function proposeThemeColors(scene: Scene): string[] {
  const counts = new Map<string, number>();
  for (const element of elementsOf(scene)) for (const { color } of colourFields(element)) counts.set(color, (counts.get(color) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, TEMPLATE_LIMITS.themeColors).map(([color]) => color);
}

/** The dialog's starting values: main-track clips are required slots, overlay clips are not slots, every text is editable, no audio is replaceable. */
export function proposeTemplate(doc: ProjectDocument, sceneId: string): TemplateDraft {
  const scene = sceneOf(doc, sceneId);
  const draft: TemplateDraft = { name: doc.metadata.name.slice(0, TEMPLATE_LIMITS.name), category: "Other", tags: [], media: [], texts: [], audio: [], themeColors: proposeThemeColors(scene), thumbnailTime: Math.min(SECOND, sceneDuration(scene)), showMedia: true };
  const main = new Set((scene.tracks.main.elements as Json[]).map((element) => element.id as string));
  const ordered = elementsOf(scene).filter((element) => element.type === "video" || element.type === "image")
    .sort((a, b) => Number(main.has(b.id)) - Number(main.has(a.id)) || a.startTime - b.startTime);
  ordered.forEach((element, index) => draft.media.push({ elementId: element.id, name: element.name, type: element.type, main: main.has(element.id), slot: main.has(element.id), order: index + 1, label: "", required: true }));
  for (const element of elementsOf(scene).sort((a, b) => a.startTime - b.startTime)) {
    if (element.type === "text") draft.texts.push({ elementId: element.id, content: String(element.content ?? ""), editable: true, label: String(element.name ?? "Text").slice(0, TEMPLATE_LIMITS.label), maxLength: defaultMaxLength(String(element.content ?? "")) });
    if (element.type === "audio") draft.audio.push({ elementId: element.id, name: element.name, replaceable: false, label: String(element.name ?? "Audio").slice(0, TEMPLATE_LIMITS.label) });
  }
  return draft;
}

/** The asset ids an element shows or plays, the ones of its freeze frame and background included. */
function assetsOf(element: Json): string[] {
  return [element.mediaId, element.freeze?.mediaId].filter((value): value is string => typeof value === "string");
}
/** The scenes a scene needs to render: itself and the scenes of its compound clips, transitively. */
function reachable(doc: ProjectDocument, scene: Scene): Scene[] {
  const kept = new Map<string, Scene>([[scene.id, scene]]);
  const visit = (current: Scene) => {
    for (const element of elementsOf(current)) {
      if (element.type !== "compound" || kept.has(element.sceneId)) continue;
      const inner = doc.scenes.find((candidate) => candidate.id === element.sceneId);
      if (inner) { kept.set(inner.id, inner); visit(inner); }
    }
  };
  visit(scene);
  return [...kept.values()];
}

/** The bytes a save would embed: the assets of every element that is not a slot. */
export function embeddedAssets(doc: ProjectDocument, sceneId: string, draft: Pick<TemplateDraft, "media">): { ids: string[]; bytes: number } {
  const slots = new Set(draft.media.filter((row) => row.slot).map((row) => row.elementId));
  const ids = new Set<string>();
  for (const scene of reachable(doc, sceneOf(doc, sceneId))) for (const element of elementsOf(scene)) if (!slots.has(element.id)) for (const assetId of assetsOf(element)) ids.add(assetId);
  const background = doc.settings.background as Json;
  if (typeof background?.mediaId === "string") ids.add(background.mediaId);
  const kept = doc.media.assets.filter((asset) => ids.has(asset.id));
  return { ids: kept.map((asset) => asset.id), bytes: kept.reduce((sum, asset) => sum + asset.size, 0) };
}

export class TemplateRefused extends Error {
  code: "too-large" | "template-mode" | "name";
  details: Record<string, number>;
  constructor(code: TemplateRefused["code"], message: string, details: Record<string, number> = {}) { super(message); this.name = "TemplateRefused"; this.code = code; this.details = details; }
}

/**
 * The template a project's active scene saves as. The project is read, never changed: the snapshot is a copy holding
 * that scene only, without provenance links, with the media of every slot element removed and the `template` object
 * (locked, every slot unfilled) that makes a project created from it a template draft.
 */
export function buildTemplate(doc: ProjectDocument, sceneId: string, draft: TemplateDraft, env: { id: string; now_ms: number; author?: string; appVersion?: string; thumbnail?: string | null; preview?: string | null }): BuiltTemplate {
  if (!canSaveAsTemplate(doc)) throw new TemplateRefused("template-mode", "Open this project in the full editor before saving it as a template");
  const name = draft.name.trim().replace(/\s+/g, " ").slice(0, TEMPLATE_LIMITS.name);
  if (name === "") throw new TemplateRefused("name", "Give the template a name");
  const embedded = embeddedAssets(doc, sceneId, draft);
  if (embedded.bytes > TEMPLATE_LIMITS.embeddedBytes) throw new TemplateRefused("too-large", "The template would embed more than 2 GiB of media. Turn more clips into slots.", { bytes: embedded.bytes });

  const copy = structuredClone(doc) as unknown as Json;
  const active = sceneOf(doc, sceneId);
  const scenes = reachable(copy as unknown as ProjectDocument, (copy.scenes as Scene[]).find((scene) => scene.id === active.id)!);
  for (const scene of scenes) (scene as Json).isMain = scene.id === active.id;
  copy.scenes = scenes;
  for (const key of ["local", "filmLink", "workflowLink", "template", "cover", "exportSettings", "publish"]) delete copy[key];
  copy.cover = null;
  copy.scriptLinks = [];
  copy.metadata = { ...copy.metadata, id: env.id, name, created_ms: env.now_ms, updated_ms: env.now_ms, thumbnail: null };
  delete copy.metadata.importedFrom;
  const scene = scenes[0];
  for (const kept of scenes) for (const element of elementsOf(kept)) for (const key of PROVENANCE) delete element[key];

  const rows = draft.media.filter((row) => row.slot).sort((a, b) => a.order - b.order);
  const slots: TemplateManifest["slots"] = [];
  for (const track of tracksOf(scene)) {
    (track as Json).elements = (track.elements as Json[]).map((element) => {
      if (!rows.some((row) => row.elementId === element.id)) return element;
      // A slot keeps everything of its element but the media it showed.
      const { mediaId: _mediaId, sourceDuration: _source, freeze: _freeze, ...rest } = element;
      return { ...rest, trimStart: 0, trimEnd: 0 };
    });
  }
  const byId = new Map(elementsOf(scene).map((element) => [element.id as string, element]));
  rows.forEach((row, position) => {
    const element = byId.get(row.elementId);
    if (!element) return;
    slots.push({ slotId: `slot-${position + 1}`, elementId: row.elementId, index: position + 1, accepts: "any", duration: element.duration, required: row.required, label: row.label.trim().slice(0, TEMPLATE_LIMITS.label) });
  });
  const editableTexts = draft.texts.filter((row) => row.editable && byId.get(row.elementId)?.type === "text")
    .map((row) => ({ elementId: row.elementId, label: row.label.trim().slice(0, TEMPLATE_LIMITS.label), maxLength: Math.max([...String(byId.get(row.elementId)!.content ?? "")].length, Math.min(TEMPLATE_LIMITS.textMax, Math.max(1, Math.round(row.maxLength)))) }));
  const audioSlots = draft.audio.filter((row) => byId.get(row.elementId)?.type === "audio").map((row) => ({ elementId: row.elementId, label: row.label.trim().slice(0, TEMPLATE_LIMITS.label), replaceable: row.replaceable }));
  const themeColors = draft.themeColors.slice(0, TEMPLATE_LIMITS.themeColors).map((color) => color.toLowerCase());
  const colorBindings = elementsOf(scene).flatMap((element) => colourFields(element).filter((entry) => themeColors.includes(entry.color)).map((entry) => ({ colorIndex: themeColors.indexOf(entry.color), elementId: element.id as string, field: entry.field })));
  const variables = [
    ...editableTexts.map((entry) => ({ id: `text-${entry.elementId}`, label: entry.label, type: "text" as const, defaultValue: String(byId.get(entry.elementId)?.content ?? ""), maxLength: entry.maxLength, bindings: [{ elementId: entry.elementId, field: "content" }] })),
    ...themeColors.map((value, colorIndex) => ({ id: `color-${colorIndex + 1}`, label: "Brand color {n}", type: "color" as const, defaultValue: value, bindings: colorBindings.filter((binding) => binding.colorIndex === colorIndex).map(({ elementId, field }) => ({ elementId, field })) })),
  ];

  copy.media.assets = (copy.media.assets as Json[]).filter((asset) => embedded.ids.includes(asset.id));
  const duration = sceneDuration(scene);
  copy.metadata.duration = duration;
  copy.template = {
    templateId: env.id, locked: true, sceneId: scene.id,
    slots: slots.map((slot) => ({ ...slot, filled: false, framing: { zoom: 1, panX: 0, panY: 0 }, sourceOffset: 0 })),
    editableTexts, audioSlots, themeColors, colorBindings, variables: variables.map((variable) => ({ ...variable, value: variable.defaultValue })),
  };
  const snapshot = projectDocumentSchema.parse(copy);
  const manifest = readTemplateManifest({
    id: env.id, name, category: draft.category, tags: [...new Set(draft.tags.map((tag) => tag.trim()).filter(Boolean))].slice(0, TEMPLATE_LIMITS.tags),
    canvas: { width: snapshot.settings.canvasSize.width, height: snapshot.settings.canvasSize.height }, frameRate: snapshot.settings.fps, duration,
    slots, editableTexts, audioSlots, themeColors, colorBindings, variables,
    thumbnail: env.thumbnail ?? null, preview: env.preview ?? null, author: env.author ?? "", license: "", sources: [],
    schemaVersion: snapshot.schemaVersion, packageVersion: TEMPLATE_PACKAGE_VERSION, created_ms: env.now_ms, appVersionMin: env.appVersion ?? "0.0.0",
  });
  return { manifest, snapshot, embeddedAssetIds: embedded.ids };
}

/**
 * A new project from a template: the snapshot under a new id and name, with the manifest's lists as its `template`
 * object, locked, every slot empty. The template is not changed.
 */
export function projectFromTemplate(manifest: TemplateManifest, snapshot: ProjectDocument, env: { id: string; now_ms: number; name?: string }): ProjectDocument {
  const copy = structuredClone(snapshot) as unknown as Json;
  delete copy.local;
  copy.metadata = { ...copy.metadata, id: env.id, name: (env.name ?? manifest.name).slice(0, 120), created_ms: env.now_ms, updated_ms: env.now_ms, thumbnail: null };
  copy.template = {
    templateId: manifest.id, locked: true, sceneId: (copy.scenes as Scene[]).find((scene) => scene.isMain)?.id ?? copy.scenes[0].id,
    slots: manifest.slots.map((slot) => ({ ...slot, filled: false, framing: { zoom: 1, panX: 0, panY: 0 }, sourceOffset: 0 })),
    editableTexts: manifest.editableTexts, audioSlots: manifest.audioSlots, themeColors: manifest.themeColors, colorBindings: manifest.colorBindings,
    variables: manifest.variables.map((variable) => ({ ...variable, value: variable.defaultValue })),
  };
  return projectDocumentSchema.parse(copy);
}

/** The n-th picked asset fills slot n; an asset whose kind a slot does not accept is left out and named. */
export function fillPlan(manifestSlots: readonly { slotId: string; index: number; accepts: "video" | "image" | "any" }[], picked: readonly { id: string; type: string }[]): { fills: { slotId: string; assetId: string }[]; refused: { slotId: string; assetId: string; needs: "video" | "image" }[] } {
  const fills: { slotId: string; assetId: string }[] = [], refused: { slotId: string; assetId: string; needs: "video" | "image" }[] = [];
  [...manifestSlots].sort((a, b) => a.index - b.index).forEach((slot, position) => {
    const asset = picked[position];
    if (!asset) return;
    if (slot.accepts !== "any" && slot.accepts !== asset.type) refused.push({ slotId: slot.slotId, assetId: asset.id, needs: slot.accepts });
    else fills.push({ slotId: slot.slotId, assetId: asset.id });
  });
  return { fills, refused };
}
/** The required slots still empty: what disables Export in template mode. */
export const missingRequired = (doc: ProjectDocument): string[] => (doc.template?.slots ?? []).filter((slot) => slot.required && !slot.filled).map((slot) => slot.slotId);
