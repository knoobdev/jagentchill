import { AUDIO_KEYS, createElement, createTrack, ELEMENT_VARIANTS, tracksOf, type Background, type ProjectDocument, type Scene, type TimelineElement, type Track } from "@jagentchill/protocol";
import type { z } from "zod";
import { elementEnd, findAsset, isObject, sceneDuration, type Json } from "../model.ts";
import { roundHalfAway } from "../time.ts";
import { copyElement, dropBrokenTransitions, edit, editable, elementIn, followDuration, keepKeysOf, reject, sortElements, trackIn, type Commit, type CommitContext } from "./shared.ts";

type NewElement = Record<string, unknown> & { type: TimelineElement["type"]; name: string; startTime: number; duration: number; id?: string };

/** Inserts a new element with every defaulted field of its type written out; the track stays sorted. */
export function insertElement(doc: ProjectDocument, ctx: CommitContext, trackId: string, fields: NewElement, label = "Insert"): Commit {
  return edit(doc, ctx, { commandType: "element.insert", label }, (draft) => {
    const { track } = trackIn(draft, trackId);
    const { type, ...rest } = fields;
    const parsed = (ELEMENT_VARIANTS[type] as z.ZodTypeAny).safeParse({ ...rest, type, id: fields.id ?? ctx.newId() });
    // A malformed element is inserted as given so that the validator reports every finding with its path.
    (track.elements as unknown[]).push(parsed.success ? parsed.data : { ...rest, type, id: fields.id ?? ctx.newId() });
    sortElements(track);
  });
}

/** Moves an element in time. A transition whose two clips are no longer adjacent is removed in the same step. */
export function moveElement(doc: ProjectDocument, ctx: CommitContext, elementId: string, startTime: number): Commit {
  return edit(doc, ctx, { commandType: "element.move", label: "Move" }, (draft) => {
    const ref = elementIn(draft, elementId);
    // Moving within the track changes no content of the element, so an element of an unknown type moves too.
    (ref.element as { startTime: number }).startTime = startTime;
    sortElements(ref.track);
    dropBrokenTransitions(ref.track);
  });
}

/** Trims an element. Refused for an element whose type this build does not know. */
export function trimElement(doc: ProjectDocument, ctx: CommitContext, elementId: string, change: { startTime?: number; duration?: number; trimStart?: number; trimEnd?: number }): Commit {
  return edit(doc, ctx, { commandType: "element.trim", label: "Trim" }, (draft) => {
    const ref = elementIn(draft, elementId);
    const element = editable(ref);
    Object.assign(element, change);
    followDuration(element);
    sortElements(ref.track);
    dropBrokenTransitions(ref.track);
  });
}

const splitKeys = (keys: Json[], at: number, side: "left" | "right", newId: () => string, ids: Map<string, string>): Json[] =>
  side === "left" ? keys.filter((key) => (key.time as number) <= at)
    : keys.filter((key) => (key.time as number) >= at).map((key) => {
      if (!ids.has(String(key.id))) ids.set(String(key.id), newId());
      return { ...key, id: ids.get(String(key.id)), time: (key.time as number) - at };
    });

