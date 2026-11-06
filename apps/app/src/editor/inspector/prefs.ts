import { preference } from "@jagentchill/app-core";

/** What the inspector tools keep per device: saved looks and curves, and how the graph editor was left. */
export type AdjustmentPreset = { name: string; adjustments: Record<string, unknown> };
export type SavedEasing = { name: string; bezier: [number, number, number, number] };
const isList = <T>(check: (value: unknown) => boolean) => (value: unknown): value is T[] => Array.isArray(value) && value.every(check);
const named = (value: unknown): boolean => value !== null && typeof value === "object" && typeof (value as { name?: unknown }).name === "string";
export const INSPECTOR_PREFS = {
  adjustmentPresets: preference<AdjustmentPreset[]>("adjustment.presets", [], isList<AdjustmentPreset>((value) => named(value) && typeof (value as AdjustmentPreset).adjustments === "object")),
  easings: preference<SavedEasing[]>("graph.easings", [], isList<SavedEasing>((value) => named(value) && Array.isArray((value as SavedEasing).bezier) && (value as SavedEasing).bezier.length === 4 && (value as SavedEasing).bezier.every(Number.isFinite))),
  graph: preference<{ view: "curves" | "easing"; height: number }>("graph.view", { view: "curves", height: 240 }, (value): value is { view: "curves" | "easing"; height: number } => value !== null && typeof value === "object" && ["curves", "easing"].includes((value as { view: string }).view) && Number.isFinite((value as { height: number }).height)),
};
