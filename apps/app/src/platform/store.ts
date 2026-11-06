/** Native implementation of the app's device services. The web one is `store.web.ts`. */
import * as FileSystem from "expo-file-system/legacy";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import * as SQLite from "expo-sqlite";
import KeyValue from "expo-sqlite/kv-store";
import type { KeyValueStore } from "@jagentchill/app-core";
import { expoFileDriver, expoSqlDriver, openMobileStorage, toBase64, type StoragePort } from "@jagentchill/storage";
import { nativeImageUrl } from "./native-image-url";

/** UI preferences: the platform key-value store, read synchronously before first paint. */
export const preferenceStore: KeyValueStore = {
  get: (key) => KeyValue.getItemSync(key),
  set: (key, value) => KeyValue.setItemSync(key, value),
  remove: (key) => { KeyValue.removeItemSync(key); },
};
/** The mobile store: records in the app-private SQLite database, files in the documents directory. */
export async function openStorage(): Promise<StoragePort> {
  const database = await SQLite.openDatabaseAsync("jagentchill.db");
  return openMobileStorage(expoSqlDriver(database as never), expoFileDriver(FileSystem as never));
}
/** A stored image as something `Image` can show. Native builds read images from files, which the render engine provides. */
export const imageUrl = (bytes: Uint8Array, mime: string): string => nativeImageUrl(bytes, mime, toBase64);
export const releaseImageUrl = (_url: string): void => {};
/** Frame 0 of a project that holds only its background. Needs a 2D canvas, which native builds get from the render engine. */
export const renderBackgroundFrame = async (_background: unknown, _size: { width: number; height: number }, _longSide: number): Promise<{ bytes: Uint8Array; mime: "image/jpeg" | "image/png" } | null> => null;
export function setDocumentTitle(_title: string): void {}
/** Registers a guard that makes leaving the page ask first. Only the web has such a prompt. */
export function guardUnload(_shouldAsk: () => boolean, _work?: { settle(): Promise<void> | void; pending(): boolean }): () => void { return () => {}; }
/** Keeps the browser from navigating to a file dropped outside a drop target. */
export function preventStrayDrops(): () => void { return () => {}; }
export type DropHandlers = { onEnter?(): void; onLeave?(): void; onDrop?(data: { files: File[]; text: string }): void; accept?(types: readonly string[]): boolean };
export function bindDrop(_node: unknown, _handlers: DropHandlers): () => void { return () => {}; }
export function bindDrag(_node: unknown, _payload: () => string | null, _handlers?: { onStart?(): void; onEnd?(): void }): () => void { return () => {}; }
export function onWindowKey(_handler: (event: { key: string; meta: boolean; ctrl: boolean; alt: boolean; shift: boolean; inField: boolean; preventDefault(): void }) => void): () => void { return () => {}; }
export function onEdgeHover(_edge: number, _delay: number, _show: () => void): () => void { return () => {}; }
export const isDesktopOs = (): boolean => false;
export const systemLanguage = (): string => Intl.DateTimeFormat().resolvedOptions().locale;
export const openExternal = (_url: string): void => {};
export function bindSplitter(_node: unknown, _handlers: { onStart(): void; onDrag(dx: number): void; onEnd(): void; onReset(): void }): () => void { return () => {}; }
export function focusById(_id: string): void {}
export const pickFiles = (_accept: string, _multiple: boolean): Promise<File[]> => Promise.resolve([]);
export type PickedNativeMedia = { uri: string; name: string; mimeType: string; size: number; modified_ms?: number };
export async function readNativeMediaRange(uri: string, start: number, end: number): Promise<Uint8Array> {
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: "base64", position: start, length: end - start });
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", clean = base64.replace(/[^A-Za-z0-9+/]/g, ""), bytes = new Uint8Array(Math.floor(clean.length * 3 / 4));
  for (let i = 0, at = 0; i < clean.length; i += 4) {
    const a = alphabet.indexOf(clean[i] ?? "A"), b = alphabet.indexOf(clean[i + 1] ?? "A"), c = alphabet.indexOf(clean[i + 2] ?? "A"), d = alphabet.indexOf(clean[i + 3] ?? "A");
    bytes[at++] = (a << 2) | (b >> 4);
    if (i + 2 < clean.length) bytes[at++] = ((b & 15) << 4) | (c >> 2);
    if (i + 3 < clean.length) bytes[at++] = ((c & 3) << 6) | d;
  }
  return bytes;
}
/** MediaSheet pickers return file references; callers read byte ranges from the URI instead of building a whole-file Blob. */
export async function pickNativeMedia(kind: "photos" | "videos" | "files"): Promise<PickedNativeMedia[]> {
  if (kind === "files") {
    const result = await DocumentPicker.getDocumentAsync({ type: "*/*", multiple: true, copyToCacheDirectory: true });
    return result.canceled ? [] : result.assets.map((asset) => ({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType ?? "application/octet-stream", size: asset.size ?? 0 }));
  }
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: kind === "photos" ? ["images"] : ["videos"], allowsMultipleSelection: true, quality: 1, base64: false });
  return result.canceled ? [] : result.assets.map((asset) => ({ uri: asset.uri, name: asset.fileName ?? asset.uri.split("/").pop() ?? (kind === "photos" ? "photo" : "video"), mimeType: asset.mimeType ?? (kind === "photos" ? "image/jpeg" : "video/mp4"), size: asset.fileSize ?? 0 }));
}
export const downloadUrl = (): string | undefined => undefined;
export const heldModifiers = (): { shift: boolean; toggle: boolean } => ({ shift: false, toggle: false });
