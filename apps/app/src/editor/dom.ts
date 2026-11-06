/** Native implementation of the editor's bindings: the desktop editor regions are web and desktop only (the phone editor is `mobile-editor`), so these do nothing. */
export type PointerInfo = { x: number; y: number; clientX: number; clientY: number; button: number; shift: boolean; alt: boolean; mod: boolean; touch: boolean; time_ms: number; onControl: boolean; detail: number };
export type PointerSession = { move?(info: PointerInfo): void; up?(info: PointerInfo): void; cancel?(): void };
export type PointerHandlers = { down?(info: PointerInfo): PointerSession | void | null; hover?(info: PointerInfo | null): void; context?(info: PointerInfo): void; double?(info: PointerInfo): void };
export type WheelInfo = { deltaX: number; deltaY: number; deltaMode: number; shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean; x: number; y: number };
export type KeyInfo = { key: string; code: string; meta: boolean; ctrl: boolean; alt: boolean; shift: boolean; repeat: boolean; type: "down" | "up"; inField: boolean; inOverlay: boolean; inPreview: boolean; onButton: boolean; preventDefault(): void };
export type DropInfo = { x: number; y: number; payload: string | null; files: File[]; alt: boolean };
export const isMac = (): boolean => false;
export function bindPointer(_node: unknown, _handlers: PointerHandlers): () => void { return () => {}; }
export function bindWheel(_node: unknown, _handler: (wheel: WheelInfo) => void): () => void { return () => {}; }
export function observeSize(_node: unknown, _onSize: (size: { width: number; height: number }) => void): () => void { return () => {}; }
export function followPanelMotion(_stage: unknown, _layers: unknown[], _transformFor: (size: { width: number; height: number }) => string | null): { settle(): void; dispose(): void } { return { settle() {}, dispose() {} }; }
export function bindKeys(_handler: (key: KeyInfo) => void): () => void { return () => {}; }
export function trackDrags(): () => void { return () => {}; }
export function bindDropZone(_node: unknown, _handlers: { over(info: DropInfo): boolean; leave(): void; drop(info: DropInfo): void }): () => void { return () => {}; }
export function placePlayhead(_node: unknown, _at: { left: number; shown: boolean; now: number; max: number; text: string }): void {}
export function setInputText(_node: unknown, _text: string): void {}
export function setCursor(_node: unknown, _cursor: string): void {}
export function bindCursorHitTest(_node: unknown, _hitTest: (event: PointerEvent) => boolean): () => void { return () => {}; }
export function focusNode(_node: unknown): void {}
export function toggleFullscreen(_node: unknown): void {}
export function onFullscreen(_node: unknown, _listener: (on: boolean) => void): () => void { return () => {}; }
export const devicePixelRatio = (): number => 1;
export function observeDevicePixelRatio(_onChange: (ratio: number) => void): () => void { return () => {}; }
export const now = (): number => Date.now();
export const nextFrame = (callback: () => void): (() => void) => { const id = setTimeout(callback, 16); return () => clearTimeout(id); };
export function saveBytes(_bytes: Uint8Array, _name: string, _mime: string): void {}
export const copyImage = async (_bytes: Uint8Array, _mime: string): Promise<boolean> => false;
export type CoverCrop = { x: number; y: number; zoom: number };
export type EncodedImage = { bytes: Uint8Array; mime: "image/jpeg" | "image/png"; width: number; height: number };
export const cropImage = async (_source: Blob, _ratio: number, _crop: CoverCrop, _maxSide: number, _png?: boolean): Promise<EncodedImage | null> => null;
export const objectUrl = (_bytes: Uint8Array, _mime: string): string => "";
export const releaseUrl = (_url: string): void => {};
export const decodePixels = async (_bytes: Uint8Array, _mime: string, _maxSide?: number): Promise<{ data: Uint8ClampedArray; width: number; height: number } | null> => null;
export const sha256Hex = async (_bytes: Uint8Array): Promise<string> => "";
