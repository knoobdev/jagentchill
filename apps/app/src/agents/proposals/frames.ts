/** Image helpers of the frame requests. Frames come from the preview engine, which this platform does not have: nothing is drawn. */
export type FrameOverlay = "safe_areas" | "element_bounds" | "grid";
export type Box = { x: number; y: number; width: number; height: number; rotation: number };
export const toBase64 = (_bytes: Uint8Array): string => "";
export async function decorate(bytes: Uint8Array, _options: { overlays: FrameOverlay[]; boxes: Box[]; canvas: { width: number; height: number } }): Promise<Uint8Array> { return bytes; }
export async function contactSheet(frames: Uint8Array[], _size: { width: number; height: number }): Promise<{ bytes: Uint8Array; width: number; height: number } | null> { return frames.length ? null : null; }
