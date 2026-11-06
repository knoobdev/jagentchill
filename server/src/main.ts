import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { encodeOfferUrl } from "@jagentchill/protocol";
import { createServerApp } from "./app.ts";
import { BOOTSTRAP_KEY_ENV, BOOTSTRAP_PROTECTION_ENV, bootstrapFirstDevice } from "./devices/bootstrap.ts";
import { parseCommandLine, runAddAdmin } from "./cli.ts";
import { registerAgentTools } from "./tools/mcp.ts";
import { createMcpEndpoint } from "./tools/mcp-endpoint.ts";
import { createTailnetListener } from "./tailnet/listener.ts";
import { RenderHostManager } from "./render-host/manager.ts";
import { createRenderHostRemoteExportRenderer } from "./export/render-host-adapter.ts";

const repoRoot = resolve(import.meta.dirname, "../..");
// `jagentchill serve --data-dir <dir> --port <port>`; the environment gives the defaults of a development run.
const command = parseCommandLine(process.argv.slice(2));
const dataDir = resolve(command.dataDir ?? process.env.JAGENTCHILL_DATA_DIR ?? join(repoRoot, ".dev/server-data"));
if (command.name === "devices add-admin") process.exit(await runAddAdmin(dataDir, command));
const serverPort = command.port ?? Number(process.env.JAGENTCHILL_PORT ?? 18910);
// The bootstrap key is for this process alone: no child (no agent CLI) inherits it.
const bootstrapKey = process.env[BOOTSTRAP_KEY_ENV], bootstrapProtection = process.env[BOOTSTRAP_PROTECTION_ENV];
delete process.env[BOOTSTRAP_KEY_ENV];
delete process.env[BOOTSTRAP_PROTECTION_ENV];
const started_ms = Date.now();

/** A secret kept in the server's data directory, created on first start. */
function secret(name: string): string {
  const file = join(dataDir, "secrets", name);
  if (existsSync(file)) return readFileSync(file, "utf8");
  const value = randomBytes(32).toString("base64url");
  mkdirSync(join(dataDir, "secrets"), { recursive: true });
  writeFileSync(file, value, { mode: 0o600 });
  return value;
}

const localAdminToken = secret("local-admin");
const toolSecret = secret("tool-endpoint");

// The agent-tool endpoint: every runtime session the server opens is given its address with the session named in the
// URL, and this bearer (`agents/sessions.ts`, `RuntimeOpenOptions.mcpUrl`).
const mcp = createMcpEndpoint({
  secret: toolSecret,
  register(server, directSessionKey) {
    registerAgentTools(server, {
      tools: () => app.tools,
      session: (sessionKey) => app.relay.session(sessionKey),
      assertBudget: (sessionKey) => { app.usage.assertBudget(sessionKey); app.team.assertBudget(sessionKey); app.contextWindow.assertTokens(sessionKey); },
      log: (text) => console.log(`[agent-tools] ${text}`),
      ...(directSessionKey ? { directSessionKey } : {}),
    });
  },
});

