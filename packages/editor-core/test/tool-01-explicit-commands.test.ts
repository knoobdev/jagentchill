import assert from "node:assert/strict";
import { test } from "node:test";
import { DocumentRejected, timeline } from "../src/index.ts";
import { el, ON, OFF, open, overlay, project, RIPPLE, S, spans, withTracks } from "./support/timeline.ts";

// Commands that take explicit values (a time range, a source range, a track setting): what an agent tool and a numeric
// control of the editor both run. None of them clamps a value it is given.

const seeded = () => {
  const session = open(withTracks(project(), ["t-audio", "audio", { pinned: true }]));
  const made = session.execute(timeline.addClips({ sceneId: "s1", clips: [{ assetId: "a4" }, { assetId: "a4", sourceIn: 5 * S, sourceOut: 15 * S }], time: 0, request: { strategy: "mainInsert" } }), ON);
  assert.equal(made.ok, true);
  const music = session.execute(timeline.addClips({ sceneId: "s1", clips: [{ assetId: "a3", sourceOut: 30 * S }], time: 0, request: { strategy: "explicit", trackId: "t-audio" } }), ON);
  assert.equal(music.ok, true);
  return { session, clips: (made as { info: { elementIds: string[] } }).info.elementIds, music: (music as { info: { elementIds: string[] } }).info.elementIds[0] };
};

test("addClips places a chain with explicit source ranges and never clamps them", () => {
  const { session, clips } = seeded();
  assert.deepEqual(spans(session.document, "t-main"), [[0, 20], [20, 30]]);
  assert.deepEqual([el(session.document, clips[1]).trimStart, el(session.document, clips[1]).trimEnd, el(session.document, clips[1]).sourceDuration], [5 * S, 5 * S, 20 * S]);
  const beyond = session.execute(timeline.addClips({ sceneId: "s1", clips: [{ assetId: "a4", sourceIn: 15 * S, sourceOut: 25 * S }], time: 0, request: { strategy: "mainInsert" } }), ON);
  assert.deepEqual([beyond.ok, (beyond as { code?: string }).code], [false, "document/out-of-range"]);
  // An image takes its duration; fields are written on the new element.
  const image = session.execute(timeline.addClips({ sceneId: "s1", clips: [{ assetId: "a2", duration: 2 * S, fields: { opacity: 0.5 } }], time: 3 * S, request: { strategy: "alwaysNew" } }), ON);
  const id = (image as { info: { elementIds: string[]; createdTrack: boolean } }).info.elementIds[0];
  assert.deepEqual([el(session.document, id).startTime, el(session.document, id).duration, el(session.document, id).opacity, (image as { info: { createdTrack: boolean } }).info.createdTrack], [3 * S, 2 * S, 0.5, true]);
  // Video and audio do not share a track in one call.
  assert.equal(session.execute(timeline.addClips({ sceneId: "s1", clips: [{ assetId: "a4" }, { assetId: "a3" }], time: 0, request: { strategy: "firstAvailable" } }), ON).ok, false);
  // One undo step.
  session.undo();
  assert.equal(overlay(session.document).length, 0);
});

test("deleteRanges splits at the boundaries, works from the latest range back, ripples every track and leaves locked tracks alone", () => {
  const { session } = seeded();
  const plain = session.execute(timeline.deleteRanges({ sceneId: "s1", ranges: [{ start: 2 * S, end: 4 * S }], trackIds: ["t-audio"] }), OFF);
  assert.equal(plain.ok, true);
  assert.deepEqual(spans(session.document, "t-audio"), [[0, 2], [4, 30]], "a gap stays without ripple");
  assert.deepEqual(spans(session.document, "t-main"), [[0, 20], [20, 30]], "other tracks are unchanged");
  session.undo();
  const rippled = session.execute(timeline.deleteRanges({ sceneId: "s1", ranges: [{ start: 22 * S, end: 23 * S }, { start: 2 * S, end: 4 * S }, { start: 3 * S, end: 5 * S }], ripple: true }), OFF);
  assert.deepEqual((rippled as { info: { removedDuration: number } }).info.removedDuration, 4 * S, "overlapping ranges are merged");
  assert.deepEqual(spans(session.document, "t-main"), [[0, 2], [2, 17], [17, 19], [19, 26]]);
  assert.deepEqual(spans(session.document, "t-audio"), [[0, 2], [2, 19], [19, 26]]);
  assert.deepEqual(timeline.trackGaps(timeline.sceneById(session.document, "s1").tracks.main), []);
  session.undo();
  session.execute(timeline.setTrackState({ trackId: "t-audio", state: { locked: true } }), OFF);
  session.execute(timeline.deleteRanges({ sceneId: "s1", ranges: [{ start: 2 * S, end: 4 * S }], ripple: true }), OFF);
  assert.deepEqual(spans(session.document, "t-audio"), [[0, 30]], "elements on a locked track are never altered");
  const strict = session.execute(timeline.deleteRanges({ sceneId: "s1", ranges: [{ start: 6 * S, end: 7 * S }], ripple: true, strictLocks: true }), OFF);
  assert.deepEqual([strict.ok, (strict as { code?: string }).code], [false, "track-locked"]);
});

