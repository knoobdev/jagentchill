import { readingSeconds } from "../script/estimate.ts";
import { TICKS } from "../prompt-video/params.ts";
import { LIMITS, type Breakdown } from "./model.ts";
import { storyQuotes } from "./speech-check.ts";

/**
 * THE PLAN OF A FILM, told from its STORY alone — before any model has read it. A whole run ("Make the film") is
 * quoted by it when the script does not exist yet, so a person is asked about money ONCE, up front; and it is BINDING
 * on whoever writes the script (`PROMPTS.breakdown` states it, `planProblems` enforces it), so the quote is a bound
 * and not a forecast. Deterministic: the same story gives the same plan.
 *
 * The derivation uses the story's own structure and the film's existing limits — no tempo, no ratio:
 *
 *  LINES. The script's lines ARE the story's sentences (the breakdown contract: every sentence the story quotes is a
 *    line with exactly the story's words; everything else is carried by the Narrator "in the story's own sentences").
 *    So a script needs no more lines than the story has sentences — counted as the story is spoken, in ITS writing
 *    system (`storySentences`): cut at its quoted lines (`storyQuotes`), at its sentence marks — those of scripts that
 *    put a space after them (. ! ? … ؟ ۔ । ॥ ։) where a space follows, those of scripts that do not (。！？｡ ። ។ ။)
 *    wherever they stand —, at its line breaks (a verse), and, in a script written with no spaces between words (Thai,
 *    Lao, Khmer, Myanmar), at its spaces, which are that script's phrase breaks. A sentence longer than one line can
 *    hold (`LIMITS.lineText` characters) needs a line for each such stretch, whatever the script; and a panel lasts at
 *    most `LIMITS.panelMax_ticks`, so the story's reading time ÷ that are lines it cannot do without either. Never
 *    more than `LIMITS.lines`.
 *  FRAMES. A frame shows what a line says, and the contract gives every panel at least one line (several lines may
 *    share a frame): frames ≤ lines. Never more than `LIMITS.panels`.
 *  SHEETS. A sheet (a character, a place, a prop) is drawn to be SHOWN in a frame. The bound is what the frames can
 *    show by the contract's own caps: a frame stands in ONE place and shows at most `PANEL_CAST_MAX` characters and as
 *    many props, and the script lists at most `SHEETS_PER_KIND` of each kind (`sheetsShown`). For any story of more
 *    than a few sentences that is the CEILING 3 × `SHEETS_PER_KIND` — a ceiling, NOT a count taken from the story:
 *    nothing in a story's text bounds what its film shows in every language (capital letters mark names in some
 *    scripts and nothing does in others — and a film shows people and places its story never names: "Dusk." is a
 *    street with somebody in it), so no such count is guessed. The screens say "at most".
 *    (How many sheets ONE frame can be drawn WITH — `PANEL_REFERENCES_MAX` reference pictures — is not a bound on how
 *    many sheets a story needs: a one-sentence story that names six people needs their six sheets and the place's.)
 *    Never more than `LIMITS.assets`.
 *  SPOKEN CHARACTERS. Every line is at most `LIMITS.lineText` characters: lines × that.
 */
export type UpperPlan = { assets: number; panels: number; lines: number; /** The characters all the lines have together, at most. */ spokenCharacters: number; /** The reading time of the story (shown; the plan does not come from it, except as the floor above). */ seconds: number; /** The story's sentences, as they are spoken: what the lines were counted from. */ sentences: number };
/** The most characters, places and props a breakdown lists of each (the contract's own caps, `normaliseBreakdown`). */
export const SHEETS_PER_KIND = 12;
/** The most characters — and the most props — ONE panel shows (the contract's own cap, `normaliseBreakdown` and the panel's fields). */
export const PANEL_CAST_MAX = 8;

/** A letter of a script that is written with no spaces between its words (a sentence mark of another script that such a letter follows directly ends its sentence all the same). */
const UNSPACED = String.raw`\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}`;
/** A script written without spaces between words that marks no sentence end either: its spaces are its phrase breaks. */
const PHRASED = String.raw`\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}`;
const CLOSERS = String.raw`"”»」』）)\]'’`;
/**
 * Where prose is cut into the pieces it is spoken in: after a sentence mark that its script follows with a space,
 * where a space (or a letter of a script written without spaces) follows; after a sentence mark of a script that puts
 * no space after it, wherever it stands (but not inside a run of marks or before what closes a quotation); at a space
 * between two letters of a script whose spaces are its phrase breaks; at every line break.
 */
