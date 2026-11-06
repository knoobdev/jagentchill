import type { FrameDescriptor } from "../frame/descriptor.ts";
import type { TextureRequest } from "../frame/build.ts";

import { loadWasm, type Wasm } from "./wasm.ts";
export type FrameReport = { diagnostics: { id: string; subject: string }[]; stages: string[]; passes: number };
export type BackendInfo = { backend: "webgpu" | "webgl2"; software: boolean; maxTextureSize: number };
/** What a texture request resolves to: a browser image source or straight RGBA bytes, with the key that tells whether it changed. */
export type ResolvedTexture = { key: string; width: number; height: number; source?: ImageBitmap | OffscreenCanvas | HTMLCanvasElement; pixels?: Uint8Array };

/** Frames a texture may go unreferenced before it is released. */
export const TEXTURE_IDLE_FRAMES = 120;

type Cached = { key: string; bytes: number; lastFrame: number };

/** A bitmap that was closed has no area: uploading it is refused by the GPU as a validation error. */
const released = (source: unknown): boolean => typeof source === "object" && source !== null && "width" in source && (source as { width: number }).width === 0;

/**
 * The compositor driver: owns the wasm module, the texture cache and the upload rules. A texture is uploaded only
 * when its cache key changes; one not referenced for 120 rendered frames is released; the least recently used go
 * first when GPU texture memory passes the pool budget.
 */
export class CompositorDriver {
  readonly info: BackendInfo;
  readonly counters = { textureUpload: 0, textureCacheHit: 0, textureUploadPixels: 0, renderFrame: 0 };
  private readonly wasm: Wasm;
  private readonly cache = new Map<string, Cached>();
  private frame = 0;
  private budget: number;

  private constructor(wasm: Wasm, info: BackendInfo, budget: number) {
    this.wasm = wasm;
    this.info = info;
    this.budget = budget;
  }

  /** Loads the wasm module, initialises the GPU on the chosen backend and creates the compositor. */
  static async create(options: { wasmUrl?: string | URL; width: number; height: number; forceBackend?: "webgl2"; textureBudget: number }): Promise<CompositorDriver> {
    const wasm = await loadWasm(options.wasmUrl);
    await wasm.initializeGpu({ forceBackend: options.forceBackend });
    wasm.initCompositor({ width: options.width, height: options.height });
    return new CompositorDriver(wasm, wasm.getBackendInfo() as BackendInfo, options.textureBudget);
  }

  get canvas(): HTMLCanvasElement { return this.wasm.getCompositorCanvas(); }
  /** Calls back once when the WebGPU device under this compositor is lost. */
  onDeviceLost(callback: (message: string) => void): void { this.wasm.onDeviceLost(callback); }
  /** Test hooks: a panic inside the module, and a destroyed device. */
  debugPanic(): void { this.wasm.debugPanic(); }
  debugLoseDevice(): void { this.wasm.debugLoseDevice(); }
  get textureBytes(): number { let total = 0; for (const entry of this.cache.values()) total += entry.bytes; return total; }
  get textureCount(): number { return this.cache.size; }
  stats(): { textures: number; textureBytes: number; poolBytes: number; poolCreated: number } { return this.wasm.getTextureStats(); }
  listShaders(): string[] { return this.wasm.listShaders() as string[]; }
  setBudget(bytes: number): void { this.budget = bytes; }

  /**
   * Makes every requested texture current. `resolve` is asked only for a texture that is not cached, or whose
   * content can change between frames (a video frame); a texture whose key is unchanged is not uploaded again.
   */
  async sync(requests: TextureRequest[], resolve: (request: TextureRequest) => Promise<ResolvedTexture | undefined>, sameFrame = false): Promise<Set<string>> {
    const missing = new Set<string>();
    // A second sync of one frame (substitute textures) keeps the frame counter, so nothing of the frame is evicted.
    if (!sameFrame) this.frame++;
    for (const request of requests) {
      const cached = this.cache.get(request.id);
      // A video frame and the frame of an animated sticker change between frames: they are resolved every time.
      // So does the person matte of a video: it is a track decoded in lock-step with the source frame.
      const changing = request.kind === "video" || (request.kind === "sticker" && request.animation !== undefined) || (request.kind === "person-matte" && request.sourceTime !== null);
      if (cached && !changing) {
        cached.lastFrame = this.frame;
        this.counters.textureCacheHit++;
        continue;
      }
      let resolved = await resolve(request);
      // A decoded frame whose session was closed while this request waited (another asset took its place in the pool)
      // has no picture any more: it is decoded once more, and stays missing for this frame if that fails too.
      if (resolved && released(resolved.source)) resolved = await resolve(request);
      if (!resolved || released(resolved.source)) { missing.add(request.id); continue; }
      if (cached && cached.key === resolved.key) {
        cached.lastFrame = this.frame;
        this.counters.textureCacheHit++;
        continue;
      }
      // No source dimension exceeds maxTextureSize: a larger one is downscaled with its aspect kept, and a source
      // without area (or one the GPU refuses) is a missing texture, never a failed frame.
      const fitted = fitTexture(resolved, this.info.maxTextureSize);
      if (!fitted) { missing.add(request.id); continue; }
      try {
        if (fitted.pixels) this.wasm.uploadTexturePixels({ id: request.id, data: fitted.pixels, width: fitted.width, height: fitted.height });
        else this.wasm.uploadTexture({ id: request.id, source: fitted.source, width: fitted.width, height: fitted.height });
      } catch (error) {
        // A wasm trap is not an upload refusal: the engine's recovery handles it.
        if (error instanceof WebAssembly.RuntimeError) throw error;
        missing.add(request.id);
        continue;
      }
      resolved.width = fitted.width; resolved.height = fitted.height;
      this.counters.textureUpload++;
      this.counters.textureUploadPixels += resolved.width * resolved.height;
      this.cache.set(request.id, { key: resolved.key, bytes: resolved.width * resolved.height * 4, lastFrame: this.frame });
    }
    this.evict();
    return missing;
  }

