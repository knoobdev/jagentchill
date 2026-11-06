import { ProbeError } from "../probe.ts";
import { inlineMediaEngine, type EngineRequest, type EngineResponse } from "./client.ts";

/** Entry of the dedicated media worker: `new Worker(url, { type: "module" })`, driven by `workerMediaEngine`. */
const engine = inlineMediaEngine();
const scope = self as unknown as { postMessage(message: EngineResponse, transfer?: Transferable[]): void; addEventListener(type: "message", listener: (event: MessageEvent<EngineRequest>) => void): void };
const PROGRESS_ARG: Record<string, number> = { hash: 1, waveform: 1, proxy: 3 };
/** Buffers handed back without copying. */
function transferables(value: unknown): Transferable[] {
  const found: Transferable[] = [];
  const visit = (entry: unknown, depth: number): void => {
    if (entry instanceof Uint8Array || entry instanceof Int8Array) { if (entry.byteOffset === 0 && entry.byteLength === entry.buffer.byteLength && !found.includes(entry.buffer as ArrayBuffer)) found.push(entry.buffer as ArrayBuffer); }
    else if (depth < 4 && Array.isArray(entry)) for (const item of entry) visit(item, depth + 1);
    else if (depth < 4 && entry !== null && typeof entry === "object" && !(entry instanceof Blob)) for (const item of Object.values(entry)) visit(item, depth + 1);
  };
  visit(value, 0);
  return found;
}
scope.addEventListener("message", (event) => {
  const { id, op, args } = event.data, slot = PROGRESS_ARG[op];
  const params = slot !== undefined ? args.map((arg, index) => (index === slot ? (arg ? (value: number) => scope.postMessage({ id, type: "progress", value }) : undefined) : arg)) : args;
  (engine[op] as (...parameters: unknown[]) => Promise<unknown>)(...params).then(
    (value) => scope.postMessage({ id, type: "result", value }, transferables(value)),
    (error: unknown) => scope.postMessage({ id, type: "error", name: error instanceof Error ? error.name : "Error", message: error instanceof Error ? error.message : String(error), ...(error instanceof ProbeError ? { fileName: error.fileName } : {}) }),
  );
});
