// The Gateway in these tests is the FAKE of `harness.ts`; devices are simulated. The server, sync and the tools are real.
import assert from "node:assert/strict";
import { test } from "node:test";
import { timeline } from "@jagentchill/editor-core";
import { S, toolWorld } from "./support/tools.ts";

const spans = (elements: timeline.El[]) => elements.map((element) => [element.startTime / S, element.duration / S]);

test("Add an overlay track; Remove a non-empty track; Zone and type do not fit; Track volume and solo; Track volume out of range; Actionable message", async () => {
  const w = await toolWorld();
  const added = await w.write("jc_track_edit", { action: "add", zone: "overlay", type: "video", index: 0, name: "B-roll" });
  let scene = w.scene(await w.proposed());
  assert.deepEqual([scene.tracks.overlay[0].id, scene.tracks.overlay[0].name, added.data.index], [added.data.trackId, "B-roll", 0], "a top-most overlay track");
  const mismatch = await w.writeFails("jc_track_edit", { action: "add", zone: "audio", type: "text" });
  assert.equal(mismatch.code, "TRACK_KIND_MISMATCH");
  assert.equal((await w.writeFails("jc_track_edit", { action: "add", zone: "overlay" })).code, "INVALID_PARAMS");
  // Volume, pan and solo of a music track.
  await w.write("jc_track_edit", { action: "set_volume", trackId: w.project.musicTrack, volume: -6 });
  await w.write("jc_track_edit", { action: "solo", trackId: w.project.musicTrack });
  await w.write("jc_track_edit", { action: "set_pan", trackId: w.project.musicTrack, pan: -40 });
  await w.write("jc_track_edit", { action: "set_ducking", trackId: w.project.musicTrack, ducking: { enabled: true, amount: 9 } });
  await w.write("jc_track_edit", { action: "pin", trackId: w.project.musicTrack });
  await w.write("jc_track_edit", { action: "rename", trackId: w.project.musicTrack, name: "Music" });
  scene = w.scene(await w.proposed());
  const music = scene.tracks.audio[0] as any;
  assert.deepEqual([music.volume, music.solo, music.pan, music.ducking.enabled, music.ducking.amount, music.pinned, music.name], [-6, true, -40, true, 9, true, "Music"]);
  const loud = await w.writeFails("jc_track_edit", { action: "set_volume", trackId: w.project.musicTrack, volume: 20 });
  assert.deepEqual([loud.code, loud.details], ["OUT_OF_RANGE", { field: "volume", min: -60, max: 12, value: 20 }]);
  assert.equal((scene.tracks.audio[0] as any).volume, -6, "nothing was staged by the refused call");
  assert.equal((await w.writeFails("jc_track_edit", { action: "set_ducking", trackId: w.project.musicTrack, ducking: { enabled: true, amount: 45 } })).code, "OUT_OF_RANGE");
  // A state a track type does not carry.
  assert.equal((await w.writeFails("jc_track_edit", { action: "hide", trackId: w.project.musicTrack })).code, "TRACK_KIND_MISMATCH");
  const text = await w.write("jc_track_edit", { action: "add", zone: "overlay", type: "text" });
  assert.equal((await w.writeFails("jc_track_edit", { action: "mute", trackId: text.data.trackId })).code, "TRACK_KIND_MISMATCH");
  await w.write("jc_track_edit", { action: "hide", trackId: text.data.trackId });
  await w.write("jc_track_edit", { action: "reorder", trackId: text.data.trackId, index: 1 });
  assert.equal((await w.writeFails("jc_track_edit", { action: "reorder", trackId: text.data.trackId, index: 7 })).code, "OUT_OF_RANGE");
  // The main track is fixed; a track with elements needs the flag.
  assert.equal((await w.writeFails("jc_track_edit", { action: "remove", trackId: w.project.mainTrackId })).code, "INVALID_PARAMS");
  assert.equal((await w.writeFails("jc_track_edit", { action: "reorder", trackId: w.project.mainTrackId, index: 0 })).code, "INVALID_PARAMS");
  const holds = await w.writeFails("jc_track_edit", { action: "remove", trackId: w.project.musicTrack });
  assert.equal(holds.code, "INVALID_PARAMS");
  assert.match(holds.message, /holds 1 elements/);
  assert.equal((await w.writeFails("jc_track_edit", { action: "lock", trackId: "nope" })).code, "TRACK_NOT_FOUND");
  // A locked track rejects every element write until it is unlocked; the error says how.
  await w.write("jc_track_edit", { action: "lock", trackId: w.project.mainTrackId });
  const locked = await w.writeFails("jc_clip_move", { elementIds: [w.project.clipB], delta: S });
  assert.equal(locked.code, "TRACK_LOCKED");
  assert.match(locked.message, /Main Track/);
  assert.match(locked.message, /unlock/i);
  assert.match(locked.message, /jc_track_edit/);
  for (const [tool, args] of [["jc_clip_trim", { elementId: w.project.clipA, edge: "end", delta: -S }], ["jc_clip_split", { elementIds: [w.project.clipA], times: [2 * S] }], ["jc_clip_delete", { elementIds: [w.project.clipA] }], ["jc_clip_rename", { elementId: w.project.clipA, name: "x" }]] as const) assert.equal((await w.writeFails(tool, args)).code, "TRACK_LOCKED", tool);
  await w.write("jc_track_edit", { action: "unlock", trackId: w.project.mainTrackId });
  await w.write("jc_track_edit", { action: "remove", trackId: w.project.musicTrack, removeElements: true });
  assert.equal(w.scene(await w.proposed()).tracks.audio.length, 0);
  // 99 overlay tracks, not one more.
  const full = await toolWorld({ empty: true });
  for (let index = 0; index < 99; index++) await full.write("jc_track_edit", { action: "add", zone: "audio", type: "audio" });
  const beyond = await full.writeFails("jc_track_edit", { action: "add", zone: "audio", type: "audio" });
  assert.deepEqual([beyond.code, beyond.details?.max], ["OUT_OF_RANGE", 99]);
  full.close();
  w.close();
});

