// The Gateway in these tests is the FAKE of `harness.ts`; devices are simulated. The server, sync and the tools are real.
import assert from "node:assert/strict";
import { test } from "node:test";
import { timeline } from "@jagentchill/editor-core";
import { S, toolWorld } from "./support/tools.ts";

test("Add a title; Text animation; Unknown font; Curved text in a bubble; Font size out of range", async () => {
  const w = await toolWorld();
  const template = (await w.ok("jc_library_search", { kind: "text_template", limit: 1 })).data.items[0];
  const title = await w.write("jc_text_add", { content: "Summer in Hội An", start: 0, duration: 3 * S, templateId: template.id });
  const placed = timeline.located(await w.proposed(), title.data.elementId);
  assert.deepEqual([placed.zone, placed.track.type, placed.element.type, placed.element.content], ["overlay", "text", "text", "Summer in Hội An"], "a text element with the template style on an overlay track");
  assert.equal(title.data.elementIds.includes(title.data.elementId), true);
  // A plain text: centred, three seconds, on a text track.
  const plain = await w.write("jc_text_add", { content: "Chapter one", start: 5 * S, style: { fontFamily: "georgia", fontSize: 24, fontWeight: 700, color: "#ffcc00", stroke: { enabled: true, width: 4 }, shadow: { enabled: true, blur: 20 } }, position: { x: 0, y: 300 } });
  const text = await w.element(plain.data.elementId) as any;
  assert.deepEqual([text.duration, text.fontFamily, text.fontSize, text.fontWeight, text.color, text.stroke.enabled, text.stroke.width, text.stroke.color, text.shadow.blur, text.transform.position, text.textAlign], [3 * S, "Georgia", 24, 700, "#ffcc00", true, 4, "#000000", 20, { x: 0, y: 300 }, "center"]);
  // An unknown family never fails the edit: the closest name stands in, else a family of the same kind, and the result says so.
  const slip = await w.write("jc_text_update", { elementIds: [plain.data.elementId], style: { fontFamily: "Helvetca" } });
  assert.equal((await w.element(plain.data.elementId) as any).fontFamily, "Helvetica");
  assert.match(slip.warnings.join("\n"), /FONT_SUBSTITUTED: the font "Helvetca" is not available; "Helvetica" is used instead \(the closest name\)\. Available fonts: Arial, .*Noto Sans JP/);
  const foreign = await w.write("jc_text_update", { elementIds: [plain.data.elementId], style: { fontFamily: "Montserrat" } });
  assert.equal((await w.element(plain.data.elementId) as any).fontFamily, "Arial", "a sans family the product does not have becomes the default sans");
  assert.match(foreign.warnings.join("\n"), /"Montserrat" is not available; "Arial" is used instead \(the same kind of font\)/);
  for (const [wanted, got] of [["Playfair Display", "serif"], ["JetBrains Mono", "monospace"], ["Noto Sans Display", "Noto Sans"], ["NotoSerif", "Noto Serif"], ["tinos", "Tinos"]]) {
    await w.write("jc_text_update", { elementIds: [plain.data.elementId], style: { fontFamily: wanted } });
    assert.equal((await w.element(plain.data.elementId) as any).fontFamily, got, wanted);
  }
  // The same catalogue as the editor's font picker: nine baseline names and the sixteen bundled families.
  const fonts = (await w.ok("jc_library_search", { kind: "font", limit: 100 })).data;
  assert.equal(fonts.total, 25);
  assert.deepEqual(fonts.items.find((item: any) => item.id === "Noto Sans JP")?.category, "sans");
  assert.equal((await w.ok("jc_library_search", { kind: "font", category: "mono" })).data.items.every((item: any) => /mono|Courier|Cousine/i.test(item.id)), true);
  const size = await w.writeFails("jc_text_update", { elementIds: [plain.data.elementId], style: { fontSize: 800 } });
  assert.deepEqual([size.code, size.details], ["OUT_OF_RANGE", { field: "style.fontSize", min: 1, max: 500, value: 800 }]);
  assert.equal((await w.writeFails("jc_text_update", { elementIds: [plain.data.elementId], style: { fontColour: "#fff" } })).code, "INVALID_PARAMS", "the style accepts no other key");
  assert.equal((await w.writeFails("jc_text_update", { elementIds: [plain.data.elementId], style: { fontWeight: 450 } })).code, "INVALID_PARAMS");
  assert.equal((await w.writeFails("jc_text_add", { content: "", start: 0 })).code, "OUT_OF_RANGE");
  assert.equal((await w.writeFails("jc_text_add", { content: "x".repeat(10_001), start: 0 })).code, "OUT_OF_RANGE");
  // An entrance animation of half a second: a text animation, never a clip animation.
  const animation = (await w.ok("jc_library_search", { kind: "text_animation", category: "in", limit: 1 })).data.items[0].id;
  await w.write("jc_text_update", { elementIds: [plain.data.elementId], animation: { in: { animationId: animation, duration: S / 2 } } });
  const animated = await w.element(plain.data.elementId) as any;
  assert.deepEqual([animated.textAnimation.in, animated.clipAnimation], [{ id: animation, duration: S / 2, strength: 100 }, undefined]);
  assert.equal((await w.writeFails("jc_text_update", { elementIds: [plain.data.elementId], animation: { in: { animationId: animation, duration: 5 * S } } })).code, "OUT_OF_RANGE");
  assert.equal((await w.writeFails("jc_text_update", { elementIds: [plain.data.elementId], animation: { in: { animationId: "nope", duration: S } } })).code, "LIBRARY_ITEM_NOT_FOUND");
  await w.write("jc_text_update", { elementIds: [plain.data.elementId], clearAnimation: ["in"] });
  assert.equal((await w.element(plain.data.elementId)).textAnimation, undefined);
  // Curve, strikethrough and a bubble; a bubble and the text background exclude each other.
  const bubble = (await w.ok("jc_library_search", { kind: "text_bubble", limit: 1 })).data.items[0].id;
  await w.write("jc_text_update", { elementIds: [plain.data.elementId], style: { curve: 120, strikethrough: true, bubble: { id: bubble } } });
  const curved = await w.element(plain.data.elementId) as any;
  assert.deepEqual([curved.curve, curved.strikethrough, curved.bubble.id], [120, true, bubble]);
  await w.write("jc_text_update", { elementIds: [plain.data.elementId], style: { bubble: null, background: { enabled: true, color: "#101010", cornerRadius: 12 } } });
  const boxed = await w.element(plain.data.elementId) as any;
  assert.deepEqual([boxed.bubble, boxed.background.enabled, boxed.background.cornerRadius], [undefined, true, 12]);
  assert.equal((await w.writeFails("jc_text_update", { elementIds: [plain.data.elementId], style: { bubble: { id: "nope" } } })).code, "LIBRARY_ITEM_NOT_FOUND");
  // A text effect preset is recorded as the style preset; content can change on its own.
  const preset = (await w.ok("jc_library_search", { kind: "text_effect_preset", limit: 3 })).data.items[2].id;
  await w.write("jc_text_update", { elementIds: [plain.data.elementId], effectPresetId: preset, content: "Chapter two" });
  assert.deepEqual([(await w.element(plain.data.elementId)).stylePresetId, (await w.element(plain.data.elementId)).content], [preset, "Chapter two"]);
  assert.equal((await w.writeFails("jc_text_update", { elementIds: [w.project.clipA], content: "x" })).code, "UNSUPPORTED_FOR_ELEMENT");
  assert.equal((await w.writeFails("jc_text_update", { elementIds: [plain.data.elementId] })).code, "INVALID_PARAMS");
  assert.equal((await w.writeFails("jc_text_add", { content: "On the music track", start: 0, trackId: w.project.musicTrack })).code, "TRACK_KIND_MISMATCH");
  assert.equal((await w.writeFails("jc_text_add", { content: "Same place", start: 5 * S, trackId: timeline.located(await w.proposed(), plain.data.elementId).track.id })).code, "OVERLAP_NOT_ALLOWED");
  w.close();
});

