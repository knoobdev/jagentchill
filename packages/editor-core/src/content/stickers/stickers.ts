import { createElement } from "@jagentchill/protocol";
import { reject } from "../../ops/shared.ts";
import { snapToFrame } from "../../time.ts";
import type { TimelineCommand } from "../../timeline/command.ts";
import { fpsOf, sceneById, type El } from "../../timeline/model.ts";
import { FACTORY_INSERT_DEFAULTS, placeElements } from "../../timeline/placement.ts";
import { initialStickerScale } from "./shapes.ts";

/** `stickers-shapes.Sticker identifiers`: `provider:value`, both parts non-empty; only the first colon separates them. */
export function parseStickerId(id: string): { provider: string; value: string } | null {
  const at = id.indexOf(":");
  return at > 0 && at < id.length - 1 ? { provider: id.slice(0, at), value: id.slice(at + 1) } : null;
}
/** The providers whose stickers this build can place. */
export const STICKER_PROVIDERS = ["starter", "emoji", "flags", "shapes", "user", "generated"] as const;
export const EMOJI_STICKER_SIZE = 512;
/** The recents of the Stickers tab: ids of known providers, most recent first, without duplicates, at most `limit`. */
export function pushRecentSticker(recents: readonly string[], id: string, limit = 24): string[] {
  const known = (entry: string) => { const parsed = parseStickerId(entry); return parsed !== null && (STICKER_PROVIDERS as readonly string[]).includes(parsed.provider); };
  return [...new Set([id, ...recents])].filter(known).slice(0, limit);
}

/**
 * Adds a sticker at a time (and, for a drop on the canvas, at a canvas point), selected, one step. Its longer side is
 * 25 % of the canvas's shorter side; an animated sticker lasts at least one full pass.
 */
export function addStickerItem(options: { sceneId: string; stickerId: string; name?: string; width: number; height: number; time: number; position?: { x: number; y: number }; animationDuration?: number }): TimelineCommand<{ elementId: string }> {
  return {
    type: "sticker.add", label: "Add sticker", sceneId: options.sceneId,
    run(draft, env) {
      if (!parseStickerId(options.stickerId)) return reject("document/unknown-reference", "", `"${options.stickerId}" is not a sticker id`);
      const fps = fpsOf(draft), scale = initialStickerScale({ width: options.width, height: options.height }, draft.settings.canvasSize);
      const duration = Math.max(FACTORY_INSERT_DEFAULTS.stickerDuration, options.animationDuration ?? 0);
      const element = createElement("sticker", {
        id: env.newId(), name: options.name ?? "Sticker", startTime: snapToFrame(Math.max(0, options.time), fps), duration: snapToFrame(duration, fps), stickerId: options.stickerId,
        intrinsicWidth: options.width, intrinsicHeight: options.height, transform: { position: options.position ?? { x: 0, y: 0 }, scale: { x: scale, y: scale }, rotation: 0 },
      }) as unknown as El;
      placeElements(sceneById(draft, options.sceneId), [element], { strategy: "firstAvailable" }, env);
      return { selection: [element.id], info: { elementId: element.id } };
    },
  };
}
