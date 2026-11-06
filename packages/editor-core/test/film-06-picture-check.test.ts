import assert from "node:assert/strict";
import { test } from "node:test";
import { film as fm } from "../src/index.ts";

const context = (): fm.OpContext => { let n = 0; return { now_ms: 5000, newId: () => `id_${++n}` }; };
const version = (id: string, check?: fm.PictureCheck): fm.Version => ({ id, media: { blobId: id.padEnd(64, "0"), name: `${id}.png`, kind: "image", bytes: 10 }, costUsd: 0.01, prompt: "p", created_ms: 1, ...(check ? { check } : {}) });
function film(): fm.Film {
  const base = fm.createFilm({ id: "film_1", now_ms: 1000, title: "Rain" });
  return fm.applyOps(base, [{ op: "film.set", fields: { sourceText: "A boy finds a kitten." } }, { op: "breakdown.set", breakdown: fm.normaliseBreakdown({
    logline: "A boy finds a kitten.", synopsis: "Bin finds a kitten in the rain.",
    characters: [{ name: "Ba Tu", role: "supporting", age: "68", gender: "female", description: "a noodle seller", appearance: "grey bun" }, { name: "Bin", role: "lead", age: 9, gender: "male", description: "a schoolboy", appearance: "blue uniform" }],
    locations: [{ name: "The alley", description: "an alley", appearance: "a narrow alley under tin roofs" }], props: [],
    clips: [{ title: "Rain", panels: [{ action: "Bin kneels by a cardboard box.", duration_s: 3, characters: ["Ba Tu", "Bin"], location: "The alley" }, { action: "Ba Tu holds out an umbrella.", duration_s: 3, characters: ["Ba Tu"], location: "The alley" }] }],
  }, base) }], context());
}

