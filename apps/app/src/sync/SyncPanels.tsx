import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, TextInput, View } from "react-native";
import { createEditorController, EDITOR_PREFS, formatDateTime, relativeTime } from "@jagentchill/app-core";
import { HostError, type SessionState, type SyncSession, type Transfer } from "@jagentchill/client";
import { uuidV4 } from "@jagentchill/editor-core";
import { COMMENT_BODY_MAX, VERSION_NAME_MAX, type ProjectDocument, type Rational, type SyncComment, type SyncVersion } from "@jagentchill/protocol";
import { formatTimecode, timeline } from "@jagentchill/editor-core";
import { Avatar, Badge, BottomSheet, Button, ConfirmDialog, Icon, IconButton, Input, MarkdownView, Menu, Modal, Popover, Segmented, Spinner, Tap, Text, Tooltip, radius, space, useTheme, useToast, type MenuItem } from "@jagentchill/ui";
import { commentThreads, type CommentFilter, type CommentSort } from "@jagentchill/app-core";
import { EditorContext, useEditor } from "../editor/context";
import { Player } from "../editor/Player";
import { createEditorRuntime, type EditorRuntime } from "../editor/runtime";
import { useHost } from "../host";
import { loadSigner } from "../identity";
import { useT } from "../locale";
import type { MediaSession } from "../media/session";
import { onWindowKey, openExternal, preferenceStore } from "../platform/store";
import { getPref, setPref } from "../state";
import { SyncActivity, useSessionState } from "./EditorSync";
import { SYNC_PREFS } from "./prefs";
import { useSync } from "./SyncProvider";

const PREF_STORE = { get: getPref, set: setPref } as never;
const timecode = (ticks: number, fps: Rational) => formatTimecode(ticks, "HH:MM:SS:FF", fps) ?? "00:00:00:00";
const when = (time_ms: number) => formatDateTime(time_ms);

// ── Compare ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** "Compare": this device's version and the host's side by side in view-only players whose playheads move together. */
export function ComparePlayers(props: { open: boolean; onClose(): void; session: SyncSession | null; document: ProjectDocument | null; media: MediaSession | null }) {
  const t = useT();
  const theme = useTheme();
  const [pair, setPair] = useState<{ device: EditorRuntime; host: EditorRuntime } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    if (!props.open || !props.session || !props.document || !props.media) { setPair(null); return; }
    let cancelled = false, made: { close(): void }[] = [];
    setFailed(null);
    void props.session.hostDocument().then((hostDocument) => {
      if (cancelled) return;
      const local = (props.document as { local?: unknown }).local;
      const runtimeOf = (document: ProjectDocument) => {
        const controller = createEditorController({ document, newId: () => uuidV4(), platform: "web", prefs: () => getPref(EDITOR_PREFS.timeline), readOnly: t("View only") });
        const runtime = createEditorRuntime({ controller, media: props.media!, prefs: PREF_STORE, toast: () => undefined, t: (text) => text });
        made.push(runtime, controller);
        return runtime;
      };
      const device = runtimeOf(props.document!), host = runtimeOf((local === undefined ? hostDocument : { ...hostDocument, local }) as ProjectDocument);
      // Scrubbing one moves the other to the same time.
      let moving = false;
      const link = (from: EditorRuntime, to: EditorRuntime) => from.subscribeTransport(() => { if (moving || from.transport.playing) return; if (Math.abs(to.transport.time - from.transport.time) < 1) return; moving = true; to.seek(from.transport.time); moving = false; });
      const off = [link(device, host), link(host, device)];
      made.push({ close: () => off.forEach((stop) => stop()) });
      setPair({ device, host });
    }, (error) => { if (!cancelled) setFailed(error instanceof Error ? error.message : String(error)); });
    return () => { cancelled = true; for (const entry of made.reverse()) entry.close(); made = []; };
  }, [props.open, props.session, props.document, props.media]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!props.open) return null;
  const side = (title: string, runtime: EditorRuntime, id: string) => (
    <View style={{ flex: 1, minWidth: 0, gap: space[1] }} testID={id}>
      <Text variant="body-medium">{title}</Text>
      <View style={{ height: 300, borderRadius: radius.md, overflow: "hidden", borderWidth: 1, borderColor: theme.color("border/hairline") }}>
        <EditorContext.Provider value={runtime}><Player onOpenCanvasSettings={() => undefined} /></EditorContext.Provider>
      </View>
    </View>
  );
  return (
    <Modal open width={640} title={t("Compare")} description={t("Both versions, view only. Scrubbing one moves the other to the same time.")} onClose={props.onClose} footer={<Button label={t("Close")} testID="compare-close" onPress={props.onClose} />}>
      {failed ? <Text color="danger">{failed}</Text> : pair ? (
        <View style={{ flexDirection: theme.compact ? "column" : "row", gap: space[3] }} testID="compare-players">
          {side(t("This device"), pair.device, "compare-device")}
          {side(t("Host"), pair.host, "compare-host")}
        </View>
      ) : <Text color="text/secondary">{t("Loading the host version…")}</Text>}
    </Modal>
  );
}

