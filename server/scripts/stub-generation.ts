// TEST DOUBLE. A local fake of the generation provider (OpenRouter's wire format): no model, no network, no money.
// It answers `GET /key`, `GET /models`, `POST /images` and `POST /chat/completions` (audio stream) with real, decodable
// files it makes itself — a PNG of one colour, a sine tone — so that the server's real adapter, job queue, blob store
// and the editor run against it. Used by the unit tests and by `apps/app/e2e/generation.mjs`; never by the product.
//
// Scripted behaviour, by markers inside the prompt/text: [fail:503] every time, [fail-once:500] the first time only,
// [rate:2] one 429 with a Retry-After of 2 s, [slow:1500] waits, [blocked] a content-policy refusal, [corrupt] bytes
// that are not media, [partial] one image fewer than asked. Keys: any key works except ones containing "bad" (401)
// and "nocredit" (valid, no credit). `GET /__calls` returns what was asked so far.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { crc32, deflateSync } from "node:zlib";

/** A w×h PNG of one colour. */
export function png(width: number, height: number, rgb: [number, number, number]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]), out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc32(body) >>> 0, body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) row.set(rgb, 1 + x * 3);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))), chunk("IEND", Buffer.alloc(0))]);
}
/** A sine tone as raw 16-bit samples. */
export function tone(seconds: number, sampleRate: number, channels: number, hz = 440): Buffer {
  const frames = Math.round(seconds * sampleRate), out = Buffer.alloc(frames * channels * 2);
  for (let i = 0; i < frames; i++) { const value = Math.round(Math.sin((2 * Math.PI * hz * i) / sampleRate) * 9000); for (let c = 0; c < channels; c++) out.writeInt16LE(value, (i * channels + c) * 2); }
  return out;
}
function wav(pcm: Buffer, sampleRate: number, channels: number): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVEfmt ", 8); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * channels * 2, 28); header.writeUInt16LE(channels * 2, 32); header.writeUInt16LE(16, 34); header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/**
 * `GET /videos/models`, as the real list writes its rows: a model priced by the second per resolution (with a line for
 * sound, which the product does not ask for), one priced by the token (no price can be stated for a clip), and an
 * upscaler (no lengths: it is given a video, so it is not a model that makes a clip).
 */
const VIDEO_MODELS = [
  { id: "stub/video-fast", name: "Stub Video Fast", description: "TEST DOUBLE: a clip from a picture.", supported_resolutions: ["480p", "720p"], supported_aspect_ratios: ["16:9", "9:16", "1:1"], supported_sizes: null, supported_durations: [4, 6, 8, 10], supported_frame_images: ["first_frame"], generate_audio: true, seed: true, pricing_skus: { duration_seconds_with_audio: "0.09", duration_seconds_without_audio_480p: "0.02", duration_seconds_without_audio_720p: "0.03", cents_per_image_input: "1" }, allowed_passthrough_parameters: [] },
  { id: "stub/video-tokens", name: "Stub Video Tokens", supported_resolutions: ["720p"], supported_aspect_ratios: ["16:9"], supported_sizes: null, supported_durations: [5, 10], supported_frame_images: ["first_frame", "last_frame"], generate_audio: true, seed: false, pricing_skus: { video_tokens: "0.000007" }, allowed_passthrough_parameters: [] },
  { id: "stub/video-upscale", name: "Stub Video Upscale", supported_resolutions: null, supported_aspect_ratios: null, supported_sizes: null, supported_durations: null, supported_frame_images: null, generate_audio: false, seed: false, pricing_skus: { cents_per_megapixel_second_precise: "7.5" }, allowed_passthrough_parameters: [] },
];
/** What the double bills a second of video (the 720p line of `stub/video-fast`), and a picture given as a first frame. */
const VIDEO_BILL = { perSecond: { "480p": 0.02, "720p": 0.03 } as Record<string, number>, perPicture: 0.01 };
const clips = new Map<string, Buffer>();
/** A real, decodable MP4 of a moving test pattern, made here with ffmpeg (the double has no model): `seconds` long, in the asked shape. */
export function mp4(seconds: number, aspect = "16:9"): Buffer {
  const size = aspect === "9:16" ? "180x320" : aspect === "1:1" ? "240x240" : "320x180", key = `${seconds}:${size}`, known = clips.get(key);
  if (known) return known;
  const dir = mkdtempSync(join(tmpdir(), "jc-stub-video-")), file = join(dir, "clip.mp4");
  try {
    const made = spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", `testsrc=duration=${seconds}:size=${size}:rate=24`, "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "ultrafast", "-movflags", "+faststart", "-y", file], { timeout: 60_000 });
    if (made.status !== 0) throw new Error(`stub-generation: ffmpeg could not make the test clip: ${String(made.stderr).slice(0, 300)}`);
    const bytes = readFileSync(file);
    clips.set(key, bytes);
    return bytes;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** `GET /images/models`: what each picture model takes; its price is in its endpoint record. */
