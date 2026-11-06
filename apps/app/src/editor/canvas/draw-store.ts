import { useSyncExternalStore } from "react";
import { DRAW_DEFAULTS, type DrawnStroke } from "@jagentchill/editor-core";

/**
 * The Draw tool: while it is on, the preview canvas takes strokes and the Stickers tab shows its controls. The strokes
 * live here until Done makes one drawing element of them; undo and redo step through them inside the mode.
 */
export type DrawState = { active: boolean; tool: "pen" | "marker" | "eraser"; color: string; width: number; strokes: DrawnStroke[]; past: DrawnStroke[][]; future: DrawnStroke[][] };
let state: DrawState = { active: false, tool: "pen", color: DRAW_DEFAULTS.color, width: DRAW_DEFAULTS.width, strokes: [], past: [], future: [] };
const listeners = new Set<() => void>();
const set = (change: Partial<DrawState>) => { state = { ...state, ...change }; for (const listener of [...listeners]) listener(); };
const record = (strokes: DrawnStroke[]) => set({ strokes, past: [...state.past, state.strokes], future: [] });
export const draw = {
  get state(): DrawState { return state; },
  start(): void { set({ active: true, strokes: [], past: [], future: [] }); },
  /** Leaves the mode; the strokes are handed to the caller (Done) or dropped (Cancel). */
  finish(): DrawnStroke[] { const strokes = state.strokes; set({ active: false, strokes: [], past: [], future: [], tool: state.tool === "eraser" ? "pen" : state.tool }); return strokes; },
  setTool(tool: DrawState["tool"]): void { set({ tool }); },
  setColor(color: string): void { set({ color }); },
  setWidth(width: number): void { set({ width: Math.min(200, Math.max(1, Math.round(width))) }); },
  add(stroke: DrawnStroke): void { record([...state.strokes, stroke]); },
  /** The eraser removes whole strokes: the ones at these indexes. */
  erase(indexes: number[]): void { if (indexes.length > 0) record(state.strokes.filter((_, index) => !indexes.includes(index))); },
  undo(): void { const previous = state.past[state.past.length - 1]; if (previous) set({ strokes: previous, past: state.past.slice(0, -1), future: [state.strokes, ...state.future] }); },
  redo(): void { const [next, ...rest] = state.future; if (next) set({ strokes: next, past: [...state.past, state.strokes], future: rest }); },
};
export function useDraw(): DrawState {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => void listeners.delete(listener); }, () => state, () => state);
}
