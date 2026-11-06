# OpenClaw — code-grounded reference for JAgentChill

**Source of truth for this note:** the fresh clone at
`/Users/ngocchanh/Project/private/organisations/hdc/jagentchill/.refs/openclaw`
— upstream github.com/openclaw/openclaw, **HEAD `0816aa1b57dc815d0c1e0d48bcb9517980985438`
(2026-10-04), `package.json` version `2026.9.8`**.

The older checkout at `/Users/ngocchanh/Project/private/organisations/hdc/openclaw` (July
snapshot `7c72fef2`, version 2026.7.2) was **not** used: every path and claim below was read or
re-verified in the fresh clone. Several facts changed between the two (Node floor, pnpm major,
`agents.list` -> `agents.entries`, published client packages, a new embedding guide, new `crates/`
and `apps/linux`), so do not carry conclusions over from the old copy.

Paths are relative to the fresh clone. Anything not confirmed in its code/docs is marked
**UNVERIFIED**. Nothing was built or run; all findings are from reading source and docs.

## 1. Single most important fact

OpenClaw is a **long-lived Gateway daemon** (Node, MIT) and the supported way for another product
to use it is as a **separate process spoken to over its WebSocket protocol**, extended **in-process
through plugins** — not as an importable agent library. Its trust model is **one Gateway = one
trusted operator domain** (`docs/gateway/multi-tenant-hosting.md`: "OpenClaw's default security
model is one trusted operator boundary per Gateway, not hostile multi-tenant isolation inside one
shared Gateway"). That single sentence decides JAgentChill's topology: a Gateway per user/device
(local-first desktop app) is natural; a shared cloud Gateway serving many end users is not.

## 2. What OpenClaw is

- `package.json`: `"name": "openclaw"`, `"description": "Multi-channel AI gateway with extensible
  messaging integrations"`, `"license": "MIT"` (`LICENSE`: "Copyright (c) 2026 OpenClaw
  Foundation"), `"bin": {"openclaw": "openclaw.mjs"}`.
- `VISION.md`: a personal assistant that "runs on your devices, in your channels, with your
  rules"; "OpenClaw has an extensive plugin API. Core stays lean; optional capabilities should
  usually ship as plugins." and "If you build a plugin, host and maintain it in your own
  repository."
- It is a personal-assistant platform, not a video product. What it brings to JAgentChill: agent
  loop, sessions/transcripts, model/provider routing with failover, tool policy and approvals,
  skills, memory, scheduler, sub-agents, device pairing, native companion apps, and a bundled
  `video_generate` tool with 17 provider plugins (section 5).

## 3. Architecture

From `docs/concepts/architecture.md` and `docs/gateway/index.md`:

- "A single long-lived **Gateway** owns all messaging surfaces"; "Control-plane clients (macOS
  app, CLI, web UI, automations) connect to the Gateway over **WebSocket** on the configured bind
  host (default `127.0.0.1:18789`)."
- "**Nodes** (macOS/iOS/Android/headless) also connect over **WebSocket**, but declare
  `role: node` with explicit caps/commands."
- "Single multiplexed port for: WebSocket control/RPC; HTTP APIs (`/v1/models`, `/v1/embeddings`,
  `/v1/chat/completions`, `/v1/responses`, `/tools/invoke`); Plugin HTTP routes ...; Control UI
  and hooks."
- "Default bind mode: `loopback`." "Auth is required by default." (shared secret
  `gateway.auth.token` / `gateway.auth.password`, env `OPENCLAW_GATEWAY_TOKEN` /
  `OPENCLAW_GATEWAY_PASSWORD`; modes `none | token | password | trusted-proxy` per
  `docs/gateway/protocol/auth.md`).
- Hosted widget surface on the same port: `/__openclaw__/canvas/` and `/__openclaw__/a2ui/`.

