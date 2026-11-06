/**
 * Notifications outside the app: the desktop app shows them through its main process (Electron's Notification — a click
 * focuses the window and opens the entry's route), a browser through the Notifications API. A browser is asked for its
 * permission only by `askOsPermission`, which Settings ▸ Notifications calls when the person turns the switch on.
 */
import type { OutsideNotification, OutsideState } from "@jagentchill/app-core";
import { desktop } from "./desktop";

export type OsPermission = OutsideState["permission"];
const browser = (): typeof Notification | null => (typeof Notification === "undefined" ? null : Notification);
export const osKind = (): "desktop" | "web" | "mobile" => (desktop() ? "desktop" : "web");
export async function osPermission(): Promise<OsPermission> {
  const bridge = desktop();
  if (bridge) return (await bridge.notifications.permission().catch(() => "unsupported")) === "granted" ? "granted" : "unsupported";
  return browser()?.permission ?? "unsupported";
}
export async function askOsPermission(): Promise<OsPermission> {
  if (desktop()) return osPermission();
  const api = browser();
  if (!api) return "unsupported";
  if (api.permission !== "default") return api.permission;
  try { return await api.requestPermission(); } catch { return api.permission; }
}
export function showOutside(notification: OutsideNotification, onOpen: () => void): void {
  const bridge = desktop();
  // The desktop app answers a click itself: it focuses the window and sends the route back (`notifications.activated`).
  if (bridge) { void bridge.notifications.show(notification).catch(() => undefined); return; }
  const api = browser();
  if (!api || api.permission !== "granted") return;
  try {
    const shown = new api(notification.title, { body: notification.body, tag: notification.id });
    shown.onclick = () => { try { window.focus(); } catch { /* the browser decides */ } shown.close(); onOpen(); };
  } catch { /* a browser that only shows notifications from a service worker: nothing is shown */ }
}
export const appInFront = (): boolean => document.visibilityState === "visible" && document.hasFocus();
export const openOsNotificationSettings = (): void => { void desktop()?.notifications.openSystemSettings().catch(() => undefined); };
export function setOsBadge(count: number): void { void desktop()?.notifications.setBadge(count).catch(() => undefined); }
/** The desktop app says which notification was clicked. */
export function onOutsideOpened(listener: (id: string) => void): () => void { return desktop()?.notifications.onActivated((event) => listener(event.id)) ?? (() => {}); }
