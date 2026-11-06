import type { Rational } from "@jagentchill/protocol";
import type { Detected } from "../detect.ts";
import type { ImportFile, ImportHost } from "../import-pipeline.ts";
import { ProbeError, type ProbeResult } from "../probe.ts";
import type { EncoderSupport, ProxyForm } from "../proxy.ts";
import type { Thumbnail } from "../thumbnail.ts";
import type { WaveformSummary } from "../waveform.ts";
import * as engine from "./engine.ts";

/** The decode-dependent engine as callers use it; the same interface whether it runs inline or in a worker. */
export interface MediaEngine {
  probe(blob: Blob, name: string, mimeType?: string): Promise<engine.Probed | null>;
  hash(blob: Blob, onProgress?: (fraction: number) => void): Promise<string>;
  thumbnail(blob: Blob, probe: ProbeResult): Promise<Thumbnail | null>;
  filmstrip(blob: Blob, times: number[]): Promise<{ time: number; bytes: Uint8Array | null; width: number; height: number }[]>;
  waveform(blob: Blob, onProgress?: (fraction: number) => void): Promise<WaveformSummary>;
  decodeTest(blob: Blob, probe: { duration?: number; fps?: Rational }): Promise<number | undefined>;
  encoderSupport(): Promise<EncoderSupport>;
  proxy(blob: Blob, source: { width: number; height: number; fps: Rational; hasAudio?: boolean }, form: ProxyForm, onProgress?: (fraction: number) => void): Promise<engine.GeneratedProxy>;
  dispose(): void;
}
export type EngineOp = Exclude<keyof MediaEngine, "dispose">;
export type EngineRequest = { id: number; op: EngineOp; args: unknown[] };
export type EngineResponse = { id: number; type: "progress"; value: number } | { id: number; type: "result"; value: unknown } | { id: number; type: "error"; name: string; message: string; fileName?: string };

/** Runs on the calling thread. Used where no worker can be started and by the worker itself. */
export function inlineMediaEngine(): MediaEngine {
  return {
    probe: engine.probeBlob, hash: engine.hashBlob, thumbnail: engine.makeThumbnail, filmstrip: engine.decodeFilmstripFrames, waveform: engine.computeWaveform,
    decodeTest: engine.decodeTest, encoderSupport: engine.encoderSupport,
    proxy: (blob, source, form, onProgress) => engine.generateProxy(blob, source, form, { onProgress }),
    dispose: () => undefined,
  };
}
/** Ops whose last argument is a progress callback, with the argument's position. */
const PROGRESS_ARG: Partial<Record<EngineOp, number>> = { hash: 1, waveform: 1, proxy: 3 };

/**
 * Hashing, probing, thumbnails, waveforms and proxies off the UI thread: every call is posted to a dedicated worker
 * running `worker.ts`. SVG thumbnails are the one exception — rasterising needs a document — and run here.
 */
export function workerMediaEngine(worker: Worker): MediaEngine {
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: unknown) => void; onProgress?: (fraction: number) => void }>();
  let nextId = 1;
  worker.addEventListener("message", (event: MessageEvent<EngineResponse>) => {
    const reply = event.data, call = pending.get(reply.id);
    if (!call) return;
    if (reply.type === "progress") return void call.onProgress?.(reply.value);
    pending.delete(reply.id);
    if (reply.type === "result") call.resolve(reply.value);
    else call.reject(reply.name === "ProbeError" ? new ProbeError(reply.fileName ?? "") : Object.assign(new Error(reply.message), { name: reply.name }));
  });
  worker.addEventListener("error", (event) => {
    for (const call of pending.values()) call.reject(new Error(event.message || "media worker failed"));
    pending.clear();
  });
  const call = <T>(op: EngineOp, args: unknown[]): Promise<T> => new Promise<T>((resolve, reject) => {
    const id = nextId++, slot = PROGRESS_ARG[op];
    const onProgress = slot !== undefined ? (args[slot] as ((fraction: number) => void) | undefined) : undefined;
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject, onProgress });
    worker.postMessage({ id, op, args: slot !== undefined ? args.map((arg, index) => (index === slot ? arg !== undefined : arg)) : args } satisfies EngineRequest);
  });
  return {
    probe: (blob, name, mimeType) => call("probe", [blob, name, mimeType]),
    hash: (blob, onProgress) => call("hash", [blob, onProgress]),
    thumbnail: (blob, probe) => (probe.container === "svg" ? engine.makeThumbnail(blob, probe) : call("thumbnail", [blob, probe])),
    filmstrip: (blob, times) => call("filmstrip", [blob, times]),
    waveform: (blob, onProgress) => call("waveform", [blob, onProgress]),
    decodeTest: (blob, probe) => call("decodeTest", [blob, probe]),
    encoderSupport: () => call("encoderSupport", []),
    proxy: (blob, source, form, onProgress) => call("proxy", [blob, source, form, onProgress]),
    dispose: () => worker.terminate(),
  };
}

const blobOf = (file: ImportFile): Blob => file.blob ?? (() => { throw new Error(`${file.name} has no Blob to decode from`); })();
/** The import pipeline's hashing, probing, thumbnail and decode-test steps, served by a media engine. */
export function engineImportSteps(mediaEngine: MediaEngine): Pick<ImportHost, "hash" | "probe" | "thumbnail" | "decodeTest"> {
  return {
    hash: (file) => mediaEngine.hash(blobOf(file)),
    probe: async (file: ImportFile, _detected: Detected) => {
      const probed = await mediaEngine.probe(blobOf(file), file.name, file.mimeType);
      if (!probed) throw new ProbeError(file.name);
      return probed.probe;
    },
    thumbnail: (file, probe) => mediaEngine.thumbnail(blobOf(file), probe),
    decodeTest: (file, probe) => mediaEngine.decodeTest(blobOf(file), probe),
  };
}
