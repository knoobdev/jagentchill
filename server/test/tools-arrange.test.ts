// The Gateway in these tests is the FAKE of `harness.ts`; devices are simulated. The server, sync and the tools are real.
import assert from "node:assert/strict";
import { test } from "node:test";
import { S, toolWorld } from "./support/tools.ts";

test("Duplicate with an offset; Duplicate onto an occupied range; Replace media keeps the edit; Replace with a shorter asset; Rename an element", async () => {
  const w = await toolWorld();
  const clip = await w.write("jc_clip_add", { assetId: w.project.assets.silent, newTrack: { zone: "overlay", type: "video" }, start: 10 * S, sourceOut: 4 * S });
  const id = clip.data.elementIds[0];
  await w.write("jc_clip_transform", { elementIds: [id], scale: 0.5, opacity: 0.8 });
  const copy = await w.write("jc_clip_duplicate", { elementIds: [id], offset: 4 * S });
  const second = await w.element(copy.data.elementIds[0]) as any, first = await w.element(id) as any;
  assert.deepEqual([second.startTime, second.duration, second.opacity, second.transform.scale, second.mediaId], [14 * S, 4 * S, 0.8, first.transform.scale, first.mediaId], "a second element with the same properties at 14 s");
  assert.notEqual(second.id, first.id);
  assert.equal((await w.writeFails("jc_clip_duplicate", { elementIds: [id], offset: 2 * S })).code, "OVERLAP_NOT_ALLOWED");
  assert.equal((await w.writeFails("jc_clip_duplicate", { elementIds: [id], offset: -20 * S })).code, "OUT_OF_RANGE");
  assert.equal((await w.writeFails("jc_clip_duplicate", { elementIds: [id], toTrackId: w.project.musicTrack })).code, "TRACK_KIND_MISMATCH");
  // New media, the same start, duration, effects and transform.
  await w.write("jc_effect_apply", { target: { elementIds: [id] }, effectId: "blur" });
  const replaced = await w.write("jc_clip_replace_media", { elementId: id, assetId: w.project.assets.drone, keepDuration: true });
  const now = await w.element(id) as any;
  assert.deepEqual([now.mediaId, now.startTime, now.duration, now.effects.length, now.transform.scale, replaced.data.trimAdjusted], [w.project.assets.drone, 10 * S, 4 * S, 1, { x: 0.5, y: 0.5 }, false]);
  const short = await w.writeFails("jc_clip_replace_media", { elementId: w.project.clipB, assetId: w.project.assets.silent, keepDuration: true });
  assert.deepEqual([short.code, short.details?.maxDuration], ["SOURCE_EXHAUSTED", 6 * S]);
  assert.equal((await w.write("jc_clip_replace_media", { elementId: w.project.clipB, assetId: w.project.assets.silent })).data.duration, 6 * S);
  assert.equal((await w.writeFails("jc_clip_replace_media", { elementId: w.project.clipA, assetId: w.project.assets.music })).code, "UNSUPPORTED_FOR_ELEMENT");
  const renamed = await w.write("jc_clip_rename", { elementId: w.project.clipA, name: "Interview A" });
  const before = await w.proposed();
  assert.equal((await w.element(w.project.clipA)).name, "Interview A");
  assert.equal(renamed.changeIds?.length, 1);
  assert.equal((await w.writeFails("jc_clip_rename", { elementId: w.project.clipA, name: "x".repeat(201) })).code, "OUT_OF_RANGE");
  assert.equal(JSON.stringify(await w.proposed()), JSON.stringify(before));
  w.close();
});

