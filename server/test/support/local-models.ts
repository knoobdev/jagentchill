// TEST DOUBLES for the local models: a small HTTP server that serves the "model files" (a few hundred KB of random
// bytes each) with Range support and scripted faults, a ZIP writer, and a manifest that points at that server with the
// real hashes of those bytes. The engine in the archive is `fixtures/fake-sd-cli.mjs`. No real model or engine is used.
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";
import type { LocalFile, LocalManifest } from "../../src/local-models/manifest.ts";
import type { HardwareProbe } from "../../src/local-models/hardware.ts";

/** A ZIP archive of these entries (deflated; `mode` kept as Unix permissions). */
export function makeZip(entries: { name: string; data: Buffer; mode?: number }[]): Buffer {
  const locals: Buffer[] = [], centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name), packed = deflateRawSync(entry.data), crc = crc32(entry.data) >>> 0;
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(entry.data.length, 22); local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(0x031e, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(8, 10); central.writeUInt32LE(crc, 16); central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(entry.data.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(((0o100000 | (entry.mode ?? 0o644)) << 16) >>> 0, 38); central.writeUInt32LE(offset, 42);
    locals.push(local, name, packed); centrals.push(central, name);
    offset += local.length + name.length + packed.length;
  }
  const directory = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

export const FAKE_ENGINE = join(import.meta.dirname, "..", "fixtures", "fake-sd-cli.mjs");
export type Fixture = {
  url: string; manifest: LocalManifest; files: Record<string, Buffer>; requests: { path: string; range?: string }[];
  /** Scripted faults: the next answer for a path breaks after this many bytes, sends other bytes, ignores the range, or trickles (a few KB a second). */
  faults: { cutAfter?: Record<string, number>; corrupt?: Set<string>; /** The next this-many answers for a path send other bytes. */ corruptTimes?: Record<string, number>; ignoreRange?: boolean; slow?: Set<string> };
  close(): Promise<void>;
};
const sha = (data: Buffer) => createHash("sha256").update(data).digest("hex");

/** The fixture server and its manifest: an engine archive for every platform, two picture-model quants per variant, a text encoder and a VAE. */
export async function startModelFixture(): Promise<Fixture> {
  const engineZip = makeZip([{ name: "sd-cli", data: readFileSync(FAKE_ENGINE), mode: 0o755 }, { name: "stable-diffusion.cpp.txt", data: Buffer.from("MIT (test double)") }]);
  const files: Record<string, Buffer> = { "/engine.zip": engineZip, "/llm.gguf": randomBytes(300_000), "/vae.safetensors": randomBytes(120_000) };
  for (const variant of ["standard", "uncensored"]) for (const quant of ["q4", "q5", "q6", "q8"]) files[`/${variant}-${quant}.gguf`] = randomBytes(200_000 + quant.charCodeAt(1) * 1000);
  const fixture: Fixture = { url: "", manifest: undefined as unknown as LocalManifest, files, requests: [], faults: {}, close: async () => undefined };
  const server: Server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0]!, body = files[path];
    fixture.requests.push({ path, ...(req.headers.range ? { range: String(req.headers.range) } : {}) });
    if (!body) return void res.writeHead(404).end();
    const times = fixture.faults.corruptTimes?.[path] ?? 0;
    if (times) fixture.faults.corruptTimes![path] = times - 1;
    let data = fixture.faults.corrupt?.has(path) || times ? randomBytes(body.length) : body, start = 0;
    fixture.faults.corrupt?.delete(path);
    const range = /^bytes=(\d+)-$/.exec(String(req.headers.range ?? ""));
    if (range && !fixture.faults.ignoreRange) {
      start = Number(range[1]);
      if (start >= data.length) return void res.writeHead(416).end();
      res.writeHead(206, { "content-length": data.length - start, "content-range": `bytes ${start}-${data.length - 1}/${data.length}` });
    } else res.writeHead(200, { "content-length": data.length });
    data = data.subarray(start);
    const cut = fixture.faults.cutAfter?.[path];
    if (cut !== undefined) { delete fixture.faults.cutAfter![path]; res.write(data.subarray(0, cut)); setTimeout(() => res.destroy(), 20); return; }
    if (fixture.faults.slow?.has(path)) {
      let at = 0;
      const timer = setInterval(() => { if (at >= data.length || res.destroyed) { clearInterval(timer); if (!res.destroyed) res.end(); return; } res.write(data.subarray(at, at + 4096)); at += 4096; }, 50);
      res.on("close", () => clearInterval(timer));
      return;
    }
    res.end(data);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address() as { port: number };
  fixture.url = `http://127.0.0.1:${address.port}`;
  const file = (id: string, path: string, at: string, role: LocalFile["role"], label: string, unpackTo?: string): LocalFile => ({ id, label, url: `${fixture.url}${path}`, bytes: files[path]!.length, sha256: sha(files[path]!), path: at, role, ...(unpackTo ? { unpackTo } : {}) });
  const engine = (key: string) => ({ key, label: `Test engine (${key})`, files: [file(`engine-${key}`, "/engine.zip", `engine/test/${key}/engine.zip`, "engine", "Engine", `engine/test/${key}/bin`)] });
  const quants = (variant: string) => Object.fromEntries(["q4", "q5", "q6", "q8"].map((quant) => [quant, file(`${variant}-${quant}`, `/${variant}-${quant}.gguf`, `qwen-image-2.1/${variant}/${quant}.gguf`, "diffusion", `Picture model (${quant.toUpperCase()})`)])) as LocalManifest["variants"]["standard"]["quants"];
  fixture.manifest = {
    engine: { name: "stable-diffusion.cpp (test double)", version: "test", sourceUrl: "https://github.com/leejet/stable-diffusion.cpp", builds: Object.fromEntries(["darwin", "linux-x64-vulkan", "linux-x64-cpu", "win32-x64-cuda", "win32-x64-cpu"].map((key) => [key, engine(key)])) },
    license: { name: "Qwen Research License (non-commercial)", url: "https://huggingface.co/Qwen/Qwen-Image-2.1/blob/main/LICENSE" },
    variants: { standard: { label: "Standard", description: "Test double.", quants: quants("standard") }, uncensored: { label: "Uncensored", description: "Test double.", quants: quants("uncensored") } },
    shared: [file("llm", "/llm.gguf", "qwen-image-2.1/shared/llm.gguf", "llm", "Text encoder"), file("vae", "/vae.safetensors", "qwen-image-2.1/shared/vae.safetensors", "vae", "Image decoder (VAE)")],
  };
  fixture.close = () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); });
  return fixture;
}

const GIB = 1_073_741_824;
/** A reading of a made-up computer. */
export function fakeProbe(reading: { platform?: string; arch?: string; totalGiB: number; availableGiB?: number; nvidia?: { name: string; totalMiB: number; freeMiB: number }; freeDiskBytes?: number; cpu?: string }): HardwareProbe {
  return {
    platform: reading.platform ?? "darwin", arch: reading.arch ?? "arm64", cpuModel: () => reading.cpu ?? "Apple M3 Pro", cores: () => 12,
    totalBytes: () => reading.totalGiB * GIB, availableBytes: () => (reading.availableGiB ?? reading.totalGiB / 2) * GIB,
    run: async (file) => (file === "nvidia-smi" && reading.nvidia ? `${reading.nvidia.name}, ${reading.nvidia.totalMiB}, ${reading.nvidia.freeMiB}, 560.94\n` : file === "sysctl" ? (reading.arch === "arm64" ? "1\n" : "0\n") : undefined),
    freeBytes: () => reading.freeDiskBytes ?? 500 * GIB,
  };
}
