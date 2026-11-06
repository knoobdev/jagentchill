// LIVE pass of the generation adapter against the REAL OpenRouter: one small job per capability on the cheap models,
// with the account's usage read before and after each call (`GET /key`) and the difference reported in USD.
// The key is read from the file named on the command line; it is never printed, logged or written anywhere.
// Usage: node server/scripts/live-generation.ts <key-file> <out-dir> [capUsd=0.5] [only=image,tts,music]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ProviderFailure, sniffMedia } from "../src/generation/adapter.ts";
import { BUNDLED_MODELS } from "../src/generation/catalogue.ts";
import { OPENROUTER_BASE_URL, createOpenRouterAdapter } from "../src/generation/openrouter.ts";

const [keyFile, outDir, capText = "0.5", onlyText = "image,tts,music"] = process.argv.slice(2);
if (!keyFile || !outDir) throw new Error("usage: live-generation.ts <key-file> <out-dir> [capUsd] [only]");
const key = readFileSync(keyFile, "utf8").trim(), cap = Number(capText), only = onlyText.split(",");
const scrub = (text: string) => text.split(key).join("[redacted]");
mkdirSync(outDir, { recursive: true });
const adapter = createOpenRouterAdapter();
const usage = async (): Promise<number> => {
  const response = await fetch(`${OPENROUTER_BASE_URL}/key`, { headers: { authorization: `Bearer ${key}` } });
  if (!response.ok) throw new Error(`GET /key answered ${response.status}`);
  return Number(((await response.json()) as { data: { usage: number } }).data.usage);
};
const JOBS = [
  { capability: "image" as const, model: "openai/gpt-5-image-mini", params: { prompt: "A small red circle on a plain white background.", quality: "low" as const } },
  { capability: "tts" as const, model: "google/gemini-3.8-flash-lite-tts", params: { text: "Về thôi, cả ba mẹ con mình.", voice: "Kore" } },
  { capability: "music" as const, model: "google/lyria-3-clip-preview", params: { prompt: "A calm solo piano melody.", instrumental: true } },
];
const validation = await adapter.validateConnection(key);
console.log(`validateConnection: ${validation.outcome} — ${validation.message}`);
if (validation.outcome !== "ok" && validation.outcome !== "quota") process.exit(2);
if (validation.outcome === "quota" && !process.env.LIVE_TRY_ANYWAY) { console.log("no live job was sent: the account has no credit"); process.exit(3); }
const start = await usage();
let total = 0;
for (const job of JOBS.filter((entry) => only.includes(entry.capability))) {
  if (total >= cap - 0.05) { console.log(`${job.capability}: skipped — the cap of $${cap} would be at risk (spent $${total.toFixed(4)})`); continue; }
  const before = await usage(), started = Date.now(), metadata = BUNDLED_MODELS.find((model) => model.id === job.model)!.metadata;
  try {
    const { result } = await adapter.submit({ capability: job.capability, model: job.model, params: job.params, metadata }, { secret: key, signal: new AbortController().signal, idempotencyKey: `live-${job.capability}`, progress: () => undefined });
    const output = result.outputs[0], kind = sniffMedia(output.bytes), file = join(outDir, `live-${job.capability}.${kind?.extension ?? "bin"}`);
    writeFileSync(file, output.bytes);
    // The account's usage figure can trail the call by a moment.
    let after = await usage();
    for (let wait = 0; wait < 6 && after === before; wait++) { await new Promise((resolve) => setTimeout(resolve, 2500)); after = await usage(); }
    total += after - before;
    console.log(`${job.capability}: ok model=${job.model} file=${file} bytes=${output.bytes.length} mime=${output.mime} container=${kind?.mime ?? "unknown"} reportedCostUsd=${result.costUsd ?? "none"} usageDeltaUsd=${(after - before).toFixed(6)} units=${JSON.stringify(result.units)} ms=${Date.now() - started}`);
  } catch (error) {
    const failure = error instanceof ProviderFailure ? error : null, after = await usage().catch(() => before);
    total += after - before;
    console.log(`${job.capability}: FAILED class=${failure?.class ?? "?"} status=${failure?.statusCode ?? ""} usageDeltaUsd=${(after - before).toFixed(6)} message=${scrub(String(failure?.message ?? error)).slice(0, 400)}`);
  }
}
const end = await usage();
console.log(`total usage difference: $${(end - start).toFixed(6)} (cap $${cap})`);
