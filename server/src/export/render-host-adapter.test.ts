import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_EXPORT_SETTINGS } from "../../../packages/app-core/src/export/settings.ts";
import { createRenderHostRemoteExportRenderer } from "./render-host-adapter.ts";

test("remote export strips the client-only frame count from the renderer range", async () => {
  let request: Record<string, any> | undefined;
  const renderer = createRenderHostRemoteExportRenderer({
    renderHost: { canStart: () => true, exportStart: async (input: any) => { request = input.request; } } as any,
    blobs: () => ({ locate: () => ({ path: "/tmp/unused", mime: "video/mp4" }) }) as any,
  });
  await renderer.start({
    jobId: "job-1", projectId: "project-1", revision: 4,
    document: { settings: { canvasSize: { width: 1920, height: 1080 }, fps: { numerator: 30, denominator: 1 } }, media: { assets: [] } },
    settings: { ...DEFAULT_EXPORT_SETTINGS, target: "host", includeAudio: false },
    request: { range: { start: 0, end: 600_000, frames: 150 } }, outputPath: "/tmp/unused.mp4", progress: () => {},
  });
  assert.deepEqual(request?.range, { start: 0, end: 600_000 });
});
