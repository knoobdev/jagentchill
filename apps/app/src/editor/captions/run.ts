import { timeline, type SpeechClip, type SpeechElement } from "@jagentchill/editor-core";
import type { ProjectDocument } from "@jagentchill/protocol";
import { HostError } from "@jagentchill/client";
import { useCallback, useEffect, useState } from "react";
import { useHost } from "../../host";
import { sumEstimates, type Answer, type Quoted } from "./answers";

export type SpeechSource = "timeline" | "main" | "audio" | "selection";

/** The audible clips of the chosen source, in timeline order: muted and hidden clips and clips on muted tracks are left out. */
export function speechClips(document: ProjectDocument, sceneId: string, source: SpeechSource, selected: readonly string[]): SpeechClip[] {
  const scene = timeline.sceneById(document, sceneId);
  const tracks = [...(source !== "audio" ? [scene.tracks.main, ...(source === "main" ? [] : scene.tracks.overlay)] : []), ...(source !== "main" ? scene.tracks.audio : [])];
  return tracks.filter((track) => (track as { muted?: boolean }).muted !== true).flatMap((track) => track.elements as unknown as timeline.El[])
    .filter((element) => typeof element.mediaId === "string" && timeline.isAudioCapable(document, element) && element.muted !== true && element.hidden !== true && (source !== "selection" || selected.includes(element.id)))
    .sort((a, b) => a.startTime - b.startTime)
    .map((element) => ({ id: element.id, assetId: String(element.mediaId), element: element as unknown as SpeechElement }));
}

export const base64 = (bytes: Uint8Array): string => { let text = ""; for (let at = 0; at < bytes.length; at += 0x8000) text += String.fromCharCode(...bytes.subarray(at, at + 0x8000)); return btoa(text); };

export type CaptionsStatus = {
  transcription: { available: boolean; provider?: string; label?: string; model?: string };
  translation: { available: boolean; provider?: string; label?: string; model?: string; reason?: "no_route" };
  speech: { available: boolean };
};
/** What the connected host can do for captions right now; `null` while it is not known (no host, or still asking). */
export function useCaptionsStatus(): { status: CaptionsStatus | null; reload(): void } {
  const { connection, onEvent } = useHost();
  const [status, setStatus] = useState<CaptionsStatus | null>(null);
  const reload = useCallback(() => { if (!connection) return setStatus(null); void connection.call<CaptionsStatus>("jagentchill.captions.status", {}).then(setStatus).catch(() => setStatus(null)); }, [connection]);
  useEffect(reload, [reload]);
  useEffect(() => onEvent((event) => { if (event.event === "jagentchill.provider.changed" || event.event === "jagentchill.orc.config.changed") reload(); }), [onEvent, reload]);
  return { status, reload };
}

/** The host's estimate of a paid action — and its QUOTE: `confirmWith` names the question the host put on record for it, which the answer sends back. */
export type CostEstimate = Quoted;
export type EstimateOf = { kind: "transcription"; seconds: number; pieces?: number } | { kind: "translation"; characters: number; /** How many captions they are: the host prices the batches they are sent in. */ lines?: number; /** The captions as they will be sent, and the names their requests carry (`answers.translationEstimate`). */ texts?: string[]; targetName?: string; source?: string } | { kind: "speech"; text: string; language?: string; /** Recorded anew although a recording of this text exists: paid again. */ again?: boolean };
/** Asks the host for the estimate of one piece of paid work now. Asked right before the action too: the answer names the question this call puts on record. */
export const askEstimate = (connection: { call<T>(method: string, params?: unknown): Promise<T> }, of: EstimateOf): Promise<CostEstimate> => connection.call<CostEstimate>("jagentchill.captions.estimate", of);
/**
 * The host's estimate for paid work, asked again when what would be sent changes; `null` while unknown or when nothing
 * would be sent. Several pieces (speech: one request a text) are estimated each as it will be sent and shown as one sum.
 */
export function useEstimate(of: EstimateOf | readonly (EstimateOf & { kind: "speech" })[] | null): CostEstimate | null {
  const { connection, can } = useHost();
  const [estimate, setEstimate] = useState<CostEstimate | null>(null);
  const key = of && (!Array.isArray(of) || of.length) ? JSON.stringify(of) : "";
  useEffect(() => {
    setEstimate(null);
    if (!connection || !key || !can("jagentchill.generation.run")) return;
    let alive = true;
    // A text being typed, a selection being changed: ask once it rests.
    const timer = setTimeout(() => {
      const asked = JSON.parse(key) as EstimateOf | (EstimateOf & { kind: "speech" })[];
      const work = Array.isArray(asked) ? Promise.all(asked.map(async (entry) => ({ key: entry.text, estimate: await askEstimate(connection, entry) }))).then(sumEstimates) : askEstimate(connection, asked);
      void work.then((result) => { if (alive) setEstimate(result); }).catch(() => undefined);
    }, 250);
    return () => { alive = false; clearTimeout(timer); };
  }, [connection, key, can]);
  return estimate;
}

/** Whether the host refused paid work until its estimate is confirmed (the tool stops and the cost dialog asks). */
export const needsConfirming = (error: unknown): boolean => error instanceof HostError && error.code === "PERMISSION_DENIED" && error.details?.reason === "confirmation_required";
/**
 * What a person has confirmed for one action, as the cost dialog gives it: `confirmed: true` and whatever the host
 * named to be sent back with the answer (`confirmWith` of its question). Sent as it is with EVERY request of that action.
 */
export type Grants = Answer;