let app!: ReturnType<typeof createServerApp>;
const renderHost = new RenderHostManager({ path: process.env.JAGENTCHILL_RENDER_HOST_PATH, userDataDir: join(dataDir, "render-host", "profile") });
const remoteExportRenderer = createRenderHostRemoteExportRenderer({ renderHost, blobs: () => app.sync.blobs });
let boundListenAddress = "127.0.0.1";
const tailnet = createTailnetListener({
  port: serverPort,
  stateDir: join(dataDir, "tailscale"),
  bridgeBinary: process.env.JAGENTCHILL_TSNET_BRIDGE_BIN ?? join(repoRoot, ".dev/build/jagentchill-tsnet-bridge"),
  handleHttp: (request, response) => app.handleTailnetHttp(request, response),
  attachSocket: (socket, transport) => app.channel.attachExternalSocket(socket, transport),
});
app = createServerApp({
  dataDir,
  renderHost,
  remoteExportRenderer,
  tailnet,
  directListenPort: serverPort,
  rebindDirectListener: async (address) => {
    const server = app.http;
    const listenAt = (host: string) => new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => { server.off("listening", onListening); reject(error); };
      const onListening = () => { server.off("error", onError); resolve(); };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(serverPort, host);
    });
    const previouslyBound = boundListenAddress;
    if (server.listening) {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
    try { await listenAt(address); boundListenAddress = address; }
    catch (error) {
      try { await listenAt(previouslyBound); } catch { /* the caller receives the original bind error */ }
      throw error;
    }
  },
  health: () => ({ agentsReady: true }),
  // The desktop app's renderer has exactly this origin; a development web server is named by the operator.
  allowedOrigins: ["app://jagentchill", ...(process.env.JAGENTCHILL_DEV_ALLOWED_ORIGINS ?? "").split(",").filter(Boolean)],
  localAdminToken,
  // Test runs point the generation adapter at a local test double; the product never sets this.
  // (The wait between two asks about a video task can be shortened only together with a provider address of one's own — a test double: against the real provider it is the documented 30 s.)
  // Test only: the address of a local double of the music catalogue.
  music: { warmAddresses: true, ...(process.env.JAGENTCHILL_MUSIC_OPENVERSE_URL ? { openverseBaseUrl: process.env.JAGENTCHILL_MUSIC_OPENVERSE_URL } : {}) },
  // Test only (browser e2e): a manifest of small files served by a local test server instead of the real model files.
  ...(process.env.JAGENTCHILL_LOCAL_MODELS_MANIFEST ? { localModels: { manifest: JSON.parse(readFileSync(process.env.JAGENTCHILL_LOCAL_MODELS_MANIFEST, "utf8")) } } : {}),
  ...(process.env.JAGENTCHILL_GENERATION_OPENROUTER_URL ? { generation: { openRouterBaseUrl: process.env.JAGENTCHILL_GENERATION_OPENROUTER_URL, ...(Number(process.env.JAGENTCHILL_GENERATION_VIDEO_POLL_MS) > 0 ? { videoPollMs: Number(process.env.JAGENTCHILL_GENERATION_VIDEO_POLL_MS) } : {}) } } : {}),
  hostStatus: () => ({
    // The agent runtimes are the server's own children now: they are ready whenever the server is.
    gateway: { state: "ready", restartCount: 0 },
    serverVersion: process.env.JAGENTCHILL_VERSION ?? "0.1.0", started_ms, port: serverPort,
  }),
  // "Restart agents": every turn is stopped and every agent CLI the server started is closed; the next turn starts them again.
  restartService: async () => { await app.restartAgents(); },
  prepareShutdown: async () => {
    // The desktop app asks before it stops the server: the running turns are stopped and the agent CLIs closed first.
    try { await stopAgents(); return { safe: true, running: [] }; } catch { return { safe: false, running: [] }; }
  },
  agentTools: { url: (sessionKey) => `http://127.0.0.1:${serverPort}/agent-tools/mcp?session=${encodeURIComponent(sessionKey)}`, token: toolSecret },
  extraRoutes(req, res, path) {
    if (path !== "/agent-tools/mcp") return false;
    // The agent-tool endpoint is for the agent CLIs on this machine only; it is never served to another address.
    const address = req.socket.remoteAddress ?? "";
    if (address !== "127.0.0.1" && address !== "::1" && address !== "::ffff:127.0.0.1") {
      res.writeHead(404).end();
      return true;
    }
    mcp(req, res).catch((err) => {
      console.error(`[agent-tools] ${err}`);
      if (!res.headersSent) res.writeHead(500).end();
    });
    return true;
  },
});
void renderHost.probe().catch((error) => console.error("[server] render host probe failed: " + (error instanceof Error ? error.message : String(error))));
const http = app.http;

