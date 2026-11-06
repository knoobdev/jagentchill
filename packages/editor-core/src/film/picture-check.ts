import { extractJson } from "./contracts.ts";
import type { Film, Panel } from "./model.ts";

/**
 * Is a drawn picture the frame it was asked for? One closed question to a model that can see (the Vision role), like the
 * listening check of a voice take: does the picture show this moment, and is it free of lettering. A picture that is
 * not is drawn again; one that still is not waits for a person — it is never placed in the film as if it were the frame.
 * (A real film, 2026-10-07: 7 of 17 frames came back as a poster, a book cover or the portrait of a stranger.)
 */
export type PictureCheck = { ok: boolean; /** The model's own short reason, or why no verdict could be read. */ why: string; /** The picture shows the moment (the people, the place). */ shows: boolean; /** The picture carries a poster, a title card or large lettering. */ text: boolean };

/** A picture is drawn at most this many times for one request before a person is asked. */
export const PICTURE_ATTEMPTS = 3;

const age = (entry: { age?: string; gender?: string }): string => [entry.age?.trim() ? (/^\d+$/.test(entry.age.trim()) ? `about ${entry.age.trim()} years old` : entry.age.trim()) : "", entry.gender && entry.gender !== "neutral" ? entry.gender : ""].filter(Boolean).join(", ");

/**
 * The question, sent WITH the picture. The people are described by what an eye can tell (age, gender) and never by
 * name: a model cannot know who "Bin" is, and must not answer "no" because it cannot read a name off a face.
 */
export function pictureQuestion(film: Pick<Film, "characters" | "locations">, panel: Pick<Panel, "action" | "characterIds" | "locationId">): string {
  const cast = panel.characterIds.map((id) => film.characters.find((entry) => entry.id === id)).filter((entry) => !!entry);
  const place = film.locations.find((entry) => entry.id === panel.locationId);
  return [
    "[[jc-film:look]] You check one frame of a film. Look at the attached picture and answer about what you SEE in it.",
    `The frame was asked to show this moment: """${panel.action.trim().slice(0, 1200)}"""`,
    cast.length ? `People in it: ${cast.map((entry) => `${entry.name}${age(entry) ? ` (${age(entry)})` : ""}`).join("; ")}. Judge them by apparent age and gender, not by name.` : "No particular person has to be in it.",
    place ? `Place: ${place.name}${place.appearance || place.description ? ` — ${(place.appearance || place.description).slice(0, 300)}` : ""}.` : "",
    'Question 1 — "shows": is the picture a scene of this moment, with these people (right number, apparent age and gender) in this kind of place? A portrait of someone else, another subject, a poster, a book cover or a title card is NOT.',
    'Question 2 — "text": does the picture carry a poster, a title card, a caption or LARGE lettering (words that fill a noticeable part of the picture)? Small incidental marks do not count.',
    'Answer with ONE JSON object only and nothing else: {"shows": true|false, "text": true|false, "why": "one short sentence"}',
  ].filter(Boolean).join("\n");
}

const flag = (value: unknown): boolean | undefined => (typeof value === "boolean" ? value : typeof value === "string" && /^(true|yes)$/i.test(value.trim()) ? true : typeof value === "string" && /^(false|no)$/i.test(value.trim()) ? false : undefined);

/**
 * The verdict in a model's answer, or undefined when the answer holds none: both `shows` and `text` must be there as
 * yes or no. An answer that cannot be read is not a pass and not a fail — the caller asks again, then says it could
 * not check.
 */
export function readPictureVerdict(answer: string): PictureCheck | undefined {
  let raw: unknown;
  try { raw = extractJson(answer); } catch { return undefined; }
  if (typeof raw !== "object" || raw === null) return undefined;
  const fields = raw as Record<string, unknown>, shows = flag(fields.shows), text = flag(fields.text);
  if (shows === undefined || text === undefined) return undefined;
  const said = typeof fields.why === "string" ? fields.why.replace(/\s+/g, " ").trim().slice(0, 300) : "";
  const ok = shows && !text;
  return { ok, shows, text, why: said || (ok ? "It shows the moment." : !shows ? "It does not show the moment." : "It carries lettering.") };
}

/** What happens to a picture after its check: kept, drawn again, or — the last allowed drawing also failed — left to a person. */
export function afterPictureCheck(check: PictureCheck | undefined, attempt: number, attempts = PICTURE_ATTEMPTS): "keep" | "again" | "ask" {
  // Nobody could judge it: the picture is kept as an UNCHECKED one (the caller says so); it is not drawn again blindly.
  if (!check || check.ok) return "keep";
  return attempt + 1 < attempts ? "again" : "ask";
}

/** What a person reads on a frame whose drawings all failed the check. */
export const pictureProblem = (check: PictureCheck, drawn: number): string =>
  `Drawn ${drawn} ${drawn === 1 ? "time" : "times"}, and the picture still ${!check.shows ? "does not show this frame" : "carries lettering"}: ${check.why}`.slice(0, 500);