/** Splits an element at a scene time into two halves. The right half is a copy with new ids; unknown keys are on both. */
export function splitElement(doc: ProjectDocument, ctx: CommitContext, elementId: string, time: number): Commit {
  return edit(doc, ctx, { commandType: "element.split", label: "Split" }, (draft) => {
    const ref = elementIn(draft, elementId);
    const left = editable(ref);
    const offset = time - (left.startTime as number), duration = left.duration as number;
    if (offset <= 0 || offset >= duration) reject("document/out-of-range", `${ref.elementPath}/startTime`, "the split point lies inside the element");
    const { element: right, ids } = copyElement(ref.element, ctx.newId);
    const rate = isObject(left.retime) && typeof left.retime.rate === "number" ? left.retime.rate : 1;
    const hasSource = left.sourceDuration !== undefined;
    right.startTime = time;
    right.duration = duration - offset;
    left.duration = offset;
    if (hasSource) {
      // The source consumed by each half follows the constant rate; a speed curve is re-fitted by its owner.
      const consumed = roundHalfAway(offset * rate), rest = roundHalfAway((duration - offset) * rate);
      right.trimStart = (left.trimStart as number) + consumed;
      left.trimEnd = (left.trimEnd as number) + rest;
    }
    for (const half of [left, right]) {
      const side = half === left ? "left" : "right";
      if (!isObject(half.animations)) continue;
      const fresh = new Map<string, string>();
      for (const [path, channel] of Object.entries(half.animations) as [string, Json][]) {
        if ("r" in channel) for (const part of ["r", "g", "b", "a"]) (channel[part] as Json).keys = splitKeys((channel[part] as Json).keys as Json[], offset, side, ctx.newId, fresh);
        else channel.keys = splitKeys(channel.keys as Json[], offset, side, ctx.newId, fresh);
        const keys = ("r" in channel ? (channel.r as Json).keys : channel.keys) as Json[];
        if (keys.length === 0) delete half.animations[path];
      }
      if (Object.keys(half.animations).length === 0) delete half.animations;
    }
    // The outgoing transition now belongs to the right half; the cut between the halves has none.
    if ("transitionOut" in left) {
      const record = (ref.track.transitions as unknown as Json[]).find((entry) => entry.id === left.transitionOut);
      if (record) record.fromElementId = right.id;
      right.transitionOut = left.transitionOut;
      right.transitionIn = null;
      left.transitionOut = null;
    }
    // A link joins exactly two elements, so the copy starts unlinked; the group is kept.
    right.linkId = null;
    void ids;
    followDuration(left);
    followDuration(right);
    (ref.track.elements as unknown[]).push(right);
    sortElements(ref.track);
  });
}

/** Duplicates an element onto the same track at `startTime` (default: the end of the track). */
export function duplicateElement(doc: ProjectDocument, ctx: CommitContext, elementId: string, startTime?: number): Commit {
  return edit(doc, ctx, { commandType: "element.duplicate", label: "Duplicate" }, (draft) => {
    const ref = elementIn(draft, elementId);
    const { element } = copyElement(ref.element, ctx.newId);
    element.startTime = startTime ?? Math.max(...(ref.track.elements as TimelineElement[]).map(elementEnd));
    element.groupId = null;
    element.linkId = null;
    if ("transitionIn" in element) { element.transitionIn = null; element.transitionOut = null; }
    (ref.track.elements as unknown[]).push(element);
    sortElements(ref.track);
  });
}

/** Deletes elements; transitions, tracking bindings and template bindings that named them go in the same step. */
export function deleteElements(doc: ProjectDocument, ctx: CommitContext, elementIds: string[]): Commit {
  return edit(doc, ctx, { commandType: "element.delete", label: "Delete" }, (draft) => {
    const gone = new Set(elementIds);
    for (const scene of draft.scenes) {
      for (const track of tracksOf(scene)) {
        (track as { elements: unknown[] }).elements = (track.elements as TimelineElement[]).filter((element) => !gone.has(element.id));
        (track as unknown as Json).transitions = (track.transitions as unknown as Json[]).filter((record) => !gone.has(String(record.fromElementId)) && !gone.has(String(record.toElementId)));
        dropBrokenTransitions(track);
        for (const element of track.elements as unknown as Json[]) {
          if (isObject(element.tracking) && gone.has(String(element.tracking.targetElementId))) delete element.tracking;
        }
      }
      // A group or a link that lost its partner no longer exists.
      const elements = tracksOf(scene).flatMap((track) => track.elements as unknown as Json[]);
      for (const key of ["groupId", "linkId"]) {
        const counts = new Map<unknown, number>();
        for (const element of elements) if (typeof element[key] === "string") counts.set(element[key], (counts.get(element[key]) ?? 0) + 1);
        for (const element of elements) if (typeof element[key] === "string" && counts.get(element[key])! < 2) element[key] = null;
      }
    }
    const template = draft.template as unknown as Json | undefined;
    if (template) for (const key of ["colorBindings"]) template[key] = (template[key] as Json[]).filter((entry) => !gone.has(String(entry.elementId)));
  });
}

