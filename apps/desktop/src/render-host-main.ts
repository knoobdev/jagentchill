import { BrowserWindow, app, protocol, session } from "electron";
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { Readable } from "node:stream";
import { spawn, type ChildProcess } from "node:child_process";
import { refusesUnattendedDefaultProfile } from "./profile-guard.ts";
import { EnvelopeReader, frameEnvelope, recordHeader } from "../../../packages/render/src/surface/host-protocol.ts";

const assets = join(__dirname, "render-host");
const commandFd = 3;
const frameFd = 4;
let windowRef: BrowserWindow | undefined;
let commandClosed = false;
let sequence = 0;
const commandTypes = new Map<string, string>();
type MotionJob = { cancelled: boolean; window?: BrowserWindow; ffmpeg?: ChildProcess; cancelCapture?: () => void };
const motionJobs = new Map<string, MotionJob>();

const profileArg = process.argv.indexOf("--render-host-profile");
const profileDir = profileArg >= 0 ? process.argv[profileArg + 1] : undefined;
if (!profileDir || profileDir.startsWith("--")) {
  console.error("[render-host] --render-host-profile <private directory> is required");
  app.exit(2);
  process.exit(2);
}
const profile = resolve(profileDir);
if (refusesUnattendedDefaultProfile({ unattended: process.env.JAGENTCHILL_UNATTENDED === "1", userData: profile, defaultUserData: app.getPath("userData") })) {
  console.error("[render-host] unattended launch refused: private profile resolves to Electron's default userData");
  app.exit(2);
  process.exit(2);
}
app.setPath("userData", profile);
app.setPath("sessionData", join(profile, "session"));
app.commandLine.appendSwitch("disk-cache-dir", join(profile, "cache"));
app.setAppLogsPath(join(profile, "logs"));

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  { scheme: "jagentchill-media", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);
const allowedMedia = new Map<string, { path: string; mime: string }>();
process.on("exit", (code) => console.error("[render-host] node exit event code=" + code));

function exitRenderHost(code: number): void {
  let exitGuard: NodeJS.Timeout | undefined;
  const requestQuit = () => {
    if (code === 0) {
      exitGuard ??= setTimeout(() => { app.quit(); app.exit(0); process.exit(0); }, 500);
    } else app.exit(code);
  };
  if (windowRef && !windowRef.isDestroyed()) {
    const closingWindow = windowRef;
    closingWindow.once("closed", requestQuit);
    closingWindow.close();
  } else requestQuit();
}

// The other end of the pipes is the host. When it has gone away (stopped, restarted, crashed) a write fails with
// EPIPE: there is nobody left to render for, so this process leaves quietly instead of raising an error dialog.
let pipeGone = false;
function writeAll(fd: number, bytes: Uint8Array): void {
  if (pipeGone) return;
  let offset = 0;
  try {
    while (offset < bytes.length) offset += writeSync(fd, bytes, offset, bytes.length - offset);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EPIPE" && code !== "EBADF" && code !== "ECONNRESET") throw error;
    pipeGone = true;
    console.error(`[render-host] host pipe closed (${code}); leaving`);
    exitRenderHost(0);
  }
}
// Nothing in this helper process may put a system error dialog in front of the user: it is logged and the process ends.
process.on("uncaughtException", (error) => {
  try { console.error(`[render-host] uncaught: ${error?.stack ?? String(error)}`); } catch { /* the log pipe itself is gone */ }
  app.exit(1);
});

function sendRecord(kind: "still" | "thumbnail" | "videoFrame" | "exportChunk", bytes: Uint8Array, recordSequence = sequence++): void {
  const header = recordHeader(kind, recordSequence, bytes.length);
  writeAll(frameFd, header); writeAll(frameFd, bytes);
}

function sendMotionMessage(message: Record<string, unknown>): void { writeAll(commandFd, frameEnvelope(message)); }

function motionFailure(command: { id: string }, code: string, message: string): void {
  sendMotionMessage({ v: 1, id: `motion-failed-${command.id}`, type: "motion.failed", payload: { requestId: command.id, code, message } });
}

async function writeFrameToEncoder(child: ChildProcess, png: Uint8Array): Promise<void> {
  const input = child.stdin;
  if (!input || input.destroyed) throw new Error("The video encoder stopped accepting frames.");
  if (!input.write(png)) await new Promise<void>((resolve, reject) => { input.once("drain", resolve); input.once("error", reject); });
}

