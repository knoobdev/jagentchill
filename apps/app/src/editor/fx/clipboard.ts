import type { timeline } from "@jagentchill/editor-core";

// What "Copy effects" took: it lives as long as the app session, like a clipboard.
let copied: timeline.EffectClipboard | null = null;
export const copiedEffects = (): timeline.EffectClipboard | null => copied;
export const hasCopiedEffects = (): boolean => copied !== null;
export function setCopiedEffects(clipboard: timeline.EffectClipboard | null): void { copied = clipboard; }
