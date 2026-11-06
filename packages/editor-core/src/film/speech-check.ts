/**
 * Is a recording the line it was made from? Two measurable checks, with no judgement of how it sounds:
 * the words a listener (a transcription model) wrote back against the words of the line, and the length of the
 * recording against the length of the text. A take that fails either is made again; one that still fails is kept,
 * marked, and named to the person — never passed off as good.
 */
export type SpeechCheck = { ok: boolean; /** 0–1: the share of the line's words heard in order. */ score: number; heard: string; seconds: number; /** The pitch of the voice in this take (Hz), when it was measured. */ pitchHz?: number; reason?: "words" | "too_long" | "too_short" | "silent" | /** The voice is far from the speaker's other lines: it sounds like someone else. */ "voice" };

/** The words of a text as they are compared: lower case, no punctuation; marks on letters are kept (they are the word in Vietnamese). */
export const spokenWords = (text: string): string[] => text.normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, " ").split(/\s+/).filter(Boolean);

/** The share of `expected`'s words that `heard` has in the same order (word-level edit distance). */
export function speechMatch(expected: string, heard: string): number {
  const a = spokenWords(expected), b = spokenWords(heard);
  if (!a.length) return b.length ? 0 : 1;
  let row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return Math.max(0, 1 - row[b.length] / Math.max(a.length, b.length));
}

/** Words heard at least this well count as the line. One word in five may differ: a listener mishears names and particles. */
export const SPEECH_MATCH_MIN = 0.8;
/** People speak about 2–4 words a second; a recording outside 1–9 words a second (plus a second of room) is not a reading of the line. */
export function speechLengthProblem(text: string, seconds: number): "too_long" | "too_short" | "silent" | undefined {
  const words = spokenWords(text).length;
  if (seconds <= 0.15) return "silent";
  if (!words) return undefined;
  if (seconds > words / 1 + 1.5) return "too_long";
  if (seconds < words / 9 - 0.2) return "too_short";
  return undefined;
}
/** The verdict on one take that a listener wrote back: its words against the line's, and its length. */
export function checkSpeech(text: string, seconds: number, heard: string): SpeechCheck {
  const length = speechLengthProblem(text, seconds), score = speechMatch(text, heard);
  const reason = length ?? (score < SPEECH_MATCH_MIN ? "words" as const : undefined);
  return { ok: !reason, score: Math.round(score * 100) / 100, heard: heard.slice(0, 600), seconds: Math.round(seconds * 100) / 100, ...(reason ? { reason } : {}) };
}
/**
 * A take NOBODY listened to (no transcription model, or it failed). Its length is still measurable: a recording that
 * cannot be a reading of the line fails (score 0 — no word was heard). Otherwise there is NO verdict: undefined, and the
 * take is kept as unchecked (`Take.unchecked`) — never as "ok, score 1".
 */
export function checkUnheard(text: string, seconds: number): SpeechCheck | undefined {
  const reason = speechLengthProblem(text, seconds);
  return reason ? { ok: false, score: 0, heard: "", seconds: Math.round(seconds * 100) / 100, reason } : undefined;
}
/** Why a take has no verdict: there is no listener on this host, or the listener could not be asked. */
export type Unchecked = { seconds: number; why: "no_listener" | "listener_failed" };

/**
 * What the people of a story say in it: the text between quotation marks ("…", “…”, «…», 「…」), in order, each with
 * the one character the story names beside it (in the same sentence, outside the quote) when there is exactly one.
 * A script made from the story must speak these words, not words of its own — a model left free rewrote the lines of
 * a real story and gave them to the wrong person. A short quote is a line too ("Dạ!", "Về thôi,") when it is said as a
 * sentence: it ends in a sentence mark or a comma. A quoted name or word (they call her "bà Tư") is not.
 */
