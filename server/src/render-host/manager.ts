import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, ftruncateSync, mkdirSync, openSync, writeSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { EnvelopeReader, frameEnvelope } from "../../../packages/render/src/surface/host-protocol.ts";
import { RenderRecordReader } from "./records.ts";

export type RenderHostHello = { engineVersion: string; protocolVersion: number; backend: "webgpu" | "webgl2"; software: boolean; encoders?: Record<string, { supported: boolean; hardware?: boolean }>; audioEncoders?: { aac: boolean; opus: boolean; flac: boolean }; maxTextureSize?: number };
export type RenderHostState = { state: "stopped" | "starting" | "ready" | "unavailable"; hello?: RenderHostHello; reason?: string };
type Envelope = { v: 1; id: string; type: string; payload?: any; replyTo?: string; ok?: boolean; error?: { code: string; message: string; details?: Record<string, unknown> } };
type Running = { child: ChildProcess; hello: RenderHostHello; pending: Map<string, (message: Envelope) => void>; listeners: Set<(message: Envelope) => void>; stopWaiters: Set<() => void> };
export type RenderHostExportProgress = { stage: string; framesDone: number; frameCount: number; bytesDone?: number; bytesTotal?: number };
export type RenderHostExportResult = { exportId: string; frameCount: number; duration: number; bytes: number; elapsedMs: number };
export type MotionSceneProgress = { framesDone: number; frameCount: number };
export type MotionSceneResult = { requestId: string; frameCount: number; bytes: number; width: number; height: number; durationSeconds: number; fps: number };
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function rejectAfter<T>(operation: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<T>((_resolve, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })]);
  } finally { if (timer) clearTimeout(timer); }
}
async function finishAfter<T>(operation: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<T>((resolve) => { timer = setTimeout(() => resolve(undefined as T), ms); })]);
  } finally { if (timer) clearTimeout(timer); }
}