const IMAGE_MODELS = [
  { id: "openai/gpt-5-image-mini", name: "GPT-5 Image Mini", supported_parameters: { aspect_ratio: { type: "enum", values: ["1:1", "3:2", "2:3", "auto"] }, n: { type: "range", min: 1, max: 10 }, input_references: { type: "range", min: 0, max: 16 } } },
  { id: "stub/new-image-model", name: "Stub New Image", description: "A picture model the bundled catalogue does not have.", supported_parameters: { aspect_ratio: { type: "enum", values: ["1:1", "16:9", "auto"] }, n: { type: "range", min: 1, max: 2 }, input_references: { type: "range", min: 0, max: 3 }, seed: { type: "boolean" } } },
  { id: "stub/token-priced-image", name: "Stub Token Image", supported_parameters: {} },
  { id: "stub/tiered-image", name: "Stub Tiered Image", supported_parameters: { quality: { type: "enum", values: ["low", "high"] } } },
  { id: "stub/sized-image", name: "Stub Sized Image", supported_parameters: {} },
  { id: "google/gemini-3.1-flash-lite-image", name: "Gemini 3.1 Flash Lite Image", supported_parameters: { aspect_ratio: { type: "enum", values: ["1:1", "16:9", "9:16", "21:9"] }, n: { type: "range", min: 1, max: 2 }, input_references: { type: "range", min: 0, max: 14 } } },
];
const IMAGE_PRICES: Record<string, unknown[]> = {
  "stub/new-image-model": [{ billable: "output_image", unit: "image", cost_usd: 0.02 }, { billable: "input_reference", unit: "image", cost_usd: 0.002 }],
  "stub/token-priced-image": [{ billable: "output_image", unit: "token", cost_usd: 0.00003 }],
  // As the real list writes them: one line per variant of the picture.
  "stub/tiered-image": [{ billable: "output_image", unit: "image", cost_usd: 0.003, variant: "low" }, { billable: "output_image", unit: "image", cost_usd: 0.034, variant: "high" }],
  "stub/sized-image": [{ billable: "output_image", unit: "image", cost_usd: 0.05, variant: "1k" }, { billable: "output_image", unit: "image", cost_usd: 0.07, variant: "2k" }],
  // The provider's own record of a model the catalogue ships with.
  "google/gemini-3.1-flash-lite-image": [{ billable: "output_image", unit: "image", cost_usd: 0.025 }, { billable: "input_image", unit: "image", cost_usd: 0.001 }],
};
/** `GET /models?output_modalities=…`: speech models with their voices, the chat models that answer in sound, and the listeners. */
const BY_OUTPUT: Record<string, unknown[]> = {
  speech: [
    { id: "google/gemini-3.8-flash-lite-tts", name: "Gemini 3.8 Flash Lite TTS", architecture: { output_modalities: ["speech"] }, pricing: { prompt: "0.0000005", completion: "0.000006" }, supported_voices: ["Kore", "Puck"] },
    // A local test model whose catalogue deliberately has no price, for hard-budget refusal paths.
    { id: "stub/unpriced-voice", name: "Stub Unpriced Voice", architecture: { output_modalities: ["speech"] }, supported_voices: ["alloy"] },
    // A model that speaks in the voice of a sample (its endpoint record says `supports_voice_cloning`), and has no voices of its own.
    { id: "stub/clone-voice", name: "Stub Clone Voice", architecture: { output_modalities: ["speech"] }, pricing: { prompt: "0.000015", completion: "0" }, supported_voices: [] },
    { id: "stub/locale-voice", name: "Stub Locale Voice", architecture: { output_modalities: ["speech"] }, pricing: { prompt: "0.000015", completion: "0" }, supported_voices: ["en-US-Harper:Stub-Voice", "vi-VN-Grant:Stub-Voice", "vi-VN-Harper:Stub-Voice", "de-DE-Klaus:Stub-Voice", "stub-ama-ja"] },
  ],
  audio: [
    { id: "google/lyria-3-clip-preview", name: "Lyria 3 Clip", architecture: { output_modalities: ["text", "audio"] }, pricing: { prompt: "0", completion: "0" } },
    { id: "stub/lyria-long", name: "Stub Lyria Long", architecture: { output_modalities: ["text", "audio"] }, pricing: { prompt: "0", completion: "0" } },
    { id: "openai/gpt-audio-mini", name: "GPT Audio Mini", architecture: { output_modalities: ["text", "audio"] }, pricing: { prompt: "0.0000006", completion: "0.0000024" } },
  ],
  transcription: [
    { id: "qwen/qwen3-asr-1.7b", name: "Qwen3 ASR 1.7B", architecture: { output_modalities: ["transcription"] }, pricing: { prompt: "0.0000075", completion: "0" } },
    { id: "stub/listener", name: "Stub Listener", architecture: { output_modalities: ["transcription"] }, pricing: { prompt: "0.000002", completion: "0" } },
  ],
};
const MODELS = [
  { id: "openai/gpt-5-image-mini", name: "GPT-5 Image Mini", architecture: { output_modalities: ["image", "text"] } },
  { id: "openai/gpt-audio-mini", name: "GPT Audio Mini", architecture: { output_modalities: ["text", "audio"] } },
  { id: "google/lyria-3-clip-preview", name: "Lyria 3 Clip", architecture: { output_modalities: ["text", "audio"] } },
  { id: "stub/new-image-model", name: "Stub New Image", architecture: { output_modalities: ["image"] } },
  { id: "stub/text-only", name: "Stub Text", architecture: { output_modalities: ["text"] } },
];