test("Append to the main track; Overlap rejected; Wrong track kind; Atomic multi-item call; clip add placements and modes", async () => {
  const w = await toolWorld();
  // Appending a 6 s clip to a main track that ends at 30 s.
  const appended = await w.write("jc_clip_add", { assetId: w.project.assets.silent });
  assert.deepEqual([appended.data.elements[0].start, appended.data.elements[0].duration, appended.data.elements[0].trackId, appended.data.sceneDuration], [30 * S, 6 * S, w.project.mainTrackId, 36 * S]);
  // An image defaults to 5 s; a part of a video by its source range.
  const photo = await w.write("jc_clip_add", { assetId: w.project.assets.photo, newTrack: { zone: "overlay", type: "video" }, start: 2 * S });
  const overlay = photo.data.elements[0].trackId;
  assert.deepEqual([photo.data.elements[0].duration, photo.data.elements[0].createdTrack], [5 * S, true]);
  const part = await w.write("jc_clip_add", { assetId: w.project.assets.interview, trackId: overlay, start: 10 * S, sourceIn: 4 * S, sourceOut: 9 * S, name: "Mai, close", transform: { scale: 0.5, position: { x: 400, y: -200 }, opacity: 0.9 }, volume: -12 });
  const cut = await w.element(part.data.elementIds[0]) as any;
  assert.deepEqual([cut.startTime, cut.duration, cut.trimStart, cut.trimEnd, cut.name, cut.transform.scale, cut.transform.position, cut.opacity, cut.volume], [10 * S, 5 * S, 4 * S, 11 * S, "Mai, close", { x: 0.5, y: 0.5 }, { x: 400, y: -200 }, 0.9, -12]);
  // An occupied range on an overlay track: the conflicting elements and the nearest free start.
  const overlap = await w.writeFails("jc_clip_add", { assetId: w.project.assets.photo, trackId: overlay, start: 4 * S });
  assert.deepEqual([overlap.code, overlap.details?.conflictingElementIds, overlap.details?.nearestFreeStart], ["OVERLAP_NOT_ALLOWED", [photo.data.elementIds[0]], 15 * S]);
  await w.write("jc_clip_add", { assetId: w.project.assets.photo, trackId: overlay, start: 4 * S, duration: 2 * S, mode: "overwrite" });
  assert.deepEqual(spans(w.scene(await w.proposed()).tracks.overlay[0].elements), [[2, 2], [4, 2], [6, 1], [10, 5]], "overwrite cut the photo around the new clip");
  await w.write("jc_clip_add", { assetId: w.project.assets.photo, trackId: overlay, start: 4 * S, duration: S, mode: "insert" });
  assert.deepEqual(spans(w.scene(await w.proposed()).tracks.overlay[0].elements), [[2, 2], [4, 1], [5, 2], [7, 1], [11, 5]], "insert moved what followed");
  // Kinds.
  const kind = await w.writeFails("jc_clip_add", { assetId: w.project.assets.music, trackId: overlay, start: 20 * S });
  assert.equal(kind.code, "TRACK_KIND_MISMATCH");
  assert.equal((await w.writeFails("jc_clip_add", { assetId: w.project.assets.drone, trackId: w.project.musicTrack, start: 40 * S })).code, "TRACK_KIND_MISMATCH");
  assert.equal((await w.writeFails("jc_clip_add", { assetId: w.project.assets.music, newTrack: { zone: "overlay", type: "audio" } })).code, "TRACK_KIND_MISMATCH");
  // Audio defaults to a new audio track; source bounds are not clamped.
  const voice = await w.write("jc_clip_add", { assetId: w.project.assets.music, sourceOut: 5 * S });
  assert.deepEqual([voice.data.elements[0].start, voice.data.elements[0].duration, voice.data.elements[0].createdTrack], [0, 5 * S, true]);
  const exhausted = await w.writeFails("jc_clip_add", { assetId: w.project.assets.drone, sourceIn: 8 * S, sourceOut: 12 * S });
  assert.deepEqual([exhausted.code, exhausted.details?.maxTo], ["SOURCE_EXHAUSTED", 10 * S]);
  assert.equal((await w.writeFails("jc_clip_add", { assetId: w.project.assets.photo, sourceIn: S })).code, "UNSUPPORTED_FOR_ELEMENT");
  assert.equal((await w.writeFails("jc_clip_add", { assetId: "nope" })).code, "ASSET_NOT_FOUND");
  assert.equal((await w.writeFails("jc_clip_add", { assetId: w.project.assets.photo, volume: -3 })).code, "UNSUPPORTED_FOR_ELEMENT");
  assert.equal((await w.writeFails("jc_clip_add", { assetId: w.project.assets.drone, transform: { opacity: 1.4 } })).code, "OUT_OF_RANGE");
  // Relative placements; the main track inserts by default.
  const before = await w.write("jc_clip_add", { assetId: w.project.assets.photo, placement: "before_element", anchorElementId: w.project.clipB, duration: 2 * S });
  assert.deepEqual(spans(await w.main()), [[0, 10], [10, 2], [12, 20], [32, 6]]);
  const after = await w.write("jc_clip_add", { assetId: w.project.assets.photo, placement: "after_element", anchorElementId: before.data.elementIds[0], duration: S });
  assert.deepEqual(spans(await w.main()), [[0, 10], [10, 2], [12, 1], [13, 20], [33, 6]]);
  assert.equal((await w.writeFails("jc_clip_add", { assetId: w.project.assets.photo, placement: "after_element" })).code, "INVALID_PARAMS");
  assert.equal((await w.writeFails("jc_clip_add", { assetId: w.project.assets.photo, start: 3 * S, trackId: w.project.mainTrackId, mode: "fail_on_overlap" })).code, "OVERLAP_NOT_ALLOWED");
  void after;
  // Five items, the third invalid: none is staged and the item is named.
  const count = w.h.app.tools.currentProposal(w.sessionKey)!.changes.length, state = JSON.stringify(await w.proposed());
  const atomic = await w.writeFails("jc_clip_add", { items: [{ assetId: w.project.assets.photo }, { assetId: w.project.assets.photo }, { assetId: "missing" }, { assetId: w.project.assets.photo }, { assetId: w.project.assets.photo }] });
  assert.deepEqual([atomic.code, atomic.details?.index], ["ASSET_NOT_FOUND", 2]);
  assert.equal(w.h.app.tools.currentProposal(w.sessionKey)!.changes.length, count);
  assert.equal(JSON.stringify(await w.proposed()), state);
  const three = await w.write("jc_clip_add", { items: [{ assetId: w.project.assets.photo, duration: S }, { assetId: w.project.assets.photo, duration: S }, { assetId: w.project.assets.silent }] });
  assert.equal(three.data.elementIds.length, 3);
  assert.equal(three.changeIds?.length, 1, "one staged change for the whole call");
  assert.equal((await w.writeFails("jc_clip_add", { items: Array.from({ length: 51 }, () => ({ assetId: w.project.assets.photo })) })).code, "OUT_OF_RANGE");
  w.close();
});

