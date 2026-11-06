import assert from "node:assert/strict";
import { test } from "node:test";
import { createProjectDocument, projectDocumentSchema } from "@jagentchill/protocol";
import { exporting as x } from "../src/index.ts";

const HD = { width: 1920, height: 1080 }, FPS30 = { numerator: 30, denominator: 1 }, T = x.TICKS_PER_SECOND;
const base = x.applyPreset("match-project");
const caps = (patch: Partial<x.DeviceCapabilities> = {}, host: x.HostCapabilities | null = null, platform: x.Capabilities["platform"] = "web"): x.Capabilities => ({ device: { ...x.FULL_DEVICE, ...patch }, host, platform });
const host = (encoders: x.HostCapabilities["encoders"], patch: Partial<x.HostCapabilities> = {}): x.HostCapabilities => ({ name: "Studio", remoteExport: true, shareLinks: true, connectors: false, admin: false, encoders, proRes: false, ...patch });
const available = { state: "available" as const, hardware: false };
const context = (patch: Partial<x.BlockerContext> = {}): x.BlockerContext => ({ caps: caps(), durationTicks: 10 * T, hasAudibleSource: true, hasCaptionTrack: false, hasRange: false, freeBytes: null, estimateBytes: null, transparentBackground: false, ...patch });

// ---- Export entry points and dialog ------------------------------------------------------------------------------------
test("Six export types: Video, GIF, Audio, Image sequence, Still frame and Captions only, in that order", () => {
  assert.deepEqual(x.EXPORT_TYPES.map((type) => x.EXPORT_TYPE_LABELS[type]), ["Video", "GIF", "Audio", "Image sequence", "Still frame", "Captions only"]);
});
test("The UI says host: no user-facing string of the export rules contains the word Gateway", async () => {
  const { EXPORT_STRINGS } = await import("../../../apps/app/src/editor/export/strings.ts");
  assert.ok(EXPORT_STRINGS.length > 150);
  for (const text of EXPORT_STRINGS) assert.ok(!/gateway/i.test(text), text);
  for (const option of x.targetOptions(host({}))) assert.ok(!/gateway/i.test(option.label.text));
});
test("Open export on desktop: a project with no saved settings opens on the device default, else on Match project", () => {
  assert.equal(x.fromStoredExportSettings(null, base).presetId, "match-project");
  assert.equal(x.estimateLabel(x.estimateExport(base, HD, FPS30, 60 * T)).text, "≈ 76.4 MB");
});

// ---- Built-in export presets --------------------------------------------------------------------------------------------
test("Default preset: Match project is 1920×1080, 30 fps, H.264, MP4, Recommended bitrate, audio on", () => {
  assert.deepEqual(x.outputSize(base, HD), HD);
  assert.deepEqual(x.outputFrameRate(base, FPS30), FPS30);
  assert.deepEqual([base.videoCodec, base.container, base.bitrateLevel, base.includeAudio, base.audioCodec, base.audioBitrateKbps, base.sampleRate, base.channels], ["h264", "mp4", "recommended", true, "aac", 192, 48_000, 2]);
  assert.equal(x.presetName(base, []), "Match project");
  assert.equal(x.presetName(x.edit(base, { bitrateLevel: "higher" }), []), "Custom");
});
test("Built-in presets: the eleven ids, each setting every field", () => {
  assert.deepEqual(x.BUILT_IN_PRESET_IDS, ["match-project", "1080p", "4k", "small-720p", "vertical-9x16", "wide-16x9", "square-1x1", "webm", "gif", "audio-only", "image-sequence"]);
  assert.deepEqual(x.outputSize(x.applyPreset("1080p"), { width: 3840, height: 2160 }), HD);
  assert.equal(x.applyPreset("4k").bitrateLevel, "higher");
  const small = x.applyPreset("small-720p");
  assert.deepEqual([x.outputSize(small, HD), small.bitrateLevel, small.audioBitrateKbps], [{ width: 1280, height: 720 }, "lower", 128]);
  const webm = x.applyPreset("webm");
  assert.deepEqual([webm.videoCodec, webm.audioCodec, webm.container], ["vp9", "opus", "webm"]);
  assert.deepEqual(["gif", "audio-only", "image-sequence"].map((id) => x.applyPreset(id).type), ["gif", "audio", "image-sequence"]);
  assert.deepEqual(x.outputSize(x.applyPreset("square-1x1"), HD), { width: 1080, height: 1080 });
});
test("Preset with a different aspect ratio: Vertical 9:16 on a 16:9 project is 1080×1920 with the bars warning", () => {
  const vertical = x.applyPreset("vertical-9x16");
  assert.deepEqual(x.outputSize(vertical, HD), { width: 1080, height: 1920 });
  assert.equal(x.aspectDiffers(vertical, HD), true);
  assert.equal(x.aspectDiffers(base, HD), false);
  assert.equal(x.ASPECT_WARNING, "Aspect ratio differs from the project; the picture is fitted with bars");
});
test("Unknown preset id from a tool: 1080p-h264 is refused with INVALID_PARAMS listing the eleven valid ids", () => {
  assert.throws(() => x.applyPreset("1080p-h264"), (error: x.ExportParamsError) => error.code === "INVALID_PARAMS" && error.details.valid.length === 11 && error.message.includes("small-720p"));
});
test("Linux desktop with the built-in host: no AAC in the runtime, the built-in host has H.264 and AAC — the target is Host: This computer, MP4", () => {
  const linux = caps({ audio: { aac: false, opus: true, flac: true, mp3: true } }, host({ h264: available, aac: available, vp9: available, opus: available }, { thisComputer: true, healthy: true }), "desktop");
  const resolved = x.resolveH264Aac(base, linux);
  assert.deepEqual([resolved.settings.target, resolved.settings.container, resolved.settings.videoCodec, resolved.settings.audioCodec, resolved.targetLabel.text, resolved.notice], ["host", "mp4", "h264", "aac", "Host: This computer", null]);
});
test("Linux desktop without a usable host encoder: H.264 download_required — VP9 with Opus as WebM, never Opus in MP4", () => {
  const linux = caps({ audio: { aac: false, opus: true, flac: true, mp3: true } }, host({ h264: { state: "download_required", hardware: false }, aac: available, vp9: available, opus: available }, { thisComputer: true }), "desktop");
  const resolved = x.resolveH264Aac(base, linux);
  assert.deepEqual([resolved.settings.target, resolved.settings.container, resolved.settings.videoCodec, resolved.settings.audioCodec], ["device", "webm", "vp9", "opus"]);
  assert.equal(resolved.notice, "H.264 with AAC is not available here; exporting VP9 with Opus as WebM");
  assert.equal(resolved.settings.presetId, "match-project", "the preset name stays as chosen");
  assert.equal(x.fileExtension(resolved.settings), "webm");
});
test("Built-in presets: on a device with both encoders nothing is changed; another host offers Export on host", () => {
  assert.equal(x.resolveH264Aac(base, caps()).settings, base);
  const other = x.resolveH264Aac(base, caps({ audio: { aac: false, opus: true, flac: false, mp3: false } }, host({ h264: available, aac: available })));
  assert.equal(other.action, "Export on host");
});

// ---- User-saved export presets ------------------------------------------------------------------------------------------
let ids = 0;
const newId = () => `p${++ids}`;
test("Save a preset: Client review appears after the built-ins and restores every saved field", () => {
  const custom = x.edit(base, { bitrateLevel: "maximum", sampleRate: 44_100 });
  const saved = x.saveUserPreset([], "Client review", custom, { newId });
  assert.equal(saved.state, "saved");
  if (saved.state !== "saved") return;
  assert.equal(x.presetName(saved.preset.settings, saved.presets), "Client review");
  assert.deepEqual({ ...saved.preset.settings, presetId: null }, custom);
  assert.ok(x.isUserPresets(saved.presets));
});
test("Duplicate name: saving client review while Client review exists asks before overwriting and changes nothing", () => {
  const first = x.saveUserPreset([], "Client review", base, { newId });
  assert.equal(first.state, "saved");
  if (first.state !== "saved") return;
  const again = x.saveUserPreset(first.presets, "client review", x.edit(base, { channels: 1 }), { newId });
  assert.equal(again.state, "duplicate");
  const confirmed = x.saveUserPreset(first.presets, "client review", x.edit(base, { channels: 1 }), { newId, overwrite: true });
  assert.ok(confirmed.state === "saved" && confirmed.presets.length === 1 && confirmed.presets[0].settings.channels === 1 && confirmed.presets[0].name === "Client review");
});
test("Preset limit: with 30 saved presets Save as preset is refused with the limit message", () => {
  let presets: x.UserPreset[] = [];
  for (let index = 0; index < 30; index++) { const made = x.saveUserPreset(presets, `Preset ${index}`, base, { newId }); assert.equal(made.state, "saved"); if (made.state === "saved") presets = made.presets; }
  const refused = x.saveUserPreset(presets, "One more", base, { newId });
  assert.deepEqual(refused, { state: "limit", message: "Preset limit reached (30). Delete a preset to save a new one." });
  assert.equal(x.saveUserPreset([], "x".repeat(41), base, { newId }).state, "invalid");
  assert.equal(x.deleteUserPreset(presets, presets[0].id).length, 29);
  assert.equal(x.renameUserPreset(presets, presets[0].id, "Preset 1").state, "duplicate");
});

// ---- Resolution options -------------------------------------------------------------------------------------------------
test("4K for a vertical project: 2160×3840 for a 1080×1920 canvas", () => {
  assert.deepEqual(x.outputSize({ resolution: { mode: "2160p", width: 0, height: 0 } }, { width: 1080, height: 1920 }), { width: 2160, height: 3840 });
  assert.deepEqual(x.shortSideSize(HD, 480), { width: 854, height: 480 });
  assert.deepEqual(x.outputSize({ resolution: { mode: "project", width: 0, height: 0 } }, { width: 1921, height: 1081 }), { width: 1922, height: 1082 });
});
test("Odd custom size: a typed width of 1001 becomes 1002; custom sides stay in 128–4096", () => {
  assert.equal(x.fixCustomSide(1001), 1002);
  assert.deepEqual([x.fixCustomSide(10), x.fixCustomSide(9000), x.fixCustomSide(1000)], [128, 4096, 1000]);
});
test("Resolution not encodable on this device: the reason names the codec, and Export on host is offered with a capable host", () => {
  assert.deepEqual(x.resolutionReason("h264"), { text: "Not supported by this device's {codec} encoder", values: { codec: "H.264" } });
  const rows = x.codecOptions({ target: "device", container: "mp4" }, caps({ video: { h264: false, hevc: true, vp9: true, av1: true } }, host({ h264: available })));
  assert.equal(rows[0].action, "Export on host");
  assert.equal(x.isUpscaled({ width: 3840, height: 2160 }, HD, [{ width: 640, height: 360 }]), true);
});

