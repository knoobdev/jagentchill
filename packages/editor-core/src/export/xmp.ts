/** XMP packets inside exported files (`export-share.Provenance metadata`): PNG, JPEG, and the `uuid` box of MP4 and MOV. Pure byte work. */
const utf8 = new TextEncoder();
const ascii = (text: string) => Uint8Array.from(text, (char) => char.charCodeAt(0));
const join = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
};
const u32 = (value: number) => Uint8Array.from([(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]);
let crcTable: Uint32Array | undefined;
function crc32(bytes: Uint8Array): number {
  if (!crcTable) { crcTable = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; } }
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index++) crc = crcTable[(crc ^ bytes[index]) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** A PNG with the packet in an `iTXt` chunk (keyword `XML:com.adobe.xmp`) right after `IHDR`. */
export function pngWithXmp(png: Uint8Array, xmp: string): Uint8Array {
  // Signature (8) + IHDR (4 length + 4 type + 13 data + 4 CRC).
  const after = 8 + 25;
  const body = join(ascii("iTXt"), ascii("XML:com.adobe.xmp"), Uint8Array.from([0, 0, 0, 0, 0]), utf8.encode(xmp));
  return join(png.subarray(0, after), u32(body.length - 4), body, u32(crc32(body)), png.subarray(after));
}
/** A JPEG with the packet in an APP1 segment (`http://ns.adobe.com/xap/1.0/`) right after the start-of-image marker. */
export function jpegWithXmp(jpeg: Uint8Array, xmp: string): Uint8Array {
  const payload = join(ascii("http://ns.adobe.com/xap/1.0/\0"), utf8.encode(xmp)), length = payload.length + 2;
  return join(jpeg.subarray(0, 2), Uint8Array.from([0xff, 0xe1, (length >> 8) & 255, length & 255]), payload, jpeg.subarray(2));
}
const XMP_UUID = Uint8Array.from([0xbe, 0x7a, 0xcf, 0xcb, 0x97, 0xa9, 0x42, 0xe8, 0x9c, 0x71, 0x99, 0x94, 0x91, 0xe3, 0xaf, 0xac]);
/** The top-level `uuid` box that carries XMP in MP4 and MOV; it is appended after the finalised file. */
export function xmpUuidBox(xmp: string): Uint8Array {
  const packet = utf8.encode(xmp);
  return join(u32(8 + 16 + packet.length), ascii("uuid"), XMP_UUID, packet);
}
/** The XMP packet found in file bytes, wherever its container put it; `null` when there is none. */
export function findXmp(bytes: Uint8Array): string | null {
  const text = new TextDecoder("latin1").decode(bytes), start = text.indexOf("<x:xmpmeta"), end = text.indexOf("</x:xmpmeta>");
  return start >= 0 && end > start ? new TextDecoder().decode(bytes.subarray(start, end + 12)) : null;
}

