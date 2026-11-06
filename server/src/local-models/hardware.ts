import { execFile } from "node:child_process";
import { existsSync, statfsSync } from "node:fs";
import { cpus, freemem, totalmem } from "node:os";
import { dirname } from "node:path";
import { LOCAL_MODEL_QUANTS, LOCAL_MODEL_VARIANTS, type LocalHardware, type LocalModelQuant, type LocalModelVariant, type LocalVerdict, type LocalVerdictKind } from "@jagentchill/protocol";
import { engineKey, filesOf, type LocalManifest } from "./manifest.ts";

/** How the host is read; every reading is replaced in tests by fixed numbers. */
export type HardwareProbe = {
  platform: string; arch: string; cpuModel(): string; cores(): number; totalBytes(): number; availableBytes(): number;
  /** A command's output, or undefined when it does not exist or fails (`nvidia-smi`, `sysctl`). */
  run(file: string, args: string[]): Promise<string | undefined>;
  /** Free bytes of the volume that holds `path` (or its nearest existing parent). */
  freeBytes(path: string): number;
};

export const systemProbe: HardwareProbe = {
  platform: process.platform, arch: process.arch,
  cpuModel: () => cpus()[0]?.model?.trim() || "Unknown processor", cores: () => cpus().length, totalBytes: () => totalmem(), availableBytes: () => freemem(),
  run: (file, args) => new Promise((resolve) => { execFile(file, args, { timeout: 5000, windowsHide: true }, (error, stdout) => resolve(error ? undefined : String(stdout))); }),
  freeBytes(path) { let at = path; while (!existsSync(at) && dirname(at) !== at) at = dirname(at); const stats = statfsSync(at); return Number(stats.bavail) * Number(stats.bsize); },
};

const MIB = 1_048_576, GIB = 1_073_741_824;
/**
 * What the host has, measured now: memory, the graphics processor and the free disk where the models are kept. An
 * NVIDIA card is what `nvidia-smi` lists (the one with the most memory); Apple Silicon is a Mac whose processor is
 * arm64 (also when this process runs translated: `sysctl hw.optional.arm64`), and its memory is unified.
 */
export async function readHardware(folder: string, probe: HardwareProbe, now: number): Promise<LocalHardware> {
  const totalBytes = probe.totalBytes();
  // macOS counts only untouched pages as free; what an app can have at once also takes the inactive, speculative and purgeable pages (`vm_stat`).
  let availableBytes = probe.availableBytes();
  if (probe.platform === "darwin") {
    const vm = await probe.run("vm_stat", []), page = Number(/page size of (\d+) bytes/.exec(vm ?? "")?.[1]);
    const pages = (name: string) => Number(new RegExp(`Pages ${name}:\\s+(\\d+)`).exec(vm ?? "")?.[1] ?? 0);
    if (vm && page > 0) availableBytes = Math.max(availableBytes, (pages("free") + pages("inactive") + pages("speculative") + pages("purgeable")) * page);
  }
  const base = { platform: probe.platform, arch: probe.arch, cpu: { model: probe.cpuModel(), cores: probe.cores() }, memory: { totalBytes, availableBytes: Math.min(totalBytes, availableBytes) }, disk: { path: folder, freeBytes: probe.freeBytes(folder) }, checked_ms: now };
  if (probe.platform === "darwin") {
    const silicon = probe.arch === "arm64" || (await probe.run("sysctl", ["-n", "hw.optional.arm64"]))?.trim() === "1";
    return { ...base, ...(silicon ? { arch: "arm64" } : {}), gpu: silicon ? { kind: "apple", name: base.cpu.model, unifiedBytes: totalBytes } : { kind: "none" } };
  }
  const smi = await probe.run("nvidia-smi", ["--query-gpu=name,memory.total,memory.free,driver_version", "--format=csv,noheader,nounits"]);
  const cards = (smi ?? "").split(/\r?\n/).map((line) => line.split(",").map((part) => part.trim())).filter((parts) => parts.length >= 3 && Number(parts[1]) > 0)
    .map(([name, total, free, driver]) => ({ kind: "nvidia" as const, name: name!, vramBytes: Number(total) * MIB, vramFreeBytes: Math.max(0, Number(free) || 0) * MIB, ...(driver ? { driver } : {}) }))
    .sort((a, b) => b.vramBytes - a.vramBytes);
  return { ...base, gpu: cards[0] ?? { kind: "none" } };
}

/** Working memory of one 1024 px picture beyond the weights (activations, the prefix cache of the prompt, the decoder's buffers). */
export const WORKING_BYTES = 3 * GIB;
/** What macOS and the open apps keep for themselves before a model can count on unified memory. */
const SYSTEM_HEADROOM = 4 * GIB;
/** The least the system needs beside a model that is run with parts moved in turn (below it, the computer only swaps). */
const SYSTEM_MINIMUM = 1.5 * GIB;
/** Room left on the disk after the download. */
const DISK_MARGIN = GIB;
const gb = (bytes: number) => `${(bytes / 1e9).toFixed(1)} GB`;

