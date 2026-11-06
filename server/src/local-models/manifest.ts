import type { LocalModelQuant, LocalModelVariant } from "@jagentchill/protocol";

/**
 * What the local picture model is made of, pinned: every file by its address at a fixed commit, its size and its
 * SHA-256 (read from the Hugging Face and GitHub APIs on 2026-10-19 — the LFS object id of a Hugging Face file is the
 * SHA-256 of its bytes; a GitHub release asset carries its own `sha256:` digest). Nothing here is downloaded until a
 * person presses Download; a file whose hash does not match is not kept.
 *
 * The engine is stable-diffusion.cpp (one native program per platform): its source supports this model
 * (`src/model/diffusion/qwen_image_2_1.hpp`, `docs/qwen_image_2.1.md`, release master-975-95b3090).
 */
export type LocalFile = {
  /** Unique across the manifest: two variants that need the same file share it on disk. */
  id: string; label: string; url: string; bytes: number; sha256: string;
  /** Where it is kept, relative to the models folder. */
  path: string;
  role: "diffusion" | "llm" | "vae" | "engine";
  /** An archive is unpacked into `unpackTo` (relative to the models folder) once it is verified. */
  unpackTo?: string;
};
export type EngineBuild = { key: string; label: string; files: LocalFile[] };
export type LocalManifest = {
  engine: { name: string; version: string; sourceUrl: string; builds: Record<string, EngineBuild> };
  license: { name: string; url: string };
  variants: Record<LocalModelVariant, { label: string; description: string; quants: Record<LocalModelQuant, LocalFile>;
    /** A LoRA the variant is run with (the uncensored build's own add-on): fetched by itself when it is missing, applied to every picture. */
    lora?: { url: string; bytes: number; sha256: string; path: string; name: string; weight: number };
    /** A text encoder the variant reads its prompts with instead of the shared one, fetched by itself once the variant is installed. */
    encoder?: { label: string; url: string; bytes: number; sha256: string; path: string } }>;
  shared: LocalFile[];
};

const hf = (repo: string, commit: string, path: string) => `https://huggingface.co/${repo}/resolve/${commit}/${path}`;
const RELEASE = "master-975-95b3090";
const gh = (asset: string) => `https://github.com/leejet/stable-diffusion.cpp/releases/download/${RELEASE}/${asset}`;
const STANDARD = { repo: "leejet/Qwen-Image-2.1-GGUF", commit: "cc11433936a06e9765f7c0c0b1f0436cfd2b9856" };
const UNCENSORED = { repo: "abenzerps/Qwen-Image-2.1-Uncensored-Quantized", commit: "7959e658915f52274897fb573ffeda49de8dc16b" };
const diffusion = (variant: LocalModelVariant, quant: LocalModelQuant, source: { repo: string; commit: string }, file: string, bytes: number, sha256: string, label: string): LocalFile =>
  ({ id: `${variant}-${quant}`, label: `Picture model (${label})`, url: hf(source.repo, source.commit, file), bytes, sha256, path: `qwen-image-2.1/${variant}/${file}`, role: "diffusion" });
const engine = (key: string, asset: string, bytes: number, sha256: string, label = "Engine"): LocalFile =>
  ({ id: `engine-${key}-${asset}`, label, url: gh(asset), bytes, sha256, path: `engine/${RELEASE}/${key}/${asset}`, role: "engine", unpackTo: `engine/${RELEASE}/${key}/bin` });

