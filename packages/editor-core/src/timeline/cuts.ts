import { TICKS_PER_SECOND } from "@jagentchill/protocol";
import { frameTicks, roundHalfAway, snapToFrame } from "../time.ts";
import type { TimelineCommand } from "./command.ts";
import { removeElements, splitOne } from "./edit.ts";
import { endOf, fpsOf, hasSourceBounds, refuse, rejectDoc, sceneById, TIMELINE_MESSAGES, tracksOfScene, type El, type Sc, type Tr } from "./model.ts";

// — Automatic scene-cut detection —
export const SCENE_CUT = { frameWidth: 64, frameHeight: 36, bins: 64, maxSamplesPerSecond: 10, minGapSeconds: 0.5, defaultSensitivity: 50 } as const;
/** The difference above which a cut is marked: `0.8 − 0.006 × sensitivity` (slider 1–100; 50 gives 0.5). */
export const sceneCutThreshold = (sensitivity: number = SCENE_CUT.defaultSensitivity): number => Math.round((0.8 - 0.006 * Math.min(100, Math.max(1, sensitivity))) * 1000) / 1000;
/** The 64-bin luma histogram of a decoded frame downscaled to 64 × 36, normalised to sum 1. */
export function lumaHistogram(luma: ArrayLike<number>): Float64Array {
  const histogram = new Float64Array(SCENE_CUT.bins);
  for (let index = 0; index < luma.length; index++) histogram[Math.min(SCENE_CUT.bins - 1, Math.max(0, Math.floor(luma[index] / (256 / SCENE_CUT.bins))))]++;
  if (luma.length > 0) for (let bin = 0; bin < histogram.length; bin++) histogram[bin] /= luma.length;
  return histogram;
}
/** Half the L1 distance of two normalised histograms: 0 (same) to 1 (disjoint). */
export function histogramDifference(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let sum = 0;
  for (let bin = 0; bin < a.length; bin++) sum += Math.abs(a[bin] - b[bin]);
  return sum / 2;
}
export type FrameSample = { time: number; histogram: ArrayLike<number> };
/** The sample times of the visible source range: at most 10 per second, on the source's frames. */
export function sceneCutSampleTimes(sourceStart: number, sourceEnd: number, sourceFps = 30): number[] {
  const step = TICKS_PER_SECOND / Math.min(SCENE_CUT.maxSamplesPerSecond, sourceFps), times: number[] = [];
  for (let time = sourceStart; time < sourceEnd; time += step) times.push(Math.round(time));
  return times;
}
/** The pairs of consecutive samples whose difference exceeds the threshold: a cut lies between each pair. */
export function coarseCuts(samples: FrameSample[], sensitivity?: number): { before: FrameSample; after: FrameSample }[] {
  const threshold = sceneCutThreshold(sensitivity), cuts: { before: FrameSample; after: FrameSample }[] = [];
  for (let index = 1; index < samples.length; index++) if (histogramDifference(samples[index - 1].histogram, samples[index].histogram) > threshold) cuts.push({ before: samples[index - 1], after: samples[index] });
  return cuts;
}
/** Refines a cut to the exact frame: among the frames from one sample to the next, the pair with the greatest difference; the cut is the later frame's time. */
export function refineCut(frames: FrameSample[]): number {
  let best = { time: frames[frames.length - 1].time, difference: -1 };
  for (let index = 1; index < frames.length; index++) {
    const difference = histogramDifference(frames[index - 1].histogram, frames[index].histogram);
    if (difference > best.difference) best = { time: frames[index].time, difference };
  }
  return best.time;
}
/** Cuts closer than 0.5 s to the previous kept cut are discarded. */
export function spacedCuts(times: number[]): number[] {
  const kept: number[] = [];
  for (const time of [...times].sort((a, b) => a - b)) if (kept.length === 0 || time - kept[kept.length - 1] >= SCENE_CUT.minGapSeconds * TICKS_PER_SECOND) kept.push(time);
  return kept;
}
/** The decoder side of the analysis, supplied by the caller (it runs on-device on decoded frames). */
export type SceneCutSource = { histogramAt(sourceTime: number): Promise<ArrayLike<number>>; framesBetween(from: number, to: number): Promise<FrameSample[]> };
/**
 * Runs the analysis over the visible source range of a clip: samples, coarse cuts, refinement, spacing. Reports
 * progress 0–1 and resolves to `null` when cancelled — in which case nothing is changed.
 */
export async function analyseSceneCuts(source: SceneCutSource, range: { sourceStart: number; sourceEnd: number; sourceFps?: number }, options: { sensitivity?: number; onProgress?: (fraction: number) => void; isCancelled?: () => boolean } = {}): Promise<number[] | null> {
  const times = sceneCutSampleTimes(range.sourceStart, range.sourceEnd, range.sourceFps), samples: FrameSample[] = [];
  for (const [index, time] of times.entries()) {
    if (options.isCancelled?.()) return null;
    samples.push({ time, histogram: await source.histogramAt(time) });
    options.onProgress?.(((index + 1) / times.length) * 0.9);
  }
  const refined: number[] = [];
  for (const cut of coarseCuts(samples, options.sensitivity)) {
    if (options.isCancelled?.()) return null;
    refined.push(refineCut(await source.framesBetween(cut.before.time, cut.after.time)));
  }
  options.onProgress?.(1);
  return spacedCuts(refined);
}

