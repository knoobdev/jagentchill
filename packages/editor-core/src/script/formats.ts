import type { ScriptAspectRatio, ScriptConstraints, ScriptDocument, ScriptMeta } from "@jagentchill/protocol";
import { contentOf } from "./commands.ts";
import { clone, createScript, newBeat, newScene, type NewScriptOptions, type ScriptIds } from "./model.ts";

/**
 * `script-studio.Format templates`: project-authored, usable offline. A format supplies structure and guidance — the
 * guidance is a beat's `intent`, never script content, so a new script contains no filler lines.
 */
export type FormatBeat = { label: string; intent: string };
export type FormatScene = { title: string; setting?: "INT" | "EXT" | "INT_EXT" | "NONE"; beats: FormatBeat[] };
export type ScriptFormat = {
  id: string; name: string; description: string; aspectRatio: ScriptAspectRatio | null; targetDuration_s: number | null; scenes: FormatScene[];
  meta?: Partial<ScriptMeta>; constraints?: ScriptConstraints; personal?: boolean;
};
const beat = (label: string, intent: string): FormatBeat => ({ label, intent });
export const SCRIPT_FORMATS: readonly ScriptFormat[] = [
  { id: "blank", name: "Blank", description: "An empty script", aspectRatio: "9:16", targetDuration_s: null, scenes: [{ title: "", beats: [beat("", "")] }] },
  {
    id: "short-form", name: "Short-form vertical video", description: "9:16, 30 seconds, narration-led", aspectRatio: "9:16", targetDuration_s: 30,
    scenes: [{ title: "", beats: [beat("Hook", "0–3 s: stop the scroll with one surprising line and matching on-screen text."), beat("Setup", "Say what this is about and why it matters to the viewer."), beat("Payoff", "Deliver the promise of the hook."), beat("Call to action", "One clear next step, spoken and on screen.")] }],
  },
  {
    id: "explainer", name: "Explainer", description: "16:9, 90 seconds, problem to next step", aspectRatio: "16:9", targetDuration_s: 90,
    scenes: [
      { title: "Problem", beats: [beat("Problem", "Name the problem in the viewer's words.")] }, { title: "Why it matters", beats: [beat("Why it matters", "What it costs to leave the problem unsolved.")] },
      { title: "How it works", beats: [beat("Step 1", "The first step, in one idea."), beat("Step 2", "The second step."), beat("Step 3", "The third step.")] },
      { title: "Recap", beats: [beat("Recap", "The three steps in one breath.")] }, { title: "Next step", beats: [beat("Next step", "What to do now.")] },
    ],
  },
  {
    id: "advertisement", name: "Advertisement", description: "16:9 or 9:16, 30 seconds, attention to call to action", aspectRatio: "16:9", targetDuration_s: 30,
    scenes: [{ title: "", beats: [beat("Attention", "An image or line that earns the first two seconds."), beat("Problem", "The situation the audience recognises."), beat("Product", "Show the product solving it."), beat("Proof", "A fact, a result or a testimonial."), beat("Offer", "What the viewer gets, and until when."), beat("Call to action", "Where to go and what to do. Add the legal line if one is required.")] }],
  },
  {
    id: "vlog", name: "Vlog", description: "16:9, 5 minutes, talking points", aspectRatio: "16:9", targetDuration_s: 300,
    scenes: [
      { title: "Cold open", beats: [beat("Cold open", "The best moment of the video, before any introduction.")] }, { title: "Intro", beats: [beat("Intro", "Who you are and what happens today. Talking points, not fixed dialogue.")] },
      { title: "Segment 1", beats: [beat("Segment 1", "Talking points for the first part.")] }, { title: "Segment 2", beats: [beat("Segment 2", "Talking points for the second part.")] },
      { title: "Segment 3", beats: [beat("Segment 3", "Talking points for the third part.")] }, { title: "Outro", beats: [beat("Outro", "Wrap up and say what comes next.")] },
    ],
  },
  {
    id: "short-drama", name: "Short drama episode", description: "9:16, 2 minutes, full screenplay formatting", aspectRatio: "9:16", targetDuration_s: 120,
    scenes: [
      { title: "Teaser", setting: "INT", beats: [beat("Teaser", "Open on the conflict of this episode.")] }, { title: "Act 1", setting: "INT", beats: [beat("Act 1", "Establish what the lead wants and what stands in the way.")] },
      { title: "Turn", setting: "INT", beats: [beat("Turn", "Something changes the plan.")] }, { title: "Act 2", setting: "INT", beats: [beat("Act 2", "The lead acts on the new situation.")] },
      { title: "Cliffhanger", setting: "INT", beats: [beat("Cliffhanger", "End on a question the next episode answers.")] },
    ],
  },
  {
    id: "tutorial", name: "Tutorial", description: "16:9, 3 minutes, result first", aspectRatio: "16:9", targetDuration_s: 180,
    scenes: [
      { title: "Result first", beats: [beat("Result first", "Show the finished result before explaining anything.")] }, { title: "Materials", beats: [beat("Materials", "Everything needed, in the order it is used.")] },
      { title: "Steps", beats: [beat("Steps", "One step per line, each with what to watch for.")] }, { title: "Common mistakes", beats: [beat("Common mistakes", "What goes wrong most often and how to recover.")] },
      { title: "Wrap-up", beats: [beat("Wrap-up", "Repeat the result and suggest a next project.")] },
    ],
  },
  { id: "narrated-story", name: "Narrated story", description: "Any ratio, 60 seconds, narration with a shot per sentence", aspectRatio: null, targetDuration_s: 60, scenes: [{ title: "", beats: [beat("Beginning", "Who, where and what they want."), beat("Middle", "What gets in the way."), beat("End", "How it resolves, and the image to end on.")] }] },
];
export const formatById = (id: string, personal: readonly ScriptFormat[] = []): ScriptFormat | undefined => [...SCRIPT_FORMATS, ...personal].find((format) => format.id === id);