test("Relative timing anchors — jc_clip_add and jc_text_add accept edge, signed offset seconds and resolve to ticks", async () => {
  const w = await toolWorld();
  const clip = await w.write("jc_clip_add", { assetId: w.project.assets.photo, newTrack: { zone: "overlay", type: "video" }, anchor: { elementId: w.project.clipA, edge: "end", offsetSeconds: 0.5 } });
  const clipId = clip.data.elementIds[0];
  let clipElement = await w.element(clipId) as any;
  assert.deepEqual([clipElement.startTime, clipElement.timingAnchor], [10.5 * S, { elementId: w.project.clipA, edge: "end", offsetTicks: 60_000 }]);
  await w.write("jc_clip_move", { elementIds: [clipId], anchor: { elementId: w.project.clipA, edge: "start", offsetSeconds: 1 } });
  clipElement = await w.element(clipId) as any;
  assert.deepEqual([clipElement.startTime, clipElement.timingAnchor.offsetTicks], [S, 120_000]);
  const title = await w.write("jc_text_add", { content: "Title", start: 0, anchor: { elementId: w.project.clipA, edge: "end", offsetSeconds: -0.2 } });
  const text = await w.element(title.data.elementIds[0]) as any;
  assert.deepEqual([text.startTime, text.timingAnchor.offsetTicks], [9.8 * S, -24_000]);
  await w.write("jc_text_update", { elementIds: [title.data.elementIds[0]], anchor: { elementId: w.project.clipA, edge: "start", offsetSeconds: 2 } });
  assert.equal((await w.element(title.data.elementIds[0]) as any).startTime, 2 * S);
  w.close();
});