// ── Review comments ──────────────────────────────────────────────────────────────────────────────────────────────────

type Pending = { commentId: string; body: string; time_ticks?: number; parentId?: string; created_ms: number };
const pendingKey = (projectId: string) => `jagentchill.sync.pendingComments.${projectId}`;
const readPending = (projectId: string): Pending[] => { try { return JSON.parse(preferenceStore.get(pendingKey(projectId)) ?? "[]") as Pending[]; } catch { return []; } };
const FILTERS = [{ id: "open", label: "Open" }, { id: "resolved", label: "Resolved" }, { id: "all", label: "All" }];

function CommentCardActions(props: { comment: SyncComment; reply: boolean; visible: boolean; own: boolean; canWrite: boolean; onMenuOpen(): void; onMenuClose(): void; onReply(): void; onResolve(): void; onEdit(): void; onCopy(): void; onDelete(): void }) {
  const t = useT();
  const more = useRef<View>(null);
  const [open, setOpen] = useState(false);
  if (!props.visible) return null;
  const items: MenuItem[] = [
    ...(props.own ? [{ id: "edit", label: t("Edit"), icon: "pencil" as const, onSelect: props.onEdit }] : []),
    { id: "copy", label: t("Copy link"), icon: "link", onSelect: props.onCopy },
    ...(props.canWrite || props.own ? [{ id: "delete", label: t("Delete"), icon: "trash" as const, danger: true, onSelect: props.onDelete }] : []),
  ];
  return <View style={{ flexDirection: "row", alignItems: "center", gap: space[0.5] }}>
    {!props.reply ? <IconButton icon="chat" size="xs" label={t("Reply")} testID="comment-reply-action" onPress={props.onReply} /> : null}
    {!props.reply && props.canWrite ? <IconButton icon={props.comment.resolved ? "undo" : "check"} size="xs" label={props.comment.resolved ? t("Reopen") : t("Resolve")} testID="comment-resolve" onPress={props.onResolve} /> : null}
    <IconButton ref={more} icon="more" size="xs" label={t("More")} testID="comment-more" expanded={open} onPress={() => { setOpen(true); props.onMenuOpen(); }} />
    <Menu open={open} anchor={more} label={t("More")} items={items} onClose={() => { setOpen(false); props.onMenuClose(); }} />
  </View>;
}

