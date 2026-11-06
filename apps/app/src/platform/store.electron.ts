/** The desktop shell's device services: the web ones, with storage, file pickers and OS integration replaced by the preload bridge. */
import { createBridgeStorage, OPEN_WITH_MEDIA } from "@jagentchill/desktop-core/renderer";
import type { StoragePort } from "@jagentchill/storage";
import { requireDesktop, type DesktopFile, type LibraryStatus } from "./desktop";

export * from "./store.web";

/**
 * The desktop store: the project library folder on disk, held by the main process. While the folder is missing the
 * shell shows its blocking dialog; the store opens once the user has located or created a library.
 */
export async function openStorage(): Promise<StoragePort> {
  const bridge = requireDesktop();
  await new Promise<void>((resolve) => {
    let off = () => {};
    const settle = (status: LibraryStatus) => { if (status.state === "ready") { off(); resolve(); } };
    off = bridge.library.onStatus(settle);
    void bridge.library.status().then(settle);
  });
  return createBridgeStorage(bridge.library);
}

const MIME: Record<string, string> = {
  mp4: "video/mp4", mov: "video/quicktime", m4v: "video/x-m4v", webm: "video/webm", mkv: "video/x-matroska", mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4",
  aac: "audio/aac", ogg: "audio/ogg", flac: "audio/flac", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml",
  srt: "application/x-subrip", vtt: "text/vtt", ass: "text/x-ass", json: "application/json", zip: "application/zip", jagentchill: "application/vnd.jagentchill.project+zip",
  ttf: "font/ttf", otf: "font/otf", woff: "font/woff", woff2: "font/woff2", cube: "text/plain", txt: "text/plain",
};
const READ_BYTES = 4 * 1024 * 1024;
/** A file the user chose, as the `File` the rest of the app works with. The token names the original path for reference in place. */
export async function fileFromDesktop(file: DesktopFile): Promise<File> {
  const bridge = requireDesktop();
  const parts: BlobPart[] = [];
  for (let start = 0; start < file.size; start += READ_BYTES) {
    const reply = await bridge.files.read(file.token, { start, end: Math.min(file.size, start + READ_BYTES) });
    if ("error" in reply) throw Object.assign(new Error(reply.error.message), { code: reply.error.code });
    parts.push(reply.value as unknown as BlobPart);
  }
  const extension = /\.([A-Za-z0-9]+)$/.exec(file.name)?.[1].toLowerCase() ?? "";
  const made = new File(parts, file.name, { type: MIME[extension] ?? "" });
  Object.defineProperty(made, "desktopToken", { value: file.token });
  return made;
}
/** The token of a file that came from a native dialog, a drop or a file association; `undefined` for any other `File`. */
export const desktopTokenOf = (file: File): string | undefined => (file as File & { desktopToken?: string }).desktopToken;

function filtersOf(accept: string): { name: string; extensions: string[] }[] {
  const extensions = new Set<string>();
  for (const token of accept.split(",").map((part) => part.trim().toLowerCase()).filter(Boolean)) {
    if (token.startsWith(".")) extensions.add(token.slice(1));
    else if (token === "video/*") OPEN_WITH_MEDIA.video.forEach((ext) => extensions.add(ext));
    else if (token === "audio/*") OPEN_WITH_MEDIA.audio.forEach((ext) => extensions.add(ext));
    else if (token === "image/*") OPEN_WITH_MEDIA.image.forEach((ext) => extensions.add(ext));
    else { const known = Object.entries(MIME).filter(([, mime]) => mime === token).map(([ext]) => ext); known.forEach((ext) => extensions.add(ext)); }
  }
  return extensions.size ? [{ name: "Files", extensions: [...extensions] }] : [];
}
/** The native open dialog of the operating system, remembering the folder of each purpose. */
export async function pickFiles(accept: string, multiple: boolean): Promise<File[]> {
  const purpose = accept.includes(".jagentchill") ? "import-project" : accept.includes(".cube") ? "lut" : /\.(ttf|otf|woff)/.test(accept) ? "font" : /\.(srt|vtt)/.test(accept) ? "subtitle" : "import-media";
  const chosen = await requireDesktop().files.openDialog({ purpose, multiple, filters: filtersOf(accept) });
  return Promise.all(chosen.filter((file) => !file.directory).map(fileFromDesktop));
}
export const isDesktopOs = (): boolean => true;
/** The desktop app is the download. */
export const downloadUrl = (): string | undefined => undefined;
/** Links leave the app: the main process validates the scheme and hands `https:` and `mailto:` to the system browser. */
export const openExternal = (url: string): void => { window.open(url, "_blank", "noopener"); };
