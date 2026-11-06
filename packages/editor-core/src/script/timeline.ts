import { createElement, createProjectDocument, createTrack, type ProjectDocument, type ScriptAspectRatio, type ScriptBeat, type ScriptDocument, type ScriptLine, type ScriptScene, type ScriptShot } from "@jagentchill/protocol";
import { canonicalJson } from "../canonical.ts";
import { commitChange, type CommitContext } from "../commit.ts";
import { captionStyleFields } from "../ops/captions.ts";
import { CAPTION_STYLES } from "../content/captions/styles.ts";
import { sha256, toHex, utf8 } from "../sha256.ts";
import { captionLineLength } from "./check.ts";
import { beatTicks, sceneLineTicks, shotTicks, TICKS_PER_SECOND } from "./estimate.ts";
import { headingText, sceneLines, speakerOf } from "./model.ts";
import { wrapColumns } from "./screenplay.ts";

/**
 * `script-studio.Draft timeline from a script`: a script version becomes a real editor project — one shot slate per
 * shot on the main track with no gaps, scene markers, on-screen text on a "Titles" track and spoken lines as caption
 * cues on a "Script" track. The plan is pure; the client renders each slate to an image and the project is assembled
 * from the plan and those assets through the document's single commit entry.
 */
export const TIMELINE_FPS = { numerator: 30, denominator: 1 } as const;
const FRAME = TICKS_PER_SECOND / 30;
export const TIMELINE_CANVAS: Record<ScriptAspectRatio, { width: number; height: number }> = {
  "16:9": { width: 1920, height: 1080 }, "9:16": { width: 1080, height: 1920 }, "1:1": { width: 1080, height: 1080 }, "4:5": { width: 1080, height: 1350 },
  "4:3": { width: 1440, height: 1080 }, "3:4": { width: 1080, height: 1440 }, "21:9": { width: 2520, height: 1080 },
};
/** Rounded up to a whole frame: 4.25 s at 30 fps is 128 frames. */
export const toFrames = (ticks: number): number => Math.ceil(ticks / FRAME - 1e-9) * FRAME;
const hash = (value: unknown): string => toHex(sha256(utf8(canonicalJson(value))));
/** The content of a shot that the timeline depends on: what `syncedHash` records at the last sync. */
export const shotSyncHash = (document: Pick<ScriptDocument, "meta">, scene: ScriptScene, shot: ScriptShot): string =>
  hash({ description: shot.description, size: shot.size, angle: shot.angle, movement: shot.movement, duration: shotTicks(document, scene, shot), lineIds: shot.lineIds, onScreenText: shot.onScreenText, transitionOut: shot.transitionOut, references: shot.references });
export const lineSyncHash = (document: Pick<ScriptDocument, "entities">, line: ScriptLine): string => hash({ text: line.text, speaker: speakerOf(document, line) });
const beatSyncHash = (document: Pick<ScriptDocument, "entities">, beat: ScriptBeat): string => hash({ label: beat.label, lines: beat.lines.map((line) => [line.kind, line.text, speakerOf(document, line)]) });

export type SlatePlan = {
  key: string; sceneId: string; shotId?: string; beatId?: string; number: string; name: string; heading: string; detail: string; description: string;
  start: number; duration: number; transitionOut: string; lineIds: string[]; syncedHash: string;
};
export type CuePlan = { text: string; start: number; duration: number; lineId: string; sceneId: string; shotId?: string; speaker: string; syncedHash: string };
export type TitlePlan = { text: string; start: number; duration: number; lineId: string; sceneId: string; syncedHash: string };
export type TimelinePlan = {
  scriptId: string; versionId: string; versionNumber: number | null; approved: boolean; name: string; language: string;
  canvas: { width: number; height: number }; slates: SlatePlan[]; markers: { time: number; note: string; sceneId: string }[]; titles: TitlePlan[]; cues: CuePlan[];
  duration: number; warnings: string[];
};

