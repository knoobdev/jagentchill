import { exporting } from "@jagentchill/app-core";
import type { HostConnection } from "@jagentchill/client";

/** Device side of the host export create contract, separated for fake-RPC tests. */
export async function createHostExportJob(input: { connection: Pick<HostConnection, "call">; projectId: string; settings: exporting.ExportSettings; range: { start: number; end: number }; fileName: string; idempotencyKey: string }): Promise<exporting.RemoteJob> {
  const doc = { kind: "project", id: input.projectId };
  const current = await input.connection.call<{ head: number }>("jagentchill.sync.subscribe", { doc });
  return input.connection.call<exporting.RemoteJob>(exporting.EXPORT_RPC.create, {
    projectId: input.projectId, revision: current.head, settings: input.settings, range: input.range,
    fileName: input.fileName, idempotencyKey: input.idempotencyKey,
  });
}

export function watchHostExport(connection: Pick<HostConnection, "on">, jobId: string, update: (job: exporting.RemoteJob) => void): () => void {
  return connection.on((event) => {
    if (event.event !== "jagentchill.job.updated") return;
    const job = event.payload?.job as exporting.RemoteJob | undefined;
    if (job?.jobId === jobId) update(job);
  });
}

/** Ask the host to cancel its render and return its authoritative job state. */
export function cancelHostExport(connection: Pick<HostConnection, "call">, jobId: string): Promise<exporting.RemoteJob> {
  return connection.call<exporting.RemoteJob>(exporting.EXPORT_RPC.cancel, { jobId });
}

/** Resumes a host file at the byte offset already stored locally, validating every inclusive range. */
export async function resumeHostFile(input: { size: number; offset: number; chunkBytes?: number; requestRange(start: number, end: number): Promise<Uint8Array>; write(bytes: Uint8Array): void; onProgress?(done: number, total: number): void }): Promise<void> {
  let at = Math.max(0, Math.min(input.size, input.offset));
  const chunkBytes = input.chunkBytes ?? 1024 * 1024;
  input.onProgress?.(at, input.size);
  while (at < input.size) {
    const end = Math.min(input.size - 1, at + chunkBytes - 1), bytes = await input.requestRange(at, end);
    if (bytes.length !== end - at + 1) throw new Error("Host export range was incomplete.");
    input.write(bytes); at += bytes.length; input.onProgress?.(at, input.size);
  }
}
