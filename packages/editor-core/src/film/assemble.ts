import type { ProjectDocument } from "@jagentchill/protocol";
import type { CommitContext } from "../commit.ts";
import { assembleProject } from "../prompt-video/assemble.ts";
import type { CaptionSet, MotionPreset, Script, ShotList, ShotMedia, VoiceTrack } from "../prompt-video/contracts.ts";
import { TICKS, type VideoParams } from "../prompt-video/params.ts";
import { FilmError, NARRATOR, activeTake, clipOf, orderedPanels, speakerName, type CameraMotion, type Film, type FilmProject, type Line, type Panel } from "./model.ts";

/**
 * From a film to its timeline: where every panel, take and caption sits, and the editor project built from that. A
 * panel is as long as the person set it, or longer when the takes spoken over it need the time. A panel without a
 * picture is never replaced by dummy media: it is either left out on request or assembly refuses.
 */
const MOTION: Record<CameraMotion, MotionPreset> = { static: "none", "pan-left": "pan-left", "pan-right": "pan-right", "tilt-up": "slow-zoom-in", "tilt-down": "slow-zoom-out", "push-in": "slow-zoom-in", "pull-out": "slow-zoom-out", track: "pan-right", orbit: "pan-left", handheld: "slow-zoom-in" };
export const motionOf = (panel: Pick<Panel, "cameraMotion">): MotionPreset => MOTION[panel.cameraMotion];
const LEAD = TICKS / 5, GAP = TICKS / 5;

export type PlacedPanel = { panel: Panel; number: number; start_ticks: number; duration_ticks: number; placed: boolean };
export type PlacedLine = { line: Line; panelId: string; start_ticks: number; duration_ticks: number; spoken: boolean };
export type Layout = {
  panels: PlacedPanel[]; lines: PlacedLine[]; total_ticks: number;
  /** Panels left out because they have no picture, lines with no panel, and lines of a panel that have no take. */
  withoutMedia: Panel[]; unbound: Line[]; silent: Line[];
};
/** Where everything sits. Panels without a picture keep their place in the list with `placed: false` and take no time. */
export function layout(film: Film): Layout {
  const frame = TICKS / film.frameRate, floor = (ticks: number) => Math.max(frame, Math.floor(ticks / frame) * frame), ceil = (ticks: number) => Math.ceil(ticks / frame - 1e-9) * frame;
  const byPanel = new Map<string, Line[]>();
  for (const line of film.lines) if (line.panelId) byPanel.set(line.panelId, [...(byPanel.get(line.panelId) ?? []), line]);
  const panels: PlacedPanel[] = [], lines: PlacedLine[] = [], silent: Line[] = [];
  let start = 0;
  orderedPanels(film).forEach((panel, index) => {
    // A frame a person left out is out of the film whatever it holds — also a picture drawn before they decided.
    if (!panel.picture.current || panel.leftOut === true) { panels.push({ panel, number: index + 1, start_ticks: start, duration_ticks: 0, placed: false }); return; }
    const own = byPanel.get(panel.id) ?? [];
    let at = own.some((line) => activeTake(line)) ? ceil(LEAD) : 0;
    const placedHere: PlacedLine[] = [];
    for (const line of own) {
      const take = activeTake(line);
      if (!take) { silent.push(line); continue; }
      const duration = floor(take.duration_ticks);
      placedHere.push({ line, panelId: panel.id, start_ticks: start + at, duration_ticks: duration, spoken: true });
      at += duration + ceil(GAP);
    }
    const duration = Math.max(ceil(panel.duration_ticks), ceil(at));
    // Lines without a take are still read as captions, sharing what the panel has left.
    const quiet = own.filter((line) => !activeTake(line));
    if (quiet.length) {
      const from = placedHere.length ? at : 0, room = Math.max(frame * quiet.length, duration - from), each = floor(room / quiet.length);
      quiet.forEach((line, order) => placedHere.push({ line, panelId: panel.id, start_ticks: start + Math.min(from + order * each, duration - frame), duration_ticks: Math.min(each, duration), spoken: false }));
    }
    lines.push(...placedHere.sort((a, b) => a.start_ticks - b.start_ticks));
    panels.push({ panel, number: index + 1, start_ticks: start, duration_ticks: duration, placed: true });
    start += duration;
  });
  const placedPanels = new Set(panels.filter((entry) => entry.placed).map((entry) => entry.panel.id));
  return { panels, lines, total_ticks: start, /* a frame a person left out is not one that still waits for its picture */ withoutMedia: panels.filter((entry) => !entry.placed && entry.panel.leftOut !== true).map((entry) => entry.panel), unbound: film.lines.filter((line) => !line.panelId || !placedPanels.has(line.panelId)), silent };
}

