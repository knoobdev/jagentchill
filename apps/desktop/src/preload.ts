import { contextBridge, ipcRenderer, webUtils } from "electron";
import { DESKTOP_BRIDGE_VERSION, desktopChannelName, type DesktopChannel, type DesktopEvent, type DesktopReply } from "../../../packages/protocol/src/desktop-channels.ts";
import type { TailnetProxyCredentials } from "../../../packages/protocol/src/tailnet.ts";

/**
 * The preload bridge: one frozen object with a fixed set of typed methods. Nothing generic crosses it — no
 * `ipcRenderer`, no `invoke` by name, no Node object. Each method below names its channel as a literal.
 */
class BridgeFailure extends Error {
  code: string;
  kind?: string;
  details?: Record<string, unknown>;
  constructor(error: { code: string; message: string; kind?: string; details?: Record<string, unknown> }) {
    super(error.message);
    this.name = "DesktopBridgeError";
    this.code = error.code;
    this.kind = error.kind;
    this.details = error.details;
  }
}
async function call<T>(channel: DesktopChannel, ...args: unknown[]): Promise<T> {
  const reply = (await ipcRenderer.invoke(desktopChannelName(channel), ...args)) as DesktopReply<T>;
  if (reply.ok) return reply.value;
  // contextBridge keeps own properties of an Error only as plain data: the code travels in the message head too.
  const failure = new BridgeFailure(reply.error);
  failure.message = `${reply.error.code}: ${reply.error.message}`;
  throw Object.assign(failure, { code: reply.error.code, kind: reply.error.kind, details: reply.error.details });
}
/** A failed call resolves to `{ error }` instead of throwing, so that code, kind and details survive the bridge intact. */
const safe = <T>(channel: DesktopChannel) => async (...args: unknown[]): Promise<{ value: T } | { error: { code: string; message: string; kind?: string; details?: Record<string, unknown> } }> => {
  const reply = (await ipcRenderer.invoke(desktopChannelName(channel), ...args)) as DesktopReply<T>;
  return reply.ok ? { value: reply.value } : { error: reply.error };
};
const on = <T>(event: DesktopEvent) => (listener: (payload: T) => void): (() => void) => {
  const handler = (_event: unknown, payload: T) => listener(payload);
  ipcRenderer.on(desktopChannelName(event), handler);
  return () => { ipcRenderer.removeListener(desktopChannelName(event), handler); };
};
const info = ipcRenderer.sendSync(desktopChannelName("app.info")) as { version: string; platform: string; arch: string; packaged: boolean; devToolsDisabled: boolean; appMenuInWindow: boolean };

