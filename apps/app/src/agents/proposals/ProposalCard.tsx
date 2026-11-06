import { formatTimeOfDay, formatSeconds } from "@jagentchill/app-core";
import { hostLists } from "../hostLists";
import { useRouter } from "expo-router";
import { useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Image, View } from "react-native";
import { formatTimecode } from "@jagentchill/editor-core";
import type { ProposalView } from "@jagentchill/protocol";
import { Button, Callout, Card, Checkbox, Icon, IconButton, Kbd, Menu, Modal, StatusPill, Text, Textarea, Tooltip, radius, space, useTheme, useToast, type MenuItem, inlineIcon } from "@jagentchill/ui";
import { EditorContext } from "../../editor/context";
import { useHost, type Session } from "../../host";
import { useT } from "../../locale";
import { useSync } from "../../sync/SyncProvider";
import { useLibraryState } from "../../state";
import { focusedSession, proposalPreview, useProposals, type Notice, type ProposalError } from "./data";

type Tone = "info" | "success" | "warning" | "danger" | "neutral";
/** The label and tone of each state a proposal card shows. An `open` proposal has no card. */
const STATE: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "Needs your review", tone: "info" }, applying: { label: "Applying…", tone: "info" }, accepted: { label: "Applied", tone: "success" }, partially_accepted: { label: "Partly applied", tone: "success" },
  rejected: { label: "Rejected", tone: "neutral" }, stale: { label: "Could not apply", tone: "warning" }, expired: { label: "Expired", tone: "neutral" }, failed: { label: "Failed", tone: "danger" },
};
type Rate = { numerator: number; denominator: number };
/** A time in ticks as the timecode `HH:MM:SS:FF` of the project's frame rate, the form the card's frame captions use. */
export const timecode = (ticks: number, fps: Rate = { numerator: 30, denominator: 1 }): string => formatTimecode(Math.max(0, Math.round(ticks)), "HH:MM:SS:FF", fps) ?? "00:00:00:00";
/** The same as `MM:SS:FF`, the form of the card's duration line; the hours stay when there are any. */
export const clock = (ticks: number, fps?: Rate): string => timecode(ticks, fps).replace(/^00:/, "");
const seconds = (ticks: number): string => formatSeconds(Math.round(ticks / 12_000) / 10);
const dataUri = (frame: { mime: string; dataBase64: string }) => `data:${frame.mime};base64,${frame.dataBase64}`;
/** The size of a card thumbnail: 70 px high at the frame's own aspect, 124 px wide at most (16:9 is 124 × 70). */
const thumb = (frame: { width: number; height: number }) => { const width = Math.min(124, Math.round((70 * frame.width) / frame.height)); return { width, height: Math.round((width * frame.height) / frame.width) }; };

/**
 * A submitted proposal in the chat: what the agent wants to change, and the person's decision. Nothing of it is in the
 * project until it is accepted; once applied it can be reverted from here on any device that may change projects.
 */
