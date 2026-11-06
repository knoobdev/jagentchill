import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { film as fm } from "@jagentchill/editor-core";
import type { WorkflowRunRecord } from "@jagentchill/protocol";
import type { CostAnswer, CostAsk, NameOf } from "../generation/cost";
import { useModelNames } from "../generation/data";
import { uploadBlob } from "@jagentchill/client";
import { sha256Hex } from "../editor/dom";
import { useHost } from "../host";
import { loadSigner } from "../identity";
import { useT, type T } from "../locale";
import { failureOf } from "../workflows/data";
import { activityQuestion, answerPending, filmModelName, routeMissing, sendPaid, writingRouted, type Outcome, type Pending } from "./paid";

/** What is being made for a film right now, and what failed last, by target (`panel:<id>`, `character:<id>`, `line:<id>`, `music`, `story`, `breakdown`). */
export type FilmActivity = Record<string, { state: "running" | "failed"; code?: string; message?: string; /** A failure that is a money question carries it here (`reason "confirmation_required"`, the estimate, `confirmWith`). */ details?: Record<string, unknown> }>;
export type FilmSummary = {
  id: string; title: string; revision: number; updated_ms: number; opened_ms: number; created_ms: number; stale: fm.StageId[]; panels: number; panelsWithImage: number; lines: number; assets: number;
  duration_ticks: number; assembled: boolean; cover: string | null; pipeline: WorkflowRunRecord["status"] | null; busy: boolean;
};
export type FilmAnswer = { film: fm.Film; activity: FilmActivity; pipeline: WorkflowRunRecord | null };
export type FilmEstimate = {
  rows: { id: "assets" | "panels" | "clips" | "voice" | "listening" | "music"; count: number; unitUsd: number | null; usd: number | null; model: string }[]; totalUsd: number; spentUsd: number;
  /** Who writes and who looks, as Model routing resolves each role now: the model, none (the role has no profile), or why it cannot serve. Absent from an older host. */
  writing?: { role: "screenwriter" | "storyboard" | "vision"; model: { runtimeId: string; providerId: string; modelId: string; label: string } | null; problem?: string; optionsNotApplied?: string[] }[];
  capabilities: { image: boolean; speech: boolean; music: boolean; /** Shots are set in motion on this host: the Video role of Model routing has a profile that can serve. Absent from an older host. */ video?: boolean };
  capabilityProblems?: Partial<Record<"image" | "video" | "tts" | "music" | "transcription", string>>;
  /** What the voice model in use takes beside the text, as the provider documents it: delivery instructions (an accent), a sample of a voice to speak in. Absent from an older host. */
  voice?: { instructions: boolean; clone: boolean; model: string };
  voices: { voiceId: string; name: string; gender?: "female" | "male" | "neutral" }[]; blocked?: { scope?: string; remainingUsd?: number };
};
export type { Outcome } from "./paid";
export type GenerateTarget =
  | { kind: "asset"; assetKind: fm.AssetKind; id: string } | { kind: "panel"; id: string } | { kind: "line"; id: string; keepCurrent?: boolean } | { kind: "music" }
  | { kind: "assets"; scope: "missing" | "all" } | { kind: "panels"; scope: "missing" | "all"; clipId?: string } | { kind: "lines"; scope: "missing" | "all"; keepCurrent?: boolean }
  /** Every line of ONE speaker (a character id, or the narrator), recorded again as one recording cut into its lines. */
  | { kind: "speaker"; speakerId: string }
  /** A shot's picture set in motion (one shot, or every shot that has a picture and no clip of it). */
  | { kind: "clip"; id: string } | { kind: "clips"; scope: "missing" | "all" };

/** Sends a person's own recording to the host's blob store (like any media of theirs) and answers what a character needs to speak in its voice. */
export function useSampleUpload(): (file: Blob & { name?: string }) => Promise<{ blobId: string; name: string; bytes: number; mime: string }> {
  const { host } = useHost();
  return useCallback(async (file) => {
    if (!host) throw { code: "UNAVAILABLE", message: "Not connected" };
    const bytes = new Uint8Array(await file.arrayBuffer()), blobId = await sha256Hex(bytes), signer = await loadSigner(), name = (file.name ?? "voice sample").slice(0, 200);
    await uploadBlob({ host, signer }, { sha256: blobId, size: bytes.length, mime: file.type || "audio/wav", name, purpose: "media", read: async (start, end) => bytes.subarray(start, end) });
    return { blobId, name, bytes: bytes.length, mime: file.type || "audio/wav" };
  }, [host]);
}

