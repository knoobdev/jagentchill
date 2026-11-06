import { z } from "zod";
import { frameTicks, setTrackDucking, snapToFrame, timeline } from "@jagentchill/editor-core";
import { TRACK_ELEMENT_TYPES, type TrackType } from "@jagentchill/protocol";
import { SCENE, ToolFailure, WRITE, assetIn, failureOf, checkField, checkRange, clip, elementIn, elementLabel, elementsIn, fail, id, ids, outOfRange, range, seconds, tickDelta, ticks, trackIn, unlocked, writeTool, type El, type Sc, type ToolContext, type Tr } from "./kit.ts";

const end = (element: { startTime: number; duration: number }) => element.startTime + element.duration;
const TRACK_TYPES = ["video", "text", "audio", "graphic", "effect", "adjustment", "caption"] as const;
const transformShape = () => z.object({
  position: z.object({ x: z.number(), y: z.number() }).strict().optional(), scale: z.union([z.number(), z.object({ x: z.number(), y: z.number() }).strict()]).optional(), rotation: z.number().optional(), opacity: z.number().optional(),
}).strict();
/** The stored fields a `transform` convenience writes, checked against the element type's ranges. */
export function transformFields(element: { type: string; id: string; name?: string; transform?: unknown }, value: z.infer<ReturnType<typeof transformShape>>): Record<string, unknown> {
  const now = (element.transform ?? { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: 0 }) as { position: { x: number; y: number }; scale: { x: number; y: number }; rotation: number };
  const next = { position: { ...now.position }, scale: { ...now.scale }, rotation: now.rotation }, fields: Record<string, unknown> = {};
  if (value.position) { checkField(element, "transform.position.x", value.position.x, "position.x"); checkField(element, "transform.position.y", value.position.y, "position.y"); next.position = value.position; }
  if (value.scale !== undefined) { const scale = typeof value.scale === "number" ? { x: value.scale, y: value.scale } : value.scale; checkField(element, "transform.scale.x", scale.x, "scale"); checkField(element, "transform.scale.y", scale.y, "scale"); next.scale = scale; }
  if (value.rotation !== undefined) { checkField(element, "transform.rotation", value.rotation, "rotation"); next.rotation = Math.round(value.rotation * 10) / 10; }
  if (value.position || value.scale !== undefined || value.rotation !== undefined) fields.transform = next;
  if (value.opacity !== undefined) { checkField(element, "opacity", value.opacity, "opacity"); fields.opacity = value.opacity; }
  return fields;
}
const sceneOfTrack = (ctx: ToolContext, trackId: string) => trackIn(ctx, trackId);
const playheadOf = (ctx: ToolContext): number => Number(ctx.host.editorContext(ctx.session, ctx.projectId)?.playhead ?? 0);
function conflicts(track: Tr, start: number, finish: number, ignore: ReadonlySet<string> = new Set()): { conflictingElementIds: string[]; nearestFreeStart: number } {
  const hit = track.elements.filter((element) => !ignore.has(element.id) && element.startTime < finish && end(element) > start);
  // The first start at or after the requested one where the same length fits.
  let free = start;
  for (const element of [...track.elements].filter((entry) => !ignore.has(entry.id)).sort((a, b) => a.startTime - b.startTime)) if (element.startTime < free + (finish - start) && end(element) > free) free = end(element);
  return { conflictingElementIds: hit.map((element) => element.id), nearestFreeStart: free };
}
function noOverlap(track: Tr, start: number, finish: number, ignore?: ReadonlySet<string>): void {
  const found = conflicts(track, start, finish, ignore);
  if (found.conflictingElementIds.length > 0) fail("OVERLAP_NOT_ALLOWED", `The range is occupied on the track "${track.name}". The nearest free start for this length is ${found.nearestFreeStart} ticks; use it, choose another track, or pass mode "overwrite" or "insert".`, { trackId: track.id, ...found });
}

const clipItem = {
  assetId: id(), trackId: id().optional(), newTrack: z.object({ zone: z.enum(["overlay", "audio"]), type: z.enum(TRACK_TYPES) }).strict().optional(), start: ticks().optional(),
  placement: z.enum(["append_main", "at_playhead", "after_element", "before_element"]).optional(), anchorElementId: id().optional(), sourceIn: ticks().optional(), sourceOut: ticks().optional(), duration: ticks().optional(),
  mode: z.enum(["overwrite", "insert", "fail_on_overlap"]).optional(), transform: transformShape().optional(), volume: z.number().optional(), name: z.string().trim().min(1).max(200).optional(),
  anchor: z.object({ elementId: id(), edge: z.enum(["start", "end"]), offsetSeconds: z.number().finite().min(-86_400).max(86_400) }).strict().optional(),
};
type ClipItem = z.infer<z.ZodObject<typeof clipItem, "strict">>;

