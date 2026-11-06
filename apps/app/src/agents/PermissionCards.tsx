import { useEffect, useState, type ReactNode } from "react";
import { hostLists } from "./hostLists";
import { cardDigits } from "./cardMoney";
import { View } from "react-native";
import { formatTimeOfDay, formatUsd } from "@jagentchill/app-core";
import type { GenerationMessageCard, PermissionDecision, PermissionRequest } from "@jagentchill/protocol";
import { Button, Card, Icon, Input, StatusPill, Text, compactScale, radius, space, typography, useTheme, useToast } from "@jagentchill/ui";
import { useHost } from "../host";
import { useT } from "../locale";
import { reasonOf } from "./errors";
import { mergeFetchedPermissions } from "./permissionList";
import { permissionWords } from "./permissionWords";

/**
 * The permission cards of a session (`chat-agent.Permission request cards`): a `jc_*` tool call the host holds until a
 * person allows it (starting a workflow run, an import from a URL, another project…). Read once, then followed through
 * the permission events; answered from the card. Each card is handed to the chat pane with the time it was asked, so it
 * stands at that place of the conversation — in the session view and in every panel that shows the session's chat.
 */
export type PermissionCardEntry = { id: string; ts_ms: number; node: ReactNode; /** The session that asked, and whether it still waits for an answer. */ sessionKey: string; pending: boolean };
export function usePermissionCards(props: { sessionKey: string }): PermissionCardEntry[] { return usePermissionCardsOf([props.sessionKey]); }

/**
 * The same cards for several sessions at once: the run view of a workflow shows what the sessions of its steps ask
 * while those steps are at work. A session that leaves the list takes its cards with it; the others keep theirs.
 */
export function usePermissionCardsOf(sessionKeys: readonly string[]): PermissionCardEntry[] {
  const { connection, onEvent, status } = useHost();
  const [requests, setRequests] = useState<PermissionRequest[]>([]);
  const joined = [...new Set(sessionKeys)].sort().join("\n");
  const messageCards = useMessageCards(joined);
  // The sessions whose list has answered: the chat is told AFTER their requests are on screen (see `hostLists`).
  const [listed, setListed] = useState<string[]>([]);
  useEffect(() => { for (const sessionKey of listed) hostLists.answered(sessionKey, "permission"); }, [listed]);
  useEffect(() => {
    const keys = new Set(joined ? joined.split("\n") : []);
    setListed([]);
    setRequests((live) => live.filter((entry) => keys.has(entry.sessionKey)));
    if (!connection || status !== "connected" || !keys.size) return;
    let cancelled = false;
    const put = (request: PermissionRequest) => setRequests((live) => (live.some((entry) => entry.requestId === request.requestId) ? live.map((entry) => (entry.requestId === request.requestId ? request : entry)) : [...live, request]));
    // What this device held from before (a reconnect) is replaced by the host's list; only the events of this
    // connection that arrive while a list is on its way are newer than it.
    const during = new Map<string, PermissionRequest>();
    for (const sessionKey of keys) {
      hostLists.asked(sessionKey, "permission");
      void connection.call<{ requests: PermissionRequest[] }>("jagentchill.chat.approval.list", { sessionKey }).then((listed) => {
        if (!cancelled) setRequests((live) => mergeFetchedPermissions(live, sessionKey, listed.requests, during));
      }).catch(() => undefined).then(() => { if (!cancelled) setListed((known) => [...known, sessionKey]); });
    }
    const off = onEvent((event) => {
      if (event.event !== "jagentchill.chat.permission.requested" && event.event !== "jagentchill.chat.permission.resolved") return;
      const request = (event.payload as { request?: PermissionRequest }).request;
      if (request && keys.has(request.sessionKey)) { during.set(request.requestId, request); put(request); }
    });
    return () => { cancelled = true; off(); };
  }, [connection, status, joined, onEvent]);
  // ONE card for the paid things an agent's message wants to make: while it waits, the same calls are not also asked one by one.
  const single = requests.filter((request) => !supersededBy(request, messageCards.cards));
  return [
    ...single.map((request) => ({
      id: `permission-${request.requestId}`, ts_ms: request.created_ms, sessionKey: request.sessionKey, pending: request.state === "pending",
      node: <PermissionCard request={request} onResolved={(next) => setRequests((live) => live.map((entry) => (entry.requestId === next.requestId ? next : entry)))} />,
    })),
    ...messageCards.cards.map((card) => ({ id: `message-card-${card.cardId}`, ts_ms: card.created_ms, sessionKey: card.sessionKey, pending: card.state === "pending", node: <MessageCostCard card={card} onResolved={messageCards.put} /> })),
  ];
}

