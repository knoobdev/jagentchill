import { useCallback, useState, useSyncExternalStore } from "react";

/**
 * What a person has typed into a composer and not sent, by where they typed it (a session, or the new-session composer
 * of a project or script). It lives here, outside the components: the editor's agent panel leaves the tree when it
 * closes, and the text has to be there when it opens again. Kept for the life of the page, on this device only.
 */
const drafts = new Map<string, string>();
const heldMessages = new Map<string, readonly string[]>();
const heldClaims = new Set<string>();

const draftListeners = new Set<() => void>();
const subscribeDrafts = (listener: () => void): (() => void) => { draftListeners.add(listener); return () => void draftListeners.delete(listener); };
/** The draft of a composer as it is now, read where it is needed at the time of an action (a send, a dictation) without rendering for every key. */
export const readDraft = (key: string): string => drafts.get(key) ?? "";
export function writeDraft(key: string, next: string): void {
  if ((drafts.get(key) ?? "") === next) return;
  if (next) drafts.set(key, next); else drafts.delete(key);
  for (const listener of [...draftListeners]) listener();
}
/** Messages accepted by the composer while the host compacts; unlike component state, these survive route changes. */
export const readHeldMessages = (key: string): readonly string[] => heldMessages.get(key) ?? EMPTY_HELD;
const EMPTY_HELD: readonly string[] = Object.freeze([]);
export function queueHeldMessage(key: string, text: string): void {
  heldMessages.set(key, [...readHeldMessages(key), text]);
  for (const listener of [...draftListeners]) listener();
}
export function removeHeldMessage(key: string, text: string): void {
  const current = readHeldMessages(key);
  const index = current.indexOf(text);
  if (index < 0) return;
  const next = current.filter((_, at) => at !== index);
  if (next.length) heldMessages.set(key, next); else heldMessages.delete(key);
  for (const listener of [...draftListeners]) listener();
}
export function claimHeldMessage(key: string, text: string): boolean {
  const claim = `${key}\n${text}`;
  if (heldClaims.has(claim)) return false;
  heldClaims.add(claim);
  return true;
}
export function releaseHeldMessage(key: string, text: string): void { heldClaims.delete(`${key}\n${text}`); }
export function useHeldMessages(key: string): readonly string[] {
  return useSyncExternalStore(subscribeDrafts, () => readHeldMessages(key), () => EMPTY_HELD);
}
/**
 * The draft of one composer, read from the store above. Only the component that calls this renders on a key press: the
 * pane around a composer reads the draft with `readDraft` when it acts, so typing does not render the conversation.
 */
export function useDraft(key: string): [string, (next: string) => void] {
  const text = useSyncExternalStore(subscribeDrafts, () => readDraft(key), () => "");
  const set = useCallback((next: string) => writeDraft(key, next), [key]);
  return [text, set];
}

/** Which conversation a place shows (a session's key, or "new" for the new-session composer), beside its drafts and for the same reason. */
const selections = new Map<string, string>();

/** The conversation chosen in one place (the agent panel of a project or script); `null` until the person chose. */
export function useSelection(key: string): [string | null, (next: string) => void] {
  const [held, setHeld] = useState(() => ({ key, value: selections.get(key) ?? null }));
  const current = held.key === key ? held : { key, value: selections.get(key) ?? null };
  if (current !== held) setHeld(current);
  const set = useCallback((next: string) => { selections.set(key, next); setHeld({ key, value: next }); }, [key]);
  return [current.value, set];
}
