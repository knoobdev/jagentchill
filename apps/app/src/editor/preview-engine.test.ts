import test from "node:test";
import assert from "node:assert/strict";
import { createRemotePreview } from "./preview-remote.ts";
import type { EngineEvents, NativeRemote } from "./preview-engine.ts";

const tick = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));
const baseEvents = (): EngineEvents => ({ onState() {}, onTime() {}, onTransport() {}, onEnded() {}, onFrame() {} });

test("remote scrubbing is debounced and stale host frames cannot replace the latest frame", async () => {
  const pending: ((value: any) => void)[] = [], shown: { uri: string; time: number; revision: number }[] = [];
  const remote = { projectId: "project-1", host: {} as any, signer: {} as any, connection: { call: async (method: string) => {
    assert.equal(method, "jagentchill.preview.frame");
    return new Promise((resolve) => pending.push(resolve));
  } } } as NativeRemote;
  const events = { ...baseEvents(), onRemoteFrame: (frame: { uri: string; time: number; revision: number }) => { shown.push(frame); } };
  const preview = createRemotePreview(remote, events, { debounceMs: 1 });
  preview.setDocument({ scenes: [{ id: "scene-a" }] } as any, "scene-a");
  preview.seek(120_000, 240); await tick();
  preview.seek(240_000, 240); await tick();
  assert.equal(pending.length, 2);
  pending[1]({ revision: 7, time: 2, jpeg: "ZnJhbWUy" });
  await tick();
  pending[0]({ revision: 7, time: 1, jpeg: "ZnJhbWUx" });
  await tick();
  assert.equal(shown.length, 1);
  assert.deepEqual(shown[0], { uri: "data:image/jpeg;base64,ZnJhbWUy", time: 240_000, revision: 7 });
  preview.dispose();
});

test("host revision is carried into the cached frame key and the native player callback", async () => {
  const calls: any[] = [], shown: any[] = [];
  const remote = { projectId: "p", host: {} as any, signer: {} as any, connection: { call: async (_method: string, params: any) => { calls.push(params); return { revision: 8, time: params.time, jpeg: "aW1hZ2U=" }; } } } as NativeRemote;
  const preview = createRemotePreview(remote, { ...baseEvents(), onRemoteFrame: (frame: { uri: string; time: number; revision: number }) => { shown.push(frame); } }, { debounceMs: 1 });
  preview.setDocument({ scenes: [{ id: "s" }] } as any, "s");
  preview.seek(360_000, 320); await tick();
  assert.deepEqual(calls, [{ projectId: "p", sceneId: "s", time: 3, width: 320 }]);
  assert.equal(shown[0].revision, 8);
  assert.equal(shown[0].time, 360_000);
  preview.dispose();
});

test("a newly scheduled scrub invalidates an older in-flight reply before the debounce fires", async () => {
  let resolve!: (value: any) => void; const shown: any[] = [];
  const remote = { projectId: "p", host: {} as any, signer: {} as any, connection: { call: async () => new Promise((done) => { resolve = done; }) } } as NativeRemote;
  const preview = createRemotePreview(remote, { ...baseEvents(), onRemoteFrame: (frame: { uri: string; time: number; revision: number }) => { shown.push(frame); } }, { debounceMs: 50 });
  preview.setDocument({ scenes: [{ id: "s" }] } as any, "s");
  preview.seek(120_000, 160); await tick(60);
  preview.seek(240_000, 160);
  resolve({ revision: 2, time: 1, jpeg: "b2xk" }); await tick(2);
  assert.equal(shown.length, 0);
  preview.dispose();
});

