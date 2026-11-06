/** "One prompt → video": the parameters of the template, its style and parameter presets, and the rules of its input. */
export const TEMPLATE_ID = "tpl.one-prompt-video";
export const TICKS = 120_000;

export const ASPECT_RATIOS = ["16:9", "9:16", "1:1", "4:5", "4:3", "3:4", "21:9"] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];
export const RESOLUTIONS = ["720p", "1080p", "2160p"] as const;
export const FRAME_RATES = [24, 25, 30, 60] as const;
export const MUSIC_MOODS = ["none", "auto", "calm", "upbeat", "dramatic", "corporate", "playful", "dark", "epic", "romantic"] as const;
/** Who decides the checkpoints of a run: a person at each of them, or nobody (every checkpoint approves itself). */
export const RUN_MODES = ["checkpoints", "auto"] as const;

/** The style presets, in the order the style select lists them. Descriptors go to models in English. */
export const STYLE_PRESETS = [
  { id: "cinematic", label: "Cinematic", descriptor: "Natural light, shallow depth of field, restrained colour with warm highlights and cool shadows, slow deliberate camera moves, wide establishing frames followed by close details." },
  { id: "clean-product", label: "Clean product", descriptor: "Seamless light backdrop, soft even lighting, crisp edges, slow rotations and push-ins on the product, generous empty space for on-screen text." },
  { id: "documentary", label: "Documentary", descriptor: "Hand-held observational framing, available light, muted natural colour, real locations, cutaways to hands and details." },
  { id: "bold-social", label: "Bold social", descriptor: "High contrast, saturated accent colour, fast cuts every 1–2 s, large centred on-screen text, vertical framing with the subject in the upper two thirds." },
  { id: "flat-illustration", label: "Flat illustration", descriptor: "Two-dimensional vector look, flat fills, limited palette of four colours, simple geometric characters, smooth eased motion." },
  { id: "hand-drawn", label: "Hand-drawn", descriptor: "Pencil and ink line work on paper texture, loose cross-hatching, slight line wobble between frames, sparse colour washes." },
  { id: "3d-render", label: "3D render", descriptor: "Soft global illumination, rounded stylised forms, clean materials, gentle orbiting camera, shallow depth of field." },
  { id: "retro-film", label: "Retro film", descriptor: "Warm faded colour, visible grain, soft halation around highlights, 4:3-style centred compositions, slow zooms." },
  { id: "noir", label: "Noir", descriptor: "Black and white, hard side light, deep shadows, wet reflective surfaces, static low-angle frames." },
  { id: "minimal-type", label: "Minimal type", descriptor: "Solid colour backgrounds, large typography as the main visual, one accent colour, text reveals in time with narration." },
] as const;
export type StylePresetId = (typeof STYLE_PRESETS)[number]["id"];

export type VideoParams = {
  prompt: string; targetDuration_s: number; aspectRatio: AspectRatio; resolution: (typeof RESOLUTIONS)[number]; frameRate: (typeof FRAME_RATES)[number];
  language: string; style: string; voice: string; musicMood: (typeof MUSIC_MOODS)[number]; captions: boolean; mode: (typeof RUN_MODES)[number];
  /** The chat model that writes the brief, the script and the shot list; without one the host's route of the director role is used. */
  model?: WriterModel | null;
  /** A person's own script: it is spoken as written (nothing writes it again), and the video lasts as long as it reads. */
  script?: string;
  /** Captions in a second language, translated from the script by the Translation role of Model routing. */
  secondCaptionLanguage?: string | null;
  /** What this run may spend on generation: a job that would pass it is refused and the run stops there. */
  budgetUsd?: number | null;
};
export type WriterModel = { runtimeId: string; providerId: string; modelId: string };
export const DEFAULT_PARAMS: VideoParams = { prompt: "", targetDuration_s: 30, aspectRatio: "9:16", resolution: "1080p", frameRate: 30, language: "en", style: "auto", voice: "auto", musicMood: "auto", captions: true, mode: "checkpoints" };

