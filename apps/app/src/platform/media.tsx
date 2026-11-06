/** Native implementation of the media services of the app. The web one is `media.web.tsx`. */
import type { ReactNode } from "react";
import { inlineMediaEngine, type MediaEngine } from "@jagentchill/media/browser";
import type { RecorderDriver, RecordingKind } from "@jagentchill/media";
import type { ClassicOrigin, PersistenceEnvironment } from "@jagentchill/storage";

export const mediaPlatform: "web" | "desktop" | "mobile" = "mobile";
/** Decoding on a phone happens in the engine WebView, which the render engine provides; outside it no decoder exists. */
export const createMediaEngine = (): MediaEngine => inlineMediaEngine();

export type PickedFile = { file: Blob & { name: string; lastModified?: number }; relativePath?: string };
/** Drag-and-drop from the operating system is not offered on mobile. */
export function bindFileDrop(_node: unknown, _handlers: { onEnter(): void; onLeave(): void; onDrop(files: PickedFile[]): void }): () => void { return () => {}; }
export function onMediaPaste(_handler: (files: { file: Blob; name: string | null }[]) => boolean): () => void { return () => {}; }
export function onWindowFocus(_handler: () => void): () => void { return () => {}; }
export function saveBlob(_name: string, _blob: Blob): void {}
export type FileSink = { write(chunk: Uint8Array): Promise<void>; close(): Promise<void>; abort(): Promise<void> };
export async function createFileSink(_name: string, _mime: string): Promise<FileSink> { throw new Error("Saving a file needs the share sheet of the native build"); }
export const blobUrl = (_blob: Blob): string => "";
export const releaseUrl = (_url: string): void => {};
export async function copyText(text: string): Promise<boolean> { try { await (await import("expo-clipboard")).setStringAsync(text); return true; } catch { return false; } }
export function MediaPreview(_props: { type: "video" | "audio" | "image"; url: string; label: string; height: number }): ReactNode { return null; }
export function CapturePreview(_props: { stream: unknown; height: number; label: string }): ReactNode { return null; }

export type CaptureDevice = { id: string; label: string; kind: "camera" | "microphone" };
export type CaptureOptions = { kind: RecordingKind; cameraId?: string; microphoneId?: string; microphone?: boolean; systemAudio?: boolean };
export type CaptureError = { reason: "denied" | "unavailable" | "cancelled"; message: string };
export type Capture = { stream: unknown; hasVideo: boolean; driver: RecorderDriver; level(): number; onEnded(handler: () => void): void; close(): void };
/** The native recorder module is not part of this build: recording is not offered where it cannot run. */
export const captureSupported = (_kind: RecordingKind): boolean => false;
export const systemAudioSupported = (): boolean => false;
export const listCaptureDevices = async (): Promise<CaptureDevice[]> => [];
export async function openCapture(_options: CaptureOptions): Promise<Capture> { throw { reason: "unavailable", message: "Recording is not available in this build" } satisfies CaptureError; }
export const permissionHelpUrl = (): string => "app-settings:";

export const persistenceEnvironment = (): PersistenceEnvironment => ({ platform: "mobile" as const, storage: undefined, prompts: false, installAvailable: false });
export const promptInstall = (): void => {};
export function lockSignal(): { post(message: { projectId: string }): void; listen(handler: (message: { projectId: string }) => void): () => void } | undefined { return undefined; }
export const classicOrigin = (): ClassicOrigin | null => null;

export type Box = { x: number; y: number; width: number; height: number };
/** A marquee needs a pointer; touch selection uses long-press selection mode. */
export function bindMarquee(_node: unknown, _itemPrefix: string, _handlers: { onChange(marquee: Box, items: (Box & { id: string })[], additive: boolean): void; onEnd(moved: boolean): void }): () => void { return () => {}; }
export const boxOf = (_node: unknown): Box | null => null;
export function scrollIntoView(_id: string): void {}
export async function scaleImage(_file: Blob, _maxSide: number): Promise<{ bytes: Uint8Array; mime: "image/jpeg" | "image/png"; width: number; height: number } | null> { return null; }
/** Dictation on a phone is the keyboard's own microphone key. */
export function startDictation(_language: string, _handlers: { onText(text: string, final: boolean): void; onEnd(error?: string): void }): (() => void) | null { return null; }
export const editorInstanceId = (make: () => string): string => make();
export function onPageHide(_handler: () => void): () => void { return () => {}; }
