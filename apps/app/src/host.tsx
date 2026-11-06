import { carryThroughPortals } from "@jagentchill/ui";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState, Platform } from "react-native";
import { connectHostWithFallback, deleteHostSecret, listHostSecrets, migrateHostRecord, putHostSecret, type ConnectOptions, type HostConnection, type HostEvent, type HostRecord, type HostSecretInfo } from "@jagentchill/client";
import type { ModelRef } from "@jagentchill/protocol";
import { LOCAL_HOST, PREFS, formatTimeOfDay } from "@jagentchill/app-core";
import { listHosts, loadSigner, saveHost } from "./identity";
import { desktop } from "./platform/desktop";
import { usePref } from "./state";
import { getNativeTailscaleAdapter } from "./tailscale/native";
import { hostThroughNativeTailnetProxy } from "./tailscale/host-route";
import { hostRetryDelay } from "./host-retry";

export type Session = {
  sessionKey: string; title?: string; titleSource?: "auto" | "user"; access: "host" | "private"; ownerDeviceId: string; agentId: string; created_ms: number;
  origin?: "device" | "automation" | "workflow" | "agent"; toolSurface?: string;
  projectId?: string; scriptId?: string; parentSessionKey?: string;
  pinned: boolean; archived: boolean;
  /** The model the session runs on: runtime, provider and model. */
  ref?: ModelRef; modeId: string; pendingModeId?: string; thinkingOptionId: string | null; featureValues: Record<string, string | boolean | null>; unattended: boolean;
  /** Present on a session index response; live panes still use their stream for turn state. */
  running?: boolean;
};
export type Approval = { approvalId: string; sessionKey: string; title: string; detail: string; toolName?: string; cwd?: string; kind?: "exec" | "plugin"; requested_ms?: number; grant?: { scope: "program" | "command" | "tool"; subject: string } };
/** The host's secret route for this device: values go out over the signed route and never come back. */
export type HostSecrets = { put(name: string, value: string): Promise<{ name: string; hint?: string }>; remove(name: string): Promise<{ name: string }>; list(): Promise<HostSecretInfo[]> };
export type PairingRequest = {
  requestId: string; deviceId: string; deviceName: string; platform: string; sourceAddress: string; transport: string; role: "admin" | "editor" | "viewer"; expires_ms: number; code: string;
};

type HostState = {
  hosts: HostRecord[];
  /** The host the shell is showing; undefined while this device is paired with none ("Local only"). */
  host: HostRecord | undefined;
  connection: HostConnection | undefined;
  status: "local" | "connecting" | "connected" | "unavailable";
  error: unknown;
  sessions: Session[];
  /** False from the moment a host is chosen until its session list has been read once. */
  sessionsLoaded: boolean;
  approvals: Approval[];
  pairingRequests: PairingRequest[];
  /** Subscribes to every event of the connection; returns the function that removes the listener. */
  onEvent(listener: (event: HostEvent) => void): () => void;
  refreshHosts(): Promise<void>;
  refreshSessions(): Promise<void>;
  addSession(session: Session): void;
  removeSession(sessionKey: string): void;
  /** This device's role on the connected host. */
  role: "admin" | "editor" | "viewer" | null;
  /** Undefined while no host is connected. */
  secrets: HostSecrets | undefined;
  dismissPairingRequest(requestId: string): void;
  can(scope: string): boolean;
  /** "This device only" is selected: every host stays paired and none is used. */
  localOnly: boolean;
  /** Makes a paired host the active one, or — with `LOCAL_HOST` — selects "This device only". Remembered across launches. */
  selectHost(gatewayId: string): void;
  /** True once the paired hosts have been read from the device. */
  hostsLoaded: boolean;
};

