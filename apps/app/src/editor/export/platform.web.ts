/** What an export needs from the browser: encoder answers, where the bytes go, sharing. The native one is `platform.ts`. */
import type { exporting } from "@jagentchill/app-core";

type VideoCodec = exporting.VideoCodec;
type Picker = { showSaveFilePicker?(options: unknown): Promise<FileSystemFileHandle>; showDirectoryPicker?(options: unknown): Promise<FileSystemDirectoryHandle> };
const picker = (): Picker => window as unknown as Picker;
export const exportPlatform: "web" | "desktop" | "mobile" = "web";

// ---- encoders ---------------------------------------------------------------------------------------------------------

/** H.264 High at the lowest level that fits the size and the rate. */
function avcCodec(width: number, height: number, fps: number): string {
  const macroblocks = Math.ceil(width / 16) * Math.ceil(height / 16), perSecond = macroblocks * fps;
  const levels: [number, number, number][] = [[0x1e, 1620, 40_500], [0x1f, 3600, 108_000], [0x20, 5120, 216_000], [0x28, 8192, 245_760], [0x2a, 8704, 522_240], [0x32, 22_080, 589_824], [0x33, 36_864, 983_040], [0x34, 36_864, 2_073_600], [0x3c, 139_264, 4_177_920], [0x3d, 139_264, 8_355_840], [0x3e, 139_264, 16_711_680]];
  const level = levels.find(([, frame, rate]) => macroblocks <= frame && perSecond <= rate) ?? levels[levels.length - 1];
  return `avc1.6400${level[0].toString(16).padStart(2, "0")}`;
}
const CODEC_STRINGS: Record<VideoCodec, (width: number, height: number, fps: number) => string> = {
  h264: avcCodec, hevc: () => "hev1.1.6.L153.B0", vp9: () => "vp09.00.51.08", av1: () => "av01.0.12M.08",
};
/** The answer of the platform encoder for the exact size, rate and bitrate, asked for hardware and for software encoding. */
export async function probeVideoEncoders(size: { width: number; height: number }, fps: number, bitrate: number, acceleration: "auto" | "prefer-hardware" | "prefer-software" = "auto"): Promise<Record<VideoCodec, boolean>> {
  const result: Record<VideoCodec, boolean> = { h264: false, hevc: false, vp9: false, av1: false };
  if (typeof VideoEncoder === "undefined") return result;
  const modes = acceleration === "auto" ? (["prefer-hardware", "prefer-software"] as const) : ([acceleration] as const);
  await Promise.all((Object.keys(CODEC_STRINGS) as VideoCodec[]).map(async (codec) => {
    for (const hardwareAcceleration of modes) {
      try {
        const answer = await VideoEncoder.isConfigSupported({ codec: CODEC_STRINGS[codec](size.width, size.height, fps), width: size.width, height: size.height, framerate: fps, bitrate, hardwareAcceleration });
        if (answer.supported) { result[codec] = true; return; }
      } catch { /* an unknown codec string is an unsupported codec */ }
    }
  }));
  return result;
}
export async function probeAudioEncoders(sampleRate = 48_000, channels = 2): Promise<{ aac: boolean; opus: boolean; flac: boolean; mp3: boolean }> {
  const ask = async (codec: string, bitrate?: number) => {
    if (typeof AudioEncoder === "undefined") return false;
    try { return (await AudioEncoder.isConfigSupported({ codec, sampleRate, numberOfChannels: channels, ...(bitrate ? { bitrate } : {}) })).supported === true; } catch { return false; }
  };
  const [aac, opus, flac] = await Promise.all([ask("mp4a.40.2", 192_000), ask("opus", 128_000), ask("flac")]);
  // The MP3 encoder module is not part of this build.
  return { aac, opus, flac, mp3: false };
}

// ---- where the bytes go -----------------------------------------------------------------------------------------------

