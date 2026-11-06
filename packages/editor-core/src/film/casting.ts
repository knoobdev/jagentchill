import type { Character, Gender, Line } from "./model.ts";

/** A voice a speech provider offers: its id as the provider names it, its label, and the gender it is meant for. */
export type VoiceOption = { voiceId: string; name: string; gender: Gender; /** What the provider says of the voice; "young" and "mature" are used to fit a voice to an age. */ tags?: readonly string[] };
/** Who speaks with which voice after casting: every character once, and the narrator. */
export type VoiceCasting = { characters: { id: string; voiceId: string }[]; narratorVoiceId: string };

const genderOf = (value: unknown): Gender => (value === "female" || value === "male" ? value : "neutral");

/**
 * Casts the voices of a film's speakers from the voices the host offers, without an agent. A character who already
 * has a voice the host offers keeps it — a person's own choice is never replaced. Characters who never speak are not
 * cast. The others are cast in the order of
 * importance (protagonists first, then the most lines, then the name) to the least-used voice of their gender; when
 * no voice of that gender exists, to the least-used voice of any gender. The narrator takes a voice no character uses
 * when one is left. Pure and deterministic: the same film and the same voices always give the same casting.
 * Returns null when no voice is offered, so the caller changes nothing.
 */
export function castVoices(
  characters: readonly (Pick<Character, "id" | "name" | "role" | "gender" | "voiceId"> & { age?: string })[],
  lines: readonly Pick<Line, "speakerId">[],
  voices: readonly VoiceOption[],
  narratorVoiceId: string,
): VoiceCasting | null {
  if (!voices.length) return null;
  const offered = new Set(voices.map((voice) => voice.voiceId));
  const used = new Map<string, number>();
  const lineCount = new Map<string, number>();
  for (const line of lines) lineCount.set(line.speakerId, (lineCount.get(line.speakerId) ?? 0) + 1);
  // The offered voice with the smallest use count; ties keep the order the host lists its voices in.
  const leastUsed = (candidates: readonly VoiceOption[]): VoiceOption | undefined => {
    let best: VoiceOption | undefined, fewest = Number.POSITIVE_INFINITY;
    for (const voice of candidates) { const count = used.get(voice.voiceId) ?? 0; if (count < fewest) { best = voice; fewest = count; } }
    return best;
  };
  const keptVoice = (character: Pick<Character, "voiceId">): string => (character.voiceId && offered.has(character.voiceId) ? character.voiceId : "");
  // Reserve every choice a person already made before casting anyone: an unassigned speaker must not take a voice
  // another character keeps, even when the keepe is processed later.
  for (const character of characters) { const kept = keptVoice(character); if (kept) used.set(kept, (used.get(kept) ?? 0) + 1); }
  // Protagonists first; then everyone else by the most lines, then by name.
  // Only the ones who speak are cast: a character with no line (an animal, a passer-by) gets no voice.
  const ordered = characters.filter((character) => (lineCount.get(character.id) ?? 0) > 0 || keptVoice(character)).sort((a, b) =>
    (a.role === "lead" ? 0 : 1) - (b.role === "lead" ? 0 : 1) || (lineCount.get(b.id) ?? 0) - (lineCount.get(a.id) ?? 0) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const cast: VoiceCasting["characters"] = [];
  for (const character of ordered) {
    const kept = keptVoice(character);
    const gender = genderOf(character.gender);
    // The age narrows the choice when the host says which voices sound young or mature: a child is not given a grown
    // man's voice. A child under thirteen may take a young voice of either gender before an adult one of its own.
    // The age as a model writes it: "10", "khoảng 60", "about 34 years old" — the first number in it.
    const years = Number.parseInt(/\d+/.exec(character.age ?? "")?.[0] ?? "", 10), wanted = years > 0 && years < 16 ? "young" : years >= 55 ? "mature" : "";
    const ofGender = voices.filter((voice) => genderOf(voice.gender) === gender), fits = (pool: readonly VoiceOption[]) => (wanted ? pool.filter((voice) => voice.tags?.includes(wanted)) : []);
    const pool = [fits(ofGender), years > 0 && years < 13 ? fits(voices) : [], wanted === "" ? ofGender.filter((voice) => !voice.tags?.includes("young") && !voice.tags?.includes("mature")) : [], ofGender, voices].find((candidates) => candidates.length > 0)!;
    const voiceId = kept || leastUsed(pool)!.voiceId;
    if (!kept) used.set(voiceId, (used.get(voiceId) ?? 0) + 1);
    cast.push({ id: character.id, voiceId });
  }
  // The narrator: the voice a person picked, else one no character uses, else the least-used of all.
  const keptNarrator = narratorVoiceId && offered.has(narratorVoiceId) ? narratorVoiceId : "";
  const narrator = keptNarrator || leastUsed(voices.filter((voice) => (used.get(voice.voiceId) ?? 0) === 0))?.voiceId || leastUsed(voices)!.voiceId;
  return { characters: cast, narratorVoiceId: narrator };
}
