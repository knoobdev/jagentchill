import { createHistory, createIdSource, acceptPatch, type Commit, type CommitContext } from "@jagentchill/editor-core";
import { assetRecordSchema, createElement, createProjectDocument, createTrack, type AssetRecord, type ProjectDocument, type Track } from "@jagentchill/protocol";
import type { DocumentSession } from "../../src/index.ts";

/** A project document and an editing session with a real undo history, for the library and pipeline tests. */
export const NOW = 1_800_000_000_000;
export const SECOND = 120_000;
export const HASH = (char: string): string => char.repeat(64);
export const MIB = 1024 * 1024;
export const GIB = 1024 * MIB;

export function asset(id: string, type: "video" | "image" | "audio", extra: Record<string, unknown> = {}): AssetRecord {
  return assetRecordSchema.parse({
    id, name: `${id}.${type === "video" ? "mp4" : type === "image" ? "png" : "wav"}`, type, size: 1000, created_ms: NOW, contentHash: null,
    ...(type !== "audio" ? { width: 1920, height: 1080 } : {}), ...(type !== "image" ? { duration: 10 * SECOND } : {}),
    ...(type === "video" ? { fps: { numerator: 30, denominator: 1 }, hasAudio: true } : {}), ...extra,
  });
}
export function project(assets: AssetRecord[] = []): ProjectDocument {
  const doc = createProjectDocument({ id: "p1", mainSceneId: "s1", mainTrackId: "t-main", now_ms: NOW });
  doc.media.assets = [...assets].sort((a, b) => (a.id < b.id ? -1 : 1));
  doc.scenes[0].tracks.overlay = [createTrack("video", { id: "t-video", name: "Video" })] as Track[];
  doc.scenes[0].tracks.audio = [createTrack("audio", { id: "t-audio", name: "Audio" })] as Track[];
  return doc;
}
type Fields = Record<string, unknown>;
export const videoClip = (id: string, mediaId: string, start = 0, seconds = 2, extra: Fields = {}) =>
  createElement("video", { id, name: id, startTime: start * SECOND, duration: seconds * SECOND, mediaId, sourceDuration: seconds * SECOND, ...extra });
export const imageClip = (id: string, mediaId: string, start = 0, seconds = 2, extra: Fields = {}) =>
  createElement("image", { id, name: id, startTime: start * SECOND, duration: seconds * SECOND, mediaId, ...extra });
export const audioClip = (id: string, mediaId: string, start = 0, seconds = 2, extra: Fields = {}) =>
  createElement("audio", { id, name: id, startTime: start * SECOND, duration: seconds * SECOND, mediaId, sourceType: "upload", sourceDuration: seconds * SECOND, ...extra });
/** Places elements on the main track (video, image), the overlay video track or the audio track of a scene. */
export function place(doc: ProjectDocument, zone: "main" | "overlay" | "audio", elements: unknown[], sceneIndex = 0): ProjectDocument {
  const tracks = doc.scenes[sceneIndex].tracks;
  const track = zone === "main" ? tracks.main : zone === "overlay" ? tracks.overlay[0] : tracks.audio[0];
  (track.elements as unknown[]).push(...elements);
  return doc;
}
export function addScene(doc: ProjectDocument, id: string): ProjectDocument {
  const second = createProjectDocument({ id: "tmp", mainSceneId: id, mainTrackId: `${id}-main`, now_ms: NOW }).scenes[0];
  doc.scenes.push({ ...second, isMain: false, name: id });
  return doc;
}

export type TestSession = DocumentSession & { undo(): boolean; redo(): boolean; commits: Commit[]; rollbacks: number };
export function session(initial: ProjectDocument): TestSession {
  const history = createHistory(), newId = createIdSource();
  let document = initial, clock = NOW + 1000;
  const apply = (doc: ProjectDocument, patch: Parameters<typeof acceptPatch>[1]) => acceptPatch(doc, patch);
  const self: TestSession = {
    get document() { return document; },
    context: (): CommitContext => ({ now_ms: clock++, newId }),
    commit(commit) { document = history.record(document, commit); self.commits.push(commit); },
    // A failed import is taken back by undoing its step; nothing of it stays in the library.
    rollback() { const move = history.undo(document, apply); if (move) document = move.document; self.rollbacks++; },
    setDocument(next) { document = next; },
    undo() { const move = history.undo(document, apply); if (move) document = move.document; return move !== null; },
    redo() { const move = history.redo(document, apply); if (move) document = move.document; return move !== null; },
    commits: [], rollbacks: 0,
  };
  return self;
}
