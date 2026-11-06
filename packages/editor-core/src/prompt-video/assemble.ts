import { createElement, createProjectDocument, createTrack, type ProjectDocument } from "@jagentchill/protocol";
import { commitChange, type CommitContext } from "../commit.ts";
import { CAPTION_STYLES } from "../content/captions/styles.ts";
import { captionStyleFields } from "../ops/captions.ts";
import { addAsset } from "../ops/media.ts";
import type { Brief, CaptionSet, MediaFile, MotionPreset, MusicTrack, Script, ShotList, ShotMedia, VoiceTrack } from "./contracts.ts";
import { TICKS, canvasOf, type VideoParams } from "./params.ts";
import { totalTicks } from "./timing.ts";

/**
 * Assembly of a run into a real editor project, with no model: one still per shot on the main track with its motion as
 * two keyframes, on-screen text on "Titles", the takes on "Voiceover" flagged as voice, the script's cues on a caption
 * track, and the music on "Music" at −18 dB, repeated to the timeline's length, faded out, and ducked under the voice.
 * Pure: the same inputs and id source give the same document.
 */
export type AssembleInput = {
  runId: string; runNumber: number; projectId: string; artifactVersionId: string; params: VideoParams; brief: Pick<Brief, "title">; script: Script; shotList: ShotList;
  shotMedia: readonly ShotMedia[]; voiceTrack: VoiceTrack | null; captions: CaptionSet | null; music: MusicTrack;
};
export type AssembleReport = { clips: number; titles: number; voiceElements: number; captionCues: number; musicElements: number; duration_ticks: number; sceneName: string };
/** A shot without a picture is never replaced by dummy media: assembly refuses and names it. */
export class AssembleError extends Error {
  readonly code = "INVALID_PARAMS";
  readonly details: Record<string, unknown>;
  constructor(message: string, details: Record<string, unknown>) { super(message); this.name = "AssembleError"; this.details = details; }
}

const MUSIC_DB = -18, FADE_OUT = 1.5 * TICKS, ZOOM = 1.08;
/** The two keys of a motion preset, at the element's first and last frame. */
/**
 * How much a picture placed to FIT the canvas must grow to COVER it: 1 when it has the canvas's shape. A 3:2 still in a
 * 16:9 film is 1.185 — without it the film shows a black bar on each side (seen in a real export).
 */
export function coverScale(canvas: { width: number; height: number }, picture: { width?: number; height?: number } | undefined): number {
  if (!picture?.width || !picture.height) return 1;
  const across = canvas.width / picture.width, down = canvas.height / picture.height;
  return Math.round((Math.max(across, down) / Math.min(across, down)) * 10_000) / 10_000;
}
export function motionKeys(motion: MotionPreset, duration: number, frame: number, canvasWidth: number, newId: () => string, cover = 1): Record<string, unknown> | undefined {
  if (motion === "none" && cover <= 1.0005) return undefined;
  const last = Math.max(frame, duration - frame);
  const channel = (from: number, to: number) => ({ keys: [{ id: newId(), time: 0, value: from, segmentToNext: "linear" }, { id: newId(), time: last, value: to, segmentToNext: "linear" }] });
  const scale = (from: number, to: number) => ({ "transform.scale.x": channel(from * cover, to * cover), "transform.scale.y": channel(from * cover, to * cover) });
  if (motion === "none") return scale(1, 1);
  if (motion === "slow-zoom-in") return scale(1, ZOOM);
  if (motion === "slow-zoom-out") return scale(ZOOM, 1);
  // A pan travels 4 % of the canvas width at a scale that keeps the frame covered.
  const travel = canvasWidth * 0.02 * (motion === "pan-left" ? 1 : -1);
  return { ...scale(ZOOM, ZOOM), "transform.position.x": channel(travel, -travel) };
}

