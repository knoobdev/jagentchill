import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import type { ScrollView } from "react-native";

/** The part of a row's movement that came from layout after removing real scroll movement since capture. */
export function scrollAnchorLayoutShift(heldTop: number, currentTop: number, heldOffset: number, currentOffset: number): number {
  return currentOffset - heldOffset + currentTop - heldTop;
}

/** Prefer the visible row's measured movement over the row window's estimate for content prepended above it. */
export function scrollAnchorCorrection(held: { top: number; offset: number } | null, currentTop: number, currentOffset: number | null, prependedEstimate: number): number {
  return held && currentOffset !== null
    ? scrollAnchorLayoutShift(held.top, currentTop, held.offset, currentOffset)
    : prependedEstimate;
}

/** The virtual list's content coordinate includes the translation applied to its content wrapper. */
export function scrollAnchorWindowTop(scrollTop: number, compensation: number, _hasOlder: boolean): number {
  // Physical top is the first row currently loaded. Older pages are inserted there as the reader requests them.
  const logicalTop = Math.max(0, scrollTop - compensation);
  return scrollTop <= 1 ? 0 : logicalTop;
}

/** The virtual offset and row anchor must release when the first loaded row reaches the viewport top. */
export function scrollAnchorShouldResetAtTop(scrollTop: number, compensation: number, _hasOlder: boolean): boolean {
  return scrollTop <= 1 && compensation !== 0;
}

/** A Home command targets the first loaded row, even while further pages remain. */
export function scrollAnchorShouldClearForExplicitTop(_hasOlder: boolean): boolean {
  return true;
}

/** Continue paging only after the reader has asked to reach older rows and the viewport remains at the top. */
export function scrollAnchorShouldLoadOlderAtTop(scrollTop: number, intent: boolean, hasOlder: boolean, loading: boolean): boolean {
  return scrollTop <= 1 && intent && hasOlder && !loading;
}

/**
 * Holds the reader's place in a list whose rows above the viewport change — older messages put in above, rows mounted
 * in place of a spacer and found taller or shorter than the spacer took them for. The first row that crosses the top of
 * the viewport is the anchor (rows carry `data-wkey`); after every commit, and whenever the content changes size, the
 * list contents are translated by as much as that row moved, before the frame is painted. This keeps the reader's
 * visual anchor without making scrollTop move against the direction of a wheel gesture. The engine's own scroll anchoring is
 * turned off on the list (WebKit has none), so every engine takes this one path. On native there is no DOM to read:
 * the list uses `maintainVisibleContentPosition` there and this does nothing.
 */