test("closeTrackGaps, makeRoom and trackGaps", () => {
  const { session } = seeded();
  session.execute(timeline.deleteRanges({ sceneId: "s1", ranges: [{ start: 2 * S, end: 3 * S }, { start: 12 * S, end: 15 * S }], trackIds: ["t-main"] }), OFF);
  assert.deepEqual(timeline.trackGaps(timeline.sceneById(session.document, "s1").tracks.main), [{ start: 2 * S, duration: S }, { start: 12 * S, duration: 3 * S }]);
  assert.deepEqual(timeline.trackGaps(timeline.sceneById(session.document, "s1").tracks.main, undefined, 2 * S), [{ start: 12 * S, duration: 3 * S }]);
  const closed = session.execute(timeline.closeTrackGaps({ sceneId: "s1", trackId: "t-main", minGap: 2 * S }), OFF);
  assert.deepEqual((closed as { info: { closed: number; closedDuration: number } }).info, { closed: 1, closedDuration: 3 * S });
  session.execute(timeline.closeTrackGaps({ sceneId: "s1", trackId: "t-main" }), OFF);
  assert.deepEqual(timeline.trackGaps(timeline.sceneById(session.document, "s1").tracks.main), []);
  assert.deepEqual(spans(session.document, "t-main").at(-1), [16, 26]);
  session.execute(timeline.makeRoom({ sceneId: "s1", trackId: "t-audio", time: 30 * S, duration: 2 * S }), OFF);
  assert.deepEqual(spans(session.document, "t-audio"), [[0, 30]], "nothing starts at or after the point");
  const inside = session.execute(timeline.makeRoom({ sceneId: "s1", trackId: "t-audio", time: 10 * S, duration: 2 * S }), OFF);
  assert.deepEqual([inside.ok, (inside as { code?: string }).code], [false, "document/elements-overlap"]);
});

test("setSourceRange keeps the start, follows the rate, and flows only where gaps are closed", () => {
  const { session, clips } = seeded();
  const shorter = session.execute(timeline.setSourceRange({ sceneId: "s1", elementId: clips[0], sourceIn: 4 * S, sourceOut: 10 * S }), ON);
  assert.equal((shorter as { info: { duration: number } }).info.duration, 6 * S);
  assert.deepEqual([el(session.document, clips[0]).trimStart, el(session.document, clips[0]).trimEnd], [4 * S, 10 * S]);
  assert.deepEqual(spans(session.document, "t-main"), [[0, 6], [6, 16]], "the magnet closes the gap on the main track");
  const longer = session.execute(timeline.setSourceRange({ sceneId: "s1", elementId: clips[0], sourceIn: 0, sourceOut: 20 * S }), ON);
  assert.equal(longer.ok, true);
  assert.deepEqual(spans(session.document, "t-main"), [[0, 20], [20, 30]], "the followers move with its end");
  const blocked = session.execute(timeline.setSourceRange({ sceneId: "s1", elementId: clips[1], sourceIn: 0, sourceOut: 10 * S }), OFF);
  assert.equal(blocked.ok, true, "the same length fits where it was");
  const collide = open(session.document);
  collide.execute(timeline.setSourceRange({ sceneId: "s1", elementId: clips[0], sourceIn: 0, sourceOut: 10 * S }), ON);
  assert.deepEqual(spans(collide.document, "t-main"), [[0, 10], [10, 20]]);
  const grown = collide.execute(timeline.setSourceRange({ sceneId: "s1", elementId: clips[0], sourceIn: 0, sourceOut: 20 * S }), OFF);
  assert.deepEqual([grown.ok, (grown as { code?: string }).code], [false, "document/elements-overlap"], "without ripple a longer clip never pushes the next one");
  const outside = session.execute(timeline.setSourceRange({ sceneId: "s1", elementId: clips[0], sourceIn: 0, sourceOut: 25 * S }), RIPPLE);
  assert.deepEqual([outside.ok, (outside as { code?: string }).code], [false, "document/out-of-range"]);
});