export function ProposalCard(props: { proposal: ProposalView; resolve: ReturnType<typeof useProposals>["resolve"]; revert: ReturnType<typeof useProposals>["revert"]; onRegenerate?(proposal: ProposalView): void; inEditor?: boolean }) {
  const t = useT();
  const theme = useTheme();
  const toast = useToast();
  const router = useRouter();
  const { can, connection } = useHost();
  const { proposal } = props;
  const more = useRef<View>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [asking, setAsking] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [feedback, setFeedback] = useState("");
  const [problem, setProblem] = useState<ProposalError | null>(null);
  const mayWrite = can("jagentchill.projects.write"), state = STATE[proposal.state] ?? STATE.pending;
  const pending = proposal.state === "pending", applied = proposal.state === "accepted" || proposal.state === "partially_accepted";
  const denied = t("This device cannot change projects");
  const run = async (name: string, work: () => Promise<unknown>) => {
    setBusy(name); setProblem(null);
    try { await work(); } catch (error) { setProblem(error as ProposalError); } finally { setBusy(null); }
  };
  const accept = () => run("accept", async () => { proposalPreview.hide(proposal.projectId, proposal.proposalId); await props.resolve(proposal.proposalId, "accept"); });
  const reject = (note?: string) => run("reject", async () => { proposalPreview.hide(proposal.projectId, proposal.proposalId); await props.resolve(proposal.proposalId, "reject", note ? { feedback: note } : {}); });
  const revert = (force = false) => run("revert", async () => { const done = await props.revert(proposal.proposalId, force); toast.show({ kind: "success", message: done.skipped.length ? t("Reverted, except {n} items changed since", { n: done.skipped.length }) : t("Change reverted") }); });
  const review = () => {
    proposalPreview.set(proposal.projectId, proposal.proposalId);
    if (!props.inEditor) router.push(`/editor/${proposal.projectId}` as never);
  };
  // ⌘↵ accepts and ⌘⌫ rejects the pending proposal while its card has the focus.
  const onKey = (event: { key: string; metaKey?: boolean; ctrlKey?: boolean; preventDefault(): void }) => {
    if (!pending || !mayWrite || busy || !(event.metaKey || event.ctrlKey)) return;
    if (event.key === "Enter") { event.preventDefault(); void accept(); }
    if (event.key === "Backspace") { event.preventDefault(); void reject(); }
  };
  const items: MenuItem[] = [
    { id: "partial", label: t("Accept selected…"), icon: "check", disabled: !pending || !mayWrite || proposal.changes.length < 2, onSelect: () => { setPicked(proposal.changes.map((change) => change.changeId)); setSelecting(true); } },
    { id: "ask", label: t("Ask for changes"), icon: "chat", disabled: !pending || !mayWrite, onSelect: () => { setFeedback(""); setAsking(true); } },
  ];
  const conflicts = (problem?.details?.conflicts ?? []) as { entityId: string; name: string; kind: string }[];
  const leaseBusy = problem?.code === "LEASE_UNAVAILABLE";
  const reverted = proposal.revert?.state === "reverted";
  return (
    <Card padding={space[3]}>
      <View testID="proposal-card" {...({ dataSet: { state: proposal.state, proposal: proposal.proposalId }, tabIndex: 0, onKeyDown: onKey } as object)} style={{ gap: space[2] }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
          <Icon name="layers" size={16} color="accent" />
          <Text variant="title-sm" numberOfLines={2} style={{ flex: 1 }}>{proposal.title}</Text>
          <View testID="proposal-state"><StatusPill label={reverted ? t("Reverted") : t(state.label)} tone={reverted ? "neutral" : state.tone} /></View>
        </View>
        <Text color="text/secondary">{proposal.summary}</Text>
        {/* The before/after pair with the counts beside it; in the editor's narrow agent panel the counts wrap under the pair. */}
        <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space[2] }}>
          {proposal.frames ? (
            <>
              <View style={{ gap: space[1] }}>
                <Image testID="proposal-before" accessibilityLabel={t("Before")} source={{ uri: dataUri(proposal.frames.before) }} style={{ ...thumb(proposal.frames.before), borderRadius: radius.sm, backgroundColor: theme.color("bg/inset") }} resizeMode="contain" />
                <Text variant="caption" color="text/secondary" numberOfLines={1}>{t("Before · {time}", { time: timecode(proposal.frames.before.time, proposal.fps) })}</Text>
              </View>
              <Icon name={inlineIcon(theme.rtl, "arrow-r")} size={14} color="text/tertiary" />
              <View style={{ gap: space[1] }}>
                <Image testID="proposal-after" accessibilityLabel={t("After")} source={{ uri: dataUri(proposal.frames.after) }} style={{ ...thumb(proposal.frames.after), borderRadius: radius.sm, backgroundColor: theme.color("bg/inset") }} resizeMode="contain" />
                <Text variant="caption" color="text/secondary" numberOfLines={1}>{t("After · {time}", { time: timecode(proposal.frames.after.time, proposal.fps) })}</Text>
              </View>
            </>
          ) : null}
          <View testID="proposal-counts" style={proposal.frames ? { flexGrow: 1, paddingLeft: space[1] } : { flexDirection: "row", flexWrap: "wrap", columnGap: space[3], rowGap: 2 }}>
            <Text variant="meta" color="success">{t("+{n} added", { n: proposal.elements.added.length })}</Text>
            <Text variant="meta" color="accent">{t("~{n} modified", { n: proposal.elements.modified.length })}</Text>
            <Text variant="meta" color="danger/text">{t("−{n} removed", { n: proposal.elements.removed.length })}</Text>
            <Text variant="meta" color="text/secondary">{t("{time} affected", { time: seconds(proposal.affectedDuration) })}</Text>
          </View>
        </View>
        <Text variant="meta" color="text/secondary" testID="proposal-duration">{t("Project duration {before} → {after}", { before: clock(proposal.durationBefore, proposal.fps), after: clock(proposal.proposedDuration, proposal.fps) })}</Text>
        {proposal.sentToDeviceName && applied ? <Text variant="meta" color="text/secondary">{t("This project is being edited on {name} — the change was sent there", { name: proposal.sentToDeviceName })}</Text> : null}
        {proposal.state === "rejected" && proposal.feedback ? <Text variant="meta" color="text/secondary">{t("Feedback: {text}", { text: proposal.feedback })}</Text> : null}
        {proposal.state === "failed" && proposal.error ? <Text variant="meta" color="danger/text">{proposal.error.message}</Text> : null}
        {proposal.state === "stale" && proposal.error ? <View testID="proposal-timeline-conflict"><Callout tone="warning">{t("Could not apply because the timeline changed at revision {revision}. Read the current timeline, then retry.", { revision: Number(proposal.error.details?.currentRevision ?? proposal.baseRevision) })}</Callout></View> : null}
        {reverted && proposal.revert?.reverted_ms ? <Text variant="meta" color="text/secondary" testID="proposal-reverted">{t("Reverted {time} on {name}", { time: formatTimeOfDay(proposal.revert.reverted_ms), name: proposal.revert.revertedByName ?? "" })}</Text> : null}
        {applied && proposal.revert?.state === "expired" ? <Text variant="meta" color="text/secondary">{t("Revert no longer available")}</Text> : null}
        {problem && !leaseBusy && conflicts.length === 0 ? <Callout tone="danger">{problem.message}</Callout> : null}
        {leaseBusy ? <Callout tone="warning" actions={[{ label: t("Try again"), onPress: () => void accept() }, { label: t("Ask to take over"), onPress: () => void connection?.call("jagentchill.sync.lease.requestTakeover", { doc: { kind: "project", id: proposal.projectId } }).then(() => accept()).catch((error) => setProblem(error as ProposalError)) }]}>{problem!.message}</Callout> : null}
        {conflicts.length > 0 ? <Callout tone="warning" actions={[{ label: t("Revert anyway"), onPress: () => void revert(true) }]}>{t("Changed again since: {names}", { names: conflicts.map((entry) => entry.name).slice(0, 4).join(", ") })}</Callout> : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
          {pending || proposal.state === "applying" ? (
            <>
              <Tooltip label={mayWrite ? t("Accept") : denied}><Button kind="primary" size={theme.touch ? "md" : "sm"} label={t("Accept")} testID="proposal-accept" disabled={!mayWrite || !pending || busy !== null} loading={busy === "accept" || proposal.state === "applying"} onPress={() => void accept()} /></Tooltip>
              <Tooltip label={mayWrite ? t("Reject") : denied}><Button kind="ghost" size={theme.touch ? "md" : "sm"} label={t("Reject")} testID="proposal-reject" disabled={!mayWrite || !pending || busy !== null} loading={busy === "reject"} onPress={() => void reject()} /></Tooltip>
              <Button kind="secondary" size={theme.touch ? "md" : "sm"} label={t("Review")} testID="proposal-review" onPress={review} />
              <View style={{ flex: 1 }} />
              {theme.touch ? null : <Kbd keys={["Mod", "Enter"]} />}
              <View ref={more}><IconButton icon="more" size="sm" label={t("More")} testID="proposal-more" onPress={() => setMenu(true)} /></View>
              <Menu open={menu} anchor={more} items={items} label={t("Proposal")} onClose={() => setMenu(false)} />
            </>
          ) : null}
          {applied && proposal.revert?.state === "available" && mayWrite ? <Button kind="secondary" size="sm" icon="undo" label={t("Revert this change")} testID="proposal-revert" disabled={busy !== null} loading={busy === "revert"} onPress={() => void revert()} /> : null}
          {proposal.state === "stale" && props.onRegenerate ? <Button kind="secondary" size="sm" icon="refresh" label={t("Retry")} testID="proposal-retry" disabled={!mayWrite} onPress={() => props.onRegenerate!(proposal)} /> : null}
          {proposal.state === "failed" && mayWrite && props.onRegenerate ? <Button kind="secondary" size="sm" icon="refresh" label={t("Retry")} testID="proposal-retry" onPress={() => props.onRegenerate!(proposal)} /> : null}
        </View>
      </View>
      <Modal open={selecting} title={t("Accept selected…")} description={t("Only the checked changes are applied, with the changes they build on. The rest is discarded.")} width={480} onClose={() => setSelecting(false)}
        footer={<><Button label={t("Cancel")} onPress={() => setSelecting(false)} /><Button kind="primary" label={t("Accept {n} changes", { n: picked.length })} testID="proposal-accept-selected" disabled={picked.length === 0} onPress={() => { setSelecting(false); void run("accept", async () => { proposalPreview.hide(proposal.projectId, proposal.proposalId); await props.resolve(proposal.proposalId, picked.length === proposal.changes.length ? "accept" : "accept_partial", picked.length === proposal.changes.length ? {} : { changeIds: picked }); }); }} /></>}>
        <View style={{ gap: space[1.5] }}>
          {proposal.changes.map((change) => <Checkbox key={change.changeId} label={change.summary} checked={picked.includes(change.changeId)} onChange={(on) => setPicked((list) => (on ? [...list, change.changeId] : list.filter((entry) => entry !== change.changeId)))} />)}
        </View>
      </Modal>
      <Modal open={asking} title={t("Ask for changes")} description={t("The proposal is rejected and your note starts the agent's next turn.")} width={480} onClose={() => setAsking(false)} dirty={feedback.trim().length > 0}
        footer={<><Button label={t("Cancel")} onPress={() => setAsking(false)} /><Button kind="primary" label={t("Send")} testID="proposal-ask-send" disabled={feedback.trim().length === 0} onPress={() => { setAsking(false); void reject(feedback.trim().slice(0, 2000)); }} /></>}>
        <Textarea aria-label={t("What should change?")} placeholder={t("What should change?")} value={feedback} onChangeText={setFeedback} maxLength={2000} minLines={3} />
      </Modal>
    </Card>
  );
}

