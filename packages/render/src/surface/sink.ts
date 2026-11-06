import { sha256, toHex } from "@jagentchill/editor-core";
import { ENGINE_BRIDGE_MAX_BYTES, ENGINE_SINK_CHUNK_BYTES } from "@jagentchill/protocol";
import { EngineFailure } from "./errors.ts";

/**
 * The mobile binary return path: a finished file leaves the WebView as an append-only sink stream of numbered
 * chunks, each acknowledged by the native side, at most two in flight, closed with a byte count and a SHA-256.
 */

export const SINK_MAX_IN_FLIGHT = 2;
export const SINK_IDLE_TIMEOUT_MS = 30_000;
/** Raw bytes per `sink.chunk` so that the base64 text stays within one bridge message. */
export const SINK_BASE64_RAW_BYTES = Math.floor((ENGINE_BRIDGE_MAX_BYTES - 1024) / 4) * 3;

const toBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
};
export const fromBase64 = (text: string): Uint8Array => Uint8Array.from(atob(text), (character) => character.charCodeAt(0));

export type SinkTransport = {
  /** `port` on Android, `scheme` on iOS; resolves `false` when the platform refuses the chunk. */
  binary?: (streamId: string, seq: number, bytes: Uint8Array) => Promise<boolean>;
  /** The base64 fallback: emits `sink.chunk`. */
  base64: (streamId: string, seq: number, base64: string) => void;
  closed: (streamId: string, totalBytes: number, sha256: string) => void;
};

/** The engine side: sends a file through the sink with back-pressure. */
export class SinkSender {
  readonly streamId: string;
  private readonly transport: SinkTransport;
  private readonly unacknowledged = new Set<number>();
  private drained: (() => void)[] = [];
  private seq = 0;
  private useBinary: boolean;
  /** Highest number of unacknowledged chunks seen: never above two. */
  maxInFlight = 0;

  constructor(streamId: string, transport: SinkTransport) {
    this.streamId = streamId;
    this.transport = transport;
    this.useBinary = transport.binary !== undefined;
  }

  /** `sink.ack` from the native side: the chunk is durably appended. */
  ack(seq: number): void {
    if (!this.unacknowledged.delete(seq)) return;
    for (const resolve of this.drained.splice(0)) resolve();
  }

  private async until(test: () => boolean): Promise<void> {
    while (!test()) await new Promise<void>((resolve) => this.drained.push(resolve));
  }

  private async send(bytes: Uint8Array): Promise<void> {
    let offset = 0;
    while (offset < bytes.length) {
      const piece = bytes.subarray(offset, offset + (this.useBinary ? ENGINE_SINK_CHUNK_BYTES : SINK_BASE64_RAW_BYTES));
      // Output stops while two chunks are unacknowledged.
      await this.until(() => this.unacknowledged.size < SINK_MAX_IN_FLIGHT);
      const seq = this.seq;
      this.unacknowledged.add(seq);
      this.maxInFlight = Math.max(this.maxInFlight, this.unacknowledged.size);
      if (this.useBinary && !(await this.transport.binary!(this.streamId, seq, piece))) {
        // A refused chunk switches the stream to the base64 path; the same bytes go again in smaller pieces.
        this.unacknowledged.delete(seq);
        this.useBinary = false;
        continue;
      }
      if (!this.useBinary) this.transport.base64(this.streamId, seq, toBase64(piece));
      this.seq++;
      offset += piece.length;
    }
  }

  /** Streams `slices` (read lazily, so the file is never held whole) and closes the stream with its size and hash. */
  async sendAll(slices: AsyncIterable<Uint8Array> | Iterable<Uint8Array>, digest: { update(bytes: Uint8Array): void; hex(): string }): Promise<{ totalBytes: number; sha256: string }> {
    let totalBytes = 0;
    for await (const slice of slices) {
      digest.update(slice);
      totalBytes += slice.length;
      await this.send(slice);
    }
    await this.until(() => this.unacknowledged.size === 0);
    const hash = digest.hex();
    this.transport.closed(this.streamId, totalBytes, hash);
    return { totalBytes, sha256: hash };
  }
}

/** A digest over the whole stream for short files; long files use an incremental one of the platform. */
export function bufferedDigest(): { update(bytes: Uint8Array): void; hex(): string } {
  const parts: Uint8Array[] = [];
  return {
    update: (bytes) => { parts.push(bytes.slice()); },
    hex: () => {
      const all = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
      let offset = 0;
      for (const part of parts) { all.set(part, offset); offset += part.length; }
      return toHex(sha256(all));
    },
  };
}

/**
 * The receiving side of a sink stream, as the native module implements it: chunks arrive in order from 0, each is
 * appended and acknowledged, and the close is verified before the destination is finalised.
 */
export class SinkReceiver {
  private next = 0;
  private total = 0;
  private lastChunk: number;
  private readonly parts: Uint8Array[] = [];
  private state: "open" | "aborted" | "closed" = "open";
  private readonly append: (bytes: Uint8Array) => void;
  private readonly discard: () => void;

  constructor(options: { append: (bytes: Uint8Array) => void; discard: () => void; now_ms: number }) {
    this.append = options.append;
    this.discard = options.discard;
    this.lastChunk = options.now_ms;
  }

  private abort(code: "engine/sink-sequence" | "engine/sink-timeout", message: string): never {
    this.state = "aborted";
    // The partial destination file is deleted; the finalised file inside the engine storage stays.
    this.discard();
    throw new EngineFailure(code, message);
  }

  /** Appends a chunk and returns the acknowledgement. A missing, repeated or out-of-order `seq` aborts the stream. */
  chunk(seq: number, bytes: Uint8Array, now_ms: number): { seq: number; bytes: number } {
    if (this.state !== "open") throw new EngineFailure("engine/sink-sequence", "the stream is not open");
    if (seq !== this.next) this.abort("engine/sink-sequence", `chunk ${seq} arrived where ${this.next} was expected`);
    this.append(bytes);
    this.parts.push(bytes.slice());
    this.next++;
    this.total += bytes.length;
    this.lastChunk = now_ms;
    return { seq, bytes: bytes.length };
  }

  /** In the foreground a stream with no chunk for 30 s is aborted; the timer is suspended in the background. */
  tick(now_ms: number, foreground: boolean): void {
    if (this.state !== "open") return;
    if (!foreground) { this.lastChunk = now_ms; return; }
    if (now_ms - this.lastChunk >= SINK_IDLE_TIMEOUT_MS) this.abort("engine/sink-timeout", "no chunk arrived for 30 s");
  }

  /** Verifies the byte count and the SHA-256 of `sink.closed`; a mismatch fails the copy with `export/write-failed`. */
  close(totalBytes: number, hash: string): void {
    const all = new Uint8Array(this.total);
    let offset = 0;
    for (const part of this.parts) { all.set(part, offset); offset += part.length; }
    if (totalBytes !== this.total || toHex(sha256(all)) !== hash) {
      this.state = "aborted";
      this.discard();
      throw new EngineFailure("export/write-failed", "the copied file does not match the size and hash of the stream");
    }
    this.state = "closed";
  }
}
