/** Browser and Electron implementation of the host-environment services the components use. */
import { flushSync } from "react-dom";
import { DRAGGING_ATTRIBUTE, HANDLE_ATTRIBUTE, draggingCursor, handleStyleSheet, isHandleCursor, type HandleCursor } from "../logic/draghandle.ts";
import type { KeyInfo, OsName, PreferenceStorage } from "./types.ts";

export const hasDom = true;
export function osName(): OsName {
  const agent = `${navigator.platform} ${navigator.userAgent}`;
  if (/iPhone|iPad|iPod/.test(agent)) return "ios";
  if (/Android/.test(agent)) return "android";
  return /Mac/.test(agent) ? "mac" : /Win/.test(agent) ? "windows" : "linux";
}
function watchMedia(query: string, listener: (matches: boolean) => void): () => void {
  const media = typeof window.matchMedia === "function" ? window.matchMedia(query) : null;
  listener(media?.matches ?? false);
  if (!media) return () => {};
  const onChange = (event: MediaQueryListEvent) => listener(event.matches);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
/** The primary pointer: re-evaluated when it changes, for example on a touch laptop. */
export const watchCoarsePointer = (listener: (coarse: boolean) => void) => watchMedia("(pointer: coarse)", listener);
export const watchReducedMotion = (listener: (reduce: boolean) => void) => watchMedia("(prefers-reduced-motion: reduce)", listener);

// Focus rings are drawn for keyboard focus only: the last input decides.
let keyboard = false;
document.addEventListener("keydown", (event) => { if (!event.metaKey && !event.ctrlKey && !event.altKey) keyboard = true; }, true);
document.addEventListener("pointerdown", () => { keyboard = false; }, true);
document.addEventListener("mousedown", () => { keyboard = false; }, true);
export const isKeyboardModality = () => keyboard;

const info = (event: KeyboardEvent): KeyInfo => ({
  key: event.key, shift: event.shiftKey, alt: event.altKey, ctrl: event.ctrlKey, meta: event.metaKey, repeat: event.repeat,
  preventDefault: () => event.preventDefault(), stopPropagation: () => event.stopPropagation(),
});
const globalHandlers: Array<(key: KeyInfo) => boolean | void> = [];
// Capture phase: text fields stop key events from bubbling, and a surface must still see Tab and Escape typed in them.
document.addEventListener("keydown", (event) => {
  // A field that uses Escape itself (to clear or to cancel an edit) is marked `data-escape` and keeps the key.
  if (event.key === "Escape" && (event.target as HTMLElement | null)?.closest?.("[data-escape]")) return;
  // The most recently registered handler is the topmost surface; it sees the key first.
  for (let i = globalHandlers.length - 1; i >= 0; i--) {
    if (globalHandlers[i]!(info(event)) === true) { event.preventDefault(); event.stopPropagation(); return; }
  }
}, true);
export function onGlobalKey(handler: (key: KeyInfo) => boolean | void): () => void {
  globalHandlers.push(handler);
  return () => { const at = globalHandlers.indexOf(handler); if (at >= 0) globalHandlers.splice(at, 1); };
}
export function onGlobalKeyUp(handler: (key: KeyInfo) => void): () => void {
  const listener = (event: KeyboardEvent) => handler(info(event));
  document.addEventListener("keyup", listener);
  return () => document.removeEventListener("keyup", listener);
}
/**
 * The browser draws its own focus outline on inputs and on anything focused from the keyboard, on top of the ring and
 * the focus border the components draw themselves — a doubled frame around every field. Zero-specificity rules remove
 * the browser's, so any component style that sets an outline still wins. The grey flash on tap is removed as well.
 */
function ensureBaseStyles(): void {
  if (document.getElementById("jc-base")) return;
  const style = document.createElement("style");
  style.id = "jc-base";
  // The page itself never scrolls sideways (screens scroll inside their own scrollers): `clip` also refuses the scrolling a focus or an anchor would do.
  style.textContent = ":where(*:focus),:where(*:focus-visible){outline-style:none}:where(*){-webkit-tap-highlight-color:transparent}html,body,#root{overflow-x:clip}";
  document.head.appendChild(style);
}
/** The web `theme-color` meta follows `bg/app`; Electron reads the same meta for the window chrome. */
export function setThemeColor(color: string): void {
  ensureBaseStyles();
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) { meta = document.createElement("meta"); meta.name = "theme-color"; document.head.appendChild(meta); }
  meta.content = color;
}
export const defaultStorage: PreferenceStorage = {
  get: (key) => { try { return window.localStorage.getItem(key); } catch { return null; } },
  set: (key, value) => { try { window.localStorage.setItem(key, value); } catch { /* private mode: the preference lasts for the session */ } },
};
/** The side sheet's chosen width survives a reload on the web and in Electron. */
export const SHEET_WIDTH_KEY = "jagentchill.ui.sideSheetWidth";
export function loadSheetWidth(): string | null { try { return window.localStorage.getItem(SHEET_WIDTH_KEY); } catch { return null; } }
export function storeSheetWidth(width: number): void { try { window.localStorage.setItem(SHEET_WIDTH_KEY, String(width)); } catch { /* private mode: the width lasts for the session */ } }
export const copyText = (text: string): Promise<void> => navigator.clipboard.writeText(text);
export const readClipboard = (): Promise<string> => navigator.clipboard.readText();

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';
const focusables = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((node) => node.getAttribute("aria-hidden") !== "true" && !node.closest("[inert]"));
export function focusedElement(): unknown { return document.activeElement; }
// Focus never scrolls: a sheet or panel is focused while it is still off screen (it slides in), and the browser would
// otherwise scroll every clipped ancestor sideways to "reveal" it — the whole screen jumped towards the panel.
export function focusElement(target: unknown): void { (target as HTMLElement | null)?.focus?.({ preventScroll: true }); }
/** Moves focus into a surface: to the control matching `selector` when given, else the first field, else the first control. */
export function focusFirstIn(root: unknown, selector?: string): void {
  const node = root as HTMLElement | null;
  if (!node?.querySelector) return;
  // Initial focus goes to the first field when the surface has one, otherwise to its first control.
  const field = node.querySelector<HTMLElement>("input:not([disabled]):not([type=hidden]),textarea:not([disabled])");
  const target = (selector ? node.querySelector<HTMLElement>(selector) : null) ?? field ?? focusables(node)[0] ?? node;
  target.focus({ preventScroll: true });
}
/** Keeps Tab inside a surface. Returns true when it moved focus itself. */
export function cycleFocus(root: unknown, backwards: boolean): boolean {
  const node = root as HTMLElement | null;
  if (!node?.querySelectorAll) return false;
  const list = focusables(node);
  if (list.length === 0) return true;
  const at = list.indexOf(document.activeElement as HTMLElement);
  const next = backwards ? (at <= 0 ? list.length - 1 : at - 1) : at === list.length - 1 || at < 0 ? 0 : at + 1;
  list[next]!.focus({ preventScroll: true });
  // Tabbing to a control that is out of view inside a scroller still brings it into view, without moving the page itself.
  list[next]!.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  return true;
}
export function setInert(target: unknown, inert: boolean): void {
  const node = target as HTMLElement | null;
  if (!node?.setAttribute) return;
  if (inert) { node.setAttribute("inert", ""); node.setAttribute("aria-hidden", "true"); } else { node.removeAttribute("inert"); node.removeAttribute("aria-hidden"); }
}
let locks = 0;
/**
 * Tells when the part of the page that holds `node` stops being drawn (a navigator hides the screens behind the front
 * one with `display: none`, with or without freezing them) and when it is drawn again. Checked once per frame: the
 * watcher belongs to no component, so it keeps working while the screen it watches cannot render or run effects.
 */
