// Builds the desktop package for this machine's platform.
//   node scripts/package.mjs --dir            an unpacked app for this platform and architecture (unsigned unless a local signing identity is supplied)
//   node scripts/package.mjs                  the release targets of electron-builder.config.cjs (needs the signing environment)
//   --skip-web                                reuse <repo>/.dev/build/web-desktop instead of exporting it again
//   --platform=win32|linux --arch=x64|arm64   a package for another platform, built on this machine (unsigned): the Node
//                                             runtime of that platform is downloaded (fetch-node.mjs)
//   --targets=nsis,zip | AppImage,deb,…       with --platform: the electron-builder targets (default: those of the config)
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url)), desktop = resolve(here, ".."), repo = resolve(desktop, "../..");
const local = process.argv.includes("--dir");
const option = (name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const platform = option("platform") ?? process.platform, arch = option("arch") ?? process.arch;
// A package for another platform or architecture than this machine's: one architecture per run, since the bundled Node is one binary.
const cross = platform !== process.platform || (option("arch") !== undefined && arch !== process.arch);
const localSigningIdentity = process.env.JAGENTCHILL_MAC_SIGNING_IDENTITY?.trim();
if (cross && !["win32", "linux"].includes(platform)) throw new Error("--platform is win32 or linux");
const node = (script, ...args) => execFileSync(process.execPath, [join(here, script), ...args], { stdio: "inherit" });
// JAGENTCHILL_WEB_DIR / JAGENTCHILL_STAGE_DIR: fresh folders for a run that must not touch the ones of an earlier build.
const web = process.env.JAGENTCHILL_WEB_DIR ? resolve(process.env.JAGENTCHILL_WEB_DIR) : join(repo, ".dev/build/web-desktop"), stage = process.env.JAGENTCHILL_STAGE_DIR ? resolve(process.env.JAGENTCHILL_STAGE_DIR) : join(repo, ".dev/build/desktop-stage");

node("build-main.mjs");
if (!process.argv.includes("--skip-web") || !existsSync(join(web, "index.html"))) node("build-web.mjs", web);
node("build-server.mjs", join(stage, "server"));
const bridgeStage = join(stage, "bin");
mkdirSync(bridgeStage, { recursive: true });
const goos = platform === "win32" ? "windows" : platform === "darwin" ? "darwin" : "linux";
// A normal macOS release build uses the config's universal target; --dir here is darwin/arm64.
const bridgeArch = !local && platform === "darwin" && !cross ? "universal" : arch;
const goarch = bridgeArch === "x64" ? "amd64" : bridgeArch === "arm64" ? "arm64" : null;
if (!goarch && bridgeArch !== "universal") throw new Error(`Unsupported Tailscale bridge architecture: ${bridgeArch}`);
const bridgeName = `jagentchill-tsnet-bridge${platform === "win32" ? ".exe" : ""}`;
const bridgeOutput = join(bridgeStage, bridgeName);
if (bridgeArch === "universal") {
  const arm = `${bridgeOutput}.arm64`, intel = `${bridgeOutput}.amd64`;
  node("../../../server/scripts/build-tsnet-bridge.mjs", `--goos=${goos}`, "--goarch=arm64", `--output=${arm}`);
  node("../../../server/scripts/build-tsnet-bridge.mjs", `--goos=${goos}`, "--goarch=amd64", `--output=${intel}`);
  execFileSync("lipo", ["-create", arm, intel, "-output", bridgeOutput], { stdio: "inherit" });
  rmSync(arm); rmSync(intel);
} else {
  node("../../../server/scripts/build-tsnet-bridge.mjs", `--goos=${goos}`, `--goarch=${goarch}`, `--output=${bridgeOutput}`);
}
if (platform !== "win32") chmodSync(bridgeOutput, 0o755);
execFileSync(bridgeOutput, ["--help"], { stdio: "ignore" });
if (platform === "darwin") execFileSync("codesign", ["--force", "-s", "-", bridgeOutput], { stdio: "inherit" });
const runtimeDir = join(repo, ".dev/build/desktop-runtime", cross ? `${platform}-${arch}` : `${process.platform}-${local ? process.arch : process.platform === "darwin" ? "universal" : process.arch}`);
if (local && !cross && !existsSync(join(runtimeDir, "node"))) node("fetch-node.mjs", "--from-local");
if (cross && !existsSync(join(runtimeDir, "node", platform === "win32" ? "node.exe" : "bin/node"))) node("fetch-node.mjs", "--platform", platform, "--arch", arch);
if (!existsSync(join(runtimeDir, "node"))) throw new Error(`no Node runtime at ${runtimeDir}/node — run scripts/fetch-node.mjs`);
// macOS: a stripped copy of the Node binary (−24 MB). strip invalidates the signature, so it is signed ad hoc again; the release signing replaces that.
let runtimeUsed = runtimeDir;
if (process.platform === "darwin" && !cross) {
  runtimeUsed = `${runtimeDir}-slim`;
  if (!existsSync(join(runtimeUsed, "node"))) {
    mkdirSync(runtimeUsed, { recursive: true });
    cpSync(join(runtimeDir, "node"), join(runtimeUsed, "node"), { recursive: true });
    const binary = join(runtimeUsed, "node/bin/node");
    execFileSync("strip", ["-x", binary], { stdio: "ignore" });
    execFileSync("codesign", ["--force", "-s", "-", binary], { stdio: "ignore" });
    execFileSync(binary, ["-e", "require('node:sqlite')"]);
  }
}
// Release pipeline input: .dev/build/desktop-runtime/<platform-arch>/ffmpeg/{ffmpeg,ffprobe}[.exe].
// No download is attempted here. JAGENTCHILL_FFMPEG_DIR can point at that same two-file directory.
const ffmpegSource = process.env.JAGENTCHILL_FFMPEG_DIR ? resolve(process.env.JAGENTCHILL_FFMPEG_DIR) : join(runtimeDir, "ffmpeg");
const ffmpegStage = join(runtimeUsed, "ffmpeg");
mkdirSync(ffmpegStage, { recursive: true });
const binarySuffix = platform === "win32" ? ".exe" : "";
let mediaToolsStaged = true;
for (const binary of [`ffmpeg${binarySuffix}`, `ffprobe${binarySuffix}`]) {
  const source = join(ffmpegSource, binary);
  if (!existsSync(source)) { mediaToolsStaged = false; continue; }
  const destination = join(ffmpegStage, binary);
  if (resolve(source) !== resolve(destination)) cpSync(source, destination);
  if (platform !== "win32") chmodSync(destination, 0o755);
}
if (!mediaToolsStaged) console.warn(`Media tools absent: expected ffmpeg and ffprobe in ${ffmpegSource}; no download was attempted. This machine's PATH ffmpeg: ${process.env.PATH?.split(delimiter).map((dir) => join(dir, "ffmpeg")).find(existsSync) ?? "not found"}; ffprobe: ${process.env.PATH?.split(delimiter).map((dir) => join(dir, "ffprobe")).find(existsSync) ?? "not found"}.`);
mkdirSync(join(runtimeUsed, "helpers"), { recursive: true });
// The local image engine (stable-diffusion.cpp) for macOS 14+: built once on this machine (scripts/build-sd-engine.mjs)
// because the published macOS build needs macOS 26. Other systems download the engine when a model is downloaded.
const sdStage = join(runtimeUsed, "sd-engine");
rmSync(sdStage, { recursive: true, force: true });
if (platform === "darwin") {
  const { buildSdEngine } = await import("./build-sd-engine.mjs");
  mkdirSync(sdStage, { recursive: true });
  cpSync(buildSdEngine(), join(sdStage, "sd-cli"));
  chmodSync(join(sdStage, "sd-cli"), 0o755);
  execFileSync("codesign", ["--force", "-s", "-", join(sdStage, "sd-cli")], { stdio: "ignore" });
  // The text engine (llama.cpp) next to it: the host reads with it whether a chat message asks for a picture.
  const { buildLlmEngine } = await import("./build-llm-engine.mjs");
  cpSync(buildLlmEngine(), join(sdStage, "llama-completion"));
  chmodSync(join(sdStage, "llama-completion"), 0o755);
  execFileSync("codesign", ["--force", "-s", "-", join(sdStage, "llama-completion")], { stdio: "ignore" });
}

// What goes into app.asar: the two bundles and the web export. No node_modules.
const app = join(stage, "app");
rmSync(app, { recursive: true, force: true });
mkdirSync(join(app, "build"), { recursive: true });
const manifest = JSON.parse(readFileSync(join(desktop, "package.json"), "utf8"));
writeFileSync(join(app, "package.json"), JSON.stringify({ name: "jagentchill", productName: "JAgentChill", version: process.env.JAGENTCHILL_VERSION ?? manifest.version, description: manifest.description, main: "dist/entry.cjs", author: "JAgentChill", ...(process.env.JAGENTCHILL_HOMEPAGE ? { homepage: process.env.JAGENTCHILL_HOMEPAGE } : {}) }, null, 2));
cpSync(join(desktop, "dist"), join(app, "dist"), { recursive: true, filter: (file) => !file.endsWith(".map") });
cpSync(web, join(app, "web"), { recursive: true });
cpSync(join(desktop, "build/drag.png"), join(app, "build/drag.png"));
for (const name of readdirSync(join(desktop, "build")).filter((file) => /^tray-.*\.png$/.test(file))) cpSync(join(desktop, "build", name), join(app, "build", name));

const electronVersion = JSON.parse(readFileSync(join(desktop, "node_modules/electron/package.json"), "utf8")).version;
const args = ["--config", join(desktop, "electron-builder.config.cjs"), `-c.electronVersion=${electronVersion}`, "--publish", "never"];
if (cross) args.push(platform === "win32" ? "--win" : "--linux", ...(local ? ["dir"] : (option("targets") ?? "").split(",").filter(Boolean)), `--${arch}`);
else if (local) args.push("--dir", `--${process.arch}`, `-c.mac.identity=${localSigningIdentity || "null"}`, "-c.mac.notarize=false");
const result = spawnSync(join(desktop, "node_modules/.bin/electron-builder"), args, { cwd: desktop, stdio: "inherit", env: { ...process.env, JAGENTCHILL_RUNTIME_DIR: runtimeUsed, ...(cross ? { JAGENTCHILL_BUILD_ARCH: arch, CSC_IDENTITY_AUTO_DISCOVERY: "false" } : local ? { JAGENTCHILL_BUILD_ARCH: process.arch, CSC_IDENTITY_AUTO_DISCOVERY: "false" } : {}) } });
process.exit(result.status ?? 1);
