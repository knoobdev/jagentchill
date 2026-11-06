// The golden tolerance and the image files of the golden-frame suite.
import { deflateSync, inflateSync } from "node:zlib";

export type Rgba = { width: number; height: number; data: Uint8Array };
export type Comparison = { pass: boolean; withinTwo: number; maxDifference: number; ssim: number; reasons: string[] };

/** Golden tolerance: at least 99.5 % of pixels differ by 2 or less per channel, none by more than 16, and SSIM is 0.99 or greater. */
export const GOLDEN = { fraction: 0.995, perChannel: 2, maximum: 16, ssim: 0.99 } as const;

const luma = (data: Uint8Array, index: number): number => 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2];

/** Mean structural similarity of the luma over 8×8 windows. */
export function ssim(a: Rgba, b: Rgba): number {
  const c1 = (0.01 * 255) ** 2, c2 = (0.03 * 255) ** 2;
  let total = 0, windows = 0;
  for (let y = 0; y + 8 <= a.height; y += 8) {
    for (let x = 0; x + 8 <= a.width; x += 8) {
      let sumA = 0, sumB = 0, sumAA = 0, sumBB = 0, sumAB = 0;
      for (let dy = 0; dy < 8; dy++) {
        for (let dx = 0; dx < 8; dx++) {
          const index = ((y + dy) * a.width + x + dx) * 4;
          // Alpha weighs the luma, so that transparent frames compare by what they show.
          const va = (luma(a.data, index) * a.data[index + 3]) / 255, vb = (luma(b.data, index) * b.data[index + 3]) / 255;
          sumA += va; sumB += vb; sumAA += va * va; sumBB += vb * vb; sumAB += va * vb;
        }
      }
      const meanA = sumA / 64, meanB = sumB / 64;
      const varA = sumAA / 64 - meanA * meanA, varB = sumBB / 64 - meanB * meanB, cov = sumAB / 64 - meanA * meanB;
      total += ((2 * meanA * meanB + c1) * (2 * cov + c2)) / ((meanA * meanA + meanB * meanB + c1) * (varA + varB + c2));
      windows++;
    }
  }
  return windows === 0 ? 1 : total / windows;
}

export function compare(reference: Rgba, actual: Rgba, tolerance: { fraction: number; perChannel: number; maximum: number; ssim: number } = GOLDEN): Comparison {
  if (reference.width !== actual.width || reference.height !== actual.height) return { pass: false, withinTwo: 0, maxDifference: 255, ssim: 0, reasons: ["the sizes differ"] };
  let within = 0, maxDifference = 0;
  const pixels = reference.width * reference.height;
  for (let index = 0; index < pixels * 4; index += 4) {
    let worst = 0;
    for (let channel = 0; channel < 4; channel++) worst = Math.max(worst, Math.abs(reference.data[index + channel] - actual.data[index + channel]));
    if (worst <= tolerance.perChannel) within++;
    maxDifference = Math.max(maxDifference, worst);
  }
  const similarity = ssim(reference, actual);
  const reasons: string[] = [];
  if (within / pixels < tolerance.fraction) reasons.push(`${((within / pixels) * 100).toFixed(2)} % of pixels within ${tolerance.perChannel}`);
  if (maxDifference > tolerance.maximum) reasons.push(`a pixel differs by ${maxDifference}`);
  if (similarity < tolerance.ssim) reasons.push(`SSIM ${similarity.toFixed(4)}`);
  return { pass: reasons.length === 0, withinTwo: within / pixels, maxDifference, ssim: similarity, reasons };
}

/** The difference of two frames as an image: per-channel absolute difference, amplified, opaque. */
export function difference(reference: Rgba, actual: Rgba): Rgba {
  const data = new Uint8Array(reference.data.length);
  for (let index = 0; index < data.length; index += 4) {
    for (let channel = 0; channel < 3; channel++) data[index + channel] = Math.min(255, Math.abs(reference.data[index + channel] - (actual.data[index + channel] ?? 0)) * 8);
    data[index + 3] = 255;
  }
  return { width: reference.width, height: reference.height, data };
}

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(body, 8);
  view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
  return out;
}

/** An 8-bit RGBA PNG with straight alpha. */
export function encodePng(image: Rgba): Uint8Array {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, image.width);
  view.setUint32(4, image.height);
  header.set([8, 6, 0, 0, 0], 8);
  const raw = new Uint8Array((image.width * 4 + 1) * image.height);
  for (let y = 0; y < image.height; y++) raw.set(image.data.subarray(y * image.width * 4, (y + 1) * image.width * 4), y * (image.width * 4 + 1) + 1);
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

/** Reads back a PNG written by `encodePng` (8-bit RGBA, filter 0). */
export function decodePng(bytes: Uint8Array): Rgba {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16), height = view.getUint32(20);
  const data: Uint8Array[] = [];
  for (let offset = 8; offset < bytes.length;) {
    const length = view.getUint32(offset), type = new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8));
    if (type === "IDAT") data.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data));
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    if (raw[y * (width * 4 + 1)] !== 0) throw new Error("a golden reference uses a PNG filter this reader does not undo");
    out.set(raw.subarray(y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1)), y * width * 4);
  }
  return { width, height, data: out };
}
