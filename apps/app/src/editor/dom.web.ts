/** Web implementation of the editor's pointer, wheel, key, drag and fullscreen bindings. The native one is `dom.ts`. */
import { isHandleCursor, markDragHandle, onPanelMotion, panelsMoving } from "@jagentchill/ui";

export type PointerInfo = { x: number; y: number; clientX: number; clientY: number; button: number; shift: boolean; alt: boolean; mod: boolean; touch: boolean; time_ms: number; onControl: boolean; detail: number };
export type PointerSession = { move?(info: PointerInfo): void; up?(info: PointerInfo): void; cancel?(): void };
export type PointerHandlers = { down?(info: PointerInfo): PointerSession | void | null; hover?(info: PointerInfo | null): void; context?(info: PointerInfo): void; double?(info: PointerInfo): void };
export const isMac = (): boolean => /Mac|iPhone|iPad/.test(navigator.platform);
const CONTROL = '[data-testid^="tl-ctl"], input, textarea, [role="slider"], [role="menu"], [role="dialog"]';
/** A control nested in the bound element handles its own presses; the bound element itself is never "a control". */
const insideControl = (target: HTMLElement | null, node: HTMLElement): boolean => { const control = target?.closest?.(CONTROL) ?? null; return control !== null && control !== node && node.contains(control); };
const infoOf = (event: MouseEvent, node: HTMLElement): PointerInfo => {
  const rect = node.getBoundingClientRect(), target = event.target as HTMLElement | null;
  return {
    x: event.clientX - rect.left, y: event.clientY - rect.top, clientX: event.clientX, clientY: event.clientY, button: event.button, shift: event.shiftKey, alt: event.altKey, mod: isMac() ? event.metaKey : event.ctrlKey,
    touch: (event as PointerEvent).pointerType === "touch", time_ms: performance.now(), onControl: insideControl(target, node), detail: event.detail,
  };
};
/**
 * Pointer gestures on an element. `down` returns the session that follows the pointer until release; the pointer is
 * captured, so a drag keeps reporting outside the element. Coordinates are relative to the element's box.
 */
export function bindPointer(node: unknown, handlers: PointerHandlers): () => void {
  const element = node as HTMLElement | null;
  if (!element?.addEventListener) return () => {};
  let session: PointerSession | null = null, pointer = -1;
  const down = (event: PointerEvent) => {
    if (event.button === 2 || session) return;
    const info = infoOf(event, element);
    if (info.onControl) return;
    const started = handlers.down?.(info);
    if (!started) return;
    session = started; pointer = event.pointerId;
    try { element.setPointerCapture(pointer); } catch { /* a synthetic pointer has nothing to capture */ }
    event.preventDefault();
  };
  const move = (event: PointerEvent) => { if (session && event.pointerId === pointer) session.move?.(infoOf(event, element)); else if (!session) handlers.hover?.(infoOf(event, element)); };
  const finish = (event: PointerEvent, cancelled: boolean) => {
    if (!session || event.pointerId !== pointer) return;
    const ended = session;
    session = null;
    try { element.releasePointerCapture(pointer); } catch { /* already released */ }
    if (cancelled) ended.cancel?.(); else ended.up?.(infoOf(event, element));
  };
  const up = (event: PointerEvent) => finish(event, false), cancel = (event: PointerEvent) => finish(event, true);
  const leave = () => { if (!session) handlers.hover?.(null); };
  const context = (event: MouseEvent) => { const info = infoOf(event, element); if (info.onControl || !handlers.context) return; event.preventDefault(); handlers.context(info); };
  const double = (event: MouseEvent) => { const info = infoOf(event, element); if (!info.onControl) handlers.double?.(info); };
  // Losing the window mid-gesture discards it, like Escape.
  const blur = () => { if (session) { const ended = session; session = null; ended.cancel?.(); } };
  element.addEventListener("pointerdown", down); element.addEventListener("pointermove", move, true); element.addEventListener("pointerup", up); element.addEventListener("pointercancel", cancel);
  element.addEventListener("pointerleave", leave); element.addEventListener("contextmenu", context); element.addEventListener("dblclick", double); window.addEventListener("blur", blur);
  return () => {
    element.removeEventListener("pointerdown", down); element.removeEventListener("pointermove", move, true); element.removeEventListener("pointerup", up); element.removeEventListener("pointercancel", cancel);
    element.removeEventListener("pointerleave", leave); element.removeEventListener("contextmenu", context); element.removeEventListener("dblclick", double); window.removeEventListener("blur", blur);
  };
}
export type WheelInfo = { deltaX: number; deltaY: number; deltaMode: number; shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean; x: number; y: number };
/** Wheel over an element; the page never scrolls or zooms under it. */
export function bindWheel(node: unknown, handler: (wheel: WheelInfo) => void): () => void {
  const element = node as HTMLElement | null;
  if (!element?.addEventListener) return () => {};
  const listener = (event: WheelEvent) => {
    event.preventDefault();
    const rect = element.getBoundingClientRect();
    handler({ deltaX: event.deltaX, deltaY: event.deltaY, deltaMode: event.deltaMode, shiftKey: event.shiftKey, altKey: event.altKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, x: event.clientX - rect.left, y: event.clientY - rect.top });
  };
  element.addEventListener("wheel", listener, { passive: false });
  return () => element.removeEventListener("wheel", listener);
}
/**
 * The size of an element, now and whenever it changes — except while a panel slides (`panelsMoving` of the design
 * system): the browser moves the boxes then, and a re-render per frame is what would make the slide stutter. The size
 * is held and the final one is delivered once, when the slide has ended. An element that is not drawn (a collapsed
 * region) keeps the size it had, so it is laid out right when it slides back in.
 */
