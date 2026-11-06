import type { Environment, OsPlatform } from "./os.ts";
/**
 * The one menu model of the desktop app. macOS shows it as the system menu bar; Windows and Linux show the same
 * model through the application menu button in the top bar. Every item is a registry action or an OS role.
 */
export type MenuRole =
  | "services" | "hide" | "hideOthers" | "unhide" | "minimize" | "zoom" | "front" | "windowMenu"
  | "undo" | "redo" | "cut" | "copy" | "paste" | "selectAll";
export type MenuNode =
  | { type: "separator" }
  | {
    type?: "item"; id: string; label: string;
    /** The registry action the item invokes, with trigger `menu`. */
    action?: string; payload?: Record<string, string>;
    role?: MenuRole;
    submenu?: MenuNode[];
    enabled?: boolean; checked?: boolean;
    /** The active binding, as display text only. */
    hint?: string;
    /** Where the item is placed: only in the macOS menu bar, or only in the Windows and Linux menu. */
    only?: "mac" | "other";
    /** A line that states something and does nothing. */
    statusLine?: boolean;
  };
export type MenuItemNode = Exclude<MenuNode, { type: "separator" }>;
export type TopMenu = { id: string; label: string; items: MenuNode[]; only?: "mac" | "other" };

export const MENU_ROLES: readonly MenuRole[] = ["services", "hide", "hideOthers", "unhide", "minimize", "zoom", "front", "windowMenu", "undo", "redo", "cut", "copy", "paste", "selectAll"];

/** The destinations of the Go menu, in sidebar order: the primary rows, then the "More" group. */
export const GO_PRIMARY = ["home", "projects", "sessions", "workflows", "film", "automations", "library", "devices"] as const;
export const GO_MORE = ["scripts", "agents", "workspaces", "skills", "usage"] as const;
const GO_LABELS: Record<string, string> = {
  home: "New", projects: "Projects", sessions: "Sessions", workflows: "Workflows", film: "Film Studio", automations: "Automations", library: "Library",
  devices: "Devices", scripts: "Scripts", agents: "Agents", workspaces: "Workspaces", skills: "Skills", usage: "Usage",
};

/** Actions the menu invokes. The menu-model test fails when an item names an id that is not here and is not a role. */
export const MENU_ACTIONS: readonly string[] = [
  "app.about", "app.check-updates", "app.settings", "app.quit", "app.fullscreen", "app.theme.system", "app.theme.light", "app.theme.dark",
  "app.ui-scale.reset", "app.ui-scale.in", "app.ui-scale.out", "app.settings.network-access", "app.settings.host",
  "project.new", "project.open", "project.open-recent", "project.clear-recent", "project.import-package", "project.save-version", "project.export-package", "project.close",
  "window.new", "window.close", "session.new", "script.new", "media.import", "export.open", "nav.go.exports", "nav.back", "nav.forward",
  ...[...GO_PRIMARY, ...GO_MORE].map((id) => `nav.go.${id}`),
  "edit.undo", "edit.redo", "timeline.cut", "timeline.copy", "timeline.paste", "timeline.duplicate", "timeline.delete", "selection.all", "selection.none", "palette.open",
  "timeline.split", "timeline.split-all", "timeline.delete-left", "timeline.delete-right", "timeline.group", "timeline.ungroup", "timeline.compound.create",
  "timeline.compound.dissolve", "timeline.multicam.create", "timeline.multicam.flatten", "timeline.replace-media", "audio.extract.toggle", "timeline.freeze",
  "timeline.reverse", "timeline.speed", "timeline.activate.toggle",
  "playback.toggle", "playback.shuttle-reverse", "playback.shuttle-stop", "playback.shuttle-forward", "playback.frame-previous", "playback.frame-next",
  "playback.go-start", "playback.go-end", "range.set-in", "range.set-out", "range.clear", "playback.loop.toggle",
  "view.sidebar.toggle", "view.inspector.toggle", "view.agent-panel.toggle", "editor.layout.apply", "timeline.zoom-in", "timeline.zoom-out", "timeline.zoom-fit",
  "player.zoom-in", "player.zoom-out", "player.zoom-fit", "player.fullscreen", "view.focus-mode.toggle",
  "supervisor.start", "supervisor.stop", "supervisor.restart", "supervisor.open-logs", "devices.pair",
  "help.shortcuts", "help.starter-tips", "help.whats-new", "help.feedback", "help.diagnostics", "help.devtools",
];
/** Editor actions: disabled whenever no editor is in the foreground. */
export const isEditorAction = (action: string): boolean => /^(timeline|playback|range|audio|player|selection|editor\.layout|view\.(inspector|agent-panel|focus-mode)|export\.open|project\.(save-version|close|export-package)|media\.import)(\.|$)/.test(action);
/** What the operating system must run when no web contents has focus (macOS): real accelerators exist for these only. */
export const NATIVE_ACCELERATOR_ACTIONS: readonly string[] = ["app.quit", "window.close", "window.new", "app.settings", "app.fullscreen", "project.new", "project.open"];
export const NATIVE_ACCELERATOR_ROLES: readonly MenuRole[] = ["hide", "hideOthers", "minimize"];

