// Finishes a web export (`expo export --platform web`): writes what the build knows about itself.
//   build.json     { version, buildId, builtAt_ms } — Settings ▸ About and Updates read it. The id is the hash of the
//                  build's files (no commit is involved); the version is the one of apps/desktop/package.json.
//   licences.json  the third-party packages the app is built from, with their licence — the "Open-source licences" list.
//   sw.js          the service worker with the list of files it keeps for offline use (browser builds only).
// Usage: node scripts/finish-web-export.mjs <export-dir> [--desktop | --no-worker]
//   --desktop: the Electron shell serves the export from its own scheme, so no service worker is shipped.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(process.argv[2] ?? "");
const desktop = process.argv.includes("--desktop");
// --no-worker: a browser build that is not kept for offline use (the offline shell is not shipped yet): no sw.js, and
// build.json says so, so the app registers nothing.
const noWorker = process.argv.includes("--no-worker");
if (!process.argv[2] || !existsSync(join(out, "index.html"))) { console.error(`finish-web-export: ${out} is not a web export (no index.html)`); process.exit(1); }

/** The one place the product's version is written. */
const version = JSON.parse(readFileSync(join(app, "../desktop/package.json"), "utf8")).version;

// ── licences ──
const listed = spawnSync("corepack", ["pnpm", "licenses", "list", "--prod", "--json"], { cwd: app, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, shell: process.platform === "win32" });
if (listed.status !== 0) { console.error(`finish-web-export: the dependency list could not be read\n${listed.stderr}`); process.exit(1); }
const packages = Object.values(JSON.parse(listed.stdout)).flat()
  .filter((entry) => !entry.name.startsWith("@jagentchill/"))
  .flatMap((entry) => entry.versions.map((number) => ({ name: entry.name, version: number, licence: entry.license, ...(entry.homepage ? { homepage: entry.homepage } : {}), ...(entry.author ? { author: entry.author } : {}) })))
  .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
writeFileSync(join(out, "licences.json"), JSON.stringify({ packages }));

// ── the files of the build ──
// The page carries the id of its build (written below, once the id is known): it is what the page tags the address of
// its workers and of their files with, so that the service worker answers them from this build and no other. A page
// finished before is brought back to what the export wrote, so that finishing twice gives the same id.
const PAGE = join(out, "index.html"), BUILD_META = /<meta name="jagentchill-build" content="[^"]*">/g;
writeFileSync(PAGE, readFileSync(PAGE, "utf8").replace(BUILD_META, ""));
const GENERATED = new Set(["build.json", "sw.js"]);
const walk = (dir) => readdirSync(dir).flatMap((name) => { const path = join(dir, name); return statSync(path).isDirectory() ? walk(path) : [path]; });
const files = walk(out).map((path) => relative(out, path).split(sep).join("/"))
  // Source maps and Expo's export record are not part of the running app.
  .filter((file) => !GENERATED.has(file) && !file.endsWith(".map") && file !== "metadata.json" && !file.split("/").some((part) => part.startsWith(".")))
  .sort();
const hash = createHash("sha256");
for (const file of files) hash.update(file).update("\0").update(createHash("sha256").update(readFileSync(join(out, file))).digest()).update("\0");
const buildId = hash.update(version).digest("hex").slice(0, 12);
const build = { version, buildId, builtAt_ms: Date.now(), ...(noWorker ? { offline: false } : {}) };
writeFileSync(join(out, "build.json"), JSON.stringify(build));
if (!desktop) {
  const page = readFileSync(PAGE, "utf8"), meta = `<meta name="jagentchill-build" content="${buildId}">`;
  if (!/<head[^>]*>/.test(page)) { console.error("finish-web-export: index.html has no <head>"); process.exit(1); }
  writeFileSync(PAGE, page.replace(/<head[^>]*>/, (head) => `${head}${meta}`));
}

// ── the service worker ──
const worker = join(out, "sw.js");
if (desktop || noWorker) { if (existsSync(worker)) rmSync(worker); }
else {
  const source = readFileSync(join(app, "public/sw.js"), "utf8");
  const marker = "/*@build*/null";
  if (!source.includes(marker)) { console.error("finish-web-export: public/sw.js has no build marker"); process.exit(1); }
  // The first path segment of every screen of the app (`app/` of expo-router; "" is the start page): the only paths the
  // worker answers with the app's page. Anything else on the origin is not the app's.
  const routes = readdirSync(join(app, "app")).map((name) => name.replace(/\.tsx?$/, "")).filter((name) => !/^[_+]/.test(name)).map((name) => (name === "index" ? "" : name)).sort();
  // `build.json` is one of the kept files: About reads it with the network off.
  writeFileSync(worker, source.replace(marker, JSON.stringify({ id: buildId, version, builtAt_ms: build.builtAt_ms, routes, files: [...files, "build.json"].map((file) => encodeURI(file)) })));
}
console.log(`finished ${out}: version ${version}, build ${buildId}, ${files.length} files, ${packages.length} licence entries${desktop || noWorker ? "" : ", service worker written"}`);
