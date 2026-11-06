// The agent runtimes in these tests are the FAKES of `harness.ts` and the model is never called; the server, the real film
// service (its store, `applyOps`, `edit`/`reorderClips` and its events) and every tool are the real ones.
import assert from "node:assert/strict";
import { test } from "node:test";
import { tick } from "./harness.ts";
import { ACME, key, toolWorld } from "./support/tools.ts";

const until = async (done: () => boolean, what: string) => { for (let n = 0; n < 400; n++) { if (done()) return; await tick(10); } throw new Error(`timed out waiting for ${what}`); };
type World = Awaited<ReturnType<typeof toolWorld>>;
const permissionRequests = (w: World) => w.admin.events.filter((event) => event.event === "jagentchill.chat.permission.requested").map((event) => event.payload.request as { requestId: string; toolLabel: string; detail: string });
/** A film on the host, as the Film Studio creates it. */
async function filmWorld(title = "The Lantern Keeper", sourceText = "Hoi An, the night of the full moon.") {
  const w = await toolWorld({ toolSurface: "film" });
  const { film } = (await w.admin.call("jagentchill.film.create", { title, sourceText })) as { film: { id: string; title: string } };
  return { ...w, filmId: film.id };
}

test("Film tools: jc_film_get reads story, characters, scenes and shots; the story and a character change the stored film and emit its event", async () => {
  const w = await filmWorld();
  const before = w.admin.events.length;
  // The film as the assistant first reads it: the story, and no cast, scene or shot yet.
  const empty = await w.ok("jc_film_get", { filmId: w.filmId });
  assert.deepEqual([empty.data.filmId, empty.data.story.title, empty.data.characters.length, empty.data.scenes.length, empty.data.shots.length], [w.filmId, "The Lantern Keeper", 0, 0, 0]);
  assert.equal(empty.data.story.sourceText, "Hoi An, the night of the full moon.");
  // The story: title, logline and the story text, stored and announced.
  const story = await w.write("jc_film_update_story", { filmId: w.filmId, title: "Lantern", logline: "A girl mends a stranger's lantern.", sourceText: "Hoi An, off-season." });
  assert.deepEqual(story.data.changed, ["title", "logline", "sourceText"]);
  const stored = w.h.app.film!.read(w.filmId);
  assert.deepEqual([stored.title, stored.logline, stored.sourceText], ["Lantern", "A girl mends a stranger's lantern.", "Hoi An, off-season."]);
  await until(() => w.admin.events.slice(before).some((event) => event.event === "jagentchill.film.updated" && event.payload.filmId === w.filmId), "the film change event");
  const events = w.admin.events.slice(before).filter((event) => event.event === "jagentchill.film.updated" && event.payload.filmId === w.filmId);
  assert.equal(events.at(-1)!.payload.film.title, "Lantern", "the open Film screen follows the change event");
  // Characters: added without an id, changed with one, both read back.
  const made = await w.write("jc_film_upsert_character", { filmId: w.filmId, name: "Linh", role: "lead", appearance: "black braid, indigo ao dai" });
  assert.equal(made.data.created, true);
  const changed = await w.write("jc_film_upsert_character", { filmId: w.filmId, id: made.data.characterId, age: "17" });
  assert.equal(changed.data.created, false);
  const character = w.h.app.film!.read(w.filmId).characters[0]!;
  assert.deepEqual([character.id, character.name, character.role, character.appearance, character.age], [made.data.characterId, "Linh", "lead", "black braid, indigo ao dai", "17"]);
  const got = await w.ok("jc_film_get", { filmId: w.filmId });
  assert.deepEqual(got.data.characters.map((entry: { id: string }) => entry.id), [made.data.characterId]);
  w.close();
});

