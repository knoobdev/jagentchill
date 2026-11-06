import { exportService } from "../editor/export/service";
import { buildInfo } from "./build";
import { isDesktop } from "./desktop";
import { settleUnsaved, unsavedPending } from "./unsavedWork";
import { reloadIntoUpdate } from "./webReload";

/**
 * The browser build's offline copy and its updates (`public/sw.js`). A newer build is fetched in the background and
 * waits: the app only says so, and the new build takes over when the person chooses "Reload" — never by itself and
 * never while an export runs or work is unsaved. The desktop app (its own scheme), the mobile apps and development have no worker.
 */
export type WebUpdateState = { supported: boolean; offlineReady: boolean; waiting: boolean };
export const WEB_UPDATE_CHECK_MS = 60 * 60_000;

let state: WebUpdateState = { supported: false, offlineReady: false, waiting: false };
const listeners = new Set<() => void>();
const set = (next: Partial<WebUpdateState>) => { state = { ...state, ...next }; for (const listener of listeners) listener(); };
let registration: ServiceWorkerRegistration | null = null;
let started = false;

export const webUpdate = {
  getState: (): WebUpdateState => state,
  subscribe(listener: () => void): () => void { listeners.add(listener); return () => void listeners.delete(listener); },
  /** Registers the worker of a finished production build; a build without `build.json` has none. */
  async start(): Promise<void> {
    if (started || typeof navigator === "undefined" || !("serviceWorker" in navigator) || isDesktop() || process.env.NODE_ENV !== "production") return;
    started = true;
    const info = await buildInfo();
    // A build made without the offline copy (`--no-worker`) says so: nothing is registered.
    if (!info || info.offline === false) return;
    try {
      const found = await navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" });
      registration = found;
      const watch = (worker: ServiceWorker | null) => {
        if (!worker) return;
        const look = () => {
          // The first worker of a profile has nothing to replace: it is the offline copy, not an update.
          if (worker.state === "installed" && navigator.serviceWorker.controller) set({ waiting: true });
          if (worker.state === "activated") set({ offlineReady: true });
        };
        worker.addEventListener("statechange", look);
        look();
      };
      set({ supported: true, offlineReady: !!found.active, waiting: !!found.waiting && !!navigator.serviceWorker.controller });
      watch(found.installing);
      found.addEventListener("updatefound", () => watch(found.installing));
      setInterval(() => void found.update().catch(() => undefined), WEB_UPDATE_CHECK_MS);
    } catch { /* A browser that refuses the worker (private mode, a policy) runs the app online as before. */ }
  },
  /** "Check now": asks the browser to look for a newer build. Resolves to whether one is waiting or being fetched. */
  async check(): Promise<"waiting" | "current" | "failed"> {
    if (!registration) return "failed";
    try {
      await registration.update();
      const installing = registration.installing;
      if (installing) await new Promise<void>((done) => { const look = () => { if (installing.state !== "installing") done(); }; installing.addEventListener("statechange", look); look(); });
      const waiting = !!registration.waiting && !!navigator.serviceWorker.controller;
      set({ waiting });
      return waiting ? "waiting" : "current";
    } catch { return "failed"; }
  },
  /**
   * "Reload": the waiting build takes over and the page reloads into it. Refused while an export runs in this tab or
   * while work is not saved — decided before the worker is touched (`webReload.ts`).
   */
  reload(): Promise<"reloading" | "export" | "unsaved"> {
    return reloadIntoUpdate({
      exporting: () => exportService.getState().queue.jobs.some((job) => job.target === "device" && (job.state === "running" || job.state === "paused")),
      settle: settleUnsaved,
      unsaved: unsavedPending,
      waiting: () => registration?.waiting ?? null,
      onTakeover: (run) => navigator.serviceWorker.addEventListener("controllerchange", run, { once: true }),
      reload: () => location.reload(),
      sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
    });
  },
};