bootstrapFirstDevice({
  devices: app.devices, dataDir, publicKey: bootstrapKey, keyProtection: bootstrapProtection,
  log: (level, event, details) => console[level === "warn" ? "warn" : "log"](`[bootstrap] ${level} ${event} ${JSON.stringify(details)}`),
});
const initialListenAddress = app.directConnection.listenAddress();
boundListenAddress = initialListenAddress;
http.listen(serverPort, initialListenAddress, () => {
  void tailnet.resume();
  console.log(`[server] listening on ${initialListenAddress}:${serverPort} (host ${app.host.gatewayId})`);
  // Where the host CLI on this machine finds the running server.
  mkdirSync(join(dataDir, "run"), { recursive: true, mode: 0o700 });
  writeFileSync(join(dataDir, "run", "server.json"), JSON.stringify({ pid: process.pid, port: serverPort }), { mode: 0o600 });
  // Headless bootstrap: with no admin device yet, this terminal is the trusted display for the offer and the code.
  if (!app.devices.hasAdmin()) {
    const offer = app.pairing.createOffer([{ kind: "loopback", url: `ws://127.0.0.1:${serverPort}/jagentchill/v1/ws` }], { firstDeviceIsAdmin: true });
    console.log(`[pairing] no admin device yet. Pair the first device with this offer (valid 10 minutes):\n  ${encodeOfferUrl(offer)}`);
    app.pairing.listen({
      requested: (request, code) => console.log(`[pairing] "${request.deviceName}" (${request.platform}, ${request.deviceId.slice(0, 8)}) over ${request.transport} — code ${code}`),
      completed: (request) => console.log(`[pairing] "${request.deviceName}" paired as ${request.role}`),
    });
  }
});

// Declared before anything that can call back while this module is still being evaluated.
let shuttingDown = false;
const SHUTDOWN_LIMIT_MS = 20_000, ABORT_TURNS_LIMIT_MS = 2_000;
/**
 * Stops every turn that is running and closes every agent CLI the server started: a runtime ends its run itself
 * instead of being killed in the middle of its work. Bounded, so a runtime that does not answer cannot keep the server
 * from stopping; safe to call more than once.
 */
const stopAgents = async (): Promise<void> => {
  await app.relay.stopAll(ABORT_TURNS_LIMIT_MS);
  await app.relay.close();
};
async function shutdown(code = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.stopAcceptingWork();
  // A last resort only: the normal path waits for the agent CLIs to be gone before this process exits.
  setTimeout(() => { console.error("[server] shutdown did not finish in time; exiting"); process.exit(code || 1); }, SHUTDOWN_LIMIT_MS).unref();
  // The running turns are stopped first and the agent CLIs closed; only then does the server exit.
  let stopped = false;
  try { await stopAgents(); stopped = true; } catch (err) { console.error(`[server] stopping the agents failed: ${err instanceof Error ? err.message : err}`); }
  try { await tailnet.stop(); } catch (err) { console.error(`[server] stopping the Tailscale bridge failed: ${err instanceof Error ? err.message : err}`); stopped = false; }
  try { await renderHost.stop(); } catch (err) { console.error(`[server] stopping the render host failed: ${err instanceof Error ? err.message : err}`); stopped = false; }
  rmSync(join(dataDir, "run", "server.json"), { force: true });
  try {
    await app.close();
  } catch (err) {
    console.error(`[server] close failed: ${err instanceof Error ? err.message : err}`);
  }
  process.exit(stopped ? code : 1);
}
// A fault nobody handled ends the server, and the agent CLIs with it, instead of leaving them behind.
for (const event of ["uncaughtException", "unhandledRejection"] as const) {
  process.on(event, (err) => {
    console.error(`[server] ${event}: ${err instanceof Error ? err.stack : err}`);
    void shutdown(1);
  });
}
// A second signal while stopping ends it at once.
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { if (shuttingDown) process.exit(1); void shutdown(); });
// A server started by the desktop app never outlives it: the app names its pid, and the server leaves when that process is gone.
const parentPid = Number(process.env.JAGENTCHILL_PARENT_PID);
if (Number.isInteger(parentPid) && parentPid > 1) {
  const gone = (): boolean => { try { process.kill(parentPid, 0); return false; } catch (error) { return (error as NodeJS.ErrnoException).code === "ESRCH"; } };
  setInterval(() => { if (!shuttingDown && (gone() || process.ppid === 1)) { console.log("[server] the app that started this server is gone; stopping"); void shutdown(); } }, 1000).unref();
}
