import { ALL_FORMATS, Input, UrlSource, VideoSampleSink, type InputVideoTrack, type VideoSample } from "mediabunny";
import { mediaTimeToSeconds, mediaTimeFromSeconds } from "@jagentchill/editor-core";

/** A decoded frame held by a session. `bytes` is counted as codedWidth × codedHeight × 4. */
export type DecodedFrame = { bitmap: ImageBitmap; timestamp: number; duration: number; width: number; height: number; bytes: number };

export type SessionCounters = { seeks: number; decoded: number; openFrames: number };

const FORWARD_WINDOW_S = 2.0;
/** Container timestamps are rationals of another time base: a time within 0.1 ms of a frame boundary belongs to the later frame. */
const BOUNDARY_S = 1e-4;

/**
 * One decoder session for one `(assetId, variant)`: WebCodecs through mediabunny, no `<video>` element. Requests
 * are serialised; a cached frame whose interval contains the time is returned without decoding; a time just ahead
 * of the last one decodes forward sequentially; anything else seeks to the key frame at or before the time.
 */
export class VideoSession {
  readonly url: string;
  readonly counters: SessionCounters = { seeks: 0, decoded: 0, openFrames: 0 };
  private input: Input | undefined;
  private track: InputVideoTrack | undefined;
  private sink: VideoSampleSink | undefined;
  private iterator: AsyncGenerator<VideoSample, void, unknown> | undefined;
  private lastTime = Number.NEGATIVE_INFINITY;
  private current: DecodedFrame | undefined;
  /** The frame after `current`, decoded ahead for a frame blend; it becomes `current` when the time reaches it. */
  private ahead: DecodedFrame | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private generation = 0;
  private closed = false;
  private refineTarget: number | undefined;
  private refining = false;

  constructor(url: string) { this.url = url; }

  private async open(): Promise<VideoSampleSink> {
    if (this.sink) return this.sink;
    this.input = new Input({ source: new UrlSource(this.url), formats: ALL_FORMATS });
    const track = await this.input.getPrimaryVideoTrack();
    if (!track) throw new Error("the file has no video track");
    if (!(await track.canDecode())) throw new Error("unsupported");
    this.track = track;
    return this.sink = new VideoSampleSink(track);
  }

  /** `{width, height, duration, codec}` of the video track. */
  async describe(): Promise<{ width: number; height: number; duration: number; codec: string | null }> {
    await this.open();
    const track = this.track!;
    return { width: track.displayWidth, height: track.displayHeight, duration: mediaTimeFromSeconds(await track.computeDuration()), codec: track.codec };
  }

  private contains(frame: DecodedFrame | undefined, seconds: number): frame is DecodedFrame {
    return frame !== undefined && seconds >= frame.timestamp - BOUNDARY_S && seconds < frame.timestamp + frame.duration - BOUNDARY_S;
  }

  private async toFrame(sample: VideoSample): Promise<DecodedFrame> {
    const video = sample.toVideoFrame();
    try {
      // An ImageBitmap of a VideoFrame references the decoded picture; the compositor uploads it without a canvas copy.
      const bitmap = await createImageBitmap(video);
      this.counters.openFrames++;
      this.counters.decoded++;
      return { bitmap, timestamp: sample.timestamp, duration: sample.duration || 1 / 30, width: bitmap.width, height: bitmap.height, bytes: sample.codedWidth * sample.codedHeight * 4 };
    } finally {
      video.close();
      sample.close();
    }
  }

  private release(frame: DecodedFrame | undefined): void {
    if (!frame) return;
    frame.bitmap.close();
    this.counters.openFrames--;
  }

