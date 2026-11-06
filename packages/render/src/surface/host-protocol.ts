import { ENGINE_HOST_MAX_BYTES } from "@jagentchill/protocol";

/**
 * The stdio protocol between JAgentChill Server and the render host: file descriptor 3 carries envelopes framed by
 * a 4-byte big-endian length; file descriptor 4 carries binary records with a 16-byte header.
 */

export const FRAME_MAGIC = "JCF1";
export const RECORD_KINDS = { videoFrame: 1, still: 2, thumbnail: 3, exportChunk: 4 } as const;
export const RECORD_HEADER_BYTES = 16;
/** Rendered frames the render host may hold unwritten while the pipe is full. */
export const MAX_UNWRITTEN_FRAMES = 4;

const encoder = new TextEncoder(), decoder = new TextDecoder();

/** One envelope as it travels on file descriptor 3. */
export function frameEnvelope(message: unknown): Uint8Array {
  const body = encoder.encode(JSON.stringify(message));
  if (body.length > ENGINE_HOST_MAX_BYTES) throw new RangeError(`an envelope is at most ${ENGINE_HOST_MAX_BYTES} bytes`);
  const out = new Uint8Array(4 + body.length);
  new DataView(out.buffer).setUint32(0, body.length, false);
  out.set(body, 4);
  return out;
}

/** Splits a byte stream of file descriptor 3 back into envelopes; bytes of an incomplete one are kept for the next call. */
export class EnvelopeReader {
  private pending = new Uint8Array(0);
  push(chunk: Uint8Array): unknown[] {
    const joined = new Uint8Array(this.pending.length + chunk.length);
    joined.set(this.pending);
    joined.set(chunk, this.pending.length);
    const out: unknown[] = [];
    let offset = 0;
    while (joined.length - offset >= 4) {
      const length = new DataView(joined.buffer, joined.byteOffset + offset).getUint32(0, false);
      if (length > ENGINE_HOST_MAX_BYTES) throw new RangeError("an envelope is larger than the protocol allows");
      if (joined.length - offset - 4 < length) break;
      out.push(JSON.parse(decoder.decode(joined.subarray(offset + 4, offset + 4 + length))));
      offset += 4 + length;
    }
    this.pending = joined.slice(offset);
    return out;
  }
}

/** The 16-byte header of a binary record: magic, kind, three reserved bytes, sequence number, payload length. */
export function recordHeader(kind: keyof typeof RECORD_KINDS, sequence: number, payloadLength: number): Uint8Array {
  const out = new Uint8Array(RECORD_HEADER_BYTES);
  out.set(encoder.encode(FRAME_MAGIC), 0);
  out[4] = RECORD_KINDS[kind];
  const view = new DataView(out.buffer);
  view.setUint32(8, sequence, false);
  view.setUint32(12, payloadLength, false);
  return out;
}

export function parseRecordHeader(header: Uint8Array): { kind: keyof typeof RECORD_KINDS; sequence: number; payloadLength: number } {
  if (header.length < RECORD_HEADER_BYTES || decoder.decode(header.subarray(0, 4)) !== FRAME_MAGIC) throw new RangeError("not a JCF1 record");
  const kind = (Object.keys(RECORD_KINDS) as (keyof typeof RECORD_KINDS)[]).find((name) => RECORD_KINDS[name] === header[4]);
  if (!kind) throw new RangeError(`unknown record kind ${header[4]}`);
  const view = new DataView(header.buffer, header.byteOffset);
  return { kind, sequence: view.getUint32(8, false), payloadLength: view.getUint32(12, false) };
}

/** Bytes of a raw RGBA video frame record payload. */
export const videoFrameBytes = (width: number, height: number): number => width * height * 4;
/** Bytes of the raw `f32le` interleaved mix the render host writes for a range. */
export const rawMixBytes = (seconds: number, sampleRate: number, channels: number): number => seconds * sampleRate * channels * 4;

/**
 * Writes frames to a pipe that may stop draining: at most four frames wait unwritten, and `write` does not return
 * for a fifth until the pipe has taken one.
 */
export class FramePipe {
  private queued = 0;
  private waiters: (() => void)[] = [];
  /** Highest number of frames held at once. */
  maxQueued = 0;
  private readonly sink: (record: Uint8Array) => Promise<void>;
  private sequence = 0;
  constructor(sink: (record: Uint8Array) => Promise<void>) { this.sink = sink; }

  async write(kind: keyof typeof RECORD_KINDS, payload: Uint8Array): Promise<void> {
    while (this.queued >= MAX_UNWRITTEN_FRAMES) await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.queued++;
    this.maxQueued = Math.max(this.maxQueued, this.queued);
    const record = new Uint8Array(RECORD_HEADER_BYTES + payload.length);
    record.set(recordHeader(kind, this.sequence++, payload.length));
    record.set(payload, RECORD_HEADER_BYTES);
    void this.sink(record).finally(() => { this.queued--; this.waiters.shift()?.(); });
  }
}