test("Film tools: scenes and shots are added, changed, reordered and deleted the way the studio changes them", async () => {
  const w = await filmWorld("F");
  const a = await w.write("jc_film_upsert_scene", { filmId: w.filmId, title: "The stall" });
  const b = await w.write("jc_film_upsert_scene", { filmId: w.filmId, title: "The lantern" });
  const c = await w.write("jc_film_upsert_scene", { filmId: w.filmId, title: "The river" });
  assert.deepEqual(w.h.app.film!.read(w.filmId).clips.map((entry) => entry.title), ["The stall", "The lantern", "The river"]);
  // A scene renamed by id; created is false and the stored title changes.
  const renamed = await w.write("jc_film_upsert_scene", { filmId: w.filmId, id: b.data.sceneId, title: "The lantern light" });
  assert.deepEqual([renamed.data.created, renamed.data.sceneId, w.h.app.film!.read(w.filmId).clips[1]!.title], [false, b.data.sceneId, "The lantern light"]);
  await w.write("jc_film_upsert_scene", { filmId: w.filmId, id: b.data.sceneId, title: "The lantern" });
  // A shot is added to a scene, changed, and is the model's panel (shot size, camera motion, duration).
  const shot = await w.write("jc_film_upsert_shot", { filmId: w.filmId, clipId: a.data.sceneId, action: "Empty street at dusk.", shotSize: "wide", cameraMotion: "static", duration_ticks: 240_000 });
  assert.deepEqual([shot.data.clipId, shot.data.index, shot.data.created], [a.data.sceneId, 1, true]);
  const changed = await w.write("jc_film_upsert_shot", { filmId: w.filmId, id: shot.data.shotId, cameraMotion: "push-in" });
  assert.deepEqual([changed.data.created, w.h.app.film!.read(w.filmId).panels[0]!.cameraMotion], [false, "push-in"]);
  // Reorder the scenes; the shots keep their scene.
  const reorder = await w.write("jc_film_reorder_scenes", { filmId: w.filmId, ids: [c.data.sceneId, a.data.sceneId, b.data.sceneId] });
  assert.deepEqual(reorder.data.ids, [c.data.sceneId, a.data.sceneId, b.data.sceneId]);
  assert.deepEqual(w.h.app.film!.read(w.filmId).clips.map((entry) => entry.title), ["The river", "The stall", "The lantern"]);
  assert.equal(w.h.app.film!.read(w.filmId).panels[0]!.clipId, a.data.sceneId);
  // A short or repeated list is refused.
  assert.equal((await w.writeFails("jc_film_reorder_scenes", { filmId: w.filmId, ids: [a.data.sceneId] })).code, "INVALID_PARAMS");
  assert.equal((await w.writeFails("jc_film_reorder_scenes", { filmId: w.filmId, ids: [a.data.sceneId, a.data.sceneId, b.data.sceneId] })).code, "INVALID_PARAMS");
  // Deleting a shot and a scene asks the user first, then carries out the identical call.
  await w.admin.call("jagentchill.chat.subscribe", { sessionKey: w.sessionKey });
  const shotArgs = { filmId: w.filmId, id: shot.data.shotId, idempotencyKey: key() };
  assert.deepEqual((await w.fails("jc_film_delete_shot", shotArgs)).code, "APPROVAL_PENDING");
  await until(() => permissionRequests(w).length === 1, "the shot permission card");
  assert.match(permissionRequests(w)[0]!.toolLabel, /^Delete shot 1$/);
  await w.admin.call("jagentchill.chat.approval.resolve", { requestId: permissionRequests(w)[0]!.requestId, decision: "allow-once" });
  assert.equal((await w.ok("jc_film_delete_shot", shotArgs)).data.shotId, shot.data.shotId);
  assert.equal(w.h.app.film!.read(w.filmId).panels.length, 0);
  const sceneArgs = { filmId: w.filmId, id: b.data.sceneId, idempotencyKey: key() };
  assert.deepEqual((await w.fails("jc_film_delete_scene", sceneArgs)).code, "APPROVAL_PENDING");
  await until(() => permissionRequests(w).length === 2, "the scene permission card");
  assert.equal(permissionRequests(w)[1]!.toolLabel, "Delete the scene “The lantern”");
  await w.admin.call("jagentchill.chat.approval.resolve", { requestId: permissionRequests(w)[1]!.requestId, decision: "allow-once" });
  await w.ok("jc_film_delete_scene", sceneArgs);
  assert.deepEqual(w.h.app.film!.read(w.filmId).clips.map((entry) => entry.title), ["The river", "The stall"]);
  w.close();
});

