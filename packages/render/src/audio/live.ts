import { TICKS_PER_SECOND } from "@jagentchill/protocol";
import { INTERNAL_SAMPLE_RATE } from "./gain.ts";
import { Limiter } from "./limiter.ts";
import { mixBlock, MixState, type MixClip, type SourceReader } from "./mixdown.ts";

/** How far ahead of the playhead audio is scheduled, and how often the scheduler runs. */
export const SCHEDULE_AHEAD_SECONDS = 2.0;
export const SCHEDULER_INTERVAL_MS = 200;
const CHUNK_SECONDS = 0.25;
/** Gap between `play` and the first audible sample: time to mix the first chunk. */
const START_DELAY_SECONDS = 0.06;

/**
 * Live audio output of the preview. The timeline mix is rendered ahead of the playhead with the same block mixer
 * and the same limiter as the export, and scheduled on the `AudioContext` clock; the transport position is read
 * back from that clock, so picture follows sound.
 */
export class LiveAudio {
  private context: AudioContext | undefined;
  private master: GainNode | undefined;
  /** A tap on the master bus, for metering and for tests. */
  analyser: AnalyserNode | undefined;
  private readonly limiter = new Limiter(2, INTERNAL_SAMPLE_RATE);
  /** Filter, compressor and ducking state of the mix, carried from chunk to chunk and reset with the limiter. */
  private mixState = new MixState();
  private clips: MixClip[] = [];
  private read: SourceReader | undefined;
  private nodes: AudioBufferSourceNode[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  private pumping = false;
  private generation = 0;
  private startPosition = 0;      // ticks
  private startContextTime = 0;   // seconds on the context clock at which `startPosition` sounds
  private scheduledFrames = 0;    // frames of the mix scheduled since the start
  private volume = 1;
  private muted = false;
  private endFrame = Number.MAX_SAFE_INTEGER;
  /** Called when the context stops running underneath the transport (a call, another app taking the output). */
  onInterrupted: () => void = () => undefined;
  /** Seconds of audio currently scheduled ahead of the playhead. */
  get scheduledAhead(): number {
    return this.context ? this.startContextTime + this.scheduledFrames / INTERNAL_SAMPLE_RATE - this.context.currentTime : 0;
  }
  get running(): boolean { return this.timer !== undefined; }

  private ensureContext(): AudioContext | undefined {
    if (this.context) return this.context;
    const Context = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
    if (!Context) return undefined;
    // On iOS the page asks for the playback session before the context exists, so the mute switch does not silence it.
    const session = (navigator as { audioSession?: { type: string } }).audioSession;
    if (session) session.type = "playback";
    const context = this.context = new Context({ sampleRate: INTERNAL_SAMPLE_RATE, latencyHint: "interactive" });
    this.master = context.createGain();
    this.analyser = context.createAnalyser();
    this.analyser.fftSize = 2048;
    this.master.connect(this.analyser).connect(context.destination);
    this.applyGain();
    context.addEventListener("statechange", () => { if (this.running && context.state !== "running") this.onInterrupted(); });
    return context;
  }

  private applyGain(): void {
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
  }
  /** Master volume, clamped to 0…1. */
  setVolume(volume: number): void { this.volume = Math.min(Math.max(volume, 0), 1); this.applyGain(); }
  /** Mute keeps the volume, so unmuting restores it. */
  setMuted(muted: boolean): void { this.muted = muted; this.applyGain(); }

  /**
   * Starts playback of `clips` from a timeline position. Resolves `false` when there is no audio output or the
   * context cannot be resumed; the transport then runs on the monotonic clock.
   */
  async start(clips: MixClip[], read: SourceReader, position: number, end: number): Promise<boolean> {
    this.stop();
    const context = this.ensureContext();
    if (!context) return false;
    try {
      if (context.state !== "running") await Promise.race([context.resume(), new Promise((_, reject) => setTimeout(() => reject(new Error("resume timed out")), 1000))]);
    } catch {
      return false;
    }
    if (context.state !== "running") return false;
    this.clips = clips;
    this.read = read;
    this.startPosition = position;
    this.endFrame = Math.round((end * INTERNAL_SAMPLE_RATE) / TICKS_PER_SECOND);
    this.startContextTime = context.currentTime + START_DELAY_SECONDS;
    this.scheduledFrames = 0;
    // Limiter state is reset at every transport start and seek.
    this.limiter.reset();
    this.mixState = new MixState();
    const generation = ++this.generation;
    this.timer = setInterval(() => { void this.pump(generation); }, SCHEDULER_INTERVAL_MS);
    // The first chunk is mixed before the clock starts to matter; the rest of the look-ahead follows in the background.
    await this.pump(generation, 1);
    void this.pump(generation);
    return true;
  }

  /** Replaces the clips while playing (an edit): what is already scheduled beyond the next 100 ms is dropped and mixed again. */
  async update(clips: MixClip[]): Promise<void> {
    const context = this.context;
    if (!context || !this.running || !this.read) return;
    const position = this.position();
    const read = this.read, end = (this.endFrame * TICKS_PER_SECOND) / INTERNAL_SAMPLE_RATE;
    await this.start(clips, read, Math.round(position), end);
  }

  /** Transport position in ticks from the audio clock: `start + (currentTime − startContextTime − outputLatency) × rate`. */
  position(): number {
    const context = this.context;
    if (!context) return this.startPosition;
    // The limiter's look-ahead delays the output by its length; it joins the output latency.
    const latency = (context.outputLatency || 0) + this.limiter.lookahead / INTERNAL_SAMPLE_RATE;
    return this.startPosition + Math.max(0, context.currentTime - this.startContextTime - latency) * TICKS_PER_SECOND;
  }

  /** Schedules chunks until two seconds are ahead of the playhead; a chunk that would start in the past is shortened or dropped. */
  private async pump(generation: number, maxChunks = Number.MAX_SAFE_INTEGER): Promise<void> {
    const context = this.context;
    if (!context || !this.read || this.pumping || generation !== this.generation) return;
    this.pumping = true;
    try {
      const chunk = Math.round(CHUNK_SECONDS * INTERNAL_SAMPLE_RATE);
      const firstFrame = Math.round((this.startPosition * INTERNAL_SAMPLE_RATE) / TICKS_PER_SECOND);
      for (let chunks = 0; chunks < maxChunks && generation === this.generation && this.scheduledAhead < SCHEDULE_AHEAD_SECONDS && firstFrame + this.scheduledFrames < this.endFrame; chunks++) {
        const length = Math.min(chunk, this.endFrame - firstFrame - this.scheduledFrames);
        const block = await mixBlock(this.clips, this.read, firstFrame + this.scheduledFrames, length, this.endFrame, this.mixState);
        if (generation !== this.generation) return;
        this.limiter.process(block, length);
        const buffer = context.createBuffer(2, length, INTERNAL_SAMPLE_RATE);
        buffer.copyToChannel(block[0] as Float32Array<ArrayBuffer>, 0);
        buffer.copyToChannel(block[1] as Float32Array<ArrayBuffer>, 1);
        const node = context.createBufferSource();
        node.buffer = buffer;
        node.connect(this.master!);
        const when = this.startContextTime + this.scheduledFrames / INTERNAL_SAMPLE_RATE;
        const late = context.currentTime - when;
        // A chunk that arrives after its time starts at once, offset by its lateness; one wholly in the past is dropped.
        if (late < length / INTERNAL_SAMPLE_RATE) {
          if (late > 0) node.start(context.currentTime, late); else node.start(when);
          this.nodes.push(node);
          node.onended = () => { const index = this.nodes.indexOf(node); if (index >= 0) this.nodes.splice(index, 1); };
        }
        this.scheduledFrames += length;
      }
    } finally {
      this.pumping = false;
    }
  }

  /** Stops everything that is scheduled. */
  stop(): void {
    this.generation++;
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    for (const node of this.nodes) { try { node.stop(); } catch { /* not started */ } node.disconnect(); }
    this.nodes = [];
  }

  /** An 80 ms (or one frame) snippet of the mix at a position, with 5 ms fades, for scrubbing. Does not start the transport. */
  async snippet(clips: MixClip[], read: SourceReader, position: number, seconds = 0.08): Promise<boolean> {
    const context = this.ensureContext();
    if (!context || context.state !== "running") return false;
    const length = Math.round(seconds * INTERNAL_SAMPLE_RATE);
    const block = await mixBlock(clips, read, Math.round((position * INTERNAL_SAMPLE_RATE) / TICKS_PER_SECOND), length);
    const fade = Math.min(Math.round(0.005 * INTERNAL_SAMPLE_RATE), Math.floor(length / 2));
    for (const channel of block) for (let index = 0; index < fade; index++) { channel[index] *= index / fade; channel[length - 1 - index] *= index / fade; }
    const buffer = context.createBuffer(2, length, INTERNAL_SAMPLE_RATE);
    buffer.copyToChannel(block[0] as Float32Array<ArrayBuffer>, 0);
    buffer.copyToChannel(block[1] as Float32Array<ArrayBuffer>, 1);
    const node = context.createBufferSource();
    node.buffer = buffer;
    node.connect(this.master!);
    node.start();
    return true;
  }

  async dispose(): Promise<void> {
    this.stop();
    await this.context?.close().catch(() => undefined);
    this.context = undefined;
  }
}