| Concept | Where it lives / how it works | Doc or path |
|---|---|---|
| Gateway | daemon, `openclaw gateway --port 18789`; `src/gateway/` | `docs/gateway/index.md` |
| Agents | isolated personas: workspace, `agentDir`, SQLite session store; config `agents.entries.<id>` | `docs/concepts/multi-agent.md`, `docs/gateway/config-agents/entries-and-multi-agent.md` |
| Sessions | "All session state is owned by the **gateway**"; keys like `agent:<agentId>:<key>`; sub-agents `agent:<agentId>:subagent:<uuid>` | `docs/concepts/session.md`, `docs/tools/subagents.md` |
| Agent runtime / "harness" | the low-level loop executing one turn: built-in `openclaw`, plugin harnesses `codex`/`copilot`, CLI backends like `claude-cli` | `docs/concepts/agent-runtimes.md` |
| Channels | 27 bundled channel plugins (telegram, whatsapp, slack, discord, signal, imessage, line, zalo, msteams, ...) | `extensions/*/openclaw.plugin.json` |
| Tools | core + plugin tools; policy via `tools.profile/allow/deny`; exec approvals | `docs/tools/`, `docs/gateway/sandbox-vs-tool-policy-vs-elevated.md` |
| Skills | directory + `SKILL.md` (YAML frontmatter); 50 bundled under `skills/`; per-agent allowlist `agents.entries.*.skills` | `docs/tools/creating-skills.md`, `docs/tools/skills.md` |
| Plugins | code plugins (`openclaw.plugin.json` + entry) and bundle plugins; 163 bundled manifests in `extensions/` | `docs/plugins/`, `docs/tools/plugin.md` |
| Nodes / devices | companion devices exposing `camera.*`, `device.*`, `system.*`... via `node.invoke`; "Nodes are **peripherals**, not gateways" | `docs/nodes/index.md` |
| Pairing | Ed25519 device identity, signed `connect.challenge`, approval, per-device token | `docs/gateway/pairing.md`, `docs/gateway/clients.md` |
| Models / providers | `provider/model` refs; primary + fallbacks; 61 bundled provider plugins | `docs/concepts/models.md` |
| Memory | "plain Markdown files in your agent's workspace": `MEMORY.md`, `memory/YYYY-MM-DD.md`; pluggable memory slot | `docs/concepts/memory.md` |
| Scheduler (cron) | "Automations are OpenClaw's built-in scheduler. The scheduler persists jobs, wakes the agent at the right time" | `docs/automation/cron-jobs.md` |
| Pipelines | Lobster: "runs multi-step tool pipelines as one deterministic tool call" with approval checkpoints | `docs/tools/lobster.md` |
| Canvas / widgets | `show_widget` renders SVG/HTML inline for clients declaring `inline-widgets`; plugins can add presenters | `docs/tools/show-widget.md` |
| Multi-tenant | `openclaw fleet`: one hardened container "cell" per tenant; experimental | `docs/gateway/multi-tenant-hosting.md` |
| Team server | shared team Gateway behind Cloudflare Access with GitHub identities and roles | `docs/gateway/team-server.md` |
| Cloud sessions | run sessions on paired devices or throwaway cloud machines | `docs/gateway/cloud-sessions.md` |

Default state paths (`docs/concepts/multi-agent.md`): config `~/.openclaw/openclaw.json`
(`OPENCLAW_CONFIG_PATH`), state dir `~/.openclaw` (`OPENCLAW_STATE_DIR`), sessions and auth
profiles in `<agentDir>/openclaw-agent.sqlite` (default `~/.openclaw/agents/<agentId>/agent/`).

## 4. Gateway protocol (what an app talks)

`docs/gateway/protocol.md` and `docs/gateway/protocol/*.md`; schemas in
`packages/gateway-protocol/src/schema/`; `packages/gateway-protocol/src/version.ts`:
`PROTOCOL_VERSION = 4`, `MIN_CLIENT_PROTOCOL_VERSION = 4`.

Frames (`docs/concepts/architecture.md`): requests `{type:"req", id, method, params}` ->
`{type:"res", id, ok, payload|error}`; events `{type:"event", event, payload, seq?, stateVersion?}`.
"Idempotency keys are required for side-effecting methods (`send`, `agent`)". "Events are not
replayed; clients must refresh on gaps."

Handshake, verbatim from `docs/gateway/protocol/handshake.md` (trimmed):

```json
{ "type": "event", "event": "connect.challenge", "payload": { "nonce": "…", "ts": 1737264000000 } }
```
```json
{
  "type": "req", "id": "…", "method": "connect",
  "params": {
    "minProtocol": 4, "maxProtocol": 4,
    "client": { "id": "cli", "version": "1.2.3", "platform": "macos", "mode": "operator" },
    "role": "operator",
    "scopes": ["operator.read", "operator.write"],
    "caps": [], "commands": [], "permissions": {},
    "auth": { "token": "…" },
    "locale": "en-US", "userAgent": "openclaw-cli/1.2.3",
    "device": { "id": "device_fingerprint", "publicKey": "…", "signature": "…",
                "signedAt": 1737264000000, "nonce": "…" }
  }
}
```

Scopes (`docs/gateway/operator-scopes.md`): `operator.read`, `operator.write`, `operator.admin`,
`operator.pairing`, `operator.approvals`, `operator.questions` (plus `operator.talk.secrets`).

