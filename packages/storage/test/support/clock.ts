import type { Clock } from "../../src/index.ts";

type Timer = { id: number; at: number; run: () => void; label: string };
/**
 * A fake clock: time moves only through `advance`, which fires the due timers in order and, after each, lets the
 * real asynchronous work they started (store writes) finish before time moves on.
 */
export function fakeClock(start = 0) {
  let now = start, next = 1;
  const timers: Timer[] = [], dead = new Set<string>();
  const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
  const clock = {
    /** Conditions under which real work is still in flight (a save being written). */
    busy: [] as (() => boolean)[],
    now: () => now,
    setTimeout: (run: () => void, ms: number): unknown => clock.schedule(run, ms, ""),
    clearTimeout: (handle: unknown): void => { const index = timers.findIndex((timer) => timer.id === handle); if (index >= 0) timers.splice(index, 1); },
    schedule(run: () => void, ms: number, label: string): unknown {
      if (dead.has(label)) return 0;
      const timer = { id: next++, at: now + Math.max(0, ms), run, label };
      timers.push(timer);
      return timer.id;
    },
    /** The clock as one participant sees it, so that the participant can be killed. */
    fork: (label: string): Clock => ({ now: () => now, setTimeout: (run, ms) => clock.schedule(run, ms, label), clearTimeout: clock.clearTimeout }),
    /** Kills a participant: its timers never fire again. */
    kill(label: string): void { dead.add(label); for (let index = timers.length - 1; index >= 0; index--) if (timers[index].label === label) timers.splice(index, 1); },
    /** Jumps to a wall-clock time; pending timers keep their remaining delay. */
    set(time: number): void { const delta = time - now; for (const timer of timers) timer.at += delta; now = time; },
    async settle(): Promise<void> {
      for (let round = 0; round < 200; round++) {
        for (let index = 0; index < 12; index++) await turn();
        if (!clock.busy.some((busy) => busy())) { for (let index = 0; index < 12; index++) await turn(); if (!clock.busy.some((busy) => busy())) return; }
        await new Promise<void>((resolve) => setTimeout(resolve, 1));
      }
    },
    async advance(ms: number): Promise<void> {
      const target = now + ms;
      await clock.settle();
      for (;;) {
        const due = timers.filter((timer) => timer.at <= target).sort((a, b) => a.at - b.at || a.id - b.id)[0];
        if (!due) break;
        timers.splice(timers.indexOf(due), 1);
        now = Math.max(now, due.at);
        due.run();
        await clock.settle();
      }
      now = target;
      await clock.settle();
    },
  };
  return clock;
}