/** The comments of a synced project: timed notes any paired device may leave without holding the edit lease. */
export function CommentsPanel(props: { open: boolean; onClose(): void; projectId: string; playhead(): number; fps: Rational; seek(ticks: number): void; selectedId?: string | null; onSelect?(commentId: string): void; onComments?(comments: SyncComment[]): void; embedded?: boolean }) {
  const t = useT();
  const theme = useTheme();
  const toast = useToast();
  const host = useHost();
  const sync = useSync();
  const [comments, setComments] = useState<SyncComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<Pending[]>(() => readPending(props.projectId));
  const [filter, setFilter] = useState("open");
  const [sort, setSort] = useState<CommentSort>("time");
  const [draft, setDraft] = useState("");
  const [timeMode, setTimeMode] = useState<"time" | "project">("time");
  const [heldTime, setHeldTime] = useState<number | null>(null);
  const [composerFocused, setComposerFocused] = useState(false);
  const [composerHeight, setComposerHeight] = useState(44);
  const [replyDraft, setReplyDraft] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [expandedResolved, setExpandedResolved] = useState<string | null>(null);
  const connection = host.connection, target = useMemo(() => ({ targetType: "project" as const, targetId: props.projectId }), [props.projectId]);
  const [me, setMe] = useState("");
  const [playhead, setPlayhead] = useState(props.playhead);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [activeCard, setActiveCard] = useState<string | null>(null);
  const [menuCard, setMenuCard] = useState<string | null>(null);
  const input = useRef<TextInput>(null);
  const list = useRef<ScrollView>(null);
  const cardY = useRef(new Map<string, number>());
  const sortRef = useRef<View>(null);
  const [sortOpen, setSortOpen] = useState(false);
  useEffect(() => { void loadSigner().then((signer) => setMe(signer.deviceId), () => undefined); }, []);
  const editor = useEditor();
  useEffect(() => {
    if (!props.open) return;
    setPlayhead(props.playhead());
    return editor.subscribeTransport(() => setPlayhead(editor.transport.time));
  }, [editor, props.open]); // eslint-disable-line react-hooks/exhaustive-deps
  const savePending = useCallback((next: Pending[]) => { setPending(next); preferenceStore.set(pendingKey(props.projectId), JSON.stringify(next)); }, [props.projectId]);
  const load = useCallback(() => {
    if (!connection) { setLoading(false); return; }
    setLoading(true);
    void connection.call<{ comments: SyncComment[] }>("jagentchill.comment.list", target).then((result) => { setComments(result.comments); props.onComments?.(result.comments); setLoading(false); }, () => setLoading(false));
  }, [connection, target, props.onComments]);
  useEffect(() => {
    if (!props.open) return;
    const focus = setTimeout(() => input.current?.focus(), 0);
    const off = onWindowKey((event) => { if (event.key === "Escape") { event.preventDefault(); props.onClose(); } });
    return () => { clearTimeout(focus); off(); };
  }, [props.open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!connection) return;
    load();
    void connection.call("jagentchill.comment.subscribe", target).catch(() => undefined);
    const off = host.onEvent((event) => { if (event.event === "jagentchill.comment.changed" && event.payload?.targetId === props.projectId) load(); });
    return () => { off(); void connection.call("jagentchill.comment.unsubscribe", target).catch(() => undefined); };
  }, [props.open, connection, target, load, host, props.projectId]);
  // Comments written while disconnected are sent on reconnect; the comment id makes a repeated send harmless.
  useEffect(() => {
    if (!connection || pending.length === 0) return;
    let cancelled = false;
    void (async () => {
      let left = pending;
      for (const entry of pending) {
        try {
          await connection.call("jagentchill.comment.create", { commentId: entry.commentId, ...target, ...(entry.time_ticks === undefined ? {} : { time_ticks: entry.time_ticks }), body: entry.body, ...(entry.parentId ? { parentId: entry.parentId } : {}), ...(getPref(SYNC_PREFS.displayName) ? { authorName: getPref(SYNC_PREFS.displayName) } : {}), idempotencyKey: entry.commentId });
          left = left.filter((other) => other.commentId !== entry.commentId);
        } catch (error) { if (error instanceof HostError && error.code !== "CONNECTION_CLOSED") left = left.filter((other) => other.commentId !== entry.commentId); else break; }
      }
      if (!cancelled) { savePending(left); load(); }
    })();
    return () => { cancelled = true; };
  }, [connection]); // eslint-disable-line react-hooks/exhaustive-deps
  const over = draft.length - COMMENT_BODY_MAX;
  const send = (replyBody?: string) => {
    const body = (replyBody ?? draft).trim();
    if (!body || over > 0) return;
    const entry: Pending = { commentId: uuidV4(), body, ...(timeMode === "time" ? { time_ticks: Math.max(0, Math.round(heldTime ?? props.playhead())) } : {}), ...(replyTo ? { parentId: replyTo } : {}), created_ms: Date.now() };
    setDraft(""); setReplyDraft(""); setReplyTo(null); setHeldTime(null);
    if (!connection) { savePending([...pending, entry]); return; }
    void connection.call("jagentchill.comment.create", { commentId: entry.commentId, ...target, ...(entry.time_ticks === undefined ? {} : { time_ticks: entry.time_ticks }), body, ...(entry.parentId ? { parentId: entry.parentId } : {}), ...(getPref(SYNC_PREFS.displayName) ? { authorName: getPref(SYNC_PREFS.displayName) } : {}), idempotencyKey: entry.commentId })
      .then(load, (error) => { if (error instanceof HostError && error.code === "CONNECTION_CLOSED") savePending([...pending, entry]); else toast.show({ kind: "error", message: error instanceof HostError && error.code === "SCOPE_DENIED" ? t("Your role on this host does not allow this") : t("Sync error") }); });
  };
  const act = (method: string, params: unknown) => { if (connection) void connection.call(method, params).then(load, (error) => toast.show({ kind: "error", message: error instanceof HostError && (error.code === "SCOPE_DENIED" || error.code === "PERMISSION_DENIED") ? t("Your role on this host does not allow this") : t("Sync error") })); };
  const copyLink = async (commentId: string) => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("comment", commentId);
    try { await (await import("expo-clipboard")).setStringAsync(url.toString()); toast.show({ kind: "info", message: t("Copied") }); }
    catch { toast.show({ kind: "error", message: t("Copy link") }); }
  };
  const threads = commentThreads(comments, filter as CommentFilter, sort);
  const frameTicks = 240_000 * props.fps.denominator / props.fps.numerator;
  const activeCommentId = threads.map((thread) => thread.root).find((comment) => comment.time_ticks !== undefined && Math.abs(comment.time_ticks - playhead) <= frameTicks)?.commentId ?? null;
  useEffect(() => { const y = activeCommentId ? cardY.current.get(activeCommentId) : undefined; if (y !== undefined) list.current?.scrollTo({ y: Math.max(0, y - 24), animated: true }); }, [activeCommentId]);
  const item = (comment: SyncComment, reply: boolean) => (
    <View key={comment.commentId} {...({ dataSet: { activeComment: activeCommentId === comment.commentId }, onPointerEnter: () => setActiveCard(comment.commentId), onPointerLeave: () => { if (menuCard !== comment.commentId) setActiveCard((id) => id === comment.commentId ? null : id); }, onFocusCapture: () => setActiveCard(comment.commentId), onBlurCapture: () => { if (menuCard !== comment.commentId) setActiveCard((id) => id === comment.commentId ? null : id); } } as object)} onLayout={(event) => { cardY.current.set(comment.commentId, event.nativeEvent.layout.y); }} testID={reply ? "comment-reply" : "comment"} style={{ position: "relative", gap: space[1], marginStart: reply ? space[8] : 0, marginTop: reply ? 0 : space[1], padding: space[2], paddingStart: reply ? space[3] : space[2], borderWidth: reply ? 0 : 1, borderStartWidth: reply ? 1 : (props.selectedId === comment.commentId || activeCommentId === comment.commentId) ? 2 : 1, borderColor: theme.color("border/hairline"), borderStartColor: reply ? theme.color("border/strong") : theme.color(props.selectedId === comment.commentId || activeCommentId === comment.commentId ? "accent" : "border/hairline"), borderRadius: reply ? 0 : radius.md, backgroundColor: reply ? "transparent" : theme.color(comment.resolved ? "bg/app" : "bg/elevated"), opacity: comment.resolved ? 0.82 : 1 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[1.5], minWidth: 0, paddingEnd: theme.touch ? 144 : activeCard === comment.commentId || menuCard === comment.commentId ? 100 : 0 }}>
        <Avatar name={comment.authorName} id={comment.authorDeviceId} size={reply ? 20 : 24} />
        <Tap role="button" label={t("Go to {time}", { time: timecode(comment.time_ticks ?? 0, props.fps) })} onPress={() => { props.onSelect?.(comment.commentId); if (comment.time_ticks !== undefined) props.seek(comment.time_ticks); }} style={{ flexDirection: "row", alignItems: "center", gap: space[1], minWidth: 0 }}>
          <Text variant="body-medium" numberOfLines={1}>{comment.authorName}</Text>
        </Tap>
        {comment.time_ticks !== undefined && !theme.touch ? <Tap role="button" label={t("Go to {time}", { time: timecode(comment.time_ticks, props.fps) })} testID="comment-time" onPress={() => { props.onSelect?.(comment.commentId); props.seek(comment.time_ticks!); }} style={{ paddingHorizontal: space[1.5], paddingVertical: space[0.5], borderRadius: radius.full, backgroundColor: theme.color("accent/subtle") }}><Text variant="mono" color="accent/text" tabular>{timecode(comment.time_ticks, props.fps)}</Text></Tap> : null}
        <View style={{ flex: 1 }} />
        {!theme.touch && activeCard !== comment.commentId && menuCard !== comment.commentId ? <Tooltip label={formatDateTime(comment.created_ms)}><Text variant="meta" color="text/secondary" numberOfLines={1}>{relativeTime(comment.created_ms, Date.now(), theme.locale)}{comment.edited_ms ? ` · ${t("edited")}` : ""}</Text></Tooltip> : null}
        {comment.resolved ? <Icon name="check" size={14} color="text/tertiary" /> : null}
      </View>
      {comment.time_ticks !== undefined && theme.touch ? <Tap role="button" label={t("Go to {time}", { time: timecode(comment.time_ticks, props.fps) })} testID="comment-time" onPress={() => { props.onSelect?.(comment.commentId); props.seek(comment.time_ticks!); }} style={{ alignSelf: "flex-start", paddingHorizontal: space[1.5], paddingVertical: space[0.5], borderRadius: radius.full, backgroundColor: theme.color("accent/subtle") }}><Text variant="mono" color="accent/text" tabular>{timecode(comment.time_ticks, props.fps)}</Text></Tap> : null}
      {editing?.id === comment.commentId ? (
        <View style={{ flexDirection: "row", gap: space[2] }}>
          <View style={{ flex: 1 }}><Input size="sm" accessibilityLabel={t("Edit comment")} value={editing.body} onChangeText={(body) => setEditing({ id: comment.commentId, body })} /></View>
          <Button size="xs" kind="strong" label={t("Save")} testID="comment-edit-save" disabled={!editing.body.trim() || editing.body.length > COMMENT_BODY_MAX} onPress={() => { act("jagentchill.comment.update", { commentId: comment.commentId, body: editing.body.trim() }); setEditing(null); }} />
        </View>
      ) : comment.resolved && !reply && expandedResolved !== comment.commentId ? (
        <Tap role="button" label={t("Expand resolved comment")} onPress={() => setExpandedResolved(comment.commentId)}>
          <Text numberOfLines={1} color="text/secondary" testID="comment-body">{comment.body}</Text>
        </Tap>
      ) : <View testID="comment-body"><MarkdownView source={comment.body} resolveImage={() => null} textStyle={{ fontSize: 14, lineHeight: 20 }} onLink={(href) => openExternal(href)} /></View>}
      <View testID="comment-actions" pointerEvents="box-none" style={{ position: "absolute", top: space[1], end: space[1], zIndex: 2, borderRadius: radius.sm, backgroundColor: theme.color("bg/elevated") }}><CommentCardActions comment={comment} reply={reply} visible={theme.touch || activeCard === comment.commentId || menuCard === comment.commentId || replyTo === comment.commentId} own={comment.authorDeviceId === me} canWrite={sync.canWrite}
        onMenuOpen={() => { setMenuCard(comment.commentId); setActiveCard(comment.commentId); }} onMenuClose={() => { setMenuCard(null); setActiveCard(null); }}
        onReply={() => { setReplyTo(comment.commentId); setReplyDraft(""); }} onResolve={() => act("jagentchill.comment.resolve", { commentId: comment.commentId, resolved: !comment.resolved })}
        onEdit={() => setEditing({ id: comment.commentId, body: comment.body })} onCopy={() => void copyLink(comment.commentId)} onDelete={() => setPendingDelete(comment.commentId)} /></View>
      {!reply && replyTo === comment.commentId ? <View style={{ flexDirection: "row", alignItems: "flex-end", gap: space[1] }}>
        <TextInput multiline accessibilityLabel={t("Reply")} aria-label={t("Reply")} testID="comment-reply-input" placeholder={t("Write a reply")}
          placeholderTextColor={theme.color("text/tertiary" as never)} value={replyDraft} onChangeText={setReplyDraft}
          style={[theme.type("body"), { flex: 1, minHeight: 40, maxHeight: 96, padding: space[1.5], borderRadius: radius.sm, borderWidth: 1, borderColor: theme.color("border/hairline"), color: theme.color("text/primary"), backgroundColor: theme.color("bg/app") }]} />
        <IconButton icon="chat" size="sm" label={t("Send reply")} disabled={!replyDraft.trim()} testID="comment-reply-send" onPress={() => send(replyDraft)} />
        <IconButton icon="x" size="sm" label={t("Cancel")} onPress={() => { setReplyTo(null); setReplyDraft(""); }} />
      </View> : null}
      {(!comment.resolved || expandedResolved === comment.commentId) ? comments.filter((other) => other.parentId === comment.commentId).map((other) => item(other, true)) : null}
    </View>
  );
  const panelBody = (
      <View testID="comments-panel" style={{ flex: 1, minHeight: 0, backgroundColor: theme.color("bg/app") }}>
        {(!props.embedded || !theme.compact) ? <View testID="comments-header" style={{ height: 44, flexDirection: "row", alignItems: "center", gap: space[1], paddingHorizontal: space[3], borderBottomWidth: 1, borderBottomColor: theme.color("border/hairline") }}>
          <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: space[1] }}><Text variant="title-sm" testID="comments-header-title">{t("Comments")}</Text><Badge label={String(comments.filter((comment) => !comment.resolved && !comment.parentId).length)} tone="neutral" /></View>
          <IconButton ref={sortRef} icon="sliders" size="sm" label={t("Sort comments")} testID="comment-sort-menu" onPress={() => setSortOpen(true)} />
          <Menu open={sortOpen} anchor={sortRef} label={t("Sort comments")} onClose={() => setSortOpen(false)} items={[
            { id: "time", label: t("By time in video"), checked: sort === "time", onSelect: () => setSort("time") },
            { id: "newest", label: t("Newest first"), checked: sort === "newest", onSelect: () => setSort("newest") },
          ] satisfies MenuItem[]} />
          <IconButton icon="x" size="sm" label={t("Close comments")} testID="comments-close" onPress={props.onClose} />
        </View> : null}
        <View style={{ flex: 1, minHeight: 0 }}>
          <View testID="comments-filter-wrap" style={{ paddingHorizontal: space[3], paddingVertical: space[1.5] }}><Segmented block size="xs" label={t("Comments")} options={FILTERS.map((entry) => ({ value: entry.id, label: t(entry.label), count: comments.filter((comment) => !comment.parentId && (entry.id === "all" || (entry.id === "open") === !comment.resolved)).length }))} value={filter} onChange={setFilter} /></View>
          <ScrollView ref={list} testID="comments-list" style={{ flex: 1 }} contentContainerStyle={{ gap: space[1.5], paddingHorizontal: space[3], paddingBottom: space[3] }}>
            {!connection ? <View style={{ flexDirection: "row", alignItems: "center", gap: space[1], padding: space[2], borderRadius: radius.sm, backgroundColor: theme.color("warning/subtle") }}><Icon name="device" size={14} color="warning/icon" /><Text variant="meta" color="warning/text">{t("Offline")}</Text></View> : null}
            {pending.map((entry) => <View key={entry.commentId} testID="comment-pending" style={{ gap: space[1], padding: space[2], borderWidth: 1, borderColor: theme.color("border/hairline"), borderRadius: radius.md }}><View style={{ flexDirection: "row", gap: space[2], alignItems: "center" }}>{entry.time_ticks !== undefined ? <Text variant="mono" color="accent/text">{timecode(entry.time_ticks, props.fps)}</Text> : <Text variant="meta" color="text/secondary">{t("Whole project")}</Text>}<Badge label={t("Pending")} tone="warning" /></View><Text>{entry.body}</Text></View>)}
            {loading ? <View style={{ padding: space[4], alignItems: "center", gap: space[2] }}><Spinner /><Text color="text/secondary">{t("Loading…")}</Text></View> : threads.length === 0 && pending.length === 0 ? <View style={{ alignItems: "flex-start", maxWidth: 260, paddingHorizontal: space[1], paddingTop: space[4], gap: space[1] }}><Icon name="chat" size={24} color="text/secondary" /><Text variant="title-sm" testID="comments-empty">{filter === "resolved" ? t("Nothing resolved yet") : t("No comments yet")}</Text><Text variant="body" color="text/secondary" style={{ fontSize: 13, lineHeight: 18 }}>{filter === "open" ? t("Leave notes on a moment of the video for yourself, your devices or the agent") : t("Comments will appear here")}</Text><Button kind="outline" size="xs" label={t("Comment at {time}", { time: timecode(playhead, props.fps) })} testID="comments-empty-add" onPress={() => input.current?.focus()} /></View> : threads.map((thread) => item(thread.root, false))}
          </ScrollView>
        </View>
        {!replyTo ? <View style={{ padding: space[2], borderTopWidth: 1, borderTopColor: theme.color("border/hairline") }}>
          <View testID="comment-composer" style={{ borderRadius: radius.lg, borderWidth: composerFocused ? 2 : 1, borderColor: theme.color(composerFocused ? "border/control" : "border/hairline"), backgroundColor: theme.color("bg/app"), overflow: "hidden", ...theme.elevation(1) }}>
            <TextInput ref={input} multiline accessibilityLabel={t("Comment")} aria-label={t("Comment")} testID="comment-input" placeholder={t("Add a comment…")} placeholderTextColor={theme.color("text/placeholder")} value={draft} onChangeText={(value) => { if (value && !draft && timeMode === "time") setHeldTime(playhead); setDraft(value); }} onContentSizeChange={(event) => setComposerHeight(Math.min(144, Math.max(44, Math.ceil(event.nativeEvent.contentSize.height))))} onFocus={() => setComposerFocused(true)} onBlur={() => setComposerFocused(false)}
              {...({ onKeyPress: (event: { nativeEvent: { key: string; metaKey?: boolean; ctrlKey?: boolean }; preventDefault(): void }) => { if (event.nativeEvent.key === "Enter" && (event.nativeEvent.metaKey || event.nativeEvent.ctrlKey)) { event.preventDefault(); send(); } } } as object)}
              style={[theme.type("body"), { width: "100%", height: composerHeight, minHeight: 44, maxHeight: 144, paddingHorizontal: space[2], paddingVertical: space[1.5], color: theme.color("text/primary"), backgroundColor: "transparent", outlineWidth: 0 }]} />
            <View style={{ flexDirection: "row", alignItems: "center", gap: space[1], padding: space[1.5] }}>
              <Tap role="button" label={timeMode === "time" ? t("Switch to whole project") : t("Switch to a time") } testID="comment-time-mode" onPress={() => { setTimeMode((mode) => mode === "time" ? "project" : "time"); setHeldTime(null); }}>
                <Badge label={timeMode === "time" ? timecode(draft ? (heldTime ?? playhead) : playhead, props.fps) : t("Whole project")} tone={timeMode === "time" ? "accent" : "neutral"} />
              </Tap>
              <View style={{ flex: 1 }} />
              {over > 0 ? <Text testID="comment-counter" variant="meta" color="danger">{t("{n} characters too many", { n: over })}</Text> : draft.length > COMMENT_BODY_MAX - 200 ? <Text testID="comment-counter" variant="meta" color="text/secondary">{draft.length} / {COMMENT_BODY_MAX}</Text> : null}
              <Tap role="button" label={t("Send")} disabled={!draft.trim() || over > 0} testID="comment-send" onPress={send} style={{ width: 32, height: 32, borderRadius: radius.full, alignItems: "center", justifyContent: "center", backgroundColor: theme.color(draft.trim() && over <= 0 ? "accent" : "bg/subtle") }}><Icon name="arrow-up" size="sm" color={draft.trim() && over <= 0 ? "text/on-accent" : "text/tertiary"} /></Tap>
            </View>
          </View>
        </View> : <View style={{ padding: space[2], borderTopWidth: 1, borderTopColor: theme.color("border/hairline"), backgroundColor: theme.color("bg/elevated") }}><Text variant="meta" color="text/secondary">{t("Replying in the thread above")}</Text></View>}
      </View>
  );
  return (
    <>
      {props.embedded ? panelBody : theme.width <= 390 ? <BottomSheet open={props.open} onClose={props.onClose} snap={0.9} scrollable={false}>{panelBody}</BottomSheet> : null}
      <ConfirmDialog open={pendingDelete !== null} title={t("Delete this comment?")} confirmLabel={t("Delete")} onClose={() => setPendingDelete(null)} onConfirm={() => { if (pendingDelete) act("jagentchill.comment.delete", { commentId: pendingDelete }); setPendingDelete(null); }} />
    </>
  );
}

