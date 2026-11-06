export type TouchPoint = { x: number; y: number; clientX: number; clientY: number; time_ms: number };
export type DragSession = { move?(point: TouchPoint): void; end?(point: TouchPoint, velocity: { x: number; y: number }): void; cancel?(): void };
export type PinchSession = { move?(scale: number, rotation: number, centre: TouchPoint): void; end?(): void; cancel?(): void };
export type TouchHandlers = {
  down?(point: TouchPoint): void; tap?(point: TouchPoint): void; doubleTap?(point: TouchPoint): void;
  drag?(start: TouchPoint, now: TouchPoint): DragSession | null | void; longPress?(point: TouchPoint): DragSession | null | void;
  pinch?(centre: TouchPoint): PinchSession | null | void; twoFingerTap?(): void;
  wheel?(wheel: { deltaX: number; deltaY: number; zoom: boolean; shift: boolean; x: number }): void;
};
