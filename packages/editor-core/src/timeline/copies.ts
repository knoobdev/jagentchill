import { isObject } from "../model.ts";
import { copyElement } from "../ops/shared.ts";
import type { El } from "./model.ts";

/** Copies of a set of elements: new ids, and the grouping, linking and tracking among the copies kept under new ids. */
export function copySet(elements: El[], newId: () => string, options: { suffix?: string } = {}): Map<string, El> {
  const ids = new Map<string, string>(), shared = new Map<string, string>(), copies = new Map<string, El>();
  for (const element of elements) {
    const copy = copyElement(element as never, newId);
    for (const [from, to] of copy.ids) ids.set(from, to);
    copies.set(element.id, copy.element as unknown as El);
  }
  for (const key of ["groupId", "linkId"] as const) {
    const counts = new Map<string, number>();
    for (const copy of copies.values()) if (typeof copy[key] === "string") counts.set(copy[key] as string, (counts.get(copy[key] as string) ?? 0) + 1);
    for (const copy of copies.values()) {
      const value = copy[key];
      if (typeof value !== "string") continue;
      // A reference that points outside the copied set is dropped: the copy has no partner there.
      if ((counts.get(value) ?? 0) < 2) { copy[key] = null; continue; }
      if (!shared.has(`${key}:${value}`)) shared.set(`${key}:${value}`, newId());
      copy[key] = shared.get(`${key}:${value}`)!;
    }
  }
  for (const copy of copies.values()) {
    if (isObject(copy.tracking)) { const target = ids.get(String(copy.tracking.targetElementId)); if (target) copy.tracking.targetElementId = target; else delete copy.tracking; }
    if ("transitionIn" in copy) { copy.transitionIn = null; copy.transitionOut = null; }
    if (options.suffix && !copy.name.endsWith(options.suffix)) copy.name = `${copy.name}${options.suffix}`.slice(0, 200);
  }
  return copies;
}
