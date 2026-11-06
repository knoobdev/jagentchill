import { randomInt } from "node:crypto";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { LOCAL_IMAGE_PROVIDER_ID, LOCAL_MODEL_IDS, type GenerationCapability, type GenerationParams, type LocalModelVariant } from "@jagentchill/protocol";
import { ProviderFailure, type AdapterOutput, type JcProviderAdapter } from "../generation/adapter.ts";
import { STEPS, runEngine, sizeOf } from "./engine.ts";
import { hardLimitOf } from "./hard-limits.ts";

/** What the adapter needs of the local models service. */
export type LocalModelsPort = {
  installed(variant: LocalModelVariant): { quant: string; diffusion: string; llm: string; vae: string; engine: string | undefined } | undefined;
  settings(): { maxSide: number; timeLimitMinutes: number };
  /** Whether the models must be kept in main memory and moved to the graphics processor in turn (the hardware check's verdict for this install). */
  offload(variant: LocalModelVariant): boolean;
  /** Where a job writes its picture before it is read back. */
  workDir: string;
  /** A picture is being made (true) or not (false) any more. */
  busy(on: boolean): void;
  /** The LoRA the variant is run with, once it is on disk (fetched by itself when it is missing). */
  lora?(variant: LocalModelVariant): Promise<{ dir: string; name: string; weight: number } | undefined>;
  /** The variant's own text encoder, once it is on disk (the shared one is used until then). */
  encoder?(variant: LocalModelVariant): string | undefined;
};
export const variantOf = (modelId: string): LocalModelVariant | undefined => (Object.entries(LOCAL_MODEL_IDS) as [LocalModelVariant, string][]).find(([, id]) => id === modelId)?.[0];

/**
 * The generation provider "Local · Qwen-Image-2.1": pictures made on the host by the engine the person downloaded
 * (Settings ▸ Providers ▸ Generation ▸ Local models). No key, no network, no bill; one picture at a time (the service
 * holds it to one job, and so does this adapter). The two hard limits are checked before the engine starts.
 */
export function createLocalImageAdapter(port: LocalModelsPort): JcProviderAdapter {
  let running: Promise<unknown> = Promise.resolve();
  return {
    describe: () => ({
      id: LOCAL_IMAGE_PROVIDER_ID, label: "Local · Qwen-Image-2.1", description: "Pictures made on this computer by Qwen-Image-2.1. Free, and nothing leaves the computer.",
      source: "local", capabilities: ["image"], hosts: [], authFields: [], docsUrl: "https://huggingface.co/Qwen/Qwen-Image-2.1", local: true,
    }),
    ready: (modelId: string) => { const variant = variantOf(modelId); return !!variant && !!port.installed(variant)?.engine; },
    validateConnection: async () => ({ outcome: "ok", message: "The local model is installed." }),
    listModels: async () => [],
    sends: (capability: GenerationCapability) => (capability === "image" ? ["aspectRatio", "quality", "count", "seed"] : []),
    async submit(request, ctx) {
      const variant = variantOf(request.model), install = variant ? port.installed(variant) : undefined;
      if (!variant || !install?.engine) throw new ProviderFailure("model_unavailable", "This local model is not downloaded. Download it under Settings, Providers, Generation, Local models.");
      const params: GenerationParams = request.params, prompt = params.prompt ?? "";
      const limit = hardLimitOf({ prompt, references: request.references?.length ?? 0 });
      if (limit) throw new ProviderFailure("content_blocked", limit.message, { details: { stage: "input", rule: limit.rule, providerMessage: limit.message } });
      // One picture at a time on this host, whoever asks.
      const previous = running;
      let release!: () => void;
      running = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      port.busy(true);
      const lora = await port.lora?.(variant).catch(() => undefined);
      try {
        const settings = port.settings(), { width, height } = sizeOf(params.aspectRatio, settings.maxSide), count = params.count ?? 1, first = params.seed ?? randomInt(0, 2_147_483_647 - count);
        const outputs: AdapterOutput[] = [];
        for (let index = 0; index < count; index++) {
          if (ctx.signal.aborted) throw new ProviderFailure("cancelled", "Cancelled.");
          const seed = first + index, workDir = join(port.workDir, `local-${ctx.idempotencyKey}-${index}`);
          const bytes = await runEngine({
            program: install.engine, files: { diffusion: install.diffusion, llm: port.encoder?.(variant) ?? install.llm, vae: install.vae }, prompt, ...(params.negativePrompt ? { negativePrompt: params.negativePrompt } : {}),
            width, height, steps: STEPS[params.quality ?? "medium"], seed, offload: port.offload(variant), workDir, ...(lora ? { lora } : {}),
            timeoutMs: settings.timeLimitMinutes * 60_000, signal: ctx.signal, progress: (fraction) => ctx.progress((index + fraction) / count),
          }).finally(() => rmSync(workDir, { recursive: true, force: true }));
          outputs.push({ bytes, mime: "image/png", seed });
        }
        return { result: { outputs, costUsd: 0, units: { images: outputs.length } } };
      } finally { port.busy(false); release(); }
    },
  };
}
