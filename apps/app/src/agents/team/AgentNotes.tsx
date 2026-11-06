import type { ReactNode } from "react";
import { View } from "react-native";
import { handoffMessageId, isHandoffDecisionMessage, parseAgentNotification, type AgentNote, type ChatItem } from "@jagentchill/app-core";
import { Icon, StatusPill, Text, inlineIcon, radius, space, useTheme } from "@jagentchill/ui";
import { useT } from "../../locale";

const OUTCOME: Record<AgentNote["outcome"], { label: string; status: string }> = {
  completed: { label: "Completed", status: "completed" }, failed: { label: "Failed", status: "failed" }, cancelled: { label: "Cancelled", status: "cancelled" }, closed: { label: "Stopped", status: "stopped" },
};

/** The hand-off card of the chat: which sub-agents settled, how, and what each gave back. */
function AgentNotesCard(props: { notes: AgentNote[] }) {
  const t = useT();
  const theme = useTheme();
  return (
    <View testID="agent-notes-card" style={{ gap: space[2], padding: space[3], borderRadius: radius.md, borderWidth: 1, borderColor: theme.color("border/hairline"), backgroundColor: theme.color("bg/elevated") }}>
      {props.notes.map((note) => (
        <View key={note.agentId} style={{ gap: space[1] }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
            <Icon name={inlineIcon(theme.rtl, "arrow-l")} size={14} color="text/secondary" />
            <Text variant="body-medium" style={{ flex: 1 }} numberOfLines={1}>{note.handbackId ? t("Hand-back from {title}", { title: note.title }) : t("{title} settled", { title: note.title })}</Text>
            <StatusPill label={t(OUTCOME[note.outcome].label)} status={OUTCOME[note.outcome].status} />
          </View>
          {note.summary ? <Text selectable numberOfLines={6}>{note.summary}</Text> : null}
          {note.reason ? <Text color="danger/text" selectable>{note.reason}</Text> : null}
          {note.artefacts.length ? <Text variant="meta" color="text/secondary">{t("Attached: {items}", { items: note.artefacts.map((entry) => entry.title).join(", ") })}</Text> : null}
        </View>
      ))}
    </View>
  );
}

/**
 * What the server told a session's agent about its sub-agents is data for the agent, not a message of the person: it
 * leaves the conversation and stands there as a card. The same array comes back when the chat holds no such message.
 */
export function splitAgentNotes(items: ChatItem[], shown?: { /** Hand-backs and hand-offs that have a card of their own in this conversation. */ handbackIds: Set<string>; handoffIds: Set<string> }): { items: ChatItem[]; cards: Array<{ id: string; ts_ms: number; node: ReactNode }> } {
  const cards: Array<{ id: string; ts_ms: number; node: ReactNode }> = [];
  let last = 0, dropped = false;
  const kept = items.filter((item) => {
    if ("ts_ms" in item && typeof item.ts_ms === "number") last = item.ts_ms;
    if (item.kind !== "user") return true;
    // A hand-off package the server delivered, and its word that a person decided: the hand-off card stands for both.
    const handoffId = handoffMessageId(item.text);
    if ((handoffId && shown?.handoffIds.has(handoffId)) || isHandoffDecisionMessage(item.text)) { dropped = true; return false; }
    const notes = parseAgentNotification(item.text);
    if (!notes) return true;
    // A hand-back is drawn as its own card, with its sections and its decision; the note of the same agent settling would say it twice.
    const brief = notes.filter((note) => !note.handbackId || !shown?.handbackIds.has(note.handbackId));
    if (brief.length) cards.push({ id: `agent-notes-${item.id}`, ts_ms: item.ts_ms ?? last, node: <AgentNotesCard notes={brief} /> });
    dropped = true;
    return false;
  });
  return dropped ? { items: kept, cards } : { items, cards };
}
