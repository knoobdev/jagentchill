import { useEffect, useState, type ReactNode } from "react";
import { View } from "react-native";
import { escalationReason, formatTimeOfDay, handbackOutcomeLabel, handbackPill, handbackSections } from "@jagentchill/app-core";
import type { AgentHandback, ConversationLead, TeamRunApproval } from "@jagentchill/protocol";
import { Button, Card, Disclosure, Icon, StatusPill, Text, Textarea, inlineIcon, space, useTheme, useToast } from "@jagentchill/ui";
import { useHost, type Session } from "../../host";
import { useT } from "../../locale";
import { copyText } from "../../platform/media";
import { useChat, type Chat } from "../chat";
import { ArtefactChips } from "./Artefacts";
import { useAgentTree } from "./data";
import { HandoffCard } from "./RunPanel";
import { useTeamRuns, type TeamRunsApi } from "./run";

/** The words of these cards the screens translate from data (outcome, state and section labels). */
const CARD_WORDS = ["Done", "Partly done", "Blocked", "Disagrees", "Waiting for a decision", "Accepted", "Returned", "Replaced", "What changed or was inspected", "Evidence", "Remaining uncertainty", "Counter-evidence", "Requested resolution", "Current direction", "Claim", "Risk",
  "The reviewer agent still did not pass the result after the last revision round.", "The reviewer agent found a rights or safety problem. That is yours to judge.", "The reviewer agent left a criterion without a score.", "The reviewer agent gave no review twice in a row.", "No reviewer agent could be started.", "The host restarted while the reviewer agent was checking this proposal.",
  "Below threshold", "A finding blocks approval", "A rights or safety finding needs a person", "Reviewer uses the same model as the author", "Meets the brief", "Correctness and continuity", "Quality of execution", "Rights and safety", "critical", "high", "medium", "low",
  "The team's result is ready for your sign-off", "The team's revised result is ready for your sign-off", "The agent that led this conversation is gone. The main agent answers again."];
void CARD_WORDS;

/** One section of a card: its label, the text (selectable), and a button that copies it. */
function Section(props: { label: string; text: string; missing?: boolean; testID?: string }) {
  const t = useT();
  const toast = useToast();
  return (
    <View style={{ gap: space[0.5] }} testID={props.testID}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[1] }}>
        <Text variant="meta" color="text/secondary" style={{ flex: 1 }}>{props.label}</Text>
        {props.missing ? null : <Button kind="ghost" size="xs" icon="copy" iconOnly label={t("Copy {section}", { section: props.label })} onPress={() => { void copyText(props.text); toast.show({ kind: "success", message: t("Copied") }); }} />}
      </View>
      <Text selectable color={props.missing ? "text/tertiary" : "text/primary"}>{props.missing ? t("Not stated") : props.text}</Text>
    </View>
  );
}

/**
 * A hand-back as a card: who returned work to whom and how they call it, the four sections every hand-back states —
 * what changed or was inspected, the evidence, what is still uncertain, what speaks against it — the sections the agent
 * added, what is attached, and what became of it. While nobody has decided, a person who may act accepts it or returns
 * it with a note that says what is missing.
 */