export function observeSize(node: unknown, onSize: (size: { width: number; height: number }) => void): () => void {
  const element = node as HTMLElement | null;
  if (!element?.getBoundingClientRect) return () => {};
  let last: { width: number; height: number } | null = null;
  const report = () => {
    const rect = element.getBoundingClientRect();
    if ((rect.width === 0 && rect.height === 0 && last) || (last && last.width === rect.width && last.height === rect.height)) return;
    last = { width: rect.width, height: rect.height }; onSize(last);
  };
  const observer = new ResizeObserver(() => { if (!panelsMoving()) report(); });
  observer.observe(element); report();
  const off = onPanelMotion((moving) => { if (!moving) report(); });
  return () => { observer.disconnect(); off(); };
}
/**
 * While a panel slides, keeps what the `layers` show in step with the size of `stage` without rendering anything: each
 * frame `transformFor` gives the CSS transform that maps a layer as it was last rendered onto the stage's size at
 * that moment (null = as rendered). The transform stays until `settle` is called — by the render that has taken the
 * final size — so the picture never jumps between the last frame of the slide and that render.
 */
export function followPanelMotion(stage: unknown, layers: unknown[], transformFor: (size: { width: number; height: number }) => string | null): { settle(): void; dispose(): void } {
  const from = stage as HTMLElement | null, targets = (layers as (HTMLElement | null)[]).filter((layer): layer is HTMLElement => Boolean(layer?.style));
  if (!from?.getBoundingClientRect || targets.length === 0) return { settle() {}, dispose() {} };
  let frame = 0;
  const apply = () => { const rect = from.getBoundingClientRect(), transform = rect.width > 0 && rect.height > 0 ? transformFor({ width: rect.width, height: rect.height }) : null; for (const target of targets) { target.style.transformOrigin = "0 0"; target.style.transform = transform ?? ""; } };
  const tick = () => { apply(); frame = requestAnimationFrame(tick); };
  const off = onPanelMotion((moving) => { cancelAnimationFrame(frame); frame = 0; if (moving) frame = requestAnimationFrame(tick); else apply(); });
  return { settle() { if (!frame) for (const target of targets) target.style.transform = ""; }, dispose() { off(); cancelAnimationFrame(frame); } };
}
export type KeyInfo = { key: string; code: string; meta: boolean; ctrl: boolean; alt: boolean; shift: boolean; repeat: boolean; type: "down" | "up"; inField: boolean; inOverlay: boolean; inPreview: boolean; onButton: boolean; preventDefault(): void };
/** Every key of the window, with where the focus is: a field, an open menu or dialog, the preview region. */
export function bindKeys(handler: (key: KeyInfo) => void): () => void {
  const listener = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null, active = document.activeElement as HTMLElement | null;
    handler({
      key: event.key, code: event.code, meta: event.metaKey, ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey, repeat: event.repeat, type: event.type === "keyup" ? "up" : "down",
      inField: Boolean(target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)),
      inOverlay: Boolean(active?.closest?.('[role="dialog"], [role="menu"], [role="listbox"], [aria-modal="true"]')),
      inPreview: Boolean(active?.closest?.('[data-testid="player-canvas"]')),
      onButton: Boolean(active && active !== document.body && active.closest?.('button, [role="button"], [role="tab"], [role="slider"], [role="switch"], a')),
      preventDefault: () => event.preventDefault(),
    });
  };
  window.addEventListener("keydown", listener); window.addEventListener("keyup", listener);
  return () => { window.removeEventListener("keydown", listener); window.removeEventListener("keyup", listener); };
}
const PAYLOAD = "application/x-jagentchill";
let dragged: string | null = null;
/** Remembers what an in-app drag carries, because a drop target cannot read the payload before the drop. */
export function trackDrags(): () => void {
  const start = (event: DragEvent) => { dragged = event.dataTransfer?.getData(PAYLOAD) || null; };
  const end = () => { dragged = null; };
  window.addEventListener("dragstart", start); window.addEventListener("dragend", end); window.addEventListener("drop", end);
  return () => { window.removeEventListener("dragstart", start); window.removeEventListener("dragend", end); window.removeEventListener("drop", end); };
}
export type DropInfo = { x: number; y: number; payload: string | null; files: File[]; alt: boolean };
/** A drop target that follows the drag: `over` on every move with the payload of an in-app drag, `drop` with the files of an OS drag. */
export function bindDropZone(node: unknown, handlers: { over(info: DropInfo): boolean; leave(): void; drop(info: DropInfo): void }): () => void {
  const element = node as HTMLElement | null;
  if (!element?.addEventListener) return () => {};
  const infoOf = (event: DragEvent): DropInfo => {
    const rect = element.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top, payload: event.dataTransfer?.getData(PAYLOAD) || dragged, files: Array.from(event.dataTransfer?.files ?? []), alt: event.altKey };
  };
  const relevant = (event: DragEvent) => { const types = event.dataTransfer?.types ?? []; return types.includes(PAYLOAD) || types.includes("Files"); };
  const over = (event: DragEvent) => { if (!relevant(event)) return; if (handlers.over(infoOf(event))) { event.preventDefault(); event.stopPropagation(); if (event.dataTransfer) event.dataTransfer.dropEffect = (event.dataTransfer.types ?? []).includes(PAYLOAD) ? "move" : "copy"; } };
  const leave = (event: DragEvent) => { if (!element.contains(event.relatedTarget as Node | null)) handlers.leave(); };
  const drop = (event: DragEvent) => { if (!relevant(event)) return; event.preventDefault(); event.stopPropagation(); const info = infoOf(event); dragged = null; handlers.leave(); handlers.drop(info); };
  element.addEventListener("dragenter", over); element.addEventListener("dragover", over); element.addEventListener("dragleave", leave); element.addEventListener("drop", drop);
  return () => { element.removeEventListener("dragenter", over); element.removeEventListener("dragover", over); element.removeEventListener("dragleave", leave); element.removeEventListener("drop", drop); };
}
/** Moves the playhead line without a render: where it stands, whether it is inside the viewport, and what it says to assistive technology. */
export function placePlayhead(node: unknown, at: { left: number; shown: boolean; now: number; max: number; text: string }): void {
  const element = node as HTMLElement | null;
  if (!element?.style) return;
  const left = `${at.left}px`, display = at.shown ? "flex" : "none";
  if (element.style.left !== left) element.style.left = left;
  if (element.style.display !== display) element.style.display = display;
  if (element.getAttribute("aria-valuenow") !== String(at.now)) { element.setAttribute("aria-valuenow", String(at.now)); element.setAttribute("aria-valuemax", String(at.max)); element.setAttribute("aria-valuetext", at.text); }
}
/** Writes the text a field shows without a render (the timecode while it plays). */
export function setInputText(node: unknown, text: string): void { const element = node as HTMLInputElement | null; if (element && "value" in element && element.value !== text) element.value = text; }
/**
 * The cursor of a surface that draws its own handles (the tracks, the preview): what is under the pointer decides. A
 * handle's cursor goes through the shared drag-handle primitive, so it also holds while the handle is dragged outside
 * the surface and over the pressables inside it; anything else (`default`) clears it.
 */