/** The films of the host, read again whenever one of them is created, renamed, opened or deleted. */
export function useFilms(enabled = true): { films: FilmSummary[] | null; error: string | null; reload(): void; create(input: { title?: string; sourceText?: string }): Promise<fm.Film>; remove(filmId: string): Promise<Outcome> } {
  const { connection } = useHost();
  const [films, setFilms] = useState<FilmSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    if (!connection || !enabled) return;
    void connection.call<{ films: FilmSummary[] }>("jagentchill.film.list", {}).then((got) => { setFilms(got.films); setError(null); }, (failure) => setError(failureOf(failure).message));
  }, [connection, enabled]);
  useEffect(() => {
    setFilms(null);
    if (!connection || !enabled) return;
    load();
    let timer: ReturnType<typeof setTimeout> | undefined, settled: ReturnType<typeof setTimeout> | undefined;
    const off = connection.on((event) => {
      // (A film's run that the host pauses, or that goes on again, changes no film: the run's own event tells of it.)
      if (event.event !== "jagentchill.film.index" && event.event !== "jagentchill.film.updated" && event.event !== "jagentchill.workflow.updated") return;
      if (timer) clearTimeout(timer);
      if (settled) clearTimeout(settled);
      timer = setTimeout(load, 300);
      // The run of a pipeline changes its status a moment after the last change of the film it made.
      settled = setTimeout(load, 2500);
    });
    return () => { off(); if (timer) clearTimeout(timer); if (settled) clearTimeout(settled); };
  }, [connection, enabled, load]);
  return useMemo(() => ({
    films, error, reload: load,
    async create(input) { if (!connection) throw { code: "UNAVAILABLE" }; return (await connection.call<FilmAnswer>("jagentchill.film.create", input)).film; },
    async remove(filmId) { try { await connection?.call("jagentchill.film.delete", { filmId }); load(); return { ok: true }; } catch (failure) { const known = failureOf(failure); return { ok: false, code: known.code, message: known.message }; } },
  }), [films, error, load, connection]);
}

