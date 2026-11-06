import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { ProtocolError } from "../errors.ts";
import type { BlobStore } from "./blobs.ts";

export type MediaJobKind = "media.proxy" | "media.transcode" | "media.thumb" | "media.filmstrip" | "media.waveform";
export type MediaVariant = "preview" | "mezzanine" | "thumb" | "waveform" | "filmstrip";
export type MediaJob = { jobId: string; kind: MediaJobKind; sha256: string; variant: MediaVariant; state: "queued" | "running" | "succeeded" | "failed"; progress: number; error?: string; created_ms: number; finished_ms?: number };
export type MediaProbe = { video: boolean; audio: boolean; image: boolean; width: number; height: number; duration_s: number; codec: string };
export type MediaJobsDeps = {
  blobs: BlobStore; dir: string; now: () => number;
  db?: DatabaseSync;
  /** Configured locations of the tools; without them `ffmpeg` and `ffprobe` are looked up on PATH. */
  ffmpegPath?: () => string | undefined; ffprobePath?: () => string | undefined;
  /** The environment the lookup reads; replaced in tests to show a host without FFmpeg. */
  env?: () => Record<string, string | undefined>;
  onFinished?: (job: MediaJob) => void;
  onChanged?: (job: MediaJob) => void;
};
const PREVIEW_SHORT_SIDE = 720;
const unavailable = () => new ProtocolError("FFMPEG_UNAVAILABLE", "FFmpeg was not found on this host: no proxy, thumbnail or mezzanine can be produced.", { httpStatus: 503 });

/**
 * The host's media jobs: `media.proxy` (the one synced preview format — H.264 fitted to 1280×720 or 720×1280 with the
 * source's timestamps), its thumbnail, and `media.transcode` (a mezzanine at source size). One job runs at a time, on
 * the system's FFmpeg. A host without FFmpeg says so; nothing is faked.
 */
