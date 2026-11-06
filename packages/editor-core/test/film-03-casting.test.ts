// Pure functions of Film Studio: the automatic casting of voices and the gender field of the breakdown.
import assert from "node:assert/strict";
import { test } from "node:test";
import { film as fm } from "../src/index.ts";

const context = (): fm.OpContext => ({ now_ms: 2000, newId: () => "id" });
const V: fm.VoiceOption[] = [
  { voiceId: "f1", name: "F1", gender: "female" }, { voiceId: "f2", name: "F2", gender: "female" }, { voiceId: "f3", name: "F3", gender: "female" },
  { voiceId: "m1", name: "M1", gender: "male" }, { voiceId: "n1", name: "N1", gender: "neutral" },
];
const person = (id: string, name: string, role: fm.Character["role"], gender: fm.Gender, voiceId = ""): Pick<fm.Character, "id" | "name" | "role" | "gender" | "voiceId"> => ({ id, name, role, gender, voiceId });

/** Casting with everyone speaking: a character with no line of its own gets one (only speakers are cast). */
const castAll = (chars: Parameters<typeof fm.castVoices>[0], lines: { speakerId: string }[], voices: fm.VoiceOption[], narrator: string) =>
  fm.castVoices(chars, [...lines, ...chars.filter((entry) => !lines.some((line) => line.speakerId === entry.id)).map((entry) => ({ speakerId: entry.id }))], voices, narrator);

test("castVoices — no voice offered changes nothing", () => {
  assert.equal(castAll([person("a", "Ava", "lead", "female")], [], [], ""), null);
});

test("castVoices — a voice a person picked is never replaced", () => {
  const cast = castAll([person("a", "Ava", "lead", "female", "m1")], [], V, "")!;
  assert.equal(cast.characters.find((entry) => entry.id === "a")!.voiceId, "m1");
});

test("castVoices — a kept voice is reserved before an unassigned speaker is cast", () => {
  // Ava is the lead and is cast first; Bea keeps f1, so Ava must not take it even though she is processed earlier.
  const cast = castAll([person("a", "Ava", "lead", "female"), person("b", "Bea", "supporting", "female", "f1")], [], V, "")!;
  assert.deepEqual(cast.characters.map((entry) => [entry.id, entry.voiceId]), [["a", "f2"], ["b", "f1"]]);
});

test("castVoices — leads first, then everyone else by lines, then name", () => {
  const chars = [person("l", "Lead", "lead", "female"), person("s", "Support", "supporting", "female"), person("x", "Extra", "extra", "female")];
  const lines = [{ speakerId: "x" }, { speakerId: "x" }, { speakerId: "x" }, { speakerId: "s" }];
  const cast = castAll(chars, lines, V, "")!;
  // The lead first; the extra has more lines than the supporting character, so it is cast before it.
  assert.deepEqual(cast.characters.map((entry) => entry.id), ["l", "x", "s"]);
});

test("castVoices — two speakers of one gender take two distinct voices of it", () => {
  const cast = castAll([person("a", "Ava", "lead", "female"), person("b", "Bea", "supporting", "female")], [], V, "")!;
  assert.deepEqual(cast.characters.map((entry) => entry.voiceId), ["f1", "f2"]);
});

test("castVoices — the least-used voice of the gender is reused when it is exhausted", () => {
  const chars = [person("a", "Ava", "lead", "female"), person("b", "Bea", "supporting", "female"), person("c", "Cleo", "extra", "female"), person("d", "Dana", "extra", "female")];
  const cast = castAll(chars, [], V, "")!;
  // The three female voices are used once each; the fourth speaker adds to the first of the least-used ones.
  assert.deepEqual(cast.characters.map((entry) => entry.voiceId), ["f1", "f2", "f3", "f1"]);
});

test("castVoices — no voice of the speaker's gender uses the least-used voice of any gender", () => {
  const onlyMale: fm.VoiceOption[] = [{ voiceId: "m1", name: "M1", gender: "male" }, { voiceId: "m2", name: "M2", gender: "male" }];
  const cast = castAll([person("a", "Ava", "lead", "female"), person("b", "Ben", "supporting", "male")], [], onlyMale, "")!;
  assert.deepEqual(cast.characters.map((entry) => entry.voiceId), ["m1", "m2"]);
});

test("castVoices — lines, not the list order, decide who is cast first", () => {
  const chars = [person("a", "Zed", "supporting", "female"), person("b", "Ava", "supporting", "female"), person("c", "Mia", "lead", "female")];
  const lines = [{ speakerId: "b" }, { speakerId: "b" }, { speakerId: "a" }];
  const cast = castAll(chars, lines, V, "")!;
  // Mia leads; Ava has two lines; Zed one.
  assert.deepEqual(cast.characters.map((entry) => entry.id), ["c", "b", "a"]);
});

test("castVoices — the same film and voices always give the same casting", () => {
  const chars = [person("a", "Ava", "lead", "female"), person("b", "Ben", "supporting", "male"), person("c", "Cleo", "extra", "neutral")];
  const lines = [{ speakerId: "a" }, { speakerId: "b" }];
  assert.deepEqual(castAll(chars, lines, V, ""), castAll(chars, lines, V, ""));
});

