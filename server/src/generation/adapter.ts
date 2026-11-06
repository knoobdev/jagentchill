import type { GenerationCapability, GenerationErrorClass, GenerationModel, GenerationModelMetadata, GenerationParams, GenerationPricing } from "@jagentchill/protocol";

/**
 * The contract a generation provider adapter of the server implements (`generation-providers.Provider adapter
 * contract`). An adapter knows one provider's wire format and nothing of the server: the service gives it the key,
 * the request and a signal, and stores what it returns. It never sees a blob, a budget or a device.
 */
export type ProviderDefinition = {
  id: string; label: string; description: string; source: "builtin" | "server" | "endpoint" | "local"; capabilities: GenerationCapability[];
  /** The hosts a request of this provider reaches: the egress list and what a consent card names. */
  hosts: string[]; authFields: { name: string; label: string; secret: true }[]; docsUrl?: string;
  /** A model that runs on the host: no key, nothing billed, one job at a time, no automatic retry (a person retries). */
  local?: true;
};
export type ConnectionOutcome = { outcome: "ok" | "invalid_key" | "forbidden" | "network" | "endpoint" | "quota"; statusCode?: number; message: string };
export type AdapterRequest = {
  capability: GenerationCapability; model: string; params: GenerationParams; metadata: GenerationModelMetadata;
  /** image: the files of `params.referenceBlobIds`, in that order, read by the service (an adapter never sees a blob store). */
  references?: { bytes: Uint8Array; mime: string }[];
  /** tts: the recording of `params.voiceSampleBlobId` — the voice the text is to be spoken in — read by the service. */
  voiceSample?: { bytes: Uint8Array; mime: string };
};
export type AdapterOutput = { bytes: Uint8Array; mime: string; /** The seed this file was made with, when the adapter chose it (the request named none). */ seed?: number };
export type AdapterResult = {
  outputs: AdapterOutput[];
  /** What the provider said this call cost, when it says. */
  costUsd?: number;
  units: { images?: number; seconds?: number; characters?: number; calls?: number; inputTokens?: number; outputTokens?: number };
  /** Items the provider refused out of several that were asked for. */
  blocked?: number;
};
export type SubmitContext = {
  secret: string; signal: AbortSignal; idempotencyKey: string; progress(fraction: number): void;
  /**
   * A request the provider works on as a TASK it is asked about again (a video): `started` is told the provider's
   * handle of the task the moment it is accepted — the service keeps it with the job, in the store. `resume`: the
   * handle of a task that was accepted before (the host stopped while it waited): the adapter sends NOTHING new, it
   * waits for that task and fetches its result.
   */
  task?: { resume?: string; started(handle: string): void };
};
export type JcProviderAdapter = {
  describe(): ProviderDefinition;
  /** A provider that runs on the host (`local`): whether this model is installed and can run now. */
  ready?(modelId: string): boolean;
  /** One authenticated request that costs nothing. */
  validateConnection(secret: string): Promise<ConnectionOutcome>;
  /** The provider's live model list, as catalogue rows the bundled file may not have: with what the provider's list says each model takes and costs. */
  listModels(secret: string | undefined): Promise<ListedModel[]>;
  /**
   * The options of a request (`params`, beyond its words and its reference pictures) that this adapter really puts in
   * what it sends the provider for this model. It is what "applied" means for a profile's option under Model routing:
   * an option outside this list reaches nobody. An adapter that does not say sends none.
   */
  sends?(capability: GenerationCapability, model: string): readonly (keyof GenerationParams)[];
  /**
   * The UTF-8 bytes of everything a model reads as TEXT in the request this adapter would send (the messages of a
   * translation exactly as they are serialised into the request; the words a transcription request carries beside its sound, if it carries any).
   * No tokenizer makes more tokens than a text has bytes, so this bounds the input tokens that can be billed for the
   * text of the request. An adapter that does not say: a per-token price of such a request is not known.
   */
  textBytes?(request: { translate: { prompt: string; model: string } } | { transcribe: { language?: string; model: string } }): number;
  /** One paid request, to its result. A request the provider works on as a task (a video) is waited for here, inside the call: see `SubmitContext.task`. */
  submit(request: AdapterRequest, ctx: SubmitContext): Promise<{ result: AdapterResult }>;
  /** Speech written back as text (what a take really says), for adapters whose provider offers it. */
  transcribe?(input: { bytes: Uint8Array; format: "wav" | "mp3"; language?: string; model: string }, ctx: { secret: string; signal: AbortSignal }): Promise<{ text: string; costUsd?: number }>;
  /** A text answered with text by a language model of the provider (captions in another language), for adapters whose provider offers it. */
  translate?(input: { prompt: string; model: string; /** The most the answer may be, in tokens: what was quoted is what can be billed. */ maxOutputTokens?: number; /** The thinking the request asks the model for, where its row says it can be switched off or turned down (it counts inside the limit). */ reasoning?: "none" | "minimal" }, ctx: { secret: string; signal: AbortSignal }): Promise<{ text: string; costUsd?: number; /** The provider stopped the answer AT the limit (`finish_reason: "length"`): the text is not the whole answer, whatever it looks like. */ cutOff?: true }>;
};

export type ListedModel = Pick<GenerationModel, "id" | "label" | "capability" | "description"> & { metadata?: Partial<GenerationModelMetadata>; pricing?: GenerationPricing };