export type FilmData = {
  film: fm.Film | null; activity: FilmActivity; pipeline: WorkflowRunRecord | null; error: { code: string; message: string } | null; reload(): void;
  /** A person's change of the film: the host applies it and announces the new film. */
  apply(ops: fm.FilmOp[]): Promise<Outcome>;
  /** Starts a generation; its progress and its failure arrive in `activity`. */
  generate(target: GenerateTarget): Promise<Outcome>;
  call<T = FilmAnswer>(method: string, params?: Record<string, unknown>): Promise<({ ok: true } & { value: T }) | { ok: false; code: string; message: string }>;
  /** "Make the film": starts the film's run (it continues at the first missing step). */
  makeFilm(params: { mode: "auto" | "checkpoints" }): Promise<Outcome>;
  /** What the last "Make the film" could not do without and this host does not have (pictures, voices, music): said beside the button until it is pressed again. */
  missing: string[] | null;
  /** The money question the host put before the action last started here (a generation, or the film's run); null when none waits. */
  cost: CostAsk | null;
  /** The person's answer: Start sends the same action again as confirmed; Cancel sends nothing. */
  answerCost(start: boolean, answer?: CostAnswer): Promise<Outcome>;
};
/** One film followed on the host: every change of a screen, a generation or a pipeline stage arrives with the film itself. */
export function useFilm(filmId: string | null, /** How the models a question names are called on screen. */ nameOf?: NameOf): FilmData {
  const { connection } = useHost();
  const [answer, setAnswer] = useState<FilmAnswer | null>(null);
  const [error, setError] = useState<FilmData["error"]>(null);
  const revision = useRef(0);
  const t = useT();
  // The action that waits for its cost to be confirmed: the question and the request it belongs to — data only, so
  // the answer goes out through the connection that is current when the person answers. The ref is what an answer
  // takes: two presses of Start take it once.
  const [asked, setAsked] = useState<Pending | null>(null);
  const waiting = useRef<Pending | null>(null), names = useRef(nameOf);
  names.current = nameOf;
  const hold = useCallback((next: Pending | null) => { waiting.current = next; setAsked(next); }, []);
  const [missing, setMissing] = useState<string[] | null>(null);
  useEffect(() => { hold(null); setMissing(null); }, [filmId, hold]);
  // Somebody else answered it (another device started this film's run): the question here is no longer open.
  const runId = answer?.film.pipelineRunId ?? null;
  useEffect(() => { if (waiting.current?.kind === "film") hold(null); }, [runId, hold]);
  // A step this device started may stop at a money question AFTER its request was accepted (a line recorded again
  // whose read-back passes what was confirmed): the host keeps the question on the failed step, and it is asked here.
  const last = useRef<{ kind: Pending["kind"]; params: Record<string, unknown> } | null>(null), seen = useRef(new Set<string>());
  useEffect(() => { last.current = null; seen.current = new Set(); }, [filmId]);
  const activity = answer?.activity;
  useEffect(() => {
    if (!activity || waiting.current) return;
    const found = activityQuestion(t, activity, last.current, seen.current, names.current);
    if (found) hold(found);
  }, [activity, t, hold]);
  const take = useCallback((next: FilmAnswer) => { revision.current = next.film.revision; setAnswer(next); setError(null); }, []);
  const load = useCallback(() => {
    if (!connection || !filmId) return;
    void connection.call<FilmAnswer>("jagentchill.film.open", { filmId }).then(take, (failure) => { const known = failureOf(failure); setError({ code: known.code, message: known.message }); });
  }, [connection, filmId, take]);
  useEffect(() => {
    setAnswer(null); setError(null); revision.current = 0;
    if (!connection || !filmId) return;
    load();
    const off = connection.on((event) => {
      if (event.payload?.filmId === filmId && event.event === "jagentchill.film.updated") {
        const payload = event.payload as { film: fm.Film; activity: FilmActivity };
        if (payload.film.revision < revision.current) return;
        revision.current = payload.film.revision;
        setAnswer((before) => ({ film: payload.film, activity: payload.activity, pipeline: before?.pipeline ?? null }));
      }
    });
    return () => off();
  }, [connection, filmId, load]);
  return useMemo(() => {
    const call: FilmData["call"] = async (method, params = {}) => {
      if (!connection || !filmId) return { ok: false, code: "UNAVAILABLE", message: failureOf({ code: "UNAVAILABLE" }).message };
      try {
        const value = await connection.call<any>(`jagentchill.film.${method}`, { filmId, ...params });
        if (value?.film) take({ film: value.film, activity: value.activity ?? {}, pipeline: value.pipeline ?? null });
        return { ok: true, value };
      } catch (failure) { const known = failureOf(failure); return { ok: false, code: known.code, message: known.message, details: known.details }; }
    };
    // Money is the person's decision: the host refuses a paid action until its estimate is confirmed. The question is
    // put to the person (FilmStudio shows it), not shown as an error; Start sends the same action again with the
    // answer the question named (`paid.ts`).
    const paid = async (kind: Pending["kind"], method: string, params: Record<string, unknown>): Promise<Outcome> => {
      const sent = await sendPaid(call, t, kind, method, params, undefined, names.current);
      if (sent.pending) hold(sent.pending);
      return sent.outcome;
    };
    const kindOf = (target: GenerateTarget) => (target.kind === "music" ? "music" as const : target.kind === "clip" || target.kind === "clips" ? "clips" as const : target.kind === "line" || target.kind === "lines" || target.kind === "speaker" ? "voice" as const : "pictures" as const);
    const generate: FilmData["generate"] = (target) => { activityQuestion(t, answer?.activity ?? {}, null, seen.current); last.current = { kind: kindOf(target), params: { target } }; return send(target); };
    const send = (target: GenerateTarget) => paid(kindOf(target), "generate", { target });
    return {
      film: answer?.film ?? null, activity: shownActivity(t, answer?.activity ?? {}), pipeline: answer?.pipeline ?? null, error, reload: load, call,
      apply: async (ops) => { const result = await call("apply", { ops }); return result.ok ? { ok: true } : result; },
      generate, missing,
      // No model goes with it: who writes is the roles of Model routing, resolved by the host.
      makeFilm: async (params) => {
        setMissing(null);
        const outcome = await paid("film", "pipeline.start", params), lacks = outcome.ok ? null : routeMissing(outcome);
        if (lacks) setMissing(lacks);
        return outcome;
      },
      cost: asked?.ask ?? null,
      answerCost: async (start, given) => {
        const pending = waiting.current;
        hold(null);
        if (!start || !pending) return { ok: true };
        // Sent through `call` of NOW: the connection that asked may have been replaced since.
        const sent = await answerPending(call, t, pending, given, names.current);
        if (sent.pending) hold(sent.pending);
        return sent.outcome;
      },
    };
  }, [answer, error, load, connection, filmId, take, asked, t, hold, missing]);
}

/**
 * A step's failures as the stages say them. A step that stopped at a money question (the cost dialog asks it) keeps a
 * sentence of the host's with raw figures ("…would pass the $0.000026 that was confirmed…"): a person who closed the
 * dialog reads instead what happened and what to do — starting the step again asks, with the new amount.
 */
