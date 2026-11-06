// Pure: the cost cell of a step of the one-prompt video estimate. Run with `node --test apps/app/src/prompt-video/strings.test.ts`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { promptVideo as pv } from "@jagentchill/editor-core";
import { setFormatLocale } from "@jagentchill/app-core";
import { partUsd, stageCost } from "./strings.ts";

setFormatLocale("en");
const stage = (patch: Partial<pv.StageEstimate>): pv.StageEstimate => ({ stage: "x", label: "X", count: 1, unitUsd: 0, lowUsd: 0, highUsd: 0, source: "Chat model", ...patch });

test("w7 item 4: no \"$0.00\" row — own-account work is no money row, a step that is not used or that no model does has no price, and a real amount under one cent reads \"less than $0.01\"", () => {
  // The estimate of a run whose writing runs on the person's own Codex account, with a voice that costs a fraction of a cent.
  const stages = [
    stage({ stage: "brief", label: "Brief", source: "gpt-5-codex", ownAccount: true }), stage({ stage: "script_draft", label: "Script", source: "gpt-5-codex", ownAccount: true }),
    stage({ stage: "assets", label: "Pictures", count: 6, unitUsd: 0.034, lowUsd: 0.204, highUsd: 0.408, source: "GPT-5 Image Mini" }),
    stage({ stage: "voiceover", label: "Voice", count: 6, unitUsd: 0.0006, lowUsd: 0.0036, highUsd: 0.0072, source: "Speech Mini" }),
    stage({ stage: "music", label: "Music", count: 0, unitUsd: null, lowUsd: 0, highUsd: 0, source: "No provider" }),
    stage({ stage: "assemble", label: "Assemble", source: "No model" }),
  ];
  // Money rows: what is used and billed by this app. (Before: every stage was a row, the own-account ones as "Chat model $0.00".)
  assert.deepEqual(pv.moneyStages(stages).map((entry) => entry.stage), ["assets", "voiceover"]);
  const cells = Object.fromEntries(stages.filter((entry) => !entry.ownAccount).map((entry) => { const cost = stageCost(entry); return [entry.stage, cost.kind === "amount" ? cost.text : cost.kind]; }));
  assert.deepEqual(cells, { assets: "$0.20 – 0.41", voiceover: "less than $0.01", music: "none", assemble: "none" });
  for (const text of Object.values(cells)) assert.doesNotMatch(String(text), /\$0\.00(?!\d)/, "no zero price is shown");
  // A step whose low end is under one cent and whose high end is not shows the high figure, not a range that starts at "less than".
  assert.deepEqual(stageCost(stage({ count: 2, unitUsd: 0.006, lowUsd: 0.006, highUsd: 0.012, source: "Speech Mini" })), { kind: "amount", text: "$0.012" });
  // The host's estimate keeps four decimals: three lines of a voice at $0.00001 arrive as 0. It is a real amount, so not "$0.00"
  // — in the row and in the parts of the money question.
  const tiny = stage({ stage: "voiceover", count: 3, unitUsd: 0.00001, lowUsd: 0, highUsd: 0, source: "Gemini TTS" });
  assert.deepEqual(stageCost(tiny), { kind: "amount", text: "less than $0.01" });
  assert.equal(partUsd(tiny), "less than $0.01");
  assert.equal(partUsd(stage({ count: 3, unitUsd: 0.033, lowUsd: 0.033, highUsd: 0.066 })), "$0.066");
  assert.deepEqual(stageCost(stage({ count: 3, unitUsd: null, lowUsd: null, highUsd: null, source: "Unpriced" })), { kind: "unknown" });
});
