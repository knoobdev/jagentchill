import { useCallback, useEffect, useRef, useState } from "react";
import { applyAgentEvent, type AgentTree } from "@jagentchill/app-core";
import type { AgentLimits, AgentRecord, AgentUpdatedEvent, Team, TeamSummary } from "@jagentchill/protocol";
import { useToast } from "@jagentchill/ui";
import { useHost } from "../../host";
import { reasonOf } from "../errors";

export type AgentTreeApi = {
  tree: AgentTree | null; loading: boolean; error: unknown; reload(): void;
  /** Stops the running turn of one agent and of everything below it. */
  stop(agentId: string): Promise<boolean>;
  /** Stops every running agent of the session. */
  stopAll(): Promise<boolean>;
  archive(agentId: string): Promise<boolean>;
  /** A person's message to one agent of the tree. */
  send(agentId: string, prompt: string): Promise<boolean>;
  /** Chooses the team of the session (`null`: no team). */
  setTeam(teamId: string | null): Promise<boolean>;
  setBudget(agentId: string, limitUsd: number | null): Promise<boolean>;
  /** Lets a tree that stopped at its turn ceiling go on. */
  resume(): Promise<boolean>;
};

/**
 * The agent tree of one session, kept in step with the host: read once, then followed through `jagentchill.agent.updated`;
 * an event out of order means one was missed and the tree is read again.
 */
export function useAgentTree(sessionKey: string | undefined): AgentTreeApi {
  const { connection, onEvent, status } = useHost();
  const toast = useToast();
  const [tree, setTree] = useState<AgentTree | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);
  const held = useRef<AgentTree | null>(null);
  held.current = tree;
  const reload = useCallback(() => setNonce((value) => value + 1), []);
  useEffect(() => {
    if (!connection || status !== "connected" || !sessionKey) { setLoading(false); return; }
    let cancelled = false;
    setLoading(held.current === null); setError(null);
    void connection.call<AgentTree>("jagentchill.agent.tree.get", { sessionKey }).then((next) => { if (!cancelled) { setTree(next); setLoading(false); } })
      .catch((failure) => { if (!cancelled) { setError(failure); setLoading(false); } });
    return () => { cancelled = true; };
  }, [connection, status, sessionKey, nonce]);
  useEffect(() => { setTree(null); }, [sessionKey]);
  useEffect(() => onEvent((event) => {
    if (event.event !== "jagentchill.agent.updated" || !held.current) return;
    const next = applyAgentEvent(held.current, event.payload as AgentUpdatedEvent);
    if (next === null) reload(); else if (next !== held.current) setTree(next);
  }), [onEvent, reload]);
  const act = useCallback(async (method: string, params: Record<string, unknown>): Promise<boolean> => {
    if (!connection) return false;
    try {
      const result = await connection.call<Partial<AgentTree>>(method, params);
      if (Array.isArray(result.agents) && result.rootId) setTree(result as AgentTree);
      return true;
    } catch (failure) { toast.show({ kind: "error", message: reasonOf(failure) }); return false; }
  }, [connection, toast]);
  return {
    tree, loading, error, reload,
    stop: (agentId) => act("jagentchill.agent.stop", { agentId }),
    stopAll: () => act("jagentchill.agent.stopAll", { sessionKey }),
    archive: (agentId) => act("jagentchill.agent.archive", { agentId }),
    send: (agentId, prompt) => act("jagentchill.agent.send", { agentId, prompt }),
    setTeam: (teamId) => act("jagentchill.agent.team.set", { sessionKey, teamId }),
    resume: async () => (tree ? act("jagentchill.agent.delivery.resume", { rootId: tree.rootId }) : false),
    setBudget: async (agentId, limitUsd) => { const done = await act("jagentchill.agent.budget.set", { agentId, limitUsd }); if (done) reload(); return done; },
  };
}

/** The teams of the host as the list shows them. */
export function useTeams(): { teams: TeamSummary[] | null; error: unknown; reload(): void } {
  const { connection, status } = useHost();
  const [teams, setTeams] = useState<TeamSummary[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!connection || status !== "connected") return;
    let cancelled = false;
    setError(null);
    void connection.call<{ teams: TeamSummary[] }>("jagentchill.orc.team.list", {}).then((listed) => { if (!cancelled) setTeams(listed.teams); }).catch((failure) => { if (!cancelled) setError(failure); });
    return () => { cancelled = true; };
  }, [connection, status, nonce]);
  return { teams, error, reload: useCallback(() => setNonce((value) => value + 1), []) };
}

/** One team with its roles, for the editor and for the session's team view. */
export function useTeam(teamId: string | null | undefined): { team: Team | null; template: boolean; missing: boolean; set(team: Team, template: boolean): void } {
  const { connection, status } = useHost();
  const [state, setState] = useState<{ team: Team | null; template: boolean; missing: boolean }>({ team: null, template: false, missing: false });
  useEffect(() => {
    setState({ team: null, template: false, missing: false });
    if (!connection || status !== "connected" || !teamId) return;
    let cancelled = false;
    void connection.call<{ team: Team; template: boolean }>("jagentchill.orc.team.get", { teamId }).then((got) => { if (!cancelled) setState({ ...got, missing: false }); })
      .catch(() => { if (!cancelled) setState({ team: null, template: false, missing: true }); });
    return () => { cancelled = true; };
  }, [connection, status, teamId]);
  return { ...state, set: (team, template) => setState({ team, template, missing: false }) };
}

/** The host's limit on agents one agent may have working at once: the "Maximum sub-agents per session" of the routing page. */
export function useAgentLimits(): { limits: AgentLimits | null; set(patch: Partial<AgentLimits>): Promise<void> } {
  const { connection, status } = useHost();
  const toast = useToast();
  const [limits, setLimits] = useState<AgentLimits | null>(null);
  useEffect(() => {
    if (!connection || status !== "connected") return;
    let cancelled = false;
    void connection.call<{ limits: AgentLimits }>("jagentchill.agent.limits.get", {}).then((got) => { if (!cancelled) setLimits(got.limits); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [connection, status]);
  return {
    limits,
    async set(patch) {
      if (!connection || !limits) return;
      try { setLimits((await connection.call<{ limits: AgentLimits }>("jagentchill.agent.limits.set", { limits: { ...limits, ...patch } })).limits); }
      catch (failure) { toast.show({ kind: "error", message: reasonOf(failure) }); }
    },
  };
}
export type { AgentRecord };