test("Typed template variables — jc_template_edit fills every bound property in one staged tool call", async () => {
  const w = await toolWorld({ template: true });
  const result = await w.write("jc_template_edit", { variables: { "clip-name": "Opening scene" } });
  const document = await w.proposed();
  assert.deepEqual([result.data.variables, (await w.element(w.project.clipA) as any).name, document.template!.variables[0].value], [["clip-name"], "Opening scene", "Opening scene"]);
  w.close();
});

test("Move a group; Move before zero; Ripple trim; Beyond source media; Split into three; Time outside the element; Host default edit context; Explicit edit context", async () => {
  const w = await toolWorld();
  // Two overlay elements one second apart keep their distance.
  const a = await w.write("jc_clip_add", { assetId: w.project.assets.photo, newTrack: { zone: "overlay", type: "video" }, start: 2 * S, duration: 2 * S });
  const track = a.data.elements[0].trackId;
  const b = await w.write("jc_clip_add", { assetId: w.project.assets.photo, trackId: track, start: 5 * S, duration: 2 * S });
  const moved = await w.write("jc_clip_move", { elementIds: [a.data.elementIds[0], b.data.elementIds[0]], delta: 2 * S });
  assert.deepEqual(moved.data.elements.map((element: any) => element.start / S), [4, 7]);
  const negative = await w.writeFails("jc_clip_move", { elementIds: [a.data.elementIds[0], b.data.elementIds[0]], delta: -5 * S });
  assert.deepEqual([negative.code, negative.details?.min], ["OUT_OF_RANGE", -4 * S]);
  assert.equal((await w.writeFails("jc_clip_move", { elementIds: [a.data.elementIds[0]], start: 6 * S })).code, "OVERLAP_NOT_ALLOWED");
  await w.write("jc_clip_move", { elementIds: [a.data.elementIds[0]], start: 6 * S, mode: "overwrite" });
  assert.deepEqual(spans(w.scene(await w.proposed()).tracks.overlay[0].elements), [[6, 2], [8, 1]]);
  // To another track of the same kind; never to a track of another kind.
  const second = await w.write("jc_track_edit", { action: "add", zone: "overlay", type: "video" });
  const across = await w.write("jc_clip_move", { elementIds: [a.data.elementIds[0]], toTrackId: second.data.trackId, start: 20 * S });
  assert.deepEqual([across.data.elements[0].trackId, across.data.elements[0].start], [second.data.trackId, 20 * S]);
  assert.equal((await w.writeFails("jc_clip_move", { elementIds: [a.data.elementIds[0]], toTrackId: w.project.musicTrack })).code, "TRACK_KIND_MISMATCH");
  assert.equal((await w.writeFails("jc_clip_move", { elementIds: [a.data.elementIds[0]], toTrackId: "nope" })).code, "TRACK_NOT_FOUND");
  assert.equal((await w.writeFails("jc_clip_move", { elementIds: ["nope"], delta: S })).code, "ELEMENT_NOT_FOUND");
  // snap: within five frames of an element edge.
  const snapped = await w.write("jc_clip_move", { elementIds: [a.data.elementIds[0]], start: 10 * S + 12_000, snap: true });
  assert.equal(snapped.data.elements[0].start, 10 * S, "snapped to the cut between the two main clips");
  await w.ok("jc_proposal_discard");

  // Ripple trim of a main-track clip: the following clip starts two seconds earlier and no gap remains.
  const trimmed = await w.write("jc_clip_trim", { elementId: w.project.clipA, edge: "end", delta: -2 * S, ripple: true });
  assert.deepEqual([trimmed.data.duration, trimmed.changeIds?.length], [8 * S, 1]);
  assert.deepEqual(spans(await w.main()), [[0, 8], [8, 20]]);
  // A clip that uses its whole source cannot be extended.
  const beyond = await w.writeFails("jc_clip_trim", { elementId: w.project.clipB, edge: "end", delta: S });
  assert.deepEqual([beyond.code, beyond.details?.maxTo], ["SOURCE_EXHAUSTED", 28 * S]);
  const back = await w.write("jc_clip_trim", { elementId: w.project.clipA, edge: "end", to: 10 * S });
  assert.equal(back.data.duration, 10 * S);
  assert.equal((await w.writeFails("jc_clip_trim", { elementId: w.project.clipA, edge: "end", to: 0 })).code, "OUT_OF_RANGE", "at least one frame stays");
  assert.equal((await w.writeFails("jc_clip_trim", { elementId: w.project.clipA, edge: "end", to: 5 * S, delta: -S })).code, "INVALID_PARAMS");
  await w.write("jc_clip_trim", { elementId: w.project.clipA, edge: "start", delta: 3 * S });
  assert.deepEqual([(await w.element(w.project.clipA)).trimStart, (await w.element(w.project.clipA)).duration], [3 * S, 7 * S]);
  // Without ripple a neighbour stops the edge.
  const o1 = await w.write("jc_clip_add", { assetId: w.project.assets.silent, newTrack: { zone: "overlay", type: "video" }, start: 0, sourceOut: 3 * S });
  await w.write("jc_clip_add", { assetId: w.project.assets.photo, trackId: o1.data.elements[0].trackId, start: 4 * S, duration: S });
  const blocked = await w.writeFails("jc_clip_trim", { elementId: o1.data.elementIds[0], edge: "end", delta: 2 * S });
  assert.deepEqual([blocked.code, blocked.details?.maxTo], ["OVERLAP_NOT_ALLOWED", 4 * S]);
  await w.write("jc_clip_trim", { elementId: o1.data.elementIds[0], edge: "end", delta: 2 * S, ripple: true });
  assert.deepEqual(spans(w.scene(await w.proposed()).tracks.overlay[0].elements), [[0, 5], [6, 1]]);
  // Both source bounds at once.
  const ranged = await w.write("jc_clip_set_range", { elementId: w.project.clipB, sourceIn: 5 * S, sourceOut: 9 * S });
  assert.deepEqual([ranged.data.duration, (await w.element(w.project.clipB)).trimStart, (await w.element(w.project.clipB)).trimEnd], [4 * S, 5 * S, 11 * S]);
  assert.equal((await w.writeFails("jc_clip_set_range", { elementId: w.project.clipB, sourceIn: 5 * S, sourceOut: 25 * S })).code, "SOURCE_EXHAUSTED");
  assert.equal((await w.writeFails("jc_clip_set_range", { elementId: w.project.clipB, sourceIn: 9 * S, sourceOut: 5 * S })).code, "OUT_OF_RANGE");
  await w.ok("jc_proposal_discard");

  // A 10 s element split at 3 s and 7 s.
  const split = await w.write("jc_clip_split", { elementIds: [w.project.clipA], times: [3 * S, 7 * S] });
  assert.equal(split.data.elementIds.length, 3);
  assert.deepEqual(split.data.parts.map((part: any) => [part.start / S, part.duration / S]), [[0, 3], [3, 4], [7, 3]]);
  assert.equal(split.data.elementIds[0], w.project.clipA, "the ids come back in time order");
  const outside = await w.write("jc_clip_split", { elementIds: [w.project.clipB], times: [10 * S] });
  assert.deepEqual([outside.warnings, outside.changeIds], [["time_outside_element", "no_change"], []]);
  const all = await w.write("jc_clip_split", { allAtTime: true, times: [15 * S] });
  assert.equal(all.data.elementIds.length, 4, "the interview and the music, each in two parts");
  const kept = await w.write("jc_clip_split", { elementIds: [split.data.elementIds[2]], times: [8 * S], keep: "left" });
  assert.deepEqual(kept.data.parts.map((part: any) => [part.start / S, part.duration / S]), [[7, 1]]);
  assert.deepEqual(spans(await w.main()).slice(0, 4), [[0, 3], [3, 4], [7, 1], [10, 5]], "the other part is deleted without closing the gap");
  assert.equal((await w.writeFails("jc_clip_split", { elementIds: [w.project.clipA], allAtTime: true, times: [S] })).code, "INVALID_PARAMS");
  assert.equal((await w.writeFails("jc_clip_split", { elementIds: [w.project.clipA], times: Array.from({ length: 101 }, (_, index) => index) })).code, "OUT_OF_RANGE");
  await w.ok("jc_proposal_discard");

  // Deleting a main-track clip: the host default closes the gap whatever the device prefers; an explicit context keeps it.
  await w.write("jc_clip_delete", { elementIds: [w.project.clipA] });
  assert.deepEqual(spans(await w.main()), [[0, 20]], "magnet: true is the host default");
  await w.ok("jc_proposal_discard");
  await w.write("jc_clip_delete", { elementIds: [w.project.clipA], editContext: { magnet: false } });
  assert.deepEqual(spans(await w.main()), [[10, 20]], "a gap of the removed duration remains");
  assert.equal((await w.writeFails("jc_clip_delete", { elementIds: [w.project.clipA] })).code, "ELEMENT_NOT_FOUND");
  assert.equal((await w.writeFails("jc_clip_delete", { elementIds: [w.project.clipB], editContext: { magnets: true } })).code, "INVALID_PARAMS");
  w.close();
});

