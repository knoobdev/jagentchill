import assert from "node:assert/strict";
import { test } from "node:test";
import { addAsset, renameProject, uuidV4, type CommitContext } from "@jagentchill/editor-core";
import { createProjectDocument } from "@jagentchill/protocol";
import { channelsLabel, createSessionHistory, durationBadge, elapsedLabel, mediaGridColumns, sampleRateLabel, usageBadge } from "../src/index.ts";

const ctx = (): CommitContext => ({ now_ms: 1_700_000_000_000, newId: () => uuidV4() });
const blank = () => createProjectDocument({ id: uuidV4(), mainSceneId: uuidV4(), mainTrackId: uuidV4(), now_ms: 1_700_000_000_000 });
const asset = (name: string) => ({ name, type: "image" as const, size: 10 });

test("Persistence rollback: a rolled-back import leaves no undo step and can never be redone", () => {
  const history = createSessionHistory();
  let doc = blank();
  const rename = renameProject(doc, ctx(), "Trip");
  doc = history.record(doc, rename);
  const added = addAsset(doc, ctx(), asset("a.png"));
  doc = history.record(doc, added);
  assert.equal(doc.media.assets.length, 1);
  const back = history.rollback(doc, added);
  assert.ok(back);
  doc = back!;
  assert.equal(doc.media.assets.length, 0, "the asset disappears from the library");
  assert.equal(history.canRedo, false, "the rolled-back step is not redoable");
  assert.equal(history.redo(doc), null);
  assert.equal(history.undoLabel, rename.label, "the step before it is still the next undo");
  // Undo and redo of earlier work still pass over the dead step.
  doc = history.undo(doc)!;
  assert.equal(doc.metadata.name === "Trip", false);
  assert.equal(history.canRedo, true);
  doc = history.redo(doc)!;
  assert.equal(doc.metadata.name, "Trip");
  assert.equal(history.canRedo, false);
  assert.equal(doc.media.assets.length, 0);
});
test("a new step after a rollback clears the dead step; a commit that is not the latest step is not rolled back", () => {
  const history = createSessionHistory();
  let doc = blank();
  const first = addAsset(doc, ctx(), asset("a.png"));
  doc = history.record(doc, first);
  doc = history.rollback(doc, first)!;
  const second = addAsset(doc, ctx(), asset("b.png"));
  doc = history.record(doc, second);
  assert.equal(history.canUndo, true);
  assert.equal(history.canRedo, false);
  const rename = renameProject(doc, ctx(), "Later");
  doc = history.record(doc, rename);
  assert.equal(history.rollback(doc, second), null);
  assert.equal(doc.media.assets.length, 1);
  history.clear();
  assert.equal(history.canUndo, false);
});
test("media card labels: duration badge, sample rate, channels, usage badge, grid columns of at least 112 px", () => {
  assert.equal(durationBadge(42 * 120_000), "00:42");
  assert.equal(durationBadge(66 * 120_000), "01:06");
  assert.equal(durationBadge(3734 * 120_000), "1:02:14");
  assert.equal(durationBadge(0), "00:00");
  assert.equal(elapsedLabel(7_900), "00:07");
  assert.equal(sampleRateLabel(48_000), "48 kHz");
  assert.equal(sampleRateLabel(44_100), "44.1 kHz");
  assert.equal(channelsLabel(1), "Mono");
  assert.equal(channelsLabel(2), "Stereo");
  assert.equal(channelsLabel(6), "6 channels");
  assert.equal(usageBadge(0), null);
  assert.equal(usageBadge(1), "Used");
  assert.equal(usageBadge(3), "Used ×3");
  assert.equal(mediaGridColumns(272, 112, 8), 2);
  assert.equal(mediaGridColumns(360, 112, 8), 3);
  assert.equal(mediaGridColumns(80, 112, 8), 1);
});