  private evict(): void {
    for (const [id, entry] of this.cache) if (this.frame - entry.lastFrame >= TEXTURE_IDLE_FRAMES) this.release(id);
    if (this.textureBytes <= this.budget) return;
    const byAge = [...this.cache.entries()].sort((a, b) => a[1].lastFrame - b[1].lastFrame);
    for (const [id, entry] of byAge) {
      if (this.textureBytes <= this.budget) break;
      // A texture referenced by the current frame is never released.
      if (entry.lastFrame !== this.frame) this.release(id);
    }
  }

  release(id: string): void {
    if (!this.cache.delete(id)) return;
    this.wasm.releaseTexture({ id });
  }
  /** Releases every texture the current frame does not use and the pooled render targets. */
  trim(): void {
    for (const [id, entry] of this.cache) if (entry.lastFrame !== this.frame) this.release(id);
    this.wasm.trimCompositor();
  }

  render(descriptor: FrameDescriptor): FrameReport {
    this.counters.renderFrame++;
    return this.wasm.renderFrame({ descriptor }) as FrameReport;
  }
  resize(width: number, height: number): void { this.wasm.resizeCompositor({ width, height }); }
  /** RGBA8 pixels of the last rendered frame: straight alpha, top-left origin. */
  readPixels(x: number, y: number, width: number, height: number): Promise<Uint8Array> { return this.wasm.readPixels({ x, y, width, height }); }
  /** Resolves when the GPU has drawn everything submitted so far. */
  drawn(): Promise<void> { return this.wasm.frameDrawn(); }
  profile(): { name?: string; durationMs?: number; stage?: string }[] { return this.wasm.getLastFrameProfile() as never; }

  destroy(): void {
    this.cache.clear();
    this.wasm.destroy();
  }
}

/**
 * A texture as it may be uploaded: both sides whole, at least 1 px and at most `limit`. A larger source is drawn
 * down with its aspect preserved; `null` when the source has no area or no finite size.
 */
export function fitTexture(texture: ResolvedTexture, limit: number): ResolvedTexture | null {
  const width = Math.floor(texture.width), height = Math.floor(texture.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 || (!texture.source && !texture.pixels)) return null;
  if (texture.pixels && texture.pixels.length !== width * height * 4) return null;
  const max = Math.max(1, Math.floor(limit) || 8192);
  if (width <= max && height <= max) return width === texture.width && height === texture.height ? texture : { ...texture, width, height };
  const scale = Math.min(max / width, max / height);
  const canvas = new OffscreenCanvas(Math.max(1, Math.floor(width * scale)), Math.max(1, Math.floor(height * scale)));
  const context = canvas.getContext("2d")!;
  let source: CanvasImageSource | undefined = texture.source;
  if (!source) {
    // Straight RGBA bytes are scaled as bytes, row by row: a canvas of the source size may itself be too large.
    const out = new Uint8Array(canvas.width * canvas.height * 4), pixels = texture.pixels!;
    for (let y = 0; y < canvas.height; y++) {
      const sy = Math.min(height - 1, Math.floor(((y + 0.5) * height) / canvas.height));
      for (let x = 0; x < canvas.width; x++) {
        const sx = Math.min(width - 1, Math.floor(((x + 0.5) * width) / canvas.width));
        out.set(pixels.subarray((sy * width + sx) * 4, (sy * width + sx) * 4 + 4), (y * canvas.width + x) * 4);
      }
    }
    return { key: texture.key, width: canvas.width, height: canvas.height, pixels: out };
  }
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return { key: texture.key, width: canvas.width, height: canvas.height, source: canvas };
}
