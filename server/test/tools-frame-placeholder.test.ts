// The Gateway in these tests is the FAKE of `harness.ts`; devices are simulated. The server, sync and the tools are real.
import assert from "node:assert/strict";
import { test } from "node:test";
import { S, toolWorld } from "./support/tools.ts";

const pixel = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64");

test("jc_frame_render when a media file of the frame is not on the device: the frame is returned and the answer names the file drawn as a placeholder; a device whose engine refuses is not reported as \"not in time\"", async () => {
  const w = await toolWorld({ harness: { extra: { toolTimings: { frameMs: 120 } } as never } });
  const desktop = await w.h.pair("Desktop", "editor");
  await desktop.call("jagentchill.presence.heartbeat", { deviceType: "desktop", appVisible: true, openDoc: w.doc, mode: "viewing", sceneId: w.project.sceneId, playhead_ticks: 2 * S, supportedSchemaVersion: { project: 32, script: 1, workflow: 1 }, lastActivity_ms: Date.now(), focusedSessionId: w.sessionKey });
  let answer: (request: any) => Record<string, unknown> = () => ({});
  let asked = 0;
  desktop.ws.on("message", (data: { toString(): string }) => {
    const frame = JSON.parse(data.toString());
    if (frame.t !== "evt" || frame.event !== "jagentchill.editor.frame.request") return;
    asked += 1;
    void desktop.call("jagentchill.editor.frame.result", { requestId: frame.payload.requestId, ...answer(frame.payload) });
  });
  const frames = (request: any) => request.times.map((time: number, index: number) => ({ index, mime: "image/jpeg", dataBase64: pixel, time, width: request.width, height: Math.round((request.width * 9) / 16) }));

  // The device drew the frame with a placeholder in place of the file it does not have.
  answer = (request) => ({ frames: frames(request), failed: [], missingAssetIds: [w.project.assets.drone] });
  const first = await w.h.app.tools.call(w.sessionKey, "jc_frame_render", { times: [2 * S] });
  assert.equal(first.envelope.ok, true, JSON.stringify(first.envelope.error));
  assert.equal(first.images.length, 1, "the frame is returned");
  assert.deepEqual((first.envelope.data as any).placeholders, [{ assetId: w.project.assets.drone, name: "drone_dalat_01.mp4", reason: "not_on_device" }]);
  const warning = (first.envelope.warnings as string[]).find((entry) => entry.startsWith("MEDIA_PLACEHOLDER"));
  assert.match(String(warning), /"drone_dalat_01\.mp4"/);
  assert.match(String(warning), /placeholder/);
  assert.match(String(warning), /has not reached the user's device/);
  // Such a frame is not kept: once the file is on the device the same call draws it for real.
  answer = (request) => ({ frames: frames(request), failed: [] });
  const second = await w.ok("jc_frame_render", { times: [2 * S] });
  assert.equal(asked, 2, "the device is asked again");
  assert.equal(second.data.cached, undefined);
  assert.equal(second.data.placeholders, undefined);
  assert.deepEqual(second.warnings.filter((entry: string) => entry.startsWith("MEDIA_PLACEHOLDER")), []);

  // An engine that refused to draw: the agent is told what the device reported, not that it was slow.
  answer = () => ({ frames: [], failed: [0], reason: "media/unavailable: media of the frame is unavailable" });
  const refused = await w.fails("jc_frame_render", { times: [3 * S] });
  assert.equal(refused.code, "RENDERER_UNAVAILABLE");
  assert.doesNotMatch(refused.message, /in time/);
  assert.match(refused.message, /could not draw these frames: media\/unavailable/);
  assert.equal(refused.details.reason, "engine");
  // A device that ran out of time is still told so.
  answer = () => ({ frames: [], failed: [0], reason: "timeout" });
  const late = await w.fails("jc_frame_render", { times: [4 * S] });
  assert.match(late.message, /did not draw these frames in time/);
  w.close();
});

// The owner's screenshot: a contact sheet of 6 moments waited past the runtime's 60 s tool timeout ("MCP error -32001").
test("jc_frame_render never outlives the runtime's tool timeout: a device that does not answer is reported as late within the call budget", async () => {
  const w = await toolWorld({ harness: { extra: { toolTimings: { frameMs: 5000, frameCallMs: 400 } } as never } });
  const desktop = await w.h.pair("Desktop", "editor");
  await desktop.call("jagentchill.presence.heartbeat", { deviceType: "desktop", appVisible: true, openDoc: w.doc, mode: "viewing", sceneId: w.project.sceneId, playhead_ticks: 2 * S, supportedSchemaVersion: { project: 32, script: 1, workflow: 1 }, lastActivity_ms: Date.now(), focusedSessionId: w.sessionKey });
  // The device receives the request and never answers. Without the budget the wait would be 5 s × 14 + 0.5 s = 70.5 s.
  const started = Date.now();
  const late = await w.fails("jc_frame_render", { times: [1 * S, 2 * S, 3 * S, 4 * S, 5 * S, 6 * S], layout: "contact_sheet", width: 540 });
  const took = Date.now() - started;
  assert.equal(late.code, "RENDERER_UNAVAILABLE");
  assert.match(late.message, /did not draw these frames in time/);
  assert.ok(took < 3000, `answered after ${took} ms`);
  w.close();
});
