/** Web implementation of the phone editor's touch gestures, over pointer events: tap, long press, drag with release velocity, two-finger pinch and tap, wheel. The native one is `touch.ts`. */
export type TouchPoint = { x: number; y: number; clientX: number; clientY: number; time_ms: number };
export type DragSession = { move?(point: TouchPoint): void; end?(point: TouchPoint, velocity: { x: number; y: number }): void; cancel?(): void };
export type PinchSession = { move?(scale: number, rotation: number, centre: TouchPoint): void; end?(): void };
export type TouchHandlers = {
  /** A finger landed (whatever it becomes): playback pauses, inertia stops. */
  down?(point: TouchPoint): void;
  tap?(point: TouchPoint): void;
  doubleTap?(point: TouchPoint): void;
  /** Travel before the long-press time: the session follows the finger to its release. */
  drag?(start: TouchPoint, now: TouchPoint): DragSession | null | void;
  /** Held in place for the long-press time: the session follows the finger from there. */
  longPress?(point: TouchPoint): DragSession | null | void;
  pinch?(centre: TouchPoint): PinchSession | null | void;
  twoFingerTap?(): void;
  wheel?(wheel: { deltaX: number; deltaY: number; zoom: boolean; shift: boolean; x: number }): void;
};
/** The touch values of the phone editor: one place, read by every gesture. */
export const TOUCH = { longPress_ms: 400, travel: 8, doubleTap_ms: 300, edgeZone: 40, edgeMin: 200, edgeMax: 1200, hapticGap_ms: 60, trimHit: 44, trimHandle: 20, deceleration: 0.998 } as const;
/** Controls drawn over a gesture surface handle their own presses. */
const CONTROL = '[data-testid^="tl-ctl"], input, textarea, [role="slider"], [role="menu"], [role="dialog"]';