const CLAUSE = /(?<=[.!?…。！？,;:、，；：])\s*/u;
/** Caption cues of one line: at most 2 lines of `length` characters each, broken at sentence and clause boundaries first. */
export function splitCues(text: string, length: number): string[] {
  const cues: string[] = [];
  let current = "";
  const fits = (value: string) => wrapColumns(value, length).length <= 2;
  const flush = () => { if (current.trim()) cues.push(wrapColumns(current.trim(), length).join("\n")); current = ""; };
  for (const clause of text.replace(/\s+/g, " ").trim().split(CLAUSE).filter(Boolean)) {
    const joined = current ? `${current} ${clause}` : clause;
    if (fits(joined)) { current = joined; continue; }
    flush();
    if (fits(clause)) { current = clause; continue; }
    // A clause longer than one cue is cut where its lines wrap.
    const rows = wrapColumns(clause, length);
    for (let index = 0; index < rows.length; index += 2) cues.push(rows.slice(index, index + 2).join("\n"));
  }
  flush();
  return cues;
}

export function planTimeline(document: ScriptDocument, source: { versionId: string; versionNumber: number | null; approved: boolean }): TimelinePlan {
  const plan: TimelinePlan = {
    scriptId: document.id, versionId: source.versionId, versionNumber: source.versionNumber, approved: source.approved, name: document.title, language: document.meta.language,
    canvas: TIMELINE_CANVAS[document.meta.aspectRatio], slates: [], markers: [], titles: [], cues: [], duration: 0, warnings: [],
  };
  const length = captionLineLength(document.meta.aspectRatio);
  let cursor = 0, uncovered = 0;
  document.scenes.forEach((scene, sceneIndex) => {
    if (scene.omitted) return;
    const heading = headingText(document, scene) || scene.title, lineTimes = sceneLineTicks(document, scene), sceneStart = cursor;
    const placed: { slate: SlatePlan; lines: ScriptLine[] }[] = [];
    const place = (slate: Omit<SlatePlan, "start">, lines: ScriptLine[]) => { const full = { ...slate, start: cursor }; plan.slates.push(full); placed.push({ slate: full, lines }); cursor += full.duration; };
    const all = sceneLines(scene);
    if (scene.shots.length > 0) {
      const taken = new Set<string>();
      scene.shots.forEach((shot, index) => {
        const number = `${sceneIndex + 1}.${index + 1}`;
        // A line covered by several shots is captioned in the first of them.
        const lines = all.filter((line) => shot.lineIds.includes(line.id) && !taken.has(line.id));
        for (const line of lines) taken.add(line.id);
        place({ key: shot.id, sceneId: scene.id, shotId: shot.id, number, name: `Shot ${number}`, heading, detail: [shot.size, shot.angle, shot.movement].join(" / "), description: shot.description, duration: toFrames(shotTicks(document, scene, shot)), transitionOut: shot.transitionOut, lineIds: [...shot.lineIds], syncedHash: shotSyncHash(document, scene, shot) }, lines);
      });
      uncovered += all.filter((line) => !taken.has(line.id) && (line.kind === "dialogue" || line.kind === "narration" || line.kind === "on_screen_text") && line.text.trim()).length;
    } else scene.beats.forEach((beat, index) => {
      const number = `${sceneIndex + 1}.${index + 1}`;
      place({ key: beat.id, sceneId: scene.id, beatId: beat.id, number, name: `Shot ${number}`, heading, detail: beat.label, description: beat.intent || beat.lines.find((line) => line.kind === "action" || line.kind === "visual_note")?.text || "", duration: toFrames(Math.max(TICKS_PER_SECOND, beatTicks(document, beat))), transitionOut: "cut", lineIds: beat.lines.map((line) => line.id), syncedHash: beatSyncHash(document, beat) }, beat.lines);
    });
    if (placed.length === 0) return;
    plan.markers.push({ time: sceneStart, note: `Scene ${sceneIndex + 1}${heading ? ` — ${heading}` : ""}`, sceneId: scene.id });
    for (const { slate, lines } of placed) {
      const spoken = lines.filter((line) => (line.kind === "dialogue" || line.kind === "narration") && line.text.trim());
      const wanted = spoken.map((line) => lineTimes.get(line.id) ?? 0), total = wanted.reduce((sum, ticks) => sum + ticks, 0);
      // The lines share the slate in the proportion of their estimates when they would not fit.
      const scale = total > slate.duration ? slate.duration / total : 1;
      let at = slate.start;
      spoken.forEach((line, index) => {
        const end = Math.min(slate.start + slate.duration, index === spoken.length - 1 && scale < 1 ? slate.start + slate.duration : toFrames(at + wanted[index] * scale));
        const span = Math.max(FRAME, end - at), texts = splitCues(line.text.replace(/\*\*|\*|_/g, ""), length), characters = texts.reduce((sum, cue) => sum + cue.length, 0) || 1;
        let cueStart = at;
        texts.forEach((cue, cueIndex) => {
          const cueEnd = cueIndex === texts.length - 1 ? at + span : Math.max(cueStart + FRAME, toFrames(cueStart + (span * cue.length) / characters));
          if (cueStart >= slate.start + slate.duration) return;
          plan.cues.push({ text: cue, start: cueStart, duration: Math.max(FRAME, Math.min(cueEnd, slate.start + slate.duration) - cueStart), lineId: line.id, sceneId: scene.id, ...(slate.shotId ? { shotId: slate.shotId } : {}), speaker: speakerOf(document, line), syncedHash: lineSyncHash(document, line) });
          cueStart = cueEnd;
        });
        at += span;
      });
    }
    // On-screen text spans its beat: from the first slate that shows a line of the beat to the end of the last.
    for (const beat of scene.beats) for (const line of beat.lines) {
      if (line.kind !== "on_screen_text" || !line.text.trim()) continue;
      const ids = new Set(beat.lines.map((entry) => entry.id));
      const spans = placed.filter(({ slate }) => slate.beatId === beat.id || slate.lineIds.some((id) => ids.has(id)));
      if (spans.length === 0) continue;
      const start = spans[0].slate.start, last = spans[spans.length - 1].slate;
      plan.titles.push({ text: line.text, start, duration: last.start + last.duration - start, lineId: line.id, sceneId: scene.id, syncedHash: lineSyncHash(document, line) });
    }
  });
  plan.duration = cursor;
  if (uncovered > 0) plan.warnings.push(`${uncovered} ${uncovered === 1 ? "line is" : "lines are"} not covered by a shot and ${uncovered === 1 ? "was" : "were"} left out`);
  return plan;
}

