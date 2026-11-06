import { useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { agentIsActive, preference, subAgentsOf } from "@jagentchill/app-core";
import { Button, Icon, Tap, Text, inlineIcon, radius, space, useTheme } from "@jagentchill/ui";
import { useT } from "../../locale";
import { usePref } from "../../state";
import { AgentDetail, AgentRow } from "./AgentViews";
import { useAgentTree } from "./data";
import { SignoffCard } from "./RunPanel";
import { useTeamRuns } from "./run";

const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";

/**
 * The lane above a session's composer that lists the agents its agent created: who works, in which role, on which
 * model, for how long and at what cost. A row opens the agent's own conversation, hand-back and proposals. The lane is
 * absent while the session has one agent.
 */
export function SubAgentsTrack(props: { sessionKey: string; mayAct: boolean }) {
  const t = useT();
  const theme = useTheme();
  const api = useAgentTree(props.sessionKey);
  const collapsedPref = useMemo(() => preference<boolean>(`agents.track.collapsed.${props.sessionKey}`, false, isBoolean), [props.sessionKey]);
  const [collapsed, setCollapsed] = usePref(collapsedPref);
  const [openId, setOpenId] = useState<string | null>(null);
  const runs = useTeamRuns(props.sessionKey);
  const agents = subAgentsOf(api.tree);
  const waiting = runs.runs.find((run) => run.status === "waiting_human");
  // A result that waits for the person is shown where they write, also when the Director finished the brief alone.
  if (!agents.length) return waiting ? <SignoffCard run={waiting} mayAct={props.mayAct} api={runs} /> : null;
  const running = agents.filter(agentIsActive).length, rootDepth = 1;
  const paused = api.tree?.agents[0]?.deliveryPaused;
  const rowHeight = theme.compact ? 44 : 32, visible = theme.compact ? 3 : 5;
  return (
    <View style={{ gap: space[2] }}>
    {waiting ? <SignoffCard run={waiting} mayAct={props.mayAct} api={runs} /> : null}
    <View testID="subagents-track" aria-label={t("Sub-agents")} style={{ borderRadius: radius.md, borderWidth: 1, borderColor: theme.color("border/hairline"), backgroundColor: theme.color("bg/elevated"), overflow: "hidden" }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingRight: space[1.5] }}>
        <Tap role="button" label={t("Sub-agents")} expanded={!collapsed} testID="subagents-toggle" onPress={() => setCollapsed(!collapsed)}
          style={{ flex: 1, minHeight: theme.compact ? 44 : 28, flexDirection: "row", alignItems: "center", gap: space[1.5], paddingHorizontal: space[2] }}>
          <Icon name={collapsed ? inlineIcon(theme.rtl, "chev-r") : "chev-d"} size={12} color="text/secondary" />
          <Text variant="meta" color="text/secondary" testID="subagents-header">{t("Sub-agents · {running} running", { running })}</Text>
          <Text variant="meta" color="text/tertiary">{t("{count} in all", { count: agents.length })}</Text>
        </Tap>
        {props.mayAct && running > 0 ? <Button kind="ghost" size="xs" icon="stop" label={t("Stop all")} testID="subagents-stop-all" onPress={() => void api.stopAll()} /> : null}
      </View>
      {paused ? (
        <View testID="subagents-paused" style={{ flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[2], paddingBottom: space[1] }}>
          <Icon name="warn" size={14} color="warning/icon" />
          <Text variant="meta" style={{ flex: 1 }}>{t("This session reached its activity limit ({limit} turns).", { limit: paused.limit })}</Text>
          {props.mayAct ? <Button kind="ghost" size="xs" label={t("Resume")} testID="subagents-resume" onPress={() => void api.resume()} /> : null}
        </View>
      ) : null}
      {collapsed ? null : (
        <ScrollView style={{ maxHeight: openId ? 420 : rowHeight * visible + space[1] }} contentContainerStyle={{ paddingHorizontal: space[1], paddingBottom: space[1] }} nestedScrollEnabled>
          {agents.map((agent) => (
            <View key={agent.id}>
              <AgentRow agent={agent} dense mayAct={props.mayAct} indent={agent.depth - rootDepth} open={openId === agent.id} onToggle={() => setOpenId(openId === agent.id ? null : agent.id)} onStop={() => void api.stop(agent.id)} />
              {openId === agent.id ? <AgentDetail agent={agent} mayAct={props.mayAct} onSend={(prompt) => api.send(agent.id, prompt)} /> : null}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
    </View>
  );
}
