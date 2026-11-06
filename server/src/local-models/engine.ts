import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { ProviderFailure } from "../generation/adapter.ts";

/** The largest picture file the engine may hand back (a 1024 px PNG is a few MB). */
export const OUTPUT_MAX_BYTES = 64 * 1_048_576;
/** Steps of the sampler by the request's quality (the engine's default is 20). */
export const STEPS = { low: 12, medium: 20, high: 30 } as const;
/** Width × height of each aspect ratio for a longest side of 1024 px: about one megapixel, each side a multiple of 32 (what the model takes). */
const SHAPES: Record<string, [number, number]> = { "1:1": [1024, 1024], "16:9": [1344, 768], "9:16": [768, 1344], "4:3": [1184, 896], "3:4": [896, 1184], "3:2": [1248, 832], "2:3": [832, 1248] };
export const LOCAL_ASPECT_RATIOS = Object.keys(SHAPES);
/**
 * The picture size for an aspect ratio at the host's size setting: 1024 is the model's own size class (about one
 * megapixel, 1024 × 1024 for a square); 768 and 512 scale both sides down (multiples of 32), for less memory and time.
 */
export function sizeOf(aspectRatio: string | undefined, size: number): { width: number; height: number } {
  const [width, height] = SHAPES[aspectRatio ?? "1:1"] ?? SHAPES["1:1"]!, scale = Math.min(1, size / 1024);
  const round = (value: number) => Math.max(256, Math.round((value * scale) / 32) * 32);
  return { width: round(width), height: round(height) };
}

export type EngineJob = {
  program: string; files: { diffusion: string; llm: string; vae: string };
  prompt: string; negativePrompt?: string; width: number; height: number; steps: number; seed: number;
  /** A LoRA applied to the picture (`--lora-model-dir` and `<lora:name:weight>` in the prompt). */
  lora?: { dir: string; name: string; weight: number };
  /** Keep the models in main memory and move each to the graphics processor in turn (not enough memory to hold them all there). */
  offload: boolean;
  workDir: string; timeoutMs: number; signal: AbortSignal; progress(fraction: number): void;
};
/**
 * The engine's command line for one picture (stable-diffusion.cpp `sd-cli`, flags of `examples/common/common.cpp`).
 * Guidance 1.0, as Qwen's own demo runs Qwen-Image-2.1 (`true_cfg_scale` 1, no negative prompt): pictures as natural, in half the time.
 */
export function engineArgs(job: Omit<EngineJob, "program" | "signal" | "progress" | "timeoutMs" | "workDir">, output: string): string[] {
  return [
    "--diffusion-model", job.files.diffusion, "--vae", job.files.vae, "--llm", job.files.llm,
    "-p", job.lora ? `${job.prompt}<lora:${job.lora.name}:${job.lora.weight}>` : job.prompt, ...(job.negativePrompt ? ["-n", job.negativePrompt] : []),
    ...(job.lora ? ["--lora-model-dir", job.lora.dir] : []),
    "-W", String(job.width), "-H", String(job.height), "--steps", String(job.steps), "--cfg-scale", "1.0", "--sampling-method", "euler", "-s", String(job.seed),
    ...(job.offload ? ["--offload-to-cpu"] : []), "-o", output,
  ];
}
/** The engine said it ran out of memory (Metal, CUDA, Vulkan, the C++ allocator). */
const OUT_OF_MEMORY = /out of memory|failed to allocate|cudaMalloc|insufficient memory|ErrorOutOfDeviceMemory|OutOfMemory|bad_alloc|not enough memory/i;
/** A progress line of the sampler: `|====>   | 3/20 - 1.23s/it` (`src/core/util.cpp`, `pretty_progress`). */
const STEP = /(\d+)\/(\d+) - [\d.]+(?:s\/it|it\/s)/g;

/**
 * Runs the engine for one picture and returns the PNG it wrote. Progress follows the sampler's steps; the time limit
 * and a cancel stop the process (TERM, then KILL). Failures are put in the classes of the generation service: out of
 * memory, a time-out, a cancel, an engine that is missing, or an engine that stopped for another reason (its last words).
 */
export function runEngine(job: EngineJob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    mkdirSync(job.workDir, { recursive: true, mode: 0o700 });
    const output = join(job.workDir, "picture.png");
    rmSync(output, { force: true });
    if (!existsSync(job.program)) return reject(new ProviderFailure("model_unavailable", "The engine of the local model is missing. Download the model again under Settings, Providers, Generation, Local models."));
    const env = { ...process.env, ...(process.platform === "linux" ? { LD_LIBRARY_PATH: [dirname(job.program), process.env.LD_LIBRARY_PATH].filter(Boolean).join(":") } : {}) };
    const child = spawn(job.program, engineArgs(job, output), { cwd: dirname(job.program), env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let tail = "", stopped: "timeout" | "cancelled" | undefined, settled = false;
    const stop = (why: "timeout" | "cancelled") => { if (stopped) return; stopped = why; child.kill("SIGTERM"); setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }, 3000).unref(); };
    const timer = setTimeout(() => stop("timeout"), job.timeoutMs);
    const onAbort = () => stop("cancelled");
    job.signal.addEventListener("abort", onAbort, { once: true });
    if (job.signal.aborted) stop("cancelled");
    job.progress(0.05);
    const read = (chunk: Buffer) => {
      tail = (tail + chunk.toString("utf8")).slice(-8192);
      let last: RegExpExecArray | undefined;
      for (const found of tail.matchAll(STEP)) last = found as RegExpExecArray;
      if (last) { const step = Number(last[1]), steps = Number(last[2]); if (steps > 0) job.progress(0.1 + 0.85 * Math.min(1, step / steps)); }
    };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    const end = (error?: ProviderFailure, bytes?: Uint8Array) => {
      if (settled) return;
      settled = true; clearTimeout(timer); job.signal.removeEventListener("abort", onAbort);
      if (error) reject(error); else resolve(bytes!);
    };
    child.on("error", (error: NodeJS.ErrnoException) => end(new ProviderFailure("model_unavailable", error.code === "EACCES" ? "The engine of the local model cannot be started (permission denied)." : "The engine of the local model could not be started.", { details: { providerMessage: error.message } })));
    child.on("close", (code, signal) => {
      if (stopped === "cancelled") return end(new ProviderFailure("cancelled", "Cancelled."));
      if (stopped === "timeout") return end(new ProviderFailure("timeout", `The picture took longer than the time limit (${Math.round(job.timeoutMs / 60_000)} min). Choose a smaller quant or picture size, or raise the limit.`));
      const last = tail.split(/[\r\n]+/).map((line) => line.trim()).filter(Boolean).slice(-3).join(" · ").slice(0, 500);
      // Killed by the system without being asked to stop: that is the system taking memory back.
      if (OUT_OF_MEMORY.test(tail) || (code === null && signal === "SIGKILL")) return end(new ProviderFailure("out_of_memory", "This computer ran out of memory for this picture.", { details: { providerMessage: last } }));
      if (code !== 0) return end(new ProviderFailure("unknown", `The local engine stopped (exit ${code ?? signal}).`, { details: { providerMessage: last } }));
      if (!existsSync(output)) return end(new ProviderFailure("invalid_output", "The local engine wrote no picture.", { details: { providerMessage: last } }));
      const size = statSync(output).size;
      if (size > OUTPUT_MAX_BYTES) return end(new ProviderFailure("invalid_output", "The local engine wrote a picture larger than the limit."));
      const bytes = readFileSync(output);
      rmSync(output, { force: true });
      end(undefined, bytes);
    });
  });
}
