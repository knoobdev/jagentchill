import type { ChatItem } from "./timeline.ts";

/** One compaction of a session's context, as the host records it. */
export type Compaction = { id: number; ts_ms: number; reason: "auto" | "manual" | "runtime"; tokensBefore: number | null; tokensAfter: number | null; summary?: string };
/** The context window of a session: how full it is, when it compacts by itself, and its compactions. */
export type SessionContext = {
  sessionKey: string; context?: { usedTokens: number; maxTokens?: number; pct?: number; updated_ms: number };
  autoCompact: { hostPct: number; sessionPct: number | null; effectivePct: number };
  compaction: "host" | "runtime" | "none"; compactions: Compaction[];
  /** A compaction is running now (the host says so the moment it starts one or the runtime reports one). */
  compacting?: { since_ms: number; reason: Compaction["reason"] };
  /** The token limits that apply; a scope without a limit is absent. */
  limits?: { session?: TokenLimit; day?: TokenLimit; sessionOwn: number | null };
};
export type TokenLimit = { usedTokens: number; limitTokens: number; pct: number; warning: boolean; exhausted: boolean };

/** The limit the composer speaks about: one that is used up before one that only warns, the session's before the day's. */
export function pressingLimit(limits: SessionContext["limits"]): ({ scope: "session" | "day" } & TokenLimit) | null {
  const all = [...(limits?.session ? [{ scope: "session" as const, ...limits.session }] : []), ...(limits?.day ? [{ scope: "day" as const, ...limits.day }] : [])];
  return all.find((limit) => limit.exhausted) ?? all.find((limit) => limit.warning) ?? null;
}
/** The shares of the window a session can compact at; 0 is off. */
export const AUTO_COMPACT_STEPS = [0, 60, 70, 80, 90] as const;

/** The colour step of the context meter: calm below 70 %, a warning from 70 %, danger from 90 %. */
export function meterTone(pct: number): "normal" | "warning" | "danger" {
  return pct >= 90 ? "danger" : pct >= 70 ? "warning" : "normal";
}

/** Token counts as the meter writes them: 950, 12.4k, 200k, 1.2M. */
export function tokensShort(count: number): string {
  if (count < 1000) return String(Math.round(count));
  const [value, unit] = count < 999_500 ? [count / 1000, "k"] : [count / 1_000_000, "M"];
  return `${value >= 100 ? Math.round(value) : Math.round(value * 10) / 10}${unit}`;
}

/** The id of the timeline row of a compaction; the timeline draws such a row as a divider. */
export const COMPACTION_ROW = "compaction-";

/**
 * The timeline with a divider at every compaction: each sits before the first row written after it. A row without a
 * time (a streaming answer) counts as "now", so a compaction between turns lands above the turn that follows it.
 */
export function withCompactions(items: ChatItem[], compactions: readonly Compaction[], label: (compaction: Compaction) => string): ChatItem[] {
  if (!compactions.length) return items;
  const out = [...items];
  for (const compaction of compactions) {
    const row: ChatItem = { kind: "status", id: `${COMPACTION_ROW}${compaction.id}`, text: label(compaction), ts_ms: compaction.ts_ms };
    const at = out.findIndex((item) => !item.id.startsWith(COMPACTION_ROW) && "ts_ms" in item && typeof item.ts_ms === "number" && item.ts_ms > compaction.ts_ms);
    if (at < 0) out.push(row); else out.splice(at, 0, row);
  }
  return out;
}
