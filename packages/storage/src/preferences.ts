/**
 * App-level UI preferences. They live in the preferences port — localStorage of the app origin on web and desktop,
 * the platform key-value store on mobile — never in a project record and never in a project package.
 */
export interface PreferencesPort {
  /** Synchronous, so that a preference is known before first paint. */
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** One preference: a versioned JSON entry with its defaults and its migrations from earlier versions. */
export type PreferenceDefinition<T> = {
  key: string;
  version: number;
  defaults: T;
  /** Brings a stored value of an earlier version to this one; a value it cannot bring forward becomes the defaults. */
  migrate?: Record<number, (stored: unknown) => unknown>;
  /** Narrows a parsed value to `T`; `undefined` when the value is not usable. */
  parse(value: unknown): T | undefined;
};

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const oneOf = <T extends string>(values: readonly T[]) => (value: unknown): T | undefined => (values.includes(value as T) ? (value as T) : undefined);
const flag = (value: unknown): boolean | undefined => (typeof value === "boolean" ? value : undefined);
const toggle = (key: string, defaults: boolean): PreferenceDefinition<boolean> => ({ key, version: 1, defaults, parse: flag });
const numberIn = (min: number, max: number) => (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : undefined);

export type SortOrder = "asc" | "desc";
export type PanelSizes = Record<string, number>;
export type PreviewSettings = { activeGuide: string | null; overlays: Record<string, boolean>; grid: { rows: number; columns: number } };
export type StickerSettings = { category: string; recents: string[] };
export type EasingPreset = { id: string; name: string; curve: [number, number, number, number] };
export type Dismissals = { persistDialog_ms: number | null; persistBanner_ms: number | null; persistRequested: boolean; onboarding: boolean };
export const SNAPSHOT_INTERVALS = [1, 5, 10, 30, "off"] as const;
export type SnapshotInterval = (typeof SNAPSHOT_INTERVALS)[number];

/** Every preference this capability stores. Each timeline toggle is ONE stored value shown on two surfaces. */
export const PREFERENCES = {
  projectsViewMode: { key: "projects.viewMode", version: 1, defaults: "grid", parse: oneOf(["grid", "list"] as const) } as PreferenceDefinition<"grid" | "list">,
  projectsSort: {
    key: "projects.sort", version: 1, defaults: { key: "updated", order: "desc" },
    parse: (value) => (isRecord(value) && typeof value.key === "string" && (value.order === "asc" || value.order === "desc") ? { key: value.key, order: value.order } : undefined),
  } as PreferenceDefinition<{ key: string; order: SortOrder }>,
  mediaViewMode: { key: "media.viewMode", version: 1, defaults: "grid", parse: oneOf(["grid", "list"] as const) } as PreferenceDefinition<"grid" | "list">,
  mediaSort: {
    key: "media.sort", version: 1, defaults: { key: "name", order: "asc" },
    parse: (value) => (isRecord(value) && typeof value.key === "string" && (value.order === "asc" || value.order === "desc") ? { key: value.key, order: value.order } : undefined),
  } as PreferenceDefinition<{ key: string; order: SortOrder }>,
  panelSizes: {
    key: "panels.sizes", version: 1, defaults: {},
    parse: (value) => (isRecord(value) && Object.values(value).every((size) => typeof size === "number" && Number.isFinite(size) && size >= 0) ? (value as PanelSizes) : undefined),
  } as PreferenceDefinition<PanelSizes>,
  timelineSnapping: toggle("timeline.snapping", true),
  timelineRipple: toggle("timeline.ripple", false),
  timelineMagnet: toggle("timeline.magnet", true),
  timelineLinkage: toggle("timeline.linkage", true),
  timelinePreviewAxis: toggle("timeline.previewAxis", true),
  timelineFreeLayer: toggle("timeline.freeLayer", false),
  timelineAutoFollow: { key: "timeline.autoFollow", version: 1, defaults: "page", parse: oneOf(["page", "smooth", "off"] as const) } as PreferenceDefinition<"page" | "smooth" | "off">,
  previewSettings: {
    key: "preview.settings", version: 1, defaults: { activeGuide: null, overlays: {}, grid: { rows: 3, columns: 3 } },
    parse: (value) => {
      if (!isRecord(value) || !isRecord(value.overlays) || !isRecord(value.grid)) return undefined;
      const rows = numberIn(1, 64)(value.grid.rows), columns = numberIn(1, 64)(value.grid.columns);
      if (rows === undefined || columns === undefined || !(value.activeGuide === null || typeof value.activeGuide === "string")) return undefined;
      return { activeGuide: value.activeGuide, overlays: Object.fromEntries(Object.entries(value.overlays).filter(([, on]) => typeof on === "boolean")) as Record<string, boolean>, grid: { rows, columns } };
    },
  } as PreferenceDefinition<PreviewSettings>,
  stickerSettings: {
    key: "stickers.settings", version: 1, defaults: { category: "all", recents: [] },
    parse: (value) => (isRecord(value) && typeof value.category === "string" && Array.isArray(value.recents) && value.recents.every((id) => typeof id === "string") ? { category: value.category, recents: value.recents as string[] } : undefined),
  } as PreferenceDefinition<StickerSettings>,
  easingPresets: {
    key: "easing.presets", version: 1, defaults: [],
    parse: (value) => (Array.isArray(value) && value.every((preset) => isRecord(preset) && typeof preset.id === "string" && typeof preset.name === "string" && Array.isArray(preset.curve) && preset.curve.length === 4 && preset.curve.every((part) => typeof part === "number")) ? (value as EasingPreset[]) : undefined),
  } as PreferenceDefinition<EasingPreset[]>,
  dismissals: {
    key: "dismissals", version: 1, defaults: { persistDialog_ms: null, persistBanner_ms: null, persistRequested: false, onboarding: false },
    parse: (value) => {
      if (!isRecord(value)) return undefined;
      const time = (entry: unknown) => (typeof entry === "number" && Number.isFinite(entry) ? entry : null);
      return { persistDialog_ms: time(value.persistDialog_ms), persistBanner_ms: time(value.persistBanner_ms), persistRequested: value.persistRequested === true, onboarding: value.onboarding === true };
    },
  } as PreferenceDefinition<Dismissals>,
  theme: { key: "theme", version: 1, defaults: "system", parse: oneOf(["system", "light", "dark"] as const) } as PreferenceDefinition<"system" | "light" | "dark">,
  snapshotInterval: { key: "editing.snapshotInterval", version: 1, defaults: 10, parse: (value) => (SNAPSHOT_INTERVALS.includes(value as SnapshotInterval) ? (value as SnapshotInterval) : undefined) } as PreferenceDefinition<SnapshotInterval>,
  snapshotsToKeep: { key: "editing.automaticSnapshotsToKeep", version: 1, defaults: 20, parse: (value) => (Number.isInteger(value) ? numberIn(10, 200)(value) : undefined) } as PreferenceDefinition<number>,
} as const;

const PREFIX = "jagentchill.pref.";
type Listener<T> = (value: T) => void;

/**
 * The preference store over a preferences port. Reads are synchronous. A corrupt or unparsable entry is replaced by
 * its defaults — and overwritten — without blocking start-up. A change notifies every surface that shows the value.
 */
export function createPreferences(port: PreferencesPort) {
  const listeners = new Map<string, Set<Listener<unknown>>>();
  const write = <T>(definition: PreferenceDefinition<T>, value: T) => { try { port.setItem(PREFIX + definition.key, JSON.stringify({ v: definition.version, value })); } catch { /* a full or disabled store keeps the value for this session only */ } };
  const cache = new Map<string, unknown>();

  function read<T>(definition: PreferenceDefinition<T>): T {
    let raw: string | null;
    try { raw = port.getItem(PREFIX + definition.key); } catch { raw = null; }
    if (raw === null) return definition.defaults;
    let entry: unknown;
    try { entry = JSON.parse(raw); } catch { write(definition, definition.defaults); return definition.defaults; }
    if (!isRecord(entry) || typeof entry.v !== "number" || entry.v > definition.version) { write(definition, definition.defaults); return definition.defaults; }
    let value = entry.value, version = entry.v;
    // Per-key migrations, one version at a time.
    while (version < definition.version) {
      const step = definition.migrate?.[version];
      if (!step) { value = undefined; break; }
      try { value = step(value); } catch { value = undefined; break; }
      version++;
    }
    const parsed = value === undefined ? undefined : definition.parse(value);
    if (parsed === undefined) { write(definition, definition.defaults); return definition.defaults; }
    if (entry.v !== definition.version) write(definition, parsed);
    return parsed;
  }

  return {
    get<T>(definition: PreferenceDefinition<T>): T {
      if (!cache.has(definition.key)) cache.set(definition.key, read(definition));
      return cache.get(definition.key) as T;
    },
    set<T>(definition: PreferenceDefinition<T>, value: T): void {
      const parsed = definition.parse(value);
      if (parsed === undefined) throw new RangeError(`"${String(value)}" is not a value of the preference "${definition.key}"`);
      cache.set(definition.key, parsed);
      write(definition, parsed);
      for (const listener of listeners.get(definition.key) ?? []) listener(parsed);
    },
    reset<T>(definition: PreferenceDefinition<T>): void {
      cache.set(definition.key, definition.defaults);
      try { port.removeItem(PREFIX + definition.key); } catch { /* nothing to remove */ }
      for (const listener of listeners.get(definition.key) ?? []) listener(definition.defaults);
    },
    /** The toolbar toggle and the preferences row subscribe to the same key: one stored value, two surfaces. */
    subscribe<T>(definition: PreferenceDefinition<T>, listener: Listener<T>): () => void {
      const set = listeners.get(definition.key) ?? new Set();
      listeners.set(definition.key, set);
      set.add(listener as Listener<unknown>);
      return () => { set.delete(listener as Listener<unknown>); };
    },
    /** Another window changed an entry (the browser's `storage` event): drop the cached value and tell the surfaces. */
    externalChange(storageKey: string | null): void {
      const definition = Object.values(PREFERENCES).find((entry) => PREFIX + entry.key === storageKey) as PreferenceDefinition<unknown> | undefined;
      if (!definition) return;
      cache.delete(definition.key);
      const value = this.get(definition);
      for (const listener of listeners.get(definition.key) ?? []) listener(value);
    },
  };
}
export type Preferences = ReturnType<typeof createPreferences>;

/** A preferences port in memory, for a platform whose key-value store is asynchronous: loaded once, then read synchronously. */
export async function preloadedPreferences(store: { getAllKeys(): Promise<readonly string[]>; getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void>; removeItem(key: string): Promise<void> }): Promise<PreferencesPort> {
  const memory = new Map<string, string>();
  for (const key of await store.getAllKeys()) if (key.startsWith(PREFIX)) { const value = await store.getItem(key); if (value !== null) memory.set(key, value); }
  return {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => { memory.set(key, value); void store.setItem(key, value).catch(() => undefined); },
    removeItem: (key) => { memory.delete(key); void store.removeItem(key).catch(() => undefined); },
  };
}

/** The classic localStorage keys this capability owns; each is a zustand `persist` entry `{state, version}` or a plain string. */
export const CLASSIC_PREFERENCE_KEYS = ["timeline-store", "preview-settings", "panel-sizes", "assets-panel", "projects-view-mode", "stickers-settings", "theme"] as const;
const classicState = (raw: string): Record<string, unknown> | undefined => { try { const entry = JSON.parse(raw) as unknown; return isRecord(entry) && isRecord(entry.state) ? entry.state : undefined; } catch { return undefined; } };
/**
 * Per-key migrations of the OpenCut classic localStorage entries into the preference store. A key whose stored
 * value is unusable is skipped; nothing is read from or written to the classic origin.
 */
export function importClassicPreferences(preferences: Preferences, entries: Record<string, string>): string[] {
  const imported: string[] = [];
  const put = <T>(key: string, definition: PreferenceDefinition<T>, value: unknown) => { const parsed = definition.parse(value); if (parsed !== undefined) { preferences.set(definition, parsed); if (!imported.includes(key)) imported.push(key); } };
  for (const key of CLASSIC_PREFERENCE_KEYS) {
    const raw = entries[key];
    if (typeof raw !== "string") continue;
    if (key === "theme") { put(key, PREFERENCES.theme, raw.replace(/^"|"$/g, "")); continue; }
    const state = classicState(raw);
    if (!state) continue;
    if (key === "timeline-store") { put(key, PREFERENCES.timelineSnapping, state.snappingEnabled); put(key, PREFERENCES.timelineRipple, state.rippleEditingEnabled); }
    if (key === "projects-view-mode") { put(key, PREFERENCES.projectsViewMode, state.viewMode); put(key, PREFERENCES.projectsSort, { key: state.sortKey, order: state.sortOrder }); }
    if (key === "assets-panel") { put(key, PREFERENCES.mediaViewMode, state.mediaViewMode); put(key, PREFERENCES.mediaSort, { key: state.mediaSortBy, order: state.mediaSortOrder }); }
    if (key === "panel-sizes") put(key, PREFERENCES.panelSizes, state.panels);
    if (key === "stickers-settings") put(key, PREFERENCES.stickerSettings, { category: state.selectedCategory, recents: Array.isArray(state.recentStickers) ? state.recentStickers.filter((id) => typeof id === "string") : [] });
    if (key === "preview-settings") {
      const grid = isRecord(state.gridConfig) ? state.gridConfig : {};
      put(key, PREFERENCES.previewSettings, { activeGuide: typeof state.activeGuide === "string" ? state.activeGuide : null, overlays: isRecord(state.overlays) ? state.overlays : {}, grid: { rows: grid.rows ?? 3, columns: grid.columns ?? grid.cols ?? 3 } });
    }
  }
  return imported;
}
