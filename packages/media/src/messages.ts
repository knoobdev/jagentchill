/**
 * Every user-visible sentence this capability produces, in English exactly as the spec gives it. Callers receive
 * `{code, params, text}`: the code and params feed the locale resources (en, vi, ja); `text` is the English form.
 */
export const MEDIA_MESSAGES = {
  "media.unsupported-type": "Unsupported file type: {name}",
  "media.already-in-project": "{name} is already in this project",
  "media.unreadable": "Unable to read {name}",
  "media.cant-preview": "Can't preview {name}",
  "media.heic-needs-host": "HEIC photos need a host to convert them. Convert {name} to JPEG or PNG, or connect a host.",
  "media.quota": "Not enough storage for {name} ({size}). {available} available.",
  "media.quota.empty-trash": "Empty trash ({size})",
  "media.quota.manage": "Manage storage",
  "media.save-failed": "{name} could not be saved",
  "media.import.progress": "Uploading media asset(s)…",
  "media.import.progress.native": "Importing media…",
  "media.import.done.one": "{name} has been uploaded",
  "media.import.done.many": "{n} media assets have been uploaded",
  "media.import.done.none": "No media assets were uploaded",
  "media.import.failure-line": "{name}: {reason}",
  "media.drop-zone": "Drag and drop videos, photos, and audio files here",
  "media.drop-zone.processing": "Processing your files ({percent} %)",
  "media.url.failed": "Download from {host} failed: {reason}",
  "media.url.not-media": "The link does not point to a supported media file",
  "media.url.needs-gateway": "A connected host is required to import this link",
  "media.not-found": "Media not found in this project",
  "media.no-results": "No media found",
  "media.clear-search": "Clear search",
  "media.clear-filters": "Clear filters",
  "media.folder-depth": "Folders can be nested up to 4 levels",
  "media.tag-limit": "Up to 20 tags",
  "media.offline": "Media offline",
  "media.offline.badge": "Offline",
  "media.offline.banner": "{n} media files are offline",
  "media.offline.banner.one": "1 media file is offline",
  "media.relink": "Relink…",
  "media.locate-folder": "Locate folder…",
  "media.export-originals.skipped": "Skipped offline media: {names}",
  "media.copy-into-library.space": "Not enough space to copy media into the library. {required} required, {available} available.",
  "media.copy-into-library.summary": "Copy {n} files ({size}) into the library",
  "media.proxy.badge": "Proxy",
  "media.proxy.failed": "Proxy failed",
  "media.proxy.unavailable": "Proxy unavailable on this device",
  "media.proxy.retry": "Retry",
  "media.proxy.offer": "{name} can't be previewed on this device. Convert it on {host}?",
  "media.codec-guidance": "{codec} cannot be decoded on this device. Convert the file to H.264 MP4 and import it again.",
  "media.codec-guidance.hevc": "HEVC cannot be decoded on this device. Convert the file to H.264 MP4 and import it again. HEVC plays natively in Safari, on iOS and macOS, and on devices with a hardware HEVC decoder.",
  "media.export-blocked.undecodable": "Export can't start: {names} can't be decoded on this device.",
  "media.export-blocked.offline": "Export can't start: these media files are offline: {names}",
  "media.recording.storage-low": "Recording stopped because storage ran low",
  "media.recording.recovered": "Recovered recording",
  "media.connector.reconnect": "Reconnect {connector} in Settings",
  "media.connector.busy": "{connector} is busy — retrying",
  "media.connector.gone": "{name} is no longer available",
  "media.connector.needs-host": "Connect a host to import from {connector}",
  "media.connector.setup": "Set up {connector} on {host}",
  "media.devices.needs-host": "Connect a host to import from your devices",
  "media.devices.viewer": "Your role on this host is view-only",
  "media.stock.connect": "Connect a stock source in Settings",
  "media.stock.ask-admin": "Ask an admin to connect a stock source",
  "media.stock.error": "Couldn't load results",
  "media.index.needs-host": "Connect a host to index media for search",
  "media.slates-in-export": "{n} placeholder shots are still in the timeline",
} as const;
export type MediaMessageCode = keyof typeof MEDIA_MESSAGES;
export type MediaMessage = { code: MediaMessageCode; params: Record<string, string | number>; text: string };
export function message(code: MediaMessageCode, params: Record<string, string | number> = {}): MediaMessage {
  return { code, params, text: MEDIA_MESSAGES[code].replace(/\{(\w+)\}/g, (_, key: string) => String(params[key] ?? "")) };
}

/** Sizes shown to the user: binary units with one decimal (the rule of `project-storage.Quota evaluation`). */
export function formatBytes(bytes: number): string {
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes / 1024, unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value.toFixed(1)} ${units[unit]}`;
}
export const MIB = 1024 * 1024;
/** The media-write reserve of `project-storage.Quota evaluation`. */
export const STORAGE_RESERVE_BYTES = 50 * MIB;
/** Below this much available space after the reserve, the Media tab footer turns to the warning colour token. */
export const LOW_SPACE_WARNING_BYTES = 500 * MIB;
/** The Media tab footer: project media usage and available space in binary units. */
export function storageFooter(usedBytes: number, availableAfterReserve: number | null): { used: string; available: string | null; warning: boolean } {
  return { used: formatBytes(usedBytes), available: availableAfterReserve === null ? null : formatBytes(availableAfterReserve), warning: availableAfterReserve !== null && availableAfterReserve < LOW_SPACE_WARNING_BYTES };
}
/** The one quota message with its actions; "Empty trash" is offered when the trash is non-empty. */
export function quotaMessage(name: string, decision: { required: number; available: number }, trashBytes = 0): MediaMessage & { actions: MediaMessage[] } {
  return {
    ...message("media.quota", { name, size: formatBytes(decision.required), available: formatBytes(decision.available) }),
    actions: [...(trashBytes > 0 ? [message("media.quota.empty-trash", { size: formatBytes(trashBytes) })] : []), message("media.quota.manage")],
  };
}
/** Guidance in the asset info for a codec this device cannot decode; HEVC additionally names where it decodes natively. */
export const codecGuidance = (codecName: string, codec: string | undefined): MediaMessage => (codec === "hevc" ? message("media.codec-guidance.hevc") : message("media.codec-guidance", { codec: codecName }));