// ---- Frame rate options -------------------------------------------------------------------------------------------------
test("60 fps project exported at 30 fps: 300 frames, each every second project frame", () => {
  const sixty = { numerator: 60, denominator: 1 };
  assert.equal(x.frameCountOf(10 * T, FPS30), 300);
  assert.deepEqual([0, 1, 2, 299].map((index) => x.projectFrameOf(index, FPS30, sixty)), [0, 2, 4, 598]);
});
test("29.97 project: frame rate Project keeps the rational 30000/1001", () => {
  const ntsc = { numerator: 30_000, denominator: 1001 };
  assert.deepEqual(x.outputFrameRate(base, ntsc), ntsc);
  assert.equal(x.rateLabel(ntsc), "29.97");
  assert.equal(x.rateLabel({ numerator: 24_000, denominator: 1001 }), "23.976");
});
test("Smooth motion is offered: a 24 fps clip without smoothing exported at 60 fps", () => {
  assert.equal(x.smoothMotionAvailable([{ fps: { numerator: 24, denominator: 1 }, smooth: "none" }], { numerator: 60, denominator: 1 }), true);
  assert.equal(base.smoothMotion, false);
});
test("Smooth motion has nothing to do: every source is at or above the export frame rate", () => {
  assert.equal(x.smoothMotionAvailable([{ fps: FPS30 }, { fps: { numerator: 60, denominator: 1 } }], FPS30), false);
  assert.equal(x.smoothMotionAvailable([{ fps: { numerator: 24, denominator: 1 }, smooth: "optical-flow" }], FPS30), false);
});

// ---- Bitrate modes ------------------------------------------------------------------------------------------------------
test("Recommended at 1080p30 H.264: 10.0 Mbps", () => { assert.equal(x.videoBitrateMbps(base, HD, 30), 10); });
test("Higher at 4K60 HEVC: 39.0 Mbps", () => { assert.equal(x.videoBitrateMbps({ ...base, videoCodec: "hevc", bitrateLevel: "higher" }, { width: 3840, height: 2160 }, 60), 39); });
test("Custom out of range: 500 Mbps is clamped to 200", () => {
  assert.equal(x.clampCustomMbps(500), 200);
  assert.equal(x.videoBitrateMbps({ ...base, bitrateLevel: "custom", customMbps: 500 }, HD, 30), 200);
  assert.equal(x.clampCustomMbps(0.01), 0.2);
  assert.deepEqual([x.CLASSIC_QUALITY.low, x.CLASSIC_QUALITY.medium, x.CLASSIC_QUALITY.high, x.CLASSIC_QUALITY["very high"]], ["lower", "recommended", "higher", "maximum"]);
  assert.deepEqual(["lower", "maximum"].map((level) => x.videoBitrateMbps({ ...base, bitrateLevel: level as x.BitrateLevel }, HD, 30)), [5, 25]);
  assert.deepEqual((["vp9", "av1"] as const).map((codec) => x.videoBitrateMbps({ ...base, videoCodec: codec }, HD, 30)), [7, 5.5]);
});

// ---- Video codecs with capability detection and fallback ----------------------------------------------------------------
test("HEVC not supported on device: the option is disabled with Not supported on this device", () => {
  const row = x.codecOptions({ target: "device", container: "mp4" }, caps({ video: { h264: true, hevc: false, vp9: true, av1: true } })).find((entry) => entry.codec === "hevc")!;
  assert.deepEqual([row.disabled, row.reason?.text, row.action], [true, "Not supported on this device", null]);
});
test("Automatic fallback after changing resolution: AV1 rejects 3840×2160, H.264 accepts it", () => {
  const change = x.fallbackCodec({ ...base, videoCodec: "av1" }, { h264: true, hevc: true, vp9: true, av1: false }, { width: 3840, height: 2160 });
  assert.equal(change.settings.videoCodec, "h264");
  const notice = change.notice!;
  assert.equal(notice.text.replace(/\{(\w+)\}/g, (_, key: string) => String(notice.values![key])), "AV1 cannot encode 3840×2160 on this device; switched to H.264");
  assert.equal(x.fallbackCodec({ ...base, container: "webm", videoCodec: "av1" }, { h264: true, hevc: false, vp9: true, av1: false }, HD).settings.videoCodec, "vp9", "the first supported codec the container holds");
});
test("No encoder available: video Export is disabled with This device cannot encode video; the other types remain", () => {
  const none = caps({ video: { h264: false, hevc: false, vp9: false, av1: false } });
  assert.equal(x.exportBlocker(base, context({ caps: none }))?.text, "This device cannot encode video");
  for (const id of ["gif", "image-sequence"]) assert.equal(x.exportBlocker(x.applyPreset(id), context({ caps: none })), null);
  assert.equal(x.exportBlocker({ ...x.applyPreset("audio-only"), audioOnly: { format: "wav", bitrateKbps: 192, bitDepth: 16 } }, context({ caps: none })), null);
  assert.equal(x.exportBlocker({ ...base, type: "still" }, context({ caps: none })), null);
  assert.equal(x.exportBlocker({ ...base, type: "captions" }, context({ caps: none, hasCaptionTrack: true })), null);
});

// ---- Container formats --------------------------------------------------------------------------------------------------
test("Selecting WebM: H.264 becomes VP9, the audio Opus, with the notice", () => {
  const change = x.chooseContainer(base, "webm");
  assert.deepEqual([change.settings.videoCodec, change.settings.audioCodec, change.settings.audioBitrateKbps, change.notice?.text], ["vp9", "opus", 128, "WebM requires VP9 or AV1; switched to VP9"]);
  assert.deepEqual(x.chooseCodec(change.settings, "h264").settings.container, "mp4", "a codec the container cannot hold switches to the first compatible container");
});
test("MOV output: extension .mov and MIME video/quicktime; H.264 stays", () => {
  const mov = x.chooseContainer(base, "mov").settings;
  assert.deepEqual([x.fileExtension(mov), x.mimeOf(mov), mov.videoCodec, mov.audioCodec], ["mov", "video/quicktime", "h264", "aac"]);
  assert.deepEqual([x.CONTAINER_MIME.mp4, x.CONTAINER_MIME.webm], ["video/mp4", "video/webm"]);
  assert.equal(x.containerAccepts("mp4", "vp9"), false);
  assert.equal(x.containerAccepts("mp4", "vp9", "host"), true);
});

// ---- Audio settings for video export ------------------------------------------------------------------------------------
test("Audio off: Include audio off adds no audio to the estimate or the summary", () => {
  const off = { ...base, includeAudio: false };
  assert.equal(x.estimateExport(off, HD, FPS30, 60 * T).bytes, (10_000_000 * 60) / 8);
});
const noAac = caps({ audio: { aac: false, opus: true, flac: false, mp3: false } });
test("AAC unavailable, user picks Opus in MP4: the players warning is shown and the MP4 gets Opus", () => {
  const choices = x.audioFallbackChoices(noAac);
  assert.deepEqual(choices.map((choice) => choice.label), ["WebM (VP9 + Opus)", "Opus in MP4", "16-bit PCM in MOV"]);
  assert.equal(choices[1].warning, "Some players do not play Opus audio in MP4");
  const chosen = x.applyAudioFallback(base, "opus-mp4");
  assert.deepEqual([chosen.container, chosen.audioCodec, chosen.audioFallback], ["mp4", "opus", "opus-mp4"]);
  assert.equal(x.exportBlocker(chosen, context({ caps: noAac })), null);
  assert.equal(x.resolveH264Aac(chosen, noAac).settings, chosen, "an explicit choice is not resolved away");
});
test("AAC unavailable, nothing chosen: Export is disabled with Choose how to encode audio", () => {
  // The preset rule first names the WebM fallback; with AAC kept explicitly the button waits for a choice.
  assert.equal(x.needsAudioChoice(base, noAac), true);
  assert.equal(x.exportBlocker(base, context({ caps: noAac }))?.text, "Choose how to encode audio");
});
test("Neither AAC nor Opus: the only choice is 16-bit PCM in MOV, which switches the container; MP4 never holds PCM", () => {
  const bare = caps({ audio: { aac: false, opus: false, flac: false, mp3: false } });
  assert.deepEqual(x.audioFallbackChoices(bare).map((choice) => choice.label), ["16-bit PCM in MOV"]);
  const chosen = x.applyAudioFallback(base, "pcm-mov");
  assert.deepEqual([chosen.container, chosen.audioCodec], ["mov", "pcm"]);
  assert.notEqual(x.chooseContainer(chosen, "mp4").settings.audioCodec, "pcm");
});
test("No audio encoder path on the device: gateway-only with a host — Export on host is the offered action", () => {
  const only = caps({ audio: { aac: false, opus: false, flac: false, mp3: false }, audioEncode: "gateway-only" }, host({ aac: available, h264: available }));
  assert.deepEqual(x.audioFallbackChoices(only).map((choice) => choice.label), ["Export on host"]);
  assert.equal(x.applyAudioFallback(base, "host").target, "host");
});
test("Audio settings: bitrates per codec and their defaults", () => {
  assert.deepEqual([...x.audioBitrates("aac")], [96, 128, 192, 256, 320]);
  assert.deepEqual([...x.audioBitrates("opus")], [64, 96, 128, 192, 256]);
  assert.deepEqual([...x.SAMPLE_RATES], [44_100, 48_000]);
});

// ---- Colour space of exported video -------------------------------------------------------------------------------------
test("HDR source in the timeline: the colour row reads SDR Rec.709 — 2 HDR sources are converted to SDR", () => {
  const row = x.colourRow(2);
  assert.equal(row.text.replace("{n}", String(row.values!.n)), "SDR Rec.709 — 2 HDR sources are converted to SDR");
  assert.equal(x.colourRow(0).text, "SDR Rec.709");
});
test("No HDR control: no setting selects HDR, wide gamut or 10-bit output", () => {
  assert.ok(Object.keys(x.DEFAULT_EXPORT_SETTINGS).every((key) => !/hdr|gamut|bitdepth10|tenbit/i.test(key)));
});

// ---- Estimated file size and duration -----------------------------------------------------------------------------------
test("Estimate for a one-minute 1080p30 export: ≈ 76.4 MB", () => {
  assert.equal(x.estimateLabel(x.estimateExport(base, HD, FPS30, 60 * T)).text, "≈ 76.4 MB");
  assert.equal(x.formatBytes(3_200_000_000), "3.20 GB");
  assert.equal(x.durationLabel(32 * T), "00:32");
  assert.deepEqual(x.estimateLabel(x.estimateExport(x.applyPreset("image-sequence"), HD, FPS30, 2 * T)), { text: "{n} frames", values: { n: 60 } });
});
test("Insufficient space: 3.2 GB against 1.0 GB free — danger, Not enough free space, Export disabled", () => {
  assert.deepEqual(x.exportBlocker(base, context({ estimateBytes: 3_200_000_000, freeBytes: 1_000_000_000 })), { text: "Not enough free space", danger: true });
});

