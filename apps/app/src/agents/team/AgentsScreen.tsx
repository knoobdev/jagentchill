import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { applyAgentEvent, treeTotals, type AgentTree } from "@jagentchill/app-core";
import type { AgentUpdatedEvent } from "@jagentchill/protocol";
import { Button, Callout, Card, EmptyState, SkeletonList, Text, space, useToast } from "@jagentchill/ui";
import { useHost } from "../../host";
import { useT } from "../../locale";
import { Screen, useHostScopeState } from "../../shell/Shell";
import { reasonOf } from "../errors";
import { hostSettingsRoute } from "../ModelBrowser";
import { RosterList } from "./AgentsTab";

/** The host-wide Agents screen: every agent tree this device can read that has sub-agents or a team, by session. */
export function AgentsScreen() {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const scope = useHostScopeState(t("Agents"));
  const { host, connection, status, onEvent, can } = useHost();
  const [trees, setTrees] = useState<AgentTree[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((value) => value + 1), []);
  useEffect(() => {
    if (!connection || status !== "connected") return;
    let cancelled = false;
    setError(null);
    void connection.call<{ trees: AgentTree[] }>("jagentchill.agent.list", { scope: "host" }).then((listed) => { if (!cancelled) setTrees(listed.trees); }).catch((failure) => { if (!cancelled) setError(failure); });
    return () => { cancelled = true; };
  }, [connection, status, nonce]);
  useEffect(() => onEvent((event) => {
    if (event.event !== "jagentchill.agent.updated") return;
    const change = event.payload as AgentUpdatedEvent;
    setTrees((held) => {
      if (!held) return held;
      const at = held.findIndex((tree) => tree.rootId === change.rootId);
      // A tree this screen does not hold yet, or one that missed an event, is read again.
      const next = at === -1 ? null : applyAgentEvent(held[at], change);
      if (next === null) { reload(); return held; }
      return held.map((tree, index) => (index === at ? next : tree));
    });
  }), [onEvent, reload]);
  if (scope) return <Screen title={t("Agents")}>{scope}</Screen>;
  const act = async (method: string, params: Record<string, unknown>) => {
    if (!connection) return false;
    try { await connection.call(method, params); reload(); return true; } catch (failure) { toast.show({ kind: "error", message: reasonOf(failure) }); return false; }
  };
  const mayAct = can("jagentchill.agent.use");
  return (
    <Screen title={t("Agents")}>
      <ScrollView testID="agents-screen" contentContainerStyle={{ padding: space[5], gap: space[3], alignItems: "center" }}>
        <View style={{ width: "100%", maxWidth: 880, gap: space[3] }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
            <View style={{ flex: 1, gap: space[0.5] }}>
              <Text variant="h1" level={1}>{t("Agents")}</Text>
              <Text color="text/secondary">{t("Sessions on this host whose agent works with sub-agents or a team.")}</Text>
            </View>
            {host ? <Button size="sm" label={t("Teams")} testID="agents-screen-teams" onPress={() => router.push(hostSettingsRoute(host.gatewayId, "teams") as never)} /> : null}
          </View>
          {error ? <Callout tone="danger" actions={[{ label: t("Retry"), onPress: reload }]}>{t("Unable to load agents")}</Callout> : null}
          {!trees && !error ? <SkeletonList rows={3} leading="avatar" meta /> : null}
          {trees && trees.length === 0 ? <EmptyState icon="bot" title={t("No agent teams yet")} description={t("A session appears here when its agent creates sub-agents or is given a team.")} /> : null}
          {(trees ?? []).map((tree) => {
            const totals = treeTotals(tree.agents), root = tree.agents[0];
            return (
              <Card key={tree.rootId} padding={space[3]}>
                <View style={{ gap: space[2] }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
                    <Text variant="body-medium" style={{ flex: 1 }} numberOfLines={1}>{root?.title ?? t("Session")}</Text>
                    <Text variant="meta" color="text/secondary">{[t("{count} agents", { count: tree.agents.length }), t("{running} running", { running: totals.running })].join(" · ")}</Text>
                    {host && root ? <Button kind="ghost" size="xs" label={t("Open session")} onPress={() => router.push(`/h/${host.gatewayId}/sessions/${encodeURIComponent(root.sessionKey)}` as never)} /> : null}
                    {mayAct && totals.running > 0 ? <Button size="xs" icon="stop" label={t("Stop all")} onPress={() => void act("jagentchill.agent.stopAll", { rootId: tree.rootId })} /> : null}
                  </View>
                  <RosterList tree={tree} mayAct={mayAct} api={{ stop: (agentId) => act("jagentchill.agent.stop", { agentId }), archive: (agentId) => act("jagentchill.agent.archive", { agentId }), send: (agentId, prompt) => act("jagentchill.agent.send", { agentId, prompt }) }} />
                </View>
              </Card>
            );
          })}
        </View>
      </ScrollView>
    </Screen>
  );
}
