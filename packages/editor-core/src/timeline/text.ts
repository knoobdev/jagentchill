import { createElement, type ProjectDocument } from "@jagentchill/protocol";
import { TEXT_BUBBLES } from "../content/text/bubbles.ts";
import { TEXT_PRESETS } from "../content/text/presets.ts";
import { TEXT_TEMPLATES, type TemplateKeys, type TemplateShape, type TemplateText, type TextTemplate } from "../content/text/templates.ts";
import type { Json } from "../model.ts";
import { clampTextAnimation, presetFields } from "../ops/text.ts";
import { writeKey } from "../ops/animation.ts";
import { frameTicks, snapToFrame } from "../time.ts";
import type { CommandEnv, TimelineCommand } from "./command.ts";
import { canHold, createTrackAt, elementsOfScene, endOf, fpsOf, refuse, sceneById, TRACK_FOR_ELEMENT, type El, type Sc } from "./model.ts";
import { FACTORY_INSERT_DEFAULTS, placeElements } from "./placement.ts";

/** `text-and-titles`: the commands of the Text asset tab — the default text card, effect presets and templates. */

const SECOND = 120_000;
const ticks = (seconds: number): number => Math.round(seconds * SECOND);

/**
 * "Default text" at a time on a text track by `firstAvailable`, with the default text duration. `position` is the
 * canvas point of a drop on the canvas (the element centre); `presetId` is a preset clicked with no text selected.
 */
export function addDefaultText(options: { sceneId: string; time: number; duration?: number; position?: { x: number; y: number }; presetId?: string; fields?: Record<string, unknown> }): TimelineCommand<{ elementId: string }> {
  return {
    type: "text.add", label: "Add text", sceneId: options.sceneId,
    run(draft, env) {
      const scene = sceneById(draft, options.sceneId), fps = fpsOf(draft);
      const preset = options.presetId ? TEXT_PRESETS.find((entry) => entry.id === options.presetId) ?? refuse("This text effect is not available", "unknown-preset") : null;
      const element = createElement("text", {
        id: env.newId(), name: "Text", startTime: snapToFrame(Math.max(0, options.time), fps), duration: Math.max(1, snapToFrame(options.duration ?? FACTORY_INSERT_DEFAULTS.textDuration, fps)),
        ...(options.position ? { transform: { position: options.position, scale: { x: 1, y: 1 }, rotation: 0 } } : {}), ...options.fields,
      }) as unknown as El;
      if (preset) Object.assign(element, presetFields(element as Json, preset));
      placeElements(scene, [element], { strategy: "firstAvailable" }, env);
      return { selection: [element.id], info: { elementId: element.id } };
    },
  };
}

const EASING_SEGMENT: Record<NonNullable<TemplateKeys["easing"]>, string> = { linear: "linear", "out-cubic": "bezier", "out-back": "bezier" };
function writeKeys(element: El, keyframes: TemplateKeys[] | undefined, scale: (path: string, value: number) => number, snap: (time: number) => number, env: CommandEnv): void {
  for (const channel of keyframes ?? []) {
    // "scale" animates both axes: each stored channel is keyed, multiplied by that axis' own size.
    const paths = channel.path === "transform.scale" ? ["transform.scale.x", "transform.scale.y"] : [channel.path];
    for (const path of paths) for (const [seconds, value] of channel.keys) writeKey(element as Json, "", path, { time: seconds === 0 ? 0 : Math.min(element.duration, snap(ticks(seconds))), value: scale(path, value), segmentToNext: EASING_SEGMENT[channel.easing ?? "linear"] }, env.newId);
  }
}

