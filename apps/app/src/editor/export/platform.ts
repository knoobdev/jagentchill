/**
 * Native implementation of what an export needs from the platform. On a phone the export runs inside the engine view of
 * `mobile-editor`, which is not part of this build: nothing here can encode or write, and the dialog says so.
 */
import { exporting } from "@jagentchill/app-core";
import { signedRequest, type DeviceSigner, type HostConnection, type HostRecord } from "@jagentchill/client";
import { File as ExpoFile, Directory, FileMode, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import * as MediaLibrary from "expo-media-library/legacy";
import * as Crypto from "expo-crypto";
import { createHostExportJob, resumeHostFile } from "./remote-client";

type VideoCodec = exporting.VideoCodec;
export const exportPlatform: "web" | "desktop" | "mobile" = "mobile";
export type HostExportInput = { host: HostRecord; connection: HostConnection; signer: DeviceSigner; projectId: string; settings: exporting.ExportSettings; range: { start: number; end: number }; fileName: string };
export async function createHostExport(input: HostExportInput): Promise<exporting.RemoteJob> {
  return createHostExportJob({ connection: input.connection, projectId: input.projectId, settings: input.settings, range: input.range, fileName: input.fileName, idempotencyKey: Crypto.randomUUID() });
}
export async function downloadHostExport(input: { host: HostRecord; signer: DeviceSigner; job: exporting.RemoteJob; onProgress?(done: number, total: number): void }): Promise<string> {
  if (!input.job.output) throw new Error("The host export has no output file.");
  const directory = new Directory(Paths.cache, "jagentchill-exports");
  directory.create({ idempotent: true, intermediates: true });
  const file = new ExpoFile(directory, input.job.output.fileName || `export-${input.job.jobId}.mp4`);
  const present = file.exists ? file.size : 0;
  if (present > input.job.output.size) file.delete();
  // File.open(WriteOnly) does not create a missing file on native platforms.
  if (!file.exists) file.create();
  const offset = file.exists ? file.size : 0;
  if (offset < input.job.output.size) {
    const handle = file.open(offset ? FileMode.Append : FileMode.WriteOnly);
    try {
      await resumeHostFile({ size: input.job.output.size, offset, requestRange: async (start, end) => {
        const response = await signedRequest({ host: input.host, signer: input.signer }, "GET", exporting.exportFileRoute(input.job!.jobId), undefined, { range: `bytes=${start}-${end}` });
        if (response.status !== 206) throw new Error(`Host export download failed (${response.status})`);
        return new Uint8Array(await response.arrayBuffer());
      }, write: (bytes) => handle.writeBytes(bytes), onProgress: input.onProgress });
    } finally { handle.close(); }
  }
  return file.uri;
}
export async function saveHostExportToPhotos(uri: string): Promise<void> {
  const permission = await MediaLibrary.requestPermissionsAsync(true, ["video"]);
  if (!permission.granted) throw new Error("Photos permission was not granted.");
  await MediaLibrary.saveToLibraryAsync(uri);
}
export async function shareHostExport(uri: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing is unavailable on this device.");
  await Sharing.shareAsync(uri, { mimeType: "video/mp4", UTI: "public.mpeg-4" });
}
export async function probeVideoEncoders(_size: { width: number; height: number }, _fps: number, _bitrate: number, _acceleration?: "auto" | "prefer-hardware" | "prefer-software"): Promise<Record<VideoCodec, boolean>> { return { h264: false, hevc: false, vp9: false, av1: false }; }
export async function probeAudioEncoders(_sampleRate?: number, _channels?: number): Promise<{ aac: boolean; opus: boolean; flac: boolean; mp3: boolean }> { return { aac: false, opus: false, flac: false, mp3: false }; }
export type SaveHandle = { name: string };
export type FolderHandle = { name: string };
export const hasSavePicker = (): boolean => false;
export const hasDirectoryPicker = (): boolean => false;
export async function pickSaveFile(_name: string, _mime: string): Promise<SaveHandle | "cancelled" | null> { return null; }
export async function pickFolder(): Promise<FolderHandle | "cancelled" | null> { return null; }
export type Output = { write(data: Uint8Array, position: number): Promise<void>; close(): Promise<number>; abort(): Promise<void> };
export async function openOutput(_target: { handle: SaveHandle } | { privateName: string }): Promise<Output> { throw new Error("Exporting on this device needs the engine view of the native build"); }
export async function writeIntoFolder(_folder: FolderHandle, _name: string, _bytes: Uint8Array): Promise<void> { throw new Error("Exporting on this device needs the engine view of the native build"); }
export async function privateFile(_privateName: string): Promise<File | null> { return null; }
export async function deletePrivate(_privateName: string): Promise<void> {}
export async function cleanPrivate(_keep: ReadonlySet<string>): Promise<void> {}
export function download(_file: Blob, _name: string): void {}
export async function freeBytes(): Promise<number | null> { return null; }
export function canShareFile(_file: File): boolean { return false; }
export async function shareFile(_file: File): Promise<boolean> { return false; }
export const openPage = (_url: string): void => {};
export async function copyToClipboard(text: string): Promise<boolean> { try { await (await import("expo-clipboard")).setStringAsync(text); return true; } catch { return false; } }
export function guardExport(_active: () => boolean): () => void { return () => {}; }
export function onTabHidden(_handler: (hidden: boolean) => void): () => void { return () => {}; }
export function hiddenHost(): { element: unknown; remove(): void } { return { element: null, remove: () => {} }; }
export async function toJpeg(_bytes: Uint8Array, _mime: string, _longSide: number, _quality?: number): Promise<Uint8Array | null> { return null; }
export const toBase64 = (_bytes: Uint8Array): string => "";
export async function decodeRgba(_bytes: Uint8Array, _mime: string): Promise<{ width: number; height: number; rgba: Uint8ClampedArray } | null> { return null; }
export const appVersion = (): string => process.env.EXPO_PUBLIC_JAGENTCHILL_VERSION || "0.0.0";
export const platformName = (): string => "mobile";
