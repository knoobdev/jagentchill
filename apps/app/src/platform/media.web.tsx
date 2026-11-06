/** Web implementation of the media services of the app: the media worker, file drops, paste, capture and saving. The native one is `media.tsx`. */
import { createElement, type ReactNode } from "react";
import { inlineMediaEngine, workerMediaEngine, type MediaEngine } from "@jagentchill/media/browser";
import type { RecorderDriver, RecordingKind } from "@jagentchill/media";
import type { ClassicOrigin, PersistenceEnvironment } from "@jagentchill/storage";

export const mediaPlatform: "web" | "desktop" | "mobile" = "web";
/** Hashing, probing, thumbnails, waveforms and proxies run in a dedicated worker; a browser that cannot start one runs them inline. */
export function createMediaEngine(): MediaEngine {
  try { return workerMediaEngine(new Worker(new URL("../media/engine.worker", window.location.href))); } catch { return inlineMediaEngine(); }
}

export type PickedFile = { file: Blob & { name: string; lastModified?: number }; relativePath?: string };
type Entry = { isFile: boolean; isDirectory: boolean; name: string; fullPath: string; file(done: (file: File) => void, failed: (error: unknown) => void): void; createReader(): { readEntries(done: (entries: Entry[]) => void, failed: (error: unknown) => void): void } };
async function walkEntry(entry: Entry, out: PickedFile[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File | null>((resolve) => entry.file(resolve, () => resolve(null)));
    if (file) out.push({ file, relativePath: entry.fullPath.replace(/^\//, "") });
    return;
  }
  const reader = entry.createReader();
  // A directory reader hands its entries out in batches until it returns an empty one.
  for (;;) {
    const batch = await new Promise<Entry[]>((resolve) => reader.readEntries(resolve, () => resolve([])));
    if (batch.length === 0) break;
    for (const child of batch.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))) await walkEntry(child, out);
  }
}
/**
 * Makes an element the import drop zone for files dragged from the operating system. Drags that start inside the app
 * (they carry the app payload type) are ignored. Dropped folders are traversed recursively.
 */
export function bindFileDrop(node: unknown, handlers: { onEnter(): void; onLeave(): void; onDrop(files: PickedFile[]): void }): () => void {
  const element = node as HTMLElement | null;
  if (!element?.addEventListener) return () => {};
  let depth = 0;
  const external = (event: DragEvent) => { const types = Array.from(event.dataTransfer?.types ?? []); return types.includes("Files") && !types.includes("application/x-jagentchill"); };
  const enter = (event: DragEvent) => { if (!external(event)) return; event.preventDefault(); if (depth++ === 0) handlers.onEnter(); };
  const over = (event: DragEvent) => { if (!external(event)) return; event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = "copy"; };
  const leave = (event: DragEvent) => { if (external(event) && --depth <= 0) { depth = 0; handlers.onLeave(); } };
  const drop = (event: DragEvent) => {
    if (!external(event)) return;
    event.preventDefault(); event.stopPropagation(); depth = 0; handlers.onLeave();
    const items = Array.from(event.dataTransfer?.items ?? []);
    const entries = items.map((item) => (item.kind === "file" ? (item as unknown as { webkitGetAsEntry?(): Entry | null }).webkitGetAsEntry?.() ?? null : null));
    const plain = Array.from(event.dataTransfer?.files ?? []);
    void (async () => {
      const out: PickedFile[] = [];
      if (entries.some((entry) => entry?.isDirectory)) { for (const entry of entries) if (entry) await walkEntry(entry, out); }
      else for (const file of plain) out.push({ file });
      if (out.length > 0) handlers.onDrop(out);
    })();
  };
  element.addEventListener("dragenter", enter); element.addEventListener("dragover", over); element.addEventListener("dragleave", leave); element.addEventListener("drop", drop);
  return () => { element.removeEventListener("dragenter", enter); element.removeEventListener("dragover", over); element.removeEventListener("dragleave", leave); element.removeEventListener("drop", drop); };
}

const typable = (target: EventTarget | null): boolean => { const element = target as HTMLElement | null; return Boolean(element && (element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.isContentEditable)); };
/** A paste outside typable fields that carries files or images. `handler` returns true when it took the paste. */
export function onMediaPaste(handler: (files: { file: Blob; name: string | null }[]) => boolean): () => void {
  const listener = (event: ClipboardEvent) => {
    if (typable(event.target)) return;
    const files = Array.from(event.clipboardData?.items ?? []).filter((item) => item.kind === "file" && /^(image|video|audio)\//i.test(item.type)).map((item) => item.getAsFile()).filter((file): file is File => file !== null)
      // A bitmap copied from a screen has the browser's placeholder name, not a file name of its own.
      .map((file) => ({ file: file as Blob, name: file.name && file.name !== "image.png" ? file.name : null }));
    if (files.length > 0 && handler(files)) event.preventDefault();
  };
  window.addEventListener("paste", listener);
  return () => window.removeEventListener("paste", listener);
}
/** Runs when the window regains focus (external files and the project lock are checked again). */
export function onWindowFocus(handler: () => void): () => void {
  window.addEventListener("focus", handler);
  return () => window.removeEventListener("focus", handler);
}

/** Saves bytes through the browser's download: the file-save path of the web. */
export function saveBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob), link = document.createElement("a");
  link.href = url; link.download = name; link.style.display = "none";
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
export type FileSink = { write(chunk: Uint8Array): Promise<void>; close(): Promise<void>; abort(): Promise<void> };
/**
 * A streamed file to save: the chunks go to a scratch file of the origin's private file system, so a package of any
 * size never sits in memory, and the finished file is handed to the browser's download.
 */
export async function createFileSink(name: string, mime: string): Promise<FileSink> {
  const root = await navigator.storage.getDirectory(), scratch = await root.getDirectoryHandle("exports", { create: true });
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const handle = await scratch.getFileHandle(id, { create: true }), writable = await handle.createWritable();
  const discard = () => scratch.removeEntry(id).catch(() => undefined);
  return {
    write: async (chunk) => { await writable.write(chunk as unknown as BufferSource); },
    close: async () => {
      await writable.close();
      const file = await handle.getFile();
      saveBlob(name, new File([file], name, { type: mime }));
      // The download reads the file after this returns: the scratch copy goes once the browser had time to take it.
      setTimeout(() => void discard(), 120_000);
    },
    abort: async () => { await writable.abort().catch(() => undefined); await discard(); },
  };
}
export const blobUrl = (blob: Blob): string => URL.createObjectURL(blob);
export const releaseUrl = (url: string): void => URL.revokeObjectURL(url);
export async function copyText(text: string): Promise<boolean> { try { await navigator.clipboard.writeText(text); return true; } catch { return false; } }

/** A playable preview of a video or audio asset, or the picture of an image. */
export function MediaPreview(props: { type: "video" | "audio" | "image"; url: string; label: string; height: number }): ReactNode {
  if (props.type === "image") return createElement("img", { src: props.url, alt: props.label, style: { width: "100%", height: props.height, objectFit: "contain", display: "block" } });
  if (props.type === "audio") return createElement("audio", { src: props.url, controls: true, "aria-label": props.label, style: { width: "100%" } });
  return createElement("video", { src: props.url, controls: true, playsInline: true, "aria-label": props.label, style: { width: "100%", height: props.height, objectFit: "contain", display: "block", background: "black" } }); // content-colour
}
/** The live picture of a capture in progress. */
export function CapturePreview(props: { stream: unknown; height: number; label: string }): ReactNode {
  return createElement("video", { ref: (element: HTMLVideoElement | null) => { if (element && element.srcObject !== props.stream) { element.srcObject = props.stream as MediaStream; void element.play().catch(() => undefined); } }, muted: true, playsInline: true, "aria-label": props.label, style: { width: "100%", height: props.height, objectFit: "contain", display: "block", background: "black" } }); // content-colour
}

// ── Capture ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export type CaptureDevice = { id: string; label: string; kind: "camera" | "microphone" };
export type CaptureOptions = { kind: RecordingKind; cameraId?: string; microphoneId?: string; microphone?: boolean; systemAudio?: boolean };
export type CaptureError = { reason: "denied" | "unavailable" | "cancelled"; message: string };
export type Capture = {
  /** `null` for a voice recording. */
  stream: unknown; hasVideo: boolean; driver: RecorderDriver;
  /** Input level 0–1 of the audio being recorded; 0 when there is none. */
  level(): number;
  /** The source ended by itself (the shared window was closed, the camera unplugged). */
  onEnded(handler: () => void): void;
  close(): void;
};
export const captureSupported = (kind: RecordingKind): boolean => typeof navigator !== "undefined" && typeof MediaRecorder === "function" && (kind === "screen" ? typeof navigator.mediaDevices?.getDisplayMedia === "function" : typeof navigator.mediaDevices?.getUserMedia === "function");
export const systemAudioSupported = (): boolean => /Chrome|Chromium|Edg\//.test(navigator.userAgent);
/** Cameras and microphones; labels are empty until a capture permission was granted. */
export async function listCaptureDevices(): Promise<CaptureDevice[]> {
  const devices = await navigator.mediaDevices?.enumerateDevices?.().catch(() => []) ?? [];
  return devices.filter((device) => device.kind === "videoinput" || device.kind === "audioinput").map((device) => ({ id: device.deviceId, label: device.label, kind: device.kind === "videoinput" ? "camera" as const : "microphone" as const }));
}
const RECORDER_TYPES = { video: ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"], audio: ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"] };
const captureFailure = (error: unknown): CaptureError => {
  const name = (error as { name?: string } | null)?.name ?? "";
  const reason = name === "NotAllowedError" || name === "SecurityError" ? "denied" : name === "AbortError" ? "cancelled" : "unavailable";
  return { reason, message: error instanceof Error ? error.message : String(error) };
};
/**
 * Opens the capture sources and returns a MediaRecorder driver for them. Camera: video with the microphone. Screen:
 * a display, window or tab, with system audio where the browser shares it, and the microphone mixed in when asked.
 * Voice: the microphone only. Rejects with a `CaptureError`.
 */