function shownActivity(t: T, activity: FilmActivity): FilmActivity {
  if (!Object.values(activity).some((entry) => entry.state === "failed" && entry.details?.reason === "confirmation_required")) return activity;
  return Object.fromEntries(Object.entries(activity).map(([key, entry]) => [key, entry.state === "failed" && entry.details?.reason === "confirmation_required" ? { ...entry, message: t("Not made: it would cost more than you confirmed. Start it again to confirm the new amount.") } : entry]));
}

/** What the rest of the film costs at the host's prices, the capabilities it has and the voices it offers; read again when the film changes. */
export function useFilmEstimate(film: fm.Film | null): FilmEstimate | null {
  const { connection } = useHost();
  const [estimate, setEstimate] = useState<FilmEstimate | null>(null);
  const filmId = film?.id, revision = film?.revision;
  useEffect(() => {
    if (!connection || !filmId) return;
    let alive = true;
    const timer = setTimeout(() => void connection.call<FilmEstimate>("jagentchill.film.estimate", { filmId }).then((got) => { if (alive) setEstimate(got); }, () => undefined), 250);
    return () => { alive = false; clearTimeout(timer); };
  }, [connection, filmId, revision]);
  return estimate;
}

/**
 * How the models a film's money question names are called on screen. The host names them by id (`unpricedParts[].model`
 * is a model id, the over-estimate stop says `runtime:<provider>/<model>`): the name is the one Model routing resolved
 * for the film's writing roles, else the generation catalogue's, else the id without its prefixes.
 */
export function useFilmModelNames(estimate: FilmEstimate | null, /** Whether a model is set to write (`useWritingRouted`): when that changes, who the Director is is read again. */ writer?: boolean | null): (name: string) => string {
  const catalogue = useModelNames(), writing = estimate?.writing, director = useDirectorModel(writer);
  return useCallback((name: string) => filmModelName(name, writing ?? [], catalogue, director), [writing, catalogue, director]);
}

/**
 * The model Model routing gives the Director (its default profile), for the one place a film names it: the host says
 * "the Director" where no writing role has a model of its own. "" when routing is off, the role has no profile, or this
 * device may not read the routing.
 */
function useDirectorModel(again?: unknown): string {
  const { connection, onEvent } = useHost();
  const [model, setModel] = useState("");
  const load = useCallback(() => {
    if (!connection) return;
    void connection.call<{ config: { enabled: boolean; roles: Record<string, { enabled: boolean; defaultProfileId?: string; profiles: { id: string; model: string; enabled: boolean }[] } | undefined> } }>("jagentchill.orc.config.get", {})
      .then((got) => { const role = got.config.roles.director, usable = got.config.enabled && role?.enabled ? role.profiles.filter((profile) => profile.enabled) : []; setModel((usable.find((profile) => profile.id === role?.defaultProfileId) ?? usable[0])?.model ?? ""); }, () => setModel(""));
  }, [connection]);
  useEffect(load, [load, again]);
  useEffect(() => onEvent((event) => { if (event.event === "jagentchill.orc.config.changed") load(); }), [onEvent, load]);
  return model;
}

/**
 * Whether a model is set to write a film's script, as Model routing has it now (the Storyboard role, else the
 * Director): `false` → the screen says so and offers "Open Model routing"; `null` while it is not known. Read again
 * when the routing changes. The device sends no model of its own with the film.
 */
export function useWritingRouted(estimate: FilmEstimate | null): boolean | null {
  const { connection, onEvent } = useHost();
  const [director, setDirector] = useState<{ enabled: boolean; state: string } | null>(null);
  const load = useCallback(() => {
    if (!connection) return;
    void connection.call<{ enabled: boolean; roles: { roleId: string; state: string }[] }>("jagentchill.orc.readiness.check", { roles: ["director"] })
      .then((got) => setDirector({ enabled: got.enabled, state: got.roles.find((role) => role.roleId === "director")?.state ?? "not_configured" }), () => setDirector(null));
  }, [connection]);
  useEffect(load, [load]);
  useEffect(() => onEvent((event) => { if (event.event === "jagentchill.orc.config.changed" || event.event === "jagentchill.runtime.updated" || event.event === "jagentchill.provider.changed") load(); }), [onEvent, load]);
  const routed = writingRouted(estimate?.writing, director);
  // While the screen says nobody writes it keeps looking: the person may be giving the role its model in another tab
  // or on another device, and a model that was just added is ready a moment after the routing changed.
  useEffect(() => { if (routed !== false) return; const timer = setInterval(load, 4000); return () => clearInterval(timer); }, [routed, load]);
  return routed;
}
