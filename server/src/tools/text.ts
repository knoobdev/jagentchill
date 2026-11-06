import { z } from "zod";
import {
  applyCaptionStyle, applyTextPreset, CAPTION_STYLES, captionCues, captionFileName, frameTicks, importCaptions, mergeCaptionWithPrevious, parseAss, parseSrt, parseVtt, setCaptionText, setCaptionTiming, setCaptionTrack, setElementFields, setTextAnimation,
  setTextBackground, setTextBubble, snapToFrame, splitCaption, SubtitleError, TEXT_ANIMATIONS, TEXT_BUBBLES, TEXT_PRESETS, TEXT_TEMPLATES, timeline, writeAss, writeSrt, writeTxt, writeVtt,
} from "@jagentchill/editor-core";
import { fontFamilyList, resolveFont } from "./fonts.ts";
import { SCENE, WRITE, defineTool, checkField, checkRange, clip, color, elementIn, elementLabel, elementsIn, fail, id, ids, outOfRange, seconds, tickDelta, ticks, trackIn, unlocked, writeTool, type El, type Sc, type ToolContext } from "./kit.ts";

type Json = Record<string, unknown>;
const end = (element: { startTime: number; duration: number }) => element.startTime + element.duration;
/** The families the texts of the project are set in: one of them is a family its devices have. */
const usedFonts = (ctx: ToolContext): string[] => (ctx.doc.scenes as unknown as Sc[]).flatMap((scene) => timeline.elementsOfScene(scene)).map((element) => element.fontFamily).filter((name): name is string => typeof name === "string");
/**
 * The stored family for a `fontFamily` argument. A family that is not available does not fail the edit (the model
 * names fonts it knows from elsewhere): the closest available one is used and the result says so in `warnings`.
 */
function checkFont(ctx: ToolContext, family: string, _field: string): string {
  const resolved = resolveFont(family, usedFonts(ctx));
  if (resolved.substituted) {
    const warning = `FONT_SUBSTITUTED: the font "${resolved.substituted.wanted}" is not available; "${resolved.family}" is used instead (${resolved.substituted.by === "name" ? "the closest name" : "the same kind of font"}). Available fonts: ${fontFamilyList()}.`;
    if (!ctx.warnings.includes(warning)) ctx.warnings.push(warning);
  }
  return resolved.family;
}

const group = <S extends z.ZodRawShape>(shape: S) => z.object(shape).strict().optional();
const styleShape = () => z.object({
  fontFamily: z.string().min(1).max(200).optional(), fontSize: z.number().optional(), fontWeight: z.number().optional(), fontStyle: z.enum(["normal", "italic"]).optional(), underline: z.boolean().optional(), strikethrough: z.boolean().optional(),
  textCase: z.enum(["none", "upper", "lower", "title"]).optional(), color: color().optional(), fill: group({ type: z.enum(["solid", "gradient"]).optional(), gradientColor: color().optional(), gradientAngle: z.number().optional() }),
  textAlign: z.enum(["left", "center", "right", "justify"]).optional(), letterSpacing: z.number().optional(), lineHeight: z.number().optional(), box: group({ mode: z.enum(["auto", "fixed"]).optional(), width: z.number().optional() }), curve: z.number().optional(),
  background: group({ enabled: z.boolean().optional(), color: color().optional(), cornerRadius: z.number().optional(), paddingX: z.number().optional(), paddingY: z.number().optional(), offsetX: z.number().optional(), offsetY: z.number().optional() }),
  stroke: group({ enabled: z.boolean().optional(), color: color().optional(), width: z.number().optional(), position: z.enum(["outside", "center"]).optional() }),
  shadow: group({ enabled: z.boolean().optional(), color: color().optional(), opacity: z.number().optional(), blur: z.number().optional(), distance: z.number().optional(), angle: z.number().optional() }),
  glow: group({ enabled: z.boolean().optional(), color: color().optional(), intensity: z.number().optional(), radius: z.number().optional() }),
  bubble: z.object({ id: id(), color: color().optional(), strokeColor: color().optional(), strokeWidth: z.number().optional(), flipHorizontal: z.boolean().optional() }).strict().nullable().optional(),
}).strict();
type Style = z.infer<ReturnType<typeof styleShape>>;
const animationShape = () => z.object({
  in: z.object({ animationId: id(), duration: ticks(), strength: z.number().optional() }).strict().optional(), out: z.object({ animationId: id(), duration: ticks(), strength: z.number().optional() }).strict().optional(),
  loop: z.object({ animationId: id(), period: ticks(), strength: z.number().optional() }).strict().optional(),
}).strict();
type Animation = z.infer<ReturnType<typeof animationShape>>;

