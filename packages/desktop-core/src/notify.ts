/** A notification the app asks the desktop shell to show: what it shows, and what a click on it sends back. */
export type ShellNotification = { id: string; kind?: string; title: string; body?: string; route?: string; actions?: { id: string; label: string }[] };
export type NotificationPlan =
  | { show: true; options: { title: string; body: string; actions: { type: "button"; text: string }[] } }
  | { show: false; reason: "unattended" | "unsupported"; log: string };
/**
 * What the main process does with it. An unattended run (`JAGENTCHILL_UNATTENDED=1`, the tests) shows NOTHING on the
 * machine: the log line says what would have been shown. A system without notifications shows nothing either.
 */
export function notificationPlan(notification: ShellNotification, env: { unattended: boolean; supported: boolean }): NotificationPlan {
  const said = JSON.stringify({ id: notification.id, kind: notification.kind ?? "", title: notification.title, body: notification.body ?? "", ...(notification.route ? { route: notification.route } : {}) });
  if (env.unattended) return { show: false, reason: "unattended", log: `[notification] not shown (unattended): ${said}` };
  if (!env.supported) return { show: false, reason: "unsupported", log: `[notification] not shown (the system has no notifications): ${said}` };
  return { show: true, options: { title: notification.title, body: notification.body ?? "", actions: (notification.actions ?? []).map((action) => ({ type: "button" as const, text: action.label })) } };
}
/** What a click sends to the window: the notification, the route of what it is about, and the button when one was pressed. */
export const notificationActivation = (notification: ShellNotification, actionIndex?: number): { id: string; route?: string; action?: string } => {
  const action = actionIndex === undefined ? undefined : notification.actions?.[actionIndex]?.id;
  return { id: notification.id, ...(notification.route ? { route: notification.route } : {}), ...(action ? { action } : {}) };
};
/** Keep unattended test and automation processes from changing the machine's visible Dock or taskbar badge. */
export function setAttentionBadge(count: number, unattended: boolean, setCount: (value: number) => void): void {
  if (!unattended) setCount(count);
}
