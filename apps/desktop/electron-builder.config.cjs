// Packaging of the desktop app. Run through scripts/package.mjs, which stages what goes into the package first.
// Signing: nothing here holds a credential. macOS signing and notarisation use CSC_LINK / CSC_KEY_PASSWORD and
// APPLE_API_KEY / APPLE_API_KEY_ID / APPLE_API_ISSUER from the CI environment; Windows uses WIN_CSC_LINK /
// WIN_CSC_KEY_PASSWORD (or the signtool options of the CI's signing service). Without them the build is unsigned.
const path = require("node:path");
const repo = path.resolve(__dirname, "../..");
const stage = process.env.JAGENTCHILL_STAGE_DIR ? path.resolve(process.env.JAGENTCHILL_STAGE_DIR) : path.join(repo, ".dev/build/desktop-stage");
// scripts/package.mjs points JAGENTCHILL_RUNTIME_DIR at the slimmed copy of the runtime folder it made (macOS).
const runtime = (os, arch) => process.env.JAGENTCHILL_RUNTIME_DIR || path.join(repo, ".dev/build/desktop-runtime", `${os}-${arch}`);
const fileTypes = [
  { ext: "jagentchill", name: "JAgentChill Project", mimeType: "application/vnd.jagentchill.project+zip", role: "Editor", rank: "Owner" },
  { ext: "jctpl", name: "JAgentChill Template", mimeType: "application/vnd.jagentchill.template+zip", role: "Viewer", rank: "Alternate" },
  { ext: "jcpack", name: "JAgentChill Preset Pack", mimeType: "application/vnd.jagentchill.pack+zip", role: "Viewer", rank: "Alternate" },
  { ext: "jcworkflow", name: "JAgentChill Workflow", mimeType: "application/vnd.jagentchill.workflow+json", role: "Viewer", rank: "Alternate" },
  { ext: "jcscript", name: "JAgentChill Script", mimeType: "application/vnd.jagentchill.script+json", role: "Viewer", rank: "Alternate" },
  { ext: "jckeys", name: "JAgentChill Shortcuts", mimeType: "application/vnd.jagentchill.keys+json", role: "Viewer", rank: "Alternate" },
  { ext: "fountain", name: "Fountain Screenplay", mimeType: "text/vnd.fountain", role: "Viewer", rank: "Alternate" },
  // "Open with" only: never the default handler of a media type, and never of .json.
  { ext: ["mp4", "mov", "m4v", "webm", "mkv", "mp3", "wav", "m4a", "aac", "ogg", "flac", "png", "jpg", "jpeg", "webp", "gif", "srt", "vtt", "ass"], name: "Media", role: "Viewer", rank: "Alternate" },
];
const resources = (os) => (arch) => [
  { from: path.join(runtime(os, arch), "node"), to: "node" },
  { from: path.join(stage, "server"), to: "server" },
  { from: path.join(stage, "bin", `jagentchill-tsnet-bridge${os === "win32" ? ".exe" : ""}`), to: path.join("bin", `jagentchill-tsnet-bridge${os === "win32" ? ".exe" : ""}`) },
  // FFmpeg and FFprobe (LGPL builds) and the two helper executables are placed here by the release pipeline.
  ...["ffmpeg", "helpers"].map((name) => ({ from: path.join(runtime(os, arch), name), to: name })),
  // macOS only: the local image engine built for macOS 14+ (scripts/build-sd-engine.mjs).
  ...(os === "darwin" ? [{ from: path.join(runtime(os, arch), "sd-engine"), to: "sd-engine" }] : []),
  // THIRD_PARTY_NOTICES.md is added by the release pipeline once the notices file exists.
];
const arch = process.env.JAGENTCHILL_BUILD_ARCH || process.arch;

