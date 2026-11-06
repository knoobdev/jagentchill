/** Image helpers of the frame requests on the web: base64 of the engine's bytes, guide overlays and contact sheets drawn on a 2D canvas. */
export type FrameOverlay = "safe_areas" | "element_bounds" | "grid";
export type Box = { x: number; y: number; width: number; height: number; rotation: number };

export function toBase64(bytes: Uint8Array): string {
  let text = "";
  for (let at = 0; at < bytes.length; at += 0x8000) text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(text);
}
const encode = (canvas: HTMLCanvasElement): Promise<Uint8Array> => new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? void blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer))) : reject(new Error("the frame could not be encoded"))), "image/jpeg", 0.8));
const decode = (bytes: Uint8Array): Promise<ImageBitmap> => createImageBitmap(new Blob([bytes as BlobPart], { type: "image/jpeg" }));

/** Draws the guide overlays an agent asked for over a frame: the action- and title-safe areas, a thirds grid, the bounds of the elements. */
export async function decorate(bytes: Uint8Array, options: { overlays: FrameOverlay[]; boxes: Box[]; canvas: { width: number; height: number } }): Promise<Uint8Array> {
  if (options.overlays.length === 0) return bytes;
  const image = await decode(bytes), canvas = document.createElement("canvas");
  canvas.width = image.width; canvas.height = image.height;
  const context = canvas.getContext("2d")!, scale = image.width / options.canvas.width;
  context.drawImage(image, 0, 0);
  context.lineWidth = Math.max(1, Math.round(image.width / 640));
  // The guide colours are part of the picture handed to the model, not of the app's surface.
  const light = "rgba(255,255,255,0.85)", mark = "rgba(0,200,255,0.9)";
  if (options.overlays.includes("grid")) {
    context.strokeStyle = light;
    for (const third of [1 / 3, 2 / 3]) { context.beginPath(); context.moveTo(image.width * third, 0); context.lineTo(image.width * third, image.height); context.moveTo(0, image.height * third); context.lineTo(image.width, image.height * third); context.stroke(); }
  }
  if (options.overlays.includes("safe_areas")) {
    context.strokeStyle = light;
    for (const inset of [0.05, 0.1]) context.strokeRect(image.width * inset, image.height * inset, image.width * (1 - 2 * inset), image.height * (1 - 2 * inset));
  }
  if (options.overlays.includes("element_bounds")) {
    context.strokeStyle = mark;
    // The engine reports the axis-aligned bounds of each element on the canvas, from its top-left corner.
    for (const box of options.boxes) context.strokeRect(box.x * scale, box.y * scale, box.width * scale, box.height * scale);
  }
  return encode(canvas);
}

/** Lays frames out side by side (two per row) as one picture no wider than `size.width`. */
export async function contactSheet(frames: Uint8Array[], size: { width: number; height: number }): Promise<{ bytes: Uint8Array; width: number; height: number } | null> {
  if (frames.length === 0) return null;
  const images = await Promise.all(frames.map(decode)), columns = Math.min(2, images.length), rows = Math.ceil(images.length / columns);
  const cellWidth = Math.floor(size.width / columns), cellHeight = Math.round((cellWidth * size.height) / size.width);
  const canvas = document.createElement("canvas");
  canvas.width = cellWidth * columns; canvas.height = cellHeight * rows;
  const context = canvas.getContext("2d")!;
  images.forEach((image, index) => context.drawImage(image, (index % columns) * cellWidth, Math.floor(index / columns) * cellHeight, cellWidth, cellHeight));
  return { bytes: await encode(canvas), width: canvas.width, height: canvas.height };
}