function buildText(member: TemplateText, start: number, duration: number, canvas: { width: number; height: number }, snap: (time: number) => number, env: CommandEnv, content?: string): El {
  const from = member.from ? snap(ticks(member.from)) : 0, length = Math.max(snap(1), snap(ticks(member.to ?? duration / SECOND)) - from);
  const element = createElement("text", {
    id: env.newId(), name: "Text", startTime: start + from, duration: length, content: content ?? member.content,
    fontFamily: member.fontFamily, fontWeight: member.fontWeight, fontStyle: member.fontStyle ?? "normal", fontSize: member.fontSize, textCase: member.textCase ?? "none", textAlign: member.align,
    ...(member.boxWidth ? { box: { mode: "fixed", width: member.boxWidth } } : {}),
    transform: { position: { x: (member.position[0] / 100) * canvas.width, y: (member.position[1] / 100) * canvas.height }, scale: { x: 1, y: 1 }, rotation: 0 },
  }) as unknown as El;
  const preset = member.preset ? TEXT_PRESETS.find((entry) => entry.id === member.preset) : undefined;
  if (preset) Object.assign(element, presetFields(element as Json, preset));
  for (const [key, value] of Object.entries(member.style ?? {})) element[key] = value !== null && typeof value === "object" ? { ...(element[key] as object), ...value } : value;
  if (member.bubble) {
    const bubble = TEXT_BUBBLES.find((entry) => entry.id === member.bubble!.id)!;
    element.bubble = { id: bubble.id, color: member.bubble.color ?? bubble.color, strokeColor: bubble.strokeColor, strokeWidth: bubble.strokeWidth, flipHorizontal: false };
  }
  let animation: Json | undefined;
  for (const group of ["in", "out", "loop"] as const) {
    const slot = member[group];
    if (slot) animation = clampTextAnimation(length, animation, group, group === "loop" ? { id: slot[0], period: ticks(slot[1]) } : { id: slot[0], duration: ticks(slot[1]) });
  }
  if (animation) element.textAnimation = animation;
  writeKeys(element, member.keyframes, (_path, value) => value, snap, env);
  return element;
}

/** A shape is 200 × 200 px at scale 1: its size in % of the canvas becomes its scale. */
function buildShape(member: TemplateShape, start: number, duration: number, canvas: { width: number; height: number }, snap: (time: number) => number, env: CommandEnv): El {
  const from = member.from ? snap(ticks(member.from)) : 0, length = Math.max(snap(1), snap(ticks(member.to ?? duration / SECOND)) - from);
  const sx = ((member.size[0] / 100) * (member.square ? canvas.height : canvas.width)) / 200, sy = ((member.size[1] / 100) * canvas.height) / 200;
  const element = createElement("graphic", {
    id: env.newId(), name: "Shape", startTime: start + from, duration: length, definitionId: member.definitionId, params: member.params,
    transform: { position: { x: (member.position[0] / 100) * canvas.width, y: (member.position[1] / 100) * canvas.height }, scale: { x: sx, y: sy }, rotation: member.rotation ?? 0 },
  }) as unknown as El;
  writeKeys(element, member.keyframes, (path, value) => {
    if (path === "transform.scale.x") return Math.max(0.01, value * sx);
    if (path === "transform.scale.y") return Math.max(0.01, value * sy);
    if (path === "transform.position.x") return (value / 100) * canvas.width;
    if (path === "transform.position.y") return (value / 100) * canvas.height;
    return value;
  }, snap, env);
  return element;
}

/** The elements of a template at a start time, back to front as the catalogue lists them, sharing one new `groupId`. */
export function buildTextTemplate(doc: ProjectDocument, template: TextTemplate, start: number, env: CommandEnv, firstContent?: string): El[] {
  const canvas = doc.settings.canvasSize, groupId = env.newId(), duration = ticks(template.duration);
  // A member that starts a fraction of a frame into the group starts on the nearest frame (at least one frame long).
  const fps = fpsOf(doc), snap = (time: number) => (time <= 1 ? frameTicks(fps) : snapToFrame(time, fps));
  let firstText = true;
  return template.members.map((member) => {
    const element = member.kind === "text" ? buildText(member, start, duration, canvas, snap, env, firstText ? firstContent : undefined) : buildShape(member, start, duration, canvas, snap, env);
    if (member.kind === "text") firstText = false;
    element.groupId = groupId;
    return element;
  });
}

function placeGroup(scene: Sc, elements: El[], env: CommandEnv): void {
  // The members are listed back to front. The first takes the first track of its type that is free for its range; every
  // later one goes above the one before it — on the nearest free track of its type there, else on a new track right above.
  let below: string | null = null;
  for (const element of elements) {
    if (below === null) { below = placeElements(scene, [element], { strategy: "firstAvailable" }, env).track.id; continue; }
    const floor = scene.tracks.overlay.findIndex((track) => track.id === below);
    const free = (track: (typeof scene.tracks.overlay)[number]) => canHold(track, element.type) && !track.locked && track.elements.every((other) => endOf(other) <= element.startTime || other.startTime >= endOf(element));
    let target = floor < 0 ? undefined : scene.tracks.overlay.slice(0, floor).reverse().find(free);
    if (!target) target = createTrackAt(scene, TRACK_FOR_ELEMENT[element.type] as never, Math.max(0, floor), env.newId) as (typeof scene.tracks.overlay)[number];
    target.elements.push(element);
    below = target.id;
  }
}
const templateById = (id: string): TextTemplate => TEXT_TEMPLATES.find((template) => template.id === id) ?? refuse("This template is not available", "unknown-template");

