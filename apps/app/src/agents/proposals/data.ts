import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { ProposalView, ToolNotice } from "@jagentchill/protocol";
import { useHost } from "../../host";

export type Notice = ToolNotice & { synced?: boolean };
export type ProposalError = { code: string; message: string; details?: Record<string, unknown> };
type Scope = { sessionKey?: string; projectId?: string };

/**
 * The proposals of a session (with the notices its tools left in the chat) or of a project, kept in step with the host:
 * read once, then followed through `jagentchill.proposal.updated` and `jagentchill.tool.notice`.
 */
export function useProposals(scope: Scope): {
  proposals: ProposalView[]; notices: Notice[]; loaded: boolean; reload(): void;
  resolve(proposalId: string, action: "accept" | "accept_partial" | "reject", options?: { changeIds?: string[]; feedback?: string }): Promise<ProposalView>;
  revert(proposalId: string, force?: boolean): Promise<{ proposal: ProposalView; skipped: { entityId: string }[] }>;
} {
  const { connection, onEvent, status } = useHost();
  const [proposals, setProposals] = useState<ProposalView[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [nonce, setNonce] = useState(0);
  const { sessionKey, projectId } = scope;
  useEffect(() => {
    setProposals([]); setNotices([]); setLoaded(false);
    if (!connection || status !== "connected" || (!sessionKey && !projectId)) return;
    let cancelled = false;
    void connection.call<{ proposals: ProposalView[]; notices: Notice[] }>("jagentchill.proposal.list", sessionKey ? { sessionKey } : { projectId }).then((listed) => {
      if (cancelled) return;
      // What arrived as an event while the list was on its way is newer than the list.
      setProposals((live) => [...listed.proposals.filter((entry) => !live.some((own) => own.proposalId === entry.proposalId)), ...live].sort((a, b) => a.created_ms - b.created_ms));
      setNotices(listed.notices);
      setLoaded(true);
    }).catch(() => { if (!cancelled) setLoaded(true); });
    const off = onEvent((event) => {
      if (event.event === "jagentchill.proposal.updated") {
        const proposal = (event.payload as { proposal: ProposalView }).proposal;
        if ((sessionKey && proposal.author.sessionId !== sessionKey) || (!sessionKey && proposal.projectId !== projectId)) return;
        setProposals((live) => (live.some((entry) => entry.proposalId === proposal.proposalId) ? live.map((entry) => (entry.proposalId === proposal.proposalId ? proposal : entry)) : [...live, proposal]));
      }
      if (event.event === "jagentchill.tool.notice" && sessionKey) {
        const notice = (event.payload as { notice: Notice }).notice;
        // A notice that is announced again has changed (the person continued after a pause): the newer one stands.
        if (notice.sessionKey === sessionKey) setNotices((live) => (live.some((entry) => entry.noticeId === notice.noticeId) ? live.map((entry) => (entry.noticeId === notice.noticeId ? { ...entry, ...notice } : entry)) : [...live, notice]));
      }
    });
    return () => { cancelled = true; off(); };
  }, [connection, status, sessionKey, projectId, nonce, onEvent]);
  const put = useCallback((proposal: ProposalView) => setProposals((live) => live.map((entry) => (entry.proposalId === proposal.proposalId ? proposal : entry))), []);
  return useMemo(() => ({
    proposals, notices, loaded, reload: () => setNonce((value) => value + 1),
    async resolve(proposalId, action, options = {}) {
      if (!connection) throw { code: "UNAVAILABLE", message: "Host offline" } satisfies ProposalError;
      const result = await connection.call<{ proposal: ProposalView }>("jagentchill.proposal.resolve", { proposalId, action, ...(options.changeIds ? { changeIds: options.changeIds, includeDependencies: true } : {}), ...(options.feedback ? { feedback: options.feedback } : {}) });
      put(result.proposal);
      return result.proposal;
    },
    async revert(proposalId, force = false) {
      if (!connection) throw { code: "UNAVAILABLE", message: "Host offline" } satisfies ProposalError;
      const result = await connection.call<{ proposal: ProposalView; skipped: { entityId: string }[] }>("jagentchill.proposal.revert", { proposalId, ...(force ? { force: true } : {}) });
      put(result.proposal);
      return result;
    },
  }), [proposals, notices, loaded, connection, put]);
}

// — What this app instance is looking at —
type Listener = () => void;
function cell<T>(initial: T) {
  let value = initial;
  const listeners = new Set<Listener>();
  return {
    get: () => value,
    set(next: T) { if (next === value) return; value = next; for (const listener of [...listeners]) listener(); },
    subscribe(listener: Listener) { listeners.add(listener); return () => void listeners.delete(listener); },
  };
}
/** The session whose chat pane is on screen: the host asks this device for the editor's context and for frames on its behalf. */
export const focusedSession = cell<string | null>(null);
/** The proposal an editor draws over its project, by project id; absent: the project as it is. */
const previews = cell<Record<string, string | null>>({});
export const proposalPreview = {
  of: (projectId: string): string | null | undefined => previews.get()[projectId],
  set: (projectId: string, proposalId: string | null) => previews.set({ ...previews.get(), [projectId]: proposalId }),
  /** Hides the preview of this one proposal until the person asks for it again; a later proposal is shown as usual. */
  hide: (projectId: string, proposalId: string) => previews.set({ ...previews.get(), [projectId]: `!${proposalId}` }),
  subscribe: previews.subscribe,
};
export const usePreviewOf = (projectId: string): string | null | undefined => useSyncExternalStore(previews.subscribe, () => previews.get()[projectId], () => undefined);
export const useFocusedSession = (): string | null => useSyncExternalStore(focusedSession.subscribe, focusedSession.get, () => null);

export { hostNotes } from "./notes";
