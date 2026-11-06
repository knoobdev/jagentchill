import { PREFERENCES, type Preferences } from "./preferences.ts";
import { storageString, type StorageLocale } from "./strings.ts";

/** "Not now" suppresses the dialog for this long. */
export const PERSIST_DIALOG_SNOOZE_MS = 30 * 86_400_000;
/** The banner cannot be hidden for longer than this at a time. */
export const PERSIST_BANNER_SNOOZE_MS = 7 * 86_400_000;

export type PersistenceEnvironment = {
  platform: "web" | "desktop" | "mobile";
  /** `navigator.storage`. */
  storage?: { persist?: () => Promise<boolean>; persisted?: () => Promise<boolean> };
  /** Whether this browser shows a permission prompt before granting persistence (Firefox does; Chromium and Safari decide silently). */
  prompts?: boolean;
  /** Whether the browser currently offers an install prompt. */
  installAvailable?: boolean;
};
/** The default detection of a prompting browser, from the user-agent string. */
export const browserPromptsForPersistence = (userAgent: string): boolean => /\bFirefox\/|\bFxiOS\//.test(userAgent);

export type PersistAction = { id: "allow" | "not-now" | "install" | "sync" | "hide" | "request-again"; label: string };
export type PersistenceView = {
  /** Storage is durable: by grant on web, by nature on desktop (library folder) and mobile (app-private storage). */
  persisted: boolean;
  /** The dialog "Don't lose your projects". */
  dialog: { title: string; body: string; actions: PersistAction[] } | null;
  /** The banner of the Projects screen. */
  banner: { text: string; actions: PersistAction[] } | null;
  /** The row of the personal storage page. */
  storagePage: { text: string; action: PersistAction } | null;
};

/**
 * The persistent-storage request of the Projects screen. Browsers that grant without a prompt are asked silently;
 * browsers that prompt first get the explaining dialog. Desktop and mobile are durable and make no request.
 */
export function createPersistenceRequest(environment: PersistenceEnvironment, preferences: Preferences, now: () => number = Date.now, locale?: StorageLocale) {
  const text = (key: Parameters<typeof storageString>[0]) => storageString(key, {}, locale);
  const supported = environment.platform === "web" && typeof environment.storage?.persist === "function";
  let persisted = environment.platform !== "web", dialogOpen = false;
  const refresh = async () => { if (environment.platform === "web") persisted = (await environment.storage?.persisted?.().catch(() => false)) === true; return persisted; };
  const request = async () => {
    const granted = (await environment.storage!.persist!().catch(() => false)) === true;
    preferences.set(PREFERENCES.dismissals, { ...preferences.get(PREFERENCES.dismissals), persistRequested: true });
    persisted = granted || (await refresh());
    return persisted;
  };
  const view = (): PersistenceView => {
    const dismissals = preferences.get(PREFERENCES.dismissals);
    const hidden = dismissals.persistBanner_ms !== null && now() - dismissals.persistBanner_ms < PERSIST_BANNER_SNOOZE_MS;
    const exposed = environment.platform === "web" && !persisted;
    return {
      persisted,
      dialog: dialogOpen ? { title: text("persistTitle"), body: text("persistBody"), actions: [{ id: "allow", label: text("allow") }, { id: "not-now", label: text("notNow") }] } : null,
      // The banner follows a request that did not make storage persistent.
      banner: exposed && dismissals.persistRequested && !hidden ? { text: text("persistBanner"), actions: [...(environment.installAvailable ? [{ id: "install" as const, label: text("install") }] : []), { id: "sync", label: text("syncWithHost") }, { id: "hide", label: text("hideFor7Days") }] } : null,
      storagePage: exposed ? { text: text("browserCanClear"), action: { id: "request-again", label: text("requestAgain") } } : null,
    };
  };
  return {
    /** The Projects screen opened. */
    async onProjectsScreen(): Promise<PersistenceView> {
      dialogOpen = false;
      if (!supported || (await refresh())) return view();
      if (!environment.prompts) { await request(); return view(); }
      const dismissed = preferences.get(PREFERENCES.dismissals).persistDialog_ms;
      dialogOpen = dismissed === null || now() - dismissed >= PERSIST_DIALOG_SNOOZE_MS;
      return view();
    },
    /** "Allow": calls `persist()`, which makes the browser show its permission prompt. */
    async allow(): Promise<PersistenceView> { dialogOpen = false; if (supported) await request(); return view(); },
    /** "Not now": the dismissal is recorded and the dialog stays away for 30 days. */
    notNow(): PersistenceView { dialogOpen = false; preferences.set(PREFERENCES.dismissals, { ...preferences.get(PREFERENCES.dismissals), persistDialog_ms: now() }); return view(); },
    /** "Hide for 7 days". */
    hideBanner(): PersistenceView { preferences.set(PREFERENCES.dismissals, { ...preferences.get(PREFERENCES.dismissals), persistBanner_ms: now() }); return view(); },
    /** "Request again" on the storage page. */
    async requestAgain(): Promise<PersistenceView> { if (supported) await request(); return view(); },
    view,
  };
}
