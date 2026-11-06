import type { MediaFormat } from "./detect.ts";
import { looksLikeSvg } from "./detect.ts";

/**
 * Still-image headers read from the file bytes, without a decoder: size after orientation, rotation, alpha, and for
 * GIF the frame count and total delay. The same code runs in the browser, in a worker, on the host and in tests.
 */
export type ImageInfo = {
  format: MediaFormat;
  /** Pixels after the stored orientation is applied. */
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
  hasAlpha: boolean;
  /** GIF only: more than one frame makes it a video asset. */
  frameCount?: number;
  /** GIF only: sum of the frame delays in seconds. */
  durationSeconds?: number;
};

const u16be = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const u32be = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const u16le = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u24le = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
const u32le = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const tag = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
const ok = (width: number, height: number) => Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0;

/** EXIF orientation 1–8 → clockwise rotation to display the stored picture upright. */
const ORIENTATION_ROTATION: Record<number, 0 | 90 | 180 | 270> = { 1: 0, 2: 0, 3: 180, 4: 180, 5: 90, 6: 90, 7: 270, 8: 270 };

function png(b: Uint8Array): ImageInfo | null {
  if (b.length < 33 || tag(b, 12) !== "IHDR") return null;
  const width = u32be(b, 16), height = u32be(b, 20), colourType = b[25];
  let hasAlpha = colourType === 4 || colourType === 6;
  // A palette or greyscale/RGB picture is transparent when a tRNS chunk precedes the image data.
  for (let offset = 8; !hasAlpha && offset + 12 <= b.length; offset += 12 + u32be(b, offset)) {
    const type = tag(b, offset + 4);
    if (type === "tRNS") hasAlpha = true;
    if (type === "IDAT" || type === "IEND") break;
  }
  return ok(width, height) ? { format: "png", width, height, rotation: 0, hasAlpha } : null;
}

function exifOrientation(b: Uint8Array, start: number, length: number): number {
  if (length < 14 || String.fromCharCode(...b.subarray(start, start + 4)) !== "Exif") return 1;
  const tiff = start + 6, little = b[tiff] === 0x49;
  const r16 = (o: number) => (little ? u16le(b, o) : u16be(b, o)), r32 = (o: number) => (little ? u32le(b, o) : u32be(b, o));
  const ifd = tiff + r32(tiff + 4);
  if (ifd + 2 > start + length) return 1;
  for (let i = 0, count = r16(ifd); i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > start + length) break;
    if (r16(entry) === 0x0112) return r16(entry + 8);
  }
  return 1;
}
function jpeg(b: Uint8Array): ImageInfo | null {
  let orientation = 1;
  for (let offset = 2; offset + 4 <= b.length; ) {
    if (b[offset] !== 0xff) { offset++; continue; }
    const marker = b[offset + 1];
    if (marker === 0xff) { offset++; continue; }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
    const length = u16be(b, offset + 2);
    if (marker === 0xe1) orientation = exifOrientation(b, offset + 4, length - 2) || orientation;
    // SOF0–SOF15 except DHT (C4), JPG (C8) and DAC (CC) carry the frame size.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = u16be(b, offset + 5), width = u16be(b, offset + 7);
      if (!ok(width, height)) return null;
      const rotation = ORIENTATION_ROTATION[orientation] ?? 0, swap = orientation >= 5 && orientation <= 8;
      return { format: "jpeg", width: swap ? height : width, height: swap ? width : height, rotation, hasAlpha: false };
    }
    if (marker === 0xda) break;
    offset += 2 + length;
  }
  return null;
}

function gif(b: Uint8Array): ImageInfo | null {
  if (b.length < 13) return null;
  const width = u16le(b, 6), height = u16le(b, 8);
  let offset = 13 + (b[10] & 0x80 ? 3 * (1 << ((b[10] & 7) + 1)) : 0), frames = 0, hundredths = 0, hasAlpha = false, pendingDelay = 0;
  const skipBlocks = () => { while (offset < b.length && b[offset] !== 0) offset += 1 + b[offset]; offset++; };
  while (offset < b.length) {
    const block = b[offset++];
    if (block === 0x3b) break;
    if (block === 0x21) {
      const label = b[offset++];
      if (label === 0xf9 && b[offset] === 4) {
        if (b[offset + 1] & 1) hasAlpha = true;
        pendingDelay = u16le(b, offset + 2);
      }
      skipBlocks();
    } else if (block === 0x2c) {
      frames++;
      // Browsers play a delay of 0 or 1 hundredth as 100 ms; the duration follows what is displayed.
      hundredths += pendingDelay < 2 ? 10 : pendingDelay; pendingDelay = 0;
      const flags = b[offset + 8];
      offset += 9 + (flags & 0x80 ? 3 * (1 << ((flags & 7) + 1)) : 0) + 1;
      skipBlocks();
    } else break;
  }
  if (!ok(width, height) || frames === 0) return null;
  const durationSeconds = frames > 1 ? hundredths / 100 : 0;
  return { format: "gif", width, height, rotation: 0, hasAlpha, frameCount: frames, durationSeconds };
}

function webp(b: Uint8Array): ImageInfo | null {
  const kind = tag(b, 12);
  if (kind === "VP8X") {
    const width = u24le(b, 24) + 1, height = u24le(b, 27) + 1;
    return ok(width, height) ? { format: "webp", width, height, rotation: 0, hasAlpha: (b[20] & 0x10) !== 0 } : null;
  }
  if (kind === "VP8L" && b[20] === 0x2f) {
    const bits = u32le(b, 21), width = (bits & 0x3fff) + 1, height = ((bits >>> 14) & 0x3fff) + 1;
    return { format: "webp", width, height, rotation: 0, hasAlpha: ((bits >>> 28) & 1) === 1 };
  }
  if (kind === "VP8 " && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
    const width = u16le(b, 26) & 0x3fff, height = u16le(b, 28) & 0x3fff;
    return ok(width, height) ? { format: "webp", width, height, rotation: 0, hasAlpha: false } : null;
  }
  return null;
}

