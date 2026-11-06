/** Browser-only helpers of the content tabs (fonts, canvas drops, sound previews, text files); native builds have the surfaces of `mobile-editor`. */
export function registerFontFaces(_faces: readonly { family: string; url: string; weight: number; style: string }[]): void {}
/** A drop of an in-app payload on the preview canvas: `drop` receives the payload and the point in project-canvas pixels from the canvas centre. */
export function bindCanvasDrop(_canvas: { width: number; height: number }, _accept: (payload: string) => boolean, _drop: (payload: string, point: { x: number; y: number }) => void): () => void { return () => {}; }
export type SoundPreview = { stop(): void; play?(): void };
export function playSound(_url: string, _volume: number, _events: { onProgress(fraction: number): void; onEnd(failed: boolean): void }): SoundPreview { return { stop() {} }; }
export function playStreamSound(_stream: ReadableStream<Uint8Array>, _mime: string, _volume: number, _events: { onProgress(fraction: number): void; onEnd(failed: boolean): void }): SoundPreview { return { stop() {} }; }
export function saveTextFile(_name: string, _text: string, _mime: string): void {}
export const readTextFile = (file: { text(): Promise<string> }): Promise<string> => file.text();
export function copyText(_text: string): Promise<boolean> { return Promise.resolve(false); }
/** `x`, `y` are relative to the handle (which may move while it is dragged); `clientX`, `clientY` to the viewport. */
export type HandleDrag = { x: number; y: number; clientX: number; clientY: number; shift: boolean };
/** A small handle drawn over a clip (the volume line, a beat dot): its drag and double-click are its own and never start a gesture of the clip under it. */
export function bindHandle(_node: unknown, _handlers: { down(info: HandleDrag): { move(info: HandleDrag): void; up(info: HandleDrag): void; cancel?(): void } | null; double?(info: HandleDrag): void }): () => void { return () => {}; }
/** Tells which timeline clip the pointer is over (its element id), or `null`; a handle drawn over a clip counts as its clip. */
export function bindClipHover(_onHover: (elementId: string | null) => void): () => void { return () => {}; }
/** The decoded sound of a media file, as two channels at 48 kHz; `null` when the platform cannot decode it. */
export function decodeSound(_url: string): Promise<{ left: Float32Array; right: Float32Array; sampleRate: number } | null> { return Promise.resolve(null); }