const SRT = `1\n00:00:01,000 --> 00:00:03,000\nWelcome to JAgent Chill\n\n2\n00:00:03,500 --> 00:00:06,000\nPlease subscribe today\n\n3\n00:00:07,000 --> 00:00:09,000\nJAgent Chill makes editing easy\n`;
test("Plain text import is refused; Find and replace; caption import, edit and style", async () => {
  const w = await toolWorld();
  const refused = await w.writeFails("jc_caption_import", { text: "Welcome", format: "txt" });
  assert.equal(refused.code, "INVALID_PARAMS");
  assert.deepEqual(refused.details?.allowed, ["srt", "vtt", "ass", "ssa"]);
  assert.equal((await w.writeFails("jc_caption_import", { text: "no timings here", format: "srt" })).code, "INVALID_PARAMS");
  const imported = await w.write("jc_caption_import", { text: SRT, format: "srt", language: "en", offset: S });
  assert.equal(imported.data.captionCount, 3);
  const [first, second, third] = imported.data.captionIds;
  const track = timeline.located(await w.proposed(), first).track;
  assert.deepEqual([track.type, track.elements.map((caption) => [caption.startTime / S, caption.duration / S])], ["caption", [[2, 2], [4.5, 2.5], [8, 2]]]);
  const replaced = await w.write("jc_caption_edit", { findReplace: { find: "JAgent Chill", replace: "JAgentChill" } });
  assert.equal(replaced.data.replacements, 2, "the result reports the number of replacements");
  assert.deepEqual([(await w.element(first)).text, (await w.element(third)).text], ["Welcome to JAgentChill", "JAgentChill makes editing easy"]);
  assert.deepEqual((await w.write("jc_caption_edit", { findReplace: { find: "nothing like this", replace: "x" } })).warnings, ["no_change"]);
  // Text, timing and speaker of one caption; captions of a track never overlap.
  await w.write("jc_caption_edit", { edits: [{ captionId: second, text: "Please subscribe", start: 5 * S, end: 7 * S, speaker: "Mai" }] });
  const edited = await w.element(second) as any;
  assert.deepEqual([edited.text, edited.startTime, edited.duration, edited.speaker], ["Please subscribe", 5 * S, 2 * S, "Mai"]);
  const overlap = await w.writeFails("jc_caption_edit", { edits: [{ captionId: second, end: 9 * S }] });
  assert.deepEqual([overlap.code, overlap.details?.conflictingElementIds], ["OVERLAP_NOT_ALLOWED", [third]]);
  await w.write("jc_caption_edit", { edits: [{ action: "split", captionIds: [third], at: 11 }] });
  assert.equal(timeline.located(await w.proposed(), first).track.elements.length, 4);
  await w.write("jc_caption_edit", { edits: [{ action: "merge", captionIds: [first, second] }] });
  assert.equal((await w.element(first)).text, "Welcome to JAgentChill Please subscribe");
  await w.write("jc_caption_edit", { edits: [{ action: "delete", captionIds: [third] }] });
  assert.equal(timeline.located(await w.proposed(), first).track.elements.length, 2);
  assert.equal((await w.writeFails("jc_caption_edit", { edits: [{ captionId: w.project.clipA, text: "x" }] })).code, "UNSUPPORTED_FOR_ELEMENT");
  // Track style: a bundled style, the layout and the highlight; per-caption overrides refuse track-only keys.
  const style = (await w.ok("jc_library_search", { kind: "caption_style", limit: 3 })).data.items[2].id;
  await w.write("jc_caption_style", { trackId: track.id, styleId: style, layout: { anchor: "top", marginY: 8 }, highlight: { style: "karaoke", color: "#00ff88" }, bilingual: { visible: false }, showSpeakerLabels: true, burnIn: false, style: { fontSize: 6 } });
  const caption = timeline.located(await w.proposed(), first).track.caption as any;
  assert.deepEqual([caption.layout.anchor, caption.layout.marginY, caption.highlight.style, caption.highlight.color, caption.bilingual.visible, caption.showSpeakerLabels, caption.burnIn, caption.style.fontSize], ["top", 8, "karaoke", "#00ff88", false, true, false, 6]);
  await w.write("jc_caption_style", { captionIds: [first], style: { color: "#ff0000", fontWeight: 900 } });
  assert.deepEqual((await w.element(first)).style, { color: "#ff0000", fontWeight: 900 });
  assert.equal((await w.writeFails("jc_caption_style", { captionIds: [first], layout: { anchor: "top" } })).code, "INVALID_PARAMS");
  assert.equal((await w.writeFails("jc_caption_style", { trackId: track.id, layout: { marginY: 80 } })).code, "OUT_OF_RANGE");
  assert.equal((await w.writeFails("jc_caption_style", { trackId: track.id, styleId: "nope" })).code, "LIBRARY_ITEM_NOT_FOUND");
  assert.equal((await w.writeFails("jc_caption_style", { trackId: w.project.musicTrack, styleId: style })).code, "TRACK_KIND_MISMATCH");
  w.close();
});

