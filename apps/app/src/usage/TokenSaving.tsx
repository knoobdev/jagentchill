import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { Button, Card, Input, Segmented, StatusPill, Switch, Text, space, useToast } from "@jagentchill/ui";
import { reasonOf } from "../agents/errors";
import { useHost } from "../host";
import { useT } from "../locale";

type Settings = { autoCompactPct: number; tokenLimits: { perSession: number; perDay: number }; turnToolCalls: number; shortTurnContext: boolean; steps: number[]; turnToolCallSteps: number[] };

/** A row of the card: what the saving does, and its state or control at the end. */
function Row(props: { id: string; title: string; text: string; children: React.ReactNode }) {
  return (
    <View testID={`token-saving-${props.id}`} style={{ flexDirection: "row", alignItems: "center", gap: space[3], flexWrap: "wrap" }}>
      <View style={{ flex: 1, minWidth: 200, gap: space[0.5] }}>
        <Text variant="body-medium">{props.title}</Text>
        <Text variant="meta" color="text/secondary">{props.text}</Text>
      </View>
      {props.children}
    </View>
  );
}

/**
 * Host ▸ Usage and limits ▸ Limits: what the host does by itself to spend fewer tokens, each with its state. The ones
 * with a choice are changed here by an admin device; none of them restricts which model a person may choose.
 */
export function TokenSaving(props: { admin: boolean }) {
  const t = useT();
  const toast = useToast();
  const { connection } = useHost();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [perSession, setPerSession] = useState("");
  const [perDay, setPerDay] = useState("");
  const take = useCallback((next: Settings) => { setSettings(next); setPerSession(next.tokenLimits.perSession ? String(next.tokenLimits.perSession) : ""); setPerDay(next.tokenLimits.perDay ? String(next.tokenLimits.perDay) : ""); }, []);
  useEffect(() => { void connection?.call<Settings>("jagentchill.context.settings.get", {}).then(take).catch(() => undefined); }, [connection, take]);
  if (!settings) return null;
  const set = async (patch: Record<string, unknown>) => {
    try { take(await connection!.call<Settings>("jagentchill.context.settings.set", patch)); }
    catch (error) { toast.show({ kind: "error", message: reasonOf(error) }); throw error; }
  };
  const count = (text: string) => { const value = Number(text.replace(/[\s,._]/g, "")); return text.trim() === "" ? 0 : Number.isInteger(value) && value > 0 ? value : null; };
  const limits = { perSession: count(perSession), perDay: count(perDay) };
  const changed = limits.perSession !== settings.tokenLimits.perSession || limits.perDay !== settings.tokenLimits.perDay;
  const on = <StatusPill label={t("On")} tone="success" />;
  return (
    <View testID="token-saving" style={{ gap: space[3] }}>
      <Text variant="body-medium" level={2}>{t("Token saving")}</Text>
      <Text variant="meta" color="text/secondary">{t("What this host does by itself to spend fewer tokens. None of it restricts which model you choose.")}</Text>
      <Card style={{ gap: space[3] }}>
        <Row id="compact" title={t("Compact automatically")} text={t("A session whose last request filled this share of the model's context window is compacted before the next message. Each session can choose its own value from its context meter.")}>
          <Segmented size="sm" label={t("Compact automatically")} disabled={!props.admin} options={settings.steps.map((step) => ({ value: String(step), label: step === 0 ? t("Off") : `${step}%` }))} value={String(settings.autoCompactPct)} onChange={(value) => void set({ autoCompactPct: Number(value) }).catch(() => undefined)} />
        </Row>
        <Row id="context" title={t("Short turn context")} text={t("The project's context is sent in full with the first message and after a change; in between, one line.")}>
          <Switch value={settings.shortTurnContext} accessibilityLabel={t("Short turn context")} disabled={!props.admin} onChange={(value) => set({ shortTurnContext: value })} />
        </Row>
        <Row id="results" title={t("Compact tool results")} text={t("Timeline snapshots are summaries unless the agent asks for more, lists are paged, and no result is larger than 32 KiB.")}>{on}</Row>
        <Row id="runaway" title={t("Pause a runaway turn")} text={t("A turn that makes this many tool calls pauses and asks you to continue.")}>
          <Segmented size="sm" label={t("Pause a runaway turn")} disabled={!props.admin} options={settings.turnToolCallSteps.map((step) => ({ value: String(step), label: String(step) }))} value={String(settings.turnToolCalls)} onChange={(value) => void set({ turnToolCalls: Number(value) }).catch(() => undefined)} />
        </Row>
        <Row id="idle" title={t("Idle sessions do not generate")} text={t("No heartbeat, schedule or background memory pass calls a model while nobody is asking.")}>{on}</Row>
        <Row id="limits" title={t("Token limits")} text={t("A session, or the whole host in one day, stops at its limit; the composer warns at 80 %. Empty means no limit. A person can raise the limit of their own session.")}>
          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: space[2], flexWrap: "wrap" }}>
            <View style={{ width: 132, gap: space[0.5] }}><Text variant="meta" color="text/secondary">{t("Per session")}</Text><Input size="sm" value={perSession} onChangeText={setPerSession} inputMode="numeric" placeholder={t("No limit")} disabled={!props.admin} invalid={limits.perSession === null} aria-label={t("Token limit per session")} testID="token-limit-session" /></View>
            <View style={{ width: 132, gap: space[0.5] }}><Text variant="meta" color="text/secondary">{t("Per day")}</Text><Input size="sm" value={perDay} onChangeText={setPerDay} inputMode="numeric" placeholder={t("No limit")} disabled={!props.admin} invalid={limits.perDay === null} aria-label={t("Token limit per day")} testID="token-limit-day" /></View>
            <Button size="sm" label={t("Save")} testID="token-limit-save" disabled={!props.admin || !changed || limits.perSession === null || limits.perDay === null} onPress={() => void set({ tokenLimits: limits }).catch(() => undefined)} />
          </View>
        </Row>
      </Card>
    </View>
  );
}