test("setTrackState, setSceneRange and setUseProxies write explicit values and reject what does not fit", () => {
  const { session } = seeded();
  assert.equal(session.execute(timeline.setTrackState({ trackId: "t-audio", state: { volume: -6, pan: 30, solo: true, pinned: true } }), OFF).ok, true);
  const track = timeline.sceneById(session.document, "s1").tracks.audio[0];
  assert.deepEqual([track.volume, track.pan, track.solo, track.pinned], [-6, 30, true, true]);
  const loud = session.execute(timeline.setTrackState({ trackId: "t-audio", state: { volume: 40 } }), OFF);
  assert.deepEqual([loud.ok, (loud as { code?: string }).code], [false, "document/out-of-range"], "the validator rejects; nothing is clamped");
  assert.equal(timeline.sceneById(session.document, "s1").tracks.audio[0].volume, -6);
  const hidden = session.execute(timeline.setTrackState({ trackId: "t-audio", state: { hidden: true } }), OFF);
  assert.deepEqual([hidden.ok, (hidden as { code?: string }).code], [false, "unsupported-flag"]);
  session.execute(timeline.setSceneRange({ sceneId: "s1", inPoint: 2 * S + 7, outPoint: 10 * S }), OFF);
  assert.deepEqual([timeline.sceneById(session.document, "s1").inPoint, timeline.sceneById(session.document, "s1").outPoint], [2 * S, 10 * S], "aligned to the frame grid");
  assert.equal(session.execute(timeline.setSceneRange({ sceneId: "s1", inPoint: 12 * S, outPoint: 10 * S }), OFF).ok, false);
  session.execute(timeline.setSceneRange({ sceneId: "s1", inPoint: null, outPoint: null }), OFF);
  assert.deepEqual([timeline.sceneById(session.document, "s1").inPoint, timeline.sceneById(session.document, "s1").outPoint], [undefined, undefined]);
  session.execute(timeline.setUseProxies({ value: false }), OFF);
  assert.equal(session.document.settings.useProxies, false);
});

