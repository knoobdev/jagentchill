/**
 * The default bindings of the editor screen and their lookup. `Mod` is Command on macOS and Control elsewhere; a
 * binding names the physical key, so a layout that moves a letter does not move the shortcut.
 */
export type KeyPress = { key: string; code?: string; meta?: boolean; ctrl?: boolean; alt?: boolean; shift?: boolean };
export type ShortcutContext = "editor" | "preview";
type Binding = { action: string; combos: string[]; context?: ShortcutContext };

const B = (action: string, ...combos: string[]): Binding => ({ action, combos });
const P = (action: string, ...combos: string[]): Binding => ({ action, combos, context: "preview" });
export const EDITOR_BINDINGS: readonly Binding[] = [
  B("playback.toggle", "Space"), B("playback.shuttle-reverse", "J"), B("playback.shuttle-stop", "K"), B("playback.shuttle-forward", "L"),
  B("playback.frame-previous", "Left"), B("playback.frame-next", "Right"), B("playback.frames-back-10", "Shift+Left"), B("playback.frames-forward-10", "Shift+Right"),
  B("playback.jump-back", "Alt+Left"), B("playback.jump-forward", "Alt+Right"), B("playback.cut-previous", "Up"), B("playback.cut-next", "Down"),
  B("playback.go-start", "Home"), B("playback.go-end", "End"), B("range.set-in", "I"), B("range.set-out", "O"), B("range.set-to-selection", "Shift+X"), B("range.clear", "Alt+X"),
  B("playback.loop.toggle", "Mod+L"),
  B("timeline.split", "Mod+B"), B("timeline.split-all", "Mod+Shift+B"), B("timeline.delete-left", "Q"), B("timeline.delete-right", "W"), B("timeline.delete", "Delete", "Backspace"),
  B("timeline.ripple-delete", "Shift+Delete"), B("timeline.copy", "Mod+C"), B("timeline.cut", "Mod+X"), B("timeline.paste", "Mod+V"), B("timeline.duplicate", "Mod+D"),
  B("edit.undo", "Mod+Z"), B("edit.redo", "Mod+Shift+Z", "Mod+Y"), B("timeline.group", "Mod+G"), B("timeline.ungroup", "Mod+Shift+G"),
  B("timeline.compound.create", "Alt+G"), B("timeline.compound.dissolve", "Alt+Shift+G"), B("audio.extract.toggle", "Mod+Shift+S"), B("timeline.activate.toggle", "V"),
  B("timeline.toggle-hidden", "Shift+H"), B("audio.mute.toggle", "Mod+Shift+M"),
  B("timeline.nudge-left", "Mod+Left"), B("timeline.nudge-right", "Mod+Right"), B("timeline.nudge-left-10", "Mod+Shift+Left"), B("timeline.nudge-right-10", "Mod+Shift+Right"),
  B("timeline.trim-start-to-playhead", "Alt+Q"), B("timeline.trim-end-to-playhead", "Alt+W"), B("timeline.move-track-up", "Alt+Up"), B("timeline.move-track-down", "Alt+Down"),
  B("text.add", "T"), B("tools.select", "A"), B("tools.blade", "B"), B("selection.all", "Mod+A"), B("selection.none", "Mod+Shift+A"),
  B("selection.previous-clip", "["), B("selection.next-clip", "]"), B("editor.cancel", "Escape"),
  B("timeline.magnet.toggle", "P"), B("timeline.snapping.toggle", "N"), B("timeline.linkage.toggle", "`"), B("timeline.preview-axis.toggle", "S"),
  B("marker.toggle", "M"), B("marker.add-next-color", "Alt+M"), B("marker.next", "Shift+M"), B("marker.previous", "Alt+Shift+M"), B("timeline.track-lock.toggle", "Mod+Shift+L"),
  B("transition.add-default", "Mod+T", "Alt+T"), B("transition.focus-duration", "Enter"),
  B("timeline.zoom-in", "Mod+="), B("timeline.zoom-out", "Mod+-"), B("timeline.zoom-fit", "Shift+Z"),
  B("player.zoom-in", "Alt+Shift+="), B("player.zoom-out", "Alt+Shift+-"), B("player.zoom-fit", "Alt+Shift+Z"), B("player.fullscreen", "Mod+Shift+F"),
  P("preview.nudge-left", "Left"), P("preview.nudge-right", "Right"), P("preview.nudge-up", "Up"), P("preview.nudge-down", "Down"),
  P("preview.nudge-far-left", "Shift+Left"), P("preview.nudge-far-right", "Shift+Right"), P("preview.nudge-far-up", "Shift+Up"), P("preview.nudge-far-down", "Shift+Down"),
  P("preview.edit-text", "Enter"), P("preview.select-previous", "["), P("preview.select-next", "]"),
];

