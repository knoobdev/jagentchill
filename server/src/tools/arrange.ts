import { z } from "zod";
import { clipAnimationsOf, extractAudio, frameTicks, isClipAnimatable, recoverAudio, removeAllKeys, setClipAnimation, setElementFields, setMotionBlur, timeline } from "@jagentchill/editor-core";
import { BLEND_MODES } from "@jagentchill/protocol";
import { transformFields } from "./clips.ts";
import { WRITE, assetIn, checkField, checkRange, clip, elementIn, elementLabel, elementsIn, fail, id, ids, outOfRange, seconds, tickDelta, ticks, trackIn, unlocked, writeTool, type El, type ToolContext } from "./kit.ts";
import { background, checkBackground } from "./project.ts";

const end = (element: { startTime: number; duration: number }) => element.startTime + element.duration;
const first = (hits: timeline.Located[]) => ({ kind: "modify" as const, entity: "element" as const, entityId: hits[0].element.id, label: hits[0].element.name });
const many = (hits: timeline.Located[]) => (hits.length === 1 ? elementLabel(hits[0].element) : `${hits.length} elements`);
const hasKeys = (element: El, path: string): boolean => Object.keys((element.animations ?? {}) as object).some((key) => key === path || key.startsWith(`${path}.`));
const animationSlot = () => z.object({ type: id(), duration: ticks(), strength: z.number().optional() }).strict();

/** The scale that makes a picture fill the canvas in the chosen way. At scale 1 a picture is fitted inside the canvas. */
function fitScale(ctx: ToolContext, element: El, fit: "contain" | "cover" | "stretch" | "none"): { x: number; y: number } {
  const asset = typeof element.mediaId === "string" ? assetIn(ctx, element.mediaId) : undefined;
  if (!asset?.width || !asset.height) return fail("UNSUPPORTED_FOR_ELEMENT", `fit needs a video or image clip whose dimensions are known; ${elementLabel(element)} has none. Set scale instead.`, { elementId: element.id });
  const crop = (element.crop ?? {}) as { left?: number; right?: number; top?: number; bottom?: number };
  const quarter = asset.rotation === 90 || asset.rotation === 270, width = (quarter ? asset.height : asset.width) * (1 - (crop.left ?? 0) - (crop.right ?? 0)), height = (quarter ? asset.width : asset.height) * (1 - (crop.top ?? 0) - (crop.bottom ?? 0));
  const canvas = ctx.doc.settings.canvasSize, across = canvas.width / width, down = canvas.height / height, contain = Math.min(across, down);
  const round = (value: number) => Math.round(value * 1e4) / 1e4;
  if (fit === "contain") return { x: 1, y: 1 };
  if (fit === "cover") { const scale = round(Math.max(across, down) / contain); return { x: scale, y: scale }; }
  if (fit === "stretch") return { x: round(across / contain), y: round(down / contain) };
  return { x: round(1 / contain), y: round(1 / contain) };
}
/** The size an element has on the canvas at a scale, for alignment to an edge. */
function sizeOf(ctx: ToolContext, element: El, scale: { x: number; y: number }): { width: number; height: number } {
  const canvas = ctx.doc.settings.canvasSize;
  if (typeof element.mediaId === "string") {
    const asset = assetIn(ctx, element.mediaId);
    if (asset.width && asset.height) { const contain = Math.min(canvas.width / asset.width, canvas.height / asset.height); return { width: asset.width * contain * scale.x, height: asset.height * contain * scale.y }; }
  }
  if (typeof element.intrinsicWidth === "number") return { width: element.intrinsicWidth * scale.x, height: Number(element.intrinsicHeight) * scale.y };
  if (element.type === "graphic") return { width: 200 * scale.x, height: 200 * scale.y };
  return fail("UNSUPPORTED_FOR_ELEMENT", `${elementLabel(element)} has no known size, so it cannot be aligned to an edge. Set position instead, or align: "center".`, { elementId: element.id });
}