function addOne(ctx: ToolContext, scene: Sc, item: ClipItem): { elementId: string; trackId: string; createdTrack: boolean; start: number; duration: number } {
  const asset = assetIn(ctx, item.assetId), fps = ctx.doc.settings.fps, frame = frameTicks(fps);
  if (ctx.mediaAvailability(asset.id) === "unavailable") fail("ASSET_NOT_READY", `The media file "${asset.name}" has no usable bytes. Retry its import before adding a clip.`, { assetId: asset.id });
  if (item.start !== undefined && item.placement !== undefined) fail("INVALID_PARAMS", "Give either start or placement, not both.", { field: "placement" });
  if (item.trackId !== undefined && item.newTrack !== undefined) fail("INVALID_PARAMS", "Give either trackId or newTrack, not both.", { field: "newTrack" });
  if ((item.placement === "after_element" || item.placement === "before_element") && !item.anchorElementId) fail("INVALID_PARAMS", `placement "${item.placement}" needs anchorElementId.`, { field: "anchorElementId" });
  const elementType = asset.type, trackType: TrackType = elementType === "audio" ? "audio" : "video";
  if (elementType !== "image") {
    const source = asset.duration ?? fail("ASSET_NOT_READY", `The asset "${asset.name}" has no duration yet: its probe has not finished on the device that imported it. Try again shortly.`, { assetId: asset.id });
    const from = item.sourceIn ?? 0, to = item.sourceOut ?? (item.duration !== undefined ? from + item.duration : source);
    if (from > source - frame) outOfRange("sourceIn", 0, Math.max(0, source - frame), from, "inside the asset's duration");
    if (to > source || to < from + frame) fail("SOURCE_EXHAUSTED", `The source range must lie inside the asset (0–${source} ticks) and be at least one frame long; sourceOut ${to} is not. Use a value up to ${source}.`, { field: item.sourceOut !== undefined ? "sourceOut" : "duration", maxTo: source, maxDuration: source - from });
  } else if (item.sourceIn !== undefined || item.sourceOut !== undefined) fail("UNSUPPORTED_FOR_ELEMENT", "An image has no source range; set its length with duration.", { assetId: asset.id });
  if (item.duration !== undefined && item.duration < frame) outOfRange("duration", frame, 2_592_000_000, item.duration, "at least one frame");
  if (item.volume !== undefined) { if (elementType === "image") fail("UNSUPPORTED_FOR_ELEMENT", "An image has no volume.", { assetId: asset.id }); checkRange("volume", item.volume, -60, 20, "decibels"); }
  const fields: Record<string, unknown> = { ...(item.volume !== undefined ? { volume: item.volume } : {}) };
  if (item.transform) Object.assign(fields, transformFields({ type: elementType, id: asset.id, name: asset.name }, item.transform));

  // Where it goes.
  let time: number, request: timeline.PlacementRequest, target: Tr | undefined, mode = item.mode;
  const anchor = item.anchorElementId ? timeline.locate(ctx.doc, item.anchorElementId) ?? fail("ELEMENT_NOT_FOUND", `No element has the id "${item.anchorElementId}".`, { elementId: item.anchorElementId }) : undefined;
  if (anchor && anchor.scene.id !== scene.id) fail("INVALID_PARAMS", "The anchor element belongs to another scene.", { field: "anchorElementId" });
  if (item.trackId) target = (timeline.trackById(scene, item.trackId) as Tr | undefined) ?? fail("TRACK_NOT_FOUND", `No track of this scene has the id "${item.trackId}".`, { trackId: item.trackId });
  const placement = item.placement ?? (item.start !== undefined || target || item.newTrack ? undefined : elementType === "audio" ? "at_playhead" : "append_main");
  if (placement === "after_element" || placement === "before_element") { target ??= anchor!.track; time = placement === "after_element" ? end(anchor!.element) : anchor!.element.startTime; if (placement === "before_element") mode ??= target === scene.tracks.main ? "insert" : undefined; }
  else if (placement === "append_main") { target = scene.tracks.main; time = timeline.sceneDurationOf({ ...scene, tracks: { overlay: [], main: scene.tracks.main, audio: [] } } as Sc); }
  else if (placement === "at_playhead") time = playheadOf(ctx);
  else time = item.start ?? (target ? target.elements.reduce((latest, element) => Math.max(latest, end(element)), 0) : 0);
  time = snapToFrame(time, fps);
  if (item.newTrack) {
    if ((item.newTrack.zone === "audio") !== (item.newTrack.type === "audio")) fail("TRACK_KIND_MISMATCH", `A ${item.newTrack.type} track cannot be in the ${item.newTrack.zone} zone: the audio zone holds audio tracks and the overlay zone every other type.`, { zone: item.newTrack.zone, type: item.newTrack.type });
    if (item.newTrack.type !== trackType) fail("TRACK_KIND_MISMATCH", `A ${elementType} asset goes on a ${trackType} track, not on a ${item.newTrack.type} track.`, { assetId: asset.id, trackType: item.newTrack.type });
    request = { strategy: "alwaysNew" };
  } else if (target) {
    if (!(TRACK_ELEMENT_TYPES[target.type] as readonly string[]).includes(elementType)) fail("TRACK_KIND_MISMATCH", `The track "${target.name}" is a ${target.type} track and cannot hold a ${elementType} clip. ${elementType === "audio" ? "Audio goes on an audio track." : "Video and images go on a video track."}`, { trackId: target.id, trackType: target.type, assetType: elementType });
    unlocked(target);
    const main = target === scene.tracks.main;
    mode ??= main ? "insert" : "fail_on_overlap";
    const length = elementType === "image" ? item.duration ?? timeline.FACTORY_INSERT_DEFAULTS.imageDuration : (item.sourceOut ?? (item.duration !== undefined ? (item.sourceIn ?? 0) + item.duration : asset.duration!)) - (item.sourceIn ?? 0);
    if (mode === "insert") {
      if (main) request = { strategy: "mainInsert" };
      else {
        // Insert on another track: everything from the insert point moves right by the new length.
        ctx.run(timeline.makeRoom({ sceneId: scene.id, trackId: target.id, time, duration: length }));
        request = { strategy: "explicit", trackId: target.id };
      }
    } else if (mode === "overwrite") {
      ctx.run(timeline.deleteRanges({ sceneId: scene.id, ranges: [{ start: time, end: time + length }], trackIds: [target.id], ripple: false }));
      request = { strategy: "explicit", trackId: target.id };
    } else {
      noOverlap(target, time, time + snapToFrame(length, fps));
      request = { strategy: "explicit", trackId: target.id };
    }
  } else request = elementType === "audio" ? (placement === "at_playhead" && item.start === undefined ? { strategy: "alwaysNew" } : { strategy: "firstAvailable" }) : { strategy: "mainFirst" };
  // Overwrite and fail_on_overlap place at the exact time, so the main track takes them without its magnet rule.
  const exact = target === scene.tracks.main && (mode === "overwrite" || mode === "fail_on_overlap");
  const before = ctx.edit;
  if (exact) ctx.edit = { ...ctx.edit, magnet: false };
  try {
    const made = ctx.run(timeline.addClips({ sceneId: scene.id, clips: [{ assetId: asset.id, ...(item.name ? { name: item.name } : {}), ...(item.sourceIn !== undefined ? { sourceIn: item.sourceIn } : {}), ...(item.sourceOut !== undefined ? { sourceOut: item.sourceOut } : {}), ...(item.duration !== undefined ? { duration: item.duration } : {}), fields }], time, request }));
    if (item.anchor) ctx.run(timeline.setTimingAnchor({ sceneId: scene.id, elementId: made.elementIds[0], anchor: item.anchor }));
    const placed = timeline.located(ctx.doc, made.elementIds[0]);
    return { elementId: made.elementIds[0], trackId: placed.track.id, createdTrack: made.createdTrack, start: placed.element.startTime, duration: placed.element.duration };
  } finally { ctx.edit = before; }
}

