import { createElement, createTrack, type ProjectDocument, type Track } from "@jagentchill/protocol";
import type { ExportCue, ParsedSubtitles } from "../captions/subtitles.ts";
import { CAPTION_STYLES, type CaptionStyle } from "../content/captions/styles.ts";
import { isObject, type Json } from "../model.ts";
import { frameTicks, snapToFrame } from "../time.ts";
import type { TimelineCommand } from "../timeline/command.ts";
import { refuse, sceneById } from "../timeline/model.ts";
import { edit, editable, elementIn, reject, sortElements, trackIn, type Commit, type CommitContext } from "./shared.ts";

/** `captions-subtitles`: caption tracks and their captions — import, the editable list, style templates, highlight, export. */

const TICKS_PER_MS = 120;
type Word = { text: string; start: number; end: number };
const fpsIn = (doc: ProjectDocument) => doc.settings.fps as never;
export const captionTracksOf = (doc: ProjectDocument, sceneId: string): Track[] => (doc.scenes.find((scene) => scene.id === sceneId)?.tracks.overlay ?? []).filter((track) => track.type === "caption") as Track[];
const captionsOf = (track: { elements: unknown }): Json[] => track.elements as Json[];

/** Word timings spread over a duration in proportion to the words' character counts (a caption without `words[]`, or one whose text was edited). */
export function distributeWords(text: string, duration: number): Word[] {
  const words = text.split(/\s+/).filter((word) => word.length > 0), total = words.reduce((sum, word) => sum + Array.from(word).length, 0);
  let spent = 0;
  return words.map((word) => { const start = Math.round((spent / total) * duration); spent += Array.from(word).length; return { text: word.slice(0, 100), start, end: Math.round((spent / total) * duration) }; });
}

/** The stored style and layout of a bundled caption style: every feature the row leaves out is disabled. */
export function captionStyleFields(style: CaptionStyle): { style: Json; layout: Json; highlight: Json } {
  const animation: Json = {};
  for (const group of ["in", "out", "loop"] as const) { const slot = style.animation?.[group]; if (slot) animation[group] = group === "loop" ? { id: slot[0], period: Math.round(slot[1] * 120_000), strength: 100 } : { id: slot[0], duration: Math.round(slot[1] * 120_000), strength: 100 }; }
  return {
    style: {
      fontFamily: style.fontFamily, fontWeight: style.fontWeight, fontStyle: style.fontStyle, textCase: style.textCase, fontSize: style.fontSize, color: style.color, fill: { type: "solid" },
      stroke: style.stroke ? { enabled: true, ...style.stroke } : { enabled: false },
      shadow: style.shadow ? { enabled: true, ...style.shadow } : { enabled: false },
      glow: style.glow ? { enabled: true, ...style.glow } : { enabled: false },
      background: style.background ? { enabled: true, ...style.background } : { enabled: false },
      textAlign: "center", ...(Object.keys(animation).length ? { textAnimation: animation } : {}),
    },
    layout: { ...style.layout },
    highlight: { style: style.highlight.style, ...(style.highlight.color ? { color: style.highlight.color } : {}), ...(style.highlight.textColor ? { textColor: style.highlight.textColor } : {}), ...(style.highlight.scale ? { scale: style.highlight.scale } : {}) },
  };
}
const styleById = (id: string): CaptionStyle => CAPTION_STYLES.find((style) => style.id === id) ?? reject("document/unknown-reference", "", `"${id}" is not a caption style`);

/**
 * Imports parsed subtitle cues as a new caption track in the style `classic` (an ASS file brings its own track style).
 * Times are moved by `offset_ms`, put on the frame grid, and kept from overlapping; a cue shorter than a frame lasts one.
 */
