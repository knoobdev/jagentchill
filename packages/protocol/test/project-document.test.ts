import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CANVAS_PRESETS, createElement, createProjectDocument, createTrack, findUnknownFields, projectDocumentSchema, projectDuration, PROJECT_SCHEMA_VERSION,
  TICKS_PER_SECOND,
} from "../src/index.ts";

const fresh = (over = {}) => createProjectDocument({ id: "p1", mainSceneId: "s1", mainTrackId: "t1", now_ms: 1_800_000_000_000, ...over });

test("a new project has the factory defaults and one main scene with a main video track", () => {
  const doc = fresh();
  assert.equal(doc.format, "jagentchill.project");
  assert.equal(doc.schemaVersion, PROJECT_SCHEMA_VERSION);
  assert.equal(TICKS_PER_SECOND, 120_000);
  assert.equal(doc.metadata.name, "New project");
  assert.deepEqual(doc.settings.canvasSize, { width: 1920, height: 1080 });
  assert.deepEqual(doc.settings.fps, { numerator: 30, denominator: 1 });
  assert.deepEqual(doc.settings.background, { kind: "color", color: "#000000" });
  assert.equal(doc.settings.canvasSizeMode, "preset");
  assert.equal(doc.settings.adoptCanvasFromFirstMedia, true);
  assert.equal(doc.scenes.length, 1);
  assert.equal(doc.scenes[0].name, "Main scene");
  assert.equal(doc.scenes[0].isMain, true);
  assert.equal(doc.scenes[0].tracks.main.type, "video");
  assert.equal(projectDuration(doc), 0);
  assert.deepEqual(fresh({ phone: true }).settings.canvasSize, { width: 1080, height: 1920 });
  assert.equal(CANVAS_PRESETS.length, 10);
});

test("an explicitly chosen canvas or frame rate disarms adoption from the first media", () => {
  const doc = fresh({ canvasSize: { width: 1080, height: 1080 }, fps: { numerator: 24, denominator: 1 } });
  assert.equal(doc.settings.adoptCanvasFromFirstMedia, false);
  assert.equal(doc.settings.adoptFrameRateFromFirstMedia, false);
});

test("schema 32 documents still open after the timing anchor and template variable migration", () => {
  const legacy = { ...fresh(), schemaVersion: 32, minReaderSchemaVersion: 32, scenes: [{ ...fresh().scenes[0], tracks: { ...fresh().scenes[0].tracks, main: { ...fresh().scenes[0].tracks.main, elements: [createElement("video", { id: "e1", name: "clip", startTime: 0, duration: 240_000, mediaId: "a1" })] } } }] };
  const parsed = projectDocumentSchema.parse(legacy);
  assert.equal(parsed.schemaVersion, 32);
  assert.equal("timingAnchor" in parsed.scenes[0].tracks.main.elements[0], false);
  assert.equal(parsed.template, undefined);
});

test("unknown fields survive a parse at every level; invalid documents are refused", () => {
  const doc = { ...fresh(), futureField: { a: 1 } } as any;
  doc.settings.futureSetting = 3;
  doc.scenes[0].tracks.main.elements = [{ ...createElement("video", { id: "e1", name: "clip", startTime: 0, duration: 240_000, mediaId: "a1" }), futureProp: true }];
  const parsed = projectDocumentSchema.parse(doc) as any;
  assert.deepEqual(parsed.futureField, { a: 1 });
  assert.equal(parsed.settings.futureSetting, 3);
  assert.equal(parsed.scenes[0].tracks.main.elements[0].futureProp, true);
  assert.equal(projectDuration(parsed), 240_000);
  assert.deepEqual(findUnknownFields(doc, projectDocumentSchema).sort(), ["futureField", "scenes[0].tracks.main.elements[0].futureProp", "settings.futureSetting"]);

  assert.equal(projectDocumentSchema.safeParse({ ...fresh(), scenes: [] }).success, false);
  const odd = fresh() as any;
  odd.settings.canvasSize = { width: 1921, height: 1080 };
  assert.equal(projectDocumentSchema.safeParse(odd).success, false, "canvas sides are even");
  const fractional = fresh() as any;
  fractional.scenes[0].tracks.main.elements = [{ ...createElement("video", { id: "e1", name: "clip", startTime: 0, duration: 10, mediaId: "a1" }), startTime: 0.5 }];
  assert.equal(projectDocumentSchema.safeParse(fractional).success, false, "ticks are integers");
  const audioMain = fresh() as any;
  audioMain.scenes[0].tracks.main = createTrack("audio", { id: "t1", name: "Main" });
  assert.equal(projectDocumentSchema.safeParse(audioMain).success, false, "the main track is a video track");
});

test("a new element or track writes every defaulted field and no field whose default is absent", () => {
  const video = createElement("video", { id: "e1", name: "clip", startTime: 0, duration: 240_000, mediaId: "a1" }) as any;
  assert.deepEqual(video.transform, { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0 });
  assert.deepEqual(video.crop, { left: 0, top: 0, right: 0, bottom: 0 });
  for (const key of ["retime", "freeze", "adjustments", "cutout", "animations", "chromaKey", "sourceDuration"]) assert.equal(key in video, false, key);
  const audio = createTrack("audio", { id: "t2", name: "Audio" }) as any;
  assert.deepEqual(audio.ducking, { enabled: false, amount: 12, attack: 200, release: 500, mode: "full" });
  assert.equal("hidden" in audio, false);
});