// ---- GIF export ---------------------------------------------------------------------------------------------------------
test("Default GIF: a 4 s 16:9 range is 854×480 with 60 frames and delays repeating 70, 70, 60 ms", () => {
  const gif = x.applyPreset("gif");
  assert.deepEqual(gif.gif, { shortSide: 480, frameRate: 15, loop: "forever", palette: "per-frame", dither: "floyd-steinberg" });
  assert.deepEqual(x.gifSize(HD, 480), { width: 854, height: 480 });
  const estimate = x.estimateExport(gif, HD, FPS30, 4 * T);
  assert.equal(estimate.frames, 60);
  assert.equal(estimate.bytes, 854 * 480 * 60 * 0.35);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((index) => x.gifDelay(index, 15)), [7, 7, 6, 7, 7, 6]);
  assert.equal(Array.from({ length: 60 }, (_, index) => x.gifDelay(index, 15)).reduce((sum, value) => sum + value, 0), 400);
});
test("Too long for GIF: a 95 s timeline with no range disables Export with the 60-second message", () => {
  assert.equal(x.exportBlocker(x.applyPreset("gif"), context({ durationTicks: 95 * T }))?.text, "GIF export is limited to 60 seconds. Set an in/out range.");
  assert.equal(x.exportBlocker(x.applyPreset("gif"), context({ durationTicks: 60 * T })), null);
});

// ---- Audio-only export --------------------------------------------------------------------------------------------------
test("WAV export: a 30 s range as WAV 16-bit 48 kHz stereo is exactly 5 760 044 bytes", () => {
  const wav = { ...x.applyPreset("audio-only"), audioOnly: { format: "wav" as const, bitrateKbps: 192, bitDepth: 16 as const } };
  assert.deepEqual(x.estimateExport(wav, HD, FPS30, 30 * T), { bytes: 5_760_044, frames: null, exact: true });
  assert.equal(x.wavBytes(48_000, 2, 16, 30), 5_760_044);
});
test("Silent timeline: audio-only export of a timeline with no audible source is refused", () => {
  assert.equal(x.exportBlocker(x.applyPreset("audio-only"), context({ hasAudibleSource: false }))?.text, "Nothing to export: the timeline has no audio.");
});
test("FLAC unsupported on device: with no FLAC encoder and no host the option is refused with Not supported on this device", () => {
  const flac = { ...x.applyPreset("audio-only"), audioOnly: { format: "flac" as const, bitrateKbps: 192, bitDepth: 16 as const } };
  assert.equal(x.exportBlocker(flac, context({ caps: caps({ audio: { aac: true, opus: true, flac: false, mp3: true } }) }))?.text, "Not supported on this device");
  assert.deepEqual([x.fileExtension(flac), x.AUDIO_ONLY_MIME.m4a, x.applyPreset("audio-only").audioOnly.format], ["flac", "audio/mp4", "mp3"]);
});

// ---- Image sequence, still, file names ----------------------------------------------------------------------------------
test("PNG sequence on desktop: a 2 s range of a 30 fps project named Promo is Promo_000001.png to Promo_000060.png", () => {
  assert.equal(x.frameCountOf(2 * T, FPS30), 60);
  assert.deepEqual([x.sequenceFrameName("Promo", 0, "png"), x.sequenceFrameName("Promo", 59, "png")], ["Promo_000001.png", "Promo_000060.png"]);
  assert.equal(x.exportBlocker(x.applyPreset("image-sequence"), context({ frames: 18_001 }))?.text, "Confirm the {n} frames of this sequence");
  assert.equal(x.exportBlocker(x.applyPreset("image-sequence"), context({ frames: 18_001, sequenceConfirmed: true })), null);
});
test("Web without directory access: the sequence is delivered as Promo_frames.zip", () => { assert.equal(x.sequenceZipName("Promo"), "Promo_frames.zip"); });
test("Still at playhead: 00:00:12:05 in project Promo is Promo-00-00-12-05.png", () => { assert.equal(x.stillFileName("Promo", 12 * T + 5 * 4000, FPS30, "png"), "Promo-00-00-12-05.png"); });
test("Vietnamese project name: Chuyến đi Đà Lạt at 00:01:05:11", () => { assert.equal(x.stillFileName("Chuyến đi Đà Lạt", 65 * T + 11 * 4000, FPS30, "png"), "Chuyến đi Đà Lạt-00-01-05-11.png"); });
test("Japanese project name: 京都の旅 JPEG at 00:00:03:00", () => { assert.equal(x.stillFileName("京都の旅", 3 * T, FPS30, "jpeg"), "京都の旅-00-00-03-00.jpg"); });
test("Playhead past the end: a still has no range and exports one frame", () => {
  const still = { ...base, type: "still" as const, range: "in-out" as const };
  assert.deepEqual(x.exportRange(still, { inPoint: T, outPoint: 2 * T }, 10 * T, FPS30), { start: 0, end: 10 * T, frames: 300 });
  assert.equal(x.estimateExport(still, HD, FPS30, 0).frames, 1);
});

// ---- Range export -------------------------------------------------------------------------------------------------------
test("Export a range: 00:00:05:00–00:00:15:00 at 30 fps is 300 frames starting at 5 s", () => {
  assert.deepEqual(x.exportRange({ type: "video", range: "in-out" }, { inPoint: 5 * T, outPoint: 15 * T }, 60 * T, FPS30), { start: 5 * T, end: 15 * T, frames: 300 });
  assert.equal(x.sidecarTime(7 * T, { start: 5 * T }), 2000, "caption times are offset so the range start is 0");
  assert.equal(x.exportRange({ type: "video", range: "in-out" }, { inPoint: 5 * T + 1234 }, 60 * T, FPS30).start, 5 * T, "the range snaps to frame boundaries");
});
test("No range defined: In/out range is unavailable with the hint Set in and out points on the timeline", () => {
  assert.equal(x.hasRange({}, 10 * T), false);
  assert.equal(x.hasRange({ inPoint: T }, 10 * T), true);
  assert.equal(x.RANGE_HINT, "Set in and out points on the timeline");
  assert.deepEqual(x.exportRange({ type: "video", range: "in-out" }, {}, 10 * T, FPS30), { start: 0, end: 10 * T, frames: 300 });
});

// ---- Alpha and intermediate codec export --------------------------------------------------------------------------------
test("Opaque background blocks alpha: Include transparency with a colour background shows the message and disables Export", () => {
  assert.equal(x.exportBlocker({ ...x.applyPreset("image-sequence"), includeTransparency: true }, context())?.text, x.OPAQUE_MESSAGE);
  assert.equal(x.exportBlocker({ ...x.applyPreset("image-sequence"), includeTransparency: true }, context({ transparentBackground: true })), null);
});
test("Flattening notice: a transparent-background project as H.264 MP4 says Transparent areas will be black in this format", () => { assert.equal(x.FLATTEN_MESSAGE, "Transparent areas will be black in this format"); });
test("No host: ProRes options are disabled with Requires a connected host; PNG sequence stays available", () => {
  const rows = x.codecOptions({ target: "device", container: "mov" }, caps());
  for (const codec of x.HOST_CODECS) { const row = rows.find((entry) => entry.codec === codec)!; assert.deepEqual([row.host, row.disabled, row.reason?.text], [true, true, "Requires a connected host"]); }
  assert.equal(x.codecOptions({ target: "host", container: "mov" }, caps({}, host({}, { proRes: true }))).find((entry) => entry.codec === "prores-4444")!.disabled, false);
  assert.deepEqual([x.chooseCodec(base, "prores-4444").settings.container, x.chooseCodec(base, "prores-4444").settings.audioCodec], ["mov", "pcm"], "ProRes 4444 with alpha on the host is a MOV with PCM audio");
});