const CODE_KEYS: Record<string, string> = {
  Space: "Space", ArrowLeft: "Left", ArrowRight: "Right", ArrowUp: "Up", ArrowDown: "Down", Home: "Home", End: "End", Delete: "Delete", Backspace: "Backspace", Escape: "Escape", Enter: "Enter", NumpadEnter: "Enter",
  BracketLeft: "[", BracketRight: "]", Backquote: "`", Equal: "=", Minus: "-", NumpadAdd: "=", NumpadSubtract: "-", Comma: ",", Period: ".", Backslash: "\\", F2: "F2",
};
const KEY_NAMES: Record<string, string> = { " ": "Space", ArrowLeft: "Left", ArrowRight: "Right", ArrowUp: "Up", ArrowDown: "Down", Esc: "Escape", "+": "=" };
/** The key of a press as bindings name it: the physical key where the event carries one. */
export function keyName(press: KeyPress): string {
  if (press.code) {
    if (/^Key[A-Z]$/.test(press.code)) return press.code.slice(3);
    if (/^Digit\d$/.test(press.code)) return press.code.slice(5);
    if (CODE_KEYS[press.code]) return CODE_KEYS[press.code];
  }
  return KEY_NAMES[press.key] ?? (press.key.length === 1 ? press.key.toUpperCase() : press.key);
}
/** A press as a combination string in the grammar of the bindings: `Mod+Shift+B`. */
export function comboOf(press: KeyPress, mac: boolean): string {
  const mod = mac ? press.meta === true : press.ctrl === true;
  // Control on macOS and the Windows key elsewhere are not part of any default binding.
  const foreign = mac ? press.ctrl === true : press.meta === true;
  return [foreign ? "Foreign" : "", mod ? "Mod" : "", press.alt ? "Alt" : "", press.shift ? "Shift" : "", keyName(press)].filter(Boolean).join("+");
}
/**
 * The action a key press invokes. A binding of the focused context wins over an editor-wide one on the same keys
 * (the arrows nudge the selected element while the preview has focus and step frames otherwise).
 */
export function actionForKey(press: KeyPress, options: { mac: boolean; context?: ShortcutContext }): string | undefined {
  const combo = comboOf(press, options.mac);
  const matches = EDITOR_BINDINGS.filter((binding) => binding.combos.includes(combo));
  return (matches.find((binding) => binding.context !== undefined && binding.context === options.context) ?? matches.find((binding) => binding.context === undefined))?.action;
}
const MAC_GLYPHS: Record<string, string> = { Mod: "⌘", Alt: "⌥", Shift: "⇧", Left: "←", Right: "→", Up: "↑", Down: "↓", Delete: "⌦", Backspace: "⌫", Escape: "⎋", Enter: "↩" };
/** The keys of an action's current binding, as the parts a tooltip or a menu hint draws; `null` when it is unbound. */
export function bindingKeys(actionId: string, mac: boolean): string[] | null {
  const combo = EDITOR_BINDINGS.find((binding) => binding.action === actionId)?.combos[0];
  if (!combo) return null;
  return combo.split("+").map((part) => (mac ? MAC_GLYPHS[part] ?? part : part === "Mod" ? "Ctrl" : part));
}