/** Writes typed fields of an element as they are given (the validator judges them). `undefined` removes a key. */
export function setElementFields(doc: ProjectDocument, ctx: CommitContext, elementId: string, fields: Record<string, unknown>, meta = { commandType: "element.update", label: "Edit" }, history = true): Commit {
  return edit(doc, ctx, { ...meta, history }, (draft) => {
    const element = editable(elementIn(draft, elementId));
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) delete element[key];
      else element[key] = value;
    }
  });
}
/** Writes one nested value by its stored dotted path (`transform.position.x`). */
export function setElementValue(doc: ProjectDocument, ctx: CommitContext, elementId: string, path: string, value: unknown, history = true): Commit {
  return edit(doc, ctx, { commandType: "element.update", label: "Edit", history }, (draft) => {
    let target = editable(elementIn(draft, elementId));
    const parts = path.split(".");
    for (const part of parts.slice(0, -1)) target = (isObject(target[part]) ? target[part] : (target[part] = {})) as Json;
    if (value === undefined) delete target[parts[parts.length - 1]];
    else target[parts[parts.length - 1]] = value;
  });
}

export const setTransform = (doc: ProjectDocument, ctx: CommitContext, elementId: string, transform: { position: { x: number; y: number }; scale: { x: number; y: number }; rotation: number }): Commit =>
  setElementFields(doc, ctx, elementId, { transform }, { commandType: "element.transform", label: "Transform" });

/** "Flip horizontal" / "Flip vertical": mirroring is a flag; the scale is not touched. */
export function toggleFlip(doc: ProjectDocument, ctx: CommitContext, elementId: string, axis: "horizontal" | "vertical"): Commit {
  return edit(doc, ctx, { commandType: "element.flip", label: "Flip" }, (draft) => {
    const element = editable(elementIn(draft, elementId));
    const flip = (element.flip ?? (element.flip = { horizontal: false, vertical: false })) as Json;
    flip[axis] = !flip[axis];
  });
}

/** Per-clip canvas background; `undefined` returns the clip to the project default. */
export const setElementBackground = (doc: ProjectDocument, ctx: CommitContext, elementId: string, background: Background | undefined): Commit =>
  setElementFields(doc, ctx, elementId, { background }, { commandType: "element.background", label: "Background" });

/** "Apply to all": the value becomes the project default and every main-track override of every scene is removed. */
export function applyBackgroundToAll(doc: ProjectDocument, ctx: CommitContext, background: Background): Commit {
  return edit(doc, ctx, { commandType: "project.background.apply-all", label: "Apply background to all" }, (draft) => {
    draft.settings.background = background as never;
    for (const scene of draft.scenes) for (const element of scene.tracks.main.elements as unknown as Json[]) delete element.background;
  });
}

const RETIME_DEFAULT = { rate: 1, maintainPitch: false, reverse: false, smooth: "none" };
/** Changes retime. A structure back at its default is removed, never stored as `null` or `{rate: 1}`. */
export function setRetime(doc: ProjectDocument, ctx: CommitContext, elementId: string, change: Record<string, unknown>): Commit {
  return edit(doc, ctx, { commandType: "element.retime", label: "Speed" }, (draft) => {
    const element = editable(elementIn(draft, elementId));
    const next: Json = { ...RETIME_DEFAULT, ...(isObject(element.retime) ? element.retime : {}), ...change };
    for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
    const isDefault = next.curve === undefined && Object.entries(RETIME_DEFAULT).every(([key, value]) => next[key] === value) && Object.keys(next).length === 4;
    if (isDefault) delete element.retime;
    else element.retime = next;
  });
}