test("duplicateElements, setElementsHidden, restackElements and insertFreezeFrame", () => {
  const { session, clips, music } = seeded();
  const image = session.execute(timeline.addClips({ sceneId: "s1", clips: [{ assetId: "a2", duration: 2 * S }], time: 4 * S, request: { strategy: "alwaysNew" } }), ON) as { info: { elementIds: string[]; trackId: string } };
  const top = session.execute(timeline.addClips({ sceneId: "s1", clips: [{ assetId: "a2", duration: 2 * S }], time: 4 * S, request: { strategy: "alwaysNew", index: 0 } }), ON) as { info: { elementIds: string[]; trackId: string } };
  const copy = session.execute(timeline.duplicateElements({ sceneId: "s1", elementIds: [image.info.elementIds[0]], offset: 2 * S }), ON) as { info: { elementIds: string[] } };
  assert.deepEqual(spans(session.document, image.info.trackId), [[4, 6], [6, 8]]);
  assert.notEqual(copy.info.elementIds[0], image.info.elementIds[0]);
  const occupied = session.execute(timeline.duplicateElements({ sceneId: "s1", elementIds: [image.info.elementIds[0]], offset: S }), ON);
  assert.deepEqual([occupied.ok, (occupied as { code?: string }).code], [false, "document/elements-overlap"]);
  // Hide at an explicit value; audio cannot be hidden.
  session.execute(timeline.setElementsHidden({ sceneId: "s1", elementIds: [clips[0]], hidden: true }), ON);
  assert.equal(el(session.document, clips[0]).hidden, true);
  assert.equal(session.execute(timeline.setElementsHidden({ sceneId: "s1", elementIds: [music], hidden: true }), ON).ok, false);
  // Stacking order: the element on the lower overlay track goes to the front.
  const order = () => overlay(session.document).map((track) => track.elements.map((element: { id: string }) => element.id));
  const front = session.execute(timeline.restackElements({ sceneId: "s1", elementIds: [top.info.elementIds[0]], action: "to_front" }), ON) as { info: { moved: string[] } };
  assert.deepEqual(front.info.moved, [], "already at the front: nothing moves");
  const raised = session.execute(timeline.restackElements({ sceneId: "s1", elementIds: [copy.info.elementIds[0]], action: "bring_forward" }), ON) as { info: { moved: string[] } };
  assert.deepEqual(raised.info.moved, [copy.info.elementIds[0]]);
  assert.ok(order()[0].includes(copy.info.elementIds[0]), "it sits on the top overlay track, where its range is free");
  assert.equal(session.execute(timeline.restackElements({ sceneId: "s1", elementIds: [clips[0]], action: "to_front" }), ON).ok, false, "the main track has no stacking order");
  // Freeze: 4 s, a 3 s freeze element, the rest; everything after it moved.
  const frozen = session.execute(timeline.insertFreezeFrame({ sceneId: "s1", elementId: clips[0], time: 4 * S }), ON) as { info: { elementId: string; rightId: string } };
  assert.deepEqual(spans(session.document, "t-main"), [[0, 4], [4, 7], [7, 23], [23, 33]]);
  assert.deepEqual([el(session.document, frozen.info.elementId).freeze, el(session.document, frozen.info.elementId).type], [{ mediaId: "a4", sourceTime: 4 * S }, "video"]);
  const edge = session.execute(timeline.insertFreezeFrame({ sceneId: "s1", elementId: clips[0], time: 0 }), ON);
  assert.deepEqual([edge.ok, (edge as { code?: string }).code], [false, "freeze-time"]);
  assert.equal(session.execute(timeline.insertFreezeFrame({ sceneId: "s1", elementId: frozen.info.elementId, time: 5 * S }), ON).ok, false, "a freeze element is not frozen again");
});

test("addMarkerAt and updateMarker address markers by id and never share a frame", () => {
  const { session } = seeded();
  const hook = session.execute(timeline.addMarkerAt({ sceneId: "s1", time: 3 * S, note: "Hook", color: 4 }), ON) as { info: { markerId: string } };
  const second = session.execute(timeline.addMarkerAt({ sceneId: "s1", time: S, color: "#FF3B30", duration: 2 * S }), ON) as { info: { markerId: string } };
  const markers = () => (timeline.sceneById(session.document, "s1").markers as { id: string; time: number; note?: string; color: unknown; duration?: number }[]).map((marker) => [marker.id, marker.time / S, marker.note, marker.color, marker.duration]);
  assert.deepEqual(markers(), [[second.info.markerId, 1, undefined, "#ff3b30", 2 * S], [hook.info.markerId, 3, "Hook", 4, undefined]]);
  const taken = session.execute(timeline.addMarkerAt({ sceneId: "s1", time: 3 * S + 10 }), ON);
  assert.deepEqual([taken.ok, (taken as { code?: string }).code], [false, "marker-exists"]);
  session.execute(timeline.updateMarker({ sceneId: "s1", markerId: hook.info.markerId, time: 5 * S, note: "", duration: S }), ON);
  assert.deepEqual(markers()[1], [hook.info.markerId, 5, undefined, 4, S]);
  assert.equal(session.execute(timeline.updateMarker({ sceneId: "s1", markerId: hook.info.markerId, time: S }), ON).ok, false);
  assert.equal(session.execute(timeline.updateMarker({ sceneId: "s1", markerId: "nope", note: "x" }), ON).ok, false);
  const long = session.execute(timeline.addMarkerAt({ sceneId: "s1", time: 9 * S, note: "x".repeat(2001) }), ON);
  assert.equal(long.ok, false, "a note longer than the field allows is rejected, not shortened");
  assert.ok(DocumentRejected);
});
