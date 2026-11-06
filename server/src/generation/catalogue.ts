import type { GenerationCapability, GenerationEstimate, GenerationModel, GenerationParams, GenerationPricing } from "@jagentchill/protocol";

/** The date the bundled prices were taken (each row's `pricing.source` says from where: the provider's list, or real bills). */
export const PRICES_AS_OF = "2026-10-07";
/** Ruling R7: the two real origins of a bundled price. Taken from the provider's own list (and, for these rows, later found far from what was billed — the dialog says "about", and a run's 120 % guard is the net)… */
const LISTED = { kind: "provider-list", date: PRICES_AS_OF, note: "Read from the provider's list on that date; later found far from what real runs were billed." } as const;
/** …or measured on real bills of live runs on that date. */
const measured = (sample: string) => ({ kind: "measured", date: PRICES_AS_OF, sample }) as const;

type Bundled = Omit<GenerationModel, "enabled" | "source" | "updated_ms" | "pricesAsOf"> & {
  /** What was MEASURED on the real provider for this row (named in the comment beside it): the provider's own list does not replace these at a refresh; everything else of the row follows the list. */
  verified?: readonly (keyof GenerationModel["metadata"] | "pricing")[];
};
const OPENAI_VOICES = [
  ["alloy", "Alloy", "neutral"], ["ash", "Ash", "male"], ["ballad", "Ballad", "male"], ["coral", "Coral", "female"], ["echo", "Echo", "male"], ["sage", "Sage", "female"], ["shimmer", "Shimmer", "female"], ["verse", "Verse", "male"],
] as const;
/** The voices of Google's speech models, with the gender Google documents for each. */
const GEMINI_VOICES = [
  ["Kore", "female"], ["Leda", "female"], ["Aoede", "female"], ["Zephyr", "female"], ["Callirrhoe", "female"], ["Autonoe", "female"], ["Despina", "female"], ["Erinome", "female"], ["Laomedeia", "female"], ["Achernar", "female"],
  ["Gacrux", "female"], ["Pulcherrima", "female"], ["Vindemiatrix", "female"], ["Sulafat", "female"],
  ["Puck", "male"], ["Charon", "male"], ["Fenrir", "male"], ["Orus", "male"], ["Enceladus", "male"], ["Iapetus", "male"], ["Umbriel", "male"], ["Algieba", "male"], ["Algenib", "male"], ["Rasalgethi", "male"], ["Alnilam", "male"],
  ["Schedar", "male"], ["Achird", "male"], ["Zubenelgenubi", "male"], ["Sadachbia", "male"], ["Sadaltager", "male"],
] as const;
/** From Google's one-word description of each voice (Youthful, Upbeat, Bright, Lively / Mature, Gravelly, Gentle, Warm, Informative, Even). */
const GEMINI_YOUNG: readonly string[] = ["Leda", "Laomedeia", "Zephyr", "Autonoe", "Puck", "Sadachbia"], GEMINI_MATURE: readonly string[] = ["Gacrux", "Vindemiatrix", "Sulafat", "Algenib", "Charon", "Schedar"];
const IMAGE_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"];

/**
 * The bundled model catalogue of the generation providers the server ships an adapter for: capability metadata and
 * the cost model of each model. Feature code never states a capability of a model itself; it reads it from here.
 */
/**
 * The most reference pictures ANY image request carries, whatever a model's list says it takes. Measured on a real
 * film (2026-10-07): the model whose list says 16 drew unrelated pictures from 6 references up. A listed maximum is
 * not trusted above this until a real run has shown the model keeps to its references with more.
 */