test("Group and ungroup; Group a single element; Compound clip; Compound nesting limit; Link requires the same media; Detach audio; Detach audio from a silent clip; Recover audio", async () => {
  const w = await toolWorld();
  const third = (await w.write("jc_clip_add", { assetId: w.project.assets.photo })).data.elementIds[0];
  const grouped = await w.write("jc_clip_group", { action: "group", elementIds: [w.project.clipA, w.project.clipB, third] });
  for (const elementId of [w.project.clipA, w.project.clipB, third]) assert.equal((await w.element(elementId)).groupId, grouped.data.groupId);
  await w.write("jc_clip_group", { action: "ungroup", groupId: grouped.data.groupId });
  for (const elementId of [w.project.clipA, w.project.clipB, third]) assert.equal((await w.element(elementId)).groupId, null);
  assert.equal((await w.writeFails("jc_clip_group", { action: "group", elementIds: [w.project.clipA] })).code, "INVALID_PARAMS");
  assert.equal((await w.writeFails("jc_clip_group", { action: "ungroup", groupId: "nope" })).code, "NOT_FOUND");
  // Detach: a linked audio element with the same start and duration, and the video's own sound off.
  const detached = await w.write("jc_clip_detach_audio", { elementId: w.project.clipA });
  const audio = await w.element(detached.data.audioElementId) as any, video = await w.element(w.project.clipA) as any;
  assert.deepEqual([audio.type, audio.startTime, audio.duration, audio.linkId, video.isSourceAudioEnabled, video.linkId], ["audio", 0, 10 * S, detached.data.linkId, false, detached.data.linkId]);
  assert.equal((await w.writeFails("jc_clip_detach_audio", { elementId: w.project.clipA })).code, "UNSUPPORTED_FOR_ELEMENT");
  const silent = (await w.write("jc_clip_add", { assetId: w.project.assets.silent })).data.elementIds[0];
  assert.equal((await w.writeFails("jc_clip_detach_audio", { elementId: silent })).code, "UNSUPPORTED_FOR_ELEMENT");
  // A video and an audio element of different assets cannot be linked.
  assert.equal((await w.writeFails("jc_clip_link", { action: "link", elementIds: [w.project.clipB, w.project.music] })).code, "UNSUPPORTED_FOR_ELEMENT");
  await w.write("jc_clip_link", { action: "unlink", elementIds: [w.project.clipA, detached.data.audioElementId] });
  assert.equal((await w.element(w.project.clipA)).linkId, null);
  await w.write("jc_clip_link", { action: "link", elementIds: [w.project.clipA, detached.data.audioElementId] });
  // Recover: the level set on the extracted audio goes back to the video, and the audio element is removed.
  await w.write("jc_audio_edit", { elementIds: [detached.data.audioElementId], volume: -9 });
  const recovered = await w.write("jc_clip_detach_audio", { elementId: w.project.clipA, action: "recover" });
  assert.deepEqual([recovered.data.isSourceAudioEnabled, recovered.data.volume], [true, -9]);
  assert.equal((await w.fails("jc_clip_rename", { elementId: detached.data.audioElementId, name: "x", idempotencyKey: "k".repeat(20) })).code, "ELEMENT_NOT_FOUND");
  assert.equal((await w.writeFails("jc_clip_detach_audio", { elementId: w.project.clipA, action: "recover" })).code, "UNSUPPORTED_FOR_ELEMENT");
  await w.ok("jc_proposal_discard");

  // Three elements become one compound element and a new scene that holds them.
  const extra = (await w.write("jc_clip_add", { assetId: w.project.assets.photo })).data.elementIds[0];
  const compound = await w.write("jc_clip_compound", { action: "create", elementIds: [w.project.clipA, w.project.clipB, extra], name: "Act one" });
  let doc = await w.proposed();
  assert.deepEqual(w.scene(doc).tracks.main.elements.map((element) => [element.id, element.type]), [[compound.data.elementId, "compound"]]);
  assert.equal(w.scene(doc, compound.data.sceneId).tracks.main.elements.length, 3);
  // Nesting stops at eight levels.
  let inner = compound.data.elementId, depth = 1, error;
  for (; depth < 12 && !error; depth++) { const next = await w.call("jc_clip_compound", { action: "create", elementIds: [inner], idempotencyKey: `nest-${depth}-0123456789abc` }); if (next.ok) inner = (next.data as any).elementId; else error = next.error; }
  assert.equal(error?.code, "OUT_OF_RANGE");
  assert.match(String(error?.message), /8 levels/);
  const dissolved = await w.write("jc_clip_compound", { action: "dissolve", elementId: inner });
  assert.ok(dissolved.data.elementIds.length >= 1);
  assert.equal((await w.writeFails("jc_clip_compound", { action: "dissolve", elementId: w.project.music })).code, "UNSUPPORTED_FOR_ELEMENT");
  doc = await w.proposed();
  w.close();
});