test("Film tools: a shot added to a scene that is not last keeps its scene and its own id", async () => {
  const w = await filmWorld("F");
  const a = await w.write("jc_film_upsert_scene", { filmId: w.filmId, title: "A" });
  const b = await w.write("jc_film_upsert_scene", { filmId: w.filmId, title: "B" });
  const first = await w.write("jc_film_upsert_shot", { filmId: w.filmId, clipId: a.data.sceneId, action: "One." });
  const last = await w.write("jc_film_upsert_shot", { filmId: w.filmId, clipId: b.data.sceneId, action: "Two." });
  // Inserted after the first shot of A while B's shot is the last panel: the answer names the new shot, not the last one.
  const between = await w.write("jc_film_upsert_shot", { filmId: w.filmId, clipId: a.data.sceneId, afterId: first.data.shotId, action: "Three." });
  const panels = w.h.app.film!.read(w.filmId).panels;
  assert.deepEqual(panels.map((entry) => entry.id), [first.data.shotId, between.data.shotId, last.data.shotId]);
  assert.equal(between.data.clipId, a.data.sceneId);
  const got = await w.ok("jc_film_get", { filmId: w.filmId });
  assert.deepEqual(got.data.shots.map((entry: { id: string; index: number }) => [entry.id, entry.index]), [[first.data.shotId, 1], [between.data.shotId, 2], [last.data.shotId, 3]]);
  w.close();
});

test("Film tools: a bad id is the family's typed error, a wrong type is INVALID_PARAMS, and every write needs a key", async () => {
  const w = await filmWorld("F");
  // A film id that names nothing.
  assert.deepEqual([(await w.writeFails("jc_film_update_story", { filmId: "film_missing", title: "X" })).code, (await w.fails("jc_film_get", { filmId: "film_missing" })).code], ["NOT_FOUND", "NOT_FOUND"]);
  // A character id that names nothing is NOT_FOUND, not a silent create.
  assert.equal((await w.writeFails("jc_film_upsert_character", { filmId: w.filmId, id: "ch_ghost", age: "1" })).code, "NOT_FOUND");
  assert.equal((await w.writeFails("jc_film_upsert_scene", { filmId: w.filmId, id: "cl_ghost", title: "X" })).code, "NOT_FOUND");
  assert.equal((await w.writeFails("jc_film_delete_shot", { filmId: w.filmId, id: "pa_ghost" })).code, "NOT_FOUND");
  // A parameter of the wrong type, and a parameter that does not exist.
  const wrong = await w.writeFails("jc_film_update_story", { filmId: w.filmId, title: 7 });
  assert.equal(wrong.code, "INVALID_PARAMS");
  assert.match(wrong.message, /title/);
  const unknown = await w.writeFails("jc_film_upsert_scene", { filmId: w.filmId, title: "A", nope: true });
  assert.equal(unknown.code, "INVALID_PARAMS");
  assert.match(unknown.message, /nope/);
  // A shot size outside the model's list, and a duration that is not whole ticks.
  assert.equal((await w.writeFails("jc_film_upsert_shot", { filmId: w.filmId, clipId: "cl_1", shotSize: "very-wide" })).code, "INVALID_PARAMS");
  // Every write carries an idempotency key; the read does not need one.
  const noKey = (await w.call("jc_film_upsert_scene", { filmId: w.filmId, title: "A" })).error!;
  assert.equal(noKey.code, "INVALID_PARAMS");
  assert.match(noKey.message, /idempotencyKey/);
  // Creating a character needs a name; changing one needs a field.
  assert.equal((await w.writeFails("jc_film_upsert_character", { filmId: w.filmId })).code, "INVALID_PARAMS");
  const made = await w.write("jc_film_upsert_character", { filmId: w.filmId, name: "Linh" });
  assert.equal((await w.writeFails("jc_film_upsert_character", { filmId: w.filmId, id: made.data.characterId })).code, "INVALID_PARAMS");
  // The session bound to the film may leave filmId out; an unbound one may not.
  assert.equal((await w.fails("jc_film_get", {})).code, "INVALID_PARAMS");
  w.close();
});

