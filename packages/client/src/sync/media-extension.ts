/** Only a short alphanumeric tail is a file extension. */
export const extensionOf = (name: string): string => {
  const tail = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  return /^[a-z0-9]{1,10}$/.test(tail) ? tail : "";
};

/** The extension of a downloaded file whose name has none, read from its first bytes. */
export const sniffExtension = (head: Uint8Array): string | undefined => {
  const at = (offset: number, text: string) => [...text].every((char, index) => head[offset + index] === char.charCodeAt(0));
  if (at(0, "ID3") || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0 && (head[1] & 0x06) !== 0)) return "mp3";
  if (at(0, "RIFF") && at(8, "WAVE")) return "wav";
  if (at(0, "RIFF") && at(8, "WEBP")) return "webp";
  if (at(0, "OggS")) return "ogg";
  if (at(0, "fLaC")) return "flac";
  if (head[0] === 0xff && (head[1] & 0xf6) === 0xf0) return "aac";
  if (at(4, "ftyp")) return at(8, "M4A ") ? "m4a" : at(8, "qt  ") ? "mov" : "mp4";
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return "webm";
  if (head[0] === 0x89 && at(1, "PNG")) return "png";
  if (head[0] === 0xff && head[1] === 0xd8) return "jpg";
  if (at(0, "GIF8")) return "gif";
  return undefined;
};

/** The safe extension supplied to a media store for a downloaded asset. */
export const downloadExtension = (name: string, head: Uint8Array): string | undefined => extensionOf(name) || sniffExtension(head);

/** A repeated hash mismatch is the concrete failure shown on the transfer row. */
export const DOWNLOAD_HASH_MISMATCH_MESSAGE = "The downloaded file did not match its expected hash.";
