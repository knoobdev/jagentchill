import assert from "node:assert/strict";
import { test } from "node:test";
import { timeline as tl } from "../src/index.ts";
import { put, text, video } from "./support/fixtures.ts";
import { OFF, open, project, withTracks } from "./support/timeline.ts";

const S = 120_000;
const base = () => put(put(withTracks(project(), ["t-video", "video"], ["t-text", "text"]), "t-video", video("a", 0, 4, { sourceDuration: 60 * S, trimEnd: 56 * S })), "t-text", text("b", 0, 2));

test("Relative anchors — end plus offset resolves to ticks and follows anchor movement in the same undo step", () => {
  const session = open(base());
  assert.equal(session.execute(tl.setTimingAnchor({ sceneId: "s1", elementId: "b", anchor: { elementId: "a", edge: "end", offsetSeconds: 0.5 } }), OFF).ok, true);
  assert.equal(tl.locate(session.document, "b")!.element.startTime, 4.5 * S);
  const moved = session.execute(tl.move({ sceneId: "s1", elementIds: ["a"], time: 3 * S }), OFF);
  assert.equal(moved.ok, true);
  assert.deepEqual([tl.locate(session.document, "a")!.element.startTime, tl.locate(session.document, "b")!.element.startTime], [3 * S, 7.5 * S]);
  assert.ok(moved.patch.some((entry) => entry.path.endsWith("/@b/startTime")), "the dependent start is part of the anchor move patch");
  session.undo();
  assert.deepEqual([tl.locate(session.document, "a")!.element.startTime, tl.locate(session.document, "b")!.element.startTime], [0, 4.5 * S]);
});

test("Relative anchors — changing anchor duration updates its end dependent", () => {
  const session = open(base());
  assert.equal(session.execute(tl.setTimingAnchor({ sceneId: "s1", elementId: "b", anchor: { elementId: "a", edge: "end", offsetSeconds: -0.2 } }), OFF).ok, true);
  assert.equal(tl.locate(session.document, "b")!.element.startTime, 3.8 * S);
  const result = session.execute(tl.trim({ sceneId: "s1", elementId: "a", side: "end", delta: S }), OFF);
  assert.equal(result.ok, true);
  assert.deepEqual([tl.locate(session.document, "a")!.element.duration, tl.locate(session.document, "b")!.element.startTime], [5 * S, 4.8 * S]);
});

test("Relative anchors — cycles are refused without changing either element", () => {
  const session = open(base());
  session.execute(tl.setTimingAnchor({ sceneId: "s1", elementId: "b", anchor: { elementId: "a", edge: "start", offsetSeconds: 1 } }), OFF);
  const before = session.document;
  const refused = session.execute(tl.setTimingAnchor({ sceneId: "s1", elementId: "a", anchor: { elementId: "b", edge: "start", offsetSeconds: 1 } }), OFF);
  assert.equal(refused.ok, false);
  assert.equal(session.document, before);
});

test("Relative anchors — deleting an anchor preserves dependent absolute time and clears its link", () => {
  const session = open(base());
  session.execute(tl.setTimingAnchor({ sceneId: "s1", elementId: "b", anchor: { elementId: "a", edge: "end", offsetSeconds: 0.5 } }), OFF);
  session.execute(tl.deleteElements({ sceneId: "s1", elementIds: ["a"] }), OFF);
  const dependent = tl.locate(session.document, "b")!.element as unknown as Record<string, unknown>;
  assert.equal(dependent.startTime, 4.5 * S);
  assert.equal("timingAnchor" in dependent, false);
});