RPC families (index: `docs/gateway/protocol/rpc-methods.md`; names below confirmed present in the
fresh protocol docs): `agent`, `agent.wait`; `agents.list` / `agents.create`; `sessions.create`,
`sessions.send`, `sessions.steer`, `sessions.abort`, `sessions.list`, `sessions.patch`,
`sessions.subscribe`, `sessions.messages.subscribe`; `chat.send`, `chat.history`; `models.list`;
`artifacts.list` / `artifacts.download`; `config.get` / `config.patch`; `plugins.install`;
`device.pair.approve`, `device.pair.setupCode`, `device.token.rotate`; `node.list`, `node.invoke`,
`node.pluginTools.update`; `approval.resolve`, `exec.approval.resolve`; `cron.run`;
`tools.invoke`, `tools.effective`; `gateway.suspend.prepare`. Events include `agent`,
`session.message`, `session.tool`, `sessions.changed`. The discovery list in `hello-ok` "is not a
generated dump of every method".

`agent` request params, verbatim head of `AgentParamsSchema`
(`packages/gateway-protocol/src/schema/agent.ts`):

```ts
export const AgentParamsSchema = closedObject({
  message: NonEmptyString,
  agentId: Type.Optional(NonEmptyString),
  provider: Type.Optional(Type.String()),
  model: Type.Optional(Type.String()),
  to: Type.Optional(Type.String()),
  replyTo: Type.Optional(Type.String()),
  sessionId: Type.Optional(Type.String()),
  sessionKey: Type.Optional(Type.String()),
  ...
  thinking: Type.Optional(Type.String()),
  deliver: Type.Optional(Type.Boolean()),
  attachments: Type.Optional(Type.Array(Type.Unknown())),
  ...
  timeout: Type.Optional(Type.Integer({ minimum: 0 })),
  lane: Type.Optional(Type.String()),
  cwd: Type.Optional(NonEmptyString),
  ...
```
So a caller can pick agent, provider and model per run.

Client capabilities (`docs/gateway/clients.md`): registry includes `tool-events`,
`inline-widgets`, `approvals`, `session-scoped-events`, `ui-commands`, ... "`tool-events` gates
live tool-execution streaming ... Without it, the connection receives no live tool events and the
handshake does not report an error." A pipeline-status UI must advertise it.

HTTP alternatives on the same port:

- OpenAI-compatible `/v1/chat/completions`, `/v1/responses`, `/v1/models`, `/v1/embeddings` —
  "**disabled by default**"; the `model` field is "an **agent target**, not a raw provider model
  id"; "Treat this endpoint as **full operator access**" (`docs/gateway/openai-http-api.md`).
- `POST /tools/invoke` — "always enabled and uses Gateway auth plus tool policy"; also a "**full
  operator-access** surface" (`docs/gateway/tools-invoke-http-api.md`).
- `POST /api/v1/admin/rpc` via the bundled, default-off `admin-http-rpc` plugin
  (`docs/plugins/admin-http-rpc.md`).

## 5. Extending it: plugins, tools, skills, agents, models

### 5.1 Plugins (the product-code seam)

`docs/plugins/building-plugins.md` — requirements "Node 24.16+ or Node 26.1+", TypeScript ESM.
Minimal tool plugin, verbatim:

```json
// package.json
{
  "name": "@myorg/openclaw-my-plugin", "version": "1.0.0", "type": "module",
  "peerDependencies": { "openclaw": ">=2026.3.24-beta.2" },
  "openclaw": { "extensions": ["./index.ts"], "compat": { "pluginApi": ">=2026.3.24-beta.2", ... } }
}
```
```json
// openclaw.plugin.json
{
  "id": "my-plugin", "name": "My Plugin", "description": "Adds a custom tool to OpenClaw",
  "contracts": { "tools": ["my_tool"] },
  "activation": { "onStartup": true },
  "configSchema": { "type": "object", "additionalProperties": false }
}
```
```ts
import { Type } from "typebox";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

export default definePluginEntry({
  id: "my-plugin", name: "My Plugin", description: "Adds a custom tool to OpenClaw",
  register(api) {
    api.registerTool({
      name: "my_tool",
      description: "Echo one input value",
      parameters: Type.Object({ input: Type.String() }),
      async execute(_id, params) {
        return { content: [{ type: "text", text: `Got: ${params.input}` }] };
      },
    });
  },
});
```
"Every plugin needs a manifest ... Runtime tools must appear in `contracts.tools`".

