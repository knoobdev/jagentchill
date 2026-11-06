import { createProjectDocument, createTrack, projectDuration, type ProjectDocument, type Track } from "@jagentchill/protocol";
import { applyPatch, canonicalize, clone, timeline, validateProjectDocument, type StatePatch } from "../../src/index.ts";
import { asset, ids, NOW, REGISTRIES, SECOND } from "./fixtures.ts";

export { SECOND };
export const S = SECOND;
export const ON: timeline.EditContext = { magnet: true, ripple: false, linkage: true, freeLayer: false };
export const OFF: timeline.EditContext = { magnet: false, ripple: false, linkage: false, freeLayer: false };
export const RIPPLE: timeline.EditContext = { magnet: false, ripple: true, linkage: false, freeLayer: false };
export const FREE: timeline.EditContext = { magnet: false, ripple: false, linkage: true, freeLayer: true };

/** A new project (30 fps) with a 60 s video `a1` that has sound, an image `a2`, a 60 s audio `a3` and a second 20 s video `a4`. */
export function project(): ProjectDocument {
  const doc = createProjectDocument({ id: "p1", mainSceneId: "s1", mainTrackId: "t-main", now_ms: NOW });
  doc.media.assets = [asset("a1", "video", { duration: 60 * S }), asset("a2", "image"), asset("a3", "audio", { duration: 60 * S }), asset("a4", "video", { duration: 20 * S, contentHash: "b".repeat(64) })];
  return doc;
}
/** Adds empty tracks to the first scene: `[id, type]` pairs; audio tracks go to the audio zone, the rest to overlay in the given order (top first). */
export function withTracks(doc: ProjectDocument, ...tracks: [string, Track["type"], Record<string, unknown>?][]): ProjectDocument {
  const next = clone(doc), scene = next.scenes[0];
  for (const [id, type, extra] of tracks) (type === "audio" ? scene.tracks.audio : scene.tracks.overlay).push(createTrack(type, { id, name: timeline.DEFAULT_TRACK_NAMES[type], ...(type === "caption" ? { caption: { style: {} } } : {}), ...extra }) as never);
  return next;
}
/** An editing session over a document with reproducible ids and a clock the test moves. */
export function open(input: ProjectDocument, options: Partial<timeline.SessionOptions> = {}) {
  // Fixtures are assembled by hand; the derived duration is brought in step as a save would have left it.
  const document = input.metadata.duration === projectDuration(input) ? input : { ...input, metadata: { ...input.metadata, duration: projectDuration(input) } };
  const patches: { patch: StatePatch; kind: string; label: string }[] = [];
  const clock = { now: NOW + 10_000 };
  const session = timeline.createEditorSession({ document, newId: ids("gen"), now: () => clock.now, registries: REGISTRIES, onPatch: (patch, step) => patches.push({ patch, ...step }), ...options });
  return Object.assign(session, { patches, clock });
}
export type Session = ReturnType<typeof open>;
const tracksOf = (doc: ProjectDocument, sceneId?: string) => { const scene = doc.scenes.find((entry) => entry.id === (sceneId ?? doc.scenes[0].id))!; return [...scene.tracks.overlay, scene.tracks.main, ...scene.tracks.audio]; };
export const trackOf = (doc: ProjectDocument, trackId: string): any => doc.scenes.flatMap((scene) => tracksOf(doc, scene.id)).find((track) => track.id === trackId);
/** `[start, end]` in seconds of every element of a track, in order. */
export const spans = (doc: ProjectDocument, trackId: string): [number, number][] => (trackOf(doc, trackId)?.elements ?? []).map((element: any) => [element.startTime / S, (element.startTime + element.duration) / S]);
export const el = (doc: ProjectDocument, id: string): any => doc.scenes.flatMap((scene) => tracksOf(doc, scene.id)).flatMap((track) => track.elements as any[]).find((element) => element.id === id);
export const trackIdOf = (doc: ProjectDocument, elementId: string): string | undefined => doc.scenes.flatMap((scene) => tracksOf(doc, scene.id)).find((track) => (track.elements as any[]).some((element) => element.id === elementId))?.id;
export const overlay = (doc: ProjectDocument, sceneIndex = 0): any[] => doc.scenes[sceneIndex].tracks.overlay as any[];
export const audioTracks = (doc: ProjectDocument, sceneIndex = 0): any[] => doc.scenes[sceneIndex].tracks.audio as any[];
export const main = (doc: ProjectDocument, sceneIndex = 0): any => doc.scenes[sceneIndex].tracks.main;
export const isValid = (doc: ProjectDocument): boolean => validateProjectDocument(doc, { mode: "strict", registries: REGISTRIES }).ok;
export const canonical = (doc: ProjectDocument): string => canonicalize(doc);
export { applyPatch };
