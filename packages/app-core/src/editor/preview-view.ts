/** The preview's view of the canvas: zoom relative to fit, pan, and the mapping between screen and canvas pixels. */
export type Size = { width: number; height: number };
export type Point = { x: number; y: number };
export type PreviewView = { zoom: number; pan: Point };
export const PREVIEW_ZOOM = { min: 0.25, max: 16, step: 1.25, presets: [25, 50, 75, 100, 150, 200] } as const;
export const FIT_VIEW: PreviewView = { zoom: 1, pan: { x: 0, y: 0 } };

/** Screen px per canvas px at zoom 1: the whole canvas fits the viewport. */
export const fitScale = (viewport: Size, canvas: Size): number => Math.min(viewport.width / canvas.width, viewport.height / canvas.height);
export const displayScale = (view: PreviewView, viewport: Size, canvas: Size): number => fitScale(viewport, canvas) * view.zoom;
export const clampPreviewZoom = (zoom: number): number => Math.min(PREVIEW_ZOOM.max, Math.max(PREVIEW_ZOOM.min, zoom));
/** A preset is an absolute percentage of native canvas pixels. */
export const presetZoom = (percent: number, viewport: Size, canvas: Size): number => clampPreviewZoom(percent / 100 / fitScale(viewport, canvas));
/** "Fit" at zoom 1, otherwise the display scale as a percentage. */
export const zoomLabel = (view: PreviewView, viewport: Size, canvas: Size): string => (Math.abs(view.zoom - 1) <= 0.001 ? "Fit" : `${Math.round(displayScale(view, viewport, canvas) * 100)}%`);

/**
 * The pan centre kept legal: on an axis where the canvas is larger than the viewport it always covers the
 * viewport; on an axis where it fits it is centred. `pan` is the offset of the canvas centre from the viewport
 * centre, in screen px.
 */
export function clampPan(view: PreviewView, viewport: Size, canvas: Size): PreviewView {
  const scale = displayScale(view, viewport, canvas);
  const axis = (pan: number, canvasSide: number, viewportSide: number) => { const spare = (canvasSide * scale - viewportSide) / 2; return spare <= 0 ? 0 : Math.min(spare, Math.max(-spare, pan)); };
  return { zoom: view.zoom, pan: { x: axis(view.pan.x, canvas.width, viewport.width), y: axis(view.pan.y, canvas.height, viewport.height) } };
}
/** Where the canvas is drawn in the viewport, in screen px. */
export function canvasRect(view: PreviewView, viewport: Size, canvas: Size): { left: number; top: number; width: number; height: number; scale: number } {
  const scale = displayScale(view, viewport, canvas), width = canvas.width * scale, height = canvas.height * scale;
  return { left: (viewport.width - width) / 2 + view.pan.x, top: (viewport.height - height) / 2 + view.pan.y, width, height, scale };
}
/** A viewport point as canvas coordinates with the origin at the canvas centre — the space of `transform.position`. */
export function toCanvas(point: Point, view: PreviewView, viewport: Size, canvas: Size): Point {
  const rect = canvasRect(view, viewport, canvas);
  return { x: (point.x - rect.left) / rect.scale - canvas.width / 2, y: (point.y - rect.top) / rect.scale - canvas.height / 2 };
}
export function toScreen(point: Point, view: PreviewView, viewport: Size, canvas: Size): Point {
  const rect = canvasRect(view, viewport, canvas);
  return { x: rect.left + (point.x + canvas.width / 2) * rect.scale, y: rect.top + (point.y + canvas.height / 2) * rect.scale };
}

/** Zoom by a command or a preset keeps the view centre fixed; by wheel or pinch it keeps the canvas point under `anchor` fixed. */
export function zoomTo(view: PreviewView, zoom: number, viewport: Size, canvas: Size, anchor?: Point): PreviewView {
  const next = clampPreviewZoom(zoom), ratio = next / view.zoom;
  const centre = { x: viewport.width / 2, y: viewport.height / 2 }, about = anchor ?? centre;
  // The canvas centre sits at `centre + pan`; scaling about a point moves it along the line through that point.
  const pan = { x: about.x - centre.x + (centre.x + view.pan.x - about.x) * ratio, y: about.y - centre.y + (centre.y + view.pan.y - about.y) * ratio };
  return clampPan({ zoom: next, pan }, viewport, canvas);
}
export const zoomInView = (view: PreviewView, viewport: Size, canvas: Size): PreviewView => zoomTo(view, view.zoom * PREVIEW_ZOOM.step, viewport, canvas);
export const zoomOutView = (view: PreviewView, viewport: Size, canvas: Size): PreviewView => zoomTo(view, view.zoom / PREVIEW_ZOOM.step, viewport, canvas);
/** `Mod` + wheel: factor `exp(−delta / 300)`, the delta of one animation frame capped at ±30, about the cursor. */
export const wheelZoomView = (view: PreviewView, deltaPerFrame: number, viewport: Size, canvas: Size, cursor: Point): PreviewView =>
  zoomTo(view, view.zoom * Math.exp(-Math.min(30, Math.max(-30, deltaPerFrame)) / 300), viewport, canvas, cursor);