// ---- Pre-flight validation ----------------------------------------------------------------------------------------------
const el = (id: string, patch: Record<string, unknown> = {}) => ({ id, name: id, type: "video", startTime: 0, duration: T, mediaId: `asset-${id}`, ...patch });
const docOf = (elements: ReturnType<typeof el>[], extra: Partial<x.PreflightDocument> = {}): x.PreflightDocument => ({
  scenes: [{ id: "s", tracks: { overlay: [], main: { id: "m", type: "video", elements }, audio: [] } }], media: { assets: elements.map((element) => ({ id: String(element.mediaId), name: element.id })) }, ...extra,
});
const flight = (document: x.PreflightDocument, patch: Partial<x.PreflightInput> = {}) => x.runPreflight({ document, sceneId: "s", range: { start: 0, end: T }, frameTicks: 4000, target: "device", platform: "web", ...patch });
test("Empty project: Export with no element does not start and says Project is empty", () => {
  const result = flight(docOf([]));
  assert.deepEqual([result.ok, result.blocking[0].code, result.blocking[0].message], [false, "export/empty", "Project is empty"]);
  assert.equal(x.exportAnyway(result), null);
  assert.equal(flight(docOf([el("a")]), { range: { start: 0, end: 100 } }).blocking[0].code, "export/range-too-short");
});
test("Proxy-only media on a phone: 3 clips with only proxies are listed with Download originals and Export on host", () => {
  const result = flight(docOf([el("a"), el("b"), el("c")]), { platform: "mobile", mediaState: () => "proxy-only" });
  assert.deepEqual([result.blocking[0].code, result.blocking[0].elementIds, result.blocking[0].remedies], ["media/original-unavailable", ["a", "b", "c"], ["Download originals", "Export on host"]]);
});
test("Export anyway: one missing clip is waivable, and with the waiver the export runs", () => {
  const document = docOf([el("a"), el("b")]), mediaState = (assetId: string) => (assetId === "asset-b" ? "missing" as const : "ready" as const);
  const result = flight(document, { mediaState });
  assert.deepEqual([result.blocking[0].code, result.blocking[0].names, result.blocking[0].waiver], ["media/unavailable", ["b"], "allowMissingMedia"]);
  const waivers = x.exportAnyway(result);
  assert.deepEqual(waivers, { allowMissingMedia: true });
  const again = flight(document, { mediaState, waivers: waivers! });
  assert.equal(again.ok, true);
  assert.equal(again.items[0].waived, true, "what was waived stays listed for the summary");
});
test("Device font on a host export: the element is listed with Export anyway; on this device it is not an item", () => {
  const document = docOf([el("t", { type: "text", fontFamily: "Comic Device", mediaId: undefined })]);
  const onHost = flight(document, { target: "host", fontState: () => "device" });
  assert.deepEqual([onHost.blocking[0].code, onHost.blocking[0].waiver, onHost.blocking[0].elementIds], ["export/device-font", "allowFontFallback", ["t"]]);
  assert.equal(flight(document, { fontState: () => "device" }).ok, true);
});
test("Replace font: 4 text elements using a font that cannot be loaded are listed with Replace font; replaced, they are gone", () => {
  const texts = ["a", "b", "c", "d"].map((id) => el(id, { type: "text", fontFamily: "Lost", mediaId: undefined }));
  const result = flight(docOf(texts), { fontState: (family) => (family === "Lost" ? "unavailable" : "ok") });
  assert.deepEqual([result.blocking[0].code, result.blocking[0].elementIds.length, result.blocking[0].remedies], ["export/font-unavailable", 4, ["Replace font"]]);
  assert.equal(flight(docOf(texts.map((text) => ({ ...text, fontFamily: "Inter" }))), { fontState: (family) => (family === "Lost" ? "unavailable" : "ok") }).ok, true);
});
test("Slate stills remain: 3 slate clips are listed as 3 placeholder shots are still in the timeline with Export anyway", () => {
  const document = docOf([el("a"), el("b"), el("c")]);
  document.media.assets = document.media.assets.map((asset) => ({ ...asset, kind: "slate" }));
  const result = flight(document), [item] = result.blocking;
  assert.equal(item.message.replace("{n}", String(item.values!.n)), "3 placeholder shots are still in the timeline");
  assert.deepEqual([item.code, item.names, x.exportAnyway(result)], ["export/slates-present", ["a", "b", "c"], { allowSlates: true }]);
});
test("Empty optional slot is not listed: every required slot filled and one optional slot empty lists nothing", () => {
  assert.equal(flight(docOf([el("a")], { template: { slots: [{ slotId: "1", elementId: "a", required: true, filled: true }, { slotId: "2", elementId: "a", required: false, filled: false }] } })).ok, true);
});
test("Empty required slot blocks: export/template-incomplete names the slot and no waiver changes that", () => {
  const document = docOf([el("a")], { template: { slots: [{ slotId: "slot-1", elementId: "a", required: true, filled: false, label: "Opening shot" }] } });
  const result = flight(document, { waivers: { allowMissingMedia: true, allowFontFallback: true, allowSlates: true, allowMissingResources: true } });
  assert.deepEqual([result.ok, result.blocking[0].code, result.blocking[0].values?.names, result.blocking[0].waiver], [false, "export/template-incomplete", "Opening shot", null]);
  assert.equal(x.preflightFailure(result)?.code, "export/template-incomplete");
});
test("Free space on a phone: 800 MB estimated with 1.2 GB free blocks with export/insufficient-space stating 1.6 GB", () => {
  const result = flight(docOf([el("a")]), { platform: "mobile", estimateBytes: 800_000_000, freeBytes: 1_200_000_000 });
  assert.deepEqual([result.blocking[0].code, result.blocking[0].values?.needed], ["export/insufficient-space", "1.6 GB"]);
  assert.equal(flight(docOf([el("a")]), { platform: "web", estimateBytes: 800_000_000, freeBytes: 1_200_000_000 }).ok, true);
});
test("No GPU on this device: backend none with target This device blocks with export/no-gpu and offers Export on host", () => {
  const result = flight(docOf([el("a")]), { backend: "none" });
  assert.deepEqual([result.blocking[0].code, result.blocking[0].remedies], ["export/no-gpu", ["Export on host"]]);
  assert.equal(flight(docOf([el("a")]), { backend: "none", target: "host" }).ok, true);
});
test("Pre-flight time: a 500-element project is checked well within 2 000 ms", () => {
  const elements = Array.from({ length: 500 }, (_, index) => el(`e${index}`, { startTime: index * 100, type: index % 5 === 0 ? "text" : "video", fontFamily: "Inter" }));
  const started = performance.now();
  const result = flight(docOf(elements), { range: { start: 0, end: 100 * T }, mediaState: () => "ready", fontState: () => "ok" });
  assert.ok(performance.now() - started < 2000);
  assert.equal(result.ok, true);
});
test("Pre-flight validation: a missing sticker pack item or template resource is export/resource-missing with its waiver", () => {
  const result = flight(docOf([el("s", { type: "sticker" })]), { resourceMissing: () => "Party pack" });
  assert.deepEqual([result.blocking[0].code, result.blocking[0].waiver], ["export/resource-missing", "allowMissingResources"]);
  assert.equal(flight(docOf([el("a")]), { matteProcessing: () => true }).blocking[0].code, "export/matte-unavailable");
  assert.equal(flight(docOf([el("a")]), { derivedFailed: () => true }).blocking[0].code, "export/derived-unavailable");
  assert.equal(flight(docOf([el("a")]), { codecAvailable: false }).blocking[0].code, "export/codec-unavailable");
  assert.equal(flight(docOf([el("a")]), { writable: false }).blocking[0].code, "export/write-failed");
});

// ---- Output destination and file name / Filename sanitisation -----------------------------------------------------------
test("Default name: project Summer trip exported as MP4 is Summer trip.mp4", () => { assert.equal(x.uniqueFileName(x.sanitiseFileName("Summer trip"), x.fileExtension(base), () => false), "Summer trip.mp4"); });
test("Name collision on desktop: with Summer trip.mp4 present the new file is Summer trip (2).mp4", () => {
  const taken = new Set(["Summer trip.mp4"]);
  assert.equal(x.uniqueFileName("Summer trip", "mp4", (name) => taken.has(name)), "Summer trip (2).mp4");
  taken.add("Summer trip (2).mp4");
  assert.equal(x.uniqueFileName("Summer trip", "mp4", (name) => taken.has(name)), "Summer trip (3).mp4");
});
test("Illegal characters: Q3: Plan/Review? becomes Q3_ Plan_Review_", () => { assert.equal(x.sanitiseFileName("Q3: Plan/Review?"), "Q3_ Plan_Review_"); });
test("Reserved name: con becomes _con", () => { assert.equal(x.sanitiseFileName("con"), "_con"); assert.equal(x.sanitiseFileName("LPT9"), "_LPT9"); assert.equal(x.sanitiseFileName("console"), "console"); });
test("Empty after sanitising: ... becomes Untitled", () => { assert.equal(x.sanitiseFileName("..."), "Untitled"); assert.equal(x.sanitiseFileName("  a   b  "), "a b"); });
test("Vietnamese name is kept: Chuyến đi Đà Lạt in NFC form", () => {
  assert.equal(x.sanitiseFileName("Chuyến đi Đà Lạt".normalize("NFD")), "Chuyến đi Đà Lạt".normalize("NFC"));
});
test("Japanese name is kept: 京都の旅 #2", () => { assert.equal(x.sanitiseFileName("京都の旅 #2"), "京都の旅 #2"); });
test("Truncation does not split a character: 100 × 旅 (300 bytes) becomes 66 × 旅 (198 bytes)", () => {
  assert.equal(x.sanitiseFileName("旅".repeat(100)), "旅".repeat(66));
  assert.equal([...x.sanitiseFileName("a".repeat(300))].length, 120);
});

// ---- Progress and estimated time remaining ------------------------------------------------------------------------------
test("Progress is monotonic: each reported percentage is at least the previous one and the last is 100", () => {
  const stages: [x.ExportStage, number, number][] = [["Preparing", 0, 0], ["Rendering", 0, 300], ["Rendering", 150, 300], ["Rendering", 300, 300], ["Mixing audio", 0, 0], ["Finalising", 0, 0]];
  let percent = 0;
  const seen = stages.map(([stage, done, total]) => (percent = x.advancePercent(percent, x.stagePercent(stage, done, total))));
  assert.deepEqual(seen, [0, 5, 51.5, 98, 98, 98]);
  assert.ok(seen.every((value, index) => index === 0 || value >= seen[index - 1]));
  assert.equal(x.advancePercent(98, 100), 100);
  assert.deepEqual([x.stagePercent("Saving", 0, 10), x.stagePercent("Saving", 10, 10)], [98, 100], "the copy-out on a phone is the last 2 %");
});
test("Waiting for derived audio: Preparing audio is a stage of its own inside the first 5 %", () => {
  assert.ok(x.EXPORT_STAGES.includes("Preparing audio") && x.EXPORT_STAGES.includes("Smoothing motion"));
  const at = x.stagePercent("Preparing audio", 3, 5);
  assert.ok(at > 0 && at < 5 && x.stagePercent("Mixing audio", 0, 1) >= at);
});
test("Remaining time appears: after 3 s at a steady 60 frames per second with 3 000 frames left, about 50 s (±10 %)", () => {
  const samples: x.EtaSample[] = [];
  let estimate: number | null = null;
  for (let ms = 0; ms <= 3000; ms += 250) { samples.push({ at_ms: ms, frames: (ms / 1000) * 60 }); estimate = x.estimateRemaining(samples, 3180, 0, ms); if (ms < 3000) assert.equal(estimate, null, "nothing is shown before 3 s of rendering"); }
  assert.ok(estimate !== null && Math.abs(estimate - 50_000) <= 5000, String(estimate));
  assert.deepEqual(x.remainingLabel(50_000), { text: "About {n} s remaining", values: { n: 50 } });
});
test("Progress announcement: passing 50 % announces Export 50 percent", () => {
  assert.deepEqual(x.progressAnnouncement(48, 51), { text: "Export {percent} percent", values: { percent: 50 } });
  assert.equal(x.progressAnnouncement(51, 55), null);
  assert.equal(x.progressAnnouncement(8, 9), null);
});

