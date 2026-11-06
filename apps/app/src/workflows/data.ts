import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { HostConnection, HostEvent } from "@jagentchill/client";
import { workflow as wf } from "@jagentchill/editor-core";
import type {
  AutomationDraft, AutomationRecord, AutomationRun, AutomationSchedule, WorkflowDocument, WorkflowEdgeState, WorkflowExecution, WorkflowListItem, WorkflowLogEntry, WorkflowNodeAggregate, WorkflowNodeType, WorkflowOp,
  WorkflowProblem, WorkflowRunRecord, WorkflowTimelineEntry,
} from "@jagentchill/protocol";
import { useHost } from "../host";
import { messageFor } from "../messages";

export type Validation = { valid: boolean; errors: WorkflowProblem[]; warnings: WorkflowProblem[] };
/** What a run can cost at most, and whether a person is asked before it starts (`jagentchill.workflow.run.estimate`). */
export type RunMoneyAnswer = {
  estimate: { canSpend: boolean; steps: Array<{ nodeId: string; name: string; model: string; calls: number; unitUsd: number | null; highUsd: number | null; /** The amount is worked out from the model's measured prompt size on this host (ruling R10): it is said with "about". */ measured?: true; /** Counted for ONE item of a list whose length is not known before the run (the fan-out step it belongs to). */ perItem?: { nodeId: string; name: string } }>; highUsd: number; /** What each item of such a list adds at most (0: there is none). */ perItemUsd?: number; unpricedModels: string[]; assumptions: string[]; /** Steps on the person's own signed-in account (Claude Code, Codex): not billed by this app, no part of the question. */ ownAccount?: Array<{ label: string; model: string; account?: string }> };
  confirmation: { needed: boolean; amountUsd: number; stopsAtUsd: number; perItemUsd?: number; unpricedModels: string[] };
};
export type RunMoneyGiven = { confirmedUsd: number; confirmedPerItemUsd?: number; allowUnpriced?: string[] };
export type Failure = { code: string; message: string; details: Record<string, unknown> };
/** A refusal of the host or of the local model, as the sentence it carries. Workflow refusals are worded for the person. */
export function failureOf(error: unknown): Failure {
  const record = (error ?? {}) as { code?: string; message?: string; details?: Record<string, unknown> };
  const code = record.code ?? "";
  const worded = /^(WORKFLOW_|QUOTA_EXCEEDED$|CONFLICT$|NOT_FOUND$|NO_ROUTE$|UNAVAILABLE$|VALIDATION_FAILED$)/.test(code) && record.message;
  return { code, message: worded ? record.message! : code === "INVALID_PARAMS" && record.message ? record.message : messageFor(error), details: record.details ?? {} };
}

// ── The index of workflows, runs and automations: one copy per connection ────────────────────────────────────────────