export async function openCapture(options: CaptureOptions): Promise<Capture> {
  const tracks: MediaStreamTrack[] = [], opened: MediaStream[] = [];
  let context: AudioContext | null = null, analyser: AnalyserNode | null = null;
  const closeAll = () => { for (const stream of opened) for (const track of stream.getTracks()) track.stop(); void context?.close().catch(() => undefined); };
  try {
    const audioWanted = options.kind !== "screen" || options.microphone === true;
    const audioConstraint = options.microphoneId ? { deviceId: { exact: options.microphoneId } } : true;
    if (options.kind === "camera") {
      const stream = await navigator.mediaDevices.getUserMedia({ video: options.cameraId ? { deviceId: { exact: options.cameraId } } : true, audio: audioConstraint });
      opened.push(stream); tracks.push(...stream.getTracks());
    } else if (options.kind === "voice") {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraint });
      opened.push(stream); tracks.push(...stream.getTracks());
    } else {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: options.systemAudio === true });
      opened.push(display); tracks.push(...display.getVideoTracks());
      const sources = [...display.getAudioTracks()];
      if (audioWanted) { const microphone = await navigator.mediaDevices.getUserMedia({ audio: audioConstraint }); opened.push(microphone); sources.push(...microphone.getAudioTracks()); }
      if (sources.length === 1) tracks.push(sources[0]);
      else if (sources.length > 1) {
        // System audio and the microphone are mixed into the one audio track a recorder takes.
        context = new AudioContext();
        const mix = context.createMediaStreamDestination();
        for (const track of sources) context.createMediaStreamSource(new MediaStream([track])).connect(mix);
        tracks.push(...mix.stream.getAudioTracks());
      }
    }
  } catch (error) { closeAll(); throw captureFailure(error); }
  const stream = new MediaStream(tracks), hasVideo = stream.getVideoTracks().length > 0, hasAudio = stream.getAudioTracks().length > 0;
  if (hasAudio) {
    context ??= new AudioContext();
    analyser = context.createAnalyser(); analyser.fftSize = 512;
    context.createMediaStreamSource(new MediaStream(stream.getAudioTracks())).connect(analyser);
  }
  const samples = analyser ? new Uint8Array(analyser.fftSize) : null;
  const mimeType = RECORDER_TYPES[hasVideo ? "video" : "audio"].find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
  let recorder: MediaRecorder | null = null, queue: Promise<void> = Promise.resolve();
  const driver: RecorderDriver = {
    mimeType: (mimeType || (hasVideo ? "video/webm" : "audio/webm")).split(";")[0],
    start: async (timesliceMs, onData) => {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      // Chunks are converted in arrival order, so the bytes reach storage in the order they were recorded.
      recorder.ondataavailable = (event) => { if (event.data.size > 0) queue = queue.then(async () => onData(new Uint8Array(await event.data.arrayBuffer()))); };
      recorder.start(timesliceMs);
    },
    pause: () => { if (recorder?.state === "recording") { recorder.requestData(); recorder.pause(); } },
    resume: () => { if (recorder?.state === "paused") recorder.resume(); },
    stop: async () => {
      const active = recorder;
      if (active && active.state !== "inactive") await new Promise<void>((resolve) => { active.onstop = () => resolve(); active.stop(); });
      await queue;
      closeAll();
    },
  };
  return {
    stream: hasVideo ? stream : null, hasVideo, driver,
    level: () => {
      if (!analyser || !samples) return 0;
      analyser.getByteTimeDomainData(samples);
      let peak = 0;
      for (const sample of samples) peak = Math.max(peak, Math.abs(sample - 128) / 128);
      return peak;
    },
    onEnded: (handler) => { for (const track of stream.getVideoTracks()) track.addEventListener("ended", handler, { once: true }); },
    close: closeAll,
  };
}
/** Opens the browser's page about site permissions; a browser has no deep link into its own settings. */
export const permissionHelpUrl = (): string => (/Firefox\//.test(navigator.userAgent) ? "https://support.mozilla.org/kb/how-manage-your-camera-and-microphone-permissions" : /Safari\//.test(navigator.userAgent) && !/Chrome\//.test(navigator.userAgent) ? "https://support.apple.com/guide/safari/websites-ibrwe2159f50/mac" : "https://support.google.com/chrome/answer/2693767");

// ── Persistence, install ────────────────────────────────────────────────────────────────────────────────────────────
let installEvent: { prompt(): Promise<unknown> } | null = null;
if (typeof window !== "undefined") window.addEventListener("beforeinstallprompt", (event) => { event.preventDefault(); installEvent = event as unknown as { prompt(): Promise<unknown> }; });
// The desktop app runs this same web code, but its data sits in the app's own folder on disk: nothing "the browser can
// delete", so no browser-storage warning there.
const inDesktopApp = typeof window !== "undefined" && "jagentchillDesktop" in window;
export const persistenceEnvironment = (): PersistenceEnvironment => ({
  platform: inDesktopApp ? "desktop" as const : "web" as const, storage: typeof navigator !== "undefined" ? navigator.storage : undefined,
  prompts: typeof navigator !== "undefined" && /\bFirefox\/|\bFxiOS\//.test(navigator.userAgent), installAvailable: installEvent !== null,
});
export const promptInstall = (): void => { void installEvent?.prompt().catch(() => undefined); };
/** Tells the other windows of this profile that a project's lock changed. */
export function lockSignal(): { post(message: { projectId: string }): void; listen(handler: (message: { projectId: string }) => void): () => void } | undefined {
  if (typeof BroadcastChannel !== "function") return undefined;
  const channel = new BroadcastChannel("jagentchill.project-lock");
  return {
    post: (message) => channel.postMessage(message),
    listen: (handler) => { const listener = (event: MessageEvent) => handler(event.data as { projectId: string }); channel.addEventListener("message", listener); return () => channel.removeEventListener("message", listener); },
  };
}
/** OpenCut classic data of this browser origin, when the classic app ran here. */
export const classicOrigin = (): ClassicOrigin | null => (typeof indexedDB === "undefined" ? null : { indexedDB: globalThis.indexedDB, storage: navigator.storage, localStorage: globalThis.localStorage });

// ── Marquee ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export type Box = { x: number; y: number; width: number; height: number };
/**
 * A marquee drag that starts on the empty area of an element. `onChange` receives the rectangle and the boxes of the
 * items (elements whose id starts with `itemPrefix`), all in viewport coordinates.
 */
export function bindMarquee(node: unknown, itemPrefix: string, handlers: { onChange(marquee: Box, items: (Box & { id: string })[], additive: boolean): void; onEnd(moved: boolean): void }): () => void {
  const element = node as HTMLElement | null;
  if (!element?.addEventListener) return () => {};
  const down = (event: PointerEvent) => {
    const target = event.target as HTMLElement | null;
    if (event.button !== 0 || event.pointerType === "touch" || target?.closest(`[id^="${itemPrefix}"],[role="button"],[role="searchbox"],input,button,a`)) return;
    const startX = event.clientX, startY = event.clientY, additive = event.shiftKey || event.metaKey || event.ctrlKey;
    let moved = false;
    const move = (at: PointerEvent) => {
      if (!moved && Math.hypot(at.clientX - startX, at.clientY - startY) < 4) return;
      moved = true;
      const items = Array.from(element.querySelectorAll<HTMLElement>(`[id^="${itemPrefix}"]`)).map((item) => { const box = item.getBoundingClientRect(); return { id: item.id.slice(itemPrefix.length), x: box.left, y: box.top, width: box.width, height: box.height }; });
      handlers.onChange({ x: startX, y: startY, width: at.clientX - startX, height: at.clientY - startY }, items, additive);
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); handlers.onEnd(moved); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };
  element.addEventListener("pointerdown", down);
  return () => element.removeEventListener("pointerdown", down);
}
/** The box of an element in viewport coordinates, for drawing the marquee relative to its container. */
export const boxOf = (node: unknown): Box | null => { const element = node as HTMLElement | null; if (!element?.getBoundingClientRect) return null; const box = element.getBoundingClientRect(); return { x: box.left, y: box.top, width: box.width, height: box.height }; };
export function scrollIntoView(id: string): void { document.getElementById(id)?.scrollIntoView({ block: "nearest" }); }

/** A picked picture scaled to fit `maxSide`, orientation applied: PNG when the file is a PNG, else JPEG at quality 0.9. */
export async function scaleImage(file: Blob, maxSide: number): Promise<{ bytes: Uint8Array; mime: "image/jpeg" | "image/png"; width: number; height: number } | null> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale)), height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const mime = file.type === "image/png" ? "image/png" : "image/jpeg";
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, 0.9));
    return blob ? { bytes: new Uint8Array(await blob.arrayBuffer()), mime, width, height } : null;
  } catch { return null; }
}
/** Dictation through the browser's speech recognition. `null` where the browser has none. */
export function startDictation(language: string, handlers: { onText(text: string, final: boolean): void; onEnd(error?: string): void }): (() => void) | null {
  const Recognition = (window as unknown as { SpeechRecognition?: new () => any; webkitSpeechRecognition?: new () => any }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => any }).webkitSpeechRecognition; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!Recognition) return null;
  const recognition = new Recognition();
  recognition.lang = language; recognition.interimResults = true; recognition.continuous = true;
  let failure: string | undefined;
  recognition.onresult = (event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => {
    for (let index = event.resultIndex; index < event.results.length; index++) handlers.onText(event.results[index][0].transcript, event.results[index].isFinal);
  };
  recognition.onerror = (event: { error?: string }) => { failure = event.error ?? "error"; };
  recognition.onend = () => handlers.onEnd(failure);
  try { recognition.start(); } catch { return null; }
  return () => recognition.stop();
}

/** The id of this editor instance: one per tab, kept across a reload of the tab so that it still owns the projects it had open. */
export function editorInstanceId(make: () => string): string {
  try {
    const known = sessionStorage.getItem("jagentchill.instance");
    if (known) return known;
    const id = make();
    sessionStorage.setItem("jagentchill.instance", id);
    return id;
  } catch { return make(); }
}
/** Runs when the page is being closed or put away for good. */
export function onPageHide(handler: () => void): () => void {
  window.addEventListener("pagehide", handler);
  return () => window.removeEventListener("pagehide", handler);
}
