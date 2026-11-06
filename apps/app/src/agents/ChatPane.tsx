import { useRouter } from "expo-router";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from "react";
import { Image, Platform, ScrollView, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent, type TextInput } from "react-native";
import { AGENT_PREFS, blocksOf, messageLength, noRuntimeReady, pressingLimit, QUEUE_LABEL, rowTop, sendPlan, tokensShort, withCards, type ChatItem } from "@jagentchill/app-core";
import { blobRoutes as protocolBlobRoutes, type QueueMode } from "@jagentchill/protocol";
import { Button, Callout, Checkbox, Icon, IconButton, Input, Modal, Spinner, Tap, Text, compactScale, radius, space, useTheme, useToast, type IconName, type MenuItem, SkeletonChat } from "@jagentchill/ui";
import { AgentComposer } from "./AgentComposer";
import { useSlashCommands } from "./useSlashCommands";
import { useFileDrop } from "./useFileDrop";
import { useHost, type Approval, type Session } from "../host";
import { blobStatus, signedRequest, uploadBlob, sha256Hex } from "@jagentchill/client";
import { loadSigner } from "../identity";
import { useT } from "../locale";
import { copyText, startDictation } from "../platform/media";
import { onWindowKey } from "../platform/store";
import { useSkillPicker } from "../skills/SkillPicker";
import { skillReason } from "../skills/data";
import { useLibraryState, usePref } from "../state";
import type { Chat } from "./chat";
import { ContextMeter, useSessionContext } from "./context";
import type { useSessionControls } from "./controls";
import { useAgentData } from "./data";
import { claimHeldMessage, queueHeldMessage, readDraft, releaseHeldMessage, removeHeldMessage, useDraft, useHeldMessages, writeDraft } from "./drafts";
import { reasonOf } from "./errors";
import { hostSettingsRoute } from "./ModelBrowser";
import { useProposalCards } from "./proposals/ProposalCard";
import { usePermissionCards } from "./PermissionCards";
import { useQuestionCards } from "./QuestionCards";
import { questionCardLayout } from "./questionCardLayout";
import { scrollAnchorShouldLoadOlderAtTop, useScrollAnchor } from "./scrollAnchor";
import { ApprovalCard, Timeline } from "./Timeline";
import { splitAgentNotes } from "./team/AgentNotes";
import { ConversationLeadBar, LeadChat, useConversationLead, useTeamCards } from "./team/Cards";
import { SubAgentsTrack } from "./team/SubAgentsTrack";
import { needsFilePickerNotice, usesDomChatScroll } from "./chatPlatform";

/**
 * The chat pane of a session: the timeline with its approvals, the queued messages, and the docked composer with the
 * model, mode, thinking and skill controls. The session screen and the editor's agent panel draw this same pane.
 */
type ChatPaneProps = {
  session: Session | undefined; sessionKey: string; chat: Chat; controls: ReturnType<typeof useSessionControls>;
  searchOpen?: boolean; onSearchOpen?(): void; onSearchClose?(): void;
  /** A step of the timeline was opened: where its detail is shown. */
  onOpenStep(id: string): void;
  /** Forks the session from one of its messages; without it the pane offers no fork. */
  onFork?(messageId: string): void;
};
type PendingImage = { key: string; name: string; mimeType: string; attachmentId?: string; blobId?: string; thumbnail?: string; size: number; status: "uploading" | "ready" | "failed"; progress: number; error?: string };
type ProjectMediaEntry = { blobId: string; name: string; mime: string; size: number };
type ProjectMediaPickerHandle = { open(): void };
type ConversationMatch = { messageId: string; itemId?: string; kind: "message" | "step"; role: "user" | "assistant"; ts_ms?: number; snippet: string; at: number; newer: number };
const MAX_CHAT_ATTACHMENT_BYTES = 50 * 1024 * 1024;
const CHAT_ATTACHMENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "video/webm", "video/quicktime", "audio/mpeg", "audio/mp4", "audio/wav", "audio/x-wav", "audio/ogg", "audio/webm", "audio/aac", "application/pdf", "text/plain", "text/markdown", "text/csv", "application/json"]);

function ProjectMediaThumbnail({ file, host }: { file: ProjectMediaEntry; host: NonNullable<ReturnType<typeof useHost>["host"]> }) {
  const [thumbnail, setThumbnail] = useState<string>();
  useEffect(() => {
    let live = true, url: string | undefined;
    const timer = setTimeout(() => void (async () => {
      try {
        const env = { host, signer: await loadSigner() }, status = await blobStatus(env, file.blobId), variant = status.variants.thumb;
        // Listing project media must never ask the host to make a preview from the original. Only fetch a small
        // thumbnail the host/library already produced; a missing preview leaves the media type icon in place.
        if (!variant || variant.size > 512 * 1024 || !live) return;
        const response = await signedRequest(env, "GET", protocolBlobRoutes.variant(file.blobId, "thumb"));
        if (!response.ok || !live) return;
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (!live || bytes.byteLength > 512 * 1024 || await sha256Hex(bytes) !== variant.sha256) return;
        if (Platform.OS === "web" && typeof URL.createObjectURL === "function") {
          url = URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
          setThumbnail(url);
        }
      } catch { /* A missing/expired preview does not affect attachment availability. */ }
    })(), 750);
    return () => { live = false; clearTimeout(timer); if (url) URL.revokeObjectURL(url); };
  }, [file.blobId, host]);
  return thumbnail ? <Image source={{ uri: thumbnail }} resizeMode="cover" style={{ width: 56, height: 40, borderRadius: radius.sm, backgroundColor: "#00000010" }} /> : null;
}

