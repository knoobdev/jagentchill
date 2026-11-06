import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// jsdom has no layout: give matchMedia and the observers react-native-web asks for.
// Media queries are a controllable fake: `setMedia("dark", true)` flips every query containing the word and notifies it.
type Listener = (event: { matches: boolean }) => void;
const media = new Map<string, { matches: boolean; listeners: Set<Listener> }>();
window.matchMedia = ((query: string) => {
  let entry = media.get(query);
  if (!entry) { entry = { matches: false, listeners: new Set() }; media.set(query, entry); }
  const state = entry;
  return { get matches() { return state.matches; }, media: query, onchange: null, addEventListener: (_: string, fn: Listener) => state.listeners.add(fn), removeEventListener: (_: string, fn: Listener) => state.listeners.delete(fn), addListener: (fn: Listener) => state.listeners.add(fn), removeListener: (fn: Listener) => state.listeners.delete(fn), dispatchEvent: () => false };
}) as unknown as typeof window.matchMedia;
(globalThis as Record<string, unknown>).setMedia = (word: string, matches: boolean) => {
  for (const [query, entry] of media) if (query.includes(word)) { entry.matches = matches; entry.listeners.forEach((listener) => listener({ matches })); }
};
class Observer { observe() {} unobserve() {} disconnect() {} }
(globalThis as Record<string, unknown>).ResizeObserver ??= Observer;
(globalThis as Record<string, unknown>).IntersectionObserver ??= Observer;
afterEach(() => cleanup());

