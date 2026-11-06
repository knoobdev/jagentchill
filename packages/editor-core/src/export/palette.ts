/** Colour quantisation for GIF export (`export-share.GIF export`): a 15-bit histogram and a median-cut palette. Pure byte work. */
export const PALETTE_BINS = 32 * 32 * 32;
const BINS = PALETTE_BINS;
export const paletteBin = (r: number, g: number, b: number) => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
/** Adds the pixels of a frame to a 15-bit colour histogram. `step` samples every n-th pixel. */
export function addToHistogram(histogram: Uint32Array, rgba: Uint8Array | Uint8ClampedArray, step = 1): void {
  for (let at = 0; at < rgba.length; at += 4 * step) histogram[paletteBin(rgba[at], rgba[at + 1], rgba[at + 2])]++;
}
export const newHistogram = (): Uint32Array => new Uint32Array(BINS);

type Box = { bins: number[]; count: number };
const channel = (bin: number, axis: number) => (axis === 0 ? bin >> 10 : axis === 1 ? (bin >> 5) & 31 : bin & 31);
/** Median cut over the histogram: at most 256 colours as RGB triples, each the population-weighted mean of its box. */
export function buildPalette(histogram: Uint32Array, maxColours = 256): Uint8Array {
  const used: number[] = [];
  for (let bin = 0; bin < BINS; bin++) if (histogram[bin] > 0) used.push(bin);
  const total = (bins: number[]) => bins.reduce((sum, bin) => sum + histogram[bin], 0);
  const boxes: Box[] = [{ bins: used, count: total(used) }];
  while (boxes.length < maxColours) {
    // The box with the most pixels that can still be split.
    let pick = -1;
    for (let index = 0; index < boxes.length; index++) if (boxes[index].bins.length > 1 && (pick < 0 || boxes[index].count > boxes[pick].count)) pick = index;
    if (pick < 0) break;
    const box = boxes[pick];
    let axis = 0, widest = -1;
    for (let candidate = 0; candidate < 3; candidate++) {
      let low = 31, high = 0;
      for (const bin of box.bins) { const value = channel(bin, candidate); if (value < low) low = value; if (value > high) high = value; }
      if (high - low > widest) { widest = high - low; axis = candidate; }
    }
    box.bins.sort((a, b) => channel(a, axis) - channel(b, axis));
    let running = 0, cut = 1;
    for (let index = 0; index < box.bins.length - 1; index++) { running += histogram[box.bins[index]]; if (running >= box.count / 2) { cut = index + 1; break; } cut = index + 1; }
    const head = box.bins.slice(0, cut), tail = box.bins.slice(cut);
    boxes.splice(pick, 1, { bins: head, count: total(head) }, { bins: tail, count: total(tail) });
  }
  const palette = new Uint8Array(Math.max(2, boxes.length) * 3);
  boxes.forEach((box, index) => {
    let r = 0, g = 0, b = 0, count = 0;
    for (const bin of box.bins) { const weight = histogram[bin]; r += ((bin >> 10) * 8 + 4) * weight; g += (((bin >> 5) & 31) * 8 + 4) * weight; b += ((bin & 31) * 8 + 4) * weight; count += weight; }
    if (count > 0) palette.set([Math.round(r / count), Math.round(g / count), Math.round(b / count)], index * 3);
  });
  return palette;
}

