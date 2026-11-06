import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { accessSync, constants, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import type { AddressKind, TailnetStatus } from "@jagentchill/protocol";

export type { TailnetStatus } from "@jagentchill/protocol";

export type TailnetListener = {
  status(): TailnetStatus;
  proxyCredentials(): { port: number; secret: string } | null;
  subscribe(listener: (status: TailnetStatus) => void): () => void;
  startInteractiveLogin(): Promise<TailnetStatus>;
  joinWithAuthKey(authKey: string): Promise<TailnetStatus>;
  setEnabled(enabled: boolean): Promise<TailnetStatus>;
  restart(): Promise<TailnetStatus>;
  resume(): Promise<TailnetStatus>;
  stop(): Promise<void>;
};

export type TailnetListenerOptions = {
  /** Port clients use on the tailnet; the owner server's HTTP port is the public endpoint. */
  port: number;
  stateDir: string;
  bridgeBinary?: string;
  /** Extra CLI args for an executable test fixture. Production uses the tsnet port arguments below. */
  bridgeArgs?: string[];
  /** Tests may provide a script that emits bridge protocol lines; no real tsnet state is read. */
  fakeBridgeEnv?: Record<string, string>;
  acceptOrigin?: (request: IncomingMessage) => boolean;
  /** The normal HTTP route handler; requests accepted here are forced to the `tailnet` transport. */
  handleHttp?: (request: IncomingMessage, response: ServerResponse) => void;
  attachSocket: (socket: WebSocket, transport: AddressKind) => void;
};

const SERVER_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DEFAULT_BRIDGE = path.join(SERVER_ROOT, "go/tsnet-bridge/tailnet-bridge");
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

function bridgePath(explicit?: string): { path?: string; reason?: string } {
  const candidate = explicit ?? process.env.JAGENTCHILL_TSNET_BRIDGE_BIN ?? DEFAULT_BRIDGE;
  if (!existsSync(candidate)) return { reason: "Embedded Tailscale bridge is missing. Reinstall JAgentChill to restore it." };
  try { accessSync(candidate, process.platform === "win32" ? constants.F_OK : constants.X_OK); }
  catch { return { reason: "Embedded Tailscale bridge is not executable. Reinstall JAgentChill to restore it." }; }
  return { path: candidate };
}

/** Embedded tsnet lifecycle plus a private, authenticated loopback HTTP/WebSocket ingress tagged as `tailnet`. */
export function createTailnetListener(options: TailnetListenerOptions): TailnetListener {
  const enabledFile = path.join(options.stateDir, "jagentchill-enabled");
  let enabled = existsSync(enabledFile) && readFileSync(enabledFile, "utf8") === "1";
  let connectedHost: string | null = null;
  let loginUrl: string | null = null;
  let unavailableReason: string | null = null;
  let child: ChildProcess | null = null;
  let ingress: HttpServer | null = null;
  let ingressWss: WebSocketServer | null = null;
  let ingressPort: number | null = null;
  let proxyPort: number | null = null;
  let proxySecret = "";
  let bridgeProxySecret = "";
  let generation = 0;
  let stopPromise: Promise<void> | null = null;
  let ingressToken = "";
  const trustedIngressSockets = new WeakSet<object>();
  const listeners = new Set<(status: TailnetStatus) => void>();

  const snapshot = (): TailnetStatus => ({
    connected: connectedHost !== null,
    host: connectedHost,
    loginUrl,
    port: connectedHost ? options.port : null,
    proxyPort: connectedHost ? proxyPort : null,
    enabled,
    updatedAt: Date.now(),
    unavailableReason,
  });
  const publish = () => {
    const status = snapshot();
    for (const listener of listeners) listener(status);
    return status;
  };

  async function createIngress(): Promise<number> {
    if (ingressPort !== null) return ingressPort;
    ingressToken = randomBytes(32).toString("base64url");
    ingressWss = new WebSocketServer({ noServer: true, maxPayload: 1_048_576 });
    ingress = createServer((request, response) => {
      if (!hasIngressToken(request)) { response.writeHead(403, { connection: "close" }).end(); return; }
      delete request.headers["x-jagentchill-tailnet-ingress"];
      options.handleHttp?.(request, response);
      if (!options.handleHttp && !response.headersSent) response.writeHead(404).end();
    });
    ingress.on("upgrade", (request, socket, head) => {
      const address = request.socket.remoteAddress ?? "";
      if (!hasIngressToken(request) || !LOOPBACK.has(address) || new URL(request.url ?? "/", "http://localhost").pathname !== "/jagentchill/v1/ws" || options.acceptOrigin?.(request) === false) {
        socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        return;
      }
      delete request.headers["x-jagentchill-tailnet-ingress"];
      ingressWss!.handleUpgrade(request, socket, head, (ws) => options.attachSocket(ws, "tailnet"));
    });
    await new Promise<void>((resolve, reject) => {
      ingress!.once("error", reject);
      ingress!.listen(0, "127.0.0.1", () => {
        ingress!.off("error", reject);
        ingressPort = (ingress!.address() as AddressInfo).port;
        resolve();
      });
    });
    return ingressPort!;
  }

  function hasIngressToken(request: IncomingMessage): boolean {
    if (trustedIngressSockets.has(request.socket)) return true;
    const supplied = request.headers["x-jagentchill-tailnet-ingress"];
    if (typeof supplied !== "string" || !ingressToken) return false;
    const left = Buffer.from(supplied), right = Buffer.from(ingressToken);
    if (left.length !== right.length || !timingSafeEqual(left, right)) return false;
    trustedIngressSockets.add(request.socket);
    return true;
  }

  function rememberEnabled(value: boolean): void {
    mkdirSync(path.dirname(enabledFile), { recursive: true, mode: 0o700 });
    const temp = `${enabledFile}.tmp`;
    writeFileSync(temp, value ? "1" : "0", { mode: 0o600 });
    renameSync(temp, enabledFile);
  }

  function handleOutput(proc: ChildProcess, ownGeneration: number): void {
    let stdout = "";
    const consume = (line: string) => {
      const value = line.trim();
      if (!value || ownGeneration !== generation) return;
      if (value.startsWith("TSNET_READY ")) {
        const [host, rawProxyPort] = value.slice("TSNET_READY ".length).trim().split(/\s+/, 2);
        connectedHost = host || null;
        const parsedProxyPort = Number(rawProxyPort);
        proxyPort = Number.isInteger(parsedProxyPort) && parsedProxyPort > 0 && parsedProxyPort <= 65535 ? parsedProxyPort : null;
        proxySecret = connectedHost && proxyPort ? bridgeProxySecret : "";
        loginUrl = null;
        publish();
      } else if (value.startsWith("TSNET_LOGIN_URL ")) {
        connectedHost = null;
        proxyPort = null;
        proxySecret = "";
        const candidate = value.slice("TSNET_LOGIN_URL ".length).trim();
        try { loginUrl = new URL(candidate).origin === "https://login.tailscale.com" ? candidate : null; }
        catch { loginUrl = null; }
        publish();
      } else if (value.startsWith("TSNET_ERROR ")) {
        connectedHost = null;
        proxyPort = null;
        proxySecret = "";
        bridgeProxySecret = "";
        loginUrl = null;
        unavailableReason = value.slice("TSNET_ERROR ".length).trim() || "Tailscale could not start.";
        publish();
      }
      // Bridge output is intentionally not forwarded: login URLs are bearer-like secrets.
    };
    proc.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      const lines = stdout.split("\n");
      stdout = lines.pop() ?? "";
      lines.forEach(consume);
    });
    proc.stderr?.resume();
    proc.on("error", () => {
      if (ownGeneration !== generation) return;
      child = null;
      connectedHost = null;
      proxyPort = null;
      proxySecret = "";
      bridgeProxySecret = "";
      loginUrl = null;
      unavailableReason = "Embedded Tailscale bridge could not be started. Reinstall JAgentChill to restore it.";
      publish();
    });
    proc.on("exit", () => {
      if (ownGeneration !== generation) return;
      child = null;
      connectedHost = null;
      proxyPort = null;
      proxySecret = "";
      bridgeProxySecret = "";
      loginUrl = null;
      if (proc.exitCode !== 0 && proc.exitCode !== null) unavailableReason = "Embedded Tailscale bridge stopped unexpectedly.";
      publish();
    });
  }

  async function launch(authKey?: string): Promise<TailnetStatus> {
    enabled = true;
    connectedHost = null;
    loginUrl = null;
    unavailableReason = null;
    proxyPort = null;
    bridgeProxySecret = randomBytes(32).toString("base64url");
    proxySecret = bridgeProxySecret;
    const bridge = bridgePath(options.bridgeBinary);
    if (!bridge.path) {
      unavailableReason = bridge.reason ?? "Embedded Tailscale bridge is unavailable.";
      return publish();
    }
    const ownGeneration = ++generation;
    publish();
    const localPort = await createIngress();
    const args = options.bridgeArgs ?? ["--tailnet-port", String(options.port), "--local-port", String(localPort), "--state-dir", options.stateDir];
    const env: NodeJS.ProcessEnv = { ...process.env, ...options.fakeBridgeEnv, TS_STATE_DIR: options.stateDir, TS_LOG: "off", JAGENTCHILL_TAILNET_LOCAL_PORT: String(localPort), JAGENTCHILL_TAILNET_INGRESS_TOKEN: ingressToken, JAGENTCHILL_TAILNET_PROXY_SECRET: bridgeProxySecret };
    if (authKey) env.TS_AUTHKEY = authKey;
    else delete env.TS_AUTHKEY;
    const proc = nodeSpawn(bridge.path, args, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child = proc;
    handleOutput(proc, ownGeneration);
    return snapshot();
  }

  async function stopChild(): Promise<void> {
    ++generation;
    const proc = child;
    child = null;
    connectedHost = null;
    proxyPort = null;
    proxySecret = "";
    bridgeProxySecret = "";
    loginUrl = null;
    if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { proc.kill("SIGKILL"); resolve(); }, 1_500);
      proc.once("exit", () => { clearTimeout(timer); resolve(); });
      proc.kill("SIGTERM");
    });
  }

  async function closeIngress(): Promise<void> {
    const wss = ingressWss;
    const server = ingress;
    ingressWss = null;
    ingress = null;
    ingressPort = null;
    ingressToken = "";
    if (wss) await new Promise<void>((resolve) => wss.close(() => resolve()));
    if (server?.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  async function restart(): Promise<TailnetStatus> {
    if (stopPromise) await stopPromise;
    await stopChild();
    await closeIngress();
    return enabled ? launch() : publish();
  }

  return {
    status: snapshot,
    proxyCredentials() { return connectedHost && proxyPort && proxySecret ? { port: proxyPort, secret: proxySecret } : null; },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async startInteractiveLogin() {
      enabled = true;
      rememberEnabled(true);
      if (child) await restart();
      else await launch();
      return snapshot();
    },
    async joinWithAuthKey(authKey) {
      if (!authKey.trim()) throw new Error("A Tailscale auth key is required.");
      enabled = true;
      rememberEnabled(true);
      if (child) { await stopChild(); await closeIngress(); }
      return launch(authKey.trim());
    },
    async setEnabled(value) {
      enabled = value;
      rememberEnabled(value);
      if (!value) {
        await stopChild();
        await closeIngress();
        return publish();
      }
      if (!child) return launch();
      return snapshot();
    },
    restart,
    async resume() {
      if (!enabled || child) return snapshot();
      return launch();
    },
    async stop() {
      if (stopPromise) return stopPromise;
      stopPromise = (async () => {
        await stopChild();
        await closeIngress();
        publish();
      })();
      try { await stopPromise; } finally { stopPromise = null; }
    },
  };
}
