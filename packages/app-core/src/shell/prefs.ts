/** A synchronous key-value store: localStorage on web and desktop, the platform key-value store on mobile. */
export type KeyValueStore = { get(key: string): string | null; set(key: string, value: string): void; remove?(key: string): void };

/** One versioned preference: its key is namespaced `jagentchill.*`, its stored form is `{ v, value }`. */
export type Preference<T> = { key: string; version: number; fallback: T; validate(value: unknown): value is T; migrate?(value: unknown, version: number): unknown };
export const preference = <T>(name: string, fallback: T, validate: (value: unknown) => value is T, version = 1, migrate?: Preference<T>["migrate"]): Preference<T> =>
  ({ key: `jagentchill.${name}`, version, fallback, validate, migrate });

/**
 * Reads a preference. An entry that is not valid JSON, has no version, or fails validation is discarded — removed from
 * the store — and the default applies, so a bad entry never blocks startup.
 */
export function readPreference<T>(store: KeyValueStore, pref: Preference<T>): T {
  const raw = store.get(pref.key);
  if (raw === null) return pref.fallback;
  try {
    const entry = JSON.parse(raw) as { v?: unknown; value?: unknown };
    if (entry === null || typeof entry !== "object" || typeof entry.v !== "number") throw new Error("not a versioned entry");
    const value = entry.v === pref.version ? entry.value : pref.migrate ? pref.migrate(entry.value, entry.v) : undefined;
    if (pref.validate(value)) return value;
  } catch { /* falls through to the default */ }
  if (store.remove) store.remove(pref.key); else store.set(pref.key, JSON.stringify({ v: pref.version, value: pref.fallback }));
  return pref.fallback;
}
export function writePreference<T>(store: KeyValueStore, pref: Preference<T>, value: T): void {
  store.set(pref.key, JSON.stringify({ v: pref.version, value }));
}

const oneOf = <T extends string>(...values: T[]) => (value: unknown): value is T => typeof value === "string" && (values as string[]).includes(value);
const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";
const isString = (value: unknown): value is string => typeof value === "string";
const isStringOrNull = (value: unknown): value is string | null => value === null || typeof value === "string";
const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every(isString);
const isNumberMap = (value: unknown): value is Record<string, number> => value !== null && typeof value === "object" && !Array.isArray(value) && Object.values(value).every((entry) => typeof entry === "number" && Number.isFinite(entry));
const inRange = (min: number, max: number) => (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
type Panels = { top: number; assets: number; inspector: number };
const isPanels = (value: unknown): value is Panels => value !== null && typeof value === "object"
  && inRange(30, 85)((value as Panels).top) && inRange(15, 40)((value as Panels).assets) && inRange(15, 40)((value as Panels).inspector);

/** Every piece of shell and Projects state kept per device. */
export const PREFS = {
  projectsView: preference<"grid" | "list">("projects.view", "grid", oneOf("grid", "list")),
  projectsSortKey: preference<"created" | "modified" | "name" | "duration" | "size">("projects.sort.key", "modified", oneOf("created", "modified", "name", "duration", "size")),
  projectsSortOrder: preference<"asc" | "desc">("projects.sort.order", "desc", oneOf("asc", "desc")),
  projectsPinned: preference<string[]>("projects.pinned", [], isStrings),
  // Settings ▸ Notifications, per device. "default": on in the desktop app, off in a browser until the person turns it on (the browser asks for its permission then, never on load).
  notifyOutside: preference<"default" | "on" | "off">("notifications.outside", "default", oneOf("default", "on", "off")),
  notifyOnlyUnfocused: preference<boolean>("notifications.onlyUnfocused", true, isBoolean),
  /** The kinds whose switch is off. */
  notifyOff: preference<string[]>("notifications.off", ["other"], isStrings),
  sidebarWidth: preference<number>("shell.sidebar.width", 240, inRange(200, 360)),
  sidebarCollapsed: preference<boolean>("shell.sidebar.collapsed", false, isBoolean),
  moreOpen: preference<boolean>("shell.nav.more", false, isBoolean),
  /** Folders of the sidebar list the user closed; a folder is open until then. */
  collapsedFolders: preference<string[]>("shell.sidebar.folders.collapsed", [], isStrings),
  lastSection: preference<string | null>("shell.section", null, isStringOrNull),
  lastHost: preference<string | null>("shell.host", null, isStringOrNull),
  lastRoute: preference<string | null>("shell.route", null, isStringOrNull),
  welcomeSeen: preference<boolean>("shell.welcome.seen", false, isBoolean),
  language: preference<string | null>("shell.language", null, isStringOrNull),
  checklistDismissed: preference<boolean>("shell.checklist.dismissed", false, isBoolean),
  checklistCompleted: preference<boolean>("shell.checklist.completed", false, isBoolean),
  modelSetupDismissed: preference<boolean>("shell.modelSetup.dismissed", false, isBoolean),
  modelSetupStarted: preference<boolean>("shell.modelSetup.started", false, isBoolean),
  promoDismissed: preference<Record<string, number>>("shell.promo.dismissed", {}, isNumberMap),
  libraryCategory: preference<string>("library.category", "templates", isString),
  composerDraft: preference<string>("home.composer.draft", "", isString),
  composerTarget: preference<"session" | "video" | "film">("home.composer.target", "session", oneOf("session", "video", "film")),
  composerMode: preference<"ask" | "plan" | "edit" | "auto">("home.composer.mode", "edit", oneOf("ask", "plan", "edit", "auto")),
  composerProject: preference<string | null>("home.composer.project", null, isStringOrNull),
  editorPanels: preference<Panels>("editor.panels", { top: 50, assets: 25, inspector: 25 }, isPanels),
} as const;
