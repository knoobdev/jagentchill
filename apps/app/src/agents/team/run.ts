import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentCallPreset, AgentHandback, AgentHandoff, AgentTeamChangedEvent, ApprovalMode, ProposalReview, TeamRun, TeamRunView } from "@jagentchill/protocol";
import { useToast } from "@jagentchill/ui";
import { useHost } from "../../host";
import { reasonOf } from "../errors";

export type TeamRunsApi = {
  rootId: string | null; runs: TeamRun[]; /** The agent reviews of proposals of this session's agents, newest first. */ proposalReviews: ProposalReview[]; handoffs: AgentHandoff[]; handbacks: AgentHandback[]; loading: boolean;
  /** Starts a run of the session's team on a request; false when the host refused it (the reason was shown). */
  start(request: string): Promise<boolean>;
  cancel(runId: string): Promise<boolean>;
  /** Continues a run the host paused when it restarted. */
  resume(runId: string): Promise<boolean>;
  /** The person's decision on the result of a run. */
  signoff(runId: string, decision: "approve" | "request_changes" | "reject", note?: string): Promise<boolean>;
  /** The person's decision on a pending hand-off: accept for the receiver, reject, or cancel it. */
  resolveHandoff(handoffId: string, decision: "accept" | "reject" | "cancel", note?: string): Promise<boolean>;
  /** The person's decision on a hand-back: accept it, or return it with a note that says what is missing. */
  resolveHandback(handbackId: string, decision: "accept" | "return", note?: string): Promise<boolean>;
  /** A person decides a disagreement the lead gave to them: with the lead, with the peer, or another direction. */
  resolveEscalation(runId: string, dissentId: string, decision: "lead" | "peer" | "other", direction?: string): Promise<boolean>;
  /** Takes the conversation back from the agent that leads it. */
  returnConversation(): Promise<boolean>;
  detach(agentId: string): Promise<boolean>;
};

/**
 * The team runs and the hand-offs of one session's agent tree, kept in step with the host: read once, and read again
 * whenever the host says something of the tree changed (`jagentchill.agent.team.changed`).
 */
export function useTeamRuns(sessionKey: string | undefined): TeamRunsApi {
  const { connection, onEvent, status } = useHost();
  const toast = useToast();
  const [state, setState] = useState<{ rootId: string | null; runs: TeamRun[]; proposalReviews: ProposalReview[]; handoffs: AgentHandoff[]; handbacks: AgentHandback[] }>({ rootId: null, runs: [], proposalReviews: [], handoffs: [], handbacks: [] });
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const rootId = useRef<string | null>(null);
  rootId.current = state.rootId;
  useEffect(() => {
    if (!connection || status !== "connected" || !sessionKey) { setLoading(false); return; }
    let cancelled = false;
    void Promise.all([connection.call<TeamRunView>("jagentchill.orc.run.get", { sessionKey }), connection.call<{ handoffs: AgentHandoff[] }>("jagentchill.agent.handoff.list", { sessionKey }), connection.call<{ handbacks: AgentHandback[] }>("jagentchill.agent.handback.list", { sessionKey })])
      .then(([view, listed, returned]) => { if (!cancelled) setState({ rootId: view.rootId, runs: view.runs, proposalReviews: view.proposalReviews ?? [], handoffs: listed.handoffs, handbacks: returned.handbacks }); })
      .catch(() => undefined).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [connection, status, sessionKey, nonce]);
  useEffect(() => { setState({ rootId: null, runs: [], proposalReviews: [], handoffs: [], handbacks: [] }); setLoading(true); }, [sessionKey]);
  useEffect(() => onEvent((event) => {
    if (event.event === "jagentchill.agent.team.changed" && (event.payload as AgentTeamChangedEvent).rootId === rootId.current) setNonce((value) => value + 1);
  }), [onEvent]);
  const act = useCallback(async (method: string, params: Record<string, unknown>): Promise<boolean> => {
    if (!connection) return false;
    try { await connection.call(method, params); setNonce((value) => value + 1); return true; }
    catch (failure) { toast.show({ kind: "error", message: reasonOf(failure) }); return false; }
  }, [connection, toast]);
  return {
    ...state, loading,
    start: (request) => act("jagentchill.orc.run.start", { sessionKey, request }),
    cancel: (runId) => act("jagentchill.orc.run.cancel", { runId }),
    resume: (runId) => act("jagentchill.orc.run.resume", { runId }),
    resolveEscalation: (runId, dissentId, decision, direction) => act("jagentchill.orc.run.resolveEscalation", { runId, dissentId, decision, ...(direction ? { direction } : {}) }),
    signoff: (runId, decision, note) => act("jagentchill.orc.signoff.resolve", { runId, decision, ...(note ? { note } : {}) }),
    resolveHandoff: (handoffId, decision, note) => act("jagentchill.agent.handoff.resolve", { handoffId, decision, ...(note ? { note } : {}) }),
    resolveHandback: (handbackId, decision, note) => act("jagentchill.agent.handback.resolve", { handbackId, decision, ...(note ? { note } : {}) }),
    returnConversation: () => act("jagentchill.agent.conversation.return", { sessionKey }),
    detach: (agentId) => act("jagentchill.agent.detach", { agentId }),
  };
}

/** The host's approval settings and who agents can call, for Settings → Teams. */
export function useAgentPolicies(): { approval: { default: ApprovalMode; minimum: ApprovalMode } | null; preset: AgentCallPreset | null; setApproval(patch: { default?: ApprovalMode; minimum?: ApprovalMode }): Promise<void>; setPreset(preset: AgentCallPreset): Promise<void> } {
  const { connection, status } = useHost();
  const toast = useToast();
  const [approval, setApproval] = useState<{ default: ApprovalMode; minimum: ApprovalMode } | null>(null);
  const [preset, setPreset] = useState<AgentCallPreset | null>(null);
  useEffect(() => {
    if (!connection || status !== "connected") return;
    let cancelled = false;
    void connection.call<{ default: ApprovalMode; minimum: ApprovalMode }>("jagentchill.orc.approval.get", {}).then((got) => { if (!cancelled) setApproval(got); }).catch(() => undefined);
    void connection.call<{ preset: AgentCallPreset }>("jagentchill.agent.policy.get", {}).then((got) => { if (!cancelled) setPreset(got.preset); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [connection, status]);
  return {
    approval, preset,
    async setApproval(patch) {
      if (!connection) return;
      try { setApproval(await connection.call("jagentchill.orc.approval.set", patch)); } catch (failure) { toast.show({ kind: "error", message: reasonOf(failure) }); }
    },
    async setPreset(next) {
      if (!connection) return;
      try { setPreset((await connection.call<{ preset: AgentCallPreset }>("jagentchill.agent.policy.set", { preset: next })).preset); } catch (failure) { toast.show({ kind: "error", message: reasonOf(failure) }); }
    },
  };
}
