import assert from "node:assert/strict";
import { test } from "node:test";
import { createFinalisingWatchdog, FINALISING_TIMEOUT_MS, finalizeOrCancel, type ExportWriter } from "../src/export/session.ts";

function writer(finalize: () => Promise<void>, cancel: () => Promise<void>): ExportWriter {
  return { addVideoFrame: async () => undefined, addAudio: async () => undefined, finalize, cancel };
}

test("export finalising — Cancel interrupts a stuck muxer and starts writer cancellation without waiting", async () => {
  let cancelWriter = 0, signal!: () => void;
  const cancelled = new Promise<void>((resolve) => { signal = resolve; });
  const pending = finalizeOrCancel(writer(() => new Promise<void>(() => undefined), async () => { cancelWriter++; }), cancelled);
  signal();
  assert.equal(await pending, "cancelled");
  assert.equal(cancelWriter, 1);
});

test("export finalising — the deadline is exactly 60 seconds and a stuck flush is cancelled", async () => {
  let timer: (() => void) | undefined, delay = 0, cancelWriter = 0;
  const timers = {
    setTimeout(callback: () => void, milliseconds: number) { timer = callback; delay = milliseconds; return 1 as unknown as ReturnType<typeof setTimeout>; },
    clearTimeout() {},
  };
  const pending = finalizeOrCancel(writer(() => new Promise<void>(() => undefined), async () => { cancelWriter++; }), new Promise<void>(() => undefined), 60_000, timers);
  assert.equal(delay, FINALISING_TIMEOUT_MS);
  timer!();
  assert.equal(await pending, "timed-out");
  assert.equal(cancelWriter, 1);
});

test("export finalising watchdog — each finalising/save progress update restarts the 60-second deadline", () => {
  const timers: { id: number; callback: () => void; delay: number; cleared: boolean }[] = [];
  let expired = 0;
  const clock = {
    setTimeout(callback: () => void, delay: number) {
      const timer = { id: timers.length + 1, callback, delay, cleared: false };
      timers.push(timer);
      return timer.id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout(id: ReturnType<typeof setTimeout>) { const timer = timers.find((entry) => entry.id === (id as unknown as number)); if (timer) timer.cleared = true; },
  };
  const watchdog = createFinalisingWatchdog(() => { expired++; }, clock);
  watchdog.reset();
  watchdog.reset();
  assert.equal(timers[0]!.cleared, true);
  assert.equal(timers[1]!.delay, FINALISING_TIMEOUT_MS);
  assert.equal(expired, 0);
  timers[1]!.callback();
  assert.equal(expired, 1);
  watchdog.clear();
  assert.equal(timers[1]!.cleared, true);
});
