import { useRouter } from "expo-router";
import { ScrollView, View } from "react-native";
import { NOTICE_CATEGORY_LABELS, categoryOf, formatDay, groupNotices, isWaiting, relativeTime, unreadCount } from "@jagentchill/app-core";
import { Button, Dot, Icon, IconButton, ListCaption, Tap, Text, space, useTheme } from "@jagentchill/ui";
import { useT } from "../locale";
import { notifications, useNotifications, type Notice } from "../notifications";

/**
 * The notification centre: what waits for the person first, then everything else by day. The ONE list — the popover
 * behind the bell shows it on wide screens, the `/notifications` screen on a phone. An entry opens the thing it is
 * about and becomes read; "Mark all as read" and "Clear" act on the whole list, the two small buttons of a row on it.
 */
export function NotificationList(props: { onNavigate?(): void; fill?: boolean }) {
  const t = useT();
  const theme = useTheme();
  const router = useRouter();
  const entries = useNotifications();
  const now = Date.now();
  const groups = groupNotices(entries, now);
  const unread = unreadCount(entries);
  const tone = { success: "success/text", info: "text/secondary", warning: "warning/text", error: "danger/text" } as const;
  const open = (entry: Notice) => { notifications.markRead(entry.id); if (entry.route) { props.onNavigate?.(); router.push(entry.route as never); } };
  const heading = (group: (typeof groups)[number]) => (group.title === "waiting" ? t("Needs you") : group.title === "today" ? t("Today") : group.title === "yesterday" ? t("Yesterday") : formatDay(group.day_ms, theme.locale));
  return (
    <View testID="inbox" style={props.fill ? { flex: 1, minHeight: 0 } : { width: 380, maxWidth: "100%", maxHeight: 480 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[1], paddingStart: space[3], paddingEnd: space[1], minHeight: 44, borderBottomWidth: 1, borderBottomColor: theme.color("border/hairline") }}>
        {/* As a screen the top bar already says "Notifications": the row keeps its room for the buttons. */}
        {props.fill ? <View style={{ flex: 1 }} /> : <Text variant="body-medium" style={{ flex: 1 }} numberOfLines={1}>{unread > 0 ? t("Notifications · {n} unread", { n: unread }) : t("Notifications")}</Text>}
        {unread > 0 ? <Button kind="ghost" size="xs" label={t("Mark all as read")} testID="inbox-read-all" style={theme.touch ? { minHeight: 44 } : undefined} onPress={() => notifications.markAllRead()} /> : null}
        {entries.length > 0 ? <Button kind="ghost" size="xs" label={t("Clear all")} testID="inbox-clear" style={theme.touch ? { minHeight: 44 } : undefined} onPress={() => notifications.clear()} /> : null}
        <IconButton icon="gear" size="sm" label={t("Notification settings")} testID="inbox-settings" onPress={() => { props.onNavigate?.(); router.push("/settings/notifications" as never); }} />
      </View>
      <ScrollView style={props.fill ? { flex: 1, minHeight: 0 } : undefined}>
        {groups.map((group) => (
          <View key={group.id} testID={`inbox-group-${group.title}`} role="group" aria-label={heading(group)}>
            <View style={{ paddingHorizontal: space[1] }}><ListCaption label={heading(group)} /></View>
            {group.entries.map((entry) => {
              const category = categoryOf(entry);
              const meta = `${relativeTime(entry.at_ms, now, theme.locale)}${category === "other" ? "" : ` · ${t(NOTICE_CATEGORY_LABELS[category].label)}`}`;
              return (
                <View key={entry.id} testID="inbox-entry" {...({ dataSet: { read: String(entry.read), category, waiting: String(isWaiting(entry)) } } as object)}
                  style={{ minHeight: theme.touch ? 44 : undefined, flexDirection: "row", alignItems: "flex-start", borderTopWidth: 1, borderTopColor: theme.color("border/hairline") }}>
                  <Tap role="button" label={entry.message} testID={entry.route ? "inbox-entry-link" : "inbox-entry-text"} onPress={() => open(entry)}
                    style={(state) => ({ flex: 1, minWidth: 0, minHeight: theme.touch ? 44 : undefined, flexDirection: "row", gap: space[2], paddingStart: space[3], paddingEnd: space[1], paddingVertical: space[2], backgroundColor: state.hovered || state.pressed ? theme.color("bg/hover") : "transparent" })}>
                    <View style={{ paddingTop: space[1.5] }}><Dot tone={entry.read ? "off" : "accent"} /></View>
                    <View style={{ flex: 1, minWidth: 0, gap: space[0.5] }}>
                      <Text numberOfLines={3} style={entry.read ? undefined : { fontWeight: "500" }}>{entry.message}</Text>
                      <Text variant="meta" color={tone[entry.kind]} numberOfLines={1}>{meta}</Text>
                    </View>
                  </Tap>
                  <View style={{ flexDirection: "row", paddingTop: space[1], paddingEnd: space[1] }}>
                    {entry.read ? null : <IconButton icon="check" size="xs" label={t("Mark as read")} testID={`inbox-entry-read-${entry.id}`} onPress={() => notifications.markRead(entry.id)} />}
                    <IconButton icon="x" size="xs" label={t("Remove from the list")} testID={`inbox-entry-remove-${entry.id}`} onPress={() => notifications.remove(entry.id)} />
                  </View>
                </View>
              );
            })}
          </View>
        ))}
        {entries.length === 0 ? <View testID="inbox-empty" style={{ alignItems: "center", gap: space[1], padding: space[6] }}><Icon name="bell" size={24} color="text/secondary" /><Text color="text/secondary">{t("You're all caught up")}</Text></View> : null}
      </ScrollView>
    </View>
  );
}
