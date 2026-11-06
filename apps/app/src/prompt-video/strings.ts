import { formatSeconds, formatUsd, formatUsdRow } from "@jagentchill/app-core";
import type { promptVideo as pv } from "@jagentchill/editor-core";
import type { WorkflowNodeStatus } from "@jagentchill/protocol";

/** The words of the prompt-to-video screens that are held in tables: the key is the value of the model, the text is English (translated where it is shown). */
export const STYLE_OPTIONS = [
  { id: "auto", label: "Auto" }, { id: "cinematic", label: "Cinematic" }, { id: "clean-product", label: "Clean product" }, { id: "documentary", label: "Documentary" }, { id: "bold-social", label: "Bold social" },
  { id: "flat-illustration", label: "Flat illustration" }, { id: "hand-drawn", label: "Hand-drawn" }, { id: "3d-render", label: "3D render" }, { id: "retro-film", label: "Retro film" }, { id: "noir", label: "Noir" },
  { id: "minimal-type", label: "Minimal type" }, { id: "custom", label: "Custom…" },
] as const;
const PRESET_LABELS: Record<string, string> = { "short-social": "Short social video", "product-ad": "Product advertisement", explainer: "Explainer", story: "Story" };
const MOOD_LABELS: Record<string, string> = { none: "None", auto: "Auto", calm: "Calm", upbeat: "Upbeat", dramatic: "Dramatic", corporate: "Corporate", playful: "Playful", dark: "Dark", epic: "Epic", romantic: "Romantic" };
const LANGUAGE_LABELS: Record<string, string> = { en: "English", vi: "Vietnamese", ja: "Japanese", es: "Spanish", fr: "French", de: "German", pt: "Portuguese", ko: "Korean", zh: "Chinese" };
const STAGE_LABELS: Record<string, string> = { brief: "Brief", script_draft: "Script", shot_list: "Shot list", assets: "Pictures", voiceover: "Voice", music: "Music", timing: "Timing", captions: "Captions", assemble: "Assemble", review_checks: "Review" };
const STAGE_STATUS_LABELS: Record<WorkflowNodeStatus, string> = { pending: "Pending", ready: "Queued", running: "Running", waiting_approval: "Needs you", succeeded: "Done", failed: "Failed", skipped: "Skipped", cancelled: "Cancelled", stale: "Out of date" };
const MOTION_LABELS: Record<string, string> = { "slow-zoom-in": "Slow zoom in", "slow-zoom-out": "Slow zoom out", "pan-left": "Pan left", "pan-right": "Pan right", none: "Still" };
const CAMERA_LABELS: Record<string, string> = { static: "Static", pan: "Pan", tilt: "Tilt", "push-in": "Push in", "pull-out": "Pull out", track: "Track", handheld: "Handheld", orbit: "Orbit" };
const KIND_LABELS: Record<string, string> = { narration: "Narration", dialogue: "Dialogue", "on-screen-text": "On-screen text", silent: "Silent" };
const SEVERITY_LABELS: Record<string, string> = { blocker: "Must fix", warning: "Warning", info: "Note" };
/** Sentences the estimate of the host carries in English. */
const ESTIMATE_LABELS: Record<string, string> = { voice: "Voice — no speech provider is connected", music: "Music — no music provider is connected", chat: "Chat model", none: "No model", missing: "No provider" };
/** What a tile says about its picture. */
const VERDICT_LABELS = { deleted: "Deleted", refused: "Refused by the provider", wrong: "Not the shot", own: "Your picture", unchecked: "Not checked", checked: "Checked" };
export { VERDICT_LABELS };
export { CAMERA_LABELS, ESTIMATE_LABELS, KIND_LABELS, LANGUAGE_LABELS, MOOD_LABELS, MOTION_LABELS, PRESET_LABELS, SEVERITY_LABELS, STAGE_LABELS, STAGE_STATUS_LABELS };

export const usd = (amount: number | null): string => formatUsd(amount, { fine: true });
/** The amount in a ROW of the estimate: under one cent it reads "less than $0.01" (`formatUsdRow`). */
export const rowUsd = (amount: number | null): string => formatUsdRow(amount);
/**
 * The cost cell of a step of the estimate, as what it is: an amount (or a range), "price not known", or — for a step
 * that is not used or that no model does — nothing at all. A step on the person's own account is no row (`pv.moneyStages`).
 */
export function stageCost(stage: Pick<pv.StageEstimate, "count" | "unitUsd" | "lowUsd" | "highUsd" | "source">): { kind: "none" } | { kind: "unknown" } | { kind: "amount"; text: string } {
  if (stage.count === 0 || (stage.unitUsd === 0 && stage.source === "No model")) return { kind: "none" };
  if (stage.lowUsd === null) return { kind: "unknown" };
  if (roundedAway(stage, stage.highUsd ?? stage.lowUsd)) return { kind: "amount", text: rowUsd(stage.unitUsd) };
  if (stage.lowUsd === stage.highUsd || stage.highUsd === null) return { kind: "amount", text: rowUsd(stage.lowUsd) };
  // Both ends under one cent say the same thing: it is said once.
  const low = rowUsd(stage.lowUsd), high = rowUsd(stage.highUsd);
  return { kind: "amount", text: low === high ? low : (stage.lowUsd > 0 && stage.lowUsd < 0.01) ? high : usdRange(stage.lowUsd, stage.highUsd) };
}
/**
 * The host's estimate keeps four decimals: a step that IS used and whose unit has a price can arrive as 0 (three spoken
 * lines at $0.00001). That is a real amount, not "nothing": it is shown as "less than $0.01", never "$0.00".
 */
const roundedAway = (stage: Pick<pv.StageEstimate, "count" | "unitUsd">, amount: number | null): boolean => amount === 0 && stage.count > 0 && typeof stage.unitUsd === "number" && stage.unitUsd > 0;
/** A step's amount as a part of the money question ("Voice less than $0.01"): the figure, to the digit, unless the estimate's rounding left none. */
export const partUsd = (stage: Pick<pv.StageEstimate, "count" | "unitUsd" | "highUsd">): string => (roundedAway(stage, stage.highUsd) ? rowUsd(stage.unitUsd) : usd(stage.highUsd));
/** "$0.073 – 0.15": the sign is said once where it LEADS the figure; where the language puts it after ("0,073 $ – 0,15 $") both figures stay whole. */
export const usdRange = (low: number | null, high: number | null): string => { const top = usd(high); return `${usd(low)} – ${top.startsWith("$") ? top.slice(1) : top}`; };
export const seconds = (ticks: number): string => formatSeconds(ticks / 120_000);
