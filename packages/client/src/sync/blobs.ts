import {
  BLOB_CHUNKS_IN_FLIGHT, BLOB_CHUNK_BYTES, BLOB_MAX_BYTES, BLOB_RETRY_DELAYS_MS, SIGNATURE_HEADERS, blobRoutes, bytesToBase64Url, bytesToHex, chunkCount, utf8, utf8Decode,
  type BlobInit, type BlobStatus, type ErrorEnvelope,
} from "@jagentchill/protocol";
import { HostError } from "../errors.ts";
import type { HostRecord } from "../pairing.ts";
import type { DeviceSigner } from "../signer.ts";
import { randomBytes, sha256 } from "@jagentchill/client/crypto";

/** Where the bytes go and how the device waits; injected so that a test can cut the connection and skip the delays. */
export type BlobEnvironment = {
  host: HostRecord; signer: DeviceSigner;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};
export type TransferProgress = { bytes: number; total: number };
export type TransferControl = { signal?: AbortSignal; onProgress?: (progress: TransferProgress) => void; /** Bits per second, or undefined for no limit. */ limit?: () => number | undefined };
/** The transfer was stopped by its owner (pause, cancel, revocation): not a failure, and resumable. */
export class TransferAborted extends Error { constructor() { super("The transfer was stopped."); this.name = "TransferAborted"; } }

/**
 * A transfer limit is kept by the host, on the wire: it reads an upload and writes a download no faster than this
 * header says (bits per second). A limited transfer also sends one chunk at a time.
 */
const rateHeader = (control: TransferControl): Record<string, string> => { const limit = control.limit?.(); return limit ? { "x-jagentchill-rate": String(Math.round(limit)) } : {}; };
export const sha256Hex = async (bytes: Uint8Array): Promise<string> => bytesToHex(await sha256(bytes));
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** One request on the signed HTTP routes. The signature covers the hash of the exact body bytes; no URL carries a credential. */
export async function signedRequest(env: BlobEnvironment, method: string, target: string, body?: Uint8Array, headers: Record<string, string> = {}, signal?: AbortSignal): Promise<Response> {
  const ts = (env.now ?? Date.now)() + env.host.verifiedClockOffset_ms, nonce = bytesToBase64Url(randomBytes(16));
  const signature = await env.signer.signRequest({ gatewayId: env.host.gatewayId, method, target, bodySha256: await sha256Hex(body ?? new Uint8Array()), ts, nonce });
  try {
    return await (env.fetch ?? fetch)(env.host.origin + target, {
      method, body: body as unknown as BodyInit, signal,
      headers: { ...headers, [SIGNATURE_HEADERS.device]: env.signer.deviceId, [SIGNATURE_HEADERS.timestamp]: String(ts), [SIGNATURE_HEADERS.nonce]: nonce, [SIGNATURE_HEADERS.signature]: signature },
    });
  } catch (error) {
    if (signal?.aborted) throw new TransferAborted();
    throw new HostError("GATEWAY_UNREACHABLE", `The host did not answer: ${error instanceof Error ? error.message : String(error)}`, { retryable: true });
  }
}
async function json<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as (T & { error?: ErrorEnvelope }) | null;
  if (!response.ok || !body) {
    if (body?.error) throw HostError.from(body.error);
    throw new HostError("UNAVAILABLE", `The host answered HTTP ${response.status}.`, { retryable: true });
  }
  return body;
}
const encode = (value: unknown) => utf8(JSON.stringify(value));

export const blobStatus = async (env: BlobEnvironment, sha256: string): Promise<BlobStatus> => json(await signedRequest(env, "GET", blobRoutes.status(sha256)));

export type UploadSource = {
  sha256: string; size: number; mime: string; name: string; purpose?: BlobInit["purpose"]; variantOf?: BlobInit["variantOf"];
  /** The bytes `[start, end)` of the file. Only one chunk per request in flight is held in memory. */
  read(start: number, end: number): Promise<Uint8Array>;
};
export type UploadResult = { uploaded: boolean; chunksSent: number; chunksSkipped: number };

/**
 * Uploads a blob in 4 MiB chunks, three in flight. It starts from what the host already holds, so calling it again
 * after any interruption sends only the chunks that are missing. A chunk is retried five times (1, 2, 4, 8, 16 s);
 * a hash mismatch at `complete` restarts the upload once.
 */
