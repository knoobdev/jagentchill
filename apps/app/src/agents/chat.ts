import { useCallback, useEffect, useRef, useState } from "react";
import { applyChatEvent, emptyChat, itemsFromHistory, mergeHistory, reconcileChatRun, sendOutcome, withStatus, withTranscriptUser, withUserMessage, type ChatEvent, type ChatItem, type ChatState, type SessionUsage } from "@jagentchill/app-core";
import type { QueueMode } from "@jagentchill/protocol";
import { useHost } from "../host";
import { readChatCache, writeChatCache } from "./chatCache";

type Subscribed = { live?: { runId: string; seq: number; text: string }; activeRunIds?: string[] };
const liveEvent = (live: NonNullable<Subscribed["live"]>): ChatEvent => ({ event: "jagentchill.chat.stream", payload: { state: "delta", runId: live.runId || undefined, deltaText: live.text, replace: true, length: live.text.length }, ts_ms: Date.now() });
type SendResult = { picture?: { jobId: string }; runId?: string; delivered?: boolean; effective?: string; downgradedFrom?: string; reason?: string; handover?: { itemCount: number }; hostReply?: { title: string; rows: Array<{ label: string; value: string }>; jobId?: string } };
export type ChatAttachment = { attachmentId: string; blobId: string; name: string; mime: string; size: number };
export type Chat = {
  chat: ChatState; loading: boolean; error: unknown; usage: SessionUsage | null;
  /** Ids of the transcript's user messages in order: what a fork from a message names. */
  userMessageIds: string[];
  stopping: boolean;
  /** Sends a message. During a turn `queueMode` says how; the answer tells what the composer shows. */
  send(text: string, queueMode?: QueueMode, runtimeLabel?: string, attachments?: ChatAttachment[]): Promise<{ restore: boolean; notice: string | null }>;
  stop(): Promise<void>;
  status(text: string): void;
  reload(): Promise<void>;
  /** The transcript has messages older than the ones loaded; `loadOlder` reads the next page of them (the pane calls it as the reader scrolls up). */
  hasOlder: boolean; loadingOlder: boolean;
  loadOlder(): Promise<void>;
  /** The rows on screen come from what this device kept of the session; the host's transcript has not answered yet. */
  fromCache: boolean;
  loadSearchResult(newer: number): Promise<void>;
  restoreSearchView(): void;
};
/** The newest page a pane reads when it opens (a screenful and a margin), and the size of each page further back. */
const FIRST_PAGE = 60, OLDER_PAGE = 120;
type HistoryPage = { messages: unknown[]; nextOffset?: number; hasMore?: boolean; totalMessages?: number };

