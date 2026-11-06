#!/usr/bin/env node
// Builds the local text engine (llama.cpp `llama-completion`) that the macOS app ships: Metal, for macOS 14 and later.
// The host reads with it whether a chat message asks for a picture, on the Qwen3-VL model the picture model already
// downloaded — so nothing is sent anywhere and no model refuses.
// Output: .dev/build/llm-engine/<release>/llama-completion. Needs git, cmake and the Xcode command-line tools (build machine only).
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const LLM_RELEASE = "b11757";
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const llmEngineBinary = (release = LLM_RELEASE) => join(repo, ".dev/build/llm-engine", release, "llama-completion");

export function buildLlmEngine(release = LLM_RELEASE) {
  const out = llmEngineBinary(release);
  if (existsSync(out)) return out;
  if (process.platform !== "darwin") throw new Error("The bundled engine is built for macOS only.");
  const src = join(repo, ".dev/build/llm-engine/src", release);
  if (!existsSync(src)) {
    mkdirSync(dirname(src), { recursive: true });
    execFileSync("git", ["clone", "--depth", "1", "--branch", release, "https://github.com/ggml-org/llama.cpp", src], { stdio: "inherit" });
  }
  // One file: the Metal shaders are embedded and the libraries linked in.
  execFileSync("cmake", ["-B", join(src, "build"), "-S", src, "-DCMAKE_BUILD_TYPE=Release", "-DGGML_METAL=ON", "-DGGML_METAL_EMBED_LIBRARY=ON", "-DBUILD_SHARED_LIBS=OFF", "-DLLAMA_CURL=OFF", "-DLLAMA_BUILD_SERVER=OFF", "-DLLAMA_BUILD_TESTS=OFF", "-DCMAKE_OSX_DEPLOYMENT_TARGET=14.0", "-DCMAKE_OSX_ARCHITECTURES=arm64"], { stdio: "inherit" });
  execFileSync("cmake", ["--build", join(src, "build"), "--config", "Release", "--target", "llama-completion", "-j", "8"], { stdio: "inherit" });
  mkdirSync(dirname(out), { recursive: true });
  copyFileSync(join(src, "build", "bin", "llama-completion"), out);
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(buildLlmEngine());