/** An ancestor takes the element out of the page with `display: none`. Having no box is the cheap first test; the walk confirms it (an environment without layout has no boxes at all). */
function notDrawn(element: Element): boolean {
  if (!element.isConnected || element.getClientRects().length > 0) return false;
  for (let at: Element | null = element.parentElement; at; at = at.parentElement) if (getComputedStyle(at).display === "none") return true;
  return false;
}
/**
 * Applies the state updates made in `update`, and everything they cascade into, to the page before returning.
 * Returns whether it did: `false` (native) means the updates were only queued and the caller has to wait for them.
 */
export function commitNow(update: () => void): boolean { flushSync(update); return true; }
export function watchHidden(node: () => unknown, onChange: (hidden: boolean) => void): () => void {
  let hidden = false, frame = 0;
  const tick = () => {
    const element = node() as Element | null;
    const now = element ? notDrawn(element) : hidden;
    if (now !== hidden) { hidden = now; onChange(now); }
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(frame);
}
export function lockScroll(): () => void {
  if (locks++ === 0) document.documentElement.style.overflow = "hidden";
  return () => { if (--locks === 0) document.documentElement.style.overflow = ""; };
}
type EyeDropperWindow = Window & { EyeDropper?: new () => { open(): Promise<{ sRGBHex: string }> }; jagentchillDesktop?: { pickScreenColor?(): Promise<string | null> } };
/** The EyeDropper API where the browser has it, the Electron screen-capture path on desktop. */
export const hasEyeDropper = () => Boolean((window as EyeDropperWindow).EyeDropper || (window as EyeDropperWindow).jagentchillDesktop?.pickScreenColor);
export async function pickScreenColor(): Promise<string | null> {
  const host = window as EyeDropperWindow;
  if (host.jagentchillDesktop?.pickScreenColor) return host.jagentchillDesktop.pickScreenColor();
  if (!host.EyeDropper) return null;
  try { return (await new host.EyeDropper().open()).sRGBHex; } catch { return null; }
}
/** Pointer lock for scrubbing; the returned function releases it. */
export function lockPointer(target: unknown): () => void {
  const node = target as HTMLElement | null;
  try { void node?.requestPointerLock?.(); } catch { /* not granted: scrubbing continues with ordinary moves */ }
  return () => { if (document.pointerLockElement) document.exitPointerLock(); };
}
export function onViewportScroll(listener: () => void): () => void {
  window.addEventListener("scroll", listener, true);
  return () => window.removeEventListener("scroll", listener, true);
}
/** Follows a drag that started on an element: moves are reported as deltas, also under pointer lock. */
export function onPointerMoveUp(move: (dx: number, dy: number, key: { shift: boolean; alt: boolean }, x: number, y: number) => void, up: () => void): () => void {
  const onMove = (event: PointerEvent) => move(event.movementX, event.movementY, { shift: event.shiftKey, alt: event.altKey }, event.clientX, event.clientY);
  const stop = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); window.removeEventListener("pointercancel", onUp); };
  const onUp = () => { stop(); up(); };
  window.addEventListener("pointermove", onMove); window.addEventListener("pointerup", onUp); window.addEventListener("pointercancel", onUp);
  return stop;
}
export type Glide = { node: unknown; property: "width" | "height" | "flexGrow" | "transform"; from: string; to: string };
/**
 * Whether a panel's slide is left to the browser (a CSS transition). Not under jsdom, which has no layout and never ends a
 * transition, and not when a check asks for the per-frame animation the native platforms use (`__jcPanelMotionLegacy`,
 * the negative control of `apps/app/e2e/panel-perf.mjs`).
 */
