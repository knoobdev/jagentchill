/** Delay before a failed host connection attempt. Caps repeated failures at one attempt per 30 seconds. */
export function hostRetryDelay(attempt: number): number {
  return Math.min(1_000 * 2 ** Math.max(0, Math.floor(attempt)), 30_000);
}