// ── Named versions on the host ───────────────────────────────────────────────────────────────────────────────────────

/** The host side of version history: versions saved on any device, each with the badge of the device that saved it. */
export function HostVersions(props: { projectId: string; session: SyncSession | null; onRestored?(): void }) {
  const t = useT();
  const theme = useTheme();
  const toast = useToast();
  const host = useHost();
  const sync = useSync();
  const state = useSessionState(props.session);
  const [versions, setVersions] = useState<SyncVersion[]>([]);
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const connection = host.connection, doc = useMemo(() => ({ kind: "project" as const, id: props.projectId }), [props.projectId]);
  const load = useCallback(() => { if (connection) void connection.call<{ versions: SyncVersion[] }>("jagentchill.sync.version.list", { doc }).then((result) => setVersions(result.versions), () => setVersions([])); }, [connection, doc]);
  useEffect(() => { load(); }, [load, sync.version, state?.head]);
  // A version saved on another device is announced on the document's stream.
  useEffect(() => host.onEvent((event) => { if (event.event === "jagentchill.sync.snapshot" && event.payload?.doc?.id === props.projectId) load(); }), [host, load, props.projectId]);
  if (!state || state.status.kind === "local" || !connection) return null;
  const editing = state.mode === "editing";
  const fail = (error: unknown) => toast.show({ kind: "error", message: error instanceof HostError && error.code === "SCOPE_DENIED" ? t("Your role on this host does not allow this") : error instanceof HostError && error.code === "LEASE_NOT_HELD" ? t("Request to edit to restore a version") : t("Sync error") });
  return (
    <View testID="host-versions" style={{ gap: space[2], paddingTop: space[3], borderTopWidth: 1, borderTopColor: theme.color("border/hairline") }}>
      <Text variant="body-medium">{t("On {host}", { host: sync.hostName ?? "" })}</Text>
      {sync.canWrite ? (
        <View style={{ flexDirection: "row", gap: space[2] }}>
          <View style={{ flex: 1 }}><Input size="sm" accessibilityLabel={t("Version name")} placeholder={t("Version name")} testID="host-version-name" value={name} maxLength={VERSION_NAME_MAX} onChangeText={setName} /></View>
          <Button size="sm" label={t("Save version")} testID="host-version-save" disabled={!name.trim()} onPress={() => { void props.session?.flushLocal().then(() => connection.call("jagentchill.sync.version.create", { doc, name: name.trim(), idempotencyKey: uuidV4() })).then(() => { setName(""); load(); }, fail); }} />
        </View>
      ) : null}
      {versions.length === 0 ? <Text variant="meta" color="text/secondary">{t("No versions on this host yet")}</Text> : versions.map((version) => (
        <View key={version.versionId} testID="host-version" style={{ gap: space[1], paddingVertical: space[1] }}>
          {renaming?.id === version.versionId ? (
            <View style={{ flexDirection: "row", gap: space[2] }}>
              <View style={{ flex: 1 }}><Input size="sm" accessibilityLabel={t("Version name")} value={renaming.name} maxLength={VERSION_NAME_MAX} onChangeText={(text) => setRenaming({ id: version.versionId, name: text })} /></View>
              <Button size="xs" kind="strong" label={t("Save")} disabled={!renaming.name.trim()} onPress={() => { void connection.call("jagentchill.sync.version.rename", { versionId: version.versionId, name: renaming.name.trim() }).then(() => { setRenaming(null); load(); }, fail); }} />
            </View>
          ) : <Text numberOfLines={1}>{version.name}</Text>}
          <View style={{ flexDirection: "row", alignItems: "center", gap: space[1], flexWrap: "wrap" }}>
            <Badge label={version.authorName} tone="neutral" />
            <Text variant="meta" color="text/secondary">{`${t("Revision {n}", { n: version.revision })} · ${when(version.created_ms)}`}</Text>
          </View>
          <View style={{ flexDirection: "row", gap: space[1], alignItems: "center", flexWrap: "wrap" }}>
            <Button kind="ghost" size="xs" label={t("Restore")} testID="host-version-restore" disabled={!editing} onPress={() => { void props.session?.restoreVersion(version.versionId).then(() => { toast.show({ kind: "success", message: t("Restored") }); props.onRestored?.(); }, fail); }} />
            {sync.canWrite ? <Button kind="ghost" size="xs" label={t("Rename")} onPress={() => setRenaming({ id: version.versionId, name: version.name })} /> : null}
            {sync.canWrite ? <Button kind="ghost" size="xs" tone="danger" label={t("Delete")} testID="host-version-delete" onPress={() => { void connection.call("jagentchill.sync.version.delete", { versionId: version.versionId }).then(load, fail); }} /> : null}
            {!editing ? <Text variant="meta" color="text/secondary">{t("Request to edit to restore a version")}</Text> : null}
          </View>
        </View>
      ))}
    </View>
  );
}

