import { Gesture, type ComposedGesture, type GestureType } from "react-native-gesture-handler";
import { createTouchDriver } from "./touch-driver";
import type { DragSession, PinchSession, TouchHandlers, TouchPoint } from "./touch-types";
export type { DragSession, PinchSession, TouchHandlers, TouchPoint } from "./touch-types";

export const TOUCH = { longPress_ms: 400, travel: 8, doubleTap_ms: 300, edgeZone: 40, edgeMin: 200, edgeMax: 1200, hapticGap_ms: 60, trimHit: 44, trimHandle: 20, deceleration: 0.998 } as const;

export type NativeGesture = GestureType | ComposedGesture;
export type TouchBinding = (() => void) & { gesture: NativeGesture };
const point = (event: { x?: number; y?: number; absoluteX?: number; absoluteY?: number; focalX?: number; focalY?: number }): TouchPoint => {
  const x = event.x ?? event.focalX ?? 0, y = event.y ?? event.focalY ?? 0;
  return { x, y, clientX: event.absoluteX ?? event.focalX ?? x, clientY: event.absoluteY ?? event.focalY ?? y, time_ms: Date.now() };
};

/** Build the native Gesture Handler recognizers used by a GestureDetector around the bound view. */
export function touchGesture(handlers: TouchHandlers): NativeGesture {
  const driver = createTouchDriver(handlers);
  const pan = Gesture.Pan().minDistance(TOUCH.travel).maxPointers(1).runOnJS(true)
    .onBegin((event) => driver.down(point(event)))
    .onStart((event) => driver.panStart(point(event)))
    .onUpdate((event) => driver.panMove(point(event)))
    .onEnd((event) => driver.panEnd(point(event), { x: event.velocityX, y: event.velocityY }))
    .onFinalize((_event, success) => { if (!success) driver.cancel(); });
  const tap = Gesture.Tap().maxDuration(TOUCH.doubleTap_ms).runOnJS(true).onEnd((event, success) => { if (success) driver.tap(point(event)); });
  const doubleTap = Gesture.Tap().numberOfTaps(2).maxDuration(TOUCH.doubleTap_ms).runOnJS(true).onEnd((event, success) => { if (success) driver.doubleTap(point(event)); });
  // Keep the finger attached to a held clip: a LongPress recognizer can win the race,
  // but its touch-move stream is bounded by its max-distance slop. A delayed Pan activates
  // only after the hold and continues delivering the drag across the timeline.
  const longPress = Gesture.Pan().activateAfterLongPress(TOUCH.longPress_ms).maxPointers(1).runOnJS(true)
    .onStart((event) => driver.longStart(point(event)))
    .onUpdate((event) => driver.longMove(point(event)))
    .onEnd((event, success) => driver.longEnd(point(event), success));
  const pinch = Gesture.Pinch().runOnJS(true);
  const rotate = Gesture.Rotation().runOnJS(true);
  let scale = 1, rotation = 0, centre = { x: 0, y: 0, clientX: 0, clientY: 0, time_ms: 0 };
  pinch.onStart((event) => { centre = point(event); scale = 1; rotation = 0; driver.pinchStart(centre); })
    .onUpdate((event) => { scale = event.scale; centre = point(event); driver.pinchMove(scale, rotation, centre); })
    .onEnd(() => driver.pinchEnd(true))
    .onFinalize((_event, success) => { if (!success) driver.pinchEnd(false); });
  rotate.onUpdate((event) => { rotation = event.rotation * 180 / Math.PI; driver.pinchMove(scale, rotation, centre); });
  const twoFingerTap = Gesture.Tap().minPointers(2).runOnJS(true).onEnd((_event, success) => { if (success) driver.twoFingerTap(); });
  const oneFinger = Gesture.Race(longPress, pan, Gesture.Exclusive(doubleTap, tap));
  return Gesture.Race(Gesture.Simultaneous(oneFinger, pinch, rotate), twoFingerTap);
}

/** The cleanup handle carries its gesture for a GestureDetector; node is retained for web/native call-site parity. */
export function bindTouch(_node: unknown, handlers: TouchHandlers): TouchBinding {
  const binding = (() => {}) as TouchBinding;
  binding.gesture = touchGesture(handlers);
  return binding;
}

export function haptic(kind: "light" | "medium" | "rigid" | "success" | "warning"): void {
  void import("expo-haptics").then((Haptics) => kind === "success" || kind === "warning"
    ? Haptics.notificationAsync(kind === "success" ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning)
    : Haptics.impactAsync(kind === "light" ? Haptics.ImpactFeedbackStyle.Light : kind === "medium" ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Rigid)).catch(() => undefined);
}
export function ownTouches(_node: unknown): () => void { return () => {}; }
export function lockOrientation(_landscape: boolean): void {}
export function unlockOrientation(): void {}

export function bindPinch(_node: unknown, start: (centre: TouchPoint) => (PinchSession & { cancel?(): void }) | null | void): TouchBinding {
  const binding = (() => {}) as TouchBinding;
  let session: PinchSession | null = null;
  const pinch = Gesture.Pinch().runOnJS(true), rotate = Gesture.Rotation().runOnJS(true);
  let scale = 1, rotation = 0, centre = { x: 0, y: 0, clientX: 0, clientY: 0, time_ms: 0 };
  pinch.onStart((event) => { centre = point(event); scale = 1; rotation = 0; session = start(centre) ?? null; })
    .onUpdate((event) => { scale = event.scale; centre = point(event); session?.move?.(scale, rotation, centre); })
    .onEnd(() => { session?.end?.(); session = null; })
    .onFinalize((_event, success) => { if (!success) session?.cancel?.(); session = null; });
  rotate.onUpdate((event) => { rotation = event.rotation * 180 / Math.PI; session?.move?.(scale, rotation, centre); });
  binding.gesture = Gesture.Simultaneous(pinch, rotate);
  return binding;
}
