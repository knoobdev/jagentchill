/** Browser helpers of the library tabs: which tiles are in view, and the still that covers the preview while tiles are rendered. */

/** Reports once when an element first comes within a screen of the viewport: a tile asks for its picture then. */
export function whenVisible(node: unknown, onVisible: () => void): () => void {
  const element = node as HTMLElement | null;
  if (!element || typeof IntersectionObserver === "undefined") { onVisible(); return () => {}; }
  const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) { observer.disconnect(); onVisible(); } }, { rootMargin: "200px" });
  observer.observe(element);
  return () => observer.disconnect();
}
/** The size of the preview canvas on screen, in device pixels; `null` when it is not shown. */
export function previewSize(): { width: number; height: number } | null {
  const host = document.querySelector('[data-testid="canvas"]') as HTMLElement | null, rect = host?.getBoundingClientRect();
  if (!rect || rect.width < 1 || rect.height < 1) return null;
  const ratio = window.devicePixelRatio || 1;
  return { width: Math.max(16, Math.round(rect.width * ratio)), height: Math.max(16, Math.round(rect.height * ratio)) };
}
/**
 * Holds a picture of the current frame over the preview canvas. The engine has one canvas: while it renders tiles
 * into it, the preview keeps showing the frame it had. Returns the function that takes the picture away.
 */
export function coverPreview(url: string): () => void {
  const host = document.querySelector('[data-testid="canvas"]') as HTMLElement | null;
  if (!host) return () => {};
  const image = document.createElement("img");
  image.src = url; image.alt = ""; image.draggable = false;
  image.setAttribute("data-fx-cover", "");
  image.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;";
  host.appendChild(image);
  return () => image.remove();
}
export const nextPaint = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
/** The tracks viewport of the timeline: tiles are dropped on it. */
export const tracksElement = (): unknown => document.querySelector('[data-testid="timeline-tracks"]');
/** A press on the tracks that does not land on a transition handle: the selected transition is deselected. */
export function onTracksPress(listener: () => void): () => void {
  const element = document.querySelector('[data-testid="timeline-tracks"]') as HTMLElement | null;
  if (!element) return () => {};
  const down = (event: PointerEvent) => { if (event.button === 0 && !(event.target as HTMLElement | null)?.closest?.('[data-testid^="tl-ctl-transition-"], [data-testid^="tl-ctl-cut-"]')) listener(); };
  element.addEventListener("pointerdown", down);
  return () => element.removeEventListener("pointerdown", down);
}
/** Focuses (and selects) the text field inside the element of an id. */
export function focusInput(id: string): void { const input = document.getElementById(id)?.querySelector("input") as HTMLInputElement | null; input?.focus(); input?.select?.(); }
/** The vertical middle of each row, by element id, in viewport pixels: where a dragged row would be dropped. */
export const rowMiddles = (ids: string[]): number[] => ids.map((id) => { const rect = document.getElementById(id)?.getBoundingClientRect(); return rect ? rect.top + Math.min(rect.height, 32) / 2 : Number.MAX_SAFE_INTEGER; });