export function setCursor(node: unknown, cursor: string): void {
  const element = node as HTMLElement | null;
  if (!element?.style) return;
  const handle = isHandleCursor(cursor) ? cursor : null;
  markDragHandle(element, handle);
  const own = handle ? "" : cursor;
  if (element.style.cursor !== own) element.style.cursor = own;
}
/** Some SVG children do not bubble pointermove through their React Native Web wrapper; track the painted handles on the DOM capture path. */
export function bindCursorHitTest(node: unknown, hitTest: (event: PointerEvent) => boolean): () => void {
  const element = node as HTMLElement | null;
  if (!element?.contains || typeof document === "undefined") return () => {};
  const move = (event: PointerEvent) => {
    if (element.contains(event.target as Node)) setCursor(element, hitTest(event) ? "grab" : "default");
    else if (element.hasAttribute("data-draghandle")) setCursor(element, "default");
  };
  document.addEventListener("pointermove", move, true);
  return () => document.removeEventListener("pointermove", move, true);
}
export function focusNode(node: unknown): void { (node as HTMLElement | null)?.focus?.(); }
export function toggleFullscreen(node: unknown): void {
  const element = node as HTMLElement | null;
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined); else void element?.requestFullscreen?.().catch(() => undefined);
}
export function onFullscreen(node: unknown, listener: (on: boolean) => void): () => void {
  const change = () => listener(document.fullscreenElement === node);
  document.addEventListener("fullscreenchange", change);
  return () => document.removeEventListener("fullscreenchange", change);
}
export const devicePixelRatio = (): number => window.devicePixelRatio || 1;
/** Reports a display-density change even when the CSS layout is unchanged (for example, moving a window between monitors). */
export function observeDevicePixelRatio(onChange: (ratio: number) => void): () => void {
  let query: MediaQueryList | null = null;
  const listen = () => {
    query?.removeEventListener("change", changed);
    query = window.matchMedia(`(resolution: ${devicePixelRatio()}dppx)`);
    query.addEventListener("change", changed);
  };
  const changed = () => { listen(); onChange(devicePixelRatio()); };
  listen();
  window.addEventListener("resize", changed);
  return () => { window.removeEventListener("resize", changed); query?.removeEventListener("change", changed); query = null; };
}
export const now = (): number => performance.now();
export const nextFrame = (callback: () => void): (() => void) => { const id = requestAnimationFrame(callback); return () => cancelAnimationFrame(id); };
/** Saves bytes as a download. */
export function saveBytes(bytes: Uint8Array, name: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: mime })), link = document.createElement("a");
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
export async function copyImage(bytes: Uint8Array, mime: string): Promise<boolean> {
  try { await navigator.clipboard.write([new ClipboardItem({ [mime]: new Blob([bytes as unknown as BlobPart], { type: mime }) })]); return true; } catch { return false; }
}
export type CoverCrop = { x: number; y: number; zoom: number };
export type EncodedImage = { bytes: Uint8Array; mime: "image/jpeg" | "image/png"; width: number; height: number };
/**
 * A picture cropped to an aspect ratio: the largest rectangle of that ratio, divided by the zoom (1–8) and placed by
 * `x` / `y` (0–1 of the room there is to move), then scaled so its long side is at most `maxSide`. JPEG at quality
 * 0.9, or PNG when transparency has to survive.
 */
