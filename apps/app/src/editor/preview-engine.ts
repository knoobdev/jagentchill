/** Native preview is a remote control: frames and playback renders are made by the paired host. */
import type { ProjectDocument } from "@jagentchill/protocol";
import type { EngineSurfacePort } from "@jagentchill/render";
import { blobRoutes } from "@jagentchill/protocol";
import { signedRequest, type DeviceSigner, type HostConnection, type HostRecord } from "@jagentchill/client";
import * as FileSystem from "expo-file-system/legacy";
import { toBase64 } from "@jagentchill/storage";
import { createRemotePreview } from "./preview-remote.ts";

export type EngineState = "starting" | "ready" | "no-gpu" | "unsupported" | "stopped";
export type TransportEvent = { time: number; playing: boolean; rate: number; audioClock: boolean };
export type EngineEvents = {
  onState(state: EngineState, detail?: string): void; onTime(event: TransportEvent): void;
  onTransport(state: { playing: boolean; rate: number; loop: boolean; reason?: string; effectiveQuality?: string; audioOutput?: boolean }): void;
  onEnded(time: number): void; onFrame(frame: { time: number; revision: number }): void; onMedia?(assets: { assetId: string; status: string }[]): void; onDiagnostic?(diagnostic: { id: string; elementId?: string }): void;
  onRemoteFrame?(frame: { uri: string; time: number; revision: number }): void;
  onRemoteVideo?(video: { uri: string; revision: number; duration: number; startTime: number; endTime: number }): void;
  onRemoteProgress?(progress: { done: number; total: number }): void;
  onRemoteError?(message: string): void;
};
export type LayoutBox = { x: number; y: number; width: number; height: number; rotation: number };
export type NativeRemote = { host: HostRecord; connection: Pick<HostConnection, "call">; signer: DeviceSigner; projectId: string };
export type EngineInit = { width: number; height: number; devicePixelRatio: number; locale: string; offlineTile: { fill: string; hatch: string; offlineLabel: string; unsupportedLabel: string }; remote?: NativeRemote };
export type PreviewEngine = {
  setDocument(document: ProjectDocument, sceneId: string): void; setSources(sources: { assetId: string; original?: string; proxy?: string }[]): Promise<unknown>; setFonts(fonts: { fontId: string; family: string; url: string; weight: number; style: "normal" | "italic" }[]): Promise<unknown>;
  seek(time: number, mode?: "scrub" | "exact", frameStep?: boolean): Promise<unknown>; play(fromTime?: number): Promise<unknown>; pause(): Promise<unknown>; setRate(rate: number): Promise<unknown>;
  setLoop(enabled: boolean, inTime?: number, outTime?: number): Promise<unknown>; setVolume(volume: number, muted: boolean): Promise<unknown>; setQuality(quality: "auto" | "full" | "half" | "quarter"): Promise<unknown>;
  resize(width: number, height: number, devicePixelRatio: number, zoom: number): Promise<unknown>; layout(elementIds: string[], time: number): Promise<Record<string, LayoutBox>>; sampleSource(elementId: string, x: number, y: number): Promise<string | null>;
  still(time: number, format?: "png" | "jpeg", sceneId?: string, size?: { width: number; height: number }): Promise<Uint8Array | null>; frame(time: number, sceneId: string, size: { width: number; height: number }): Promise<{ bytes: Uint8Array; missingAssets: string[] } | { bytes: null; failure: string }>; readPixel(x: number, y: number): Promise<number[] | null>; setDerived(entries: { key: string; kind: "lut"; url: string; sha256: string }[]): Promise<unknown>; setOverride(overrides: Record<string, Record<string, unknown>>): Promise<unknown>; readBlock(x: number, y: number, side?: number): Promise<number[] | null>; dispose(): void;
  exportVideo(request: { width: number; height: number; frameRate: { numerator: number; denominator: number }; bitrate?: number; audio: boolean }, onProgress: (progress: { stage: string; framesDone: number; frameCount: number }) => void): { done: Promise<Uint8Array>; cancel(): void };
  thumbnails(assetId: string, times: number[], longSide: number, onFrame: (time: number, bytes: Uint8Array) => void): () => void;
  port: EngineSurfacePort; ready: Record<string, unknown> | null; withDocument<T>(document: ProjectDocument, sceneId: string, work: () => Promise<T>): Promise<T>;
};

/** There is no local engine on a phone; without a paired host the editor says so. */
export async function openPreviewEngine(_host: unknown, init: EngineInit, events: EngineEvents, _cancelled?: () => boolean): Promise<PreviewEngine | null> {
  if (!init.remote) { events.onState("unsupported", "Connect to a host to preview this project."); return null; }
  events.onState("ready");
  const remote = createRemotePreview(init.remote, events, { loadVideo: async (result) => {
    const response = await signedRequest({ host: init.remote!.host, signer: init.remote!.signer }, "GET", blobRoutes.bytes(result.sha256), undefined, { range: `bytes=0-${result.size - 1}` });
    if (!response.ok) throw new Error(`Preview download failed (${response.status})`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length !== result.size) throw new Error("Preview download was incomplete");
    const directory = `${FileSystem.cacheDirectory ?? ""}jagentchill-preview/`;
    await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
    const path = `${directory}${init.remote!.projectId}-r${result.revision}.mp4`;
    await FileSystem.writeAsStringAsync(path, toBase64(bytes), { encoding: "base64" });
    return path;
  } });
  const no = async () => undefined;
  return {
    setDocument(document, scene) { remote.setDocument(document, scene); }, setSources: no, setFonts: no,
    seek(time) { remote.seek(time, init.width); return Promise.resolve(); },
    async play(time = 0) { remote.play(time); }, async pause() { remote.pause(); }, async setRate() {}, async setLoop() {}, async setVolume() {}, async setQuality() {}, async resize(width) { init.width = width; },
    async layout() { return {}; }, async sampleSource() { return null; }, async still() { return null; },
    async frame(time) { await new Promise<void>((resolve) => { remote.seek(time, init.width); setTimeout(resolve, 140); }); return { bytes: null, failure: "Host frame is shown by the native preview surface." }; },
    async readPixel() { return null; }, async setDerived() {}, async setOverride() {}, async readBlock() { return null; }, dispose() { remote.dispose(); },
    exportVideo() { return { done: Promise.reject(new Error("Video export runs on the host.")), cancel() {} }; }, thumbnails() { return () => {}; },
    port: null as unknown as EngineSurfacePort, ready: { remote: true }, async withDocument<T>(_doc: ProjectDocument, _scene: string, work: () => Promise<T>): Promise<T> { return work(); },
  };
}