/** `references`: how many reference pictures an image request carried (each checked to be a picture sent as a data URL). */
export type StubCall = { path: string; model?: string; text: string; status: number; aspect?: string; quality?: string; references?: number; /** Per reference: its decoded size, its container, and whether it still carries an EXIF block. */ referenceFiles?: { bytes: number; kind: string; exif: boolean }[]; /** The size of the request body. */ bodyBytes?: number; voice?: string; /** speech: the pace that was asked. */ speed?: number; /** speech: the delivery instructions the request carried. */ instructions?: string; /** speech: the voice sample the request carried (its decoded size, its first four bytes) and the transcript beside it. */ voiceSample?: { bytes: number; magic: string; text?: string }; /** video: what the request asked for. */ video?: { duration?: number; resolution?: string; aspect?: string; audio?: boolean; frames: { type?: string; kind: string; bytes: number }[] }; /** video: the task a poll or a download named. */ task?: string };
export type StubGeneration = { server: Server; url: string; calls: StubCall[]; /** The raw body of every POST, in order (a test looks for what must NOT be in a request). */ bodies: string[]; /** The next `times` requests of a text model or a listener answer with an error of this code that ALSO carries a bill of `usd`. */ failBilled(times: number, usd: number, code: number): void; /** Every transcription answers this many ms late from now on. */ slowListening(ms: number): void; /** From now on every request to this model fails with this HTTP status (0: it works again). */ failModel(modelId: string, status: number): void; /** false: the provider's list names no listener from now on (the rows the product ships keep their shipped price). */ listListeners(on: boolean): void; /** false: a transcription answer carries no cost from now on (the host must charge its own declared price). */ reportListeningCost(on: boolean): void; /** The price lines the double's list gives a picture model from now on (as the provider changes its prices). */ setImagePrice(modelId: string, lines: unknown[]): void; /** The next `times` asks about a video task answer 503 (the provider cannot be asked just then). */ failVideoAsks(times: number): void; /** The ids of the video tasks the double accepted, in order. */ videoTasks(): string[]; /** What the double bills from now on (as a provider whose prices are not the catalogue's): a speech call; a text call — a flat amount, or by the tokens it counts (four characters a token) with `extraOutputTokens` more written than the answer needs, cut at the request's `max_tokens` when it carries one. */ bill(costs: { speech?: number; chat?: number | { inputPerToken: number; outputPerToken: number; extraOutputTokens?: number; /** The tokens the double counts for a byte it WRITES; with it an answer longer than the request's `max_tokens` is cut there and says `finish_reason: "length"`. */ outputTokensPerByte?: number; /** How many tokens the double counts a character of the prompt as (0.25 — four characters a token — unless said; 1: a tokenizer that takes every character for a token, as for text that is not plain English). */ tokensPerCharacter?: number }; image?: number }): void; close(): Promise<void> };

