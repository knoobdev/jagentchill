import assert from "node:assert/strict";
import test from "node:test";
import { MOTION_SCENE_LIMITS, sceneHtmlForRender, validateMotionScene } from "./motion-scene.ts";

test("motion scenes accept the project canvas, duration and frame rate and calculate frame count", () => {
  const result = validateMotionScene({ html: "<!doctype html><html><head></head><body>fixture</body></html>", width: 1280, height: 720, durationSeconds: 2, fps: 24 });
  assert.equal(result.frameCount, 48);
  assert.match(result.sha256, /^[0-9a-f]{64}$/);
});

test("motion scene input limits refuse oversize source, canvas, duration and frame count", () => {
  const good = { html: "<html></html>", width: 1280, height: 720, durationSeconds: 2, fps: 24 };
  assert.throws(() => validateMotionScene({ ...good, html: "x".repeat(MOTION_SCENE_LIMITS.sourceBytes + 1) }), /larger than/);
  assert.throws(() => validateMotionScene({ ...good, width: MOTION_SCENE_LIMITS.width + 1 }), /width/);
  assert.throws(() => validateMotionScene({ ...good, durationSeconds: MOTION_SCENE_LIMITS.durationSeconds + 1 }), /duration/);
  assert.throws(() => validateMotionScene({ ...good, durationSeconds: 30, fps: 60 }), /frames/);
});

test("renderer bootstrap blocks network APIs and injects deterministic timing before scene scripts", () => {
  const html = sceneHtmlForRender("<html><head><title>fixture</title><script>window.sceneReady = true</script></head><body></body></html>");
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /connect-src \'none\'/);
  assert.match(html, /window, 'fetch'/);
  assert.match(html, /window, 'Date'/);
  assert.match(html, /Math\.random =/);
  assert.ok(html.indexOf("window, 'fetch'") < html.indexOf("window.sceneReady"));
  assert.match(html, /__jcApplyTime/);
});