test("Picture check: the question describes the people by age and gender and asks the two closed questions; the verdict is read from the model's JSON, wrapped or not", () => {
  const made = film(), question = fm.pictureQuestion(made, made.panels[0]);
  assert.match(question, /^\[\[jc-film:look\]\]/);
  assert.match(question, /Bin kneels by a cardboard box\./);
  assert.match(question, /Ba Tu \(about 68 years old, female\); Bin \(about 9 years old, male\)/);
  assert.match(question, /Place: The alley — a narrow alley under tin roofs\./);
  assert.match(question, /\{"shows": true\|false, "text": true\|false, "why": "one short sentence"\}/);
  assert.deepEqual(fm.readPictureVerdict('{"shows": true, "text": false, "why": "A boy kneels by a box in an alley."}'), { ok: true, shows: true, text: false, why: "A boy kneels by a box in an alley." });
  // The real failures: a poster instead of the scene; the scene with a big shop sign.
  assert.deepEqual(fm.readPictureVerdict('Here you go:\n```json\n{"shows": false, "text": true, "why": "A VOTE FOR WOMEN poster."}\n```'), { ok: false, shows: false, text: true, why: "A VOTE FOR WOMEN poster." });
  assert.deepEqual(fm.readPictureVerdict('{"shows": "yes", "text": "true", "why": ""}'), { ok: false, shows: true, text: true, why: "It carries lettering." });
});
test("Picture check: an answer with no verdict is not a pass and not a fail", () => {
  for (const answer of ["", "Looks good to me!", '{"shows": true}', '{"shows": "maybe", "text": false}', "{ not json", '["shows"]']) assert.equal(fm.readPictureVerdict(answer), undefined, answer);
});
test("Picture check: a picture that is not the frame is drawn again twice at most, then left to a person; one nobody could judge is kept unchecked, never drawn again blindly", () => {
  const no: fm.PictureCheck = { ok: false, shows: false, text: false, why: "A portrait of a stranger." }, yes: fm.PictureCheck = { ok: true, shows: true, text: false, why: "ok" };
  assert.deepEqual([0, 1, 2].map((attempt) => fm.afterPictureCheck(no, attempt)), ["again", "again", "ask"]);
  assert.deepEqual([fm.afterPictureCheck(yes, 0), fm.afterPictureCheck(undefined, 0), fm.afterPictureCheck(undefined, 2)], ["keep", "keep", "keep"]);
  assert.equal(fm.PICTURE_ATTEMPTS, 3);
  assert.equal(fm.pictureProblem(no, 3), "Drawn 3 times, and the picture still does not show this frame: A portrait of a stranger.");
  assert.match(fm.pictureProblem({ ok: false, shows: true, text: true, why: "A big ENJOY sign." }, 3), /still carries lettering: A big ENJOY sign\./);
});
test("Picture check in the film: a drawing that failed is kept BESIDE the frame with its verdict, the frame is marked and stays without a picture until a person chooses or changes it", () => {
  const made = film(), id = made.panels[0].id, failed: fm.PictureCheck = { ok: false, shows: false, text: true, why: "A poster." };
  let next = fm.applyOps(made, [{ op: "panel.candidate", id, version: version("bad", failed) }, { op: "panel.refused", id, message: "Drawn 3 times…", reason: "picture" }], context());
  assert.deepEqual([next.panels[0].picture.current, next.panels[0].picture.candidates.map((entry) => [entry.id, entry.check?.ok]), next.panels[0].refused], [null, [["bad", false]], { message: "Drawn 3 times…", at_ms: 5000, reason: "picture" }]);
  assert.equal(fm.counts(next).panelsMissing, 2, "a candidate is not the frame's picture");
  // A person takes the drawing anyway: it is the picture now, and the mark is gone.
  const used = fm.applyOps(next, [{ op: "panel.use", id, versionId: "bad" }], context());
  assert.deepEqual([used.panels[0].picture.current?.id, used.panels[0].refused], ["bad", undefined]);
  // Or changes the words: the mark is gone, the frame is asked again.
  next = fm.applyOps(next, [{ op: "panel.update", id, fields: { action: "Bin crouches by a box." } }], context());
  assert.equal(next.panels[0].refused, undefined);
  // A picture that passed arrives: it carries its verdict.
  next = fm.applyOps(next, [{ op: "panel.picture", id, version: version("good", { ok: true, shows: true, text: false, why: "ok" }) }], context());
  assert.deepEqual([next.panels[0].picture.current?.id, next.panels[0].picture.current?.check?.ok], ["good", true]);
});
test("A refused sheet is remembered in the film until its words change or a picture arrives; a person's leave to send the film's pictures is kept per provider", () => {
  const made = film(), id = made.characters[0].id;
  let next = fm.applyOps(made, [{ op: "asset.refused", kind: "character", id, message: "Your input was flagged" }], context());
  assert.deepEqual(next.characters[0].refused, { message: "Your input was flagged", at_ms: 5000 });
  assert.equal(fm.applyOps(next, [{ op: "asset.update", kind: "character", id, fields: { appearance: "grey bun, brown blouse" } }], context()).characters[0].refused, undefined);
  assert.equal(fm.applyOps(next, [{ op: "asset.picture", kind: "character", id, version: version("sheet") }], context()).characters[0].refused, undefined);
  next = fm.applyOps(next, [{ op: "references.allow", providerId: "openrouter" }, { op: "references.allow", providerId: "openrouter" }], context());
  next = fm.applyOps(next, [{ op: "references.allow", providerId: "openrouter", kind: "audio" }], context());
  assert.deepEqual(next.sendAllowed, ["image:openrouter", "audio:openrouter"]);
});
test("References of a panel: the leads first, then the other people, the place, the frame before, the props — and never more than five are used", () => {
  const made = film(), ops: fm.FilmOp[] = [...made.characters.map((entry, index): fm.FilmOp => ({ op: "asset.picture", kind: "character", id: entry.id, version: version(`c${index}`) })), { op: "asset.picture", kind: "location", id: made.locations[0].id, version: version("place") }, { op: "panel.picture", id: made.panels[0].id, version: version("frame1") }];
  const drawn = fm.applyOps(made, ops, context());
  // Panel 1 names Ba Tu first; Bin is the lead.
  assert.deepEqual(fm.panelReferenceList(drawn, drawn.panels[0]).map((entry) => entry.what), ["the character Bin", "the character Ba Tu", "the place The alley, shown empty"]);
  assert.deepEqual(fm.panelReferenceList(drawn, drawn.panels[1]).map((entry) => entry.what), ["the character Ba Tu", "the place The alley, shown empty", "the frame just before this one"]);
  assert.equal(fm.PANEL_REFERENCES_MAX, 5);
});
test("A frame a person left out is out of the film whatever it holds: a DRAWN frame that is left out takes no place and no time, and its lines are not on the timeline", () => {
  const made = film(), ops: fm.FilmOp[] = made.panels.map((panel, index): fm.FilmOp => ({ op: "panel.picture", id: panel.id, version: version(`f${index}`) }));
  const drawn = fm.applyOps(made, ops, context()), whole = fm.layout(drawn);
  assert.deepEqual(whole.panels.map((entry) => entry.placed), [true, true]);
  const left = fm.applyOps(drawn, [{ op: "panel.leave", id: drawn.panels[0].id, leftOut: true }], context()), cut = fm.layout(left);
  assert.ok(left.panels[0].picture.current, "the picture is still there");
  assert.deepEqual(cut.panels.map((entry) => [entry.placed, entry.duration_ticks > 0]), [[false, false], [true, true]]);
  assert.equal(cut.total_ticks, whole.total_ticks - whole.panels[0].duration_ticks);
  assert.deepEqual(cut.withoutMedia, [], "left out is not 'missing'");
});
test("A new picture of a frame whose words changed replaces the outdated one (which waits beside it); a new picture of a current frame is only offered", () => {
  const made = film(), id = made.panels[0].id;
  let next = fm.applyOps(made, [{ op: "panel.picture", id, version: version("old") }, { op: "panel.update", id, fields: { action: "Bin runs." } }], context());
  assert.equal(next.panels[0].picture.stale, true);
  next = fm.applyOps(next, [{ op: "panel.picture", id, version: version("new") }], context());
  assert.deepEqual([next.panels[0].picture.current?.id, next.panels[0].picture.stale, next.panels[0].picture.candidates.map((entry) => entry.id)], ["new", false, ["old"]]);
  next = fm.applyOps(next, [{ op: "panel.picture", id, version: version("third") }], context());
  assert.deepEqual([next.panels[0].picture.current?.id, next.panels[0].picture.candidates.map((entry) => entry.id)], ["new", ["old", "third"]]);
});
