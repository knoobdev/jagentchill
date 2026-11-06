// LIVE proof of automatic captions against the REAL OpenRouter — NOT RUN YET (the account was at its cap on 2026-10-07).
// One Vietnamese clip of about ten seconds is made with the real speech model (three sentences in one call), cut at
// its pauses by the SAME function the editor uses (`speechPieces`), each piece is transcribed by the real listener, and
// the cues are compared with the sentences: how many pieces, their times, and how much of each sentence was heard.
// It also prints what `/audio/transcriptions` really returns beside `text` (segment or word times would let the
// product skip the cutting). Models: the catalogue's recommended speech model and listener — no model is named here.
// The key is read from the file named on the command line; it is never printed, logged or written anywhere.
// Usage: node server/scripts/live-captions.ts <key-file> <out-dir> [capUsd=0.10]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cuesOfSpeech, film as fm, speechPieces, wavOfPcm16, writeSrt } from "@jagentchill/editor-core";
import { ProviderFailure, sniffMedia } from "../src/generation/adapter.ts";
import { BUNDLED_MODELS } from "../src/generation/catalogue.ts";
import { OPENROUTER_BASE_URL, createOpenRouterAdapter } from "../src/generation/openrouter.ts";
import { pcmOfWav } from "../src/film/voice-batch.ts";

const [keyFile, outDir, capText = "0.10"] = process.argv.slice(2);
if (!keyFile || !outDir) throw new Error("usage: live-captions.ts <key-file> <out-dir> [capUsd]");
const key = readFileSync(keyFile, "utf8").trim(), cap = Number(capText);
const scrub = (text: string) => text.split(key).join("[redacted]");
mkdirSync(outDir, { recursive: true });
const SENTENCES = ["Sáng nay trời Đà Lạt se lạnh và có sương mù.", "Chúng tôi đi bộ quanh hồ Xuân Hương.", "Buổi chiều cả nhà cùng uống cà phê nóng."];
const adapter = createOpenRouterAdapter(), signal = new AbortController().signal;
const usage = async (): Promise<number> => {
  const response = await fetch(`${OPENROUTER_BASE_URL}/key`, { headers: { authorization: `Bearer ${key}` } });
  if (!response.ok) throw new Error(`GET /key answered ${response.status}`);
  return Number(((await response.json()) as { data: { usage: number } }).data.usage);
};
const pick = (capability: "tts" | "transcription") => { const model = BUNDLED_MODELS.find((entry) => entry.capability === capability && entry.recommended) ?? BUNDLED_MODELS.find((entry) => entry.capability === capability); if (!model) throw new Error(`the catalogue has no ${capability} model`); return model; };
const voice = pick("tts"), listener = pick("transcription");

const validation = await adapter.validateConnection(key);
console.log(`validateConnection: ${validation.outcome} — ${validation.message}`);
if (validation.outcome !== "ok") { console.log("nothing was sent: the key cannot pay for a call"); process.exit(3); }
const start = await usage();
try {
  // 1. The clip: three sentences in one recording, a blank line between them (the speech model pauses there).
  const { result } = await adapter.submit({ capability: "tts", model: voice.id, params: { text: SENTENCES.join("\n\n"), language: "vi" }, metadata: voice.metadata }, { secret: key, signal, idempotencyKey: "live-captions-tts", progress: () => undefined });
  const spoken = result.outputs[0], kind = sniffMedia(spoken.bytes);
  writeFileSync(join(outDir, `live-captions-voice.${kind?.extension ?? "bin"}`), spoken.bytes);
  const pcm = pcmOfWav(spoken.bytes);
  if (!pcm) throw new Error(`the speech came back as ${kind?.mime ?? spoken.mime}, not 16-bit WAV: decode it with ffmpeg before cutting`);
  const seconds = pcm.samples.length / pcm.rate;
  console.log(`speech: model=${voice.id} ${seconds.toFixed(2)} s at ${pcm.rate} Hz, reportedCostUsd=${result.costUsd ?? "none"}`);
  if ((await usage()) - start > cap) throw new Error("the cap was reached by the speech call alone");

  // 2. Cut at the pauses exactly as the editor does, and listen to each piece.
  const pieces = speechPieces(pcm.samples, pcm.rate), cues = [];
  console.log(`pieces: ${pieces.length} (${pieces.map((piece) => `${(piece.from / pcm.rate).toFixed(2)}–${(piece.to / pcm.rate).toFixed(2)}`).join(", ")})`);
  for (const [index, piece] of pieces.entries()) {
    const bytes = wavOfPcm16(pcm.samples.subarray(piece.from, piece.to), pcm.rate);
    if (index === 0) {
      // Once, the raw answer: does the endpoint give segment or word times when asked?
      const raw = await fetch(`${OPENROUTER_BASE_URL}/audio/transcriptions`, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ model: listener.id, input_audio: { data: Buffer.from(bytes).toString("base64"), format: "wav" }, language: "vi", response_format: "verbose_json", timestamp_granularities: ["word", "segment"] }), signal });
      const body = (await raw.json()) as Record<string, unknown>;
      console.log(`raw /audio/transcriptions (verbose asked): HTTP ${raw.status}, fields ${Object.keys(body).join(", ")}; segments=${Array.isArray(body.segments) ? body.segments.length : "none"} words=${Array.isArray(body.words) ? body.words.length : "none"}`);
    }
    const heard = await adapter.transcribe!({ bytes, format: "wav", language: "vi", model: listener.id }, { secret: key, signal });
    cues.push(...cuesOfSpeech(heard.text, (piece.from / pcm.rate) * 1000, (piece.to / pcm.rate) * 1000));
    if ((await usage()) - start > cap) throw new Error(`the cap of $${cap} was reached after piece ${index + 1}`);
  }
  writeFileSync(join(outDir, "live-captions.vi.srt"), writeSrt(cues));

  // 3. Compare: one cue per sentence, in order, saying the sentence.
  console.log(`cues: ${cues.length} for ${SENTENCES.length} sentences`);
  for (const [index, cue] of cues.entries()) console.log(`  ${(cue.start_ms / 1000).toFixed(2)}–${(cue.end_ms / 1000).toFixed(2)} s  "${cue.text}"${SENTENCES[index] ? `  match=${fm.speechMatch(SENTENCES[index], cue.text).toFixed(2)} of "${SENTENCES[index]}"` : "  (no sentence for it)"}`);
  const whole = fm.speechMatch(SENTENCES.join(" "), cues.map((cue) => cue.text).join(" "));
  console.log(`whole text match: ${whole.toFixed(2)} (the product's own threshold for "heard right" is ${fm.SPEECH_MATCH_MIN})`);
  console.log(cues.length === SENTENCES.length && whole >= fm.SPEECH_MATCH_MIN ? "RESULT: ok — one cue per sentence, text heard right" : "RESULT: NOT as expected — read the lines above");
} catch (error) {
  const failure = error instanceof ProviderFailure ? error : null;
  console.log(`FAILED class=${failure?.class ?? "?"} status=${failure?.statusCode ?? ""} message=${scrub(String(failure?.message ?? error)).slice(0, 400)}`);
} finally {
  // The account's usage figure can trail a call by a moment.
  await new Promise((resolve) => setTimeout(resolve, 5000));
  console.log(`total usage difference: $${((await usage().catch(() => start)) - start).toFixed(6)} (cap $${cap})`);
}