export async function cropImage(source: Blob, ratio: number, crop: CoverCrop, maxSide: number, png = false): Promise<EncodedImage | null> {
  try {
    const bitmap = await createImageBitmap(source);
    const zoom = Math.min(8, Math.max(1, crop.zoom));
    const fit = bitmap.width / bitmap.height > ratio ? { width: bitmap.height * ratio, height: bitmap.height } : { width: bitmap.width, height: bitmap.width / ratio };
    const width = fit.width / zoom, height = fit.height / zoom;
    const left = (bitmap.width - width) * Math.min(1, Math.max(0, crop.x)), top = (bitmap.height - height) * Math.min(1, Math.max(0, crop.y));
    const scale = Math.min(1, maxSide / Math.max(width, height));
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
    canvas.getContext("2d")!.drawImage(bitmap, left, top, width, height, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const mime = png ? "image/png" : "image/jpeg";
    const blob = await canvas.convertToBlob({ type: mime, quality: 0.9 });
    return { bytes: new Uint8Array(await blob.arrayBuffer()), mime, width: canvas.width, height: canvas.height };
  } catch { return null; }
}
export const objectUrl = (bytes: Uint8Array, mime: string): string => URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: mime }));
export const releaseUrl = (url: string): void => URL.revokeObjectURL(url);
/** The pixels of an encoded picture, scaled to at most `maxSide` on its long side: RGBA bytes for analysis (histograms, colour statistics). */
export async function decodePixels(bytes: Uint8Array, mime: string, maxSide = 256): Promise<{ data: Uint8ClampedArray; width: number; height: number } | null> {
  try {
    const bitmap = await createImageBitmap(new Blob([bytes as unknown as BlobPart], { type: mime }));
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height)), width = Math.max(1, Math.round(bitmap.width * scale)), height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height), context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    return { data: context.getImageData(0, 0, width, height).data, width, height };
  } catch { return null; }
}
/** SHA-256 of bytes as lowercase hex. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