const bridge = {
  connectionMode: {
    get: () => call<"tailscale" | "local" | null>("connectionMode.get"),
    set: (mode: "tailscale" | "local" | null) => call<void>("connectionMode.set", mode),
  },
  version: DESKTOP_BRIDGE_VERSION,
  app: {
    version: info.version, platform: info.platform, arch: info.arch, packaged: info.packaged,
    paths: () => call<{ library: string; logs: string; userData: string; cache: string }>("app.info"),
    relaunch: () => call<void>("app.relaunch"), quit: () => call<void>("app.quit"),
  },
  window: {
    minimize: () => call<void>("window.minimize"), maximize: () => call<void>("window.maximize"), close: () => call<void>("window.close"),
    setFullscreen: (on_: boolean) => call<void>("window.setFullscreen", on_), newWindow: (route?: string) => call<void>("window.new", route),
    getState: () => call<{ maximized: boolean; fullscreen: boolean; focused: boolean }>("window.state"), onState: on<{ maximized: boolean; fullscreen: boolean; focused: boolean }>("window.state"),
    controls: () => call<unknown>("window.controls"), setUiScale: (scale: number) => call<number>("window.setUiScale", scale),
    setChrome: (chrome: { background: string; text: string; scheme: "light" | "dark" }) => call<void>("window.setChrome", chrome),
    setRoute: (route: string) => call<void>("window.setRoute", route),
    claimProject: (projectId: string) => call<{ claimed: boolean }>("window.claimProject", projectId), releaseProject: (projectId: string) => call<void>("window.releaseProject", projectId),
  },
  gateway: {
    getStatus: () => call<unknown>("gateway.status"), onStatus: on<unknown>("gateway.status"),
    start: () => call<void>("gateway.start"), stop: () => call<void>("gateway.stop"), restart: () => call<void>("gateway.restart"), runDoctor: () => call<void>("gateway.doctor"),
    openLogs: () => call<void>("gateway.openLogs"), getNetworkAccess: () => call<unknown>("gateway.getNetworkAccess"),
    setNetworkAccess: (change: { level: string; alsoLan?: boolean; alsoTailnet?: boolean }) => call<unknown>("gateway.setNetworkAccess", change),
    restoreAdmin: (confirmation: string) => call<void>("gateway.restoreAdmin", { confirmation }), setEnabled: (enabled: boolean) => call<void>("gateway.setEnabled", enabled),
    resolveKeyStorage: (choice: "retry" | "file" | "cancel" | "move-to-store", options?: { confirmed: boolean }) => call<unknown>("gateway.resolveKeyStorage", choice, options),
    getLegacyIdentityRecovery: () => call<"none" | "trying" | "needs-action" | "migrated">("gateway.getLegacyIdentityRecovery"),
    retryLegacyIdentity: () => call<void>("gateway.retryLegacyIdentity"), onLegacyIdentityRecovery: on<"none" | "trying" | "needs-action" | "migrated">("identity.legacyRecovery"),
    setPort: (port: number) => call<void>("gateway.setPort", port), resetConfiguration: (confirmation: string) => call<string>("gateway.resetConfiguration", { confirmation }),
  },
  tailnet: {
    getStatus: () => call<unknown>("tailnet.getStatus"), getProxyCredentials: () => call<TailnetProxyCredentials | null>("tailnet.getProxyCredentials"), startLogin: (options: { mode: "interactive" | "authKey"; authKey?: string }) => call<unknown>("tailnet.startLogin", options),
    logout: () => call<void>("tailnet.logout"), openProxy: (options: { gatewayId: string }) => call<unknown>("tailnet.openProxy", options), closeProxy: (options: { proxyId: string }) => call<void>("tailnet.closeProxy", options),
  },
  library: {
    call: safe<unknown>("library.call"), readRange: safe<Uint8Array>("library.readRange"),
    uploadOpen: () => call<string>("library.uploadOpen"), uploadWrite: safe<void>("library.uploadWrite"), uploadAbort: (id: string) => call<void>("library.uploadAbort", id),
    release: (id: string) => call<void>("library.release", id),
    status: () => call<unknown>("library.status"), onStatus: on<unknown>("library.status"), onChanged: on<void>("library.changed"), onMoveProgress: on<unknown>("library.moveProgress"),
    locate: () => call<unknown>("library.locate"), createHere: () => call<unknown>("library.createHere"), retry: () => call<unknown>("library.retry"),
    chooseMoveTarget: () => call<unknown>("library.chooseMoveTarget"), move: (token: string) => call<unknown>("library.move", token), cancelMove: () => call<void>("library.cancelMove"),
    rebuildIndex: () => call<void>("library.rebuildIndex"),
  },
  files: {
    openDialog: (options: unknown) => call<unknown[]>("files.openDialog", options), saveDialog: (options: unknown) => call<unknown>("files.saveDialog", options),
    reveal: (target: string) => call<void>("files.reveal", target), read: safe<Uint8Array>("files.read"), stat: (token: string) => call<unknown>("files.stat", token),
    exportOpen: (token: string, options?: { estimatedBytes?: number }) => call<unknown>("files.exportOpen", token, options), exportWrite: safe<void>("files.exportWrite"),
    exportFinish: (token: string) => call<unknown>("files.exportFinish", token), exportAbort: (token: string) => call<void>("files.exportAbort", token),
    relink: (target: { projectId: string; assetId: string; name: string }) => call<unknown>("files.relink", target),
    grant: (target: { projectId: string; assetId: string; token: string }) => call<unknown>("files.grant", target), revokeGrant: (grantId: string) => call<void>("files.revokeGrant", grantId),
    /** Files the user dropped on the window: the paths come from the browser's own `File` objects and cannot be chosen by script. */
    fromDrop: (files: File[]) => call<unknown[]>("files.registerDropped", files.map((file) => webUtils.getPathForFile(file)).filter((path) => path !== "")),
    expandDrop: (tokens: string[]) => call<unknown>("files.expandDrop", tokens), freeSpace: (token?: string) => call<number | null>("files.freeSpace", token),
    startDrag: (target: unknown) => call<void>("files.startDrag", target),
    /** Files opened through a file association, "Open with" or the app icon. Subscribing hands over the ones that arrived earlier. */
    onOpen: (listener: (files: unknown[]) => void) => { const off = on<unknown[]>("files.open")(listener); void call<void>("files.ready"); return off; },
  },
  device: {
    getPublicKey: safe<{ deviceId: string; devicePublicKey: string; keyProtection: string }>("device.getPublicKey"),
    /** Structured input only: `{ kind: "handshake" | "request" | "rotate", fields }`. Anything else is answered `SIGN_REFUSED`. */
    sign: safe<{ signature: string }>("device.sign"),
    /** Replaces this device's key on every paired host. The main process asks the person at the computer first. */
    rotate: safe<{ oldDeviceId: string; deviceId: string; hosts: number }>("device.rotate"),
    beginEnrolment: (offer: string, origin: string, proxy?: { port: number; secret: string }) => call<{ gatewayId: string }>("device.beginEnrolment", offer, origin, proxy), endEnrolment: () => call<void>("device.endEnrolment"),
    /**
     * One relayed enrolment step. The outcome is RETURNED as a plain envelope, never thrown: `contextBridge` drops an
     * Error's own properties, so a thrown `code` would be lost and the renderer could not rebuild the typed error.
     */
    enrolmentPost: async (step: string, json: string): Promise<{ ok: true; status: number; body: unknown } | { ok: false; code: string; message: string }> => {
      const reply = (await ipcRenderer.invoke(desktopChannelName("device.enrolmentPost"), step, json)) as DesktopReply<{ status: number; body: unknown }>;
      return reply.ok ? { ok: true, status: reply.value.status, body: reply.value.body } : { ok: false, code: reply.error.code, message: reply.error.message };
    },
  },
  secureStore: {
    get: (key: string) => call<string | null>("secureStore.get", key), set: (key: string, value: string) => call<void>("secureStore.set", key, value),
    delete: (key: string) => call<void>("secureStore.delete", key), keys: (prefix: string) => call<string[]>("secureStore.keys", prefix),
  },
  notifications: {
    show: (notification: unknown) => call<void>("notifications.show", notification), setBadge: (count: number) => call<void>("notifications.setBadge", count),
    requestAttention: () => call<void>("notifications.requestAttention"), permission: () => call<string>("notifications.permission"),
    openSystemSettings: () => call<void>("notifications.openSystemSettings"), onActivated: on<{ id: string; route?: string; action?: string }>("notifications.activated"),
  },
  updates: {
    getState: () => call<unknown>("updates.state"), onState: on<unknown>("updates.state"), check: () => call<unknown>("updates.check"), download: () => call<void>("updates.download"), reveal: () => call<unknown>("updates.reveal"),
    install: () => call<unknown>("updates.install"), remindLater: () => call<void>("updates.remindLater"),
    setOptions: (options: { autoCheck?: boolean; autoDownload?: boolean }) => call<void>("updates.setOptions", options), setBlockers: (blockers: unknown) => call<void>("updates.setBlockers", blockers),
  },
  menu: {
    getModel: () => call<unknown>("menu.model"), onModel: on<unknown>("menu.model"), setState: (state: unknown) => call<void>("menu.setState", state),
    invoke: (id: string) => call<void>("menu.invoke", id), onInvoke: on<{ action: string; payload?: Record<string, string>; trigger: "menu" }>("menu.invoke"),
  },
  deepLinks: {
    /** Links arrive in order; the ones that came before this call are delivered first. */
    subscribe: (listener: (url: string) => void) => { const off = on<string>("deepLinks.link")(listener); void call<void>("deepLinks.ready"); return off; },
  },
  capabilities: {
    get: () => call<unknown>("capabilities.get"), report: (probe: Record<string, unknown>) => call<void>("capabilities.report", probe), onGpuFallback: on<void>("capabilities.gpuFallback"),
    blockSleep: (reason: "export" | "render") => call<void>("power.block", reason), unblockSleep: (reason: "export" | "render") => call<void>("power.unblock", reason),
    onMediaKey: on<"play-pause">("media.key"),
  },
  background: {
    get: () => call<unknown>("background.get"), set: (change: { keepInTray?: boolean; launchAtLogin?: boolean; keepHostAfterQuit?: boolean }) => call<unknown>("background.set", change),
    setWork: (work: unknown) => call<void>("background.setWork", work), onState: on<unknown>("background.state"),
  },
  policy: { devToolsDisabled: info.devToolsDisabled, appMenuInWindow: info.appMenuInWindow },
};
const freeze = (value: unknown): void => {
  if (value !== null && typeof value === "object") { for (const entry of Object.values(value)) freeze(entry); Object.freeze(value); }
};
freeze(bridge);
contextBridge.exposeInMainWorld("jagentchillDesktop", bridge);
export type DesktopBridge = typeof bridge;
