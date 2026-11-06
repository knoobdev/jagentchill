import { floorToFrame } from "@jagentchill/editor-core";
import { ENGINE_BRIDGE_MAX_BYTES, TICKS_PER_SECOND, type EngineConstraints } from "@jagentchill/protocol";

/**
 * The web side of the mobile surface: what crosses the bridge between the React Native app and the engine WebView,
 * and the app-side clock that turns 30 (or 15) time events per second into a playhead for every display frame.
 * The native view module (`JagentchillEngineView`) is owned by `mobile-editor`.
 */

const encoder = new TextEncoder();
export const encodedBytes = (message: unknown): number => encoder.encode(JSON.stringify(message)).length;

export type BridgeMessage = { v: 1; id: string; type: string; payload: Record<string, unknown> };
/**
 * Fits a command into one bridge message of at most 262 144 bytes. A `scene.set` that is larger goes by reference
 * (`storeSnapshot` keeps the document and returns its id under `/snapshot/`); a `scene.patch` that is larger is
 * replaced by a `scene.set` by reference of the current document.
 */
export function fitBridgeCommand(
  message: BridgeMessage,
  context: { engineOrigin: string; storeSnapshot: (document: unknown) => string; currentDocument?: () => { document: unknown; activeSceneId: string } },
): BridgeMessage {
  if (encodedBytes(message) <= ENGINE_BRIDGE_MAX_BYTES) return message;
  const byReference = (document: unknown, revision: number, activeSceneId: string): BridgeMessage => ({
    v: 1, id: message.id, type: "scene.set", payload: { revision, activeSceneId, snapshotUrl: `${context.engineOrigin}/snapshot/${context.storeSnapshot(document)}` },
  });
  if (message.type === "scene.set" && "document" in message.payload) return byReference(message.payload.document, message.payload.revision as number, message.payload.activeSceneId as string);
  if (message.type === "scene.patch" && context.currentDocument) {
    const current = context.currentDocument();
    // The surface-local revision starts again at 1 with each scene.set.
    return byReference(current.document, 1, current.activeSceneId);
  }
  throw new RangeError(`${message.type} is larger than one bridge message`);
}

/** The local origin the engine page is served from, per platform; nothing on it reaches the network. */
export const ENGINE_ORIGINS = { android: "https://engine.jagentchill.localhost", ios: "jagentchill-engine://app" } as const;
/** Path of a resource on the engine origin. */
export const enginePath = {
  media: (assetId: string, variant: "original" | "proxy" | "mezzanine") => `/media/${encodeURIComponent(assetId)}/${variant}`,
  derived: (sha256: string) => `/derived/${sha256}`,
  font: (fontId: string) => `/font/${encodeURIComponent(fontId)}`,
  snapshot: (snapshotId: string) => `/snapshot/${encodeURIComponent(snapshotId)}`,
};
/** Whether a navigation of the engine WebView stays on the engine origin; any other is cancelled (`surface/navigation-blocked`). */
export const isEngineNavigation = (url: string, platform: keyof typeof ENGINE_ORIGINS): boolean => url === ENGINE_ORIGINS[platform] || url.startsWith(`${ENGINE_ORIGINS[platform]}/`);

/** A single-range request against a file of `size` bytes: the 206 answer, or `null` when the range is not one the surface serves. */
export function singleRange(header: string | undefined, size: number): { status: 206; start: number; end: number; length: number; contentRange: string } | null {
  const match = /^bytes=(\d+)-(\d*)$/.exec(header ?? "");
  if (!match) return null;
  const start = Number(match[1]), end = Math.min(match[2] === "" ? size - 1 : Number(match[2]), size - 1);
  if (start > end || start >= size) return null;
  return { status: 206, start, end, length: end - start + 1, contentRange: `bytes ${start}-${end}/${size}` };
}

export type TimeEvent = { time: number; rate: number; playing: boolean; hostMono_ms?: number };
const STALL_MS = 500;