/** A new script from a format: its metadata, structure and beat guidance, and no line at all. */
export function createFromFormat(format: ScriptFormat, options: NewScriptOptions): ScriptDocument {
  const document = createScript({ ...options, formatId: format.id, aspectRatio: format.aspectRatio ?? options.aspectRatio });
  if (format.targetDuration_s !== null) document.meta.targetDuration_s = format.targetDuration_s;
  // Language, format and ratio stay the new script's own; everything else a personal format carries is taken over.
  if (format.meta) { const { language: _language, formatId: _formatId, aspectRatio: _ratio, targetDuration_s: _target, ...rest } = format.meta; Object.assign(document.meta, clone(rest)); }
  if (format.constraints) document.constraints = clone(format.constraints);
  document.scenes = format.scenes.map((scene) => newScene(options.ids, { title: scene.title, heading: { setting: scene.setting ?? "NONE", locationText: "", timeOfDay: "" }, beats: scene.beats.map((entry) => newBeat(options.ids, entry.label, entry.intent)) }));
  return document;
}
/** "Save as format": acts are flattened into scenes' order; headings, beat labels and intents, metadata and constraints are kept; every line and shot is removed. */
export function formatFromScript(document: ScriptDocument, ids: ScriptIds, name: string): ScriptFormat {
  const content = contentOf(document);
  return {
    id: `personal-${ids()}`, name: name.trim().slice(0, 80) || document.title, description: "", aspectRatio: content.meta.aspectRatio, targetDuration_s: content.meta.targetDuration_s ?? null, personal: true,
    meta: content.meta, ...(content.constraints ? { constraints: content.constraints } : {}),
    scenes: content.scenes.map((scene) => ({ title: scene.title, setting: scene.heading.setting, beats: scene.beats.map((entry) => ({ label: entry.label, intent: entry.intent })) })),
  };
}
