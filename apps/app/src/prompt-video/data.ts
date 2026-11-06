import { useEffect, useMemo, useRef, useState } from "react";
import { fetchVerified, uploadBlob } from "@jagentchill/client";
import { promptVideo as pv } from "@jagentchill/editor-core";
import type { WorkflowExecution, WorkflowNodeStatus, WorkflowRunRecord } from "@jagentchill/protocol";
import { useHost } from "../host";
import { loadSigner } from "../identity";
import { failureOf, type RunData } from "../workflows/data";
import { sha256Hex } from "../editor/dom";
import { imageSize } from "./platform";

/** What the host answers the setup form: the estimate, what it can generate, and the voices it offers. */
export type EstimateAnswer = { estimate: pv.RunEstimate; capabilities: { image: boolean; speech: boolean; music: boolean }; voices: { voiceId: string; name: string }[]; blocked?: { scope?: string; remainingUsd?: number }; /** The one money question of a run: whether this estimate needs it, and where the run would stop afterwards. */ budget?: { scope: string; label?: string; remainingUsd: number } | null; confirmation?: { needed: boolean; aboveUsd: number; amountUsd: number; stopsAtUsd: number; /** The models of this run whose price is not known: named on the question, allowed by the person's start. */ unpricedModels?: string[] } };
export type EstimateState = { answer: EstimateAnswer | null; loading: boolean; error: string | null; updated_ms: number };

