import { timeline } from "@jagentchill/editor-core";

export const TRACK_VOLUME = { min: -60, max: 12, step: 0.1, default: 0 } as const;
export const TRACK_PAN = { min: -100, max: 100, step: 1, default: 0 } as const;
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
/** The volume and pan a track has, with the defaults of a track that never had them set. */
export const trackSound = (track: timeline.Tr): { volume: number; pan: number; muted: boolean; solo: boolean } =>
  ({ volume: typeof track.volume === "number" ? track.volume : TRACK_VOLUME.default, pan: typeof track.pan === "number" ? track.pan : TRACK_PAN.default, muted: track.muted === true, solo: track.solo === true });
/**
 * Sets the volume (−60…+12 dB) and the pan (−100 left … +100 right) of a video or audio track, as one undo step.
 * Other track types have no sound of their own and refuse.
 */
export const setTrackSound = (options: { trackId: string; volume?: number; pan?: number }): timeline.TimelineCommand => ({
  type: "timeline.track.sound", label: options.pan !== undefined && options.volume === undefined ? "Track pan" : "Track volume",
  run(draft) {
    const track = (draft.scenes as unknown as timeline.Sc[]).flatMap((scene) => timeline.tracksOfScene(scene)).find((entry) => entry.id === options.trackId);
    if (!track) return timeline.refuse("The track no longer exists", "unknown-track");
    if (!timeline.trackSupports(track, "volume")) return timeline.refuse("This track has no sound", "no-sound");
    if (options.volume !== undefined) track.volume = Math.round(clamp(options.volume, TRACK_VOLUME.min, TRACK_VOLUME.max) * 10) / 10;
    if (options.pan !== undefined) track.pan = Math.round(clamp(options.pan, TRACK_PAN.min, TRACK_PAN.max));
    return { noRipple: true, noMagnet: true, noLinkage: true };
  },
});
/** "L 40", "C", "R 100": how a pan value reads. */
export const panLabel = (pan: number): string => (pan === 0 ? "C" : `${pan < 0 ? "L" : "R"} ${Math.abs(Math.round(pan))}`);
