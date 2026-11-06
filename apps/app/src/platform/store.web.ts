import type { KeyValueStore } from "@jagentchill/app-core";
import { markDragHandle } from "@jagentchill/ui";
import { openWebStorage, type StoragePort } from "@jagentchill/storage";
import { registerUnsaved, type UnsavedWork } from "./unsavedWork";

const memory = new Map<string, string>();
/** UI preferences: localStorage of the app origin; a browser mode without it keeps them for the session only. */
export const preferenceStore: KeyValueStore = {
  get: (key) => { try { return globalThis.localStorage.getItem(key); } catch { return memory.get(key) ?? null; } },
  set: (key, value) => { try { globalThis.localStorage.setItem(key, value); } catch { memory.set(key, value); } },
  remove: (key) => { try { globalThis.localStorage.removeItem(key); } catch { memory.delete(key); } },
};
/** The web store: records in IndexedDB, files in the Origin Private File System. */
export const openStorage = (): Promise<StoragePort> => openWebStorage();
export type PickedNativeMedia = { uri: string; name: string; mimeType: string; size: number; modified_ms?: number };
export const readNativeMediaRange = async (_uri: string, _start: number, _end: number): Promise<Uint8Array> => { throw new Error("Native media file reads are unavailable in a browser."); };
export const pickNativeMedia = async (_kind: "photos" | "videos" | "files"): Promise<PickedNativeMedia[]> => [];
export const imageUrl = (bytes: Uint8Array, mime: string): string | null => URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: mime }));
export const releaseImageUrl = (url: string): void => URL.revokeObjectURL(url);

type Background = { kind: string; color?: string; css?: string };
const escapeXml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/**
 * Frame 0 of a project that holds only its background: the background alone, scaled to `longSide` — a JPEG at quality
 * 0.8, or a transparent PNG for the transparent background. `null` for a background this cannot draw (blur and image
 * backgrounds need the clip or the asset, which the render engine composes).
 */
