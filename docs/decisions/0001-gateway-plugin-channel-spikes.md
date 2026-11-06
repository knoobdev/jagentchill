# 0001 — Gateway plugin channel spikes (S2, S3, S5)

Date: 2026-10-05. Environment: macOS arm64, Node 24.17.0, pnpm 12.5.1, OpenClaw v2026.9.8 (`fc23bc864e`) built
unmodified in `gateway/openclaw/` (`pnpm build`, 14 min 6 s, exit 0). Gateway run with an isolated state directory
(`.dev/gateway-state`), `OPENCLAW_SKIP_CHANNELS=1`, port 18799. All results below are from real runs, not from reading
source. No model provider was configured, so `models.list` returned an empty list.

| Spike | Question | Result |
|---|---|---|
| S5 | Does the gateway load the JAgentChill plugin from OUTSIDE its tree (`plugins.load.paths`)? | **Pass** — log: `http server listening (2 plugins: jagentchill, memory-core)`. |
| S3 | Does a plugin route with `auth: "plugin"` serve HTTP and accept a WebSocket upgrade without Gateway auth? | **Pass** — `GET /jagentchill/v1/health` → 200; `ws://…/jagentchill/v1/ws` connected, hello + echo received. |
| S5 | Can an externally loaded plugin call the core in process (`api.runtime.gateway.request`)? | **Fail** — `Gateway requests are only available to bundled or trusted official plugins. Plugin "jagentchill" is neither.` (from the HTTP handler, a WebSocket message handler and a timer alike). |
| S5 fallback | Same plugin compiled to `gateway/openclaw/dist/extensions/jagentchill/` (the built gateway's bundled-plugin directory; build output, source tree unchanged: `git status` shows 0 changed files). | **Pass** — loaded as bundled. |
| S2 | In-process core call from the plugin's HTTP handler, from a WebSocket message handler, and from a `setTimeout` callback (review R2-C1-07 doubted the last two). | **Pass** in all three contexts — `{"ok":true,"detail":"available=true models=0"}`. |

## Decision
- JAgentChill plugin source lives in `plugins/jagentchill-gateway/`. `scripts/gateway-plugin-build.sh` compiles it and
  stages it into the built gateway's `dist/extensions/jagentchill/`. The packaged desktop/headless distribution ships the
  gateway with the plugin staged this way. The OpenClaw source tree is never edited.
- The single client channel of design D7 (plugin-owned HTTP + WebSocket, plugin relays to the core in process) is
  feasible on OpenClaw v2026.9.8.
- `OPENCLAW_BUNDLED_PLUGINS_DIR` is not usable for this: outside test mode an override is trusted only inside the
  package's own bundled roots (`src/plugins/bundled-dir.ts`).

## Not covered by this run
Scopes above `operator.read`; relaying agent session events and approvals (S21); behaviour on Windows and Linux hosts;
the `ws` dependency is resolved from the gateway's own `node_modules` (kept external in the bundle).
