import { useEffect } from "react";
import { ClipChain, clipProcessing, measureLoudness, normalizeGainDb, setElementFields, timeline } from "@jagentchill/editor-core";
import { decodeSound } from "../content-dom";
import { useEditor, useEditorVersion } from "../context";
import type { EditorRuntime } from "../runtime";

type El = timeline.El;
type Obj = Record<string, unknown>;
const objectOf = (value: unknown): Obj => (value !== null && typeof value === "object" ? (value as Obj) : {});
const SECOND = 120_000, RATE = 48_000;
// What was measured for an element in this session, by everything the measurement depends on.
const measured = new Map<string, string>(), running = new Set<string>();
// The decoded sound of the assets measured last: a long file is decoded once for the clips that use it.
const decoded = new Map<string, Promise<{ left: Float32Array; right: Float32Array } | null>>();

/** Everything the loudness of an element depends on: its source range, its speed, the stages before the normalisation gain, and the target. */
const keyOf = (element: El): string => { const { normalizeDb: _own, ...before } = clipProcessing(element as never) ?? {}; return JSON.stringify([element.mediaId, element.trimStart, element.duration, objectOf(element.retime).rate ?? 1, before, objectOf(element.normalize).target ?? -14]); };

/**
 * Measures one element (ITU-R BS.1770-4, on this device): its visible source range through its equaliser and
 * compressor, then the gain that brings it to the target, limited by the true peak and to +24 dB. The gain and the
 * measurement are written without a history step.
 */
async function measure(runtime: EditorRuntime, element: El, key: string): Promise<void> {
  const assetId = String(element.mediaId);
  if (!decoded.has(assetId)) {
    if (decoded.size >= 2) decoded.delete(decoded.keys().next().value!);
    decoded.set(assetId, runtime.media.mediaUrl(assetId).then((url) => (url ? decodeSound(url) : null)).catch(() => null));
  }
  const sound = await decoded.get(assetId)!;
  if (!sound) { decoded.delete(assetId); return; }
  const rate = Number(objectOf(element.retime).rate ?? 1) || 1;
  const from = Math.max(0, Math.round((Number(element.trimStart ?? 0) / SECOND) * RATE)), to = Math.min(sound.left.length, from + Math.round(((element.duration * rate) / SECOND) * RATE));
  const left = sound.left.slice(from, to), right = sound.right.slice(from, to);
  const { normalizeDb: _own, ...before } = clipProcessing(element as never) ?? {};
  if (before.eq || before.compressor) new ClipChain(before).process(left, right, 0, left.length);
  const loudness = measureLoudness(left, right), target = Number(objectOf(element.normalize).target ?? -14), gain = normalizeGainDb(target, loudness);
  const { controller } = runtime, current = timeline.locate(controller.stored, element.id)?.element;
  // The clip may have changed or gone while its sound was decoded: a stale result is dropped.
  if (!current || keyOf(current) !== key || objectOf(current.normalize).enabled !== true) return;
  const next = { ...objectOf(current.normalize), gainDb: gain.gainDb, ...(Number.isFinite(loudness.lufs) ? { measuredLufs: Math.round(loudness.lufs * 10) / 10 } : {}) };
  if (!Number.isFinite(loudness.lufs)) delete (next as Obj).measuredLufs;
  measured.set(element.id, key);
  if (JSON.stringify(next) !== JSON.stringify(current.normalize)) controller.external((doc, ctx) => setElementFields(doc, ctx, element.id, { normalize: next }, { commandType: "audio.normalize", label: "Normalise loudness" }, false));
}

/** Whether an element's stored gain belongs to what it is now: `false` while a measurement is due or running. */
export const loudnessSettled = (element: El): boolean => measured.get(element.id) === keyOf(element);

/**
 * Keeps the normalisation gain of every element that has "Normalise loudness" on in step with the clip: a change of
 * its trim, speed, equaliser, compressor or target measures it again.
 */
export function useLoudnessWatcher(): void {
  const runtime = useEditor(), version = useEditorVersion();
  useEffect(() => {
    const { controller } = runtime;
    for (const scene of controller.stored.scenes) for (const element of timeline.elementsOfScene(scene as never)) {
      if (objectOf(element.normalize).enabled !== true || typeof element.mediaId !== "string") continue;
      const key = keyOf(element);
      if (measured.get(element.id) === key || running.has(`${element.id}:${key}`)) continue;
      running.add(`${element.id}:${key}`);
      void measure(runtime, element, key).finally(() => running.delete(`${element.id}:${key}`));
    }
  }, [runtime, version]);
}
