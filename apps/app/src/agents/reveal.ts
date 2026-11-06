import { useEffect, useRef, useState } from "react";
import { revealStep } from "@jagentchill/app-core";

/** Answers whose text was already shown in full; drawing one again (the pane was closed and opened) does not replay it. */
const shownInFull = new Set<string>();

/**
 * The part of an arriving answer that is on screen: it follows `text` at an even pace, one step per frame, whether the
 * runtime sends many small increments or a few large pieces. An answer read from the transcript is shown whole.
 */
export function useRevealedText(id: string, text: string, options: { fresh: boolean; streaming: boolean }): { text: string; revealing: boolean } {
  const animate = options.fresh && !shownInFull.has(id);
  const [shown, setShown] = useState(animate ? 0 : text.length);
  const state = useRef({ text, shown, ended: !options.streaming, last: 0, frame: null as number | null });
  state.current.text = text;
  state.current.ended = !options.streaming;
  // A text that was replaced by a shorter one is shown from where the two still agree.
  if (state.current.shown > text.length) state.current.shown = text.length;

  useEffect(() => {
    const live = state.current;
    if (!animate || live.frame !== null || live.shown >= live.text.length) {
      if (live.ended && live.shown >= live.text.length) shownInFull.add(id);
      return;
    }
    // A hidden tab runs no frames: show everything rather than hold text back.
    if (typeof requestAnimationFrame !== "function" || (typeof document !== "undefined" && document.visibilityState === "hidden")) { live.shown = live.text.length; setShown(live.shown); return; }
    live.last = 0;
    const tick = (now: number) => {
      const elapsed = live.last ? Math.min(100, now - live.last) : 16;
      live.last = now;
      live.shown = revealStep(live.text, live.shown, elapsed, live.ended);
      setShown(live.shown);
      if (live.shown < live.text.length) live.frame = requestAnimationFrame(tick);
      else { live.frame = null; if (live.ended) shownInFull.add(id); }
    };
    live.frame = requestAnimationFrame(tick);
  }, [animate, id, text, options.streaming]);
  useEffect(() => () => { if (state.current.frame !== null) cancelAnimationFrame(state.current.frame); state.current.frame = null; }, []);

  const visible = Math.min(shown, text.length);
  return { text: visible >= text.length ? text : text.slice(0, visible), revealing: visible < text.length };
}
