import { secondsToTicks } from "@jagentchill/editor-core";
import { message, MIB, STORAGE_RESERVE_BYTES, type MediaMessage } from "./messages.ts";

/**
 * Recording session logic: naming, the pause-aware clock, incremental writes so an interrupted recording keeps what
 * was captured, the low-storage stop, and recovery after a crash. Capture itself is done by a platform driver
 * (MediaRecorder on web and desktop, the native recorder on mobile).
 */
export type RecordingKind = "camera" | "screen" | "voice";
export const RECORDING_COUNTDOWN_SECONDS = 3;
/** Data reaches storage at least this often. */
export const RECORDING_FLUSH_MS = 2000;
export const RECORDING_STORAGE_CHECK_MS = 5000;
/** Recording stops when free space after the 50 MiB reserve falls below this. */
export const RECORDING_MIN_FREE_BYTES = 100 * MIB;

/** Screen recording is unavailable on mobile and the option is omitted there. */
export const recordingSources = (platform: "web" | "desktop" | "mobile"): RecordingKind[] => (platform === "mobile" ? ["camera", "voice"] : ["camera", "screen", "voice"]);
/** A 3 s countdown precedes screen and camera recording. */
export const recordingCountdown = (kind: RecordingKind): number => (kind === "voice" ? 0 : RECORDING_COUNTDOWN_SECONDS);
const two = (value: number): string => String(value).padStart(2, "0");
/** "Camera recording 2026-10-05 17.46.09" — local time, a name every file system accepts. */
export function recordingName(kind: RecordingKind, at: Date): string {
  const label = { camera: "Camera", screen: "Screen", voice: "Voice" }[kind];
  return `${label} recording ${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())} ${two(at.getHours())}.${two(at.getMinutes())}.${two(at.getSeconds())}`;
}
export const recordingStorageLow = (freeBytes: number | null): boolean => freeBytes !== null && freeBytes - STORAGE_RESERVE_BYTES < RECORDING_MIN_FREE_BYTES;

export interface RecorderDriver {
  /** Starts capture; `onData` receives encoded chunks at least every `timesliceMs`. */
  start(timesliceMs: number, onData: (chunk: Uint8Array) => void): Promise<void>;
  pause(): void;
  resume(): void;
  /** Resolves when the last chunk was delivered. */
  stop(): Promise<void>;
  readonly mimeType: string;
}
/** Incremental storage of a recording in progress. */
export interface RecordingStore {
  begin(id: string, manifest: RecordingManifest): Promise<void>;
  append(id: string, chunk: Uint8Array): Promise<void>;
  /** Marks the recording complete and returns its bytes' location for the import pipeline. */
  finish(id: string): Promise<void>;
  /** Recordings that were begun and never finished. */
  unfinished(): Promise<(RecordingManifest & { id: string; bytes: number })[]>;
  discard(id: string): Promise<void>;
}
export type RecordingManifest = { projectId: string; kind: RecordingKind; name: string; mimeType: string; started_ms: number };
export type RecordingState = "idle" | "recording" | "paused" | "stopped";
export type RecordingResult = { id: string; name: string; mimeType: string; /** Sum of the recorded segments, in ticks. */ duration: number; bytes: number; provenance: { source: "recorded" }; stoppedForStorage: boolean; notice: MediaMessage | null };

export type RecordingOptions = {
    id: string; projectId: string; kind: RecordingKind;
    driver: RecorderDriver; store: RecordingStore;
    freeBytes(): Promise<number | null>;
    now?: () => number;
    onStoppedForStorage?: (result: RecordingResult) => void;
    setInterval?: typeof setInterval; clearInterval?: typeof clearInterval;
  };

export class RecordingSession {
  state: RecordingState = "idle";
  private recordedMs = 0;
  private segmentStart = 0;
  private bytes = 0;
  private writes: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setInterval> | undefined;
  private stoppedForStorage = false;
  private finishing: Promise<RecordingResult> | undefined;
  private manifest!: RecordingManifest;
  private readonly options: RecordingOptions;
  constructor(options: RecordingOptions) { this.options = options; }
  private now(): number { return (this.options.now ?? Date.now)(); }

  async start(): Promise<void> {
    if (this.state !== "idle") throw new Error("recording already started");
    if (recordingStorageLow(await this.options.freeBytes())) throw new Error("not enough storage to record");
    const started = this.now();
    this.manifest = { projectId: this.options.projectId, kind: this.options.kind, name: recordingName(this.options.kind, new Date(started)), mimeType: this.options.driver.mimeType, started_ms: started };
    await this.options.store.begin(this.options.id, this.manifest);
    await this.options.driver.start(RECORDING_FLUSH_MS, (chunk) => {
      this.bytes += chunk.length;
      // Chunks are appended in arrival order; a slow store never reorders them.
      this.writes = this.writes.then(() => this.options.store.append(this.options.id, chunk)).catch(() => undefined);
    });
    this.segmentStart = this.now();
    this.state = "recording";
    this.timer = (this.options.setInterval ?? setInterval)(() => void this.checkStorage(), RECORDING_STORAGE_CHECK_MS);
  }
  /** Elapsed recorded time in milliseconds: paused time is not recorded. */
  get elapsedMs(): number {
    return this.recordedMs + (this.state === "recording" ? this.now() - this.segmentStart : 0);
  }
  pause(): void {
    if (this.state !== "recording") return;
    this.recordedMs += this.now() - this.segmentStart;
    this.options.driver.pause();
    this.state = "paused";
  }
  resume(): void {
    if (this.state !== "paused") return;
    this.options.driver.resume();
    this.segmentStart = this.now();
    this.state = "recording";
  }
  private async checkStorage(): Promise<void> {
    if (this.state !== "recording" && this.state !== "paused") return;
    if (!recordingStorageLow(await this.options.freeBytes().catch(() => null))) return;
    this.stoppedForStorage = true;
    this.options.onStoppedForStorage?.(await this.stop());
  }
  /** Stops and keeps what was captured. The result becomes a managed asset through the import pipeline. */
  stop(): Promise<RecordingResult> {
    return (this.finishing ??= (async () => {
      if (this.state === "recording") this.recordedMs += this.now() - this.segmentStart;
      this.state = "stopped";
      (this.options.clearInterval ?? clearInterval)(this.timer);
      await this.options.driver.stop();
      await this.writes;
      await this.options.store.finish(this.options.id);
      return {
        id: this.options.id, name: this.manifest.name, mimeType: this.manifest.mimeType, duration: secondsToTicks(this.recordedMs / 1000), bytes: this.bytes,
        provenance: { source: "recorded" as const }, stoppedForStorage: this.stoppedForStorage, notice: this.stoppedForStorage ? message("media.recording.storage-low") : null,
      };
    })());
  }
}
/** After a crash: every unfinished recording of the project is offered as "Recovered recording". */
export async function recoverableRecordings(store: RecordingStore, projectId: string): Promise<{ id: string; label: string; name: string; mimeType: string; bytes: number; kind: RecordingKind }[]> {
  const label = message("media.recording.recovered").text;
  return (await store.unfinished()).filter((entry) => entry.projectId === projectId && entry.bytes > 0).map((entry) => ({ id: entry.id, label, name: entry.name, mimeType: entry.mimeType, bytes: entry.bytes, kind: entry.kind }));
}
