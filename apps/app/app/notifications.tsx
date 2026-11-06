import { useT } from "../src/locale";
import { AppShell } from "../src/shell/AppShell";
import { NotificationList } from "../src/shell/NotificationCentre";

/** `/notifications`: the notification centre as a screen — where the bell leads on a phone. On wide screens the bell opens the same list as a popover. */
export default function Notifications() {
  const t = useT();
  return <AppShell title={t("Notifications")}><NotificationList fill /></AppShell>;
}
