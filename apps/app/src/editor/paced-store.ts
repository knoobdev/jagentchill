/**
 * A value that changes many times a second (the playhead while playing) as React is allowed to see it.
 *
 * React reads an outside store while it renders and checks it again when the render's effects run; a store that has
 * moved in between forces another render at once. A store that moves on EVERY frame, read by a tree that takes longer
 * than a frame to render (a development build, a heavy project, a busy machine), therefore forces a render from the
 * effects of every commit — React then reports "Maximum update depth exceeded" after fifty of them in a row, and the
 * interface spends its time on renders nobody sees.
 *
 * So what React is shown moves in step with React: a paced change (`set(value, true)`) is shown only after the readers
 * of the value shown before have committed and run their effects (`committed`, called from an effect), and then in a
 * task of its own — never from inside an effect. Changes in between are not queued: the newest one is shown next. A
 * change that must be seen at once (play, pause, a seek) is `set(value)`. `live` is always the newest value, for
 * whoever reads it outside React. Pure: no React, no timers of its own (`later` is `setTimeout` in the app).
 */
export type PacedStore<T> = {
  /** The newest value. */
  readonly live: T;
  /** What React reads (`getSnapshot`). */
  shown(): T;
  /** `paced`: the change may wait for React; otherwise it is shown now. */
  set(value: T, paced?: boolean): void;
  subscribe(listener: () => void): () => void;
  /** A reader rendered `value` and its effects have run. */
  committed(value: T): void;
  close(): void;
};

export function createPacedStore<T>(initial: T, options: { later(run: () => void, ms: number): unknown; cancel(handle: unknown): void; /** A reader that never answers (it was unmounted mid-render) is not waited for longer than this. */ patienceMs?: number }): PacedStore<T> {
  const listeners = new Set<() => void>(), patience = options.patienceMs ?? 250;
  let live = initial, shown = initial, awaiting = false, next: unknown = null, giveUp: unknown = null, closed = false;
  const show = () => {
    next = null;
    if (closed || shown === live) return;
    shown = live;
    if (giveUp !== null) { options.cancel(giveUp); giveUp = null; }
    awaiting = listeners.size > 0;
    if (awaiting) giveUp = options.later(() => { giveUp = null; awaiting = false; if (shown !== live) schedule(); }, patience);
    for (const listener of [...listeners]) listener();
  };
  const schedule = () => { if (next === null && !closed) next = options.later(show, 0); };
  return {
    get live() { return live; },
    shown: () => shown,
    set(value, paced = false) {
      live = value;
      if (!paced) { if (next !== null) { options.cancel(next); next = null; } show(); return; }
      // The readers of what is shown now have not answered yet: the newest value is shown when they have.
      if (!awaiting) schedule();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        // The last reader left: nobody is waited for.
        if (listeners.size > 0 || !awaiting) return;
        awaiting = false;
        if (giveUp !== null) { options.cancel(giveUp); giveUp = null; }
        if (shown !== live) schedule();
      };
    },
    committed(value) {
      if (!awaiting || value !== shown) return;
      awaiting = false;
      if (giveUp !== null) { options.cancel(giveUp); giveUp = null; }
      if (shown !== live) schedule();
    },
    close() { closed = true; listeners.clear(); if (next !== null) options.cancel(next); if (giveUp !== null) options.cancel(giveUp); next = giveUp = null; },
  };
}
