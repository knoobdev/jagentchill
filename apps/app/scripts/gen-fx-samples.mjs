// Draws the sample pictures the Effects, Filters and Transitions tabs render their tiles from, and writes them to
// `public/fx/`: `sample.png` (320 × 320, a landscape with a sun, hills and a figure) for effects and filters, and
// `transition-a.png` / `transition-b.png` (480 × 320, labelled A and B) for transitions. Every pixel comes from the
// canvas calls below; no outside picture is used. Recorded in docs/product/ASSET-PROVENANCE.md.
// Usage: node scripts/gen-fx-samples.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const out = join(new URL("..", import.meta.url).pathname, "public/fx");
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
const draw = (script, width, height) => page.evaluate(async ({ script, width, height }) => {
  const canvas = new OffscreenCanvas(width, height), c = canvas.getContext("2d");
  new Function("c", "w", "h", script)(c, width, height);
  const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
  return Array.from(bytes);
}, { script, width, height });

const sample = `
  const sky = c.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, "#f6b26b"); sky.addColorStop(0.45, "#e9778f"); sky.addColorStop(1, "#5b3a7a");
  c.fillStyle = sky; c.fillRect(0, 0, w, h);
  c.fillStyle = "#fff1c9"; c.beginPath(); c.arc(w * 0.72, h * 0.3, w * 0.11, 0, Math.PI * 2); c.fill();
  const hill = (cx, cy, rx, ry, colour) => { c.fillStyle = colour; c.beginPath(); c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); c.fill(); };
  hill(w * 0.2, h * 1.02, w * 0.62, h * 0.42, "#3f7f5c"); hill(w * 0.85, h * 1.08, w * 0.6, h * 0.46, "#2c6048"); hill(w * 0.5, h * 1.25, w * 0.8, h * 0.42, "#1d4a3a");
  c.fillStyle = "#2b2140"; c.beginPath(); c.arc(w * 0.36, h * 0.6, w * 0.055, 0, Math.PI * 2); c.fill();
  c.beginPath(); c.moveTo(w * 0.27, h * 0.95); c.quadraticCurveTo(w * 0.28, h * 0.66, w * 0.36, h * 0.66); c.quadraticCurveTo(w * 0.44, h * 0.66, w * 0.45, h * 0.95); c.closePath(); c.fill();
  c.fillStyle = "#ffffff"; for (const [x, y] of [[0.12, 0.16], [0.3, 0.1], [0.52, 0.2], [0.88, 0.12]]) c.fillRect(w * x, h * y, 3, 3);
`;
const frame = (letter, from, to, shape) => `
  const fill = c.createLinearGradient(0, 0, w, h); fill.addColorStop(0, "${from}"); fill.addColorStop(1, "${to}");
  c.fillStyle = fill; c.fillRect(0, 0, w, h);
  c.fillStyle = "rgba(255,255,255,0.16)"; ${shape}
  c.fillStyle = "#ffffff"; c.font = "700 150px Arial, Helvetica, sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("${letter}", w / 2, h / 2 + 8);
`;
const files = [
  ["sample.png", sample, 320, 320],
  ["transition-a.png", frame("A", "#4c7fd9", "#2f5bb5", "for (let i = 0; i < 6; i++) c.fillRect(i * 96 - 20, 0, 40, h);"), 480, 320],
  ["transition-b.png", frame("B", "#e58a5a", "#c9603a", "for (let i = 0; i < 4; i++) c.fillRect(0, i * 96 - 10, w, 36);"), 480, 320],
];
for (const [name, script, width, height] of files) { writeFileSync(join(out, name), Buffer.from(await draw(script, width, height))); console.log(name, `${width}×${height}`); }
await browser.close();
