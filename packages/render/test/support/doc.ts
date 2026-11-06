import { createElement, createProjectDocument, createTrack, type ProjectDocument } from "@jagentchill/protocol";

/** Plain-JSON builders of small project documents for the scene and frame tests. */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));
export function project(canvas = { width: 1920, height: 1080 }, background: unknown = { kind: "color", color: "#000000" }): ProjectDocument {
  return plain(createProjectDocument({ id: "p1", mainSceneId: "s1", mainTrackId: "main", now_ms: 0, canvasSize: canvas, fps: { numerator: 30, denominator: 1 }, background: background as never }));
}
export const asset = (id: string, type: "image" | "video" | "audio", fields: Record<string, unknown> = {}) => ({
  id, name: id, type, kind: null, size: 1, contentHash: null, rotation: 0, folderId: null, tags: [], ephemeral: false,
  provenance: { source: "imported", attributionRequired: false, referenceAssetIds: [] }, motionTracks: [], faces: [], created_ms: 0, ...fields,
}) as never;
export const element = (type: string, fields: Record<string, unknown>) => plain(createElement(type as never, { name: String(fields.id), startTime: 0, duration: 120_000, ...fields } as never)) as never;
export const track = (type: string, id: string, elements: unknown[], fields: Record<string, unknown> = {}) => ({ ...(plain(createTrack(type as never, { id, name: id, ...fields } as never)) as object), elements }) as never;
