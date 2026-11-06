// Fetches the bundled fonts of `text-and-titles/catalog.md` section 1 from their upstream repositories into
// packages/render/assets/fonts/, with each project's licence text, and writes fonts.manifest.json (family, weight, style,
// load, licence, source URL, SHA-256, bytes). Deterministic for unchanged upstream files.
// Usage: node scripts/fetch-fonts.mjs [--check]   (--check verifies the files on disk against the manifest, no network)
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const out = join(new URL("..", import.meta.url).pathname, "packages/render/assets/fonts");
const raw = (repo, path) => `https://raw.githubusercontent.com/${repo}/${path}`;
const four = [["Regular", 400, "normal"], ["Italic", 400, "italic"], ["Bold", 700, "normal"], ["BoldItalic", 700, "italic"]];
const two = [["Regular", 400, "normal"], ["Bold", 700, "normal"]];
const noto = (name) => (style) => [`notofonts/notofonts.github.io/main/fonts/${name}/hinted/ttf/${name}-${style}.ttf`, `notofonts/notofonts.github.io/main/fonts/${name}/unhinted/ttf/${name}-${style}.ttf`, `notofonts/notofonts.github.io/main/fonts/${name}/full/ttf/${name}-${style}.ttf`].map((path) => raw(...split(path)));
const split = (path) => { const parts = path.split("/"); return [parts.slice(0, 2).join("/"), parts.slice(2).join("/")]; };
const NOTO_LICENCE = raw("notofonts/notofonts.github.io", "main/fonts/LICENSE");

/** family, the names it resolves, styles, load mode, licence id, licence text URL, copyright line, per-style source URLs. */
const FAMILIES = [
  { family: "Arimo", resolves: ["Arial", "Helvetica"], styles: four, load: "engine", licence: "OFL-1.1", licenceUrl: raw("googlefonts/Arimo", "main/OFL.txt"), home: "https://github.com/googlefonts/Arimo", url: (style) => [raw("googlefonts/Arimo", `main/fonts/ttf/Arimo-${style}.ttf`)] },
  { family: "Tinos", resolves: ["Times New Roman"], styles: four, load: "engine", licence: "OFL-1.1", licenceUrl: raw("googlefonts/tinos", "main/OFL.txt"), home: "https://github.com/googlefonts/tinos", url: (style) => [raw("googlefonts/tinos", `main/fonts/ttf/Tinos-${style}.ttf`)] },
  { family: "Cousine", resolves: ["Courier New"], styles: four, load: "engine", licence: "OFL-1.1", licenceUrl: raw("googlefonts/cousine", "main/OFL.txt"), home: "https://github.com/googlefonts/cousine", url: (style) => [raw("googlefonts/cousine", `main/fonts/ttf/Cousine-${style}.ttf`)] },
  { family: "Gelasio", resolves: ["Georgia"], styles: four, load: "engine", licence: "OFL-1.1", licenceUrl: raw("SorkinType/Gelasio", "master/OFL.txt"), home: "https://github.com/SorkinType/Gelasio", url: (style) => [raw("SorkinType/Gelasio", `master/fonts/ttf/Gelasio-${style}.ttf`)] },
  { family: "DejaVu Sans", file: "DejaVuSans", resolves: ["Verdana"], styles: [["", 400, "normal"], ["Oblique", 400, "italic"], ["Bold", 700, "normal"], ["BoldOblique", 700, "italic"]], load: "engine", licence: "Bitstream-Vera", licenceUrl: raw("dejavu-fonts/dejavu-fonts", "master/LICENSE"), home: "https://github.com/dejavu-fonts/dejavu-fonts", archive: "https://github.com/dejavu-fonts/dejavu-fonts/releases/download/version_2_37/dejavu-fonts-ttf-2.37.tar.bz2", archivePath: (style) => `dejavu-fonts-ttf-2.37/ttf/DejaVuSans${style ? `-${style}` : ""}.ttf` },
  { family: "Noto Sans", file: "NotoSans", resolves: ["sans-serif"], fallback: 1, styles: four, load: "engine", url: noto("NotoSans") },
  { family: "Noto Serif", file: "NotoSerif", resolves: ["serif"], styles: four, load: "engine", url: noto("NotoSerif") },
  { family: "Noto Sans Mono", file: "NotoSansMono", resolves: ["monospace"], styles: two, load: "engine", url: noto("NotoSansMono") },
  ...[["JP", 2], ["SC", 3], ["KR", 4]].map(([region, fallback]) => ({ family: `Noto Sans ${region}`, file: `NotoSans${region}`, extension: "otf", fallback, styles: two, load: "on-demand", licenceUrl: raw("notofonts/noto-cjk", "main/Sans/LICENSE"), home: "https://github.com/notofonts/noto-cjk", url: (style) => [raw("notofonts/noto-cjk", `main/Sans/SubsetOTF/${region}/NotoSans${region}-${style}.otf`)] })),
  { family: "Noto Naskh Arabic", file: "NotoNaskhArabic", fallback: 5, styles: two, load: "on-demand", url: noto("NotoNaskhArabic") },
  { family: "Noto Sans Hebrew", file: "NotoSansHebrew", fallback: 6, styles: two, load: "on-demand", url: noto("NotoSansHebrew") },
  { family: "Noto Sans Thai", file: "NotoSansThai", fallback: 7, styles: two, load: "on-demand", url: noto("NotoSansThai") },
  { family: "Noto Sans Devanagari", file: "NotoSansDevanagari", fallback: 8, styles: two, load: "on-demand", url: noto("NotoSansDevanagari") },
  // The colour font (COLR/CPAL) of the pinned release v2.047; the 512 px bitmap set of decision E5 is not part of this fetch.
  { family: "Noto Color Emoji", file: "NotoColorEmoji", fallback: 9, styles: [["Regular", 400, "normal"]], load: "on-demand", licenceUrl: raw("googlefonts/noto-emoji", "v2.047/fonts/LICENSE"), home: "https://github.com/googlefonts/noto-emoji", url: () => [raw("googlefonts/noto-emoji", "v2.047/fonts/Noto-COLRv1.ttf")] },
];

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
if (process.argv.includes("--check")) {
  const manifest = JSON.parse(readFileSync(join(out, "fonts.manifest.json"), "utf8"));
  const listed = new Set(manifest.fonts.map((font) => font.file));
  const problems = [
    ...manifest.fonts.filter((font) => !existsSync(join(out, font.file)) || sha256(readFileSync(join(out, font.file))) !== font.sha256).map((font) => `${font.file}: missing or changed`),
    ...readdirSync(out).filter((name) => /\.(ttf|otf)$/.test(name) && !listed.has(name)).map((name) => `${name}: not in the manifest`),
    ...manifest.fonts.filter((font) => !font.licence || !font.sourceUrl || !existsSync(join(out, font.licenceFile))).map((font) => `${font.file}: no licence or source`),
  ];
  console.log(problems.length ? problems.join("\n") : `${manifest.fonts.length} font files match the manifest`);
  process.exit(problems.length ? 1 : 0);
}