test("Fade out the music; Fades longer than the element; Volume out of range is rejected, not clamped; Voice changer and pitch; Ducking; audio crossfade", async () => {
  const w = await toolWorld();
  await w.write("jc_audio_edit", { elementIds: [w.project.music], fadeOut: { duration: 2 * S, shape: "s-curve" } });
  assert.deepEqual((await w.element(w.project.music)).fadeOut, { duration: 2 * S, shape: "s-curve" }, "a 2 s fade at its end with that shape");
  // A 10 s element whose fade out is 4 s takes at most 6 s of fade in.
  await w.write("jc_audio_edit", { elementIds: [w.project.clipA], fadeOut: { duration: 4 * S } });
  const fades = await w.writeFails("jc_audio_edit", { elementIds: [w.project.clipA], fadeIn: { duration: 8 * S } });
  assert.deepEqual([fades.code, fades.details], ["OUT_OF_RANGE", { field: "fadeIn.duration", min: 0, max: 6 * S, value: 8 * S }]);
  const loud = await w.writeFails("jc_audio_edit", { elementIds: [w.project.clipA], volume: 40 });
  assert.deepEqual([loud.code, loud.details], ["OUT_OF_RANGE", { field: "volume", min: -60, max: 20, value: 40 }]);
  assert.equal((await w.element(w.project.clipA)).volume, 0, "the stored volume is unchanged");
  await w.write("jc_audio_edit", { elementIds: [w.project.music], voiceEffect: { type: "robot", intensity: 60 }, pitch: { semitones: -2 } });
  const voiced = await w.element(w.project.music) as any;
  assert.deepEqual([voiced.voiceEffect, voiced.pitch], [{ type: "robot", intensity: 60 }, { semitones: -2, cents: 0 }]);
  await w.write("jc_audio_edit", { elementIds: [w.project.music, w.project.clipB], volume: -12, mute: true, pan: 30, isVoice: true, normalize: { enabled: true, target: -16 }, eq: { enabled: true, preset: "warm", bands: { mid: 3 } }, compressor: { enabled: true, ratio: 4 } });
  const mixed = await w.element(w.project.clipB) as any;
  assert.deepEqual([mixed.volume, mixed.muted, mixed.pan, mixed.isVoice, mixed.normalize.target, mixed.eq.enabled, mixed.eq.preset, mixed.eq.bands.mid, mixed.eq.bands.low, mixed.compressor.ratio, mixed.compressor.threshold], [-12, true, 30, true, -16, true, "custom", 3, 3, 4, -18]);
  for (const [args, field] of [[{ pan: 150 }, "pan"], [{ pitch: { semitones: 20 } }, "pitch.semitones"], [{ voiceEffect: { type: "robot", intensity: 130 } }, "voiceEffect.intensity"], [{ normalize: { enabled: true, target: -2 } }, "normalize.target"], [{ eq: { enabled: true, bands: { low: 14 } } }, "eq.bands.low"], [{ compressor: { enabled: true, ratio: 40 } }, "compressor.ratio"]] as const) {
    const error = await w.writeFails("jc_audio_edit", { elementIds: [w.project.music], ...args });
    assert.deepEqual([error.code, error.details?.field], ["OUT_OF_RANGE", field], field);
  }
  assert.equal((await w.writeFails("jc_audio_edit", { elementIds: [w.project.music], voiceEffect: { type: "dalek" } })).code, "INVALID_PARAMS");
  const title = await w.write("jc_text_add", { content: "Title", start: 0 });
  assert.equal((await w.writeFails("jc_audio_edit", { elementIds: [title.data.elementId], volume: -3 })).code, "UNSUPPORTED_FOR_ELEMENT", "visual-only elements are rejected");
  assert.equal((await w.writeFails("jc_audio_edit", { elementIds: [w.project.music] })).code, "INVALID_PARAMS");
  await w.ok("jc_proposal_discard");
  // Ducking is a track setting; no volume keyframe is written.
  await w.write("jc_audio_duck", { musicTrackIds: [w.project.musicTrack], enabled: true, mode: "voice-band", voiceElementIds: [w.project.clipB] });
  const doc = await w.proposed(), music = w.scene(doc).tracks.audio[0] as any;
  assert.deepEqual([music.ducking.enabled, music.ducking.amount, (await w.element(w.project.clipB)).isVoice, (await w.element(w.project.music)).animations], [true, 12, true, undefined]);
  assert.equal(music.ducking.mode, "voice-band", "the agent can select band-limited music ducking");
  assert.equal((await w.writeFails("jc_audio_duck", { musicTrackIds: [w.project.musicTrack], enabled: true, mode: "bass-only" })).code, "INVALID_PARAMS");
  assert.equal((await w.writeFails("jc_audio_duck", { musicTrackIds: [w.project.mainTrackId], enabled: true })).code, "TRACK_KIND_MISMATCH");
  assert.equal((await w.writeFails("jc_audio_duck", { musicTrackIds: [w.project.musicTrack], enabled: true, amount: 45 })).code, "OUT_OF_RANGE");
  // A crossfade between two adjacent audio elements.
  const parts = (await w.write("jc_clip_split", { elementIds: [w.project.music], times: [10 * S] })).data.elementIds;
  const crossfade = await w.write("jc_audio_crossfade", { elementIdA: parts[0], elementIdB: parts[1], duration: S, shape: "linear" });
  const record = (w.scene(await w.proposed()).tracks.audio[0].transitions as any[])[0];
  assert.deepEqual([record.kind, record.duration, record.shape, record.id], ["crossfade", S, "linear", crossfade.data.transitionId]);
  assert.equal((await w.writeFails("jc_audio_crossfade", { elementIdA: parts[0], elementIdB: parts[1], duration: S })).code, "ALREADY_EXISTS");
  assert.equal((await w.writeFails("jc_audio_crossfade", { elementIdA: w.project.clipA, elementIdB: w.project.clipB, duration: S })).code, "UNSUPPORTED_FOR_ELEMENT");
  const far = (await w.write("jc_clip_add", { assetId: w.project.assets.music, trackId: w.project.musicTrack, start: 40 * S, sourceOut: 5 * S })).data.elementIds[0];
  assert.equal((await w.writeFails("jc_audio_crossfade", { elementIdA: parts[1], elementIdB: far, duration: S })).code, "INVALID_PARAMS");
  assert.equal((await w.writeFails("jc_audio_crossfade", { elementIdA: parts[1], elementIdB: far, duration: 20 * S })).code, "INVALID_PARAMS");
  w.close();
});