export async function renderBackgroundFrame(background: Background, size: { width: number; height: number }, longSide: number): Promise<{ bytes: Uint8Array; mime: "image/jpeg" | "image/png" } | null> {
  const scale = Math.min(1, longSide / Math.max(size.width, size.height));
  const width = Math.max(1, Math.round(size.width * scale)), height = Math.max(1, Math.round(size.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const transparent = background.kind === "transparent";
  if (background.kind === "color" && background.color) { context.fillStyle = background.color; context.fillRect(0, 0, width, height); }
  else if (background.kind === "gradient" && background.css) {
    // Gradient lengths are authored at a 1920 px long side: the browser lays the CSS out at that size and the image is scaled.
    const authored = 1920 / Math.max(size.width, size.height);
    const boxWidth = size.width * authored, boxHeight = size.height * authored;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${boxWidth} ${boxHeight}"><foreignObject width="${boxWidth}" height="${boxHeight}"><div xmlns="http://www.w3.org/1999/xhtml" style="width:${boxWidth}px;height:${boxHeight}px;background:${escapeXml(background.css)}"></div></foreignObject></svg>`;
    const image = new Image();
    const loaded = new Promise<boolean>((resolve) => { image.onload = () => resolve(true); image.onerror = () => resolve(false); });
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    if (!(await loaded)) return null;
    context.fillStyle = "black"; context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
  } else if (!transparent) return null;
  const mime = transparent ? "image/png" : "image/jpeg";
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, 0.8));
  return blob ? { bytes: new Uint8Array(await blob.arrayBuffer()), mime } : null;
}
export function setDocumentTitle(title: string): void { document.title = title; }
/** `work`: how the screen finishes saving and a look at its save state that changes nothing (`unsavedWork.ts`). */
export function guardUnload(shouldAsk: () => boolean, work?: UnsavedWork): () => void {
  const handler = (event: BeforeUnloadEvent) => { if (shouldAsk()) { event.preventDefault(); event.returnValue = ""; } };
  window.addEventListener("beforeunload", handler);
  const forget = registerUnsaved(shouldAsk, work);
  return () => { window.removeEventListener("beforeunload", handler); forget(); };
}
export function preventStrayDrops(): () => void {
  const stop = (event: DragEvent) => { if (event.dataTransfer?.types.includes("Files")) event.preventDefault(); };
  window.addEventListener("dragover", stop);
  window.addEventListener("drop", stop);
  return () => { window.removeEventListener("dragover", stop); window.removeEventListener("drop", stop); };
}
export type DropHandlers = { onEnter?(): void; onLeave?(): void; onDrop?(data: { files: File[]; text: string }): void; accept?(types: readonly string[]): boolean };
/** Makes an element a drop target. Enter and leave are counted, so moving over a child does not flicker. */
export function bindDrop(node: unknown, handlers: DropHandlers): () => void {
  const element = node as HTMLElement | null;
  if (!element?.addEventListener) return () => {};
  let depth = 0;
  const accepts = (event: DragEvent) => !handlers.accept || handlers.accept(event.dataTransfer?.types ?? []);
  const enter = (event: DragEvent) => { if (!accepts(event)) return; event.preventDefault(); if (depth++ === 0) handlers.onEnter?.(); };
  const over = (event: DragEvent) => { if (accepts(event)) { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = "move"; } };
  const leave = (event: DragEvent) => { if (accepts(event) && --depth <= 0) { depth = 0; handlers.onLeave?.(); } };
  const drop = (event: DragEvent) => {
    if (!accepts(event)) return;
    event.preventDefault(); event.stopPropagation(); depth = 0; handlers.onLeave?.();
    handlers.onDrop?.({ files: Array.from(event.dataTransfer?.files ?? []), text: event.dataTransfer?.getData("application/x-jagentchill") ?? "" });
  };
  element.addEventListener("dragenter", enter); element.addEventListener("dragover", over); element.addEventListener("dragleave", leave); element.addEventListener("drop", drop);
  return () => { element.removeEventListener("dragenter", enter); element.removeEventListener("dragover", over); element.removeEventListener("dragleave", leave); element.removeEventListener("drop", drop); };
}
/** Makes an element draggable with an app payload (project or folder ids). */
export function bindDrag(node: unknown, payload: () => string | null, handlers: { onStart?(): void; onEnd?(): void } = {}): () => void {
  const element = node as HTMLElement | null;
  if (!element?.addEventListener) return () => {};
  element.setAttribute("draggable", "true");
  const start = (event: DragEvent) => {
    const data = payload();
    if (data === null || !event.dataTransfer) { event.preventDefault(); return; }
    event.dataTransfer.setData("application/x-jagentchill", data);
    event.dataTransfer.effectAllowed = "move";
    handlers.onStart?.();
  };
  const end = () => handlers.onEnd?.();
  element.addEventListener("dragstart", start); element.addEventListener("dragend", end);
  return () => { element.removeAttribute("draggable"); element.removeEventListener("dragstart", start); element.removeEventListener("dragend", end); };
}
export function onWindowKey(handler: (event: { key: string; meta: boolean; ctrl: boolean; alt: boolean; shift: boolean; inField: boolean; preventDefault(): void }) => void): () => void {
  const listener = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    const inField = Boolean(target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable));
    handler({ key: event.key, meta: event.metaKey, ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey, inField, preventDefault: () => event.preventDefault() });
  };
  window.addEventListener("keydown", listener);
  return () => window.removeEventListener("keydown", listener);
}
/** Calls `show` when the pointer rests within `edge` px of the inline-start window edge for `delay` ms. */
export function onEdgeHover(edge: number, delay: number, show: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const move = (event: MouseEvent) => {
    const rtl = document.documentElement.dir === "rtl";
    // Only a pointer held against the very edge — not one passing by on its way to the panels beside it, nor a drag.
    const near = event.buttons === 0 && (rtl ? window.innerWidth - event.clientX <= edge : event.clientX <= edge);
    if (near && !timer) timer = setTimeout(() => { timer = null; show(); }, delay);
    if (!near && timer) { clearTimeout(timer); timer = null; }
  };
  window.addEventListener("mousemove", move);
  return () => { window.removeEventListener("mousemove", move); if (timer) clearTimeout(timer); };
}
export const isDesktopOs = (): boolean => !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
export const systemLanguage = (): string => navigator.language || "en";
export const openExternal = (url: string): void => { window.open(url, "_blank", "noopener"); };
/** A horizontal drag on a splitter: `onDrag` gets the distance from the press, `onReset` a double click. */
export function bindSplitter(node: unknown, handlers: { onStart(): void; onDrag(dx: number): void; onEnd(): void; onReset(): void }): () => void {
  const element = node as HTMLElement | null;
  if (!element?.addEventListener) return () => {};
  const down = (event: PointerEvent) => {
    event.preventDefault();
    const startX = event.clientX, rtl = document.documentElement.dir === "rtl";
    handlers.onStart();
    const move = (moved: PointerEvent) => handlers.onDrag((moved.clientX - startX) * (rtl ? -1 : 1));
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); handlers.onEnd(); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };
  const reset = () => handlers.onReset();
  element.addEventListener("pointerdown", down); element.addEventListener("dblclick", reset);
  markDragHandle(element, "col-resize");
  return () => { element.removeEventListener("pointerdown", down); element.removeEventListener("dblclick", reset); };
}
export function focusById(id: string): void { document.getElementById(id)?.focus(); }
/** Opens the file picker of the operating system. */
export function pickFiles(accept: string, multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = accept; input.multiple = multiple;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.oncancel = () => resolve([]);
    input.click();
  });
}
export const downloadUrl = (): string | undefined => process.env.EXPO_PUBLIC_JAGENTCHILL_DOWNLOAD_URL || undefined;
const held = { shift: false, toggle: false };
if (typeof window !== "undefined") {
  const track = (event: KeyboardEvent | MouseEvent) => { held.shift = event.shiftKey; held.toggle = event.metaKey || event.ctrlKey; };
  for (const type of ["keydown", "keyup", "mousedown", "pointerdown"] as const) window.addEventListener(type, track as EventListener, true);
  window.addEventListener("blur", () => { held.shift = false; held.toggle = false; });
}
/** The modifier keys held at the last key or pointer event: Shift extends a selection, Ctrl or ⌘ toggles one item. */
export const heldModifiers = (): { shift: boolean; toggle: boolean } => ({ ...held });