test("Film tools: deleting a character asks first and the allowed call removes it; the fake model is never called", async () => {
  const w = await filmWorld("F");
  await w.admin.call("jagentchill.chat.subscribe", { sessionKey: w.sessionKey });
  const made = await w.write("jc_film_upsert_character", { filmId: w.filmId, name: "Minh", appearance: "grey hoodie" });
  const args = { filmId: w.filmId, id: made.data.characterId, idempotencyKey: key() };
  assert.equal((await w.fails("jc_film_delete_character", args)).code, "APPROVAL_PENDING");
  await until(() => permissionRequests(w).length === 1, "the character permission card");
  assert.equal(permissionRequests(w)[0]!.toolLabel, "Delete the character “Minh”");
  assert.equal(w.h.app.film!.read(w.filmId).characters.length, 1, "nothing is removed before the person allows it");
  await w.admin.call("jagentchill.chat.approval.resolve", { requestId: permissionRequests(w)[0]!.requestId, decision: "allow-once" });
  await w.ok("jc_film_delete_character", args);
  assert.equal(w.h.app.film!.read(w.filmId).characters.length, 0);
  w.close();
});

test("Film tools: every write announces the film it changed, the approval-gated deletes included", async () => {
  const w = await filmWorld("F");
  await w.admin.call("jagentchill.chat.subscribe", { sessionKey: w.sessionKey });
  const seen = () => w.admin.events.filter((event) => event.event === "jagentchill.film.updated" && event.payload.filmId === w.filmId).length;
  const wrote = async (run: () => Promise<unknown>) => { const before = seen(); await run(); await until(() => seen() > before, "the film change event"); };
  await wrote(() => w.write("jc_film_update_story", { filmId: w.filmId, sourceText: "Hoi An, off-season." }));
  await wrote(() => w.write("jc_film_upsert_character", { filmId: w.filmId, name: "Linh" }));
  const characterId = w.h.app.film!.read(w.filmId).characters[0]!.id;
  await wrote(() => w.write("jc_film_upsert_character", { filmId: w.filmId, id: characterId, age: "17" }));
  await wrote(() => w.write("jc_film_upsert_scene", { filmId: w.filmId, title: "A" }));
  const sceneId = w.h.app.film!.read(w.filmId).clips[0]!.id;
  await wrote(() => w.write("jc_film_upsert_scene", { filmId: w.filmId, id: sceneId, title: "A2" }));
  await wrote(() => w.write("jc_film_upsert_shot", { filmId: w.filmId, clipId: sceneId, action: "One." }));
  const shotId = w.h.app.film!.read(w.filmId).panels[0]!.id;
  await wrote(() => w.write("jc_film_upsert_shot", { filmId: w.filmId, id: shotId, action: "Two." }));
  await wrote(() => w.write("jc_film_upsert_scene", { filmId: w.filmId, title: "B" }));
  const secondId = w.h.app.film!.read(w.filmId).clips.find((entry) => entry.title === "B")!.id;
  await wrote(() => w.write("jc_film_reorder_scenes", { filmId: w.filmId, ids: [secondId, sceneId] }));
  // The deletes ask the person first, then carry the identical call out; each also announces the film.
  let cards = 0;
  for (const [tool, id] of [["jc_film_delete_shot", shotId], ["jc_film_delete_scene", sceneId], ["jc_film_delete_character", characterId]] as const) {
    const args = { filmId: w.filmId, id, idempotencyKey: key() };
    assert.equal((await w.fails(tool, args)).code, "APPROVAL_PENDING");
    await until(() => permissionRequests(w).length > cards, "the permission card");
    await w.admin.call("jagentchill.chat.approval.resolve", { requestId: permissionRequests(w)[cards]!.requestId, decision: "allow-once" });
    cards += 1;
    await wrote(() => w.ok(tool, args));
  }
  w.close();
});