export type SaveHandle = FileSystemFileHandle;
export type FolderHandle = FileSystemDirectoryHandle;
export const hasSavePicker = (): boolean => typeof picker().showSaveFilePicker === "function";
export const hasDirectoryPicker = (): boolean => typeof picker().showDirectoryPicker === "function";
/** The browser's save dialog; `"cancelled"` when the user closed it, `null` when the browser has none. */
export async function pickSaveFile(name: string, mime: string): Promise<SaveHandle | "cancelled" | null> {
  const show = picker().showSaveFilePicker;
  if (!show) return null;
  const extension = `.${name.split(".").pop()}`;
  try { return await show.call(window, { suggestedName: name, types: [{ description: name, accept: { [mime]: [extension] } }] }); }
  catch (error) { if ((error as Error).name === "AbortError") return "cancelled"; return null; }
}
export async function pickFolder(): Promise<FolderHandle | "cancelled" | null> {
  const show = picker().showDirectoryPicker;
  if (!show) return null;
  try { return await show.call(window, { mode: "readwrite" }); } catch (error) { if ((error as Error).name === "AbortError") return "cancelled"; return null; }
}
const scratch = async () => (await navigator.storage.getDirectory()).getDirectoryHandle("exports", { create: true });
export type Output = {
  /** Positioned write: the muxer goes back to finalise the header of a non-fragmented file. */
  write(data: Uint8Array, position: number): Promise<void>;
  /** Finalises the file: nothing of it is visible at the destination before this. */
  close(): Promise<number>;
  /** Discards everything written. */
  abort(): Promise<void>;
};
/**
 * A file being written, either at the place the user chose or in the origin's private file system. Both are written
 * through a swap file that replaces the destination only on `close`, so a cancelled or failed export leaves nothing.
 */