export const ARRANGE_TOOLS = [
  writeTool({
    name: "jc_clip_duplicate", family: "clip",
    description: "Duplicate elements with all their properties. offset is how much later the copies start (default: right after the originals); toTrackId puts them on another track of the same kind. Fails with OVERLAP_NOT_ALLOWED when a copy would overlap another element.",
    shape: { elementIds: ids(), offset: tickDelta().optional(), toTrackId: id().optional(), ...WRITE },
    handle(ctx, args) {
      const { scene, hits } = elementsIn(ctx, args.elementIds);
      const target = args.toTrackId ? trackIn(ctx, args.toTrackId) : undefined;
      if (target) { unlocked(target.track); for (const hit of hits) if (!timeline.canHold(target.track, hit.element.type)) fail("TRACK_KIND_MISMATCH", `The track "${target.track.name}" is a ${target.track.type} track and cannot hold a ${hit.element.type} element.`, { trackId: target.track.id, elementType: hit.element.type }); }
      const start = Math.min(...hits.map((hit) => hit.element.startTime)), offset = args.offset ?? Math.max(...hits.map((hit) => end(hit.element))) - start;
      if (start + offset < 0) outOfRange("offset", -start, 10_368_000_000, offset, "a copy cannot start before time 0");
      const made = ctx.run(timeline.duplicateElements({ sceneId: scene.id, elementIds: args.elementIds, offset, ...(args.toTrackId ? { toTrackId: args.toTrackId } : {}) }));
      return { data: { elementIds: made.elementIds, copies: made.copies, start: start + offset }, summary: `Duplicated ${many(hits)} at ${seconds(start + offset)}.`, change: { kind: "add", entity: "element", entityId: made.elementIds[0], label: hits[0].element.name } };
    },
  }),
  writeTool({
    name: "jc_clip_replace_media", family: "clip",
    description: "Replace the media of a video, image or audio element with another asset, keeping its position, effects and transform. With keepDuration: true the call fails when the new asset is too short to fill the element; without it the element is shortened to what the new media provides.",
    shape: { elementId: id(), assetId: id(), keepDuration: z.boolean().optional(), ...WRITE },
    handle(ctx, args) {
      const hit = elementIn(ctx, args.elementId), asset = assetIn(ctx, args.assetId), { element } = hit;
      unlocked(hit.track);
      if (!timeline.canReplaceWith(element, asset)) fail("UNSUPPORTED_FOR_ELEMENT", `A ${asset.type} asset cannot replace the media of ${elementLabel(element)}: video and image clips take video or images, audio clips take audio.`, { elementId: element.id, assetType: asset.type });
      if (asset.type !== "image" && asset.duration === undefined) fail("ASSET_NOT_READY", `The asset "${asset.name}" has no duration yet. Try again shortly.`, { assetId: asset.id });
      const rate = Number((element.retime as { rate?: number } | undefined)?.rate ?? 1), need = Math.round(element.duration * rate);
      if (args.keepDuration && asset.type !== "image" && asset.duration! < need) fail("SOURCE_EXHAUSTED", `The new asset is ${asset.duration} ticks long but the element needs ${need}. Trim the element first, or call without keepDuration to shorten it.`, { field: "assetId", maxDuration: Math.floor(asset.duration! / rate) });
      const made = ctx.run(timeline.replaceMedia({ elementId: element.id, assetId: asset.id }));
      const now = timeline.located(ctx.doc, element.id).element;
      return { data: { elementId: element.id, assetId: asset.id, start: now.startTime, duration: now.duration, trimAdjusted: made.trimAdjusted }, summary: `Replaced the media of ${elementLabel(element)} with "${clip(asset.name, 60)}".`, change: first([hit]) };
    },
  }),
  writeTool({
    name: "jc_clip_group", family: "clip",
    description: "Group two or more elements so they are selected and moved together (action \"group\" with elementIds), or dissolve a group (action \"ungroup\" with groupId or elementIds).",
    shape: { action: z.enum(["group", "ungroup"]), elementIds: ids().optional(), groupId: id().optional(), ...WRITE },
    refine(args) {
      if (args.action === "group" && (args.elementIds?.length ?? 0) < 2) fail("INVALID_PARAMS", "A group needs two or more elements in elementIds.", { field: "elementIds" });
      if (args.action === "ungroup" && !args.elementIds && !args.groupId) fail("INVALID_PARAMS", "ungroup needs groupId or elementIds.", { field: "groupId" });
    },
    handle(ctx, args) {
      let elementIds = args.elementIds;
      if (!elementIds) {
        const members = (ctx.doc.scenes as unknown as timeline.Sc[]).flatMap((scene) => timeline.elementsOfScene(scene)).filter((element) => element.groupId === args.groupId);
        if (members.length === 0) fail("NOT_FOUND", `No element belongs to the group "${args.groupId}".`, { groupId: args.groupId });
        elementIds = members.map((element) => element.id);
      }
      const { scene, hits } = elementsIn(ctx, elementIds);
      for (const hit of hits) unlocked(hit.track);
      if (args.action === "group") { const made = ctx.run(timeline.group({ sceneId: scene.id, elementIds })); return { data: { groupId: made.groupId, elementIds }, summary: `Grouped ${hits.length} elements.`, change: first(hits) }; }
      ctx.run(timeline.ungroup({ sceneId: scene.id, elementIds }));
      return { data: { elementIds }, summary: `Ungrouped ${hits.length} elements.`, change: first(hits) };
    },
  }),
  writeTool({
    name: "jc_clip_link", family: "clip",
    description: "Link one video (or text) element and one audio element of the same media that overlap in time so they edit together, or unlink linked elements.",
    shape: { action: z.enum(["link", "unlink"]), elementIds: ids(2), ...WRITE },
    handle(ctx, args) {
      const { scene, hits } = elementsIn(ctx, args.elementIds);
      for (const hit of hits) unlocked(hit.track);
      if (args.action === "link") {
        if (!timeline.linkAvailability(ctx.doc, scene.id, args.elementIds)) fail("UNSUPPORTED_FOR_ELEMENT", "Link needs exactly two unlinked elements that overlap in time: one audio element and one video element of the same media (or one text element).", { elementIds: args.elementIds });
        ctx.run(timeline.link({ sceneId: scene.id, elementIds: args.elementIds }));
        return { data: { elementIds: args.elementIds, linkId: timeline.located(ctx.doc, args.elementIds[0]).element.linkId }, summary: `Linked ${hits.length} elements.`, change: first(hits) };
      }
      ctx.run(timeline.unlink({ sceneId: scene.id, elementIds: args.elementIds }));
      return { data: { elementIds: args.elementIds }, summary: `Unlinked ${many(hits)}.`, change: first(hits) };
    },
  }),
  writeTool({
    name: "jc_clip_compound", family: "clip",
    description: "Combine elements into one compound clip that references a new scene (action \"create\" with elementIds), or dissolve a compound clip back into its elements (action \"dissolve\" with elementId). Compound clips nest at most 8 levels.",
    shape: { action: z.enum(["create", "dissolve"]), elementIds: ids().optional(), elementId: id().optional(), name: z.string().trim().min(1).max(80).optional(), ...WRITE },
    refine(args) {
      if (args.action === "create" && !args.elementIds) fail("INVALID_PARAMS", "create needs elementIds.", { field: "elementIds" });
      if (args.action === "dissolve" && !args.elementId) fail("INVALID_PARAMS", "dissolve needs elementId.", { field: "elementId" });
    },
    handle(ctx, args) {
      if (args.action === "create") {
        const { scene, hits } = elementsIn(ctx, args.elementIds!);
        for (const hit of hits) unlocked(hit.track);
        const made = ctx.run(timeline.createCompound({ sceneId: scene.id, elementIds: args.elementIds!, ...(args.name ? { name: args.name } : {}) }));
        return { data: { elementId: made.elementId, sceneId: made.sceneId }, summary: `Combined ${hits.length} elements into a compound clip.`, change: { kind: "add", entity: "element", entityId: made.elementId, label: args.name ?? "Compound clip" } };
      }
      const hit = elementIn(ctx, args.elementId!);
      unlocked(hit.track);
      if (hit.element.type !== "compound" || hit.element.multicam) fail("UNSUPPORTED_FOR_ELEMENT", `${elementLabel(hit.element)} is not a compound clip.`, { elementId: hit.element.id });
      const made = ctx.run(timeline.dissolveCompound({ sceneId: hit.scene.id, elementId: hit.element.id }));
      return { data: { elementIds: made.elementIds }, summary: `Dissolved the compound clip "${clip(hit.element.name, 60)}" into ${made.elementIds.length} elements.`, change: { kind: "remove", entity: "element", entityId: hit.element.id, label: hit.element.name } };
    },
  }),
  writeTool({
    name: "jc_clip_detach_audio", family: "clip",
    description: "Detach the sound of a video clip into a linked audio element on an audio track and mute the video's own sound (action \"detach\", the default), or recover it: put the sound back on the video with the audio element's level and fades and remove that element (action \"recover\").",
    shape: { elementId: id(), action: z.enum(["detach", "recover"]).optional(), ...WRITE },
    handle(ctx, args) {
      const hit = elementIn(ctx, args.elementId), { element } = hit;
      unlocked(hit.track);
      if (element.type !== "video" || element.freeze) fail("UNSUPPORTED_FOR_ELEMENT", `${elementLabel(element)} is not a video clip with sound.`, { elementId: element.id });
      if ((args.action ?? "detach") === "detach") {
        if (typeof element.mediaId === "string" && assetIn(ctx, element.mediaId).hasAudio === false) fail("UNSUPPORTED_FOR_ELEMENT", `${elementLabel(element)} has no audio stream to detach.`, { elementId: element.id });
        if (element.isSourceAudioEnabled === false) fail("UNSUPPORTED_FOR_ELEMENT", `The sound of ${elementLabel(element)} is already detached. Use action "recover" to put it back.`, { elementId: element.id });
        ctx.apply((doc, c) => extractAudio(doc, c, element.id));
        const now = timeline.located(ctx.doc, element.id), audio = timeline.elementsOfScene(now.scene).find((other) => other.type === "audio" && other.linkId === now.element.linkId);
        return { data: { elementId: element.id, audioElementId: audio?.id, audioTrackId: audio ? timeline.located(ctx.doc, audio.id).track.id : undefined, linkId: now.element.linkId }, summary: `Detached the audio of ${elementLabel(element)} to an audio track.`, change: first([hit]) };
      }
      if (element.isSourceAudioEnabled !== false) fail("UNSUPPORTED_FOR_ELEMENT", `The sound of ${elementLabel(element)} is not detached.`, { elementId: element.id });
      ctx.apply((doc, c) => recoverAudio(doc, c, element.id));
      const now = timeline.located(ctx.doc, element.id).element;
      return { data: { elementId: element.id, volume: now.volume, isSourceAudioEnabled: now.isSourceAudioEnabled }, summary: `Recovered the audio into ${elementLabel(element)}.`, change: first([hit]) };
    },
  }),
  writeTool({
    name: "jc_clip_set_enabled", family: "clip",
    description: "Show or hide visual elements (enabled: false hides them; they stay on the timeline and are not rendered). Audio elements cannot be hidden: mute them with jc_audio_edit.",
    shape: { elementIds: ids(), enabled: z.boolean(), ...WRITE },
    handle(ctx, args) {
      const { scene, hits } = elementsIn(ctx, args.elementIds);
      for (const hit of hits) { unlocked(hit.track); if (!timeline.isHideable(hit.element)) fail("UNSUPPORTED_FOR_ELEMENT", `${elementLabel(hit.element)} cannot be hidden. Mute an audio element with jc_audio_edit {mute: true}.`, { elementId: hit.element.id }); }
      ctx.run(timeline.setElementsHidden({ sceneId: scene.id, elementIds: args.elementIds, hidden: !args.enabled }));
      return { data: { elementIds: args.elementIds, enabled: args.enabled }, summary: `${args.enabled ? "Showed" : "Hid"} ${many(hits)}.`, change: first(hits) };
    },
  }),
  writeTool({
    name: "jc_clip_rename", family: "clip",
    description: "Rename one element (1–200 characters). Nothing else about it changes.",
    shape: { elementId: id(), name: z.string().trim().min(1).max(200), ...WRITE },
    handle(ctx, args) {
      const hit = elementIn(ctx, args.elementId);
      unlocked(hit.track);
      ctx.apply((doc, c) => setElementFields(doc, c, hit.element.id, { name: args.name }, { commandType: "timeline.element.rename", label: "Rename" }));
      return { data: { elementId: hit.element.id, name: args.name }, summary: `Renamed ${elementLabel(hit.element)} to "${clip(args.name, 80)}".`, change: first([hit]) };
    },
  }),
  writeTool({
    name: "jc_clip_reorder", family: "clip",
    description: "Change the stacking order of elements on overlay tracks: bring_forward, send_backward, to_front or to_back. The top-most overlay track is in front. Returns the warning no_change when the elements already are where the action puts them.",
    shape: { elementIds: ids(), action: z.enum(["bring_forward", "send_backward", "to_front", "to_back"]), ...WRITE },
    handle(ctx, args) {
      const { scene, hits } = elementsIn(ctx, args.elementIds);
      for (const hit of hits) { unlocked(hit.track); if (hit.zone !== "overlay") fail("UNSUPPORTED_FOR_ELEMENT", `${elementLabel(hit.element)} is on the ${hit.zone} track; only elements on overlay tracks have a stacking order. Move it to an overlay track with jc_clip_move first.`, { elementId: hit.element.id, zone: hit.zone }); }
      const made = ctx.run(timeline.restackElements({ sceneId: scene.id, elementIds: args.elementIds, action: args.action }));
      return { data: { movedElementIds: made.moved, createdTrackIds: made.createdTrackIds, elements: args.elementIds.map((elementId) => ({ elementId, trackId: timeline.located(ctx.doc, elementId).track.id })) }, summary: made.moved.length > 0 ? `Moved ${many(hits)} ${args.action.replace("_", " ")}.` : `${many(hits)} already ${args.action === "to_front" || args.action === "bring_forward" ? "at the front" : "at the back"}.`, change: { ...first(hits), kind: "move" } };
    },
  }),
  writeTool({
    name: "jc_clip_freeze", family: "clip",
    description: "Insert a freeze frame into a video or compound clip at a timeline time strictly inside it: the clip is split there and a still of that frame (default 3 s) goes between the parts; everything after it on the track moves later by the freeze duration.",
    shape: { elementId: id(), at: ticks(), duration: ticks().optional(), ripple: z.boolean().optional(), ...WRITE },
    refine(args) { if (args.ripple === false) fail("INVALID_PARAMS", "A freeze frame always moves the following elements on its track; ripple can only be true or absent.", { field: "ripple" }); },
    handle(ctx, args) {
      const hit = elementIn(ctx, args.elementId), { element } = hit, frame = frameTicks(ctx.doc.settings.fps);
      unlocked(hit.track);
      if ((element.type !== "video" && element.type !== "compound") || timeline.isFreeze(element)) fail("UNSUPPORTED_FOR_ELEMENT", `${elementLabel(element)} cannot hold a freeze frame: it works on a video or compound clip.`, { elementId: element.id });
      if (args.at <= element.startTime || args.at >= end(element)) outOfRange("at", element.startTime + frame, end(element) - frame, args.at, "strictly inside the clip");
      if (args.duration !== undefined && args.duration < frame) outOfRange("duration", frame, 2_592_000_000, args.duration, "at least one frame");
      const made = ctx.run(timeline.insertFreezeFrame({ sceneId: hit.scene.id, elementId: element.id, time: args.at, ...(args.duration !== undefined ? { duration: args.duration } : {}) }));
      const parts = [element.id, made.elementId, made.rightId].map((elementId) => { const now = timeline.located(ctx.doc, elementId).element; return { elementId, type: now.type, start: now.startTime, duration: now.duration }; });
      return { data: { freezeElementId: made.elementId, parts, sceneDuration: timeline.sceneDurationOf(ctx.scene(hit.scene.id)) }, summary: `Inserted a ${seconds(parts[1].duration)} freeze frame into ${elementLabel(element)}.`, change: { kind: "add", entity: "element", entityId: made.elementId, label: `${element.name} (freeze)` } };
    },
  }),

  writeTool({
    name: "jc_clip_transform", family: "clip",
    description: "Set static visual properties of visual elements: position (canvas pixels from the centre), scale (1 is 100 %), rotation (degrees), opacity (0–1), crop fractions, flip, blendMode, a clip's own canvas background (null removes it) and motion blur. fit (contain, cover, stretch, none) and align compute scale and position. A property that has keyframes is refused unless replaceKeyframes is true; animate with jc_keyframe_set.",
    shape: {
      elementIds: ids(), position: z.object({ x: z.number(), y: z.number() }).strict().optional(), scale: z.union([z.number(), z.object({ x: z.number(), y: z.number() }).strict()]).optional(), rotation: z.number().optional(), opacity: z.number().optional(),
      crop: z.object({ left: z.number().optional(), top: z.number().optional(), right: z.number().optional(), bottom: z.number().optional() }).strict().optional(), flip: z.object({ horizontal: z.boolean().optional(), vertical: z.boolean().optional() }).strict().optional(),
      fit: z.enum(["contain", "cover", "stretch", "none"]).optional(), blendMode: z.enum(BLEND_MODES).optional(), align: z.enum(["center", "left", "right", "top", "bottom"]).optional(), background: background().nullable().optional(),
      motionBlur: z.object({ enabled: z.boolean(), strength: z.number().optional(), samples: z.number().optional() }).strict().optional(), replaceKeyframes: z.boolean().optional(), ...WRITE,
    },
    refine(args) {
      if (args.fit && args.scale !== undefined) fail("INVALID_PARAMS", "Give either fit or scale, not both.", { field: "fit" });
      if (args.align && args.position) fail("INVALID_PARAMS", "Give either align or position, not both.", { field: "align" });
      if (args.crop) {
        for (const side of ["left", "top", "right", "bottom"] as const) checkRange(`crop.${side}`, args.crop[side], 0, 0.99);
      }
      if (args.motionBlur?.samples !== undefined && ![4, 8, 16].includes(args.motionBlur.samples)) fail("INVALID_PARAMS", "motionBlur.samples must be 4, 8 or 16.", { field: "motionBlur.samples", allowed: [4, 8, 16] });
      checkRange("motionBlur.strength", args.motionBlur?.strength, 0, 100);
    },
    handle(ctx, args) {
      const { hits } = elementsIn(ctx, args.elementIds), changed = new Set<string>();
      for (const hit of hits) {
        const { element } = hit;
        unlocked(hit.track);
        if (element.type === "audio") fail("UNSUPPORTED_FOR_ELEMENT", `${elementLabel(element)} is an audio element and has no visual properties. Use jc_audio_edit.`, { elementId: element.id });
        const fields: Record<string, unknown> = {};
        const now = (element.transform ?? { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0 }) as { position: { x: number; y: number }; scale: { x: number; y: number }; rotation: number };
        if (args.crop) {
          checkField(element, "crop.left", args.crop.left ?? 0, "crop");
          const crop = { ...(element.crop as object), ...args.crop } as { left: number; top: number; right: number; bottom: number };
          if (crop.left + crop.right > 0.99) outOfRange("crop.right", 0, Math.round((0.99 - crop.left) * 100) / 100, crop.right, "left + right is at most 0.99");
          if (crop.top + crop.bottom > 0.99) outOfRange("crop.bottom", 0, Math.round((0.99 - crop.top) * 100) / 100, crop.bottom, "top + bottom is at most 0.99");
          fields.crop = crop;
        }
        const cropped = fields.crop ? ({ ...element, crop: fields.crop } as El) : element;
        const scale = args.fit ? fitScale(ctx, cropped, args.fit) : args.scale;
        let position = args.fit ? { x: 0, y: 0 } : args.position;
        if (args.align) {
          const target = scale === undefined ? now.scale : typeof scale === "number" ? { x: scale, y: scale } : scale, canvas = ctx.doc.settings.canvasSize;
          position = { ...(position ?? now.position) };
          if (args.align === "center") position = { x: 0, y: 0 };
          else {
            const size = sizeOf(ctx, cropped, target);
            if (args.align === "left") position.x = Math.round((size.width - canvas.width) / 2); if (args.align === "right") position.x = Math.round((canvas.width - size.width) / 2);
            if (args.align === "top") position.y = Math.round((size.height - canvas.height) / 2); if (args.align === "bottom") position.y = Math.round((canvas.height - size.height) / 2);
          }
        }
        Object.assign(fields, transformFields(element, { ...(position ? { position } : {}), ...(scale !== undefined ? { scale } : {}), ...(args.rotation !== undefined ? { rotation: args.rotation } : {}), ...(args.opacity !== undefined ? { opacity: args.opacity } : {}) }));
        if (args.flip) { checkField(element, "flip.horizontal", args.flip.horizontal ?? false, "flip"); fields.flip = { ...(element.flip as object), ...args.flip }; }
        if (args.blendMode) { checkField(element, "blendMode", args.blendMode); fields.blendMode = args.blendMode; }
        if (args.background !== undefined) {
          if (!["video", "image", "compound"].includes(element.type)) fail("UNSUPPORTED_FOR_ELEMENT", `${elementLabel(element)} has no canvas background of its own: only video, image and compound clips do.${element.type === "text" ? " A text's background is set with jc_text_update {style: {background}}." : ""}`, { elementId: element.id, field: "background" });
          if (args.background) checkBackground(ctx, args.background);
          fields.background = args.background === null ? undefined : args.background.kind === "image" ? { fit: "cover", ...args.background } : args.background;
        }
        // A property with keyframes is not overwritten behind the animation's back.
        const keyed = [["position", "transform.position"], ["scale", "transform.scale"], ["rotation", "transform.rotation"], ["opacity", "opacity"], ["crop", "crop"]].filter(([name, path]) => ((name === "position" && position) || (name === "scale" && scale !== undefined) || (name === "rotation" && args.rotation !== undefined) || (name === "opacity" && args.opacity !== undefined) || (name === "crop" && args.crop)) && hasKeys(element, path));
        if (keyed.length > 0 && !args.replaceKeyframes) fail("UNSUPPORTED_FOR_ELEMENT", `${keyed.map(([name]) => name).join(", ")} of ${elementLabel(element)} is animated with keyframes. Change the animation with jc_keyframe_set, or pass replaceKeyframes: true to remove the keyframes and set a fixed value.`, { elementId: element.id, properties: keyed.map(([, path]) => path) });
        for (const [, path] of keyed) for (const channel of Object.keys((element.animations ?? {}) as object).filter((key) => key === path || key.startsWith(`${path}.`))) ctx.apply((doc, c) => removeAllKeys(doc, c, element.id, channel, 0));
        if (Object.keys(fields).length > 0) { ctx.apply((doc, c) => setElementFields(doc, c, element.id, fields, { commandType: "element.transform", label: "Transform" })); for (const key of Object.keys(fields)) changed.add(key); }
        if (args.motionBlur) { checkField(element, "motionBlur.enabled", args.motionBlur.enabled, "motionBlur"); ctx.apply((doc, c) => setMotionBlur(doc, c, [element.id], args.motionBlur as never)); changed.add("motionBlur"); }
      }
      if (changed.size === 0) fail("INVALID_PARAMS", "Name at least one property to set.");
      return { data: { elementIds: args.elementIds, changed: [...changed], elements: args.elementIds.map((elementId) => { const now = timeline.located(ctx.doc, elementId).element; return { elementId, transform: now.transform, opacity: now.opacity, crop: now.crop }; }) }, summary: `Set ${[...changed].join(", ")} of ${many(hits)}.`, change: first(hits) };
    },
  }),
  writeTool({
    name: "jc_clip_animation", family: "clip",
    description: "Set the entrance (in), exit (out) or combination (combo) animation of visual elements from the clip animation library (find ids with jc_library_search {kind: \"clip_animation\"}), or clear them. In plus out cannot be longer than the element; a combo replaces both. A fade-in on the first clip makes the video open on black. Text elements use jc_text_update.",
    shape: { elementIds: ids(), in: animationSlot().optional(), out: animationSlot().optional(), combo: z.object({ type: id(), duration: ticks().optional(), strength: z.number().optional() }).strict().optional(), clear: z.array(z.enum(["in", "out", "combo"])).min(1).max(3).optional(), ...WRITE },
    refine(args) {
      if (!args.in && !args.out && !args.combo && !args.clear) fail("INVALID_PARAMS", "Name an animation to set (in, out, combo) or to clear.");
      if (args.combo && (args.in || args.out)) fail("INVALID_PARAMS", "A combo animation replaces in and out: give combo alone.", { field: "combo" });
      for (const group of ["in", "out", "combo"] as const) checkRange(`${group}.strength`, args[group]?.strength, 0, 100);
    },
    handle(ctx, args) {
      const { hits } = elementsIn(ctx, args.elementIds), frame = frameTicks(ctx.doc.settings.fps);
      for (const hit of hits) {
        const { element } = hit;
        unlocked(hit.track);
        if (element.type === "text" || element.type === "caption") fail("UNSUPPORTED_FOR_ELEMENT", `${elementLabel(element)} is a ${element.type} element: clip animations do not apply to it. Use jc_text_update {animation}.`, { elementId: element.id });
        if (!isClipAnimatable(element)) fail("UNSUPPORTED_FOR_ELEMENT", `${elementLabel(element)} cannot carry a clip animation.`, { elementId: element.id });
        for (const group of ["in", "out", "combo"] as const) {
          const slot = args[group];
          if (!slot) continue;
          if (!clipAnimationsOf(group).some((row) => row.id === slot.type)) fail("LIBRARY_ITEM_NOT_FOUND", `"${slot.type}" is not a${group === "in" ? "n in" : group === "out" ? "n out" : " combo"} animation. Find ids with jc_library_search {kind: "clip_animation", category: "${group}"}.`, { field: `${group}.type`, suggestions: clipAnimationsOf(group).slice(0, 3).map((row) => row.id) });
          const least = Math.min(element.duration, Math.max(frame, 12_000)), most = group === "combo" ? element.duration : Math.min(600_000, element.duration);
          if (slot.duration !== undefined && (slot.duration < least || slot.duration > most)) outOfRange(`${group}.duration`, least, most, slot.duration, group === "combo" ? "between 0.1 s and the element's duration" : "between 0.1 s and the smaller of 5 s and the element's duration");
        }
        const existing = (element.clipAnimation ?? {}) as { in?: { duration: number }; out?: { duration: number } };
        const lengthIn = args.in?.duration ?? (args.clear?.includes("in") || args.combo ? 0 : existing.in?.duration ?? 0), lengthOut = args.out?.duration ?? (args.clear?.includes("out") || args.combo ? 0 : existing.out?.duration ?? 0);
        if (lengthIn + lengthOut > element.duration) outOfRange(args.out ? "out.duration" : "in.duration", frame, Math.max(0, element.duration - (args.out ? lengthIn : lengthOut)), args.out ? lengthOut : lengthIn, "in plus out is at most the element's duration");
      }
      for (const group of args.clear ?? []) ctx.apply((doc, c) => setClipAnimation(doc, c, args.elementIds, group, null));
      for (const group of ["combo", "in", "out"] as const) { const slot = args[group]; if (slot) ctx.apply((doc, c) => setClipAnimation(doc, c, args.elementIds, group, { type: slot.type, ...(slot.duration !== undefined ? { duration: slot.duration } : {}), strength: slot.strength ?? 100 } as never)); }
      // An entrance that fades from nothing on what the video starts with leaves the picture black at 00:00 — where the
      // playhead of a project rests. The person is told, in the proposal's own words, instead of meeting a black player.
      const opening = args.in && /fade/.test(args.in.type) ? hits.find((hit) => hit.element.startTime === 0 && hit.track.id === hit.scene.tracks.main.id) : undefined;
      const dark = opening ? ` The video now opens on black: the picture fades in over ${seconds(args.in!.duration ?? ((opening.element.clipAnimation as { in?: { duration?: number } } | undefined)?.in?.duration ?? 60_000))} from 00:00.` : "";
      return { data: { elementIds: args.elementIds, clipAnimation: timeline.located(ctx.doc, args.elementIds[0]).element.clipAnimation ?? null, ...(opening ? { opensOnBlack: true } : {}) }, summary: `Set the clip animation of ${many(hits)}.${dark}`, change: first(hits) };
    },
  }),
];
