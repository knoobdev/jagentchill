/**
 * The GIF89a encoder of `export-share.GIF export`: 256-colour palettes (one per frame, or one for the whole file),
 * Floyd–Steinberg dithering, LZW, and frames handed to the output one at a time so the file is never held whole.
 * Project code: it needs no platform encoder and runs wherever the engine does.
 */
export type GifOptions = {
  width: number; height: number;
  /** Frames per second; delays are written in GIF's 10 ms units so that their running sum follows the rate. */
  frameRate: number; loop: "forever" | "once" | number; dither: "floyd-steinberg" | "none";
  /** A palette shared by every frame (`buildPalette` over sampled frames); absent for a palette per frame. */
  globalPalette?: Uint8Array;
  /** An XMP packet written as the application extension "XMP DataXMP". */
  xmp?: string;
};
export type GifWriter = { addFrame(rgba: Uint8Array | Uint8ClampedArray): void; finish(): void; frames: number };

import { addToHistogram, buildPalette, newHistogram, PALETTE_BINS as BINS, paletteBin as binOf } from "@jagentchill/editor-core";

const clamp = (value: number) => (value < 0 ? 0 : value > 255 ? 255 : value);
/** Maps a frame onto a palette: palette indexes per pixel, with Floyd–Steinberg error diffusion or the nearest colour alone. */
export function indexFrame(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number, palette: Uint8Array, dither: boolean): Uint8Array {
  const colours = palette.length / 3, cache = new Int16Array(BINS).fill(-1), out = new Uint8Array(width * height);
  const nearest = (r: number, g: number, b: number): number => {
    const bin = binOf(r, g, b);
    if (cache[bin] >= 0) return cache[bin];
    let best = 0, distance = Infinity;
    for (let index = 0; index < colours; index++) {
      const dr = r - palette[index * 3], dg = g - palette[index * 3 + 1], db = b - palette[index * 3 + 2], d = dr * dr * 2 + dg * dg * 4 + db * db * 3;
      if (d < distance) { distance = d; best = index; }
    }
    cache[bin] = best;
    return best;
  };
  if (!dither) {
    for (let pixel = 0, at = 0; pixel < out.length; pixel++, at += 4) out[pixel] = nearest(rgba[at], rgba[at + 1], rgba[at + 2]);
    return out;
  }
  // Two rows of carried error, three channels each, with one column of padding on both sides.
  let current = new Float32Array((width + 2) * 3), next = new Float32Array((width + 2) * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4, carry = (x + 1) * 3;
      const r = clamp(Math.round(rgba[at] + current[carry])), g = clamp(Math.round(rgba[at + 1] + current[carry + 1])), b = clamp(Math.round(rgba[at + 2] + current[carry + 2]));
      const index = nearest(r, g, b);
      out[y * width + x] = index;
      const er = r - palette[index * 3], eg = g - palette[index * 3 + 1], eb = b - palette[index * 3 + 2];
      current[carry + 3] += (er * 7) / 16; current[carry + 4] += (eg * 7) / 16; current[carry + 5] += (eb * 7) / 16;
      next[carry - 3] += (er * 3) / 16; next[carry - 2] += (eg * 3) / 16; next[carry - 1] += (eb * 3) / 16;
      next[carry] += (er * 5) / 16; next[carry + 1] += (eg * 5) / 16; next[carry + 2] += (eb * 5) / 16;
      next[carry + 3] += er / 16; next[carry + 4] += eg / 16; next[carry + 5] += eb / 16;
    }
    const spare = current; current = next; next = spare; next.fill(0);
  }
  return out;
}

