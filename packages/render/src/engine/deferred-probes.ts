import { ALL_FORMATS, Input, UrlSource, VideoSampleSink } from "mediabunny";

/**
 * The capability measurements that take time (`render-engine.Deferred probes`): a decode probe (the bundled 2 s
 * H.264 1080p30 clip decoded once, then 20 seeks timed) and an encode probe (60 frames of 1080p through
 * `VideoEncoder`). They never run before `engine.ready`; the engine starts them in a worker at least 500 ms after
 * it, only while nothing plays or exports, aborts them when that changes, and caches the result per browser and OS
 * version. Nothing is written to user storage and no memory is held beyond the frames in flight.
 */

export const PROBE_DELAY_MS = 500, PROBE_BUDGET_MS = 4000;
export type ProbeResult = {
  /** Decode speed over real time and the 95th percentile of 20 seeks in ms; absent when there was no clip or no decoder. */
  decode?: { realtime: number; seekP95: number };
  /** Encode speed over real time; absent when there is no video encoder. */
  encode?: { realtime: number };
  /** Running time of the two probes in ms. */
  elapsed: number;
};
/** A decode below 1× real time or seeks above 150 ms make proxies necessary; an encode below 0.5× real time sends exports to the host. */
export const probeVerdict = (result: ProbeResult): { proxyEditing: "optional" | "required"; onDeviceVideoExport?: boolean } => ({
  proxyEditing: result.decode && (result.decode.realtime < 1 || result.decode.seekP95 > 150) ? "required" : "optional",
  ...(result.encode ? { onDeviceVideoExport: result.encode.realtime >= 0.5 } : {}),
});

class Aborted extends Error {}
const now = () => performance.now();

async function decodeProbe(clipUrl: string, check: () => void): Promise<ProbeResult["decode"]> {
  const input = new Input({ source: new UrlSource(clipUrl), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) return undefined;
    const sink = new VideoSampleSink(track), duration = await track.computeDuration();
    const started = now();
    for await (const sample of sink.samples()) { sample.close(); check(); }
    const realtime = duration / Math.max((now() - started) / 1000, 1e-6);
    // 20 seeks over the clip, in an order that goes backwards as often as forwards.
    const times: number[] = [];
    for (let index = 0; index < 20; index++) {
      check();
      const at = now(), sample = await sink.getSample(((index * 7) % 20) / 20 * duration);
      sample?.close();
      times.push(now() - at);
    }
    times.sort((a, b) => a - b);
    return { realtime, seekP95: times[18] };
  } finally {
    input.dispose?.();
  }
}

async function encodeProbe(check: () => void): Promise<ProbeResult["encode"]> {
  const Encoder = (globalThis as { VideoEncoder?: typeof VideoEncoder }).VideoEncoder;
  if (!Encoder || typeof OffscreenCanvas === "undefined") return undefined;
  const width = 1920, height = 1080, frames = 60;
  let config: VideoEncoderConfig | undefined;
  for (const codec of ["avc1.640028", "vp09.00.40.08", "av01.0.08M.08", "hvc1.1.6.L120.90"]) {
    const candidate = { codec, width, height, framerate: 30, bitrate: 6_000_000 };
    if ((await Encoder.isConfigSupported(candidate).catch(() => ({ supported: false }))).supported) { config = candidate; break; }
  }
  if (!config) return undefined;
  let failed: unknown;
  const encoder = new Encoder({ output: () => undefined, error: (error) => { failed = error; } });
  const canvas = new OffscreenCanvas(width, height), context = canvas.getContext("2d")!;
  try {
    encoder.configure(config);
    const started = now();
    for (let index = 0; index < frames; index++) {
      check();
      // A picture that changes: a gradient with a bar travelling across it.
      context.fillStyle = `rgb(${(index * 4) % 256}, 96, 160)`;
      context.fillRect(0, 0, width, height);
      context.fillStyle = "#ffffff";
      context.fillRect((index * 32) % width, 0, 64, height);
      const frame = new VideoFrame(canvas, { timestamp: Math.round((index * 1_000_000) / 30) });
      encoder.encode(frame, { keyFrame: index % 30 === 0 });
      frame.close();
      // The encoder is not fed faster than it works: memory stays at a few frames.
      while (encoder.encodeQueueSize > 2) { await new Promise((resolve) => setTimeout(resolve, 1)); check(); }
    }
    await encoder.flush();
    if (failed) return undefined;
    return { realtime: frames / 30 / Math.max((now() - started) / 1000, 1e-6) };
  } finally {
    if (encoder.state !== "closed") encoder.close();
  }
}

/** Runs both probes. Resolves `null` when aborted or when the budget of running time is spent. */
export async function runDeferredProbes(options: { clipUrl?: string; signal?: AbortSignal; budgetMs?: number }): Promise<ProbeResult | null> {
  const started = now(), budget = options.budgetMs ?? PROBE_BUDGET_MS;
  const check = () => { if (options.signal?.aborted || now() - started > budget) throw new Aborted(); };
  try {
    const decode = options.clipUrl ? await decodeProbe(options.clipUrl, check).catch((error) => { if (error instanceof Aborted) throw error; return undefined; }) : undefined;
    const encode = await encodeProbe(check).catch((error) => { if (error instanceof Aborted) throw error; return undefined; });
    return { ...(decode ? { decode } : {}), ...(encode ? { encode } : {}), elapsed: now() - started };
  } catch (error) {
    if (error instanceof Aborted) return null;
    throw error;
  }
}

/** The cache of a result: one entry, valid for the browser and OS version that measured it. */
const CACHE_KEY = "jagentchill.engine.probes.v1";
type Stored = { agent: string; result: ProbeResult };
const agent = (): string => (globalThis as { navigator?: { userAgent?: string } }).navigator?.userAgent ?? "";
export function cachedProbeResult(): ProbeResult | null {
  try {
    const stored = JSON.parse((globalThis as { localStorage?: Storage }).localStorage?.getItem(CACHE_KEY) ?? "null") as Stored | null;
    // An entry of another OS or browser version is discarded.
    if (stored && stored.agent !== agent()) { (globalThis as { localStorage?: Storage }).localStorage?.removeItem(CACHE_KEY); return null; }
    return stored?.result ?? null;
  } catch {
    return null;
  }
}
export function storeProbeResult(result: ProbeResult): void {
  try { (globalThis as { localStorage?: Storage }).localStorage?.setItem(CACHE_KEY, JSON.stringify({ agent: agent(), result } satisfies Stored)); } catch { /* private mode: measured again next time */ }
}