/** Words that say a sentence is about someone speaking (a few languages; a story in another one is attributed only by lead-ins and unfinished quotes). */
const SPEECH_VERBS = /\b(said|says|asked|asks|replied|answered|whispered|shouted|cried|muttered|murmured|told)\b|(^|\s)(nói|hỏi|đáp|bảo|thì thầm|trả lời|la lên|thốt)(\s|$)|言|尋ね|答え|叫/iu;
export type StoryQuote = { text: string; /** The character the story gives the line to, when it names exactly one beside it. */ speaker?: string };
export function quotesOf(story: string, characterNames: readonly string[] = []): StoryQuote[] {
  const out: StoryQuote[] = [];
  for (const match of story.matchAll(/"([^"\n]{1,400})"|“([^”\n]{1,400})”|«([^»\n]{1,400})»|「([^」\n]{1,400})」/gu)) {
    const raw = (match[1] ?? match[2] ?? match[3] ?? match[4] ?? "").trim(), said = raw.replace(/[,，]$/u, ""), count = spokenWords(said).length;
    if (!count) continue;
    // Who says it, from the sentence around the quote: what leads into it ("Bà Tư cười: “…”"); what follows a quote
    // that does not end its sentence ("…," Bin nói.); and, after a quote that does end with a sentence mark, what
    // follows only when it is about speaking ("…?" Minh asked.) — the next sentence may be about someone else.
    const at = match.index ?? 0, before = story.slice(Math.max(0, at - 160), at), after = story.slice(at + match[0].length, at + match[0].length + 160);
    const lead = before.slice(Math.max(before.lastIndexOf("."), before.lastIndexOf("!"), before.lastIndexOf("?"), before.lastIndexOf("”"), before.lastIndexOf('"'), before.lastIndexOf("\n")) + 1);
    const tail = after.slice(0, (() => { const end = after.search(/[.!?\n“"«「]/u); return end < 0 ? after.length : end; })());
    const ended = /[.!?…。！？]$/u.test(raw), led = /[:,，：]\s*$/u.test(lead);
    // One or two quoted words are a line when they are SAID: punctuated as a sentence ("Dạ!"), led into (Mary said:
    // “Go”) or followed by a speech verb (“Go” said Mary). A quoted name or word in running prose (they call her "bà Tư") is not.
    if (count < 3 && !/[.!?…。！？,，]$/u.test(raw) && !led && !SPEECH_VERBS.test(lead) && !SPEECH_VERBS.test(tail)) continue;
    const around = `${lead} ${led && ended ? "" : !ended || SPEECH_VERBS.test(tail) ? tail : ""}`.toLowerCase();
    const named = characterNames.filter((name) => name.trim() && around.includes(name.trim().toLowerCase()));
    out.push({ text: said, ...(named.length === 1 ? { speaker: named[0] } : {}) });
  }
  return out;
}
export const storyQuotes = (story: string): string[] => quotesOf(story).map((quote) => quote.text);

/** Whether `words` appear in `inside` one after the other with nothing between them. */
function contiguous(words: readonly string[], inside: readonly string[]): boolean {
  if (!words.length) return true;
  for (let start = 0; start + words.length <= inside.length; start++) { let at = 0; while (at < words.length && inside[start + at] === words[at]) at++; if (at === words.length) return true; }
  return false;
}
export type ScriptLine = { text: string; /** A character's name, or "Narrator". */ speaker: string; kind: string; panelId: string | null };
/**
 * Where a script leaves the story it was made from, as sentences the writing model is sent back:
 * - a line the story quotes must be SPOKEN WORD FOR WORD — the story's own words one after the other, in one line or
 *   in consecutive lines of one speaker — not paraphrased, not with its words scattered through other lines;
 * - by a character, as dialogue (not told by the Narrator), and by the character the story gives it to when it names one;
 * - and the story must be TOLD: a story with prose outside its quotes has narration, and no more than half of the
 *   panels are without any line.
 */
export function scriptProblems(story: string, lines: readonly ScriptLine[], panelIds: readonly string[], characterNames: readonly string[]): string[] {
  const problems: string[] = [], narrator = (line: ScriptLine): boolean => line.speaker.trim().toLowerCase() === "narrator" || line.kind === "narration";
  for (const quote of quotesOf(story, characterNames)) {
    const wanted = spokenWords(quote.text), short = quote.text.slice(0, 200);
    // One line, or the consecutive lines of one speaker read together (a script may split a long line over two).
    let found: ScriptLine | undefined;
    for (let from = 0; from < lines.length && !found; from++) {
      let joined: string[] = [];
      for (let to = from; to < lines.length && to < from + 4 && lines[to].speaker === lines[from].speaker; to++) { joined = [...joined, ...spokenWords(lines[to].text)]; if (contiguous(wanted, joined)) { found = lines[from]; break; } }
    }
    if (!found) { problems.push(`the story's line "${short}" is not spoken word for word in the plan — use the story's exact words, one after the other, by the speaker the story gives it`); continue; }
    if (narrator(found)) problems.push(`the story's line "${short}" is told by the Narrator — it is dialogue: give it to the character who says it`);
    else if (quote.speaker && found.speaker.trim().toLowerCase() !== quote.speaker.trim().toLowerCase()) problems.push(`the story's line "${short}" is said by ${quote.speaker} in the story, not by ${found.speaker}`);
  }
  // The story must be TOLD, not only quoted: what it tells outside its quotation marks is the Narrator's. A panel may
  // be silent (a beat with no words); a film in which most panels are, or one with prose and no narration at all, is
  // the quoted lines alone.
  const prose = spokenWords(story.replace(/"[^"\n]{1,400}"|“[^”\n]{1,400}”|«[^»\n]{1,400}»|「[^」\n]{1,400}」/gu, " ")).length;
  if (prose >= 4 && panelIds.length && !lines.some(narrator)) problems.push("the plan has no narration: everything the story tells outside its quotation marks is carried by the Narrator, in the story's own sentences");
  const voiced = new Set(lines.map((line) => line.panelId)), silent = panelIds.map((id, index) => (voiced.has(id) ? 0 : index + 1)).filter(Boolean);
  if (prose >= 4 && silent.length * 2 > panelIds.length && lines.some(narrator)) problems.push(`${silent.length} of ${panelIds.length} panels have no line (panels ${silent.slice(0, 12).join(", ")}): where nobody speaks, the Narrator tells that part of the story`);
  return problems;
}
/** The story's spoken lines that the script does not speak word for word (whoever says them). */
export function unspokenQuotes(story: string, scriptLines: readonly string[]): string[] {
  const lines = scriptLines.map((text) => ({ text, speaker: "someone", kind: "dialogue", panelId: null }));
  return storyQuotes(story).filter((quote) => scriptProblems(`"${quote}"`, lines, [], []).length > 0);
}
