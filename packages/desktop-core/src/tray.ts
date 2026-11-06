import type { OsPlatform } from "./os.ts";

export type TrayState = "idle" | "busy" | "attention";
export type TrayTask = { id: string; title: string; percent?: number; route?: string };
export type TrayItem = { type: "separator" } | { type?: "item"; id: string; label: string; action?: string; payload?: Record<string, string>; enabled?: boolean };

/** The icon: attention (a task needs the user, or the host failed) wins over busy (jobs running) over idle. */
export const trayState = (input: { tasks: number; attention: number; hostFailed: boolean }): TrayState =>
  (input.attention > 0 || input.hostFailed ? "attention" : input.tasks > 0 ? "busy" : "idle");

export const trayStatusLine = (hostLabel: string, tasks: number): string => (tasks > 0 ? `Host ${hostLabel.toLowerCase()} — ${tasks} ${tasks === 1 ? "task" : "tasks"}` : `Host ${hostLabel.toLowerCase()}`);

/**
 * The tray menu: a status line, the ways back into the app, up to five running tasks, pairing, the host switch,
 * settings and quit. Every item is the registry action of the same name in the application menu.
 */
export function buildTrayMenu(input: { hostLabel: string; hostRunning: boolean; hostAvailable: boolean; tasks: readonly TrayTask[]; attention?: readonly TrayTask[]; translate?(text: string): string }): TrayItem[] {
  const t = input.translate ?? ((text: string) => text);
  const sep: TrayItem = { type: "separator" };
  const tasks = input.tasks.slice(0, 5), attention = (input.attention ?? []).slice(0, 5);
  return [
    { id: "tray.status", label: trayStatusLine(input.hostLabel, input.tasks.length), enabled: false }, sep,
    { id: "app.open", label: t("Open JAgentChill"), action: "app.open" }, { id: "project.new", label: t("New project"), action: "project.new" },
    ...(attention.length ? [sep, ...attention.map((task): TrayItem => ({ id: `tray.attention:${task.id}`, label: task.title, action: "nav.open", payload: { route: task.route ?? "/home" } }))] : []),
    ...(tasks.length ? [sep, ...tasks.map((task): TrayItem => ({ id: `tray.task:${task.id}`, label: task.percent === undefined ? task.title : `${task.title} — ${Math.round(task.percent)}%`, action: "nav.open", payload: { route: task.route ?? "/exports" } }))] : []),
    sep, { id: "devices.pair", label: t("Pair a device…"), action: "devices.pair" },
    input.hostRunning ? { id: "supervisor.stop", label: t("Stop built-in host"), action: "supervisor.stop", enabled: input.hostAvailable } : { id: "supervisor.start", label: t("Start built-in host"), action: "supervisor.start", enabled: input.hostAvailable },
    sep, { id: "app.settings", label: t("Settings…"), action: "app.settings" }, { id: "app.quit", label: t("Quit"), action: "app.quit" },
  ];
}

/** "Keep running in the tray": off on macOS (closing the window already keeps the app), on elsewhere when the built-in host is enabled and a tray exists. */
export const keepInTrayDefault = (platform: OsPlatform, input: { hostEnabled: boolean; trayAvailable: boolean }): boolean => platform !== "darwin" && input.hostEnabled && input.trayAvailable;
/** The tray icon is shown whenever the built-in host is enabled or "Keep running in the tray" is on, and a tray exists. */
export const trayShown = (input: { hostEnabled: boolean; keepInTray: boolean; trayAvailable: boolean }): boolean => input.trayAvailable && (input.hostEnabled || input.keepInTray);
/** A `--hidden` launch opens no window where a tray exists and a minimised one where none does. */
export const hiddenLaunch = (trayAvailable: boolean): "no-window" | "minimised" => (trayAvailable ? "no-window" : "minimised");
export const backgroundNotice = (tasks: number): string => `JAgentChill is running in the background — ${tasks} ${tasks === 1 ? "task" : "tasks"}`;
export const EXPORT_QUIT = { message: "An export is in progress", detail: "Quitting now cancels the export and removes the partial file.", choices: ["Quit and cancel the export", "Keep exporting"] } as const;