  /**
   * The frame for a source time in ticks. `scrub`: a request superseded while it waited resolves with the frame
   * already decoded; `exact`: the frame whose interval contains the time is always decoded and returned.
   */
  frameAt(sourceTime: number, mode: "scrub" | "exact" = "exact"): Promise<DecodedFrame | undefined> {
    // Scrubbing shows something at once: the frame already decoded is returned while the frame asked for is decoded
    // behind it. Only the newest scrub target is decoded; older ones are dropped.
    if (mode === "scrub" && this.current && !this.closed) {
      if (this.contains(this.current, mediaTimeToSeconds(sourceTime))) return Promise.resolve(this.current);
      this.refineTarget = sourceTime;
      if (!this.refining) {
        this.refining = true;
        void (async () => {
          try {
            while (this.refineTarget !== undefined && !this.closed) {
              const target = this.refineTarget;
              this.refineTarget = undefined;
              await this.frameAt(target, "exact").catch(() => undefined);
            }
          } finally {
            this.refining = false;
          }
        })();
      }
      return Promise.resolve(this.current);
    }
    const generation = ++this.generation;
    const run = this.queue.then(async () => {
      if (this.closed) return undefined;
      const seconds = mediaTimeToSeconds(sourceTime);
      if (this.contains(this.current, seconds)) return this.current;
      if (this.contains(this.ahead, seconds)) {
        this.release(this.current);
        this.current = this.ahead;
        this.ahead = undefined;
        this.lastTime = seconds;
        return this.current;
      }
      // The decoder is one frame past `current` when a frame was decoded ahead: that frame is given up first.
      const passed = this.ahead as DecodedFrame | undefined;
      this.release(this.ahead);
      this.ahead = undefined;
      const sink = await this.open();
      const sequential = this.iterator !== undefined && seconds >= this.lastTime && seconds < this.lastTime + FORWARD_WINDOW_S && (!passed || seconds >= passed.timestamp + passed.duration - BOUNDARY_S);
      if (!sequential) {
        await this.iterator?.return();
        // `samples(start)` begins at the key frame at or before the start and yields from the frame containing it.
        this.iterator = sink.samples(Math.max(0, seconds));
        this.counters.seeks++;
      }
      for (;;) {
        const next = await this.iterator!.next();
        if (next.done) { this.iterator = undefined; break; }
        const sample = next.value;
        const end = sample.timestamp + (sample.duration || 0);
        // Frames that end at or before the time are decoded past; the first one whose interval contains it is presented.
        if (end <= seconds + BOUNDARY_S) { sample.close(); continue; }
        const frame = await this.toFrame(sample);
        this.release(this.current);
        this.current = frame;
        break;
      }
      this.lastTime = seconds;
      return this.current;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  /**
   * The frame that follows the one containing a source time, for a frame blend: decoded once and kept until the
   * time reaches it. `undefined` at the end of the stream.
   */
  frameAfter(sourceTime: number): Promise<DecodedFrame | undefined> {
    const run = this.frameAt(sourceTime, "exact").then(async () => {
      if (this.closed || !this.current) return undefined;
      if (this.ahead && this.ahead.timestamp > this.current.timestamp) return this.ahead;
      if (!this.iterator) return undefined;
      const next = await this.iterator.next();
      if (next.done) { this.iterator = undefined; return undefined; }
      this.release(this.ahead);
      return this.ahead = await this.toFrame(next.value);
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Bytes of the decoded frames this session holds. */
  get bytes(): number { return (this.current?.bytes ?? 0) + (this.ahead?.bytes ?? 0); }

  async close(): Promise<void> {
    this.closed = true;
    await this.queue;
    await this.iterator?.return();
    this.iterator = undefined;
    this.release(this.current);
    this.current = undefined;
    this.release(this.ahead);
    this.ahead = undefined;
    this.input?.dispose?.();
    this.input = undefined;
    this.sink = undefined;
  }
}

/** Decoder sessions open at once: 8 on desktop and the render host, 6 on web, 3 on mobile. */
export const SESSION_LIMITS = { desktop: 8, host: 8, web: 6, mobile: 3 } as const;

/** The open sessions, least recently used first; opening one past the limit closes the oldest. */
export class SessionPool {
  private readonly sessions = new Map<string, VideoSession>();
  private readonly limit: number;
  private readonly create: (url: string) => VideoSession;
  closedOpenFrames = 0;
  constructor(limit: number, create: (url: string) => VideoSession = (url) => new VideoSession(url)) {
    this.limit = limit;
    this.create = create;
  }
  get size(): number { return this.sessions.size; }
  keys(): string[] { return [...this.sessions.keys()]; }
  /** The session for a key (`assetId:variant`), opened on demand. */
  async acquire(key: string, url: string): Promise<VideoSession> {
    let session = this.sessions.get(key);
    if (session && session.url !== url) { await this.close(key); session = undefined; }
    if (session) {
      this.sessions.delete(key);
      this.sessions.set(key, session);
      return session;
    }
    while (this.sessions.size >= this.limit) await this.close(this.sessions.keys().next().value as string);
    session = this.create(url);
    this.sessions.set(key, session);
    return session;
  }
  async close(key: string): Promise<void> {
    const session = this.sessions.get(key);
    if (!session) return;
    this.sessions.delete(key);
    await session.close();
    this.closedOpenFrames += session.counters.openFrames;
  }
  async closeAll(): Promise<void> {
    for (const key of [...this.sessions.keys()]) await this.close(key);
  }
  /** Frames still open across every session, including ones already closed: 0 after dispose. */
  get openFrames(): number {
    let open = this.closedOpenFrames;
    for (const session of this.sessions.values()) open += session.counters.openFrames;
    return open;
  }
  get bytes(): number {
    let total = 0;
    for (const session of this.sessions.values()) total += session.bytes;
    return total;
  }
  counters(key: string): SessionCounters | undefined { return this.sessions.get(key)?.counters; }
}
