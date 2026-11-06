/** Type detection and the list of supported formats. Pure: it looks at a name, a MIME type and the first bytes. */
export type MediaType = "image" | "video" | "audio";
/** Lower-case container / file-format names as stored in `AssetRecord.container`. */
export type MediaFormat =
  | "mp4" | "mov" | "m4v" | "webm" | "mkv" | "3gp"
  | "mp3" | "wav" | "m4a" | "aac" | "ogg" | "opus" | "flac"
  | "jpeg" | "png" | "webp" | "gif" | "avif" | "bmp" | "svg" | "heic" | "heif";

export const FORMAT_TYPES: Record<MediaFormat, MediaType> = {
  mp4: "video", mov: "video", m4v: "video", webm: "video", mkv: "video", "3gp": "video",
  mp3: "audio", wav: "audio", m4a: "audio", aac: "audio", ogg: "audio", opus: "audio", flac: "audio",
  jpeg: "image", png: "image", webp: "image", gif: "image", avif: "image", bmp: "image", svg: "image", heic: "image", heif: "image",
};
const EXTENSION_FORMATS: Record<string, MediaFormat> = {
  mp4: "mp4", mov: "mov", m4v: "m4v", webm: "webm", mkv: "mkv", "3gp": "3gp",
  mp3: "mp3", wav: "wav", m4a: "m4a", aac: "aac", ogg: "ogg", oga: "ogg", opus: "opus", flac: "flac",
  jpg: "jpeg", jpeg: "jpeg", png: "png", webp: "webp", gif: "gif", avif: "avif", bmp: "bmp", svg: "svg", heic: "heic", heif: "heif",
};
/** What the file picker accepts: the three MIME families plus every supported extension. */
export const SUPPORTED_EXTENSIONS: readonly string[] = Object.keys(EXTENSION_FORMATS);
export const PICKER_ACCEPT: string = ["image/*", "video/*", "audio/*", ...SUPPORTED_EXTENSIONS.map((extension) => `.${extension}`)].join(",");
export const SUPPORTED_VIDEO_CODECS = ["h264", "hevc", "vp8", "vp9", "av1", "prores"] as const;
export const SUPPORTED_AUDIO_CODECS = ["aac", "mp3", "opus", "vorbis", "flac", "pcm", "alac"] as const;
/** Bytes of the file start that signature sniffing looks at. */
export const SNIFF_BYTES = 4096;
export const SVG_MIME = "image/svg+xml";

export const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : "";
};
export const baseNameOf = (name: string): string => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
};

const ascii = (bytes: Uint8Array, start: number, length: number): string => String.fromCharCode(...bytes.subarray(start, Math.min(bytes.length, start + length)));
const startsWith = (bytes: Uint8Array, signature: number[], offset = 0): boolean => signature.every((byte, index) => bytes[offset + index] === byte);
const includesAscii = (bytes: Uint8Array, text: string): boolean => {
  outer: for (let i = 0; i + text.length <= bytes.length; i++) {
    for (let j = 0; j < text.length; j++) if (bytes[i + j] !== text.charCodeAt(j)) continue outer;
    return true;
  }
  return false;
};

/** Whether the text is an SVG document: `<svg` after an optional byte-order mark, XML prolog, doctype, comments and whitespace. */
export function looksLikeSvg(head: Uint8Array): boolean {
  let text = new TextDecoder("utf-8", { fatal: false }).decode(head.subarray(0, SNIFF_BYTES)).replace(/^﻿/, "");
  for (;;) {
    const trimmed = text.replace(/^\s+/, "");
    const skipped = trimmed.replace(/^<\?xml[\s\S]*?\?>/i, "").replace(/^<!--[\s\S]*?-->/, "").replace(/^<!DOCTYPE[^>]*>/i, "");
    if (skipped === trimmed) { text = trimmed; break; }
    text = skipped;
  }
  return /^<svg[\s>/]/i.test(text);
}