export const REFERENCES_MAX = 5;
export const BUNDLED_MODELS: Bundled[] = [
  {
    provider: "openrouter", id: "openai/gpt-5-image-mini", label: "GPT-5 Image Mini", capability: "image", recommended: true, description: "Fast, low-cost images from a text prompt.",
    // Measured on the real provider (2026-10-07): it refuses any other shape ("Accepted: 1:1, 3:2, 2:3, auto"), and one
    // picture cost $0.0334 at the default quality and $0.0022 at "low".
    // Reference pictures, measured on a real 17-panel film (2026-10-07): the provider's list says up to 16 per request,
    // but every frame asked with 6 or 7 came back as an unrelated picture (a poster, a stranger's portrait) billed
    // $0.003, while every frame with 1 to 5 showed the people of its sheets. So: 5. Each 1536×1024 reference added about
    // $0.004 to a "low" picture ($0.0078 with one, $0.0225 with five).
    metadata: { resumable: false, cancellable: false, aspectRatios: ["1:1", "3:2", "2:3"], maxImages: 4, maxPromptLength: 8000, seed: false, negativePrompt: false, referenceImages: 5 },
    pricing: { kind: "per_image", baseUsd: 0.034, tiers: [{ when: { quality: "low" }, usd: 0.003 }], approximate: true, referenceUsd: 0.004, source: measured("Live runs: one picture $0.0334 at the default quality, $0.0022 at low; each 1536×1024 reference added about $0.004 (a 17-panel film).") },
    // Measured LIMITS stay (the shapes it really makes, the reference cap). Its PRICE is not pinned: when the provider's list states a price per picture, that price is used (beneath a person's own); today the list prices this model per token, which cannot be stated per picture, so the measured price below stands.
    verified: ["aspectRatios", "referenceImages"],
  },
  {
    provider: "openrouter", id: "google/gemini-3.1-flash-lite-image", label: "Gemini 3.1 Flash Lite Image", capability: "image", description: "Images from a text prompt.",
    metadata: { resumable: false, cancellable: false, aspectRatios: IMAGE_RATIOS, maxImages: 4, maxPromptLength: 8000, seed: false, negativePrompt: false, referenceImages: REFERENCES_MAX },
    // NO PRICE (ruling R7): the $0.04 a picture this row carried has no recorded origin — neither a line of the provider's list nor a bill. Until the list states a price per picture (a refresh takes it) or an admin enters one, its pictures are "price not known".
  },
  {
    // A text-to-speech model served by the provider's speech endpoint: it reads the text and nothing else. Measured on the
    // real provider (2026-10-07): a Vietnamese line read back word for word by a transcription model.
    provider: "openrouter", id: "google/gemini-3.8-flash-lite-tts", label: "Gemini 3.8 Flash Lite TTS", capability: "tts", recommended: true, description: "Reads text aloud in thirty voices, in many languages.",
    metadata: {
      resumable: false, cancellable: false, voices: GEMINI_VOICES.map(([voiceId, gender]) => ({ voiceId, name: voiceId, gender, languages: ["multi"], tags: GEMINI_YOUNG.includes(voiceId) ? ["young"] : GEMINI_MATURE.includes(voiceId) ? ["mature"] : [] })),
      languages: ["multi"], formats: ["wav"], maxCharacters: 4000, wordTimings: false,
      // The provider's speech documentation: delivery `instructions` are "Supported by OpenAI gpt-4o-mini-tts and Gemini TTS models" (how an accent is asked of this model); its endpoint record says it takes no voice sample (`supports_voice_cloning: false`, read 2026-10-08).
      instructions: true, voiceClone: false,
    },
    pricing: { kind: "per_character", perThousandUsd: 0.01, approximate: true, source: LISTED },
    // The voices and their genders are the provider's documented ones; its list names voices without them.
    verified: ["voices"],
  },
  {
    // A CONVERSATIONAL model with audio output, not a reader: on the real provider it spoke a 8-word line for 16 seconds.
    // Kept for hosts that enabled it; never the recommended one.
    provider: "openrouter", id: "openai/gpt-audio-mini", label: "GPT Audio Mini", capability: "tts", description: "A conversational voice model; it may not read the text word for word.",
    metadata: {
      resumable: false, cancellable: false, voices: OPENAI_VOICES.map(([voiceId, name, gender]) => ({ voiceId, name, gender, languages: ["multi"], tags: [] })),
      languages: ["multi"], formats: ["wav"], maxCharacters: 4000, wordTimings: false,
    },
    pricing: { kind: "per_character", perThousandUsd: 0.004, approximate: true, source: LISTED },
    // The voices and their genders are the provider's documented ones; its list names voices without them.
    verified: ["voices"],
  },
  {
    // The listener of a film's takes: measured on the real provider (2026-10-07) to write Vietnamese back word for word, at about $0.00002 a line.
    provider: "openrouter", id: "qwen/qwen3-asr-1.7b", label: "Qwen3 ASR 1.7B", capability: "transcription", recommended: true, description: "Writes speech back as text, in many languages.",
    metadata: { resumable: false, cancellable: false, languages: ["multi"] },
    pricing: { kind: "per_call", usd: 0.00002, source: LISTED },
  },
  {
    provider: "openrouter", id: "google/lyria-3-clip-preview", label: "Lyria 3 Clip", capability: "music", recommended: true, description: "A 30-second music clip from a description.",
    metadata: { resumable: false, cancellable: false, durationSeconds: { min: 30, max: 30 }, instrumental: true, lyrics: false, maxPromptLength: 2000 },
    pricing: { kind: "per_clip", tiers: [{ when: {}, usd: 0.04 }], source: measured("Live runs: one 30-second clip was billed $0.04.") },
  },
  // Qwen-Image-2.1 on the host itself (Settings ▸ Providers ▸ Generation ▸ Local models): free, a row per variant, usable once
  // that variant is downloaded. Its shapes are the ones the engine is given at about one megapixel (`local-models/engine.ts`);
  // a seed and a negative prompt are passed to the engine (`-s`, `-n`); reference pictures are not (editing needs the vision weights, not downloaded).
  ...(["standard", "uncensored"] as const).map((variant): Bundled => ({
    provider: "local-qwen-image", id: variant === "standard" ? "qwen-image-2.1" : "qwen-image-2.1-uncensored", label: variant === "standard" ? "Qwen-Image-2.1 (this computer)" : "Qwen-Image-2.1 Uncensored (this computer)", capability: "image", recommended: true,
    description: variant === "standard" ? "Pictures made on this computer. Free." : "Pictures made on this computer, without content refusals. Free.",
    metadata: { resumable: false, cancellable: true, aspectRatios: IMAGE_RATIOS, maxImages: 4, maxPromptLength: 4000, seed: true, negativePrompt: true, referenceImages: 0 },
    pricing: { kind: "free" },
  })),
];