test("Disable an element; Reorder at the top; Freeze frame; Freeze would collide on an overlay", async () => {
  const w = await toolWorld();
  await w.write("jc_clip_set_enabled", { elementIds: [w.project.clipA], enabled: false });
  assert.equal((await w.element(w.project.clipA)).hidden, true, "a hidden element is not rendered");
  await w.write("jc_clip_set_enabled", { elementIds: [w.project.clipA], enabled: true });
  assert.equal((await w.element(w.project.clipA)).hidden, false);
  const audio = await w.writeFails("jc_clip_set_enabled", { elementIds: [w.project.music], enabled: false });
  assert.equal(audio.code, "UNSUPPORTED_FOR_ELEMENT");
  assert.match(audio.message, /jc_audio_edit/);
  // Stacking order between overlay tracks.
  const bottom = await w.write("jc_clip_add", { assetId: w.project.assets.photo, newTrack: { zone: "overlay", type: "video" }, start: 0, duration: 2 * S });
  const top = await w.write("jc_clip_add", { assetId: w.project.assets.photo, newTrack: { zone: "overlay", type: "video" }, start: 0, duration: 2 * S });
  const order = async () => w.scene(await w.proposed()).tracks.overlay.map((track) => track.elements.map((element) => element.id)).flat();
  const lower = bottom.data.elementIds[0], upper = top.data.elementIds[0];
  const start = await order();
  const front = start[0], back = start[1];
  const already = await w.write("jc_clip_reorder", { elementIds: [front], action: "to_front" });
  assert.deepEqual([already.ok, already.warnings, already.changeIds], [true, ["no_change"], []]);
  await w.write("jc_clip_reorder", { elementIds: [back], action: "to_front" });
  assert.equal((await order())[0], back);
  await w.write("jc_clip_reorder", { elementIds: [back], action: "send_backward" });
  assert.deepEqual(await order(), [front, back]);
  assert.equal((await w.writeFails("jc_clip_reorder", { elementIds: [w.project.clipA], action: "to_front" })).code, "UNSUPPORTED_FOR_ELEMENT");
  void lower; void upper;
  await w.ok("jc_proposal_discard");

  // A 3 s freeze frame 4 s into the 10 s clip: 4 s, a freeze element of type video, then 6 s.
  const frozen = await w.write("jc_clip_freeze", { elementId: w.project.clipA, at: 4 * S });
  assert.deepEqual(frozen.data.parts.map((part: any) => [part.type, part.start / S, part.duration / S]), [["video", 0, 4], ["video", 4, 3], ["video", 7, 6]]);
  const freeze = await w.element(frozen.data.freezeElementId) as any;
  assert.deepEqual([freeze.freeze.sourceTime, freeze.freeze.mediaId], [4 * S, w.project.assets.drone]);
  assert.equal((await w.main()).at(-1)!.startTime, 13 * S, "everything after it moved by the freeze duration");
  assert.equal((await w.writeFails("jc_clip_freeze", { elementId: w.project.clipB, at: 100 * S })).code, "OUT_OF_RANGE");
  assert.equal((await w.writeFails("jc_clip_freeze", { elementId: w.project.music, at: 5 * S })).code, "UNSUPPORTED_FOR_ELEMENT");
  assert.equal((await w.writeFails("jc_clip_freeze", { elementId: frozen.data.freezeElementId, at: 5 * S })).code, "UNSUPPORTED_FOR_ELEMENT");
  // `ripple: false` is not a thing a freeze can do; on an overlay the shifted part must not run into the next element.
  assert.equal((await w.writeFails("jc_clip_freeze", { elementId: w.project.clipB, at: 20 * S, ripple: false })).code, "INVALID_PARAMS");
  const o = await w.write("jc_clip_add", { assetId: w.project.assets.silent, newTrack: { zone: "overlay", type: "video" }, start: 0 });
  const next = await w.write("jc_clip_add", { assetId: w.project.assets.photo, trackId: o.data.elements[0].trackId, start: 7 * S, duration: S });
  const shifted = await w.write("jc_clip_freeze", { elementId: o.data.elementIds[0], at: 2 * S, duration: 2 * S });
  assert.equal((await w.element(next.data.elementIds[0])).startTime, 9 * S, "the following element of the track moved too, so nothing collides");
  assert.equal(shifted.data.parts[2].start, 4 * S);
  w.close();
});

