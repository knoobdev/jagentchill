import { ProtocolError } from "../errors.ts";

/** A sliding window per key: mutations of the admin proxy are limited per device. */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(limit: number, windowMs: number, now: () => number) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
  }

  /** Records one call, or fails with `RATE_LIMITED` and the time until the next one is accepted. */
  hit(key: string): void {
    const now = this.now();
    const recent = (this.hits.get(key) ?? []).filter((at) => now - at < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      throw new ProtocolError("RATE_LIMITED", "Too many changes in a short time.", { retryable: true, details: { retryAfter_ms: this.windowMs - (now - recent[0]) } });
    }
    recent.push(now);
    this.hits.set(key, recent);
  }
}
