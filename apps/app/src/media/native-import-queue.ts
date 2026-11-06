export type NativeImportPhase = "hash" | "upload";
export type NativeImportFile = { id: string; name: string };
export type NativeImportTransport<T extends NativeImportFile, R> = (file: T, signal: AbortSignal, progress: (phase: NativeImportPhase, bytes: number, total: number) => void) => Promise<R>;
export type NativeImportOutcome<R> = { id: string; result: R } | { id: string; error: string } | { id: string; paused: true } | { id: string; cancelled: true };

/** Sequential, resumable upload state machine. A foreground resume calls it again with only pending files. */
export async function runNativeImportQueue<T extends NativeImportFile, R>(input: {
  files: T[]; transport: NativeImportTransport<T, R>; signal: AbortSignal; shouldPause(): boolean;
  onState(id: string, state: "uploading" | "paused" | "failed" | "done" | "cancelled", error?: string): void;
  onProgress(id: string, percent: number): void;
}): Promise<NativeImportOutcome<R>[]> {
  const outcomes: NativeImportOutcome<R>[] = [];
  for (const file of input.files) {
    if (input.signal.aborted) {
      const paused = input.shouldPause(); input.onState(file.id, paused ? "paused" : "cancelled");
      outcomes.push(paused ? { id: file.id, paused: true } : { id: file.id, cancelled: true });
      if (paused) break;
      continue;
    }
    input.onState(file.id, "uploading");
    try {
      const result = await input.transport(file, input.signal, (phase, bytes, total) => {
        const fraction = total ? Math.max(0, Math.min(1, bytes / total)) : 1;
        input.onProgress(file.id, Math.round((phase === "hash" ? fraction * 0.2 : 0.2 + fraction * 0.8) * 100));
      });
      input.onProgress(file.id, 100); input.onState(file.id, "done"); outcomes.push({ id: file.id, result });
    } catch (error) {
      if (input.signal.aborted) {
        const paused = input.shouldPause(); input.onState(file.id, paused ? "paused" : "cancelled");
        outcomes.push(paused ? { id: file.id, paused: true } : { id: file.id, cancelled: true });
        if (paused) break;
      } else {
        const message = error instanceof Error ? error.message : String(error);
        input.onState(file.id, "failed", message); outcomes.push({ id: file.id, error: message });
      }
    }
  }
  return outcomes;
}

export function plainImportFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error), lower = message.toLowerCase();
  if (/no host|not connected|host.*missing/.test(lower)) return "No host connected. Connect to your desktop host and retry.";
  if (/permission|not authorized|forbidden|denied/.test(lower)) return "Permission denied. Allow access to this file and retry.";
  if (/too large|413|maximum.*size|size limit/.test(lower)) return "File too large for this host.";
  if (/network|fetch|timeout|unavailable|offline|connection|econn/.test(lower)) return "Host unreachable. Check the host connection and retry.";
  return message || "Import failed. Retry this file.";
}
