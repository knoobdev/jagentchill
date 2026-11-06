import assert from "node:assert/strict";
import { assetRecordSchema, createElement, createProjectDocument, createTrack, type ProjectDocument, type TimelineElement, type Track } from "@jagentchill/protocol";
import {
  clone, compareIds, DOCUMENT_ERROR_CODES, DocumentRejected, validateProjectDocument, type CommitContext, type DocumentError, type Registries, type ValidateOptions, type ValidationResult,
} from "../../src/index.ts";

export const NOW = 1_800_000_000_000;
export const SECOND = 120_000;
/** A reproducible id source. */
export const ids = (prefix = "n") => { let count = 0; return () => `${prefix}${++count}`; };

/** A small stand-in for the open registries other capabilities own: enough ids and parameters to exercise the validator. */
export const REGISTRIES: Registries = {
  effects: {
    blur: { kind: "effect", params: { intensity: { type: "number", min: 0, max: 100, default: 15, keyframable: true } } },
    "warm-film": { kind: "filter", params: { intensity: { type: "number", min: 0, max: 100, default: 100, keyframable: true } } },
    "cool-film": { kind: "filter", params: { intensity: { type: "number", min: 0, max: 100, default: 100, keyframable: true } } },
  },
  transitions: { dissolve: {} },
  clipAnimations: ["fade-in", "fade-out", "pulse"],
  textAnimations: ["typewriter", "fade", "wave"],
  bubbles: ["speech-round"],
};
export const context = (over: Partial<CommitContext> = {}): CommitContext => ({ now_ms: NOW + 1000, newId: ids(), registries: REGISTRIES, ...over });

export const HASH = (char: string) => char.repeat(64);
export function asset(id: string, type: "video" | "image" | "audio", extra: Record<string, unknown> = {}) {
  return assetRecordSchema.parse({
    id, name: `${id}.${type === "video" ? "mp4" : type === "image" ? "png" : "wav"}`, type, size: 1000, created_ms: NOW,
    ...(type !== "audio" ? { width: 1920, height: 1080 } : {}), ...(type !== "image" ? { duration: 10 * SECOND } : {}),
    ...(type === "video" ? { fps: { numerator: 30, denominator: 1 }, hasAudio: true } : {}), ...extra,
  });
}

/**
 * A project with one asset of each type (`a1` video with a motion track `m1` and a face `f1`, `a2` image, `a3` audio),
 * an overlay track of every type and one audio track. Every scenario test starts from it.
 */
export function studio(): ProjectDocument {
  const doc = createProjectDocument({ id: "p1", mainSceneId: "s1", mainTrackId: "t-main", now_ms: NOW });
  doc.media.assets = [
    asset("a1", "video", { motionTracks: [{ id: "m1", name: "Subject", shape: "rectangle", sourceStart: 0, sourceEnd: 5 * SECOND, dataHash: HASH("d") }], faces: [{ id: "f1", firstSeen: 0 }] }),
    asset("a2", "image"), asset("a3", "audio"),
  ];
  const scene = doc.scenes[0];
  scene.tracks.overlay = [
    createTrack("video", { id: "t-video", name: "Video" }), createTrack("text", { id: "t-text", name: "Text" }),
    createTrack("graphic", { id: "t-graphic", name: "Graphic" }), createTrack("effect", { id: "t-effect", name: "Effect" }),
    createTrack("adjustment", { id: "t-adjust", name: "Adjustment" }),
  ] as Track[];
  scene.tracks.audio = [createTrack("audio", { id: "t-audio", name: "Audio" })] as Track[];
  return doc;
}

type Fields = Record<string, unknown>;
const at = (id: string, start: number, seconds: number) => ({ id, name: id, startTime: start * SECOND, duration: seconds * SECOND });
export const video = (id: string, start = 0, seconds = 2, extra: Fields = {}) => createElement("video", { ...at(id, start, seconds), mediaId: "a1", sourceDuration: seconds * SECOND, ...extra });
export const image = (id: string, start = 0, seconds = 2, extra: Fields = {}) => createElement("image", { ...at(id, start, seconds), mediaId: "a2", ...extra });
export const audio = (id: string, start = 0, seconds = 2, extra: Fields = {}) => createElement("audio", { ...at(id, start, seconds), mediaId: "a3", sourceType: "upload", sourceDuration: seconds * SECOND, ...extra });
export const text = (id: string, start = 0, seconds = 2, extra: Fields = {}) => createElement("text", { ...at(id, start, seconds), ...extra });
export const sticker = (id: string, start = 0, seconds = 2, extra: Fields = {}) => createElement("sticker", { ...at(id, start, seconds), stickerId: "flags:JP", ...extra });
export const shape = (id: string, definitionId: string, start = 0, seconds = 2, extra: Fields = {}) => createElement("graphic", { ...at(id, start, seconds), definitionId, ...extra });

