import { StorageError, type ByteSource, type CacheKey, type StoragePort } from "@jagentchill/storage";
import { LIBRARY_METHODS } from "./library-bridge.ts";

type Reply<T> = { value: T } | { error: { code: string; message: string; kind?: string; details?: Record<string, unknown> } };
/** The `library` group of the preload bridge, as the storage client uses it. */
export type LibraryBridge = {
  call(method: string, args: unknown[]): Promise<Reply<unknown>>;
  readRange(method: string, args: unknown[], range: { start: number; end: number }): Promise<Reply<Uint8Array>>;
  uploadOpen(): Promise<string>;
  uploadWrite(id: string, bytes: Uint8Array): Promise<Reply<void>>;
  uploadAbort(id: string): Promise<void>;
  release(id: string): Promise<void>;
};
export const BRIDGE_CHUNK_BYTES = 1024 * 1024;

function unwrap<T>(reply: Reply<T>): T {
  if ("value" in reply) return reply.value;
  // The same error types as on every platform: `NotFound`, `QuotaExceeded`, `Corrupt`, `Unavailable`.
  if (reply.error.code === "STORAGE") throw new StorageError((reply.error.kind as StorageError["kind"]) ?? "Unavailable", reply.error.message, reply.error.details);
  throw new StorageError("Unavailable", reply.error.message, { reason: reply.error.code });
}

/**
 * The storage port of the desktop renderer. Every operation is the operation of the same name of the store in the
 * main process, named by ids; bytes travel in pieces of 1 MiB, so that a large media file is never held whole on
 * either side of the bridge.
 */
export function createBridgeStorage(bridge: LibraryBridge): StoragePort {
  const call = async (method: string, args: unknown[]) => unwrap(await bridge.call(method, args));
  async function* read(method: string, args: unknown[], range: { start?: number; end?: number } = {}): AsyncGenerator<Uint8Array> {
    let position = range.start ?? 0;
    const end = range.end ?? Number.MAX_SAFE_INTEGER;
    while (position < end) {
      const want = Math.min(BRIDGE_CHUNK_BYTES, end - position);
      const chunk = unwrap(await bridge.readRange(method, args, { start: position, end: position + want }));
      if (chunk.length > 0) yield chunk;
      // A short piece is the end of the file.
      if (chunk.length < want) return;
      position += chunk.length;
    }
  }
  async function upload(source: ByteSource): Promise<{ upload: string }> {
    const id = await bridge.uploadOpen();
    try {
      for await (const part of source) for (let offset = 0; offset < part.length; offset += BRIDGE_CHUNK_BYTES) unwrap(await bridge.uploadWrite(id, part.subarray(offset, Math.min(part.length, offset + BRIDGE_CHUNK_BYTES))));
    } catch (error) { await bridge.uploadAbort(id).catch(() => undefined); throw error; }
    return { upload: id };
  }
  const cache = {
    put: async (key: CacheKey, data: Uint8Array | ByteSource, options?: { projectId?: string }) =>
      (data instanceof Uint8Array ? call("cache.put", [key, data, options]) : call("cache.putStream", [key, await upload(data), options])) as Promise<number>,
    stream: (key: CacheKey, range?: { start?: number; end?: number }) => read("cache.stream", [key], range),
    /** Entries in use are held in the main process until the returned function runs. */
    hold(keys: CacheKey[]): () => void {
      const held = call("cache.hold", [keys]).catch(() => null);
      return () => { void held.then((id) => (typeof id === "string" ? bridge.release(id) : undefined)); };
    },
  } as Record<string, unknown>;
  for (const method of Object.keys(LIBRARY_METHODS).filter((name) => name.startsWith("cache."))) {
    const name = method.slice(6);
    if (!(name in cache) && name !== "putStream") cache[name] = (...args: unknown[]) => call(method, args);
  }
  const port = {
    platform: "desktop" as const, cache,
    writeMediaStream: async (projectId: string, assetId: string, source: ByteSource, options?: unknown) => call("writeMediaStream", [projectId, assetId, await upload(source), options]),
    readMediaStream: (projectId: string, assetId: string, range?: { start?: number; end?: number }) => read("readMediaStream", [projectId, assetId], range),
  } as Record<string, unknown>;
  for (const method of Object.keys(LIBRARY_METHODS).filter((name) => !name.includes("."))) {
    if (!(method in port)) port[method] = (...args: unknown[]) => call(method, args);
  }
  return port as unknown as StoragePort;
}
