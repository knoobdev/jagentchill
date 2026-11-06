import type { OsName } from "../platform/types.ts";

const APPLE: Record<string, string> = { Mod: "⌘", Meta: "⌘", Cmd: "⌘", Alt: "⌥", Option: "⌥", Shift: "⇧", Ctrl: "⌃", Control: "⌃" };
const OTHER: Record<string, string> = { Mod: "Ctrl", Meta: "Win", Cmd: "Ctrl", Alt: "Alt", Option: "Alt", Shift: "Shift", Ctrl: "Ctrl", Control: "Ctrl" };
const ARROWS: Record<string, string> = { ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", Left: "←", Right: "→", Up: "↑", Down: "↓" };
const NAMED: Record<string, Record<string, string>> = {
  en: { Space: "Space", Enter: "Enter", Escape: "Esc", Backspace: "Backspace", Delete: "Delete", Tab: "Tab", Home: "Home", End: "End", PageUp: "Page Up", PageDown: "Page Down" },
  vi: { Space: "Dấu cách", Enter: "Enter", Escape: "Esc", Backspace: "Backspace", Delete: "Delete", Tab: "Tab", Home: "Home", End: "End", PageUp: "Page Up", PageDown: "Page Down" },
  ja: { Space: "スペース", Enter: "Enter", Escape: "Esc", Backspace: "Backspace", Delete: "Delete", Tab: "Tab", Home: "Home", End: "End", PageUp: "Page Up", PageDown: "Page Down" },
};
export const isApple = (os: OsName) => os === "mac" || os === "ios";

/** Keycap labels of a binding on a platform: ⌘ ⌥ ⇧ ⌃ on macOS and iOS, words elsewhere; arrows as glyphs; named keys localised. */
export function keycaps(keys: readonly string[], os: OsName, locale = "en"): string[] {
  const modifiers = isApple(os) ? APPLE : OTHER;
  const named = NAMED[locale.toLowerCase().slice(0, 2)] ?? NAMED.en!;
  return keys.map((key) => modifiers[key] ?? ARROWS[key] ?? named[key] ?? (key.length === 1 ? key.toUpperCase() : key));
}
/** A chord separator: a thin space between keycaps on macOS and iOS, " + " elsewhere. */
export const chordSeparator = (os: OsName) => (isApple(os) ? " " : " + ");
export const shortcutText = (keys: readonly string[], os: OsName, locale = "en") => keycaps(keys, os, locale).join(chordSeparator(os));

/** A menu title with a mnemonic: "&File" → label "File", mnemonic "f", index 0. */
export function mnemonicOf(title: string): { label: string; mnemonic: string | null; index: number } {
  const at = title.indexOf("&");
  if (at < 0 || at === title.length - 1) return { label: title, mnemonic: null, index: -1 };
  return { label: title.slice(0, at) + title.slice(at + 1), mnemonic: title[at + 1]!.toLowerCase(), index: at };
}

/**
 * Tracks Alt for the in-window application menu. Alt+letter opens that top-level menu and F10 the first one; a bare press
 * and release of Alt does nothing, so Alt-modified pointer gestures and shortcuts never move focus into the menu.
 */
export function appMenuKeys(titles: readonly string[], platform: OsName) {
  let altHeld = false;
  return {
    /** Returns the index of the top-level menu to open, or null. */
    keyDown(key: { key: string; alt: boolean; ctrl: boolean; meta: boolean }): number | null {
      if (platform === "mac") return null;
      if (key.key === "Alt") { altHeld = true; return null; }
      if (key.key === "F10" && !key.alt && !key.ctrl && !key.meta) return titles.length > 0 ? 0 : null;
      if (key.alt && !key.ctrl && !key.meta && key.key.length === 1) {
        const index = titles.findIndex((title) => mnemonicOf(title).mnemonic === key.key.toLowerCase());
        return index >= 0 ? index : null;
      }
      return null;
    },
    /** Releasing Alt never opens the menu. */
    keyUp(key: { key: string }): null { if (key.key === "Alt") altHeld = false; return null; },
    /** Mnemonic underlines are drawn only while Alt is held. */
    showMnemonics: () => altHeld,
  };
}
