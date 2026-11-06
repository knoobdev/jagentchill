import { z } from "zod";
import type { Background } from "./element-fields.ts";
import { ELEMENT_VARIANTS, type ElementType, type TimelineElement } from "./elements.ts";
import { localSchema, projectDocumentSchema, TRACK_VARIANTS, type CanvasSize, type LocalSection, type ProjectDocument, type Track, type TrackType } from "./structure.ts";
import { PROJECT_SCHEMA_VERSION } from "./values.ts";

/** Canvas presets of the aspect-ratio control. */
export const CANVAS_PRESETS = [
  { ratio: "16:9", width: 1920, height: 1080 }, { ratio: "9:16", width: 1080, height: 1920 }, { ratio: "1:1", width: 1080, height: 1080 },
  { ratio: "4:3", width: 1440, height: 1080 }, { ratio: "3:4", width: 1080, height: 1440 }, { ratio: "4:5", width: 1080, height: 1350 },
  { ratio: "2:1", width: 2160, height: 1080 }, { ratio: "2.35:1", width: 2538, height: 1080 }, { ratio: "1.85:1", width: 1998, height: 1080 },
  { ratio: "21:9", width: 2520, height: 1080 },
] as const;

export type NewProjectOptions = {
  id: string; mainSceneId: string; mainTrackId: string; now_ms: number;
  name?: string; canvasSize?: CanvasSize; fps?: { numerator: number; denominator: number }; background?: Background;
  /** Phones start in portrait; every other form factor in landscape. */
  phone?: boolean;
};

/** The single definition of a new project: "New project", one main scene "Main scene", factory settings. */
export function createProjectDocument(options: NewProjectOptions): ProjectDocument {
  return projectDocumentSchema.parse({
    format: "jagentchill.project",
    schemaVersion: PROJECT_SCHEMA_VERSION,
    // Only a breaking feature raises the minimum reader (BREAKING_FEATURES); additive fields never do.
    minReaderSchemaVersion: FIRST_READER_SCHEMA_VERSION,
    metadata: { id: options.id, name: options.name ?? "New project", duration: 0, created_ms: options.now_ms, updated_ms: options.now_ms, thumbnail: null },
    settings: {
      fps: options.fps ?? { numerator: 30, denominator: 1 },
      canvasSize: options.canvasSize ?? (options.phone ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 }),
      canvasSizeMode: "preset",
      lastCustomCanvasSize: null,
      originalCanvasSize: null,
      // A size or rate the user chose explicitly is not replaced by the first clip's.
      adoptCanvasFromFirstMedia: !options.canvasSize,
      adoptFrameRateFromFirstMedia: !options.fps,
      background: options.background ?? { kind: "color", color: "#000000" },
    },
    cover: null,
    scenes: [{
      id: options.mainSceneId, name: "Main scene", isMain: true,
      tracks: { overlay: [], main: { id: options.mainTrackId, name: "Main Track", type: "video" }, audio: [] },
      created_ms: options.now_ms, updated_ms: options.now_ms,
    }],
    media: {},
  });
}

type ElementOf<T extends ElementType> = Extract<TimelineElement, { type: T }>;
/**
 * A new element with every defaulted field written out, so that content created at schema 32 never depends on a
 * reader's default table. Fields whose default is "absent" stay absent.
 */
export function createElement<T extends ElementType>(type: T, fields: Record<string, unknown> & { id: string; name: string; startTime: number; duration: number }): ElementOf<T> {
  return (ELEMENT_VARIANTS[type] as z.ZodTypeAny).parse({ ...fields, type }) as ElementOf<T>;
}

/** A new track with every defaulted field of its type written out. */
export function createTrack<T extends TrackType>(type: T, fields: Record<string, unknown> & { id: string; name: string }): Extract<Track, { type: T }> {
  return (TRACK_VARIANTS[type] as z.ZodTypeAny).parse({ ...fields, type }) as Extract<Track, { type: T }>;
}

/** The scenes' tracks in layer order: overlay (top first), main, audio. */
export function tracksOf(scene: ProjectDocument["scenes"][number]): Track[] {
  return [...scene.tracks.overlay, scene.tracks.main, ...scene.tracks.audio];
}

/** Duration of the project: the end of the last element of the main scene. */
export function projectDuration(doc: ProjectDocument): number {
  const main = doc.scenes.find((scene) => scene.isMain);
  if (!main) return 0;
  let end = 0;
  for (const track of tracksOf(main)) for (const element of track.elements) end = Math.max(end, element.startTime + element.duration);
  return end;
}

/** The device-local section with every default written out; `currentSceneId` defaults to the main scene. */
export function localDefaults(doc: { scenes?: { id: string; isMain?: boolean }[] }): LocalSection {
  const main = doc.scenes?.find((scene) => scene.isMain) ?? doc.scenes?.[0];
  return localSchema.parse(main ? { currentSceneId: main.id } : {});
}

/**
 * Breaking features and the schema that introduced each. Schema 32 is the first schema, so the table is empty; a
 * later schema adds rows here and in the catalogue, and `minReaderSchemaVersion` is the highest level present.
 */
export type BreakingFeature = { level: number; name: string; present: (doc: ProjectDocument) => boolean };
export const BREAKING_FEATURES: readonly BreakingFeature[] = [];
/** The first schema: the lowest minimum reader a document can declare (schema 33 only added optional fields). */
export const FIRST_READER_SCHEMA_VERSION = 32;

/**
 * `minReaderSchemaVersion` for a save by this build. Never below 32, never above `schemaVersion`; while the document
 * holds content this build does not know, never below the stored value.
 */
export function computeMinReaderSchemaVersion(doc: ProjectDocument, hasUnknownContent: boolean, features: readonly BreakingFeature[] = BREAKING_FEATURES): number {
  let level = FIRST_READER_SCHEMA_VERSION;
  for (const feature of features) if (feature.level > level && feature.present(doc)) level = feature.level;
  if (hasUnknownContent) level = Math.max(level, doc.minReaderSchemaVersion);
  return Math.min(level, doc.schemaVersion);
}