// ---- Cancel, queue, history ---------------------------------------------------------------------------------------------
const job = (id: string, patch: Partial<x.ExportJob> = {}): x.ExportJob => ({
  id, projectId: "p", projectName: "Promo", type: "video", settings: base, settingsSummary: x.settingsSummary(base, HD, FPS30), fileName: `${id}.mp4`, target: "device", state: "queued", stage: "Preparing", percent: 0,
  framesDone: 0, frameCount: 300, duration: 10 * T, range: { start: 0, end: 10 * T }, sceneId: "s", created_ms: 1, elapsed_ms: 0, ...patch,
});
const queueOf = (...jobs: x.ExportJob[]): x.ExportQueue => jobs.reduce<x.ExportQueue>((queue, entry) => { const added = x.enqueue(queue, entry); assert.ok(added.ok); return added.ok ? added.queue : queue; }, x.EMPTY_QUEUE);
test("Cancel mid-render: at 40 % cancelling asks first; the job ends cancelled and stays in history", () => {
  let queue = x.updateJob(queueOf(job("a")), "a", { state: "running", percent: 40 });
  assert.equal(x.cancelNeedsConfirmation(queue.jobs[0]), true);
  assert.equal(x.CANCEL_CONFIRMATION, "Cancel export? The partial file is deleted.");
  queue = x.cancelJob(queue, "a", 99);
  assert.deepEqual([queue.jobs.length, queue.history[0].state, queue.history[0].finished_ms], [0, "cancelled", 99]);
  assert.ok(x.historyActions(queue.history[0], "web").includes("export-again"));
  assert.equal(x.cancelNeedsConfirmation({ state: "running", percent: 8 }), false);
});
test("Cancel a queued job: it is removed without confirmation and recorded in history as cancelled", () => {
  const queue = x.updateJob(queueOf(job("a"), job("b")), "a", { state: "running" });
  assert.equal(x.cancelNeedsConfirmation(queue.jobs[1]), false);
  const next = x.cancelJob(queue, "b", 5);
  assert.deepEqual([next.jobs.map((entry) => entry.id), next.history[0].id, next.history[0].state], [["a"], "b", "cancelled"]);
});
test("Second export is queued: with one running the second waits and starts when the first finishes", () => {
  let queue = queueOf(job("a"), job("b"));
  assert.equal(x.nextToRun(queue)?.id, "a");
  queue = x.updateJob(queue, "a", { state: "running" });
  assert.equal(x.nextToRun(queue), null);
  assert.equal(x.nextToRun(x.updateJob(queue, "a", { state: "paused" })), null, "a paused job keeps the slot");
  queue = x.finishJob(queue, "a", { state: "succeeded" });
  assert.deepEqual([x.nextToRun(queue)?.id, queue.history[0].percent], ["b", 100]);
});
test("Restart with queued jobs: the running job is failed with export/interrupted, the two queued jobs stay queued in order", () => {
  const queue = x.updateJob(queueOf(job("a"), job("b"), job("c")), "a", { state: "running", framesDone: 120 });
  const restored = x.restoreQueue(queue, 7);
  assert.deepEqual(restored.jobs.map((entry) => [entry.id, entry.state]), [["b", "queued"], ["c", "queued"]]);
  assert.deepEqual([restored.history[0].state, restored.history[0].error?.code, restored.history[0].error?.frameIndex], ["failed", "export/interrupted", 120]);
  assert.ok(x.historyActions(restored.history[0], "web").includes("retry"));
  assert.equal(x.nextToRun(restored)?.id, "b");
  assert.ok(x.isQueue(JSON.parse(JSON.stringify(restored))), "the queue survives being stored");
});
test("Queue is full: a twenty-first unfinished on-device job is not added and Export queue is full (20) is shown", () => {
  const queue = queueOf(...Array.from({ length: 20 }, (_, index) => job(`j${index}`)));
  assert.deepEqual(x.enqueue(queue, job("more")), { ok: false, code: "export/queue-full", message: "Export queue is full (20)" });
  assert.equal(x.enqueue(queue, job("host", { target: "host" })).ok, true, "host jobs are not counted in the limit");
});
test("Reorder: Move up on the third queued job makes it the second, ahead of the job it passed", () => {
  let queue = x.updateJob(queueOf(job("run"), job("a"), job("b"), job("c")), "run", { state: "running" });
  assert.equal(x.canMove(queue, "a", -1), false);
  queue = x.moveJob(queue, "c", -1);
  assert.deepEqual(x.queuedJobs(queue).map((entry) => entry.id), ["a", "c", "b"]);
  assert.deepEqual(x.queuedJobs(x.reorderJob(queue, "b", 0)).map((entry) => entry.id), ["b", "a", "c"]);
  assert.equal(queue.jobs[0].id, "run");
});
test("Badge count: one on-device job running and two host jobs queued show the badge 3", () => {
  assert.equal(x.badgeCount([{ state: "running" }, { state: "succeeded" }], [{ state: "queued" }, { state: "queued" }]), 3);
});
test("No pause for host jobs: a host job has exactly the five host states", () => {
  assert.deepEqual([...x.HOST_JOB_STATES], ["queued", "running", "succeeded", "failed", "cancelled"]);
  assert.ok(x.DEVICE_JOB_STATES.includes("paused"));
  const row = x.hostJobRow({ jobId: "h1", kind: "export.remote", state: "running", stage: "rendering", framesDone: 10, frameCount: 100, encodedBytes: 5, createdBy: { kind: "agent", id: "a" }, created_ms: 1 }, { hostName: "Studio" });
  assert.deepEqual([row.target, row.state, row.hostName, row.stage], ["host", "running", "Studio", "Rendering"]);
});
test("History limit: a 201st job removes the oldest entry and 200 remain", () => {
  let queue = x.EMPTY_QUEUE;
  for (let index = 0; index < 201; index++) queue = x.recordHistory(queue, job(`h${index}`, { state: "succeeded" }));
  assert.deepEqual([queue.history.length, queue.history[0].id, queue.history.some((entry) => entry.id === "h0")], [200, "h200", false]);
});
test("File missing: an entry whose output file is gone offers Export again and Remove from history only", () => {
  assert.deepEqual(x.historyActions({ state: "succeeded", fileMissing: true, output: undefined }, "desktop"), ["export-again", "remove"]);
  assert.ok(x.historyActions({ state: "succeeded", output: { fileName: "a.mp4", mime: "video/mp4", size: 1, location: "path" } }, "desktop").includes("show-in-folder"));
});
test("Re-export from history: Export again carries every setting of the entry; history is searched by project and file name and filtered", () => {
  const entries = [job("a", { state: "succeeded", fileName: "Promo.mp4" }), job("b", { state: "failed", projectName: "Trip", fileName: "Trip.gif", type: "gif" })];
  assert.deepEqual(x.filterHistory(entries, { query: "trip" }).map((entry) => entry.id), ["b"]);
  assert.deepEqual(x.filterHistory(entries, { state: "succeeded" }).map((entry) => entry.id), ["a"]);
  assert.deepEqual(x.filterHistory(entries, { type: "gif" }).map((entry) => entry.id), ["b"]);
  assert.equal(entries[0].settings, base);
  assert.equal(x.removeFromHistory({ jobs: [], history: entries }, "a").history.length, 1);
});
test("Empty history: with no export made the history holds nothing", () => { assert.deepEqual(x.filterHistory(x.EMPTY_QUEUE.history, {}), []); });

// ---- Remote export contract and host UI ---------------------------------------------------------------------------------
test("One create method: jagentchill.export.create with an idempotencyKey", () => {
  const request = x.createParams({ projectId: "p", revision: 4, settings: base, idempotencyKey: "k-1" });
  assert.deepEqual([request.method, request.params.idempotencyKey, request.params.revision], ["jagentchill.export.create", "k-1", 4]);
  assert.throws(() => x.createParams({ projectId: "p", revision: 4, settings: base, idempotencyKey: " " }));
  assert.deepEqual(Object.values(x.EXPORT_RPC).filter((method) => method.startsWith("jagentchill.export.")), ["jagentchill.export.capabilities", "jagentchill.export.create", "jagentchill.export.get", "jagentchill.export.list", "jagentchill.export.cancel", "jagentchill.export.delete"]);
  assert.equal(x.exportFileRoute("j 1"), "/jagentchill/v1/exports/j%201/file");
  assert.equal(x.JOB_UPDATED_EVENT, "jagentchill.job.updated");
});
test("Host not connected: the host target is disabled and labelled Host (not connected)", () => {
  const [device, target] = x.targetOptions(null);
  assert.deepEqual([device.label.text, target.label.text, target.disabled, target.link], ["This device", "Host (not connected)", true, "connection-settings"]);
});
test("FFmpeg missing on the host: no remote-export, and the target selector names FFmpeg as the missing component", () => {
  const capabilities = x.hostCapabilities({ name: "Studio", features: ["render-host"], role: "editor" });
  const [, target] = x.targetOptions(capabilities);
  assert.deepEqual([capabilities.remoteExport, target.disabled, target.label.text, target.reason?.values?.component], [false, true, "Host: {name} (cannot export)", "FFmpeg"]);
  assert.equal(x.targetOptions(x.hostCapabilities({ name: "Studio", features: ["remote-export"], role: "editor" }))[1].disabled, false);
});
test("Host lacks an encoder: no HEVC encoder reads This host has no HEVC encoder", () => {
  const row = x.codecOptions({ target: "host", container: "mp4" }, caps({}, host({ h264: available, hevc: { state: "unavailable", hardware: false } }))).find((entry) => entry.codec === "hevc")!;
  assert.equal(row.reason!.text.replace("{codec}", String(row.reason!.values!.codec)), "This host has no HEVC encoder");
});
test("Download-required codec in the dialog: H.264 reads This host needs the OpenH264 encoder; no download button for an editor", () => {
  const table = { h264: { state: "download_required" as const, hardware: false }, vp9: available, av1: available };
  const rows = x.codecOptions({ target: "host", container: "mp4" }, caps({}, host(table)));
  assert.deepEqual([rows[0].disabled, rows[0].reason?.text, rows[0].action], [true, "This host needs the OpenH264 encoder", null]);
  assert.deepEqual(rows.filter((row) => !row.disabled).map((row) => row.codec), ["vp9", "av1"]);
  assert.equal(x.codecOptions({ target: "host", container: "mp4" }, caps({}, host(table, { admin: true })))[0].action, "Open host diagnostics");
});
test("Device cannot encode video: This device is disabled for video with the reason and the host is selected", () => {
  const studio = host({ h264: available });
  assert.deepEqual([x.targetOptions(studio, false)[0].disabled, x.targetOptions(studio, false)[0].reason?.text], [true, "This device cannot encode video"]);
  assert.equal(x.preselectTarget(base, studio, false).target, "host");
  assert.equal(x.preselectTarget(base, null, false).target, "device");
});
test("No prompt at export time: an H.264 job on a host without it fails at once with export/codec-unavailable details", () => {
  const encoders = { h264: { state: "download_required" as const, hardware: false }, hevc: { state: "unavailable" as const, hardware: false }, vp9: available, av1: available, aac: available, opus: available };
  assert.equal(x.resolveCodecPreference([{ video: "h264", audio: "aac", container: "mp4" }], encoders), null);
  assert.deepEqual(x.codecUnavailableDetails("h264", encoders), { requested: "h264", available: ["vp9", "av1"], downloadRequired: ["h264"] });
});
test("Automation falls back along its preference: preset 1080p on that host uses VP9 with Opus in WebM", () => {
  const encoders = { h264: { state: "download_required" as const, hardware: false }, hevc: { state: "unavailable" as const, hardware: false }, vp9: available, av1: available, aac: available, opus: available };
  assert.deepEqual(x.resolveCodecPreference(x.DEFAULT_CODEC_PREFERENCE, encoders), { video: "vp9", audio: "opus", container: "webm" });
});
test("Hand-off with missing media: only the 2 blobs the host lacks are uploaded; an interrupted upload resumes after the last acknowledged chunk", () => {
  assert.deepEqual(x.blobsToUpload(["a", "b", "c"], new Set(["a"])), ["b", "c"]);
  assert.equal(x.resumeChunk(3 * x.UPLOAD_CHUNK_BYTES + 5), 3);
  assert.equal(x.UPLOAD_CHUNK_BYTES, 4 * 1024 * 1024);
});
test("Resume an interrupted download: the client continues with a Range request from the bytes it has", () => {
  assert.deepEqual(x.resumeRange(900_000_000), { Range: "bytes=900000000-" });
  assert.deepEqual(x.resumeRange(0), {});
  assert.deepEqual([x.downloadWhenFinished("web", false), x.downloadWhenFinished("mobile", true), x.downloadWhenFinished("mobile", false)], [true, false, true]);
});
test("Expired output: the job shows Output expired with Export again", () => {
  const row = x.hostJobRow({ jobId: "h", kind: "export.remote", state: "failed", framesDone: 0, frameCount: 0, encodedBytes: 0, createdBy: { kind: "device", id: "d" }, created_ms: 1, error: { code: "export/output-expired", message: "gone" } }, { hostName: "Studio" });
  assert.equal(row.error?.message, "Output expired");
  assert.equal(x.exportRemedy("export/output-expired"), "Export again");
});
test("Device disconnects during a host export: on reconnect the queue is rebuilt from jagentchill.export.list, local jobs kept", () => {
  const listed = [x.hostJobRow({ jobId: "h", kind: "export.remote", state: "running", framesDone: 70, frameCount: 100, encodedBytes: 0, createdBy: { kind: "device", id: "d" }, created_ms: 1 }, { hostName: "Studio" })];
  const merged = x.reconcileHostJobs([job("local"), { ...listed[0], percent: 10 }], listed);
  assert.deepEqual(merged.map((entry) => entry.id), ["local", "host:h"]);
  assert.ok(merged[1].percent > 60);
});
test("Mismatched project: a second project of 1080×1920 fails with export/sequence-mismatch naming it", () => {
  const first = { id: "a", width: 1920, height: 1080, fps: FPS30 };
  assert.deepEqual(x.checkSequence([first, { ...first, id: "b", width: 1080, height: 1920 }], 0), { ok: false, code: "export/sequence-mismatch", projectId: "b", message: "project b differs in canvas size or frame rate from the first" });
  assert.deepEqual(x.checkSequence([first, { ...first, id: "b" }], 0), { ok: true });
  assert.equal(x.checkSequence([first], 0).ok, false);
  assert.equal(x.checkSequence([first, first], 1000).ok, false);
});
test("Three episodes with a cut: 60 s, 90 s and 30 s are 180 s; Black gap: with gapTicks 120000 the output is 182 s", () => {
  assert.equal(x.sequenceDuration([60 * T, 90 * T, 30 * T], 0), 180 * T);
  assert.equal(x.sequenceDuration([60 * T, 90 * T, 30 * T], 120_000), 182 * T);
});
test("Progress weighting: the first of two segments, 30 s of a 120 s sequence, is 25 %", () => { assert.equal(x.sequenceProgress([30 * T, 90 * T], 1), 0.25); });

