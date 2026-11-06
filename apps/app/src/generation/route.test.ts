// The Generate dialog chooses no model: its requests name the capability only, and the voices it offers are the routed
// model's. Pure functions of `route.ts` (the dialog calls exactly these); no host is involved.
// Run with `node --test apps/app/src/generation/route.test.ts`.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { GenerationVoice } from "@jagentchill/protocol";
import { createRequest, estimateRequest, probeParams, routedOf, voicesOf } from "./route.ts";

test("Every model choice goes through Model routing: a Generate request names no provider and no model", () => {
  for (const kind of ["image", "tts", "music"] as const) {
    const estimate = estimateRequest(kind, probeParams(kind)), create = createRequest(kind, kind === "tts" ? { text: "Hello", voice: "Kore" } : { prompt: "A red kite" }, "prj_1", { confirmed: true, actionId: "generation.create:abc", quoteId: "q1" });
    assert.deepEqual(Object.keys(estimate.items[0]).sort(), ["capability", "params"]);
    assert.ok(!("provider" in create) && !("model" in create), "the host resolves the role; the screen names no model");
    assert.deepEqual([create.capability, create.projectId, create.confirmed, create.actionId, create.quoteId], [kind, "prj_1", true, "generation.create:abc", "q1"]);
  }
});

test("The voices offered are those of the routed speech model, and the model shown is the one the host resolved", () => {
  const voice = (voiceId: string, model: string): GenerationVoice => ({ voiceId, provider: "openrouter", model, name: voiceId, languages: ["en"], tags: [], source: "provider" });
  const voices = [voice("Coral", "openai/tts"), voice("Kore", "google/tts"), voice("Leda", "google/tts")];
  const routed = routedOf({ provider: "openrouter", model: "google/tts", label: "Gemini TTS" });
  assert.deepEqual(routed, { provider: "openrouter", model: "google/tts", label: "Gemini TTS" });
  assert.deepEqual(voicesOf(voices, routed).map((entry) => entry.voiceId), ["Kore", "Leda"]);
  // A role that resolves to nothing: no model is shown and no voice is offered — the screen does not fall back to one of its own.
  assert.equal(routedOf({ provider: null, model: null, label: null }), null);
  assert.deepEqual(voicesOf(voices, null), []);
});
