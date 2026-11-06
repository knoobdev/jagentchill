import { blobRoutes, type BlobStatus } from "@jagentchill/protocol";
import { signedRequest, uploadBlob, type DeviceSigner, type HostConnection, type HostRecord } from "@jagentchill/client";
import { hashMobileFile, toBase64 } from "@jagentchill/storage";
import * as FileSystem from "expo-file-system/legacy";
import { readNativeMediaRange, type PickedNativeMedia } from "../platform/store";

type Caller = Pick<HostConnection, "call">;
export type NativeMediaReader = PickedNativeMedia & { read(start: number, end: number): Promise<Uint8Array> };
export type ImportedHostMedia = { assetId: string; name: string; alreadyInLibrary?: boolean; kind?: "video" | "audio" | "image" };

/** The sole native import bridge: hash and upload file ranges, let the host probe, then let it register the project asset. */
export async function importRemoteMedia(input: {
  host: HostRecord; connection: Caller; signer: DeviceSigner; projectId: string; file: NativeMediaReader; signal: AbortSignal;
  onProgress?(progress: { phase: "hash" | "upload"; bytes: number; total: number }): void;
}): Promise<ImportedHostMedia> {
  const { file } = input;
  const sha256 = await hashMobileFile(file, { signal: input.signal, onProgress: (bytes, total) => input.onProgress?.({ phase: "hash", bytes, total }) });
  await uploadBlob({ host: input.host, signer: input.signer }, {
    sha256, size: file.size, mime: file.mimeType || "application/octet-stream", name: file.name, purpose: "media",
    read: (start, end) => file.read(start, end),
  }, { signal: input.signal, onProgress: ({ bytes, total }) => input.onProgress?.({ phase: "upload", bytes, total }) });
  await input.connection.call("jagentchill.media.probe", { sha256 });
  return input.connection.call<ImportedHostMedia>("jagentchill.media.import", { projectId: input.projectId, sha256, name: file.name });
}

const wait = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const finish = () => { signal?.removeEventListener("abort", abort); resolve(); };
  const timer = setTimeout(finish, ms);
  const abort = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(new Error("Variant request cancelled.")); };
  signal?.addEventListener("abort", abort, { once: true });
});

/** Ask the host to make a picture, download its signed range, and return a cache URI or browser object URL. */
export async function fetchHostMediaPicture(input: { host: HostRecord; connection: Caller; signer: DeviceSigner; sha256: string; variant: "thumb" | "filmstrip"; signal?: AbortSignal }): Promise<string | null> {
  const directory = FileSystem.cacheDirectory ? `${FileSystem.cacheDirectory}jagentchill-media/` : null;
  const path = directory ? `${directory}${input.sha256}.${input.variant}.jpg` : null;
  if (path && (await FileSystem.getInfoAsync(path)).exists) return path;
  const request = await input.connection.call<{ state: "ready" | "queued" | "not-needed" }>("jagentchill.blob.variant.request", { sha256: input.sha256, variant: input.variant });
  if (request.state === "not-needed") return null;
  let ready: BlobStatus | undefined;
  for (let attempt = 0; attempt < 90; attempt++) {
    if (input.signal?.aborted) return null;
    const response = await signedRequest({ host: input.host, signer: input.signer }, "GET", blobRoutes.status(input.sha256), undefined, {}, input.signal);
    if (!response.ok) return null;
    const status = await response.json() as BlobStatus;
    if (status.state !== "complete") return null;
    if (status.variants[input.variant]) { ready = status; break; }
    await wait(1000, input.signal);
  }
  const descriptor = ready?.variants[input.variant];
  if (!descriptor) return null;
  const response = await signedRequest({ host: input.host, signer: input.signer }, "GET", blobRoutes.variant(input.sha256, input.variant), undefined, { range: `bytes=0-${descriptor.size - 1}` }, input.signal);
  if (!response.ok) return null;
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length !== descriptor.size) return null;
  if (path && directory) {
    await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
    await FileSystem.writeAsStringAsync(path, toBase64(bytes), { encoding: "base64" });
    return path;
  }
  return typeof URL.createObjectURL === "function" ? URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: "image/jpeg" })) : null;
}

export const nativeMediaReader = (file: PickedNativeMedia): NativeMediaReader => ({ ...file, read: (start, end) => readNativeMediaRange(file.uri, start, end) });