export async function openOutput(target: { handle: SaveHandle } | { privateName: string }): Promise<Output> {
  const directory = "privateName" in target ? await scratch() : null;
  const handle = "handle" in target ? target.handle : await directory!.getFileHandle(target.privateName, { create: true });
  const writable = await handle.createWritable();
  let size = 0, chain: Promise<void> = Promise.resolve(), failed: unknown = null, aborted = false;
  return {
    write(data, position) {
      if (aborted) return Promise.reject(new DOMException("The export output was aborted", "AbortError"));
      size = Math.max(size, position + data.byteLength);
      chain = chain.then(() => aborted ? undefined : writable.write({ type: "write", position, data: data as unknown as BufferSource })).catch((error) => { failed ??= error; });
      return chain;
    },
    async close() { await chain; if (aborted) throw new DOMException("The export output was aborted", "AbortError"); if (failed) { await writable.abort().catch(() => undefined); throw failed; } await writable.close(); return size; },
    async abort() {
      if (aborted) return;
      aborted = true;
      const stopping = writable.abort().catch(() => undefined);
      if (directory && "privateName" in target) void stopping.then(() => directory.removeEntry(target.privateName).catch(() => undefined));
      await stopping;
    },
  };
}
/** A whole small file (a still, a caption file, a credits file) written into a chosen folder. */
export async function writeIntoFolder(folder: FolderHandle, name: string, bytes: Uint8Array): Promise<void> {
  const handle = await folder.getFileHandle(name, { create: true }), writable = await handle.createWritable();
  await writable.write(bytes as unknown as BufferSource);
  await writable.close();
}
export async function privateFile(privateName: string): Promise<File | null> {
  try { return await (await (await scratch()).getFileHandle(privateName)).getFile(); } catch { return null; }
}
export async function deletePrivate(privateName: string): Promise<void> { await (await scratch()).removeEntry(privateName).catch(() => undefined); }
/** Removes private files no job names any more: an export the app was closed during leaves nothing behind. */
export async function cleanPrivate(keep: ReadonlySet<string>): Promise<void> {
  try {
    const directory = await scratch();
    for await (const name of (directory as unknown as { keys(): AsyncIterable<string> }).keys()) if (!keep.has(name)) await directory.removeEntry(name).catch(() => undefined);
  } catch { /* no private file system: nothing to clean */ }
}
/** Hands a file to the browser's download. */
export function download(file: Blob, name: string): void {
  const url = URL.createObjectURL(file), link = document.createElement("a");
  link.href = url; link.download = name; link.style.display = "none";
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
export async function freeBytes(): Promise<number | null> {
  try { const estimate = await navigator.storage.estimate(); return estimate.quota !== undefined && estimate.usage !== undefined ? Math.max(0, estimate.quota - estimate.usage) : null; } catch { return null; }
}

// ---- sharing and the page ---------------------------------------------------------------------------------------------

export function canShareFile(file: File): boolean {
  const nav = navigator as Navigator & { canShare?(data: { files: File[] }): boolean };
  try { return typeof nav.share === "function" && typeof nav.canShare === "function" && nav.canShare({ files: [file] }); } catch { return false; }
}
export async function shareFile(file: File): Promise<boolean> {
  try { await navigator.share({ files: [file], title: file.name }); return true; } catch { return false; }
}
export const openPage = (url: string): void => { window.open(url, "_blank", "noopener"); };
export async function copyToClipboard(text: string): Promise<boolean> { try { await navigator.clipboard.writeText(text); return true; } catch { return false; } }
/** Asks before the tab is closed or reloaded while `active` says an export runs. */
export function guardExport(active: () => boolean): () => void {
  const handler = (event: BeforeUnloadEvent) => { if (active()) { event.preventDefault(); event.returnValue = ""; } };
  window.addEventListener("beforeunload", handler);
  return () => window.removeEventListener("beforeunload", handler);
}
export function onTabHidden(handler: (hidden: boolean) => void): () => void {
  const listener = () => handler(document.visibilityState === "hidden");
  document.addEventListener("visibilitychange", listener);
  return () => document.removeEventListener("visibilitychange", listener);
}
/** The element a headless engine mounts its canvas in: off-screen, never shown. */
export function hiddenHost(): { element: unknown; remove(): void } {
  const element = document.createElement("div");
  Object.assign(element.style, { position: "fixed", left: "-10000px", top: "0", width: "320px", height: "180px", pointerEvents: "none", opacity: "0" });
  element.setAttribute("aria-hidden", "true");
  document.body.appendChild(element);
  return { element, remove: () => element.remove() };
}
/** A cover or frame as a JPEG whose long side is at most `longSide`, for the dialog thumbnail and the embedded artwork. */
export async function toJpeg(bytes: Uint8Array, mime: string, longSide: number, quality = 0.9): Promise<Uint8Array | null> {
  try {
    const bitmap = await createImageBitmap(new Blob([bytes as unknown as BlobPart], { type: mime })), scale = Math.min(1, longSide / Math.max(bitmap.width, bitmap.height));
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return new Uint8Array(await (await canvas.convertToBlob({ type: "image/jpeg", quality })).arrayBuffer());
  } catch { return null; }
}
export function toBase64(bytes: Uint8Array): string {
  let text = "";
  for (let at = 0; at < bytes.length; at += 0x8000) text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(text);
}
/** RGBA pixels of an encoded image, for sampling the palette of a GIF. */
export async function decodeRgba(bytes: Uint8Array, mime: string): Promise<{ width: number; height: number; rgba: Uint8ClampedArray } | null> {
  try {
    const bitmap = await createImageBitmap(new Blob([bytes as unknown as BlobPart], { type: mime })), canvas = new OffscreenCanvas(bitmap.width, bitmap.height), context = canvas.getContext("2d")!;
    context.drawImage(bitmap, 0, 0);
    return { width: bitmap.width, height: bitmap.height, rgba: context.getImageData(0, 0, bitmap.width, bitmap.height).data };
  } catch { return null; }
}
export const appVersion = (): string => process.env.EXPO_PUBLIC_JAGENTCHILL_VERSION || "0.0.0";
export const platformName = (): string => navigator.userAgent;