/** Adds a text template at a time as grouped elements, one undo step. */
export function addTextTemplate(options: { sceneId: string; templateId: string; time: number }): TimelineCommand<{ elementIds: string[]; groupId: string }> {
  return {
    type: "text.template.add", label: "Add text template", sceneId: options.sceneId,
    run(draft, env) {
      const elements = buildTextTemplate(draft, templateById(options.templateId), snapToFrame(Math.max(0, options.time), fpsOf(draft)), env);
      placeGroup(sceneById(draft, options.sceneId), elements, env);
      return { selection: elements.map((element) => element.id), info: { elementIds: elements.map((element) => element.id), groupId: String(elements[0].groupId) } };
    },
  };
}

/** The Templates sub-tab: the selected text is replaced by the template group at the same start, its content carried into the first text. */
export function replaceTextWithTemplate(options: { sceneId: string; elementId: string; templateId: string }): TimelineCommand<{ elementIds: string[] }> {
  return {
    type: "text.template.replace", label: "Apply text template", sceneId: options.sceneId,
    run(draft, env) {
      const scene = sceneById(draft, options.sceneId);
      const track = [...scene.tracks.overlay, scene.tracks.main, ...scene.tracks.audio].find((entry) => entry.elements.some((element) => element.id === options.elementId)) ?? refuse("Select a text clip", "disabled");
      const source = track.elements.find((element) => element.id === options.elementId)!;
      if (source.type !== "text") refuse("Select a text clip", "disabled");
      track.elements = track.elements.filter((element) => element !== source);
      const elements = buildTextTemplate(draft, templateById(options.templateId), source.startTime, env, String(source.content ?? ""));
      placeGroup(scene, elements, env);
      return { selection: elements.map((element) => element.id), info: { elementIds: elements.map((element) => element.id) } };
    },
  };
}

/**
 * Trims a template group as a unit. Every member that ended at the group end ends at the new end (a member that ends
 * earlier keeps its timing unless the new end cuts it), and likewise at the start; in and out animations stay
 * anchored to each member's own start and end, shortened only when the member becomes shorter than they are.
 */
export function trimGroup(options: { sceneId: string; groupId: string; start?: number; end?: number }): TimelineCommand {
  return {
    type: "timeline.group.trim", label: "Trim", sceneId: options.sceneId,
    run(draft) {
      const members = elementsOfScene(sceneById(draft, options.sceneId)).filter((element) => element.groupId === options.groupId);
      if (members.length === 0) refuse("Select a clip first", "disabled");
      const fps = fpsOf(draft), groupStart = Math.min(...members.map((element) => element.startTime)), groupEnd = Math.max(...members.map(endOf));
      const start = options.start === undefined ? groupStart : snapToFrame(options.start, fps), end = options.end === undefined ? groupEnd : snapToFrame(options.end, fps);
      if (end <= start) refuse("The group cannot be trimmed to nothing", "disabled");
      for (const element of members) {
        let from = element.startTime, to = endOf(element);
        if (from === groupStart || from < start) from = Math.min(start, to);
        if (to === groupEnd || to > end) to = end;
        from = Math.max(from, start);
        if (to <= from) refuse("A clip of the group would be trimmed to nothing", "disabled");
        // Keyframes are authored from the element start: a later start shifts none of them.
        element.startTime = from;
        element.duration = to - from;
        const animation = element.textAnimation as Json | undefined;
        if (animation) {
          const inSlot = animation.in as Json | undefined, outSlot = animation.out as Json | undefined;
          if (inSlot && Number(inSlot.duration) > element.duration) inSlot.duration = element.duration;
          if (outSlot && Number(inSlot?.duration ?? 0) + Number(outSlot.duration) > element.duration) outSlot.duration = Math.max(0, element.duration - Number(inSlot?.duration ?? 0));
        }
      }
    },
  };
}