export type WorkflowIndex = {
  /** `null` until the host answered. */
  workflows: WorkflowListItem[] | null; runs: WorkflowRunRecord[] | null; automations: AutomationRecord[] | null; automationRuns: AutomationRun[] | null;
  /** Runs waiting for a person. */
  attention: number; offered: WorkflowNodeType[]; error: unknown;
};
const EMPTY: WorkflowIndex = { workflows: null, runs: null, automations: null, automationRuns: null, attention: 0, offered: [], error: null };
type Store = { data: WorkflowIndex; listeners: Set<() => void>; reload(): void };
const stores = new WeakMap<HostConnection, Store>();
function storeOf(connection: HostConnection): Store {
  const existing = stores.get(connection);
  if (existing) return existing;
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const store: Store = { data: EMPTY, listeners, reload: () => { if (timer) clearTimeout(timer); timer = setTimeout(() => void load(), 120); } };
  const set = (patch: Partial<WorkflowIndex>) => { store.data = { ...store.data, ...patch }; for (const listener of listeners) listener(); };
  async function load(): Promise<void> {
    try {
      const [list, runs, automations, automationRuns] = await Promise.all([
        connection.call<{ workflows: WorkflowListItem[]; attention: number; offered: WorkflowNodeType[] }>("jagentchill.workflow.list", {}),
        connection.call<{ runs: WorkflowRunRecord[] }>("jagentchill.workflow.run.list", { limit: 200 }),
        connection.call<{ automations: AutomationRecord[] }>("jagentchill.automation.list", {}),
        connection.call<{ runs: AutomationRun[] }>("jagentchill.automation.run.list", { limit: 200 }),
      ]);
      set({ workflows: list.workflows, attention: list.attention, offered: list.offered, runs: runs.runs, automations: automations.automations, automationRuns: automationRuns.runs, error: null });
    } catch (error) { set({ error }); }
  }
  // The streams stay open for the life of the connection: the sidebar and the screens read the same copy.
  void connection.call("jagentchill.workflow.subscribe", { stream: "index" }).catch(() => undefined);
  void connection.call("jagentchill.automation.subscribe", {}).catch(() => undefined);
  connection.on((event) => { if (/^jagentchill\.(workflow\.(changed|run\.changed)|automation\.changed)$/.test(event.event)) store.reload(); });
  void load();
  stores.set(connection, store);
  return store;
}
const noSubscribe = () => () => undefined;
/** The workflows, runs and automations of the connected host, kept current by its streams. */
export function useWorkflowIndex(): WorkflowIndex & { reload(): void } {
  const { connection } = useHost();
  const store = connection ? storeOf(connection) : undefined;
  const data = useSyncExternalStore(store ? (listener) => { store.listeners.add(listener); return () => void store.listeners.delete(listener); } : noSubscribe, () => store?.data ?? EMPTY, () => EMPTY);
  return useMemo(() => ({ ...data, reload: () => store?.reload() }), [data, store]);
}

// ── One workflow document, edited by batches of graph operations ────────────────────────────────────────────────────

export type TriggerRecord = AutomationRecord | null;
export type ApplyResult = { ok: true } | ({ ok: false } & Failure);
export type WorkflowDoc = {
  doc: WorkflowDocument | null; validation: Validation | null; trigger: TriggerRecord; error: unknown; canUndo: boolean; canRedo: boolean;
  /** One gesture: applied here at once and sent to the host as one batch. A refusal leaves the document as it was. */
  apply(ops: WorkflowOp[], label: string): ApplyResult;
  undo(): ApplyResult | null; redo(): ApplyResult | null;
  setTrigger(input: { schedule: AutomationSchedule | null; enabled: boolean }): Promise<void>;
  reload(): void;
  /** Called with the failure of a batch the host refused after it was shown. */
  onRefused: { current: ((failure: Failure) => void) | null };
};
/**
 * The head of a workflow on this device. Edits are applied to the local copy by the same pure functions the host runs
 * and are sent in order; batches of other actors arrive on the document stream and are folded in. Undo is this
 * device's: inverse batches against the head, 100 steps.
 */
