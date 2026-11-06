import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { Connection, RpcMethod } from "../channel/ws-channel.ts";
import { RateLimiter } from "../channel/rate-limit.ts";
import { ProtocolError } from "../errors.ts";
import type { BlobStore } from "../sync/blobs.ts";
import type { DocumentStore } from "../sync/documents.ts";
import type { RenderHostManager } from "./manager.ts";

type PreviewDeps = { db: DatabaseSync; now: () => number; dataDir: string; renderHost?: RenderHostManager; blobs: BlobStore; documents: DocumentStore };
const integer = (value: unknown, min: number, max: number): value is number => Number.isInteger(value) && Number(value) >= min && Number(value) <= max;
const TICKS_PER_SECOND = 120_000;
const toTicks = (seconds: number) => Math.round(seconds * TICKS_PER_SECOND);

/** Project revision previews use the same isolated Electron render host as export. */
export function createRenderPreviewService(deps: PreviewDeps): { methods: Map<string, RpcMethod> } {
  const frameLimits = new RateLimiter(60, 60_000, deps.now), renderLimits = new RateLimiter(3, 60_000, deps.now);
  const inFlight = new Map<string, Promise<unknown>>();
  const methods = new Map<string, RpcMethod>();
  const requireMediaIfReferenced = (connection: Connection, document: Record<string, any>) => {
    if ((document.media?.assets ?? []).some((asset: any) => typeof asset.contentHash === "string")) {
      if (!connection.scopes().includes("jagentchill.media.read")) throw new ProtocolError("SCOPE_DENIED", "The device lacks the required scope.", { httpStatus: 403, details: { requiredScope: "jagentchill.media.read" } });
    }
  };
  const mediaSources = (document: Record<string, any>) => (document.media?.assets ?? []).flatMap((asset: any) => {
    if (typeof asset.contentHash !== "string") return [];
    const blob = deps.blobs.locate(asset.contentHash);
    return [{ assetId: asset.id, original: `jagentchill-media://blob/${encodeURIComponent(asset.id)}?path=${encodeURIComponent(blob.path)}&mime=${encodeURIComponent(blob.mime)}` }];
  });
  const project = (projectId: unknown) => {
    if (typeof projectId !== "string" || !projectId) throw new ProtocolError("INVALID_PARAMS", "projectId is required.");
    const ref = { kind: "project" as const, id: projectId }, row = deps.documents.row(ref);
    if (!row || row.state !== "active") throw new ProtocolError("NOT_FOUND", "No active synced project has that id.", { httpStatus: 404 });
    return { row, document: deps.documents.head(row) as Record<string, any> };
  };

  methods.set("jagentchill.preview.frame", { scope: "jagentchill.projects.read", handle: async (raw, connection) => {
    const p = raw as any;
    if (!p || !Number.isFinite(p.time) || p.time < 0 || !integer(p.width, 64, 1920) || (p.sceneId !== undefined && typeof p.sceneId !== "string")) throw new ProtocolError("INVALID_PARAMS", "Preview frame parameters are invalid.");
    frameLimits.hit(connection.deviceId);
    if (!deps.renderHost?.available()) throw new ProtocolError("RENDERER_UNAVAILABLE", "The render host is unavailable.", { httpStatus: 503, retryable: true });
    const { row, document } = project(p.projectId); requireMediaIfReferenced(connection, document);
    const sceneId = p.sceneId ?? document.scenes?.find((scene: any) => scene.isMain)?.id;
    const jpeg = await deps.renderHost.renderStill({ document, revision: row.head, sceneId, time: toTicks(p.time), width: p.width, format: "jpeg", mediaSources: mediaSources(document) });
    return { projectId: p.projectId, revision: row.head, sceneId, time: p.time, width: p.width, mime: "image/jpeg", jpeg: Buffer.from(jpeg).toString("base64") };
  } });

  methods.set("jagentchill.preview.render", { scope: "jagentchill.projects.read", handle: async (raw, connection) => {
    const p = raw as any;
    if (!p || !integer(p.height, 90, 480) || (p.sceneId !== undefined && typeof p.sceneId !== "string") || (p.range !== undefined && (!p.range || !Number.isFinite(p.range.start) || !Number.isFinite(p.range.end) || p.range.start < 0 || p.range.end <= p.range.start))) throw new ProtocolError("INVALID_PARAMS", "Preview render parameters are invalid.");
    renderLimits.hit(connection.deviceId);
    if (!deps.renderHost?.available()) throw new ProtocolError("RENDERER_UNAVAILABLE", "The render host is unavailable.", { httpStatus: 503, retryable: true });
    const { row, document } = project(p.projectId); requireMediaIfReferenced(connection, document);
    const sceneId = p.sceneId ?? document.scenes?.find((scene: any) => scene.isMain)?.id;
    const canvas = document.settings?.canvasSize ?? { width: 1920, height: 1080 };
    const width = Math.max(64, Math.round(p.height * canvas.width / canvas.height / 2) * 2);
    const sourceFps = document.settings?.fps;
    const projectFps = typeof sourceFps === "number" ? sourceFps : Number(sourceFps?.numerator ?? 30) / Number(sourceFps?.denominator ?? 1);
    const fps = Math.max(1, Math.min(15, Number.isFinite(projectFps) ? projectFps : 15));
    // The phone preview RPC speaks seconds; the render engine consumes project ticks.
    const range = p.range ? { start: toTicks(p.range.start), end: toTicks(p.range.end) } : undefined;
    const variant = createHash("sha256").update(JSON.stringify({ sceneId, range: range ?? null, height: p.height, width, fps })).digest("hex");
    const cache = deps.db.prepare("SELECT output_sha256, output_size FROM media_jobs WHERE kind='preview.render' AND sha256=? AND variant=? AND revision=? AND state='succeeded' ORDER BY finished_ms DESC LIMIT 1").get(p.projectId, variant, row.head) as { output_sha256: string; output_size: number } | undefined;
    if (cache && deps.blobs.exists(cache.output_sha256)) return { projectId: p.projectId, revision: row.head, sceneId, height: p.height, width, mime: "video/mp4", sha256: cache.output_sha256, size: cache.output_size, cached: true };
    const key = `${p.projectId}:${row.head}:${variant}`;
    const prior = inFlight.get(key);
    if (prior) return prior;
    const task = (async () => {
      const jobId = randomUUID(), dir = join(deps.dataDir, "render-previews"), outputPath = join(dir, `${jobId}.mp4`);
      mkdirSync(dir, { recursive: true });
      deps.db.prepare("INSERT INTO media_jobs (job_id,kind,sha256,variant,state,created_ms,project_id,revision,payload,created_by,stage) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
        .run(jobId, "preview.render", p.projectId, variant, "running", deps.now(), p.projectId, row.head, JSON.stringify({ sceneId, range: range ?? null, height: p.height, width, fps }), JSON.stringify({ kind: "device", id: connection.deviceId }), "rendering");
      try {
        const result = await deps.renderHost!.exportStart({ document, revision: row.head, sceneId, mediaSources: mediaSources(document), outputPath,
          request: { width, height: p.height, frameRate: { numerator: fps, denominator: 1 }, container: "mp4", video: { codec: "avc", bitrate: 900_000, hardwareAcceleration: "prefer-software" }, ...(range ? { range } : {}), includeCaptions: false, allowFontFallback: true },
        });
        const stored = await deps.blobs.putFile(outputPath, { mime: "video/mp4", name: `preview-${p.projectId}-r${row.head}.mp4`, purpose: "media" });
        deps.db.prepare("UPDATE media_jobs SET state='succeeded',stage='done',finished_ms=?,frames_done=?,frame_count=?,encoded_bytes=?,output_sha256=?,output_size=?,output_mime='video/mp4' WHERE job_id=?")
          .run(deps.now(), result.frameCount, result.frameCount, stored.size, stored.sha256, stored.size, jobId);
        return { projectId: p.projectId, revision: row.head, sceneId, height: p.height, width, mime: "video/mp4", sha256: stored.sha256, size: stored.size, cached: false };
      } catch (error) {
        deps.db.prepare("UPDATE media_jobs SET state='failed',stage='failed',finished_ms=?,error=? WHERE job_id=?")
          .run(deps.now(), JSON.stringify({ code: "preview/render-failed", message: error instanceof Error ? error.message : String(error) }), jobId);
        throw error;
      } finally { try { unlinkSync(outputPath); } catch { /* no render file was produced */ } }
    })();
    inFlight.set(key, task);
    try { return await task; } finally { if (inFlight.get(key) === task) inFlight.delete(key); }
  } });
  return { methods };
}