const ProjectMediaPicker = forwardRef<ProjectMediaPickerHandle, {
  projectId: string; sessionKey: string; connection: ReturnType<typeof useHost>["connection"]; host: ReturnType<typeof useHost>["host"];
  onAttach(files: ProjectMediaEntry[]): void;
}>(function ProjectMediaPicker({ projectId, sessionKey, connection, host, onAttach }, ref) {
  const t = useT(), theme = useTheme(), router = useRouter();
  const [projectMedia, setProjectMedia] = useState<ProjectMediaEntry[]>([]);
  const [projectMediaLoading, setProjectMediaLoading] = useState(false);
  const [projectMediaOpen, setProjectMediaOpen] = useState(false);
  const [projectMediaQuery, setProjectMediaQuery] = useState("");
  const [selectedProjectMedia, setSelectedProjectMedia] = useState<Set<string>>(() => new Set());
  const projectMediaScroll = useRef<ScrollView>(null);
  const [projectMediaScrollTop, setProjectMediaScrollTop] = useState(0);
  useImperativeHandle(ref, () => ({ open() { setProjectMediaQuery(""); setProjectMediaScrollTop(0); projectMediaScroll.current?.scrollTo({ y: 0, animated: false }); setSelectedProjectMedia(new Set()); setProjectMediaOpen(true); } }), []);
  useEffect(() => {
    if (!connection || !projectId) { setProjectMedia([]); setProjectMediaLoading(false); return; }
    let live = true;
    setProjectMediaLoading(true);
    void connection.call<{ media: ProjectMediaEntry[] }>("jagentchill.chat.attachment.media", { sessionKey }).then((result) => { if (live) setProjectMedia(result.media); }, () => { if (live) setProjectMedia([]); }).finally(() => { if (live) setProjectMediaLoading(false); });
    return () => { live = false; };
  }, [connection, projectId, sessionKey]);
  const closeProjectMedia = () => { setProjectMediaOpen(false); setSelectedProjectMedia(new Set()); };
  const query = projectMediaQuery.trim().toLocaleLowerCase();
  const visibleProjectMedia = query ? projectMedia.filter((file) => `${file.name} ${file.mime}`.toLocaleLowerCase().includes(query)) : projectMedia;
  const firstProjectMediaRow = Math.max(0, Math.floor(projectMediaScrollTop / 56) - 4);
  const renderedProjectMedia = visibleProjectMedia.slice(firstProjectMediaRow, firstProjectMediaRow + 16);
  const attachSelectedProjectMedia = () => {
    const selected = projectMedia.filter((file) => selectedProjectMedia.has(file.blobId));
    closeProjectMedia();
    onAttach(selected);
  };
  return <Modal open={projectMediaOpen} title={t("Select project media")} width={640} onClose={closeProjectMedia}
    footer={<><Button label={t("Cancel")} onPress={closeProjectMedia} /><Button kind="primary" label={t("Attach selected media ({n})", { n: selectedProjectMedia.size })} disabled={!selectedProjectMedia.size} onPress={attachSelectedProjectMedia} /></>}>
    {projectMediaOpen ? projectMediaLoading ? <Spinner label={t("Loading…")} /> : projectMedia.length === 0 ? (
      <View style={{ alignItems: "flex-start", gap: space[2] }} testID="project-media-empty">
        <Text color="text/secondary">{t("No media in this project yet.")}</Text>
        <Button kind="secondary" label={t("Add media in the project editor")} onPress={() => { closeProjectMedia(); router.push(`/editor/${projectId}` as never); }} />
      </View>
    ) : (
      <View testID="project-media-picker" style={{ gap: space[2] }}>
        {projectMedia.length > 8 ? <Input role="searchbox" accessibilityLabel={t("Search media")} placeholder={t("Search media…")} leadingIcon="search" value={projectMediaQuery} onChangeText={(value) => { setProjectMediaQuery(value); setProjectMediaScrollTop(0); projectMediaScroll.current?.scrollTo({ y: 0, animated: false }); }} testID="project-media-search" /> : null}
        {visibleProjectMedia.length === 0 ? <Text color="text/secondary">{t("No media found")}</Text> : <ScrollView
          ref={projectMediaScroll}
          testID="project-media-virtual-list"
          style={{ height: 448 }}
          scrollEventThrottle={32}
          onScroll={(event) => setProjectMediaScrollTop(event.nativeEvent.contentOffset.y)}
        >
          <View style={{ height: firstProjectMediaRow * 56 }} />
          {renderedProjectMedia.map((file) => <View key={file.blobId} testID={`project-media-item-${file.blobId}`} style={{ height: 56, flexDirection: "row", alignItems: "center", gap: space[2], paddingVertical: space[1] }}>
            <Checkbox accessibilityLabel={file.name} checked={selectedProjectMedia.has(file.blobId)} onChange={(checked) => setSelectedProjectMedia((current) => { const next = new Set(current); if (checked) next.add(file.blobId); else next.delete(file.blobId); return next; })} />
            <View style={{ width: 56, height: 40, alignItems: "center", justifyContent: "center", borderRadius: radius.sm, backgroundColor: theme.color("bg/inset") }}>
              <Icon name={file.mime.startsWith("video/") ? "film" : file.mime.startsWith("audio/") ? "music" : "image"} size={16} color="text/secondary" />
              {host ? <View style={{ position: "absolute" }}><ProjectMediaThumbnail file={file} host={host} /></View> : null}
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text variant="body-medium" numberOfLines={1}>{file.name}</Text>
              <Text variant="meta" color="text/secondary" numberOfLines={1}>{file.mime} · {(file.size / 1024).toFixed(0)} KB</Text>
            </View>
          </View>)}
          <View style={{ height: Math.max(0, (visibleProjectMedia.length - firstProjectMediaRow - renderedProjectMedia.length) * 56) }} />
        </ScrollView>}
      </View>
    ) : null}
  </Modal>;
});
/**
 * While another agent of the session leads the conversation (a hand-off the person accepted), the pane is that agent's
 * conversation — what the person writes goes to it — under a line that says who leads and offers the way back.
 */