/** A copy of the document with elements added to a track (by id, or `main`). Elements may be raw objects to build invalid documents. */
export function put(doc: ProjectDocument, trackId: string, ...elements: unknown[]): ProjectDocument {
  const next = clone(doc);
  const scene = next.scenes.find((candidate) => [candidate.tracks.main, ...candidate.tracks.overlay, ...candidate.tracks.audio].some((track) => track.id === trackId || trackId === "main"))!;
  const track = trackId === "main" ? scene.tracks.main : [scene.tracks.main, ...scene.tracks.overlay, ...scene.tracks.audio].find((candidate) => candidate.id === trackId)!;
  (track.elements as unknown[]).push(...clone(elements));
  (track.elements as TimelineElement[]).sort((a, b) => a.startTime - b.startTime || compareIds(a.id, b.id));
  return next;
}
/** A copy of the document changed in place by `mutate`; for building documents a command would never write. */
export function tweak(doc: ProjectDocument, mutate: (draft: any) => void): ProjectDocument {
  const next = clone(doc);
  mutate(next);
  return next;
}
export const element = (doc: ProjectDocument, id: string): any => {
  for (const scene of doc.scenes) for (const track of [scene.tracks.main, ...scene.tracks.overlay, ...scene.tracks.audio]) {
    const found = (track.elements as TimelineElement[]).find((candidate) => candidate.id === id);
    if (found) return found;
  }
  throw new Error(`no element ${id}`);
};
export const track = (doc: ProjectDocument, id: string): any => doc.scenes.flatMap((scene) => [scene.tracks.main, ...scene.tracks.overlay, ...scene.tracks.audio]).find((candidate) => candidate.id === id)!;

const KNOWN = new Set<string>(DOCUMENT_ERROR_CODES);
/** Validates with the test registries and asserts that every code emitted is a code of the catalogue. */
export function validate(doc: unknown, options: ValidateOptions = {}): ValidationResult {
  const result = validateProjectDocument(doc, { registries: REGISTRIES, ...options });
  for (const finding of [...result.errors, ...result.warnings]) assert.ok(KNOWN.has(finding.code), `"${finding.code}" is not in catalog.md §14`);
  return result;
}
export const codes = (result: ValidationResult): string[] => result.errors.map((error) => error.code);
export function assertValid(doc: unknown, options: ValidateOptions = {}): ValidationResult {
  const result = validate(doc, options);
  assert.deepEqual(result.errors, [], "the document validates");
  return result;
}
/** Asserts that validation fails with `code` (optionally at a path ending in `pathEnd`) and returns the finding. */
export function assertFails(doc: unknown, code: string, pathEnd?: string, options: ValidateOptions = {}): DocumentError {
  const result = validate(doc, options);
  const found = result.errors.find((error) => error.code === code && (pathEnd === undefined || error.path.endsWith(pathEnd)));
  assert.ok(found, `expected ${code}${pathEnd ? ` at …${pathEnd}` : ""}, got ${JSON.stringify(result.errors.map((error) => `${error.code} ${error.path}`))}`);
  assert.equal(result.ok, false);
  return found;
}
/** Runs a command that must be rejected and returns its findings; the caller checks that the document is unchanged. */
export function rejected(run: () => unknown, code?: string): DocumentError[] {
  try { run(); } catch (error) {
    assert.ok(error instanceof DocumentRejected, `expected DocumentRejected, got ${String(error)}`);
    if (code) assert.ok(error.errors.some((entry) => entry.code === code), `expected ${code}, got ${error.errors.map((entry) => `${entry.code} ${entry.path}`).join(", ")}`);
    return error.errors;
  }
  assert.fail("the command was expected to be rejected");
}