export const QWEN_IMAGE_MANIFEST: LocalManifest = {
  engine: {
    name: "stable-diffusion.cpp", version: RELEASE, sourceUrl: "https://github.com/leejet/stable-diffusion.cpp",
    builds: {
      // One universal (arm64 + x86_64) build for macOS: Metal on Apple Silicon, the processor on an Intel Mac.
      "darwin": { key: "darwin", label: "macOS (Metal)", files: [engine("darwin", "sd-master-95b3090-bin-Darwin-macOS-26.6.2-arm64.zip", 36_488_395, "2edf5a21c4b73f448c3a02c87925283b77aa94f1859c0d8e649134da68b40813")] },
      // The project publishes no Linux CUDA build: an NVIDIA card is used through Vulkan (part of the NVIDIA driver).
      "linux-x64-vulkan": { key: "linux-x64-vulkan", label: "Linux x86-64 (Vulkan, NVIDIA)", files: [engine("linux-x64-vulkan", "sd-master-95b3090-bin-Linux-Ubuntu-24.04-x86_64-vulkan.zip", 36_612_523, "703f547a0bbe254979940ec6142a87b4af6acbc01d34e37358f4feabb430a225")] },
      "linux-x64-cpu": { key: "linux-x64-cpu", label: "Linux x86-64 (processor)", files: [engine("linux-x64-cpu", "sd-master-95b3090-bin-Linux-Ubuntu-24.04-x86_64.zip", 26_289_165, "23757b2d46edd68ec59ad252e6e3d6c1854ab01d6be5d47a06e0bc751c2eee2a")] },
      "win32-x64-cuda": { key: "win32-x64-cuda", label: "Windows x64 (CUDA 12)", files: [
        engine("win32-x64-cuda", "sd-master-95b3090-bin-win-cuda12-x64.zip", 343_630_973, "b935f5902fbedefe6db0b68c8930ae3e7c0f3cc778bd5d501a3c7f7ee7336338"),
        engine("win32-x64-cuda", "cudart-sd-bin-win-cu12-x64.zip", 563_452_046, "fe20366827d357c00797eebb58244dddab7fd9a348d70090c3871004c320f38d", "CUDA runtime"),
      ] },
      "win32-x64-cpu": { key: "win32-x64-cpu", label: "Windows x64 (processor)", files: [engine("win32-x64-cpu", "sd-master-95b3090-bin-win-cpu-x64.zip", 17_706_677, "945ed74a22a5c6abbae480201312e439f16ad029166dd94e58cef9a2ecb2dba8")] },
    },
  },
  license: { name: "Qwen Research License (non-commercial)", url: "https://huggingface.co/Qwen/Qwen-Image-2.1/blob/main/LICENSE" },
  variants: {
    standard: {
      label: "Standard", description: "Qwen-Image-2.1 as Qwen released it.",
      quants: {
        q4: diffusion("standard", "q4", STANDARD, "qwen_image_2.1-Q4_K.gguf", 4_197_494_816, "29f9c83c249ff0292fb2943fceddfa2319b446601866c82a4f8be062abea72c2", "Q4_K"),
        q5: diffusion("standard", "q5", STANDARD, "qwen_image_2.1-Q5_0.gguf", 5_069_910_048, "8dfeb1ee091a5d7c7d8191f69723254f031de8fe67ec219a21bf7df57590ab43", "Q5_0"),
        q6: diffusion("standard", "q6", STANDARD, "qwen_image_2.1-Q6_K.gguf", 5_996_851_232, "1c51d1a8e6cf2b215719dea0c4f0f4cbfff9214a1c7571e57913f57d6a9c3c12", "Q6_K"),
        q8: diffusion("standard", "q8", STANDARD, "qwen_image_2.1-Q8_0.gguf", 7_687_155_744, "f8b244b00937f0e444a40dbf7866460871b89b30142594973b6012d1b471dc0a", "Q8_0"),
      },
    },
    uncensored: {
      label: "Uncensored", description: "A community build of Qwen-Image-2.1 without content refusals.",
      // The build's base weights are Qwen's own; what it was taught beyond them is this LoRA of the same repository (rank 16,
      // attention layers; checked 2026-10-20: the engine applies all 256 tensors).
      // Qwen-Image reads a prompt through Qwen3-VL-8B-Instruct, a model taught to steer away from some content; the
      // uncensored build reads it through the same model with that steering removed ("abliterated", the same size).
      encoder: { label: "Uncensored text encoder", url: hf("mradermacher/Qwen3-VL-8B-Instruct-abliterated-GGUF", "292ee2bd5d0f1c49e1fb82b0fbd98cb3dbfb6269", "Qwen3-VL-8B-Instruct-abliterated.Q4_K_M.gguf"), bytes: 5_027_785_792, sha256: "713d7cfeb8e1eccb3c92838c26d3fc5c99d238ce161caa3b3d5e3133ec491f42", path: "qwen-image-2.1/uncensored/Qwen3-VL-8B-Instruct-abliterated.Q4_K_M.gguf" },
      lora: { url: hf(UNCENSORED.repo, UNCENSORED.commit, "qwen-image-2.1-uncensored-lora.safetensors"), bytes: 33_586_704, sha256: "00ee2cb7f00a37b097640c1880ed0d17e368e30599f34bb348fee0e8c2cc4ca1", path: "qwen-image-2.1/uncensored/loras/uc.safetensors", name: "uc", weight: 1 },
      quants: {
        q4: diffusion("uncensored", "q4", UNCENSORED, "qwen-image-2.1-UC-Q4_K_M.gguf", 4_604_558_112, "e79c8a009f2ecbdb6c70fd663d9aea9ee304a0d91f347e4169a756b8ad141b41", "Q4_K_M"),
        q5: diffusion("uncensored", "q5", UNCENSORED, "qwen-image-2.1-UC-Q5_K_M.gguf", 5_221_284_640, "af0bf278cf16d204fb31c384dc82fd41dca82d976b15fe9305a60c726fd6f821", "Q5_K_M"),
        q6: diffusion("uncensored", "q6", UNCENSORED, "qwen-image-2.1-UC-Q6_K.gguf", 5_876_556_576, "e14bb312109333b3d73b92ad9b9ac8b29b51f2edca1e7b86d1af1981bf1c4ee3", "Q6_K"),
        q8: diffusion("uncensored", "q8", UNCENSORED, "qwen-image-2.1-UC-Q8_0.gguf", 7_591_557_920, "cde456c72ea3ecebfc1be783300e972711d875e0c5f1bed33d42b66b156affa8", "Q8_0"),
      },
    },
  },
  shared: [
    // The text encoder the engine's own guide names (Qwen3-VL-8B, GGUF): read once per prompt, then let go.
    { id: "llm-qwen3vl-8b-q4km", label: "Text encoder (Qwen3-VL-8B Q4_K_M)", url: hf("Qwen/Qwen3-VL-8B-Instruct-GGUF", "f982a07559d4a2f6c8744d840bf6fccab30eea96", "Qwen3VL-8B-Instruct-Q4_K_M.gguf"), bytes: 5_027_784_800, sha256: "67d1659bfe71b89d50b45a4ad1a9e5b997e5bb16ce5da66a6a6167abd569e9e2", path: "qwen-image-2.1/shared/Qwen3VL-8B-Instruct-Q4_K_M.gguf", role: "llm" },
    // The model's own VAE (the earlier Qwen-Image and Wan VAEs are not interchangeable with it — the engine's guide).
    { id: "vae-qwen-image-2.1", label: "Image decoder (VAE)", url: hf("Comfy-Org/Qwen-Image-2.1", "a8342359c61979b06a8dafb1a47991fe1f30e994", "vae/qwen_image_2.1_vae_bf16.safetensors"), bytes: 675_509_688, sha256: "bb21f7473051e1ac368515dd3f2e15cd44d7a11748ee8823e1ddca3e4876b7c9", path: "qwen-image-2.1/shared/qwen_image_2.1_vae_bf16.safetensors", role: "vae" },
  ],
};

export const QUANT_LABEL: Record<LocalModelQuant, string> = { q4: "4-bit", q5: "5-bit", q6: "6-bit", q8: "8-bit" };

/**
 * The engine build for this computer: macOS (one build for both kinds of Mac); Linux and Windows on x86-64 with an
 * NVIDIA card (Vulkan on Linux, CUDA on Windows) or without one (the processor). Undefined: no build exists for it.
 */
export function engineKey(platform: string, arch: string, nvidia: boolean): string | undefined {
  if (platform === "darwin" && (arch === "arm64" || arch === "x64")) return "darwin";
  if (platform === "linux" && arch === "x64") return nvidia ? "linux-x64-vulkan" : "linux-x64-cpu";
  if (platform === "win32" && arch === "x64") return nvidia ? "win32-x64-cuda" : "win32-x64-cpu";
  return undefined;
}

/** Every file one install needs: the engine of this computer, the picture model of the variant and quant, the text encoder and the VAE. */
export function filesOf(manifest: LocalManifest, variant: LocalModelVariant, quant: LocalModelQuant, build: string | undefined): LocalFile[] {
  return [...(build ? manifest.engine.builds[build]?.files ?? [] : []), manifest.variants[variant].quants[quant], ...manifest.shared];
}
