import assert from "node:assert/strict";
import test from "node:test";
import { TOOL_INDEX, TOOL_MANIFEST } from "@jagentchill/protocol";
import { ALL_TOOLS } from "../src/tools/index.ts";
import { MOTION_SCENE_TOOLS } from "../src/tools/motion-scene.ts";

const fixtureHtml = "<!doctype html><html><body><script>window.__jcSeek=async(seconds)=>{};</script></body></html>";
const tool = MOTION_SCENE_TOOLS[0] as any;

function context(overrides: Record<string, unknown> = {}) {
  const calls: Record<string, unknown[]> = { save: [], render: [], import: [], place: [] };
  return {
    calls,
    value: {
      projectId: "project-1", session: { sessionKey: "session-1" }, dryRun: false,
      doc: { settings: { canvasSize: { width: 1280, height: 720 }, fps: { numerator: 24, denominator: 1 } } },
      activeSceneId: () => "scene-1",
      host: {
        saveMotionScene: (input: unknown) => { calls.save.push(input); return { sourcePath: "motion-scenes/chart.html", sha256: "a".repeat(64) }; },
        renderMotionScene: async (input: unknown) => { calls.render.push(input); return { sourcePath: "motion-scenes/chart.html", outputPath: "motion-scenes/chart.webm", frameCount: 48, bytes: 2048, width: 1280, height: 720, durationSeconds: 2, fps: 24 }; },
        importMedia: async (_session: unknown, _projectId: unknown, source: unknown, fields: unknown) => { calls.import.push(source, fields); return { assetId: "asset-motion", revision: 7 }; },
        stageMotionClip: async (input: unknown) => { calls.place.push(input); return { proposalId: "proposal-1", changeIds: ["change-1"], elementIds: ["element-1"] }; },
      },
      ...overrides,
    } as any,
  };
}

test("jc_motion_scene is registered in the media catalogue and manifest", () => {
  assert.ok(TOOL_INDEX.media.includes("jc_motion_scene"));
  assert.ok(TOOL_MANIFEST.some((entry) => entry.name === "jc_motion_scene" && entry.family === "media"));
  assert.ok(ALL_TOOLS.some((entry) => entry.name === "jc_motion_scene"));
  assert.ok(tool.description.length < 600);
});

test("create and update save inline source under the work folder at the project canvas and frame rate", async () => {
  const ctx = context();
  const created = await tool.handle(ctx.value, { action: "create", name: "chart", html: fixtureHtml, durationSeconds: 2 });
  assert.equal(created.data.sourcePath, "motion-scenes/chart.html");
  assert.equal(ctx.calls.save.length, 1);
  assert.deepEqual(ctx.calls.save[0], { session: ctx.value.session, name: "chart", html: fixtureHtml, width: 1280, height: 720, durationSeconds: 2, fps: 24 });
  const updated = await tool.handle(ctx.value, { action: "update", name: "chart", html: fixtureHtml + "<!-- updated -->", durationSeconds: 2 });
  assert.equal(updated.data.action, "update");
  assert.equal(ctx.calls.save.length, 2);
});

test("render imports the transparent WebM and optionally stages it at the requested scene tick and track", async () => {
  const ctx = context();
  const result = await tool.handle(ctx.value, { action: "render", name: "chart", html: fixtureHtml, durationSeconds: 2, placement: { startSeconds: 3, trackId: "track-overlay" } });
  assert.equal(ctx.calls.render.length, 1);
  assert.equal(ctx.calls.import[0] instanceof Object, true);
  assert.deepEqual(ctx.calls.import[0], { kind: "workspace", path: "motion-scenes/chart.webm" });
  assert.deepEqual(ctx.calls.place[0], { session: ctx.value.session, projectId: "project-1", assetId: "asset-motion", sceneId: "scene-1", start: 360_000, trackId: "track-overlay" });
  assert.equal(result.data.assetId, "asset-motion");
  assert.equal(result.data.frameCount, 48);
  assert.equal(result.data.placement.proposalId, "proposal-1");
  assert.equal(result.proposalId, "proposal-1");
  assert.deepEqual(result.changeIds, ["change-1"]);
});
