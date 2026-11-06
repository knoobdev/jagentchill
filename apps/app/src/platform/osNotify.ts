/**
 * Notifications outside the app on iOS and Android. The app ships no notification module (`expo-notifications` is not a
 * dependency), so nothing is shown outside the app here and the settings page says so. The web and desktop part is
 * `osNotify.web.ts`.
 */
import type { OutsideNotification, OutsideState } from "@jagentchill/app-core";

export type OsPermission = OutsideState["permission"];
export const osKind = (): "desktop" | "web" | "mobile" => "mobile";
export const osPermission = async (): Promise<OsPermission> => "unsupported";
export const askOsPermission = async (): Promise<OsPermission> => "unsupported";
export function showOutside(_notification: OutsideNotification, _onOpen: () => void): void {}
export const appInFront = (): boolean => true;
export const openOsNotificationSettings = (): void => {};
export function setOsBadge(_count: number): void {}
export function onOutsideOpened(_listener: (id: string) => void): () => void { return () => {}; }