export type MenuState = {
  recent?: readonly { id: string; name: string }[];
  layouts?: readonly { id: string; label: string }[];
  theme?: "system" | "light" | "dark";
  host?: { label: string; running: boolean; available: boolean };
  /** `isEnabled` of the renderer's actions; an action that is absent is enabled. */
  enabled?: Readonly<Record<string, boolean>>;
  checked?: Readonly<Record<string, boolean>>;
  /** Display text of the active binding of an action. */
  hints?: Readonly<Record<string, string>>;
  editorForeground?: boolean;
  /** The enterprise policy flag: no developer tools at all. */
  devToolsDisabled?: boolean;
  translate?(text: string): string;
};

const sep: MenuNode = { type: "separator" };

/** Builds the model from the current state of the app. `&` in a top-level label marks its mnemonic. */
export function buildMenuModel(state: MenuState = {}): TopMenu[] {
  const t = state.translate ?? ((text: string) => text);
  const enabledOf = (action: string): boolean => {
    if (isEditorAction(action) && state.editorForeground === false) return false;
    return state.enabled?.[action] ?? true;
  };
  const item = (label: string, action: string, extra: Partial<MenuItemNode> = {}): MenuNode => ({
    id: extra.payload ? `${action}:${Object.values(extra.payload).join(":")}` : action, label: t(label), action, enabled: enabledOf(action),
    ...(state.checked?.[action] !== undefined ? { checked: state.checked[action] } : {}), ...(state.hints?.[action] ? { hint: state.hints[action] } : {}), ...extra,
  });
  const role = (label: string, name: MenuRole, extra: Partial<MenuItemNode> = {}): MenuNode => ({ id: `role.${name}`, label: t(label), role: name, ...extra });
  // Text-editing roles act on the focused field; without one the action of the foreground screen runs.
  const edit = (label: string, name: MenuRole, action: string): MenuNode => ({ ...(item(label, action) as MenuItemNode), role: name });
  const recent = (state.recent ?? []).slice(0, 10);
  const host = state.host ?? { label: "Host stopped", running: false, available: true };

  return [
    { id: "app", label: "JAgentChill", only: "mac", items: [
      item("About JAgentChill", "app.about"), item("Check for updates…", "app.check-updates"), sep, item("Settings…", "app.settings"), sep,
      role("Services", "services"), sep, role("Hide JAgentChill", "hide"), role("Hide others", "hideOthers"), sep, item("Quit JAgentChill", "app.quit"),
    ] },
    { id: "file", label: t("&File"), items: [
      item("New project", "project.new"), item("New window", "window.new"), item("New session", "session.new"), item("New script", "script.new"), sep,
      item("Open project…", "project.open"),
      { id: "file.open-recent", label: t("Open recent"), enabled: true, submenu: [
        ...recent.map((project) => item(project.name, "project.open-recent", { payload: { projectId: project.id } })),
        ...(recent.length ? [sep] : []), item("Clear", "project.clear-recent", { enabled: recent.length > 0 }),
      ] },
      sep, item("Import media…", "media.import"), item("Import project…", "project.import-package"), sep,
      item("Save version", "project.save-version"), item("Export…", "export.open"), item("Exports", "nav.go.exports"), item("Export project package…", "project.export-package"), sep,
      item("Close project", "project.close"), item("Close window", "window.close"),
      { ...sep, only: "other" } as MenuNode, item("Settings…", "app.settings", { only: "other" }), item("Quit", "app.quit", { only: "other" }),
    ] },
    { id: "edit", label: t("&Edit"), items: [
      edit("Undo", "undo", "edit.undo"), edit("Redo", "redo", "edit.redo"), sep, edit("Cut", "cut", "timeline.cut"), edit("Copy", "copy", "timeline.copy"),
      edit("Paste", "paste", "timeline.paste"), item("Duplicate", "timeline.duplicate"), item("Delete", "timeline.delete"), sep,
      edit("Select all", "selectAll", "selection.all"), item("Deselect all", "selection.none"), sep, item("Find…", "palette.open"),
    ] },
    { id: "clip", label: t("&Clip"), items: [
      item("Split", "timeline.split"), item("Split all tracks", "timeline.split-all"), item("Delete left", "timeline.delete-left"), item("Delete right", "timeline.delete-right"), sep,
      item("Group", "timeline.group"), item("Ungroup", "timeline.ungroup"), item("Create compound clip", "timeline.compound.create"), item("Dissolve compound clip", "timeline.compound.dissolve"),
      item("Create multi-camera clip", "timeline.multicam.create"), item("Flatten multi-camera clip", "timeline.multicam.flatten"), sep,
      item("Replace media…", "timeline.replace-media"), item("Extract audio", "audio.extract.toggle"), item("Freeze frame", "timeline.freeze"), item("Reverse", "timeline.reverse"),
      item("Speed…", "timeline.speed"), item("Activate/deactivate", "timeline.activate.toggle"),
    ] },
    { id: "playback", label: t("&Playback"), items: [
      item("Play/pause", "playback.toggle"), item("Shuttle reverse", "playback.shuttle-reverse"), item("Shuttle stop", "playback.shuttle-stop"), item("Shuttle forward", "playback.shuttle-forward"), sep,
      item("Previous frame", "playback.frame-previous"), item("Next frame", "playback.frame-next"), item("Go to start", "playback.go-start"), item("Go to end", "playback.go-end"), sep,
      item("Set in point", "range.set-in"), item("Set out point", "range.set-out"), item("Clear range", "range.clear"), item("Loop", "playback.loop.toggle"),
    ] },
    { id: "view", label: t("&View"), items: [
      item("Toggle sidebar", "view.sidebar.toggle"), item("Toggle inspector", "view.inspector.toggle"), item("Toggle agent panel", "view.agent-panel.toggle"),
      { id: "view.layout", label: t("Layout"), enabled: enabledOf("editor.layout.apply"), submenu: (state.layouts ?? [{ id: "default", label: "Default" }]).map((layout) => item(layout.label, "editor.layout.apply", { payload: { presetId: layout.id } })) },
      sep, item("Zoom timeline in", "timeline.zoom-in"), item("Zoom timeline out", "timeline.zoom-out"), item("Zoom timeline to fit", "timeline.zoom-fit"),
      item("Zoom player in", "player.zoom-in"), item("Zoom player out", "player.zoom-out"), item("Zoom player to fit", "player.zoom-fit"), item("Player fullscreen", "player.fullscreen"),
      item("Focus mode", "view.focus-mode.toggle"), sep,
      { id: "view.theme", label: t("Theme"), enabled: true, submenu: (["system", "light", "dark"] as const).map((theme) => item(theme === "system" ? "System" : theme === "light" ? "Light" : "Dark", `app.theme.${theme}`, { checked: (state.theme ?? "system") === theme })) },
      item("Enter full screen", "app.fullscreen"), sep, item("Actual size", "app.ui-scale.reset"), item("Zoom in", "app.ui-scale.in"), item("Zoom out", "app.ui-scale.out"),
    ] },
    { id: "go", label: t("&Go"), items: [
      ...GO_PRIMARY.map((id) => item(GO_LABELS[id], `nav.go.${id}`)), sep, ...GO_MORE.map((id) => item(GO_LABELS[id], `nav.go.${id}`)), sep,
      item("Back", "nav.back"), item("Forward", "nav.forward"),
    ] },
    { id: "host", label: t("&Host"), items: [
      { id: "host.status", label: t(host.label), enabled: false, statusLine: true }, sep,
      host.running ? item("Stop built-in host", "supervisor.stop", { enabled: host.available }) : item("Start built-in host", "supervisor.start", { enabled: host.available }),
      item("Restart", "supervisor.restart", { enabled: host.available && host.running }), sep,
      item("Network access…", "app.settings.network-access"), item("Pair a device…", "devices.pair"), item("Devices", "nav.go.devices"), item("Host settings…", "app.settings.host"), sep,
      item("Open logs folder", "supervisor.open-logs"),
    ] },
    { id: "window", label: t("&Window"), items: [role("Minimise", "minimize"), role("Zoom", "zoom"), sep, role("Windows", "windowMenu"), { ...(role("Bring all to front", "front") as MenuItemNode), only: "mac" }] },
    { id: "help", label: t("He&lp"), items: [
      item("Keyboard shortcuts", "help.shortcuts"), item("Starter tips", "help.starter-tips"), item("What's new", "help.whats-new"), item("Send feedback…", "help.feedback"),
      item("Diagnostics…", "help.diagnostics"), ...(state.devToolsDisabled ? [] : [item("Toggle developer tools", "help.devtools")]),
      { ...sep, only: "other" } as MenuNode, item("Check for updates…", "app.check-updates", { only: "other" }), item("About", "app.about", { only: "other" }),
    ] },
  ];
}