export async function uploadBlob(env: BlobEnvironment, source: UploadSource, control: TransferControl = {}): Promise<UploadResult> {
  if (source.size > BLOB_MAX_BYTES) throw new HostError("BLOB_TOO_LARGE", "This file is too large to sync (limit 64 GB)");
  const sleep = env.sleep ?? pause;
  const stop = () => { if (control.signal?.aborted) throw new TransferAborted(); };
  let sent = 0, skipped = 0;
  for (let restart = 0; ; restart++) {
    stop();
    const started = await json<{ exists: boolean; receivedChunks: number[] }>(await signedRequest(env, "POST", blobRoutes.init(source.sha256), encode({
      size: source.size, mime: source.mime || "application/octet-stream", name: source.name, chunkSize: BLOB_CHUNK_BYTES,
      ...(source.purpose ? { purpose: source.purpose } : {}), ...(source.variantOf ? { variantOf: source.variantOf } : {}),
    }), { "content-type": "application/json" }, control.signal));
    if (started.exists) { control.onProgress?.({ bytes: source.size, total: source.size }); return { uploaded: false, chunksSent: sent, chunksSkipped: skipped }; }
    const have = new Set(started.receivedChunks), count = chunkCount(source.size);
    const missing = Array.from({ length: count }, (_, index) => index).filter((index) => !have.has(index) && source.size > 0);
    skipped += have.size;
    let done = Math.min(source.size, have.size * BLOB_CHUNK_BYTES);
    control.onProgress?.({ bytes: done, total: source.size });
    const limited = control.limit?.() !== undefined;
    let failure: unknown;
    const worker = async () => {
      for (;;) {
        const index = missing.shift();
        if (index === undefined || failure) return;
        const start = index * BLOB_CHUNK_BYTES, bytes = await source.read(start, Math.min(source.size, start + BLOB_CHUNK_BYTES)), began = Date.now();
        for (let attempt = 0; ; attempt++) {
          stop();
          try {
            await json(await signedRequest(env, "PUT", blobRoutes.chunk(source.sha256, index), bytes, { "content-type": "application/octet-stream", ...rateHeader(control) }, control.signal));
            break;
          } catch (error) {
            // A refusal that another attempt cannot change ends the transfer; anything else is retried.
            if (error instanceof TransferAborted || (error instanceof HostError && !error.retryable && error.code !== "INTERNAL")) throw error;
            if (attempt >= BLOB_RETRY_DELAYS_MS.length) throw error;
            await sleep(BLOB_RETRY_DELAYS_MS[attempt]);
          }
        }
        sent += 1; done += bytes.length;
        control.onProgress?.({ bytes: Math.min(done, source.size), total: source.size });
        void began;
      }
    };
    await Promise.all(Array.from({ length: limited ? 1 : BLOB_CHUNKS_IN_FLIGHT }, () => worker().catch((error) => { failure ??= error; })));
    if (failure) throw failure;
    stop();
    try {
      await json(await signedRequest(env, "POST", blobRoutes.complete(source.sha256), encode({}), { "content-type": "application/json" }, control.signal));
      return { uploaded: true, chunksSent: sent, chunksSkipped: skipped };
    } catch (error) {
      if (!(error instanceof HostError)) throw error;
      // The host deleted every chunk of a mismatching upload: it is sent once more, then reported.
      if (error.code === "BLOB_HASH_MISMATCH" && restart === 0) continue;
      if (error.code === "BLOB_INCOMPLETE" && restart < 3) continue;
      throw error;
    }
  }
}

/** Where the ranges of a download are kept until the file is whole: a range that is stored is never requested again. */
export type PartStore = { has(index: number): Promise<boolean>; put(index: number, bytes: Uint8Array): Promise<void>; get(index: number): Promise<Uint8Array>; clear(): Promise<void> };
export type DownloadTarget = { sha256: string; variant?: string; size: number; parts: PartStore };

/**
 * Downloads a blob (or a variant) in 4 MiB ranges, three in flight, into the part store. Resolves when every range
 * is stored; ranges stored by an earlier, interrupted run are skipped. The caller assembles and verifies the file.
 */