/** Reduces a speed curve to at most `max` points, keeping the first, the last and the largest changes of rate. */
export function reduceSpeedCurve(points: { u: number; rate: number }[], max = 32): { u: number; rate: number }[] {
  const kept = [...points];
  while (kept.length > max) {
    let weakest = 1, smallest = Infinity;
    for (let index = 1; index < kept.length - 1; index++) {
      const span = kept[index + 1].u - kept[index - 1].u;
      const expected = kept[index - 1].rate + ((kept[index + 1].rate - kept[index - 1].rate) * (kept[index].u - kept[index - 1].u)) / span;
      const error = Math.abs(kept[index].rate - expected);
      if (error < smallest) { smallest = error; weakest = index; }
    }
    kept.splice(weakest, 1);
  }
  return kept;
}

/** "Freeze frame": a video (or compound) element that holds one source frame; no still image asset is created. */
export function freezeFrame(doc: ProjectDocument, ctx: CommitContext, elementId: string, sourceTime: number, at: { trackId: string; startTime: number; duration?: number }): Commit {
  return edit(doc, ctx, { commandType: "element.freeze", label: "Freeze frame" }, (draft) => {
    const source = elementIn(draft, elementId).element as unknown as Json;
    const { track } = trackIn(draft, at.trackId);
    const base = { id: ctx.newId(), name: `${String(source.name)} (freeze)`, startTime: at.startTime, duration: at.duration ?? 360_000 };
    const frozen = source.type === "compound"
      ? createElement("compound", { ...base, sceneId: source.sceneId, freeze: { sourceTime }, ...(source.multicam ? { multicam: source.multicam } : {}) })
      : createElement("video", { ...base, mediaId: source.mediaId, freeze: { mediaId: source.mediaId, sourceTime } });
    (track.elements as unknown[]).push(frozen);
    sortElements(track);
  });
}

/** A replacing tool switched the element's media; the original is remembered for "Revert to original". */
export const setProcessedSource = (doc: ProjectDocument, ctx: CommitContext, elementId: string, tool: string, mediaId: string, range?: { sourceStart: number; sourceEnd: number }): Commit =>
  edit(doc, ctx, { commandType: "element.processed-source", label: "Apply result" }, (draft) => {
    const element = editable(elementIn(draft, elementId));
    element.processedSource = { originalMediaId: (element.processedSource as Json | undefined)?.originalMediaId ?? element.mediaId, tool, ...range };
    element.mediaId = mediaId;
  });
export const revertProcessedSource = (doc: ProjectDocument, ctx: CommitContext, elementId: string): Commit =>
  edit(doc, ctx, { commandType: "element.revert-source", label: "Revert to original" }, (draft) => {
    const element = editable(elementIn(draft, elementId));
    const original = (element.processedSource as Json | undefined)?.originalMediaId;
    if (original === undefined) return;
    element.mediaId = original;
    delete element.processedSource;
  });

/**
 * Replaces the media of a video or image element. When the new asset is of the other kind the element changes type:
 * it keeps id, timing, transform, effects, masks, adjustments, animations and links; fields the new type does not
 * carry are removed and fields it requires are written at their defaults.
 */
export function replaceMedia(doc: ProjectDocument, ctx: CommitContext, elementId: string, assetId: string): Commit {
  return edit(doc, ctx, { commandType: "element.replace-media", label: "Replace" }, (draft) => {
    const ref = elementIn(draft, elementId);
    const element = editable(ref);
    const asset = findAsset(draft, assetId) ?? reject("document/unknown-asset", `${ref.elementPath}/mediaId`, `asset "${assetId}" does not exist`);
    element.mediaId = assetId;
    if (asset.type !== "audio" && asset.type !== element.type) {
      element.type = asset.type;
      keepKeysOf(element, asset.type);
    }
    if (asset.type === "video") { element.sourceDuration = asset.duration ?? element.duration; element.trimStart = 0; element.trimEnd = Math.max(0, (element.sourceDuration as number) - (element.duration as number)); }
    const index = (ref.track.elements as unknown[]).indexOf(ref.element);
    (ref.track.elements as unknown[])[index] = (ELEMENT_VARIANTS[element.type as "video"] as z.ZodTypeAny).parse(element);
  });
}