export const CLIP_TOOLS = [
  writeTool({
    name: "jc_track_edit", family: "track",
    description: "Change track structure and state: add (needs zone and type), remove (a track with elements needs removeElements: true), rename, reorder by index inside its zone, lock/unlock, mute/unmute, solo/unsolo, hide/show, pin/unpin, set_volume (−60 to +12 dB), set_pan (−100 to +100) and set_ducking on an audio track. The main track cannot be added, removed or reordered.",
    shape: {
      action: z.enum(["add", "remove", "rename", "reorder", "lock", "unlock", "mute", "unmute", "solo", "unsolo", "hide", "show", "pin", "unpin", "set_volume", "set_pan", "set_ducking"]), trackId: id().optional(), ...SCENE,
      zone: z.enum(["overlay", "audio"]).optional(), type: z.enum(TRACK_TYPES).optional(), name: z.string().trim().min(1).max(80).optional(), index: z.number().int().min(0).max(98).optional(), volume: z.number().optional(), pan: z.number().optional(),
      ducking: z.object({ enabled: z.boolean(), amount: z.number().optional(), attack: z.number().optional(), release: z.number().optional(), mode: z.enum(["full", "voice-band"]).optional() }).strict().optional(), removeElements: z.boolean().optional(), ...WRITE,
    },
    refine(args) {
      const need = (field: "trackId" | "zone" | "type" | "name" | "index" | "volume" | "pan" | "ducking") => { if (args[field] === undefined) fail("INVALID_PARAMS", `action "${args.action}" needs ${field}.`, { field }); };
      if (args.action === "add") { need("zone"); need("type"); } else need("trackId");
      if (args.action === "rename") need("name");
      if (args.action === "reorder") need("index");
      if (args.action === "set_volume") { need("volume"); checkRange("volume", args.volume, -60, 12, "decibels"); }
      if (args.action === "set_pan") { need("pan"); checkRange("pan", args.pan, -100, 100); if (!Number.isInteger(args.pan)) fail("INVALID_PARAMS", "pan is a whole number from −100 to +100.", { field: "pan" }); }
      if (args.action === "set_ducking") { need("ducking"); checkRange("ducking.amount", args.ducking!.amount, 0, 30, "decibels"); checkRange("ducking.attack", args.ducking!.attack, 10, 1000, "milliseconds"); checkRange("ducking.release", args.ducking!.release, 50, 3000, "milliseconds"); }
    },
    handle(ctx, args) {
      if (args.action === "add") {
        const scene = ctx.scene(args.sceneId);
        if ((args.zone === "audio") !== (args.type === "audio")) fail("TRACK_KIND_MISMATCH", `A ${args.type} track cannot be in the ${args.zone} zone: the audio zone holds audio tracks and the overlay zone every other type.`, { zone: args.zone, type: args.type });
        const zone = args.zone === "audio" ? scene.tracks.audio : scene.tracks.overlay;
        if (zone.length >= timeline.TRACK_LIMIT) outOfRange(`${args.zone}Tracks`, 0, timeline.TRACK_LIMIT, zone.length + 1, `a scene holds at most 99 ${args.zone} tracks`);
        const made = ctx.run(timeline.addTrack({ sceneId: scene.id, type: args.type!, ...(args.index !== undefined ? { index: args.index } : {}), ...(args.name ? { name: args.name } : {}) }));
        const placed = sceneOfTrack(ctx, made.trackId);
        return { data: { trackId: made.trackId, zone: args.zone, type: args.type, index: (args.zone === "audio" ? placed.scene.tracks.audio : placed.scene.tracks.overlay).indexOf(placed.track) }, summary: `Added a ${args.type} track to the ${args.zone} zone.`, change: { kind: "add", entity: "track", entityId: made.trackId, label: placed.track.name } };
      }
      const { scene, track, zone } = sceneOfTrack(ctx, args.trackId!), label = track.name;
      const done = (summary: string, kind: "modify" | "remove" | "move" = "modify", data: Record<string, unknown> = {}) => ({ data: { trackId: track.id, ...data }, summary, change: { kind, entity: "track" as const, entityId: track.id, label } });
      const state = (field: "locked" | "muted" | "solo" | "hidden" | "pinned" | "volume" | "pan", value: boolean | number, summary: string) => {
        if (!timeline.trackSupports(track, field)) fail("TRACK_KIND_MISMATCH", `A ${track.type} track has no "${field}": ${field === "hidden" ? "audio tracks cannot be hidden; mute them instead" : "only video and audio tracks carry sound settings"}.`, { trackId: track.id, trackType: track.type, field });
        ctx.run(timeline.setTrackState({ trackId: track.id, state: { [field]: value } }));
        return done(summary, "modify", { [field]: value });
      };
      switch (args.action) {
        case "remove": {
          if (zone === "main") fail("INVALID_PARAMS", "The main track cannot be removed.", { field: "trackId" });
          if (track.elements.length > 0 && args.removeElements !== true) fail("INVALID_PARAMS", `The track "${track.name}" holds ${track.elements.length} elements. Pass removeElements: true to remove it with them, or move the elements first.`, { field: "removeElements", elementCount: track.elements.length });
          unlocked(track);
          ctx.run(timeline.deleteTrack({ trackId: track.id }));
          return done(`Removed the track "${clip(label, 60)}"${track.elements.length ? ` with its ${track.elements.length} elements` : ""}.`, "remove", { removedElements: track.elements.length });
        }
        case "rename": ctx.run(timeline.renameTrack({ trackId: track.id, name: args.name! })); return done(`Renamed the track to "${clip(args.name!, 60)}".`, "modify", { name: args.name });
        case "reorder": {
          if (zone === "main") fail("INVALID_PARAMS", "The main track cannot be reordered.", { field: "trackId" });
          const list = scene.tracks[zone as "overlay" | "audio"];
          if (args.index! > list.length - 1) outOfRange("index", 0, list.length - 1, args.index, `the ${zone} zone has ${list.length} tracks`);
          ctx.run(timeline.reorderTrack({ trackId: track.id, toIndex: args.index! }));
          return done(`Moved the track "${clip(label, 60)}" to position ${args.index! + 1} of the ${zone} zone.`, "move", { index: args.index });
        }
        case "lock": case "unlock": return state("locked", args.action === "lock", `${args.action === "lock" ? "Locked" : "Unlocked"} the track "${clip(label, 60)}".`);
        case "mute": case "unmute": return state("muted", args.action === "mute", `${args.action === "mute" ? "Muted" : "Unmuted"} the track "${clip(label, 60)}".`);
        case "solo": case "unsolo": return state("solo", args.action === "solo", `${args.action === "solo" ? "Soloed" : "Unsoloed"} the track "${clip(label, 60)}".`);
        case "hide": case "show": return state("hidden", args.action === "hide", `${args.action === "hide" ? "Hid" : "Showed"} the track "${clip(label, 60)}".`);
        case "pin": case "unpin": return state("pinned", args.action === "pin", `${args.action === "pin" ? "Pinned" : "Unpinned"} the track "${clip(label, 60)}".`);
        case "set_volume": return state("volume", args.volume!, `Set the volume of the track "${clip(label, 60)}" to ${args.volume} dB.`);
        case "set_pan": return state("pan", args.pan!, `Set the pan of the track "${clip(label, 60)}" to ${args.pan}.`);
        case "set_ducking": {
          if (track.type !== "audio") fail("TRACK_KIND_MISMATCH", `Ducking is a setting of an audio track; "${track.name}" is a ${track.type} track.`, { trackId: track.id, trackType: track.type });
          ctx.apply((doc, c) => setTrackDucking(doc, c, track.id, args.ducking!));
          return done(`${args.ducking!.enabled ? "Turned on" : "Turned off"} ducking on the track "${clip(label, 60)}".`, "modify", { ducking: trackIn(ctx, track.id).track.ducking });
        }
        default: return fail("INVALID_PARAMS", `Unknown action "${args.action}".`);
      }
    },
  }),

  writeTool({
    name: "jc_clip_add", family: "clip",
    description: "Add a video, image or audio asset to the timeline. Video and images go to the end of the main track by default, audio to a new audio track at the playhead. Choose a place with trackId or newTrack and start, or with placement and anchorElementId. sourceIn and sourceOut pick the part of the source; images default to 5 s. mode decides what happens to content already there: insert (default on the main track), overwrite or fail_on_overlap. Up to 50 clips with items[].",
    shape: { ...clipItem, assetId: id().optional(), items: z.array(z.object(clipItem).strict()).min(1).max(50).optional(), ...SCENE, ...WRITE },
    refine(args) {
      if ((args.assetId === undefined) === (args.items === undefined)) fail("INVALID_PARAMS", "Give either assetId (one clip) or items[] (several), not both and not neither.", { field: "assetId" });
    },
    handle(ctx, args) {
      const scene = ctx.scene(args.sceneId), { items, sceneId: _scene, idempotencyKey: _key, dryRun: _dry, editContext: _edit, ...single } = args as { items?: ClipItem[] } & Record<string, unknown>;
      const list = items ?? [single as unknown as ClipItem], added: ReturnType<typeof addOne>[] = [];
      list.forEach((item, index) => {
        try { added.push(addOne(ctx, ctx.scene(scene.id), item)); } catch (error) {
          // A multi-item call is atomic: the failing item is named and nothing of the call is staged.
          const failure = failureOf(error);
          throw items ? new ToolFailure(failure.code, `items[${index}]: ${failure.message}`, { ...failure.details, index }) : failure;
        }
      });
      const first = timeline.located(ctx.doc, added[0].elementId).element;
      return {
        data: { elementIds: added.map((entry) => entry.elementId), elements: added, sceneDuration: timeline.sceneDurationOf(ctx.scene(scene.id)) },
        summary: added.length === 1 ? `Added ${elementLabel(first)} at ${seconds(added[0].start)} (${seconds(added[0].duration)} long).` : `Added ${added.length} clips starting at ${seconds(added[0].start)}.`,
        change: { kind: "add", entity: "element", entityId: added[0].elementId, label: first.name },
      };
    },
  }),

  writeTool({
    name: "jc_clip_move", family: "clip",
    description: "Move elements in time (start for the first id, or delta for all) and optionally to another track (toTrackId). Several elements keep their distances. Linked audio and video move together unless breakLink. mode: fail_on_overlap (default), overwrite, or insert. anchor sets or clears the first element's relative start using {elementId, edge, offsetSeconds}. snap: true snaps within 5 frames.",
    shape: { elementIds: ids(), toTrackId: id().optional(), start: ticks().optional(), delta: tickDelta().optional(), mode: z.enum(["overwrite", "insert", "fail_on_overlap"]).optional(), ripple: z.boolean().optional(), snap: z.boolean().optional(), breakLink: z.boolean().optional(), anchor: z.object({ elementId: id(), edge: z.enum(["start", "end"]), offsetSeconds: z.number().finite().min(-86_400).max(86_400) }).strict().nullable().optional(), ...WRITE },
    refine(args) {
      if (args.start !== undefined && args.delta !== undefined) fail("INVALID_PARAMS", "Give either start or delta, not both.", { field: "delta" });
      if (args.start === undefined && args.delta === undefined && args.toTrackId === undefined && args.anchor === undefined) fail("INVALID_PARAMS", "Name where to move: start, delta, toTrackId or anchor.", { field: "start" });
    },
    handle(ctx, args) {
      const { scene, hits } = elementsIn(ctx, args.elementIds), fps = ctx.doc.settings.fps, frame = frameTicks(fps);
      for (const hit of hits) unlocked(hit.track);
      const anchor = hits[0], earliest = Math.min(...hits.map((hit) => hit.element.startTime));
      let delta = args.delta ?? (args.start !== undefined ? args.start - anchor.element.startTime : 0);
      if (earliest + delta < 0) outOfRange(args.delta !== undefined ? "delta" : "start", args.delta !== undefined ? -earliest : anchor.element.startTime - earliest, 10_368_000_000, args.delta ?? args.start, "an element cannot start before time 0");
      const moving = new Set(args.elementIds);
      if (args.snap) {
        const playhead = playheadOf(ctx), want = earliest + delta, targets = [playhead, ...(scene.markers as { time: number }[]).map((marker) => marker.time), ...timeline.elementsOfScene(scene).filter((element) => !moving.has(element.id)).flatMap((element) => [element.startTime, end(element)])];
        const nearest = targets.reduce<number | null>((best, time) => (Math.abs(time - want) <= 5 * frame && (best === null || Math.abs(time - want) < Math.abs(best - want)) ? time : best), null);
        if (nearest !== null) delta += nearest - want;
      }
      delta = Math.sign(delta) * snapToFrame(Math.abs(delta), fps);
      const target = args.toTrackId ? (timeline.trackById(scene, args.toTrackId) as Tr | undefined) ?? fail("TRACK_NOT_FOUND", `No track of this scene has the id "${args.toTrackId}".`, { trackId: args.toTrackId }) : undefined;
      if (target) {
        unlocked(target);
        if (!timeline.canHold(target, anchor.element.type)) fail("TRACK_KIND_MISMATCH", `The track "${target.name}" is a ${target.type} track and cannot hold a ${anchor.element.type} element. Elements move between tracks of the same kind.`, { trackId: target.id, trackType: target.type, elementType: anchor.element.type });
      }
      if (args.breakLink) { const linked = hits.filter((hit) => hit.element.linkId).map((hit) => hit.element.id); if (linked.length) ctx.run(timeline.unlink({ sceneId: scene.id, elementIds: linked })); }
      // Where each member lands, to judge the overlap before the command (which would otherwise open new tracks, as a drag does).
      const order = timeline.tracksOfScene(scene), rows = target ? order.findIndex((track) => track.id === target.id) - order.indexOf(anchor.track) : 0, mode = args.mode ?? "fail_on_overlap";
      const landings = hits.map((hit) => ({ hit, track: order[order.indexOf(hit.track) + rows] ?? hit.track, start: hit.element.startTime + delta }));
      const onMain = landings.some((landing) => landing.track === scene.tracks.main);
      if (mode === "insert" && !landings.every((landing) => landing.track === scene.tracks.main)) fail("INVALID_PARAMS", "mode \"insert\" moves clips to a cut of the main track; on other tracks use overwrite or a free range.", { field: "mode" });
      const before = ctx.edit;
      if (mode !== "insert" && onMain) ctx.edit = { ...ctx.edit, magnet: false };
      try {
        for (const landing of landings) {
          if (mode === "overwrite") ctx.run(timeline.deleteRanges({ sceneId: scene.id, ranges: [{ start: landing.start, end: landing.start + landing.hit.element.duration }], trackIds: [landing.track.id], keepIds: [...moving] }));
          else if (mode === "fail_on_overlap") noOverlap(landing.track, landing.start, landing.start + landing.hit.element.duration, moving);
        }
        const moved = ctx.run(timeline.move({ sceneId: scene.id, elementIds: args.elementIds, anchorId: anchor.element.id, time: anchor.element.startTime + delta, ...(target ? { target: { kind: "track", trackId: target.id } } : {}), ...(mode === "insert" ? { pointerTime: anchor.element.startTime + delta } : {}) }));
        if (args.anchor !== undefined) ctx.run(timeline.setTimingAnchor({ sceneId: scene.id, elementId: anchor.element.id, anchor: args.anchor }));
        const after = args.elementIds.map((elementId) => { const now = timeline.located(ctx.doc, elementId); return { elementId, trackId: now.track.id, start: now.element.startTime, duration: now.element.duration }; });
        return {
          data: { elements: after, delta: moved.delta, createdTrackIds: moved.createdTrackIds },
          summary: `Moved ${hits.length === 1 ? elementLabel(anchor.element) : `${hits.length} elements`} ${target ? `to the track "${clip(target.name, 40)}"` : ""}${delta !== 0 ? ` by ${delta > 0 ? "+" : "−"}${seconds(Math.abs(delta))}` : ""}.`.replace("  ", " "),
          change: { kind: "move", entity: "element", entityId: anchor.element.id, label: anchor.element.name },
        };
      } finally { ctx.edit = before; }
    },
  }),

  writeTool({
    name: "jc_clip_trim", family: "clip",
    description: "Change one edge of an element: edge \"start\" or \"end\", to an absolute timeline time (to) or by a signed amount (delta). A video or audio clip cannot extend past its source media. ripple: true moves the following elements with the edge instead of leaving a gap or stopping at the neighbour.",
    shape: { elementId: id(), edge: z.enum(["start", "end"]), to: ticks().optional(), delta: tickDelta().optional(), ripple: z.boolean().optional(), ...WRITE },
    refine(args) { if ((args.to === undefined) === (args.delta === undefined)) fail("INVALID_PARAMS", "Give either to or delta, exactly one.", { field: "to" }); },
    handle(ctx, args) {
      const hit = elementIn(ctx, args.elementId), { scene, track, element } = hit, fps = ctx.doc.settings.fps, frame = frameTicks(fps);
      unlocked(track);
      const edgeNow = args.edge === "start" ? element.startTime : end(element);
      const wanted = args.to !== undefined ? args.to - edgeNow : args.delta!, delta = Math.sign(wanted) * snapToFrame(Math.abs(wanted), fps);
      // The limits of the source alone, then the limits with the neighbours of this call's edit context.
      const source = timeline.trimBounds(scene, hit, args.edge, { edit: { ...ctx.edit, ripple: true } }, fps), own = timeline.trimBounds(scene, hit, args.edge, { edit: ctx.edit }, fps);
      const shortest = args.edge === "end" ? frame - element.duration : element.duration - frame;
      if (args.edge === "end" ? delta < shortest : delta > shortest) outOfRange(args.to !== undefined ? "to" : "delta", args.edge === "end" ? (args.to !== undefined ? element.startTime + frame : frame - element.duration) : Math.max(0, args.to !== undefined ? edgeNow + source.min : source.min), args.edge === "end" ? (args.to !== undefined ? edgeNow + source.max : source.max) : args.to !== undefined ? end(element) - frame : element.duration - frame, args.to ?? args.delta, "an element is at least one frame long");
      if (delta < source.min || delta > source.max) {
        const limit = args.edge === "end" ? source.max : source.min;
        fail("SOURCE_EXHAUSTED", `${elementLabel(element)} has no more source media on that side: its ${args.edge} can go at most to ${edgeNow + limit} ticks (delta ${limit}).`, { field: args.to !== undefined ? "to" : "delta", maxTo: edgeNow + limit, maxDelta: limit });
      }
      if (delta < own.min || delta > own.max) {
        const limit = args.edge === "end" ? own.max : own.min, neighbour = track.elements.filter((other) => other.id !== element.id).find((other) => (args.edge === "end" ? other.startTime === end(element) + own.max : end(other) === element.startTime + own.min));
        fail("OVERLAP_NOT_ALLOWED", `The ${args.edge} of ${elementLabel(element)} can go at most to ${edgeNow + limit} ticks before it meets the next element. Pass ripple: true to move the following elements, or trim less.`, { conflictingElementIds: neighbour ? [neighbour.id] : [], maxTo: edgeNow + limit, maxDelta: limit });
      }
      const result = ctx.run(timeline.trim({ sceneId: scene.id, elementId: element.id, side: args.edge, delta }));
      const now = timeline.located(ctx.doc, element.id).element;
      return {
        data: { elementId: element.id, start: now.startTime, duration: now.duration, delta: result.delta, sceneDuration: timeline.sceneDurationOf(ctx.scene(scene.id)) },
        summary: `Trimmed the ${args.edge} of ${elementLabel(element)} by ${delta > 0 ? "+" : "−"}${seconds(Math.abs(delta))}; it is now ${seconds(now.duration)} long.`,
        change: { kind: "modify", entity: "element", entityId: element.id, label: element.name },
      };
    },
  }),
  writeTool({
    name: "jc_clip_set_range", family: "clip",
    description: "Set both source bounds of a video or audio element at once (sourceIn and sourceOut in the asset's own time), keeping its timeline start. The element's length follows the new range.",
    shape: { elementId: id(), sourceIn: ticks(), sourceOut: ticks(), ripple: z.boolean().optional(), ...WRITE },
    handle(ctx, args) {
      const { scene, track, element } = elementIn(ctx, args.elementId);
      unlocked(track);
      if (!timeline.hasSourceBounds(element)) fail("UNSUPPORTED_FOR_ELEMENT", `${elementLabel(element)} has no source range: only video and audio clips do.`, { elementId: element.id, elementType: element.type });
      const source = element.sourceDuration as number, frame = frameTicks(ctx.doc.settings.fps);
      if (args.sourceOut > source) fail("SOURCE_EXHAUSTED", `sourceOut ${args.sourceOut} is past the end of the source media (${source} ticks). Use a value up to ${source}.`, { field: "sourceOut", maxTo: source });
      if (args.sourceOut < args.sourceIn + frame) outOfRange("sourceOut", args.sourceIn + frame, source, args.sourceOut, "sourceOut is at least one frame after sourceIn");
      const made = ctx.run(timeline.setSourceRange({ sceneId: scene.id, elementId: element.id, sourceIn: args.sourceIn, sourceOut: args.sourceOut }));
      return { data: { elementId: element.id, start: element.startTime, duration: made.duration, sourceIn: args.sourceIn, sourceOut: args.sourceOut }, summary: `Set the source range of ${elementLabel(element)}; it is now ${seconds(made.duration)} long.`, change: { kind: "modify", entity: "element", entityId: element.id, label: element.name } };
    },
  }),

  writeTool({
    name: "jc_clip_split", family: "clip",
    description: "Split elements at timeline times (1–100). Name the elements with elementIds, or pass allAtTime: true to split everything under each time on unlocked tracks. keep: both (default), left or right — the other part is deleted without closing the gap. A time that is not strictly inside an element is skipped with the warning time_outside_element. Returns the ids of all parts in time order.",
    shape: { elementIds: ids().optional(), allAtTime: z.boolean().optional(), times: z.array(ticks()).min(1).max(100), keep: z.enum(["both", "left", "right"]).optional(), ...SCENE, ...WRITE },
    refine(args) { if ((args.elementIds === undefined) === (args.allAtTime !== true)) fail("INVALID_PARAMS", "Give either elementIds or allAtTime: true, exactly one.", { field: "elementIds" }); },
    handle(ctx, args) {
      const picked = args.elementIds ? elementsIn(ctx, args.elementIds) : undefined, scene = picked?.scene ?? ctx.scene(args.sceneId), fps = ctx.doc.settings.fps, keep = args.keep ?? "both";
      for (const hit of picked?.hits ?? []) unlocked(hit.track);
      const family = new Set(args.elementIds ?? []), parts = new Set(args.elementIds ?? []), before = ctx.edit;
      // Deleting one side of a split leaves the other where it is.
      if (keep !== "both") ctx.edit = { ...ctx.edit, ripple: false, magnet: false };
      try {
        for (const time of [...new Set(args.times.map((value) => snapToFrame(value, fps)))].sort((a, b) => a - b)) {
          const live = ctx.scene(scene.id), under = timeline.splitTargets(live, time, args.allAtTime ? [] : [...family].filter((elementId) => timeline.locate(ctx.doc, elementId)), args.allAtTime ? "split-all" : "split");
          if (under.length === 0) { ctx.warnings.push("time_outside_element"); continue; }
          const info = ctx.run(timeline.split({ sceneId: scene.id, time, elementIds: args.allAtTime ? [] : under.map((hit) => hit.element.id), mode: keep === "both" ? (args.allAtTime ? "split-all" : "split") : keep === "left" ? "delete-right" : "delete-left" }));
          for (const hit of under) parts.add(hit.element.id);
          for (const rightId of info.rightIds) { family.add(rightId); parts.add(rightId); }
        }
      } finally { ctx.edit = before; }
      const alive = [...parts].map((elementId) => timeline.locate(ctx.doc, elementId)).filter((hit): hit is timeline.Located => hit !== undefined).sort((a, b) => a.element.startTime - b.element.startTime);
      const first = alive[0]?.element;
      return {
        data: { elementIds: alive.map((hit) => hit.element.id), parts: alive.map((hit) => ({ elementId: hit.element.id, trackId: hit.track.id, start: hit.element.startTime, duration: hit.element.duration })) },
        summary: alive.length > 0 ? `Split into ${alive.length} part(s)${keep !== "both" ? `, keeping the ${keep} side` : ""}.` : "No element was under the given times; nothing was split.",
        change: { kind: "modify", entity: "element", entityId: first?.id ?? scene.id, label: first?.name ?? scene.name },
      };
    },
  }),

  writeTool({
    name: "jc_clip_delete", family: "clip",
    description: "Remove elements from the timeline. ripple: true closes the gaps they leave on their tracks. On the main track the gap closes by default (the host's magnet); pass editContext {magnet: false} to keep it.",
    shape: { elementIds: ids(), ripple: z.boolean().optional(), ...WRITE },
    handle(ctx, args) {
      const { scene, hits } = elementsIn(ctx, args.elementIds);
      for (const hit of hits) unlocked(hit.track);
      const made = ctx.run(timeline.deleteElements({ sceneId: scene.id, elementIds: args.elementIds, ripple: args.ripple === true }));
      return { data: { removedElementIds: made.removed, sceneDuration: timeline.sceneDurationOf(ctx.scene(scene.id)) }, summary: `Deleted ${made.removed.length === 1 ? elementLabel(hits[0].element) : `${made.removed.length} elements`}${args.ripple ? " and closed the gaps" : ""}.`, change: { kind: "remove", entity: "element", entityId: hits[0].element.id, label: hits[0].element.name } };
    },
  }),
  writeTool({
    name: "jc_range_delete", family: "range",
    description: "Remove everything inside timeline time ranges (ranges[], 1–200), splitting elements at the boundaries, on the named tracks or on all unlocked tracks; ripple: true closes the gaps. Or remove ranges of an element given in its source time (elementId + sourceRanges[]): this is the form for silence and filler removal from a transcript and always closes the gaps. Pass one form, not both.",
    shape: {
      ranges: z.array(range()).min(1).max(200).optional(), trackIds: ids().optional(), allTracks: z.boolean().optional(), ripple: z.boolean().optional(),
      elementId: id().optional(), sourceRanges: z.array(z.object({ sourceStart: ticks(), sourceEnd: ticks() }).strict()).min(1).max(200).optional(), ...SCENE, ...WRITE,
    },
    refine(args) {
      if (args.ranges && args.sourceRanges) fail("INVALID_PARAMS", "Pass either ranges (timeline time) or sourceRanges (the element's source time), not both.", { field: "sourceRanges" });
      if (!args.ranges && !args.sourceRanges) fail("INVALID_PARAMS", "Pass ranges, or elementId with sourceRanges.", { field: "ranges" });
      if (args.sourceRanges && !args.elementId) fail("INVALID_PARAMS", "sourceRanges needs elementId.", { field: "elementId" });
      if (args.trackIds && args.allTracks) fail("INVALID_PARAMS", "Give either trackIds or allTracks, not both.", { field: "allTracks" });
      for (const [index, entry] of (args.ranges ?? []).entries()) if (entry.end <= entry.start) fail("INVALID_PARAMS", `ranges[${index}].end must be later than its start.`, { field: `ranges.${index}.end`, index });
      for (const [index, entry] of (args.sourceRanges ?? []).entries()) if (entry.sourceEnd <= entry.sourceStart) fail("INVALID_PARAMS", `sourceRanges[${index}].sourceEnd must be later than its sourceStart.`, { field: `sourceRanges.${index}.sourceEnd`, index });
    },
    handle(ctx, args) {
      if (args.sourceRanges) {
        const { scene, track, element } = elementIn(ctx, args.elementId!);
        unlocked(track);
        const made = ctx.run(timeline.removeSourceRanges({ sceneId: scene.id, elementId: element.id, ranges: args.sourceRanges }));
        return { data: { elementId: element.id, removedCount: made.removedCount, removedDuration: made.removedDuration, sceneDuration: timeline.sceneDurationOf(ctx.scene(scene.id)) }, summary: `Removed ${made.removedCount} range(s) (${seconds(made.removedDuration)}) from ${elementLabel(element)} and closed the gaps.`, change: { kind: "remove", entity: "element", entityId: element.id, label: element.name } };
      }
      const scene = ctx.scene(args.sceneId);
      for (const trackId of args.trackIds ?? []) { const found = timeline.trackById(scene, trackId) ?? fail("TRACK_NOT_FOUND", `No track of this scene has the id "${trackId}".`, { trackId }); unlocked(found as Tr); }
      const made = ctx.run(timeline.deleteRanges({ sceneId: scene.id, ranges: args.ranges!, ...(args.trackIds ? { trackIds: args.trackIds } : {}), ripple: args.ripple === true, strictLocks: args.allTracks === true }));
      return { data: { removedElementIds: made.removed, removedDuration: made.removedDuration, sceneDuration: timeline.sceneDurationOf(ctx.scene(scene.id)) }, summary: `Removed ${args.ranges!.length} range(s) totalling ${seconds(made.removedDuration)}${args.ripple ? " and closed the gaps" : ""}.`, change: { kind: "remove", entity: "scene", entityId: scene.id, label: scene.name } };
    },
  }),
  writeTool({
    name: "jc_gap_close", family: "range",
    description: "Close the gaps on a track (default: the main track): every element after a gap moves left. range limits it to a part of the timeline, minGap ignores gaps shorter than that many ticks.",
    shape: { trackId: id().optional(), range: range().optional(), minGap: ticks().optional(), ...SCENE, ...WRITE },
    handle(ctx, args) {
      const found = args.trackId ? trackIn(ctx, args.trackId) : undefined, scene = found?.scene ?? ctx.scene(args.sceneId), track = found?.track ?? scene.tracks.main;
      unlocked(track);
      if (args.range && args.range.end <= args.range.start) fail("INVALID_PARAMS", "range.end must be later than range.start.", { field: "range" });
      const made = ctx.run(timeline.closeTrackGaps({ sceneId: scene.id, trackId: track.id, ...(args.range ? { range: args.range } : {}), ...(args.minGap !== undefined ? { minGap: Math.max(1, args.minGap) } : {}) }));
      if (made.closed === 0) ctx.warnings.push("no_change");
      return { data: { trackId: track.id, closedGaps: made.closed, closedDuration: made.closedDuration, sceneDuration: timeline.sceneDurationOf(ctx.scene(scene.id)) }, summary: made.closed > 0 ? `Closed ${made.closed} gap(s) (${seconds(made.closedDuration)}) on the track "${clip(track.name, 40)}".` : `The track "${clip(track.name, 40)}" has no gap to close.`, change: { kind: "move", entity: "track", entityId: track.id, label: track.name } };
    },
  }),
];
export type { El };