export async function downloadBlob(env: BlobEnvironment, target: DownloadTarget, control: TransferControl = {}): Promise<{ rangesFetched: number; rangesSkipped: number }> {
  const sleep = env.sleep ?? pause, count = target.size === 0 ? 0 : chunkCount(target.size);
  const route = target.variant && target.variant !== "original" ? blobRoutes.variant(target.sha256, target.variant) : blobRoutes.bytes(target.sha256);
  const missing: number[] = [];
  for (let index = 0; index < count; index++) if (!(await target.parts.has(index))) missing.push(index);
  const skipped = count - missing.length;
  let done = Math.min(target.size, skipped * BLOB_CHUNK_BYTES), fetched = 0, failure: unknown;
  control.onProgress?.({ bytes: done, total: target.size });
  const worker = async () => {
    for (;;) {
      const index = missing.shift();
      if (index === undefined || failure) return;
      const start = index * BLOB_CHUNK_BYTES, end = Math.min(target.size, start + BLOB_CHUNK_BYTES) - 1, began = Date.now();
      let bytes: Uint8Array;
      for (let attempt = 0; ; attempt++) {
        if (control.signal?.aborted) throw new TransferAborted();
        try {
          const response = await signedRequest(env, "GET", route, undefined, { range: `bytes=${start}-${end}`, ...rateHeader(control) }, control.signal);
          if (!response.ok) await json(response);
          bytes = new Uint8Array(await response.arrayBuffer());
          if (bytes.length !== end - start + 1) throw new HostError("UNAVAILABLE", "The host sent a short range.", { retryable: true });
          break;
        } catch (error) {
          if (control.signal?.aborted) throw new TransferAborted();
          if (error instanceof TransferAborted || (error instanceof HostError && !error.retryable && error.code !== "INTERNAL")) throw error;
          if (attempt >= BLOB_RETRY_DELAYS_MS.length) throw error;
          await sleep(BLOB_RETRY_DELAYS_MS[attempt]);
        }
      }
      await target.parts.put(index, bytes);
      fetched += 1; done += bytes.length;
      control.onProgress?.({ bytes: Math.min(done, target.size), total: target.size });
      void began;
    }
  };
  await Promise.all(Array.from({ length: control.limit?.() !== undefined ? 1 : BLOB_CHUNKS_IN_FLIGHT }, () => worker().catch((error) => { failure ??= error; })));
  if (failure) throw failure;
  return { rangesFetched: fetched, rangesSkipped: skipped };
}
/** The stored ranges of a download, in order, for a streamed write that hashes them. */
export async function* assembledParts(target: DownloadTarget): AsyncGenerator<Uint8Array> {
  for (let index = 0; index < (target.size === 0 ? 0 : chunkCount(target.size)); index++) yield await target.parts.get(index);
}

/** Fetches a small blob whole (a snapshot) and checks it against its address. */
export async function fetchVerified(env: BlobEnvironment, sha256: string): Promise<Uint8Array> {
  const response = await signedRequest(env, "GET", blobRoutes.bytes(sha256));
  if (!response.ok) await json(response);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if ((await sha256Hex(bytes)) !== sha256) throw new HostError("BLOB_HASH_MISMATCH", "The downloaded bytes do not match their address.", { retryable: true });
  return bytes;
}

async function pipe(bytes: Uint8Array, transform: { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> }): Promise<Uint8Array> {
  const writer = transform.writable.getWriter();
  void writer.write(bytes).then(() => writer.close()).catch(() => undefined);
  const parts: Uint8Array[] = [];
  let length = 0;
  const reader = transform.readable.getReader();
  for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); length += value.length; }
  const out = new Uint8Array(length);
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}
function gzipStored(bytes: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(bytes.length / 65_535));
  const out = new Uint8Array(10 + bytes.length + blocks * 5 + 8);
  // RFC 1952 header; DEFLATE stored blocks keep the fallback streamable and dependency-free on Hermes.
  out.set([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 255], 0);
  let source = 0, target = 10;
  for (let index = 0; index < blocks; index++) {
    const length = Math.min(65_535, bytes.length - source);
    out[target++] = index === blocks - 1 ? 1 : 0;
    out[target++] = length & 255; out[target++] = length >>> 8;
    const inverse = (~length) & 0xffff;
    out[target++] = inverse & 255; out[target++] = inverse >>> 8;
    out.set(bytes.subarray(source, source + length), target);
    source += length; target += length;
  }
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0);
  }
  const checksum = (~crc) >>> 0, size = bytes.length >>> 0;
  out[target++] = checksum & 255; out[target++] = checksum >>> 8 & 255; out[target++] = checksum >>> 16 & 255; out[target++] = checksum >>> 24;
  out[target++] = size & 255; out[target++] = size >>> 8 & 255; out[target++] = size >>> 16 & 255; out[target] = size >>> 24;
  return out;
}

/** gzip of the canonical JSON of a document: the form of every snapshot. */
export async function gzip(text: string): Promise<Uint8Array> {
  const bytes = utf8(text);
  const Constructor = (globalThis as typeof globalThis & { CompressionStream?: new(format: "gzip") => { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> } }).CompressionStream;
  return Constructor ? pipe(bytes, new Constructor("gzip") as never) : gzipStored(bytes);
}
export const gunzip = async (bytes: Uint8Array): Promise<string> => utf8Decode(await pipe(bytes, new DecompressionStream("gzip") as never));
