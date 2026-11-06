import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ScrollView, View, useWindowDimensions } from "react-native";
import { agentIsActive, formatAmount, formatUsd, preference, treeTotals, type AgentTree } from "@jagentchill/app-core";
import type { AgentRecord } from "@jagentchill/protocol";
import { Badge, Button, Callout, ConfirmDialog, Segmented, Select, SkeletonList, Text, Tooltip, space, useTheme } from "@jagentchill/ui";
import { useHost } from "../../host";
import { useT } from "../../locale";
import { usePref } from "../../state";
import { hostSettingsRoute } from "../ModelBrowser";
import { AgentDetail, AgentRow } from "./AgentViews";
import { useAgentTree, useTeam, useTeams, type AgentTreeApi } from "./data";
import { DissentCard } from "./Dissent";
import { escalatedDissents, needsYou } from "./needsYou";
import { ActivityLog, HandoffCard, SignoffCard, TeamRunPanel } from "./RunPanel";
import { useCardFocus } from "./focus";
import { useTeamRuns } from "./run";

const NO_TEAM = "none";
const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";
/** The roster docks beside the chat only where the content is at least this wide (`Session split view`); the shell's sidebar is beside it. */
export const DOCK_MIN_WINDOW = 944 + 240;
/** Whether a session's roster is docked on this device. */
export const dockPreference = (sessionKey: string) => preference<boolean>(`agents.dock.${sessionKey}`, false, isBoolean);

/** The agents of a tree as an indented list with their actions; shared by the session's Agents tab and the host-wide screen. */
export function RosterList(props: { tree: AgentTree; api: Pick<AgentTreeApi, "stop" | "archive" | "send">; mayAct: boolean; onDetach?(agentId: string): Promise<boolean> }) {
  const t = useT();
  const [openId, setOpenId] = useState<string | null>(null);
  const [archiving, setArchiving] = useState<AgentRecord | null>(null);
  const [detaching, setDetaching] = useState<AgentRecord | null>(null);
  return (
    <View testID="agent-roster" role="list">
      {props.tree.agents.map((agent) => (
        <View key={agent.id}>
          <AgentRow agent={agent} mayAct={props.mayAct} indent={agent.depth} open={openId === agent.id} onToggle={() => setOpenId(openId === agent.id ? null : agent.id)}
            onStop={() => void props.api.stop(agent.id)} onArchive={() => setArchiving(agent)} onDetach={props.onDetach ? () => setDetaching(agent) : undefined} />
          {openId === agent.id && agent.depth > 0 ? <AgentDetail agent={agent} mayAct={props.mayAct} onSend={(prompt) => props.api.send(agent.id, prompt)} /> : null}
        </View>
      ))}
      <ConfirmDialog open={!!archiving} title={t("Archive {title}? Its sub-agents are archived too.", { title: archiving?.title ?? "" })} confirmLabel={t("Archive")}
        onConfirm={() => { const agent = archiving; setArchiving(null); if (agent) void props.api.archive(agent.id); }} onClose={() => setArchiving(null)} />
      <ConfirmDialog open={!!detaching} title={t("Detach {title}? It leaves this session and goes on as a session of its own.", { title: detaching?.title ?? "" })} confirmLabel={t("Detach")}
        onConfirm={() => { const agent = detaching; setDetaching(null); if (agent) void props.onDetach?.(agent.id); }} onClose={() => setDetaching(null)} />
    </View>
  );
}

/**
 * The Agents tab of a session: the roster of its agent tree (who works, in which role, on which model, at what cost,
 * with stop and stop-all), the budget of the tree, and the team the session's agent leads.
 */
