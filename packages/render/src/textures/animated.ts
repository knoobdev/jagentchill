/**
 * An animated image (GIF, APNG, animated WebP) opened through `ImageDecoder`: the start time of every frame from
 * the file's own frame timing, and any frame decoded on demand.
 */
import { straightBitmap } from "./straight.ts";

type Decoded = { image: VideoFrame; complete: boolean };
type Decoder = {
  tracks: { ready: Promise<void>; selectedTrack: { animated: boolean; frameCount: number } | null };
  completed: Promise<void>;
  decode(options: { frameIndex: number; completeFramesOnly?: boolean }): Promise<Decoded>;
  close(): void;
};
type DecoderClass = { new (init: { data: ArrayBuffer; type: string }): Decoder; isTypeSupported(type: string): Promise<boolean> };

/** The media type of an image file from its first bytes: the one a server sent is not always right. */
function sniff(bytes: Uint8Array, declared: string): string {
  const ascii = (from: number, text: string) => [...text].every((character, index) => bytes[from + index] === character.charCodeAt(0));
  if (ascii(0, "GIF8")) return "image/gif";
  if (bytes[0] === 0x89 && ascii(1, "PNG")) return "image/png";
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return "image/webp";
  return declared;
}

export class AnimatedImage {
  /** Start time of each frame in seconds, and the length of one pass. */
  readonly starts: number[];
  readonly duration: number;
  private readonly decoder: Decoder;
  private chain: Promise<unknown> = Promise.resolve();

  private constructor(decoder: Decoder, starts: number[], duration: number) {
    this.decoder = decoder;
    this.starts = starts;
    this.duration = duration;
  }

  /** Opens a file; `null` when it is a still image, or when this runtime has no `ImageDecoder` for it. */
  static async open(blob: Blob): Promise<AnimatedImage | null> {
    const ImageDecoderClass = (globalThis as { ImageDecoder?: DecoderClass }).ImageDecoder;
    if (!ImageDecoderClass) return null;
    const data = await blob.arrayBuffer();
    const type = sniff(new Uint8Array(data, 0, Math.min(16, data.byteLength)), blob.type);
    if (!/^image\/(gif|png|apng|webp)$/.test(type) || !(await ImageDecoderClass.isTypeSupported(type).catch(() => false))) return null;
    let decoder: Decoder | undefined;
    try {
      decoder = new ImageDecoderClass({ data, type });
      await decoder.tracks.ready;
      await decoder.completed;
      const track = decoder.tracks.selectedTrack;
      if (!track || !track.animated || track.frameCount < 2) { decoder.close(); return null; }
      // The frame timing of the file: every frame is decoded once for its duration and released at once.
      const starts: number[] = [];
      let at = 0;
      for (let index = 0; index < track.frameCount; index++) {
        const { image } = await decoder.decode({ frameIndex: index });
        starts.push(at);
        // A frame without a duration gets the 100 ms browsers give it.
        at += (image.duration ?? 0) > 0 ? image.duration! / 1_000_000 : 0.1;
        image.close();
      }
      return new AnimatedImage(decoder, starts, at);
    } catch {
      decoder?.close();
      return null;
    }
  }

  /** Index of the frame shown at `seconds` into the animation: modulo one pass when looping, the last frame held otherwise. */
  frameAt(seconds: number, loop: boolean): number {
    const last = this.starts.length - 1;
    if (!(seconds > 0)) return 0;
    if (seconds >= this.duration && !loop) return last;
    const time = seconds % this.duration;
    let low = 0, high = last;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (this.starts[middle] <= time + 1e-9) low = middle; else high = middle - 1;
    }
    return low;
  }

  /** Decodes one frame; calls are served one after another, as the decoder requires. */
  frame(index: number): Promise<ImageBitmap> {
    const run = this.chain.then(async () => {
      const { image } = await this.decoder.decode({ frameIndex: index });
      try { return await straightBitmap(image); } finally { image.close(); }
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  close(): void { try { this.decoder.close(); } catch { /* already closed */ } }
}