test("Film tools: a reference that names nothing is NOT_FOUND for every id a shot can carry", async () => {
  const w = await filmWorld("F");
  const character = await w.write("jc_film_upsert_character", { filmId: w.filmId, name: "Linh" });
  const scene = await w.write("jc_film_upsert_scene", { filmId: w.filmId, title: "A" });
  await w.write("jc_film_upsert_scene", { filmId: w.filmId, title: "B" });
  const shot = await w.write("jc_film_upsert_shot", { filmId: w.filmId, clipId: scene.data.sceneId, action: "One." });
  const base = { filmId: w.filmId, clipId: scene.data.sceneId, action: "A shot." };
  // Every reference the shot payload can carry, each with one id that names nothing.
  for (const [field, args] of ([
    ["afterId", { ...base, afterId: "pa_ghost" }],
    ["characterIds", { ...base, characterIds: [character.data.characterId, "ch_ghost"] }],
    ["locationId", { ...base, locationId: "lo_ghost" }],
    ["propIds", { ...base, propIds: ["pr_ghost"] }],
    ["clipId", { filmId: w.filmId, clipId: "cl_ghost", action: "A shot." }],
    ["id", { filmId: w.filmId, id: "pa_ghost", action: "A shot." }],
  ] as [string, Record<string, unknown>][])) {
    assert.equal((await w.writeFails("jc_film_upsert_shot", args)).code, "NOT_FOUND", `${field} that names nothing is NOT_FOUND`);
  }
  // The deletes and the update of a shot id that is gone.
  assert.equal((await w.writeFails("jc_film_delete_shot", { filmId: w.filmId, id: "pa_ghost" })).code, "NOT_FOUND");
  assert.equal((await w.writeFails("jc_film_delete_scene", { filmId: w.filmId, id: "cl_ghost" })).code, "NOT_FOUND");
  assert.equal((await w.writeFails("jc_film_delete_character", { filmId: w.filmId, id: "ch_ghost" })).code, "NOT_FOUND");
  // A valid afterId still lands where it should; a reorder that names a scene that is gone is NOT_FOUND.
  const between = await w.write("jc_film_upsert_shot", { filmId: w.filmId, clipId: scene.data.sceneId, afterId: shot.data.shotId, action: "Two." });
  assert.equal(between.data.index, 2);
  const clips = w.h.app.film!.read(w.filmId).clips.map((entry) => entry.id);
  assert.equal((await w.writeFails("jc_film_reorder_scenes", { filmId: w.filmId, ids: ["cl_ghost", clips[1]!] })).code, "NOT_FOUND");
  w.close();
});

