import type { DragSession, PinchSession, TouchHandlers, TouchPoint } from "./touch-types.ts";

/** Gesture Handler callbacks translated to the editor's existing drag/tap/pinch contract. */
export function createTouchDriver(handlers: TouchHandlers) {
  let origin: TouchPoint = { x: 0, y: 0, clientX: 0, clientY: 0, time_ms: 0 }, drag: DragSession | null = null, pinch: PinchSession | null = null;
  return {
    down(point: TouchPoint) { origin = point; handlers.down?.(point); },
    panStart(point: TouchPoint) { drag = handlers.drag?.(origin, point) ?? null; drag?.move?.(point); },
    panMove(point: TouchPoint) { drag?.move?.(point); },
    panEnd(point: TouchPoint, velocity: { x: number; y: number }) { drag?.end?.(point, velocity); drag = null; },
    cancel() { drag?.cancel?.(); drag = null; pinch?.cancel?.(); pinch = null; },
    tap(point: TouchPoint) { handlers.tap?.(point); },
    doubleTap(point: TouchPoint) { handlers.doubleTap?.(point); },
    longStart(point: TouchPoint) { origin = point; drag = handlers.longPress?.(point) ?? null; },
    longMove(point: TouchPoint) { drag?.move?.(point); },
    longEnd(point: TouchPoint, success: boolean) { if (success) drag?.end?.(point, { x: 0, y: 0 }); else drag?.cancel?.(); drag = null; },
    pinchStart(point: TouchPoint) { pinch = handlers.pinch?.(point) ?? null; },
    pinchMove(scale: number, rotation: number, centre: TouchPoint) { pinch?.move?.(scale, rotation, centre); },
    pinchEnd(success: boolean) { if (success) pinch?.end?.(); else pinch?.cancel?.(); pinch = null; },
    twoFingerTap() { handlers.twoFingerTap?.(); },
  };
}