const rateOf = (element: El): number => {
  const rate = (element.retime as { rate?: number } | undefined)?.rate;
  return hasSourceBounds(element) && typeof rate === "number" ? rate : 1;
};
const locateIn = (scene: Sc, elementId: string): { track: Tr; element: El } => {
  for (const track of tracksOfScene(scene)) { const element = track.elements.find((entry) => entry.id === elementId); if (element) return { track, element }; }
  return rejectDoc("document/unknown-reference", "", `element "${elementId}" does not exist`);
};
/** The scene time at which an element shows a source time. */
export const sceneTimeOfSource = (element: El, sourceTime: number): number => element.startTime + (sourceTime - element.trimStart) / rateOf(element);

/** "Split scenes": splits the element at each detected cut (source times) as one undo step; with no cut nothing is recorded. */
export const splitAtSourceTimes = (options: { sceneId: string; elementId: string; sourceTimes: number[] }): TimelineCommand<{ splits: number }> => ({
  type: "timeline.split-scenes", label: "Split scenes", sceneId: options.sceneId,
  run(draft, env) {
    const scene = sceneById(draft, options.sceneId), { track, element } = locateIn(scene, options.elementId), fps = fpsOf(draft);
    if (track.locked) refuse("The track is locked", "track-locked");
    const times = [...new Set(options.sourceTimes.map((time) => snapToFrame(sceneTimeOfSource(element, time), fps)))].filter((time) => time > element.startTime && time < endOf(element)).sort((a, b) => b - a);
    if (times.length === 0) refuse(TIMELINE_MESSAGES.noSceneChanges, "no-cuts");
    const made = times.map((time) => splitOne(track, element, time, env.newId).id);
    return { selection: [element.id, ...made], info: { splits: times.length } };
  },
});

/**
 * `RemoveSourceRanges {elementId, ranges[]}`: for each source range, in descending time order, the element is split at
 * the range's frame-rounded boundaries, the part inside is removed and the gap is closed on that track. A linked
 * partner loses the same ranges; attached elements follow by linkage. Ranges outside the visible source are ignored,
 * overlapping ranges are merged, and a call that would leave less than one frame is rejected.
 */
export const removeSourceRanges = (options: { sceneId: string; elementId: string; ranges: { sourceStart: number; sourceEnd: number }[] }): TimelineCommand<{ removedCount: number; removedDuration: number }> => ({
  type: "timeline.remove-source-ranges", label: "Remove ranges", sceneId: options.sceneId,
  run(draft, env) {
    const scene = sceneById(draft, options.sceneId), primary = locateIn(scene, options.elementId), fps = fpsOf(draft), frame = frameTicks(fps);
    const visibleStart = primary.element.trimStart, visibleEnd = primary.element.trimStart + roundHalfAway(primary.element.duration * rateOf(primary.element));
    const merged: { start: number; end: number }[] = [];
    for (const range of [...options.ranges].sort((a, b) => a.sourceStart - b.sourceStart)) {
      const start = Math.max(visibleStart, range.sourceStart), end = Math.min(visibleEnd, range.sourceEnd);
      if (end <= start) continue;
      const last = merged[merged.length - 1];
      if (last && start <= last.end) last.end = Math.max(last.end, end); else merged.push({ start, end });
    }
    // Scene-time intervals on the frame grid, inside the element.
    const cuts = merged.map((range) => ({ start: Math.max(primary.element.startTime, snapToFrame(sceneTimeOfSource(primary.element, range.start), fps)), end: Math.min(endOf(primary.element), snapToFrame(sceneTimeOfSource(primary.element, range.end), fps)) })).filter((cut) => cut.end > cut.start);
    const removedDuration = cuts.reduce((sum, cut) => sum + (cut.end - cut.start), 0);
    if (primary.element.duration - removedDuration < frame) rejectDoc("document/out-of-range", "", "the ranges would leave less than one frame of the element");
    const partner = primary.element.linkId ? tracksOfScene(scene).flatMap((track) => track.elements.map((element) => ({ track, element }))).find((hit) => hit.element.linkId === primary.element.linkId && hit.element.id !== primary.element.id) : undefined;
    if ([primary, partner].some((hit) => hit?.track.locked)) refuse("A linked clip is on a locked track", "track-locked");
    const piecesOf = new Map<string, El[]>();
    for (const hit of [primary, partner].filter((entry): entry is { track: Tr; element: El } => entry !== undefined)) {
      const pieces = [hit.element];
      for (const cut of [...cuts].reverse()) {
        const piece = pieces.find((candidate) => candidate.startTime < cut.end && endOf(candidate) > cut.start);
        if (!piece) continue;
        if (cut.end < endOf(piece)) pieces.push(splitOne(hit.track, piece, cut.end, env.newId));
        const inside = cut.start > piece.startTime ? splitOne(hit.track, piece, cut.start, env.newId) : piece;
        removeElements(draft, scene, new Set([inside.id]));
        if (inside === piece) pieces.splice(pieces.indexOf(piece), 1);
        for (const other of hit.track.elements) if (other.startTime >= cut.end) other.startTime -= cut.end - cut.start;
      }
      piecesOf.set(hit.element.id, pieces.sort((a, b) => a.startTime - b.startTime));
    }
    // The pieces of a linked pair stay linked pairwise.
    if (partner) {
      const own = piecesOf.get(primary.element.id)!, other = piecesOf.get(partner.element.id)!;
      own.forEach((piece, index) => { const mate = other[index]; const linkId = mate ? (index === 0 ? primary.element.linkId : env.newId()) : null; piece.linkId = linkId; if (mate) mate.linkId = linkId; });
      other.slice(own.length).forEach((piece) => { piece.linkId = null; });
    }
    return { selection: piecesOf.get(primary.element.id)!.map((piece) => piece.id), info: { removedCount: cuts.length, removedDuration }, noRipple: true, noMagnet: true };
  },
});
