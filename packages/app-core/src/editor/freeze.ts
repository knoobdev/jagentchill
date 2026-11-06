import { snapToFrame, timeline } from "@jagentchill/editor-core";
import { createElement, type ProjectDocument, type Rational } from "@jagentchill/protocol";

/** The one default freeze duration: 3 s. */
export const FREEZE_DEFAULT_TICKS = 360_000;
const inside = (element: timeline.El, time: number): boolean => element.startTime < time && time < timeline.endOf(element);
const freezable = (element: timeline.El): boolean => (element.type === "video" || element.type === "compound") && !timeline.isFreeze(element);

/** The element "Freeze frame" acts on: the single selected video or compound clip under the playhead, or with no selection the main-track one. */
export function freezeTarget(doc: ProjectDocument, sceneId: string, selectedIds: readonly string[], playhead: number): string | undefined {
  const scene = timeline.sceneById(doc, sceneId);
  if (selectedIds.length === 1) return timeline.elementsOfScene(scene).find((element) => element.id === selectedIds[0] && freezable(element) && inside(element, playhead))?.id;
  return selectedIds.length === 0 ? scene.tracks.main.elements.find((element) => freezable(element) && inside(element, playhead))?.id : undefined;
}

/** The fields a freeze element copies from its clip, as the static values the clip has. Keyframes are not copied. */
const COPIED = ["transform", "crop", "flip", "opacity", "blendMode", "effects", "masks", "adjustments", "chromaKey", "cutout", "background"] as const;

/**
 * "Freeze frame": the clip is split at the playhead frame and a freeze element holding the source frame under the
 * playhead goes between the two parts; the second part and everything after it on the track moves right by the
 * freeze duration, on every track type and whatever the ripple setting is. One undo step.
 */
export const freezeFrameAt = (options: { sceneId: string; elementId: string; time: number; duration?: number }): timeline.TimelineCommand<{ elementId: string }> => ({
  type: "timeline.freeze", label: "Freeze frame", sceneId: options.sceneId,
  run(draft, env) {
    const scene = timeline.sceneById(draft, options.sceneId), fps = draft.settings.fps as Rational;
    const track = timeline.tracksOfScene(scene).find((entry) => entry.elements.some((element) => element.id === options.elementId));
    const source = track?.elements.find((element) => element.id === options.elementId);
    const time = snapToFrame(options.time, fps), duration = Math.max(snapToFrame(options.duration ?? FREEZE_DEFAULT_TICKS, fps), snapToFrame(1, fps) || 1);
    if (!track || !source || !freezable(source) || !inside(source, time)) return timeline.refuse("Select a video clip and move the playhead onto it", "freeze-target");
    if (track.locked) return timeline.refuse("The track is locked", "track-locked");
    const rate = Number((source.retime as { rate?: number } | undefined)?.rate ?? 1), sourceTime = Math.round(source.trimStart + (time - source.startTime) * rate);
    const copied = Object.fromEntries(COPIED.filter((field) => source[field] !== undefined).map((field) => [field, JSON.parse(JSON.stringify(source[field]))]));
    // Effects and masks carry ids of their own: the freeze element gets fresh ones, or the document would hold an id twice.
    for (const field of ["effects", "masks"] as const) if (Array.isArray(copied[field])) copied[field] = (copied[field] as Record<string, unknown>[]).map((entry) => (typeof entry?.id === "string" ? { ...entry, id: env.newId() } : entry));
    timeline.splitOne(track, source, time, env.newId);
    for (const element of track.elements) if (element.startTime >= time) element.startTime += duration;
    const base = { id: env.newId(), name: `${source.name} (freeze)`, startTime: time, duration, ...copied };
    const frozen = (source.type === "compound"
      ? createElement("compound", { ...base, sceneId: source.sceneId, freeze: { sourceTime } } as never)
      : createElement("video", { ...base, mediaId: source.mediaId, freeze: { mediaId: source.mediaId, sourceTime }, isSourceAudioEnabled: false } as never)) as unknown as timeline.El;
    track.elements.push(frozen);
    track.elements.sort((a, b) => a.startTime - b.startTime);
    // The command placed everything itself: the closing passes must not pull the shifted clips back.
    return { selection: [frozen.id], info: { elementId: frozen.id }, noRipple: true, noMagnet: true };
  },
});
