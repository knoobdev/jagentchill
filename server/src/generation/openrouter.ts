import type { GenerationModelMetadata, GenerationPricing } from "@jagentchill/protocol";
import { ProviderFailure, billedAs, classifyHttp, classifyThrown, sniffMedia, wavFromPcm16, type AdapterRequest, type AdapterResult, type ConnectionOutcome, type JcProviderAdapter, type ListedModel, type SubmitContext } from "./adapter.ts";
import { REFERENCES_MAX } from "./catalogue.ts";

type PriceLine = { billable?: string; unit?: string; cost_usd?: number; variant?: string };
const QUALITY_VARIANTS = new Set(["low", "medium", "high", "auto", "standard", "hd"]);
/**
 * The price of one picture from a model's price lines, or none when it cannot be stated truthfully. Only a price per
 * picture can be stated as one (per-token and per-megapixel prices depend on the picture). A model may list several:
 * a plain line is the price of a request that asks nothing special; a line whose `variant` is a quality becomes a tier
 * matched by the request's `quality`; a variant a request cannot name (a resolution: "1k", "2k", "high_resolution")
 * makes the stated price approximate. Never the cheapest of several: with only variants and no plain line the dearest
 * quality is the base (a request that names no quality is not promised the cheap one), and with only variants that
 * cannot be matched the cost is unknown.
 */
export function imagePriceOf(lines: readonly PriceLine[]): Extract<GenerationPricing, { kind: "per_image" }> | undefined {
  const each = lines.filter((line) => line.billable === "output_image" && line.unit === "image" && typeof line.cost_usd === "number");
  if (!each.length) return undefined;
  const plain = each.filter((line) => !line.variant), byQuality = each.filter((line) => line.variant && QUALITY_VARIANTS.has(line.variant.toLowerCase())), other = each.length - plain.length - byQuality.length;
  if (!plain.length && !byQuality.length) return undefined;
  const baseUsd = plain.length ? Math.max(...plain.map((line) => line.cost_usd!)) : Math.max(...byQuality.map((line) => line.cost_usd!));
  const tiers = byQuality.map((line) => ({ when: { quality: line.variant!.toLowerCase() }, usd: line.cost_usd! }));
  return { kind: "per_image", baseUsd, ...(tiers.length ? { tiers } : {}), ...(other > 0 || plain.length > 1 || (!plain.length && byQuality.length > 0) ? { approximate: true } : {}) };
}

/**
 * The price of one second of video from a model's price list (`pricing_skus` of the provider's video list), for the
 * request this product sends: WITHOUT sound (a film has its own voices and music) and, when `fromPicture`, started
 * from a picture. Only what the list states per second can be stated as a price: a model priced by the token or by
 * the megapixel, or one whose list carries a line this function does not understand (it might apply to the request),
 * has NO price here — its clips are "price not known". Per resolution the most specific line wins (picture-to-video,
 * then "without audio", then the plain one). A request that names no listed resolution is not promised the cheap
 * one: the base is the plain line, or the dearest of the resolutions.
 */
export function videoPriceOf(skus: Readonly<Record<string, unknown>> | null | undefined, resolutions: readonly string[] = []): Extract<GenerationPricing, { kind: "per_second" }> | undefined {
  type Line = { usd: number; resolution?: string; rank: number };
  const lines: Line[] = [];
  let referenceUsd: number | undefined;
  for (const [key, raw] of Object.entries(skus ?? {})) {
    const value = Number(raw), name = key.toLowerCase();
    if (!Number.isFinite(value) || value < 0) return undefined;
    // Lines of requests this product does not send: with sound, from words alone, continuing an earlier clip.
    if (/with_audio|^text_to_video_|continuation/.test(name) && !/without_audio/.test(name)) continue;
    if (name === "cents_per_image_input") { referenceUsd = value / 100; continue; }
    const cents = /^cents_per_(?:video_output_second|second_output)(?:_(.+))?$/.exec(name), dollars = /^(image_to_video_)?duration_seconds(_without_audio)?(?:_(.+))?$/.exec(name);
    if (cents) lines.push({ usd: value / 100, ...(cents[1] ? { resolution: cents[1] } : {}), rank: 0 });
    else if (dollars) lines.push({ usd: value, ...(dollars[3] ? { resolution: dollars[3] } : {}), rank: dollars[1] ? 2 : dollars[2] ? 1 : 0 });
    else return undefined;
  }
  if (!lines.length) return undefined;
  const best = (resolution: string | undefined): number | undefined => lines.filter((line) => line.resolution === resolution).sort((a, b) => b.rank - a.rank || b.usd - a.usd)[0]?.usd;
  const named = [...new Set(lines.map((line) => line.resolution).filter((entry): entry is string => !!entry))];
  // A resolution is written in the request as the model's list writes it ("2K"); the price list writes it small ("2k").
  const written = (resolution: string): string => resolutions.find((entry) => entry.toLowerCase() === resolution) ?? resolution;
  const tiers = named.map((resolution) => ({ when: { resolution: written(resolution) }, usd: best(resolution)! }));
  const usd = best(undefined) ?? Math.max(...tiers.map((tier) => tier.usd));
  return { kind: "per_second", usd, ...(tiers.length ? { tiers } : {}), ...(referenceUsd !== undefined ? { referenceUsd } : {}) };
}

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
/**
 * How a video task is waited for — the provider's own documented loop (its "Generate and Download a Video" guide:
 * "Use a reasonable polling interval (e.g., 30 seconds)", sixty attempts): asked every 30 s, given up after 60 asks.
 */
