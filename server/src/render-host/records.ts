import { RECORD_HEADER_BYTES, parseRecordHeader } from "../../../packages/render/src/surface/host-protocol.ts";

export class RenderRecordReader {
  private pending = new Uint8Array(0);
  push(chunk: Uint8Array): { kind: "videoFrame" | "still" | "thumbnail" | "exportChunk"; sequence: number; payload: Uint8Array }[] {
    const joined = new Uint8Array(this.pending.length + chunk.length);
    joined.set(this.pending); joined.set(chunk, this.pending.length);
    const output: { kind: "videoFrame" | "still" | "thumbnail" | "exportChunk"; sequence: number; payload: Uint8Array }[] = [];
    let offset = 0;
    while (joined.length - offset >= RECORD_HEADER_BYTES) {
      const parsed = parseRecordHeader(joined.subarray(offset, offset + RECORD_HEADER_BYTES));
      const end = offset + RECORD_HEADER_BYTES + parsed.payloadLength;
      if (end > joined.length) break;
      output.push({ ...parsed, payload: joined.slice(offset + RECORD_HEADER_BYTES, end) });
      offset = end;
    }
    this.pending = joined.slice(offset);
    return output;
  }
}