/** One id per tab or window, kept across a reload: the host tells two windows of one device apart by it. */
function clientInstance(): string {
  try {
    const stored = globalThis.sessionStorage?.getItem("jagentchill.clientInstance");
    if (stored) return stored;
    const made = `app-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    globalThis.sessionStorage?.setItem("jagentchill.clientInstance", made);
    return made;
  } catch { return "app"; }
}
const HostContext = createContext<HostState | null>(null);
// Drawers, sheets and dialogs are drawn in the overlay stack: the context travels with them.
carryThroughPortals(HostContext);

export function HostProvider(props: { children: ReactNode }) {
  const [hosts, setHosts] = useState<HostRecord[]>([]);
  const [connection, setConnection] = useState<HostConnection>();
  const [status, setStatus] = useState<HostState["status"]>("local");
  const [error, setError] = useState<unknown>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionsFrom, setSessionsFrom] = useState<string | null>(null);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [pairingRequests, setPairingRequests] = useState<PairingRequest[]>([]);
  const listeners = useRef(new Set<(event: HostEvent) => void>());
  const hostsRefreshSequence = useRef(0);
  const [hostsLoaded, setHostsLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [desktopHostPolicy, setDesktopHostPolicy] = useState<{ loaded: boolean; mode: "tailscale" | "local" | null; running: boolean; starting: boolean; tailnetConnected: boolean }>(() => ({ loaded: !desktop(), mode: null, running: false, starting: false, tailnetConnected: false }));
  const [lastHost, setLastHost] = usePref(PREFS.lastHost);
  const localOnly = lastHost === LOCAL_HOST;
  // The last active host is restored on launch; a host that is no longer paired falls back to the first one.
  const host = localOnly ? undefined : hosts.find((record) => record.gatewayId === lastHost) ?? hosts[0];

  const refreshHosts = useCallback(async () => {
    const sequence = ++hostsRefreshSequence.current;
    const stored = await listHosts().catch(() => []);
    const migrated = stored.map(migrateHostRecord);
    if (sequence !== hostsRefreshSequence.current) return;
    setHosts(migrated);
    // Web IndexedDB uses structured records directly; write the one-origin migration back on first load.
    await Promise.all(migrated.filter((host, index) => !stored[index]?.connections?.length).map((host) => saveHost(host).catch(() => undefined)));
    if (sequence !== hostsRefreshSequence.current) return;
    setHostsLoaded(true);
  }, []);
  const refreshSessions = useCallback(async () => {
    if (!connection || !host) return;
    const result = await connection.call<{ sessions: Session[] }>("jagentchill.session.list");
    setSessions(result.sessions);
    setSessionsFrom(host.gatewayId);
  }, [connection, host?.gatewayId]);
  useEffect(() => void refreshHosts(), [refreshHosts]);
  useEffect(() => {
    const shell = desktop();
    if (!shell) return;
    let active = true;
    const refresh = () => {
      void Promise.all([shell.connectionMode.get().catch(() => null), shell.gateway.getStatus().catch(() => null), shell.tailnet.getStatus().catch(() => null)]).then(([mode, status, tailnet]) => {
        if (!active) return;
        const next = { loaded: true, mode, running: status?.state === "ready" || status?.state === "degraded", starting: status?.state === "starting" || status?.state === "restarting", tailnetConnected: tailnet?.connected === true };
        setDesktopHostPolicy((previous) => previous.loaded === next.loaded && previous.mode === next.mode && previous.running === next.running && previous.starting === next.starting && previous.tailnetConnected === next.tailnetConnected ? previous : next);
      });
    };
    const offStatus = shell.gateway.onStatus(refresh);
    const timer = setInterval(refresh, 5000);
    refresh();
    return () => { active = false; offStatus(); clearInterval(timer); };
  }, []);
  useEffect(() => {
    const shell = desktop();
    if (!shell) return;
    let pending = Promise.resolve();
    const refreshForBuiltInHost = (status: { gatewayId?: string; port?: number }) => {
      if (!status.gatewayId) return;
      pending = pending.then(async () => {
        await refreshHosts();
        if (!status.port) return;
        const [mode, tailnetStatus] = await Promise.all([shell.connectionMode.get().catch(() => null), shell.tailnet.getStatus().catch(() => null)]);
        const record = (await listHosts()).find((item) => item.gatewayId === status.gatewayId && (item as HostRecord & { builtIn?: boolean }).builtIn);
        if (!record) return;
        const current = migrateHostRecord(record);
        const connections = current.connections ?? [];
        const existingLocal = connections.find((item) => item.kind === "local");
        const localOrigin = existingLocal?.origin ?? current.origin;
        let parsed: URL;
        try { parsed = new URL(localOrigin); } catch { return; }
        if (parsed.hostname !== "localhost" && !parsed.hostname.startsWith("127.")) return;
        if (parsed.port !== String(status.port)) parsed.port = String(status.port);
        const updatedOrigin = parsed.toString().replace(/\/$/, "");
        const local = existingLocal
          ? { ...existingLocal, origin: updatedOrigin }
          : { id: `local:${record.gatewayId}`, kind: "local" as const, origin: updatedOrigin };
        let nextConnections = existingLocal
          ? connections.map((item) => item.id === existingLocal.id ? local : item)
          : [...connections, local];
        let tailnet = nextConnections.find((item) => item.kind === "tailnet");
        if (mode === "tailscale" && tailnetStatus?.connected && tailnetStatus.host && tailnetStatus.port) {
          const address = `${tailnetStatus.host}:${tailnetStatus.port}`;
          tailnet = { id: `tailnet:${address}`, kind: "tailnet", origin: `http://${address}`, tailnetAddress: address };
          nextConnections = [...nextConnections.filter((item) => item.kind !== "tailnet"), tailnet];
        }
        // What this device USES to reach its bundled host is always the local connection (a stored record's origin
        // follows the preferred connection). The tailnet connection stays in the list for display and for others.
        const selected = local;
        const preferredConnectionId = selected?.id ?? current.preferredConnectionId ?? local.id;
        // The record's origin is what THIS app dials (signed HTTP as well as the socket): always the loopback address of
        // the bundled host. Its tailnet address lives only in `connections` (shown on the Connections row, used by others).
        const origin = local.origin;
        if (JSON.stringify(nextConnections) === JSON.stringify(connections) && current.preferredConnectionId === preferredConnectionId && current.origin === origin) return;
        await saveHost({ ...current, origin, connections: nextConnections, preferredConnectionId });
        await refreshHosts();
      }).catch(() => undefined);
    };
    const off = shell.gateway.onStatus(refreshForBuiltInHost);
    void shell.gateway.getStatus().then(refreshForBuiltInHost).catch(() => undefined);
    return off;
  }, [refreshHosts]);

  useEffect(() => {
    const isBuiltIn = !!(host as (HostRecord & { builtIn?: boolean }) | undefined)?.builtIn;
    const blockedBuiltIn = isBuiltIn && desktop() && (!desktopHostPolicy.loaded || !desktopHostPolicy.mode || !desktopHostPolicy.running);
    if (blockedBuiltIn) {
      setStatus("unavailable");
      setConnection(undefined);
      setSessions([]);
      setApprovals([]);
      setPairingRequests([]);
      return;
    }
    if (!host) {
      setStatus("local");
      setConnection(undefined);
      setSessions([]);
      setApprovals([]);
      setPairingRequests([]);
      return;
    }
    let live: HostConnection | undefined;
    let cancelled = false;
    // A lost connection backs off and pauses while the app is backgrounded.
    let again: ReturnType<typeof setTimeout> | undefined;
    let pendingDelay: number | null = null;
    const retry = (delay: number) => {
      if (cancelled || again) return;
      pendingDelay = delay;
      if (AppState.currentState !== "active") return;
      again = setTimeout(() => { again = undefined; pendingDelay = null; setAttempt((count) => count + 1); }, delay);
    };
    const foreground = AppState.addEventListener("change", (state) => {
      if (state !== "active") { if (again) clearTimeout(again); again = undefined; return; }
      if (pendingDelay !== null) { const delay = pendingDelay; pendingDelay = null; retry(delay); }
    });
    const online = () => { if (!live) { clearTimeout(again); again = undefined; retry(0); } };
    // A browser that reports the network gone does not always end the socket: the channel is closed here, so that every
    // part of the app knows it is offline, and opened again when the network is back.
    const offline = () => { const dead = live; if (dead) { live = undefined; dead.close(); setStatus("unavailable"); setConnection(undefined); } };
    if (typeof window !== "undefined" && window.addEventListener) { window.addEventListener("online", online); window.addEventListener("offline", offline); }
    if (attempt === 0) { setStatus("connecting"); setError(null); }
    (async () => {
      const signer = await loadSigner();
      const preferred = host.connections?.find((item) => item.id === host.preferredConnectionId) ?? host.connections?.[0];
      let routes: Array<{ record: HostRecord; kind?: string; tailnetAddress?: string }>;
      if (Platform.OS === "ios" || Platform.OS === "android") {
        routes = [{ record: hostThroughNativeTailnetProxy(host, getNativeTailscaleAdapter()) }];
      } else if (isBuiltIn) {
        // This app reaches the host bundled on the same computer over loopback in every connect type. Its tailnet
        // connection is what other devices use (and what the Connections row shows), never this app's own transport.
        const local = host.connections?.find((item) => item.kind === "local");
        if (local) routes = [{ record: { ...host, origin: local.origin }, kind: local.kind }];
        else if (desktop()) {
          const status = await desktop()!.gateway.getStatus();
          if (!status.port) throw new Error("The bundled host loopback port is unavailable.");
          routes = [{ record: { ...host, origin: `http://127.0.0.1:${status.port}` }, kind: "local" }];
        } else routes = [{ record: host }];
      } else {
        const connections = host.connections ?? [];
        const ordered = preferred ? [preferred, ...connections.filter((item) => item.id !== preferred.id)] : connections;
        routes = ordered.map((item) => ({ record: { ...host, origin: item.origin, preferredConnectionId: item.id }, kind: item.kind, tailnetAddress: item.tailnetAddress }));
      }
      const options: ConnectOptions[] = [];
      for (const route of routes) {
        let tailnetProxy: ConnectOptions["tailnetProxy"];
        if (route.kind === "tailnet" && desktop()) {
          const credentials = await desktop()!.tailnet.getProxyCredentials().catch(() => null);
          if (!credentials) continue;
          const target = route.tailnetAddress ?? new URL(route.record.origin).host;
          tailnetProxy = { origin: `http://127.0.0.1:${credentials.port}/_jagentchill/tailnet/${encodeURIComponent(target)}`, secret: credentials.secret };
        }
        options.push({
          host: route.record, signer, clientInstanceId: clientInstance(),
          ...(tailnetProxy ? { tailnetProxy, connectionTimeoutMs: 8_000 } : { connectionTimeoutMs: 12_000 }),
        onTokenRotated: (token) => saveHost({ ...host, deviceToken: token }).then(() => undefined),
        onClose: (code) => {
          setStatus("unavailable");
          setConnection(undefined);
          live = undefined;
          // A revoked device (4403) stays disconnected; anything else is a lost link, retried while the browser is online.
          if (code !== 4403 && (typeof navigator === "undefined" || navigator.onLine !== false)) retry(hostRetryDelay(attempt));
        },
        onEvent: (event) => {
          const payload = event.payload ?? {};
          if (event.event === "jagentchill.approval.requested") setApprovals((list) => [...list.filter((a) => a.approvalId !== payload.approvalId), payload]);
          if (event.event === "jagentchill.approval.resolved") setApprovals((list) => list.filter((a) => a.approvalId !== payload.approvalId));
          if (event.event === "jagentchill.pairing.requested") setPairingRequests((list) => [...list.filter((r) => r.requestId !== payload.request.requestId), { ...payload.request, code: payload.code }]);
          if (event.event === "jagentchill.session.updated" && payload.session && payload.session.origin !== "workflow" && payload.session.origin !== "automation") setSessions((list) => (list.some((s) => s.sessionKey === payload.session.sessionKey) ? list.map((s) => (s.sessionKey === payload.session.sessionKey ? payload.session : s)) : [payload.session, ...list]));
          if (event.event === "jagentchill.session.deleted") setSessions((list) => list.filter((s) => s.sessionKey !== payload.sessionKey));
          if (event.event === "jagentchill.pairing.completed") setPairingRequests((list) => list.filter((r) => r.requestId !== payload.request.requestId));
          for (const listener of listeners.current) listener(event);
        },
        });
      }
      live = await connectHostWithFallback(options);
      if (cancelled) return live.close();
      setConnection(live);
      setStatus("connected");
      setSessions((await live.call<{ sessions: Session[] }>("jagentchill.session.list")).sessions);
      setSessionsFrom(host.gatewayId);
      // Changes of session records made on any device arrive on the `sessions` stream.
      void live.call("jagentchill.session.subscribe").catch(() => undefined);
      if (live.ready.scopes.includes("jagentchill.host.exec")) setApprovals((await live.call<{ approvals: Approval[] }>("jagentchill.approval.list")).approvals);
      if (live.ready.scopes.includes("jagentchill.devices.manage")) {
        setPairingRequests((await live.call<{ requests: PairingRequest[] }>("jagentchill.pairing.request.list")).requests);
      }
    })().catch((err) => {
      if (cancelled) return;
      // Keep the first failure for diagnostics. Replacing an Error object on every retry would
      // publish a new HostContext value and reconcile the entire shell for each failed attempt.
      if (attempt === 0) setError(err);
      setStatus("unavailable");
      if ((err as { code?: string } | null)?.code !== "DEVICE_REVOKED") retry(hostRetryDelay(attempt));
    });
    return () => {
      cancelled = true;
      clearTimeout(again);
      foreground.remove();
      if (typeof window !== "undefined" && window.removeEventListener) { window.removeEventListener("online", online); window.removeEventListener("offline", offline); }
      live?.close();
    };
  }, [host?.gatewayId, attempt, desktopHostPolicy]); // eslint-disable-line react-hooks/exhaustive-deps

  const secrets = useMemo<HostSecrets | undefined>(() => (host && connection ? {
    put: async (name, secret) => putHostSecret(host, await loadSigner(), name, secret),
    remove: async (name) => deleteHostSecret(host, await loadSigner(), name),
    list: async () => listHostSecrets(host, await loadSigner()),
  } : undefined), [host, connection]);
  const onEvent = useCallback<HostState["onEvent"]>((listener) => {
    listeners.current.add(listener);
    return () => void listeners.current.delete(listener);
  }, []);
  // On the desktop, while this computer's own host is being started (the app just opened, or Tailscale/Local was just
  // chosen) the app is neither "local only" nor "unavailable": it is connecting, and every surface must say so.
  const builtInComingUp = !!desktop() && !localOnly && (!desktopHostPolicy.loaded || !hostsLoaded || (desktopHostPolicy.mode !== null && desktopHostPolicy.starting));
  // With "This device only" chosen (or no host at all) nothing is being reached: the state is "local", whatever a
  // connection that was just closed reported on its way out.
  const shownStatus: HostState["status"] = builtInComingUp && status !== "connected" && status !== "connecting" ? "connecting" : !host ? "local" : status;
  const value = useMemo<HostState>(() => ({
    hosts, host, connection, status: shownStatus, error, sessions, sessionsLoaded: !!host && sessionsFrom === host.gatewayId, approvals, pairingRequests,
    onEvent,
    refreshHosts, refreshSessions,
    addSession: (session) => setSessions((list) => [session, ...list.filter((s) => s.sessionKey !== session.sessionKey)]),
    removeSession: (sessionKey) => setSessions((list) => list.filter((s) => s.sessionKey !== sessionKey)),
    role: connection?.ready.role ?? null, secrets,
    dismissPairingRequest: (requestId) => setPairingRequests((list) => list.filter((r) => r.requestId !== requestId)),
    can: (scope) => connection?.ready.scopes.includes(scope as never) ?? false,
    localOnly, selectHost: setLastHost, hostsLoaded,
  }), [hosts, host, connection, status, error, sessions, sessionsFrom, approvals, pairingRequests, onEvent, refreshHosts, refreshSessions, localOnly, setLastHost, hostsLoaded, secrets, shownStatus]);

  return <HostContext.Provider value={value}>{props.children}</HostContext.Provider>;
}

export function useHost(): HostState {
  const value = useContext(HostContext);
  if (!value) throw new Error("useHost needs a HostProvider");
  return value;
}

export function sessionTitle(session: Pick<Session, "title" | "created_ms">): string {
  return session.title ?? `Session ${formatTimeOfDay(session.created_ms)}`;
}

/** `3f9a1c77d2e048b1…` → `3f9a 1c77 d2e0 48b1`. */
export function fingerprint(hex: string): string {
  return hex.slice(0, 16).replace(/(.{4})(?=.)/g, "$1 ");
}