test("Apply an effect with parameters; Second filter replaces the first; Parameter out of range; Effect limit; Cross dissolve between two clips; Not adjacent; Duration beyond the owner's limit", async () => {
  const w = await toolWorld();
  const blur = (await w.ok("jc_library_search", { kind: "effect", query: "blur" })).data.items.find((item: any) => item.id === "blur");
  const numeric = blur.params.find((param: any) => param.type === "number");
  const value = Math.min(numeric.max, 12);
  const applied = await w.write("jc_effect_apply", { target: { elementIds: [w.project.clipA] }, effectId: "blur", params: { [numeric.name]: value } });
  let effects = (await w.element(w.project.clipA)).effects as any[];
  assert.deepEqual([effects.length, effects[0].params[numeric.name], effects[0].id, effects[0].kind], [1, value, applied.data.effectInstanceId, "effect"], "one more effect instance with that parameter; its instance id is returned");
  const range = await w.writeFails("jc_effect_apply", { target: { elementIds: [w.project.clipA] }, effectId: "blur", params: { [numeric.name]: numeric.max + 1000 } });
  assert.deepEqual([range.code, range.details?.field, range.details?.max], ["OUT_OF_RANGE", `params.${numeric.name}`, numeric.max]);
  assert.equal((await w.writeFails("jc_effect_apply", { target: { elementIds: [w.project.clipA] }, effectId: "blur", params: { sparkle: 3 } })).code, "INVALID_PARAMS");
  assert.equal((await w.writeFails("jc_effect_apply", { target: { elementIds: [w.project.clipA] }, effectId: "sparkle-9000" })).code, "LIBRARY_ITEM_NOT_FOUND");
  assert.equal((await w.writeFails("jc_effect_apply", { target: { elementIds: [w.project.music] }, effectId: "blur" })).code, "UNSUPPORTED_FOR_ELEMENT");
  // Update, disable and reorder an instance.
  const second = await w.write("jc_effect_apply", { target: { elementIds: [w.project.clipA] }, effectId: "blur" });
  const updated = await w.write("jc_effect_update", { elementId: w.project.clipA, effectInstanceId: second.data.effectInstanceId, params: { [numeric.name]: numeric.min }, enabled: false, order: 0 });
  assert.deepEqual([updated.data.effect.enabled, updated.data.effect.params[numeric.name], updated.data.order[0]], [false, numeric.min, second.data.effectInstanceId]);
  assert.equal((await w.writeFails("jc_effect_update", { elementId: w.project.clipA, effectInstanceId: second.data.effectInstanceId, params: { [numeric.name]: numeric.max + 1 } })).code, "OUT_OF_RANGE");
  assert.equal((await w.writeFails("jc_effect_update", { elementId: w.project.clipA, effectInstanceId: "nope", enabled: true })).code, "NOT_FOUND");
  // Filters: one per element, the second replaces the first.
  const filters = (await w.ok("jc_library_search", { kind: "filter", limit: 2 })).data.items;
  await w.write("jc_filter_apply", { target: { elementIds: [w.project.clipA] }, filterId: filters[0].id, intensity: 60 });
  await w.write("jc_filter_apply", { target: { elementIds: [w.project.clipA] }, filterId: filters[1].id });
  effects = (await w.element(w.project.clipA)).effects as any[];
  assert.deepEqual(effects.filter((entry) => entry.kind === "filter").map((entry) => entry.type), [filters[1].id], "exactly one filter entry, the new one");
  const strong = await w.writeFails("jc_filter_apply", { target: { elementIds: [w.project.clipA] }, filterId: filters[0].id, intensity: 170 });
  assert.deepEqual([strong.code, strong.details?.max], ["OUT_OF_RANGE", 100]);
  await w.write("jc_filter_remove", { elementIds: [w.project.clipA] });
  assert.deepEqual((await w.write("jc_filter_remove", { elementIds: [w.project.clipA] })).warnings, ["no_change"]);
  await w.write("jc_effect_remove", { elementId: w.project.clipA, all: true });
  assert.deepEqual((await w.element(w.project.clipA)).effects, []);
  // Sixteen entries and no more.
  for (let index = 0; index < 16; index++) await w.write("jc_effect_apply", { target: { elementIds: [w.project.clipB] }, effectId: "blur" });
  const full = await w.writeFails("jc_effect_apply", { target: { elementIds: [w.project.clipB] }, effectId: "blur" });
  assert.equal(full.code, "OUT_OF_RANGE");
  assert.match(full.message, /16/);
  // Standalone layers.
  const layer = await w.write("jc_effect_apply", { target: { effectLayer: { start: 2 * S, duration: 3 * S } }, effectId: "blur", params: { [numeric.name]: value } });
  const layered = await w.element(layer.data.elementId) as any;
  assert.deepEqual([layered.type, layered.startTime, layered.duration, layered.effects[0].params[numeric.name]], ["effect", 2 * S, 3 * S, value]);
  const whole = await w.write("jc_effect_apply", { target: { scene: true }, effectId: "blur" });
  assert.equal((await w.element(whole.data.elementId)).duration, 30 * S);
  const filterLayer = await w.write("jc_filter_apply", { target: { filterLayer: { start: 0, duration: 2 * S } }, filterId: filters[0].id, intensity: 40 });
  assert.equal(((await w.element(filterLayer.data.elementId)).effects as any[])[0].params.intensity, 40);
  await w.ok("jc_proposal_discard");

  // Transitions between adjacent clips.
  const dissolve = await w.write("jc_transition_set", { betweenElementIds: [w.project.clipA, w.project.clipB], transitionId: "cross-dissolve", duration: S / 2 });
  const record = (w.scene(await w.proposed()).tracks.main.transitions as any[])[0];
  assert.deepEqual([record.kind, record.type, record.duration, record.id, dissolve.data.duration], ["transition", "cross-dissolve", S / 2, dissolve.data.transitionId, S / 2], "a transition of 0.5 s between them");
  await w.write("jc_transition_set", { betweenElementIds: [w.project.clipA, w.project.clipB], transitionId: "domain-warp", params: { strength: 60, scale: 24, seed: 17 } });
  const agentShader = (w.scene(await w.proposed()).tracks.main.transitions as any[])[0];
  assert.deepEqual([agentShader.type, agentShader.params], ["domain-warp", { strength: 60, scale: 24, seed: 17 }], "the agent transition tool accepts the new shader id and params");
  await w.write("jc_transition_set", { betweenElementIds: [w.project.clipB, w.project.clipA], transitionId: "cross-dissolve", duration: S, easing: "linear", audioCrossfade: false });
  const edited = (w.scene(await w.proposed()).tracks.main.transitions as any[])[0];
  assert.deepEqual([edited.duration, edited.easing, edited.audioCrossfade, edited.id], [S, "linear", false, record.id]);
  await w.write("jc_transition_remove", { betweenElementIds: [w.project.clipA, w.project.clipB] });
  assert.equal(w.scene(await w.proposed()).tracks.main.transitions.length, 0);
  assert.equal((await w.writeFails("jc_transition_remove", { betweenElementIds: [w.project.clipA, w.project.clipB] })).code, "NOT_FOUND");
  assert.equal((await w.writeFails("jc_transition_set", { betweenElementIds: [w.project.clipA, w.project.clipB], transitionId: "nope" })).code, "LIBRARY_ITEM_NOT_FOUND");
  // A transition longer than the cut between a 2 s and a 20 s clip can hold.
  await w.write("jc_clip_trim", { elementId: w.project.clipA, edge: "end", to: 2 * S });
  const long = await w.writeFails("jc_transition_set", { betweenElementIds: [w.project.clipA, w.project.clipB], transitionId: "cross-dissolve", duration: 6 * S });
  const limits = timeline.durationLimits(w.scene(await w.proposed()).tracks.main, w.project.clipA, w.project.clipB, { numerator: 30, denominator: 1 });
  assert.deepEqual([long.code, long.details?.field, long.details?.min, long.details?.max], ["OUT_OF_RANGE", "duration", limits.min * S, limits.max * S], "the limits the transitions capability computes for that cut");
  assert.equal(limits.max, 4, "half of the window lies in each clip: the 2 s clip holds at most a 4 s transition");
  assert.equal(w.scene(await w.proposed()).tracks.main.transitions.length, 0, "nothing is staged");
  assert.equal((await w.write("jc_transition_set", { betweenElementIds: [w.project.clipA, w.project.clipB], transitionId: "cross-dissolve", duration: long.details!.max })).data.duration, long.details!.max);
  // Not adjacent.
  await w.write("jc_transition_remove", { allOnTrack: w.project.mainTrackId });
  await w.write("jc_clip_move", { elementIds: [w.project.clipB], delta: S, editContext: { magnet: false } });
  const gap = await w.writeFails("jc_transition_set", { betweenElementIds: [w.project.clipA, w.project.clipB], transitionId: "cross-dissolve" });
  assert.equal(gap.code, "INVALID_PARAMS");
  assert.match(gap.message, /not adjacent/);
  await w.write("jc_gap_close", {});
  const all = await w.write("jc_transition_set", { allOnTrack: w.project.mainTrackId, transitionId: "cross-dissolve" });
  assert.equal(all.data.transitions.length, 1);
  w.close();
});