export function bindTouch(node: unknown, handlers: TouchHandlers): () => void {
  const element = node as HTMLElement | null;
  if (!element?.addEventListener) return () => {};
  const pointOf = (event: { clientX: number; clientY: number }): TouchPoint => { const rect = element.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top, clientX: event.clientX, clientY: event.clientY, time_ms: performance.now() }; };
  const pointers = new Map<number, TouchPoint>();
  let start: TouchPoint | null = null, session: DragSession | null = null, pinch: PinchSession | null = null, timer: ReturnType<typeof setTimeout> | null = null;
  let mode: "idle" | "pending" | "drag" | "pinch" | "spent" = "idle", pinchBase = { distance: 1, angle: 0, moved: false, at: 0 }, lastTap = { time: -1e9, x: 0, y: 0 };
  let samples: TouchPoint[] = [];
  const clear = () => { if (timer) { clearTimeout(timer); timer = null; } };
  const two = (): [TouchPoint, TouchPoint] => { const [a, b] = [...pointers.values()]; return [a, b]; };
  const span = (a: TouchPoint, b: TouchPoint) => ({ distance: Math.max(1, Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY)), angle: (Math.atan2(b.clientY - a.clientY, b.clientX - a.clientX) * 180) / Math.PI, centre: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, clientX: (a.clientX + b.clientX) / 2, clientY: (a.clientY + b.clientY) / 2, time_ms: b.time_ms } });
  const velocity = (release: TouchPoint): { x: number; y: number } => {
    // The speed over the last 100 ms of the drag, in px per ms; a finger that rested before lifting has none.
    const last = samples[samples.length - 1], first = samples.find((sample) => last.time_ms - sample.time_ms <= 100) ?? last, dt = last.time_ms - first.time_ms;
    return dt > 0 && release.time_ms - last.time_ms < 80 ? { x: (last.clientX - first.clientX) / dt, y: (last.clientY - first.clientY) / dt } : { x: 0, y: 0 };
  };
  // Mobile browsers aim a finger at the nearest button within its width, so the target of a touch can be a control the
  // finger is only beside. What is under the finger is read from its own point: a gesture that starts beside a control is the surface's.
  const onControl = (event: { clientX: number; clientY: number }): boolean => { const control = (document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null)?.closest?.(CONTROL) ?? null; return control !== null && control !== element && element.contains(control); };
  const down = (event: PointerEvent) => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    if (onControl(event)) return;
    // What is drawn inside the surface (volume lines, fade handles of the wide layout) never takes a finger here.
    event.stopPropagation();
    if (event.pointerType !== "mouse") event.preventDefault();
    const point = pointOf(event);
    pointers.set(event.pointerId, point);
    try { element.setPointerCapture(event.pointerId); } catch { /* a synthetic pointer has nothing to capture */ }
    if (pointers.size === 1) {
      start = point; samples = [point]; mode = "pending";
      handlers.down?.(point);
      clear();
      timer = setTimeout(() => { timer = null; if (mode !== "pending" || !start) return; const made = handlers.longPress?.(start); if (made) { session = made; mode = "drag"; } else mode = "spent"; }, TOUCH.longPress_ms);
      return;
    }
    if (pointers.size === 2) {
      // A second finger ends whatever the first one was doing, without a result.
      clear();
      if (session) { session.cancel?.(); session = null; }
      const [a, b] = two(), base = span(a, b);
      pinchBase = { distance: base.distance, angle: base.angle, moved: false, at: point.time_ms };
      pinch = handlers.pinch?.(base.centre) ?? null;
      mode = "pinch";
    }
  };
  const move = (event: PointerEvent) => {
    if (!pointers.has(event.pointerId)) return;
    event.stopPropagation();
    const point = pointOf(event);
    pointers.set(event.pointerId, point);
    if (mode === "pinch" && pointers.size >= 2) {
      const [a, b] = two(), now = span(a, b);
      if (Math.abs(now.distance - pinchBase.distance) > TOUCH.travel) pinchBase.moved = true;
      pinch?.move?.(now.distance / pinchBase.distance, now.angle - pinchBase.angle, now.centre);
      return;
    }
    if (!start) return;
    samples.push(point); if (samples.length > 12) samples.shift();
    if (mode === "pending" && Math.hypot(point.clientX - start.clientX, point.clientY - start.clientY) > TOUCH.travel) {
      clear();
      const made = handlers.drag?.(start, point);
      if (made) { session = made; mode = "drag"; } else mode = "spent";
    }
    if (mode === "drag") session?.move?.(point);
  };
  const finish = (event: PointerEvent, cancelled: boolean) => {
    if (!pointers.has(event.pointerId)) return;
    event.stopPropagation();
    const point = pointOf(event);
    pointers.delete(event.pointerId);
    try { element.releasePointerCapture(event.pointerId); } catch { /* already released */ }
    if (mode === "pinch") {
      if (pointers.size > 0) return;
      pinch?.end?.(); pinch = null;
      if (!pinchBase.moved && !cancelled && point.time_ms - pinchBase.at < TOUCH.longPress_ms) handlers.twoFingerTap?.();
      mode = "idle"; start = null;
      return;
    }
    clear();
    const was = mode, ended = session;
    mode = "idle"; session = null;
    if (was === "drag") { if (cancelled) ended?.cancel?.(); else ended?.end?.(point, velocity(point)); }
    else if (was === "pending" && !cancelled && start) {
      const double = point.time_ms - lastTap.time <= TOUCH.doubleTap_ms && Math.hypot(point.clientX - lastTap.x, point.clientY - lastTap.y) < 24;
      lastTap = double ? { time: -1e9, x: 0, y: 0 } : { time: point.time_ms, x: point.clientX, y: point.clientY };
      handlers.tap?.(start);
      if (double) handlers.doubleTap?.(start);
    }
    start = null;
  };
  const up = (event: PointerEvent) => finish(event, false), cancel = (event: PointerEvent) => finish(event, true);
  const wheel = (event: WheelEvent) => { if (!handlers.wheel) return; event.preventDefault(); handlers.wheel({ deltaX: event.deltaX, deltaY: event.deltaY, zoom: event.ctrlKey || event.metaKey, shift: event.shiftKey, x: event.clientX - element.getBoundingClientRect().left }); };
  // A finger on the surface itself must not become a click, which would go to that nearest button.
  const claim = (event: TouchEvent) => { const finger = event.changedTouches[0]; if (finger && !onControl(finger) && event.cancelable) event.preventDefault(); };
  // A long press must not open the browser's own menu or start a text selection.
  const context = (event: Event) => event.preventDefault();
  const before = { touchAction: element.style.touchAction, userSelect: element.style.userSelect };
  element.style.touchAction = "none"; element.style.userSelect = "none"; element.style.setProperty("-webkit-touch-callout", "none");
  element.addEventListener("pointerdown", down, true); element.addEventListener("pointermove", move, true); element.addEventListener("pointerup", up, true); element.addEventListener("pointercancel", cancel, true);
  element.addEventListener("wheel", wheel, { passive: false }); element.addEventListener("contextmenu", context); element.addEventListener("touchstart", claim, { passive: false });
  return () => {
    clear();
    element.style.touchAction = before.touchAction; element.style.userSelect = before.userSelect;
    element.removeEventListener("pointerdown", down, true); element.removeEventListener("pointermove", move, true); element.removeEventListener("pointerup", up, true); element.removeEventListener("pointercancel", cancel, true);
    element.removeEventListener("wheel", wheel); element.removeEventListener("contextmenu", context); element.removeEventListener("touchstart", claim);
  };
}