export function useScrollAnchor(scroll: RefObject<ScrollView | null>, /** false while the list follows its end: there is no place to hold. */ active: () => boolean, /** Rows were put in ABOVE everything in this commit (an older page): measured row movement is preferred; this estimate is used only while the held row is unavailable. */ prepended?: { take(): number; placed(top: number): void; hasOlder?(): boolean }) {
  const anchor = useRef<{ key: string; offset: number; top: number } | null>(null);
  const compensation = useRef(0);
  // During deliberate upward wheel movement at physical top, keep the rendered window fixed while its transform
  // unwinds. Otherwise moving both the window and transform would cancel the user's movement on the next render.
  const topUnwindWindowTop = useRef<number | null>(null);
  // The browser harness can opt in to inspect the exact anchor state while reproducing scroll jumps.
  const publishTrace = () => {
    if (typeof window === "undefined") return;
    const trace = (window as Window & { __w11ScrollTrace?: { heldAnchor?: typeof anchor.current; compensation?: number } }).__w11ScrollTrace;
    if (trace) { trace.heldAnchor = anchor.current ? { ...anchor.current } : null; trace.compensation = compensation.current; }
  };
  const node = (): HTMLElement | null => {
    const found = (scroll.current as unknown as { getScrollableNode?(): unknown } | null)?.getScrollableNode?.();
    return found && typeof (found as HTMLElement).querySelectorAll === "function" ? (found as HTMLElement) : null;
  };
  const capture = (): void => {
    const list = node();
    if (!list) return;
    const frame = list.getBoundingClientRect();
    // Only a row that is IN the viewport can hold the place: after a jump to a part that is not mounted yet there is
    // none, and the list is then placed by its scroll offset until rows are there.
    for (const row of list.querySelectorAll<HTMLElement>("[data-wkey]")) {
      const box = row.getBoundingClientRect();
      if (box.bottom > frame.top + 1 && box.top < frame.bottom - 1) { anchor.current = { key: row.dataset.wkey!, offset: box.top - frame.top, top: list.scrollTop }; publishTrace(); return; }
    }
    anchor.current = null;
    publishTrace();
  };
  const restore = (): void => {
    const list = node(), held = anchor.current;
    if (!list) return;
    const content = list.firstElementChild as HTMLElement | null;
    // At the top of the currently loaded page, let newly prepended rows occupy the viewport instead of pinning the
    // previous first row there. A held row is useful only after the reader has moved into the loaded transcript.
    if (list.scrollTop <= 1 && (prepended?.hasOlder?.() ?? false)) {
      if (content) content.style.transform = "";
      compensation.current = 0;
      topUnwindWindowTop.current = null;
      anchor.current = null;
      publishTrace();
      return;
    }
    // At the actual transcript beginning, discard any correction retained from the last page.
    if (scrollAnchorShouldResetAtTop(list.scrollTop, compensation.current, prepended?.hasOlder?.() ?? false)) {
      if (content) content.style.transform = "";
      compensation.current = 0;
      anchor.current = null;
      topUnwindWindowTop.current = null;
      publishTrace();
      return capture();
    }
    // An older page was put in above. Its row-window height is only an estimate: when the held visible row is mounted,
    // use that row's actual movement. Keep its screen position with a content translation so scrollTop remains the
    // reader's own offset. Fall back to the estimate only while the anchor row is unavailable.
    const shift = prepended?.take() ?? 0;
    if (!active()) {
      if (compensation.current !== 0 && content) {
        const maxTop = Math.max(0, list.scrollHeight - list.clientHeight);
        const nearEnd = maxTop - list.scrollTop <= 48;
        const heldTop = nearEnd ? list.scrollTop - compensation.current : list.scrollTop;
        content.style.transform = "";
        compensation.current = 0;
        list.scrollTop = Math.max(0, Math.min(maxTop, heldTop));
        publishTrace();
      }
      return;
    }
    const compensate = (correction: number) => {
      compensation.current -= correction;
      if (content) content.style.transform = compensation.current ? `translate3d(0, ${compensation.current}px, 0)` : "";
      publishTrace();
    };
    // No row held yet (the list was just placed by its offset): the rows that are there now give one.
    if (!held) {
      if (shift > 0) { compensate(shift); prepended?.placed(list.scrollTop); }
      return capture();
    }
    const row = [...list.querySelectorAll<HTMLElement>("[data-wkey]")].find((entry) => entry.dataset.wkey === held.key);
    const offset = row ? row.getBoundingClientRect().top - list.getBoundingClientRect().top : null;
    const correction = scrollAnchorCorrection(held, list.scrollTop, offset, row ? 0 : shift);
    if (Math.abs(correction) > 0.5) { compensate(correction); if (!row) prepended?.placed(list.scrollTop); capture(); }
    else if (!row) capture();
  };
  // After every commit, before the paint.
  useLayoutEffect(() => { restore(); });
  // A row that changes size without a commit (a picture that loads).
  useEffect(() => {
    const list = node(), content = list?.firstElementChild;
    if (!content || typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(() => restore());
    observer.observe(content);
    return () => observer.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const scrollAtTop = (deltaY: number): boolean => {
    const list = node();
    if (!list || list.scrollTop > 1 || deltaY >= 0 || (prepended?.hasOlder?.() ?? false) || compensation.current >= 0) return false;
    if (topUnwindWindowTop.current === null) topUnwindWindowTop.current = Math.max(0, list.scrollTop - compensation.current);
    const distance = Math.min(-compensation.current, -deltaY);
    compensation.current += distance;
    if (compensation.current >= 0) { compensation.current = 0; topUnwindWindowTop.current = null; }
    const content = list.firstElementChild as HTMLElement | null;
    if (content) content.style.transform = compensation.current ? `translate3d(0, ${compensation.current}px, 0)` : "";
    anchor.current = null;
    publishTrace();
    return true;
  };
  const resetForExplicitTop = (): boolean => {
    if (!scrollAnchorShouldClearForExplicitTop(prepended?.hasOlder?.() ?? false)) return false;
    const content = node()?.firstElementChild as HTMLElement | null;
    if (content) content.style.transform = "";
    compensation.current = 0;
    topUnwindWindowTop.current = null;
    anchor.current = null;
    publishTrace();
    return true;
  };
  return { capture, restore, scrollAtTop, resetForExplicitTop, windowTop: (top: number) => topUnwindWindowTop.current ?? scrollAnchorWindowTop(top, compensation.current, prepended?.hasOlder?.() ?? false), /** Set the row and offset to hold after a list replacement. */ hold: (next: { key: string; offset: number } | null) => { const list = node(); anchor.current = next && list ? { ...next, top: list.scrollTop } : null; publishTrace(); }, /** The row the reader's place is held by, and how far below the top of the viewport it starts. */ held: () => anchor.current };
}
