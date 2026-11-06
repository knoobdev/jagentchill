import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { test } from "node:test";
import { createRenderPreviewService } from "./preview.ts";

test("phone preview seconds become project ticks for stills and render ranges", async () => {
  const dataDir = ".dev/tmp-w9s-sim-pass7";
  mkdirSync(dataDir, { recursive: true });
  const sceneId = "scene-1";
  const document = { scenes: [{ id: sceneId, isMain: true }], settings: { canvasSize: { width: 1080, height: 1920 }, fps: { numerator: 30, denominator: 1 } }, media: { assets: [] } };
  let stillTime = -1;
  let exportRange: { start: number; end: number } | undefined;
  const db = { prepare: (sql: string) => ({
    get: () => undefined,
    run: (..._args: unknown[]) => undefined,
  }) };
  const renderHost = {
    available: () => true,
    renderStill: async (input: { time: number }) => { stillTime = input.time; return Buffer.from("jpeg"); },
    exportStart: async (input: { request: { range?: { start: number; end: number } }; outputPath: string }) => {
      exportRange = input.request.range;
      return { frameCount: 15, duration: 1, bytes: 10, elapsedMs: 1 };
    },
  };
  const blobs = {
    locate: () => ({ path: "/unused", mime: "video/mp4" }),
    exists: () => false,
    putFile: async () => ({ sha256: "a".repeat(64), size: 10 }),
  };
  const documents = {
    row: () => ({ head: 1, state: "active" }),
    head: () => document,
  };
  const service = createRenderPreviewService({
    db: db as never,
    now: () => 1,
    dataDir,
    renderHost: renderHost as never,
    blobs: blobs as never,
    documents: documents as never,
  });
  const connection = { deviceId: "device-1", scopes: () => ["jagentchill.projects.read"] };
  await service.methods.get("jagentchill.preview.frame")!.handle({ projectId: "project-1", sceneId, time: 2.5, width: 320 }, connection as never);
  assert.equal(stillTime, 300_000);
  await service.methods.get("jagentchill.preview.render")!.handle({ projectId: "project-1", sceneId, range: { start: 1, end: 2.5 }, height: 90 }, connection as never);
  assert.deepEqual(exportRange, { start: 120_000, end: 300_000 });
});
