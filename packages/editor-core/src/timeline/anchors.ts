import type { ProjectDocument } from "@jagentchill/protocol";
import { locate, sceneById, type El } from "./model.ts";
import type { TimelineCommand } from "./command.ts";

const SECOND = 120_000;
export type TimingAnchorInput = { elementId: string; edge: "start" | "end"; offsetSeconds: number };

/** Set or clear an element's relative start. Commit settlement resolves the whole dependency graph atomically. */
export function setTimingAnchor(options: { sceneId: string; elementId: string; anchor: TimingAnchorInput | null }): TimelineCommand {
  return {
    type: "timeline.anchor",
    label: options.anchor ? "Link timing" : "Unlink timing",
    sceneId: options.sceneId,
    run(draft: ProjectDocument) {
      const scene = sceneById(draft, options.sceneId), target = locate(draft, options.elementId);
      if (!target || target.scene.id !== scene.id) throw new Error(`No element "${options.elementId}" in this scene`);
      const element = target.element as El & { timingAnchor?: { elementId: string; edge: "start" | "end"; offsetTicks: number } };
      if (!options.anchor) { delete element.timingAnchor; return; }
      const parent = locate(draft, options.anchor.elementId);
      if (!parent || parent.scene.id !== scene.id) throw new Error(`No anchor element "${options.anchor.elementId}" in this scene`);
      if (parent.element.id === element.id) throw new Error("An element cannot anchor to itself");
      if (!Number.isFinite(options.anchor.offsetSeconds) || Math.abs(options.anchor.offsetSeconds) > 86_400) throw new Error("Anchor offset must be within one day");
      element.timingAnchor = { elementId: parent.element.id, edge: options.anchor.edge, offsetTicks: Math.round(options.anchor.offsetSeconds * SECOND) };
    },
  };
}