/** Plain wheel pans on both axes while zoomed in: line-mode deltas ×16, page-mode deltas × the viewport size. Nothing happens at zoom ≤ 1. */
export function wheelPan(view: PreviewView, wheel: { deltaX: number; deltaY: number; deltaMode?: number }, viewport: Size, canvas: Size): PreviewView {
  if (view.zoom <= 1) return view;
  const unit = (side: number) => (wheel.deltaMode === 1 ? 16 : wheel.deltaMode === 2 ? side : 1);
  return clampPan({ zoom: view.zoom, pan: { x: view.pan.x - wheel.deltaX * unit(viewport.width), y: view.pan.y - wheel.deltaY * unit(viewport.height) } }, viewport, canvas);
}
/** Middle-button drag, Space + drag and two-finger drag: the view follows the pointer, while zoomed in. */
export const dragPan = (view: PreviewView, delta: Point, viewport: Size, canvas: Size): PreviewView =>
  (view.zoom <= 1 ? view : clampPan({ zoom: view.zoom, pan: { x: view.pan.x + delta.x, y: view.pan.y + delta.y } }, viewport, canvas));
/** The zoom select: Fit, a separator, then the presets. */
export const zoomOptions = (): ({ id: "fit"; label: "Fit" } | { separator: true } | { id: string; label: string; percent: number })[] =>
  [{ id: "fit", label: "Fit" }, { separator: true }, ...PREVIEW_ZOOM.presets.map((percent) => ({ id: String(percent), label: `${percent}%`, percent }))];

// — Guides —
export type SafeAreaPreset = { id: string; label: string; vertical: boolean; margins(canvas: Size): { top: number; bottom: number; left: number; right: number } };
const centred = (fraction: number) => (canvas: Size) => ({ top: (canvas.height * (1 - fraction)) / 2, bottom: (canvas.height * (1 - fraction)) / 2, left: (canvas.width * (1 - fraction)) / 2, right: (canvas.width * (1 - fraction)) / 2 });
// Margins of the vertical presets are stated for a 1080 × 1920 reference and scale with the canvas.
const vertical = (top: number, bottom: number, left: number, right: number) => (canvas: Size) => ({ top: (top / 1920) * canvas.height, bottom: (bottom / 1920) * canvas.height, left: (left / 1080) * canvas.width, right: (right / 1080) * canvas.width });
export const SAFE_AREA_PRESETS: readonly SafeAreaPreset[] = [
  { id: "title-safe", label: "Title safe", vertical: false, margins: centred(0.9) },
  { id: "action-safe", label: "Action safe", vertical: false, margins: centred(0.93) },
  { id: "vertical-rail-right", label: "Vertical feed — side buttons", vertical: true, margins: vertical(130, 370, 60, 140) },
  { id: "vertical-tall-caption", label: "Vertical feed — tall caption area", vertical: true, margins: vertical(220, 420, 35, 35) },
  { id: "vertical-wide-rail", label: "Vertical feed — wide side buttons", vertical: true, margins: vertical(190, 380, 60, 190) },
  { id: "vertical-compact", label: "Vertical feed — compact", vertical: true, margins: vertical(150, 340, 60, 150) },
];
export const isVerticalCanvas = (canvas: Size): boolean => Math.abs(canvas.width / canvas.height - 9 / 16) < 0.001;
/** A vertical preset applies only to a 9:16 canvas; elsewhere it is disabled with "Available for 9:16 projects". */
export const safeAreaAvailable = (preset: SafeAreaPreset, canvas: Size): boolean => !preset.vertical || isVerticalCanvas(canvas);
/** The safe rectangle in canvas px from the top-left corner. */
export function safeAreaRect(presetId: string, canvas: Size): { x: number; y: number; width: number; height: number } | null {
  const preset = SAFE_AREA_PRESETS.find((entry) => entry.id === presetId);
  if (!preset || !safeAreaAvailable(preset, canvas)) return null;
  const margins = preset.margins(canvas);
  return { x: margins.left, y: margins.top, width: canvas.width - margins.left - margins.right, height: canvas.height - margins.top - margins.bottom };
}
export const GRID_LIMITS = { min: 1, max: 24, rows: 3, columns: 3 } as const;
export const clampGrid = (value: number): number => Math.min(GRID_LIMITS.max, Math.max(GRID_LIMITS.min, Math.round(value)));
/** The inner lines of the grid, in canvas px from the top-left corner. */
export function gridLines(rows: number, columns: number, canvas: Size): { vertical: number[]; horizontal: number[] } {
  const cut = (count: number, side: number) => Array.from({ length: clampGrid(count) - 1 }, (_, index) => (side * (index + 1)) / clampGrid(count));
  return { vertical: cut(columns, canvas.width), horizontal: cut(rows, canvas.height) };
}
export type GuideSettings = { visible: boolean; grid: { on: boolean; rows: number; columns: number }; safeArea: { on: boolean; preset: string }; custom: { on: boolean; vertical: number[]; horizontal: number[] }; snap: boolean };
export const GUIDE_DEFAULTS: GuideSettings = { visible: true, grid: { on: false, rows: 3, columns: 3 }, safeArea: { on: false, preset: "title-safe" }, custom: { on: false, vertical: [], horizontal: [] }, snap: true };
/** The guides button shows its active state while any guide is on. */
export const anyGuideOn = (guides: GuideSettings): boolean => guides.grid.on || guides.safeArea.on || guides.custom.on;
export const isGuideSettings = (value: unknown): value is GuideSettings => {
  const guides = value as GuideSettings | null;
  return guides !== null && typeof guides === "object" && typeof guides.visible === "boolean" && typeof guides.snap === "boolean" && typeof guides.grid?.on === "boolean" && Number.isFinite(guides.grid.rows) && Number.isFinite(guides.grid.columns)
    && typeof guides.safeArea?.on === "boolean" && typeof guides.safeArea.preset === "string" && typeof guides.custom?.on === "boolean" && Array.isArray(guides.custom.vertical) && Array.isArray(guides.custom.horizontal);
};