export function useWorkflowDoc(workflowId: string): WorkflowDoc {
  const { connection } = useHost();
  const [state, setState] = useState<{ doc: WorkflowDocument | null; validation: Validation | null; trigger: TriggerRecord; error: unknown }>({ doc: null, validation: null, trigger: null, error: null });
  const [, bump] = useState(0);
  const live = useRef({ doc: null as WorkflowDocument | null, confirmed: 0, seen: 0, pending: 0, chain: Promise.resolve() });
  const stack = useRef(new wf.UndoStack());
  const onRefused = useRef<((failure: Failure) => void) | null>(null);

  const load = useCallback(async () => {
    if (!connection) return;
    try {
      const got = await connection.call<{ document: WorkflowDocument; validation: Validation; trigger: TriggerRecord }>("jagentchill.workflow.get", { workflowId });
      live.current.doc = got.document;
      live.current.confirmed = live.current.seen = got.document.revision;
      setState({ doc: got.document, validation: got.validation, trigger: got.trigger, error: null });
    } catch (error) { setState((before) => ({ ...before, error })); }
  }, [connection, workflowId]);

  useEffect(() => {
    if (!connection) return;
    stack.current = new wf.UndoStack();
    void connection.call("jagentchill.workflow.subscribe", { stream: "doc", id: workflowId }).catch(() => undefined);
    void load();
    const off = connection.on((event: HostEvent) => {
      if (event.event !== "jagentchill.workflow.ops" || event.payload?.workflowId !== workflowId) return;
      const batch = event.payload as { revision: number; ops: Array<WorkflowOp & { index?: number }> };
      const now = live.current;
      now.seen = Math.max(now.seen, batch.revision);
      // While batches of this device are on their way the head is settled when they return.
      if (now.pending > 0 || batch.revision <= now.confirmed || !now.doc) return;
      if (batch.revision !== now.confirmed + 1) return void load();
      try {
        const next = { ...wf.applyBatch(now.doc, batch.ops.map(({ index: _index, ...op }) => op as WorkflowOp)).doc, revision: batch.revision };
        now.doc = next;
        now.confirmed = batch.revision;
        setState((before) => ({ ...before, doc: next }));
        void connection.call<Validation>("jagentchill.workflow.validate", { workflowId }).then((validation) => setState((before) => ({ ...before, validation }))).catch(() => undefined);
      } catch { void load(); }
    });
    return () => { off(); void connection.call("jagentchill.workflow.unsubscribe", { stream: "doc", id: workflowId }).catch(() => undefined); };
  }, [connection, workflowId, load]);

  const send = useCallback((ops: WorkflowOp[], label: string, after?: (ok: boolean) => void): ApplyResult & { inverse?: WorkflowOp[] } => {
    const now = live.current;
    if (!connection || !now.doc) return { ok: false, code: "UNAVAILABLE", message: messageFor({ code: "UNAVAILABLE" }), details: {} };
    let result: wf.BatchResult;
    try { result = wf.applyBatch(now.doc, ops); } catch (error) { return { ok: false, ...failureOf(error) }; }
    now.doc = { ...result.doc, revision: now.doc.revision };
    now.pending += 1;
    setState((before) => ({ ...before, doc: now.doc }));
    now.chain = now.chain.then(async () => {
      try {
        const applied = await connection.call<{ revision: number; rebased: boolean; validation: Validation }>("jagentchill.workflow.apply", { workflowId, baseRevision: now.confirmed, ops, label });
        const clean = !applied.rebased && applied.revision === now.confirmed + 1;
        now.confirmed = applied.revision;
        now.seen = Math.max(now.seen, applied.revision);
        now.pending -= 1;
        if (now.doc) now.doc = { ...now.doc, revision: applied.revision };
        setState((before) => ({ ...before, doc: now.doc, validation: applied.validation }));
        after?.(true);
        // Another actor's batch landed between ours: the head is read again once nothing of ours is on its way.
        if ((!clean || now.seen > now.confirmed) && now.pending === 0) await load();
      } catch (error) {
        now.pending -= 1;
        after?.(false);
        onRefused.current?.(failureOf(error));
        if (now.pending === 0) await load();
      }
    });
    return { ok: true, inverse: result.inverse };
  }, [connection, workflowId, load]);

  const apply = useCallback((ops: WorkflowOp[], label: string): ApplyResult => {
    if (!ops.length) return { ok: true };
    const sent = send(ops, label);
    if (sent.ok && sent.inverse) { stack.current.push({ label, inverse: sent.inverse, forward: ops }); bump((count) => count + 1); }
    return sent.ok ? { ok: true } : sent;
  }, [send]);
  const step = useCallback((direction: "undo" | "redo"): ApplyResult | null => {
    const entry = direction === "undo" ? stack.current.takeUndo() : stack.current.takeRedo();
    if (!entry) return null;
    const sent = send(direction === "undo" ? entry.inverse : entry.forward, direction === "undo" ? `Undo ${entry.label}` : `Redo ${entry.label}`);
    bump((count) => count + 1);
    // An inverse that no longer applies leaves the stack: the step is gone.
    if (!sent.ok) return { ...sent, code: "WORKFLOW_UNDO_CONFLICT" };
    if (direction === "undo") stack.current.undoApplied(entry, sent.inverse ?? []); else stack.current.redoApplied(entry, sent.inverse ?? []);
    return { ok: true };
  }, [send]);

  return useMemo(() => ({
    ...state, canUndo: stack.current.canUndo, canRedo: stack.current.canRedo, apply, undo: () => step("undo"), redo: () => step("redo"), reload: () => void load(), onRefused,
    async setTrigger(input) {
      if (!connection) return;
      const got = await connection.call<{ trigger: TriggerRecord; document: WorkflowDocument; validation: Validation }>("jagentchill.workflow.trigger.set", { workflowId, ...input });
      await live.current.chain;
      await load();
      setState((before) => ({ ...before, trigger: got.trigger }));
    },
  // `bump` re-renders after the stack changed; the stack itself is a ref.
  }), [state, apply, step, load, connection, workflowId, stack.current.canUndo, stack.current.canRedo]); // eslint-disable-line react-hooks/exhaustive-deps
}