/** "Extract audio": an audio element that plays the video asset's sound, linked to the clip; the clip's own sound is switched off. */
export function extractAudio(doc: ProjectDocument, ctx: CommitContext, elementId: string, audioTrackId?: string): Commit {
  return edit(doc, ctx, { commandType: "element.extract-audio", label: "Extract audio" }, (draft) => {
    const ref = elementIn(draft, elementId);
    const video = editable(ref);
    let track: Track | undefined = audioTrackId ? trackIn(draft, audioTrackId).track : (ref.scene.tracks.audio as Track[]).find((candidate) => (candidate.elements as TimelineElement[]).every((other) => elementEnd(other) <= (video.startTime as number) || other.startTime >= elementEnd(video as never)));
    if (!track) { track = createTrack("audio", { id: ctx.newId(), name: "Audio" }); (ref.scene.tracks.audio as Track[]).push(track); }
    const linkId = ctx.newId();
    video.linkId = linkId;
    video.isSourceAudioEnabled = false;
    // The sound moves with its settings: volume, mute, pan, fades, the processing settings and the volume and pan
    // keyframes go to the audio element, and the video's own audio fields return to their defaults.
    const sound: Record<string, unknown> = {}, source = video as unknown as Record<string, unknown>;
    for (const key of AUDIO_KEYS) if (source[key] !== undefined) sound[key] = structuredClone(source[key]);
    const animations = (source.animations ?? {}) as Record<string, unknown>, moved: Record<string, unknown> = {};
    for (const path of ["volume", "pan"]) if (animations[path] !== undefined) { moved[path] = animations[path]; delete animations[path]; }
    Object.assign(source, { volume: 0, muted: false, pan: 0, fadeIn: { duration: 0, shape: "equal-power" }, fadeOut: { duration: 0, shape: "equal-power" }, isVoice: false, beats: [] });
    for (const key of AUDIO_KEYS) if (!["volume", "muted", "pan", "fadeIn", "fadeOut", "isVoice", "beats"].includes(key)) delete source[key];
    (track.elements as unknown[]).push(createElement("audio", {
      id: ctx.newId(), name: String(video.name), startTime: video.startTime as number, duration: video.duration as number, trimStart: video.trimStart, trimEnd: video.trimEnd,
      sourceDuration: video.sourceDuration, sourceType: "upload", mediaId: video.mediaId, linkId, ...(video.retime ? { retime: video.retime } : {}),
      ...sound, ...(Object.keys(moved).length > 0 ? { animations: moved } : {}),
    } as never));
    sortElements(track);
  });
}

/**
 * An asset recorded as a VIDEO whose file has no moving picture (a song with cover art, which a probe once took for a
 * video stream) is corrected to what it is: the asset becomes audio, and every clip that used it as a video — which no
 * engine can draw — becomes the audio clip the editor makes for a sound: same id, name, place in time, source span and
 * sound settings, on an audio track that is free there (a new one otherwise). A clip whose sound was already extracted
 * to a linked audio clip is simply removed. Overlay tracks left empty go. One step.
 */
