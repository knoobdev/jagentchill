// LIVE proof of W7 (video for a shot, the accent of a voice, a voice sample) against the REAL OpenRouter — PAID, and
// NOT RUN by the coder who wrote it (brief `w7-film.md`: a paid run is the coordinator's to make).
// What it sends, in this order, each printed with its estimate BEFORE it is sent and refused when the sum would pass the cap:
//   1. VIDEO: one clip started from the still you give (`--still`), on the video model you name (`--video-model`) or,
//      with none named, the cheapest model of the provider's own list that starts from a picture and has a price per
//      second — at its shortest length and lowest resolution, without sound. It answers the open question of the
//      adapter: does the video endpoint take the first frame as a `data:` URL (its documentation shows https URLs only)?
//   2. ACCENT: one Vietnamese sentence spoken three times by the catalogue's recommended voice model, with the delivery
//      instruction of each accent (Northern, Central, Southern). The files are for a PERSON to listen to: nothing here
//      can measure an accent.
//   3. VOICE SAMPLE (only with `--sample <wav|mp3>` and `--clone-model <id>`): one sentence spoken in the sample's voice.
// The key is read from the file named on the command line; it is never printed, logged or written anywhere.
// Usage: node server/scripts/live-w7.ts <key-file> <out-dir> --still <picture.png|jpg> [--cap 0.60] [--video-model <id>] [--sample <file> --clone-model <id>] [--skip video|accent]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { film as fm } from "@jagentchill/editor-core";
import type { GenerationModelMetadata, GenerationPricing } from "@jagentchill/protocol";
import { ProviderFailure, sniffMedia } from "../src/generation/adapter.ts";
import { BUNDLED_MODELS } from "../src/generation/catalogue.ts";
import { OPENROUTER_BASE_URL, createOpenRouterAdapter } from "../src/generation/openrouter.ts";

const [keyFile, outDir, ...rest] = process.argv.slice(2);
const flag = (name: string): string | undefined => { const at = rest.indexOf(name); return at >= 0 ? rest[at + 1] : undefined; };
if (!keyFile || !outDir) throw new Error("usage: live-w7.ts <key-file> <out-dir> --still <picture> [--cap 0.60] [--video-model <id>] [--sample <file> --clone-model <id>] [--skip video|accent]");
const key = readFileSync(keyFile, "utf8").trim(), cap = Number(flag("--cap") ?? "0.60"), skip = flag("--skip");
const scrub = (text: string) => text.split(key).join("[redacted]");
mkdirSync(outDir, { recursive: true });
const adapter = createOpenRouterAdapter(), signal = new AbortController().signal;
const spentAtProvider = async (): Promise<number> => { const response = await fetch(`${OPENROUTER_BASE_URL}/key`, { headers: { authorization: `Bearer ${key}` } }); if (!response.ok) throw new Error(`GET /key answered ${response.status}`); return Number(((await response.json()) as { data: { usage: number } }).data.usage); };
const ctx = (label: string) => ({ secret: key, signal, idempotencyKey: `live-w7-${label}-${Date.now()}`, progress: () => undefined, task: { started: (handle: string) => console.log(`  ${label}: the provider accepted the task ${handle}`) } });
const failed = (error: unknown): string => (error instanceof ProviderFailure ? `${error.class}${error.statusCode ? ` (HTTP ${error.statusCode})` : ""}: ${scrub(error.message)} ${scrub(JSON.stringify(error.details ?? {}))}` : scrub(String(error)));
let planned = 0;
const plan = (what: string, usd: number | null): boolean => {
  if (usd === null) { console.log(`REFUSED ${what}: its price is not known, so it is not sent by this script.`); return false; }
  if (planned + usd > cap + 1e-9) { console.log(`REFUSED ${what}: about $${usd.toFixed(4)} would take this run to $${(planned + usd).toFixed(4)}, past the cap of $${cap.toFixed(2)}.`); return false; }
  planned += usd; console.log(`SENDING ${what}: about $${usd.toFixed(4)} (planned so far $${planned.toFixed(4)} of $${cap.toFixed(2)})`); return true;
};
const before = await spentAtProvider();