test("Reframe to cover; Crop limit; Keyframed property; Per-clip blurred background; Background on a text element; Out of range is rejected with the valid range; Entrance animation; Text element; Durations too long", async () => {
  const w = await toolWorld({ canvas: { width: 1080, height: 1920 } });
  // A 16:9 clip in a 9:16 project, set to cover: no letterbox on either side.
  const cover = await w.write("jc_clip_transform", { elementIds: [w.project.clipA], fit: "cover" });
  const scale = cover.data.elements[0].transform.scale, contain = Math.min(1080 / 1920, 1920 / 1080);
  assert.ok(1920 * contain * scale.x >= 1080 && 1080 * contain * scale.y >= 1920 - 1, `the picture fills the canvas (${JSON.stringify(scale)})`);
  assert.deepEqual(cover.data.elements[0].transform.position, { x: 0, y: 0 });
  assert.deepEqual((await w.write("jc_clip_transform", { elementIds: [w.project.clipA], fit: "contain" })).data.elements[0].transform.scale, { x: 1, y: 1 });
  const aligned = await w.write("jc_clip_transform", { elementIds: [w.project.clipA], align: "top" });
  assert.equal(aligned.data.elements[0].transform.position.y, Math.round((1080 * contain - 1920) / 2));
  // Values outside a field's range are refused with the range; nothing is clamped.
  const opacity = await w.writeFails("jc_clip_transform", { elementIds: [w.project.clipA], opacity: 1.4 });
  assert.deepEqual([opacity.code, opacity.details], ["OUT_OF_RANGE", { field: "opacity", min: 0, max: 1, value: 1.4 }]);
  assert.equal((await w.element(w.project.clipA)).opacity, 1, "the element's opacity is unchanged");
  const crop = await w.writeFails("jc_clip_transform", { elementIds: [w.project.clipA], crop: { left: 0.6, right: 0.5 } });
  assert.equal(crop.code, "OUT_OF_RANGE");
  for (const [args, field] of [[{ scale: 500 }, "scale"], [{ rotation: 9000 }, "rotation"], [{ position: { x: 1e7, y: 0 } }, "position.x"], [{ crop: { top: 1.2 } }, "crop.top"], [{ motionBlur: { enabled: true, strength: 300 } }, "motionBlur.strength"]] as const) {
    const error = await w.writeFails("jc_clip_transform", { elementIds: [w.project.clipA], ...args });
    assert.deepEqual([error.code, error.details?.field, typeof error.details?.min, typeof error.details?.max], ["OUT_OF_RANGE", field, "number", "number"], field);
  }
  await w.write("jc_clip_transform", { elementIds: [w.project.clipA, w.project.clipB], position: { x: 120, y: -60 }, scale: { x: 1.2, y: 1.1 }, rotation: 12.34, opacity: 0.5, crop: { left: 0.1 }, flip: { horizontal: true }, blendMode: "screen", motionBlur: { enabled: true, strength: 40, samples: 16 } });
  const set = await w.element(w.project.clipB) as any;
  assert.deepEqual([set.transform.position, set.transform.scale, set.transform.rotation, set.opacity, set.crop.left, set.flip.horizontal, set.blendMode, set.motionBlur], [{ x: 120, y: -60 }, { x: 1.2, y: 1.1 }, 12.3, 0.5, 0.1, true, "screen", { enabled: true, strength: 40, samples: 16 }]);
  assert.equal((await w.writeFails("jc_clip_transform", { elementIds: [w.project.clipA], blendMode: "glow" })).code, "INVALID_PARAMS");
  assert.equal((await w.writeFails("jc_clip_transform", { elementIds: [w.project.music], opacity: 0.5 })).code, "UNSUPPORTED_FOR_ELEMENT");
  assert.equal((await w.writeFails("jc_clip_transform", { elementIds: [w.project.clipA] })).code, "INVALID_PARAMS");
  // A property with keyframes is not overwritten behind the animation.
  await w.write("jc_keyframe_set", { elementId: w.project.clipA, property: "opacity", keyframes: [{ time: 0, value: 0 }, { time: 2 * S, value: 1 }] });
  const keyed = await w.writeFails("jc_clip_transform", { elementIds: [w.project.clipA], opacity: 0.3 });
  assert.equal(keyed.code, "UNSUPPORTED_FOR_ELEMENT");
  assert.match(keyed.message, /jc_keyframe_set/);
  await w.write("jc_clip_transform", { elementIds: [w.project.clipA], opacity: 0.3, replaceKeyframes: true });
  const cleared = await w.element(w.project.clipA) as any;
  assert.deepEqual([cleared.opacity, cleared.animations?.opacity], [0.3, undefined]);
  // A clip's own background; the project default is untouched; a text has none of this kind.
  const projectBackground = JSON.stringify((await w.proposed()).settings.background);
  await w.write("jc_clip_transform", { elementIds: [w.project.clipA], background: { kind: "blur", blurIntensity: 200 } });
  assert.deepEqual((await w.element(w.project.clipA)).background, { kind: "blur", blurIntensity: 200 });
  assert.equal((await w.element(w.project.clipB)).background, undefined);
  assert.equal(JSON.stringify((await w.proposed()).settings.background), projectBackground);
  await w.write("jc_clip_transform", { elementIds: [w.project.clipA], background: null });
  assert.equal((await w.element(w.project.clipA)).background, undefined);
  const title = await w.write("jc_text_add", { content: "Title", start: 0, duration: 4 * S });
  const onText = await w.writeFails("jc_clip_transform", { elementIds: [title.data.elementId], background: { kind: "color", color: "#000000" } });
  assert.equal(onText.code, "UNSUPPORTED_FOR_ELEMENT");
  assert.match(onText.message, /jc_text_update/);
  assert.equal((await w.writeFails("jc_clip_transform", { elementIds: [title.data.elementId], crop: { left: 0.1 } })).code, "UNSUPPORTED_FOR_ELEMENT", "a field the element type does not have");

  // Clip animations.
  const library = (await w.ok("jc_library_search", { kind: "clip_animation" })).data.items;
  const into = library.find((item: any) => item.category === "in").id, out = library.find((item: any) => item.category === "out").id, combo = library.find((item: any) => item.category === "combo").id;
  const photo = (await w.write("jc_clip_add", { assetId: w.project.assets.photo, duration: 4 * S })).data.elementIds[0];
  const entered = await w.write("jc_clip_animation", { elementIds: [photo], in: { type: into, duration: S / 2 } });
  assert.deepEqual([entered.data.clipAnimation.in.type, entered.data.clipAnimation.in.duration], [into, S / 2]);
  // A fade-in on what the video starts with leaves 00:00 black: the result says so, in the words the proposal shows.
  const opening = await w.write("jc_clip_animation", { elementIds: [w.project.clipA], in: { type: "fade-in", duration: S } });
  assert.equal(opening.data.opensOnBlack, true);
  assert.match(opening.summary!, /opens on black: the picture fades in over 1 s from 00:00/);
  await w.write("jc_clip_animation", { elementIds: [w.project.clipA], clear: ["in"] });
  const text = await w.writeFails("jc_clip_animation", { elementIds: [title.data.elementId], in: { type: into, duration: S / 2 } });
  assert.equal(text.code, "UNSUPPORTED_FOR_ELEMENT");
  assert.match(text.message, /jc_text_update/);
  assert.equal((await w.writeFails("jc_clip_animation", { elementIds: [photo], in: { type: into, duration: 3 * S }, out: { type: out, duration: 2 * S } })).code, "OUT_OF_RANGE");
  assert.equal((await w.writeFails("jc_clip_animation", { elementIds: [photo], in: { type: "wobble-nine", duration: S } })).code, "LIBRARY_ITEM_NOT_FOUND");
  await w.write("jc_clip_animation", { elementIds: [photo], combo: { type: combo } });
  const withCombo = (await w.element(photo)).clipAnimation as any;
  assert.deepEqual([withCombo.combo.type, withCombo.in, withCombo.out], [combo, undefined, undefined], "a combo replaces in and out");
  await w.write("jc_clip_animation", { elementIds: [photo], clear: ["combo"] });
  assert.equal((await w.element(photo)).clipAnimation, undefined);
  w.close();
});