/**
 * A generation call that is asked about by itself while the card of its message waits is the same question twice: the
 * message's card lists it. (Only generation calls, only from the moment the card was put, only while it waits.)
 */
export const supersededBy = (request: Pick<PermissionRequest, "sessionKey" | "tool" | "state" | "created_ms">, cards: readonly Pick<GenerationMessageCard, "sessionKey" | "state" | "created_ms">[]): boolean =>
  request.state === "pending" && /^jc_generate_/.test(request.tool) && cards.some((card) => card.sessionKey === request.sessionKey && card.state === "pending" && request.created_ms >= card.created_ms - 2000);

/**
 * The cards the host keeps for the sessions' messages (`…provider.messageCard.list`), followed through
 * `…messageCard.updated` (an event of the job stream, which this hook subscribes to).
 */
function useMessageCards(joined: string): { cards: GenerationMessageCard[]; put(card: GenerationMessageCard): void } {
  const { connection, onEvent, status } = useHost();
  const [cards, setCards] = useState<GenerationMessageCard[]>([]);
  const put = (card: GenerationMessageCard) => setCards((live) => (live.some((entry) => entry.cardId === card.cardId) ? live.map((entry) => (entry.cardId === card.cardId ? card : entry)) : [...live, card]));
  useEffect(() => {
    const keys = new Set(joined ? joined.split("\n") : []);
    setCards((live) => live.filter((entry) => keys.has(entry.sessionKey)));
    if (!connection || status !== "connected" || !keys.size) return;
    let cancelled = false;
    // A device that may not read jobs, or a host without this card, simply has none.
    void connection.call("jagentchill.job.subscribe", {}).catch(() => undefined);
    for (const sessionKey of keys) void connection.call<{ cards: GenerationMessageCard[] }>("jagentchill.provider.messageCard.list", { sessionKey }).then((listed) => { if (!cancelled) for (const card of listed.cards) put(card); }).catch(() => undefined);
    const off = onEvent((event) => {
      if (event.event !== "jagentchill.provider.messageCard.updated") return;
      const card = (event.payload as { card?: GenerationMessageCard }).card;
      if (card && keys.has(card.sessionKey)) put(card);
    });
    return () => { cancelled = true; off(); };
  }, [connection, status, joined, onEvent]);
  return { cards, put };
}

/** What a call of the card makes, in a word a person knows. */
const MAKES: Record<string, string> = { image: "Picture", tts: "Speech", music: "Music", video: "Video", transcription: "Captions", translation: "Translation" };

/**
 * The ONE card of a message of the agent that wants to make paid things: each of them with what it asks for, the
 * model and its cost, the total, and Allow / Deny. Nothing of it is made before Allow. Once answered it is one line.
 */
