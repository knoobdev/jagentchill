import { z } from "zod";
import { addCrossfade, frameTicks, setElementFields, setEq, setFade, setTrackDucking, snapToFrame, timeline } from "@jagentchill/editor-core";
import { EQ_BANDS, EQ_PRESETS, FADE_SHAPES, VOICE_EFFECTS } from "@jagentchill/protocol";
import { WRITE, checkField, checkRange, elementIn, elementLabel, elementsIn, fail, id, ids, outOfRange, seconds, ticks, trackIn, unlocked, writeTool } from "./kit.ts";

const end = (element: { startTime: number; duration: number }) => element.startTime + element.duration;
const fadeShape = () => z.object({ duration: ticks(), shape: z.enum(FADE_SHAPES).optional() }).strict();
const toggled = () => z.object({ enabled: z.boolean(), strength: z.number().optional() }).strict();

export const AUDIO_TOOLS = [
  writeTool({
    name: "jc_audio_edit", family: "audio",
    description: "Set audio properties of audio elements and of video or compound elements with sound: volume (−60 to +20 dB; −60 is silence), mute, pan (−100 to +100), fadeIn and fadeOut (duration in ticks and a shape), the voice flag, voice effect, pitch, loudness normalisation, equaliser and compressor. fadeIn plus fadeOut cannot be longer than the element.",
    shape: {
      elementIds: ids(), volume: z.number().optional(), mute: z.boolean().optional(), pan: z.number().optional(), fadeIn: fadeShape().optional(), fadeOut: fadeShape().optional(), isVoice: z.boolean().optional(),
      voiceEffect: z.object({ type: z.enum(VOICE_EFFECTS), intensity: z.number().optional() }).strict().optional(), pitch: z.object({ semitones: z.number().optional(), cents: z.number().optional() }).strict().optional(),
      normalize: z.object({ enabled: z.boolean(), target: z.number().optional() }).strict().optional(),
      eq: z.object({ enabled: z.boolean(), preset: z.enum(EQ_PRESETS).optional(), bands: z.object(Object.fromEntries(EQ_BANDS.map((band) => [band, z.number().optional()])) as Record<(typeof EQ_BANDS)[number], z.ZodOptional<z.ZodNumber>>).strict().optional() }).strict().optional(),
      compressor: z.object({ enabled: z.boolean(), threshold: z.number().optional(), ratio: z.number().optional(), attack: z.number().optional(), release: z.number().optional(), makeup: z.number().optional() }).strict().optional(),
      noiseReduction: toggled().optional(), enhanceVoice: toggled().optional(), ...WRITE,
    },
    refine(args) {
      checkRange("volume", args.volume, -60, 20, "decibels");
      checkRange("pan", args.pan, -100, 100);
      if (args.pan !== undefined && !Number.isInteger(args.pan)) fail("INVALID_PARAMS", "pan is a whole number from −100 to +100.", { field: "pan" });
      checkRange("voiceEffect.intensity", args.voiceEffect?.intensity, 0, 100);
      checkRange("pitch.semitones", args.pitch?.semitones, -12, 12); checkRange("pitch.cents", args.pitch?.cents, -100, 100);
      checkRange("normalize.target", args.normalize?.target, -30, -5, "LUFS");
      for (const band of EQ_BANDS) checkRange(`eq.bands.${band}`, args.eq?.bands?.[band], -12, 12, "decibels");
      checkRange("compressor.threshold", args.compressor?.threshold, -60, 0); checkRange("compressor.ratio", args.compressor?.ratio, 1, 20); checkRange("compressor.attack", args.compressor?.attack, 1, 200);
      checkRange("compressor.release", args.compressor?.release, 10, 1000); checkRange("compressor.makeup", args.compressor?.makeup, 0, 24);
      checkRange("noiseReduction.strength", args.noiseReduction?.strength, 0, 100); checkRange("enhanceVoice.strength", args.enhanceVoice?.strength, 0, 100);
      if (Object.keys(args).every((key) => ["elementIds", "idempotencyKey", "dryRun", "editContext"].includes(key))) fail("INVALID_PARAMS", "Name at least one audio property to set.");
    },
    handle(ctx, args) {
      const { hits } = elementsIn(ctx, args.elementIds), changed = new Set<string>();
      for (const hit of hits) {
        const { element } = hit;
        unlocked(hit.track);
        if (!timeline.isAudioCapable(ctx.doc, element)) fail("UNSUPPORTED_FOR_ELEMENT", `${elementLabel(element)} has no sound: audio properties apply to audio elements and to video or compound elements with sound.`, { elementId: element.id });
        const fields: Record<string, unknown> = {};
        if (args.volume !== undefined) { checkField(element, "volume", args.volume); fields.volume = args.volume; }
        if (args.mute !== undefined) fields.muted = args.mute;
        if (args.pan !== undefined) fields.pan = args.pan;
        if (args.isVoice !== undefined) fields.isVoice = args.isVoice;
        if (args.voiceEffect) fields.voiceEffect = { type: args.voiceEffect.type, intensity: args.voiceEffect.intensity ?? (element.voiceEffect as { intensity?: number } | undefined)?.intensity ?? 100 };
        if (args.pitch) fields.pitch = { semitones: 0, cents: 0, ...(element.pitch as object), ...args.pitch };
        if (args.normalize) fields.normalize = { target: -14, gainDb: 0, ...(element.normalize as object), ...args.normalize };
        if (args.compressor) fields.compressor = { threshold: -18, ratio: 3, attack: 10, release: 120, makeup: 0, ...(element.compressor as object), ...args.compressor };
        if (args.noiseReduction) fields.noiseReduction = { strength: 50, ...(element.noiseReduction as object), ...args.noiseReduction };
        if (args.enhanceVoice) fields.enhanceVoice = { strength: 50, ...(element.enhanceVoice as object), ...args.enhanceVoice };
        // Fades: the one being set is limited by what the other leaves of the element.
        const current = { fadeIn: Number((element.fadeIn as { duration?: number } | undefined)?.duration ?? 0), fadeOut: Number((element.fadeOut as { duration?: number } | undefined)?.duration ?? 0) };
        const wanted = { fadeIn: args.fadeIn?.duration ?? current.fadeIn, fadeOut: args.fadeOut?.duration ?? current.fadeOut };
        for (const side of ["fadeIn", "fadeOut"] as const) {
          if (!args[side]) continue;
          const other = side === "fadeIn" ? wanted.fadeOut : wanted.fadeIn;
          if (wanted[side] + other > element.duration) outOfRange(`${side}.duration`, 0, Math.max(0, element.duration - other), wanted[side], "fadeIn plus fadeOut is at most the element's duration");
        }
        if (Object.keys(fields).length > 0) { ctx.apply((doc, c) => setElementFields(doc, c, element.id, fields, { commandType: "audio.edit", label: "Audio" })); for (const key of Object.keys(fields)) changed.add(key); }
        for (const side of ["fadeIn", "fadeOut"] as const) if (args[side]) { ctx.apply((doc, c) => setFade(doc, c, [element.id], side, args[side]!)); changed.add(side); }
        if (args.eq) {
          ctx.apply((doc, c) => setEq(doc, c, [element.id], { enabled: args.eq!.enabled, ...(args.eq!.preset && args.eq!.preset !== "custom" ? { preset: args.eq!.preset } : {}) }));
          for (const band of EQ_BANDS) { const value = args.eq.bands?.[band]; if (value !== undefined) ctx.apply((doc, c) => setEq(doc, c, [element.id], { band: { key: band, value } })); }
          changed.add("eq");
        }
      }
      const now = timeline.located(ctx.doc, args.elementIds[0]).element;
      return {
        data: { elementIds: args.elementIds, changed: [...changed], audio: { volume: now.volume, muted: now.muted, pan: now.pan, fadeIn: now.fadeIn, fadeOut: now.fadeOut, isVoice: now.isVoice, voiceEffect: now.voiceEffect ?? null, pitch: now.pitch ?? null, eq: now.eq ?? null } },
        summary: `Set ${[...changed].join(", ")} of ${hits.length === 1 ? elementLabel(hits[0].element) : `${hits.length} elements`}.`, change: { kind: "modify", entity: "element", entityId: hits[0].element.id, label: hits[0].element.name },
      };
    },
  }),
  writeTool({
    name: "jc_audio_duck", family: "audio",
    description: "Turn ducking on or off on music tracks (audio tracks): while a voice plays, reduce the whole track or only its 300 Hz–4 kHz voice band (`mode`: full or voice-band; default full) by amount (0–30 dB, default 12) with attack (10–1000 ms) and release (50–3000 ms). voiceElementIds marks those elements as voice. Ducking is a track setting read when mixing; no volume keyframes are written.",
    shape: { musicTrackIds: ids(99), enabled: z.boolean(), amount: z.number().optional(), attack: z.number().optional(), release: z.number().optional(), mode: z.enum(["full", "voice-band"]).optional(), voiceElementIds: ids().optional(), ...WRITE },
    refine(args) { checkRange("amount", args.amount, 0, 30, "decibels"); checkRange("attack", args.attack, 10, 1000, "milliseconds"); checkRange("release", args.release, 50, 3000, "milliseconds"); },
    handle(ctx, args) {
      const tracks = args.musicTrackIds.map((trackId) => trackIn(ctx, trackId));
      for (const { track } of tracks) { unlocked(track); if (track.type !== "audio") fail("TRACK_KIND_MISMATCH", `Ducking is a setting of an audio track; "${track.name}" is a ${track.type} track.`, { trackId: track.id, trackType: track.type }); }
      const voices = (args.voiceElementIds ?? []).map((elementId) => elementIn(ctx, elementId));
      for (const hit of voices) { unlocked(hit.track); if (!timeline.isAudioCapable(ctx.doc, hit.element)) fail("UNSUPPORTED_FOR_ELEMENT", `${elementLabel(hit.element)} has no sound and cannot be marked as voice.`, { elementId: hit.element.id }); }
      for (const { track } of tracks) ctx.apply((doc, c) => setTrackDucking(doc, c, track.id, { enabled: args.enabled, ...(args.amount !== undefined ? { amount: args.amount } : {}), ...(args.attack !== undefined ? { attack: args.attack } : {}), ...(args.release !== undefined ? { release: args.release } : {}), ...(args.mode !== undefined ? { mode: args.mode } : {}) }));
      for (const hit of voices) ctx.apply((doc, c) => setElementFields(doc, c, hit.element.id, { isVoice: true }, { commandType: "audio.voice", label: "Voice" }));
      return { data: { tracks: args.musicTrackIds.map((trackId) => ({ trackId, ducking: trackIn(ctx, trackId).track.ducking })), voiceElementIds: args.voiceElementIds ?? [] }, summary: `${args.enabled ? "Turned on" : "Turned off"} ducking on ${tracks.length} track(s).`, change: { kind: "modify", entity: "track", entityId: tracks[0].track.id, label: tracks[0].track.name } };
    },
  }),
  writeTool({
    name: "jc_audio_crossfade", family: "audio",
    description: "Create a crossfade between two adjacent audio elements of one audio track: duration 0.05–10 s in ticks (at least 2 frames, and no longer than either element) and a fade shape.",
    shape: { elementIdA: id(), elementIdB: id(), duration: ticks(), shape: z.enum(FADE_SHAPES).optional(), ...WRITE },
    handle(ctx, args) {
      const a = elementIn(ctx, args.elementIdA), b = elementIn(ctx, args.elementIdB), frame = frameTicks(ctx.doc.settings.fps);
      unlocked(a.track);
      if (a.element.type !== "audio" || b.element.type !== "audio") fail("UNSUPPORTED_FOR_ELEMENT", "A crossfade joins two audio elements. Between video clips use jc_transition_set.", { elementIds: [args.elementIdA, args.elementIdB] });
      if (a.track.id !== b.track.id) fail("INVALID_PARAMS", "The two elements are on different tracks. A crossfade joins two adjacent elements of the same track.", { field: "elementIdB" });
      const [from, to] = a.element.startTime <= b.element.startTime ? [a.element, b.element] : [b.element, a.element];
      if (end(from) !== to.startTime) fail("INVALID_PARAMS", `The elements are not adjacent: there is ${end(from) < to.startTime ? `a gap of ${seconds(to.startTime - end(from))}` : "an overlap"} between them.`, { field: "elementIdB", gap: to.startTime - end(from) });
      const least = Math.max(6000, 2 * frame), most = Math.min(1_200_000, from.duration, to.duration);
      if (args.duration < least || args.duration > most) outOfRange("duration", least, most, args.duration, "0.05–10 s, at least 2 frames, and no longer than either element");
      if ((a.track.transitions as { fromElementId: string; toElementId: string }[]).some((record) => record.fromElementId === from.id && record.toElementId === to.id)) fail("ALREADY_EXISTS", "These two elements already have a crossfade between them.", { elementIds: [from.id, to.id] });
      let transitionId = "";
      ctx.apply((doc, c) => { const made = addCrossfade(doc, c, from.id, to.id, { duration: snapToFrame(args.duration, doc.settings.fps), ...(args.shape ? { shape: args.shape } : {}) }); transitionId = made.transitionId; return made; });
      return { data: { transitionId, fromElementId: from.id, toElementId: to.id, duration: args.duration, shape: args.shape ?? "equal-power" }, summary: `Added a ${seconds(args.duration)} crossfade between ${elementLabel(from)} and ${elementLabel(to)}.`, change: { kind: "modify", entity: "element", entityId: from.id, label: from.name } };
    },
  }),
];