export function correctSoundAsset(doc: ProjectDocument, ctx: CommitContext, assetId: string): Commit & { elementIds: string[] } {
  const elementIds: string[] = [];
  const commit = edit(doc, ctx, { commandType: "media.correct-kind", label: "Sound, not video" }, (draft) => {
    const asset = (findAsset(draft, assetId) ?? reject("document/unknown-asset", "/media/assets", `asset "${assetId}" does not exist`)) as unknown as Json;
    if (asset.type !== "video") reject("document/asset-type-mismatch", "/media/assets", `asset "${assetId}" is not recorded as a video`);
    asset.type = "audio"; asset.hasAudio = true;
    for (const key of ["width", "height", "videoCodec", "fps", "rotation", "hasAlpha"]) delete asset[key];
    for (const scene of draft.scenes) {
      const tracks = scene.tracks as unknown as { overlay: Track[]; main: Track; audio: Track[] };
      for (const track of [...tracks.overlay, tracks.main]) {
        const mine = (track.elements as unknown as Json[]).filter((element) => element.mediaId === assetId && (element.type === "video" || element.type === "image"));
        if (mine.length === 0) continue;
        (track as { elements: unknown[] }).elements = (track.elements as unknown as Json[]).filter((element) => !mine.includes(element));
        dropBrokenTransitions(track);
        for (const video of mine) {
          const end = (video.startTime as number) + (video.duration as number);
          // A link joins a picture and its sound: with the picture gone, what it was linked to stands alone.
          const linked = video.linkId === undefined ? [] : tracks.audio.flatMap((other) => (other.elements as unknown as Json[]).filter((element) => element.linkId === video.linkId));
          for (const partner of linked) delete partner.linkId;
          // Its sound already plays from the linked audio clip of the same file: nothing more to add.
          if (video.isSourceAudioEnabled === false && linked.some((partner) => partner.mediaId === assetId)) continue;
          let target = tracks.audio.find((candidate) => (candidate.elements as TimelineElement[]).every((other) => elementEnd(other) <= (video.startTime as number) || other.startTime >= end));
          if (!target) { target = createTrack("audio", { id: ctx.newId(), name: "Audio" }); tracks.audio.push(target); }
          const sound: Record<string, unknown> = {};
          for (const key of AUDIO_KEYS) if (video[key] !== undefined) sound[key] = structuredClone(video[key]);
          const animations = (video.animations ?? {}) as Record<string, unknown>, moved: Record<string, unknown> = {};
          for (const path of ["volume", "pan"]) if (animations[path] !== undefined) moved[path] = animations[path];
          (target.elements as unknown[]).push(createElement("audio", {
            id: video.id, name: String(video.name), startTime: video.startTime as number, duration: video.duration as number, trimStart: video.trimStart ?? 0, trimEnd: video.trimEnd ?? 0,
            sourceDuration: video.sourceDuration ?? asset.duration, sourceType: "upload", mediaId: assetId, ...(video.retime ? { retime: video.retime } : {}), ...(video.groupId ? { groupId: video.groupId } : {}),
            ...sound, ...(Object.keys(moved).length > 0 ? { animations: moved } : {}),
          } as never));
          sortElements(target);
          elementIds.push(String(video.id));
        }
      }
      tracks.overlay = tracks.overlay.filter((track) => track.elements.length > 0 || !doc.scenes.find((before) => before.id === scene.id)?.tracks.overlay.some((before) => before.id === track.id && before.elements.length > 0));
    }
  });
  return { ...commit, elementIds };
}

