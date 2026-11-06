import type { Environment, OsPlatform } from "./os.ts";
export const DEFAULT_WINDOW = { width: 1440, height: 900 } as const;
export const MIN_VIEWPORT = { width: 960, height: 600 } as const;
export const UI_SCALES = [0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5] as const;
export const MAC_TRAFFIC_LIGHT_INSET = 78;

export type Rect = { x: number; y: number; width: number; height: number };
export type Display = { workArea: Rect; primary?: boolean };
export type WindowState = { x?: number; y?: number; width: number; height: number; maximized?: boolean; fullscreen?: boolean; route?: string };

/** The smallest window at a UI scale: the effective viewport never falls below 960×600 CSS px. */
export const minimumSize = (uiScale: number): { width: number; height: number } => ({ width: Math.round(MIN_VIEWPORT.width * uiScale), height: Math.round(MIN_VIEWPORT.height * uiScale) });
/** The largest UI scale whose minimum window still fits the work area. */
export function maxUiScale(workArea: Pick<Rect, "width" | "height">): number {
  const fitting = UI_SCALES.filter((scale) => minimumSize(scale).width <= workArea.width && minimumSize(scale).height <= workArea.height);
  return fitting.length ? fitting[fitting.length - 1] : UI_SCALES[0];
}
export const stepUiScale = (current: number, direction: 1 | -1 | 0, limit = 1.5): number => {
  if (direction === 0) return 1;
  const next = Math.round((current + direction * 0.1) * 10) / 10;
  return Math.min(Math.min(1.5, limit), Math.max(0.8, next));
};

const centred = (area: Rect, width: number, height: number): Rect => ({ x: Math.round(area.x + (area.width - width) / 2), y: Math.round(area.y + (area.height - height) / 2), width, height });
const overlap = (a: Rect, b: Rect): number => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

/**
 * Where a window opens. A remembered position that is on a connected display is kept; one that is on no display any
 * more is centred on the primary display at the remembered size, clamped to that display. A first window is 1440×900
 * centred on the active display.
 */
export function restoreBounds(saved: WindowState | null | undefined, displays: readonly Display[], opts: { uiScale?: number; active?: Display } = {}): Rect & { maximized: boolean; fullscreen: boolean } {
  const primary = displays.find((display) => display.primary) ?? displays[0];
  const min = minimumSize(opts.uiScale ?? 1);
  const flags = { maximized: saved?.maximized === true, fullscreen: saved?.fullscreen === true };
  const fit = (area: Rect, width: number, height: number) => ({ width: Math.min(Math.max(width, Math.min(min.width, area.width)), area.width), height: Math.min(Math.max(height, Math.min(min.height, area.height)), area.height) });
  if (!saved || !Number.isFinite(saved.width) || !Number.isFinite(saved.height)) {
    const area = (opts.active ?? primary).workArea, size = fit(area, DEFAULT_WINDOW.width, DEFAULT_WINDOW.height);
    return { ...centred(area, size.width, size.height), ...flags };
  }
  if (saved.x !== undefined && saved.y !== undefined) {
    const wanted: Rect = { x: saved.x, y: saved.y, width: saved.width, height: saved.height };
    // Enough of the window must be on a display to grab its title bar.
    const home = displays.find((display) => overlap(wanted, display.workArea) >= 100 * 40);
    if (home) { const size = fit(home.workArea, saved.width, saved.height); return { x: saved.x, y: saved.y, ...size, ...flags }; }
  }
  const size = fit(primary.workArea, saved.width, saved.height);
  return { ...centred(primary.workArea, size.width, size.height), ...flags };
}

export type ControlsLayout = { side: "start" | "end" | "none"; buttons: ("minimize" | "maximize" | "close")[]; inset: number; drawn: "native" | "app" };
const NAMES: Record<string, "minimize" | "maximize" | "close"> = { minimize: "minimize", maximize: "maximize", close: "close" };
const BUTTON_WIDTH = 46;
/**
 * The app-drawn window buttons on Linux follow the desktop's `button-layout` (`"close,minimize:"`, `":minimize,maximize,close"`).
 * When it cannot be read the default is minimise, maximise, close at the inline end.
 */
export function linuxControls(buttonLayout: string | null | undefined): { start: ControlsLayout["buttons"]; end: ControlsLayout["buttons"] } {
  const fallback = { start: [], end: ["minimize", "maximize", "close"] as ControlsLayout["buttons"] };
  if (typeof buttonLayout !== "string") return fallback;
  const text = buttonLayout.trim().replace(/^'|'$/g, "");
  if (!text.includes(":")) return fallback;
  const [left, right] = text.split(":");
  const parse = (side: string) => side.split(",").map((name) => NAMES[name.trim()]).filter((name): name is "minimize" | "maximize" | "close" => name !== undefined);
  return { start: parse(left ?? ""), end: parse(right ?? "") };
}
/** The width the top bar keeps free for window controls, and the side it is on. */
export function controlsLayout(platform: OsPlatform, opts: { linuxButtonLayout?: string | null; overlayWidth?: number } = {}): { start: ControlsLayout; end: ControlsLayout } {
  const none: ControlsLayout = { side: "none", buttons: [], inset: 0, drawn: "native" };
  if (platform === "darwin") return { start: { side: "start", buttons: ["close", "minimize", "maximize"], inset: MAC_TRAFFIC_LIGHT_INSET, drawn: "native" }, end: none };
  if (platform === "win32") return { start: none, end: { side: "end", buttons: ["minimize", "maximize", "close"], inset: opts.overlayWidth ?? 3 * BUTTON_WIDTH, drawn: "native" } };
  const layout = linuxControls(opts.linuxButtonLayout);
  const group = (side: "start" | "end", buttons: ControlsLayout["buttons"]): ControlsLayout => (buttons.length ? { side, buttons, inset: buttons.length * BUTTON_WIDTH, drawn: "app" } : { ...none, drawn: "app" });
  return { start: group("start", layout.start), end: group("end", layout.end) };
}

/** What closing the last window does. */
export function lastWindowClosed(input: { platform: OsPlatform; keepInTray: boolean; trayAvailable: boolean; hostJobs: number }): "stay" | "hide-to-tray" | "ask" | "quit" {
  if (input.platform === "darwin") return "stay";
  if (input.keepInTray && input.trayAvailable) return "hide-to-tray";
  return input.hostJobs > 0 ? "ask" : "quit";
}
export function quitChoices(input: { jobs: number; trayAvailable: boolean }): { message: string; choices: string[] } {
  return {
    message: `${input.jobs} ${input.jobs === 1 ? "task is" : "tasks are"} still running on this computer`,
    choices: [input.trayAvailable ? "Keep running in the background" : "Keep the host running — reopen JAgentChill from the launcher", "Quit anyway", "Cancel"],
  };
}