let lastHaptic = -1e9;
const PATTERN = { light: 8, medium: 16, rigid: 24, success: [12, 40, 12], warning: [24, 40, 24] } as const;
/** Haptic feedback where the device has an actuator the browser can drive; never more than one per 60 ms. */
export function haptic(kind: keyof typeof PATTERN): void {
  const at = performance.now();
  if (at - lastHaptic < TOUCH.hapticGap_ms) return;
  lastHaptic = at;
  try { (navigator as Navigator & { vibrate?(pattern: number | readonly number[]): boolean }).vibrate?.(PATTERN[kind]); } catch { /* no actuator */ }
}
/** Lets fingers on an element reach its own pointer handlers instead of scrolling or zooming the page. */
export function ownTouches(node: unknown): () => void {
  const element = node as HTMLElement | null;
  if (!element?.style) return () => {};
  const before = element.style.touchAction;
  element.style.touchAction = "none";
  return () => { element.style.touchAction = before; };
}
/** Asks the screen to turn with a wide picture while it is shown full screen; browsers that cannot simply do not. */
export function lockOrientation(landscape: boolean): void {
  try { void (screen.orientation as ScreenOrientation & { lock?(orientation: string): Promise<void> }).lock?.(landscape ? "landscape" : "portrait")?.catch(() => undefined); } catch { /* not supported */ }
}
export function unlockOrientation(): void { try { screen.orientation.unlock?.(); } catch { /* not supported */ } }

/**
 * Two fingers on a surface that already follows one pointer (the preview): when the second finger lands, the gesture of
 * the first is cancelled and both become a pinch — distance ratio, twist in degrees and centre — until they lift.
 */
export function bindPinch(node: unknown, start: (centre: TouchPoint) => (PinchSession & { cancel?(): void }) | null | void): () => void {
  const element = node as HTMLElement | null;
  if (!element?.addEventListener) return () => {};
  const pointers = new Map<number, TouchPoint>();
  let session: (PinchSession & { cancel?(): void }) | null = null, pinching = false, synthetic = false, base = { distance: 1, angle: 0 };
  const pointOf = (event: PointerEvent): TouchPoint => { const rect = element.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top, clientX: event.clientX, clientY: event.clientY, time_ms: performance.now() }; };
  const span = () => { const [a, b] = [...pointers.values()]; return { distance: Math.max(1, Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY)), angle: (Math.atan2(b.clientY - a.clientY, b.clientX - a.clientX) * 180) / Math.PI, centre: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, clientX: (a.clientX + b.clientX) / 2, clientY: (a.clientY + b.clientY) / 2, time_ms: b.time_ms } }; };
  const down = (event: PointerEvent) => {
    if (event.pointerType !== "touch") return;
    if (pinching) { event.stopImmediatePropagation(); if (pointers.size < 2) pointers.set(event.pointerId, pointOf(event)); return; }
    pointers.set(event.pointerId, pointOf(event));
    if (pointers.size !== 2) return;
    event.stopImmediatePropagation(); event.preventDefault();
    pinching = true;
    // The one-finger gesture of the first finger ends without a result.
    const [first] = [...pointers.keys()];
    synthetic = true;
    try { element.dispatchEvent(new PointerEvent("pointercancel", { pointerId: first, pointerType: "touch", bubbles: true })); } finally { synthetic = false; }
    const now = span();
    base = { distance: now.distance, angle: now.angle };
    session = start(now.centre) ?? null;
  };
  const move = (event: PointerEvent) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, pointOf(event));
    if (!pinching) return;
    event.stopImmediatePropagation();
    if (pointers.size < 2 || !session) return;
    const now = span();
    let twist = now.angle - base.angle;
    if (twist > 180) twist -= 360; else if (twist < -180) twist += 360;
    session.move?.(now.distance / base.distance, twist, now.centre);
  };
  const finish = (event: PointerEvent) => {
    if (synthetic || !pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    if (!pinching) return;
    event.stopImmediatePropagation();
    if (session) { const ended = session; session = null; if (event.type === "pointercancel") ended.cancel?.(); else ended.end?.(); }
    if (pointers.size === 0) pinching = false;
  };
  element.addEventListener("pointerdown", down, true); element.addEventListener("pointermove", move, true); element.addEventListener("pointerup", finish, true); element.addEventListener("pointercancel", finish, true);
  return () => { element.removeEventListener("pointerdown", down, true); element.removeEventListener("pointermove", move, true); element.removeEventListener("pointerup", finish, true); element.removeEventListener("pointercancel", finish, true); };
}
