// After electron-builder has laid out the app and before it signs it: the packaged parts are checked, and the fuses are set.
const fs = require("node:fs");
const path = require("node:path");
const { FuseV1Options, FuseVersion, flipFuses } = require("@electron/fuses");

exports.RELEASE_FUSES = {
  [FuseV1Options.RunAsNode]: false, [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false, [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.OnlyLoadAppFromAsar]: true, [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true, [FuseV1Options.EnableCookieEncryption]: true,
};
exports.executableOf = (appOutDir, context) => {
  const name = context.packager.appInfo.productFilename;
  if (context.electronPlatformName === "darwin") return path.join(appOutDir, `${name}.app`);
  return path.join(appOutDir, context.electronPlatformName === "win32" ? `${name}.exe` : context.packager.executableName ?? name.toLowerCase());
};
exports.default = async function afterPack(context) {
  const resources = context.electronPlatformName === "darwin" ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Resources") : path.join(context.appOutDir, "resources");
  const bridge = path.join(resources, "bin", `jagentchill-tsnet-bridge${context.electronPlatformName === "win32" ? ".exe" : ""}`);
  if (!fs.existsSync(bridge)) throw new Error(`Packaged Tailscale bridge is missing: ${bridge}`);
  if (context.electronPlatformName !== "win32" && !(fs.statSync(bridge).mode & 0o111)) throw new Error("Packaged Tailscale bridge lost its executable bit");
  const target = exports.executableOf(context.appOutDir, context);
  await flipFuses(target, { version: FuseVersion.V1, resetAdHocDarwinSignature: context.electronPlatformName === "darwin", ...exports.RELEASE_FUSES });
  console.log(`  • fuses set on ${path.basename(target)}`);
};