// ---- Cover, captions, checks, summary, provenance -----------------------------------------------------------------------
test("WebM: the Embed cover toggle is disabled with Not supported for this format", () => {
  assert.equal(x.coverSupported(x.applyPreset("webm")), false);
  assert.equal(x.COVER_UNSUPPORTED, "Not supported for this format");
  assert.equal(x.coverSupported(base), true);
  assert.deepEqual(["gif", "image-sequence"].map((id) => x.coverSupported(x.applyPreset(id))), [false, false]);
  assert.equal(x.coverFileName("Promo.mp4"), "Promo_cover.jpg");
});
const cues = [{ start_ms: 6000, end_ms: 8000, text: "Hello", translation: "Xin chào" }, { start_ms: 1000, end_ms: 2000, text: "Before the range" }];
test("Sidecar with burn-in off: Promo.en.srt beside Promo.mp4 with cue times relative to the range start, and nothing burned", () => {
  const settings = { ...base, burnCaptions: false, sidecar: { enabled: true, format: "srt" as const, trackIds: null, content: "primary" as const } };
  const [file] = x.sidecarFiles([{ id: "t", language: "en", cues }], settings, "Promo.mp4", { start_ms: 5000, end_ms: 15_000 });
  assert.equal(file.name, "Promo.en.srt");
  assert.equal(file.text, "1\r\n00:00:01,000 --> 00:00:03,000\r\nHello\r\n");
  assert.deepEqual(x.burnedTracks([{ id: "t", cues }], false), []);
});
test("Per-track burn-in under the master switch: only the track whose burnIn is on is burned", () => {
  assert.deepEqual(x.burnedTracks([{ id: "A", cues, burnIn: true }, { id: "B", cues, burnIn: false }], true), ["A"]);
});
test("ASS sidecar for a track of unknown language: Clip.und.ass", () => {
  const [file] = x.sidecarFiles([{ id: "t", cues }], { sidecar: { enabled: true, format: "ass", trackIds: null, content: "primary" } }, "Clip.mp4", { start_ms: 0, end_ms: 10_000 });
  assert.equal(file.name, "Clip.und.ass");
  assert.ok(file.text.includes("Dialogue: 0,0:00:06.00,0:00:08.00,Default,Hello"));
});
test("Bilingual both: each VTT cue has the primary line followed by the translation line", () => {
  assert.ok(x.sidecarText("vtt", cues, "both", { start_ms: 0, end_ms: 10_000 }).includes("00:00:06.000 --> 00:00:08.000\nHello\nXin chào\n"));
});
test("Captions only: TXT writes only the caption text files, named from the file name field", () => {
  const settings = { ...base, type: "captions" as const, sidecar: { enabled: true, format: "txt" as const, trackIds: null, content: "primary" as const } };
  assert.deepEqual(x.sidecarFiles([{ id: "t", language: "vi", cues }], settings, "Trip.txt", { start_ms: 0, end_ms: 10_000 }), [{ name: "Trip.vi.txt", text: "Before the range\nHello\n" }]);
  assert.equal(x.exportBlocker(settings, context({ hasCaptionTrack: false }))?.text, "This project has no captions");
  assert.equal(x.fileExtension(settings), "txt");
});
const cc = (id: string, licence: string) => ({ id, name: `${id}.mp3`, provenance: { source: "stock", author: "Ana", licence, sourceUrl: `https://sounds.example/${id}` } });
test("Credits file: two CC BY sounds give two lines with title, author, licence and source URL; the file is Trip.credits.txt", () => {
  const text = x.creditsFile([cc("a", "CC BY 4.0"), cc("b", "CC BY 4.0")])!;
  assert.deepEqual(text.trim().split("\n"), ["a.mp3 — Ana — CC BY 4.0 — https://sounds.example/a", "b.mp3 — Ana — CC BY 4.0 — https://sounds.example/b"]);
  assert.equal(x.creditsFileName("Trip.mp4"), "Trip.credits.txt");
});
test("No attribution needed: only CC0 and user-recorded audio — no credits file", () => {
  assert.equal(x.creditsFile([cc("a", "CC0 1.0"), { id: "r", name: "voice.wav", provenance: { source: "recorded" } }]), null);
});
test("Fallback font is reported: 1 font replaced: <family>", () => {
  const [line] = x.summaryLines({ fontsReplaced: ["Lost Sans"] });
  assert.equal(line.text.replace("{names}", String(line.values!.names)), "1 font replaced: Lost Sans");
});
test("Missing sticker and template resource: 1 sticker missing and 1 template resource missing: <name>", () => {
  const lines = x.summaryLines({ stickersMissing: 1, templateResourcesMissing: ["Teal LUT"] }).map((line) => line.text.replace("{names}", String(line.values?.names)));
  assert.deepEqual(lines, ["1 sticker missing", "1 template resource missing: Teal LUT"]);
});
test("Clean export: the summary shows No issues", () => { assert.deepEqual(x.summaryLines({}), [{ text: "No issues" }]); assert.deepEqual(x.summaryLines(undefined), [{ text: "No issues" }]); });
test("Held transition frame: 1 transition held a frame with the clip names; Slates accepted: 3 placeholder shots exported", () => {
  const [held] = x.summaryLines({ transitionsHeld: ["A → B"] });
  assert.equal(held.text.replace("{names}", String(held.values!.names)), "1 transition held a frame: A → B");
  const [slates] = x.summaryLines({ slatesExported: 3 });
  assert.equal(slates.text.replace("{n}", String(slates.values!.n)), "3 placeholder shots exported");
});
const visual = (id: string, patch: Record<string, unknown> = {}) => ({ id, type: "video", startTime: 0, duration: T, mediaId: id, ...patch });
const assets = [{ id: "cam", provenance: { source: "imported" } }, { id: "gen", provenance: { source: "ai" } }, { id: "gen2", provenance: { source: "ai" } }];
test("Fully generated timeline: every visual element AI-generated gives the trainedAlgorithmicMedia term and xmp:CreatorTool", () => {
  const source = x.digitalSourceType([visual("gen"), visual("gen2", { type: "image" })], assets, { start: 0, end: T });
  assert.equal(source, x.IPTC_TRAINED);
  const packet = x.xmpPacket(source, "1.2.3");
  assert.ok(packet.includes(`Iptc4xmpExt:DigitalSourceType="${x.IPTC_TRAINED}"`) && packet.includes('xmp:CreatorTool="JAgentChill 1.2.3"'));
  assert.equal(x.provenanceLabel(source), "AI-generated");
});
test("Mixed timeline: one camera clip and one AI-generated image give the compositeWithTrainedAlgorithmicMedia term", () => {
  assert.equal(x.digitalSourceType([visual("cam"), visual("gen", { type: "image" })], assets, { start: 0, end: T }), x.IPTC_COMPOSITE);
  assert.equal(x.digitalSourceType([visual("cam"), visual("gen", { type: "audio" })], assets, { start: 0, end: T }), x.IPTC_COMPOSITE, "only audio generated");
  assert.equal(x.digitalSourceType([visual("cam"), visual("x", { mediaId: "cam", workflowLink: { runId: "r" } })], assets, { start: 0, end: T }), x.IPTC_COMPOSITE);
  assert.equal(x.digitalSourceType([visual("cam"), visual("gen", { startTime: 5 * T })], assets, { start: 0, end: T }), null, "only elements inside the range count");
  assert.equal(x.provenanceLabel(x.IPTC_COMPOSITE), "Contains AI-generated media");
});
test("No generated media: the packet carries xmp:CreatorTool and no DigitalSourceType property", () => {
  const packet = x.xmpPacket(x.digitalSourceType([visual("cam")], assets, { start: 0, end: T }), "1.0.0");
  assert.ok(packet.includes("xmp:CreatorTool") && !packet.includes("DigitalSourceType"));
  assert.deepEqual(x.provenanceTags(null, "1.0.0"), { ENCODER: "JAgentChill 1.0.0" });
  assert.ok(x.provenanceComment(x.IPTC_TRAINED, "1.0.0").includes(x.IPTC_TRAINED));
});
test("Metadata cannot be switched off: no export setting removes or edits the provenance record", () => {
  assert.ok(Object.keys(x.DEFAULT_EXPORT_SETTINGS).every((key) => !/provenance|metadata|xmp/i.test(key)));
});
test("Label size and position: at 1920×1080 the text is 27 px tall, 27 px from the right and bottom edges", () => {
  const geometry = x.aiLabelGeometry(HD);
  assert.deepEqual([geometry.textHeight, geometry.margin, geometry.right, geometry.bottom, geometry.opacity, geometry.outline], [27, 27, 1893, 1053, 0.6, 2.25]);
});
test("Label disabled without AI media: This export contains no AI-generated media", () => {
  assert.equal(x.AI_LABEL_DISABLED, "This export contains no AI-generated media");
  assert.equal(x.provenanceLabel(null), "No AI-generated media");
  assert.equal(x.AI_LABEL_TEXT, "AI-generated");
});