/** A tool was refused for a reason the person can act on: the project is only on a device, or another agent is editing it. */
export function NoticeCard(props: { notice: Notice; onSynced(): void }) {
  const t = useT();
  const toast = useToast();
  const { engine, canWrite } = useSync();
  const library = useLibraryState();
  const [busy, setBusy] = useState(false);
  const [synced, setSynced] = useState(props.notice.synced === true);
  const { notice } = props;
  if (notice.code === "TURN_LIMIT") return <TurnLimitNotice notice={notice} />;
  if (notice.code === "WRITER_HELD") return <View testID="notice-writer-held"><Callout tone="info">{t("This project is being edited by {name} in another session", { name: notice.holderTitle || t("another agent") })}</Callout></View>;
  if (notice.code === "RENDERER_UNAVAILABLE") return <View testID="notice-no-renderer"><Callout tone="info">{t("The agent could not look at frames: open the project on a device.")}</Callout></View>;
  const onDevice = !!notice.projectId && library.projects.some((project) => project.id === notice.projectId);
  const sync = async () => {
    if (!engine || !notice.projectId) return;
    setBusy(true);
    try { await engine.enable(notice.projectId); setSynced(true); props.onSynced(); toast.show({ kind: "success", message: t("Project synced — ask the agent again") }); }
    catch (error) { toast.show({ kind: "error", message: (error as { message?: string } | null)?.message ?? t("Sync error") }); }
    finally { setBusy(false); }
  };
  return (
    <Card padding={space[3]}>
      <View testID="notice-not-synced" {...({ dataSet: { synced: String(synced) } } as object)} style={{ gap: space[2] }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
          <Icon name="cloud" size={16} color="accent" />
          <Text variant="title-sm" style={{ flex: 1 }}>{synced ? t("Project synced — ask the agent again") : t("This project is only on {name}", { name: notice.deviceName ?? t("a device") })}</Text>
        </View>
        <Text color="text/secondary">{synced ? t("The project is synced to the host now. Ask the agent again.") : t("The agent works on the host's copy of a project. Sync this project so it can read and edit it.")}</Text>
        {synced ? null : (
          <View style={{ flexDirection: "row", gap: space[2] }}>
            <Tooltip label={onDevice ? t("Sync this project") : t("Open this chat on {name} to sync the project", { name: notice.deviceName ?? t("that device") })}>
              <Button kind="primary" size="sm" icon="cloud" label={t("Sync this project")} testID="notice-sync" disabled={!onDevice || !engine || !canWrite || busy} loading={busy} onPress={() => void sync()} />
            </Tooltip>
          </View>
        )}
      </View>
    </Card>
  );
}

/** The runaway guard paused a turn: what happened, and "Continue" while the person has not gone on. */
function TurnLimitNotice(props: { notice: Notice }) {
  const t = useT();
  const toast = useToast();
  const { connection, can, role } = useHost();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try { await connection?.call("jagentchill.chat.send", { sessionKey: props.notice.sessionKey, message: "Continue." }); }
    catch (error) { toast.show({ kind: "error", message: (error as { message?: string } | null)?.message ?? t("Could not send") }); }
    finally { setBusy(false); }
  };
  return (
    <View testID="notice-turn-limit" {...({ dataSet: { continued: String(props.notice.continued === true) } } as object)}>
      <Callout tone="warning" actions={props.notice.continued || busy || !can("jagentchill.agent.use") || role === "viewer" ? undefined : [{ label: t("Continue"), onPress: () => void go() }]}>
        {t("The agent paused: it made many tool calls in one turn without finishing. Continue if this is what you asked for.")}
      </Callout>
    </View>
  );
}