export function assembleProject(input: AssembleInput, context: CommitContext): { document: ProjectDocument; report: AssembleReport } {
  const { params, shotList } = input, frame = TICKS / params.frameRate, canvas = canvasOf(params.aspectRatio, params.resolution), sceneName = `Video ${input.runNumber}`;
  const mediaOf = new Map(input.shotMedia.map((entry) => [entry.shotId, entry]));
  const without = shotList.shots.filter((shot) => !mediaOf.get(shot.id)?.media);
  if (without.length) throw new AssembleError(`Shot ${without[0].index + 1} has no picture. Make it again or remove the shot.`, { shotIds: without.map((shot) => shot.id) });

  let document = createProjectDocument({ id: input.projectId, mainSceneId: context.newId(), mainTrackId: context.newId(), now_ms: context.now_ms, name: input.brief.title.slice(0, 80), canvasSize: canvas, fps: { numerator: params.frameRate, denominator: 1 } });
  // Each file once in the library, whatever uses it.
  const assetIds = new Map<string, string>();
  const asset = (file: MediaFile): string => {
    const known = assetIds.get(file.blobId);
    if (known) return known;
    const added = addAsset(document, context, {
      name: file.name.slice(0, 255), type: file.kind, size: file.bytes, contentHash: file.blobId, provenance: file.provenance,
      ...(file.kind === "image" ? { width: file.width ?? canvas.width, height: file.height ?? canvas.height } : file.kind === "video" ? { width: file.width ?? canvas.width, height: file.height ?? canvas.height, duration: Math.max(1, file.duration_ticks ?? 1), hasAudio: false } : { duration: Math.max(1, file.duration_ticks ?? 1), hasAudio: true }),
    });
    document = added.document;
    assetIds.set(file.blobId, added.assetId);
    return added.assetId;
  };
  for (const shot of shotList.shots) { const media = mediaOf.get(shot.id)!; asset(media.media!); if (media.clip) asset(media.clip); }
  for (const take of input.voiceTrack?.takes ?? []) asset(take.media);
  if (input.music) asset(input.music.media);

  const link = (shotId?: string) => ({ runId: input.runId, stepId: "assemble", ...(shotId ? { shotId } : {}), artifactVersionId: input.artifactVersionId });
  const report: AssembleReport = { clips: 0, titles: 0, voiceElements: 0, captionCues: 0, musicElements: 0, duration_ticks: totalTicks(shotList), sceneName };
  const segmentOf = new Map(input.script.segments.map((segment) => [segment.id, segment])), shown = new Set<string>();
  const commit = commitChange(document, context, { commandType: "workflow.assemble", label: "Workflow: Assemble" }, (draft) => {
    const scene = draft.scenes[0], main = scene.tracks.main as unknown as { elements: unknown[] };
    (scene as unknown as { name: string }).name = sceneName;
    const titles = createTrack("text", { id: context.newId(), name: "Titles" }) as unknown as { elements: unknown[] };
    let start = 0;
    for (const shot of shotList.shots) {
      const media = mediaOf.get(shot.id)!, animations = motionKeys(media.motion, shot.duration_ticks, frame, canvas.width, context.newId, coverScale(canvas, media.media ?? undefined));
      // A shot that was set in motion is its clip — a real video, which moves by itself: no zoom or pan is laid over it — cut to the shot's length; a shot longer than its clip holds the clip's last frame to its end (never a jump back to the still).
      const source = media.clip ? Math.floor((media.clip.duration_ticks ?? 0) / frame) * frame : 0;
      if (media.clip && source >= frame) {
        const mediaId = assetIds.get(media.clip.blobId), played = Math.min(source, shot.duration_ticks), cover = coverScale(canvas, media.clip), fill = cover > 1.0005 ? motionKeys("none", played, frame, canvas.width, context.newId, cover) : undefined;
        main.elements.push(createElement("video", { id: context.newId(), name: `Shot ${shot.index + 1}`, startTime: start, duration: played, sourceDuration: media.clip.duration_ticks, trimEnd: Math.max(0, media.clip.duration_ticks! - played), mediaId, isSourceAudioEnabled: false, workflowLink: link(shot.id), ...(fill ? { animations: fill } : {}) }));
        if (played < shot.duration_ticks) { const held = shot.duration_ticks - played, still = cover > 1.0005 ? motionKeys("none", held, frame, canvas.width, context.newId, cover) : undefined; main.elements.push(createElement("video", { id: context.newId(), name: `Shot ${shot.index + 1} (held)`, startTime: start + played, duration: held, mediaId, freeze: { mediaId, sourceTime: Math.max(0, source - frame) }, isSourceAudioEnabled: false, workflowLink: link(shot.id), ...(still ? { animations: still } : {}) })); }
      } else main.elements.push(createElement("image", { id: context.newId(), name: `Shot ${shot.index + 1}`, startTime: start, duration: shot.duration_ticks, mediaId: assetIds.get(media.media!.blobId), workflowLink: link(shot.id), ...(animations ? { animations } : {}) }));
      report.clips += 1;
      // The words a shot shows: its own on-screen text, else the on-screen lines of the script it is the first to show.
      const lines = shot.segmentIds.map((id) => segmentOf.get(id)).filter((segment) => segment?.kind === "on-screen-text" && !shown.has(segment.id));
      for (const segment of lines) shown.add(segment!.id);
      const text = shot.onScreenText || lines.map((segment) => segment!.text).join("\n");
      if (text) { titles.elements.push(createElement("text", { id: context.newId(), name: text.replace(/\n/g, " ").slice(0, 200), startTime: start, duration: shot.duration_ticks, content: text.slice(0, 2000), workflowLink: link(shot.id) })); report.titles += 1; }
      start += shot.duration_ticks;
    }
    const overlay = scene.tracks.overlay as unknown[], audio = scene.tracks.audio as unknown[];
    if (titles.elements.length) overlay.push(titles);
    if (input.captions?.cues.length) {
      const classic = captionStyleFields(CAPTION_STYLES.find((style) => style.id === "classic")!);
      const track = createTrack("caption", { id: context.newId(), name: "Captions", caption: { language: input.captions.language || "und", ...(input.captions.translationLanguage ? { translationLanguage: input.captions.translationLanguage } : {}), mode: "speech", styleId: "classic", style: classic.style, layout: classic.layout, highlight: classic.highlight } }) as unknown as { elements: unknown[] };
      for (const cue of input.captions.cues) {
        if (cue.start_ticks >= start) continue;
        track.elements.push(createElement("caption", { id: context.newId(), name: cue.text.replace(/\n/g, " ").slice(0, 200) || "Caption", startTime: cue.start_ticks, duration: Math.max(frame, Math.min(cue.duration_ticks, start - cue.start_ticks)), text: cue.text.slice(0, 500), ...(cue.translation ? { translation: cue.translation.slice(0, 500) } : {}), ...(cue.speaker ? { speaker: cue.speaker.slice(0, 80) } : {}), workflowLink: link() }));
        report.captionCues += 1;
      }
      overlay.unshift(track);
    }
    if (input.voiceTrack?.takes.length) {
      const track = createTrack("audio", { id: context.newId(), name: "Voiceover" }) as unknown as { elements: unknown[] };
      for (const take of input.voiceTrack.takes) {
        const duration = Math.min(take.duration_ticks, start - take.start_ticks);
        if (duration < frame) continue;
        track.elements.push(createElement("audio", { sourceType: "upload", id: context.newId(), name: (segmentOf.get(take.segmentId)?.text ?? "Voice").slice(0, 200), startTime: take.start_ticks, duration, mediaId: assetIds.get(take.media.blobId), sourceDuration: take.media.duration_ticks ?? take.duration_ticks, trimEnd: Math.max(0, (take.media.duration_ticks ?? take.duration_ticks) - duration), isVoice: true, workflowLink: link(take.shotId) }));
        report.voiceElements += 1;
      }
      audio.push(track);
    }
    if (input.music && (input.music.media.duration_ticks ?? 0) >= frame) {
      // The clip from tick 0, repeated to the timeline's length; the last piece fades out. It is lowered under the voice.
      // A generated clip ends by fading itself out: played end to end, every repeat left seconds of near silence at the
      // seam (measured on a real film: the sound fell from −15 dB to −51 dB where the 30-second clip met its repeat).
      // So each repeat stops before the clip's own tail, and the seam is a real crossfade: a piece plays ON for `seam`
      // after the next one has started, one fading out while the other fades in (equal power: the level holds). Two
      // pieces that sound at once cannot sit on one track, so the repeats alternate between two music tracks.
      const lanes = [0, 1].map((lane) => createTrack("audio", { id: context.newId(), name: lane ? "Music (crossfade)" : "Music", ducking: { enabled: true, amount: 12 } }) as unknown as { elements: Array<Record<string, unknown>> });
      const source = input.music.media.duration_ticks!, tail = Math.floor(Math.min(3 * TICKS, source / 5) / frame) * frame;
      const step = Math.max(frame, Math.floor((source - tail) / frame) * frame), seam = Math.max(0, Math.min(Math.floor(Math.min(0.4 * TICKS, step / 4) / frame) * frame, source - step));
      const pieces: Array<Record<string, unknown>> = [];
      for (let at = 0, index = 0; at < start && pieces.length < 500; at += step, index++) {
        const follows = at + step < start, duration = Math.min(step + (follows ? seam : 0), start - at);
        if (duration < frame) break;
        const repeat = createElement("audio", { sourceType: "upload", id: context.newId(), name: "Music", startTime: at, duration, mediaId: assetIds.get(input.music.media.blobId), sourceDuration: source, trimEnd: source - duration, volume: MUSIC_DB, workflowLink: link() }) as unknown as Record<string, unknown>;
        if (seam >= frame) { if (at > 0) repeat.fadeIn = { duration: Math.min(seam, duration), shape: "equal-power" }; if (follows) repeat.fadeOut = { duration: seam, shape: "equal-power" }; }
        lanes[seam >= frame ? index % 2 : 0].elements.push(repeat);
        pieces.push(repeat);
      }
      const last = pieces.at(-1);
      if (last) {
        // The end of the film: the long fade-out, with whatever the piece has left after its fade-in.
        const into = ((last.fadeIn as { duration?: number } | undefined)?.duration ?? 0), room = (last.duration as number) - into;
        if (room < frame) delete last.fadeIn;
        last.fadeOut = { duration: Math.min(FADE_OUT, room < frame ? (last.duration as number) : room), shape: "equal-power" };
      }
      report.musicElements = pieces.length;
      for (const lane of lanes) if (lane.elements.length) audio.push(lane);
    }
    (draft as unknown as { workflowLink: unknown }).workflowLink = { runId: input.runId };
  });
  return { document: commit.document, report };
}