export function ChatPane(props: ChatPaneProps) {
  const lead = useConversationLead(props.sessionKey);
  if (!lead) return <SessionChatPane {...props} />;
  return <LeadChat key={lead.sessionKey} lead={lead} render={(chat, session) => <SessionChatPane {...props} session={session} sessionKey={lead.sessionKey} chat={chat} onFork={undefined} home={{ sessionKey: props.sessionKey, lead }} />} />;
}
function SessionChatPane(props: ChatPaneProps & { /** The session this pane stands in, when it shows the conversation of the agent that leads it. */ home?: { sessionKey: string; lead: NonNullable<ReturnType<typeof useConversationLead>> } }) {
  const t = useT();
  const theme = useTheme();
  const toast = useToast();
  const router = useRouter();
  const { session, sessionKey, controls } = props;
  const { chat, loading, error, userMessageIds, stopping, send, stop, status: addStatus, reload, hasOlder, loadingOlder, loadOlder } = props.chat;
  const { host, connection, status, approvals, can, role } = useHost();
  const data = useAgentData();
  const projectMediaPicker = useRef<ProjectMediaPickerHandle>(null);
  const commandList = useSlashCommands({ sessionKey, ref: session?.ref, agentId: session?.agentId, modelLabel: session?.ref?.modelId });
  const library = useLibraryState();
  const skillPicker = useSkillPicker(session, controls.anchor);
  const context = useSessionContext(session?.sessionKey);
  // The draft is held by the composer itself (`DraftComposer`): this pane reads it when it acts, so a key press renders
  // the composer and not the conversation above it.
  const draftKey = `session:${sessionKey}`;
  const setDraft = (next: string) => writeDraft(draftKey, next);
  const [notice, setNotice] = useState<string | null>(null);
  const [images, setImages] = useState<PendingImage[]>([]);
  const [defaultSend] = usePref(AGENT_PREFS.defaultSend);
  const [dictating, setDictating] = useState(false);
  const stopDictation = useRef<(() => void) | null>(null);
  const scroll = useRef<ScrollView>(null);
  // The pane follows the newest content while the reader is at the bottom; once they scroll up it stays where they
  // read and offers a jump down instead.
  const follow = useRef(true);
  const readerMovedUpSinceSend = useRef(false);
  const lastOffset = useRef(0), lastHeight = useRef(0);
  const [newBelow, setNewBelow] = useState(false);
  const [focusRow, setFocusRow] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMatches, setSearchMatches] = useState<ConversationMatch[]>([]);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchIndex, setSearchIndex] = useState(0);
  const [searching, setSearching] = useState(false);
  const [searchHit, setSearchHit] = useState<{ id: string; term: string } | null>(null);
  const [searchTopPadding, setSearchTopPadding] = useState(0);
  const searchTopPaddingRef = useRef(0);
  const [searchSettled, setSearchSettled] = useState(false);
  const searchJumpActive = useRef(false);
  const [localSearchOpen, setLocalSearchOpen] = useState(false);
  const searchOpen = props.searchOpen ?? localSearchOpen;
  const { width: windowWidth } = useWindowDimensions();
  const [searchChosen, setSearchChosen] = useState(false);
  const openSearch = props.onSearchOpen ?? (() => setLocalSearchOpen(true));
  const closeSearch = props.onSearchClose ?? (() => setLocalSearchOpen(false));
  const searchOriginalTop = useRef<number | null>(null);
  const searchOriginalBottom = useRef(false);
  const searchOriginalAnchor = useRef<{ key: string; offset: number } | null>(null);
  const searchRestoringAnchor = useRef(false);
  const chatScrollElement = () => Platform.OS === "web" && typeof document !== "undefined" ? [...document.querySelectorAll<HTMLElement>('[data-testid="chat-scroll"]')]
    .filter((node) => { const rect = node.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; })
    .sort((a, b) => { const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect(); return br.width * br.height - ar.width * ar.height; })[0] : undefined;
  const rememberSearchScroll = () => {
    if (searchOriginalTop.current !== null) return;
    const list = chatScrollElement();
    searchOriginalTop.current = list?.scrollTop ?? view.current.top;
    searchOriginalBottom.current = list ? list.scrollHeight - list.clientHeight - list.scrollTop < 48 : view.current.contentHeight - view.current.height - view.current.top < 48;
    if (list && !searchOriginalBottom.current) {
      const bounds = list.getBoundingClientRect();
      const row = [...list.querySelectorAll<HTMLElement>("[data-wkey]")].find((node) => {
        const rect = node.getBoundingClientRect(); return rect.bottom > bounds.top + 1 && rect.top < bounds.bottom - 1;
      });
      if (row?.dataset.wkey) {
        searchOriginalAnchor.current = { key: row.dataset.wkey, offset: row.getBoundingClientRect().top - bounds.top };
        anchor.hold(searchOriginalAnchor.current);
      }
    }
  };
  const beginSearch = () => { rememberSearchScroll(); openSearch(); };
  const searchSequence = useRef(0);
  const searchJumpSequence = useRef(0);
  const currentChat = useRef({ items: chat.items, hasOlder, loadingOlder, loading, loadOlder });
  currentChat.current = { items: chat.items, hasOlder, loadingOlder, loading, loadOlder };
  const olderAtTopIntent = useRef(false);
  if (typeof window !== "undefined") {
    const trace = (window as Window & { __w11ScrollTrace?: { hasOlder?: boolean; loadingOlder?: boolean } }).__w11ScrollTrace;
    if (trace) { trace.hasOlder = hasOlder; trace.loadingOlder = loadingOlder; }
  }
  const toBottom = (animated: boolean) => {
    if (searchJumpActive.current || searchHit) return;
    follow.current = true; setNewBelow(false); requestWindow(); scroll.current?.scrollToEnd({ animated });
  };
  // A long conversation is not mounted whole: the timeline mounts the rows around the viewport (`listWindow`) from the
  // heights measured here; a frame after the reader scrolled far enough, or a row was measured, the window is worked out again.
  const heights = useRef(new Map<string, number>());
  const view = useRef({ top: 0, height: 0, contentHeight: 0, windowTop: 0 });
  const [, setWindowTick] = useState(0);
  const windowFrame = useRef<number | null>(null);
  const requestWindow = useCallback(() => {
    if (windowFrame.current !== null) return;
    const run = () => { windowFrame.current = null; setWindowTick((tick) => tick + 1); };
    windowFrame.current = typeof requestAnimationFrame === "function" ? requestAnimationFrame(run) : (setTimeout(run, 16) as unknown as number);
  }, []);
  const measure = useCallback((key: string, height: number) => {
    const rounded = Math.round(height);
    if (Math.abs((heights.current.get(key) ?? -1) - rounded) < 1) return;
    heights.current.set(key, rounded);
    requestWindow();
  }, [requestWindow]);
  const prependedBy = useRef(0);
  const anchor = useScrollAnchor(scroll, () => !follow.current, { take: () => { const height = prependedBy.current; prependedBy.current = 0; return height; }, placed: (top) => { view.current.top = top; }, hasOlder: () => currentChat.current.hasOlder });
  useEffect(() => {
    if (!olderAtTopIntent.current || !hasOlder || loading || loadingOlder || searchJumpActive.current || searchHit) {
      if (!hasOlder) olderAtTopIntent.current = false;
      return;
    }
    const list = (scroll.current as unknown as { getScrollableNode?(): HTMLElement | null } | null)?.getScrollableNode?.();
    if (!list || !scrollAnchorShouldLoadOlderAtTop(list.scrollTop, olderAtTopIntent.current, hasOlder, loadingOlder)) return;
    const frame = requestAnimationFrame(() => {
      const current = (scroll.current as unknown as { getScrollableNode?(): HTMLElement | null } | null)?.getScrollableNode?.();
      if (current && scrollAnchorShouldLoadOlderAtTop(current.scrollTop, olderAtTopIntent.current, currentChat.current.hasOlder, currentChat.current.loading || currentChat.current.loadingOlder)) void currentChat.current.loadOlder();
    });
    return () => cancelAnimationFrame(frame);
  }, [hasOlder, loading, loadingOlder, loadOlder, searchHit]);
  useEffect(() => {
    if (!usesDomChatScroll(Platform.OS)) return;
    const list = (scroll.current as unknown as { getScrollableNode?(): HTMLElement | null } | null)?.getScrollableNode?.();
    if (!list) return;
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) {
        follow.current = false; readerMovedUpSinceSend.current = true; olderAtTopIntent.current = true;
        if (anchor.scrollAtTop(event.deltaY)) requestWindow();
        if (scrollAnchorShouldLoadOlderAtTop(list.scrollTop, true, currentChat.current.hasOlder, currentChat.current.loading || currentChat.current.loadingOlder)) void currentChat.current.loadOlder();
        return;
      }
      if (event.deltaY > 0) olderAtTopIntent.current = false;
      if (event.deltaY > 0) requestAnimationFrame(() => {
        const atEnd = list.scrollHeight - list.clientHeight - list.scrollTop <= 48;
        if (atEnd) { follow.current = true; readerMovedUpSinceSend.current = false; }
      });
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target !== list || !["PageUp", "PageDown", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Home") { anchor.resetForExplicitTop(); olderAtTopIntent.current = true; }
      const maxTop = Math.max(0, list.scrollHeight - list.clientHeight);
      const target = event.key === "Home" ? 0
        : event.key === "End" ? maxTop
          : Math.max(0, Math.min(maxTop, list.scrollTop + (event.key === "PageDown" ? 1 : -1) * list.clientHeight));
      list.scrollTop = target;
      scroll.current?.scrollTo({ y: target, animated: false });
      if (event.key === "Home" && scrollAnchorShouldLoadOlderAtTop(list.scrollTop, true, currentChat.current.hasOlder, currentChat.current.loading || currentChat.current.loadingOlder)) void currentChat.current.loadOlder();
    };
    list.addEventListener("wheel", onWheel, { passive: true });
    list.addEventListener("keydown", onKeyDown);
    return () => { list.removeEventListener("wheel", onWheel); list.removeEventListener("keydown", onKeyDown); };
  }, []);
  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const atBottom = contentSize.height - layoutMeasurement.height - contentOffset.y < 48;
    const resized = view.current.height !== layoutMeasurement.height;
    view.current.top = contentOffset.y; view.current.height = layoutMeasurement.height; view.current.contentHeight = contentSize.height;
    const windowTop = anchor.windowTop(contentOffset.y);
    if (!searchJumpActive.current && !searchHit && (resized || Math.abs(windowTop - view.current.windowTop) > 240)) requestWindow();
    if (!searchRestoringAnchor.current) anchor.capture();
    // Near the first loaded message: the page before it is read, and put above without moving what is being read.
    if (!searchJumpActive.current && !searchHit && contentOffset.y < 1500 && hasOlder && !loadingOlder && !loading) void loadOlder();
    // Any move up is the reader leaving the end, however small: the next piece of text must not pull them back.
    // (Content that got shorter — the transcript was read again — also lowers the offset; that is not the reader.)
    const movedUp = contentOffset.y < lastOffset.current - 2 && contentSize.height >= lastHeight.current - 2;
    lastOffset.current = contentOffset.y; lastHeight.current = contentSize.height;
    follow.current = searchJumpActive.current || searchHit ? false : movedUp ? false : atBottom || follow.current;
    if (atBottom && newBelow) setNewBelow(false);
  };
  useEffect(() => {
    const query = searchQuery.trim();
    if (!searchOpen || !query || !connection) { setSearchMatches([]); setSearchTotal(0); setSearching(false); setSearchIndex(0); setSearchChosen(false); return; }
    setSearchChosen(false);
    const request = ++searchSequence.current;
    const timer = setTimeout(() => {
      setSearching(true);
      void connection.call<{ total: number; matches: ConversationMatch[] }>("jagentchill.chat.search", { sessionKey, query, limit: 100 }).then((result) => {
        if (request !== searchSequence.current) return;
        setSearchMatches(result.matches ?? []); setSearchTotal(result.total ?? 0); setSearchIndex(0);
      }).catch(() => {
        if (request === searchSequence.current) { setSearchMatches([]); setSearchTotal(0); }
      }).finally(() => { if (request === searchSequence.current) setSearching(false); });
    }, 160);
    return () => { clearTimeout(timer); searchSequence.current += 1; };
  }, [connection, sessionKey, searchOpen, searchQuery]);
  const stepSearch = (delta: number) => {
    if (!searchMatches.length) return;
    const next = (searchIndex + delta + searchMatches.length) % searchMatches.length;
    setSearchIndex(next);
    setSearchChosen(true);
    void jumpToSearchResult(searchMatches[next]!);
  };
  async function jumpToSearchResult(match: ConversationMatch): Promise<void> {
    const request = ++searchJumpSequence.current;
    searchJumpActive.current = true;
    rememberSearchScroll();
    follow.current = false;
    const target = match.itemId ?? match.messageId;
    const initialSearchSpace = Math.ceil((chatScrollElement()?.clientHeight ?? view.current.height ?? 600) * 0.45);
    searchTopPaddingRef.current = initialSearchSpace;
    setSearchTopPadding(initialSearchSpace);
    setSearchSettled(false);
    setSearchChosen(true);
    setSearchHit({ id: target, term: searchQuery.trim() });
    try {
      await props.chat.loadSearchResult(match.newer);
      if (request !== searchJumpSequence.current) return;
      setFocusRow(target);
      if (Platform.OS !== "web" || typeof document === "undefined") {
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        const blocks = blocksOf(currentChat.current.items);
        const targetBlock = blocks.find((block) => block.kind === "activity"
          ? block.steps.some((step) => step.id === target)
          : block.kind === "item" && block.item.id === target);
        const key = targetBlock ? targetBlock.kind === "item" ? targetBlock.item.id : targetBlock.id : target;
        const keys = blocks.map((block) => block.kind === "item" ? block.item.id : block.id);
        const top = rowTop(keys, heights.current, 96, key, space[3]) ?? 0;
        const rowHeight = heights.current.get(key) ?? 96;
        const centered = top - Math.max(0, ((view.current.height || 600) - rowHeight) / 2);
        scroll.current?.scrollTo({ y: Math.max(0, space[4] + searchTopPaddingRef.current + centered), animated: false });
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        if (request === searchJumpSequence.current) setSearchSettled(true);
        return;
      }
      let row: Element | null = null;
      for (let frame = 0; frame < 120 && !row; frame++) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        row = [...document.querySelectorAll<HTMLElement>(`[data-search-id="${CSS.escape(target)}"]`)]
          .find((node) => { const rect = node.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; }) ?? null;
      }
      const list = chatScrollElement();
      if (request === searchJumpSequence.current && row && list) {
        let stable = 0;
        for (let attempt = 0; attempt < 24 && stable < 2; attempt++) {
          const current = [...document.querySelectorAll<HTMLElement>(`[data-search-id="${CSS.escape(target)}"]`)]
            .find((node) => { const rect = node.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; });
          if (!current) break;
          const a = list.getBoundingClientRect(), b = current.getBoundingClientRect();
          const centerOffset = Math.max(0, (a.height - b.height) / 2);
          const requested = list.scrollTop + b.top - a.top - centerOffset;
          if (requested < 0 && searchTopPaddingRef.current === 0) {
            searchTopPaddingRef.current = Math.ceil(-requested);
            setSearchTopPadding(searchTopPaddingRef.current);
          }
          const centered = Math.max(0, Math.min(list.scrollHeight - list.clientHeight, requested));
          list.scrollTop = centered;
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          const after = current.getBoundingClientRect(), pane = list.getBoundingClientRect();
          const onCenter = Math.abs((after.top + after.bottom) / 2 - (pane.top + pane.bottom) / 2) < 5;
          stable = onCenter ? stable + 1 : 0;
        }
        const finalRow = [...document.querySelectorAll<HTMLElement>(`[data-search-id="${CSS.escape(target)}"]`)]
          .find((node) => { const rect = node.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; });
        finalRow?.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" as ScrollBehavior });
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        if (request === searchJumpSequence.current) setSearchSettled(true);
      }
    } catch (err) { toast.show({ kind: "error", message: reasonOf(err) }); }
    finally { searchJumpActive.current = false; }
  }
  const dismissSearch = () => {
    searchJumpSequence.current += 1;
    searchJumpActive.current = false;
    skipNextAutoScroll.current = true;
    props.chat.restoreSearchView();
    setSearchHit(null); setFocusRow(null); setSearchQuery(""); setSearchMatches([]); setSearchTotal(0); setSearchIndex(0);
    searchTopPaddingRef.current = 0;
    setSearchTopPadding(0);
    setSearchSettled(false);
    const top = searchOriginalTop.current;
    const bottom = searchOriginalBottom.current;
    const readingAnchor = searchOriginalAnchor.current;
    searchOriginalTop.current = null;
    searchOriginalBottom.current = false;
    searchOriginalAnchor.current = null;
    searchRestoringAnchor.current = !bottom && !!readingAnchor;
    closeSearch();
    if (Platform.OS !== "web" || typeof document === "undefined") {
      searchRestoringAnchor.current = false;
      if (top !== null) {
        if (bottom) scroll.current?.scrollToEnd({ animated: false });
        else scroll.current?.scrollTo({ y: top, animated: false });
        view.current.top = bottom ? Math.max(0, view.current.contentHeight - view.current.height) : top;
        follow.current = bottom || view.current.top < 2;
      }
      skipNextAutoScroll.current = false;
      return;
    }
    if (top !== null) {
      if (!bottom && readingAnchor) { setFocusRow(readingAnchor.key); anchor.hold(readingAnchor); prependedBy.current = 0; }
      const restore = (attempt = 0, stable = 0) => {
        const list = chatScrollElement();
        if (bottom && list) { list.scrollTop = list.scrollHeight - list.clientHeight; scroll.current?.scrollToEnd({ animated: false }); }
        else if (list && readingAnchor) {
          const row = [...list.querySelectorAll<HTMLElement>("[data-wkey]")].find((node) => node.dataset.wkey === readingAnchor.key);
          if (!row && attempt < 120) { requestAnimationFrame(() => restore(attempt + 1)); return; }
          if (row) {
            const offset = row.getBoundingClientRect().top - list.getBoundingClientRect().top;
            const delta = offset - readingAnchor.offset;
            if (Math.abs(delta) > 2) {
              const y = list.scrollTop + delta;
              list.scrollTop = y; scroll.current?.scrollTo({ y, animated: false });
              requestAnimationFrame(() => restore(attempt + 1)); return;
            }
            if (stable < 3 && attempt < 120) { requestAnimationFrame(() => restore(attempt + 1, stable + 1)); return; }
          }
          searchRestoringAnchor.current = false;
        } else { anchor.restore(); }
        const restored = list?.scrollTop ?? top;
        view.current.top = restored; follow.current = bottom || restored < 2;
      };
      requestAnimationFrame(() => requestAnimationFrame(() => restore()));
    }
    requestAnimationFrame(() => requestAnimationFrame(() => { skipNextAutoScroll.current = false; }));
  };
  const wasSearchOpen = useRef(searchOpen);
  useEffect(() => {
    if (searchOpen && !wasSearchOpen.current) rememberSearchScroll();
    wasSearchOpen.current = searchOpen;
  }, [searchOpen]);
  useEffect(() => onWindowKey((event) => {
    if ((event.meta || event.ctrl) && !event.alt && event.key.toLowerCase() === "f") { event.preventDefault(); beginSearch(); return; }
    if (!searchOpen) return;
    if (event.key === "Escape") { event.preventDefault(); dismissSearch(); }
    else if (event.key === "Enter" || event.key === "ArrowDown" || event.key === "ArrowRight") { event.preventDefault(); stepSearch(event.shift ? -1 : 1); }
    else if (event.key === "ArrowUp" || event.key === "ArrowLeft") { event.preventDefault(); stepSearch(-1); }
  }), [searchOpen, searchMatches.length, searchIndex, openSearch, closeSearch, searchQuery]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (searchOpen) setSearchQuery(""); }, [searchOpen]);
  // "New messages" is about the END of the conversation: older messages put in above, or rows measured, also change
  // the content's size and are not news.
  const tail = chat.items.at(-1), tailMark = tail ? `${tail.id}:${"text" in tail ? tail.text.length : 0}:${tail.kind === "tool" ? tail.status : ""}` : "";
  const seenTail = useRef(tailMark);
  const onGrew = () => {
    if (searchJumpActive.current || searchHit) { follow.current = false; seenTail.current = tailMark; return; }
    if (follow.current) { seenTail.current = tailMark; scroll.current?.scrollToEnd({ animated: false }); }
    else if (!newBelow && seenTail.current !== tailMark) setNewBelow(true);
  };
  const questionCards = useQuestionCards({ sessionKey });
  const permissionCards = usePermissionCards({ sessionKey });
  const proposalCards = useProposalCards({ sessionKey, session });
  const input = useRef<TextInput | null>(null);
  const mine = approvals.filter((approval) => approval.sessionKey === sessionKey);
  const connected = status === "connected";
  const mayAct = connected && can("jagentchill.agent.use") && role !== "viewer";
  const plan = sendPlan(defaultSend);
  const runtimeLabel = controls.group?.label ?? "";

  // A session that moves to another project says so in its timeline.
  const boundTo = useRef<string | undefined | null>(null);
  useEffect(() => {
    if (!session) return;
    if (boundTo.current !== null && boundTo.current !== session.projectId && session.projectId) {
      const name = library.projects.find((entry) => entry.id === session.projectId)?.name;
      if (name) addStatus(t("Now working on {project}", { project: name }));
    }
    boundTo.current = session.projectId;
  }, [session?.projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // A compaction runs (the host says so from its start): the timeline shows it, and a message written meanwhile is held
  // here and sent the moment it is over — the summary would otherwise be made of a conversation that is already longer.
  const compacting = context.state?.compacting;
  const held = useHeldMessages(draftKey);
  const sendHeld = useRef<(text: string) => void>(() => undefined);
  useEffect(() => {
    if (compacting || !held.length) return;
    sendHeld.current(held[0]!);
  }, [compacting, held]);
  async function submit(mode?: QueueMode) {
    const text = readDraft(draftKey).trim();
    if ((!text && !images.length) || messageLength(readDraft(draftKey)).over || !mayAct) return;
    if (images.some((image) => image.status !== "ready" || !image.attachmentId)) { setNotice(t("Wait for attachments to finish uploading before sending.")); return; }
    if (compacting && text !== "/compact") { setDraft(""); setNotice(null); queueHeldMessage(draftKey, text); return; }
    // `/compact` is carried out by the host; it is never sent to the model.
    if (text === "/compact") {
      if (context.state?.compaction !== "host") { setNotice(t("{runtime} compacts its context by itself.", { runtime: runtimeLabel })); return; }
      if (chat.running) { setNotice(t("Compact when the turn has ended.")); return; }
      setDraft(""); setNotice(null);
      void context.compact();
      return;
    }
    readerMovedUpSinceSend.current = false;
    setDraft(""); setNotice(null);
    const typedCommand = /^\/([a-z0-9][a-z0-9_-]*)(?:\s|$)/i.exec(text)?.[1]?.toLowerCase();
    const isListedCommand = !!typedCommand && commandList.commands.some((entry) => entry.name.toLowerCase() === typedCommand);
    // The attached skills are named in front of the message; a skill that may not be used stops the send.
    let message: string;
    try { message = isListedCommand ? text : await skillPicker.prepare(text); } catch (err) { setDraft(text); setNotice(skillReason(err)); return; }
    const ready = images.filter((image) => image.attachmentId);
    const attachedText = message || (ready.length ? t("Please review the attached files.") : message);
    const outcome = await send(attachedText, chat.running ? mode ?? plan.primary : undefined, runtimeLabel, ready.map((entry) => ({ attachmentId: entry.attachmentId!, blobId: entry.blobId!, name: entry.name, mime: entry.mimeType, size: entry.size })));
    // A message that was not delivered goes back into the input.
    if (outcome.restore) setDraft(text); else setImages([]);
    if (outcome.notice) setNotice(t(outcome.notice));
  }
  sendHeld.current = (text) => {
    if (!claimHeldMessage(draftKey, text)) return;
    void (async () => {
      let message: string;
      try { message = await skillPicker.prepare(text); } catch (err) { removeHeldMessage(draftKey, text); setDraft(text); setNotice(skillReason(err)); releaseHeldMessage(draftKey, text); return; }
      const ready = images.filter((image) => image.status === "ready" && image.attachmentId);
      const outcome = await send(message, undefined, runtimeLabel, ready.map((entry) => ({ attachmentId: entry.attachmentId!, blobId: entry.blobId!, name: entry.name, mime: entry.mimeType, size: entry.size })));
      if (outcome.restore) { removeHeldMessage(draftKey, text); setDraft(text); }
      else removeHeldMessage(draftKey, text);
      releaseHeldMessage(draftKey, text);
    })();
  };
  async function answer(approval: Approval, decision: "allow-once" | "allow-session" | "deny") {
    try { await connection?.call("jagentchill.approval.resolve", { approvalId: approval.approvalId, decision }); }
    catch (err) { toast.show({ kind: "error", message: reasonOf(err) }); }
  }
  // Questions, proposals, notices and approvals stand where they happened; what comes after them is drawn below them.
  const teamCards = useTeamCards({ sessionKey, mayAct });
  const agentNotes = splitAgentNotes(chat.items, teamCards);
  const pendingQuestion = questionCards.some((card) => card.pending);
  const questionLayout = questionCardLayout(questionCards);
  const pinnedQuestions = questionLayout.pinned ? [{
    ...questionLayout.pinned,
    node: <View testID="pending-question-block" style={{ gap: space[3] }}>{questionLayout.pinned.cards.map((card) => <View key={card.id}>{card.node}</View>)}</View>,
  }] : [];
  const cards: Array<{ id: string; ts_ms: number; node: ReactNode; pending?: boolean }> = [
    ...questionLayout.settled, ...pinnedQuestions, ...permissionCards, ...proposalCards, ...agentNotes.cards, ...teamCards.cards,
    ...mine.map((approval) => ({ id: `approval-${approval.approvalId}`, ts_ms: approval.requested_ms ?? Number.MAX_SAFE_INTEGER, pending: true, node: <ApprovalCard approval={approval} onAnswer={(decision) => answer(approval, decision)} /> as ReactNode })),
  ];
  const marked = context.marked(agentNotes.items);
  // A card stands where it happened. While the transcript has pages further back that are not loaded, a card from
  // before the first loaded message has no place yet: it is put in when its page is (it was piled above the first
  // loaded row before — and moved away under the reader every time a page arrived).
  const firstLoaded = hasOlder ? marked.find((item) => (item.kind === "user" || item.kind === "assistant") && typeof item.ts_ms === "number") as { ts_ms: number } | undefined : undefined;
  const shownCards = firstLoaded ? cards.filter((card) => card.ts_ms >= firstLoaded.ts_ms) : cards;
  const waitingOlder = firstLoaded ? cards.filter((card) => card.pending && card.ts_ms < firstLoaded.ts_ms).sort((a, b) => a.ts_ms - b.ts_ms) : [];
  const placed = shownCards.map((card) => `${card.id}@${card.ts_ms}`).join("|");
  const items = useMemo(() => withCards(marked, shownCards.map(({ id, ts_ms }) => ({ id, ts_ms }))), [marked, placed]); // eslint-disable-line react-hooks/exhaustive-deps
  // The reader's own message always brings the pane back to the newest content.
  const lastUser = chat.items.findLast((item) => item.kind === "user")?.id;
  const lastUserSeen = useRef(lastUser);
  const skipNextAutoScroll = useRef(false);
  useEffect(() => {
    const changed = lastUser !== lastUserSeen.current;
    lastUserSeen.current = lastUser;
    if (!changed || !lastUser) return;
    if (skipNextAutoScroll.current) { skipNextAutoScroll.current = false; return; }
    if (readerMovedUpSinceSend.current) { readerMovedUpSinceSend.current = false; return; }
    if (!searchHit) toBottom(false);
  }, [lastUser, searchHit]); // eslint-disable-line react-hooks/exhaustive-deps
  async function jumpToWaiting(): Promise<void> {
    const target = waitingOlder[0];
    if (!target) return;
    follow.current = false;
    for (let page = 0; page < 100; page++) {
      const first = currentChat.current.items.find((item) => (item.kind === "user" || item.kind === "assistant") && typeof item.ts_ms === "number") as { ts_ms: number } | undefined;
      if (!currentChat.current.hasOlder || currentChat.current.loading || currentChat.current.loadingOlder || first && first.ts_ms <= target.ts_ms) break;
      const before = currentChat.current.items.length;
      await loadOlder();
      // loadOlder resolves after scheduling React state. Wait for the page to commit before deciding that it made no progress.
      for (let frame = 0; frame < 120 && currentChat.current.items.length <= before; frame++) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
      if (currentChat.current.items.length <= before) break;
    }
    setFocusRow(target.id);
    if (Platform.OS !== "web" || typeof document === "undefined") {
      const blocks = blocksOf(currentChat.current.items), keys = blocks.map((block) => block.kind === "item" ? block.item.id : block.id);
      const top = rowTop(keys, heights.current, 96, target.id, space[3]);
      if (top !== null) scroll.current?.scrollTo({ y: Math.max(0, space[4] + top - 32), animated: false });
      setTimeout(() => setFocusRow(null), 300);
      return;
    }
    let row: Element | null = null;
    for (let frame = 0; frame < 60 && !row; frame++) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      row = document.querySelector(`[data-wkey="${CSS.escape(target.id)}"]`);
    }
    const list = document.querySelector('[data-testid="chat-scroll"]');
    if (row && list) {
      const a = list.getBoundingClientRect(), b = row.getBoundingClientRect();
      scroll.current?.scrollTo({ y: list.scrollTop + b.top - a.top - 32, animated: false });
      setTimeout(() => setFocusRow(null), 300);
    }
  }
  const dictate = () => {
    if (dictating) { stopDictation.current?.(); return; }
    const draft = readDraft(draftKey), base = draft ? `${draft.replace(/\s+$/, "")} ` : "";
    let spoken = "";
    const end = startDictation(theme.locale, {
      onText: (text, final) => { if (final) spoken += text; setDraft(`${base}${spoken}${final ? "" : text}`); },
      onEnd: (reason) => { setDictating(false); stopDictation.current = null; if (reason && reason !== "aborted" && reason !== "no-speech") toast.show({ kind: "warning", message: reason === "not-allowed" ? t("Allow the microphone to dictate") : t("Dictation stopped: {reason}", { reason }) }); },
    });
    if (!end) { toast.show({ kind: "info", message: t("Dictation is not available in this browser") }); return; }
    stopDictation.current = end; setDictating(true);
  };
  const canFork = controls.group?.capabilities.fork === true && !controls.group.requiresFullAccess;
  const userMenu = (item: Extract<ChatItem, { kind: "user" }>, index: number): MenuItem[] => [
    { id: "copy", label: t("Copy message"), icon: "copy", onSelect: () => void copyText(item.text) },
    ...(props.onFork ? [{ id: "fork", label: t("Fork from here"), icon: "split" as IconName, disabled: !mayAct || !canFork || !userMessageIds[index] || !session, onSelect: () => props.onFork!(userMessageIds[index]) }] : []),
  ];
  const sendOptions: MenuItem[] = chat.running
    ? (["steer", "interrupt", "followup"] as QueueMode[]).map((mode) => ({ id: mode, label: t(QUEUE_LABEL[mode]), icon: (mode === "steer" ? "arrow-up" : mode === "interrupt" ? "stop" : "clock") as IconName, checked: mode === plan.primary, onSelect: () => void submit(mode) }))
    : [];
  function addFiles(files: FileList | File[]): void {
    const valid: { file: File; mimeType: string; key: string }[] = [];
    for (const file of Array.from(files)) {
      const mimeType = file.type;
      if (!CHAT_ATTACHMENT_TYPES.has(mimeType)) { setNotice(t("{name} has a file type this chat does not accept. Accepted: images, video, audio, PDF and text files.", { name: file.name })); continue; }
      if (file.size > MAX_CHAT_ATTACHMENT_BYTES) { setNotice(t("{name} is too large. Attachments must be 50 MB or smaller.", { name: file.name })); continue; }
      if (images.length + valid.length >= 10) { setNotice(t("This chat accepts up to 10 files per message.")); break; }
      valid.push({ file, mimeType, key: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}` });
    }
    const entries = valid.map(({ file, mimeType, key }) => ({ key, name: file.name || t("Attachment"), mimeType, size: file.size, status: "uploading" as const, progress: 0,
      ...(Platform.OS === "web" && mimeType.startsWith("image/") && typeof URL.createObjectURL === "function" ? { thumbnail: URL.createObjectURL(file) } : {}) }));
    if (entries.length) setImages((current) => [...current, ...entries]);
    valid.forEach(({ file, mimeType, key }) => {
      void (async () => {
        try {
          if (!host || !connection) throw new Error(t("Connect to a host before attaching files."));
          const bytes = new Uint8Array(await file.arrayBuffer()), blobId = await sha256Hex(bytes), signer = await loadSigner();
          await uploadBlob({ host, signer }, { sha256: blobId, size: bytes.length, mime: mimeType, name: file.name || t("Attachment"), purpose: "media", read: async (start, end) => bytes.subarray(start, end) }, {
            onProgress: ({ bytes: sent, total }) => setImages((list) => list.map((item) => item.key === key ? { ...item, progress: total ? Math.min(95, Math.round(sent / total * 95)) : 95 } : item)),
          });
          const registered = await connection.call<{ attachment: { attachmentId: string } }>("jagentchill.chat.attachment.create", { sessionKey, blobId, name: file.name || t("Attachment"), mime: mimeType, size: file.size });
          setImages((list) => list.map((item) => item.key === key ? { ...item, attachmentId: registered.attachment.attachmentId, blobId, status: "ready", progress: 100 } : item));
        } catch (error) {
          setImages((list) => list.map((item) => item.key === key ? { ...item, status: "failed", error: reasonOf(error) } : item));
        }
      })();
    });
  }
  function pickFiles(): void {
    if (needsFilePickerNotice(Platform.OS, typeof document !== "undefined")) {
      setNotice(t("File attachments are not available on this device yet."));
      return;
    }
    const picker = document.createElement("input"); picker.type = "file"; picker.accept = [...CHAT_ATTACHMENT_TYPES].join(","); picker.multiple = true;
    picker.setAttribute("data-testid", "chat-attachment-picker"); picker.onchange = () => { if (picker.files) addFiles(picker.files); picker.remove(); };
    picker.click();
  }
  async function addProjectMedia(file: ProjectMediaEntry): Promise<void> {
    if (!connection) return;
    const key = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    setImages((current) => [...current, { key, name: file.name, mimeType: file.mime, blobId: file.blobId, size: file.size, status: "uploading", progress: 50 }]);
    try {
      const made = await connection.call<{ attachment: { attachmentId: string } }>("jagentchill.chat.attachment.create", { sessionKey, blobId: file.blobId, name: file.name, mime: file.mime, size: file.size });
      setImages((current) => current.map((entry) => entry.key === key ? { ...entry, attachmentId: made.attachment.attachmentId, status: "ready", progress: 100 } : entry));
    } catch (error) {
      setImages((current) => current.map((entry) => entry.key === key ? { ...entry, status: "failed", error: reasonOf(error) } : entry));
    }
  }
  const openProjectMedia = () => projectMediaPicker.current?.open();
  const attachOptions: MenuItem[] = [
    { id: "choose-files", label: t("Choose files"), icon: "plus", onSelect: pickFiles },
    ...(session?.projectId ? [{ id: "project-media", label: t("From project media"), icon: "film" as IconName, requiresHost: true, onSelect: openProjectMedia }] : []),
  ];
  const dropSurface = useRef<View>(null);
  useFileDrop(dropSurface, (files) => addFiles(files));
  const limit = pressingLimit(context.state?.limits);
  const banner = !connected ? <BannerRow icon="info" text={t("Host offline — reconnecting…")} />
    : role === "viewer" ? <BannerRow icon="eye" text={t("Viewers can read this session")} />
    : noRuntimeReady(data.catalogue) ? <BannerRow icon="warn" text={role === "admin" ? t("Set up an AI runtime") : t("Ask an admin device to set up a runtime")} action={role === "admin" && host ? <Button size="xs" label={t("Open settings")} onPress={() => router.push(hostSettingsRoute(host.gatewayId, "runtimes") as never)} /> : undefined} />
    : controls.group && controls.group.readiness !== "ready" && controls.group.readiness !== "loading" ? <BannerRow icon="warn" text={`${controls.group.label}: ${controls.group.error?.message ?? t("not available")}`} action={<Button size="xs" label={t("Choose another runtime")} onPress={controls.modelPill.onPress} />} />
    : limit ? <BannerRow icon="warn" danger={limit.exhausted}
        text={limit.scope === "session"
          ? (limit.exhausted ? t("This session reached its token limit ({used} of {limit}). Raise the limit to continue.", { used: tokensShort(limit.usedTokens), limit: tokensShort(limit.limitTokens) }) : t("This session used {pct}% of its token limit ({used} of {limit}).", { pct: limit.pct, used: tokensShort(limit.usedTokens), limit: tokensShort(limit.limitTokens) }))
          : (limit.exhausted ? t("This host reached its token limit for today ({used} of {limit}).", { used: tokensShort(limit.usedTokens), limit: tokensShort(limit.limitTokens) }) : t("This host used {pct}% of its token limit for today ({used} of {limit}).", { pct: limit.pct, used: tokensShort(limit.usedTokens), limit: tokensShort(limit.limitTokens) }))}
        action={limit.scope === "session" && mayAct ? <Button size="xs" label={t("Raise limit to {limit}", { limit: tokensShort(limit.limitTokens * 2) })} testID="token-limit-raise" onPress={() => void context.raiseLimit()} />
          : limit.scope === "day" && role === "admin" && host ? <Button size="xs" label={t("Open settings")} onPress={() => router.push(hostSettingsRoute(host.gatewayId, "usage", "limits") as never)} /> : undefined} />
    : compacting ? <BannerRow icon="layers" text={t("Compacting the conversation — your message will be sent when it is done.")} />
    : notice ? <BannerRow icon="info" text={notice} action={<IconButton icon="x" size="xs" label={t("Dismiss")} onPress={() => setNotice(null)} />} />
    : undefined;

  return (
    <View ref={dropSurface} style={{ flex: 1, minHeight: 0 }}>
      {searchOpen ? (
        searchChosen && windowWidth <= 600 ? (
          <View testID="chat-search" {...({ dataSet: { searchSettled: String(searchSettled) } } as object)} style={{ position: "absolute", top: 6, left: space[3], zIndex: 80, flexDirection: "row", alignItems: "center", gap: space[1], paddingHorizontal: space[2], paddingVertical: space[1], borderRadius: radius.md, borderWidth: 1, borderColor: theme.color("border/hairline"), backgroundColor: theme.color("bg/subtle"), ...theme.elevation(3) }}>
            {searchTotal ? <Text testID="chat-search-count" variant="meta" color="text/secondary">{t("{current} of {total}", { current: searchIndex + 1, total: searchTotal })}</Text> : null}
            <IconButton icon="arrow-up" label={t("Previous result")} disabled={!searchMatches.length} onPress={() => stepSearch(-1)} />
            <IconButton icon="arrow-d" label={t("Next result")} disabled={!searchMatches.length} onPress={() => stepSearch(1)} />
            <IconButton icon="x" label={t("Close search")} onPress={dismissSearch} />
          </View>
        ) : (
        <View testID="chat-search" {...({ dataSet: { searchSettled: String(searchSettled) } } as object)} style={{ position: "absolute", top: 6, left: space[3], right: space[3], zIndex: 80, maxHeight: 300, padding: space[2], borderRadius: radius.md, borderWidth: 1, borderColor: theme.color("border/hairline"), backgroundColor: theme.color("bg/subtle"), ...theme.elevation(3) }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space[1] }}>
            <View style={{ flex: 1, minWidth: 0 }}><Input autoFocus accessibilityLabel={t("Search conversation")} placeholder={t("Search messages and steps…")} leadingIcon="search" value={searchQuery} onChangeText={setSearchQuery} testID="chat-search-input" /></View>
            <IconButton icon="arrow-up" label={t("Previous result")} disabled={!searchMatches.length} onPress={() => stepSearch(-1)} />
            <IconButton icon="arrow-d" label={t("Next result")} disabled={!searchMatches.length} onPress={() => stepSearch(1)} />
            <IconButton icon="x" label={t("Close search")} onPress={dismissSearch} />
          </View>
          <View style={{ minHeight: 28, flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[1] }}>
            {searching ? <Spinner size={12} label={t("Searching…")} /> : null}
            {searchTotal ? <Text testID="chat-search-count" variant="meta" color="text/secondary">{t("{current} of {total}", { current: searchIndex + 1, total: searchTotal })}</Text>
              : searchQuery.trim() && !searching ? <Text variant="meta" color="text/secondary">{t("No results")}</Text> : null}
          </View>
          <ScrollView style={{ maxHeight: 210 }} keyboardShouldPersistTaps="always">
            {searchMatches.map((match, index) => (
              <Tap key={`${match.messageId}:${match.itemId ?? "message"}:${index}`} role="button" label={match.snippet} testID={`chat-search-result-${index + 1}`} onPress={() => { setSearchIndex(index); setSearchChosen(true); void jumpToSearchResult(match); }}
                style={({ hovered, pressed }) => ({ paddingHorizontal: space[2], paddingVertical: space[1], borderRadius: radius.sm, backgroundColor: index === searchIndex ? theme.color("bg/hover") : hovered || pressed ? theme.color("bg/subtle") : "transparent" })}>
                <Text variant="meta" numberOfLines={2}>{match.snippet}</Text>
                <Text variant="meta" color="text/tertiary">{match.role === "user" ? t("You") : t("Agent")} · {match.ts_ms ? new Date(match.ts_ms).toLocaleDateString(theme.locale) : ""}</Text>
              </Tap>
            ))}
          </ScrollView>
        </View>
        )
      ) : null}
      <View style={{ flex: 1, minHeight: 0 }}>
      <ScrollView ref={scroll} testID="chat-scroll" onScroll={onScroll} scrollEventThrottle={32} onContentSizeChange={(_width, height) => { view.current.contentHeight = height; onGrew(); }} onLayout={(event) => { if (view.current.height !== event.nativeEvent.layout.height) { view.current.height = event.nativeEvent.layout.height; requestWindow(); } }}
        maintainVisibleContentPosition={searchHit ? undefined : { minIndexForVisible: 0 }} style={{ overflowAnchor: "none" } as object} contentContainerStyle={{ paddingHorizontal: theme.compact ? compactScale.space.side : space[4], gap: space[3] }}>
        {loadingOlder ? <View testID="chat-loading-older" style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space[1.5] }}><Spinner size={12} label={t("Loading earlier messages…")} /><Text variant="meta" color="text/secondary">{t("Loading earlier messages…")}</Text></View> : null}
        {loading ? <SkeletonChat testID="chat-skeleton" /> : null}
        {error ? <Callout tone="danger">{reasonOf(error)}</Callout> : null}
        {!loading && !hasOlder && marked.length > 0 ? <View testID="chat-beginning" style={{ alignItems: "center", paddingVertical: space[1] }}><Text variant="meta" color="text/tertiary">{t("Beginning of conversation")}</Text></View> : null}
        {!loading && chat.items.length === 0 && !chat.running ? <Text color="text/secondary" align="center">{t("Send a message to start the conversation.")}</Text> : null}
        {searchTopPadding > 0 ? <View testID="chat-search-top-spacer" style={{ height: searchTopPadding }} /> : null}
        <Timeline items={items} running={chat.running} turn={chat.turn} stopping={stopping} approvals={mine} userMenu={userMenu} onOpenStep={props.onOpenStep} onRetryImport={() => { void send(t("Retry the failed media import from the same source.")); }} renderCard={(id) => cards.find((card) => card.id === id)?.node} compacting={compacting} searchHit={searchHit}
          windowed={{ heights: heights.current, top: follow.current ? null : (view.current.windowTop = anchor.windowTop(view.current.top)), hasOlder: currentChat.current.hasOlder, viewport: view.current.height || 900, measure, focus: focusRow, anchor: follow.current || (!currentChat.current.hasOlder && view.current.top <= 1) ? null : anchor.held(), prepended: (height) => { prependedBy.current += height; } }} />
      </ScrollView>
      {newBelow ? (
        <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, bottom: space[2], alignItems: "center" }}>
          <Button kind="secondary" size="sm" icon="arrow-d" label={t("New messages")} testID="chat-jump-newest" onPress={() => toBottom(false)} />
        </View>
      ) : null}
      </View>
      <View ref={controls.anchor} testID="chat-composer-dock" style={{ paddingTop: space[2], paddingHorizontal: space[4], paddingBottom: space[4], gap: space[1.5] }}>
        {waitingOlder.length ? <Button kind="secondary" size="sm" icon="hand" label={t("Waiting for you ({n})", { n: waitingOlder.length })} testID="chat-waiting-for-you" onPress={() => void jumpToWaiting()} /> : null}
        {props.home ? <ConversationLeadBar homeKey={props.home.sessionKey} lead={props.home.lead} mayAct={mayAct} /> : null}
        <SubAgentsTrack sessionKey={props.home?.sessionKey ?? sessionKey} mayAct={mayAct} />
        {held.length ? (
          <View testID="held-track" style={{ gap: space[1] }}>
            {held.map((entry, index) => (
              <View key={index} style={{ flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[2], paddingVertical: space[1], borderRadius: radius.sm, backgroundColor: theme.color("bg/subtle") }}>
                <Icon name="clock" size={14} color="text/secondary" />
                <Text variant="meta" numberOfLines={2} style={{ flex: 1 }}>{entry}</Text>
                <Text variant="meta" color="text/secondary">{t("Will send after compacting")}</Text>
              </View>
            ))}
          </View>
        ) : null}
        {chat.queued.length ? (
          <View testID="queue-track" style={{ gap: space[1] }}>
            {chat.queued.map((entry) => (
              <View key={entry.id} style={{ flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[2], paddingVertical: space[1], borderRadius: radius.sm, backgroundColor: theme.color("bg/subtle") }}>
                <Icon name="clock" size={14} color="text/secondary" />
                <Text variant="meta" numberOfLines={2} style={{ flex: 1 }}>{entry.text}</Text>
                <Text variant="meta" color="text/secondary">{t("Will send after this turn")}</Text>
              </View>
            ))}
          </View>
        ) : null}
        <DraftComposer draftKey={draftKey} docked inputRef={input} onSend={() => void submit()} onStop={() => void stop()} running={chat.running}
          placeholder={pendingQuestion ? t("Waiting for your answer") : chat.running ? t("Guide the agent while it works…") : t("Ask or guide the agent…")} canSend={mayAct} disabled={role === "viewer"}
          model={controls.modelPill} permission={controls.pills.find((pill) => pill.id === "mode")} skills={skillPicker.pill} options={controls.pills.filter((pill) => pill.id !== "mode")} onDictate={dictate} dictating={dictating} sendOptions={sendOptions.length ? sendOptions : undefined} banner={banner}
          attachments={images.map((image) => ({ name: image.name, size: `${(image.size / 1024).toFixed(0)} KB`, thumbnail: image.thumbnail, icon: image.mimeType.startsWith("image/") ? "image" as IconName : image.mimeType.startsWith("video/") ? "film" as IconName : image.mimeType.startsWith("audio/") ? "music" as IconName : "doc" as IconName, status: image.status, progress: image.progress / 100, error: image.error }))}
          commands={commandList.commands} commandListLoaded={commandList.loaded} commandModelLabel={runtimeLabel}
          onRemoveAttachment={(index) => setImages((current) => current.filter((_, at) => at !== index))} onRetryAttachment={(index) => { setImages((current) => current.filter((_, at) => at !== index)); pickFiles(); }} onAttach={pickFiles} attachOptions={attachOptions}
          context={<ContextMeter api={context} running={chat.running} mayAct={mayAct} runtimeLabel={runtimeLabel} sessionKey={sessionKey} runtimeId={session?.ref?.runtimeId} providerId={session?.ref?.providerId} modelId={session?.ref?.modelId} contextWindow={controls.model?.contextWindow} reports={props.chat.usage?.reports} />} />
      </View>
      {session?.projectId ? <ProjectMediaPicker ref={projectMediaPicker} projectId={session.projectId} sessionKey={sessionKey} connection={connection} host={host}
        onAttach={(files) => files.forEach((file) => void addProjectMedia(file))} /> : null}
      {controls.overlays}
      {skillPicker.overlay}
    </View>
  );
}

/** A line of the composer's banner: an icon, the sentence, and at most one action. */
/**
 * The composer of a session with the draft it holds. The text, its length counter and whether it may be sent are worked
 * out here, so that a key press renders this and nothing else of the pane. `banner` is what the pane has to say; the
 * length counter shows when it has nothing.
 */
function DraftComposer(props: Omit<Parameters<typeof AgentComposer>[0], "value" | "onChangeText"> & { draftKey: string }) {
  const { draftKey, banner, canSend, ...rest } = props;
  const [draft, setDraft] = useDraft(draftKey);
  const length = messageLength(draft);
  return <AgentComposer {...rest} value={draft} onChangeText={setDraft} canSend={canSend !== false && !length.over}
    banner={banner ?? (length.counter ? <BannerRow icon={length.over ? "warn" : "info"} text={length.counter} danger={length.over} /> : undefined)} />;
}

export function BannerRow(props: { icon: IconName; text: string; action?: ReactNode; danger?: boolean }) {
  return (
    <>
      <Icon name={props.icon} size={14} color={props.danger ? "danger" : "text/secondary"} />
      <Text variant="meta" color={props.danger ? "danger/text" : "text/primary"} style={{ flex: 1 }}>{props.text}</Text>
      {props.action}
    </>
  );
}
