import type { ColorToken } from "../tokens.ts";

export type Tone = "neutral" | "info" | "warning" | "success" | "danger" | "purple";
export type ToneShape = "hollow-dot" | "dot" | "triangle" | "check" | "cross" | "double-check";

/** Fill, label colour, dot or icon colour and shape of each tone. The six shapes differ, so tone never rests on colour. */
export const TONES: Record<Tone, { fill: ColorToken; text: ColorToken; icon: ColorToken; shape: ToneShape }> = {
  neutral: { fill: "bg/subtle", text: "text/secondary", icon: "text/secondary", shape: "hollow-dot" },
  info: { fill: "accent/subtle", text: "accent/text", icon: "accent", shape: "dot" },
  warning: { fill: "warning/subtle", text: "warning/text", icon: "warning/icon", shape: "triangle" },
  success: { fill: "success/subtle", text: "success/text", icon: "success", shape: "check" },
  danger: { fill: "danger/subtle", text: "danger/text", icon: "danger", shape: "cross" },
  purple: { fill: "purple/subtle", text: "purple/text", icon: "purple", shape: "double-check" },
};

const TABLE: Record<Tone, string> = {
  neutral: "queued, pending, ready to run, paused, cancelled, skipped, idle, draft, archived, stopped, disabled, unknown, parked, offline, signed out, not installed",
  info: "running, working, starting, creating, syncing, rendering, connecting, repairing, updating",
  warning: "needs approval, waiting for approval, needs input, waiting for a person, awaiting review, changes requested, stale, stalled, degraded, timed out, interrupted, blocked, outdated, orphaned, expired, pairing required, update required, sign-in required",
  success: "succeeded, result ready, approved, connected, installed, up to date",
  danger: "failed, error, rejected, revoked, lost",
  purple: "completed, exported, merged",
};
/** Enum spellings whose words differ from the state name of the table. "Ready" is never used bare: it means "ready to run". */
const ALIASES: Record<string, string> = {
  ready: "ready to run", "waiting approval": "waiting for approval", "waiting input": "needs input", "waiting person": "waiting for a person",
  canceled: "cancelled", success: "succeeded", errored: "error", "signin required": "sign-in required", "sign in required": "sign-in required",
};
const normalise = (value: string) => value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim().toLowerCase();

/** The closed status → tone mapping: every status of the product maps to one tone. */
export const statusTone: Readonly<Record<string, Tone>> = Object.freeze(Object.fromEntries(
  (Object.keys(TABLE) as Tone[]).flatMap((tone) => TABLE[tone].split(", ").map((state) => [normalise(state), tone] as const)),
));
/** Tone of a status enum value such as `waiting_approval` or `timed_out`; null when the value has no tone. */
export function toneOfStatus(value: string): Tone | null {
  const key = normalise(value);
  return statusTone[key] ?? statusTone[ALIASES[key] ?? ""] ?? null;
}
/** Contract check: every value of every status enum has a tone. Returns the offenders as `enum.value`. */
export function unmappedStatuses(enums: Record<string, readonly string[]>): string[] {
  return Object.entries(enums).flatMap(([name, values]) => values.filter((value) => toneOfStatus(value) === null).map((value) => `${name}.${value}`));
}

const AVATAR_FILLS = 8;
/** Deterministic avatar fill index (1–8) from an entity id: the same id gives the same fill on every device. */
export function avatarFill(id: string): ColorToken {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619) >>> 0;
  return `avatar/bg/${(hash % AVATAR_FILLS) + 1}` as ColorToken;
}
/** Up to two initials of a name. */
export function initials(name: string, max: 1 | 2 = 2): string {
  const words = name.match(/\p{L}+/gu) ?? [];
  const letters = words.length > 1 ? words.slice(0, 2).map((word) => [...word][0]!) : [...(words[0] ?? "")].slice(0, 2);
  return letters.slice(0, max).join("").toUpperCase();
}
/** Counts above 99 render "99+". */
export const badgeCount = (count: number) => (count > 99 ? "99+" : String(Math.max(0, Math.floor(count))));

/** Truncates in the middle, keeping both ends: used by breadcrumbs, token chips and file names. */
export function truncateMiddle(text: string, max: number): string {
  if (text.length <= max) return text;
  const keep = max - 1, head = Math.ceil(keep / 2), tail = Math.floor(keep / 2);
  return `${text.slice(0, head)}…${tail > 0 ? text.slice(-tail) : ""}`;
}
export const truncateEnd = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);
