export type QuestionCardLayoutEntry = { id: string; ts_ms: number; pending: boolean };

/** Settled questions stay at their transcript time; every currently pending question shares one tail block. */
export function questionCardLayout<T extends QuestionCardLayoutEntry>(cards: readonly T[]): {
  settled: T[];
  pinned: { id: "pending-questions"; ts_ms: number; pending: true; cards: T[] } | null;
} {
  const settled = cards.filter((card) => !card.pending);
  const waiting = cards.filter((card) => card.pending);
  return {
    settled,
    pinned: waiting.length ? { id: "pending-questions", ts_ms: Number.MAX_SAFE_INTEGER, pending: true, cards: waiting } : null,
  };
}