/**
 * A verdict per variant and quant, before anything is downloaded: what it needs (the weights it loads, plus the
 * working memory of one picture) against what was measured.
 *  - Apple Silicon: all of it in unified memory. Runs well with room left for the system; runs (slower, parts kept in
 *    main memory and moved in turn) when it fits at all; else not enough memory.
 *  - NVIDIA: the text encoder runs once and leaves the card (`--offload-to-cpu`), so the card needs the larger of the
 *    two models, the decoder and the working memory; main memory holds every file. Card too small but enough main
 *    memory: runs slowly.
 *  - No usable graphics processor: the processor makes the picture — slow, minutes a picture — when main memory holds it.
 *  - Disk: what is still to be downloaded, and a margin, must fit where the models are kept.
 */
export function verdictsOf(hardware: LocalHardware, manifest: LocalManifest, onDisk: (fileId: string) => boolean): LocalVerdict[] {
  const build = engineKey(hardware.platform, hardware.arch, hardware.gpu.kind === "nvidia");
  const out: LocalVerdict[] = [];
  for (const variant of LOCAL_MODEL_VARIANTS) {
    const rows: LocalVerdict[] = [];
    for (const quant of LOCAL_MODEL_QUANTS) {
      const files = filesOf(manifest, variant, quant, build), size = (role: string) => files.filter((file) => file.role === role).reduce((sum, file) => sum + file.bytes, 0);
      const diffusion = size("diffusion"), llm = size("llm"), vae = size("vae");
      const downloadBytes = files.reduce((sum, file) => sum + file.bytes, 0), remainingBytes = files.filter((file) => !onDisk(file.id)).reduce((sum, file) => sum + file.bytes, 0);
      const memoryBytes = diffusion + llm + vae + WORKING_BYTES, vramBytes = Math.max(diffusion, llm) + vae + WORKING_BYTES, diskBytes = remainingBytes + DISK_MARGIN;
      const reasons: LocalVerdict["reasons"] = [], mem = hardware.memory, gpu = hardware.gpu;
      let verdict: LocalVerdictKind;
      if (!build) {
        verdict = "unsupported";
        reasons.push({ text: "The engine has no build for this computer ({platform}, {arch})", params: { platform: hardware.platform, arch: hardware.arch } });
      } else if (gpu.kind === "apple") {
        reasons.push({ text: "Unified memory: {have} — this needs about {need}", params: { have: gb(mem.totalBytes), need: gb(memoryBytes) } });
        verdict = mem.totalBytes >= memoryBytes + SYSTEM_HEADROOM ? "well" : mem.totalBytes >= memoryBytes + SYSTEM_MINIMUM ? "slow" : "memory";
        if (verdict === "slow") reasons.push({ text: "Parts of the model are kept in main memory and moved in turn: slower" });
      } else if (gpu.kind === "nvidia") {
        reasons.push({ text: "Graphics card {card}: {have} of memory — this needs about {need}", params: { card: gpu.name, have: gb(gpu.vramBytes), need: gb(vramBytes) } });
        reasons.push({ text: "Main memory: {have} — this needs about {need}", params: { have: gb(mem.totalBytes), need: gb(memoryBytes) } });
        verdict = gpu.vramBytes >= vramBytes && mem.totalBytes >= memoryBytes ? "well" : mem.totalBytes >= memoryBytes + SYSTEM_MINIMUM ? "slow" : "memory";
        if (verdict === "slow") reasons.push({ text: "The graphics card is too small for this quant: parts run from main memory, slower" });
      } else {
        reasons.push({ text: "No supported graphics processor: the processor makes the picture, several minutes each" });
        reasons.push({ text: "Main memory: {have} — this needs about {need}", params: { have: gb(mem.totalBytes), need: gb(memoryBytes) } });
        verdict = mem.totalBytes >= memoryBytes + SYSTEM_MINIMUM ? "slow" : "memory";
      }
      if (verdict !== "unsupported" && hardware.disk.freeBytes < diskBytes) {
        reasons.push({ text: "Free disk: {have} — the download needs {need}", params: { have: gb(hardware.disk.freeBytes), need: gb(diskBytes) } });
        verdict = "disk";
      }
      if ((verdict === "well" || verdict === "slow") && mem.availableBytes < memoryBytes) reasons.push({ text: "Free memory right now: {have} — close other apps before making pictures", params: { have: gb(mem.availableBytes) } });
      rows.push({ variant, quant, verdict, reasons, needs: { memoryBytes, ...(gpu.kind === "nvidia" ? { vramBytes } : {}), diskBytes }, downloadBytes, remainingBytes, recommended: false });
    }
    // The recommended quant: the largest that runs well; none does — the smallest that runs at all.
    const pick = [...rows].reverse().find((row) => row.verdict === "well") ?? rows.find((row) => row.verdict === "slow");
    if (pick) pick.recommended = true;
    out.push(...rows);
  }
  return out;
}
export const verdictFor = (verdicts: readonly LocalVerdict[], variant: LocalModelVariant, quant: LocalModelQuant) => verdicts.find((entry) => entry.variant === variant && entry.quant === quant);