const tidy = (items: MenuNode[]): MenuNode[] => {
  // No separator leads, trails or follows another one after a placement filter.
  const out: MenuNode[] = [];
  for (const node of items) {
    if (node.type === "separator" && (out.length === 0 || out[out.length - 1].type === "separator")) continue;
    out.push(node);
  }
  while (out.length && out[out.length - 1].type === "separator") out.pop();
  return out;
};
/** The model as one platform presents it: the placement differences applied and nothing else changed. */
export function menuFor(model: readonly TopMenu[], platform: OsPlatform): TopMenu[] {
  const target = platform === "darwin" ? "mac" : "other";
  const keep = (node: { only?: "mac" | "other" }) => node.only === undefined || node.only === target;
  const filter = (items: MenuNode[]): MenuNode[] => tidy(items.filter((node) => keep(node as { only?: "mac" | "other" })).map((node) => (node.type !== "separator" && node.submenu ? { ...node, submenu: filter(node.submenu) } : node)));
  return model.filter(keep).map((menu) => ({ ...menu, items: filter(menu.items) }));
}

/** Items that have neither a registered action nor a declared role. A submenu parent and a status line need neither. */
export function invalidMenuItems(model: readonly TopMenu[], actions: readonly string[] = MENU_ACTIONS, roles: readonly string[] = MENU_ROLES): string[] {
  const bad: string[] = [];
  const visit = (items: MenuNode[], path: string) => {
    for (const node of items) {
      if (node.type === "separator") continue;
      const here = `${path} ▸ ${node.label}`;
      if (node.submenu) { visit(node.submenu, here); continue; }
      if (node.statusLine) continue;
      const hasAction = node.action !== undefined && actions.includes(node.action), hasRole = node.role !== undefined && roles.includes(node.role);
      if (!hasAction && !hasRole) bad.push(here);
      if (node.action !== undefined && !actions.includes(node.action)) { if (!bad.includes(here)) bad.push(here); }
    }
  };
  for (const menu of model) visit(menu.items, menu.label.replace("&", ""));
  return bad;
}

