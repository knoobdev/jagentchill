import test from "node:test";
import assert from "node:assert/strict";
import { plainImportFailure, runNativeImportQueue } from "./native-import-queue.ts";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("native import queue stops a cancelled file and marks later files cancelled", async () => {
  const controller = new AbortController(), states: string[] = [];
  const pending = runNativeImportQueue({
    files: [{ id: "a", name: "a.mov" }, { id: "b", name: "b.mov" }],
    transport: async (_file, signal) => new Promise<string>((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true })),
    signal: controller.signal, shouldPause: () => false, onState: (_id, state) => states.push(state), onProgress() {},
  });
  await tick(); controller.abort();
  assert.deepEqual(await pending, [{ id: "a", cancelled: true }, { id: "b", cancelled: true }]);
  assert.deepEqual(states, ["uploading", "cancelled", "cancelled"]);
});

test("failed native upload can be retried with the fake host transport", async () => {
  let attempts = 0; const states: string[] = [];
  const first = await runNativeImportQueue({ files: [{ id: "photo", name: "photo.jpg" }], signal: new AbortController().signal, shouldPause: () => false,
    transport: async () => { attempts++; throw new Error("host unavailable"); }, onState: (_id, state) => states.push(state), onProgress() {} });
  assert.deepEqual(first, [{ id: "photo", error: "host unavailable" }]);
  const retry = await runNativeImportQueue({ files: [{ id: "photo", name: "photo.jpg" }], signal: new AbortController().signal, shouldPause: () => false,
    transport: async () => { attempts++; return { assetId: "asset-1" }; }, onState: (_id, state) => states.push(state), onProgress() {} });
  assert.deepEqual(retry, [{ id: "photo", result: { assetId: "asset-1" } }]);
  assert.equal(attempts, 2);
  assert.deepEqual(states, ["uploading", "failed", "uploading", "done"]);
});

test("background pause keeps the current item resumable and a foreground call completes it", async () => {
  let paused = false, acknowledged = 0, first = true;
  const controller = new AbortController(), states: string[] = [];
  const task = runNativeImportQueue({ files: [{ id: "video", name: "clip.mov" }], signal: controller.signal, shouldPause: () => paused,
    transport: async (_file, signal, progress) => {
      if (first) {
        first = false; acknowledged = 1; progress("upload", 1, 4);
        await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("paused")), { once: true }));
      }
      acknowledged = 4; progress("upload", acknowledged, 4); return "registered";
    }, onState: (_id, state) => states.push(state), onProgress() {} });
  await tick(); paused = true; controller.abort();
  assert.deepEqual(await task, [{ id: "video", paused: true }]);
  const resumed = await runNativeImportQueue({ files: [{ id: "video", name: "clip.mov" }], signal: new AbortController().signal, shouldPause: () => false,
    transport: async (_file, _signal, progress) => { progress("upload", acknowledged, 4); return "registered"; }, onState: (_id, state) => states.push(state), onProgress() {} });
  assert.deepEqual(resumed, [{ id: "video", result: "registered" }]);
  assert.deepEqual(states, ["uploading", "paused", "uploading", "done"]);
});

test("native import failures use plain host, size, and permission wording", () => {
  assert.equal(plainImportFailure(new Error("no host connected")), "No host connected. Connect to your desktop host and retry.");
  assert.equal(plainImportFailure(new Error("ECONNREFUSED")), "Host unreachable. Check the host connection and retry.");
  assert.equal(plainImportFailure(new Error("413 payload too large")), "File too large for this host.");
  assert.equal(plainImportFailure(new Error("permission denied")), "Permission denied. Allow access to this file and retry.");
});
