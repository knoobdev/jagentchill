// The export session's worker: an engine of its own (compositor on an OffscreenCanvas, caches, decoder sessions)
// that the app-side engine drives with the same envelopes as any other surface. The app bundles this file as a
// worker script and hands the engine a factory for it (`createEngineSurface(host, { exportWorker })`).
import { Engine } from "../engine/engine.ts";
import { runDeferredProbes } from "../engine/deferred-probes.ts";
import { EngineDispatcher } from "./dispatcher.ts";

type Scope = { postMessage(message: unknown, transfer?: Transferable[]): void; onmessage: ((event: { data: any }) => void) | null };

/** Serves an engine over a worker's message port. The first message is `{boot: {wasmUrl?}}`; every later one is `{message}`; the worker answers with `{message, buffers?}`. */
export function runEngineWorker(scope: Scope): void {
  let dispatcher: EngineDispatcher | undefined;
  let probing: AbortController | undefined;
  scope.onmessage = (event) => {
    const data = event.data;
    // The deferred probes run here too, off the app's thread: `{probe: {clipUrl?}}` answers `{probe: result | null}`.
    if (data?.probe) {
      probing = new AbortController();
      void runDeferredProbes({ clipUrl: data.probe.clipUrl, signal: probing.signal }).then((result) => scope.postMessage({ probe: result }), () => scope.postMessage({ probe: null }));
      return;
    }
    if (data?.abortProbe) { probing?.abort(); return; }
    if (data?.boot) {
      const engine = new Engine({ wasmUrl: data.boot.wasmUrl, surface: "same-thread", emit: (type, payload, transfer) => dispatcher!.emit(type, payload, transfer) });
      dispatcher = new EngineDispatcher({ handlers: engine.handlers, validate: false, // A transferred buffer travels only if the message names it.
      post: (message, transfer) => scope.postMessage({ message, buffers: transfer }, transfer ?? []) });
      return;
    }
    if (data?.message && dispatcher) void dispatcher.receive(data.message).catch(() => undefined);
  };
}

const scope = globalThis as unknown as Scope & { WorkerGlobalScope?: unknown; document?: unknown };
if (typeof scope.WorkerGlobalScope !== "undefined" && typeof scope.document === "undefined") runEngineWorker(scope);