export function importCaptions(options: { sceneId: string; parsed: ParsedSubtitles; language?: string; offset_ms?: number; name?: string; /** What made the track when it was not a file: captions heard in the timeline's speech, or a translation of another track. */ origin?: "speech" | "translation"; sourceId?: string }): TimelineCommand<{ trackId: string; elementIds: string[] }> {
  return {
    type: options.origin === "speech" ? "caption.generate" : options.origin === "translation" ? "caption.translate" : "caption.import", label: options.origin === "speech" ? "Auto captions" : options.origin === "translation" ? "Translate captions" : "Import captions", sceneId: options.sceneId,
    run(draft, env) {
      const scene = sceneById(draft, options.sceneId), fps = fpsIn(draft), frame = frameTicks(fps), trackId = env.newId();
      const classic = captionStyleFields(styleById("classic"));
      const track = createTrack("caption", {
        id: trackId, name: options.name ?? "Captions",
        caption: { language: options.language || "und", mode: "speech", ...(options.sourceId ? { sourceId: options.sourceId } : {}), styleId: "classic", style: { ...classic.style, ...(options.parsed.trackStyle ?? {}) }, layout: { ...classic.layout, ...(options.parsed.layout ?? {}) }, highlight: classic.highlight },
      }) as unknown as { elements: unknown[] };
      let previousEnd = 0;
      const ids: string[] = [];
      for (const cue of [...options.parsed.cues].sort((a, b) => a.start_ms - b.start_ms)) {
        const start = Math.max(previousEnd, snapToFrame(Math.max(0, (cue.start_ms + (options.offset_ms ?? 0)) * TICKS_PER_MS), fps));
        const end = Math.max(start + frame, snapToFrame(Math.max(0, (cue.end_ms + (options.offset_ms ?? 0)) * TICKS_PER_MS), fps));
        const id = env.newId(), text = Array.from(cue.text).slice(0, 500).join("");
        const style = { ...(cue.style ?? {}) };
        track.elements.push(createElement("caption", {
          id, name: text.replace(/\n/g, " ").slice(0, 200) || "Caption", startTime: start, duration: end - start, text,
          ...(cue.words?.length ? { words: cue.words.slice(0, 200).map((word) => ({ text: word.text.slice(0, 100), start: Math.min(end - start, word.start_ms * TICKS_PER_MS), end: Math.min(end - start, word.end_ms * TICKS_PER_MS) })) } : {}),
          ...(cue.speaker ? { speaker: cue.speaker } : {}), ...(Object.keys(style).length ? { style } : {}),
        }));
        ids.push(id); previousEnd = end;
      }
      (scene.tracks.overlay as unknown[]).unshift(track);
      return { selection: ids.slice(0, 1), info: { trackId, elementIds: ids } };
    },
  };
}

/** "Add caption": an empty 2 s caption at a time when that range is free (shortened to the free gap), on the scene's caption track or a new one. */
export function addCaptionAt(options: { sceneId: string; time: number; trackId?: string }): TimelineCommand<{ trackId: string; elementId: string }> {
  return {
    type: "caption.add", label: "Add caption", sceneId: options.sceneId,
    run(draft, env) {
      const scene = sceneById(draft, options.sceneId), fps = fpsIn(draft), frame = frameTicks(fps), start = snapToFrame(Math.max(0, options.time), fps);
      let track = (scene.tracks.overlay as unknown as Json[]).find((entry) => entry.type === "caption" && (!options.trackId || entry.id === options.trackId));
      if (!track) {
        const classic = captionStyleFields(styleById("classic"));
        track = createTrack("caption", { id: env.newId(), name: "Captions", caption: { language: "und", mode: "speech", styleId: "classic", style: classic.style, layout: classic.layout, highlight: classic.highlight } }) as unknown as Json;
        (scene.tracks.overlay as unknown[]).unshift(track);
      }
      const elements = captionsOf(track as never);
      if (elements.some((entry) => Number(entry.startTime) <= start && start < Number(entry.startTime) + Number(entry.duration))) refuse("No room for a caption here", "disabled");
      const next = elements.map((entry) => Number(entry.startTime)).filter((time) => time > start).sort((a, b) => a - b)[0] ?? Infinity;
      const duration = Math.min(240_000, next - start);
      if (duration < frame) refuse("No room for a caption here", "disabled");
      const id = env.newId();
      elements.push(createElement("caption", { id, name: "Caption", startTime: start, duration: snapToFrame(duration, fps), text: "", edited: true }) as unknown as Json);
      sortElements(track as unknown as Track);
      return { selection: [id], info: { trackId: String(track.id), elementId: id } };
    },
  };
}

/** The text of several captions at once (a retried translation filling its track): one step, and not a hand edit. */
export function fillCaptionTexts(doc: ProjectDocument, ctx: CommitContext, texts: Record<string, string>): Commit {
  return edit(doc, ctx, { commandType: "caption.translate", label: "Translate captions" }, (draft) => {
    for (const [elementId, text] of Object.entries(texts)) {
      const element = editable(elementIn(draft, elementId)), next = Array.from(text).slice(0, 500).join("");
      element.text = next; element.name = next.replace(/\n/g, " ").slice(0, 200) || "Caption";
    }
  });
}

