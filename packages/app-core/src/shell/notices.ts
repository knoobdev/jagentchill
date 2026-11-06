/**
 * The notification centre of a device, as pure rules: what an entry is, how the list is grouped, what counts as unread,
 * and whether an entry is also shown OUTSIDE the app (an OS notification). The screens and the platform parts only
 * carry these out.
 */
export const NOTICE_CATEGORIES = ["needs-you", "finished", "money", "pairing", "sync", "media", "other"] as const;
export type NoticeCategory = (typeof NOTICE_CATEGORIES)[number];
/** What each kind is called in Settings ▸ Notifications and as the title of an OS notification. */
export const NOTICE_CATEGORY_LABELS: Record<NoticeCategory, { label: string; description: string }> = {
  "needs-you": { label: "The agent needs you", description: "A permission, a question, a disagreement or a hand-off waits for your decision" },
  finished: { label: "Finished or failed", description: "A run, a film or an export ended while you were elsewhere" },
  money: { label: "Paused for money", description: "A run waits because it would spend more than you confirmed or allowed" },
  pairing: { label: "Pairing requests", description: "A new device asks to pair with your host" },
  sync: { label: "Sync conflicts", description: "A project changed here and on another device" },
  media: { label: "Media that could not be fetched", description: "A file a project needs did not arrive on this device" },
  other: { label: "Everything else", description: "Imports, packages and other results of what you started" },
};
export type InboxNotice = {
  id: string; kind: "success" | "info" | "warning" | "error"; message: string; at_ms: number; read: boolean; route?: string;
  /** What the entry is about, when it waits for a decision that any device of the host may take; `resolved` once it no longer waits. */
  subject?: string; resolved?: boolean;
  category?: NoticeCategory;
};
export const categoryOf = (notice: Pick<InboxNotice, "category">): NoticeCategory => (notice.category && (NOTICE_CATEGORIES as readonly string[]).includes(notice.category) ? notice.category : "other");
/** An entry that still waits for the person: it has a subject and nobody decided it yet. */
export const isWaiting = (notice: Pick<InboxNotice, "subject" | "resolved"> & Partial<Pick<InboxNotice, "category">>): boolean => Boolean(notice.subject) && !notice.resolved && notice.category !== "finished";
export const unreadCount = (entries: readonly Pick<InboxNotice, "read">[]): number => entries.filter((entry) => !entry.read).length;
/** The number on the bell: nothing at zero, "99+" above 99. */
export const badgeLabel = (count: number): string | null => (count <= 0 ? null : count > 99 ? "99+" : String(count));

const dayStart = (ms: number): number => { const day = new Date(ms); day.setHours(0, 0, 0, 0); return day.getTime(); };
export type NoticeGroup<T> = { id: string; title: "waiting" | "today" | "yesterday" | "day"; day_ms: number; entries: T[] };
/**
 * The list of the centre: what still waits for the person first, then the rest by day — today, yesterday, then each
 * earlier day — newest first inside every group.
 */
export function groupNotices<T extends InboxNotice>(entries: readonly T[], now_ms: number): NoticeGroup<T>[] {
  const newest = (a: T, b: T) => b.at_ms - a.at_ms;
  const waiting = entries.filter(isWaiting).sort(newest), rest = entries.filter((entry) => !isWaiting(entry)).sort(newest);
  const today = dayStart(now_ms), yesterday = dayStart(today - 1);
  const groups: NoticeGroup<T>[] = waiting.length ? [{ id: "waiting", title: "waiting", day_ms: today, entries: waiting }] : [];
  for (const entry of rest) {
    const day = dayStart(entry.at_ms), last = groups[groups.length - 1];
    if (last && last.title !== "waiting" && last.day_ms === day) last.entries.push(entry);
    else groups.push({ id: `day-${day}`, title: day >= today ? "today" : day === yesterday ? "yesterday" : "day", day_ms: day, entries: [entry] });
  }
  return groups;
}

/** What the person chose in Settings ▸ Notifications on this device. `off`: the kinds whose switch is off. */
export type OutsidePrefs = { outside: boolean; onlyUnfocused: boolean; off: readonly string[] };
export type OutsideState = {
  /** The app's window has the focus and is visible. */
  focused: boolean;
  /** What the operating system (or the browser) says about showing notifications for this app. */
  permission: "granted" | "denied" | "default" | "unsupported";
};
export type OutsideDecision = { show: true } | { show: false; why: "off" | "kind-off" | "no-permission" | "app-in-front" | "already-read" };
/**
 * Whether an entry is shown outside the app. Never when the person did not turn it on, when the kind is off, when the
 * system has not given (or has refused) the permission, or for an entry that is born read. With "only when the app is
 * not in front" it is not shown while the window is focused — the centre and the toast inside the app say it then.
 */
export function outsideDecision(notice: InboxNotice, prefs: OutsidePrefs, state: OutsideState): OutsideDecision {
  if (!prefs.outside) return { show: false, why: "off" };
  if (prefs.off.includes(categoryOf(notice))) return { show: false, why: "kind-off" };
  if (state.permission !== "granted") return { show: false, why: "no-permission" };
  if (notice.read) return { show: false, why: "already-read" };
  if (prefs.onlyUnfocused && state.focused) return { show: false, why: "app-in-front" };
  return { show: true };
}
export type OutsideNotification = { id: string; kind: string; title: string; body: string; route?: string };
/** The OS notification of an entry: the kind as its title, the entry's sentence (at most 240 characters) as its body. */
export function outsideNotification(notice: InboxNotice, title: string): OutsideNotification {
  const body = Array.from(notice.message);
  return { id: notice.id, kind: categoryOf(notice), title, body: body.length > 240 ? `${body.slice(0, 239).join("")}…` : notice.message, ...(notice.route ? { route: notice.route } : {}) };
}