export const cssMotion = (): boolean => !/jsdom/i.test(navigator.userAgent) && (globalThis as { __jcPanelMotionLegacy?: boolean }).__jcPanelMotionLegacy !== true;
const CSS_NAME = { width: "width", height: "height", flexGrow: "flex-grow", transform: "transform" } as const;
/**
 * Moves style properties from one value to another with ONE CSS transition: no script runs per frame. `done` is
 * called when it has ended (or was cut short by `cancel(true)`); the inline values are left at the end state, which is
 * what the caller renders at rest.
 */
export function cssGlide(glides: Glide[], ms: number, ease: string, done: () => void): (finish?: boolean) => void {
  const items = glides.map((glide) => ({ ...glide, element: glide.node as HTMLElement })).filter((item) => item.element?.style);
  if (items.length === 0) { done(); return () => {}; }
  const lead = items[0]!.element;
  for (const item of items) { item.element.style.transition = "none"; item.element.style[item.property] = item.from; }
  // The start state is laid out before the transition is declared: the browser animates from it.
  void lead.offsetWidth;
  for (const item of items) { item.element.style.transition = `${CSS_NAME[item.property]} ${ms}ms ${ease}`; item.element.style[item.property] = item.to; }
  let over = false, timer = 0;
  const end = (event?: Event) => {
    if (over || (event && event.target !== lead)) return;
    over = true;
    window.clearTimeout(timer); lead.removeEventListener("transitionend", end); lead.removeEventListener("transitioncancel", end);
    for (const item of items) item.element.style.transition = "";
    done();
  };
  lead.addEventListener("transitionend", end); lead.addEventListener("transitioncancel", end);
  // A transition that never starts (equal values, a hidden tab) never ends either.
  timer = window.setTimeout(() => end(), ms + 250);
  return (finish) => { if (over) return; if (finish) { end(); return; } over = true; window.clearTimeout(timer); lead.removeEventListener("transitionend", end); lead.removeEventListener("transitioncancel", end); for (const item of items) item.element.style.transition = ""; };
}
let resizeGated = false;
/**
 * Holds back every ResizeObserver of the page while `moving()` says panels slide: an element's FIRST size is always
 * delivered (something mounted mid-slide still measures itself), later changes are kept and delivered once when
 * `onEnd` fires. At any time, an element that is not drawn (`display: none` — a collapsed region, a screen behind the
 * current one) reports nothing: it keeps the size it had, so it is already laid out right when it comes back. This is what stops `onLayout` handlers (react-native-web observes every such element with one shared
 * ResizeObserver) from rendering once per frame of a slide. Installed once, before any observer exists.
 */