export const VIDEO_POLL = { everyMs: 30_000, attempts: 60 } as const;
/** The models the provider documents as taking delivery `instructions` on its speech endpoint ("Supported by OpenAI gpt-4o-mini-tts and Gemini TTS models. Ignored by other providers"). */
export const takesInstructions = (model: string): boolean => /^google\/gemini-[^/]*tts/.test(model) || /^openai\/gpt-4o-mini-tts/.test(model);
/** How long one generation request may take before it is classed `timeout`. */
const REQUEST_TIMEOUT_MS = 180_000;
const VALIDATION_TIMEOUT_MS = 15_000;
/** Speech models answer in raw 16-bit mono samples at this rate when no container is asked for. */
const SPEECH_PCM = { sampleRate: 24_000, channels: 1 };
/** Music models that answer in raw samples do so in stereo at this rate. */
const MUSIC_PCM = { sampleRate: 48_000, channels: 2 };

type Fetch = typeof fetch;
type Usage = { cost?: number; prompt_tokens?: number; completion_tokens?: number };

/**
 * The OpenRouter adapter of the generation service, for image, speech and music. It is the one place that knows
 * OpenRouter's wire formats: `POST /images` (JSON with base64 images; `input_references` for the pictures to draw with), and `POST /chat/completions` with the `audio`
 * output modality, which OpenRouter only serves as a stream.
 */