/**
 * App-side playhead between `transport.time` events: `time + (nowMono − hostMono) × rate`, floored to a frame.
 * It corrects to each new event, never moves backwards during forward playback (a correction that would is held
 * until the extrapolation catches up), and stops when an event says paused or none arrives for 500 ms.
 */
export class PlayheadExtrapolator {
  private readonly frameRate: { numerator: number; denominator: number };
  private event: TimeEvent | undefined;
  private received = 0;
  private shown = 0;
  constructor(frameRate: { numerator: number; denominator: number }) { this.frameRate = frameRate; }

  /** Takes an event; `nowMono_ms` is the monotonic clock at receipt, used when the event carries none. */
  receive(event: TimeEvent, nowMono_ms: number): void {
    this.event = { ...event, hostMono_ms: event.hostMono_ms ?? nowMono_ms };
    this.received = nowMono_ms;
    if (!event.playing) this.shown = event.time;
  }

  /** The playhead to draw at a display frame. */
  at(nowMono_ms: number): number {
    const event = this.event;
    if (!event) return this.shown;
    if (!event.playing) return this.shown = event.time;
    // No event for 500 ms: the bridge stalled, the playhead stops where the last event allows.
    const now = Math.min(nowMono_ms, this.received + STALL_MS);
    const raw = event.time + ((now - event.hostMono_ms!) * event.rate * TICKS_PER_SECOND) / 1000;
    const framed = floorToFrame(Math.max(0, Math.floor(raw)), this.frameRate);
    if (event.rate > 0) this.shown = Math.max(this.shown, framed);
    else this.shown = framed;
    return this.shown;
  }

  /** Whether the playhead is still being advanced at this instant. */
  advancing(nowMono_ms: number): boolean {
    return this.event?.playing === true && nowMono_ms - this.received < STALL_MS;
  }
  /** A seek or a pause: the next event is taken as it is. */
  reset(time = 0): void { this.event = undefined; this.shown = time; }
}

/**
 * Runtime measurement of the bridge: `timeEventsPerSecond` becomes 15 when the 95th-percentile latency over a
 * rolling window of 1 000 messages exceeds 8 ms, and 30 again after a further 1 000 messages at or below 6 ms.
 */
export class BridgeLatencyMonitor {
  rate: EngineConstraints["timeEventsPerSecond"] = 30;
  private window: number[] = [];
  private calm = 0;
  private static readonly WINDOW = 1000;

  /** Records one message latency; returns the new rate when it changed. */
  record(latencyMs: number): EngineConstraints["timeEventsPerSecond"] | undefined {
    this.window.push(latencyMs);
    if (this.window.length > BridgeLatencyMonitor.WINDOW) this.window.shift();
    if (this.window.length < BridgeLatencyMonitor.WINDOW) return undefined;
    const p95 = [...this.window].sort((a, b) => a - b)[Math.floor(0.95 * BridgeLatencyMonitor.WINDOW) - 1];
    if (this.rate === 30) {
      if (p95 > 8) { this.rate = 15; this.calm = 0; return 15; }
      return undefined;
    }
    this.calm = p95 <= 6 ? this.calm + 1 : 0;
    if (this.calm >= BridgeLatencyMonitor.WINDOW) { this.rate = 30; this.calm = 0; return 30; }
    return undefined;
  }
}

/**
 * Terminations of the WebView content process and wasm panics share one counter: three within 60 s stop automatic
 * restarts (`engine/restart-loop`).
 */
export class RestartBudget {
  private times: number[] = [];
  /** Records a termination or panic at `now_ms`; `"restart"` while the engine may be recreated, `"loop"` otherwise. */
  record(now_ms: number): "restart" | "loop" {
    this.times = [...this.times.filter((time) => now_ms - time < 60_000), now_ms];
    return this.times.length >= 3 ? "loop" : "restart";
  }
}
/** Deadlines of the mobile handshake and restart, in milliseconds. */
export const MOBILE_BUDGETS = { ready: 3000, frameAfterReady: 2000, restart: 5000, initTimeout: 8000, backgroundDispose: 30_000 } as const;