const kindOf = (file: Buffer): "png" | "jpeg" | "webp" | "other" => (file.subarray(1, 4).toString("latin1") === "PNG" ? "png" : file[0] === 0xff && file[1] === 0xd8 ? "jpeg" : file.subarray(0, 4).toString("latin1") === "RIFF" && file.subarray(8, 12).toString("latin1") === "WEBP" ? "webp" : "other");
export function startStubGeneration(port = 0): Promise<StubGeneration> {
  const calls: StubCall[] = [], bodies: string[] = [], seen = new Map<string, number>(), spoken = new Map<number, string>(), misheard = new Map<string, number>(), drifted = new Map<string, number>();
  let listenDelay = 0, listeners = true, listeningCost = true, pollFailures = 0;
  /** The video tasks the double accepted: each is "made" after it was asked about `needs` times. */
  const tasks = new Map<string, { text: string; duration: number; aspect: string; asks: number; needs: number; cost: number }>();
  const base = (): string => { const address = server.address(); return `http://127.0.0.1:${typeof address === "object" && address ? address.port : port}`; };
  // The next requests of a text model or a listener that answer with an error AND a bill (`failBilled`).
  let billedFailures: { left: number; usd: number; code: number } | undefined;
  const billed: { speech?: number; chat?: number | { inputPerToken: number; outputPerToken: number; extraOutputTokens?: number; tokensPerCharacter?: number; outputTokensPerByte?: number }; image?: number } = {};
  const failing = new Map<string, number>();
  const prices: Record<string, unknown[]> = { ...IMAGE_PRICES };
  const read = (req: IncomingMessage) => new Promise<string>((resolve) => { let text = ""; req.on("data", (piece) => (text += piece)); req.on("end", () => resolve(text)); });
  const server = createServer(async (req, res) => {
    const path = (req.url ?? "/").split("?")[0], key = String(req.headers.authorization ?? "").replace(/^Bearer /, "");
    const json = (status: number, body: unknown, extra: Record<string, string> = {}) => { res.writeHead(status, { "content-type": "application/json", ...extra }); res.end(JSON.stringify(body)); };
    if (path === "/__calls") return json(200, { calls });
    if (path === "/images/models") return json(200, { data: IMAGE_MODELS });
    if (path === "/videos/models") return json(200, { data: VIDEO_MODELS });
    const speechEndpoints = /^\/models\/(.+)\/endpoints$/.exec(path);
    if (speechEndpoints) return json(200, { data: { id: speechEndpoints[1], endpoints: [{ provider_name: "Stub", supports_voice_cloning: speechEndpoints[1] === "stub/clone-voice", supports_multiple_audio_references: false, supports_image_reference: false }] } });
    const endpoints = /^\/images\/models\/(.+)\/endpoints$/.exec(path);
    if (endpoints) return json(200, { id: endpoints[1], endpoints: [{ provider_name: "Stub", pricing: prices[endpoints[1]] ?? [] }] });
    if (path === "/models") { const output = new URL(req.url ?? "/", "http://stub").searchParams.get("output_modalities"); return json(200, { data: output ? (output === "transcription" && !listeners ? [] : BY_OUTPUT[output] ?? []) : MODELS }); }
    if (key.includes("bad") || !key) return json(401, { error: { message: "No auth credentials found", code: 401 } });
    if (path === "/key") return json(200, { data: { label: "stub", usage: 0, limit: null, limit_remaining: null } });
    if (path === "/credits") return json(200, { data: key.includes("nocredit") ? { total_credits: 0, total_usage: 0.001 } : { total_credits: 10, total_usage: 1 } });
    // A video task is asked about, and its file fetched, with the key (as the real endpoints).
    const asked = /^\/videos\/([^/]+)(\/content)?$/.exec(path);
    if (req.method === "GET" && asked) {
      const task = tasks.get(asked[1]);
      if (!task) { calls.push({ path, text: "", status: 404, task: asked[1] }); return json(404, { error: { message: "No such video job", code: 404 } }); }
      if (asked[2]) { calls.push({ path: "/videos/:id/content", text: task.text, status: 200, task: asked[1] }); res.writeHead(200, { "content-type": "video/mp4" }); return void res.end(task.text.includes("[corrupt]") ? Buffer.from("this is not a video at all, only some text bytes") : mp4(task.duration, task.aspect)); }
      task.asks++;
      if (pollFailures > 0) { pollFailures--; calls.push({ path: "/videos/:id", text: task.text, status: 503, task: asked[1] }); return json(503, { error: { message: "Upstream busy", code: 503 } }); }
      calls.push({ path: "/videos/:id", text: task.text, status: 200, task: asked[1] });
      const common = { id: asked[1], generation_id: asked[1], polling_url: `/api/v1/videos/${asked[1]}` };
      if (task.asks < task.needs) return json(200, { ...common, status: task.asks === 1 ? "pending" : "in_progress" });
      if (task.text.includes("[video-fail]")) return json(200, { ...common, status: "failed", error: "The model could not make this video" });
      if (task.text.includes("[video-blocked]")) return json(200, { ...common, status: "failed", error: "Content policy violation" });
      return json(200, { ...common, status: "completed", unsigned_urls: [`${base()}/videos/${asked[1]}/content?index=0`], usage: { cost: task.cost, is_byok: false } });
    }
    if (req.method !== "POST" || (path !== "/images" && path !== "/videos" && path !== "/chat/completions" && path !== "/audio/speech" && path !== "/audio/transcriptions")) return json(404, { error: { message: "Not found", code: 404 } });
    const sent = await read(req);
    bodies.push(sent);
    const body = JSON.parse(sent || "{}") as { model?: string; prompt?: string; n?: number; aspect_ratio?: string; quality?: string; audio?: { format?: string }; input?: string; voice?: string; speed?: number; response_format?: string; input_audio?: { data?: string; format?: string }; input_references?: { type?: string; text?: string; image_url?: { url?: string }; input_audio?: { data?: string } }[]; instructions?: string; duration?: number; resolution?: string; generate_audio?: boolean; frame_images?: { type?: string; frame_type?: string; image_url?: { url?: string } }[]; messages?: { role: string; content: string }[] };
    // speech: a voice sample rides as an `input_audio` part of `input_references` (a data URL), its transcript as a `text` part beside it.
    const sampleData = path === "/audio/speech" ? (body.input_references ?? []).find((entry) => entry.type === "input_audio")?.input_audio?.data : undefined, sample = sampleData ? Buffer.from(/^data:audio\/[a-z0-9.+-]+;base64,(.+)$/.exec(sampleData)?.[1] ?? "", "base64") : undefined, sampleText = path === "/audio/speech" ? (body.input_references ?? []).find((entry) => entry.type === "text")?.text : undefined;
    const text = body.prompt ?? body.input ?? body.messages?.filter((message) => message.role === "user").map((message) => message.content).join(" ") ?? "";
    const note = (status: number) => calls.push({ path, ...(body.model ? { model: body.model } : {}), text, status, ...(body.aspect_ratio ? { aspect: body.aspect_ratio } : {}), ...(body.quality ? { quality: body.quality } : {}), ...(path === "/images" ? { references: (body.input_references ?? []).length, referenceFiles: (body.input_references ?? []).map((entry) => { const file = Buffer.from(/^data:image\/[a-z]+;base64,(.+)$/.exec(entry.image_url?.url ?? "")?.[1] ?? "", "base64"); return { bytes: file.length, kind: kindOf(file), exif: file.includes("Exif\0\0", 0, "latin1") }; }), bodyBytes: sent.length } : {}), ...(body.voice ? { voice: body.voice } : {}), ...(typeof body.speed === "number" ? { speed: body.speed } : {}), ...(typeof body.instructions === "string" ? { instructions: body.instructions } : {}), ...(sample ? { voiceSample: { bytes: sample.length, magic: sample.subarray(0, 4).toString("latin1"), ...(sampleText !== undefined ? { text: sampleText } : {}) } } : {}),
      ...(path === "/videos" ? { video: { ...(typeof body.duration === "number" ? { duration: body.duration } : {}), ...(body.resolution ? { resolution: body.resolution } : {}), ...(body.aspect_ratio ? { aspect: body.aspect_ratio } : {}), ...(typeof body.generate_audio === "boolean" ? { audio: body.generate_audio } : {}), frames: (body.frame_images ?? []).map((entry) => { const file = Buffer.from(/^data:image\/[a-z]+;base64,(.+)$/.exec(entry.image_url?.url ?? "")?.[1] ?? "", "base64"); return { type: entry.frame_type, kind: kindOf(file), bytes: file.length }; }) } } : {}) });
    const times = (seen.get(text) ?? 0) + 1;
    seen.set(text, times);
    const slow = /\[slow:(\d+)\]/.exec(text);
    if (slow) await new Promise((resolve) => setTimeout(resolve, Number(slow[1])));
    if (res.destroyed || res.socket?.destroyed) return void note(499);
    const fail = (failing.get(body.model ?? "") ? [ "", String(failing.get(body.model ?? "")) ] : null) ?? /\[fail:(\d+)\]/.exec(text) ?? (times === 1 ? /\[fail-once:(\d+)\]/.exec(text) : null);
    if (fail) { note(Number(fail[1])); return json(Number(fail[1]), { error: { message: `Stub failure ${fail[1]} (key ${key})`, code: Number(fail[1]) } }); }
    const rate = times === 1 ? /\[rate:(\d+)\]/.exec(text) : null;
    if (rate) { note(429); return json(429, { error: { message: "Rate limited", code: 429 } }, { "retry-after": rate[1] }); }
    // As the real endpoint: a reference is `{ type: "image_url", image_url: { url } }` whose URL holds a picture.
    const bad = (body.input_references ?? []).find((entry) => { const data = /^data:image\/[a-z]+;base64,(.+)$/.exec(entry.image_url?.url ?? "")?.[1]; return entry.type !== "image_url" || !data || kindOf(Buffer.from(data, "base64")) === "other"; });
    if (path === "/images" && bad) { note(400); return json(400, { error: { message: "input_references: not an image", code: 400 } }); }
    // As the real endpoint: a request that carries a voice sample is served only by a model whose endpoint takes one, and never together with a voice id.
    if (path === "/audio/speech" && (body.input_references ?? []).length && (body.model !== "stub/clone-voice" || !sample?.length || body.voice)) { note(400); return json(400, { error: { message: "Provider rejected the request: this endpoint takes no voice reference", code: 400 } }); }
    if (text.includes("[blocked]")) { note(403); return json(403, { error: { message: "Your input was flagged", code: 403, metadata: { reasons: ["violence"] } } }); }
    note(200);
    if (billedFailures && billedFailures.left > 0 && (path === "/audio/transcriptions" || (path === "/chat/completions" && !(body as { audio?: unknown }).audio))) {
      billedFailures.left--;
      return json(200, { error: { message: "The upstream model failed after it was billed.", code: billedFailures.code }, usage: { prompt_tokens: 20, completion_tokens: 0, cost: billedFailures.usd } });
    }
    if (path === "/videos") {
      // As the real endpoint: the request is ACCEPTED as a task (202, its id) and nothing is made yet. What it asks for is checked against the model's list, like the real one ("Unsupported values return a 400 with the supported values").
      const model = VIDEO_MODELS.find((entry) => entry.id === body.model), frame = (body.frame_images ?? [])[0], picture = frame ? Buffer.from(/^data:image\/[a-z]+;base64,(.+)$/.exec(frame.image_url?.url ?? "")?.[1] ?? "", "base64") : undefined;
      const wrong = !model?.supported_durations ? "model: not a video generation model" : !model.supported_durations.includes(body.duration ?? -1) ? `duration: supported values are ${model.supported_durations.join(", ")}` : body.resolution && !model.supported_resolutions!.includes(body.resolution) ? `resolution: supported values are ${model.supported_resolutions!.join(", ")}` : frame && (frame.type !== "image_url" || frame.frame_type !== "first_frame" || !picture || kindOf(picture) === "other") ? "frame_images: not an image" : undefined;
      if (wrong) { calls[calls.length - 1].status = 400; return json(400, { error: { message: wrong, code: 400 } }); }
      const id = `gen-vid-${1789480874 + tasks.size}-${createHash("sha256").update(`${tasks.size}:${text}`).digest("hex").slice(0, 20)}`, needs = Number(/\[video-asks:(\d+)\]/.exec(text)?.[1] ?? 2);
      tasks.set(id, { text, duration: body.duration!, aspect: body.aspect_ratio ?? "16:9", asks: 0, needs, cost: Math.round(((VIDEO_BILL.perSecond[body.resolution ?? "720p"] ?? 0.03) * body.duration! + (frame ? VIDEO_BILL.perPicture : 0)) * 1e6) / 1e6 });
      return json(202, { id, polling_url: `/api/v1/videos/${id}`, status: "pending" });
    }
    if (path === "/audio/transcriptions") {
      if (listenDelay) await new Promise((resolve) => setTimeout(resolve, listenDelay));
      // The double "hears" by loudness: every paragraph it speaks has its own level, so a recording — or a piece cut
      // out of one — is recognised by its peak. A line carrying [misread] is heard wrong once.
      const file = Buffer.from(body.input_audio?.data ?? "", "base64"), raw = file.subarray(0, 4).toString("latin1") === "RIFF" ? file.subarray(44) : file;
      let peak = 0;
      for (let at = 0; at + 1 < raw.length; at += 2) { const value = Math.abs(raw.readInt16LE(at)); if (value > peak) peak = value; }
      let said = "", near = Number.POSITIVE_INFINITY;
      for (const [level, words] of spoken) { const off = Math.abs(level - peak); if (off < near) { near = off; said = words; } }
      if (near > 40) said = "";
      const wrong = said.includes("[misread]") && (misheard.get(said) ?? 0) < 1;
      if (wrong) misheard.set(said, (misheard.get(said) ?? 0) + 1);
      // A line carrying [slur] is heard with two of its words wrong, once: close enough to be laid over its line, not close enough to pass.
      const slurred = !wrong && said.includes("[slur]") && (misheard.get(said) ?? 0) < 1;
      if (slurred) misheard.set(said, (misheard.get(said) ?? 0) + 1);
      return json(200, { text: wrong ? "something else entirely was said here" : slurred ? said.split(/\s+/).map((word, index, all) => (index >= all.length - 2 ? "blur" : word)).join(" ") : said, usage: { seconds: 1, ...(listeningCost ? { cost: 0.00002 } : {}) } });
    }
    if (path === "/audio/speech") {
      // As the real endpoint: raw 16-bit samples at 24 kHz mono, about fifteen characters a second. The paragraphs of
      // the text are spoken one after the other with a pause between them: one PITCH per voice (a voice is one
      // person), one LEVEL per paragraph (so the double can tell later which line a piece is).
      const parts = text.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean), pieces: Buffer[] = [];
      const hz = 140 + (createHash("sha256").update(body.voice ?? "").digest().readUInt16LE(0) % 12) * 10;
      parts.forEach((part, index) => {
        const level = 4000 + (createHash("sha256").update(part).digest().readUInt16LE(0) % 200) * 100, seconds = Math.max(1, Math.min(8, part.length / 15)), frames = Math.round(seconds * 24_000), piece = Buffer.alloc(frames * 2);
        // A paragraph carrying [drift] is spoken in another voice (a third lower) the first time it is spoken.
        const drifting = part.includes("[drift]") && (drifted.get(part) ?? 0) < 1, pitch = drifting ? hz * 0.7 : hz;
        if (drifting) drifted.set(part, 1);
        for (let frame = 0; frame < frames; frame++) piece.writeInt16LE(Math.round(Math.sin((2 * Math.PI * pitch * frame) / 24_000) * level), frame * 2);
        spoken.set(level, part);
        if (index) pieces.push(Buffer.alloc(Math.round(0.7 * 24_000) * 2));
        pieces.push(piece);
      });
      const samples = text.includes("[corrupt]") ? Buffer.alloc(0) : Buffer.concat(pieces);
      res.writeHead(200, { "content-type": "audio/pcm;rate=24000;channels=1" });
      return void res.end(samples);
    }
    if (path === "/images") {
      const [w, h] = body.aspect_ratio === "16:9" ? [64, 36] : body.aspect_ratio === "9:16" ? [36, 64] : [48, 48];
      // [http+bill:<status>]: the provider answers with that HTTP status — not a success — and a body that ALSO says what the request was billed.
      const billedStatus = /\[http\+bill:(\d+)\]/.exec(text);
      if (billedStatus) return json(Number(billedStatus[1]), { error: { message: "The upstream model failed after it started.", code: Number(billedStatus[1]) }, usage: { prompt_tokens: 0, completion_tokens: 0, cost: billed.image ?? 0.011 } });
      // [empty]: the provider answers with no picture at all — and bills the request all the same.
      if (text.includes("[empty]")) return json(200, { created: 1, data: [], usage: { prompt_tokens: 0, completion_tokens: 0, cost: billed.image ?? 0.011 } });
      const count = Math.max(0, (body.n ?? 1) - (text.includes("[partial]") ? 1 : 0));
      const bytes = text.includes("[corrupt]") ? Buffer.from("this is not an image at all, only some text bytes") : png(w, h, [40 + (text.length * 7) % 200, 120, 200]);
      return json(200, { created: 1, data: Array.from({ length: count }, () => ({ b64_json: bytes.toString("base64"), media_type: "image/png" })), usage: { prompt_tokens: 0, completion_tokens: 100, cost: (billed.image ?? 0.011) * count } });
    }
    if (path === "/chat/completions" && !(body as { audio?: unknown }).audio) {
      // A text model: the double "translates" the JSON array of the last line by putting the target language's name
      // before each entry. A line carrying [blank] comes back empty; [miscount] loses its last entry the first time.
      const asked = /into ([^.\n]+)\./.exec(text)?.[1] ?? "?", line = text.split("\n").filter((part) => part.startsWith("[")).pop() ?? "[]";
      let entries: string[] = []; try { entries = JSON.parse(line) as string[]; } catch { /* not the translation prompt */ }
      const out = entries.map((entry) => (entry.includes("[blank]") ? "" : entry.includes("[wordy]") ? Array.from({ length: 8 }, () => `[${asked}] ${entry}`).join(" ") : `[${asked}] ${entry}`));
      if (text.includes("[miscount]") && (misheard.get(line) ?? 0) < 1) { misheard.set(line, 1); out.pop(); }
      const content = JSON.stringify(out), limit = (body as { max_tokens?: number }).max_tokens;
      // A provider that counts the tokens it writes (`outputTokensPerByte`) and stops AT the request's limit, saying so: the text is cut where the limit fell.
      if (typeof billed.chat === "object" && billed.chat.outputTokensPerByte && limit) {
        const rate = billed.chat.outputTokensPerByte, whole = Buffer.from(content, "utf8"), needed = Math.ceil(whole.length * rate), read = Math.ceil(text.length * (billed.chat.tokensPerCharacter ?? 0.25)), written = Math.min(limit, needed);
        return json(200, { choices: [{ message: { role: "assistant", content: needed > limit ? whole.subarray(0, Math.floor(limit / rate)).toString("utf8") : content }, finish_reason: needed > limit ? "length" : "stop" }], usage: { prompt_tokens: read, completion_tokens: written, cost: Math.round((read * billed.chat.inputPerToken + written * billed.chat.outputPerToken) * 1e6) / 1e6 } });
      }
      if (typeof billed.chat === "object") {
        const read = Math.ceil(text.length * (billed.chat.tokensPerCharacter ?? 0.25)), wanted = Math.ceil(content.length / 4) + (billed.chat.extraOutputTokens ?? 0), written = limit ? Math.min(limit, wanted) : wanted;
        return json(200, { choices: [{ message: { role: "assistant", content } }], usage: { prompt_tokens: read, completion_tokens: written, cost: Math.round((read * billed.chat.inputPerToken + written * billed.chat.outputPerToken) * 1e6) / 1e6 } });
      }
      return json(200, { choices: [{ message: { role: "assistant", content } }], usage: { prompt_tokens: 20, completion_tokens: 20, cost: billed.chat ?? 0.00003 } });
    }
    const music = /lyria|music/.test(body.model ?? ""), seconds = music ? 3 : Math.max(1, Math.min(8, text.length / 15));
    const samples = music ? wav(tone(seconds, 48_000, 2, 220), 48_000, 2) : tone(seconds, 24_000, 1);
    const sound = text.includes("[corrupt]") ? Buffer.from("not audio".repeat(40)) : samples;
    res.writeHead(200, { "content-type": "text/event-stream" });
    // [error+bill:<code>]: the stream's one chunk is an error that ALSO says what the request was billed.
    const billedError = /\[error\+bill:(\d+)\]/.exec(text);
    if (billedError) { res.write(`data: ${JSON.stringify({ error: { message: "The upstream model failed after it started.", code: Number(billedError[1]) }, usage: { prompt_tokens: 12, completion_tokens: 0, cost: music ? 0.04 : billed.speech ?? 0.0004 } })}\n\ndata: [DONE]\n\n`); res.end(); return; }
    const step = 48_000;
    for (let offset = 0; offset < sound.length && !res.destroyed; offset += step) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { audio: { data: sound.subarray(offset, offset + step).toString("base64") } } }] })}\n\n`);
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 40, cost: music ? 0.04 : billed.speech ?? 0.0004 } })}\n\ndata: [DONE]\n\n`);
    res.end();
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => {
    const address = server.address();
    resolve({ server, url: `http://127.0.0.1:${typeof address === "object" && address ? address.port : port}`, calls, bodies, slowListening: (ms: number) => { listenDelay = ms; }, failModel: (modelId: string, status: number) => { if (status) failing.set(modelId, status); else failing.delete(modelId); }, listListeners: (on: boolean) => { listeners = on; }, reportListeningCost: (on: boolean) => { listeningCost = on; }, failBilled: (times: number, usd: number, code: number) => { billedFailures = { left: times, usd, code }; }, bill: (costs) => { Object.assign(billed, costs); }, setImagePrice: (modelId: string, lines: unknown[]) => { prices[modelId] = lines; }, failVideoAsks: (times: number) => { pollFailures = times; }, videoTasks: () => [...tasks.keys()], close: () => new Promise((done) => { server.closeAllConnections(); server.close(() => done()); }) });
  }));
}

if (import.meta.main) {
  const port = Number(process.argv[2] ?? process.env.STUB_GENERATION_PORT ?? 18942);
  const stub = await startStubGeneration(port);
  console.log(`stub-generation (TEST DOUBLE) listening on ${stub.url}`);
}