export type SlateAsset = { assetId: string; size: number; contentHash: string | null; width: number; height: number };
export type TimelineBuild = { document: ProjectDocument; elementIds: Record<string, string> };
/**
 * The project of a plan. `assets` maps each slate key to its rendered image. Transitions named by shots are applied
 * between adjacent slates when the catalogue knows them; any other value is a cut.
 */
export function buildTimelineProject(plan: TimelinePlan, assets: Readonly<Record<string, SlateAsset>>, context: CommitContext & { projectId: string; transitionTypes?: readonly string[] }): TimelineBuild {
  const base = createProjectDocument({ id: context.projectId, mainSceneId: context.newId(), mainTrackId: context.newId(), now_ms: context.now_ms, name: plan.name.slice(0, 80), canvasSize: plan.canvas, fps: { ...TIMELINE_FPS } });
  const elementIds: Record<string, string> = {};
  const link = (sceneId: string, extra: { shotId?: string; lineId?: string }, syncedHash: string) => ({ scriptId: plan.scriptId, sceneId, ...extra, versionId: plan.versionId, syncedHash });
  const commit = commitChange(base, context, { commandType: "script.timeline.create", label: "Create timeline" }, (draft) => {
    const scene = draft.scenes[0], main = scene.tracks.main as unknown as { elements: unknown[]; transitions: unknown[] };
    const media = (draft.media as unknown as { assets: unknown[] }).assets;
    plan.slates.forEach((slate, index) => {
      const asset = assets[slate.key];
      if (!asset) throw new Error(`no slate image for ${slate.name}`);
      media.push({
        id: asset.assetId, name: `${slate.name}.png`, type: "image", kind: "slate", size: asset.size, contentHash: asset.contentHash, width: asset.width, height: asset.height,
        provenance: { source: "slate", scriptId: plan.scriptId, sceneId: slate.sceneId, ...(slate.shotId ? { shotId: slate.shotId } : {}), versionId: plan.versionId }, created_ms: context.now_ms,
      });
      const id = context.newId();
      elementIds[slate.key] = id;
      main.elements.push(createElement("image", { id, name: slate.name, startTime: slate.start, duration: slate.duration, mediaId: asset.assetId, scriptLink: link(slate.sceneId, slate.shotId ? { shotId: slate.shotId } : {}, slate.syncedHash) }));
      const previous = plan.slates[index - 1];
      if (previous && previous.transitionOut !== "cut" && context.transitionTypes?.includes(previous.transitionOut)) {
        const duration = Math.min(60_000, Math.floor(Math.min(previous.duration, slate.duration) / 2 / FRAME) * FRAME);
        if (duration >= FRAME * 3) {
          // The record and the two elements mirror each other.
          const transitionId = context.newId(), elements = main.elements as { id: string; transitionIn?: string | null; transitionOut?: string | null }[];
          main.transitions.push({ id: transitionId, kind: "transition", type: previous.transitionOut, fromElementId: elementIds[previous.key], toElementId: id, duration });
          elements[elements.length - 2].transitionOut = transitionId; elements[elements.length - 1].transitionIn = transitionId;
        }
      }
    });
    // Assets are kept sorted by id.
    (media as { id: string }[]).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    (scene as unknown as { markers: unknown[] }).markers = plan.markers.map((marker) => ({ id: context.newId(), time: marker.time, note: marker.note, color: 1 }));
    const overlay = scene.tracks.overlay as unknown[];
    if (plan.titles.length > 0) {
      // Titles of beats that overlap take a lane each, so that no two elements of a track overlap.
      const lanes: TitlePlan[][] = [];
      for (const title of plan.titles) { const lane = lanes.find((entries) => entries.every((entry) => entry.start + entry.duration <= title.start || title.start + title.duration <= entry.start)); if (lane) lane.push(title); else lanes.push([title]); }
      lanes.forEach((lane, index) => {
        const track = createTrack("text", { id: context.newId(), name: index === 0 ? "Titles" : `Titles ${index + 1}` }) as unknown as { elements: unknown[] };
        for (const title of lane) { const id = context.newId(); elementIds[`title:${title.lineId}`] = id; track.elements.push(createElement("text", { id, name: title.text.slice(0, 200), startTime: title.start, duration: title.duration, content: title.text, scriptLink: link(title.sceneId, { lineId: title.lineId }, title.syncedHash) })); }
        overlay.push(track);
      });
    }
    if (plan.cues.length > 0) {
      const classic = captionStyleFields(CAPTION_STYLES.find((style) => style.id === "classic")!);
      const track = createTrack("caption", { id: context.newId(), name: "Script", caption: { language: plan.language || "und", mode: "speech", styleId: "classic", style: classic.style, layout: classic.layout, highlight: classic.highlight } }) as unknown as { elements: unknown[] };
      for (const cue of plan.cues) track.elements.push(createElement("caption", { id: context.newId(), name: cue.text.replace(/\n/g, " ").slice(0, 200) || "Caption", startTime: cue.start, duration: cue.duration, text: cue.text.slice(0, 500), ...(cue.speaker ? { speaker: cue.speaker.slice(0, 80) } : {}), scriptLink: link(cue.sceneId, { lineId: cue.lineId, ...(cue.shotId ? { shotId: cue.shotId } : {}) }, cue.syncedHash) }));
      overlay.unshift(track);
    }
    (draft as unknown as { scriptLinks: unknown[] }).scriptLinks = [{ scriptId: plan.scriptId }];
  });
  return { document: commit.document, elementIds };
}
/** "From script" or "From script (draft v<n>)": the chip of a project made from an unapproved version. */
export const timelineChip = (plan: Pick<TimelinePlan, "approved" | "versionNumber">): string => (plan.approved ? "From script" : `From script (draft v${plan.versionNumber ?? "?"})`);