/** The stored fields a partial style writes on an element type, every leaf checked against that type's field ranges. */
function styleFields(ctx: ToolContext, element: { type: string; id: string; name?: string; [key: string]: unknown }, style: Style, prefix = "style"): { fields: Json; bubble?: Style["bubble"]; background?: Json } {
  const fields: Json = {};
  for (const [key, value] of Object.entries(style)) {
    if (value === undefined || key === "bubble") continue;
    if (value !== null && typeof value === "object") {
      for (const [leaf, entry] of Object.entries(value)) checkField(element, `${key}.${leaf}`, entry, `${prefix}.${key}.${leaf}`);
      if (key !== "background") fields[key] = { ...(element[key] as object), ...value };
    } else { checkField(element, key, value, `${prefix}.${key}`); fields[key] = key === "fontFamily" ? checkFont(ctx, String(value), `${prefix}.fontFamily`) : value; }
  }
  if (style.bubble && !TEXT_BUBBLES.some((bubble) => bubble.id === style.bubble!.id)) fail("LIBRARY_ITEM_NOT_FOUND", `"${style.bubble.id}" is not a text bubble. Find ids with jc_library_search {kind: "text_bubble"}.`, { field: `${prefix}.bubble.id`, suggestions: TEXT_BUBBLES.slice(0, 3).map((bubble) => bubble.id) });
  checkRange(`${prefix}.bubble.strokeWidth`, style.bubble?.strokeWidth, 0, 20);
  return { fields, ...(style.bubble !== undefined ? { bubble: style.bubble } : {}), ...(style.background ? { background: style.background as Json } : {}) };
}
function checkAnimation(element: { duration: number }, animation: Animation, frame: number): void {
  for (const slot of ["in", "out", "loop"] as const) {
    const value = animation[slot];
    if (!value) continue;
    if (!TEXT_ANIMATIONS.some((entry) => entry.id === value.animationId && entry.group === slot)) fail("LIBRARY_ITEM_NOT_FOUND", `"${value.animationId}" is not a text ${slot} animation. Find ids with jc_library_search {kind: "text_animation", category: "${slot}"}.`, { field: `animation.${slot}.animationId`, suggestions: TEXT_ANIMATIONS.filter((entry) => entry.group === slot).slice(0, 3).map((entry) => entry.id) });
    checkRange(`animation.${slot}.strength`, value.strength, 0, 100);
    if ("period" in value) checkRange("animation.loop.period", value.period, 24_000, 600_000, "ticks; 0.2–5 s");
    else if (value.duration < Math.min(12_000, element.duration) || value.duration > element.duration) outOfRange(`animation.${slot}.duration`, Math.min(Math.max(frame, 12_000), element.duration), element.duration, value.duration, "between 0.1 s and the element's duration");
  }
  if ((animation.in?.duration ?? 0) + (animation.out?.duration ?? 0) > element.duration) outOfRange("animation.out.duration", 0, Math.max(0, element.duration - (animation.in?.duration ?? 0)), animation.out?.duration ?? 0, "in plus out is at most the element's duration");
}
function applyStyle(ctx: ToolContext, element: El, style: Style | undefined, animation: Animation | undefined, effectPresetId: string | undefined): void {
  if (effectPresetId !== undefined) {
    if (!TEXT_PRESETS.some((preset) => preset.id === effectPresetId)) fail("LIBRARY_ITEM_NOT_FOUND", `"${effectPresetId}" is not a text effect preset. Find ids with jc_library_search {kind: "text_effect_preset"}.`, { field: "effectPresetId", suggestions: TEXT_PRESETS.slice(0, 3).map((preset) => preset.id) });
    ctx.apply((doc, c) => applyTextPreset(doc, c, [element.id], effectPresetId));
  }
  if (style) {
    const live = timeline.located(ctx.doc, element.id).element, made = styleFields(ctx, live, style);
    if (Object.keys(made.fields).length > 0) ctx.apply((doc, c) => setElementFields(doc, c, element.id, made.fields, { commandType: "text.style", label: "Text style" }));
    if (made.background) ctx.apply((doc, c) => setTextBackground(doc, c, element.id, made.background!));
    if (made.bubble !== undefined) { const { id: bubbleId, ...change } = made.bubble ?? { id: null as unknown as string }; ctx.apply((doc, c) => setTextBubble(doc, c, element.id, made.bubble === null ? null : bubbleId, change as Json)); }
  }
  for (const slot of ["in", "out", "loop"] as const) {
    const value = animation?.[slot];
    if (value) ctx.apply((doc, c) => setTextAnimation(doc, c, element.id, slot, { id: value.animationId, ...("period" in value ? { period: value.period } : { duration: value.duration }), strength: value.strength ?? 100 }));
  }
}
const textData = (element: El) => ({ elementId: element.id, content: String(element.content ?? "").slice(0, 200), start: element.startTime, duration: element.duration, fontFamily: element.fontFamily, fontSize: element.fontSize, color: element.color, textAnimation: element.textAnimation ?? null, stylePresetId: element.stylePresetId ?? null, bubble: element.bubble ?? null, curve: element.curve, strikethrough: element.strikethrough });