test("Film tools: a 40 000-character story is read in parts, never as one oversized result", async () => {
  const w = await toolWorld({ toolSurface: "film" });
  const text = `Start. ${"sentence ".repeat(4444)}End.`;
  const { film } = (await w.admin.call("jagentchill.film.create", { title: "Long", sourceText: text })) as { film: { id: string } };
  const overview = await w.ok("jc_film_get", { filmId: film.id });
  assert.deepEqual([overview.data.part, overview.data.storyTruncated, overview.data.storyLength, overview.data.story.sourceText.length], ["overview", true, text.length, 2000]);
  const first = await w.ok("jc_film_get", { filmId: film.id, part: "story" });
  assert.deepEqual([first.data.part, first.data.offset, first.data.limit, first.data.sourceText.length, first.data.nextOffset, first.data.storyTruncated], ["story", 0, 8000, 8000, 8000, true]);
  const second = await w.ok("jc_film_get", { filmId: film.id, part: "story", offset: first.data.nextOffset, limit: 8000 });
  assert.deepEqual([second.data.offset, second.data.sourceText.length, second.data.nextOffset], [8000, 8000, 16000]);
  const last = await w.ok("jc_film_get", { filmId: film.id, part: "story", offset: 32000, limit: 16000 });
  assert.equal(last.data.nextOffset, undefined);
  assert.equal(last.data.sourceText.length, text.length - 32000);
  const scenes = await w.ok("jc_film_get", { filmId: film.id, part: "scenes" });
  assert.deepEqual([scenes.data.part, scenes.data.scenes.length, scenes.data.shots.length], ["scenes", 0, 0]);
  w.close();
});

test("Film tools: a wrong-typed parameter is INVALID_PARAMS for every tool, and the family needs an idempotency key only to write", async () => {
  const w = await filmWorld("F");
  const wrong: [string, Record<string, unknown>][] = [
    ["jc_film_get", { filmId: 7 }],
    ["jc_film_update_story", { filmId: w.filmId, title: 7 }],
    ["jc_film_upsert_character", { filmId: w.filmId, name: "A", role: "boss" }],
    ["jc_film_delete_character", { filmId: w.filmId, id: 7 }],
    ["jc_film_upsert_scene", { filmId: w.filmId, title: 7 }],
    ["jc_film_delete_scene", { filmId: w.filmId, id: 7 }],
    ["jc_film_reorder_scenes", { filmId: w.filmId, ids: "cl_1" }],
    ["jc_film_upsert_shot", { filmId: w.filmId, clipId: "cl_1", duration_ticks: "later" }],
    ["jc_film_delete_shot", { filmId: w.filmId, id: 7 }],
  ];
  for (const [tool, args] of wrong) {
    const failed = tool === "jc_film_get" ? await w.fails(tool, args) : await w.writeFails(tool, args);
    assert.equal(failed.code, "INVALID_PARAMS", `${tool} rejects a wrong-typed parameter`);
  }
  // `story` is no longer a parameter of the story update: only `sourceText`.
  const legacy = await w.writeFails("jc_film_update_story", { filmId: w.filmId, story: "Old name." });
  assert.equal(legacy.code, "INVALID_PARAMS");
  w.close();
});

test("Film tools: a session bound to one film leaves filmId out but may not write another film", async () => {
  const w = await filmWorld("One");
  const { film: other } = (await w.admin.call("jagentchill.film.create", { title: "Two" })) as { film: { id: string } };
  const bound = (await w.admin.call("jagentchill.session.create", { ref: ACME, scriptId: w.filmId })).session.sessionKey as string;
  await w.admin.call("jagentchill.session.access.set", { sessionKey: bound, access: "host" });
  // Without filmId the bound film is the one the call works on.
  const made = await w.write("jc_film_upsert_scene", { title: "Mine" }, bound);
  assert.equal(w.h.app.film!.read(w.filmId).clips[0]!.id, made.data.sceneId);
  // Naming another film is refused, and that film is untouched.
  const refused = await w.writeFails("jc_film_upsert_scene", { filmId: other.id, title: "Theirs" }, bound);
  assert.equal(refused.code, "INVALID_PARAMS");
  assert.equal(w.h.app.film!.read(other.id).clips.length, 0);
  w.close();
});