test("Remove silences; Single range without ripple; Close gaps; Locked track blocks ripple; Filler removal through the source-range form", async () => {
  const w = await toolWorld();
  // Twelve silence ranges totalling nine seconds, rippled on every track.
  const silences = Array.from({ length: 12 }, (_, index) => ({ start: (1 + index * 2) * S, end: (1 + index * 2) * S + (index % 2 === 0 ? S : S / 2) }));
  const removed = await w.write("jc_range_delete", { ranges: silences, ripple: true });
  assert.deepEqual([removed.data.removedDuration, removed.data.sceneDuration, removed.changeIds?.length], [9 * S, 21 * S, 1]);
  let scene = w.scene(await w.proposed());
  assert.deepEqual(timeline.trackGaps(scene.tracks.main), []);
  assert.equal(timeline.sceneDurationOf(scene), 21 * S);
  assert.equal(scene.tracks.main.elements.reduce((sum, element) => sum + element.duration, 0), 21 * S);
  await w.ok("jc_proposal_discard");
  // One range on one track without ripple: a gap stays, the other tracks are untouched.
  const single = await w.write("jc_range_delete", { ranges: [{ start: 2 * S, end: 4 * S }], trackIds: [w.project.musicTrack] });
  scene = w.scene(await w.proposed());
  assert.deepEqual(spans(scene.tracks.audio[0].elements), [[0, 2], [4, 26]]);
  assert.deepEqual(spans(scene.tracks.main.elements), [[0, 10], [10, 20]]);
  assert.equal(single.data.removedDuration, 2 * S);
  // A locked music track in the way of a ripple over all tracks.
  await w.write("jc_track_edit", { action: "lock", trackId: w.project.musicTrack });
  const locked = await w.writeFails("jc_range_delete", { ranges: [{ start: 12 * S, end: 14 * S }], allTracks: true, ripple: true });
  assert.equal(locked.code, "TRACK_LOCKED");
  assert.match(locked.message, /Audio track/);
  // Without allTracks the locked track is simply left alone.
  await w.write("jc_range_delete", { ranges: [{ start: 12 * S, end: 14 * S }], ripple: true });
  scene = w.scene(await w.proposed());
  assert.deepEqual(spans(scene.tracks.main.elements), [[0, 10], [10, 2], [12, 16]]);
  assert.deepEqual(spans(scene.tracks.audio[0].elements), [[0, 2], [4, 26]], "elements on a locked track are never altered");
  assert.equal((await w.writeFails("jc_range_delete", { ranges: [{ start: S, end: 2 * S }], sourceRanges: [{ sourceStart: 0, sourceEnd: S }], elementId: w.project.clipA })).code, "INVALID_PARAMS");
  assert.equal((await w.writeFails("jc_range_delete", { ranges: [{ start: 4 * S, end: 2 * S }] })).code, "INVALID_PARAMS");
  await w.ok("jc_proposal_discard");

  // Two gaps of 1 s and 3 s on the main track.
  await w.write("jc_range_delete", { ranges: [{ start: 2 * S, end: 3 * S }, { start: 12 * S, end: 15 * S }], trackIds: [w.project.mainTrackId] });
  assert.equal(timeline.trackGaps(w.scene(await w.proposed()).tracks.main).length, 2);
  const closed = await w.write("jc_gap_close", {});
  assert.deepEqual([closed.data.closedGaps, closed.data.closedDuration], [2, 4 * S]);
  scene = w.scene(await w.proposed());
  assert.deepEqual(timeline.trackGaps(scene.tracks.main), []);
  assert.equal(scene.tracks.main.elements.reduce((latest, element) => Math.max(latest, element.startTime + element.duration), 0), 26 * S, "the main track is 4 s shorter");
  assert.deepEqual((await w.write("jc_gap_close", {})).warnings, ["no_change"]);
  await w.ok("jc_proposal_discard");

  // Three filler ranges of a clip, given in its source time: one RemoveSourceRanges change.
  const filler = await w.write("jc_range_delete", { elementId: w.project.clipB, sourceRanges: [{ sourceStart: 2 * S, sourceEnd: 3 * S }, { sourceStart: 8 * S, sourceEnd: 8 * S + 60_000 }, { sourceStart: 15 * S, sourceEnd: 16 * S }] });
  assert.deepEqual([filler.data.removedCount, filler.data.removedDuration, filler.changeIds?.length], [3, 2 * S + 60_000, 1]);
  const change = w.h.app.tools.currentProposal(w.sessionKey)!.changes[0];
  assert.deepEqual([change.tool, change.kind], ["jc_range_delete", "remove"]);
  // The same timeline as the transcript view's cut: the command the editor runs.
  const expected = timeline.executeCommand(w.head(), { now_ms: 1, newId: () => crypto.randomUUID() }, timeline.HOST_EDIT_CONTEXT, timeline.removeSourceRanges({ sceneId: w.project.sceneId, elementId: w.project.clipB, ranges: [{ sourceStart: 2 * S, sourceEnd: 3 * S }, { sourceStart: 8 * S, sourceEnd: 8 * S + 60_000 }, { sourceStart: 15 * S, sourceEnd: 16 * S }] })).commit.document;
  assert.deepEqual(spans(await w.main()), spans(w.scene(expected).tracks.main.elements));
  assert.deepEqual(spans(await w.main()), [[0, 10], [10, 2], [12, 5], [17, 6.5], [23.5, 4]]);
  assert.equal((await w.writeFails("jc_range_delete", { sourceRanges: [{ sourceStart: 0, sourceEnd: S }] })).code, "INVALID_PARAMS");
  w.close();
});

test("Same result as the UI", async () => {
  const w = await toolWorld();
  // A split through the tool and the split command the editor's toolbar runs, on identical projects with the same edit context.
  await w.write("jc_clip_split", { elementIds: [w.project.clipA], times: [4 * S] });
  const viaTool = await w.proposed();
  const viaEditor = timeline.executeCommand(w.head(), { now_ms: 1, newId: () => crypto.randomUUID() }, timeline.HOST_EDIT_CONTEXT, timeline.split({ sceneId: w.project.sceneId, time: 4 * S, elementIds: [w.project.clipA] })).commit.document;
  const shape = (doc: typeof viaTool) => JSON.stringify(w.scene(doc).tracks.main.elements.map(({ id: _id, ...rest }) => rest), (name, value) => (name === "id" || name === "linkId" ? undefined : value));
  assert.equal(shape(viaTool), shape(viaEditor), "equal apart from generated ids");
  w.close();
});