/** The four parameter presets: each sets only what it lists. */
export const PARAM_PRESETS: readonly { id: string; label: string; set: Partial<VideoParams> }[] = [
  { id: "short-social", label: "Short social video", set: { targetDuration_s: 20, aspectRatio: "9:16", style: "bold-social", voice: "auto", musicMood: "upbeat" } },
  { id: "product-ad", label: "Product advertisement", set: { targetDuration_s: 30, aspectRatio: "1:1", style: "clean-product", voice: "auto", musicMood: "corporate" } },
  { id: "explainer", label: "Explainer", set: { targetDuration_s: 90, aspectRatio: "16:9", style: "flat-illustration", voice: "auto", musicMood: "calm" } },
  { id: "story", label: "Story", set: { targetDuration_s: 60, aspectRatio: "16:9", style: "cinematic", voice: "auto", musicMood: "dramatic" } },
];

export const PROMPT_MAX = 4000;
export const SCRIPT_MAX = 20_000;
export type InputProblem = { field: keyof VideoParams; message: string };
/** The rules the form checks under each field and the host checks again before a run starts. */
export function checkInput(params: VideoParams): InputProblem[] {
  const problems: InputProblem[] = [];
  const prompt = params.prompt.trim();
  const script = params.script?.trim() ?? "";
  if (!prompt && !script) problems.push({ field: "prompt", message: "Write a prompt or choose a script" });
  if (script.length > SCRIPT_MAX) problems.push({ field: "script", message: "Script must be 20,000 characters or fewer" });
  if (params.secondCaptionLanguage && params.secondCaptionLanguage === params.language) problems.push({ field: "secondCaptionLanguage", message: "Choose a language other than the video's own" });
  if (params.budgetUsd !== undefined && params.budgetUsd !== null && !(params.budgetUsd >= 0.01 && params.budgetUsd <= 100_000)) problems.push({ field: "budgetUsd", message: "Budget must be between $0.01 and $100,000" });
  if (prompt.length > PROMPT_MAX) problems.push({ field: "prompt", message: "Prompt must be 4,000 characters or fewer" });
  if (!Number.isInteger(params.targetDuration_s) || params.targetDuration_s < 5 || params.targetDuration_s > 600) problems.push({ field: "targetDuration_s", message: "Duration must be between 5 and 600 seconds" });
  const style = params.style.trim();
  if (!style || style.length > 500) problems.push({ field: "style", message: "Describe the style in 1 to 500 characters" });
  return problems;
}

/** The descriptor a style value stands for: a preset's text, the custom text itself, or nothing for `auto`. */
export const styleDescriptor = (style: string): string => (style === "auto" ? "" : STYLE_PRESETS.find((preset) => preset.id === style)?.descriptor ?? style);
export const narrated = (params: Pick<VideoParams, "voice">): boolean => params.voice !== "none";
/** The shot count a run is estimated with before its shot list exists: one shot every 4 s. */
export const assumedShots = (targetDuration_s: number): number => Math.ceil(targetDuration_s / 4);
/** What the script is written to: the run's duration less the room the voiceover step adds around the takes, never below 60 %. */
export const speechTarget_s = (params: Pick<VideoParams, "voice" | "targetDuration_s">): number =>
  narrated(params) ? Math.max(params.targetDuration_s * 0.6, params.targetDuration_s - 0.4 * assumedShots(params.targetDuration_s)) : params.targetDuration_s;
/** The window a run's duration must end in: ±10 % or ±2 s, whichever is larger. */
export const durationWindow = (targetDuration_s: number): { min: number; max: number } => { const room = Math.max(2, targetDuration_s * 0.1); return { min: targetDuration_s - room, max: targetDuration_s + room }; };

const SHORT_EDGE = { "720p": 720, "1080p": 1080, "2160p": 2160 } as const;
/** The canvas of an aspect ratio at a short edge, both sides even. */
export function canvasOf(aspectRatio: AspectRatio, resolution: (typeof RESOLUTIONS)[number]): { width: number; height: number } {
  const [w, h] = aspectRatio.split(":").map(Number), short = SHORT_EDGE[resolution];
  const even = (value: number) => Math.round(value / 2) * 2;
  return w >= h ? { width: even((short * w) / h), height: short } : { width: short, height: even((short * h) / w) };
}
/** The aspect ratio an image model is asked for: the nearest one image models offer. */
export const imageAspect = (aspectRatio: AspectRatio): string => (aspectRatio === "4:5" ? "3:4" : aspectRatio === "21:9" ? "16:9" : aspectRatio);
