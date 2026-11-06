/**
 * The desktop shell as the app sees it: the object the preload script exposes, or `null` in a browser and on mobile.
 * Only the `.electron` platform files and the desktop-only screens use it.
 */
export type BridgeReply<T> = { value: T } | { error: { code: string; message: string; kind?: string; details?: Record<string, unknown> } };
export type DesktopFile = { token: string; name: string; path: string; size: number; directory: boolean; kind: string | null };
export type HostStatus = {
  state: "stopped" | "starting" | "ready" | "degraded" | "restarting" | "doctor" | "failed" | "stopping"; label: string; reasons: string[]; reasonTexts: string[]; message?: string;
  enabled: boolean; pid?: number; port?: number; gatewayPort?: number; gatewayId?: string; started_ms?: number; serverVersion?: string; protocolVersion?: number;
  portChange?: { previous: string; current: string };
  gateway?: { state: string; restartCount: number; lastExit?: { code: number | null; signal: string | null; ts_ms: number } };
  lastExit?: { code: number | null; signal: string | null; ts_ms: number }; restartsLastHour: number; networkLevel: string; keyProtection: string | null; path: string;
  listeners: { tailnet: { available: boolean; enabled: boolean }; lan: { available: boolean; enabled: boolean } };
};
export type LibraryStatus =
  | { state: "opening" }
  | { state: "ready"; path: string; readOnly: boolean; banner: string | null; rebuilding: string | null; indexRebuilt: boolean }
  | { state: "blocked"; path: string; message: string; reason: string; actions: { id: "retry" | "locate" | "create" | "quit"; label: string; enabled: boolean }[] };
export type MoveResult = { moved: true; library: string; files: number; bytes: number } | { moved: false; message: string; reason: string; code: string };
export type UpdateState = {
  /** `manual`: this build cannot replace itself (an unsigned macOS app); it downloads and verifies the new package and shows it in its folder. */
  mode: "auto" | "manual" | "link" | "off"; status: "idle" | "checking" | "available" | "downloading" | "ready" | "downloaded" | "error" | "up-to-date";
  version?: string; progress?: number; error?: string; downloadUrl?: string; managed?: boolean; installOnQuit?: boolean; currentVersion: string; file?: string; lastChecked_ms?: number; autoCheck?: boolean; autoDownload?: boolean; reason?: "unreachable" | "feed" | "verification" | "download";
};
export type MenuNode = { type?: "separator" | "item"; id?: string; label?: string; action?: string; payload?: Record<string, string>; role?: string; submenu?: MenuNode[]; enabled?: boolean; checked?: boolean; hint?: string; statusLine?: boolean };
export type TopMenu = { id: string; label: string; items: MenuNode[] };
export type BackgroundState = { trayAvailable: boolean; keepInTray: boolean; launchAtLogin: boolean; keepHostAfterQuit: boolean; noTrayText: string | null; trayShown: boolean; trayState: "idle" | "busy" | "attention" };
export type TailnetStatus = { connected: boolean; host: string | null; loginUrl: string | null; port: number | null; proxyPort?: number | null; enabled: boolean; updatedAt: number; unavailableReason?: string | null };
export type TailnetProxyCredentials = { port: number; secret: string };
export type WorkItem = { id: string; title: string; percent?: number; route?: string };
type Off = () => void;