function MessageCostCard(props: { card: GenerationMessageCard; onResolved(card: GenerationMessageCard): void }) {
  const t = useT();
  const theme = useTheme();
  const toast = useToast();
  const { connection, can, role } = useHost();
  const { card } = props;
  const [busy, setBusy] = useState<"allow" | "deny" | null>(null);
  const waiting = card.items.filter((item) => item.state === "waiting"), unknown = card.items.some((item) => item.amountUsd === null);
  const data = { dataSet: { state: card.state, card: card.cardId, items: String(card.items.length), total: String(card.totalUsd) } } as object;
  // The rows and the total are worded by the shared money formatter at ONE precision — the one at which every amount is exact — so they add up as shown.
  const digits = cardDigits([...card.items.map((item) => item.amountUsd), card.totalUsd]), cardMoney = (amount: number) => formatUsd(amount, { digits });
  const total = unknown ? (card.totalUsd > 0 ? t("{cost}, plus what has no known price", { cost: cardMoney(card.totalUsd) }) : t("Not known")) : cardMoney(card.totalUsd);
  if (card.state !== "pending") {
    const allowed = card.state === "allowed", when = card.decided_ms ? formatTimeOfDay(card.decided_ms) : "";
    return (
      <View testID="message-cost-card" {...data} style={{ flexDirection: "row", alignItems: "flex-start", gap: space[1.5] }}>
        <View style={{ height: typography.meta[theme.density].lineHeight, justifyContent: "center" }}><Icon name={allowed ? "check" : "x"} size={12} color="text/tertiary" /></View>
        <Text variant="meta" color="text/secondary" style={{ flex: 1 }}>
          {card.items.length === 1 ? t("1 paid item · {total}", { total }) : t("{n} paid items · {total}", { n: card.items.length, total })}{"  "}
          <Text variant="meta" color={allowed ? "text/primary" : "text/tertiary"} testID="message-cost-outcome" style={{ fontWeight: "500" }}>{allowed ? t("Allowed · {time}", { time: when }) : t("Denied · {time}", { time: when })}</Text>
        </Text>
      </View>
    );
  }
  const mayAnswer = role !== "viewer" && can("jagentchill.generation.run");
  const answer = async (decision: "allow" | "deny") => {
    if (!connection || busy) return;
    setBusy(decision);
    try { props.onResolved((await connection.call<{ card: GenerationMessageCard }>("jagentchill.provider.messageCard.resolve", { cardId: card.cardId, decision })).card); } catch (err) { toast.show({ kind: "error", message: reasonOf(err) }); }
    setBusy(null);
  };
  return (
    <Card padding={theme.compact ? compactScale.space.card : space[3]}>
      <View testID="message-cost-card" {...data} style={{ gap: space[2] }}>
          <View style={{ flexDirection: theme.compact ? "column" : "row", alignItems: theme.compact ? "stretch" : "center", gap: space[2] }}>
          <Icon name="shield" size={16} color="accent" />
          <Text variant="title-sm" style={{ flex: 1 }} testID="message-cost-title">{waiting.length === 1 ? t("The agent wants to make 1 paid item") : t("The agent wants to make {n} paid items", { n: waiting.length })}</Text>
          <StatusPill label={t("Waiting for your approval")} tone="warning" />
        </View>
        <View style={{ backgroundColor: theme.color("bg/inset"), borderRadius: radius.sm, borderWidth: 1, borderColor: theme.color("border/hairline"), padding: space[2], gap: space[2] }}>
          {card.items.map((item) => (
            <View key={item.itemId} testID="message-cost-item" {...({ dataSet: { state: item.state, capability: item.capability } } as object)} style={{ flexDirection: theme.compact ? "column" : "row", alignItems: "flex-start", gap: space[1] }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text variant="body-medium" numberOfLines={2}>{`${t(MAKES[item.capability] ?? "Generation")} — ${item.words}`}</Text>
                <Text variant="meta" color="text/secondary">{item.state === "made" ? t("Already made with {model}", { model: item.modelLabel }) : t("Made with {model}", { model: item.modelLabel })}</Text>
              </View>
              <Text tabular color={item.amountUsd === null ? "text/secondary" : "text/primary"} style={theme.compact ? { alignSelf: "flex-start" } : undefined}>{item.amountUsd === null ? t("Price not known") : cardMoney(item.amountUsd)}</Text>
            </View>
          ))}
          <View style={{ flexDirection: "row", alignItems: "center", gap: space[3], paddingTop: space[2], borderTopWidth: 1, borderTopColor: theme.color("border/hairline") }}>
            <Text variant="body-medium" style={{ flex: 1 }}>{t("Total")}</Text>
            <Text variant="body-medium" tabular testID="message-cost-total">{total}</Text>
          </View>
        </View>
        <Text variant="meta" color="text/secondary">{t("Nothing of this is made until you allow it.")}</Text>
        {!mayAnswer ? <Text variant="meta" color="text/secondary" testID="message-cost-readonly">{t("This device cannot approve")}</Text> : (
          <View style={{ flexDirection: theme.compact ? "column" : "row", alignItems: theme.compact ? "stretch" : "center", gap: space[2], flexWrap: "wrap" }}>
            <Button kind="primary" size="sm" block={theme.compact} label={t("Allow")} testID="message-cost-allow" loading={busy === "allow"} disabled={busy !== null} onPress={() => void answer("allow")} />
            <Button kind="ghost" size="sm" block={theme.compact} label={t("Deny")} testID="message-cost-deny" loading={busy !== "deny"} disabled={busy !== null} onPress={() => void answer("deny")} />
          </View>
        )}
      </View>
    </Card>
  );
}

/**
 * One permission request. While it waits: what the agent wants to do, the detail the host gave verbatim, and the
 * answers the request allows. A device that may not answer sees it read-only. Once answered it shrinks to one line.
 */
function PermissionCard(props: { request: PermissionRequest; onResolved(request: PermissionRequest): void }) {
  const t = useT();
  const theme = useTheme();
  const toast = useToast();
  const { connection, can, role } = useHost();
  const { request } = props;
  const [busy, setBusy] = useState<PermissionDecision | null>(null);
  const [why, setWhy] = useState<string | null>(null);
  // Any device that may answer can: the answered line says which one did.
  const device = request.resolver?.kind === "device" ? request.resolver.deviceName.trim() : "";
  const data = { dataSet: { state: request.state, tool: request.tool, request: request.requestId, resolver: device } } as object;
  // The title and the money line of a paid generation call are worded HERE, in the person's language, from the host's facts (a card does not mix languages).
  const words = permissionWords(t, request);

  if (request.state !== "pending") {
    const allowed = request.state === "allowed", when = request.decided_ms ? formatTimeOfDay(request.decided_ms) : "";
    return (
      <View testID="permission-card" {...data} style={{ flexDirection: "row", alignItems: "flex-start", gap: space[1.5] }}>
        <View style={{ height: typography.meta[theme.density].lineHeight, justifyContent: "center" }}><Icon name={allowed ? "check" : request.state === "expired" ? "clock" : "x"} size={12} color="text/tertiary" /></View>
        <Text variant="meta" color="text/secondary" style={{ flex: 1 }}>
          {words.title}{"  "}
          <Text variant="meta" color={allowed ? "text/primary" : "text/tertiary"} testID="permission-outcome" style={{ fontWeight: "500" }}>
            {request.state === "expired" ? t("Expired") : device ? (allowed ? t("Allowed by {device} · {time}", { device, time: when }) : t("Denied by {device} · {time}", { device, time: when })) : allowed ? t("Allowed · {time}", { time: when }) : t("Denied · {time}", { time: when })}
          </Text>
        </Text>
      </View>
    );
  }
  const mayAnswer = role !== "viewer" && request.requiredScope.every((scope) => can(scope as Parameters<typeof can>[0]));
  const answer = async (decision: PermissionDecision, reason?: string) => {
    if (!connection || busy) return;
    setBusy(decision);
    try {
      const result = await connection.call<{ request: PermissionRequest }>("jagentchill.chat.approval.resolve", { requestId: request.requestId, decision, ...(reason?.trim() ? { reason: reason.trim() } : {}) });
      props.onResolved(result.request);
    } catch (err) { toast.show({ kind: "error", message: reasonOf(err) }); }
    setBusy(null);
  };
  return (
    <Card padding={theme.compact ? compactScale.space.card : space[3]}>
      <View testID="permission-card" {...data} style={{ gap: space[2] }}>
        <View style={{ flexDirection: theme.compact ? "column" : "row", alignItems: theme.compact ? "stretch" : "center", gap: space[2] }}>
          <Icon name="shield" size={16} color="accent" />
          <Text variant="title-sm" style={{ flex: 1 }} testID="permission-title">{words.title}</Text>
          <StatusPill label={t("Waiting for your approval")} tone="warning" />
        </View>
        <Text color="text/secondary">{t("The agent asks to do this. It waits for your answer.")}</Text>
        <View style={{ backgroundColor: theme.color("bg/inset"), borderRadius: radius.sm, borderWidth: 1, borderColor: theme.color("border/hairline"), padding: space[2] }}>
          <Text selectable testID="permission-detail">{words.detail}</Text>
        </View>
        {request.copiedPrompt ? (
          <View style={{ gap: space[1] }}>
            <Text color="text/secondary" testID="permission-copied-note">{t("Part of this prompt was copied from content that came from outside the app (a file, captions or a message from another service). This is everything that will be sent:")}</Text>
            <View style={{ backgroundColor: theme.color("bg/inset"), borderRadius: radius.sm, borderWidth: 1, borderColor: theme.color("border/hairline"), padding: space[2] }}>
              <Text selectable testID="permission-copied-prompt">{request.copiedPrompt}</Text>
            </View>
          </View>
        ) : null}
        {!mayAnswer ? <Text variant="meta" color="text/secondary" testID="permission-readonly">{request.adminOnly ? t("Waiting for an admin device") : t("This device cannot approve")}</Text> : why !== null ? (
          <View style={{ gap: space[2] }}>
            <Input value={why} maxLength={2000} autoFocus accessibilityLabel={t("Why not")} placeholder={t("Tell the agent why…")} testID="permission-reason" onChangeText={setWhy} onSubmitEditing={() => void answer("deny", why)} />
          <View style={{ flexDirection: theme.compact ? "column" : "row", gap: space[2] }}>
              <Button kind="primary" size="sm" block={theme.compact} label={t("Deny")} testID="permission-deny-send" loading={busy === "deny"} disabled={busy !== null} onPress={() => void answer("deny", why)} />
              <Button kind="ghost" size="sm" block={theme.compact} label={t("Back")} disabled={busy !== null} onPress={() => setWhy(null)} />
            </View>
          </View>
        ) : (
          <View style={{ flexDirection: theme.compact ? "column" : "row", alignItems: theme.compact ? "stretch" : "center", gap: space[2], flexWrap: "wrap" }}>
            {request.actions.includes("allow-once") ? <Button kind="primary" size="sm" block={theme.compact} label={t("Allow once")} testID="permission-allow-once" loading={busy === "allow-once"} disabled={busy !== null} onPress={() => void answer("allow-once")} /> : null}
            {request.actions.includes("allow-session") ? <Button size="sm" block={theme.compact} label={t("Always allow for this session")} testID="permission-allow-session" loading={busy === "allow-session"} disabled={busy !== null} onPress={() => void answer("allow-session")} /> : null}
            {request.actions.includes("deny") ? <Button kind="ghost" size="sm" block={theme.compact} label={t("Deny")} testID="permission-deny" loading={busy === "deny"} disabled={busy !== null} onPress={() => void answer("deny")} /> : null}
            {request.actions.includes("deny") ? <Button kind="ghost" size="sm" block={theme.compact} label={t("Deny and tell the agent why")} testID="permission-deny-why" disabled={busy !== null} onPress={() => setWhy("")} /> : null}
          </View>
        )}
      </View>
    </Card>
  );
}