test("Warm up a clip; Unknown key; Invalid curve; Zoom in over a clip; Unknown easing preset; Keyframe outside the element; Non-canonical property name", async () => {
  const w = await toolWorld();
  await w.write("jc_color_adjust", { target: { elementIds: [w.project.clipA] }, basic: { contrast: 10 } });
  await w.write("jc_color_adjust", { target: { elementIds: [w.project.clipA] }, basic: { temperature: 20 } });
  const basic = ((await w.element(w.project.clipA)).adjustments as any).basic;
  assert.deepEqual([basic.temperature, basic.contrast], [20, 10], "temperature 20 and contrast 10");
  const unknown = await w.writeFails("jc_color_adjust", { target: { elementIds: [w.project.clipA] }, basic: { sharpen: 30 } });
  assert.equal(unknown.code, "INVALID_PARAMS");
  assert.match(unknown.message, /sharpen/);
  assert.ok(unknown.details?.allowed.includes("sharpness"));
  assert.equal((await w.writeFails("jc_color_adjust", { target: { elementIds: [w.project.clipA] }, curves: { master: [{ x: 0, y: 0 }] } })).code, "INVALID_PARAMS", "a curve has at least two points");
  assert.equal((await w.writeFails("jc_color_adjust", { target: { elementIds: [w.project.clipA] }, basic: { exposure: 400 } })).code, "OUT_OF_RANGE");
  assert.equal((await w.writeFails("jc_color_adjust", { target: { elementIds: [w.project.clipA] }, hsl: { teal: { hue: 3 } } })).code, "INVALID_PARAMS");
  await w.write("jc_color_adjust", { target: { elementIds: [w.project.clipA] }, hsl: { blue: { saturation: 30 } }, curves: { master: [{ x: 0, y: 0.05 }, { x: 0.5, y: 0.55 }, { x: 1, y: 1 }] }, wheels: { shadows: { x: 0.1, y: -0.1, luminance: 5 } }, enabled: { hsl: false } });
  const graded = (await w.element(w.project.clipA)).adjustments as any;
  assert.deepEqual([graded.hsl.blue.saturation, graded.hsl.enabled, graded.curves.master.length, graded.wheels.shadows.x, graded.basic.contrast], [30, false, 3, 0.1, 10], "groups that were not passed are untouched");
  await w.write("jc_color_adjust", { target: { elementIds: [w.project.clipA] }, reset: true, basic: { saturation: -100 } });
  const reset = (await w.element(w.project.clipA)).adjustments as any;
  assert.deepEqual([reset.basic.saturation, reset.basic.contrast, reset.hsl], [-100, 0, undefined]);
  const layer = await w.write("jc_color_adjust", { target: { adjustmentLayer: { start: 0, duration: 5 * S } }, basic: { vignette: 40 } });
  const adjustment = await w.element(layer.data.adjustmentLayerId) as any;
  assert.deepEqual([adjustment.type, adjustment.duration, adjustment.adjustments.basic.vignette], ["adjustment", 5 * S, 40]);
  assert.equal((await w.writeFails("jc_color_adjust", { target: { elementIds: [w.project.music] }, basic: { contrast: 5 } })).code, "UNSUPPORTED_FOR_ELEMENT");
  await w.ok("jc_proposal_discard");

  // A slow zoom: scale 1.0 at the start, 1.2 at the end, with an easing preset.
  const zoom = await w.write("jc_keyframe_set", { elementId: w.project.clipB, property: "transform.scale", keyframes: [{ time: 10 * S, value: 1, easing: "ease-in-out" }, { time: 30 * S, value: 1.2 }] });
  assert.deepEqual(zoom.data.storedPaths, ["transform.scale.x", "transform.scale.y"]);
  assert.deepEqual(zoom.data.keyframes.map((entry: any) => [entry.time / S, entry.value, entry.segmentToNext]), [[10, 1, "bezier"], [30, 1.2, "linear"]]);
  const animations = (await w.element(w.project.clipB)).animations as any;
  assert.deepEqual([animations["transform.scale.x"].keys.map((entry: any) => entry.time / S), animations["transform.scale.y"].keys.length], [[0, 20], 2], "keys are stored relative to the element");
  const bouncy = await w.writeFails("jc_keyframe_set", { elementId: w.project.clipB, property: "opacity", keyframes: [{ time: 12 * S, value: 0.5, easing: "bouncy" }] });
  assert.equal(bouncy.code, "LIBRARY_ITEM_NOT_FOUND");
  assert.ok(bouncy.details?.allowed.includes("in-out") && bouncy.details?.allowed.includes("ease-in"), "the preset ids are listed");
  const outside = await w.writeFails("jc_keyframe_set", { elementId: w.project.clipB, property: "opacity", keyframes: [{ time: 40 * S, value: 0.5 }] });
  assert.deepEqual([outside.code, outside.details?.min, outside.details?.max], ["OUT_OF_RANGE", 10 * S, 30 * S]);
  const name = await w.writeFails("jc_keyframe_set", { elementId: w.project.clipB, property: "transform.scaleX", keyframes: [{ time: 12 * S, value: 1 }] });
  assert.equal(name.code, "INVALID_PARAMS");
  assert.match(name.message, /transform\.scale\.x/);
  assert.equal((await w.writeFails("jc_keyframe_set", { elementId: w.project.clipB, property: "opacity", keyframes: [{ time: 12 * S, value: 1.5 }] })).code, "OUT_OF_RANGE");
  assert.equal((await w.writeFails("jc_keyframe_set", { elementId: w.project.music, property: "opacity", keyframes: [{ time: S, value: 1 }] })).code, "INVALID_PARAMS", "a path the element type does not have");
  // Step, linear, an explicit bezier; a key at an existing time replaces it; replaceExisting clears the rest.
  await w.write("jc_keyframe_set", { elementId: w.project.clipB, property: "opacity", keyframes: [{ time: 10 * S, value: 0, easing: "hold" }, { time: 12 * S, value: 1, easing: { bezier: [0.2, 0, 0.8, 1] } }, { time: 14 * S, value: 0.5 }] });
  await w.write("jc_keyframe_set", { elementId: w.project.clipB, property: "opacity", keyframes: [{ time: 12 * S, value: 0.8 }] });
  let keys = ((await w.element(w.project.clipB)).animations as any).opacity.keys;
  assert.deepEqual(keys.map((entry: any) => [entry.time / S, entry.value, entry.segmentToNext]), [[0, 0, "step"], [2, 0.8, "bezier"], [4, 0.5, "linear"]], "the key at an existing time is replaced and keeps its segment");
  const volume = await w.write("jc_keyframe_set", { elementId: w.project.music, property: "volume", keyframes: [{ time: 0, value: -60 }, { time: 2 * S, value: 0 }] });
  assert.equal(volume.data.keyframes.length, 2);
  const listed = await w.ok("jc_keyframe_properties", { elementId: w.project.clipB });
  assert.equal(listed.data.properties.find((entry: any) => entry.path === "opacity").keyframes, 0, "a read sees the committed state");
  assert.deepEqual([listed.data.properties.find((entry: any) => entry.path === "opacity").min, listed.data.properties.find((entry: any) => entry.path === "opacity").max, listed.data.shorthand], [0, 1, ["transform.scale"]]);
  assert.ok(listed.data.properties.some((entry: any) => entry.path === "transform.position.x") && listed.data.properties.some((entry: any) => entry.path === "crop.left"));
  await w.write("jc_keyframe_remove", { elementId: w.project.clipB, property: "opacity", times: [12 * S] });
  keys = ((await w.element(w.project.clipB)).animations as any).opacity.keys;
  assert.deepEqual(keys.map((entry: any) => entry.time / S), [0, 4]);
  await w.write("jc_keyframe_remove", { elementId: w.project.clipB, property: "transform.scale", all: true });
  assert.equal(((await w.element(w.project.clipB)).animations as any)["transform.scale.x"], undefined);
  assert.deepEqual((await w.write("jc_keyframe_remove", { elementId: w.project.clipB, property: "opacity", times: [29 * S] })).warnings, ["no_change"]);
  await w.write("jc_keyframe_set", { elementId: w.project.clipB, property: "opacity", replaceExisting: true, keyframes: [{ time: 20 * S, value: 1 }] });
  assert.equal(((await w.element(w.project.clipB)).animations as any).opacity.keys.length, 1);
  w.close();
});