async function capturePaintedFrame(window: BrowserWindow, job: MotionJob): Promise<Uint8Array> {
  return new Promise<Uint8Array>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, bytes?: Uint8Array) => {
      if (settled) return;
      settled = true; clearTimeout(timer); job.cancelCapture = undefined;
      if (!window.isDestroyed()) window.webContents.endFrameSubscription();
      if (error) reject(error); else resolve(bytes!);
    };
    const timer = setTimeout(() => finish(new Error("The scene renderer did not paint the requested frame.")), 5_000);
    job.cancelCapture = () => finish(new Error("Scene render cancelled."));
    window.webContents.beginFrameSubscription(false, (image) => {
      finish(undefined, new Uint8Array(image.toPNG()));
    });
  });
}

async function renderMotionScene(command: { id: string; payload?: any }): Promise<void> {
  const payload = command.payload ?? {}, requestId = String(payload.requestId ?? command.id), job: MotionJob = { cancelled: false };
  motionJobs.set(requestId, job);
  let failure: string | undefined;
  try {
    const { html, width, height, durationSeconds, fps, outputPath, ffmpegPath } = payload;
    const frameCount = Math.ceil(durationSeconds * fps);
    if (typeof html !== "string" || Buffer.byteLength(html) > 256 * 1024 || !Number.isInteger(width) || width < 1 || width > 1920 || !Number.isInteger(height) || height < 1 || height > 1080 || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 30 || !Number.isFinite(fps) || fps < 1 || fps > 60 || frameCount > 1200) throw new Error("Scene settings exceed the supported size, duration or frame limits.");
    if (typeof outputPath !== "string" || typeof ffmpegPath !== "string" || !existsSync(ffmpegPath)) throw new Error("The video encoder is unavailable on this host.");
    const sceneSession = session.fromPartition(`motion-scene-${command.id}`, { cache: false });
    sceneSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith("data:") }));
    const window = new BrowserWindow({
      show: false, frame: false, transparent: true, width, height, backgroundColor: "#00000000",
      webPreferences: { partition: `motion-scene-${command.id}`, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: false, offscreen: { deviceScaleFactor: 1 } },
    });
    job.window = window;
    window.setMenu(null);
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.setFrameRate(Math.min(60, Math.max(1, Math.ceil(fps))));
    const args = ["-hide_banner", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-vcodec", "png", "-i", "pipe:0", "-an", "-vf", `scale=${width}:${height}:flags=lanczos,pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0`, "-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "4", "-pix_fmt", "yuva420p", "-auto-alt-ref", "0", "-metadata:s:v:0", "alpha_mode=1", "-y", outputPath];
    const ffmpeg = spawn(ffmpegPath, args, { stdio: ["pipe", "ignore", "pipe"], windowsHide: true });
    job.ffmpeg = ffmpeg;
    let stderr = "";
    ffmpeg.stderr?.on("data", (chunk: Buffer) => { stderr = (stderr + String(chunk)).slice(-2000); });
    const encoded = new Promise<void>((resolve, reject) => {
      ffmpeg.once("error", reject);
      ffmpeg.once("close", (code) => code === 0 ? resolve() : reject(new Error(stderr.trim() || `The video encoder exited with code ${code}.`)));
    });
    const htmlSource = `data:text/html;charset=utf-8,${encodeURIComponent(String(html))}`;
    await window.loadURL(htmlSource);
    await window.webContents.executeJavaScript("document.fonts.ready");
    for (let frame = 0; frame < frameCount; frame++) {
      if (job.cancelled) throw new Error("Scene render cancelled.");
      if (window.isDestroyed()) throw new Error("Scene renderer closed before the render finished.");
      const painted = capturePaintedFrame(window, job);
      try { await window.webContents.executeJavaScript(`(async()=>{if(typeof window.__jcSeek!=='function')throw new Error('Define window.__jcSeek(seconds) in the scene.');await window.__jcSeek(${frame / fps});if(window.__jcApplyTime)await window.__jcApplyTime(${frame / fps});return true})()`); }
      catch (error) { await painted.catch(() => undefined); throw error; }
      const png = await painted;
      await writeFrameToEncoder(ffmpeg, png);
      if (existsSync(outputPath) && statSync(outputPath).size > 512 * 1024 * 1024) throw new Error("The rendered scene file exceeded 512 MiB.");
      if (frame % 10 === 0 || frame + 1 === frameCount) sendMotionMessage({ v: 1, id: `motion-progress-${requestId}-${frame}`, type: "motion.progress", payload: { requestId, framesDone: frame + 1, frameCount } });
    }
    ffmpeg.stdin?.end();
    await encoded;
    if (job.cancelled) throw new Error("Scene render cancelled.");
    const bytes = statSync(outputPath).size;
    if (bytes <= 0 || bytes > 512 * 1024 * 1024) throw new Error("The rendered scene file is empty or exceeds 512 MiB.");
    sendMotionMessage({ v: 1, id: `motion-done-${requestId}`, type: "motion.done", payload: { requestId, framesDone: frameCount, frameCount, bytes, width, height, durationSeconds, fps } });
  } catch (error) {
    failure = job.cancelled ? "Scene render cancelled." : error instanceof Error ? error.message : String(error);
    if (job.ffmpeg && !job.ffmpeg.killed) job.ffmpeg.kill("SIGTERM");
    if (failure !== "Scene render cancelled.") motionFailure({ id: requestId }, "MOTION_SCENE_FAILED", failure);
    else motionFailure({ id: requestId }, "CANCELLED", failure);
  } finally {
    job.cancelCapture?.();
    if (job.window && !job.window.isDestroyed()) job.window.destroy();
    motionJobs.delete(requestId);
    if (failure) { /* the final notification carries the user-facing error */ }
  }
}

