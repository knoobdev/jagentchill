import assert from "node:assert/strict";
import { test } from "node:test";
import type { LocalInstall, LocalModelsView, OrcRoleConfig } from "@jagentchill/protocol";
import { canDownload, defaultQuant, percentOf, progressText, usedByImageRole, withLocalImageRole } from "./local-models.ts";

const verdict = (quant: "q4" | "q5" | "q6" | "q8", kind: "well" | "slow" | "memory", recommended = false) => ({ variant: "standard" as const, quant, verdict: kind, reasons: [], needs: { memoryBytes: 1, diskBytes: 1 }, downloadBytes: 10, remainingBytes: 10, recommended });
const view = (over: Partial<LocalModelsView>): LocalModelsView => ({ folder: "/m", engine: { name: "e", version: "v", sourceUrl: "", build: null }, license: { name: "l", url: "" }, variants: [], installs: [], hardware: null, verdicts: [], settings: { maxSide: 1024, timeLimitMinutes: 30 }, generating: false, ...over });
const install = (over: Partial<LocalInstall>): LocalInstall => ({ variant: "standard", quant: "q4", modelId: "qwen-image-2.1", state: "downloading", bytesDone: 0, bytesTotal: 0, files: [], started_ms: 0, updated_ms: 0, ...over });

test("Local models card: the quant it starts on is the installed one, else the check's recommendation, else the smallest; a download starts only where the check says it can run", () => {
  assert.equal(defaultQuant(view({ verdicts: [verdict("q4", "well"), verdict("q8", "well", true)] }), "standard"), "q8");
  assert.equal(defaultQuant(view({ verdicts: [verdict("q8", "well", true)], installs: [install({ quant: "q5", state: "installed" })] }), "standard"), "q5");
  assert.equal(defaultQuant(null, "uncensored"), "q4");
  assert.deepEqual([canDownload(verdict("q4", "well")), canDownload(verdict("q4", "slow")), canDownload(verdict("q4", "memory")), canDownload(undefined)], [true, true, false, true]);
});

test("Local models card: progress in bytes, rate and time left", () => {
  assert.deepEqual(progressText(install({ bytesDone: 2_000_000_000, bytesTotal: 10_000_000_000 })), { text: "{done} of {total}", params: { done: "2.0 GB", total: "10.0 GB" } });
  assert.equal(progressText(install({ bytesDone: 2_000_000_000, bytesTotal: 10_000_000_000, rateBps: 20_000_000 })).params.left, "7 min");
  assert.equal(percentOf(install({ bytesDone: 1, bytesTotal: 3 })), 33.3);
});

test("Local models card: Use for the Image role puts the local model first and keeps the role's earlier primary as its first fallback", () => {
  const cloud: OrcRoleConfig = { enabled: true, profiles: [{ id: "main", provider: "openrouter", model: "openai/gpt-5-image-mini", params: {}, enabled: true }], defaultProfileId: "main", routes: { default: { primary: { profileId: "main" }, fallbacks: [] } }, limits: {} };
  const next = withLocalImageRole(cloud, "qwen-image-2.1", "On this computer");
  assert.deepEqual([next.defaultProfileId, next.routes.default!.primary.profileId, next.routes.default!.fallbacks.map((entry) => entry.profileId), next.profiles.map((entry) => entry.id)], ["local", "local", ["main"], ["main", "local"]]);
  assert.equal(usedByImageRole({ version: 1, enabled: true, autoPrepareBrief: true, askWhenAmbiguous: true, roles: { image: next } }, "qwen-image-2.1"), true);
  assert.equal(usedByImageRole({ version: 1, enabled: true, autoPrepareBrief: true, askWhenAmbiguous: true, roles: { image: cloud } }, "qwen-image-2.1"), false);
  const fresh = withLocalImageRole(undefined, "qwen-image-2.1-uncensored", "On this computer");
  assert.deepEqual([fresh.profiles[0]!.id, fresh.profiles[0]!.model, fresh.routes.default!.fallbacks], ["local-uncensored", "qwen-image-2.1-uncensored", []]);
  // Again: the same profile, not a second one.
  assert.equal(withLocalImageRole(next, "qwen-image-2.1", "On this computer").profiles.length, 2);
});