/** The proposal and notice cards of one session, each with the time it appeared: the chat pane draws it at that place of the conversation. */
export function useProposalCards(props: { sessionKey: string; session: Session | undefined }): Array<{ id: string; ts_ms: number; pending: boolean; node: ReactNode }> {
  const { connection } = useHost();
  // Inside an editor the pane is the agent panel of the open project: "Review" shows the preview there.
  const inEditor = useContext(EditorContext) !== null;
  const toast = useToast();
  const t = useT();
  const { proposals, notices, loaded, resolve, revert, reload } = useProposals({ sessionKey: props.sessionKey });
  // The chat tells the host's own messages by these records: it is told when the list has answered.
  useEffect(() => { if (loaded) hostLists.answered(props.sessionKey, "proposal"); else hostLists.asked(props.sessionKey, "proposal"); }, [loaded, props.sessionKey]);
  // The chat pane of this session is on screen: the host may ask this device what the editor shows, and for frames.
  useEffect(() => { focusedSession.set(props.sessionKey); return () => { if (focusedSession.get() === props.sessionKey) focusedSession.set(null); }; }, [props.sessionKey]);
  const regenerate = (proposal: ProposalView) => {
    const revision = Number(proposal.error?.details?.currentRevision ?? proposal.baseRevision);
    const changedItems = proposal.error?.details?.changed;
    const changed = Array.isArray(changedItems) ? changedItems.map((entry) => {
      if (typeof entry !== "object" || entry === null) return "";
      const item = entry as Record<string, unknown>;
      return String(item.operation ?? item.entityId ?? item.changeId ?? "");
    }).filter(Boolean).join("; ") : "";
    void connection?.call("jagentchill.chat.send", { sessionKey: props.sessionKey, message: `The proposal "${proposal.title}" could not be applied because the timeline changed. Current revision: ${revision}.${changed ? ` Changed operations: ${changed}.` : ""} Read the current timeline and media, then propose the intended edit again as a new proposal.` })
      .catch((error) => toast.show({ kind: "error", message: (error as { message?: string } | null)?.message ?? t("Could not send") }));
  };
  return [
    ...notices.map((notice) => ({ id: `notice-${notice.noticeId}`, ts_ms: notice.created_ms, pending: false, node: <NoticeCard notice={notice} onSynced={reload} /> })),
    ...proposals.map((proposal) => ({ id: `proposal-${proposal.proposalId}`, ts_ms: proposal.submitted_ms ?? proposal.created_ms, pending: proposal.state === "pending", node: <ProposalCard proposal={proposal} resolve={resolve} revert={revert} onRegenerate={regenerate} inEditor={inEditor} /> })),
  ];
}