export type DesktopBridge = {
  version: number;
  connectionMode: { get(): Promise<"tailscale" | "local" | null>; set(mode: "tailscale" | "local" | null): Promise<void> };
  app: { version: string; platform: "darwin" | "win32" | "linux"; arch: string; packaged: boolean; paths(): Promise<{ library: string; logs: string; userData: string; cache: string }>; relaunch(): Promise<void>; quit(): Promise<void> };
  window: {
    minimize(): Promise<void>; maximize(): Promise<void>; close(): Promise<void>; setFullscreen(on: boolean): Promise<void>; newWindow(route?: string): Promise<void>;
    getState(): Promise<{ maximized: boolean; fullscreen: boolean; focused: boolean }>; onState(listener: (state: { maximized: boolean; fullscreen: boolean; focused: boolean }) => void): Off;
    controls(): Promise<{ start: { side: string; buttons: string[]; inset: number; drawn: "native" | "app" }; end: { side: string; buttons: string[]; inset: number; drawn: "native" | "app" }; platform: string; uiScale: number; maxUiScale: number }>;
    setUiScale(scale: number): Promise<number>; setChrome(chrome: { background: string; text: string; scheme: "light" | "dark" }): Promise<void>; setRoute(route: string): Promise<void>;
    claimProject(projectId: string): Promise<{ claimed: boolean }>; releaseProject(projectId: string): Promise<void>;
  };
  gateway: {
    getStatus(): Promise<HostStatus>; onStatus(listener: (status: HostStatus) => void): Off; start(): Promise<void>; stop(): Promise<void>; restart(): Promise<void>; runDoctor(): Promise<void>;
    openLogs(): Promise<void>; getNetworkAccess(): Promise<{ level: string; levels: { id: string; label: string; available: boolean; unavailable?: string }[] }>;
    setNetworkAccess(change: { level: string; alsoLan?: boolean; alsoTailnet?: boolean }): Promise<{ level: string }>; restoreAdmin(confirmation: string): Promise<void>; setEnabled(enabled: boolean): Promise<void>;
    resolveKeyStorage(choice: "retry" | "file" | "cancel" | "move-to-store", options?: { confirmed: boolean }): Promise<{ keyProtection: string | null; localOnly: boolean }>;
    getLegacyIdentityRecovery(): Promise<"none" | "trying" | "needs-action" | "migrated">; retryLegacyIdentity(): Promise<void>; onLegacyIdentityRecovery(listener: (state: "none" | "trying" | "needs-action" | "migrated") => void): Off;
    setPort(port: number): Promise<void>; resetConfiguration(confirmation: string): Promise<string>;
  };
  tailnet: { getStatus(): Promise<TailnetStatus>; getProxyCredentials(): Promise<TailnetProxyCredentials | null>; startLogin(options: { mode: "interactive" | "authKey"; authKey?: string }): Promise<TailnetStatus>; logout(): Promise<TailnetStatus>; openProxy(options: { gatewayId: string }): Promise<{ proxyId: string }>; closeProxy(options: { proxyId: string }): Promise<void> };
  library: {
    call(method: string, args: unknown[]): Promise<BridgeReply<unknown>>; readRange(method: string, args: unknown[], range: { start: number; end: number }): Promise<BridgeReply<Uint8Array>>;
    uploadOpen(): Promise<string>; uploadWrite(id: string, bytes: Uint8Array): Promise<BridgeReply<void>>; uploadAbort(id: string): Promise<void>; release(id: string): Promise<void>;
    status(): Promise<LibraryStatus>; onStatus(listener: (status: LibraryStatus) => void): Off; onChanged(listener: () => void): Off; onMoveProgress(listener: (progress: { file: string; copiedFiles: number; totalFiles: number; copiedBytes: number; totalBytes: number }) => void): Off;
    locate(): Promise<LibraryStatus>; createHere(): Promise<LibraryStatus>; retry(): Promise<LibraryStatus>; chooseMoveTarget(): Promise<DesktopFile | null>; move(token: string): Promise<MoveResult>; cancelMove(): Promise<void>; rebuildIndex(): Promise<void>;
  };
  files: {
    openDialog(options: { purpose: string; multiple?: boolean; directory?: boolean; filters?: { name: string; extensions: string[] }[]; title?: string }): Promise<DesktopFile[]>;
    saveDialog(options: { purpose: string; defaultName: string; filters?: { name: string; extensions: string[] }[]; title?: string }): Promise<DesktopFile | null>;
    reveal(target: string): Promise<void>; read(token: string, range: { start: number; end: number }): Promise<BridgeReply<Uint8Array>>; stat(token: string): Promise<DesktopFile>;
    exportOpen(token: string, options?: { estimatedBytes?: number }): Promise<{ lowSpace: boolean; free: number | null }>; exportWrite(token: string, bytes: Uint8Array): Promise<BridgeReply<void>>;
    exportFinish(token: string): Promise<DesktopFile>; exportAbort(token: string): Promise<void>;
    relink(target: { projectId: string; assetId: string; name: string }): Promise<unknown>; grant(target: { projectId: string; assetId: string; token: string }): Promise<{ externalPath: string; externalSize: number; externalMtime_ms: number; externalGrantId: string; url: string }>;
    revokeGrant(grantId: string): Promise<void>; fromDrop(files: File[]): Promise<DesktopFile[]>; expandDrop(tokens: string[]): Promise<{ files: DesktopFile[]; skipped: number }>;
    freeSpace(token?: string): Promise<number | null>; startDrag(target: string | { projectId: string; assetId: string }): Promise<void>; onOpen(listener: (batch: { files: DesktopFile[]; skipped: number }) => void): Off;
  };
  device: {
    getPublicKey(): Promise<BridgeReply<{ deviceId: string; devicePublicKey: string; keyProtection: string }>>; sign(input: unknown): Promise<BridgeReply<{ signature: string }>>;
    beginEnrolment(offer: string, origin: string, proxy?: { port: number; secret: string }): Promise<{ gatewayId: string }>; endEnrolment(): Promise<void>;
    /** One enrolment HTTP step, relayed by the main process to the address of the active offer. Returns an envelope, never throws. */
    enrolmentPost(step: string, json: string): Promise<{ ok: true; status: number; body: unknown } | { ok: false; code: string; message: string }>;
    rotate(): Promise<BridgeReply<{ oldDeviceId: string; deviceId: string; hosts: number }>>;
  };
  secureStore: { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void>; delete(key: string): Promise<void>; keys(prefix: string): Promise<string[]> };
  notifications: { show(notification: { id: string; kind: string; title: string; body?: string; route?: string }): Promise<void>; setBadge(count: number): Promise<void>; requestAttention(): Promise<void>; permission(): Promise<string>; openSystemSettings(): Promise<void>; onActivated(listener: (event: { id: string; route?: string; action?: string }) => void): Off };
  updates: { getState(): Promise<UpdateState>; onState(listener: (state: UpdateState) => void): Off; check(): Promise<UpdateState>; download(): Promise<void>; reveal(): Promise<{ shown: boolean; file?: string }>; install(): Promise<{ restarted: boolean; blockers: string[] }>; remindLater(): Promise<void>; setOptions(options: { autoCheck?: boolean; autoDownload?: boolean }): Promise<void>; setBlockers(blockers: unknown): Promise<void> };
  menu: { getModel(): Promise<TopMenu[]>; onModel(listener: (model: TopMenu[]) => void): Off; setState(state: Record<string, unknown>): Promise<void>; invoke(id: string): Promise<void>; onInvoke(listener: (event: { action: string; payload?: Record<string, string>; role?: string; trigger: "menu" }) => void): Off };
  deepLinks: { subscribe(listener: (url: string) => void): Off };
  capabilities: { get(): Promise<unknown>; report(probe: Record<string, unknown>): Promise<void>; onGpuFallback(listener: () => void): Off; blockSleep(reason: "export" | "render"): Promise<void>; unblockSleep(reason: "export" | "render"): Promise<void>; onMediaKey(listener: (key: "play-pause") => void): Off };
  background: { get(): Promise<BackgroundState>; set(change: { keepInTray?: boolean; launchAtLogin?: boolean; keepHostAfterQuit?: boolean }): Promise<BackgroundState>; setWork(work: { exports: WorkItem[]; jobs: WorkItem[]; attention: WorkItem[]; unsavedProjects: number }): Promise<void>; onState(listener: (state: BackgroundState) => void): Off };
  policy: { devToolsDisabled: boolean; appMenuInWindow: boolean };
};

export const desktop = (): DesktopBridge | null => (globalThis as { jagentchillDesktop?: DesktopBridge }).jagentchillDesktop ?? null;
/** True only in the Electron shell, where the preload bridge is on `globalThis`; false in a browser and on mobile. */
export const isDesktop = (): boolean => desktop() !== null;
/** The bridge, in a file that only the desktop build loads. */
export function requireDesktop(): DesktopBridge {
  const bridge = desktop();
  if (!bridge) throw new Error("the desktop bridge is not available");
  return bridge;
}
/** An action a menu item, the tray or a notification asked for; the screen that owns the action listens for it. */
export const DESKTOP_ACTION_EVENT = "jagentchill:action";
/** Media files opened with the app while a project is open and the user chose "Add to <project>". */
export const DESKTOP_MEDIA_EVENT = "jagentchill:add-media";
export type DesktopActionDetail = { action: string; payload?: Record<string, string>; trigger: "menu" };