if (skip !== "video") {
  const stillPath = flag("--still");
  if (!stillPath) throw new Error("--still <picture> is needed for the video part (or --skip video)");
  const still = readFileSync(stillPath), kind = sniffMedia(still)?.mime ?? "";
  if (!kind.startsWith("image/")) throw new Error(`${stillPath} is not a picture`);
  // The provider's OWN list, read now (public, free): what each model takes and what a second costs.
  const listed = (await adapter.listModels(key)).filter((model) => model.capability === "video");
  const usable = listed.map((model) => { const meta = (model.metadata ?? {}) as Partial<GenerationModelMetadata>, pricing = model.pricing as GenerationPricing | undefined, seconds = [...(meta.durations ?? [])].sort((a, b) => a - b)[0], per = pricing?.kind === "per_second" ? pricing : undefined;
    const cheapest = per ? [...(per.tiers ?? []).map((tier) => ({ resolution: String(tier.when.resolution ?? ""), usd: tier.usd })), ...(per.tiers?.length ? [] : [{ resolution: (meta.resolutions ?? [])[0] ?? "", usd: per.usd }])].sort((a, b) => a.usd - b.usd)[0] : undefined;
    return { model, meta, seconds, cheapest, estimate: per && cheapest && seconds ? cheapest.usd * seconds + (per.referenceUsd ?? 0) : null, takesPicture: (meta.frameImages ?? []).includes("first_frame") }; });
  const wanted = flag("--video-model"), chosen = wanted ? usable.find((entry) => entry.model.id === wanted) : usable.filter((entry) => entry.takesPicture && entry.estimate !== null).sort((a, b) => a.estimate! - b.estimate!)[0];
  if (!chosen) console.log(wanted ? `REFUSED video: the provider's list has no model "${wanted}".` : "REFUSED video: the provider's list has no model that starts from a picture and has a price per second.");
  else if (!chosen.takesPicture) console.log(`REFUSED video: ${chosen.model.id} does not start a clip from a picture.`);
  else if (plan(`video — ${chosen.model.id}, ${chosen.seconds} s at ${chosen.cheapest?.resolution || "its default resolution"}, from ${stillPath} (sent as a data: URL, without sound)`, chosen.estimate)) {
    try {
      const shape = (chosen.meta.aspectRatios ?? []).includes("16:9") ? "16:9" : (chosen.meta.aspectRatios ?? [])[0];
      const { result } = await adapter.submit({ capability: "video", model: chosen.model.id, params: { prompt: "The scene comes to life with gentle, natural movement. The camera stays still.", durationSeconds: chosen.seconds, ...(chosen.cheapest?.resolution ? { resolution: chosen.cheapest.resolution } : {}), ...(shape ? { aspectRatio: shape } : {}) }, metadata: { resumable: true, cancellable: false, ...chosen.meta }, references: [{ bytes: still, mime: kind }] }, ctx("video"));
      const file = join(outDir, `clip.${result.outputs[0].mime === "video/webm" ? "webm" : "mp4"}`);
      writeFileSync(file, result.outputs[0].bytes);
      console.log(`VIDEO OK: ${file} (${result.outputs[0].bytes.length} bytes); the provider said it cost ${typeof result.costUsd === "number" ? `$${result.costUsd}` : "nothing it named"} (estimate $${chosen.estimate!.toFixed(4)}). The first frame as a data: URL WAS accepted.`);
    } catch (error) { console.log(`VIDEO FAILED: ${failed(error)}\n  (a 400 that names frame_images / image_url means the endpoint does not take a data: URL: the host then needs a public URL for the still.)`); }
  }
}

if (skip !== "accent") {
  const voice = BUNDLED_MODELS.find((model) => model.capability === "tts" && model.recommended);
  if (!voice) throw new Error("the catalogue has no recommended voice model");
  const text = "Sáng nay trời se lạnh, cả nhà cùng ra phố uống cà phê.", pricing = voice.pricing, each = pricing?.kind === "per_character" ? (text.length / 1000) * pricing.perThousandUsd : null;
  for (const accent of fm.accentsOf("vi")) {
    if (!plan(`speech — ${voice.id}, "${text}", instructions "${accent.say}"`, each)) continue;
    try {
      const { result } = await adapter.submit({ capability: "tts", model: voice.id, params: { text, language: "vi", instructions: accent.say }, metadata: voice.metadata }, ctx(`accent-${accent.id}`));
      const file = join(outDir, `accent-${accent.id}.wav`);
      writeFileSync(file, result.outputs[0].bytes);
      console.log(`ACCENT ${accent.id}: ${file} — listen to it: nothing here measures an accent.`);
    } catch (error) { console.log(`ACCENT ${accent.id} FAILED: ${failed(error)}`); }
  }
}

const samplePath = flag("--sample"), cloneModel = flag("--clone-model");
if (samplePath && cloneModel) {
  const sample = readFileSync(samplePath), kind = sniffMedia(sample)?.mime ?? "";
  if (!kind.startsWith("audio/")) throw new Error(`${samplePath} is not a recording`);
  const listed = (await adapter.listModels(key)).find((model) => model.capability === "tts" && model.id === cloneModel), text = "Đây là giọng của tôi, được đọc bởi một mô hình.";
  const pricing = listed?.pricing as GenerationPricing | undefined, usd = pricing?.kind === "per_character" ? (text.length / 1000) * pricing.perThousandUsd : null;
  if (!listed) console.log(`REFUSED voice sample: the provider's list has no speech model "${cloneModel}".`);
  else if (listed.metadata?.voiceClone !== true) console.log(`REFUSED voice sample: the provider's endpoint record of ${cloneModel} does not say it takes a voice sample.`);
  else if (plan(`speech in a sample's voice — ${cloneModel}, sample ${samplePath} (${sample.length} bytes, sent to the provider)`, usd)) {
    try {
      const { result } = await adapter.submit({ capability: "tts", model: cloneModel, params: { text, language: "vi" }, metadata: { resumable: false, cancellable: false, ...listed.metadata }, voiceSample: { bytes: sample, mime: kind } }, ctx("clone"));
      const file = join(outDir, `cloned.${result.outputs[0].mime === "audio/wav" ? "wav" : "mp3"}`);
      writeFileSync(file, result.outputs[0].bytes);
      console.log(`VOICE SAMPLE OK: ${file} — listen: is it the sample's voice?`);
    } catch (error) { console.log(`VOICE SAMPLE FAILED: ${failed(error)}`); }
  }
}
const after = await spentAtProvider();
console.log(`\nThe account's usage went from $${before} to $${after}: this run was billed $${(after - before).toFixed(6)} (planned at most $${planned.toFixed(4)}, cap $${cap.toFixed(2)}).`);