/** Typing changes the text; the word timings are spread again over the same span by character count. */
export function setCaptionText(doc: ProjectDocument, ctx: CommitContext, elementId: string, text: string): Commit {
  return edit(doc, ctx, { commandType: "caption.edit", label: "Edit caption" }, (draft) => {
    const element = editable(elementIn(draft, elementId)), next = Array.from(text).slice(0, 500).join("");
    element.text = next; element.edited = true; element.name = next.replace(/\n/g, " ").slice(0, 200) || "Caption";
    if (Array.isArray(element.words)) { const words = distributeWords(next, Number(element.duration)).slice(0, 200); if (words.length) element.words = words; else delete element.words; }
  });
}

/**
 * Splits a caption at a caret (a UTF-16 index into its text). The boundary is the start of the first word after the
 * caret when word timings exist, otherwise proportional to the character count, and always on a frame inside the caption.
 */
export function splitCaption(doc: ProjectDocument, ctx: CommitContext, elementId: string, caret: number): Commit {
  return edit(doc, ctx, { commandType: "caption.split", label: "Split caption" }, (draft) => {
    const ref = elementIn(draft, elementId), element = editable(ref), text = String(element.text ?? ""), duration = Number(element.duration);
    const left = text.slice(0, caret).trimEnd(), right = text.slice(caret).trimStart();
    if (left === "" || right === "") reject("document/out-of-range", "", "The caret is not inside the caption text");
    const fps = fpsIn(draft), frame = frameTicks(fps), words = Array.isArray(element.words) ? (element.words as Word[]) : [];
    const leftCount = left.split(/\s+/).filter(Boolean).length;
    const timed = words.length === text.split(/\s+/).filter(Boolean).length && words[leftCount] ? words[leftCount].start : (Array.from(left).length / Math.max(1, Array.from(left).length + Array.from(right).length)) * duration;
    const at = Math.min(duration - frame, Math.max(frame, snapToFrame(Math.round(timed), fps)));
    if (duration < 2 * frame) reject("document/out-of-range", "", "The caption is too short to split");
    const second = { ...structuredClone(element), id: ctx.newId(), startTime: Number(element.startTime) + at, duration: duration - at, text: right, name: right.replace(/\n/g, " ").slice(0, 200), edited: true } as Json;
    if (words.length) {
      second.words = words.slice(leftCount).map((word) => ({ ...word, start: Math.max(0, word.start - at), end: Math.max(0, Math.min(duration, word.end) - at) }));
      element.words = words.slice(0, leftCount).map((word) => ({ ...word, end: Math.min(at, word.end) }));
      if ((second.words as Word[]).length === 0) delete second.words;
      if ((element.words as Word[]).length === 0) delete element.words;
    }
    delete second.animations;
    Object.assign(element, { duration: at, text: left, name: left.replace(/\n/g, " ").slice(0, 200), edited: true });
    (ref.track.elements as unknown[]).push(second);
    sortElements(ref.track);
  });
}

/** Merges a caption with the previous one of its track: one caption spans both ranges, the texts joined by a space. */
export function mergeCaptionWithPrevious(doc: ProjectDocument, ctx: CommitContext, elementId: string): Commit {
  return edit(doc, ctx, { commandType: "caption.merge", label: "Merge captions" }, (draft) => {
    const ref = elementIn(draft, elementId), element = editable(ref), list = captionsOf(ref.track).slice().sort((a, b) => Number(a.startTime) - Number(b.startTime));
    const previous = list[list.indexOf(element) - 1];
    if (!previous) return reject("document/out-of-range", "", "There is no caption before this one");
    const shift = Number(element.startTime) - Number(previous.startTime);
    const words = [...((previous.words as Word[] | undefined) ?? distributeWords(String(previous.text ?? ""), Number(previous.duration))), ...((element.words as Word[] | undefined) ?? distributeWords(String(element.text ?? ""), Number(element.duration))).map((word) => ({ ...word, start: word.start + shift, end: word.end + shift }))];
    previous.text = [String(previous.text ?? "").trim(), String(element.text ?? "").trim()].filter(Boolean).join(" ").slice(0, 500);
    previous.name = String(previous.text).slice(0, 200) || "Caption";
    previous.duration = Number(element.startTime) + Number(element.duration) - Number(previous.startTime);
    previous.edited = true;
    if (previous.words !== undefined || element.words !== undefined) previous.words = words.slice(0, 200);
    if (previous.translation !== undefined || element.translation !== undefined) previous.translation = [previous.translation, element.translation].filter(Boolean).join(" ").slice(0, 500);
    (ref.track as unknown as { elements: unknown[] }).elements = captionsOf(ref.track).filter((entry) => entry !== element);
  });
}