// ---- Share targets, publishing, share links -----------------------------------------------------------------------------
test("Browser supports file sharing: Share… is offered beside Download; Browser without Web Share: only Download", () => {
  assert.deepEqual(x.completionActions({ platform: "web", host: null, connectorConnected: false, canShareFile: true, outputType: "video" }), ["download", "share", "copy-link"]);
  assert.deepEqual(x.completionActions({ platform: "web", host: null, connectorConnected: false, canShareFile: false, outputType: "video" }), ["download", "copy-link"]);
  assert.deepEqual(x.completionActions({ platform: "web", host: null, connectorConnected: false, savedToChosenFile: true, outputType: "video" })[0], "saved-to");
});
test("Share on each desktop system: macOS and Windows offer Share…, Linux Copy file and Open with…; Show in folder is first", () => {
  assert.deepEqual(x.completionActions({ platform: "desktop", os: "macos", host: null, connectorConnected: false, outputType: "video" }).slice(0, 4), ["show-in-folder", "open", "copy-path", "share"]);
  assert.deepEqual(x.completionActions({ platform: "desktop", os: "linux", host: null, connectorConnected: false, outputType: "video" }).slice(3, 5), ["copy-file", "open-with"]);
  assert.equal(x.FILE_NOT_FOUND, "File not found at {path}");
});
test("Save to photo library / Share to an installed app: mobile video offers Save to Photos, Share…, Save to Files and Done; audio only the last three", () => {
  assert.deepEqual(x.completionActions({ platform: "mobile", os: "ios", host: host({}, { shareLinks: false }), connectorConnected: false, outputType: "video" }), ["save-to-photos", "share", "save-to-files", "done"]);
  assert.deepEqual(x.completionActions({ platform: "mobile", os: "android", host: null, connectorConnected: false, outputType: "audio" }), ["share", "save-to-files", "done"]);
});
test("Text labels only: the five hand-off destinations are names with their pages and no brand image", () => {
  assert.deepEqual(x.HANDOFF_DESTINATIONS.map((destination) => [destination.name, destination.url]), [["TikTok", "https://www.tiktok.com/upload"], ["YouTube", "https://studio.youtube.com"], ["Instagram", "https://www.instagram.com"], ["Facebook", "https://www.facebook.com"], ["WhatsApp", "https://web.whatsapp.com"]]);
  assert.ok(x.HANDOFF_DESTINATIONS.every((destination) => Object.keys(destination).join() === "id,name,url"));
});
test("Title too long: a 101st character is not accepted and the counter shows 100 / 100", () => {
  const title = x.clampPublishText("x".repeat(101), x.PUBLISH_TITLE_MAX);
  assert.deepEqual([[...title].length, x.counterText(title, 100)], [100, "100 / 100"]);
  assert.equal([...x.clampPublishText("旅".repeat(3000), x.PUBLISH_DESCRIPTION_MAX)].length, 2200);
});
test("Required field missing: the YouTube form with Made for kids unanswered shows Choose Yes or No", () => {
  assert.deepEqual(x.youTubeProblems({ ...x.DEFAULT_YOUTUBE, title: "Launch", visibility: "unlisted" }), { madeForKids: "Choose Yes or No" });
  assert.deepEqual(x.youTubeProblems({ ...x.DEFAULT_YOUTUBE, title: "Launch", madeForKids: false }), {});
  assert.equal(x.DEFAULT_YOUTUBE.visibility, "private");
  const tikTok = x.defaultTikTok({ privacyOptions: ["PUBLIC_TO_EVERYONE", "SELF_ONLY"], comments: true, duets: true, stitches: false });
  assert.deepEqual([tikTok.privacy, tikTok.allowComments, tikTok.allowDuets, tikTok.allowStitches], ["SELF_ONLY", false, false, false]);
});
test("Publish to YouTube as unlisted: jagentchill.connector.publish with the job as source and an idempotency key", () => {
  assert.deepEqual(x.publishParams("youtube", { jobId: "j" }, { title: "Launch", visibility: "unlisted", madeForKids: false }, "k"), { method: "jagentchill.connector.publish", params: { connectorId: "youtube", source: { jobId: "j" }, fields: { title: "Launch", visibility: "unlisted", madeForKids: false }, idempotencyKey: "k" } });
});
test("No connector: Publish… is not offered and the hand-off shortcuts remain", () => {
  assert.ok(!x.completionActions({ platform: "web", host: host({}, { connectors: false }), connectorConnected: false, outputType: "video" }).includes("publish"));
  assert.ok(x.completionActions({ platform: "web", host: host({}, { connectors: true }), connectorConnected: true, outputType: "video" }).includes("publish"));
});
test("No host: Copy link is shown disabled with Connect a host to share by link", () => {
  assert.deepEqual(x.copyLinkState(null, null), { state: "disabled", reason: "Connect a host to share by link" });
  assert.deepEqual(x.copyLinkState(host({}, { shareLinks: false }), null), { state: "hidden" });
});
test("Share links are off: Share links are turned off on this host with Turn on for an admin and Ask an admin otherwise", () => {
  assert.deepEqual(x.copyLinkState(host({}, { admin: true }), false), { state: "off", message: "Share links are turned off on this host", action: "Turn on" });
  assert.deepEqual(x.copyLinkState(host({}), false), { state: "off", message: "Share links are turned off on this host", action: "Ask an admin" });
  assert.equal(x.exportRemedy("export/share-disabled"), "Turn on");
});
test("URL scheme follows the connection: connected at http://100.64.0.5:18910 the link begins with that address", () => {
  assert.equal(x.shareUrl("http://100.64.0.5:18910/", "tok"), "http://100.64.0.5:18910/jagentchill/v1/share/tok");
  assert.equal(x.shareUrl("wss://studio.example", "tok"), "https://studio.example/jagentchill/v1/share/tok");
});
test("Create and open a link: a 24-hour review link with download allowed is the default request; a passcode has 4–32 characters", () => {
  const request = x.shareCreateParams({ jobId: "j" }, x.DEFAULT_SHARE_OPTIONS, "k");
  assert.deepEqual(request, { method: "jagentchill.share.create", params: { source: { jobId: "j" }, expiresIn: 86_400_000, allowDownload: true, mode: "review", idempotencyKey: "k" } });
  assert.equal(x.passcodeProblem("abc"), "A passcode has 4 to 32 characters");
  assert.equal(x.passcodeProblem("abcd"), null);
  assert.throws(() => x.shareCreateParams({ jobId: "j" }, { ...x.DEFAULT_SHARE_OPTIONS, passcode: "x" }, "k"));
  assert.deepEqual(Object.keys(x.SHARE_EXPIRY), ["1h", "24h", "7d", "30d"]);
  assert.ok(x.SHARE_REACH_NOTE.includes("same network or tailnet"));
});

// ---- Failure diagnostics, error codes, encoder fallback -----------------------------------------------------------------
test("Copy details: the text has the code, frame 1204, the encoder configuration and the app version, and no file contents or secrets", () => {
  const text = x.failureDetails({
    failure: { code: "export/encoder-error", message: "the encoder failed", stage: "Rendering", frameIndex: 1204 }, settings: { ...base, token: "secret-token" }, encoder: { codec: "avc1.640028", bitrate: 10_000_000, apiKey: "sk-1" },
    backend: "webgpu", platform: "web", appVersion: "0.9.1", freeBytes: 5, diagnostics: [...Array.from({ length: 60 }, (_, index) => `d${index}`), "see http://h/jagentchill/v1/share/AbC_123-x"],
  });
  for (const part of ["export/encoder-error", "1204", "avc1.640028", "0.9.1", "webgpu"]) assert.ok(text.includes(part), part);
  for (const secret of ["secret-token", "sk-1", "AbC_123-x", '"d0"']) assert.ok(!text.includes(secret), secret);
  assert.equal(JSON.parse(text).diagnostics.length, 50);
});
test("Retry: the failure view offers Retry, Retry with the same snapshot, Copy details and Close", () => {
  assert.deepEqual(x.failureActions({ code: "export/interrupted" }, { hostCanExport: false }).map((action) => action.label), ["Retry", "Retry with the same snapshot", "Copy details", "Close"]);
});
test("Retry on host: after export/no-gpu with a host advertising remote-export, Retry on host is offered", () => {
  assert.ok(x.failureActions({ code: "export/no-gpu" }, { hostCanExport: true }).some((action) => action.label === "Retry on host"));
  assert.equal(x.exportRemedy("export/no-gpu"), "Export on host");
});
test("Unknown code is a test failure: a failure whose code is not in the listed sets throws naming the code", () => {
  assert.throws(() => x.exportCodeOf("export/made-up", true), (error: x.UnknownExportCode) => error.code === "export/made-up" && error.message.includes("export/made-up"));
  // 29 since "export/finalising-timeout" (an export that stops answering at "Finalising" ends with that code).
  assert.equal(x.EXPORT_DOMAIN_CODES.length, 29);
  assert.equal(new Set(x.EXPORT_ERROR_CODES).size, x.EXPORT_ERROR_CODES.length);
  for (const code of x.EXPORT_ERROR_CODES) { assert.ok(x.EXPORT_ERROR_MESSAGES[code], code); assert.ok(x.exportRemedy(code)); }
});
test("Every pre-flight item has a code: each row of the table is a member of the registered sets, with at most one waiver", () => {
  assert.equal(x.PREFLIGHT_TABLE.length, 15);
  for (const row of x.PREFLIGHT_TABLE) assert.ok(x.isExportErrorCode(row.code), row.id);
  assert.deepEqual(x.PREFLIGHT_TABLE.filter((row) => row.waiver).map((row) => [row.code, row.waiver]), [["media/unavailable", "allowMissingMedia"], ["export/font-unavailable", "allowFontFallback"], ["export/device-font", "allowFontFallback"], ["export/slates-present", "allowSlates"], ["export/resource-missing", "allowMissingResources"]]);
});
test("Engine no-GPU maps to the export code: engine/no-gpu is reported as export/no-gpu", () => {
  assert.equal(x.exportCodeOf("engine/no-gpu"), "export/no-gpu");
  assert.equal(x.exportCodeOf("engine/device-lost"), "export/device-lost");
  assert.equal(x.exportCodeOf("media/unavailable", true), "media/unavailable");
});
test("Hardware encoder error: one automatic retry with software encoding and the notice", () => {
  assert.deepEqual(x.encoderRetry({ hardwareAcceleration: "auto", retried: false }), { retry: true, hardwareAcceleration: "prefer-software", notice: "Hardware encoder failed; retrying with software encoding" });
});
test("Both encoders fail: the job fails with export/encoder-error; Retry on host with a host, Try H.264 with another codec", () => {
  assert.deepEqual(x.encoderRetry({ hardwareAcceleration: "auto", retried: true }), { retry: false, code: "export/encoder-error" });
  assert.deepEqual(x.encoderRetry({ hardwareAcceleration: "prefer-software", retried: false }), { retry: false, code: "export/encoder-error" });
  const labels = x.failureActions({ code: "export/encoder-error" }, { hostCanExport: true, otherCodec: "H.264" }).map((action) => action.label);
  assert.ok(labels.includes("Retry on host") && labels.includes("Try H.264"));
  assert.ok(x.failureActions({ code: "export/out-of-memory" }, { hostCanExport: false, lowerResolution: "1080p" }).some((action) => action.label === "Retry at 1080p"));
});