export function createOpenRouterAdapter(opts: { baseUrl?: string; fetch?: Fetch; /** Test only: the wait between two asks about a video task. */ videoPollMs?: number } = {}): JcProviderAdapter {
  const base = (opts.baseUrl ?? OPENROUTER_BASE_URL).replace(/\/+$/, ""), send: Fetch = opts.fetch ?? fetch, host = new URL(base).host;
  const headers = (secret: string) => ({ authorization: `Bearer ${secret}`, "content-type": "application/json", "x-title": "JAgentChill" });

  /** A request bound to the caller's signal and to the time limit. */
  async function call<T>(path: string, init: RequestInit, signal: AbortSignal, timeoutMs: number, read: (response: Response) => Promise<T>): Promise<T> {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort("timeout"), timeoutMs), onAbort = () => controller.abort(signal.reason ?? "cancelled");
    if (signal.aborted) onAbort(); else signal.addEventListener("abort", onAbort, { once: true });
    try {
      const response = await send(`${base}${path}`, { ...init, signal: controller.signal });
      // An answer that is not a success may still say what the request was billed (`usage.cost` in its body): that is read FIRST, and goes with the failure whatever its class.
      if (!response.ok) { const body = await response.text().catch(() => ""); let usage: Usage | undefined; try { usage = (JSON.parse(body) as { usage?: Usage } | null)?.usage; } catch { /* the body is not JSON: it names no bill */ } throw billedAs(classifyHttp(response.status, body, response.headers.get("retry-after")), usage); }
      return await read(response);
    } catch (error) {
      throw classifyThrown(error, controller.signal);
    } finally { clearTimeout(timer); signal.removeEventListener("abort", onAbort); }
  }

  async function image(request: AdapterRequest, ctx: SubmitContext): Promise<AdapterResult> {
    const count = request.params.count ?? 1;
    // Reference pictures ride in the same request as data URLs (measured on the real provider, 2026-10-07: the picture
    // came back with the emblem of the reference, which the prompt did not describe).
    const references = (request.references ?? []).map((file) => ({ type: "image_url", image_url: { url: `data:${file.mime};base64,${Buffer.from(file.bytes).toString("base64")}` } }));
    const body = { model: request.model, prompt: request.params.prompt, n: count, ...(request.params.aspectRatio ? { aspect_ratio: request.params.aspectRatio } : {}), ...(request.params.quality ? { quality: request.params.quality } : {}), ...(request.params.seed !== undefined ? { seed: request.params.seed } : {}), ...(references.length ? { input_references: references } : {}) };
    ctx.progress(0.1);
    const answer = await call("/images", { method: "POST", headers: headers(ctx.secret), body: JSON.stringify(body) }, ctx.signal, REQUEST_TIMEOUT_MS,
      (response) => response.json() as Promise<{ data?: { b64_json?: string; media_type?: string }[]; usage?: Usage; error?: { message?: string; code?: number } }>);
    // Usage is read FIRST: whatever is wrong with the answer below, what it was billed goes with the failure.
    if (answer.error) throw billedAs(classifyHttp(Number(answer.error.code) || 500, JSON.stringify({ error: answer.error })), answer.usage);
    const outputs = (answer.data ?? []).filter((item) => typeof item.b64_json === "string" && item.b64_json.length > 0).map((item) => {
      const bytes = Buffer.from(item.b64_json!, "base64");
      return { bytes, mime: item.media_type ?? sniffMedia(bytes)?.mime ?? "application/octet-stream" };
    });
    if (!outputs.length) throw billedAs(new ProviderFailure("invalid_output", "The provider returned no image."), answer.usage);
    return { outputs, units: { images: outputs.length, calls: 1, ...tokens(answer.usage) }, ...(typeof answer.usage?.cost === "number" ? { costUsd: answer.usage.cost } : {}), ...(outputs.length < count ? { blocked: count - outputs.length } : {}) };
  }

  /** Text read aloud by a text-to-speech model, through the provider's speech endpoint: the file, as WAV. */
  async function speech(request: AdapterRequest, ctx: SubmitContext): Promise<AdapterResult> {
    const text = request.params.text ?? "", voice = request.params.voice ?? request.metadata.voices?.[0]?.voiceId;
    // Google's speech models answer raw samples only; the others answer a container.
    const raw = /^google\//.test(request.model);
    // A sample of a voice rides in the request itself (the provider's stateless cloning: `input_references`, an `input_audio` part and, when known, what it says): the sample IS the voice, so no voice id goes with it (the provider documents a request with both as refused by some models).
    const sample = request.voiceSample, references = sample ? [{ type: "input_audio", input_audio: { data: `data:${sample.mime};base64,${Buffer.from(sample.bytes).toString("base64")}` } }, ...(request.params.voiceSampleText ? [{ type: "text", text: request.params.voiceSampleText }] : [])] : [];
    // How the text is to be delivered (an accent) goes in `instructions` — never into the text, which these models read aloud word for word — and only to the models the provider documents as reading it.
    const instructions = request.params.instructions && takesInstructions(request.model) ? request.params.instructions : undefined;
    const body = { model: request.model, input: text, ...(voice && !sample ? { voice } : {}), ...(instructions ? { instructions } : {}), response_format: raw ? "pcm" : "mp3", ...(request.params.speed !== undefined ? { speed: request.params.speed } : {}), ...(references.length ? { input_references: references } : {}) };
    ctx.progress(0.1);
    const answer = await call("/audio/speech", { method: "POST", headers: headers(ctx.secret), body: JSON.stringify(body) }, ctx.signal, REQUEST_TIMEOUT_MS, async (response) => {
      const type = response.headers.get("content-type") ?? "", bytes = Buffer.from(await response.arrayBuffer());
      if (/json/.test(type)) { let parsed: { error?: { message?: string; code?: number }; usage?: Usage } = {}; try { parsed = JSON.parse(bytes.toString("utf8")); } catch { /* not JSON after all */ } if (parsed.error) throw billedAs(classifyHttp(Number(parsed.error.code) || 500, JSON.stringify({ error: parsed.error })), parsed.usage); }
      return { type, bytes };
    });
    if (!answer.bytes.length) throw new ProviderFailure("invalid_output", "The provider returned no audio.");
    const rate = Number(/rate=(\d+)/.exec(answer.type)?.[1]) || SPEECH_PCM.sampleRate, channels = Number(/channels=(\d+)/.exec(answer.type)?.[1]) || SPEECH_PCM.channels;
    const sniffed = sniffMedia(answer.bytes), headerless = /audio\/(pcm|l16)/i.test(answer.type) || (raw && sniffed?.mime !== "audio/wav");
    const bytes = headerless ? wavFromPcm16(answer.bytes, rate, channels) : answer.bytes;
    const seconds = headerless ? answer.bytes.length / (rate * channels * 2) : undefined;
    return { outputs: [{ bytes, mime: headerless ? "audio/wav" : sniffed?.mime ?? "audio/mpeg" }], units: { calls: 1, characters: text.length, ...(seconds ? { seconds } : {}) } };
  }
  /** A chat completion with audio output: the stream's audio pieces joined into one file. */
  async function audio(request: AdapterRequest, ctx: SubmitContext, messages: { role: "system" | "user"; content: string }[], audioOptions: Record<string, unknown>, raw: { sampleRate: number; channels: number }, expectedSeconds: number): Promise<AdapterResult> {
    const body = { model: request.model, modalities: ["text", "audio"], audio: audioOptions, messages, stream: true, usage: { include: true } };
    ctx.progress(0.05);
    return call("/chat/completions", { method: "POST", headers: { ...headers(ctx.secret), accept: "text/event-stream" }, body: JSON.stringify(body) }, ctx.signal, REQUEST_TIMEOUT_MS, async (response) => {
      if (!response.body) throw new ProviderFailure("invalid_output", "The provider returned no audio.");
      const pieces: Buffer[] = [], decoder = new TextDecoder();
      let pending = "", usage: Usage | undefined, received = 0, filtered = false;
      const line = (text: string) => {
        if (!text.startsWith("data:")) return;
        const data = text.slice(5).trim();
        if (!data || data === "[DONE]") return;
        let chunk: { error?: { message?: string; code?: number | string }; usage?: Usage; choices?: { finish_reason?: string | null; delta?: { audio?: { data?: string } } }[] };
        try { chunk = JSON.parse(data); } catch { return; }
        // The bill FIRST: a chunk may carry an error and what the request cost together — the error must not hide the bill.
        if (chunk.usage) usage = chunk.usage;
        if (chunk.error) throw classifyHttp(Number(chunk.error.code) || 500, JSON.stringify({ error: chunk.error }));
        for (const choice of chunk.choices ?? []) {
          if (choice.finish_reason === "content_filter") filtered = true;
          const piece = choice.delta?.audio?.data;
          if (typeof piece === "string" && piece.length) {
            const bytes = Buffer.from(piece, "base64");
            pieces.push(bytes); received += bytes.length;
            // Progress by how much sound has arrived against what the request should give.
            ctx.progress(Math.min(0.95, 0.05 + (0.9 * received) / Math.max(1, expectedSeconds * raw.sampleRate * raw.channels * 2)));
          }
        }
      };
      // A stream that breaks, or ends in an error, after the provider said what it used: the failure carries that bill.
      try {
        for await (const part of response.body as unknown as AsyncIterable<Uint8Array>) {
          pending += decoder.decode(part, { stream: true });
          let end: number;
          while ((end = pending.indexOf("\n")) >= 0) { line(pending.slice(0, end).trim()); pending = pending.slice(end + 1); }
        }
        line(pending.trim());
      } catch (error) { throw billedAs(error instanceof ProviderFailure ? error : classifyThrown(error, ctx.signal), usage); }
      if (!received) throw billedAs(filtered ? new ProviderFailure("content_blocked", "The provider blocked this request under its content policy.", { details: { stage: "output" } }) : new ProviderFailure("invalid_output", "The provider returned no audio."), usage);
      // Raw samples were asked for (`pcm16`): only a real WAV header counts as a container. Samples that happen to
      // begin with 0xFF 0xE? look like an MP3 frame to the sniffer and were stored headerless, which no player or export reads.
      const joined = Buffer.concat(pieces), sniffed = sniffMedia(joined), known = audioOptions.format === "pcm16" && sniffed?.mime !== "audio/wav" ? undefined : sniffed;
      const bytes = known ? joined : wavFromPcm16(joined, raw.sampleRate, raw.channels);
      const seconds = known ? undefined : joined.length / (raw.sampleRate * raw.channels * 2);
      return { outputs: [{ bytes, mime: known?.mime ?? "audio/wav" }], units: { calls: 1, ...(seconds ? { seconds } : {}), ...tokens(usage) }, ...(typeof usage?.cost === "number" ? { costUsd: usage.cost } : {}) };
    });
  }

  /**
   * A clip from a picture and words, through the provider's video endpoint: the request is ACCEPTED as a task
   * (`POST /videos` → its id), asked about until it has ended (`GET /videos/{id}`), and its file fetched
   * (`GET /videos/{id}/content`). The id is handed to the service the moment the task is accepted (`ctx.task.started`);
   * with `ctx.task.resume` nothing is sent again — the same task is waited for. The provider documents no way to
   * cancel a task: a cancel here stops the waiting, and the task may still be made and billed.
   */
  async function video(request: AdapterRequest, ctx: SubmitContext): Promise<AdapterResult> {
    type Task = { id?: string; status?: string; error?: unknown; usage?: Usage; unsigned_urls?: string[] };
    const seconds = request.params.durationSeconds;
    let id = ctx.task?.resume;
    if (!id) {
      const first = request.references?.[0];
      const body = {
        model: request.model, ...(request.params.prompt ? { prompt: request.params.prompt } : {}), ...(seconds !== undefined ? { duration: Math.round(seconds) } : {}), ...(request.params.resolution ? { resolution: request.params.resolution } : {}),
        ...(request.params.aspectRatio ? { aspect_ratio: request.params.aspectRatio } : {}), ...(request.params.seed !== undefined ? { seed: request.params.seed } : {}),
        // A film has its own voices and music: the clip is asked for without sound (and priced so).
        generate_audio: false,
        ...(first ? { frame_images: [{ type: "image_url", image_url: { url: `data:${first.mime};base64,${Buffer.from(first.bytes).toString("base64")}` }, frame_type: "first_frame" }] } : {}),
      };
      ctx.progress(0.02);
      const accepted = await call("/videos", { method: "POST", headers: headers(ctx.secret), body: JSON.stringify(body) }, ctx.signal, REQUEST_TIMEOUT_MS, (response) => response.json() as Promise<Task>);
      if (typeof accepted?.id !== "string" || !accepted.id) throw billedAs(new ProviderFailure("invalid_output", "The provider accepted the video request without naming its task."), accepted?.usage);
      id = accepted.id;
      ctx.task?.started(id);
    }
    const every = opts.videoPollMs ?? VIDEO_POLL.everyMs, path = `/videos/${encodeURIComponent(id)}`;
    const pause = () => new Promise<void>((resolve) => { const timer = setTimeout(done, every); function done() { clearTimeout(timer); ctx.signal.removeEventListener("abort", done); resolve(); } ctx.signal.addEventListener("abort", done, { once: true }); });
    let task: Task = {}, unreachable: ProviderFailure | undefined;
    for (let ask = 1; ask <= VIDEO_POLL.attempts; ask++) {
      if (ctx.signal.aborted) throw new ProviderFailure("cancelled", "Cancelled.", { details: { accepted: true, task: id } });
      try { task = await call(path, { method: "GET", headers: headers(ctx.secret) }, ctx.signal, REQUEST_TIMEOUT_MS, (response) => response.json() as Promise<Task>); unreachable = undefined; } catch (error) {
        // An ask that did not get through is not the task's end: it is asked again at the next turn. What ends the waiting is the task's own state, a refusal that will not change, or the last ask.
        const failure = error as ProviderFailure;
        if (!["network", "timeout", "server_error", "rate_limited", "model_unavailable"].includes(failure.class)) throw Object.assign(failure, { details: { ...failure.details, accepted: true, task: id } });
        unreachable = failure;
      }
      if (task.status === "completed") break;
      if (task.status === "failed" || task.status === "cancelled" || task.status === "expired") {
        const said = typeof task.error === "string" ? task.error : task.error ? JSON.stringify(task.error) : `The video task ${task.status}.`, refused = /content.?policy|safety|moderation|flagged|prohibited|blocked/i.test(said);
        throw billedAs(new ProviderFailure(refused ? "content_blocked" : "server_error", said.slice(0, 600), { details: { accepted: true, ended: task.status, task: id, ...(refused ? { stage: "output" } : {}), providerMessage: said.slice(0, 600) } }), task.usage);
      }
      // No fraction of the work is reported by the provider: the bar shows that it is being waited for, by how many of the asks are used.
      ctx.progress(Math.min(0.9, 0.05 + (0.85 * ask) / VIDEO_POLL.attempts));
      if (ask < VIDEO_POLL.attempts) await pause();
    }
    if (task.status !== "completed") throw new ProviderFailure("timeout", unreachable ? `The video task could not be asked about: ${unreachable.message}` : `The video was not ready after ${VIDEO_POLL.attempts} asks.`, { details: { accepted: true, task: id } });
    const file = await call(`${path}/content?index=0`, { method: "GET", headers: { authorization: `Bearer ${ctx.secret}` } }, ctx.signal, REQUEST_TIMEOUT_MS, async (response) => Buffer.from(await response.arrayBuffer())).catch((error) => { throw billedAs(Object.assign(error as ProviderFailure, { details: { ...(error as ProviderFailure).details, accepted: true, task: id } }), task.usage); });
    if (file.length < 12 || !(file.subarray(4, 8).toString("latin1") === "ftyp" || sniffMedia(file)?.mime === "video/webm")) throw billedAs(new ProviderFailure("invalid_output", "The provider returned a file that is not a video.", { details: { accepted: true, task: id } }), task.usage);
    return { outputs: [{ bytes: file, mime: sniffMedia(file)?.mime === "video/webm" ? "video/webm" : "video/mp4" }], units: { calls: 1, ...(seconds !== undefined ? { seconds } : {}) }, ...(typeof task.usage?.cost === "number" ? { costUsd: task.usage.cost } : {}) };
  }

  return {
    describe: () => ({
      id: "openrouter", label: "OpenRouter", description: "Images, video, speech and music through one OpenRouter key.", source: "server", capabilities: ["image", "video", "tts", "music"], hosts: [host],
      authFields: [{ name: "PROVIDER_OPENROUTER_API_KEY", label: "API key", secret: true }], docsUrl: "https://openrouter.ai/docs",
    }),
    async validateConnection(secret): Promise<ConnectionOutcome> {
      const never = new AbortController();
      try {
        const info = await call("/key", { method: "GET", headers: headers(secret) }, never.signal, VALIDATION_TIMEOUT_MS, (response) => response.json() as Promise<{ data?: { limit_remaining?: number | null } }>);
        if (!info || typeof info !== "object" || !("data" in info)) return { outcome: "endpoint", message: "Unexpected response from the provider" };
        const remaining = info.data?.limit_remaining;
        // A key can be valid on an account that never bought credit: paid models then answer 402. The credit route says so for free.
        const credits = await call("/credits", { method: "GET", headers: headers(secret) }, never.signal, VALIDATION_TIMEOUT_MS, (response) => response.json() as Promise<{ data?: { total_credits?: number; total_usage?: number } }>).catch(() => undefined);
        const balance = typeof credits?.data?.total_credits === "number" ? credits.data.total_credits - (credits.data.total_usage ?? 0) : undefined;
        return (typeof remaining === "number" && remaining <= 0) || (balance !== undefined && balance <= 0) ? { outcome: "quota", statusCode: 200, message: "The key is valid but the account has no credit" } : { outcome: "ok", statusCode: 200, message: "Connected" };
      } catch (error) {
        const failure = error as ProviderFailure, statusCode = failure.statusCode;
        if (failure.class === "auth_error") return { outcome: "invalid_key", statusCode, message: "The provider rejected this API key" };
        if (failure.class === "forbidden") return { outcome: "forbidden", statusCode, message: "The key is not allowed to do this" };
        if (failure.class === "quota_exhausted") return { outcome: "quota", statusCode, message: "The key is valid but the account has no credit" };
        if (failure.class === "network" || failure.class === "timeout") return { outcome: "network", message: "Unable to reach the provider" };
        return { outcome: "endpoint", statusCode, message: "Unexpected response from the provider" };
      }
    },
    /**
     * The provider's own lists, one per kind of model: pictures (`/images/models`, with what each takes and, from its
     * endpoint record, what a picture costs), speech (`/models?output_modalities=speech`, with its voices), sound made
     * by chat models (`…=audio`: music, and the conversational voices), and transcription. A list that cannot be read
     * is left out; when none can, the refresh fails.
     */
    async listModels(secret) {
      const never = new AbortController(), auth = secret ? headers(secret) : { accept: "application/json" };
      const get = <T>(path: string) => call(path, { method: "GET", headers: auth }, never.signal, VALIDATION_TIMEOUT_MS, (response) => response.json() as Promise<T>);
      type Listed = { top_provider?: { max_completion_tokens?: number | null } | null; id: string; name?: string; description?: string; architecture?: { output_modalities?: string[] }; pricing?: Record<string, string | number | undefined>; supported_voices?: string[] | null };
      type Descriptor = { type?: string; values?: string[]; min?: number; max?: number };
      type ImageListed = { id: string; name?: string; description?: string; supported_parameters?: Record<string, Descriptor | undefined> };
      type Endpoints = { endpoints?: { pricing?: { billable?: string; unit?: string; cost_usd?: number; variant?: string }[] }[] };
      type VideoListed = { id: string; name?: string; description?: string; supported_durations?: number[] | null; supported_resolutions?: string[] | null; supported_aspect_ratios?: string[] | null; supported_frame_images?: string[] | null; seed?: boolean | null; pricing_skus?: Record<string, unknown> | null };
      type SpeechEndpoints = { data?: { endpoints?: { supports_voice_cloning?: boolean }[] } };
      const rows: ListedModel[] = [], seen = new Set<string>(), failures: unknown[] = [];
      const add = (row: ListedModel): void => { if (typeof row.id === "string" && !row.id.startsWith("openrouter/") && !seen.has(row.id)) { seen.add(row.id); rows.push(row); } };
      const base = (model: { id: string; name?: string; description?: string }) => ({ id: model.id, label: (model.name ?? model.id).slice(0, 120), ...(model.description ? { description: model.description.slice(0, 300) } : {}) });
      const usd = (value: unknown): number => { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? parsed : 0; }, scaled = (value: unknown, by: number): number => Math.round(usd(value) * by * 1e6) / 1e6;
      const list = async <T>(path: string): Promise<T[]> => { try { return (await get<{ data?: T[] }>(path)).data ?? []; } catch (error) { failures.push(error); return []; } };
      const [images, speech, audio, transcription, videos] = await Promise.all([list<ImageListed>("/images/models"), list<Listed>("/models?output_modalities=speech"), list<Listed>("/models?output_modalities=audio"), list<Listed>("/models?output_modalities=transcription"), list<VideoListed>("/videos/models")]);
      if (failures.length === 5) throw failures[0];

      // Pictures: what a request may ask for is in the list; the price of one picture is in the model's endpoint record.
      const priced = new Map<string, GenerationPricing>();
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(6, images.length) }, async () => {
        while (next < images.length) {
          const model = images[next++];
          try {
            const lines = (await get<Endpoints>(`/images/models/${model.id}/endpoints`)).endpoints?.[0]?.pricing ?? [];
            const reference = lines.find((line) => (line.billable === "input_reference" || line.billable === "input_image") && line.unit === "image")?.cost_usd;
            const price = imagePriceOf(lines);
            if (price) priced.set(model.id, { ...price, ...(typeof reference === "number" ? { referenceUsd: reference } : {}) });
          } catch { /* no endpoint record: the row has no price */ }
        }
      }));
      for (const model of images) {
        const takes = model.supported_parameters ?? {}, shapes = (takes.aspect_ratio?.values ?? []).filter((shape) => /^\d+:\d+$/.test(shape));
        add({ ...base(model), capability: "image", metadata: { ...(shapes.length ? { aspectRatios: shapes } : {}), maxImages: Math.max(1, Math.min(10, takes.n?.max ?? 1)), seed: !!takes.seed, referenceImages: Math.max(0, Math.min(REFERENCES_MAX, takes.input_references?.max ?? 0)) }, ...(priced.has(model.id) ? { pricing: priced.get(model.id)! } : {}) });
      }
      // Video: the models that MAKE a clip of a stated length (an upscaler or an editor of a video is given a video, which nothing here sends). What a request may ask for and what a second costs are in the provider's own list.
      for (const model of videos) {
        const durations = (model.supported_durations ?? []).filter((value) => Number.isInteger(value) && value > 0).sort((a, b) => a - b);
        if (!durations.length) continue;
        const resolutions = (model.supported_resolutions ?? []).filter((value) => typeof value === "string" && /^[0-9A-Za-z]{2,8}$/.test(value)), pricing = videoPriceOf(model.pricing_skus, resolutions);
        add({ ...base(model), capability: "video", metadata: { resumable: true, cancellable: false, aspectRatios: (model.supported_aspect_ratios ?? []).filter((shape) => /^\d+:\d+$/.test(shape)), durations, durationSeconds: { min: durations[0], max: durations[durations.length - 1] }, resolutions, frameImages: (model.supported_frame_images ?? []).filter((value) => typeof value === "string"), seed: model.seed === true, referenceImages: (model.supported_frame_images ?? []).includes("first_frame") ? 1 : 0 }, ...(pricing ? { pricing } : {}) });
      }
      // Speech in the voice of a sample: the provider says per endpoint whether it takes one (`supports_voice_cloning` of the model's endpoint record). A model is said to clone only when EVERY endpoint that may serve it does — a request with a sample is routed to those only, but the price and the voices of a row are one model's.
      const clones = new Set<string>();
      let nextSpeech = 0;
      await Promise.all(Array.from({ length: Math.min(6, speech.length) }, async () => {
        while (nextSpeech < speech.length) {
          const model = speech[nextSpeech++];
          try { const endpoints = (await get<SpeechEndpoints>(`/models/${model.id}/endpoints`)).data?.endpoints ?? []; if (endpoints.some((endpoint) => endpoint.supports_voice_cloning === true)) clones.add(model.id); } catch { /* no endpoint record: nothing is known of cloning, so the row does not say it */ }
        }
      }));
      // Speech: the provider's price is per character of text when only the input is billed, per token otherwise.
      const tokens = (model: Listed): GenerationPricing | undefined => (usd(model.pricing?.prompt) || usd(model.pricing?.completion) ? { kind: "tokens", inputPerMillionUsd: scaled(model.pricing?.prompt, 1e6), outputPerMillionUsd: scaled(model.pricing?.completion, 1e6) } : undefined);
      for (const model of speech) {
        const pricing: GenerationPricing | undefined = usd(model.pricing?.prompt) && !usd(model.pricing?.completion) ? { kind: "per_character", perThousandUsd: scaled(model.pricing?.prompt, 1000) } : tokens(model);
        add({ ...base(model), capability: "tts", metadata: { voices: (model.supported_voices ?? []).filter((voice) => typeof voice === "string" && voice.length > 0 && voice.length <= 80).slice(0, 400).map(voiceOf), instructions: takesInstructions(model.id), voiceClone: clones.has(model.id) }, ...(pricing ? { pricing } : {}) });
      }
      // A chat model that answers in sound is a conversational voice unless its family is a music one.
      for (const model of audio) { const pricing = tokens(model); add({ ...base(model), capability: /lyria|music/i.test(model.id) ? "music" : "tts", ...(pricing ? { pricing } : {}) }); }
      // The longest answer of a listener, where the provider's own list states it: a documented figure, recorded with where it was read.
      for (const model of transcription) { const pricing = tokens(model), longest = model.top_provider?.max_completion_tokens; add({ ...base(model), capability: "transcription", ...(typeof longest === "number" && longest > 0 ? { metadata: { maxOutputTokens: longest, sources: { maxOutputTokens: "the provider's model list (top_provider.max_completion_tokens)" } } } : {}), ...(pricing ? { pricing } : {}) }); }
      return rows;
    },
    // KEEP IN STEP with `translate` and `transcribe` below: the text those requests carry — a translation's messages as they are serialised; a transcription carries sound and no text at all (its model, its format and the code of its language are parameters of the request, not words the model reads).
    textBytes(request) {
      return "translate" in request ? Buffer.byteLength(JSON.stringify(translationMessages(request.translate.prompt)), "utf8") : 0;
    },
    async transcribe(input, ctx) {
      const body = { ...transcriptionSays(input), input_audio: { data: Buffer.from(input.bytes).toString("base64"), format: input.format } };
      const answer = await call("/audio/transcriptions", { method: "POST", headers: headers(ctx.secret), body: JSON.stringify(body) }, ctx.signal, REQUEST_TIMEOUT_MS,
        (response) => response.json() as Promise<{ text?: string; usage?: { cost?: number }; error?: { message?: string; code?: number } }>);
      if (answer.error) throw billedAs(classifyHttp(Number(answer.error.code) || 500, JSON.stringify({ error: answer.error })), answer.usage);
      return { text: String(answer.text ?? ""), ...(typeof answer.usage?.cost === "number" ? { costUsd: answer.usage.cost } : {}) };
    },
    async translate(input, ctx) {
      // The limit of the answer is SENT (`max_tokens`): the provider holds the answer — and, as it documents, a model's thinking — to it. Where the model's row says its thinking can be switched off or turned down, the request asks for that, so the limit is the answer's.
      const body = { model: input.model, messages: translationMessages(input.prompt), stream: false, usage: { include: true }, ...(input.maxOutputTokens ? { max_tokens: input.maxOutputTokens } : {}), ...(input.reasoning ? { reasoning: { effort: input.reasoning } } : {}) };
      const answer = await call("/chat/completions", { method: "POST", headers: headers(ctx.secret), body: JSON.stringify(body) }, ctx.signal, REQUEST_TIMEOUT_MS,
        (response) => response.json() as Promise<{ choices?: { message?: { content?: unknown }; finish_reason?: unknown }[]; usage?: { cost?: number }; error?: { message?: string; code?: number } }>);
      if (answer.error) throw billedAs(classifyHttp(Number(answer.error.code) || 500, JSON.stringify({ error: answer.error })), answer.usage);
      const content = answer.choices?.[0]?.message?.content;
      // WHY the answer ended is read: "length" — it was stopped at the limit — makes the text an unfinished answer, to be said as such.
      return { text: typeof content === "string" ? content : "", ...(typeof answer.usage?.cost === "number" ? { costUsd: answer.usage.cost } : {}), ...(answer.choices?.[0]?.finish_reason === "length" ? { cutOff: true as const } : {}) };
    },
    // KEEP IN STEP with `image`, `video`, `speech` and `submit`: exactly the options their requests carry.
    sends(capability, model) {
      if (capability === "image") return ["aspectRatio", "quality", "count", "seed"];
      // A reader's request (the speech endpoint) carries the voice and the pace; a conversational voice model is asked through chat, with a voice only.
      if (capability === "tts") return /^openai\/gpt-audio/.test(model) ? ["voice"] : takesInstructions(model) ? ["voice", "speed", "instructions"] : ["voice", "speed"];
      // A clip: its length, its shape and its resolution are in the request; it is asked for without sound.
      if (capability === "video") return ["durationSeconds", "aspectRatio", "resolution", "seed"];
      // The length of a music clip is the model's own: it is not in the request.
      if (capability === "music") return ["instrumental"];
      return [];
    },
    async submit(request, ctx) {
      if (request.capability === "image") return { result: await image(request, ctx) };
      if (request.capability === "video") return { result: await video(request, ctx) };
      // A reader goes through the speech endpoint; only the conversational audio models are asked through chat.
      if (request.capability === "tts" && !/^openai\/gpt-audio/.test(request.model)) return { result: await speech(request, ctx) };
      if (request.capability === "tts") {
        const text = request.params.text ?? "", voice = request.params.voice ?? request.metadata.voices?.[0]?.voiceId ?? "alloy";
        const result = await audio(request, ctx, [
          { role: "system", content: "You are a text-to-speech engine. Speak the user's message aloud exactly as written, word for word, in the language it is written in. Do not answer it, do not add, remove or translate anything." },
          { role: "user", content: text },
        ], { voice, format: "pcm16" }, SPEECH_PCM, Math.max(1, text.length / 15));
        return { result: { ...result, units: { ...result.units, characters: text.length } } };
      }
      if (request.capability === "music") {
        const prompt = [request.params.prompt, request.params.instrumental ? "Instrumental only, no vocals." : ""].filter(Boolean).join(" ");
        return { result: await audio(request, ctx, [{ role: "user", content: prompt }], { format: "wav" }, MUSIC_PCM, request.params.durationSeconds ?? 30) };
      }
      throw new ProviderFailure("capability_mismatch", `OpenRouter has no ${request.capability} model in this product.`);
    },
  };
}