/** Start and end are clamped so that captions do not overlap and each lasts at least one frame. Ticks. */
export function setCaptionTiming(doc: ProjectDocument, ctx: CommitContext, elementId: string, change: { start?: number; end?: number }): Commit {
  return edit(doc, ctx, { commandType: "caption.timing", label: "Caption timing" }, (draft) => {
    const ref = elementIn(draft, elementId), element = editable(ref), fps = fpsIn(draft), frame = frameTicks(fps);
    const list = captionsOf(ref.track).slice().sort((a, b) => Number(a.startTime) - Number(b.startTime)), index = list.indexOf(element);
    const floor = index > 0 ? Number(list[index - 1].startTime) + Number(list[index - 1].duration) : 0, ceiling = index + 1 < list.length ? Number(list[index + 1].startTime) : Infinity;
    let start = Number(element.startTime), end = start + Number(element.duration);
    if (change.start !== undefined) start = Math.min(end - frame, Math.max(floor, snapToFrame(Math.max(0, change.start), fps)));
    if (change.end !== undefined) end = Math.max(start + frame, Math.min(ceiling, snapToFrame(change.end, fps)));
    const before = Number(element.duration);
    element.startTime = start; element.duration = end - start;
    if (Array.isArray(element.words) && before !== element.duration) element.words = distributeWords(String(element.text ?? ""), end - start).slice(0, 200);
    sortElements(ref.track);
  });
}

/**
 * Applies a bundled style: to the track (its style, layout, highlight and `styleId`; "Apply to all"), or — with
 * `elementIds` — to those captions only, as their own overrides. Text and timing stay.
 */
export function applyCaptionStyle(doc: ProjectDocument, ctx: CommitContext, trackId: string, styleId: string, elementIds?: string[]): Commit {
  const fields = captionStyleFields(styleById(styleId));
  return edit(doc, ctx, { commandType: "caption.style", label: "Caption style" }, (draft) => {
    const track = trackIn(draft, trackId).track as unknown as Json;
    if (elementIds) { for (const element of captionsOf(track as never)) if (elementIds.includes(String(element.id))) element.style = structuredClone(fields.style); return; }
    const caption = track.caption as Json;
    caption.styleId = styleId; caption.style = fields.style;
    caption.layout = { ...(isObject(caption.layout) ? caption.layout : {}), ...fields.layout };
    caption.highlight = { color: "#ffd400", textColor: "#000000", scale: 1.2, ...fields.highlight };
    // The track style is what every caption shows: overrides left by an earlier per-caption style are dropped.
    for (const element of captionsOf(track as never)) delete element.style;
  });
}
/** Changes fields of the track's `caption` object one level deep (`highlight`, `layout`, `bilingual`, `style`). */
export function setCaptionTrack(doc: ProjectDocument, ctx: CommitContext, trackId: string, change: { highlight?: Json; layout?: Json; bilingual?: Json; style?: Json; language?: string }, label = "Captions"): Commit {
  return edit(doc, ctx, { commandType: "caption.track", label }, (draft) => {
    const caption = (trackIn(draft, trackId).track as unknown as Json).caption as Json;
    for (const [key, value] of Object.entries(change)) caption[key] = isObject(value) ? { ...(isObject(caption[key]) ? (caption[key] as Json) : {}), ...value } : value;
    if (change.style) delete caption.styleId;
  });
}

/** The cues of a caption track for a file: element times in milliseconds, rounded to the nearest one. */
export function captionCues(track: { elements: unknown }): ExportCue[] {
  return captionsOf(track).map((element) => ({
    start_ms: Math.round(Number(element.startTime) / TICKS_PER_MS), end_ms: Math.round((Number(element.startTime) + Number(element.duration)) / TICKS_PER_MS), text: String(element.text ?? ""),
    ...(element.translation ? { translation: String(element.translation) } : {}),
    ...(Array.isArray(element.words) ? { words: (element.words as Word[]).map((word) => ({ text: word.text, start_ms: Math.round(word.start / TICKS_PER_MS), end_ms: Math.round(word.end / TICKS_PER_MS) })) } : {}),
  }));
}