/** The live chat of one session: the transcript, the stream folded into it, the per-turn usage, and send / stop. */
export function useChat(sessionKey: string): Chat {
  const { connection, onEvent, host } = useHost();
  const cacheKey = `${host?.gatewayId ?? ""}|${sessionKey}`;
  const [chat, setChat] = useState<ChatState>(emptyChat);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [usage, setUsage] = useState<SessionUsage | null>(null);
  const [userMessageIds, setUserMessageIds] = useState<string[]>([]);
  const [stopping, setStopping] = useState(false);
  const live = useRef(chat);
  live.current = chat;
  const activeSession = useRef(sessionKey);
  activeSession.current = sessionKey;
  const lastEventAt = useRef(Date.now());
  const lastReconcileAt = useRef(0);

  const loadUsage = useCallback(async () => { if (connection) setUsage(await connection.call<SessionUsage>("jagentchill.session.usage.list", { sessionKey }).catch(() => null)); }, [connection, sessionKey]);
  // The transcript is read in pages, newest first. `older` holds the pages further back, in order; they are the first
  // rows of `chat.items`, and what is read again at the end of a turn replaces only the rows after them.
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const pages = useRef({ older: [] as ChatItem[], olderUsers: [] as string[], tailUsers: [] as string[], /** Where the next page back starts, counted from the newest message when the transcript had `total` messages. */ nextOffset: undefined as number | undefined, total: undefined as number | undefined, latestTotal: undefined as number | undefined, /** How many messages the newest page is read with: it grows with the turns of this pane, so that nothing between the pages is lost. */ tailLimit: FIRST_PAGE, /** The engine pages this transcript (it does not for a CLI's own session). */ paged: false, busy: false });
  const searchSnapshot = useRef<{ items: ChatItem[]; users: string[]; hasOlder: boolean; page: typeof pages.current } | null>(null);
  const searchRequest = useRef(0);
  const readHistory = useCallback(async () => {
    if (!connection) return [];
    const state = pages.current, limit = Math.min(500, state.tailLimit);
    const history = await connection.call<HistoryPage>("jagentchill.chat.history", { sessionKey, limit, maxChars: 200_000 });
    const items = itemsFromHistory(history.messages);
    state.tailUsers = items.filter((item) => item.kind === "user").map((item) => item.id);
    state.latestTotal = history.totalMessages ?? state.latestTotal;
    if (!state.older.length) {
      // Nothing further back is loaded: this page says where the next one starts.
      state.paged = typeof history.hasMore === "boolean";
      state.nextOffset = history.nextOffset; state.total = history.totalMessages;
      setHasOlder(history.hasMore ?? history.messages.length >= limit);
    }
    setUserMessageIds([...state.olderUsers, ...state.tailUsers]);
    return items;
  }, [connection, sessionKey]);
  const reload = useCallback(async () => {
    searchSnapshot.current = null;
    Object.assign(pages.current, { older: [], olderUsers: [], tailLimit: FIRST_PAGE });
    const items = await readHistory();
    setChat((current) => ({ ...current, items: mergeHistory(items, current.items) }));
  }, [readHistory]);
  const loadOlder = useCallback(async () => {
    const state = pages.current;
    if (!connection || state.busy) return;
    state.busy = true; setLoadingOlder(true);
    /** A transcript the engine does not page (a CLI runtime's own session): the most it gives at once, read in place of the newest page. */
    const readWhole = async (): Promise<void> => {
      if (state.tailLimit >= 500) { setHasOlder(false); return; }
      state.tailLimit = 500;
      const before = state.tailUsers.length;
      const items = await readHistory();
      setHasOlder(false);
      if (state.tailUsers.length >= before) setChat((current) => withTail(current, (tail) => mergeHistory(items, tail.filter((item) => (item.kind === "assistant" && item.fresh) || /^u\d+$/.test(item.id) || item.kind === "status" || item.kind === "error"))));
    };
    try {
      if (!state.paged) return await readWhole();
      // Messages written since that page was read moved everything back by as many.
      const offset = (state.nextOffset ?? 0) + Math.max(0, (state.latestTotal ?? 0) - (state.total ?? state.latestTotal ?? 0));
      const page = await connection.call<HistoryPage>("jagentchill.chat.history", { sessionKey, limit: OLDER_PAGE, maxChars: 200_000, offset });
      const known = new Set(live.current.items.map((item) => item.id));
      const items = itemsFromHistory(page.messages, `${offset}-`).filter((item) => !known.has(item.id));
      state.nextOffset = page.nextOffset; state.total = page.totalMessages ?? state.total; state.latestTotal = page.totalMessages ?? state.latestTotal;
      // A page further back that brings nothing new: the engine did not page after all (it answers the newest page
      // again for a CLI runtime's session). Nothing further back is lost: the transcript is read whole, once.
      if (!items.length) { if (!state.older.length && page.messages.length > 0) { state.paged = false; return await readWhole(); } setHasOlder(false); return; }
      setHasOlder(page.hasMore === true);
      state.older = [...items, ...state.older];
      state.olderUsers = [...items.filter((item) => item.kind === "user").map((item) => item.id), ...state.olderUsers];
      setUserMessageIds([...state.olderUsers, ...state.tailUsers]);
      setChat((current) => ({ ...current, items: [...items, ...current.items] }));
    } catch (err) { setError(err); }
    finally { state.busy = false; setLoadingOlder(false); }
  }, [connection, sessionKey, readHistory]);
  const loadSearchResult = useCallback(async (newer: number): Promise<void> => {
    if (!connection) return;
    const request = ++searchRequest.current;
    if (!searchSnapshot.current) {
      searchSnapshot.current = { items: live.current.items, users: userMessageIds, hasOlder, page: { ...pages.current, older: [...pages.current.older], olderUsers: [...pages.current.olderUsers], tailUsers: [...pages.current.tailUsers] } };
    }
    const offset = Math.max(0, newer - 30);
    const page = await connection.call<HistoryPage>("jagentchill.chat.history", { sessionKey, limit: 60, maxChars: 200_000, offset });
    if (request !== searchRequest.current) return;
    const items = itemsFromHistory(page.messages, `${offset}-`);
    const users = items.filter((item) => item.kind === "user").map((item) => item.id);
    Object.assign(pages.current, { older: [], olderUsers: [], tailUsers: users, nextOffset: page.nextOffset, total: page.totalMessages, latestTotal: page.totalMessages, tailLimit: 60, paged: typeof page.hasMore === "boolean", busy: false });
    setUserMessageIds(users);
    setHasOlder(page.hasMore ?? false);
    setChat((current) => ({ ...current, items }));
  }, [connection, sessionKey, userMessageIds, hasOlder]);
  const restoreSearchView = useCallback((): void => {
    searchRequest.current += 1;
    const saved = searchSnapshot.current;
    if (!saved) return;
    Object.assign(pages.current, saved.page);
    setUserMessageIds(saved.users);
    setHasOlder(saved.hasOlder);
    setChat((current) => ({ ...current, items: saved.items }));
    searchSnapshot.current = null;
  }, []);
  /** The rows after the pages further back: what a re-read of the newest page is compared with. */
  const withTail = (current: ChatState, next: (tail: ChatItem[]) => ChatItem[]): ChatState => {
    const older = pages.current.older.length, head = current.items.slice(0, older), tail = current.items.slice(older);
    const result = next(tail);
    return result === tail ? current : { ...current, items: [...head, ...result] };
  };

  // Events are folded in once per frame: a burst of increments costs one render, not one each.
  const pending = useRef<ChatEvent[]>([]);
  const frame = useRef<number | null>(null);
  const feed = useCallback((event: ChatEvent) => {
    pending.current.push(event);
    if (frame.current !== null) return;
    const flush = () => {
      frame.current = null;
      const batch = pending.current;
      pending.current = [];
      if (batch.length && activeSession.current === sessionKey) setChat((current) => batch.reduce(applyChatEvent, current));
    };
    // A hidden tab runs no frames; its events are folded in on a timer instead.
    frame.current = typeof requestAnimationFrame === "function" && (typeof document === "undefined" || document.visibilityState !== "hidden") ? requestAnimationFrame(flush) : (setTimeout(flush, 50) as unknown as number);
  }, [sessionKey]);

  useEffect(() => onEvent((event) => {
    const payload = event.payload ?? {};
    // What a live turn waits for besides its own stream: the agent's question and its answer, a decision on a card.
    if (event.event === "jagentchill.chat.question.requested" || event.event === "jagentchill.chat.question.resolved" || event.event === "jagentchill.chat.permission.resolved") {
      if ((payload.question?.sessionKey ?? payload.request?.sessionKey) === sessionKey) feed({ event: event.event, payload, ts_ms: event.ts_ms ?? Date.now() });
      return;
    }
    if (payload.sessionKey !== sessionKey) return;
    lastEventAt.current = Date.now();
    if (event.event === "jagentchill.session.usage") { void loadUsage(); return; }
    if (event.event === "jagentchill.chat.timeline.reset") { void reload(); return; }
    if (!event.event.startsWith("jagentchill.chat.")) return;
    if (event.event === "jagentchill.chat.stream" && ["final", "error", "aborted"].includes(payload.state)) {
      setStopping(false);
      // The transcript now holds the turn: its message ids are what a fork names.
      // A turn this pane did not start itself (the first message of a session made in the editor) shows the person's message too.
      // (The newest page is read a little longer after every turn of this pane: the rows between it and the pages further back stay.)
      pages.current.tailLimit = Math.min(500, pages.current.tailLimit + 12);
      void readHistory().then((items) => setChat((current) => withTail(current, (tail) => mergeHistory(withTranscriptUser(items, tail), tail)))).catch(() => undefined);
    }
    feed({ event: event.event, payload, ts_ms: event.ts_ms ?? Date.now() });
  }), [onEvent, sessionKey, loadUsage, reload, readHistory, feed]);

  const reconcileRun = useCallback(async () => {
    if (!connection) return;
    lastReconcileAt.current = Date.now();
    try {
      const result = await connection.call<Subscribed>("jagentchill.chat.subscribe", { sessionKey });
      if (Array.isArray(result.activeRunIds)) {
        const at = Date.now();
        lastEventAt.current = at;
        setChat((current) => reconcileChatRun(current, result.activeRunIds, at));
        if (!result.activeRunIds.length) {
          setStopping(false);
          pages.current.tailLimit = Math.min(500, pages.current.tailLimit + 12);
          void readHistory().then((items) => setChat((current) => withTail(current, (tail) => mergeHistory(withTranscriptUser(items, tail), tail)))).catch(() => undefined);
        }
      }
      if (result.live) feed(liveEvent(result.live));
    } catch { /* The stream remains authoritative while the host cannot answer a status check. */ }
  }, [connection, sessionKey, feed, readHistory]);

  // Reconnects always ask the host for the engine's live run membership. While the pane is open, a quiet run is
  // checked again every five seconds after 30 seconds without any event from this session.
  useEffect(() => {
    if (!connection) return;
    void reconcileRun();
    const timer = setInterval(() => {
      const now = Date.now();
      if (live.current.running && now - lastEventAt.current >= 30_000 && now - lastReconcileAt.current >= 30_000) void reconcileRun();
    }, 5_000);
    return () => clearInterval(timer);
  }, [connection, sessionKey, reconcileRun]);

  // An increment of the stream was missed: the host has the text so far.
  const resyncing = useRef(false);
  useEffect(() => {
    if (!chat.gap || resyncing.current || !connection) return;
    resyncing.current = true;
    void connection.call<Subscribed>("jagentchill.chat.subscribe", { sessionKey })
      .then((result) => { if (result.live) feed(liveEvent(result.live)); })
      .catch(() => undefined).finally(() => { resyncing.current = false; });
  }, [chat.gap, connection, sessionKey, feed]);

  useEffect(() => {
    if (!connection) return;
    let cancelled = false;
    pending.current = [];
    if (frame.current !== null) {
      if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame.current);
      clearTimeout(frame.current);
      frame.current = null;
    }
    pages.current = { older: [], olderUsers: [], tailUsers: [], nextOffset: undefined, total: undefined, latestTotal: undefined, tailLimit: FIRST_PAGE, paged: false, busy: false };
    setHasOlder(false); setLoadingOlder(false);
    // A session this device has shown before is painted from what the device kept, at once; the host's transcript replaces it when it answers.
    const kept = readChatCache(cacheKey);
    setChat(kept ? { ...emptyChat(), items: kept } : emptyChat()); setFromCache(!!kept); setLoading(!kept); setError(null); setUsage(null);
    (async () => {
      // The live stream and the newest page are asked for together: neither waits for the other.
      const [subscribed, items] = await Promise.all([connection.call<Subscribed>("jagentchill.chat.subscribe", { sessionKey }), readHistory()]);
      // Rows added while the history was loading (a message sent straight away) stay after it; the kept rows go.
      if (!cancelled) { setFromCache(false); setChat((current) => ({ ...current, items: mergeHistory(items, current.items.filter((item) => !kept?.includes(item))) })); }
      // A turn that was already running shows what it has written so far.
      if (!cancelled && subscribed.live) feed(liveEvent(subscribed.live));
      await loadUsage();
    })().catch((err) => { if (!cancelled) setError(err); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => {
      cancelled = true;
      pending.current = [];
      if (frame.current !== null) {
        if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame.current);
        clearTimeout(frame.current);
        frame.current = null;
      }
      void connection.call("jagentchill.chat.unsubscribe", { sessionKey }).catch(() => undefined);
    };
  }, [connection, sessionKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = useCallback<Chat["send"]>(async (text, queueMode, runtimeLabel = "", attachments) => {
    if (!connection) return { restore: true, notice: null };
    const running = live.current.running;
    const id = `u${Date.now()}`;
    setError(null);
    // A message that starts a turn is echoed at once; one sent during a turn is placed when the host says how it was delivered.
    if (!running) setChat((current) => {
        const optimistic = withUserMessage(current, id, text, { ts_ms: Date.now() });
        return attachments?.length ? { ...optimistic, items: optimistic.items.map((item) => item.id === id && item.kind === "user" ? { ...item, attachments } : item) } : optimistic;
      });
    try {
      // The composer's "make pictures on this computer" switch: the words go to the picture model as written (`/image`);
      // no agent reads them, so no agent's model can refuse or rewrite them.
      const result = await connection.call<SendResult>("jagentchill.chat.send", { sessionKey, message: text, ...(attachments?.length ? { attachmentIds: attachments.map((entry) => entry.attachmentId) } : {}), ...(running ? { queueMode: queueMode ?? "steer", ...(live.current.runId ? { expectedRunId: live.current.runId } : {}) } : {}) });
      // A picture of the person's own words: the host keeps the message and its picture in the conversation; the pane
      // takes them from the host's history (its own echo of the words is replaced there).
      if (result.picture) {
        // The message's picture is shown under it (the host keeps which message started which picture).
        const jobId = result.picture.jobId;
        setChat((current) => (current.items.some((item) => item.kind === "host-card" && item.jobId === jobId) ? current : { ...current, items: (() => {
          const at = current.items.findIndex((item) => item.id === id);
          const card: ChatItem = { kind: "host-card", id: `${id}-picture`, title: "", rows: [], ts_ms: Date.now(), jobId };
          return at === -1 ? [...current.items, card] : [...current.items.slice(0, at + 1), card, ...current.items.slice(at + 1)];
        })() }));
        if (!result.runId) {
          void readHistory().then((items) => setChat((current) => withTail(current, (tail) => mergeHistory(withTranscriptUser(items, tail), tail)))).catch(() => undefined);
          return { restore: false, notice: null };
        }
      }
      if (result.hostReply) {
        setChat((current) => {
          const next = running ? withUserMessage(current, id, text, { ts_ms: Date.now() }) : current;
          const card: ChatItem = { kind: "host-card", id: `host-${id}`, title: result.hostReply!.title, rows: result.hostReply!.rows, ts_ms: Date.now(), ...(result.hostReply!.jobId ? { jobId: result.hostReply!.jobId } : {}) };
          return { ...next, items: [...next.items, card] };
        });
        return { restore: false, notice: null };
      }
      if (!running) {
        setChat((current) => ({ ...current, runId: result.runId ?? current.runId, items: current.items.map((item) => (item.id === id && item.kind === "user" ? { ...item, ...(result.handover ? { handoverItems: result.handover.itemCount } : {}), ...(attachments?.length ? { attachments } : {}) } : item)) }));
        return { restore: false, notice: null };
      }
      const outcome = sendOutcome(result, runtimeLabel);
      if (!outcome.restore) setChat((current) => {
        const updated = withUserMessage(result.effective === "interrupt" ? { ...current, runId: result.runId ?? null } : current, id, text, { queued: result.effective === "followup", ts_ms: Date.now() });
        return attachments?.length ? { ...updated, items: updated.items.map((item) => item.id === id && item.kind === "user" ? { ...item, attachments } : item) } : updated;
      });
      return { restore: outcome.restore, notice: outcome.notice };
    } catch (err) {
      if (!running) setChat((current) => ({ ...current, running: false, items: current.items.filter((item) => item.id !== id) }));
      setError(err);
      return { restore: true, notice: null };
    }
  }, [connection, sessionKey]);

  const stop = useCallback(async () => {
    if (!connection) return;
    setStopping(true);
    // Stop always ends the turn on this screen within a few seconds: the host is asked to abort, but an abort that does
    // not answer (a run that already ended, an engine that is busy) must not leave "Stopping" spinning for ever.
    const asked = connection.call("jagentchill.chat.abort", { sessionKey }).then(() => null, (err: unknown) => err);
    const outcome = await Promise.race([asked, new Promise<"slow">((resolve) => setTimeout(() => resolve("slow"), 5000))]);
    setStopping(false);
    setChat((current) => reconcileChatRun(current, [], Date.now()));
    if (outcome && outcome !== "slow") setError(outcome);
    void reload();
  }, [connection, sessionKey, reload]);

  // What the device keeps of the session: its newest rows, written when a turn has ended or the transcript was read.
  useEffect(() => {
    if (loading || fromCache || chat.running) return;
    writeChatCache(cacheKey, chat.items);
  }, [cacheKey, loading, fromCache, chat.running, chat.items]);

  return { chat, loading, error, usage, userMessageIds, stopping, send, stop, status: (text) => setChat((current) => withStatus(current, text, Date.now())), reload, hasOlder, loadingOlder, loadOlder, fromCache, loadSearchResult, restoreSearchView };
}
