import test from "node:test";
import assert from "node:assert/strict";
import { cancelHostExport, createHostExportJob, resumeHostFile, watchHostExport } from "./remote-client.ts";
import { exporting } from "@jagentchill/app-core";

test("remote export reads the host's current project revision before creating the job", async () => {
  const calls: { method: string; params: any }[] = [];
  const connection = { call: async (method: string, params: any) => {
    calls.push({ method, params });
    if (method === "jagentchill.sync.subscribe") return { head: 23 };
    return { jobId: "job-1", kind: "export.remote", state: "queued", framesDone: 0, frameCount: 0, encodedBytes: 0 };
  } } as any;
  const job = await createHostExportJob({ connection, projectId: "p-1", settings: { type: "video" } as any, range: { start: 1, end: 4 }, fileName: "cut.mp4", idempotencyKey: "idempotency-123456" });
  assert.equal(job.jobId, "job-1");
  assert.deepEqual(calls, [
    { method: "jagentchill.sync.subscribe", params: { doc: { kind: "project", id: "p-1" } } },
    { method: "jagentchill.export.create", params: { projectId: "p-1", revision: 23, settings: { type: "video" }, range: { start: 1, end: 4 }, fileName: "cut.mp4", idempotencyKey: "idempotency-123456" } },
  ]);
});

test("export job subscription forwards only the matching host job and can be removed", () => {
  let listener: ((event: any) => void) | undefined, removed = false;
  const connection = { on: (next: (event: any) => void) => { listener = next; return () => { removed = true; }; } } as any;
  const updates: any[] = [];
  const off = watchHostExport(connection, "job-1", (job) => updates.push(job));
  listener!({ event: "jagentchill.job.updated", payload: { job: { jobId: "job-2", state: "running" } } });
  listener!({ event: "jagentchill.job.updated", payload: { job: { jobId: "job-1", state: "running", framesDone: 2 } } });
  assert.deepEqual(updates, [{ jobId: "job-1", state: "running", framesDone: 2 }]);
  off(); assert.equal(removed, true);
});

test("server export events drive queued, rendering, and finished client states", () => {
  let listener: ((event: any) => void) | undefined;
  const connection = { on: (next: (event: any) => void) => { listener = next; return () => {}; } } as any;
  const states: { state: string; percent: number; output?: string }[] = [];
  watchHostExport(connection, "job-1", (job) => {
    const row = exporting.hostJobRow(job, { hostName: "test host", projectId: "p" });
    states.push({ state: row.state, percent: row.percent, ...(row.output ? { output: row.output.fileName } : {}) });
  });
  const emit = (job: any) => listener!({ event: "jagentchill.job.updated", payload: { job: { jobId: "job-1", kind: "export.remote", framesDone: 0, frameCount: 10, encodedBytes: 0, createdBy: { kind: "device", id: "phone" }, created_ms: 1, ...job } } });
  emit({ state: "queued", stage: "queued" });
  emit({ state: "running", stage: "rendering", framesDone: 5 });
  emit({ state: "succeeded", stage: "finalising", framesDone: 10, output: { fileName: "cut.mp4", mime: "video/mp4", size: 100, sha256: "a".repeat(64) } });
  assert.deepEqual(states, [
    { state: "queued", percent: 5 },
    { state: "running", percent: 51.5 },
    { state: "succeeded", percent: 100, output: "cut.mp4" },
  ]);
});

test("phone cancellation uses the host export cancel RPC and returns its state", async () => {
  const calls: { method: string; params: unknown }[] = [];
  const connection = { call: async (method: string, params: unknown) => { calls.push({ method, params }); return { jobId: "job-1", state: "cancelled" }; } } as any;
  const result = await cancelHostExport(connection, "job-1");
  assert.equal(result.state, "cancelled");
  assert.deepEqual(calls, [{ method: "jagentchill.export.cancel", params: { jobId: "job-1" } }]);
});

test("host export download resumes from existing bytes and requests bounded signed ranges", async () => {
  const ranges: [number, number][] = [], written: number[] = [], progress: number[] = [];
  await resumeHostFile({ size: 10, offset: 4, chunkBytes: 3, requestRange: async (start, end) => {
    ranges.push([start, end]); return Uint8Array.from({ length: end - start + 1 }, (_, index) => start + index);
  }, write: (bytes) => written.push(...bytes), onProgress: (done) => progress.push(done) });
  assert.deepEqual(ranges, [[4, 6], [7, 9]]);
  assert.deepEqual(written, [4, 5, 6, 7, 8, 9]);
  assert.deepEqual(progress, [4, 7, 10]);
});
