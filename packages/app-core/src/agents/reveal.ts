/**
 * How the text of an answer is revealed while it arrives. A runtime may report it in small increments or in a few large
 * pieces; either way the reader sees it grow at an even pace instead of jumping. Pure: the screen runs it once per frame.
 */
export const REVEAL = {
  /** The pace never falls under this many characters per second. */
  minCharsPerSecond: 90,
  /**
   * What is waiting to be shown is shown within about this long: the pace rises with the backlog. It is also how far the
   * screen stays behind a steady stream: measured on a real turn, 450 ms for every backlog left the reader 440 ms
   * behind what had arrived, which reads as a replay. So the few words a live stream is ahead by are shown within
   * `catchUp_ms`; only a large piece (a runtime that reports text in blocks) is unfolded over up to `burstCatchUp_ms`.
   */
  catchUp_ms: 100, burstCatchUp_ms: 450,
  /** A backlog up to `liveChars` is a live stream's; from `burstChars` on it is a block. */
  liveChars: 60, burstChars: 600,
  /** Once the turn has ended the rest is shown within this long. */
  finish_ms: 250,
} as const;

/** The number of characters shown after `elapsed_ms` more, given `shown` of `total` now. Never splits a surrogate pair. */
export function revealStep(text: string, shown: number, elapsed_ms: number, ended: boolean): number {
  const total = text.length;
  if (shown >= total) return total;
  const backlog = total - shown;
  const burst = Math.min(1, Math.max(0, (backlog - REVEAL.liveChars) / (REVEAL.burstChars - REVEAL.liveChars)));
  const within = ended ? REVEAL.finish_ms : REVEAL.catchUp_ms + (REVEAL.burstCatchUp_ms - REVEAL.catchUp_ms) * burst;
  const pace = Math.max(REVEAL.minCharsPerSecond, (backlog * 1000) / within);
  let next = Math.min(total, shown + Math.max(1, Math.round((pace * Math.max(0, elapsed_ms)) / 1000)));
  const unit = text.charCodeAt(next - 1);
  if (next < total && unit >= 0xd800 && unit <= 0xdbff) next += 1;
  return next;
}