const flat = (model: readonly TopMenu[]): Map<string, string> => {
  const out = new Map<string, string>();
  const visit = (items: MenuNode[], path: string) => items.forEach((node, index) => {
    if (node.type === "separator") return;
    const key = `${path}/${node.id}`;
    out.set(key, JSON.stringify({ label: node.label, action: node.action, payload: node.payload, role: node.role, enabled: node.enabled, checked: node.checked, hint: node.hint, order: index >= 0 }));
    if (node.submenu) visit(node.submenu, key);
  });
  for (const menu of model) visit(menu.items, menu.id);
  return out;
};
/**
 * What differs between the macOS rendering and the application-menu rendering of one model, beyond placement: an
 * item that exists in one only without being a declared placement difference, or a shared item whose label, action,
 * state or hint differs. Empty when the two agree.
 */
export function menuDifferences(model: readonly TopMenu[]): string[] {
  const mac = flat(menuFor(model, "darwin")), other = flat(menuFor(model, "linux"));
  const placed = new Set<string>();
  const mark = (items: MenuNode[], path: string, inherited: boolean) => items.forEach((node) => {
    if (node.type === "separator") return;
    const key = `${path}/${node.id}`, only = inherited || node.only !== undefined;
    if (only) placed.add(key);
    if (node.submenu) mark(node.submenu, key, only);
  });
  for (const menu of model) mark(menu.items, menu.id, menu.only !== undefined);
  const differences: string[] = [];
  for (const [key, value] of mac) {
    if (!other.has(key)) { if (!placed.has(key)) differences.push(`only on macOS: ${key}`); continue; }
    if (other.get(key) !== value) differences.push(`differs: ${key}`);
  }
  for (const key of other.keys()) if (!mac.has(key) && !placed.has(key)) differences.push(`only on Windows and Linux: ${key}`);
  // Order: the shared items come in the same sequence on both.
  const shared = (map: Map<string, string>, peer: Map<string, string>) => [...map.keys()].filter((key) => peer.has(key));
  if (shared(mac, other).join("|") !== shared(other, mac).join("|")) differences.push("order differs");
  return differences;
}

/** `Mod+Shift+B` → the accelerator text Electron shows (`CmdOrCtrl+Shift+B`). */
export function acceleratorOf(combo: string): string {
  const keys: Record<string, string> = { Mod: "CmdOrCtrl", Left: "Left", Right: "Right", Up: "Up", Down: "Down", "=": "Plus", "`": "`", Escape: "Esc" };
  return combo.split("+").map((part) => keys[part] ?? part).join("+");
}
export const DEVTOOLS_ACTION = "help.devtools";

/** Every label of the model as written in English: the renderer translates them and hands the table back with its state. */
export function menuLabels(model: readonly TopMenu[] = buildMenuModel({ recent: [], layouts: [] })): string[] {
  const out = new Set<string>(["Host: Stopped", "Host: Starting…", "Host: Running", "Host: Running with problems", "Host: Restarting…", "Host: Repairing configuration…", "Host: Failed", "Host: Stopping…", "Start built-in host", "Stop built-in host", "Default"]);
  const visit = (items: MenuNode[]) => { for (const node of items) if (node.type !== "separator") { out.add(node.label); if (node.submenu) visit(node.submenu); } };
  for (const menu of model) { out.add(menu.label); visit(menu.items); }
  return [...out];
}