const CUT = new RegExp([
  String.raw`(?<=[.!?…؟۔।॥։][${CLOSERS}]*)(?:\s+|(?=[${UNSPACED}]))`,
  String.raw`(?<=[。！？｡።។။][${CLOSERS}]*)(?![。！？｡።។။…${CLOSERS}])\s*`,
  String.raw`(?<=[${PHRASED}])[^\S\n]+(?=[${PHRASED}])`,
  String.raw`\n+`,
].join("|"), "u");

/** The story as it is spoken, piece by piece: its quoted lines, and the sentences around them. */
export function storySentences(story: string): string[] {
  const text = story.replace(/\r\n/g, "\n").trim(), quoted = storyQuotes(text), out: string[] = [];
  // A piece counts when it has a letter or a digit.
  const prose = (stretch: string): void => { for (const piece of stretch.split(CUT)) if (piece && /[\p{L}\p{N}]/u.test(piece)) out.push(piece.trim()); };
  let from = 0, next = 0;
  // The quotes the story's lines are (`storyQuotes`, in order) are found again where they stand; a quoted name or word that is not a line stays in its sentence.
  for (const match of text.matchAll(/"([^"\n]{1,400})"|“([^”\n]{1,400})”|«([^»\n]{1,400})»|「([^」\n]{1,400})」/gu)) {
    const said = (match[1] ?? match[2] ?? match[3] ?? match[4] ?? "").trim().replace(/[,，]$/u, "");
    if (next >= quoted.length || said !== quoted[next]) continue;
    next++;
    prose(text.slice(from, match.index ?? 0));
    // A quote of several sentences may be spoken as consecutive lines of its speaker: each sentence counts.
    const before = out.length;
    prose(said);
    if (out.length === before) out.push(said);
    from = (match.index ?? 0) + match[0].length;
  }
  prose(text.slice(from));
  return out;
}

/** The most sheets a script of `panels` frames can SHOW, by the contract's caps: one place a frame, `PANEL_CAST_MAX` characters and as many props a frame, `SHEETS_PER_KIND` of each kind in all. */
export const sheetsShown = (panels: number): number => 2 * Math.min(SHEETS_PER_KIND, panels * PANEL_CAST_MAX) + Math.min(SHEETS_PER_KIND, panels);

export function upperPlan(story: string, language: string): UpperPlan {
  const text = story.trim(), seconds = Math.max(1, readingSeconds(text, language)), pieces = storySentences(text), sentences = Math.max(1, pieces.length);
  // A piece longer than a line can hold is spoken as several lines.
  const spoken = Math.max(1, pieces.reduce((sum, piece) => sum + Math.ceil(piece.length / LIMITS.lineText), 0));
  const lines = Math.min(LIMITS.lines, Math.max(spoken, Math.ceil(seconds / (LIMITS.panelMax_ticks / TICKS))));
  const panels = Math.min(LIMITS.panels, lines);
  return { assets: Math.min(LIMITS.assets, sheetsShown(panels)), panels, lines, spokenCharacters: lines * LIMITS.lineText, seconds: Math.round(seconds * 100) / 100, sentences };
}

/** The sentence that states the plan to the model that writes the script. */
export const planWords = (plan: Pick<UpperPlan, "assets" | "panels" | "lines">): string =>
  `LIMITS of this film — it was priced by them, and a plan over any of them is NOT accepted (fewer is fine): at most ${plan.panels} panels in all, at most ${plan.lines} lines in all, and at most ${plan.assets} characters, locations and props together. Several lines may share a panel; give a sentence of the story one line.`;

/**
 * Where a script is over the plan its film was quoted by, as sentences the writing model is sent back (empty: it is
 * inside). The sheets are held by the SAME derivation as the plan's, applied to the script's own frames: no more than
 * the plan allows, and no more than the frames it really has can show.
 */
export function planProblems(breakdown: Pick<Breakdown, "characters" | "locations" | "props" | "panels" | "lines">, plan: Pick<UpperPlan, "assets" | "panels" | "lines">): string[] {
  const sheets = breakdown.characters.length + breakdown.locations.length + breakdown.props.length, problems: string[] = [];
  if (breakdown.panels.length > plan.panels) problems.push(`the plan has ${breakdown.panels.length} panels; this film takes at most ${plan.panels} — let consecutive moments share a panel`);
  if (breakdown.lines.length > plan.lines) problems.push(`the plan has ${breakdown.lines.length} lines; this film takes at most ${plan.lines} (one for each sentence of the story) — join lines of the same speaker that follow each other`);
  const most = Math.min(plan.assets, sheetsShown(Math.max(1, breakdown.panels.length)));
  if (sheets > most) problems.push(`the plan lists ${sheets} characters, locations and props together; ${most < plan.assets ? `its ${breakdown.panels.length} ${breakdown.panels.length === 1 ? "panel" : "panels"} can show at most ${most}` : `this film takes at most ${most}`} — keep only the ones the panels show`);
  return problems;
}