/** Whether a voice with these languages reads text of `language`: "vi" and "vi-VN" are the same language; "multi" reads any. */
export const speaks = (languages: readonly string[], language: string): boolean => { const wanted = language.toLowerCase().split(/[-_]/)[0]; return languages.some((entry) => entry === "multi" || entry.toLowerCase().split(/[-_]/)[0] === wanted); };

/** Concurrent provider jobs per capability where the provider states none. */
export const DEFAULT_CONCURRENCY: Record<GenerationCapability, number> = { image: 4, video: 2, tts: 4, "voice-design": 1, music: 1, sfx: 2, lipsync: 2, transcription: 2, translation: 4, "stock-media": 2 };

/** A request against the metadata of its model: the first value that is not allowed, with what is. */
export function violationOf(model: GenerationModel, params: GenerationParams): { field: string; message: string; allowed?: unknown } | undefined {
  const meta = model.metadata, text = model.capability === "tts" ? params.text : params.prompt;
  if (!text) return { field: model.capability === "tts" ? "text" : "prompt", message: model.capability === "tts" ? "Enter the text to speak." : "Enter a prompt." };
  const longest = model.capability === "tts" ? meta.maxCharacters : meta.maxPromptLength;
  if (longest && text.length > longest) return { field: model.capability === "tts" ? "text" : "prompt", message: `This model takes at most ${longest} characters.`, allowed: { max: longest } };
  if (model.capability === "image") {
    if (params.aspectRatio && meta.aspectRatios && !meta.aspectRatios.includes(params.aspectRatio)) return { field: "aspectRatio", message: `This model makes ${meta.aspectRatios.join(", ")}.`, allowed: meta.aspectRatios };
    if ((params.count ?? 1) > (meta.maxImages ?? 1)) return { field: "count", message: `This model makes at most ${meta.maxImages ?? 1} images per request.`, allowed: { max: meta.maxImages ?? 1 } };
    if (params.seed !== undefined && !meta.seed) return { field: "seed", message: "This model does not take a seed." };
    if (params.negativePrompt && !meta.negativePrompt) return { field: "negativePrompt", message: "This model does not take a negative prompt." };
    const references = params.referenceBlobIds?.length ?? 0, most = Math.min(REFERENCES_MAX, meta.referenceImages ?? 0);
    if (references > most) return { field: "referenceBlobIds", message: most ? `This model takes at most ${most} reference pictures.` : "This model does not take reference pictures.", allowed: { max: most } };
  }
  if (model.capability === "tts") {
    const voices = (meta.voices ?? []).map((voice) => voice.voiceId);
    if (params.voice && voices.length && !voices.includes(params.voice)) return { field: "voice", message: `This model has the voices ${voices.join(", ")}.`, allowed: voices };
    if (params.speed !== undefined && (!meta.speed || params.speed < meta.speed.min || params.speed > meta.speed.max)) return { field: "speed", message: meta.speed ? `Speed is ${meta.speed.min}–${meta.speed.max} for this model.` : "This model has no speed setting.", ...(meta.speed ? { allowed: meta.speed } : {}) };
    // A voice sample is sent only to a model whose provider documents speaking in a sample's voice: to any other it would be dropped unseen, and the line spoken in a stranger's voice.
    if (params.voiceSampleBlobId && meta.voiceClone !== true) return { field: "voiceSampleBlobId", message: "This model does not speak in the voice of a sample." };
  }
  if (model.capability === "video") {
    if (params.aspectRatio && meta.aspectRatios?.length && !meta.aspectRatios.includes(params.aspectRatio)) return { field: "aspectRatio", message: `This model makes ${meta.aspectRatios.join(", ")}.`, allowed: meta.aspectRatios };
    if (params.durationSeconds !== undefined && meta.durations?.length && !meta.durations.includes(params.durationSeconds)) return { field: "durationSeconds", message: `This model makes clips of ${meta.durations.join(", ")} seconds.`, allowed: meta.durations };
    if (params.resolution && meta.resolutions?.length && !meta.resolutions.includes(params.resolution)) return { field: "resolution", message: `This model makes ${meta.resolutions.join(", ")}.`, allowed: meta.resolutions };
    if (params.seed !== undefined && !meta.seed) return { field: "seed", message: "This model does not take a seed." };
    const pictures = params.referenceBlobIds?.length ?? 0, takes = meta.frameImages?.includes("first_frame") ? 1 : 0;
    if (pictures > takes) return { field: "referenceBlobIds", message: takes ? "This model starts a clip from one picture." : "This model does not start a clip from a picture.", allowed: { max: takes } };
  }
  if (model.capability === "music") {
    const range = meta.durationSeconds;
    if (params.durationSeconds !== undefined && range && (params.durationSeconds < range.min || params.durationSeconds > range.max)) return { field: "durationSeconds", message: range.min === range.max ? `This model makes ${range.min}-second clips.` : `Duration is ${range.min}–${range.max} s for this model.`, allowed: range };
    if (params.lyrics && !meta.lyrics) return { field: "lyrics", message: "This model does not take lyrics." };
  }
  return undefined;
}

