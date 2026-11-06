import { createReadStream, existsSync, mkdirSync, statSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { RemoteCapabilities } from "../../../packages/app-core/src/export/remote.ts";
import type { Connection, RpcMethod } from "../channel/ws-channel.ts";
import type { RequestAuthenticator } from "../channel/request-auth.ts";
import type { Scope } from "@jagentchill/protocol";
import type { BlobStore } from "../sync/blobs.ts";
import type { DocumentStore } from "../sync/documents.ts";
import { ProtocolError } from "../errors.ts";

export type RemoteExportSettings = Record<string, unknown>;
export type RemoteExportProgress = { stage: string; framesDone: number; frameCount: number; encodedBytes: number };
/** Adapter consumed by the export queue. The Electron render host supplies this in production. */
export type RemoteExportRenderer = {
  kind: "render-host" | "test-fake";
  available(): boolean;
  capabilities(): RemoteCapabilities | Promise<RemoteCapabilities>;
  start(input: { jobId: string; projectId: string; revision: number; document: Record<string, any>; settings: RemoteExportSettings; request: Record<string, any>; outputPath: string; progress(value: RemoteExportProgress): void }): Promise<void>;
  cancel(jobId: string): Promise<void> | void;
};
export const remoteExportFeatures = (renderer?: Pick<RemoteExportRenderer, "kind" | "available">): Record<string, boolean> =>
  renderer?.kind === "render-host" && renderer.available() ? { "remote-export": true } : {};

type RemoteJob = {
  jobId: string; kind: "export.remote"; state: "queued" | "running" | "succeeded" | "failed" | "cancelled"; stage?: string;
  framesDone: number; frameCount: number; encodedBytes: number; createdBy: { kind: "device"; id: string }; created_ms: number;
  started_ms?: number; finished_ms?: number; output?: { fileName: string; mime: string; size: number; sha256: string }; error?: { code: string; message: string };
};
const EXPORT_SCOPE: Scope = "jagentchill.export.run";
const ROUTE = /^\/jagentchill\/v1\/exports\/([0-9a-f-]{36})\/file$/;
const bad = () => new ProtocolError("INVALID_PARAMS", "The export request is invalid.");

/** Durable host exports and their event stream. Renderer callbacks never cross the RPC boundary. */
export function createRemoteExportService(deps: { db: DatabaseSync; now: () => number; dataDir: string; blobs: BlobStore; documents: DocumentStore; auth: RequestAuthenticator; renderer?: RemoteExportRenderer; jobs: { subscribe(jobId: string, connection: Connection): void; unsubscribe(jobId: string, connection: Connection): void; publish(jobId: string, event: string, payload: unknown): void } }) {
  const { db, now, blobs, documents } = deps;
  const dir = join(deps.dataDir, "exports"); mkdirSync(dir, { recursive: true, mode: 0o700 });
  const cancelled = new Set<string>();
  const activeRuns = new Map<string, Promise<void>>();
  let closed = false;
  let closing: Promise<void> | undefined;
  const rows = () => db.prepare("SELECT * FROM media_jobs WHERE kind = 'export.remote' ORDER BY created_ms DESC").all() as any[];
  const row = (id: string) => db.prepare("SELECT * FROM media_jobs WHERE kind = 'export.remote' AND job_id = ?").get(id) as any;
  const toJob = (entry: any): RemoteJob => ({
    jobId: entry.job_id, kind: "export.remote", state: entry.cancelled ? "cancelled" : entry.state, ...(entry.stage ? { stage: entry.stage } : {}),
    framesDone: entry.frames_done, frameCount: entry.frame_count, encodedBytes: entry.encoded_bytes,
    createdBy: JSON.parse(entry.created_by), created_ms: entry.created_ms,
    ...(entry.started_ms ? { started_ms: entry.started_ms } : {}), ...(entry.finished_ms ? { finished_ms: entry.finished_ms } : {}),
    ...(entry.output_sha256 ? { output: { fileName: entry.output_name, mime: entry.output_mime, size: entry.output_size, sha256: entry.output_sha256 } } : {}),
    ...(entry.error ? { error: JSON.parse(entry.error) } : {}),
  });
  const publish = (jobId: string) => {
    const current = row(jobId); if (!current) return;
    const value = toJob(current);
    deps.jobs.publish(jobId, "jagentchill.job.updated", value);
  };
  const patch = (id: string, values: Record<string, unknown>) => {
    const fields = Object.keys(values); db.prepare(`UPDATE media_jobs SET ${fields.map((field) => `${field} = ?`).join(", ")} WHERE kind = 'export.remote' AND job_id = ?`).run(...fields.map((field) => values[field] as string | number | null), id); publish(id);
  };
  // A process restart cannot resume a renderer process that no longer exists.
  db.prepare("UPDATE media_jobs SET state = 'failed', stage = 'failed', error = ?, finished_ms = ? WHERE kind = 'export.remote' AND state IN ('queued','running')")
    .run(JSON.stringify({ code: "export/interrupted", message: "The host restarted before this export finished." }), now());

  async function run(jobId: string): Promise<void> {
    const renderer = deps.renderer;
    if (!renderer?.available()) { patch(jobId, { state: "failed", stage: "failed", error: JSON.stringify({ code: "export/renderer-unavailable", message: "The render host is unavailable." }), finished_ms: now() }); return; }
    const entry = row(jobId), document = documents.head(documents.row({ kind: "project", id: entry.project_id })!) as Record<string, any>;
    const outputPath = join(dir, `${jobId}.mp4`);
    patch(jobId, { state: "running", stage: "preparing", started_ms: now() });
    try {
      const storedRequest = JSON.parse(entry.payload);
      await renderer.start({ jobId, projectId: entry.project_id, revision: entry.revision, document: document as Record<string, any>, settings: storedRequest.settings, request: storedRequest.request ?? {}, outputPath,
        progress: (value) => { if (cancelled.has(jobId)) return; patch(jobId, { stage: value.stage, frames_done: value.framesDone, frame_count: value.frameCount, encoded_bytes: value.encodedBytes }); },
      });
      if (cancelled.has(jobId)) { patch(jobId, { state: "failed", cancelled: 1, stage: "cancelled", finished_ms: now() }); return; }
      if (!existsSync(outputPath)) throw new Error("Renderer finished without writing an output file.");
      const size = statSync(outputPath).size, name = `${String(document.metadata?.name ?? "Export").replace(/[\\/:*?"<>|]/g, "_")}.mp4`;
      const stored = await blobs.putFile(outputPath, { mime: "video/mp4", name, purpose: "exports" });
      db.prepare("UPDATE media_jobs SET state='succeeded', stage='done', frames_done=frame_count, encoded_bytes=?, finished_ms=?, output_sha256=?, output_name=?, output_mime='video/mp4', output_size=? WHERE kind='export.remote' AND job_id=?")
        .run(size, now(), stored.sha256, name, size, jobId); publish(jobId);
    } catch (error) {
      const cancelledJob = cancelled.has(jobId);
      patch(jobId, { state: "failed", cancelled: cancelledJob ? 1 : 0, stage: cancelledJob ? "cancelled" : "failed", error: cancelledJob ? null : JSON.stringify({ code: "export/failed", message: error instanceof Error ? error.message : String(error) }), finished_ms: now() });
    } finally { cancelled.delete(jobId); try { unlinkSync(outputPath); } catch { /* no output was made */ } }
  }
  const methods = new Map<string, RpcMethod>();
  methods.set("jagentchill.export.capabilities", { scope: EXPORT_SCOPE, handle: async () => {
    if (!deps.renderer?.available()) throw new ProtocolError("RENDERER_UNAVAILABLE", "The render host is unavailable.", { httpStatus: 503 });
    return await deps.renderer.capabilities();
  } });
  methods.set("jagentchill.export.create", { scope: EXPORT_SCOPE, handle: async (raw, connection) => {
    if (closed) throw new ProtocolError("UNAVAILABLE", "The host is shutting down.", { httpStatus: 503, retryable: true });
    const p = raw as any;
    if (!p || typeof p.projectId !== "string" || !Number.isInteger(p.revision) || !p.settings || typeof p.settings !== "object" || typeof p.idempotencyKey !== "string" || !p.idempotencyKey.trim()) throw bad();
    if (!deps.renderer?.available()) throw new ProtocolError("RENDERER_UNAVAILABLE", "The render host is unavailable.", { httpStatus: 503 });
    const docRef = { kind: "project" as const, id: p.projectId }, docRow = documents.row(docRef);
    if (!docRow || docRow.head !== p.revision) throw new ProtocolError("CONFLICT", "The project revision changed before export.", { httpStatus: 409, details: { currentRevision: docRow?.head } });
    const duplicate = db.prepare("SELECT result FROM sync_idempotency WHERE device_id=? AND method='jagentchill.export.create' AND key=? AND ts_ms>? ").get(connection.deviceId, p.idempotencyKey, now() - 86_400_000) as { result: string } | undefined;
    if (duplicate) return JSON.parse(duplicate.result);
    const jobId = randomUUID(), created = { jobId, kind: "export.remote", state: "queued", framesDone: 0, frameCount: 0, encodedBytes: 0, createdBy: { kind: "device", id: connection.deviceId }, created_ms: now() };
    db.prepare("INSERT INTO media_jobs (job_id,kind,sha256,variant,state,error,created_ms,finished_ms,progress,project_id,revision,payload,created_by,stage,frames_done,frame_count,encoded_bytes,cancelled) VALUES (?,?,?,?,?,NULL,?,NULL,0,?,?,?,?,?,0,0,0,0)")
      .run(jobId, "export.remote", p.projectId, "export", "queued", created.created_ms, p.projectId, p.revision, JSON.stringify({ settings: p.settings, request: p }), JSON.stringify(created.createdBy), "queued");
    db.prepare("INSERT INTO sync_idempotency (device_id,method,key,result,ts_ms) VALUES (?,?,?,?,?)").run(connection.deviceId, "jagentchill.export.create", p.idempotencyKey, JSON.stringify(created), now());
    publish(jobId);
    const active = run(jobId).finally(() => activeRuns.delete(jobId));
    activeRuns.set(jobId, active);
    void active.catch(() => undefined);
    return created;
  } });
  methods.set("jagentchill.export.get", { scope: EXPORT_SCOPE, handle: (raw) => { const id = (raw as any)?.jobId; const found = id && row(id); if (!found) throw new ProtocolError("NOT_FOUND", "No export job has that id.", { httpStatus: 404 }); return toJob(found); } });
  methods.set("jagentchill.export.list", { scope: EXPORT_SCOPE, handle: () => ({ jobs: rows().map(toJob) }) });
  methods.set("jagentchill.export.cancel", { scope: EXPORT_SCOPE, handle: async (raw) => { const id = (raw as any)?.jobId, found = id && row(id); if (!found) throw new ProtocolError("NOT_FOUND", "No export job has that id.", { httpStatus: 404 }); if (["succeeded", "failed"].includes(found.state)) return toJob(found); cancelled.add(id); await deps.renderer?.cancel(id); if (found.state === "queued") patch(id, { state: "failed", cancelled: 1, stage: "cancelled", finished_ms: now() }); return toJob(row(id)); } });
  methods.set("jagentchill.export.delete", { scope: EXPORT_SCOPE, handle: (raw) => { const id = (raw as any)?.jobId, found = id && row(id); if (!found) throw new ProtocolError("NOT_FOUND", "No export job has that id.", { httpStatus: 404 }); if (["queued", "running"].includes(found.state)) throw new ProtocolError("CONFLICT", "A running export cannot be deleted.", { httpStatus: 409 }); db.prepare("DELETE FROM media_jobs WHERE kind='export.remote' AND job_id=?").run(id); return { jobId: id, deleted: true }; } });
  methods.set("jagentchill.export.subscribe", { scope: EXPORT_SCOPE, handle: (raw, connection) => { const id = (raw as any)?.jobId; if (!id || !row(id)) throw new ProtocolError("NOT_FOUND", "No export job has that id.", { httpStatus: 404 }); deps.jobs.subscribe(id, connection); return toJob(row(id)); } });
  methods.set("jagentchill.export.unsubscribe", { scope: EXPORT_SCOPE, handle: (raw, connection) => { deps.jobs.unsubscribe((raw as any)?.jobId, connection); return { unsubscribed: true }; } });

  async function route(req: IncomingMessage, res: ServerResponse, target: string): Promise<boolean> {
    const match = ROUTE.exec(new URL(target, "http://host.invalid").pathname); if (!match) return false;
    if (req.method !== "GET" && req.method !== "HEAD") throw new ProtocolError("NOT_FOUND", "No such route.", { httpStatus: 404 });
    const deviceId = deps.auth.authenticate({ method: req.method, target, headers: req.headers, body: new Uint8Array() }, EXPORT_SCOPE);
    const job = row(match[1]); if (!job?.output_sha256 || job.state !== "succeeded") throw new ProtocolError("NOT_FOUND", "The export file is not ready.", { httpStatus: 404 });
    const file = blobs.locate(job.output_sha256), range = /^bytes=(\d+)-(\d*)$/.exec(String(req.headers.range ?? ""));
    const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(Number(range[2]), file.size - 1) : file.size - 1;
    if (range && (start > end || start >= file.size)) { res.writeHead(416, { "content-range": `bytes */${file.size}` }); res.end(); return true; }
    res.writeHead(range ? 206 : 200, { "content-type": job.output_mime, "content-length": String(Math.max(0, end - start + 1)), "accept-ranges": "bytes", "cache-control": "private, no-store", "x-jagentchill-sha256": job.output_sha256, "access-control-expose-headers": "content-range, content-length, x-jagentchill-sha256", ...(range ? { "content-range": `bytes ${start}-${end}/${file.size}` } : {}) });
    if (req.method === "HEAD") { res.end(); return true; }
    const stream = createReadStream(file.path, { start, end }); stream.on("error", () => res.destroy()); stream.pipe(res); return true;
  }
  return {
    methods, route,
    close(): Promise<void> {
      if (closing) return closing;
      closed = true;
      closing = (async () => {
        const active = [...activeRuns.entries()];
        for (const [jobId] of active) cancelled.add(jobId);
        await Promise.all(active.map(async ([jobId]) => { try { await deps.renderer?.cancel(jobId); } catch { /* the render host may already be stopping */ } }));
        await Promise.all(active.map(([, task]) => task));
      })();
      return closing;
    },
  };
}