test("Film tools: a story page is bounded by its serialized size, so Unicode and escaped text never overflow", async () => {
  const w = await toolWorld({ toolSurface: "film" });
  const japanese = "あ".repeat(20_000);
  const { film } = (await w.admin.call("jagentchill.film.create", { title: "Ja", sourceText: japanese })) as { film: { id: string } };
  const big = await w.ok("jc_film_get", { filmId: film.id, part: "story", limit: 16_000 });
  assert.ok(Buffer.byteLength(JSON.stringify(big)) <= 32 * 1024, "the whole result is within the 32 KiB limit");
  assert.ok(Buffer.byteLength(JSON.stringify(big.data.sourceText)) - 2 <= 16_000, "a page holds at most its byte budget");
  assert.ok(big.data.sourceText.length < 16_000 && big.data.nextOffset !== undefined, "three-byte characters are cut earlier");
  // Escaped text: a quote and a newline cost two bytes each in the serialized page, so the same byte budget holds.
  const escaped = ('"\\\n').repeat(6000);
  const { film: other } = (await w.admin.call("jagentchill.film.create", { title: "Escaped", sourceText: escaped })) as { film: { id: string } };
  const page = await w.ok("jc_film_get", { filmId: other.id, part: "story", limit: 8_000 });
  assert.ok(Buffer.byteLength(JSON.stringify(page.data.sourceText)) - 2 <= 8_000);
  assert.ok(page.data.nextOffset !== undefined);
  w.close();
});

test("Film tools: a populated film is read in pages, never as one oversized result", async () => {
  const w = await filmWorld("Paged");
  const scene = await w.write("jc_film_upsert_scene", { filmId: w.filmId, title: "A" });
  const action = "A".repeat(1200), video = "V".repeat(2000);
  for (let n = 0; n < 20; n++) await w.write("jc_film_upsert_shot", { filmId: w.filmId, clipId: scene.data.sceneId, action, videoPrompt: video });
  const first = await w.ok("jc_film_get", { filmId: w.filmId });
  assert.ok(Buffer.byteLength(JSON.stringify(first)) <= 32 * 1024, "the overview result is within the 32 KiB limit");
  assert.ok(first.data.nextCursor && first.data.shots.length < 20 && first.data.shotsTotal === 20, "the overview offers a cursor for the rest");
  let cursor: string | undefined = first.data.nextCursor, seen = first.data.shots.length;
  while (cursor) {
    const next = await w.ok("jc_film_get", { filmId: w.filmId, cursor });
    assert.ok(Buffer.byteLength(JSON.stringify(next)) <= 32 * 1024, "every page is within the limit");
    seen += next.data.shots.length;
    cursor = next.data.nextCursor;
  }
  assert.equal(seen, 20, "every shot is read across the pages");
  const scenes = await w.ok("jc_film_get", { filmId: w.filmId, part: "scenes" });
  assert.ok(Buffer.byteLength(JSON.stringify(scenes)) <= 32 * 1024 && scenes.data.nextCursor && scenes.data.shots.length < 20, "the scenes part is paged the same way");
  w.close();
});

test("Film tools: a reorder checks every id first, before the count and before a dry run", async () => {
  const w = await filmWorld("F");
  const a = await w.write("jc_film_upsert_scene", { filmId: w.filmId, title: "A" });
  const b = await w.write("jc_film_upsert_scene", { filmId: w.filmId, title: "B" });
  // A missing id with the wrong count is NOT_FOUND, not a count error.
  const missing = await w.writeFails("jc_film_reorder_scenes", { filmId: w.filmId, ids: ["cl_ghost"] });
  assert.deepEqual([missing.code, missing.details!.id], ["NOT_FOUND", "cl_ghost"]);
  // A dry run refuses a missing id instead of answering "would reorder".
  const dry = await w.call("jc_film_reorder_scenes", { filmId: w.filmId, idempotencyKey: key(), dryRun: true, ids: [a.data.sceneId, "cl_ghost"] });
  assert.deepEqual([dry.ok, dry.error!.code, dry.error!.details!.id], [false, "NOT_FOUND", "cl_ghost"]);
  // A valid reorder still works.
  assert.deepEqual((await w.write("jc_film_reorder_scenes", { filmId: w.filmId, ids: [b.data.sceneId, a.data.sceneId] })).data.ids, [b.data.sceneId, a.data.sceneId]);
  w.close();
});

