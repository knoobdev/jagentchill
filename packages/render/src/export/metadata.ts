/**
 * Provenance metadata of exported files (`export-share.Provenance metadata`): the XMP packet inside PNG, JPEG, MP4 and
 * MOV bytes, and the visible AI label of `export-share.AI label burn-in` blended over rendered pixels. Byte work only.
 */
export { findXmp, jpegWithXmp, pngWithXmp, xmpUuidBox } from "@jagentchill/editor-core";

export type LabelBitmap = { width: number; height: number; x: number; y: number; rgba: Uint8ClampedArray };
/**
 * The visible AI label for a frame size: text 2.5 % of the short edge tall, its right and bottom edges 2.5 % from the
 * frame's, white with a black outline of one twelfth of the text height. Rasterised once per export.
 */
export function rasterAiLabel(size: { width: number; height: number }, text: string, fontFamily: string): LabelBitmap {
  const short = Math.min(size.width, size.height), textHeight = short * 0.025, margin = short * 0.025, outline = textHeight / 12;
  const probe = new OffscreenCanvas(8, 8).getContext("2d")!;
  // The font size whose capital height is the asked text height.
  probe.font = `600 100px ${fontFamily}`;
  const metrics = probe.measureText(text), capital = metrics.actualBoundingBoxAscent || 72, fontSize = (textHeight * 100) / capital;
  probe.font = `600 ${fontSize}px ${fontFamily}`;
  const measured = probe.measureText(text), pad = Math.ceil(outline) + 1;
  const width = Math.ceil(measured.width) + pad * 2, descent = Math.ceil(measured.actualBoundingBoxDescent || 0), height = Math.ceil(textHeight) + descent + pad * 2;
  const canvas = new OffscreenCanvas(width, height), context = canvas.getContext("2d")!;
  context.font = `600 ${fontSize}px ${fontFamily}`;
  context.textBaseline = "alphabetic"; context.lineJoin = "round";
  context.strokeStyle = "#000000"; context.lineWidth = outline * 2; context.strokeText(text, pad, pad + Math.ceil(textHeight)); // content-colour
  context.fillStyle = "#ffffff"; context.fillText(text, pad, pad + Math.ceil(textHeight)); // content-colour
  // The text's right edge and baseline sit on the margin; the padding and the descent hang beyond them.
  return { width, height, x: Math.round(size.width - margin - (width - pad)), y: Math.round(size.height - margin - (pad + Math.ceil(textHeight))), rgba: context.getImageData(0, 0, width, height).data };
}
/** Blends the label over straight-alpha RGBA frame pixels at 60 % opacity, as the top-most layer. */
export function blendAiLabel(frame: Uint8Array | Uint8ClampedArray, frameWidth: number, frameHeight: number, label: LabelBitmap, opacity = 0.6): void {
  for (let row = 0; row < label.height; row++) {
    const y = label.y + row;
    if (y < 0 || y >= frameHeight) continue;
    for (let column = 0; column < label.width; column++) {
      const x = label.x + column;
      if (x < 0 || x >= frameWidth) continue;
      const from = (row * label.width + column) * 4, alpha = (label.rgba[from + 3] / 255) * opacity;
      if (alpha === 0) continue;
      const to = (y * frameWidth + x) * 4;
      frame[to] = Math.round(label.rgba[from] * alpha + frame[to] * (1 - alpha));
      frame[to + 1] = Math.round(label.rgba[from + 1] * alpha + frame[to + 1] * (1 - alpha));
      frame[to + 2] = Math.round(label.rgba[from + 2] * alpha + frame[to + 2] * (1 - alpha));
      frame[to + 3] = Math.max(frame[to + 3], Math.round(alpha * 255));
    }
  }
}