export function gateResizeObservers(moving: () => boolean, onEnd: (listener: () => void) => void): void {
  if (resizeGated || typeof window === "undefined" || typeof window.ResizeObserver !== "function") return;
  resizeGated = true;
  const Native = window.ResizeObserver, flushes = new Set<() => void>();
  const Gated = function (callback: ResizeObserverCallback) {
    const seen = new WeakSet<Element>(), held = new Map<Element, ResizeObserverEntry>();
    let self: ResizeObserver;
    const flush = () => { const entries = [...held.values()].filter((entry) => entry.target.isConnected); held.clear(); if (entries.length > 0) callback(entries, self); };
    const inner = new Native((all) => {
      const entries = all.filter((entry) => entry.target.getClientRects().length > 0);
      if (entries.length === 0) return;
      if (!moving()) { for (const entry of entries) seen.add(entry.target); callback(entries, self); return; }
      const first: ResizeObserverEntry[] = [];
      for (const entry of entries) { if (seen.has(entry.target)) held.set(entry.target, entry); else { seen.add(entry.target); first.push(entry); } }
      if (held.size > 0) flushes.add(flush);
      if (first.length > 0) callback(first, self);
    });
    self = {
      observe: (target: Element, options?: ResizeObserverOptions) => inner.observe(target, options),
      unobserve: (target: Element) => { held.delete(target); seen.delete(target); inner.unobserve(target); },
      disconnect: () => { held.clear(); flushes.delete(flush); inner.disconnect(); },
    };
    return self;
  };
  window.ResizeObserver = Gated as unknown as typeof ResizeObserver;
  onEnd(() => { const run = [...flushes]; flushes.clear(); for (const flush of run) flush(); });
}
/** The size an element has on screen right now, in px. */
export const computedSize = (node: unknown, property: "width" | "height"): number => { const element = node as HTMLElement | null; return element?.getBoundingClientRect ? element.getBoundingClientRect()[property] : 0; };
export const computedStyleOf = (node: unknown, property: "flexGrow" | "transform"): string => { const element = node as HTMLElement | null; return element?.style ? getComputedStyle(element)[property] : ""; };
/** Sets inline style properties directly: the start state of a slide, before the first paint. */
export function setInlineStyle(node: unknown, style: Partial<Record<Glide["property"] | "transition", string>>): void { const element = node as HTMLElement | null; if (element?.style) Object.assign(element.style, style); }
export const directionOfDocument = (): "ltr" | "rtl" => (document.documentElement.dir === "rtl" ? "rtl" : "ltr");
export function resetForTests(): void { keyboard = false; globalHandlers.length = 0; locks = 0; }

// — Drag handles: one style sheet and one listener for every handle of the app (see `draghandle.ts`) —
function ensureHandleStyles(): void {
  if (document.getElementById("jc-draghandles")) return;
  const style = document.createElement("style");
  style.id = "jc-draghandles";
  style.textContent = handleStyleSheet();
  document.head.appendChild(style);
}
const showDragging = (cursor: HandleCursor | null): void => { if (cursor) document.documentElement.setAttribute(DRAGGING_ATTRIBUTE, cursor); else document.documentElement.removeAttribute(DRAGGING_ATTRIBUTE); };
ensureHandleStyles();
// Capture phase: a handle that stops the event, or takes the pointer, is still seen.
document.addEventListener("pointerdown", (event) => {
  if (event.button === 2) return;
  const cursor = (event.target as HTMLElement | null)?.closest?.(`[${HANDLE_ATTRIBUTE}]`)?.getAttribute(HANDLE_ATTRIBUTE);
  if (isHandleCursor(cursor)) showDragging(draggingCursor(cursor));
}, true);
// A drag never outlives the release of the pointer.
const releaseDragging = () => showDragging(null);
for (const type of ["pointerup", "pointercancel", "dragend"] as const) window.addEventListener(type, releaseDragging, true);
window.addEventListener("blur", releaseDragging);
export function markHandle(node: unknown, attribute: string, cursor: HandleCursor | null): void {
  const element = node as HTMLElement | null;
  if (!element?.setAttribute) return;
  if (cursor) { if (element.getAttribute(attribute) !== cursor) element.setAttribute(attribute, cursor); } else if (element.hasAttribute(attribute)) element.removeAttribute(attribute);
}
export function beginDragCursor(cursor: HandleCursor): () => void {
  showDragging(cursor);
  return () => showDragging(null);
}