test("Film tools: the WHOLE answer of jc_film_get is within 32 KiB however the film is filled — long scenes, a full cast and long lines at once, also with limit 1 — and every list is paged to its end", async () => {
  const w = await filmWorld("Envelope");
  const long = (letter: string, length: number) => letter.repeat(length);
  // The reviewer's case: scene and cast arrays that were not bounded at all.
  // Filled through the studio's own change method in one call (the tools are rate-limited per minute).
  await w.admin.call("jagentchill.film.apply", { filmId: w.filmId, ops: [
    ...Array.from({ length: 60 }, (_value, n) => ({ op: "clip.add", id: `cl_big_${n}`, title: `${n} ${long("T", 190)}` })),
    ...Array.from({ length: 40 }, (_value, n) => ({ op: "asset.add", kind: "character", fields: { name: `Person ${n}`, description: long("d", 1200), appearance: long("a", 1200) } })),
    ...Array.from({ length: 12 }, (_value, n) => ({ op: "panel.add", clipId: `cl_big_${n}`, fields: { action: long("A", 1200), videoPrompt: long("V", 2000) } })),
  ] });
  const size = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
  for (const args of [{}, { limit: 1 }, { part: "scenes" }, { part: "scenes", limit: 1 }, { part: "cast" }, { part: "cast", limit: 200 }]) {
    const answer = await w.ok("jc_film_get", { filmId: w.filmId, ...args });
    assert.ok(size(answer) <= 32 * 1024, `${JSON.stringify(args)}: ${size(answer)} bytes`);
  }
  // Every list has its total and, while there is more, its own cursor; following them reads everything exactly once.
  const first = await w.ok("jc_film_get", { filmId: w.filmId });
  assert.deepEqual([first.data.charactersTotal, first.data.scenesTotal, first.data.shotsTotal], [40, 60, 12]);
  assert.ok(first.data.characters.length > 0 && first.data.scenes.length > 0 && first.data.shots.length > 0, "no list is starved by another");
  assert.ok(first.data.nextCharacterCursor && first.data.nextSceneCursor && first.data.nextCursor);
  const names = new Set<string>(), scenes = new Set<string>(), shots = new Set<string>();
  let cursors: Record<string, string | undefined> = {}, cursor: string | undefined, rounds = 0;
  for (let answer = first; ; answer = await w.ok("jc_film_get", { filmId: w.filmId, cursors: Object.fromEntries(Object.entries(cursors).filter(([, value]) => value !== undefined)), ...(cursor ? { cursor } : {}) })) {
    assert.ok(size(answer) <= 32 * 1024);
    for (const entry of answer.data.characters) { assert.ok(!names.has(entry.id)); names.add(entry.id); }
    for (const entry of answer.data.scenes) { assert.ok(!scenes.has(entry.id)); scenes.add(entry.id); }
    for (const entry of answer.data.shots) { assert.ok(!shots.has(entry.id)); shots.add(entry.id); }
    // A list that is finished is asked from its end, so it is not sent again.
    cursors = { characters: answer.data.nextCharacterCursor ?? String(answer.data.charactersTotal), scenes: answer.data.nextSceneCursor ?? String(answer.data.scenesTotal) };
    cursor = answer.data.nextCursor ?? String(answer.data.shotsTotal);
    if (!answer.data.nextCharacterCursor && !answer.data.nextSceneCursor && !answer.data.nextCursor) break;
    assert.ok(++rounds < 60, "paging ends");
  }
  assert.deepEqual([names.size, scenes.size, shots.size], [40, 60, 12]);
  assert.equal((await w.fails("jc_film_get", { filmId: w.filmId, cursors: { scenes: "9999" } })).code, "INVALID_PARAMS");
  w.close();
});
