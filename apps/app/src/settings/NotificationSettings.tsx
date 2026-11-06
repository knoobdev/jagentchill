import { useEffect, useState } from "react";
import { View } from "react-native";
import { NOTICE_CATEGORIES, NOTICE_CATEGORY_LABELS, PREFS, type NoticeCategory } from "@jagentchill/app-core";
import { Button, Callout, GroupedSettingCard, SettingRow, Switch, Text, space } from "@jagentchill/ui";
import { useT } from "../locale";
import { askOsPermission, openOsNotificationSettings, osKind, osPermission, showOutside, type OsPermission } from "../platform/osNotify";
import { outsideOn } from "../shell/NotificationFeeds";
import { usePref } from "../state";

/**
 * Settings ▸ Notifications, for this device. The list behind the bell always gets every entry; this page decides what is
 * ALSO shown outside the app by the operating system: whether at all, only while the app is not in front, and for
 * which kinds. A browser is asked for its permission here, when the person turns the first switch on — never on load.
 */
export function NotificationSettings() {
  const t = useT();
  const kind = osKind();
  const [choice, setChoice] = usePref(PREFS.notifyOutside);
  const [onlyUnfocused, setOnlyUnfocused] = usePref(PREFS.notifyOnlyUnfocused);
  const [off, setOff] = usePref(PREFS.notifyOff);
  const [permission, setPermission] = useState<OsPermission | null>(null);
  useEffect(() => { let gone = false; void osPermission().then((state) => { if (!gone) setPermission(state); }); return () => { gone = true; }; }, []);
  const wanted = outsideOn(choice), on = wanted && permission === "granted";
  const turn = async (next: boolean) => {
    if (!next) { setChoice("off"); return; }
    const state = await askOsPermission();
    setPermission(state);
    setChoice(state === "granted" ? "on" : "off");
  };
  const state = permission === null ? "" : permission === "granted" ? t("Allowed") : permission === "denied" ? t("Blocked") : permission === "default" ? t("Not asked yet") : t("Not available");
  const setKind = (category: NoticeCategory, shown: boolean) => setOff(shown ? off.filter((entry) => entry !== category) : [...off.filter((entry) => entry !== category), category]);
  return (
    <View testID="notification-settings" style={{ gap: space[3] }}>
      <Text color="text/secondary">{t("Every notification is kept in the list behind the bell. Here you choose what is also shown outside the app on this device.")}</Text>
      {kind === "mobile" ? <Callout tone="info">{t("This version does not show notifications outside the app on a phone or a tablet. They are in the list behind the bell.")}</Callout> : null}
      {permission === "denied" ? <Callout tone="warning">{t("Your browser blocks notifications for this site. Allow them in the site settings of the browser, then turn this on again.")}</Callout> : null}
      {permission === "unsupported" && kind !== "mobile" ? <Callout tone="warning">{t("This device cannot show notifications outside the app.")}</Callout> : null}
      <GroupedSettingCard>
        <SettingRow label={t("Show notifications outside the app")} description={kind === "web" ? t("Your browser asks for its permission when you turn this on.") : t("Shown by the notification centre of your computer. A click opens what it is about.")}>
          <Switch accessibilityLabel={t("Show notifications outside the app")} value={on} disabled={kind === "mobile" || permission === "unsupported"} onChange={turn} />
        </SettingRow>
        <SettingRow label={t("Permission of this device")}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
            <Text testID="notify-permission" color="text/secondary">{state}</Text>
            {kind === "desktop" ? <Button size="sm" label={t("Open system settings")} onPress={openOsNotificationSettings} /> : null}
          </View>
        </SettingRow>
        <SettingRow label={t("Only when the app is not in front")} description={t("While you are looking at the app, the list and the message inside the app tell you.")}>
          <Switch accessibilityLabel={t("Only when the app is not in front")} value={onlyUnfocused} disabled={!on} onChange={setOnlyUnfocused} />
        </SettingRow>
        <SettingRow label={t("Send a test notification")} description={t("Shows one outside the app now, whatever the switches below say.")} last>
          <Button size="sm" label={t("Send")} testID="notify-test" disabled={!on} onPress={() => showOutside({ id: `test-${Date.now()}`, kind: "other", title: "JAgentChill", body: t("This is how a notification looks on this device."), route: "/settings/notifications" }, () => undefined)} />
        </SettingRow>
      </GroupedSettingCard>
      <Text variant="title-sm" level={2}>{t("Shown outside the app for")}</Text>
      <GroupedSettingCard>
        {NOTICE_CATEGORIES.map((category, index) => (
          <SettingRow key={category} label={t(NOTICE_CATEGORY_LABELS[category].label)} description={t(NOTICE_CATEGORY_LABELS[category].description)} last={index === NOTICE_CATEGORIES.length - 1}>
            <Switch accessibilityLabel={t(NOTICE_CATEGORY_LABELS[category].label)} value={!off.includes(category)} disabled={!on} onChange={(shown) => setKind(category, shown)} />
          </SettingRow>
        ))}
      </GroupedSettingCard>
    </View>
  );
}