mkdirSync(out, { recursive: true });
const get = async (url) => { const response = await fetch(url); if (!response.ok) throw new Error(`${response.status} ${url}`); return new Uint8Array(await response.arrayBuffer()); };
const first = async (urls) => { let last; for (const url of urls) { try { return { url, bytes: await get(url) }; } catch (error) { last = error; } } throw last; };
const fonts = [], missing = [];
for (const entry of FAMILIES) {
  const base = entry.file ?? entry.family.replace(/ /g, ""), extension = entry.extension ?? "ttf";
  const licenceFile = `LICENSE-${base}.txt`;
  let copyright = "";
  try {
    const licenceText = await get(entry.licenceUrl ?? NOTO_LICENCE);
    writeFileSync(join(out, licenceFile), licenceText);
    // The copyright line is the one the project's own licence file states; a licence file without one leaves it to the font's name table.
    copyright = new TextDecoder().decode(licenceText).split("\n").map((line) => line.trim()).find((line) => /^(Copyright|Fonts are \(c\))/i.test(line)) ?? "";
  } catch (error) { missing.push(`${entry.family}: licence text (${error.message})`); continue; }
  let archive = null;
  if (entry.archive) {
    archive = mkdtempSync(join(tmpdir(), "jc-fonts-"));
    writeFileSync(join(archive, "a.tar.bz2"), await get(entry.archive));
    execFileSync("tar", ["-xjf", join(archive, "a.tar.bz2"), "-C", archive]);
  }
  for (const [style, weight, slant] of entry.styles) {
    const file = `${base}${style ? `-${style}` : "-Regular"}.${extension}`.replace("-Regular-Regular", "-Regular");
    try {
      const got = archive ? { url: `${entry.archive}#${entry.archivePath(style)}`, bytes: readFileSync(join(archive, entry.archivePath(style))) } : await first(entry.url(style));
      // A font file starts with the TrueType, OpenType or collection tag.
      const tag = String.fromCharCode(...got.bytes.subarray(0, 4));
      if (!["\u0000\u0001\u0000\u0000", "OTTO", "true", "ttcf"].includes(tag)) throw new Error("not a font file");
      writeFileSync(join(out, file), got.bytes);
      fonts.push({ fontId: `${base.toLowerCase()}-${weight}${slant === "italic" ? "i" : ""}`, family: entry.family, file, weight, style: slant, load: entry.load, ...(entry.resolves ? { resolves: entry.resolves } : {}), ...(entry.fallback ? { fallback: entry.fallback } : {}), licence: entry.licence ?? "OFL-1.1", licenceFile, copyright, home: entry.home ?? "https://github.com/notofonts/notofonts.github.io", sourceUrl: got.url, sha256: sha256(got.bytes), bytes: got.bytes.length });
      console.log(file, got.bytes.length);
    } catch (error) { missing.push(`${entry.family} ${style || "Regular"}: ${error.message}`); }
  }
}
writeFileSync(join(out, "fonts.manifest.json"), `${JSON.stringify({ version: 1, fonts }, null, 1)}\n`);
console.log(`${fonts.length} files, ${(fonts.reduce((sum, font) => sum + font.bytes, 0) / 1e6).toFixed(1)} MB`);
if (missing.length) { console.log(`MISSING:\n${missing.join("\n")}`); process.exit(1); }