test("Double speed; Too many curve points; Chroma strength out of range is rejected, not clamped; Mask with a combine mode; Mask stroke; Element type cannot be masked; Mask limit", async () => {
  const w = await toolWorld();
  // A 10 s main-track clip at rate 2 becomes 5 s and the following clip starts 5 s earlier.
  const fast = await w.write("jc_speed_set", { elementIds: [w.project.clipA], rate: 2 });
  assert.equal(fast.data.elements[0].duration, 5 * S);
  assert.deepEqual((await w.main()).map((element) => [element.startTime / S, element.duration / S]), [[0, 5], [5, 20]]);
  assert.equal(((await w.element(w.project.clipA)).retime as any).rate, 2);
  const points = await w.writeFails("jc_speed_set", { elementIds: [w.project.clipA], curve: { points: Array.from({ length: 33 }, (_, index) => ({ u: index / 32, rate: 1 })) } });
  assert.equal(points.code, "OUT_OF_RANGE");
  assert.equal((await w.writeFails("jc_speed_set", { elementIds: [w.project.clipA], rate: 500 })).code, "OUT_OF_RANGE");
  assert.equal((await w.writeFails("jc_speed_set", { elementIds: [w.project.clipA], curve: { preset: "warp" } })).code, "LIBRARY_ITEM_NOT_FOUND");
  assert.equal((await w.writeFails("jc_speed_set", { elementIds: [w.project.clipA], curve: { points: [{ u: 0.1, rate: 1 }, { u: 1, rate: 2 }] } })).code, "INVALID_PARAMS");
  await w.write("jc_speed_set", { elementIds: [w.project.clipB], curve: { preset: "montage" }, reverse: true, maintainPitch: false });
  const curved = (await w.element(w.project.clipB)).retime as any;
  assert.deepEqual([curved.curve.preset, curved.reverse, curved.maintainPitch], ["montage", true, false]);
  const title = await w.write("jc_text_add", { content: "Title", start: 0 });
  assert.equal((await w.writeFails("jc_speed_set", { elementIds: [title.data.elementId], rate: 2 })).code, "UNSUPPORTED_FOR_ELEMENT");
  await w.ok("jc_proposal_discard");

  const strength = await w.writeFails("jc_chroma_set", { elementIds: [w.project.clipA], enabled: true, strength: 140 });
  assert.deepEqual([strength.code, strength.details], ["OUT_OF_RANGE", { field: "strength", min: 0, max: 100, value: 140 }]);
  assert.equal((await w.element(w.project.clipA)).chromaKey, undefined, "the stored strength is unchanged");
  await w.write("jc_chroma_set", { elementIds: [w.project.clipA], enabled: true, color: "#00FF00", strength: 60, spill: 30 });
  const chroma = (await w.element(w.project.clipA)).chromaKey as any;
  assert.deepEqual([chroma.enabled, chroma.color, chroma.strength, chroma.spill], [true, "#00ff00", 60, 30]);
  assert.equal((await w.writeFails("jc_chroma_set", { elementIds: [w.project.music], enabled: true })).code, "UNSUPPORTED_FOR_ELEMENT");
  // Masks.
  const first = await w.write("jc_mask_set", { elementId: w.project.clipA, action: "add", type: "ellipse" });
  const second = await w.write("jc_mask_set", { elementId: w.project.clipA, action: "add", type: "rectangle", combine: "subtract" });
  let masks = (await w.element(w.project.clipA)).masks as any[];
  assert.deepEqual([masks.length, masks[1].combine, masks[1].id], [2, "subtract", second.data.maskId]);
  await w.write("jc_mask_set", { elementId: w.project.clipA, action: "update", maskId: first.data.maskId, params: { strokeWidth: 6, strokeColor: "#ffffff", strokeAlign: "outside", feather: 200 }, enabled: false });
  masks = (await w.element(w.project.clipA)).masks as any[];
  assert.deepEqual([masks[0].params.strokeWidth, masks[0].params.strokeColor, masks[0].params.strokeAlign, masks[0].params.feather, masks[0].enabled], [6, "#ffffff", "outside", 200, false]);
  assert.equal((await w.writeFails("jc_mask_set", { elementId: w.project.clipA, action: "update", maskId: first.data.maskId, params: { feather: 5000 } })).code, "OUT_OF_RANGE");
  assert.equal((await w.writeFails("jc_mask_set", { elementId: w.project.clipA, action: "update", maskId: first.data.maskId, params: { sparkle: 1 } })).code, "INVALID_PARAMS");
  await w.write("jc_mask_set", { elementId: w.project.clipA, action: "reorder", maskId: second.data.maskId, index: 0 });
  assert.equal(((await w.element(w.project.clipA)).masks as any[])[0].id, second.data.maskId);
  await w.write("jc_mask_set", { elementId: w.project.clipA, action: "remove", maskId: first.data.maskId });
  assert.equal(((await w.element(w.project.clipA)).masks as any[]).length, 1);
  assert.equal((await w.writeFails("jc_mask_set", { elementId: w.project.clipA, action: "update", maskId: first.data.maskId, enabled: true })).code, "NOT_FOUND");
  const text = await w.write("jc_text_add", { content: "Title", start: 0 });
  assert.equal((await w.writeFails("jc_mask_set", { elementId: text.data.elementId, action: "add", type: "ellipse" })).code, "UNSUPPORTED_FOR_ELEMENT");
  for (let index = 0; index < 7; index++) await w.write("jc_mask_set", { elementId: w.project.clipA, action: "add", type: "star" });
  const ninth = await w.writeFails("jc_mask_set", { elementId: w.project.clipA, action: "add", type: "star" });
  assert.deepEqual([ninth.code, ninth.details?.max], ["OUT_OF_RANGE", 8]);
  w.close();
});

