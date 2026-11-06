import { useSyncExternalStore } from "react";
import { preference } from "@jagentchill/app-core";
import type { CopiedTextStyle, SavedTextPreset } from "@jagentchill/editor-core";

/** "My presets" of the Text tab: the styles the user saved, kept per device. */
export const SAVED_TEXT_PRESETS = preference<SavedTextPreset[]>("editor.text-presets", [], (value): value is SavedTextPreset[] =>
  Array.isArray(value) && value.every((entry) => entry !== null && typeof entry === "object" && typeof (entry as SavedTextPreset).id === "string" && typeof (entry as SavedTextPreset).name === "string" && typeof (entry as SavedTextPreset).style === "object"));

// The style "Copy style" took: it lives as long as the app session, like a clipboard.
let copied: CopiedTextStyle | null = null;
const listeners = new Set<() => void>();
export function setCopiedTextStyle(style: CopiedTextStyle | null): void { copied = style; for (const listener of [...listeners]) listener(); }
export function useCopiedTextStyle(): CopiedTextStyle | null {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => void listeners.delete(listener); }, () => copied, () => null);
}