// ---- Export settings persistence ----------------------------------------------------------------------------------------
const blank = () => createProjectDocument({ id: "11111111-1111-4111-8111-111111111111", mainSceneId: "22222222-2222-4222-8222-222222222222", mainTrackId: "33333333-3333-4333-8333-333333333333", now_ms: 1_700_000_000_000 });
test("Settings restored per project: 720p WebM and 4K MP4 each come back as they were stored, and the document accepts them", () => {
  const a = x.edit(x.applyPreset("webm"), { resolution: { mode: "720p", width: 0, height: 0 } }), b = x.applyPreset("4k");
  for (const settings of [a, b]) {
    const stored = x.toStoredExportSettings(settings, HD, FPS30);
    const parsed = projectDocumentSchema.safeParse({ ...blank(), exportSettings: stored });
    assert.ok(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues[0]));
    const back = x.fromStoredExportSettings(JSON.parse(JSON.stringify(stored)));
    assert.deepEqual([x.outputSize(back, HD), back.container, back.videoCodec, back.audioCodec, back.presetId], [x.outputSize(settings, HD), settings.container, settings.videoCodec, settings.audioCodec, settings.presetId]);
  }
  assert.deepEqual(x.fromStoredExportSettings(x.toStoredExportSettings(x.applyPreset("gif"), HD, FPS30)).type, "gif");
  assert.equal(x.toStoredExportSettings(x.applyPreset("image-sequence"), HD, FPS30).type, "sequence");
});
test("Project opened on another device: the stored settings hold no save path — the location is that device's default", () => {
  const text = JSON.stringify(x.toStoredExportSettings(base, HD, FPS30));
  assert.ok(!/path|folder|token|passcode/i.test(text), text);
});
test("Unknown field survives: extraOption: 3 in stored values is still there after the next write", () => {
  const stored = x.toStoredExportSettings(base, HD, FPS30, { values: { extraOption: 3 }, futureRoot: true });
  assert.equal(stored.values!.extraOption, 3);
  assert.equal(stored.futureRoot, true);
});
test("Path is refused: values.path in the project is rejected with document/field-not-allowed", () => {
  const stored = x.toStoredExportSettings(base, HD, FPS30);
  const parsed = projectDocumentSchema.safeParse({ ...blank(), exportSettings: { ...stored, values: { ...stored.values, path: "/Users/me/Movies" } } });
  assert.equal(parsed.success, false);
  assert.ok(!parsed.success && JSON.stringify(parsed.error.issues).includes("document/field-not-allowed"));
});

// ---- Encoder availability, keyboard, notification -----------------------------------------------------------------------
test("MP3 encoder is a separate file: this build bundles none, so MP3 is refused on the device instead of being substituted", () => {
  const mp3 = x.applyPreset("audio-only");
  assert.equal(x.exportBlocker(mp3, context({ caps: caps({ audio: { aac: true, opus: true, flac: true, mp3: false } }) }))?.text, "Not supported on this device");
});
test("Keyboard-only export: the dialog's blocker is null for a valid export, so Enter on Export starts it", () => { assert.equal(x.exportBlocker(base, context()), null); });
test("Desktop window in background / host job fails: a finished or failed job carries what its notification needs", () => {
  const done = x.finishJob(queueOf(job("a")), "a", { state: "succeeded", output: { fileName: "a.mp4", mime: "video/mp4", size: 10, location: "downloads" } }).history[0];
  assert.deepEqual([done.state, done.output?.fileName, done.target], ["succeeded", "a.mp4", "device"]);
});

// The owner's export of 2026-10-08 stopped at frame 0 with a bare "media of the frame is unavailable": a song the library
// had recorded as a video lay on an overlay track as a video clip, its file present, and nothing named it.
test("A clip whose media cannot be drawn is named before the export starts: a sound placed as a video clip, and a video this device cannot decode", () => {
  const document = docOf([el("Heartbreaking.mp3", { name: "Heartbreaking.mp3" }), el("b"), el("c")]);
  document.media.assets[0].type = "audio";
  const result = flight(document, { mediaState: (assetId) => (assetId === "asset-c" ? "undrawable" : "ready") });
  const item = result.blocking.find((entry) => entry.id === "media-undrawable")!;
  assert.deepEqual([result.ok, item.code, item.message, item.values, item.names, item.elementIds, item.waiver, item.remedies], [false, "media/unavailable", "{n} clips use media that cannot be drawn", { n: 2 }, ["Heartbreaking.mp3", "c"], ["Heartbreaking.mp3", "c"], "allowMissingMedia", ["Replace media"]]);
  assert.equal(result.blocking.some((entry) => entry.id === "media-missing"), false, "the files are here: they are not called missing");
  assert.equal(flight(docOf([el("b")]), { mediaState: () => "ready" }).ok, true);
  // An audio clip of an audio asset is what it should be.
  const sound = docOf([el("song", { type: "audio" })]);
  sound.media.assets[0].type = "audio";
  assert.equal(flight(sound).ok, true);
});
// The review of 2026-10-08: the check looked at decodability for videos only, and media that arrived by sync had no
// answer at all — a picture or a song this device cannot decode passed as ready and the film lost it.
test("A picture or a sound this device cannot decode is named before the export starts, like a video: the device's answer for every kind of media reaches the check", () => {
  const undecodable = { canDecode: false as const };
  // What the dialog tells the check, per kind (before: only a video could be `undrawable`).
  assert.equal(x.deviceMediaState({ type: "image" }, undecodable, true), "undrawable");
  assert.equal(x.deviceMediaState({ type: "audio" }, undecodable, true), "undrawable");
  assert.equal(x.deviceMediaState({ type: "video" }, undecodable, true), "undrawable");
  assert.equal(x.deviceMediaState({ type: "video" }, { canDecode: false, proxy: { state: "succeeded" } }, true), "ready", "a finished proxy stands in for a video");
  assert.equal(x.deviceMediaState({ type: "image" }, { canDecode: false, proxy: { state: "succeeded" } }, true), "undrawable");
  for (const local of [undefined, {}, { canDecode: null }, { canDecode: true }]) assert.equal(x.deviceMediaState({ type: "audio" }, local, true), "ready");
  assert.equal(x.deviceMediaState({ type: "audio" }, undecodable, false), "missing", "a file that is not here is missing, whatever was known of it");

  const document = docOf([el("poster.jpg", { name: "Clip 1", type: "image" }), el("song.wav", { name: "song", type: "audio" }), el("voice.wav", { type: "audio" }), el("ok")]);
  document.media.assets[0].type = "image"; document.media.assets[1].type = "audio"; document.media.assets[2].type = "audio";
  for (const asset of document.media.assets) asset.name = asset.id.replace(/^asset-/, "");
  const local: Record<string, { canDecode: boolean }> = { "asset-poster.jpg": undecodable, "asset-song.wav": undecodable, "asset-voice.wav": undecodable };
  const result = flight(document, { mediaState: (assetId) => x.deviceMediaState(document.media.assets.find((asset) => asset.id === assetId)!, local[assetId], true) });
  const sounds = result.blocking.find((entry) => entry.id === "media-undecodable-sound")!, pictures = result.blocking.find((entry) => entry.id === "media-undrawable")!;
  assert.equal(result.ok, false);
  assert.deepEqual([sounds.code, sounds.message, sounds.values, sounds.names, sounds.elementIds, sounds.waiver, sounds.remedies], ["media/unavailable", "{n} sounds cannot be decoded on this device", { n: 2 }, ["song.wav", "voice.wav"], ["song.wav", "voice.wav"], "allowMissingMedia", ["Replace media"]]);
  assert.deepEqual([pictures.message, pictures.names, pictures.elementIds], ["1 clip uses media that cannot be drawn", ["poster.jpg"], ["poster.jpg"]]);
  assert.equal(result.blocking.some((entry) => entry.id === "media-missing"), false);
  // One sound: said in the singular, by its file's name.
  const one = docOf([el("song.wav", { type: "audio" })]);
  one.media.assets[0].type = "audio"; one.media.assets[0].name = "song.wav";
  assert.deepEqual(flight(one, { mediaState: () => "undrawable" }).blocking.map((entry) => [entry.id, entry.message, entry.names]), [["media-undecodable-sound", "1 sound cannot be decoded on this device", ["song.wav"]]]);
});
test("An export failure is told in one sentence that names the clip; the engine's words stay in the copied details", () => {
  const failure: x.ExportFailure = { code: "media/unavailable", message: "media of the frame is unavailable", frameIndex: 0, details: { textures: ["t1"], clips: [{ elementId: "e1", assetId: "a1", elementName: "Heartbreaking", assetName: "Heartbreaking - Kevin MacLeod.mp3" }] } };
  const told = x.failureSentence(failure);
  assert.equal(told.message, "The clip “{clip}” could not be drawn: its media is missing or is not a picture or video this device can show. Replace or remove the clip, then export again.");
  assert.deepEqual(told.values, { clip: "Heartbreaking - Kevin MacLeod.mp3" });
  assert.deepEqual(x.failedClips(failure).map((clip) => clip.elementId), ["e1"]);
  // A sound that would have been left out of the film is said as a sound, by the clip's name.
  const silent = x.failureSentence({ code: "media/unavailable", details: { sound: "undecodable", assetId: "a1", clips: [{ elementId: "e1", assetId: "a1", assetName: "song.mp3" }] } });
  assert.deepEqual([silent.message, silent.values], ["The sound “{clip}” could not be exported: this device cannot decode its audio. Replace it with another file (MP3, WAV or AAC), then export again.", { clip: "song.mp3" }]);
  assert.match(x.failureSentence({ code: "media/unavailable", details: { sound: "missing", clips: [{ elementId: "e1", assetName: "song.mp3" }] } }).message, /^The sound “\{clip\}” could not be exported: its file is not on this device\./);
  assert.deepEqual(x.failureSentence({ code: "media/unavailable", details: { clips: [{ elementId: "e1", elementName: "A" }, { elementId: "e2" }, { elementId: "e3" }] } }).values, { clip: "A", n: 2 });
  // Without a named clip the sentence is the code's own; never the raw message.
  assert.equal(x.failureSentence({ code: "media/unavailable" }).message, "A media file is missing");
  assert.equal(x.failureSentence({ code: "export/engine-panic", details: { anything: "{\"raw\":true}" } }).message, "The render engine stopped");
  const copied = x.failureDetails({ failure, settings: null, encoder: null, backend: "webgl2", platform: "web", appVersion: "0", freeBytes: null, diagnostics: [] });
  assert.match(copied, /media of the frame is unavailable/);
  assert.match(copied, /Heartbreaking - Kevin MacLeod\.mp3/);
});