test("Add a marker; Duplicate marker time; Triangle; Unknown shape; Restyle a shape after creation; Replace a sticker; Freehand drawing; Update by marker id; Unknown marker id", async () => {
  const w = await toolWorld();
  const hook = await w.write("jc_marker_edit", { action: "add", time: 3 * S, note: "Hook" });
  assert.deepEqual(w.scene(await w.proposed()).markers.map((marker: any) => [marker.id, marker.time, marker.note]), [[hook.data.markerId, 3 * S, "Hook"]]);
  assert.equal((await w.writeFails("jc_marker_edit", { action: "add", time: 3 * S + 100 })).code, "INVALID_PARAMS", "two markers cannot share a frame");
  // Another marker is inserted before it; the first is still addressed by its id.
  await w.write("jc_marker_edit", { action: "add", time: S, color: "#FF3B30", duration: 2 * S });
  const moved = await w.write("jc_marker_edit", { action: "update", markerId: hook.data.markerId, time: 5 * S, color: 4 });
  assert.equal(moved.data.time, 5 * S);
  assert.deepEqual(w.scene(await w.proposed()).markers.map((marker: any) => [marker.time / S, marker.note, marker.color, marker.duration]), [[1, undefined, "#ff3b30", 2 * S], [5, "Hook", 4, undefined]]);
  assert.equal((await w.writeFails("jc_marker_edit", { action: "update", markerId: "nope", time: S })).code, "NOT_FOUND");
  assert.equal((await w.writeFails("jc_marker_edit", { action: "update", markerId: hook.data.markerId, time: S })).code, "INVALID_PARAMS");
  assert.equal((await w.writeFails("jc_marker_edit", { action: "add", time: 9 * S, color: 12 })).code, "OUT_OF_RANGE");
  assert.equal((await w.writeFails("jc_marker_edit", { action: "add", time: 9 * S, note: "x".repeat(2001) })).code, "OUT_OF_RANGE");
  await w.write("jc_marker_edit", { action: "remove", markerId: hook.data.markerId });
  assert.equal(w.scene(await w.proposed()).markers.length, 1);

  // Shapes.
  const triangle = await w.write("jc_shape_add", { shape: "polygon", start: 0, duration: 2 * S, params: { sides: 3, fill: "#00aaff" }, size: { width: 300, height: 300 }, position: { x: 100, y: 100 } });
  const polygon = await w.element(triangle.data.elementId) as any;
  assert.deepEqual([polygon.type, polygon.definitionId, polygon.params.sides, polygon.params.fill, polygon.transform.scale, polygon.duration], ["graphic", "polygon", 3, "#00aaff", { x: 1.5, y: 1.5 }, 2 * S], "a three-sided graphic element");
  const noTriangle = await w.writeFails("jc_shape_add", { shape: "triangle", start: 0 });
  assert.equal(noTriangle.code, "LIBRARY_ITEM_NOT_FOUND");
  assert.deepEqual(noTriangle.details?.allowed, ["rectangle", "ellipse", "polygon", "star", "arrow", "line", "drawing"]);
  await w.write("jc_shape_update", { elementIds: [triangle.data.elementId], params: { fill: "#ff3b30", strokeWidth: 4, strokeAlign: "inside" } });
  const restyled = await w.element(triangle.data.elementId) as any;
  assert.deepEqual([restyled.params.fill, restyled.params.strokeWidth, restyled.params.strokeAlign, restyled.params.sides, restyled.transform.scale], ["#ff3b30", 4, "inside", 3, { x: 1.5, y: 1.5 }], "its other fields are unchanged");
  assert.equal((await w.writeFails("jc_shape_update", { elementIds: [triangle.data.elementId], params: { strokeWidth: 200 } })).code, "OUT_OF_RANGE");
  assert.equal((await w.writeFails("jc_shape_update", { elementIds: [triangle.data.elementId], params: { headSize: 30 } })).code, "INVALID_PARAMS", "a key the shape's definition does not have");
  const drawing = await w.write("jc_shape_add", { shape: "drawing", start: 4 * S, duration: 2 * S, strokes: [{ points: Array.from({ length: 40 }, (_, index) => [index * 10, Math.sin(index / 3) * 80] as [number, number]), width: 12, color: "#ffffff", brush: "pen" }] });
  const drawn = await w.element(drawing.data.elementId) as any;
  assert.deepEqual([drawn.definitionId, drawn.strokes.length, drawn.strokes[0].width, drawn.strokes[0].brush], ["drawing", 1, 12, "pen"]);
  await w.write("jc_shape_update", { elementIds: [drawing.data.elementId], strokes: [{ points: [[0, 0], [50, 50], [100, 0]], width: 8, color: "#ff0000", brush: "marker" }, { points: [[0, 100], [100, 100]], width: 8, color: "#ff0000", brush: "marker" }] });
  assert.equal(((await w.element(drawing.data.elementId)).strokes as any[]).length, 2);
  assert.equal((await w.writeFails("jc_shape_add", { shape: "drawing", start: 0, strokes: [{ points: [[0, 0], [1, 1]], width: 900, color: "#ffffff", brush: "pen" }] })).code, "OUT_OF_RANGE");
  assert.equal((await w.writeFails("jc_shape_update", { elementIds: [triangle.data.elementId], strokes: [{ points: [[0, 0], [1, 1]], width: 9, color: "#ffffff", brush: "pen" }] })).code, "UNSUPPORTED_FOR_ELEMENT");
  // Stickers.
  const sticker = await w.write("jc_sticker_add", { stickerId: "emoji:1f600", start: S, duration: 3 * S, scale: 0.8, position: { x: -200, y: 200 }, loop: false });
  const before = await w.element(sticker.data.elementId) as any;
  await w.write("jc_sticker_update", { elementIds: [sticker.data.elementId], stickerId: "flags:jp", playbackSpeed: 2 });
  const replaced = await w.element(sticker.data.elementId) as any;
  assert.deepEqual([replaced.stickerId, replaced.playbackSpeed, replaced.startTime, replaced.duration, replaced.transform, replaced.loop], ["flags:jp", 2, S, 3 * S, before.transform, false], "the new sticker with the same start, duration and transform");
  assert.deepEqual(before.transform, { position: { x: -200, y: 200 }, scale: { x: 0.8, y: 0.8 }, rotation: 0 });
  assert.equal((await w.writeFails("jc_sticker_update", { elementIds: [sticker.data.elementId], playbackSpeed: 9 })).code, "OUT_OF_RANGE");
  assert.equal((await w.writeFails("jc_sticker_add", { stickerId: "nonsense", start: 0 })).code, "LIBRARY_ITEM_NOT_FOUND");
  const fromAsset = await w.write("jc_sticker_add", { assetId: w.project.assets.photo, start: 10 * S });
  assert.equal((await w.element(fromAsset.data.elementId)).stickerId, `user:${w.project.assets.photo}`);
  assert.equal((await w.writeFails("jc_sticker_add", { assetId: w.project.assets.music, start: 0 })).code, "UNSUPPORTED_FOR_ELEMENT");
  assert.equal((await w.writeFails("jc_sticker_update", { elementIds: [triangle.data.elementId], loop: true })).code, "UNSUPPORTED_FOR_ELEMENT");
  // Everything staged here is one valid document: it is accepted and applied.
  const accepted = await w.accept(await w.submit("Markers, shapes and stickers"));
  assert.equal(accepted.proposal.state, "accepted");
  w.close();
});