async function run(): Promise<void> {
  if (!profileDir || profileDir.startsWith("--")) return;
  for (const directory of [app.getPath("userData"), app.getPath("sessionData"), join(app.getPath("userData"), "cache"), join(app.getPath("userData"), "logs")]) mkdirSync(directory, { recursive: true });
  if (!existsSync(join(assets, "index.html")) || !existsSync(join(assets, "opencut_wasm_bg.wasm"))) {
    console.error("[render-host] engine assets are missing from the desktop distribution"); app.exit(3); return;
  }
  app.dock?.hide();
  // Keep Chromium's hardware preference, while allowing its built-in SwiftShader when no adapter exists.
  app.commandLine.appendSwitch("enable-unsafe-swiftshader");
  protocol.handle("app", (request) => {
    const url = new URL(request.url);
    const file = resolve(assets, decodeURIComponent(url.pathname.slice(1)));
    if (url.hostname !== "jagentchill" || (file !== assets && !file.startsWith(assets + sep)) || !existsSync(file)) return new Response("Not found", { status: 404 });
    const type = extname(file) === ".wasm" ? "application/wasm" : extname(file) === ".js" ? "text/javascript" : "text/html";
    return new Response(readFileSync(file), { headers: { "content-type": type, "cache-control": "no-store" } });
  });
  protocol.handle("jagentchill-media", (request) => {
    const url = new URL(request.url), source = allowedMedia.get(url.host + url.pathname);
    if (!source) return new Response("Not found", { status: 404 });
    const size = statSync(source.path).size;
    const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.get("range") ?? "");
    if (range) {
      const start = Number(range[1]), end = Math.min(range[2] ? Number(range[2]) : size - 1, size - 1);
      if (start > end || start >= size) return new Response(null, { status: 416, headers: { "content-range": "bytes */" + size } });
      const stream = Readable.toWeb(createReadStream(source.path, { start, end }));
      return new Response(stream as unknown as BodyInit, { status: 206, headers: { "content-type": source.mime, "accept-ranges": "bytes", "access-control-allow-origin": "app://jagentchill", "content-range": "bytes " + start + "-" + end + "/" + size, "content-length": String(end - start + 1) } });
    }
    return new Response(Readable.toWeb(createReadStream(source.path)) as unknown as BodyInit, { headers: { "content-type": source.mime, "accept-ranges": "bytes", "access-control-allow-origin": "app://jagentchill", "content-length": String(size) } });
  });
  const target = "app://jagentchill/index.html";
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const allowed = details.url.startsWith("app://jagentchill/") || details.url.startsWith("jagentchill-media://blob/") || (details.url.startsWith("file://") && details.url.startsWith(pathToFileURL(assets).href));
    if (!allowed) console.error(`[render-host] surface/navigation-blocked ${details.url.slice(0, 200)}`);
    callback({ cancel: !allowed });
  });
  windowRef = new BrowserWindow({
    show: false, width: 1920, height: 1080, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, preload: join(__dirname, "render-host-preload.cjs"), webSecurity: true, backgroundThrottling: false },
  });
  windowRef.setMenu(null);
  windowRef.webContents.on("did-fail-load", (_event, code, description, url) => console.error(`[render-host] page load failed ${code} ${description} ${url}`));
  windowRef.webContents.on("render-process-gone", (_event, details) => { console.error(`[render-host] renderer failed ${details.reason}`); app.exit(1); });
  windowRef.webContents.on("console-message", (_event, level, message) => { if (level >= 2) console.error(`[render-host] renderer ${message}`); });
  windowRef.webContents.on("ipc-message", (_event, channel, message) => {
    if (channel !== "render-host:message") return;
    const value = message as { envelope?: unknown; binary?: Uint8Array };
    if (!value.envelope) { if (value.binary instanceof Uint8Array) sendRecord("still", value.binary); return; }
    const envelope = value.envelope as { type?: string; replyTo?: string };
    if (value.binary instanceof Uint8Array) {
      const chunk = envelope.type === "export.chunk" ? (envelope as any).payload?.seq : undefined;
      sendRecord(envelope.type === "export.chunk" ? "exportChunk" : "still", value.binary, Number.isInteger(chunk) ? chunk : sequence++);
    }
    if (envelope.type === "host.no-backend") { console.error("[render-host] no-backend"); exitRenderHost(3); }
    if (envelope.type === "host.exit") { exitRenderHost(0); }
    writeAll(commandFd, frameEnvelope(envelope));
    if (envelope.type === "hello") console.error("[render-host] booted and answered hello");
    if (envelope.type === "still.done") console.error("[render-host] drew still frame");
    if (envelope.type === "reply" && envelope.replyTo) {
      const commandType = commandTypes.get(envelope.replyTo);
      console.error("[render-host] command reply type=" + commandType);
      if (commandType === "engine.dispose") {
        console.error("[render-host] engine.dispose complete; closing render window");
        exitRenderHost(0);
      }
    }
  });
  await windowRef.loadURL(target);
  const reader = new EnvelopeReader();
  const input = createReadStream("/dev/fd/3", { fd: commandFd, autoClose: false });
  input.on("data", (chunk: Buffer) => {
    try {
      for (const message of reader.push(new Uint8Array(chunk))) {
        const command = message as { id?: string; type?: string };
        if (command.id && command.type) commandTypes.set(command.id, command.type);
        if (command.type === "motion.render" && command.id) {
          sendMotionMessage({ v: 1, id: `r-${command.id}`, type: "reply", replyTo: command.id, ok: true, payload: { requestId: command.id, state: "rendering" } });
          void renderMotionScene(command as { id: string; payload?: any });
          continue;
        }
        if (command.type === "motion.cancel" && command.id) {
          const renderId = String((command as any).payload?.requestId ?? ""), job = motionJobs.get(renderId);
          if (job) { job.cancelled = true; job.cancelCapture?.(); job.ffmpeg?.kill("SIGTERM"); if (job.window && !job.window.isDestroyed()) job.window.destroy(); }
          sendMotionMessage({ v: 1, id: `r-${command.id}`, type: "reply", replyTo: command.id, ok: true, payload: { requestId: renderId, cancelled: Boolean(job) } });
          continue;
        }
        if (command.type === "media.setSources") {
          allowedMedia.clear();
          const sources = (command as any).payload?.sources ?? [];
          for (const source of sources) for (const key of ["original", "proxy", "mezzanine"]) {
            if (typeof source[key] !== "string") continue;
            const mediaUrl = new URL(source[key]);
            if (mediaUrl.protocol !== "jagentchill-media:" || mediaUrl.hostname !== "blob") continue;
            const path = mediaUrl.searchParams.get("path"), mime = mediaUrl.searchParams.get("mime");
            if (path && mime && resolve(path) === path) allowedMedia.set(mediaUrl.host + mediaUrl.pathname, { path, mime });
          }
        }
        windowRef?.webContents.send("render-host:command", message);
      }
    }
    catch (error) { console.error(`[render-host] invalid command pipe: ${String(error)}`); app.exit(1); }
  });
  input.on("end", () => {
    commandClosed = true;
    for (const job of motionJobs.values()) { job.cancelled = true; job.cancelCapture?.(); job.ffmpeg?.kill("SIGTERM"); if (job.window && !job.window.isDestroyed()) job.window.destroy(); }
    windowRef?.webContents.send("render-host:shutdown");
    setTimeout(() => { if (commandClosed) app.exit(0); }, 1500).unref();
  });
  input.on("error", (error) => { console.error(`[render-host] command pipe failed: ${error.message}`); app.exit(1); });
  process.on("SIGTERM", () => exitRenderHost(0));
}

app.whenReady().then(() => { void run(); }).catch((error) => { console.error(`[render-host] startup failed: ${error instanceof Error ? error.stack : String(error)}`); app.exit(1); });
app.on("window-all-closed", () => { /* the service owns this hidden window */ });
