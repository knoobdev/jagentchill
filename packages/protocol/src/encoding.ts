/** base64url without padding, as used for every key, nonce and signature on the wire. */
const B64URL = /^[A-Za-z0-9_-]*$/;

export function bytesToBase64Url(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let out = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index]!, b = bytes[index + 1], c = bytes[index + 2];
    out += alphabet[a >> 2] + alphabet[((a & 3) << 4) | ((b ?? 0) >> 4)];
    if (b !== undefined) out += alphabet[((b & 15) << 2) | ((c ?? 0) >> 6)];
    if (c !== undefined) out += alphabet[c & 63];
  }
  return out;
}

/** Returns null for anything that is not canonical unpadded base64url. */
export function base64UrlToBytes(text: string): Uint8Array<ArrayBuffer> | null {
  if (!B64URL.test(text) || text.length % 4 === 1) return null;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const bytes = new Uint8Array(Math.floor((text.length * 6) / 8));
  let accumulator = 0, bits = 0, index = 0;
  for (const char of text) {
    const value = alphabet.indexOf(char);
    if (value < 0) return null;
    accumulator = (accumulator << 6) | value;
    bits += 6;
    if (bits >= 8) { bits -= 8; bytes[index++] = (accumulator >> bits) & 255; accumulator &= (1 << bits) - 1; }
  }
  return bytesToBase64Url(bytes) === text ? bytes : null;
}

export function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

/** UTF-8 encoding without relying on browser TextEncoder globals (not supplied by every Hermes runtime). */
export function utf8(text: string): Uint8Array<ArrayBuffer> {
  const out: number[] = [];
  for (let index = 0; index < text.length; index++) {
    let code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      const low = text.charCodeAt(index + 1);
      if (low >= 0xdc00 && low <= 0xdfff) { code = 0x10000 + ((code - 0xd800) << 10) + low - 0xdc00; index++; }
      else code = 0xfffd;
    } else if (code >= 0xdc00 && code <= 0xdfff) code = 0xfffd;
    if (code < 0x80) out.push(code);
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000) out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    else out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
  }
  return new Uint8Array(out) as Uint8Array<ArrayBuffer>;
}

/** Strict UTF-8 decode, using URI decoding for runtimes without TextDecoder. */
export function utf8Decode(bytes: Uint8Array): string {
  let escaped = "";
  for (const byte of bytes) escaped += `%${byte.toString(16).padStart(2, "0")}`;
  return decodeURIComponent(escaped);
}