// ── One run, live ────────────────────────────────────────────────────────────────────────────────────────────────────

export type RunSnapshot = { run: WorkflowRunRecord; document: WorkflowDocument; nodes: WorkflowNodeAggregate[]; edges: Record<string, WorkflowEdgeState>; waiting: WorkflowExecution[]; /** The steps a budget holds, with the refusal and its figures. */ held?: WorkflowExecution[]; /** The sessions of the steps at work, and of the steps that ended last. */ sessions?: Array<{ nodeId: string; path: string; sessionKey: string; active: boolean }>; workflowExists: boolean };
export type RunData = {
  snapshot: RunSnapshot | null; error: unknown;
  /** Grows with every change of the run: what reads logs, executions or the timeline reads again. */
  version: number; reload(): void;
  act(method: string, params?: Record<string, unknown>): Promise<ApplyResult>;
  logs(filter?: { nodeId?: string }): Promise<WorkflowLogEntry[]>; executions(nodeId?: string): Promise<WorkflowExecution[]>; timeline(): Promise<WorkflowTimelineEntry[]>;
};
/** A run followed on its stream: every change of the host is read within the same moment it is announced. */
export function useRun(runId: string | null): RunData {
  const { connection } = useHost();
  const [snapshot, setSnapshot] = useState<RunSnapshot | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [version, setVersion] = useState(0);
  const load = useCallback(async () => {
    if (!connection || !runId) return;
    try { setSnapshot(await connection.call<RunSnapshot>("jagentchill.workflow.run.get", { runId })); setError(null); setVersion((count) => count + 1); } catch (failure) { setError(failure); }
  }, [connection, runId]);
  useEffect(() => {
    setSnapshot(null);
    setError(null);
    if (!connection || !runId) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void connection.call("jagentchill.workflow.subscribe", { stream: "run", id: runId }).catch(() => undefined);
    void load();
    const off = connection.on((event) => {
      if (event.event !== "jagentchill.workflow.updated" || event.payload?.runId !== runId) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void load(), 60);
    });
    return () => { off(); if (timer) clearTimeout(timer); void connection.call("jagentchill.workflow.unsubscribe", { stream: "run", id: runId }).catch(() => undefined); };
  }, [connection, runId, load]);
  return useMemo(() => ({
    snapshot, error, version, reload: () => void load(),
    async act(method, params = {}) {
      if (!connection || !runId) return { ok: false, code: "UNAVAILABLE", message: messageFor({ code: "UNAVAILABLE" }), details: {} };
      try { await connection.call(method, { runId, ...params }); await load(); return { ok: true }; } catch (failure) { return { ok: false, ...failureOf(failure) }; }
    },
    logs: async (filter = {}) => (connection && runId ? (await connection.call<{ entries: WorkflowLogEntry[] }>("jagentchill.workflow.node.logs", { runId, ...filter })).entries : []),
    executions: async (nodeId) => (connection && runId ? (await connection.call<{ executions: WorkflowExecution[] }>("jagentchill.workflow.run.executions", { runId, ...(nodeId ? { nodeId } : {}), limit: 500 })).executions : []),
    timeline: async () => (connection && runId ? (await connection.call<{ entries: WorkflowTimelineEntry[] }>("jagentchill.workflow.run.timeline", { runId, limit: 2000 })).entries : []),
  }), [snapshot, error, version, load, connection, runId]);
}