function bmp(b: Uint8Array): ImageInfo | null {
  if (b.length < 30) return null;
  const header = u32le(b, 14);
  const width = header === 12 ? u16le(b, 18) : u32le(b, 18) | 0, height = header === 12 ? u16le(b, 20) : Math.abs(u32le(b, 22) | 0);
  const bits = header === 12 ? u16le(b, 24) : u16le(b, 28);
  // 32-bit bitmaps carry alpha only with a V4/V5 header that declares an alpha mask.
  const hasAlpha = bits === 32 && header >= 56 && b.length >= 70 && u32le(b, 66) !== 0;
  return ok(width, height) ? { format: "bmp", width, height, rotation: 0, hasAlpha } : null;
}

/** AVIF / HEIC: the primary item's `ispe` size, `irot` rotation and an alpha auxiliary item, found in the `meta` box. */
function heif(b: Uint8Array, format: MediaFormat): ImageInfo | null {
  let width = 0, height = 0, rotation = 0 as 0 | 90 | 180 | 270, hasAlpha = false;
  const walk = (start: number, end: number, depth: number): void => {
    for (let offset = start; offset + 8 <= end; ) {
      let size = u32be(b, offset), headerSize = 8;
      const type = tag(b, offset + 4);
      if (size === 1) { size = u32be(b, offset + 8) * 2 ** 32 + u32be(b, offset + 12); headerSize = 16; }
      else if (size === 0) size = end - offset;
      if (size < headerSize) return;
      const bodyStart = offset + headerSize, bodyEnd = Math.min(end, offset + size);
      if (type === "meta") walk(bodyStart + 4, bodyEnd, depth + 1);
      else if (type === "iprp" || type === "ipco") walk(bodyStart, bodyEnd, depth + 1);
      else if (type === "ispe" && bodyStart + 12 <= bodyEnd) {
        const w = u32be(b, bodyStart + 4), h = u32be(b, bodyStart + 8);
        // Several items (thumbnail, tiles, alpha plane) declare a size; the picture is the largest.
        if (w * h > width * height) { width = w; height = h; }
      } else if (type === "irot" && bodyStart < bodyEnd) rotation = ([0, 270, 180, 90] as const)[b[bodyStart] & 3];
      else if (type === "auxC") {
        const urn = new TextDecoder().decode(b.subarray(bodyStart + 4, Math.min(bodyEnd, bodyStart + 80)));
        if (urn.includes("auxid:1") || urn.includes("alpha")) hasAlpha = true;
      }
      if (type === "mdat" && depth === 0 && width > 0) return;
      offset += size;
    }
  };
  walk(0, b.length, 0);
  if (!ok(width, height)) return null;
  const swap = rotation === 90 || rotation === 270;
  return { format, width: swap ? height : width, height: swap ? width : height, rotation, hasAlpha };
}

const SVG_UNITS: Record<string, number> = { "": 1, px: 1, pt: 4 / 3, pc: 16, in: 96, cm: 96 / 2.54, mm: 96 / 25.4 };
function svgLength(value: string | undefined): number | null {
  const match = value?.trim().match(/^([0-9]*\.?[0-9]+(?:e[+-]?[0-9]+)?)(px|pt|pc|in|cm|mm)?$/i);
  return match ? Number(match[1]) * SVG_UNITS[(match[2] ?? "").toLowerCase()] : null;
}
function svg(b: Uint8Array): ImageInfo | null {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(b.subarray(0, 65_536));
  const root = text.match(/<svg\b[^>]*>/i)?.[0];
  if (!root) return null;
  const attribute = (name: string) => root.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"))?.slice(1).find((value) => value !== undefined);
  const box = attribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  let width = svgLength(attribute("width")), height = svgLength(attribute("height"));
  const boxWidth = box && box.length === 4 && box[2] > 0 ? box[2] : null, boxHeight = box && box.length === 4 && box[3] > 0 ? box[3] : null;
  if (width === null && height === null) { width = boxWidth ?? 300; height = boxHeight ?? 150; }
  else if (width === null) width = boxWidth && boxHeight ? (height! * boxWidth) / boxHeight : 300;
  else if (height === null) height = boxWidth && boxHeight ? (width * boxHeight) / boxWidth : 150;
  const w = Math.max(1, Math.round(width)), h = Math.max(1, Math.round(height!));
  return { format: "svg", width: w, height: h, rotation: 0, hasAlpha: true };
}

/** Reads the header of a still image. `null`: the bytes are not a readable image of a supported format. */
export function probeImageBytes(bytes: Uint8Array): ImageInfo | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return png(bytes);
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return jpeg(bytes);
  if (tag(bytes, 0) === "GIF8") return gif(bytes);
  if (tag(bytes, 0) === "RIFF" && tag(bytes, 8) === "WEBP") return webp(bytes);
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return bmp(bytes);
  if (tag(bytes, 4) === "ftyp") {
    const brands = String.fromCharCode(...bytes.subarray(8, Math.min(bytes.length, u32be(bytes, 0))));
    return heif(bytes, brands.includes("avif") || brands.includes("avis") ? "avif" : brands.includes("hei") || brands.includes("hev") ? "heic" : "heif");
  }
  if (looksLikeSvg(bytes)) return svg(bytes);
  return null;
}
