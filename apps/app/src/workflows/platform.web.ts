/** The wheel and the paste command of a browser window. */
export type WheelInfo = { dx: number; dy: number; zoom: boolean; x: number; y: number };
export function bindWheel(node: unknown, handler: (info: WheelInfo) => void): () => void {
  const element = node as HTMLElement | null;
  if (!element?.addEventListener) return () => {};
  const wheel = (event: WheelEvent) => {
    event.preventDefault();
    const box = element.getBoundingClientRect();
    handler({ dx: event.deltaX, dy: event.deltaY, zoom: event.ctrlKey || event.metaKey, x: event.clientX - box.left, y: event.clientY - box.top });
  };
  element.addEventListener("wheel", wheel, { passive: false });
  return () => element.removeEventListener("wheel", wheel);
}
export function onPasteText(handler: (text: string) => void): () => void {
  const paste = (event: ClipboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
    const text = event.clipboardData?.getData("text/plain");
    if (text) handler(text);
  };
  window.addEventListener("paste", paste);
  return () => window.removeEventListener("paste", paste);
}
export const readFileText = (file: unknown): Promise<string> => (file as Blob).text();
/** Whether a view is on screen: a screen kept in the navigation history is hidden and must not act on keys. */
export const isShown = (node: unknown): boolean => { const element = node as HTMLElement | null; return !!element && element.getClientRects().length > 0; };
/** The pointer hovering over a view, in the view's own coordinates; null when it leaves. */
export function bindHover(node: unknown, handler: (point: { x: number; y: number } | null) => void): () => void {
  const element = node as HTMLElement | null;
  if (!element?.addEventListener) return () => {};
  let frame = 0, last: MouseEvent | null = null;
  const move = (event: MouseEvent) => {
    last = event;
    // One answer per frame: the pointer reports far more often than the canvas can draw.
    frame ||= requestAnimationFrame(() => { frame = 0; if (!last) return; const box = element.getBoundingClientRect(); handler({ x: last.clientX - box.left, y: last.clientY - box.top }); });
  };
  const leave = () => { last = null; handler(null); };
  element.addEventListener("mousemove", move);
  element.addEventListener("mouseleave", leave);
  return () => { cancelAnimationFrame(frame); element.removeEventListener("mousemove", move); element.removeEventListener("mouseleave", leave); };
}
export const canRasterise = true;
/** A drawing as a PNG, `scale` device pixels per unit. */
export function svgToPng(svg: string, width: number, height: number, scale = 2): Promise<Blob | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" })), image = new Image();
    const done = (blob: Blob | null) => { URL.revokeObjectURL(url); resolve(blob); };
    image.onload = () => {
      // A canvas has a largest side; a very wide workflow is drawn at a lower scale rather than not at all.
      const fit = Math.min(scale, 8192 / Math.max(width, height, 1));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width * fit)); canvas.height = Math.max(1, Math.round(height * fit));
      const context = canvas.getContext("2d");
      if (!context) return done(null);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(done, "image/png");
    };
    image.onerror = () => done(null);
    image.src = url;
  });
}