const ISO_BRANDS: Record<string, MediaFormat> = {
  "qt  ": "mov", "M4V ": "m4v", "M4VH": "m4v", "M4VP": "m4v", "M4A ": "m4a", "M4B ": "m4a",
  "3gp4": "3gp", "3gp5": "3gp", "3gp6": "3gp", "3gp7": "3gp", "3g2a": "3gp",
  avif: "avif", avis: "avif", heic: "heic", heix: "heic", hevc: "heic", hevx: "heic", heim: "heic", heis: "heic", mif1: "heif", msf1: "heif",
};
/** Container signature of the first 4 KiB, or `null` when nothing known matches. */
export function sniffFormat(head: Uint8Array): MediaFormat | null {
  const bytes = head.subarray(0, SNIFF_BYTES);
  if (ascii(bytes, 4, 4) === "ftyp") {
    const size = Math.min(bytes.length, ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0);
    const major = ISO_BRANDS[ascii(bytes, 8, 4)];
    if (major && major !== "heif") return major;
    // `mif1` is the generic HEIF brand: the compatible brands say whether the picture is AVIF or HEVC-coded.
    for (let offset = 16; offset + 4 <= size; offset += 4) {
      const brand = ISO_BRANDS[ascii(bytes, offset, 4)];
      if (brand && brand !== "heif") return major === "heif" || brand === "avif" || brand === "heic" ? brand : (major ?? brand);
    }
    return major ?? "mp4";
  }
  if (["moov", "mdat", "wide", "free", "skip"].includes(ascii(bytes, 4, 4))) return "mov";
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return includesAscii(bytes.subarray(0, 64), "webm") ? "webm" : "mkv";
  if (ascii(bytes, 0, 4) === "RIFF") {
    const kind = ascii(bytes, 8, 4);
    return kind === "WAVE" ? "wav" : kind === "WEBP" ? "webp" : null;
  }
  if (ascii(bytes, 0, 4) === "OggS") return includesAscii(bytes, "OpusHead") ? "opus" : "ogg";
  if (ascii(bytes, 0, 4) === "fLaC") return "flac";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (ascii(bytes, 0, 4) === "GIF8") return "gif";
  if (ascii(bytes, 0, 2) === "BM" && bytes.length >= 26 && ((bytes[2] | (bytes[3] << 8) | (bytes[4] << 16) | (bytes[5] << 24)) >>> 0) >= 26) return "bmp";
  if (ascii(bytes, 0, 3) === "ID3") return "mp3";
  if (bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0) return "aac"; // ADTS sync, layer 0
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0 && (bytes[1] & 0x06) !== 0 && (bytes[2] & 0xf0) !== 0xf0) return "mp3";
  if (looksLikeSvg(bytes)) return "svg";
  return null;
}

export type DetectInput = { name: string; mimeType?: string; head?: Uint8Array };
export type Detected = {
  type: MediaType;
  /** The container when the extension or the signature identifies one. */
  format: MediaFormat | null;
  /** The MIME type to store and serve: the given one, repaired for SVG delivered without a type. */
  mimeType: string;
  /** HEIC/HEIF stills are never handed to the engine as such; they need a mezzanine. */
  needsMezzanine: boolean;
};
const MIME_BY_FORMAT: Record<MediaFormat, string> = {
  mp4: "video/mp4", mov: "video/quicktime", m4v: "video/x-m4v", webm: "video/webm", mkv: "video/x-matroska", "3gp": "video/3gpp",
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg", opus: "audio/ogg", flac: "audio/flac",
  jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", avif: "image/avif", bmp: "image/bmp", svg: SVG_MIME, heic: "image/heic", heif: "image/heif",
};
export const mimeTypeOfFormat = (format: MediaFormat): string => MIME_BY_FORMAT[format];

/**
 * Detection order: the MIME type prefix, the file extension, then the container signature of the first 4 KiB.
 * `null` means the file is not imported ("Unsupported file type: {name}").
 */
export function detectMediaType({ name, mimeType = "", head }: DetectInput): Detected | null {
  const mime = mimeType.trim().toLowerCase();
  const byExtension = EXTENSION_FORMATS[extensionOf(name)] ?? null;
  const sniffed = head && head.length > 0 ? sniffFormat(head) : null;
  const prefix = (["image", "video", "audio"] as const).find((type) => mime.startsWith(`${type}/`)) ?? null;
  let type: MediaType | null = prefix, format: MediaFormat | null = null;
  if (type) format = [byExtension, sniffed].find((candidate) => candidate && FORMAT_TYPES[candidate] === type) ?? formatOfMime(mime, type);
  else if (byExtension) { type = FORMAT_TYPES[byExtension]; format = byExtension; }
  else if (sniffed) { type = FORMAT_TYPES[sniffed]; format = sniffed; }
  if (!type) return null;
  // An SVG that arrives with no MIME type is repaired here, on import and on load alike.
  const svg = format === "svg" || (mime === "" && sniffed === "svg");
  const repaired = svg ? SVG_MIME : mime !== "" && prefix ? mime : format ? MIME_BY_FORMAT[format] : `${type}/*`;
  return { type, format: svg ? "svg" : format, mimeType: repaired, needsMezzanine: format === "heic" || format === "heif" };
}
function formatOfMime(mime: string, type: MediaType): MediaFormat | null {
  const hit = (Object.keys(MIME_BY_FORMAT) as MediaFormat[]).find((format) => MIME_BY_FORMAT[format] === mime && FORMAT_TYPES[format] === type);
  if (hit) return hit;
  if (mime === "image/jpg") return "jpeg";
  if (mime === "audio/mp3") return "mp3";
  if (mime === "audio/x-wav" || mime === "audio/wave") return "wav";
  if (mime === "audio/x-m4a") return "m4a";
  if (mime === "audio/x-flac") return "flac";
  return null;
}
/** MIME repair on load: a stored SVG whose blob has no type is served as `image/svg+xml`. */
export const repairMimeType = (input: DetectInput): string => detectMediaType(input)?.mimeType ?? (input.mimeType ?? "");