const money = (value: number) => Math.round(value * 1e6) / 1e6;
const matches = (when: Record<string, unknown>, facts: Record<string, unknown>) => Object.entries(when).every(([key, value]) => facts[key] === value);
/**
 * The cost of one request by the model's cost model; no side effect. THE one pricing function: a listed job is priced
 * from its parameters; work that is not a listed job (listening, translating) says how much of it there is in `work`
 * — the seconds of sound (as they are, a quarter of a second is a quarter), the characters of text, the tokens — and
 * is priced by the same tiers and the same arithmetic, for the estimate a person confirms and for the charge alike.
 */
export type PricedWork = { seconds?: number; characters?: number; inputTokens?: number; outputTokens?: number };
export function estimateOf(model: GenerationModel, params: GenerationParams, work: PricedWork = {}): Pick<GenerationEstimate, "amountUsd" | "basis" | "breakdown" | "confidence"> {
  const pricing: GenerationPricing | undefined = model.pricing;
  if (!pricing) return { amountUsd: null, basis: "No price is known for this model", breakdown: [], confidence: "unknown" };
  // Ruling R7: a price is used only with its recorded origin (the provider's list, real bills, the host's admin). One without is no price.
  if (pricing.kind !== "free" && !pricing.source) return { amountUsd: null, basis: "This model's price has no recorded source, so it is not used", breakdown: [], confidence: "unknown" };
  // A price measured on bills is an estimate of the next bill: never "exact".
  const about = pricing.kind !== "free" && pricing.source?.kind === "measured";
  const one = (label: string, usdValue: number, confidence: GenerationEstimate["confidence"], basis: string) => ({ amountUsd: money(usdValue), basis, breakdown: [{ label, usd: money(usdValue) }], confidence: about && confidence === "exact" ? "approximate" as const : confidence });
  const duration = work.seconds ?? params.durationSeconds ?? model.metadata.durationSeconds?.max ?? 0;
  switch (pricing.kind) {
    case "free": return one("Free", 0, "exact", "Free");
    case "per_call": return one("1 call", pricing.usd, "exact", "Per call");
    case "per_image": {
      const count = params.count ?? 1, each = pricing.tiers?.find((tier) => matches(tier.when, params))?.usd ?? pricing.baseUsd, references = params.referenceBlobIds?.length ?? 0;
      return one(`${count} × image${references ? ` with ${references} reference${references === 1 ? "" : "s"}` : ""}`, count * each + references * (pricing.referenceUsd ?? 0), pricing.approximate ? "approximate" : "exact", "Per image");
    }
    case "per_second": {
      // A clip whose length is not known (a model whose row names no lengths, asked for none) cannot be priced by the second: not zero — not known.
      if (model.capability === "video" && !(duration > 0)) return { amountUsd: null, basis: "Priced per second, and how long this clip will be is not known", breakdown: [], confidence: "unknown" };
      const each = pricing.tiers?.find((tier) => matches(tier.when, { ...params, durationSeconds: duration }))?.usd ?? pricing.usd, pictures = model.capability === "video" ? params.referenceBlobIds?.length ?? 0 : 0;
      return one(`${duration} s${pictures && pricing.referenceUsd ? ` from ${pictures} picture${pictures === 1 ? "" : "s"}` : ""}`, duration * each + pictures * (pricing.referenceUsd ?? 0), "exact", "Per second");
    }
    case "per_clip": {
      const tier = pricing.tiers.find((entry) => matches(entry.when, { ...params, durationSeconds: duration }));
      return tier ? one("1 clip", tier.usd, "exact", "Per clip") : { amountUsd: null, basis: "No price tier matches this request", breakdown: [], confidence: "unknown" };
    }
    case "per_character": {
      const characters = work.characters ?? (params.text ?? "").length;
      return one(`${characters} characters`, (characters / 1000) * pricing.perThousandUsd, pricing.approximate ? "approximate" : "exact", "Per character");
    }
    case "tokens": {
      // No rate is assumed here (characters a token, tokens a second, a "typical" answer): the caller says how many
      // tokens the request can be billed at most — counted from the request itself and from documented figures of the
      // model — or the price of the request is NOT KNOWN. A side whose price is zero needs no count.
      const input = work.inputTokens, output = work.outputTokens;
      if ((pricing.inputPerMillionUsd > 0 && input === undefined) || (pricing.outputPerMillionUsd > 0 && output === undefined)) return { amountUsd: null, basis: "Priced per token, and how many tokens this request can be billed is not known", breakdown: [], confidence: "unknown" };
      return one(`at most ${input ?? 0} input and ${output ?? 0} output tokens`, ((input ?? 0) / 1e6) * pricing.inputPerMillionUsd + ((output ?? 0) / 1e6) * pricing.outputPerMillionUsd, "upper_bound", "Per token");
    }
  }
}
