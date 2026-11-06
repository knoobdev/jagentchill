// The playhead as React sees it while playing. A reader here does what React's `useSyncExternalStore` does: it reads
// the shown value when it renders, takes a while, and when its effects run it checks whether the store has moved — a
// store that has moved forces another render from inside the effects. Fifty such commits in a row is what React
// reports as "Maximum update depth exceeded". Real timers; the engine's clock is a 4 ms interval, the render takes 12 ms.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createPacedStore, type PacedStore } from "./paced-store.ts";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const timers = { later: (run: () => void, ms: number) => setTimeout(run, ms), cancel: (handle: unknown) => clearTimeout(handle as NodeJS.Timeout) };

/** A reader that renders slower than the store ticks; counts the commits whose effects found the store moved, and the longest run of them. */
function reader<T>(read: () => T, subscribe: (listener: () => void) => () => void, committed: (value: T) => void, renderMs: number) {
  const seen = { commits: 0, forced: 0, run: 0, longest: 0, last: read() };
  let rendering = false, dirty = false, stopped = false;
  const render = async () => {
    if (rendering) { dirty = true; return; }
    rendering = true;
    do {
      dirty = false;
      const value = read();
      await sleep(renderMs);
      // The commit's effects: the store is checked again.
      seen.commits += 1; seen.last = value;
      const moved = read() !== value;
      if (moved) { seen.forced += 1; seen.run += 1; seen.longest = Math.max(seen.longest, seen.run); dirty = true; } else seen.run = 0;
      committed(value);
    } while (dirty && !stopped);
    rendering = false;
  };
  const off = subscribe(() => void render());
  return { seen, stop: () => { stopped = true; off(); } };
}
const play = async (tick: (time: number) => void, ms: number) => { let time = 0; const clock = setInterval(() => tick(++time), 4); await sleep(ms); clearInterval(clock); return time; };

test("playback: a store that moves on every frame forces a render from the effects of every commit of a slow reader — the reported loop", async () => {
  // The transport as it was: one value, every listener told on every tick.
  let value = 0;
  const listeners = new Set<() => void>();
  const slow = reader(() => value, (listener) => { listeners.add(listener); return () => listeners.delete(listener); }, () => undefined, 12);
  await play((time) => { value = time; for (const listener of listeners) listener(); }, 1500);
  slow.stop();
  assert.ok(slow.seen.longest > 50, `more than fifty commits in a row found the store moved (${slow.seen.longest} of ${slow.seen.commits})`);
});

test("playback: paced, the same reader is never forced to render again from its effects, and still follows the playhead to its end", async () => {
  const store: PacedStore<number> = createPacedStore(0, timers);
  const slow = reader(store.shown, store.subscribe, store.committed, 12);
  const end = await play((time) => store.set(time, true), 1500);
  await sleep(100);
  assert.equal(slow.seen.forced, 0, `no commit found the store moved (${slow.seen.commits} commits)`);
  assert.ok(slow.seen.commits > 30, `the reader kept following (${slow.seen.commits} commits in 1.5 s)`);
  assert.equal(store.live, end);
  assert.equal(slow.seen.last, end, "the last value is shown when the playback stops");
  slow.stop(); store.close();
});

test("playback: a change that must be seen at once is shown at once, a paced one never from inside the reader's effects, and a reader that went away is not waited for", async () => {
  const store = createPacedStore("a", { ...timers, patienceMs: 40 });
  const shownAt: string[] = [];
  const off = store.subscribe(() => shownAt.push(store.shown()));
  store.set("b");
  assert.deepEqual([store.shown(), store.live, shownAt], ["b", "b", ["b"]]);
  store.committed("b");
  // Paced: not shown in the same task — neither when it is set nor when the readers answer.
  store.set("c", true);
  assert.equal(store.shown(), "b");
  await sleep(10);
  assert.equal(store.shown(), "c");
  store.set("d", true); store.set("e", true);
  assert.equal(store.shown(), "c", "the readers of c have not answered");
  store.committed("b");
  assert.equal(store.shown(), "c", "an answer for an older value is not the answer");
  store.committed("c");
  assert.equal(store.shown(), "c", "the next value is not shown from inside the effect that answers");
  await sleep(10);
  assert.deepEqual([store.shown(), shownAt], ["e", ["b", "c", "e"]], "the newest value is shown next; what lay between is skipped");
  // Nobody answers for e (its reader was unmounted): after the patience the store goes on.
  store.set("f", true);
  await sleep(80);
  assert.equal(store.shown(), "f");
  // A change that must be seen at once overtakes a paced one that is waiting.
  store.set("g", true); store.set("h");
  assert.equal(store.shown(), "h");
  off();
  // Without readers nothing is waited for.
  store.set("i", true); await sleep(5); store.set("j", true); await sleep(5);
  assert.equal(store.shown(), "j");
  store.close();
  store.set("k", true); await sleep(5);
  assert.equal(store.shown(), "j", "a closed store shows nothing more");
});