test("No tool clamps", async () => {
  const w = await toolWorld();
  const title = (await w.write("jc_text_add", { content: "Title", start: 0, duration: 4 * S })).data.elementId;
  const shape = (await w.write("jc_shape_add", { shape: "rectangle", start: 0, duration: 4 * S })).data.elementId;
  const mask = (await w.write("jc_mask_set", { elementId: w.project.clipA, action: "add", type: "ellipse" })).data.maskId;
  const before = JSON.stringify(await w.proposed());
  // One above-maximum value per ranged numeric parameter: every call fails with the range and nothing is substituted.
  const over: [string, Record<string, unknown>][] = [
    ["jc_clip_transform", { elementIds: [w.project.clipA], opacity: 2 }], ["jc_clip_transform", { elementIds: [w.project.clipA], scale: 101 }], ["jc_clip_transform", { elementIds: [w.project.clipA], rotation: 3601 }],
    ["jc_clip_transform", { elementIds: [w.project.clipA], position: { x: 100_001, y: 0 } }], ["jc_clip_transform", { elementIds: [w.project.clipA], crop: { left: 1 } }], ["jc_clip_transform", { elementIds: [w.project.clipA], motionBlur: { enabled: true, strength: 101 } }],
    ["jc_audio_edit", { elementIds: [w.project.music], volume: 21 }], ["jc_audio_edit", { elementIds: [w.project.music], pan: 101 }], ["jc_audio_edit", { elementIds: [w.project.music], pitch: { cents: 101 } }], ["jc_audio_edit", { elementIds: [w.project.music], fadeIn: { duration: 31 * S } }],
    ["jc_track_edit", { action: "set_volume", trackId: w.project.musicTrack, volume: 13 }], ["jc_track_edit", { action: "set_pan", trackId: w.project.musicTrack, pan: 101 }], ["jc_audio_duck", { musicTrackIds: [w.project.musicTrack], enabled: true, release: 3001 }],
    ["jc_text_update", { elementIds: [title], style: { fontSize: 501 } }], ["jc_text_update", { elementIds: [title], style: { curve: 361 } }], ["jc_text_update", { elementIds: [title], style: { letterSpacing: 501 } }], ["jc_text_update", { elementIds: [title], style: { stroke: { width: 51 } } }],
    ["jc_shape_update", { elementIds: [shape], params: { strokeWidth: 65 } }], ["jc_shape_update", { elementIds: [shape], params: { cornerRadius: 51 } }], ["jc_mask_set", { elementId: w.project.clipA, action: "update", maskId: mask, params: { feather: 1001 } }],
    ["jc_chroma_set", { elementIds: [w.project.clipA], enabled: true, edge: 101 }], ["jc_filter_apply", { target: { elementIds: [w.project.clipA] }, filterId: "x", intensity: 101 }], ["jc_speed_set", { elementIds: [w.project.clipA], rate: 101 }],
    ["jc_color_adjust", { target: { elementIds: [w.project.clipA] }, basic: { hue: 181 } }], ["jc_color_adjust", { target: { elementIds: [w.project.clipA] }, lut: { lutId: null, intensity: 101 } }],
    ["jc_keyframe_set", { elementId: w.project.clipA, property: "opacity", keyframes: [{ time: S, value: 1.01 }] }], ["jc_sticker_add", { stickerId: "emoji:1f600", start: 0, playbackSpeed: 4.1 }], ["jc_project_update", { canvas: { width: 7682, height: 1080 } }],
  ];
  for (const [tool, args] of over) {
    const error = await w.writeFails(tool, args);
    assert.equal(error.code, "OUT_OF_RANGE", `${tool} ${JSON.stringify(args)} → ${error.code}: ${error.message}`);
    assert.ok(typeof error.details?.min === "number" && typeof error.details?.max === "number" && typeof error.details?.field === "string", `${tool} carries the range (${JSON.stringify(error.details)})`);
  }
  assert.equal(JSON.stringify(await w.proposed()), before, "no call succeeded with a substituted value");
  w.close();
});
