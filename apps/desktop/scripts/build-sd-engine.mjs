#!/usr/bin/env node
// Builds the local image engine (stable-diffusion.cpp `sd-cli`) that the macOS app ships: Metal, for macOS 14 and later.
// The project's published macOS build is made for macOS 26 and does not start on earlier systems.
// Output: .dev/build/sd-engine/<release>/sd-cli. Needs git, cmake and the Xcode command-line tools (build machine only).
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SD_RELEASE = "master-975-95b3090";
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const sdEngineBinary = (release = SD_RELEASE) => join(repo, ".dev/build/sd-engine", release, "sd-cli");

export function buildSdEngine(release = SD_RELEASE) {
  const out = sdEngineBinary(release);
  if (existsSync(out)) return out;
  if (process.platform !== "darwin") throw new Error("The bundled engine is built for macOS only.");
  const src = join(repo, ".dev/build/sd-engine/src", release);
  if (!existsSync(src)) {
    mkdirSync(dirname(src), { recursive: true });
    execFileSync("git", ["clone", "--depth", "1", "--branch", release, "--recurse-submodules", "--shallow-submodules", "https://github.com/leejet/stable-diffusion.cpp", src], { stdio: "inherit" });
  }
  execFileSync("cmake", ["-B", join(src, "build"), "-S", src, "-DCMAKE_BUILD_TYPE=Release", "-DSD_METAL=ON", "-DCMAKE_OSX_DEPLOYMENT_TARGET=14.0", "-DCMAKE_OSX_ARCHITECTURES=arm64"], { stdio: "inherit" });
  execFileSync("cmake", ["--build", join(src, "build"), "--config", "Release", "--target", "sd-cli", "-j", "8"], { stdio: "inherit" });
  mkdirSync(dirname(out), { recursive: true });
  copyFileSync(join(src, "build", "bin", "sd-cli"), out);
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(buildSdEngine());
