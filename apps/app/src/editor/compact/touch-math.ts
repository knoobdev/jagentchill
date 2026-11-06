import { timeline } from "@jagentchill/editor-core";
import type { Rational } from "@jagentchill/protocol";

/** Convert a viewport touch into the timeline's scrolled content coordinate. */
export function compactTouchScrollX(viewportX: number, viewportWidth: number, scrollLeft: number): number {
  return Math.max(0, viewportX - viewportWidth / 2 + scrollLeft);
}

/** The fixed centre playhead means a horizontal drag seeks by moving the content beneath it. */
export function compactTouchTime(viewportX: number, viewportWidth: number, scrollLeft: number, zoom: number, duration: number, fps: Rational): number {
  return timeline.mobileScrollToTime(compactTouchScrollX(viewportX, viewportWidth, scrollLeft), zoom, duration, fps);
}

/** Keep the zoom anchored to the fixed playhead while a two-finger pinch changes scale. */
export function compactPinchZoom(baseZoom: number, scale: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, baseZoom * scale));
}

/** Advance a timeline flick: Gesture Handler velocities are points per second; elapsed time is milliseconds. */
export function advanceCompactInertia(position: number, velocity: number, elapsedMs: number, decayPerMs: number): { position: number; velocity: number } {
  return { position: position + velocity * elapsedMs / 1000, velocity: velocity * decayPerMs ** elapsedMs };
}