// ── Missing media on a timeline clip ─────────────────────────────────────────────────────────────────────────────────

/** What a clip says while its media is not on this device; null when the media is here. */
export function clipMediaText(transfer: Transfer, t: (text: string, values?: Record<string, string | number>) => string): { text: string; spoken: string } {
  const percent = Math.round((transfer.bytes / Math.max(1, transfer.size)) * 100);
  switch (transfer.state) {
    case "waiting-wifi": return { text: t("Waiting for Wi-Fi"), spoken: t("media not downloaded, waiting for Wi-Fi") };
    case "not-uploaded": return { text: t("File unavailable — Retry"), spoken: t("media file unavailable, retry download") };
    case "too-large": return { text: t("Too large to sync"), spoken: t("media not downloaded, too large to sync") };
    case "no-space": return { text: t("Not enough space on this device"), spoken: t("media not downloaded, not enough space on this device") };
    case "host-full": return { text: t("Host storage full"), spoken: t("media not downloaded, host storage full") };
    case "failed": return { text: t("Download failed — Retry"), spoken: t("media not downloaded, download failed") };
    case "paused": return { text: t("Paused"), spoken: t("media not downloaded, paused") };
    default: return { text: t("Downloading {n}%", { n: percent }), spoken: t("media not downloaded, downloading {n}%", { n: percent }) };
  }
}
/** Over a clip whose media sync has not brought to this device yet: a cloud glyph and the state; pressing it opens the transfer's actions. */
export function ClipSyncOverlay(props: { mediaId: string | undefined; elementId: string; name: string; width: number; height: number }) {
  const t = useT();
  const theme = useTheme();
  const runtime = useEditor();
  const { engine } = useSync();
  const anchor = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const projectId = runtime.controller.stored.metadata.id;
  const transfer = props.mediaId && engine ? engine.mediaState(projectId, props.mediaId) : undefined;
  if (!transfer || !engine) return null;
  const said = clipMediaText(transfer, t);
  return (
    // The timeline takes the pointer for selection and drags; the overlay opens on the press itself, beside the selection.
    <View ref={anchor} style={{ position: "absolute", left: 0, top: 0, width: props.width, height: props.height }} testID="clip-sync-overlay" {...({ onPointerDown: () => setOpen(true) } as object)}>
      <Tap role="button" label={`${props.name}, ${said.spoken}`} onPress={() => setOpen(true)}
        style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space[1], borderRadius: radius.sm, backgroundColor: theme.color("bg/scrim"), overflow: "hidden" }}>
        <Icon name="cloud" size={14} color="clip/label" />
        {props.width > 90 ? <Text variant="meta" color="clip/label" numberOfLines={1}>{said.text}</Text> : null}
      </Tap>
      <Popover open={open} anchor={anchor} onClose={() => setOpen(false)} label={t("Sync activity")}>
        <View style={{ padding: space[3], gap: space[2] }}>
          <Text variant="body-medium">{props.name}</Text>
          <SyncActivity projectId={projectId} />
          {transfer.state === "failed" || transfer.state === "not-uploaded" ? <Button kind="ghost" size="sm" tone="danger" label={t("Remove")} testID="clip-remove-failed-media" onPress={() => { setOpen(false); runtime.controller.run(timeline.deleteElements({ sceneId: runtime.controller.session.sceneId, elementIds: [props.elementId] })); }} /> : null}
          {transfer.variant === "preview" ? <Button size="sm" label={t("Download original")} onPress={() => { setOpen(false); void engine.downloadOriginal(projectId, props.mediaId!); }} /> : null}
        </View>
      </Popover>
    </View>
  );
}
/** Whether a session's project is synced at all (the comments and version controls show only then). */
export const isSynced = (state: SessionState | null): boolean => state !== null && state.status.kind !== "local";