/** A provider call that failed, already put in one of the closed classes. */
export class ProviderFailure extends Error {
  readonly class: GenerationErrorClass;
  readonly statusCode?: number;
  readonly retryAfterMs?: number;
  readonly details?: Record<string, unknown>;
  /**
   * What the provider BILLED for the request that failed, when its answer said (an answer that could not be used — no
   * file, a broken stream, an error after the work was done — is billed all the same). An adapter sets it (`billedAs`)
   * before it throws; the spend gate records it as the request's charge.
   */
  billedUsd?: number;
  constructor(errorClass: GenerationErrorClass, message: string, opts: { statusCode?: number; retryAfterMs?: number; details?: Record<string, unknown> } = {}) {
    super(message);
    this.class = errorClass;
    this.statusCode = opts.statusCode;
    this.retryAfterMs = opts.retryAfterMs;
    this.details = opts.details;
  }
}

/** The failure of a request the provider answered with a bill: the bill goes with it. */
export function billedAs<T>(failure: T, usage: { cost?: unknown } | undefined): T {
  if (failure instanceof ProviderFailure && typeof usage?.cost === "number" && Number.isFinite(usage.cost) && usage.cost > 0) failure.billedUsd = usage.cost;
  return failure;
}
const BLOCK_WORDS = /content.?policy|safety system|moderation|flagged|prohibited content|content_filter|blocked by/i;
/** The class of an HTTP answer that is not a success, from its status and what the body says. */
export function classifyHttp(status: number, body: string, retryAfter?: string | null): ProviderFailure {
  let message = body.slice(0, 600), categories: string[] | undefined;
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string; metadata?: { reasons?: string[] } } };
    if (parsed.error?.message) message = parsed.error.message.slice(0, 600);
    if (Array.isArray(parsed.error?.metadata?.reasons)) categories = parsed.error.metadata.reasons.map(String).slice(0, 12);
  } catch { /* the body is not JSON: its text is the message */ }
  const opts = { statusCode: status, details: { providerMessage: message } };
  if (categories || ((status === 400 || status === 403) && BLOCK_WORDS.test(message))) return new ProviderFailure("content_blocked", message, { statusCode: status, details: { stage: "input", ...(categories ? { categories } : {}), providerMessage: message } });
  if (status === 401) return new ProviderFailure("auth_error", message, opts);
  if (status === 402) return new ProviderFailure("quota_exhausted", message, opts);
  if (status === 403) return new ProviderFailure("forbidden", message, opts);
  if (status === 404) return new ProviderFailure("model_unavailable", message, opts);
  if (status === 408 || status === 504) return new ProviderFailure("timeout", message, opts);
  if (status === 429) {
    const seconds = Number(retryAfter);
    return new ProviderFailure("rate_limited", message, { ...opts, ...(Number.isFinite(seconds) && seconds > 0 ? { retryAfterMs: Math.min(120_000, seconds * 1000) } : {}) });
  }
  if (status === 400 || status === 413 || status === 422) return new ProviderFailure("invalid_request", message, opts);
  if (status === 503) return new ProviderFailure("model_unavailable", message, opts);
  if (status >= 500) return new ProviderFailure("server_error", message, opts);
  return new ProviderFailure("unknown", message, opts);
}

/** What a thrown transport error is: a cancel, a timeout, or the network. */
export function classifyThrown(error: unknown, signal: AbortSignal): ProviderFailure {
  if (error instanceof ProviderFailure) return error;
  if (signal.aborted) return new ProviderFailure(signal.reason === "timeout" ? "timeout" : "cancelled", signal.reason === "timeout" ? "The provider did not answer in time." : "Cancelled.");
  return new ProviderFailure("network", error instanceof Error ? error.message.slice(0, 300) : "The request did not reach the provider.");
}

/** A container the editor can decode, recognised by its first bytes. */
export function sniffMedia(bytes: Uint8Array): { mime: string; extension: string } | undefined {
  const at = (offset: number, text: string) => text.split("").every((char, index) => bytes[offset + index] === char.charCodeAt(0));
  if (bytes.length < 12) return undefined;
  if (bytes[0] === 0x89 && at(1, "PNG")) return { mime: "image/png", extension: "png" };
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return { mime: "image/jpeg", extension: "jpg" };
  if (at(0, "RIFF") && at(8, "WEBP")) return { mime: "image/webp", extension: "webp" };
  if (at(0, "RIFF") && at(8, "WAVE")) return { mime: "audio/wav", extension: "wav" };
  if (at(0, "ID3") || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return { mime: "audio/mpeg", extension: "mp3" };
  if (at(0, "OggS")) return { mime: "audio/ogg", extension: "ogg" };
  if (at(0, "fLaC")) return { mime: "audio/flac", extension: "flac" };
  // An MP4 container says nothing of what it holds in its first bytes: sound unless the caller knows better (a video adapter names its file `video/mp4` itself).
  if (at(4, "ftyp")) return { mime: "audio/mp4", extension: "m4a" };
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return { mime: "video/webm", extension: "webm" };
  return undefined;
}

/** Raw 16-bit little-endian samples as a WAV file. */
export function wavFromPcm16(pcm: Uint8Array, sampleRate: number, channels: number): Uint8Array {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVEfmt ", 8); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22); header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * channels * 2, 28); header.writeUInt16LE(channels * 2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
