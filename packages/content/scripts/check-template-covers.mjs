// Checks the rendered covers of the bundled templates and lays them out as one sheet for the eye.
// Per cover: its size and ratio against the template, the share of near-black pixels (at most 60 % unless the template
// is dark by design) and the number of colour clusters (at least 3). Per preview: its duration against the template,
// 720 px on the long side, at most 12 MB. The numbers do not say a cover looks good — open the sheet.
// Usage: node packages/content/scripts/check-template-covers.mjs [sheet.jpg]
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { template } from "../../editor-core/src/index.ts";

const root = join(import.meta.dirname, "../../..");
const content = join(root, "packages/content/templates"), served = join(root, "apps/app/public/templates");
const sheet = process.argv[2] ?? join(root, ".dev/shots/w2-templates/covers.jpg");
/** Dark on purpose: the end screen is two windows on a dark ground. */
const DARK_BY_DESIGN = new Set(["outro-end-screen"]);
const TILE = 232, SIDE = 64;
const starters = template.bundledTemplates();
let failed = 0, bytes = 0;
const fail = (message) => { failed++; console.log("FAIL", message); };
for (const { manifest } of starters) {
  const id = manifest.id, cover = join(content, id, "cover.jpg"), preview = join(content, id, "preview.mp4");
  if (!existsSync(cover) || !existsSync(preview)) { fail(`${id}: cover or preview is missing — run render-template-covers.mjs`); continue; }
  for (const name of ["cover.jpg", "preview.mp4"]) if (!existsSync(join(served, id, name)) || !readFileSync(join(served, id, name)).equals(readFileSync(join(content, id, name)))) fail(`${id}: apps/app/public/templates/${id}/${name} is not the rendered file`);
  bytes += statSync(cover).size + statSync(preview).size;
  const probe = (file) => JSON.parse(execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", file]).toString());
  const picture = probe(cover).streams[0], film = probe(preview);
  const ratio = manifest.canvas.width / manifest.canvas.height;
  if (Math.abs(picture.width / picture.height - ratio) > 0.01 || Math.max(picture.width, picture.height) !== 720) fail(`${id}: cover is ${picture.width}×${picture.height}`);
  if (Math.abs(Number(film.format.duration) - manifest.duration / 120_000) > 0.25) fail(`${id}: preview lasts ${film.format.duration} s, the template ${manifest.duration / 120_000} s`);
  if (Math.max(film.streams[0].width, film.streams[0].height) !== 720 || statSync(preview).size > template.TEMPLATE_LIMITS.previewBytes) fail(`${id}: preview is ${film.streams[0].width}×${film.streams[0].height}, ${statSync(preview).size} bytes`);
  const pixels = execFileSync("ffmpeg", ["-loglevel", "error", "-i", cover, "-vf", `scale=${SIDE}:${SIDE}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
  let dark = 0;
  const bins = new Map();
  for (let at = 0; at < pixels.length; at += 3) {
    if (Math.max(pixels[at], pixels[at + 1], pixels[at + 2]) < 40) dark++;
    const bin = (pixels[at] >> 6) * 16 + (pixels[at + 1] >> 6) * 4 + (pixels[at + 2] >> 6);
    bins.set(bin, (bins.get(bin) ?? 0) + 1);
  }
  const total = pixels.length / 3, black = dark / total, clusters = [...bins.values()].filter((count) => count / total >= 0.02).length;
  console.log(`${id.padEnd(20)} cover ${picture.width}×${picture.height}  near-black ${(black * 100).toFixed(0).padStart(3)} %${DARK_BY_DESIGN.has(id) ? " (dark by design)" : ""}  clusters ${clusters}  preview ${Number(film.format.duration).toFixed(1)} s ${(statSync(preview).size / 1024).toFixed(0)} KB`);
  if (black > 0.6 && !DARK_BY_DESIGN.has(id)) fail(`${id}: ${(black * 100).toFixed(0)} % of the cover is near-black`);
  if (clusters < 3) fail(`${id}: ${clusters} colour clusters`);
}
if (failed === 0) {
  // The sheet: every cover at the size of a gallery card, six to a row, on the card's own light ground.
  const inputs = starters.flatMap(({ manifest }) => ["-i", join(content, manifest.id, "cover.jpg")]);
  const tiles = starters.map((_, index) => `[${index}]scale=${TILE - 12}:${TILE - 12}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${TILE}:${TILE}:(ow-iw)/2:(oh-ih)/2:color=0xf2f2f3[t${index}]`).join(";");
  const layout = starters.map((_, index) => `${(index % 6) * TILE}_${Math.floor(index / 6) * TILE}`).join("|");
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", ...inputs, "-filter_complex", `${tiles};${starters.map((_, index) => `[t${index}]`).join("")}xstack=inputs=${starters.length}:layout=${layout}`, "-frames:v", "1", "-q:v", "2", sheet]);
  console.log(`sheet: ${sheet}`);
}
console.log(`covers and previews: ${(bytes / 1024 / 1024).toFixed(2)} MB`);
console.log(failed === 0 ? "ALL PASSED" : `FAILED: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