export function AgentsTab(props: { sessionKey: string; mayAct: boolean }) {
  const t = useT();
  const theme = useTheme();
  const router = useRouter();
  const { host, role } = useHost();
  const api = useAgentTree(props.sessionKey);
  const teams = useTeams();
  const [view, setView] = useState<"roster" | "team" | "activity">("roster");
  // A notification about a dissent or a proposal leads to its card, which is in the Team view.
  const focus = useCardFocus(), focusAt = focus?.place === "team" && focus.kind !== "agent.approval_required" ? focus.at : 0;
  useEffect(() => { if (focusAt) setView("team"); }, [focusAt]);
  const { tree } = api;
  const chosen = useTeam(tree?.teamId);
  const runs = useTeamRuns(props.sessionKey);
  const { width } = useWindowDimensions();
  const [docked, setDocked] = usePref(useMemo(() => dockPreference(props.sessionKey), [props.sessionKey]));
  if (api.loading && !tree) return <SkeletonList rows={3} leading="avatar" meta testID="agents-skeleton" style={{ padding: space[4] }} />;
  if (!tree) {
    return (
      <View style={{ padding: space[4] }}>
        <Callout tone="danger" actions={[{ label: t("Retry"), onPress: api.reload }]}>{t("Unable to load agents")}</Callout>
      </View>
    );
  }
  const root = tree.agents[0], totals = treeTotals(tree.agents), alone = tree.agents.length <= 1;
  const budget = root?.budget;
  // What waits for the person: a result to sign off, and the hand-offs that are theirs to decide (an agent's own are answered by the agent).
  const waiting = runs.runs.find((run) => run.status === "waiting_human"), offered = runs.handoffs.filter((handoff) => handoff.status === "pending" && (handoff.decision === "human" || view === "roster"));
  // A run that waits for a decision on a disagreement has no result to sign off: its card is the disagreement's.
  const signoff = waiting && waiting.waitingReason !== "dissent" ? waiting : undefined, escalated = escalatedDissents(runs.runs);
  const live = runs.runs.some((run) => run.status === "running" || run.status === "waiting_human" || run.status === "briefing" || run.status === "paused");
  const canDock = !theme.compact && width >= DOCK_MIN_WINDOW;
  const teamOptions = [{ value: NO_TEAM, label: t("No team") }, ...(teams.teams ?? []).filter((team) => team.enabled || team.id === tree.teamId).map((team) => ({ value: team.id, label: team.name }))];
  return (
    <ScrollView testID="agents-tab" contentContainerStyle={{ padding: space[4], gap: space[3] }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
        <Segmented size="sm" label={t("Agents view")} value={view} onChange={(next) => setView(next as "roster" | "team" | "activity")} options={[{ value: "roster", label: t("Roster") }, { value: "team", label: t("Team") }, { value: "activity", label: t("Activity log") }]} />
        <View style={{ flex: 1 }} />
        {!theme.compact && !alone ? (
          <Tooltip label={canDock || docked ? t("Show the roster beside the chat") : t("The window is too narrow to dock the roster")}>
            <Button kind="ghost" size="sm" icon="panel" label={docked ? t("Undock roster") : t("Dock roster")} testID="agents-dock" disabled={!canDock && !docked} onPress={() => setDocked(!docked)} />
          </Tooltip>
        ) : null}
        {host ? <Button kind="ghost" size="sm" label={t("All agents on this host")} testID="agents-open-host" onPress={() => router.push(`/h/${host.gatewayId}/agents` as never)} /> : null}
        {props.mayAct && totals.running > 0 ? <Button size="sm" icon="stop" label={t("Stop all")} testID="agents-stop-all" onPress={() => void api.stopAll()} /> : null}
      </View>
      {budget?.exhausted ? (
        <Callout tone="danger" title={t("Budget reached")}
          actions={role === "admin" && budget.limitUsd !== undefined ? [{ label: t("Raise budget to {amount}", { amount: formatUsd(budget.limitUsd * 2) }), onPress: () => void api.setBudget(root.id, budget.limitUsd! * 2) }] : undefined}>
          {`${t("This session and its sub-agents spent {spent} of {limit}.", { spent: formatUsd(budget.spentUsd), limit: formatUsd(budget.limitUsd ?? 0) })}${role === "admin" ? "" : ` ${t("Ask an admin device")}`}`}
        </Callout>
      ) : null}
      {root?.deliveryPaused ? (
        <View testID="agents-paused">
          <Callout tone="warning" actions={props.mayAct ? [{ label: t("Resume"), onPress: () => void api.resume() }, { label: t("Stop all"), onPress: () => void api.stopAll() }] : undefined}>
            {t("This session reached its activity limit ({limit} turns).", { limit: root.deliveryPaused.limit })}
          </Callout>
        </View>
      ) : null}
      {/* The heading stands only with what is under it: the result to sign off, a disagreement the lead gave to the person, the hand-offs. */}
      {needsYou(view, waiting, escalated, offered) ? (
        <View testID="agents-needs-you" style={{ gap: space[2] }}>
          <Text variant="body-medium">{t("Needs you")}</Text>
          {signoff ? <SignoffCard run={signoff} mayAct={props.mayAct} api={runs} /> : null}
          {escalated.map(({ run, dissent }) => <DissentCard key={dissent.id} run={run} dissent={dissent} mayAct={props.mayAct} api={runs} />)}
          {offered.map((handoff) => <HandoffCard key={handoff.id} handoff={handoff} mayAct={props.mayAct} api={runs} />)}
        </View>
      ) : null}
      {view === "activity" ? <ActivityLog api={runs} mayAct={props.mayAct} /> : view === "roster" ? (
        <>
          <View style={{ gap: space[0.5] }}>
            <Text variant="body-medium">{t("Session agents")}</Text>
            <Text variant="meta" color="text/secondary" testID="agents-totals">
              {[t("{count} agents", { count: tree.agents.length }), t("{running} running", { running: totals.running }), totals.tokens ? `${formatAmount(totals.tokens)} ${t("tokens")}` : "", totals.costUsd > 0 ? `${formatUsd(totals.costUsd)}${totals.costKnown ? "" : ` (${t("excludes plan-billed usage")})`}` : "",
                budget?.limitUsd !== undefined ? t("budget {limit}", { limit: formatUsd(budget.limitUsd) }) : ""].filter(Boolean).join(" · ")}
            </Text>
          </View>
          <RosterList tree={tree} api={api} mayAct={props.mayAct} onDetach={props.mayAct ? runs.detach : undefined} />
          {alone ? <Text color="text/secondary" testID="agents-empty">{t("This session has one agent. Use Team mode or ask the agent to delegate to see more here.")}</Text> : null}
        </>
      ) : (
        <View testID="agents-team" style={{ gap: space[3] }}>
          <View style={{ gap: space[1] }}>
            <Text variant="body-medium">{t("Team of this session")}</Text>
            <Text variant="meta" color="text/secondary">{t("A request you give the team goes to its Director, who staffs the team's roles. Only a role that writes edits the project.")}</Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
            <Select label={t("Team")} width={theme.compact ? 220 : 280} value={tree.teamId ?? NO_TEAM} disabled={!props.mayAct || live || tree.agents.some((agent) => agent.depth > 0 && agentIsActive(agent))} options={teamOptions}
              onChange={(value) => void api.setTeam(value === NO_TEAM ? null : value)} />
            {host ? <Button kind="ghost" size="sm" label={role === "admin" ? t("Edit teams") : t("View teams")} testID="agents-edit-teams" onPress={() => router.push(hostSettingsRoute(host.gatewayId, "teams", tree.teamId ?? undefined) as never)} /> : null}
          </View>
          {chosen.team ? (
            <View testID="agents-team-roles" style={{ gap: space[1.5] }}>
              {chosen.team.roles.filter((entry) => entry.enabled).map((entry) => (
                // On a phone the responsibility has a line of its own under the role instead of a sliver beside it.
                <View key={entry.roleId} style={theme.compact ? { gap: space[0.5] } : { flexDirection: "row", alignItems: "center", gap: space[2] }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
                    <Text variant="body-medium" style={theme.compact ? { flexShrink: 1 } : { width: 150 }} numberOfLines={1}>{entry.label}</Text>
                    <Badge label={entry.tier === "supervisor" ? t("Director") : entry.tier === "lead" ? t("Lead") : t("Peer")} />
                    {entry.contract.canWrite ? <Badge label={t("Edits the project")} tone="accent" /> : null}
                  </View>
                  <Text variant="meta" color="text/secondary" numberOfLines={theme.compact ? 3 : 2} style={theme.compact ? undefined : { flex: 1 }}>{entry.contract.responsibility}</Text>
                </View>
              ))}
            </View>
          ) : <Text color="text/secondary">{t("No team: the agent may still create sub-agents on its own.")}</Text>}
          {chosen.team ? <TeamRunPanel teamName={chosen.team.name} mayAct={props.mayAct} api={runs} working={totals.running} cardsAbove /> : null}
        </View>
      )}
    </ScrollView>
  );
}

/**
 * The roster docked as a 264 px column between a session's chat and its workspace. It is there only while the person
 * docked it on this device, the session has agents besides its own, and the window is wide enough; otherwise the
 * roster is in the Agents tab.
 */
export function DockedRoster(props: { sessionKey: string; mayAct: boolean }) {
  const t = useT();
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const [docked, setDocked] = usePref(useMemo(() => dockPreference(props.sessionKey), [props.sessionKey]));
  const api = useAgentTree(docked ? props.sessionKey : undefined);
  if (!docked || theme.compact || width < DOCK_MIN_WINDOW || !api.tree || api.tree.agents.length <= 1) return null;
  const totals = treeTotals(api.tree.agents);
  return (
    <View testID="agents-docked" style={{ width: 264, borderStartWidth: 1, borderStartColor: theme.color("border/hairline") }}>
      <View style={{ height: 36, flexDirection: "row", alignItems: "center", gap: space[1], paddingHorizontal: space[2], borderBottomWidth: 1, borderBottomColor: theme.color("border/hairline") }}>
        <Text variant="body-medium" style={{ flex: 1 }} numberOfLines={1}>{t("Session agents")}</Text>
        <Text variant="meta" color="text/secondary">{t("{running} running", { running: totals.running })}</Text>
        <Button kind="ghost" size="xs" icon="x" iconOnly label={t("Undock roster")} testID="agents-undock" onPress={() => setDocked(false)} />
      </View>
      <ScrollView contentContainerStyle={{ padding: space[1] }}>
        <RosterList tree={api.tree} api={api} mayAct={props.mayAct} />
      </ScrollView>
    </View>
  );
}
