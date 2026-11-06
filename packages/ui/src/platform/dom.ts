/** Native implementation of the host-environment services the components use. The web one is `dom.web.ts`. */
import { AccessibilityInfo, BackHandler, Platform } from "react-native";
import * as Clipboard from "expo-clipboard";
import type { HandleCursor } from "../logic/draghandle.ts";
import type { KeyInfo, OsName, PreferenceStorage } from "./types.ts";

export const hasDom = false;
export const osName = (): OsName => (Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : Platform.OS === "macos" ? "mac" : Platform.OS === "windows" ? "windows" : "linux");
/** Touch is the primary pointer on iOS and Android. */
export function watchCoarsePointer(listener: (coarse: boolean) => void): () => void { listener(true); return () => {}; }
export function watchReducedMotion(listener: (reduce: boolean) => void): () => void {
  void AccessibilityInfo.isReduceMotionEnabled().then(listener);
  const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", listener);
  return () => subscription.remove();
}
/** A hardware keyboard is the only source of focus events on native, so focus is always keyboard focus. */
export const isKeyboardModality = () => true;
/** The system back action is delivered as Escape, so overlays close on it. */
export function onGlobalKey(handler: (key: KeyInfo) => boolean | void): () => void {
  const subscription = BackHandler.addEventListener("hardwareBackPress", () => handler({ key: "Escape", shift: false, alt: false, ctrl: false, meta: false, repeat: false, preventDefault() {} }) === true);
  return () => subscription.remove();
}
export function onGlobalKeyUp(_handler: (key: KeyInfo) => void): () => void { return () => {}; }
export function setThemeColor(_color: string): void {}
let memory = new Map<string, string>();
export const defaultStorage: PreferenceStorage = { get: (key) => memory.get(key) ?? null, set: (key, value) => { memory.set(key, value); } };
/** Native has no localStorage: the side sheet's width only lasts for the run, through the module variable that owns it. */
export const SHEET_WIDTH_KEY = "jagentchill.ui.sideSheetWidth";
export function loadSheetWidth(): string | null { return null; }
export function storeSheetWidth(_width: number): void {}
export const copyText = (text: string): Promise<void> => Clipboard.setStringAsync(text).then(() => undefined);
export const readClipboard = (): Promise<string> => Clipboard.getStringAsync();
export function focusedElement(): unknown { return null; }
export function focusElement(target: unknown): void { (target as { focus?(): void } | null)?.focus?.(); }
export function focusFirstIn(_root: unknown, _selector?: string): void {}
export function cycleFocus(_root: unknown, _backwards: boolean): boolean { return false; }
export function setInert(_target: unknown, _inert: boolean): void {}
export function lockScroll(): () => void { return () => {}; }
/** Native screens that leave the front are frozen by the navigator and React disconnects their layout effects: nothing to watch here. */
/** The web applies the updates before returning. React Native has no such call: the updates are queued, and `false` tells the caller to wait for them. */
export function commitNow(update: () => void): boolean { update(); return false; }
export function watchHidden(_node: () => unknown, _onChange: (hidden: boolean) => void): () => void { return () => {}; }
export const hasEyeDropper = () => false;
export const pickScreenColor = (): Promise<string | null> => Promise.resolve(null);
export function lockPointer(_target: unknown): () => void { return () => {}; }
export function onViewportScroll(_listener: () => void): () => void { return () => {}; }
export function onPointerMoveUp(_move: (dx: number, dy: number, key: { shift: boolean; alt: boolean }, x: number, y: number) => void, _up: () => void): () => void { return () => {}; }
export const directionOfDocument = (): "ltr" | "rtl" => "ltr";
export function resetForTests(): void { memory = new Map(); }
export type Glide = { node: unknown; property: "width" | "height" | "flexGrow" | "transform"; from: string; to: string };
/** Native panels slide with the Animated API: there is no CSS transition to hand the motion to. */
export const cssMotion = (): boolean => false;
export function cssGlide(_glides: Glide[], _ms: number, _ease: string, done: () => void): (finish?: boolean) => void { done(); return () => {}; }
export function gateResizeObservers(_moving: () => boolean, _onEnd: (listener: () => void) => void): void {}
export const computedSize = (_node: unknown, _property: "width" | "height"): number => 0;
export const computedStyleOf = (_node: unknown, _property: "flexGrow" | "transform"): string => "";
export function setInlineStyle(_node: unknown, _style: Partial<Record<Glide["property"] | "transition", string>>): void {}
/** A finger has no cursor: handles are marked on the web only. */
export function markHandle(_node: unknown, _attribute: string, _cursor: HandleCursor | null): void {}
export function beginDragCursor(_cursor: HandleCursor): () => void { return () => {}; }
