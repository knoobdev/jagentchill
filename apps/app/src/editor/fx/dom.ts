/** Native builds render the library tiles in the surface of `mobile-editor`; these are the web helpers' no-op forms. */
export function whenVisible(_node: unknown, onVisible: () => void): () => void { onVisible(); return () => {}; }
export function previewSize(): { width: number; height: number } | null { return null; }
export function coverPreview(_url: string): () => void { return () => {}; }
export const nextPaint = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 34));
export const tracksElement = (): unknown => null;
export function onTracksPress(_listener: () => void): () => void { return () => {}; }
export function focusInput(_id: string): void {}
export const rowMiddles = (ids: string[]): number[] => ids.map(() => Number.MAX_SAFE_INTEGER);