/** GIF's variable-length LZW over palette indexes, as data sub-blocks of at most 255 bytes. */
export function lzw(indexes: Uint8Array, minCodeSize: number): Uint8Array {
  const clear = 1 << minCodeSize, end = clear + 1;
  let bytes = new Uint8Array(Math.max(1024, indexes.length >> 1)), length = 0, bits = 0, bitCount = 0;
  const block: number[] = [];
  const push = (value: number) => { if (length === bytes.length) { const grown = new Uint8Array(bytes.length * 2); grown.set(bytes); bytes = grown; } bytes[length++] = value; };
  const flushBlock = () => { if (block.length === 0) return; push(block.length); for (const value of block) push(value); block.length = 0; };
  const emit = (code: number, size: number) => {
    bits |= code << bitCount; bitCount += size;
    while (bitCount >= 8) { block.push(bits & 255); if (block.length === 255) flushBlock(); bits >>>= 8; bitCount -= 8; }
  };
  let table = new Map<number, number>(), codeSize = minCodeSize + 1, nextCode = end + 1;
  emit(clear, codeSize);
  let prefix = indexes[0];
  for (let at = 1; at < indexes.length; at++) {
    const value = indexes[at], key = (prefix << 8) | value, found = table.get(key);
    if (found !== undefined) { prefix = found; continue; }
    emit(prefix, codeSize);
    if (nextCode < 4096) {
      table.set(key, nextCode++);
      if (nextCode - 1 === 1 << codeSize && codeSize < 12) codeSize++;
    } else { emit(clear, codeSize); table = new Map(); codeSize = minCodeSize + 1; nextCode = end + 1; }
    prefix = value;
  }
  emit(prefix, codeSize);
  emit(end, codeSize);
  if (bitCount > 0) { block.push(bits & 255); if (block.length === 255) flushBlock(); }
  flushBlock();
  push(0);
  return bytes.subarray(0, length);
}

const ascii = (text: string) => Uint8Array.from(text, (char) => char.charCodeAt(0));
const u16 = (value: number) => [value & 255, (value >> 8) & 255];
const tableBits = (colours: number) => Math.max(1, Math.ceil(Math.log2(Math.max(2, colours))));
function padded(palette: Uint8Array): Uint8Array {
  const out = new Uint8Array((1 << tableBits(palette.length / 3)) * 3);
  out.set(palette);
  return out;
}
/** `ceil` of the running time in 10 ms units: 15 fps repeats 7, 7, 6 (mean 66.7 ms). */
export const gifFrameDelay = (index: number, frameRate: number): number => Math.ceil(((index + 1) * 100) / frameRate - 1e-9) - Math.ceil((index * 100) / frameRate - 1e-9);

/** Starts a GIF: the header goes out at once, each `addFrame` writes that frame, `finish` writes the trailer. */
export function createGifWriter(options: GifOptions, write: (bytes: Uint8Array) => void): GifWriter {
  const { width, height } = options, global = options.globalPalette ? padded(options.globalPalette) : null;
  const head: number[] = [...ascii("GIF89a"), ...u16(width), ...u16(height), global ? 0xf0 | (tableBits(global.length / 3) - 1) : 0x70, 0, 0];
  write(Uint8Array.from(head));
  if (global) write(global);
  // "Forever" is repeat count 0; a count of n plays n times, which is n − 1 repeats; "once" writes no loop extension.
  if (options.loop !== "once") write(Uint8Array.from([0x21, 0xff, 0x0b, ...ascii("NETSCAPE2.0"), 3, 1, ...u16(options.loop === "forever" ? 0 : Math.max(1, options.loop - 1)), 0]));
  if (options.xmp) {
    const packet = new TextEncoder().encode(options.xmp), trailer = new Uint8Array(258);
    trailer[0] = 1;
    for (let index = 0; index < 256; index++) trailer[index + 1] = 255 - index;
    write(Uint8Array.from([0x21, 0xff, 0x0b, ...ascii("XMP DataXMP")])); write(packet); write(trailer);
  }
  const writer: GifWriter = {
    frames: 0,
    addFrame(rgba) {
      let palette = global;
      if (!palette) { const histogram = newHistogram(); addToHistogram(histogram, rgba); palette = padded(buildPalette(histogram)); }
      const bitsPerPixel = tableBits(palette.length / 3), indexes = indexFrame(rgba, width, height, palette, options.dither === "floyd-steinberg");
      write(Uint8Array.from([0x21, 0xf9, 4, 0x04, ...u16(gifFrameDelay(writer.frames, options.frameRate)), 0, 0, 0x2c, 0, 0, 0, 0, ...u16(width), ...u16(height), global ? 0 : 0x80 | (bitsPerPixel - 1)]));
      if (!global) write(palette);
      const minCodeSize = Math.max(2, bitsPerPixel);
      write(Uint8Array.from([minCodeSize]));
      write(lzw(indexes, minCodeSize));
      writer.frames++;
    },
    finish() { write(Uint8Array.from([0x3b])); },
  };
  return writer;
}
