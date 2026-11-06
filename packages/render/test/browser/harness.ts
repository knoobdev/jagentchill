// Serves the engine bundle, the wasm binary and test media to headless Chromium, and runs functions in the page.
import { spawnSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize } from "node:path";
import { build } from "esbuild";
import { chromium, type Browser, type Page } from "playwright";
import type { Jc } from "./page.ts";

const require = createRequire(import.meta.url);
const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm", ".mp4": "video/mp4", ".webm": "video/webm", ".wav": "audio/wav", ".png": "image/png", ".ttf": "font/ttf", ".svg": "image/svg+xml" };
const w17BrowserBase = process.env.W17_TEST_BROWSER_PORT ? Number(process.env.W17_TEST_BROWSER_PORT) : undefined;
const activeW17BrowserPorts = new Set<number>();

function reserveBrowserPort(requested?: number): { port: number; release(): void } {
  if (w17BrowserBase === undefined) return { port: requested ?? 0, release() {} };
  const available = [w17BrowserBase, w17BrowserBase + 1, w17BrowserBase + 2];
  const port = requested ?? available.find((candidate) => !activeW17BrowserPorts.has(candidate));
  if (!port || !available.includes(port) || activeW17BrowserPorts.has(port)) throw new Error("W17 browser harness needs an unused port in W17_TEST_BROWSER_PORT..+2 (19117–19119).");
  activeW17BrowserPorts.add(port);
  return { port, release: () => { activeW17BrowserPorts.delete(port); } };
}

export type Harness = {
  page: Page; origin: string; tempDir: string;
  /** Directory served under `/media/`; tests write fixtures into it. */
  media: string;
  /** Console errors and page errors seen so far. */
  errors: string[];
  close(): Promise<void>;
};

export const ffmpeg = (args: string[]): void => {
  const run = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { encoding: "utf8" });
  if (run.status !== 0) throw new Error(`ffmpeg failed: ${run.stderr}`);
};
export const ffprobe = (file: string): any => {
  const run = spawnSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", "-count_frames", file], { encoding: "utf8" });
  if (run.status !== 0) throw new Error(`ffprobe failed: ${run.stderr}`);
  return JSON.parse(run.stdout);
};
export const hasFfmpeg = (): boolean => spawnSync("ffmpeg", ["-version"]).status === 0;

export async function startHarness(port?: number, directory?: string): Promise<Harness> {
  const out = directory ? join(directory) : mkdtempSync(join(tmpdir(), "jc-render-"));
  if (directory) mkdirSync(out, { recursive: true });
  const media = join(out, "media");
  mkdirSync(media);
  await build({ entryPoints: [join(import.meta.dirname, "page.ts")], outfile: join(out, "bundle.js"), bundle: true, format: "esm", platform: "browser", target: "es2022", logLevel: "silent", define: { "process.env.NODE_ENV": "\"test\"" } });
  // The export session's worker script, as the app bundles it.
  await build({ entryPoints: [join(import.meta.dirname, "../../src/surface/export-worker.ts")], outfile: join(out, "export-worker.js"), bundle: true, format: "esm", platform: "browser", target: "es2022", logLevel: "silent", define: { "process.env.NODE_ENV": "\"test\"" } });
  const wasmDir = dirname(require.resolve("@jagentchill/render-wasm"));
  const server: Server = createServer((request, response) => {
    const path = normalize(decodeURIComponent(new URL(request.url ?? "/", "http://x").pathname));
    if (path === "/") { response.writeHead(200, { "content-type": "text/html" }).end("<!doctype html><meta charset=utf-8><body style='margin:0'><script type=module src=/bundle.js></script>"); return; }
    // The installed Chrome asks for a favicon; there is none, and that is not an error of the page.
    if (path === "/favicon.ico") { response.writeHead(204).end(); return; }
    // `/slow/<ms>/<path>` answers `<path>` after a delay: a font or a file that takes its time.
    const slow = /^\/slow\/(\d+)(\/.*)$/.exec(path);
    if (slow) { setTimeout(() => { response.writeHead(302, { location: slow[2], "cache-control": "no-store" }).end(); }, Number(slow[1])); return; }
    const file = path.startsWith("/assets/") ? join(import.meta.dirname, "../../assets", path.slice(8)) : path.startsWith("/wasm/") ? join(wasmDir, path.slice(6)) : path.startsWith("/media/") ? join(media, path.slice(7)) : path.startsWith("/fixtures/") ? join(import.meta.dirname, "../fixtures", path.slice(10)) : join(out, path);
    if (!existsSync(file) || !statSync(file).isFile()) { response.writeHead(404).end(); return; }
    const size = statSync(file).size;
    const headers: Record<string, string | number> = { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "accept-ranges": "bytes", "cache-control": "no-store" };
    const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? "");
    if (range) {
      const start = Number(range[1]), end = Math.min(range[2] ? Number(range[2]) : size - 1, size - 1);
      response.writeHead(206, { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": end - start + 1 });
      createReadStream(file, { start, end }).pipe(response);
    } else {
      response.writeHead(200, { ...headers, "content-length": size });
      createReadStream(file).pipe(response);
    }
  });
  const portLease = reserveBrowserPort(port);
  try { await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(portLease.port, "127.0.0.1", resolve); }); }
  catch (error) { portLease.release(); throw error; }
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  // The engine starts audio from a command, not from a gesture inside the page (as on the mobile surface).
  // JC_GPU=1 runs in the installed Chrome with the machine's GPU instead of the bundled Chromium's software renderer.
  const gpu = process.env.JC_GPU === "1";
  const browser: Browser = await chromium.launch({
    ...(process.env.JC_TEST_BROWSER_EXECUTABLE ? { executablePath: process.env.JC_TEST_BROWSER_EXECUTABLE } : gpu ? { channel: "chrome" } : {}),
    args: ["--autoplay-policy=no-user-gesture-required", ...(gpu ? ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-webgpu"] : [])],
  });
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => { errors.push(String(error)); if (process.env.JC_DEBUG) console.error("pageerror", error); });
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(`${origin}/`);
  await page.waitForFunction(() => "jc" in window);
  return {
    page, origin, tempDir: out, media, errors,
    async close() {
      await browser.close();
      await new Promise((resolve) => server.close(resolve));
      portLease.release();
      if (!directory) rmSync(out, { recursive: true, force: true });
    },
  };
}

declare global { interface Window { jc: Jc } }

/** `actual` is within `tolerance` of `expected` on every channel. */
export function near(actual: number[], expected: number[], tolerance = 2): boolean {
  return actual.length === expected.length && actual.every((channel, index) => Math.abs(channel - expected[index]) <= tolerance);
}