export function createMediaJobs(deps: MediaJobsDeps) {
  const { blobs, now } = deps;
  const jobs = new Map<string, MediaJob>(), queue: MediaJob[] = [];
  let running = false, closed = false, child: ReturnType<typeof spawn> | undefined;
  let activeWork: Promise<void> | undefined;
  let closing: Promise<void> | undefined;
  const key = (sha256: string, variant: string) => `${sha256}/${variant}`;
  const save = (job: MediaJob): void => {
    deps.db?.prepare("INSERT INTO media_jobs (job_id, kind, sha256, variant, state, error, created_ms, finished_ms, progress) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(job_id) DO UPDATE SET state = excluded.state, error = excluded.error, finished_ms = excluded.finished_ms, progress = excluded.progress")
      .run(job.jobId, job.kind, job.sha256, job.variant, job.state, job.error ?? null, job.created_ms, job.finished_ms ?? null, job.progress);
    deps.onChanged?.({ ...job });
  };
  if (deps.db) {
    const stored = deps.db.prepare("SELECT job_id, kind, sha256, variant, state, error, created_ms, finished_ms, progress FROM media_jobs WHERE kind LIKE 'media.%' ORDER BY created_ms").all() as Array<{ job_id: string; kind: MediaJobKind; sha256: string; variant: MediaVariant; state: MediaJob["state"]; error: string | null; created_ms: number; finished_ms: number | null; progress: number }>;
    for (const row of stored) {
      const job: MediaJob = { jobId: row.job_id, kind: row.kind, sha256: row.sha256, variant: row.variant, state: row.state === "running" ? "queued" : row.state, progress: row.state === "running" ? 0 : row.progress, ...(row.error ? { error: row.error } : {}), created_ms: row.created_ms, ...(row.finished_ms === null ? {} : { finished_ms: row.finished_ms }) };
      jobs.set(key(job.sha256, job.variant), job);
      if (job.state === "queued") queue.push(job);
    }
  }
  function find(name: "ffmpeg" | "ffprobe"): string | undefined {
    const env = deps.env?.() ?? process.env;
    const configured = (name === "ffmpeg" ? deps.ffmpegPath?.() : deps.ffprobePath?.()) ?? env[name === "ffmpeg" ? "JAGENTCHILL_FFMPEG" : "JAGENTCHILL_FFPROBE"];
    if (configured) return existsSync(configured) ? configured : undefined;
    for (const directory of (env.PATH ?? "").split(delimiter).filter(Boolean)) for (const file of [name, `${name}.exe`]) if (existsSync(join(directory, file))) return join(directory, file);
    return undefined;
  }
  const tools = (): { ffmpeg: string; ffprobe: string } | undefined => { const ffmpeg = find("ffmpeg"), ffprobe = find("ffprobe"); return ffmpeg && ffprobe ? { ffmpeg, ffprobe } : undefined; };
  function probe(path: string): Promise<MediaProbe> {
    const found = tools();
    if (!found) return Promise.reject(unavailable());
    return new Promise((resolve, reject) => execFile(found.ffprobe, ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", path], { maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      if (error) return reject(new ProtocolError("INVALID_PARAMS", "The file is not media FFmpeg can read."));
      const parsed = JSON.parse(stdout) as { streams?: any[]; format?: { duration?: string; format_name?: string } };
      // A cover picture carried inside a song (an attached picture) is a "video" stream to FFmpeg; it is not moving picture.
      const video = (parsed.streams ?? []).find((stream) => stream.codec_type === "video" && stream.disposition?.attached_pic !== 1), audio = (parsed.streams ?? []).some((stream) => stream.codec_type === "audio");
      const image = Boolean(video) && /image2|png_pipe|jpeg_pipe|webp_pipe|gif/.test(parsed.format?.format_name ?? "") && !audio;
      resolve({ video: Boolean(video) && !image, audio, image, width: Number(video?.width ?? 0), height: Number(video?.height ?? 0), duration_s: Number(parsed.format?.duration ?? 0), codec: String(video?.codec_name ?? "") });
    }));
  }
  function run(file: string, args: string[], job?: MediaJob, duration_s = 0): Promise<void> {
    return new Promise((resolve, reject) => {
      if (closed) { reject(new Error("Media job cancelled during host shutdown.")); return; }
      let stderr = "";
      let progressBuffer = "";
      const target = args.at(-1)!;
      const command = job ? [...args.slice(0, -1), "-progress", "pipe:1", "-nostats", target] : args;
      child = spawn(file, command, { stdio: ["ignore", job ? "pipe" : "ignore", "pipe"] });
      child.stderr!.on("data", (data) => { stderr = (stderr + String(data)).slice(-2000); });
      if (job) child.stdout!.on("data", (data: Buffer) => {
        progressBuffer += String(data);
        const lines = progressBuffer.split("\n"); progressBuffer = lines.pop() ?? "";
        for (const line of lines) if (line.startsWith("out_time_ms=") && duration_s > 0) {
          const progress = Math.min(0.99, Number(line.slice(12)) / 1_000_000 / duration_s);
          if (Number.isFinite(progress) && progress >= job.progress + 0.01) { job.progress = progress; save(job); }
        }
      });
      child.on("error", reject);
      child.on("close", (code) => { child = undefined; if (code === 0) resolve(); else reject(new Error(`ffmpeg exited ${code}: ${stderr.split("\n").filter(Boolean).slice(-2).join(" | ")}`)); });
    });
  }
  function capture(file: string, args: string[], maxBuffer = 128 * 1024 * 1024): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const proc = spawn(file, args, { stdio: ["ignore", "pipe", "pipe"] }), chunks: Buffer[] = [];
      let size = 0, stderr = "", tooLarge = false;
      proc.stdout!.on("data", (chunk: Buffer) => { size += chunk.length; if (size > maxBuffer) { tooLarge = true; proc.kill("SIGKILL"); } else chunks.push(chunk); });
      proc.stderr!.on("data", (chunk: Buffer) => { stderr = (stderr + String(chunk)).slice(-2000); });
      proc.on("error", reject);
      proc.on("close", (code) => tooLarge ? reject(new Error("ffmpeg output exceeded the media-analysis buffer limit")) : code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error("ffmpeg exited " + code + ": " + stderr)));
    });
  }
  async function work(job: MediaJob): Promise<void> {
    const found = tools();
    if (!found) throw unavailable();
    const source = blobs.locate(job.sha256), facts = await probe(source.path);
    if (closed) throw new Error("Media job cancelled during host shutdown.");
    mkdirSync(deps.dir, { recursive: true, mode: 0o700 });
    const extension = job.variant === "thumb" || job.variant === "filmstrip" ? "jpg" : job.variant === "waveform" ? "json" : "mp4";
    const out = join(deps.dir, `${job.jobId}.${extension}`);
    try {
      if (job.variant === "thumb") {
        await run(found.ffmpeg, ["-y", "-v", "error", "-i", source.path, "-frames:v", "1", "-vf", "scale=320:320:force_original_aspect_ratio=decrease", "-q:v", "4", out], job, facts.duration_s);
        blobs.addVariant(job.sha256, "thumb", out, "image/jpeg", `${source.sha256.slice(0, 12)}.thumb.jpg`);
        return;
      }
      if (job.variant === "waveform") {
        if (!facts.audio) throw new ProtocolError("INVALID_PARAMS", "Only audio with a decodable audio stream has a waveform.");
        const pcm = await capture(found.ffmpeg, ["-v", "error", "-i", source.path, "-vn", "-ac", "1", "-ar", "1000", "-f", "s16le", "-"]);
        const samples = Math.floor(pcm.length / 2), peaks: number[] = [];
        for (let bucket = 0; bucket < 256; bucket++) {
          const start = Math.floor(bucket * samples / 256), end = Math.floor((bucket + 1) * samples / 256);
          let peak = 0;
          for (let i = start; i < end; i++) peak = Math.max(peak, Math.abs(pcm.readInt16LE(i * 2)));
          peaks.push(Number((peak / 32768).toFixed(4)));
        }
        writeFileSync(out, JSON.stringify({ sampleRate: 1000, duration_s: facts.duration_s, peaks }));
        blobs.addVariant(job.sha256, "waveform", out, "application/json", source.sha256.slice(0, 12) + ".waveform.json");
        return;
      }
      if (job.variant === "filmstrip") {
        if (!facts.video) throw new ProtocolError("INVALID_PARAMS", "Only video has a filmstrip.");
        const frames = Math.max(1, Math.min(24, Math.ceil(facts.duration_s))), columns = Math.min(6, frames), rows = Math.ceil(frames / columns);
        await run(found.ffmpeg, ["-y", "-v", "error", "-i", source.path, "-vf", "fps=1,scale=160:90:force_original_aspect_ratio=decrease,pad=160:90:(ow-iw)/2:(oh-ih)/2,tile=" + columns + "x" + rows, "-frames:v", "1", "-q:v", "4", out], job, facts.duration_s);
        blobs.addVariant(job.sha256, "filmstrip", out, "image/jpeg", source.sha256.slice(0, 12) + ".filmstrip.jpg");
        const timesFile = join(deps.dir, job.jobId + ".times.json");
        try {
          writeFileSync(timesFile, JSON.stringify({ sprite: "filmstrip", frameTimes_s: Array.from({ length: frames }, (_, index) => Math.min(index, Math.max(0, facts.duration_s - 0.001))) }));
          blobs.addVariant(job.sha256, "filmstripdata", timesFile, "application/json", source.sha256.slice(0, 12) + ".filmstrip-times.json");
        } finally { rmSync(timesFile, { force: true }); }
        return;
      }
      if (!facts.video) throw new ProtocolError("INVALID_PARAMS", "Only video has a preview or a mezzanine.");
      // The proxy is fitted inside 1280×720 (landscape) or 720×1280 (portrait); the mezzanine keeps the source size.
      // Frames keep their source timestamps (no frame-rate conversion), so a cut made on the proxy lands on the same source frame.
      const box = facts.width >= facts.height ? "1280:720" : "720:1280";
      const scale = job.variant === "preview" ? ["-vf", `scale=${box}:force_original_aspect_ratio=decrease:force_divisible_by=2`] : ["-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2"];
      await run(found.ffmpeg, ["-y", "-v", "error", "-i", source.path, ...scale, "-c:v", "libx264", "-preset", "veryfast", "-crf", job.variant === "preview" ? "23" : "18", "-pix_fmt", "yuv420p",
        "-fps_mode", "passthrough", "-enc_time_base", "demux", ...(facts.audio ? ["-c:a", "aac", "-b:a", "128k"] : ["-an"]), "-movflags", "+faststart", "-f", "mp4", out], job, facts.duration_s);
      blobs.addVariant(job.sha256, job.variant, out, "video/mp4", `${source.sha256.slice(0, 12)}.${job.variant}.mp4`);
    } finally { rmSync(out, { force: true }); }
  }
  function pump(): void {
    if (running || closed) return;
    const job = queue.shift();
    if (!job) return;
    running = true; job.state = "running"; job.progress = Math.max(0.01, job.progress); save(job);
    activeWork = work(job).then(() => { job.state = "succeeded"; job.progress = 1; }, (error) => { job.state = "failed"; job.error = error instanceof Error ? error.message : String(error); })
      .finally(() => { job.finished_ms = now(); running = false; save(job); deps.onFinished?.(job); pump(); });
    void activeWork.catch(() => undefined);
  }
  function enqueue(sha256: string, variant: MediaJob["variant"]): MediaJob {
    const existing = jobs.get(key(sha256, variant));
    if (existing && (existing.state === "queued" || existing.state === "running")) return existing;
    const job: MediaJob = { jobId: randomUUID(), kind: variant === "preview" ? "media.proxy" : variant === "thumb" ? "media.thumb" : variant === "waveform" ? "media.waveform" : variant === "filmstrip" ? "media.filmstrip" : "media.transcode", sha256, variant, state: "queued", progress: 0, created_ms: now() };
    jobs.set(key(sha256, variant), job);
    save(job);
    queue.push(job);
    pump();
    return job;
  }

  pump();
  return {
    /** Whether this host can run media jobs at all. */
    available: (): boolean => tools() !== undefined,
    status: (): { available: boolean; reason?: string } => tools() ? { available: true } : { available: false, reason: "Media tools missing: ffmpeg and ffprobe are required. Install them on PATH or package both binaries in the desktop release." },
    tools, probe,
    /** The job that is producing a variant, when one is queued or running. */
    active(sha256: string, variant: string): MediaJob | undefined { const job = jobs.get(key(sha256, variant)); return job && (job.state === "queued" || job.state === "running") ? job : undefined; },
    job: (sha256: string, variant: string): MediaJob | undefined => jobs.get(key(sha256, variant)),
    get: (jobId: string): MediaJob | undefined => [...jobs.values()].find((job) => job.jobId === jobId),
    list: (): MediaJob[] => [...jobs.values()],
    /**
     * Asks for a variant. `ready`: it exists. `queued`: a job produces it. `not-needed`: the source is 720 px or
     * smaller on its shorter side (or is not video), so the original is the editing media.
     */
    async request(sha256: string, variant: "preview" | "thumb" | "waveform" | "mezzanine" | "filmstrip" | "filmstripdata"): Promise<{ state: "ready"; size: number; sha256: string } | { state: "queued"; jobId: string } | { state: "not-needed"; reason: string }> {
      if (closed) throw new ProtocolError("UNAVAILABLE", "The host is shutting down.", { httpStatus: 503, retryable: true });
      const status = blobs.status(sha256);
      if (status.state === "absent") throw new ProtocolError("NOT_FOUND", "No such blob.", { httpStatus: 404 });
      if (status.variants[variant]) return { state: "ready", ...status.variants[variant] };
      if (status.state !== "complete") throw new ProtocolError("BLOB_INCOMPLETE", "The original is not on the host yet.", { httpStatus: 409, retryable: true, details: { missing: [] } });
      if (!tools()) throw unavailable();
      const facts = await probe(blobs.locate(sha256).path);
      if (closed) throw new ProtocolError("UNAVAILABLE", "The host is shutting down.", { httpStatus: 503, retryable: true });
      if (variant === "thumb") return facts.video || facts.image ? { state: "queued", jobId: enqueue(sha256, "thumb").jobId } : { state: "not-needed", reason: "audio" };
      if (variant === "waveform") return facts.audio ? { state: "queued", jobId: enqueue(sha256, "waveform").jobId } : { state: "not-needed", reason: "no-audio" };
      if (!facts.video) return { state: "not-needed", reason: "not-video" };
      if (variant === "filmstripdata") return { state: "not-needed", reason: "filmstrip-not-ready" };
      if (variant === "filmstrip") return { state: "queued", jobId: enqueue(sha256, "filmstrip").jobId };
      if (variant === "preview" && Math.min(facts.width, facts.height) <= PREVIEW_SHORT_SIDE) return { state: "not-needed", reason: "small-source" };
      return { state: "queued", jobId: enqueue(sha256, variant).jobId };
    },
    /** An original arrived on the host: its proxy (when it needs one) and its thumbnail are produced without being asked. */
    async originalArrived(sha256: string): Promise<void> {
      if (closed || !tools()) return;
      try {
        const facts = await probe(blobs.locate(sha256).path);
        if (closed) return;
        if (facts.video && Math.min(facts.width, facts.height) > PREVIEW_SHORT_SIDE) enqueue(sha256, "preview");
        if (facts.video || facts.image) enqueue(sha256, "thumb");
      } catch { /* not media: nothing to produce */ }
    },
    /** Resolves when no job is queued or running (tests). */
    async idle(): Promise<void> { while (running || queue.length) await new Promise((resolve) => setTimeout(resolve, 20)); },
    async close(): Promise<void> {
      if (closing) return closing;
      closed = true;
      queue.length = 0;
      child?.kill("SIGKILL");
      closing = (async () => { await activeWork; })();
      return closing;
    },
  };
}
export type MediaJobs = ReturnType<typeof createMediaJobs>;