export type AssembleInput = { film: Film; projectId: string; runId: string; hash: string; withoutMissing: boolean };
/** The film as an editor project: stills with motion on the main track, the active takes, captions from the lines, the music under them. */
export function assembleFilm(input: AssembleInput, context: CommitContext): { document: ProjectDocument; project: FilmProject } {
  const { film } = input, placed = layout(film);
  if (!placed.panels.length) throw new FilmError("INVALID_PARAMS", "The film has no panels yet. Create the script first.", {});
  if (placed.withoutMedia.length && !input.withoutMissing) throw new FilmError("INVALID_PARAMS", `${placed.withoutMedia.length} ${placed.withoutMedia.length === 1 ? "panel has" : "panels have"} no media. Generate them, or assemble without them.`, { panelIds: placed.withoutMedia.map((panel) => panel.id) });
  const shown = placed.panels.filter((entry) => entry.placed);
  if (!shown.length) throw new FilmError("INVALID_PARAMS", "No panel has an image yet.", {});
  const params: VideoParams = { prompt: film.title, targetDuration_s: Math.max(1, Math.round(placed.total_ticks / TICKS)), aspectRatio: film.aspectRatio, resolution: "1080p", frameRate: film.frameRate, language: film.language, style: "auto", voice: "auto", musicMood: "auto", captions: film.captions, mode: "auto" };
  const linesOf = (panelId: string) => placed.lines.filter((entry) => entry.panelId === panelId);
  const script: Script = { title: film.title, language: film.language, segments: placed.lines.map(({ line, duration_ticks }) => ({ id: line.id, beatLabel: "", kind: line.kind === "dialogue" ? "dialogue" : "narration", speaker: line.speakerId === NARRATOR ? "" : speakerName(film, line.speakerId), text: line.text, estimatedDuration_s: duration_ticks / TICKS })) };
  const shotList: ShotList = { shots: shown.map(({ panel, duration_ticks }, index) => ({ id: panel.id, index, segmentIds: linesOf(panel.id).map((entry) => entry.line.id), duration_ticks, description: panel.action, shotSize: "medium", cameraMotion: "static", subjects: [], setting: "", onScreenText: "", transitionOut: "cut" })) };
  // A shot whose picture was set in motion is that clip (unless a person keeps it a still); every other shot is its still, as before.
  const shotMedia: ShotMedia[] = shown.map(({ panel }) => { const clip = panel.still === true ? null : clipOf(panel); return { shotId: panel.id, method: "image", prompt: panel.picture.current!.prompt, motion: motionOf(panel), media: panel.picture.current!.media, costUsd: panel.picture.current!.costUsd, ...(clip ? { clip: clip.media } : {}) }; });
  const spoken = placed.lines.filter((entry) => entry.spoken);
  const voiceTrack: VoiceTrack | null = spoken.length ? { voices: {}, takes: spoken.map((entry) => ({ segmentId: entry.line.id, shotId: entry.panelId, media: activeTake(entry.line)!.media, start_ticks: entry.start_ticks, duration_ticks: entry.duration_ticks })), total_ticks: placed.total_ticks, warnings: [] } : null;
  const captions: CaptionSet | null = film.captions && placed.lines.length ? { language: film.language, cues: placed.lines.map((entry) => ({ segmentId: entry.line.id, text: entry.line.text, start_ticks: entry.start_ticks, duration_ticks: entry.duration_ticks, speaker: entry.line.speakerId === NARRATOR ? "" : speakerName(film, entry.line.speakerId) })), warnings: [] } : null;
  const built = assembleProject({ runId: input.runId, runNumber: 1, projectId: input.projectId, artifactVersionId: input.hash.slice(0, 32), params, brief: { title: film.title }, script, shotList, shotMedia, voiceTrack, captions, music: film.music.current ? { media: film.music.current.media, mood: film.music.mood } : null }, context);
  return { document: built.document, project: { projectId: input.projectId, name: built.document.metadata.name, assembled_ms: context.now_ms, hash: input.hash, clips: built.report.clips, voiceElements: built.report.voiceElements, captionCues: built.report.captionCues, musicElements: built.report.musicElements, duration_ticks: built.report.duration_ticks } };
}
/** What of the film the timeline is built from: the same value means the same project. */
export function assemblyKey(film: Film, withoutMissing: boolean): unknown {
  const placed = layout(film);
  return { title: film.title, aspectRatio: film.aspectRatio, frameRate: film.frameRate, captions: film.captions, withoutMissing, music: film.music.current?.media.blobId ?? null,
    panels: placed.panels.filter((entry) => entry.placed).map((entry) => [entry.panel.id, entry.panel.picture.current!.media.blobId, entry.duration_ticks, entry.panel.cameraMotion, /* only when there is a clip: a film without any keeps the key — and so the project — it had before clips existed */ ...((clip) => (clip ? [clip.media.blobId] : []))(entry.panel.still === true ? null : clipOf(entry.panel))]),
    lines: placed.lines.map((entry) => [entry.line.id, entry.line.text, entry.start_ticks, entry.duration_ticks, activeTake(entry.line)?.media.blobId ?? null]) };
}