Registration surface (collected from `docs/plugins/sdk-overview.md` + `docs/plugins/sdk-overview/*.md`):
`registerTool`, `registerCommand`, `registerProvider`, `registerModelCatalogProvider`,
`registerVideoGenerationProvider`, `registerImageGenerationProvider`,
`registerMusicGenerationProvider`, `registerSpeechProvider`, `registerMediaUnderstandingProvider`,
`registerChannel`, `registerHook`, `registerHttpRoute`, `registerGatewayMethod`, `registerService`,
`registerCli`, `registerNodeHostCommand`, `registerNodeInvokePolicy`, `registerAgentHarness`
(experimental), `registerCliBackend`, `registerContextEngine`, `registerMemoryCapability`,
`registerStorageProvider`, `registerWorkerProvider`, `registerWidgetPresenter`,
`registerBoardWidgetContentKind`, `registerSessionExtension`, `registerSessionAction`,
`registerControlUiDescriptor` ("Control UI contribution descriptors; the `tab`, `widget`, and
`link-reader` surfaces are rendered"), `registerAgentEventSubscription`, and more.

For JAgentChill the relevant ones are: `registerTool` (timeline/editing tools the agent calls),
`registerGatewayMethod` + `registerHttpRoute` (product RPC/HTTP on the Gateway port),
`registerService` (render workers), `registerVideoGenerationProvider` (extra video models),
`registerControlUiDescriptor` / `registerWidgetPresenter` (UI contributions),
`registerNodeHostCommand` (commands executed on a paired device).

Install/config (`docs/tools/plugin.md`): `openclaw plugins install clawhub:<package>`,
`npm:<package>`, `git:github.com/<owner>/<repo>@<ref>`, `./my-plugin`, `--link ./my-plugin`;
settings under `plugins.entries.<id>.config`; `plugins.allow` (exclusive allowlist),
`plugins.deny` ("wins over allow"), `plugins.entries.<id>.enabled: false`, `plugins.load.paths`,
`plugins.slots.<slot>` (`memory` or `contextEngine`). Rule from `AGENTS.md`: "Plugins use
documented `openclaw/plugin-sdk/*` contracts, manifest metadata, and public/local barrels, never
core internals".

### 5.2 Skills

`docs/tools/creating-skills.md`: "Each skill is a directory containing a `SKILL.md` file with YAML
frontmatter and markdown instructions." Workspace skills live under the agent workspace `skills/`
folder; `skills/` in the repo holds 50 bundled ones (e.g. `diagram-maker`, `visualize`,
`skill-creator`, `control-ui`). Archify's `archify/` folder has the same shape, so loading it as a
workspace skill should work — **UNVERIFIED**.

### 5.3 Agents and per-agent provider/model selection

`docs/gateway/config-agents/entries-and-multi-agent.md` (verbatim, trimmed) — note the key is now
an object map `agents.entries`, not the old `agents.list` array:

```json5
{
  agents: {
    entries: {
      main: {
        name: "Main Agent",
        workspace: "~/.openclaw/workspace",
        agentDir: "~/.openclaw/agents/main/agent",
        model: "anthropic/claude-opus-4-6", // or { primary, fallbacks }
        utilityModel: "openai/gpt-5.4-mini",
        thinkingDefault: "high",
        params: { cacheRetention: "none" },
        skills: ["docs-search"], // replaces agents.defaults.skills when set
        sandbox: { mode: "off" },
        subagents: { allowAgents: ["*"] },
        tools: { profile: "coding", allow: ["browser"], deny: ["canvas"], elevated: { enabled: true } },
      },
    },
  },
}
```
"The `agents.entries` object key is the stable agent id."

Selection order (`docs/concepts/models.md`): `agents.defaults.model.primary` ->
`agents.defaults.model.fallbacks` -> auth-profile rotation inside a provider; "Per-agent
`agents.entries.*.model` (plus bindings) overrides `agents.defaults.model`";
`agents.defaults.modelPolicy.allow` is the override allowlist. Per run, the `agent` RPC accepts
`provider`/`model`; per session, `sessions.patch`. Runtime (which loop executes) is set per
provider/model via `agentRuntime: { id: "codex" | "claude-cli" | "openclaw" }`
(`docs/gateway/config-agents/runtime-and-cli-backends.md`). So "director", "editor", "storyboard"
agents with different models are plain config.

### 5.4 Media generation already in the box

`docs/tools/video-generation.md`: "Generate videos via video_generate from text, image, or video
references across 18 provider backends". Bundled plugins declaring
`contracts.videoGenerationProviders` (17 manifests, all `enabledByDefault`): alibaba, byteplus,
comfy, deepinfra, fal, google, kie, minimax, novita, openrouter, pixverse, qwen, runway, together,
vydra, xai, zai. There are also 11 image-generation and 5 music-generation provider manifests.
(Doc says 18, manifest count is 17 — discrepancy not resolved, **UNVERIFIED**.)

## 6. Using it from another app: the three realistic options

### Option A — Gateway as supervised sidecar + protocol client (what upstream documents)

`docs/gateway/embedding.md`: "An embedding host should supervise the installed `openclaw`
executable, use the Gateway WebSocket protocol as its control plane, and treat the child process as
a replaceable runtime." Verbatim baseline:

```ts
const packageEntry = fileURLToPath(import.meta.resolve("openclaw"));
const openclawEntry = resolve(dirname(packageEntry), "..", "openclaw.mjs");
const gateway = spawn(hostNodeExecutable, [openclawEntry, "gateway", "--allow-unconfigured"], {
  env: {
    ...process.env,
    OPENCLAW_DISABLE_BONJOUR: "1",
    OPENCLAW_EXEC_SHELL_SNAPSHOT: "0",
    OPENCLAW_NO_RESPAWN: "1",
    OPENCLAW_SKIP_CHANNELS: "1",
  },
  stdio: ["ignore", "inherit", "inherit"],
});
```
Rules from the same page: exit code `78` = config failure -> run
`openclaw doctor --fix --yes --non-interactive`, retry once; readiness = `connect.challenge` then
`hello-ok` (not log scraping); `hostNodeExecutable` "must point to a real Node runtime rather than
Electron's `process.execPath`"; "Do not read or mutate files, SQLite tables, transcript files, or
cache directories under `~/.openclaw`"; "**Install; do not flatten** ... The root `openclaw`
package is not a single-file vendoring target."

Client side (`docs/gateway/clients.md`):
`npm install --save-exact @openclaw/gateway-client@2026.8.1 @openclaw/gateway-protocol@2026.8.1`
(the doc pins "the verified stable release"; the repo's packages are at `2026.9.8`). 
`@openclaw/gateway-client` root = Node client (bundles `ws`); `@openclaw/gateway-client/browser` =
"browser-safe protocol, device-auth, and reconnect helpers". These declare Node `>=22.19.0`.
A Rust client also exists: `crates/openclaw-gateway-client` (useful for a Tauri shell).

- Pros: the documented, versioned contract; product code stays out of OpenClaw's tree; upgrades =
  bump a dependency; product logic still goes in-process via a JAgentChill plugin.
- Cons: ships a Node >= 24.16 runtime plus the full `openclaw` package with the app; one Gateway
  per trust domain; mobile cannot host the Gateway (phones are clients/nodes of a Gateway running
  elsewhere); must pin and co-test client and Gateway versions.

### Option B — import OpenClaw as a library

Not a real option. The package root export (`"." -> ./dist/index.js`, `src/index.ts`,
`src/library.ts`) is a CLI entry plus a small "Public library facade for consumers embedding
OpenClaw reply runtime APIs" (`getReplyFromConfig`, `loadConfig`, session-store helpers...). There
is no exported "create agent / run turn" API; `@openclaw/sdk` (`packages/sdk`, classes `OpenClaw`,
`Agent`, `Run`, `Session`) is `"private": true`, version `0.0.0-private`, and is itself a Gateway
client. `openclaw/plugin-sdk/*` is for code loaded *by* the Gateway. The one standalone published
piece is `@openclaw/ai` (`packages/ai`, example `examples/ai-chat`): a provider-agnostic model
client — "No OpenClaw application code is involved" — i.e. LLM calls without the agent harness.

### Option C — fork/clone the monorepo and build the product inside it (the owner's stated direction)

See section 7. Pros: full control, can change core, reuse `ui/` and `apps/` wholesale. Cons: you
inherit a very large, fast-moving codebase (124 entries in `src/`, 163 bundled plugins, native
apps in Swift/Kotlin/Rust) with strict repo rules (`AGENTS.md`), and every divergence in core is a
permanent merge cost.

**Recommendation to carry into the spec:** take the repo as the skeleton (C) but behave as if it
were (A): keep all JAgentChill behaviour in new workspace packages (plugins, a UI app, client
shells) and treat `src/`, `packages/*` and bundled `extensions/*` as read-only upstream. That keeps
"pull latest OpenClaw" cheap and leaves the door open to later replace the fork with the published
`openclaw` package.

## 7. Using OpenClaw as the project skeleton

### 7.1 Workspace layout (fresh clone)

`pnpm-workspace.yaml` members: `.`, `ui`, `packages/*`, `extensions/*`, `examples/*`.
`apps/` and `crates/` are **outside** the pnpm workspace (native toolchains).

| Path | What it is | Toolchain |
|---|---|---|
| `src/` | Core: gateway, agents, sessions, cron, plugins loader, cli, config, memory, media-generation, node-host, pairing, security ... (124 entries) | TypeScript ESM, built with tsdown (`tsdown.config.ts`) |
| `openclaw.mjs`, `*-launcher.mjs`, `node-*.mjs` | CLI entry and Node-runtime bootstrap shims shipped in the npm package | Node |
| `packages/` | 25 internal libraries: `gateway-protocol`, `gateway-client`, `ai`, `agent-core`, `llm-core`, `plugin-sdk`, `sdk`, `media-core`, `media-generation-core`, `memory-host-sdk`, `worker-runtime`, `mermaid-renderer`, ... | TypeScript |
| `extensions/` | 163 bundled plugins: 27 channels, 61 model providers, media/speech/search providers, feature plugins (`canvas`, `workboard`, `lobster`, `device-pair`, `admin-http-rpc`, ...) | TypeScript, one workspace package each |
| `ui/` | Control UI: "a small **Vite + Lit** single-page app served by the Gateway" (`docs/web/control-ui.md`); `lit` 3.3.3, `vite` 8.3.1; pages for chat, sessions, agents, skills, plugins, cron, devices, dashboards, portals ... | Vite + Lit (not React) |
| `apps/macos` | Native menu-bar app (SwiftPM: `OpenClaw`, `OpenClawDiscovery`, `OpenClawIPC`, `OpenClawMacCLI`) | Swift |
| `apps/ios` | App Store iPhone/iPad app + Watch app, share extension, activity widget; connects "as a `role: node` for chat, voice, approvals, sharing, and device-aware automation" | Swift / Xcode (`project.yml`) |
| `apps/android` | Google Play app + Wear; "companion node for chat, voice, approvals, screen, and device-aware automation"; pairs "using a QR code, setup code, or manual connection" | Kotlin / Gradle |
| `apps/linux` | "a Tauri v2 desktop shell for local and remote OpenClaw Gateways" that "opens the selected Gateway's Control UI"; also builds on macOS as OpenClaw-Tauri | Rust + Tauri (`src-tauri/`) |
| `apps/shared` | `OpenClawKit` and other Swift packages shared by Apple apps | Swift |
| `apps/swabble`, `apps/macos-mlx-tts` | wake-word daemon; local MLX TTS helper | Swift |
| (Windows) | **Not in this repo**: Windows Hub lives at `github.com/openclaw/openclaw-windows-node` (`docs/platforms/windows.md`) | — |
| `crates/` | Cargo workspace: `openclaw-gateway-client`, `openclaw-node-host` (has `SIDECAR_PROTOCOL.md`) | Rust |
| `skills/` | 50 bundled `SKILL.md` skills | Markdown |
| `custodian-skills/` | operator skills (add-model-provider, configure-channel, diagnose-gateway, ...) | Markdown |
| `examples/ai-chat` | minimal `@openclaw/ai` consumer | Node |
| `docs/` | Mintlify-style docs (shipped in the npm package) | Markdown |
| `scripts/`, `test/`, `qa/`, `security/`, `deploy/`, `config/`, `patches/`, `git-hooks/` | build/test/release infrastructure | mixed |
| `Dockerfile`, `docker-compose.yml`, `fly.toml`, `render.yaml` | container and PaaS deployment | — |

### 7.2 What a product built on it must keep

- `src/` (all of it — it is one core, not separable modules), `openclaw.mjs` and the root
  `*.mjs` shims, `packages/*`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `patches/`, the
  `tsconfig*.json` / `tsdown*.ts` / `vitest.config.ts` build config, and `scripts/` (the `pnpm`
  scripts call into it: `"build": "node --import ./scripts/tsx.mjs scripts/build-all.mts"`).
- The plugins the product actually needs at runtime: at minimum the model providers it uses
  (e.g. `anthropic`, `openai`, `google`), the media providers (section 5.4), `canvas` (owns
  `show_widget`), `device-pair`, and the memory slot plugin. Which bundled plugins are hard
  requirements of core startup is **UNVERIFIED** — determine by building and running with a
  restrictive `plugins.allow`, not by deleting directories.
- `ui/` if the Control UI is used as an admin/debug surface (it is served by the Gateway).
- `LICENSE` and `THIRD_PARTY_NOTICES.md` (MIT notice retention).

### 7.3 What is optional / removable

- **Channels** (27 plugins: telegram, whatsapp, slack, discord, signal, imessage, line, matrix,
  msteams, zalo, ...): a video editor does not need them. Prefer **disabling over deleting**:
  `OPENCLAW_SKIP_CHANNELS=1` ("Skips channel startup and reload. Set it only when the embedding
  app wants a control-plane or WebChat-only Gateway", `docs/gateway/embedding.md`; the repo's own
  `gateway:dev` script sets it), plus `plugins.allow` / `plugins.deny` /
  `plugins.entries.<id>.enabled: false`. 85 of 163 manifests are `enabledByDefault`.
- Unused model/search/speech providers, meeting plugins, QA plugins (`qa-*`), migration plugins.
- `apps/*` native clients you will not ship, `apps/swabble`, `apps/macos-mlx-tts`, `deploy/`,
  `fly.toml`, `render.yaml`, `appcast*.xml`, most of `skills/`.
- Deleting directories is possible but each deletion becomes a conflict on every upstream pull and
  may break repo-wide contract tests (`pnpm test:contracts`, `CONTRIBUTING.md`). Whether the build
  passes with extensions removed is **UNVERIFIED**.

### 7.4 Where JAgentChill code goes

| Product concern | Put it in | Mechanism |
|---|---|---|
| Editing/timeline/render tools the agent can call | new `extensions/jagentchill-*/` plugin(s) | `api.registerTool`, manifest `contracts.tools` |
| One-prompt video workflow orchestration | same plugin: a tool + background `registerService`; optionally Lobster pipelines; sub-agents for parallel shots | `docs/tools/lobster.md`, `docs/tools/subagents.md` |
| Product RPC / HTTP (project CRUD, asset upload, run status stream) | plugin | `api.registerGatewayMethod`, `api.registerHttpRoute`, `api.registerAgentEventSubscription` |
| Extra video/image/music models | provider plugin | `api.registerVideoGenerationProvider` etc. |
| Agent personas (director, editor, ...) and models | config, not code | `agents.entries.*`, `agents.defaults.model` |
| Prompting know-how (storyboarding, shot lists, Archify authoring) | workspace or bundled `skills/<name>/SKILL.md` | skills loader |
| Editor web UI (CapCut-like) | a **new** workspace app (e.g. `apps/editor-web` or `packages/editor-ui`) using `@openclaw/gateway-client/browser` | Gateway WS; advertise `tool-events`, `inline-widgets` |
| Small in-chat/dash contributions | plugin UI descriptors | `api.session.controls.registerControlUiDescriptor` (`tab`, `widget`), `registerWidgetPresenter` |
| Desktop shell | adapt `apps/linux` (Tauri v2, already cross-builds for macOS) to open the editor UI and supervise the Gateway; or a new Electron/Tauri app per `docs/gateway/embedding.md` | Rust crates in `crates/` |
| Mobile | fork `apps/ios` / `apps/android` (native chat + node clients), or write React Native clients against the WS protocol | no React Native code exists upstream |

Important mismatch to plan for: the existing `ui/` is **Lit**, and the native apps are Swift /
Kotlin / Tauri. If JAgentChill's editor is React (web) + React Native (mobile), none of the
upstream client code is directly reusable as components; what is reusable is the protocol, the
browser client package, and the pairing/auth flows. Building the editor *inside* `ui/` would mean
writing it in Lit and merging against a very active directory.

### 7.5 Keeping upstream updates flowing

| Strategy | How | Trade-off |
|---|---|---|
| **Fork + `upstream` remote** (fits "repo as skeleton") | `git remote add upstream https://github.com/openclaw/openclaw.git`; periodically `git fetch upstream && git merge upstream/main` (or rebase a thin patch stack onto release tags) | Works well only if product code lives in **new** directories and core files are untouched; every edited/deleted upstream file conflicts repeatedly. Upstream moves fast (large daily churn — `CHANGELOG.md`), and `AGENTS.md` states "Main, beta, and nightly code are not shipped contracts", so merge against **stable tags**, not `main`. |
| Vendored subtree | `git subtree add --prefix vendor/openclaw upstream <tag> --squash`, product at repo root | Clean separation and explicit version bumps, but the pnpm workspace then spans two roots; OpenClaw expects to be the workspace root (`pnpm-workspace.yaml` lists `.`), so building it from a subdirectory needs its own install — feasibility **UNVERIFIED**. |
| Dependency (no skeleton) | `openclaw` npm package (or `ghcr.io/openclaw/openclaw` image, `docs/install/docker.md`) + `@openclaw/gateway-client` + own plugins installed with `openclaw plugins install --link` | Lowest maintenance and the path upstream documents, but contradicts "pull the code in as the skeleton" and gives no ability to patch core. |

Whatever is chosen: config schema changes ship with `openclaw doctor --fix` migrations
(`VISION.md`), plugin API compatibility is declared per plugin (`compat.pluginApi`,
`minGatewayVersion`), and the wire protocol is versioned separately (v4).

### 7.6 Build and runtime requirements

- Node: `"engines": {"node": ">=24.16.0 <25 || >=26.1.0"}` (`package.json`);
  `docs/install/index.md`: "**Node 24.16+ or 26.1+** - Node 26 is recommended". (Published client
  packages alone need only Node `>=22.19.0`.)
- pnpm: `"packageManager": "pnpm@12.5.1+sha512..."`; "Corepack selects the exact pnpm version from
  `package.json` (currently pnpm 12)"; "`pnpm` is only needed if you build from source". Workspace
  enforces `minimumReleaseAge: 10080` (7-day dependency cooldown) and `blockExoticSubdeps: true`
  (`pnpm-workspace.yaml`) — new product dependencies are subject to these.
- From source (`docs/install/index.md`):
  ```bash
  git clone https://github.com/openclaw/openclaw.git
  pnpm install && pnpm build && pnpm ui:build
  pnpm add --global "openclaw@link:$PWD"
  ```
  Dev loop scripts (`package.json`): `pnpm gateway:dev` (runs with `OPENCLAW_SKIP_CHANNELS=1`),
  `pnpm gateway:watch`, `pnpm ui:dev`, `pnpm openclaw ...`; gate: `pnpm build && pnpm check &&
  pnpm test` (`CONTRIBUTING.md`).
- Native apps add their own toolchains: Xcode/Swift (`apps/ios`, `apps/macos`), Android
  Gradle/Kotlin (`apps/android`), Rust + Tauri v2 (`apps/linux`, `crates/`). Exact versions were
  not checked — **UNVERIFIED**.
- OS: "macOS, Linux, or Windows" (Windows via Hub app, PowerShell installer or WSL2).
- State: SQLite everywhere (`AGENTS.md`: "State and caches use SQLite, not new JSON/JSONL/sidecar
  stores"), under `~/.openclaw` by default.

### 7.7 What the existing clients already cover

| Surface | Code | Role |
|---|---|---|
| Web | `ui/` (Control UI, served at `http://<host>:18789/`) | operator dashboard: chat, sessions, agents, config, plugins, devices, approvals, cron |
| macOS | `apps/macos` | menu-bar app, operator + node (camera, screen, notifications, computer control per `docs/nodes/index.md`) |
| Linux (and macOS via Tauri) | `apps/linux` | Tauri shell that discovers/manages Gateways and embeds the Control UI |
| Windows | external repo `openclaw-windows-node` | Hub app: setup, tray, chat, node mode |
| iOS / watchOS | `apps/ios` | chat + voice + approvals; node |
| Android / Wear | `apps/android` | chat + voice + approvals; node |
| Headless | `openclaw node run`, `crates/openclaw-node-host` | node host on any machine |

None is a media editor; all are chat/operator/companion clients.

### 7.8 Device/node pairing and auth (reusable as-is)

From `docs/gateway/clients.md`:

1. "Persist an Ed25519 device identity in the client."
2. Wait for `connect.challenge`, sign the challenge-bound payload, send `connect` with role,
   scopes and the shared Gateway token/password for bootstrap.
3. On `PAIRING_REQUIRED`, show the request ID and follow `error.details.recommendedNextStep`.
4. On the Gateway host: `openclaw devices list`, `openclaw devices approve <requestId>`.
5. Reconnect and persist `hello-ok.auth.deviceToken`; use it afterwards.

"Do not create a per-client bearer token by hand-editing `openclaw.json`." "Scope or role upgrades
create a new pending pairing request." Mobile bootstrap uses QR/setup codes
(`device.pair.setupCode`, `/pair qr`; `docs/gateway/pairing.md`), and the Android README confirms
"QR code, setup code, or manual connection". Local loopback connects can be auto-approved;
LAN/tailnet connects need explicit approval (`docs/gateway/pairing.md`). Remote access is expected
via Tailscale/VPN/SSH tunnel or a trusted proxy, not a public port.

## 8. Risks and open questions for the spec

1. **Topology.** One Gateway per user device (desktop app supervises it; phone pairs to it) versus
   hosted Gateways. Hosted multi-user means one "cell" per tenant (`openclaw fleet`,
   "experimental") or the team-server model; a single shared Gateway is not a tenant boundary.
2. **Mobile.** A phone cannot run the Gateway; a mobile-only JAgentChill user needs a Gateway
   somewhere (their desktop or a hosted cell).
3. **UI stack mismatch** (Lit / Swift / Kotlin upstream vs React / React Native product) — section 7.4.
4. **Terminology.** In OpenClaw, "harness" means the per-turn executor plugin
   (`docs/plugins/sdk-agent-harness.md`, experimental: "Do **not** register a harness just to add a
   new LLM API"). The owner's "harness (framework/skeleton)" means the whole Gateway + plugin
   platform. Keep the two apart in the spec.
5. **Operator-level power.** HTTP bearer auth and the OpenAI-compatible endpoint are full operator
   access; the default agent can run host commands. A consumer video app should ship restrictive
   `tools` profiles and sandbox settings (`docs/gateway/sandboxing.md`) — exact safe profile
   **UNVERIFIED**.
6. **Upstream velocity and size.** Plan merges against stable tags, and budget for the
   `minimumReleaseAge` dependency policy and repo-wide checks when adding product packages.
7. **Version pinning.** Docs pin client packages at `2026.8.1` while the tree is `2026.9.8`; pin
   and co-test whichever pair is adopted.