export function HandbackCard(props: {
  handback: AgentHandback; mayAct: boolean; api: Pick<TeamRunsApi, "resolveHandback">;
  /** A title of the caller's own instead of "Hand-back · <outcome>" (a workflow run shows the package between two steps under "Hand-off"). */
  title?: string;
  /** Leaves the state pill out, where "Accepted" / "Waiting" says nothing (nobody decides on a package between workflow steps). */
  hidePill?: boolean;
}) {
  const t = useT(), { rtl } = useTheme();
  const { handback } = props, pill = handbackPill(handback), state = handback.state ?? "delivered";
  const [note, setNote] = useState("");
  const [returning, setReturning] = useState(false);
  const [busy, setBusy] = useState<"accept" | "return" | null>(null);
  const decide = async (decision: "accept" | "return") => {
    setBusy(decision);
    if (await props.api.resolveHandback(handback.handbackId, decision, decision === "return" ? note.trim() : undefined)) { setNote(""); setReturning(false); }
    setBusy(null);
  };
  const from = handback.fromTitle ?? t("An agent"), to = handback.toTitle ?? "";
  return (
    <Card padding={space[3]}>
      <View testID={`handback-card-${handback.handbackId}`} aria-label={props.hidePill ? (props.title ?? t("Hand-back from {from} to {to}", { from, to })) : t("Hand-back from {from} to {to}, {status}", { from, to, status: t(pill.label) })} {...({ dataSet: { state, outcome: handback.status } } as object)} style={{ gap: space[2] }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
          <Icon name={inlineIcon(rtl, "arrow-l")} size={14} color="text/secondary" />
          <Text variant="body-medium" style={{ flex: 1 }} numberOfLines={1} testID="handback-title">{props.title ?? t("Hand-back · {outcome}", { outcome: t(handbackOutcomeLabel(handback.status)) })}</Text>
          {props.hidePill ? null : <StatusPill label={t(pill.label)} status={pill.status} />}
        </View>
        <Text variant="meta" color="text/secondary">{`${from} → ${to || t("its caller")} · ${formatTimeOfDay(handback.created_ms)}`}</Text>
        {handbackSections(handback).map((section) => <Section key={section.key} label={t(section.label)} text={section.text} missing={section.missing} testID={`handback-section-${section.key}`} />)}
        <ArtefactChips artefacts={handback.artefacts} />
        {handback.note ? <Text variant="meta" color="text/secondary" selectable testID="handback-note">{state === "returned" || state === "superseded" ? t("Returned with: {note}", { note: handback.note }) : handback.note}</Text> : null}
        {state === "delivered" && props.mayAct ? (
          <>
            {returning ? <Textarea value={note} onChangeText={setNote} minLines={2} maxLines={5} maxLength={2000} autoFocus placeholder={t("What is missing?")} accessibilityLabel={t("What is missing?")} testID="handback-return-note" /> : null}
            <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
              {returning ? (
                <>
                  <Button kind="primary" size="sm" label={t("Return to {agent}", { agent: from })} testID="handback-return-send" loading={busy === "return"} disabled={busy !== null || !note.trim()} onPress={() => void decide("return")} />
                  <Button kind="ghost" size="sm" label={t("Back")} disabled={busy !== null} onPress={() => { setReturning(false); setNote(""); }} />
                </>
              ) : (
                <>
                  <Button kind="primary" size="sm" label={t("Accept")} testID="handback-accept" loading={busy === "accept"} disabled={busy !== null} onPress={() => void decide("accept")} />
                  <Button size="sm" label={t("Return")} testID="handback-return" disabled={busy !== null} onPress={() => setReturning(true)} />
                </>
              )}
            </View>
          </>
        ) : null}
      </View>
    </Card>
  );
}

/** The reviews of a reviewer agent: per round the total, the verdict, the score of each criterion and the findings. */
export function ReviewRounds(props: { approval: TeamRunApproval }) {
  const t = useT();
  const { approval } = props, reviews = approval.reviews ?? [], criteria = approval.policy?.criteria ?? [];
  const [open, setOpen] = useState(true);
  if (!reviews.length) return null;
  return (
    <View testID="review-rounds">
      <Disclosure title={reviews.length === 1 ? t("Review by {reviewer} · 1 round", { reviewer: approval.reviewerTitle ?? t("Reviewer") }) : t("Review by {reviewer} · {count} rounds", { reviewer: approval.reviewerTitle ?? t("Reviewer"), count: reviews.length })} open={open} onToggle={setOpen}>
        <View style={{ gap: space[2] }}>
          {approval.warning ? <Text variant="meta" color="warning/text">{t(approval.warning)}</Text> : null}
          {reviews.map((round) => (
            <View key={round.round} testID={`review-round-${round.round}`} {...({ dataSet: { passed: String(round.passed), total: String(round.total) } } as object)} style={{ gap: space[1] }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
                <Text variant="body-medium">{t("Round {round} · {total}/100", { round: round.round, total: round.total })}</Text>
                <StatusPill label={round.passed ? t("Passed") : round.verdict === "approve" ? t("Not passed") : t("Changes requested")} status={round.passed ? "approved" : "changes requested"} />
                {round.note ? <Text variant="meta" color="text/secondary">{round.note.startsWith("Criterion below floor: ") ? t("Criterion below floor: {label}", { label: t(round.note.slice(23)) }) : round.note.startsWith("No score for: ") ? t("The reviewer left a criterion without a score") : t(round.note)}</Text> : null}
              </View>
              <Text variant="meta" color="text/secondary">{criteria.map((entry) => `${t(entry.label)} ${round.scores[entry.id] ?? "—"}`).join(" · ")}</Text>
              <Text selectable>{round.summary}</Text>
              {round.findings.map((finding, index) => <Text key={index} variant="meta" selectable>{`• ${t(finding.severity)} · ${finding.category}: ${finding.message}`}</Text>)}
            </View>
          ))}
          <Text variant="meta" color="text/tertiary">{t("Passes at {threshold}/100 with every criterion at {floor} or more.", { threshold: approval.policy?.threshold ?? 75, floor: approval.policy?.criterionFloor ?? 50 })}</Text>
        </View>
      </Disclosure>
    </View>
  );
}
/** Why a result that a reviewer agent had came to the person instead. */
export function EscalationNote(props: { approval: TeamRunApproval }) {
  const t = useT();
  const reason = escalationReason(props.approval);
  return reason ? <Text testID="review-escalated" color="text/secondary">{t(reason)}</Text> : null;
}

/** Who leads a session's conversation after a hand-off the person accepted; null while the session's own agent answers. */
export function useConversationLead(sessionKey: string): ConversationLead | null {
  const api = useAgentTree(sessionKey);
  const root = api.tree?.agents[0];
  return root?.sessionKey === sessionKey ? root.answering ?? null : null;
}

/** The line above the composer while another agent leads the conversation: who it is, and the way back. */
export function ConversationLeadBar(props: { homeKey: string; lead: ConversationLead; mayAct: boolean }) {
  const t = useT();
  const theme = useTheme();
  const runs = useTeamRuns(props.homeKey);
  const [busy, setBusy] = useState(false);
  return (
    <View testID="conversation-lead" {...({ dataSet: { agent: props.lead.agentId } } as object)} style={{ flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[2], minHeight: theme.compact ? 44 : 32, flexWrap: "wrap" }}>
      <Icon name="bot" size={14} color="accent" />
      <Text variant="meta" style={{ flex: 1, minWidth: 140 }} testID="conversation-lead-text">{t("{agent} is leading this conversation", { agent: props.lead.title })}</Text>
      {props.mayAct ? <Button kind="ghost" size="xs" label={props.lead.previousTitle ? t("Hand back to {previous}", { previous: props.lead.previousTitle }) : t("Hand back to the main agent")} testID="conversation-return" loading={busy} disabled={busy}
        onPress={async () => { setBusy(true); await runs.returnConversation(); setBusy(false); }} /> : null}
    </View>
  );
}

/**
 * The conversation of the agent that leads: its own transcript and stream, given to the chat pane in place of the
 * session's. The record of its session is read from the host (an agent's session is in no session list).
 */
export function LeadChat(props: { lead: ConversationLead; render(chat: Chat, session: Session | undefined): ReactNode }) {
  const { connection, status } = useHost();
  const chat = useChat(props.lead.sessionKey);
  const [session, setSession] = useState<Session | undefined>(undefined);
  useEffect(() => {
    if (!connection || status !== "connected") return;
    let cancelled = false;
    void connection.call<{ session: Session }>("jagentchill.session.get", { sessionKey: props.lead.sessionKey }).then((got) => { if (!cancelled) setSession(got.session); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [connection, status, props.lead.sessionKey]);
  return <>{props.render(chat, session)}</>;
}

/**
 * The hand-off and hand-back cards of one agent's conversation, each at the moment it happened: the hand-offs this
 * agent made or was offered, the hand-backs made to it or by it — and, in the session's own conversation, every
 * hand-off that waits for the person, whoever of its agents asked. `handbackIds` are the hand-backs that have a card:
 * the short "settled" note of the same hand-back is not drawn beside it.
 */
export function useTeamCards(props: { sessionKey: string; mayAct: boolean }): { cards: Array<{ id: string; ts_ms: number; node: ReactNode }>; handbackIds: Set<string>; handoffIds: Set<string> } {
  const runs = useTeamRuns(props.sessionKey), tree = useAgentTree(props.sessionKey).tree;
  const self = tree?.agents.find((agent) => agent.sessionKey === props.sessionKey), root = !!self && self.id === tree?.rootId;
  const handoffs = self ? runs.handoffs.filter((record) => record.fromAgentId === self.id || record.toAgentId === self.id || (root && record.decision === "human")) : [];
  const handbacks = self ? runs.handbacks.filter((record) => record.toAgentId === self.id || record.agentId === self.id) : [];
  return {
    cards: [
      ...handoffs.map((record) => ({ id: `handoff-${record.id}`, ts_ms: record.created_ms, node: <HandoffCard handoff={record} mayAct={props.mayAct} api={runs} /> as ReactNode })),
      ...handbacks.map((record) => ({ id: `handback-${record.handbackId}`, ts_ms: record.created_ms, node: <HandbackCard handback={record} mayAct={props.mayAct} api={runs} /> as ReactNode })),
    ],
    handbackIds: new Set(handbacks.map((record) => record.handbackId)), handoffIds: new Set(handoffs.map((record) => record.id)),
  };
}