// ── Calls of the list screens ────────────────────────────────────────────────────────────────────────────────────────

export type WorkflowCalls = ReturnType<typeof useWorkflowCalls>;
/** The calls a list or a header makes; each returns the host's answer or throws its refusal. */
export function useWorkflowCalls() {
  const { connection } = useHost();
  return useMemo(() => {
    const call = <T,>(method: string, params: unknown = {}): Promise<T> => (connection ? connection.call<T>(method, params) : Promise.reject({ code: "UNAVAILABLE" }));
    return {
      create: (name?: string) => call<{ document: WorkflowDocument }>("jagentchill.workflow.create", name ? { name } : {}),
      duplicate: (workflowId: string) => call<{ document: WorkflowDocument }>("jagentchill.workflow.duplicate", { workflowId }),
      remove: (workflowId: string) => call("jagentchill.workflow.delete", { workflowId }),
      rename: (workflowId: string, name: string) => call("jagentchill.workflow.apply", { workflowId, ops: [{ op: "meta.update", patch: { name } }], label: "Rename" }),
      exportFile: (workflowId: string) => call<{ fileName: string; mimeType: string; text: string }>("jagentchill.workflow.export", { workflowId }),
      importFile: (text: string) => call<{ document: WorkflowDocument }>("jagentchill.workflow.import", { text }),
      get: (workflowId: string) => call<{ document: WorkflowDocument; validation: Validation; trigger: TriggerRecord }>("jagentchill.workflow.get", { workflowId }),
      history: (workflowId: string) => call<{ revisions: Array<{ revision: number; label: string; created_ms: number; actor: { kind: string } }> }>("jagentchill.workflow.history", { workflowId }),
      restore: (workflowId: string, revision: number) => call("jagentchill.workflow.restore", { workflowId, revision }),
      // `money`: the person's answer to the run's one money question (the amount shown, the models of unknown price named).
      run: (workflowId: string, params: Record<string, unknown>, money?: RunMoneyGiven) => call<{ run: WorkflowRunRecord }>("jagentchill.workflow.run.create", { workflowId, params, ...money }),
      estimate: (workflowId: string, params: Record<string, unknown>) => call<RunMoneyAnswer>("jagentchill.workflow.run.estimate", { workflowId, params }),
      removeRun: (runId: string) => call("jagentchill.workflow.run.delete", { runId }),
      automation: (automationId: string) => call<{ automation: AutomationRecord }>("jagentchill.automation.get", { automationId }),
      createAutomation: (automation: AutomationDraft) => call<{ automation: AutomationRecord }>("jagentchill.automation.create", { automation }),
      updateAutomation: (automationId: string, automation: AutomationDraft, expectedRevision: number) => call<{ automation: AutomationRecord }>("jagentchill.automation.update", { automationId, automation, expectedRevision }),
      removeAutomation: (automationId: string, cancelRuns: boolean) => call("jagentchill.automation.delete", { automationId, cancelRuns }),
      duplicateAutomation: (automationId: string) => call<{ automation: AutomationRecord }>("jagentchill.automation.duplicate", { automationId }),
      enableAutomation: (automationId: string, enabled: boolean, cancelRuns = false) => call<{ automation: AutomationRecord }>("jagentchill.automation.setEnabled", { automationId, enabled, cancelRuns }),
      runAutomation: (automationId: string) => call<{ run: AutomationRun }>("jagentchill.automation.run", { automationId }),
      automationRuns: (automationId: string) => call<{ runs: AutomationRun[] }>("jagentchill.automation.run.list", { automationId, limit: 200 }),
      cancelAutomationRun: (runId: string) => call("jagentchill.automation.run.cancel", { runId }),
    };
  }, [connection]);
}