/** The estimate of the form's settings, read again 400 ms after they stop changing. Nothing is generated or billed by it. */
export function useEstimate(params: pv.VideoParams, enabled: boolean): EstimateState {
  const { connection } = useHost();
  const [state, setState] = useState<EstimateState>({ answer: null, loading: false, error: null, updated_ms: 0 });
  // The words of the prompt and of the script do not change the estimate (the script's length is the duration, which the
  // form already follows). The second caption language (a translation is paid work) and the writing model do: the
  // amount shown is the amount the start will ask for.
  const key = JSON.stringify({ ...params, prompt: "", script: "", budgetUsd: null });
  useEffect(() => {
    if (!connection || !enabled) return;
    let alive = true;
    setState((before) => ({ ...before, loading: true }));
    const timer = setTimeout(() => {
      const { script: _script, secondCaptionLanguage, budgetUsd: _budget, ...settings } = params;
      void connection.call<EstimateAnswer>("jagentchill.workflow.video.estimate", { params: { ...settings, prompt: "x", model: settings.model ?? null, ...(secondCaptionLanguage ? { secondCaptionLanguage } : {}) } })
        .then((answer) => { if (alive) setState({ answer, loading: false, error: null, updated_ms: Date.now() }); }, (error) => { if (alive) setState((before) => ({ ...before, loading: false, error: failureOf(error).message })); });
    }, 400);
    return () => { alive = false; clearTimeout(timer); };
  }, [connection, enabled, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}

export function useStart() {
  const { connection } = useHost();
  /** `confirmedUsd`: the amount the person was shown and confirmed for the whole run (the host refuses a start whose estimate is above it). */
  return useMemo(() => async (params: pv.VideoParams, confirmedUsd?: number, /** The models of unknown price the person was shown by name on that question: their start is the leave to use them. */ allowUnpriced?: readonly string[]): Promise<WorkflowRunRecord> => {
    if (!connection) throw { code: "UNAVAILABLE" };
    return (await connection.call<{ run: WorkflowRunRecord }>("jagentchill.workflow.video.start", { params, ...(confirmedUsd !== undefined ? { confirmedUsd } : {}), ...(allowUnpriced?.length ? { allowUnpriced } : {}) })).run;
  }, [connection]);
}

export type Stage = {
  id: pv.StageId; label: string; status: WorkflowNodeStatus; exec?: WorkflowExecution;
  /** The checkpoint of the stage, while it exists in the run. */
  check?: WorkflowExecution;
  /** The stage's result as it stands: what a person approved or edited, else what the step produced. */
  value: unknown; costUsd: number;
};
/** The executions of a run by step, read again at every change of the run. */
export function useStages(run: RunData): { stages: Stage[]; byNode: Record<string, WorkflowExecution>; loaded: boolean } {
  const [byNode, setByNode] = useState<Record<string, WorkflowExecution>>({});
  const [loaded, setLoaded] = useState(false);
  const latest = useRef(0);
  useEffect(() => {
    if (!run.snapshot) return;
    const mine = ++latest.current;
    void run.executions().then((list) => { if (mine === latest.current) { setByNode(Object.fromEntries(list.filter((exec) => exec.path === "").map((exec) => [exec.nodeId, exec]))); setLoaded(true); } }, () => undefined);
  }, [run.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const stages = useMemo(() => pv.STAGES.map((stage): Stage => {
    if (stage.id === "assets") return picturesStage(byNode);
    const exec = byNode[stage.id], check = stage.check ? byNode[stage.check] : undefined;
    const produced = exec?.outputs?.[stage.output];
    const decided = check?.status === "succeeded" ? check.outputs?.subject : check?.status === "waiting_approval" ? (check.request as { subject?: unknown } | undefined)?.subject : undefined;
    return {
      id: stage.id, label: stage.label, exec, ...(check ? { check } : {}), value: stage.id === "review_checks" ? produced : decided ?? produced, costUsd: Number(exec?.outputs?.costUsd ?? 0),
      // A step the run holds for money (the confirmed-estimate guard paused the run) needs the person, like a checkpoint.
      status: (check?.status === "waiting_approval" && exec?.status === "succeeded") || heldForBudget(exec) ? "waiting_approval" : exec?.status ?? "pending",
    };
  }), [byNode]);
  return { stages, byNode, loaded };
}

/**
 * The Pictures stage is several steps of the run (the first drawing, the rounds that ask a person and draw again, the
 * step that hands the pictures on): one row on screen, with the status of whichever of them is deciding it now.
 */
/** The step a paused run holds until a person confirms the new estimate (`blockedBy: "budget_exceeded"`). */
export const heldForBudget = (exec: WorkflowExecution | undefined): boolean => exec?.status === "ready" && exec.blockedBy === "budget_exceeded";

function picturesStage(byNode: Record<string, WorkflowExecution>): Stage {
  const parts = pv.PICTURE_STEPS.map((id) => byNode[id]).filter((exec): exec is WorkflowExecution => !!exec), ask = pv.PICTURE_ASKS.map((id) => byNode[id]).find((exec) => exec?.status === "waiting_approval");
  const ran = parts.filter((exec) => exec.status !== "pending" && exec.status !== "skipped"), last = ran[ran.length - 1], kept = byNode.pictures;
  const failed = parts.find((exec) => exec.status === "failed"), running = parts.find((exec) => exec.status === "running" || exec.status === "ready"), held = parts.find(heldForBudget);
  const status: WorkflowNodeStatus = ask || held ? "waiting_approval" : failed ? "failed" : running ? "running" : kept?.status === "succeeded" ? "succeeded" : last ? (last.status === "succeeded" ? "running" : last.status) : "pending";
  // The pictures as they stand: what was handed on, else what the last drawing made.
  const drawn = [...ran].reverse().find((exec) => Array.isArray(exec.outputs?.shotMedia));
  return {
    id: "assets", label: "Pictures", exec: held ?? failed ?? running ?? last, ...(ask ? { check: ask } : {}), status,
    value: kept?.status === "succeeded" ? kept.outputs?.shotMedia : drawn?.outputs?.shotMedia, costUsd: Math.max(0, ...parts.map((exec) => Number(exec.outputs?.costUsd ?? 0))),
  };
}

export type ShotDecision = "delete" | "restore" | "replace";
export type Spend = { spentUsd: number; budgetUsd: number | null; remainingUsd: number | null; confirmedUsd?: number | null };
/** What the run has spent and what its budget leaves, read again at every change of the run. */
export function useSpend(run: RunData, runId: string): { spend: Spend | null; setBudget(budgetUsd: number): Promise<{ ok: true } | { ok: false; message: string }> } {
  const { connection } = useHost();
  const [spend, setSpend] = useState<Spend | null>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!connection || !run.snapshot) return;
    let alive = true;
    void connection.call<Spend>("jagentchill.workflow.video.spend", { runId }).then((found) => { if (alive) setSpend(found); }, () => undefined);
    return () => { alive = false; };
  }, [connection, runId, run.version, nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  const setBudget = useMemo(() => async (budgetUsd: number) => {
    if (!connection) return { ok: false as const, message: "Not connected" };
    try { await connection.call("jagentchill.workflow.video.budget", { runId, budgetUsd }); setNonce((n) => n + 1); return { ok: true as const }; } catch (error) { return { ok: false as const, message: failureOf(error).message }; }
  }, [connection, runId]);
  return { spend, setBudget };
}

/** The estimate of what the run costs in all, with the real counts of its shot list once that exists. */
export function useRunEstimate(params: pv.VideoParams | undefined, counts: { shots: number; spoken: number } | null): pv.RunEstimate | null {
  const { connection } = useHost();
  const [estimate, setEstimate] = useState<pv.RunEstimate | null>(null);
  const key = params ? JSON.stringify([params.targetDuration_s, params.aspectRatio, params.voice, params.musicMood, counts]) : "";
  useEffect(() => {
    if (!connection || !params) return;
    let alive = true;
    const { model: _model, script: _script, secondCaptionLanguage: _second, budgetUsd: _budget, ...rest } = params;
    void connection.call<EstimateAnswer>("jagentchill.workflow.video.estimate", { params: { ...rest, prompt: "x", model: null }, ...(counts ? { counts } : {}) }).then((answer) => { if (alive) setEstimate(answer.estimate); }, () => undefined);
    return () => { alive = false; };
  }, [connection, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return estimate;
}

/**
 * The pictures of a run as its working film holds them now, and a person's decisions about one shot. While the run asks
 * a person about its pictures the steps' own outputs are older than what the person has just decided: this is live.
 */
export function useShots(run: RunData, runId: string, enabled: boolean) {
  const { connection, host } = useHost();
  const [media, setMedia] = useState<pv.ShotMedia[] | null>(null);
  useEffect(() => {
    if (!connection || !enabled) return;
    let alive = true;
    void connection.call<{ shotMedia: pv.ShotMedia[] }>("jagentchill.workflow.video.shots", { runId }).then((found) => { if (alive) setMedia(found.shotMedia.length ? found.shotMedia : null); }, () => undefined);
    return () => { alive = false; };
  }, [connection, runId, run.version, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  const decide = useMemo(() => async (shotId: string, action: ShotDecision, file?: { blobId: string; name: string; width?: number; height?: number }): Promise<{ ok: true } | { ok: false; message: string }> => {
    if (!connection) return { ok: false, message: "Not connected" };
    try {
      const answer = await connection.call<{ shotMedia: pv.ShotMedia[] }>("jagentchill.workflow.video.shot", { runId, shotId, action, ...(file ?? {}) });
      setMedia(answer.shotMedia);
      return { ok: true };
    } catch (error) { return { ok: false, message: failureOf(error).message }; }
  }, [connection, runId]);
  /** Sends a person's own picture to the host's blob store and answers what the shot needs to use it. */
  const upload = useMemo(() => async (file: Blob & { name?: string }): Promise<{ blobId: string; name: string; width?: number; height?: number }> => {
    if (!host) throw { code: "UNAVAILABLE" };
    const bytes = new Uint8Array(await file.arrayBuffer()), blobId = await sha256Hex(bytes), signer = await loadSigner();
    await uploadBlob({ host, signer }, { sha256: blobId, size: bytes.length, mime: file.type || "image/png", name: file.name ?? "picture", purpose: "media", read: async (start, end) => bytes.subarray(start, end) });
    return { blobId, name: (file.name ?? "picture").slice(0, 200), ...(await imageSize(file)) };
  }, [host]);
  return { media, decide, upload };
}

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function base64(bytes: Uint8Array): string {
  let out = "";
  for (let at = 0; at < bytes.length; at += 3) {
    const a = bytes[at], b = bytes[at + 1], c = bytes[at + 2];
    out += BASE64[a >> 2] + BASE64[((a & 3) << 4) | ((b ?? 0) >> 4)] + (b === undefined ? "=" : BASE64[((b & 15) << 2) | ((c ?? 0) >> 6)]) + (c === undefined ? "=" : BASE64[c & 63]);
  }
  return out;
}
const cache = new Map<string, Promise<string>>();
/** A picture of the host's blob store as something an image can show: fetched once, checked against its hash. */
export function useBlobUri(blobId: string | undefined, mime = "image/png"): string | null {
  const { host } = useHost();
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    setUri(null);
    if (!host || !blobId) return;
    let alive = true;
    let pending = cache.get(blobId);
    if (!pending) {
      pending = loadSigner().then((signer) => fetchVerified({ host, signer }, blobId)).then((bytes) => {
        const data = bytes as unknown as Uint8Array;
        return typeof URL !== "undefined" && typeof URL.createObjectURL === "function" && typeof Blob !== "undefined" ? URL.createObjectURL(new Blob([data as unknown as BlobPart], { type: mime })) : `data:${mime};base64,${base64(data)}`;
      });
      cache.set(blobId, pending);
      pending.catch(() => cache.delete(blobId));
    }
    pending.then((found) => { if (alive) setUri(found); }, () => undefined);
    return () => { alive = false; };
  }, [host, blobId, mime]);
  return uri;
}