module.exports = {
  appId: "com.jagentchill.desktop",
  productName: "JAgentChill",
  copyright: "JAgentChill",
  directories: { app: path.join(stage, "app"), output: process.env.JAGENTCHILL_DESKTOP_OUT || path.join(repo, ".dev/build/desktop"), buildResources: path.join(__dirname, "build") },
  files: ["package.json", "dist/**", "web/**", "build/drag.png", "build/tray-*.png", "!**/node_modules/**"],
  asar: true,
  // The app ships the three languages of the product; Electron's other ~100 locale packs (~50 MB) are left out.
  electronLanguages: ["en", "vi", "ja"],
  compression: "maximum",
  // The packaged app is built from bundles: there is no node_modules tree to collect or rebuild.
  npmRebuild: false, nodeGypRebuild: false, buildDependenciesFromSource: false,
  protocols: [{ name: "JAgentChill", schemes: ["jagentchill"] }],
  fileAssociations: fileTypes,
  afterPack: path.join(__dirname, "scripts/after-pack.cjs"),
  publish: process.env.JAGENTCHILL_UPDATE_URL ? [{ provider: "generic", url: process.env.JAGENTCHILL_UPDATE_URL }] : null,
  mac: {
    category: "public.app-category.video", target: [{ target: "dmg", arch: ["universal"] }, { target: "zip", arch: ["universal"] }], minimumSystemVersion: "12.0",
    hardenedRuntime: true, gatekeeperAssess: false, entitlements: path.join(__dirname, "build/entitlements.mac.plist"), entitlementsInherit: path.join(__dirname, "build/entitlements.mac.plist"),
    extraResources: resources("darwin")(process.env.JAGENTCHILL_BUILD_ARCH || "universal"),
    // Every nested executable is signed with the app.
    binaries: ["Contents/Resources/bin/jagentchill-tsnet-bridge"], notarize: Boolean(process.env.APPLE_API_KEY),
    extendInfo: { NSMicrophoneUsageDescription: "JAgentChill records voiceovers.", NSCameraUsageDescription: "JAgentChill records from the camera.", LSMinimumSystemVersion: "12.0" },
  },
  dmg: { sign: false },
  // Cross-packages from macOS are intentionally unsigned; keeping electron-builder's
  // Windows signer enabled makes it try to sign its bundled elevate.exe helper.
  win: { target: [{ target: "nsis", arch: ["x64", "arm64"] }], extraResources: resources("win32")(arch), signAndEditExecutable: false },
  nsis: { oneClick: false, perMachine: false, allowElevation: false, deleteAppDataOnUninstall: false, differentialPackage: true },
  linux: {
    target: [{ target: "AppImage", arch: ["x64", "arm64"] }, { target: "deb", arch: ["x64", "arm64"] }, { target: "rpm", arch: ["x64", "arm64"] }],
    category: "AudioVideo", executableName: "jagentchill", mimeTypes: ["x-scheme-handler/jagentchill", ...fileTypes.filter((type) => type.mimeType).map((type) => type.mimeType)],
    extraResources: resources("linux")(arch),
    // deb and rpm refuse to build without a maintainer ("Name <email>") and a homepage (JAGENTCHILL_HOMEPAGE, read by
    // scripts/package.mjs). The project has published neither yet, so they come from the release environment.
    ...(process.env.JAGENTCHILL_MAINTAINER ? { maintainer: process.env.JAGENTCHILL_MAINTAINER } : {}),
  },
  // `depends` replaces electron-builder's own list, so the libraries Electron loads are named here with the glibc floor:
  // with libc6 alone the installed app stopped at "libnspr4.so: cannot open shared object file" on a minimal Debian 12.
  // The legacy AppImage runtime for arm64 links the unversioned `libz.so`, which only development packages install:
  // the arm64 AppImage stopped at "libz.so: cannot open shared object file" on a stock Debian 12. The newer runtime is static.
  toolsets: { appimage: "1.0.3" },
  deb: { depends: ["libc6 (>= 2.35)", "libgtk-3-0", "libnotify4", "libnss3", "libxss1", "libxtst6", "xdg-utils", "libatspi2.0-0", "libuuid1", "libsecret-1-0", "libgbm1", "libasound2"] },
};