test("Play requests the visible range, downloads to the fake player, and reports render progress", async () => {
  const calls: { method: string; params: any }[] = [], progress: any[] = [], playing: any[] = [];
  const remote = { projectId: "p", host: {} as any, signer: {} as any, connection: { call: async (method: string, params: any) => {
    calls.push({ method, params }); return { revision: 12, sha256: "a".repeat(64), size: 100 };
  } } } as NativeRemote;
  const player = { load: async (result: any, duration: number) => { assert.equal(result.size, 100); assert.equal(duration, 4); return "file:///cache/preview.mp4"; } };
  const preview = createRemotePreview(remote, { ...baseEvents(), onRemoteProgress: (state) => { progress.push(state); }, onRemoteVideo: (video) => { playing.push(video); } }, { loadVideo: player.load });
  preview.setDocument({ scenes: [{ id: "s", duration: 600_000, tracks: { main: { elements: [{ startTime: 0, duration: 600_000 }] }, overlay: [], audio: [] } }] } as any, "s");
  preview.play(120_000); await tick(); await tick();
  assert.deepEqual(calls, [{ method: "jagentchill.preview.render", params: { projectId: "p", sceneId: "s", range: { start: 1, end: 5 }, height: 360 } }]);
  assert.deepEqual(progress, [{ done: 0, total: 1 }, { done: 1, total: 1 }]);
  assert.deepEqual(playing, [{ uri: "file:///cache/preview.mp4", revision: 12, duration: 4, startTime: 120_000, endTime: 600_000 }]);
  preview.dispose();
});

test("Play derives the render range from scene tracks when serialized scenes have no duration field", async () => {
  const calls: { method: string; params: any }[] = [];
  const remote = { projectId: "p", host: {} as any, signer: {} as any, connection: { call: async (method: string, params: any) => {
    calls.push({ method, params }); return { revision: 12, sha256: "a".repeat(64), size: 100 };
  } } } as NativeRemote;
  const preview = createRemotePreview(remote, baseEvents(), { loadVideo: async () => "file:///cache/preview.mp4" });
  preview.setDocument({ scenes: [{ id: "s", tracks: { main: { elements: [{ startTime: 0, duration: 600_000 }] }, overlay: [], audio: [] } }] } as any, "s");
  preview.play(0); await tick(); await tick();
  assert.deepEqual(calls, [{ method: "jagentchill.preview.render", params: { projectId: "p", sceneId: "s", range: { start: 0, end: 5 }, height: 360 } }]);
  preview.dispose();
});

test("pausing while the host render downloads prevents stale playback from starting", async () => {
  let finishDownload!: (uri: string) => void; const shown: any[] = [];
  const remote = { projectId: "p", host: {} as any, signer: {} as any, connection: { call: async () => ({ revision: 1, sha256: "b".repeat(64), size: 12 }) } } as NativeRemote;
  const preview = createRemotePreview(remote, { ...baseEvents(), onRemoteVideo: (video) => { shown.push(video); } }, { loadVideo: async () => new Promise((resolve) => { finishDownload = resolve; }) });
  preview.setDocument({ scenes: [{ id: "s", duration: 240_000, tracks: { main: { elements: [{ startTime: 0, duration: 240_000 }] }, overlay: [], audio: [] } }] } as any, "s");
  preview.play(0); await tick(); preview.pause(); finishDownload("file:///cache/stale.mp4"); await tick();
  assert.deepEqual(shown, []);
  preview.dispose();
});

test("host frame failures keep the last frame visible, expose an error, and clear it after retry", async () => {
  let fail = false; const shown: any[] = [], errors: (string | null)[] = [];
  const remote = { projectId: "p", host: {} as any, signer: {} as any, connection: { call: async (_method: string, params: any) => {
    if (fail) throw new Error("Host unreachable");
    return { revision: 3, time: params.time, jpeg: "ZnJhbWU=" };
  } } } as NativeRemote;
  const preview = createRemotePreview(remote, { ...baseEvents(), onRemoteFrame: (frame) => shown.push(frame), onRemoteError: (error) => errors.push(error || null) }, { debounceMs: 1 });
  preview.setDocument({ scenes: [{ id: "s" }] } as any, "s");
  preview.seek(120_000, 320); await tick(); await tick();
  fail = true; preview.seek(240_000, 320); await tick(); await tick();
  assert.equal(shown.length, 1);
  assert.equal(errors.at(-1), "Host unreachable");
  fail = false; preview.seek(240_000, 320); await tick(); await tick();
  assert.equal(shown.length, 2);
  assert.equal(errors.at(-1), null);
  preview.dispose();
});