test("castVoices — the narrator takes a voice no character uses", () => {
  const cast = castAll([person("a", "Ava", "lead", "female"), person("b", "Ben", "supporting", "male")], [], V, "")!;
  const taken = new Set(cast.characters.map((entry) => entry.voiceId));
  assert.ok(cast.narratorVoiceId && !taken.has(cast.narratorVoiceId), `${cast.narratorVoiceId} is free`);
  // A narrator voice a person picked is kept.
  assert.equal(castAll([person("a", "Ava", "lead", "female")], [], V, "m1")!.narratorVoiceId, "m1");
});

const raw = (gender?: unknown) => ({
  logline: "A girl mends a lantern.", synopsis: "Linh mends a lantern.",
  characters: [{ name: "Linh", role: "lead", gender }, { name: "Minh", role: "supporting" }],
  locations: [{ name: "Tran Phu street" }],
  props: [],
  clips: [{ title: "One", panels: [{ action: "A street at dusk.", duration_s: 4 }] }],
});

test("normaliseBreakdown — gender is parsed, defaulted and invalid values read as neutral", () => {
  const film = fm.createFilm({ id: "film_1", now_ms: 1, title: "T" });
  const made = fm.normaliseBreakdown(raw("Female"), film);
  assert.deepEqual(made.characters.map((entry) => entry.gender), ["female", "neutral"]);
  assert.equal(fm.normaliseBreakdown(raw("wizard"), film).characters[0].gender, "neutral");
  const unknown = structuredClone({ ...raw("female"), characters: [{ name: "Lin" }] }) as unknown;
  assert.equal(fm.normaliseBreakdown(unknown, film).characters[0].gender, "neutral");
});

test("A film stored before gender and voiceAuto existed still loads and can be cast", () => {
  const base = fm.createFilm({ id: "film_old", now_ms: 1, title: "Old" });
  const stored = JSON.parse(JSON.stringify(base)) as fm.Film;
  // A character as an older version stored it: no gender, no voiceAuto.
  stored.characters = [{ id: "ch_ava", name: "Ava", role: "lead", age: "", description: "", appearance: "", voiceId: "", confirmed: false, picture: fm.emptyPicture() } as unknown as fm.Character];
  const loaded = fm.applyOps(stored, [{ op: "film.set", fields: { title: "Loaded" } }], context());
  assert.equal(loaded.title, "Loaded");
  // The reader fills in what an older version did not store, without a format bump.
  assert.deepEqual([loaded.characters[0].gender, loaded.characters[0].voiceAuto, loaded.narratorVoiceAuto], ["neutral", false, false]);
  const cast = castAll(loaded.characters, [], V, "")!;
  // A missing gender reads as neutral, so the neutral voice is cast.
  assert.equal(cast.characters[0].voiceId, "n1");
  // A narrator pick on the old film clears the (absent) auto mark instead of failing.
  assert.equal(fm.applyOps(stored, [{ op: "film.set", fields: { narratorVoiceId: "m1" } }], context()).narratorVoiceAuto, false);
});

test("castVoices — a character who never speaks gets no voice", () => {
  const cast = fm.castVoices([person("a", "Ava", "lead", "female"), person("k", "Kitten", "extra", "neutral")], [{ speakerId: "a" }], V, "")!;
  assert.deepEqual(cast.characters.map((entry) => entry.id), ["a"]);
});

test("castVoices — the age fits the voice: a child takes a young voice, an elder a mature one, an adult neither", () => {
  const voices: fm.VoiceOption[] = [
    { voiceId: "m-adult", name: "M", gender: "male" }, { voiceId: "m-old", name: "MO", gender: "male", tags: ["mature"] },
    { voiceId: "f-adult", name: "F", gender: "female" }, { voiceId: "f-young", name: "FY", gender: "female", tags: ["young"] }, { voiceId: "f-old", name: "FO", gender: "female", tags: ["mature"] },
  ];
  const aged = (id: string, gender: fm.Gender, age: string) => ({ ...person(id, id, "lead", gender), age });
  const cast = fm.castVoices([aged("boy", "male", "10"), aged("gran", "female", "62"), aged("mum", "female", "34"), aged("dad", "male", "40")], [{ speakerId: "boy" }, { speakerId: "gran" }, { speakerId: "mum" }, { speakerId: "dad" }], voices, "")!;
  const of = (id: string) => cast.characters.find((entry) => entry.id === id)!.voiceId;
  // No young MALE voice is offered: a ten-year-old takes the young voice there is rather than a grown man's.
  assert.deepEqual([of("boy"), of("gran"), of("mum"), of("dad")], ["f-young", "f-old", "f-adult", "m-adult"]);
});

test("castVoices — an age written in words still fits the voice (\"khoảng 60\" is sixty)", () => {
  const voices: fm.VoiceOption[] = [{ voiceId: "f-adult", name: "F", gender: "female" }, { voiceId: "f-old", name: "FO", gender: "female", tags: ["mature"] }];
  const cast = fm.castVoices([{ ...person("gran", "Bà Tư", "lead", "female"), age: "khoảng 60" }], [{ speakerId: "gran" }], voices, "")!;
  assert.equal(cast.characters[0].voiceId, "f-old");
});