function childEnvironment(base: NodeJS.ProcessEnv, profileDir: string): NodeJS.ProcessEnv {
  const allowed = ["PATH", "TMPDIR", "TEMP", "TMP", "DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "LANG", "LC_ALL", "JAGENTCHILL_UNATTENDED"];
  const env = Object.fromEntries(allowed.flatMap((key) => base[key] ? [[key, base[key]!]] : []));
  const hostDataDir = dirname(profileDir);
  const homeDir = resolve(hostDataDir, "home");
  mkdirSync(homeDir, { recursive: true });
  env.HOME = homeDir;
  return env;
}

/** Starts the Electron engine on demand, reuses it while frames are requested and shuts it down after idle. */
export class RenderHostManager {
  private current?: Running;
  private idle?: NodeJS.Timeout;
  private readonly path?: string;
  private readonly idleMs: number;
  private readonly spawnChild: typeof spawn;
  private readonly log: (line: string) => void;
  private readonly userDataDir?: string;
  private stopping?: Promise<void>;
  private stateValue: RenderHostState = { state: "stopped" };

  constructor(options: { path?: string; idleMs?: number; spawnChild?: typeof spawn; log?: (line: string) => void; userDataDir?: string } = {}) {
    this.path = options.path ?? process.env.JAGENTCHILL_RENDER_HOST_PATH;
    this.idleMs = options.idleMs ?? 60_000;
    this.spawnChild = options.spawnChild ?? spawn;
    this.log = options.log ?? ((line) => console.log("[render-host] " + line));
    this.userDataDir = options.userDataDir;
  }
  status(): RenderHostState { return this.stateValue; }
  available(): boolean { return !!this.path && existsSync(this.path) && this.stateValue.state !== "unavailable" && !!this.stateValue.hello; }
  /** A configured renderer can be retried after a failed probe or a renderer process exit. */
  canStart(): boolean { return !!this.path && existsSync(this.path); }
  remoteCapabilities(hello = this.stateValue.hello) {
    if (!hello) throw new Error("RENDERER_UNAVAILABLE: render host capabilities are not known");
    const row = (supported: boolean | undefined, encoder: string, hardware?: boolean) => ({ state: supported ? "available" as const : "unavailable" as const, encoder, ...(hardware === undefined ? {} : { hardware }) });
    return {
      encoders: {
        h264: row(hello.encoders?.avc?.supported, "h264", hello.encoders?.avc?.hardware), hevc: row(hello.encoders?.hevc?.supported, "hevc", hello.encoders?.hevc?.hardware),
        vp9: row(hello.encoders?.vp9?.supported, "vp9", hello.encoders?.vp9?.hardware), av1: row(hello.encoders?.av1?.supported, "av1", hello.encoders?.av1?.hardware),
        aac: row(hello.audioEncoders?.aac, "aac"), opus: row(hello.audioEncoders?.opus, "opus"),
      }, containers: ["mp4", "mov", "webm"], proRes: false,
    };
  }
  async probe(): Promise<RenderHostState> {
    try {
      await this.start();
      const healthy = this.stateValue;
      await this.stop();
      return healthy;
    } catch (error) {
      const unhealthy: RenderHostState = { state: "unavailable", reason: error instanceof Error ? error.message : String(error) };
      await this.stop();
      this.stateValue = unhealthy;
      return unhealthy;
    }
  }

  private async start(): Promise<Running> {
    if (this.current) return this.current;
    if (!this.path) { this.stateValue = { state: "unavailable", reason: "render-host-path-missing" }; throw new Error("RENDERER_UNAVAILABLE: JAGENTCHILL_RENDER_HOST_PATH is not set"); }
    if (!this.userDataDir) { this.stateValue = { state: "unavailable", reason: "render-host-profile-missing" }; throw new Error("RENDERER_UNAVAILABLE: a private render-host profile directory is required"); }
    this.stateValue = { state: "starting" };
    const devApp = resolve(import.meta.dirname, "../../../apps/desktop");
    const appPath = process.env.JAGENTCHILL_RENDER_HOST_APP_PATH ?? (this.path?.includes("node_modules/electron") ? devApp : undefined);
    const profileDir = resolve(this.userDataDir);
    mkdirSync(profileDir, { recursive: true });
    const args = [...(appPath ? [appPath] : []), "--render-host", "--render-host-profile", profileDir];
    const child = this.spawnChild(this.path, args, { stdio: ["ignore", "ignore", "inherit", "pipe", "pipe"], env: childEnvironment(process.env, profileDir), windowsHide: true, detached: process.platform !== "win32" });
    this.log("spawned pid=" + child.pid);
    const pending = new Map<string, (message: Envelope) => void>();
    const listeners = new Set<(message: Envelope) => void>();
    const stopWaiters = new Set<() => void>();
    const running: Running = { child, hello: undefined as never, pending, listeners, stopWaiters };
    this.current = running;
    let resolveEnd!: () => void;
    const ended = new Promise<void>((resolve) => { resolveEnd = resolve; });
    const reader = new EnvelopeReader();
    child.stdio[3]?.on("data", (chunk: Buffer) => {
      let messages: unknown[];
      try { messages = reader.push(chunk); } catch (error) { this.log("invalid command pipe: " + String(error)); child.kill(); return; }
      for (const raw of messages) {
        const message = raw as Envelope;
        if (message.type === "hello") {
          running.hello = message.payload;
          this.stateValue = { state: "ready", hello: running.hello };
          this.log("process ready backend=" + running.hello.backend + " software=" + running.hello.software);
        }
        if (message.type === "reply" && message.replyTo) {
          const resolve = pending.get(message.replyTo);
          pending.delete(message.replyTo);
          resolve?.(message);
        }
        for (const listener of listeners) listener(message);
      }
    });
    const records = new RenderRecordReader();
    child.stdio[4]?.on("data", (chunk: Buffer) => {
      for (const record of records.push(chunk)) for (const listener of listeners) listener({ v: 1, id: "binary-" + record.sequence, type: "binary", payload: record });
    });
    child.once("error", (error) => { this.log("spawn failed: " + error.message); });
    child.once("exit", (code, signal) => {
      const reason = "RENDERER_UNAVAILABLE: render host exited code=" + code + " signal=" + signal;
      this.log("process exited code=" + code + " signal=" + signal);
      if (this.current === running) { this.current = undefined; this.stateValue = { state: "unavailable", reason }; }
      for (const resolve of pending.values()) resolve({ v: 1, id: "exit", type: "reply", ok: false, error: { code: "RENDERER_UNAVAILABLE", message: reason } });
      pending.clear(); for (const resolve of stopWaiters) resolve(); resolveEnd();
    });
    const hello = running.hello ?? await rejectAfter(
      new Promise<RenderHostHello>((resolve, reject) => {
        const onMessage = (message: Envelope) => { if (message.type === "hello") { listeners.delete(onMessage); resolve(message.payload); } };
        listeners.add(onMessage);
        void ended.then(() => { listeners.delete(onMessage); reject(new Error("RENDERER_UNAVAILABLE: child exited before hello")); });
      }),
      10_000,
      "RENDERER_UNAVAILABLE: render host did not answer hello within 10000 ms",
    );
    running.hello = hello;
    this.stateValue = { state: "ready", hello };
    this.log("booted and answered ping engine=" + hello.engineVersion + " backend=" + hello.backend + " software=" + hello.software);
    return running;
  }

  private async command(running: Running, type: string, payload: unknown): Promise<Envelope> {
    const id = randomUUID();
    const writable = running.child.stdio[3];
    if (!writable || !("write" in writable)) throw new Error("RENDERER_UNAVAILABLE: command pipe closed");
    const reply = new Promise<Envelope>((resolve) => running.pending.set(id, resolve));
    if (!writable.write(frameEnvelope({ v: 1, id, type, payload }))) await new Promise<void>((resolve, reject) => { writable.once("drain", resolve); writable.once("error", reject); });
    const result = await rejectAfter(reply, 10_000, "RENDERER_UNAVAILABLE: command " + type + " timed out");
    if (!result.ok) throw Object.assign(new Error(result.error?.message ?? type + " failed"), { code: result.error?.code, details: result.error?.details });
    return result;
  }

  async renderStill(input: { document: Record<string, any>; revision: number; sceneId?: string; time: number; width?: number; height?: number; format?: "png" | "jpeg"; mediaSources?: unknown[] }): Promise<Uint8Array> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try { return await this.renderOnce(input); }
      catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        if (attempt > 0 || (!(error as { code?: string }).code?.startsWith("RENDERER_UNAVAILABLE") && !text.startsWith("RENDERER_UNAVAILABLE"))) throw error;
        this.log("render host crashed during a frame; restarting once from the scene revision");
        await this.stop();
      }
    }
    throw new Error("RENDERER_UNAVAILABLE: render retry exhausted");
  }

  async exportStart(input: { exportId?: string; document: Record<string, any>; revision: number; sceneId?: string; mediaSources?: unknown[]; request: Record<string, unknown>; outputPath: string; progress?: (value: RenderHostExportProgress) => void }): Promise<RenderHostExportResult> {
    const running = await this.start();
    if (this.idle) clearTimeout(this.idle); this.idle = undefined;
    const activeSceneId = input.sceneId ?? input.document.scenes?.find((scene: any) => scene.isMain)?.id;
    if (!activeSceneId || !input.document.scenes?.some((scene: any) => scene.id === activeSceneId)) throw new Error("surface/invalid-payload: project has no requested scene");
    if (input.mediaSources?.length) await this.command(running, "media.setSources", { sources: input.mediaSources });
    await this.command(running, "scene.set", { revision: input.revision, activeSceneId, document: input.document });
    const exportId = input.exportId ?? randomUUID();
    const fd = (mkdirSync(dirname(input.outputPath), { recursive: true }), openSync(input.outputPath, "w"));
    const metadata = new Map<number, { position: number; bytes: number }>(), binary = new Map<number, Uint8Array>(), written = new Set<number>();
    let terminal: { ok: true; value: RenderHostExportResult } | { ok: false; error: Error } | undefined;
    let doneResult: RenderHostExportResult | undefined;
    let resolveResult!: (value: RenderHostExportResult) => void, rejectResult!: (error: Error) => void;
    const result = new Promise<RenderHostExportResult>((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
    const flush = () => {
      for (const [seq, bytes] of binary) {
        const meta = metadata.get(seq);
        if (!meta || written.has(seq)) continue;
        if (bytes.byteLength !== meta.bytes) { terminal = { ok: false, error: new Error(`export chunk ${seq} length mismatch`) }; break; }
        writeSync(fd, bytes, 0, bytes.byteLength, meta.position);
        written.add(seq); binary.delete(seq);
      }
      if (doneResult && metadata.size === written.size && [...metadata.keys()].every((seq) => written.has(seq))) {
        ftruncateSync(fd, doneResult.bytes); terminal = { ok: true, value: doneResult }; resolveResult(doneResult);
      } else if (terminal && !terminal.ok) rejectResult(terminal.error);
    };
    const onMessage = (message: Envelope) => {
      if (message.type === "export.progress" && message.payload?.exportId === exportId) input.progress?.(message.payload);
      if (message.type === "export.chunk" && message.payload?.exportId === exportId) {
        metadata.set(message.payload.seq, { position: message.payload.position ?? 0, bytes: message.payload.bytes }); flush();
      }
      if (message.type === "binary" && message.payload?.kind === "exportChunk") { binary.set(message.payload.sequence, message.payload.payload); flush(); }
      if (message.type === "export.done" && message.payload?.exportId === exportId) {
        const p = message.payload;
        doneResult = { exportId, frameCount: p.frameCount, duration: p.duration, bytes: p.bytes, elapsedMs: p.elapsedMs };
        terminal = { ok: true, value: doneResult }; flush();
      }
      if (message.type === "export.failed" && message.payload?.exportId === exportId) {
        terminal = { ok: false, error: new Error(`${message.payload.code}: ${message.payload.message}`) }; flush();
      }
    };
    running.listeners.add(onMessage);
    try {
      await this.command(running, "export.start", { ...input.request, exportId, sceneId: activeSceneId });
      const finished = await rejectAfter(result, 120_000, "RENDERER_UNAVAILABLE: export timed out after 120000 ms");
      this.idle = setTimeout(() => { this.log("idle interval elapsed; disposing render host"); void this.stop(); }, this.idleMs); this.idle.unref();
      return finished;
    } finally { running.listeners.delete(onMessage); closeSync(fd); }
  }

  async exportCancel(exportId: string): Promise<void> {
    const running = this.current;
    if (running) await this.command(running, "export.cancel", { exportId });
  }

  async renderMotionScene(input: { requestId?: string; html: string; width: number; height: number; durationSeconds: number; fps: number; outputPath: string; ffmpegPath: string; progress?: (value: MotionSceneProgress) => void }): Promise<MotionSceneResult> {
    const running = await this.start();
    if (this.idle) clearTimeout(this.idle); this.idle = undefined;
    const requestId = input.requestId ?? randomUUID();
    let resolveResult!: (value: MotionSceneResult) => void, rejectResult!: (error: Error) => void;
    const result = new Promise<MotionSceneResult>((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
    const onMessage = (message: Envelope) => {
      if (message.payload?.requestId !== requestId) return;
      if (message.type === "motion.progress") input.progress?.(message.payload);
      if (message.type === "motion.done") resolveResult(message.payload as MotionSceneResult);
      if (message.type === "motion.failed") rejectResult(Object.assign(new Error(message.payload?.message ?? "The motion scene could not be rendered."), { code: message.payload?.code ?? "MOTION_SCENE_FAILED" }));
    };
    running.listeners.add(onMessage);
    try {
      await this.command(running, "motion.render", { requestId, html: input.html, width: input.width, height: input.height, durationSeconds: input.durationSeconds, fps: input.fps, outputPath: input.outputPath, ffmpegPath: input.ffmpegPath });
      const rendered = await rejectAfter(result, 120_000, "MOTION_SCENE_TIMEOUT: the scene took longer than 120 seconds to render");
      this.idle = setTimeout(() => { this.log("idle interval elapsed; disposing render host"); void this.stop(); }, this.idleMs); this.idle.unref();
      return rendered;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("MOTION_SCENE_TIMEOUT")) await this.command(running, "motion.cancel", { requestId }).catch(() => undefined);
      throw error;
    } finally { running.listeners.delete(onMessage); }
  }

  async cancelMotionScene(requestId: string): Promise<void> {
    const running = this.current;
    if (running) await this.command(running, "motion.cancel", { requestId });
  }

  private async renderOnce(input: { document: Record<string, any>; revision: number; sceneId?: string; time: number; width?: number; height?: number; format?: "png" | "jpeg"; mediaSources?: unknown[] }): Promise<Uint8Array> {
    const running = await this.start();
    if (this.idle) clearTimeout(this.idle);
    const activeSceneId = input.sceneId ?? input.document.scenes?.find((scene: any) => scene.isMain)?.id;
    if (!activeSceneId || !input.document.scenes?.some((scene: any) => scene.id === activeSceneId)) throw new Error("surface/invalid-payload: project has no requested scene");
    if (input.mediaSources?.length) await this.command(running, "media.setSources", { sources: input.mediaSources });
    await this.command(running, "scene.set", { revision: input.revision, activeSceneId, document: input.document });
    const requestId = randomUUID();
    const result = new Promise<Uint8Array>((resolve, reject) => {
      const onMessage = (message: Envelope) => {
        if (message.type === "still.failed" && message.payload?.requestId === requestId) { running.listeners.delete(onMessage); reject(new Error(message.payload.code + ": " + message.payload.message)); }
        if (message.type === "binary" && message.payload?.kind === "still") { running.listeners.delete(onMessage); resolve(message.payload.payload); }
      };
      running.listeners.add(onMessage);
    });
    await this.command(running, "still.render", { requestId, time: input.time, width: input.width, height: input.height, format: input.format ?? "jpeg", quality: 90, source: "preview" });
    const output = await rejectAfter(result, 30_000, "RENDERER_UNAVAILABLE: still frame timeout");
    this.log("drew frame time=" + input.time + " bytes=" + output.byteLength);
    this.idle = setTimeout(() => { this.log("idle interval elapsed; disposing render host"); void this.stop(); }, this.idleMs); this.idle.unref();
    return output;
  }

  async stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    const work = this.stopCurrent();
    this.stopping = work;
    try { await work; } finally { if (this.stopping === work) this.stopping = undefined; }
  }

  /** Ordered host shutdown hook. Stops the Electron process and awaits its exit. */
  async dispose(): Promise<void> {
    await this.stop();
  }

  private async stopCurrent(): Promise<void> {
    if (this.idle) clearTimeout(this.idle); this.idle = undefined;
    const current = this.current; this.current = undefined;
    if (current) {
      const child = current.child;
      const exited = new Promise<void>((resolve) => current.stopWaiters.add(resolve));
      this.log("sending engine.dispose");
      try { await this.command(current, "engine.dispose", {}); this.log("engine.dispose acknowledged"); } catch (error) { this.log("engine.dispose failed: " + String(error)); child.kill("SIGTERM"); }
      await finishAfter(exited, 2_000);
      if (child.exitCode === null) {
        this.log("shutdown guard fired; terminating the remaining Electron process group");
        if (process.platform === "win32" && child.pid) this.spawnChild("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
        else if (child.pid) { try { process.kill(-child.pid, "SIGTERM"); } catch { /* the group already exited */ } }
        await wait(250);
        if (child.exitCode === null && child.pid) {
          if (process.platform === "win32") child.kill("SIGKILL");
          else { try { process.kill(-child.pid, "SIGKILL"); } catch { /* the group already exited */ } }
        }
      }
    }
    this.stateValue = { state: "stopped", ...(current?.hello ? { hello: current.hello } : {}) };
  }
}