const captionTrack = (ctx: ToolContext, trackId: string) => { const found = trackIn(ctx, trackId); if (found.track.type !== "caption") fail("TRACK_KIND_MISMATCH", `The track "${found.track.name}" is a ${found.track.type} track, not a caption track.`, { trackId, trackType: found.track.type }); return found; };
const captionOf = (ctx: ToolContext, captionId: string) => { const hit = elementIn(ctx, captionId); if (hit.element.type !== "caption") fail("UNSUPPORTED_FOR_ELEMENT", `${elementLabel(hit.element)} is not a caption.`, { elementId: captionId }); return hit; };

export const TEXT_TOOLS = [
  writeTool({
    name: "jc_text_add", family: "text",
    description: "Add a text element: content (1–10,000 characters) at a start time for a duration (default 3 s), centred, on a free text track or a new one. style is a partial text style (fontFamily: see jc_library_search {kind: \"font\"}, another family is replaced by the closest one with a warning; fontSize 1–500, fontWeight, color, stroke, shadow, glow, background, curve, bubble…); templateId adds a text template from the library with this content in its first text; effectPresetId applies a text effect preset; animation sets in, out and loop text animations.",
    shape: {
      content: z.string().min(1).max(10_000), start: ticks(), duration: ticks().optional(), trackId: id().optional(), style: styleShape().optional(), templateId: id().optional(), effectPresetId: id().optional(), animation: animationShape().optional(),
      anchor: z.object({ elementId: id(), edge: z.enum(["start", "end"]), offsetSeconds: z.number().finite().min(-86_400).max(86_400) }).strict().optional(),
      position: z.object({ x: z.number(), y: z.number() }).strict().optional(), ...SCENE, ...WRITE,
    },
    handle(ctx, args) {
      const scene = ctx.scene(args.sceneId), fps = ctx.doc.settings.fps, frame = frameTicks(fps), duration = args.duration ?? timeline.FACTORY_INSERT_DEFAULTS.textDuration;
      if (duration < frame) outOfRange("duration", frame, 2_592_000_000, duration, "at least one frame");
      if (args.position) { checkRange("position.x", args.position.x, -100_000, 100_000); checkRange("position.y", args.position.y, -100_000, 100_000); }
      const target = args.trackId ? trackIn(ctx, args.trackId) : undefined;
      if (target) {
        unlocked(target.track);
        if (target.track.type !== "text") fail("TRACK_KIND_MISMATCH", `The track "${target.track.name}" is a ${target.track.type} track; text goes on a text track.`, { trackId: target.track.id, trackType: target.track.type });
        if (!timeline.isFree(target.track, args.start, args.start + duration)) fail("OVERLAP_NOT_ALLOWED", `The range is occupied on the track "${target.track.name}". Choose another time, or leave trackId out to use a free text track.`, { trackId: target.track.id, conflictingElementIds: target.track.elements.filter((element) => element.startTime < args.start + duration && end(element) > args.start).map((element) => element.id) });
      }
      if (args.animation) checkAnimation({ duration: snapToFrame(duration, fps) }, args.animation, frame);
      let elementId: string, elementIds: string[];
      if (args.templateId) {
        if (!TEXT_TEMPLATES.some((template) => template.id === args.templateId)) fail("LIBRARY_ITEM_NOT_FOUND", `"${args.templateId}" is not a text template. Find ids with jc_library_search {kind: "text_template"}.`, { field: "templateId", suggestions: TEXT_TEMPLATES.slice(0, 3).map((template) => template.id) });
        const made = ctx.run(timeline.addTextTemplate({ sceneId: scene.id, templateId: args.templateId, time: args.start }));
        elementIds = made.elementIds;
        const first = made.elementIds.map((entry) => timeline.located(ctx.doc, entry).element).find((element) => element.type === "text") ?? fail("INTERNAL", "The template holds no text.");
        elementId = first.id;
        ctx.apply((doc, c) => setElementFields(doc, c, elementId, { content: args.content, name: clip(args.content.replace(/\s+/g, " "), 200) }, { commandType: "text.content", label: "Edit text" }));
        if (args.duration !== undefined) {
          // A template of one member is not a group: its text is trimmed on its own.
          const finish = snapToFrame(args.start, fps) + snapToFrame(duration, fps), members = timeline.elementsOfScene(ctx.scene(scene.id)).filter((element) => element.groupId === made.groupId);
          if (members.length > 1) ctx.run(timeline.trimGroup({ sceneId: scene.id, groupId: made.groupId, end: finish }));
          else if (first.startTime + first.duration !== finish) ctx.apply((doc, c) => setElementFields(doc, c, elementId, { duration: Math.max(frame, finish - first.startTime) }, { commandType: "timeline.trim", label: "Trim" }));
        }
      } else {
        const fields = { content: args.content, name: clip(args.content.replace(/\s+/g, " "), 200) };
        if (target) {
          const made = ctx.run(timeline.addToTimeline({ sceneId: scene.id, items: [{ kind: "text", fields: { ...fields, ...(args.position ? { transform: { position: args.position, scale: { x: 1, y: 1 }, rotation: 0 } } : {}) } }], time: args.start, request: { strategy: "explicit", trackId: target.track.id }, defaults: { ...timeline.FACTORY_INSERT_DEFAULTS, textDuration: duration }, agent: true, label: "Add text" }));
          elementId = made.elementIds[0];
        } else elementId = ctx.run(timeline.addDefaultText({ sceneId: scene.id, time: args.start, duration, ...(args.position ? { position: args.position } : {}), fields })).elementId;
        elementIds = [elementId];
      }
      if (args.anchor) ctx.run(timeline.setTimingAnchor({ sceneId: scene.id, elementId, anchor: args.anchor }));
      applyStyle(ctx, timeline.located(ctx.doc, elementId).element, args.style, args.animation, args.effectPresetId);
      const placed = timeline.located(ctx.doc, elementId);
      return { data: { ...textData(placed.element), elementIds, trackId: placed.track.id }, summary: `Added the text "${clip(args.content.replace(/\s+/g, " "), 60)}" at ${seconds(placed.element.startTime)} for ${seconds(placed.element.duration)}.`, change: { kind: "add", entity: "element", entityId: elementId, label: clip(args.content, 60) } };
    },
  }),
  writeTool({
    name: "jc_text_update", family: "text",
    description: "Change text content, style, effect, template, animations, or clear them. anchor sets or clears the text's relative start using {elementId, edge, offsetSeconds}. Position, scale, rotation and opacity are set with jc_clip_transform.",
    shape: { elementIds: ids(), content: z.string().min(1).max(10_000).optional(), style: styleShape().optional(), templateId: id().optional(), effectPresetId: id().nullable().optional(), animation: animationShape().optional(), clearAnimation: z.array(z.enum(["in", "out", "loop"])).min(1).max(3).optional(), anchor: z.object({ elementId: id(), edge: z.enum(["start", "end"]), offsetSeconds: z.number().finite().min(-86_400).max(86_400) }).strict().nullable().optional(), ...WRITE },
    refine(args) { if (Object.keys(args).every((key) => ["elementIds", "idempotencyKey", "dryRun", "editContext"].includes(key))) fail("INVALID_PARAMS", "Name at least one thing to change."); },
    handle(ctx, args) {
      const { hits } = elementsIn(ctx, args.elementIds), frame = frameTicks(ctx.doc.settings.fps);
      for (const hit of hits) {
        unlocked(hit.track);
        if (hit.element.type !== "text") fail("UNSUPPORTED_FOR_ELEMENT", `${elementLabel(hit.element)} is not a text element.${hit.element.type === "caption" ? " Captions are edited with jc_caption_edit and jc_caption_style." : ""}`, { elementId: hit.element.id });
        if (args.animation) checkAnimation(hit.element, args.animation, frame);
      }
      let ids = [...args.elementIds];
      if (args.templateId) {
        if (!TEXT_TEMPLATES.some((template) => template.id === args.templateId)) fail("LIBRARY_ITEM_NOT_FOUND", `"${args.templateId}" is not a text template. Find ids with jc_library_search {kind: "text_template"}.`, { field: "templateId", suggestions: TEXT_TEMPLATES.slice(0, 3).map((template) => template.id) });
        ids = hits.map((hit) => { const made = ctx.run(timeline.replaceTextWithTemplate({ sceneId: hit.scene.id, elementId: hit.element.id, templateId: args.templateId! })); return made.elementIds.map((entry) => timeline.located(ctx.doc, entry).element).find((element) => element.type === "text")!.id; });
      }
      for (const elementId of ids) {
        if (args.content !== undefined) ctx.apply((doc, c) => setElementFields(doc, c, elementId, { content: args.content, name: clip(args.content!.replace(/\s+/g, " "), 200) }, { commandType: "text.content", label: "Edit text" }));
        if (args.effectPresetId === null) ctx.apply((doc, c) => applyTextPreset(doc, c, [elementId], null));
        for (const slot of args.clearAnimation ?? []) ctx.apply((doc, c) => setTextAnimation(doc, c, elementId, slot, null));
        if (args.anchor !== undefined) { const hit = timeline.located(ctx.doc, elementId); ctx.run(timeline.setTimingAnchor({ sceneId: hit.scene.id, elementId, anchor: args.anchor })); }
        applyStyle(ctx, timeline.located(ctx.doc, elementId).element, args.style, args.animation, args.effectPresetId ?? undefined);
      }
      const now = timeline.located(ctx.doc, ids[0]).element;
      return { data: { ...textData(now), elementIds: ids }, summary: `Changed ${ids.length === 1 ? `the text "${clip(String(now.content).replace(/\s+/g, " "), 60)}"` : `${ids.length} text elements`}.`, change: { kind: "modify", entity: "element", entityId: ids[0], label: clip(String(now.content), 60) } };
    },
  }),

  writeTool({
    name: "jc_caption_import", family: "caption",
    description: "Create a caption track from subtitle text in SRT, VTT, ASS or SSA format (pass the file's content as text). offset shifts every caption by that many ticks. Plain text without timings is not accepted.",
    shape: { text: z.string().min(1).max(1_000_000), format: z.enum(["srt", "vtt", "ass", "ssa"]), offset: tickDelta().optional(), language: z.string().min(2).max(35).optional(), name: z.string().trim().min(1).max(80).optional(), ...SCENE, ...WRITE },
    handle(ctx, args) {
      const scene = ctx.scene(args.sceneId);
      let parsed;
      try { parsed = args.format === "srt" ? parseSrt(args.text) : args.format === "vtt" ? parseVtt(args.text) : parseAss(args.text); } catch (error) { if (error instanceof SubtitleError) fail("INVALID_PARAMS", `The text is not valid ${args.format.toUpperCase()}: ${error.message}.`, { field: "text" }); throw error; }
      if (parsed.cues.length === 0) fail("INVALID_PARAMS", "No captions were found in the text. Check that it is in the stated format, with timings.", { field: "text" });
      if (parsed.cues.length > 5000) outOfRange("text", 1, 5000, parsed.cues.length, "captions on one track");
      const made = ctx.run(importCaptions({ sceneId: scene.id, parsed, ...(args.language ? { language: args.language } : {}), ...(args.offset ? { offset_ms: args.offset / 120 } : {}), ...(args.name ? { name: args.name } : {}) }));
      for (const warning of parsed.warnings) ctx.warnings.push(warning);
      return { data: { trackId: made.trackId, captionCount: made.elementIds.length, captionIds: made.elementIds.slice(0, 50), skipped: parsed.skipped }, summary: `Imported ${made.elementIds.length} captions as a new caption track.`, change: { kind: "add", entity: "track", entityId: made.trackId, label: args.name ?? "Captions" } };
    },
  }),
  writeTool({
    name: "jc_caption_edit", family: "caption",
    description: "Edit captions: edits[] change a caption's text, start, end or speaker, or merge a caption with the one before it, split it at a character position (at), or delete captions; findReplace replaces text in every caption of a track (or of all caption tracks). Captions of one track never overlap.",
    shape: {
      edits: z.array(z.union([
        z.object({ captionId: id(), text: z.string().max(500).optional(), start: ticks().optional(), end: ticks().optional(), speaker: z.string().max(80).nullable().optional() }).strict(),
        z.object({ action: z.enum(["merge", "split", "delete"]), captionIds: ids(), at: z.number().int().min(1).max(499).optional() }).strict(),
      ])).min(1).max(200).optional(),
      findReplace: z.object({ find: z.string().min(1).max(200), replace: z.string().max(200), matchCase: z.boolean().optional() }).strict().optional(), trackId: id().optional(), ...WRITE,
    },
    refine(args) { if (!args.edits && !args.findReplace) fail("INVALID_PARAMS", "Give edits, findReplace or both."); },
    handle(ctx, args) {
      let edited = 0, replacements = 0, first: El | undefined;
      (args.edits ?? []).forEach((edit, index) => {
        if ("action" in edit) {
          const hits = edit.captionIds.map((captionId) => captionOf(ctx, captionId));
          for (const hit of hits) unlocked(hit.track);
          first ??= hits[0].element;
          if (edit.action === "delete") ctx.run(timeline.deleteElements({ sceneId: hits[0].scene.id, elementIds: edit.captionIds }));
          else if (edit.action === "split") {
            if (edit.at === undefined) fail("INVALID_PARAMS", `edits[${index}]: split needs at, a character position inside the caption's text.`, { field: `edits.${index}.at`, index });
            for (const hit of hits) { const length = String(hit.element.text ?? "").length; if (edit.at! >= length) outOfRange(`edits.${index}.at`, 1, Math.max(1, length - 1), edit.at, "inside the caption's text"); ctx.apply((doc, c) => splitCaption(doc, c, hit.element.id, edit.at!)); }
          } else {
            // Merging a run of captions: each one after the first joins the one before it.
            const ordered = [...hits].sort((a, b) => a.element.startTime - b.element.startTime);
            if (ordered.length < 2) fail("INVALID_PARAMS", `edits[${index}]: merge needs two or more adjacent captions of one track.`, { field: `edits.${index}.captionIds`, index });
            for (const hit of ordered.slice(1)) ctx.apply((doc, c) => mergeCaptionWithPrevious(doc, c, hit.element.id));
          }
          edited += hits.length;
          return;
        }
        const hit = captionOf(ctx, edit.captionId), fps = ctx.doc.settings.fps;
        unlocked(hit.track);
        first ??= hit.element;
        if (edit.start !== undefined || edit.end !== undefined) {
          const start = snapToFrame(edit.start ?? hit.element.startTime, fps), finish = snapToFrame(edit.end ?? end(hit.element), fps);
          if (finish <= start) outOfRange(`edits.${index}.end`, start + frameTicks(fps), 10_368_000_000, finish, "a caption ends after it starts");
          const clash = hit.track.elements.filter((other) => other.id !== hit.element.id && other.startTime < finish && end(other) > start);
          if (clash.length > 0) fail("OVERLAP_NOT_ALLOWED", `edits[${index}]: the new range would overlap ${clash.length} other caption(s) of the track. Captions of one track never overlap.`, { conflictingElementIds: clash.map((other) => other.id), index });
          ctx.apply((doc, c) => setCaptionTiming(doc, c, hit.element.id, { start, end: finish }));
        }
        if (edit.text !== undefined) ctx.apply((doc, c) => setCaptionText(doc, c, hit.element.id, edit.text!));
        if (edit.speaker !== undefined) ctx.apply((doc, c) => setElementFields(doc, c, hit.element.id, { speaker: edit.speaker === null || edit.speaker === "" ? undefined : edit.speaker }, { commandType: "caption.speaker", label: "Speaker" }));
        edited += 1;
      });
      if (args.findReplace) {
        const tracks = args.trackId ? [captionTrack(ctx, args.trackId).track] : (ctx.doc.scenes as unknown as Sc[]).flatMap((scene) => timeline.tracksOfScene(scene)).filter((track) => track.type === "caption" && !track.locked);
        const escaped = args.findReplace.find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), pattern = new RegExp(escaped, args.findReplace.matchCase ? "g" : "gi");
        for (const track of tracks) for (const caption of track.elements) {
          const text = String(caption.text ?? ""), count = text.match(pattern)?.length ?? 0;
          if (count === 0) continue;
          const next = text.replace(pattern, args.findReplace.replace);
          if (next.length > 500) outOfRange("findReplace.replace", 0, 500, next.length, `characters; the caption ${caption.id} would become too long`);
          ctx.apply((doc, c) => setCaptionText(doc, c, caption.id, next));
          replacements += count; first ??= caption;
        }
      }
      if (!first) { ctx.warnings.push("no_change"); return { data: { edited: 0, replacements: 0 }, summary: "Nothing matched; no caption was changed.", change: { kind: "modify", entity: "project", entityId: ctx.projectId, label: "Captions" } }; }
      return { data: { edited, replacements }, summary: `Edited ${edited} caption(s)${args.findReplace ? ` and made ${replacements} replacement(s)` : ""}.`, change: { kind: "modify", entity: "element", entityId: first.id, label: first.name } };
    },
  }),
  writeTool({
    name: "jc_caption_style", family: "caption",
    description: "Style captions. With trackId: a bundled caption style (styleId from jc_library_search {kind: \"caption_style\"}), a partial text style, the layout (anchor, marginY 0–50, maxWidth 20–100, offset, scale), the word highlight, bilingual settings, mode, speaker labels and burn-in for the whole track. With captionIds: a style for those captions only (styleId or style); the track-only settings are refused.",
    shape: {
      trackId: id().optional(), captionIds: ids().optional(), styleId: id().optional(), style: styleShape().optional(),
      layout: z.object({ anchor: z.enum(["top", "middle", "bottom"]).optional(), marginY: z.number().optional(), maxWidth: z.number().optional(), offset: z.object({ x: z.number(), y: z.number() }).strict().optional(), scale: z.number().optional() }).strict().optional(),
      highlight: z.object({ style: z.enum(["none", "color", "background", "scale", "underline", "karaoke", "reveal"]).optional(), color: color().optional(), textColor: color().optional(), scale: z.number().optional() }).strict().optional(),
      bilingual: z.object({ visible: z.boolean().optional(), order: z.enum(["below", "above"]).optional(), scale: z.number().optional(), color: color().optional() }).strict().optional(),
      mode: z.enum(["speech", "lyrics"]).optional(), showSpeakerLabels: z.boolean().optional(), burnIn: z.boolean().optional(), ...WRITE,
    },
    refine(args) {
      if ((args.trackId === undefined) === (args.captionIds === undefined)) fail("INVALID_PARAMS", "Give either trackId or captionIds, exactly one.", { field: "trackId" });
      const trackOnly = (["layout", "highlight", "bilingual", "mode", "showSpeakerLabels", "burnIn"] as const).filter((key) => args[key] !== undefined);
      if (args.captionIds && trackOnly.length > 0) fail("INVALID_PARAMS", `${trackOnly.join(", ")} belong to the whole caption track: pass trackId instead of captionIds.`, { field: trackOnly[0] });
      if (args.style?.bubble !== undefined) fail("INVALID_PARAMS", "Captions have no bubble.", { field: "style.bubble" });
      checkRange("layout.marginY", args.layout?.marginY, 0, 50); checkRange("layout.maxWidth", args.layout?.maxWidth, 20, 100); checkRange("layout.scale", args.layout?.scale, 0.01, 100);
      checkRange("highlight.scale", args.highlight?.scale, 1, 2); checkRange("bilingual.scale", args.bilingual?.scale, 50, 150);
      if (args.styleId && !CAPTION_STYLES.some((style) => style.id === args.styleId)) fail("LIBRARY_ITEM_NOT_FOUND", `"${args.styleId}" is not a caption style. Find ids with jc_library_search {kind: "caption_style"}.`, { field: "styleId", suggestions: CAPTION_STYLES.slice(0, 3).map((style) => style.id) });
    },
    handle(ctx, args) {
      // The style keys and ranges of a caption are those of a text element, without the bubble.
      const partial = args.style ? styleFields(ctx, { type: "text", id: "caption" }, args.style) : undefined, style = partial ? { ...partial.fields, ...(partial.background ? { background: partial.background } : {}) } : undefined;
      if (args.captionIds) {
        const hits = args.captionIds.map((captionId) => captionOf(ctx, captionId));
        for (const hit of hits) unlocked(hit.track);
        if (args.styleId) for (const trackId of new Set(hits.map((hit) => hit.track.id))) ctx.apply((doc, c) => applyCaptionStyle(doc, c, trackId, args.styleId!, hits.filter((hit) => hit.track.id === trackId).map((hit) => hit.element.id)));
        if (style) for (const hit of hits) { const now = timeline.located(ctx.doc, hit.element.id).element; ctx.apply((doc, c) => setElementFields(doc, c, hit.element.id, { style: { ...(now.style as object), ...style } }, { commandType: "caption.style", label: "Caption style" })); }
        if (!args.styleId && !style) fail("INVALID_PARAMS", "Name a styleId or a style for the captions.", { field: "style" });
        return { data: { captionIds: args.captionIds, style: timeline.located(ctx.doc, args.captionIds[0]).element.style ?? null }, summary: `Styled ${hits.length} caption(s).`, change: { kind: "modify", entity: "element", entityId: hits[0].element.id, label: hits[0].element.name } };
      }
      const { track } = captionTrack(ctx, args.trackId!);
      unlocked(track);
      if (args.styleId) ctx.apply((doc, c) => applyCaptionStyle(doc, c, track.id, args.styleId!));
      const change = { ...(style ? { style } : {}), ...(args.layout ? { layout: args.layout } : {}), ...(args.highlight ? { highlight: args.highlight } : {}), ...(args.bilingual ? { bilingual: args.bilingual } : {}) };
      if (Object.keys(change).length > 0) ctx.apply((doc, c) => setCaptionTrack(doc, c, track.id, change as never));
      const flags = { ...(args.mode ? { mode: args.mode } : {}), ...(args.showSpeakerLabels !== undefined ? { showSpeakerLabels: args.showSpeakerLabels } : {}), ...(args.burnIn !== undefined ? { burnIn: args.burnIn } : {}) };
      for (const [key, value] of Object.entries(flags)) ctx.apply((doc, c) => setCaptionTrack(doc, c, track.id, { [key]: value } as never));
      if (!args.styleId && Object.keys(change).length === 0 && Object.keys(flags).length === 0) fail("INVALID_PARAMS", "Name what to change on the caption track.");
      return { data: { trackId: track.id, caption: trackIn(ctx, track.id).track.caption }, summary: `Changed the caption style of the track "${clip(track.name, 40)}".`, change: { kind: "modify", entity: "track", entityId: track.id, label: track.name } };
    },
  }),
  defineTool({
    name: "jc_caption_export", family: "caption", readOnly: false, needsProject: true, kind: "direct",
    description: "Write the captions of a caption track to a subtitle file (srt, vtt, ass or txt) in the project's workspace on the host and return the file reference. trackId defaults to the scene's caption track when it has exactly one. The committed project is exported: captions of a proposal that is not accepted yet are not in the file.",
    shape: { format: z.enum(["srt", "vtt", "ass", "txt"]), trackId: id().optional(), ...SCENE },
    handle(ctx, args) {
      const tracks = args.trackId ? [captionTrack(ctx, args.trackId).track] : (timeline.tracksOfScene(ctx.scene(args.sceneId)).filter((track) => track.type === "caption"));
      if (tracks.length === 0) fail("TRACK_NOT_FOUND", "This scene has no caption track. Import captions with jc_caption_import first.", {});
      if (tracks.length > 1) fail("INVALID_PARAMS", `This scene has ${tracks.length} caption tracks. Name one in trackId.`, { field: "trackId", allowed: tracks.map((track) => track.id) });
      const track = tracks[0], cues = captionCues(track);
      if (cues.length === 0) fail("INVALID_PARAMS", `The caption track "${track.name}" holds no caption.`, { field: "trackId", trackId: track.id });
      const text = args.format === "srt" ? writeSrt(cues) : args.format === "vtt" ? writeVtt(cues) : args.format === "ass" ? writeAss(cues) : writeTxt(cues);
      const language = typeof (track.caption as { language?: unknown } | undefined)?.language === "string" ? String((track.caption as { language: string }).language) : undefined;
      const file = ctx.host.writeProjectFile(ctx.projectId, "captions", captionFileName(ctx.doc.metadata.name, language, args.format), text);
      return { data: { file, format: args.format, trackId: track.id, captionCount: cues.length }, summary: `Exported ${cues.length} captions to ${file.name}.` };
    },
  }),
];
