import { z } from "zod";
import type { Scope } from "./roles.ts";

/**
 * Wire types of the models that run ON the host (`Settings ▸ Providers ▸ Generation ▸ Local models`): the
 * Qwen-Image-2.1 picture model, downloaded on demand with its engine, the host's hardware check before any download,
 * and the download itself (resumable, verified by hash). A model that is installed is the generation provider
 * `local-qwen-image` of the catalogue: free, one job at a time, nothing leaves the computer.
 */
export const LOCAL_IMAGE_PROVIDER_ID = "local-qwen-image";
export const LOCAL_MODEL_VARIANTS = ["standard", "uncensored"] as const;
export type LocalModelVariant = (typeof LOCAL_MODEL_VARIANTS)[number];
export const LOCAL_MODEL_QUANTS = ["q4", "q5", "q6", "q8"] as const;
export type LocalModelQuant = (typeof LOCAL_MODEL_QUANTS)[number];
/** The catalogue model id of each variant. */
export const LOCAL_MODEL_IDS: Record<LocalModelVariant, string> = { standard: "qwen-image-2.1", uncensored: "qwen-image-2.1-uncensored" };
/** The longest side of a picture the local model makes (its default size is the largest). */
export const LOCAL_PICTURE_SIDES = [512, 768, 1024] as const;

/**
 * What the host measured: memory, the graphics processor (Apple Silicon's unified memory, an NVIDIA card and its
 * memory as `nvidia-smi` reports it, or none), the processor and the free space where the models are kept.
 */
export type LocalHardware = {
  platform: string; arch: string; cpu: { model: string; cores: number };
  memory: { totalBytes: number; availableBytes: number };
  gpu: { kind: "apple"; name: string; unifiedBytes: number } | { kind: "nvidia"; name: string; vramBytes: number; vramFreeBytes: number; driver?: string } | { kind: "none" };
  disk: { path: string; freeBytes: number };
  checked_ms: number;
};
/** "well": runs on the graphics processor; "slow": runs with parts moved to main memory or on the processor; the rest cannot run. */
export const LOCAL_VERDICTS = ["well", "slow", "memory", "disk", "unsupported"] as const;
export type LocalVerdictKind = (typeof LOCAL_VERDICTS)[number];
export type LocalVerdict = {
  variant: LocalModelVariant; quant: LocalModelQuant; verdict: LocalVerdictKind;
  /** Why, in product words, with the numbers measured and required: an English sentence with `{name}` places the screen fills from `params` after translating it. */
  reasons: { text: string; params?: Record<string, string> }[];
  /** What this variant and quant needs: memory while it makes a 1024 px picture (all of it on Apple Silicon and on the processor; `vramBytes` on an NVIDIA card) and disk for its files. */
  needs: { memoryBytes: number; vramBytes?: number; diskBytes: number };
  /** Bytes of all its files, and the part of them that is not on this host yet (files another variant already has are shared). */
  downloadBytes: number; remainingBytes: number;
  recommended: boolean;
};
export const LOCAL_FILE_STATES = ["waiting", "downloading", "verifying", "done", "failed"] as const;
export const LOCAL_INSTALL_STATES = ["downloading", "paused", "verifying", "installed", "failed"] as const;
export type LocalInstallState = (typeof LOCAL_INSTALL_STATES)[number];
export type LocalInstall = {
  variant: LocalModelVariant; quant: LocalModelQuant; modelId: string; state: LocalInstallState;
  bytesDone: number; bytesTotal: number; /** Bytes a second over the last few seconds, while downloading. */ rateBps?: number;
  files: { id: string; label: string; bytes: number; doneBytes: number; state: (typeof LOCAL_FILE_STATES)[number] }[];
  error?: { code: "network" | "hash_mismatch" | "disk_full" | "http" | "extract" | "unsupported"; message: string };
  started_ms: number; updated_ms: number; installed_ms?: number; verified_ms?: number;
};
export type LocalModelsView = {
  /** Where the files live on the host. */
  folder: string;
  engine: { name: string; version: string; sourceUrl: string; /** The build this computer would download; null: there is none for it. */ build: { label: string; bytes: number } | null };
  license: { name: string; url: string };
  variants: { id: LocalModelVariant; label: string; description: string; modelId: string; quants: { id: LocalModelQuant; label: string; downloadBytes: number }[] }[];
  installs: LocalInstall[];
  hardware: LocalHardware | null; verdicts: LocalVerdict[];
  settings: { maxSide: (typeof LOCAL_PICTURE_SIDES)[number]; timeLimitMinutes: number };
  /** A picture is being made right now. */
  generating: boolean;
  /** Files an installed variant fetches by itself after it was installed (the uncensored build's own text encoder and LoRA). */
  addOns?: { variant: LocalModelVariant; label: string; state: "downloading" | "ready" | "failed"; bytesDone: number; bytesTotal: number; error?: string }[];
};

const variant = z.enum(LOCAL_MODEL_VARIANTS), quant = z.enum(LOCAL_MODEL_QUANTS);
export const localModelsRpcParams = {
  "jagentchill.localModels.get": z.object({}).strict(),
  "jagentchill.localModels.check": z.object({}).strict(),
  "jagentchill.localModels.download": z.object({ variant, quant }).strict(),
  "jagentchill.localModels.pause": z.object({ variant }).strict(),
  "jagentchill.localModels.resume": z.object({ variant }).strict(),
  "jagentchill.localModels.cancel": z.object({ variant }).strict(),
  "jagentchill.localModels.verify": z.object({ variant }).strict(),
  "jagentchill.localModels.remove": z.object({ variant }).strict(),
  "jagentchill.localModels.settings.set": z.object({ maxSide: z.union([z.literal(512), z.literal(768), z.literal(1024)]).optional(), timeLimitMinutes: z.number().int().min(1).max(240).optional() }).strict(),
} as const;
const read: Scope = "jagentchill.config.read", write: Scope = "jagentchill.config.write";
export const LOCAL_MODELS_METHOD_SCOPES: Record<keyof typeof localModelsRpcParams, Scope> = {
  "jagentchill.localModels.get": read, "jagentchill.localModels.check": read, "jagentchill.localModels.download": write, "jagentchill.localModels.pause": write,
  "jagentchill.localModels.resume": write, "jagentchill.localModels.cancel": write, "jagentchill.localModels.verify": write, "jagentchill.localModels.remove": write,
  "jagentchill.localModels.settings.set": write,
};
/** The event every change of the local models goes out as (`payload.view`: the whole view, as `get` answers). */
export const LOCAL_MODELS_CHANGED = "jagentchill.localModels.changed";

/** The composer switch "make pictures on this computer": a session feature value; on, the session's pictures are made by the local image model. */
export const LOCAL_IMAGE_FEATURE = "local_image";