/** "Create compound clip": the elements move into a new scene of kind `compound`; one compound element takes their place. */
export function createCompound(doc: ProjectDocument, ctx: CommitContext, elementIds: string[], name = "Compound clip"): Commit {
  return edit(doc, ctx, { commandType: "element.compound.create", label: "Create compound clip" }, (draft) => {
    const refs = elementIds.map((id) => elementIn(draft, id));
    const parent = refs[0].scene;
    const start = Math.min(...refs.map((ref) => ref.element.startTime));
    const scene: Scene = {
      id: ctx.newId(), name, isMain: false, kind: "compound", compoundBackground: "none",
      tracks: { overlay: [], main: createTrack("video", { id: ctx.newId(), name: "Main" }), audio: [] }, markers: [], created_ms: ctx.now_ms, updated_ms: ctx.now_ms,
    } as unknown as Scene;
    const moved = new Set(elementIds);
    for (const track of tracksOf(parent)) {
      const taken = (track.elements as TimelineElement[]).filter((element) => moved.has(element.id));
      if (taken.length === 0) continue;
      (track as { elements: unknown[] }).elements = (track.elements as TimelineElement[]).filter((element) => !moved.has(element.id));
      (track as unknown as Json).transitions = (track.transitions as unknown as Json[]).filter((record) => !moved.has(String(record.fromElementId)) && !moved.has(String(record.toElementId)));
      dropBrokenTransitions(track);
      for (const element of taken as unknown as Json[]) { element.startTime = (element.startTime as number) - start; if ("transitionIn" in element) { element.transitionIn = null; element.transitionOut = null; } }
      const zone = track === parent.tracks.main ? "main" : track.type === "audio" ? "audio" : "overlay";
      if (zone === "main") (scene.tracks.main.elements as unknown[]).push(...taken);
      else (scene.tracks[zone] as Track[]).push(Object.assign(createTrack(track.type, { id: ctx.newId(), name: track.name, ...(track.type === "caption" ? { caption: track.caption } : {}) }), { elements: taken }) as Track);
    }
    draft.scenes.push(scene);
    const duration = sceneDuration(scene);
    const onMain = refs.some((ref) => ref.zone === "main");
    let host: Track | undefined = onMain ? parent.tracks.main : refs.find((ref) => ref.track.type === "video")?.track;
    if (!host) { host = createTrack("video", { id: ctx.newId(), name: "Video" }); (parent.tracks.overlay as Track[]).unshift(host); }
    (host.elements as unknown[]).push(createElement("compound", { id: ctx.newId(), name, startTime: start, duration, sourceDuration: duration, sceneId: scene.id }));
    sortElements(host);
  });
}

/**
 * Pastes copies of elements onto a track, the earliest at `startTime`. Every copy gets new ids, and every reference
 * inside the pasted set — `linkId`, `groupId`, `tracking.targetElementId` — is rewritten to the new ids; a reference
 * that points outside the set is dropped, because the copy has no partner there.
 */
export function pasteElements(doc: ProjectDocument, ctx: CommitContext, placements: { trackId: string; element: TimelineElement }[], startTime: number): Commit {
  return edit(doc, ctx, { commandType: "clipboard.paste", label: "Paste" }, (draft) => {
    const origin = Math.min(...placements.map((entry) => entry.element.startTime));
    const ids = new Map<string, string>(), shared = new Map<string, string>();
    const copies = placements.map((entry) => { const copy = copyElement(entry.element, ctx.newId); for (const [from, to] of copy.ids) ids.set(from, to); return { trackId: entry.trackId, element: copy.element }; });
    const members = (key: string) => { const counts = new Map<unknown, number>(); for (const { element } of copies) if (typeof element[key] === "string") counts.set(element[key], (counts.get(element[key]) ?? 0) + 1); return counts; };
    const groups = members("groupId"), links = members("linkId");
    for (const { trackId, element } of copies) {
      element.startTime = startTime + ((element.startTime as number) - origin);
      for (const [key, counts, needed] of [["groupId", groups, 2], ["linkId", links, 2]] as const) {
        const value = element[key];
        if (typeof value !== "string") continue;
        if ((counts.get(value) ?? 0) < needed) { element[key] = null; continue; }
        if (!shared.has(`${key}:${value}`)) shared.set(`${key}:${value}`, ctx.newId());
        element[key] = shared.get(`${key}:${value}`);
      }
      if (isObject(element.tracking)) {
        const target = ids.get(String(element.tracking.targetElementId));
        if (target) element.tracking.targetElementId = target; else delete element.tracking;
      }
      if ("transitionIn" in element) { element.transitionIn = null; element.transitionOut = null; }
      const { track } = trackIn(draft, trackId);
      (track.elements as unknown[]).push(element);
      sortElements(track);
    }
  });
}

/** The beats of an element that fall inside its visible source span: the ones that are shown and used. */
export function visibleBeats(element: { beats?: number[]; trimStart?: number; trimEnd?: number; sourceDuration?: number }): number[] {
  const from = element.trimStart ?? 0, to = element.sourceDuration !== undefined ? element.sourceDuration - (element.trimEnd ?? 0) : Infinity;
  return (element.beats ?? []).filter((beat) => beat >= from && beat <= to);
}
