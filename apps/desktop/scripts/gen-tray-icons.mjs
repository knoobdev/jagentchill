// Draws the three tray icons (idle, busy, attention) as 32×32 PNGs, plus macOS template variants, into build/.
// The glyph is a ring; busy adds a centre dot, attention a filled disc at the top right.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "build");
const crcTable = Array.from({ length: 256 }, (_unused, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (bytes) => { let c = 0xffffffff; for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const head = Buffer.alloc(8); head.writeUInt32BE(data.length, 0); head.write(type, 4); const tail = Buffer.alloc(4); tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4), data])), 0); return Buffer.concat([head, data, tail]); };
function png(size, alphaAt, rgb) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { const at = y * (size * 4 + 1) + 1 + x * 4; raw[at] = rgb[0]; raw[at + 1] = rgb[1]; raw[at + 2] = rgb[2]; raw[at + 3] = Math.round(255 * alphaAt(x + 0.5, y + 0.5)); }
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const edge = (distance) => Math.max(0, Math.min(1, 0.5 - distance));
const shapes = {
  idle: (x, y) => { const r = Math.hypot(x - 16, y - 16); return edge(Math.abs(r - 10) - 1.6); },
  busy: (x, y) => { const r = Math.hypot(x - 16, y - 16); return Math.max(edge(Math.abs(r - 10) - 1.6), edge(r - 4)); },
  attention: (x, y) => { const r = Math.hypot(x - 16, y - 16), badge = Math.hypot(x - 25, y - 7); return badge < 7.5 ? edge(badge - 6) : edge(Math.abs(r - 10) - 1.6); },
};
for (const [name, shape] of Object.entries(shapes)) {
  writeFileSync(join(out, `tray-${name}.png`), png(32, shape, [237, 237, 237]));
  writeFileSync(join(out, `tray-${name}Template.png`), png(32, shape, [0, 0, 0]));
}
console.log("wrote build/tray-{idle,busy,attention}{,Template}.png");