/**
 * A voice as the provider lists it, with the language its name carries: Microsoft's voices are `vi-VN-Harper:MAI-Voice-2`
 * (a locale first), Deepgram's `aura-2-ama-ja` (a language last); a name with neither speaks whatever it is given.
 */
export function voiceOf(voiceId: string): NonNullable<GenerationModelMetadata["voices"]>[number] {
  const locale = /^([a-z]{2,3}-[A-Z]{2})-([^:]+)/.exec(voiceId), suffix = /^(.*)-([a-z]{2})$/.exec(voiceId);
  if (locale) return { voiceId, name: `${locale[2]} (${locale[1]})`, languages: [locale[1]], tags: [] };
  if (suffix) return { voiceId, name: suffix[1], languages: [suffix[2]], tags: [] };
  return { voiceId, name: voiceId, languages: ["multi"], tags: [] };
}

/** The messages of a translation request — the one place they are made: what is sent and what is counted (`textBytes`) are the same object. */
const translationMessages = (prompt: string) => [{ role: "user", content: prompt }];
/** What a transcription request says beside its sound. */
const transcriptionSays = (input: { model: string; language?: string }) => ({ model: input.model, ...(input.language ? { language: input.language.slice(0, 2) } : {}) });
const tokens = (usage: Usage | undefined) => ({ ...(typeof usage?.prompt_tokens === "number" ? { inputTokens: usage.prompt_tokens } : {}), ...(typeof usage?.completion_tokens === "number" ? { outputTokens: usage.completion_tokens } : {}) });
