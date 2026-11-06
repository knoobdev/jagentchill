import { useEffect, useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { agentCost, agentGlyph, agentIsActive, agentPill, agentRoleLine, agentTokens, agentElapsed } from "@jagentchill/app-core";
import type { AgentHandback, AgentRecord } from "@jagentchill/protocol";
import { Avatar, Badge, Button, Icon, IconButton, Input, StatusPill, Tap, Text, inlineIcon, radius, space, useTheme } from "@jagentchill/ui";
import { useT } from "../../locale";
import { useChat } from "../chat";
import { ProposalCard } from "../proposals/ProposalCard";
import { useProposals } from "../proposals/data";
import { shownProposals } from "../SessionTabs";
import { Timeline } from "../Timeline";

/** The words of the agent pills and role lines, as the screens translate them. */
const AGENT_WORDS = {
  queued: "Queued", working: "Working", approval: "Needs approval", paused: "Paused", failed: "Failed", stopped: "Stopped", cancelled: "Cancelled", completed: "Completed", idle: "Idle", archived: "Archived",
  children: "Waiting for sub-agents", answer: "Waiting for your answer", handoff: "Waiting for hand-off", slot: "Waiting for a free slot",
  director: "Director", lead: "Lead", peer: "Peer", session: "Session agent", sub: "Sub-agent", tokensOnly: "Tokens only",
};
void AGENT_WORDS;

/** The seconds an agent's current turn has run; it ticks only while the agent works. */
function useElapsed(agent: AgentRecord): string {
  const active = agent.state === "running" || agent.state === "creating";
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  const started = agent.turnStarted_ms ?? agent.updated_ms;
  if (active) return agentElapsed(now - started);
  return agent.finished_ms && agent.turnStarted_ms ? agentElapsed(agent.finished_ms - agent.turnStarted_ms) : "";
}

/** "Peer · Editor" in the reader's language: the tier is translated, the role's own label is the admin's text. */
export function useRoleLine(): (agent: AgentRecord) => string {
  const t = useT();
  return (agent) => agentRoleLine(agent).split(" · ").map((part) => t(part)).join(" · ");
}

/**
 * One agent as a row of the roster or of the sub-agents track: avatar, title, role, status, model, time, tokens and
 * cost, and the actions the viewer may take. `dense` is the 32 px row of the track.
 */
export function AgentRow(props: {
  agent: AgentRecord; dense?: boolean; open?: boolean; mayAct: boolean; indent?: number;
  onToggle(): void; onStop(): void; onArchive?(): void; onDetach?(): void;
}) {
  const t = useT();
  const theme = useTheme();
  const { agent, dense } = props;
  const pill = agentPill(agent), roleLine = useRoleLine()(agent), elapsed = useElapsed(agent);
  const tokens = agentTokens(agent.usage), cost = agentCost(agent.usage);
  const height = theme.compact ? (dense ? 44 : 56) : dense ? 32 : 44;
  const model = agent.modelId ?? "";
  // A row in a narrow pane (the editor's agent panel) keeps what the track is for — who, state, time, tokens or cost: the model and the role give way.
  const [width, setWidth] = useState(0);
  const roomy = width === 0 || width >= 520, medium = width === 0 || width >= 400;
  // In a narrow pane nothing is cut in half: a roster row carries its time and tokens on its second line, a track row shows the time while its agent works and the tokens once it settled.
  // A roster row needs more room than a track row before everything fits on one line.
  const narrow = dense ? !medium : !roomy, active = agentIsActive(agent), fixed = { flexShrink: 0 } as const;
  // A hand-off shows as words: beside the name where there is room, at the head of the second line of a roster row otherwise.
  const handoff = agent.handedBack ? t("↩ handed back") : agent.handoff === "handed_off" ? t("→ handing off") : agent.handoff === "received" ? t("← hand-off received") : "";
  const meta = [handoff, roleLine, narrow ? "" : model, narrow ? elapsed : "", narrow && tokens ? tokens.replace(" tokens", ` ${t("tokens")}`) : ""].filter(Boolean).join(" · ");
  const status = <StatusPill label={t(pill.label)} status={pill.status} reason={!dense && !narrow && pill.reason ? t(pill.reason) : undefined} />;
  return (
    <View testID={`agent-row-${agent.id}`} onLayout={(event) => setWidth(Math.round(event.nativeEvent.layout.width))} {...({ dataSet: { state: agent.state, role: agent.roleId ?? "", depth: String(agent.depth) } } as object)}>
    <Tap role="button" label={`${agent.title} — ${t(pill.label)}`} expanded={props.open} onPress={props.onToggle}
      style={(interaction) => ({ minHeight: height, flexDirection: "row", alignItems: "center", gap: space[2], paddingLeft: space[2] + (props.indent ?? 0) * space[4], paddingRight: space[1], borderRadius: radius.sm, backgroundColor: interaction.hovered || props.open ? theme.color("bg/hover") : "transparent" })}>
      <Icon name={props.open ? "chev-d" : inlineIcon(theme.rtl, "chev-r")} size={12} color="text/tertiary" />
      <Avatar name={agent.title} id={agent.id} size={dense ? 20 : 24} glyph={agentGlyph(agent)} />
      <View style={{ flex: 1, minWidth: 64 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[1.5] }}>
          <Text variant="body-medium" numberOfLines={1} style={{ flexShrink: 1 }}>{agent.title}</Text>
          {/* The role gives way before the name does. */}
          {dense && medium ? <Text variant="meta" color="text/secondary" numberOfLines={1} style={{ flexShrink: 1000, minWidth: 0 }}>{roleLine}</Text> : null}
          {agent.grantsWrite && agentIsActive(agent) ? <Badge label={t("Editing")} tone="accent" /> : null}
          {dense && roomy && handoff ? <Badge label={handoff} /> : null}
          {agent.reviewer ? <Badge label={t("Reviews the result")} /> : null}
          {agent.handbackWaiting ? <Badge label={t("Hand-back waiting")} tone="warning" /> : null}
        </View>
        {dense ? null : narrow ? (
          // In a narrow roster (a phone, the docked column) the state and the numbers are a second line of their own, wrapping when they must.
          <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", columnGap: space[1.5], rowGap: space[0.5], paddingBottom: space[1] }}>
            {status}
            <Text variant="meta" color="text/secondary" testID={`agent-meta-${agent.id}`}>{meta}</Text>
          </View>
        ) : <Text variant="meta" color="text/secondary" numberOfLines={1} testID={`agent-meta-${agent.id}`}>{meta}</Text>}
      </View>
      {!theme.compact && dense && model && roomy ? <Text variant="meta" color="text/tertiary" numberOfLines={1} style={{ maxWidth: 140 }}>{model}</Text> : null}
      {elapsed && (!narrow || (dense && (active || !tokens))) ? <Text variant="meta" color="text/secondary" numberOfLines={1} style={fixed} testID={`agent-elapsed-${agent.id}`}>{elapsed}</Text> : null}
      {tokens && (!narrow || (dense && !active)) ? <Text variant="meta" color="text/secondary" numberOfLines={1} style={fixed} testID={`agent-tokens-${agent.id}`}>{tokens.replace(" tokens", ` ${t("tokens")}`)}</Text> : null}
      {cost && (roomy || cost !== "tokens only") ? <Text variant="meta" color="text/secondary" numberOfLines={1}>{cost === "tokens only" ? t("Tokens only") : cost}</Text> : null}
      {!dense && narrow ? null : status}
      {props.mayAct && agentIsActive(agent) ? <IconButton icon="stop" size="xs" label={t("Stop {title}", { title: agent.title })} testID={`agent-stop-${agent.id}`} onPress={props.onStop} /> : null}
      {/* Detach stays from 400 px up, as before the roster got its two-line layout below 520. */}
      {props.mayAct && props.onDetach && agent.depth > 0 && medium ? <IconButton icon="ext" size="xs" label={t("Detach {title}", { title: agent.title })} testID={`agent-detach-${agent.id}`} onPress={props.onDetach} /> : null}
      {props.mayAct && props.onArchive && agent.depth > 0 && !agentIsActive(agent) ? <IconButton icon="archive" size="xs" label={t("Archive {title}", { title: agent.title })} testID={`agent-archive-${agent.id}`} onPress={props.onArchive} /> : null}
    </Tap>
    </View>
  );
}

/** The hand-off package an agent gave back to its caller: what it did, what is open, what it produced. */
export function HandbackCard(props: { agent: AgentRecord; handback: AgentHandback }) {
  const t = useT();
  const theme = useTheme();
  const { handback } = props;
  const list = (title: string, lines: string[]) => (lines.length ? (
    <View style={{ gap: space[0.5] }}>
      <Text variant="meta" color="text/secondary">{title}</Text>
      {lines.map((line, index) => <Text key={index} selectable>{`• ${line}`}</Text>)}
    </View>
  ) : null);
  return (
    <View testID={`handback-${props.agent.id}`} style={{ gap: space[2], padding: space[3], borderRadius: radius.md, borderWidth: 1, borderColor: theme.color("border/hairline"), backgroundColor: theme.color("bg/elevated") }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
        <Icon name={inlineIcon(theme.rtl, "arrow-l")} size={14} color="text/secondary" />
        <Text variant="body-medium" style={{ flex: 1 }} numberOfLines={1}>{t("Hand-back from {title}", { title: props.agent.title })}</Text>
        <StatusPill label={handback.status === "done" ? t("Completed") : handback.status === "partial" ? t("Partly done") : t("Blocked")} status={handback.status === "done" ? "completed" : handback.status === "partial" ? "stale" : "blocked"} />
      </View>
      <Text selectable>{handback.whatChangedOrInspected}</Text>
      {list(t("Open questions"), handback.openQuestions)}
      {list(t("Risks"), handback.risks)}
      {list(t("Next steps"), handback.nextSteps)}
      {handback.artefacts.length ? <Text variant="meta" color="text/secondary">{t("Attached: {items}", { items: handback.artefacts.map((entry) => entry.title).join(", ") })}</Text> : null}
    </View>
  );
}

/**
 * What an opened agent shows: its hand-back, the proposals it submitted (the person decides on them here), its own
 * conversation with the work log collapsed per turn, and a line to write to it.
 */
export function AgentDetail(props: { agent: AgentRecord; mayAct: boolean; onSend(prompt: string): Promise<boolean> }) {
  const t = useT();
  const theme = useTheme();
  const { agent } = props;
  const chat = useChat(agent.sessionKey);
  const proposals = useProposals({ sessionKey: agent.sessionKey });
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const cards = shownProposals(proposals.proposals);
  // The agent's first message is the server's standing instructions followed by its task: the log shows the task.
  // What opens such a conversation is not a person's message: the timeline draws it as the assignment it is (`hostAssignment`).
  const items = chat.chat.items;
  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    if (await props.onSend(text)) setDraft("");
    setBusy(false);
  };
  return (
    <View testID={`agent-detail-${agent.id}`} style={{ gap: space[2], marginLeft: space[4], paddingLeft: space[3], paddingVertical: space[2], borderLeftWidth: 2, borderLeftColor: theme.color("border/hairline") }}>
      {agent.result?.handback ? <HandbackCard agent={agent} handback={agent.result.handback} /> : null}
      {agent.result?.error ? <Text color="danger/text" selectable>{agent.result.error}</Text> : null}
      {cards.map((proposal) => (
        <View key={proposal.proposalId} testID={`agent-proposal-${agent.id}`} style={{ gap: space[1] }}>
          <Text variant="meta" color="text/secondary">{t("Proposed by {title}", { title: agent.title })}</Text>
          <ProposalCard proposal={proposal} resolve={proposals.resolve} revert={proposals.revert} />
        </View>
      ))}
      <ScrollView testID={`agent-worklog-${agent.id}`} style={{ maxHeight: 280 }} contentContainerStyle={{ gap: space[2] }} nestedScrollEnabled>
        {chat.loading ? <Text variant="meta" color="text/secondary">{t("Loading…")}</Text> : null}
        {!chat.loading && chat.chat.items.length === 0 ? <Text variant="meta" color="text/secondary">{t("This agent has not written anything yet.")}</Text> : null}
        <Timeline items={items} running={chat.chat.running} turn={chat.chat.turn} approvals={[]} userMenu={() => []} />
      </ScrollView>
      {props.mayAct && agent.state !== "closed" && !agent.archived_ms ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
          <Input size="sm" value={draft} onChangeText={setDraft} placeholder={t("Message {title}…", { title: agent.title })} accessibilityLabel={t("Message {title}…", { title: agent.title })} testID={`agent-message-${agent.id}`}
            onSubmitEditing={() => void send()} style={{ flex: 1 }} />
          <Button size="sm" label={t("Send")} loading={busy} disabled={!draft.trim()} testID={`agent-message-send-${agent.id}`} onPress={() => void send()} />
        </View>
      ) : null}
    </View>
  );
}
