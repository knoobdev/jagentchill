# OpenClaw agent capabilities vs. the widened JAgentChill agent scope

- Source read: `.refs/openclaw` at `0816aa1b` (v2026.9.8). All paths are relative to that clone.
- Method: static reading of docs and code. Nothing was run against a live Gateway. Anything inferred rather than read is marked **UNVERIFIED**; behaviour that only a live Gateway can confirm is listed under "Spikes".
- Does not repeat `openclaw-reference.md` (protocol, plugin seam, pairing) or `openclaw-plugin-feasibility.md` (caller identity, plugin storage, services, tool hooks). Where those notes are now out of date, this file says so.
- Constraint assumed: core (`src/`, `packages/*`, bundled extensions) stays unmodified; product code lives in a new plugin.

## Verdict table

| # | Area | Verdict |
|---|---|---|
| A | Agent runtimes via installed CLIs (claude-cli, gemini-cli, Codex, Copilot, generic ACP) | VERIFIED-YES (with per-runtime limits) |
| A | Bundled `codex-cli` / `opencode` CLI backend | VERIFIED-NO (Codex = app-server harness; OpenCode = ACP only) |
| A | Claude Code "modes" (plan / acceptEdits) as a session control on the `claude-cli` backend | VERIFIED-NO |
| B | Direct provider auth: API key and OAuth, multiple profiles, rotation | VERIFIED-YES |
| B | OAuth login driven by a client app over Gateway RPC | VERIFIED-YES (`models.authLogin` + `wizard.*`, `operator.admin`) |
| C | Switch model / runtime / thinking / permission mode between turns | VERIFIED-YES (`sessions.patch`) |
| C | Per-message model on `chat.send` / `sessions.send` | VERIFIED-NO (only `thinking`, `fastMode`, `queueMode`); `agent` RPC has `provider`/`model` |
| C | Steer mid-turn | VERIFIED-YES (`chat.send queueMode:"steer"`, the default) |
| C | Live permission change during a CLI-backed run | VERIFIED-NO (rejected; stop, change, continue) |
| C | Per-message skill selection | PARTIAL (`$skill` text references, `/skill`; no structured param) |
| D | Sub-agents, agent-spawns-agent, depth/concurrency limits | VERIFIED-YES |
| D | Agent-to-agent messaging between top-level agents | VERIFIED-YES (`sessions_send`, `tools.agentToAgent`) |
| D | Fixed-role team supervisor -> lead -> peers | PARTIAL (allowlists + prompt contracts; "not a scheduler") |
| D | Create/modify agents at runtime; spawn runs from a plugin | VERIFIED-YES (`agents.create`, `api.runtime.subagent.run`) |
| E | Execute a user-drawn node graph of agents/tools | VERIFIED-NO (Lobster is a linear shell pipeline; Swarm: "There is no graph DSL") |
| F | Skills discovery, install, allowlists, runtime enable/disable, RPCs | VERIFIED-YES |
| G | Usage/cost per session and provider quota | VERIFIED-YES (per-turn attribution to participants: NO) |
| H | PTY terminal a client can attach to | VERIFIED-YES, built in (`terminal.*`, `operator.admin`, host shell) |
| H | Working directory per session, projects, worktrees, file browsing | VERIFIED-YES |
| H | In-sandbox terminal | VERIFIED-NO ("in-sandbox terminals are not supported yet") |
| I | `operator.write` as a per-person isolation boundary | VERIFIED-NO |

Corrections to earlier notes: `sessions.steer` is listed in `openclaw-reference.md` as a normal RPC; it is now `advertise: false` and "Deprecated alias for chat.send queueMode interrupt" (`src/gateway/methods/core-descriptors.ts:353-361`). The earlier feasibility note treats terminals/PTY as something the plugin would own; core already ships them.

---

## A. Agent runtimes — VERIFIED-YES

### A.1 The model: provider, model, runtime are three layers

`docs/concepts/agent-runtimes.md`: "An **agent runtime** owns one prepared model loop". Two families:

- "**Embedded harnesses** run inside OpenClaw's prepared agent loop: the built-in `openclaw` runtime, plus registered plugin harnesses such as `codex` and `copilot`."
- "**CLI backends** run a local CLI process while keeping the model ref canonical ... `claude-cli` is not an embedded harness id and must not be passed to AgentHarness selection."

### A.2 Every bundled runtime found in code

| Runtime id | Kind | Registered at | Notes |
|---|---|---|---|
| `openclaw` | built-in embedded loop | core | default / fallback |
| `codex` | plugin harness (Codex app-server) | `extensions/codex/index.ts:278` | auto-claims compatible `openai/*` routes; `/codex bind|threads|resume|steer|stop` |
| `copilot` | plugin harness (`@github/copilot-sdk`) | `extensions/copilot/index.ts:47` | "**never** selected by `auto`"; opt in via `agentRuntime.id` |
| `agentsapi` | plugin harness (OpenAI Agents API) | `extensions/agentsapi/index.ts:14` | hosted or self-hosted sessions |
| `acp-opencode`, `acp-qwen`, `acp-pi`, `acp-kilocode`, `acp-copilot` | plugin harnesses over ACP | `extensions/acpx/index.ts:33-50` (`runtimeId: \`acp-${agentId}\``), ids from `ACPX_NATIVE_AGENT_IDS` (`extensions/acpx/src/config-schema.ts:8`) | each toggled by `plugins.entries.acpx.config.nativeAgents.<id>` |
| `claude-cli` | CLI backend | `extensions/anthropic/register.runtime.ts:633`, manifest `"cliBackends": ["claude-cli"]` | warm `claude` subprocess over stdio |
| `google-gemini-cli` | CLI backend | `extensions/google/index.ts:42`, manifest `"cliBackends": ["google-gemini-cli"]` | `gemini --output-format stream-json` |

Only two CLI backends are bundled. `docs/gateway/cli-backends.md`: "Anthropic owns `claude-cli` and Google owns `google-gemini-cli`. OpenAI Codex agent runs use the Codex app-server harness through `openai/*`. There is no bundled `codex-cli` backend." (`docs/concepts/agent-runtimes.md`: "The bundled Codex CLI backend was removed in v2026.5.14.")

### A.3 Generic ACP client — VERIFIED-YES (`acpx`)

`extensions/acpx` (`enabledByDefault: true` in its manifest; docs still describe `openclaw plugins install @openclaw/acpx` for packaged installs) is an ACP client runtime: "[Agent Client Protocol (ACP)] sessions let OpenClaw run external coding harnesses (Claude Code, Cursor, Copilot, Droid, OpenClaw ACP, OpenCode, Gemini CLI, and other supported acpx harnesses) through an ACP backend plugin" (`docs/tools/acp-agents.md`).

- Target ids (`docs/tools/acp-agents/quickstart.md`): `claude`, `codex`, `copilot`, `cursor`, `droid`, `fast-agent`, `gemini`, `iflow`, `kilocode`, `kimi`, `kiro`, `mux`, `opencode`, `openclaw`, `qoder`, `qwen`, `trae`, plus `pi`.
- Arbitrary ACP agents: plugin config accepts a custom command map (`extensions/acpx/src/config-schema.ts:107-116`):
  ```ts
  agents: z.record(z.string(), z.strictObject({
    command: nonEmptyTrimmedString("agents.<id>.command must be a non-empty string"),
    args: z.array(z.string()).optional(),
  })).optional(),
  ```
  "Custom acpx agent aliases can be configured in acpx itself, but OpenClaw policy still checks `acp.allowedAgents` and any `agents.entries.*.runtime.acp.agent` mapping before dispatch."
- Core config: `acp: { enabled, dispatch: { enabled }, backend: "acpx", defaultAgent, allowedAgents: [...] }` (`docs/tools/acp-agents-setup.md:149-163`).
- Two ways in: (1) ACP session, key `agent:<agentId>:acp:<uuid>`, started by `/acp spawn <id>` or the agent tool `sessions_spawn({ runtime: "acp", agentId })`; (2) native runtime `acp-<id>` selected like any other `agentRuntime`.
- Opposite direction also exists: `openclaw acp` exposes a Gateway session *as* an ACP server for editors.
- There is also a plugin RPC `acpx.agents.list` (`operator.read`, `extensions/acpx/index.ts:53-66`) returning native agents with `installation` and `enabled`.

No Gateway RPC that creates an ACP session directly was found: `SessionsCreateParamsSchema` has no `runtime` field and `AgentParamsSchema` only carries `acpTurnSource: "manual_spawn"` (`packages/gateway-protocol/src/schema/agent.ts:333`). A client reaches ACP either by sending `/acp spawn ...` as chat text (runtime controls "require owner identity from external channels and `operator.admin` from internal Gateway clients", `docs/tools/acp-agents/controls.md`) or through the `acp-*` runtime ids. Whether `sessions.create { agentRuntime: "acp-opencode" }` is accepted end to end is **UNVERIFIED** (spike 1).

### A.4 How a runtime is selected

Config (`docs/concepts/agent-runtimes.md`, "Runtime selection"):

1. model-scoped: `agents.defaults.models["provider/model"].agentRuntime` or `agents.entries.*.models["provider/model"].agentRuntime` (wildcard `"vllm/*"` allowed);
2. provider-scoped: `models.providers.<provider>.agentRuntime`;
3. `auto`: registered plugin runtimes claim supported pairs;
4. fallback `openclaw`.

"whole-agent runtime keys are legacy and ignored"; `OPENCLAW_AGENT_RUNTIME` is ignored. So there is **no per-agent runtime pin**, only per provider/model (which can be scoped under one agent's `models` map).

Per session and per agent over RPC:

- `sessions.create { model, agentRuntime, thinkingLevel, fastMode, permissionMode, toolOverrides, cwd, ... }` (`packages/gateway-protocol/src/schema/sessions-create.ts:17-128`).
- `sessions.patch { model, agentRuntime }` — "Explicit runtime for the selected model; null follows configured routing." (`.../sessions-patch.ts:82-84`).
- `agents.update { agentId, model, agentRuntime }` (`.../agents-models-skills.ts:124-133`).
- Per run: `agent { provider, model, thinking }` (`.../agent.ts:292-304`). No `agentRuntime` field on `agent`, `chat.send`, or `sessions.send`.
- Discovery: `models.list` returns per-model `agentRuntime` plus `runtimeChoices[]` (max 8) with per-runtime capabilities (see B.5).

"Historical `agentHarnessId` records which runtime produced the transcript; it does not pin the next turn." "Explicit provider/model plugin runtimes fail closed when the harness is missing".

### A.5 What `registerCliBackend` requires

`registerCliBackend: (backend: CliBackendPlugin) => void` (`src/plugins/plugin-api.types.ts:296`). `CliBackendPlugin` (`src/plugins/cli-backend.types.ts:405-595`): `id` (becomes the provider prefix), `config: CliBackendConfig`, optional `modelProvider`, `bundleMcp`, `bundleMcpMode`, `prepareExecution`, `resolveExecutionArgs`, `parseJsonlEvent`, `nativeToolMode: "none" | "always-on" | "selectable"`, `hostOwnedTools`, `ownsNativeCompaction`, `manualCompaction`, `textTransforms`.

`CliBackendConfig` (`:15-91`): `command`, `args`, `output: "json"|"text"|"jsonl"`, `jsonlDialect: "claude-stream-json"|"gemini-stream-json"`, `liveSession: "claude-stdio"`, `input: "arg"|"stdin"`, `env`, `modelArg`, `modelAliases`, `sessionArgs`, `resumeArgs`, `forkArg`, `sessionMode: "always"|"existing"|"none"`, `systemPromptArg`, `imageArg`, `imageMode`, `imagePathScope: "temp"|"workspace"`, `serialize`.

The execute context gives the backend host-owned permission and question callbacks (`:263-267`):

```ts
requestToolPermission: (...) => Promise<CliBackendToolPermissionResult>;
requestUserInput: (request: CliBackendUserInputRequest) => Promise<CliBackendUserInputResult>;
// :175  | { behavior: "allow"; updatedInput: Record<string, unknown> } | { behavior: "deny"; message: string }
```

"Host-owned native action decision; plugins never acquire approval authority."

A JAgentChill plugin **can** register its own CLI backend (for example an OpenCode or Codex-CLI JSONL wrapper). The manifest must declare it under `cliBackends`.

### A.6 What `registerAgentHarness` requires

`registerAgentHarness: (harness: AgentHarness, options?: AgentHarnessRegistrationOptions) => void` (`src/plugins/plugin-api.types.ts:367`), "experimental" per the SDK docs. `AgentHarness` is deprecated in favour of `AgentHarnessV2` ("source-compatible ... through 2026-10-12", `src/agents/harness/types.ts:638-649`). Optional members read at `:520-636`: `runSideQuestion`, `compact`, `reset`, `sessionForkV2`, `authBinding`, `fetchUsageSnapshot`, `loadMcpToolCatalog`, `loadModelCatalog`, `readModelCatalogReadiness`. The required head of the contract (id, supports, runAttempt) was not read in full — **UNVERIFIED** in detail. This is a large, moving contract; prefer ACP or a CLI backend.

### A.7 How CLI-backend activity surfaces to clients

- Parsed stream shape (`src/plugins/cli-backend.types.ts:309-332`): `{kind:"text"}`, `{kind:"thinking"}`, `{kind:"toolStart", toolCallId, name, args}`, `{kind:"toolResult", toolCallId, isError, result}`, `{kind:"result", text, sessionId, usage:{input,output,cacheRead,cacheWrite,total}, errorText}`, `{kind:"sessionId"}`.
- These are re-emitted as ordinary agent events: `emitAgentEvent({ runId, stream: "tool", data })` and `stream: "item"` (`src/agents/cli-runner/execute-events.ts:83-93`), with the `mcp__openclaw__` prefix stripped. A client therefore sees the same `agent` / `session.tool` / `session.message` events as for the built-in runtime (needs the `tool-events` client cap, per the earlier reference note). Event parity in practice is **UNVERIFIED** (spike 2).
- Permissions (claude-cli): "OpenClaw's permission responses and `PreToolUse` hook keep native tools under host control ... Native requests pass through canonical `before_tool_call` policy before exec policy and approval". When exec ask is `on-miss`/`always`, approvals are relayed with **Allow once / Allow always / Deny**; "Grants stay in memory ... and never apply to Bash."
- Claude's `AskUserQuestion` "uses OpenClaw's structured question flow" (`question.*` RPCs/events, scope `operator.questions`).

### A.8 Limits per runtime

| Topic | `claude-cli` | `google-gemini-cli` | ACP (`acpx`) | `codex` harness |
|---|---|---|---|---|
| OpenClaw tools | via loopback MCP bridge (`bundleMcp`), `--allowedTools mcp__openclaw__*` | generated Gemini settings | "**not** exposed to ACP harnesses by default"; opt-in `pluginToolsMcpBridge` / `openClawToolsMcpBridge` | "Bridged through the Codex adapter" |
| Native shell | local MCP turns: "Native `Bash` is disabled", OpenClaw `exec`/`process` used | native, `--approval-mode auto_edit` | harness-owned | Codex-native |
| Images | `imageArg: "@"`, `imagePathScope: "workspace"` | same | "ACP attachments are image-only" | image forwarding |
| Resume | `--session-id {sessionId}`, warm process, resume by stored id; fork via `--fork-session` | `--resume {sessionId}`, `sessionMode: "existing"` | `resumeSessionId` -> ACP `session/load` | native thread |
| Thinking | `/think` -> `--effort` (+ `MAX_THINKING_TOKENS`) | not documented — **UNVERIFIED** | canonical option `thinking` mapped to `effort` / `reasoning_effort` / `thought_level` when advertised | native effort |
| Modes | "OpenClaw always launches Claude Code with its default permission mode"; only exception in code is `bypassPermissions` when OpenClaw requests yolo (`extensions/anthropic/cli-shared.ts:467`). No plan/acceptEdits control | fixed `auto_edit` | `/acp set-mode plan`, `/acp permissions <profile>`, static `permissionMode: approve-all|approve-reads|deny-all` (default `approve-reads`, `nonInteractivePermissions: fail`) | `/codex permissions` |
| Compaction | `ownsNativeCompaction: true`, `/compact` forwarded | native, explicit `/compact` unsupported | harness | Codex-native |
| Live permission change | rejected: "Active CLI-backed runs ... do not support live permission changes" | same | n/a | interrupt + continue |

Doc framing to respect: CLI backends are described as "a safety net for 'always works' text responses, not a primary path. For a full harness runtime ... use ACP Agents instead."

### A.9 Third route: native CLI in a PTY ("CLI agents")

`gateway.cliAgents.enabled` (default `true`) plus session catalogs let a client start the *real* CLI TUI in a Gateway PTY — the closest match to how JAgentDesk wraps CLIs:

- `api.registerSessionCatalog(provider: SessionCatalogProvider)` (`src/plugins/plugin-api.types.ts:269`). Provider type at `src/plugins/session-catalog.ts:183-229`: `list`, `read`, `continueSession?`, `copyToGatewaySession?`, `openTerminal?`, `startTerminalSession?`.
- Bundled catalog ids: "`claude`, `codex`, `openclaw`, `opencode`, and `pi`" (`docs/nodes/session-catalogs.md`).
- RPC `sessions.catalog.startTerminal { catalogId, hostId?, agentId, cwd, initialMessage? }` -> `{ sessionId, agentId, shell, cwd, confined, title? }` (`packages/gateway-protocol/src/schema/sessions-catalog.ts:206-222`); "requires `operator.admin` plus `gateway.cliAgents.enabled` and `gateway.terminal.enabled`. The caller provisions `cwd`".
- Also `sessions.catalog.list|read|import|continue|archive`.

In this route OpenClaw sees a terminal byte stream, not structured tool calls or usage.

**Reuse:** all runtimes above, selection config, `models.list` runtime choices, the MCP bridge, the approval relay, session catalogs. **Build:** a runtime/provider picker UI; optionally one extra CLI backend or acpx `agents.<id>` entries for CLIs not bundled; nothing in core.

---

## B. Direct provider auth — VERIFIED-YES

### B.1 Auth profiles and storage

`docs/concepts/model-failover.md:146-150`: "OpenClaw uses **auth profiles** for both API keys and OAuth tokens. Secrets and runtime auth-routing state live in `~/.openclaw/agents/<agentId>/agent/openclaw-agent.sqlite`. Config `auth.profiles` / `auth.order` are **metadata + routing only** (no secrets)." Shared credentials: `~/.openclaw/state/openclaw.sqlite` (`docs/concepts/oauth.md:76-78`). Sub-agents: "shared auth profiles are merged in as a **fallback**; agent profiles override ... There is no setting that isolates an agent's auth from the shared profiles."

### B.2 Which providers offer which login

Counted from `providerAuthChoices` in the 2026.9.8 bundled manifests:

- API key: 51 choices (near every provider).
- `oauth`: `openai` (ChatGPT/Codex), `xai`, `openrouter`, `chutes`, `minimax-portal` (global and CN), `radius`.
- Device code: `github-copilot` (`device`, `device-enterprise`), `openai` (`device-code`), `xai` (`device-code`).
- Anthropic: `cli` ("Keep using an existing Claude Code CLI login on this host"), `setup-token`, `api-key` — no browser OAuth choice.
- Other: `microsoft-foundry` `entra-id`, `openai` `siwc` (token sharing), local (`ollama`, `llama-cpp`, `apple-fm`, `copilot-proxy`), `custom` (`lmstudio`, `sglang`, `vllm`).
- Google: API key only; "Existing valid legacy Gemini CLI OAuth profiles remain runtime-compatible, but OpenClaw does not create or repair them."

### B.3 Driving login from a client app — VERIFIED-YES

All `operator.admin` unless noted (`src/gateway/methods/core-descriptors.ts:101-103, 431, 557, 582-584`):

- `models.authLogin { sessionId, authChoice, agentId?, ... }` (params = `SystemAgentSetupAuthStartParamsSchema`, `packages/gateway-protocol/src/schema/openclaw.ts:439-449`). The handler starts a `WizardSession` and runs `runModelsAuthLoginFlowForGateway({ provider, method, isRemote: true, openUrl, browserAuthorization })` (`src/gateway/server-methods/models-auth-login.ts:29-140`); the client continues with `wizard.next` / `wizard.cancel` / `wizard.status`. It rejects non-admin: "Provider login requires an administrator connection."
- `models.authSetApiKey { provider, apiKey, agentId? }` -> `{ provider, profileId, warning? }`.
- `models.authStatus` (`operator.read`), `models.authRefresh`, `models.authLogout { provider, profileIds?, credentialType? }`, `models.authOrderSet { provider, profileIds?, agentId? }`, `models.probe { provider, profileId?, timeoutMs? }` -> status `ok|auth|rate_limit|billing|timeout|format|unknown|no_model`.
- Personal accounts on a shared Gateway: `users.authConnect.start|answer|status|cancel|catalog`, `users.listModelAccounts`, `users.selectModelAccount` (`operator.write`).

The exact `wizard.next` step payloads for an OAuth redirect on a remote client were not traced — **UNVERIFIED** (spike 3).

### B.4 Multiple profiles and rotation

`auth.order.<provider>` controls automatic selection; "Overloaded and rate-limit errors allow one same-provider auth-profile rotation by default before advancing to the next configured model fallback." A session can pin a profile: `/model opus@anthropic:default -s`. `models.list` accepts `authProfileId`.

### B.5 Listing providers/models/capabilities

`models.list` params (`packages/gateway-protocol/src/schema/model-catalog.ts:14-55`): `agentId`, `sessionKey`, `authProfileId`, `provider`, `includeDetails`, `includeProviderCapabilities`, `includeDefaultModels`, `preparedOnly`, `refresh`, `view: "default"|"configured"|"provider-config"|"all"`.

Result `{ models: ModelChoice[], modelSelectionPolicy?, decisionModels? }`; `ModelChoice` (`:57-113`):

```ts
{ id, name, provider, alias?, tags?,
  available?, manualSelectionAllowed?, unavailableReason?: "missing-auth"|"auth-failed"|"cooldown", unavailableUntil?,
  contextWindow?, contextTokens?, local?, contextWindows?: [{id,label,contextWindow}], contextWindowDefault?,
  reasoning?, thinkingLevels?: [{id,label}], thinkingDefault?,
  effectiveFastMode?, serviceTiers?, supportsFastMode?, supportsTools?,
  input?: ("text"|"image"|"audio"|"video"|"document")[],
  agentRuntime?: { id, fallback?, ... }, apiKeySupported?,
  runtimeChoices?: [{ agentRuntime, ...same capability fields, unavailableReason incl. "unsupported-runtime" }] }
```

There is also a `models.snapshot` event. Thinking levels are therefore **per model and per runtime** and must be read from here, not hard-coded.

### B.6 Custom OpenAI-compatible endpoints

`models.providers.<id>` with `baseUrl`, `api` (for example `"openai-completions"`), `models[]`, headers, timeouts (`docs/gateway/authentication.md:85`; example at `docs/plugins/sdk-provider-plugins.md:266`). Bundled `lmstudio`, `vllm`, `sglang`, `litellm`, `ollama`, `llama-cpp`. Custom models can opt into `/think xhigh` through `compat.supportedReasoningEfforts`. Custom endpoints "stay on OpenClaw rather than losing their transport settings" (never auto-routed to Codex).

**Reuse:** everything. **Build:** a settings screen that calls these RPCs. Note they need `operator.admin`, which a normal JAgentChill device should not hold (see I).

---

## C. Per-session and per-run control

### C.1 `sessions.patch` fields — VERIFIED-YES

`packages/gateway-protocol/src/schema/sessions-patch.ts:18-91`, relevant subset: `label`, `category`, `archived`, `pinned`, `contextWindow`, `thinkingLevel`, `fastMode: boolean|"auto"|"ultrafast"`, `toolOverrides`, `verboseLevel`, `traceLevel`, `reasoningLevel`, `responseUsage: "off"|"tokens"|"full"|"on"`, `elevatedLevel`, `execHost`, `execNode`, `permissionMode`, `sandboxMode: "off"|null`, `nativeRuntimeConsent`, `model`, `agentRuntime`, `sendPolicy`, `groupActivation`. Compare-and-swap guards: `expectedSessionId`, `expectedLifecycleRevision`, `expectedPermissionMode`, `expectedToolOverrides`. `sessions.patchMany` applies one patch to up to 100 targets.

- `SessionPermissionModeSchema = "read-only" | "guarded" | "workspace" | "full"` (`.../sessions-row.ts:16-21`). "`full` requires `operator.admin`. The other modes require `operator.write`."
- `SessionToolOverridesSchema = { mcpServers?: Record<string,boolean>, mcpToolsDeny?: Record<string,string[]>, skills?: Record<string,boolean>, webSearch?: boolean }` (`:52-59`).
- `execSecurity` / `execAsk` are retired: "Requests containing either field, including `null`, are rejected with `INVALID_REQUEST`".
- Scope: "`model`, `thinkingLevel`, and `fastMode` overrides require `operator.write`" (`docs/gateway/protocol/rpc-session-control.md`). The scope of `agentRuntime` in the same patch was not traced — **UNVERIFIED**.

### C.2 Send paths

| RPC | Per-message controls | Source |
|---|---|---|
| `chat.send` | `thinking`, `fastMode`, `fastAutoOnSeconds`, `queueMode`, `attachments`, `toolBindings` (<=16 opaque plugin bindings), `workContext`, `replyToId`, `expectedLeafEntryId`, `idempotencyKey` (required). **No `model`.** | `packages/gateway-protocol/src/schema/logs-chat.ts:316-354` |
| `sessions.send` | `thinking`, `attachments`, `timeoutMs`. **No `model`.** | `.../sessions.ts:481-490` |
| `agent` | `provider`, `model`, `thinking`, `lane`, `cwd`, `extraSystemPrompt`, `promptMode`, `timeout`, `agentId`, `sessionKey`, `swarmCollector`, `idempotencyKey` (required) | `.../agent.ts:289-358` |
| `sessions.create` | initial `model`, `agentRuntime`, `thinkingLevel`, `permissionMode`, `toolOverrides`, `cwd`, `worktree*`, `projectId`, `parentSessionKey`, `fork`, `message`/`task` | `.../sessions-create.ts:17-128` |

So "pick a model for this one message in an existing chat" = `sessions.patch` then `chat.send`, or the `agent` RPC with `sessionKey`. `toolBindings` is the one structured per-run channel a plugin tool can read (`OpenClawPluginToolContext.toolBindings`).

### C.3 Switching model or runtime mid-session

- Works, context kept: "The session transcript remains available, but the next model may have a different context window, prompt and tool behavior, or prompt-cache implementation. A mid-session switch can therefore reduce continuity, require earlier compaction, or lose prompt-cache reuse ... For a planned model change, prefer a new session." (`docs/concepts/models.md:340-351`).
- During a run: "Only explicit user-driven model changes mark a pending live switch. That includes `/model`, `session_status(model=...)`, and `sessions.patch`" and "The selected model can complete the same turn." (`docs/concepts/model-failover.md:447-460`).
- Native runtimes hold their own thread: a `claude-cli` session with "A changed model, system prompt, or tool policy starts a new subprocess", fresh sessions are reseeded from OpenClaw history capped at "12,288 characters (about 3,000 tokens)" (larger for Claude), and recovery is refused when the account boundary does not match. Switching *between* runtimes therefore loses native-side context beyond that reseed. Exact behaviour for openclaw <-> claude-cli <-> acp is **UNVERIFIED** (spike 4).
- "Locked native transcripts retain their creating harness"; "ACP sessions retain their ACP backend."

### C.4 Steering, queueing, abort — VERIFIED-YES

`QUEUE_MODES = ["steer", "followup", "collect", "interrupt"]` (`.../logs-chat.ts:280`). `docs/concepts/queue-steering.md`: "When a normal prompt arrives while a session run is active and the queue mode is `steer` (the default, no config needed), OpenClaw tries to send that prompt into the active runtime". "Steering does not interrupt a tool call that is already running."

- Codex: one batched `turn/steer`. ACP: "`/acp steer` queues a follow-up; it cannot add input to the running ACP turn." Swarm collector children "cannot be steered". CLI-backend steering support is not stated — **UNVERIFIED** (spike 5).
- A changed model selection, account pin or tool permission "can require a followup turn" instead of a steer.
- Abort: `sessions.abort { key?, runId?, clearQueued? }` (`.../sessions.ts:520-526`), `chat.abort { sessionKey, runId?, preserveSideRuns?, discardPendingInput? }`. Queued messages "stay there across reconnects until consumed or canceled".
- Side question without disturbing the run: `/btw`.

### C.5 Thinking levels

Levels `off | minimal | low | medium | high | xhigh | adaptive | max | ultra` (`docs/tools/thinking.md`). "Thinking menus and pickers are provider-profile driven." "Typed directives for unsupported native levels are rejected". Resolution: inline directive -> session override -> `agents.entries.*.thinkingDefault` -> per-agent model `params.thinking` -> shared model default -> `agents.defaults.thinkingDefault` -> provider default. `ultra` is "harness-level planning, execution, verification, and proactive sub-agent orchestration", not a provider effort.

### C.6 Slash commands (sent as message text)

`/new`, `/reset`, `/compact`, `/stop`, `/model [name|default|list|status] [-s|-a|-g]`, `/models`, `/think`, `/fast`, `/reasoning`, `/verbose`, `/elevated`, `/exec host=... security=...`, `/queue <mode>`, `/steer <message>`, `/btw`, `/usage off|tokens|full|reset|cost`, `/status`, `/tools`, `/context`, `/skill <name> [input]`, `/subagents`, `/acp ...`, `/codex ...`, `/agents`, `/goal`, `/loop`, `/login`, `/approve <id> <decision>`, `/plugins`, `/config`, `/mcp`. `commands.list` (`operator.read`) enumerates them. `chat.send` has `suppressCommandInterpretation`.

### C.7 "Modes" and tool profiles

- Session-level: `permissionMode` (C.1) and `toolOverrides`.
- Agent-level: `tools.profile: "minimal" | "coding" | "messaging" | "full"` (`src/agents/tool-catalog.ts:29`) plus `tools.allow` / `alsoAllow` / `deny`, per agent under `agents.entries.<id>.tools`.
- Read back: `tools.effective` (session-scoped, `operator.read`), `tools.catalog`.
- No "plan mode" concept in OpenClaw sessions. Closest: `read-only` permission mode ("managed mutation tools omitted", exec denied) and ACP `set-mode plan`.

**Reuse:** all of it. **Build:** composer UI for model/runtime/thinking/permission pickers driven by `models.list` and `sessions.describe`; a rule in the client that model changes go through `sessions.patch` before `chat.send`.

---

## D. Multi-agent

### D.1 Sub-agents — VERIFIED-YES

Agent tools (`docs/concepts/session-tool.md`, `src/agents/tool-catalog.ts`): `sessions_spawn`, `sessions_yield`, `subagents`, `agents_wait`, `sessions_send`, `sessions_list`, `sessions_history`, `sessions_search`, `session_status`, `sessions`, `agents_list`. "The built-in `coding` and `messaging` profiles include `sessions_spawn`, `sessions_yield`, and `subagents`; `minimal` does not."

`sessions_spawn` parameters (`docs/tools/subagents/tool-reference.md:161-241`): `task`, `taskName`, `label`, `agentId`, `cwd`, `projectId`, `projectGitUrl`, `runtime: "subagent"|"acp"`, `resumeSessionId`, `streamTo: "parent"`, `model`, `runTimeoutSeconds`, `thinking`, `thread`, `mode: "run"|"session"`, `cleanup: "delete"|"keep"`, `expectsCompletionMessage`, `completionTarget: "parent"`, `sandbox: "inherit"|"require"`, `context: "isolated"|"fork"`, `visible`, `placement`, `group`, `worktree`, `worktreeName`, `worktreeBaseRef`.

- Different model/runtime per child: yes (`model`, `thinking`, `runtime: "acp"`, cross-agent `agentId`; defaults `agents.defaults.subagents.model`).
- Limits (`docs/tools/subagents/nesting.md`): `maxSpawnDepth` default 5 (range 1-5), `maxChildrenPerAgent` default 5 (1-20), `maxConcurrent` default 8 per spawning session, `runTimeoutSeconds`, `announceTimeoutMs`.
- Session keys: depth 0 `agent:<id>:main`, depth 1 `agent:<id>:subagent:<uuid>`, deeper "Persisted flat sub-agent keys with lineage"; ACP `agent:<agentId>:acp:<uuid>`.
- Allowlist: `agents.entries.*.subagents.allowAgents` (`["*"]` or ids), `agents.defaults.subagents.requireAgentId`.
- Results: "Results flow back one level at a time"; top-level requesters get "a follow-up `agent` call with external delivery", nested ones "an internal follow-up injection". `sessions_yield` ends the turn and resumes after children settle. "Explicit cancellation of an orchestrator cascades through its descendant tree."
- Tool policy by depth: orchestrators get `sessions_spawn`, `subagents`, `sessions_list`, `sessions_history`; leaves get none. "sub-agents do **not** get session or message tools by default."
- What a client sees: child sessions in `sessions.list` / `sessions.changed` (parent link, `spawnDepth`), `sessions.messages.subscribe { includeApprovals: true }` covers "this session and its descendants", `mode: "narration"` gives bounded digests; `sessions.create { parentSessionKey, spawnDepth, fork }` lets a client create a visible child itself.

### D.2 Swarm (large fan-out) — VERIFIED-YES, needs Code Mode

`docs/tools/swarm.md`: "Swarm orchestrates many sub-agents from a Code Mode script. It is enabled by default ... **There is no graph DSL and no separate workflow format. The program is the orchestration.**" Limits `tools.swarm { maxConcurrent: 32, maxChildrenPerGroup: 50, maxTotalPerGroup: 200, waitTimeoutSecondsMax: 600, defaultAgentId }`. Code Mode itself is opt-in (`tools.codeMode: true`). `agent` RPC carries `swarmCollector` / `swarmOutputSchema` for structured child results.

### D.3 Agent-to-agent between top-level agents — VERIFIED-YES

`sessions_send` "runs another session on the same Gateway and optionally waits for the response"; `timeoutSeconds: 0` for non-blocking; `mode: "steer"`; `watch: true`. Policy (`docs/gateway/config-tools/sessions-and-subagents.md`): `tools.agentToAgent { enabled (default true), allow: [...] }` — "Both the requesting agent and the target agent must match an entry"; `tools.sessions.visibility: "self" | "tree" | "agent" | "all"` (default `all`). Sandboxed sessions are clamped to spawned sessions by `agents.defaults.sandbox.sessionToolsVisibility="spawned"`.

Separate from this, `extensions/a2a` is an "A2A v1.0 Agent-to-Agent protocol channel plugin" for *external* agents; not read in depth — **UNVERIFIED**.

### D.4 Fixed-role teams — PARTIAL

`openclaw agents team create` "creates a chief of staff (`coordinator`), researcher, writer, and reviewer, each with its own workspace"; wiring is `coordinator.subagents: { allowAgents: [...], delegationMode: "prefer" }` and `allowAgents: []` for specialists. The doc is explicit: "`\"prefer\"` guides the coordinator to delegate suitable work; it is prompt guidance, not a scheduler." Role contracts live in each workspace's `AGENTS.md`.

A three-tier supervisor -> lead -> peers shape is expressible (allowlists per tier + `maxSpawnDepth` + `AGENTS.md`) but nothing enforces turn order, peer review or hand-back; peers talking sideways need `sessions_send`, which sub-agents lack by default. No RPC for team creation was found (CLI and Control UI "custodian chat" only) — **UNVERIFIED** that none exists.

Hand-off of a *user conversation* from agent A to agent B is not a first-class verb: the pieces are routing bindings (`docs/concepts/agent-bindings.md`, not read in depth), `sessions.assignOwner { key, owner: { type, id } }` (reassigns the session's mutable owner "to a person or configured agent"), and `sessions_send`. Treat as **PARTIAL / UNVERIFIED**.

### D.5 Workboard — not a pipeline

`extensions/workboard` (bundled, `enabledByDefault: false`): "an optional Kanban-style board ... agent-sized work cards, assignment to agents, and a link back to the card's task, run, and Control UI session ... It is not a replacement for GitHub Issues". Tools `workboard_list|create|claim|heartbeat|complete|block|...`. Useful as a task ledger for a team, not as an execution graph.

### D.6 Approvals across agents

Exec approvals (`exec.approval.*`), plugin approvals (`plugin.approval.*`), generic `approval.get|resolve|history`, and questions (`question.*`) are Gateway-wide, scope `operator.approvals` / `operator.questions`; events `exec.approval.requested|resolved`, `plugin.approval.requested|resolved`, `question.requested|resolved`, `session.approval`. A child "captures the requester's effective sender policy when it is spawned"; a steered turn "keeps its original owner's authority, tool bindings, and approval destination."

### D.7 Creating agents and runs programmatically — VERIFIED-YES

- RPC (`operator.admin`): `agents.create { name, workspace?, model?, emoji?, avatar? }` -> `{ ok, agentId, name, workspace, model? }`; `agents.update`; `agents.delete { agentId, deleteFiles? }`; `agents.files.list|get|set` (`packages/gateway-protocol/src/schema/agents-models-skills.ts:106-145`). `agents.create` does not take `tools`, `subagents`, `skills`, or `sandbox`; those need config mutation.
- Plugin: `api.runtime.config.mutateConfigFile({ mutate(draft, ctx) })` and `replaceConfigFile` (`src/plugins/runtime/types-core.ts:339-349`); `api.runtime.agent.ensureAgentWorkspace`, `agent.session.createSessionEntry|patchSessionEntry`.
- Plugin runs (`src/plugins/runtime/types.ts:170-180`):
  ```ts
  subagent: {
    complete: (params: { agentId, message, extraSystemPrompt?, model?, timeoutMs?, signal? }) => Promise<{ text: string }>;
    run: (params: { sessionKey, message, disableTools?, toolsAlsoAllow?, provider?, model?, extraSystemPrompt?,
                    promptMode?: "minimal", lane?, lightContext?, deliver?, completionDelivery?, idempotencyKey?, cwd? })
         => Promise<{ runId, sessionKey?, runtime?: { harness, provider, model } }>;
    waitForRun: (params: { runId, timeoutMs? }) => Promise<AgentWaitResult>;
    getSessionMessages; deleteSession;
  }
  ```
  Model overrides are gated: `plugins.entries.<id>.subagent.allowModelOverride` and `.allowedModels` (`src/config/schema.help.agents.ts:42-47`).
- `api.runtime.gateway.request(method, params, { scopes })` — "Requested Gateway scopes. Honored only for bundled or trusted official plugins." (`src/plugins/runtime/types.ts:131-146`). Which scopes a third-party plugin's request runs with was not traced to the end — **UNVERIFIED** (spike 6).
- Also `api.runtime.agent.runEmbeddedAgent`, `api.runtime.hooks.dispatchHookAgentTurn`, `api.runtime.events.onAgentEvent`, `api.registerAgentEventSubscription`.

**Reuse:** sub-agent runtime, limits, announce chain, a2a policy, team preset as a template, agent CRUD. **Build:** a team/role model (who may call whom, in what order), its mapping onto `allowAgents` + `agentToAgent.allow` + `AGENTS.md`, a UI for the session tree, and hand-off semantics.

---

## E. Workflows — VERIFIED-NO for node graphs

### E.1 Lobster

`extensions/lobster` (tool `lobster`; "an **optional** plugin tool, not installed or enabled by default"; tool must be added with `tools.alsoAllow: ["lobster"]`; "disabled entirely for sandboxed tool contexts").

- What it is: "runs multi-step tool pipelines as one deterministic tool call, with explicit approval/input checkpoints and resume tokens"; "a small, constrained DSL rather than a general scripting language".
- Formats: an inline pipe string (`exec --json --shell '...' | ... | approve --prompt '...'`) or a `.lobster`/`.yaml`/`.yml`/`.json` file with "`name`, `args`, `steps`, `env`, `condition`, and `approval` fields"; steps are `{ id, command, stdin: $step.stdout|$step.json, approval: required, condition: $step.approved }`.
- Invocation: only as an agent tool call `{ action: "run", pipeline, cwd, timeoutMs (default 20000), maxStdoutBytes, argsJson }` and `{ action: "resume", token | approvalId, approve | responseJson | cancel }`. Envelope status `ok | needs_approval | needs_input | cancelled`.
- State: "small JSON files under the Lobster state directory (`~/.lobster/state` by default)"; "The plugin does not list pending checkpoints"; "tokens are not bound to an OpenClaw user or session."
- Agent steps: **no, not in the embedded runner**. "`openclaw.invoke` does **not** automatically inherit a gateway URL/auth context ... this pattern is **not currently reliable in the embedded runner**". Steps are shell commands.
- Shape: sequential steps with a condition gate. No branches-with-merge, loops, parallel fan-out or node typing.

### E.2 Other automation

- Cron ("Automations"): `cron.add|update|remove|run|list|get|runs|history` (mutations `operator.admin`). Payload kinds (`packages/gateway-protocol/src/schema/cron.ts:213-244`): `systemEvent`, `agentTurn { message, model, fallbacks, toolsAllow, thinking, timeoutSeconds }`, command `{ argv }`, script `{ script <= 65536 chars }`. One job = one step.
- Hooks: internal `HOOK.md` lifecycle scripts; typed plugin hooks `api.on(...)`; webhooks as HTTP ingress.
- Standing orders: persistent instructions. `/loop`: cron-backed recurring prompt. Goals: `sessions.goal.update|clear`.
- Swarm (D.2): code-as-orchestration inside one agent turn; the closest thing to agent-authored pipelines, but it is JavaScript in a QuickJS isolate, not a persisted graph, and results live in the run.

### E.3 Conclusion

Nothing in core or the bundled plugins can load a persisted directed graph whose nodes are agents/tools and execute it with per-node status. JAgentChill needs its own engine in the plugin: graph store (plugin SQLite), a scheduler in a `registerService`, node executors that call `api.runtime.subagent.run` + `waitForRun` (agent nodes) and tools (tool nodes), approval nodes via `plugin.approval.*`, and `plugin.jagentchill.*` events for canvas status. This matches the existing project direction (graph JSON remains the canonical artifact; a code DSL compiles down to it). Lobster's resume-token design and Swarm's `outputSchema` are worth copying; neither is worth depending on.

---

## F. Skills — VERIFIED-YES

- Discovery roots, highest first (`docs/tools/skills.md:39-48`): `<workspace>/skills`; `<workspace>/.agents/skills`; `~/.agents/skills`; `<state-dir>/skills` (managed); `<state-dir>/agents/<agentId>/agent/workshop-skills`; bundled; `skills.load.extraDirs` + plugin skills (manifest `"skills": ["./skills"]`).
- Install sources: `openclaw skills install @owner/<slug>` (ClawHub), `skills-sh:owner/repo/slug`, `git:owner/repo@ref`, `./path --as name`. RPC `skills.install` accepts three shapes (`packages/gateway-protocol/src/schema/agents-models-skills.ts:310-341`): `{ name, installId }` (installer spec), `{ source: "clawhub", slug, version?, force? }`, `{ source: "upload", uploadId, slug }` (after `skills.upload.begin|chunk|commit`). No npm/git source on the RPC — CLI only.
- Per-agent allowlists: "Omit `agents.defaults.skills` to leave all skills unrestricted"; "Set `agents.entries.*.skills: []` to expose no skills"; "A non-empty `agents.entries.*.skills` list is the **final** set".
- Runtime enable/disable: `skills.update { skillKey, enabled?, apiKey?, env? }` (`operator.admin`); per session `toolOverrides.skills: Record<string, boolean>` via `sessions.patch`/`sessions.create`; personal library `skills.library.list|read|save|mutate|activate|import|upload` (`operator.write`). "A session retains its selected skill IDs and revisions"; "A new session selects up to 64 enabled library skills".
- Listing for a client: `skills.status { agentId?, sessionKey? }` (`operator.read`), `skills.search`, `skills.detail`, `skills.skillCard`, `skills.securityVerdicts`; event `skills.changed`. Agent tools `skills_search`, `skills_read`.
- Attach to one message: text only. "`$release_notes` ... A single message can reference up to eight distinct skills; OpenClaw returns a visible error instead of ignoring extra or allowlist-hidden references", resolved "on generic Gateway, CLI, and webhook agent turns". `/skill <name> [input]` is the command form. There is **no structured `skills` field** on `chat.send`.
- With `claude-cli`: selected skills are passed as "a temporary Claude Code plugin via `--plugin-dir`".

**Reuse:** all. **Build:** a skill picker that inserts `$name` tokens and toggles `toolOverrides.skills`; ship JAgentChill skills inside the plugin's `skills/` directory.

---

## G. Usage and cost — VERIFIED-YES

- Recorded: per-turn usage `{ input, output, cacheRead, cacheWrite, total }` (CLI backends report the same shape), per-session tokens and "estimated cost (API key models only)"; "Sessions billed through a plan hide per-token dollar estimates".
- Provider quota/plan: "Pulls provider usage/quota directly from each provider's usage endpoint ... provider-reported plan names, quota windows, balances, spend, budgets"; composer shows "per-window bars (5-hour, weekly, model-scoped) with reset times, the provider plan when known (for example `Max (20x)`)". Harnesses can contribute via `fetchUsageSnapshot` (`src/agents/harness/types.ts:586-596`).
- RPCs (`operator.read`): `usage.status`, `usage.cost`, `sessions.usage` (params at `packages/gateway-protocol/src/schema/sessions.ts:698-745`: `key?`, `agentId?`, `agentScope: "all"`, `creatorKey`, `startDate`/`endDate`, `mode: "utc"|"gateway"|"specific"`, `range: "7d"|"30d"|"90d"|"1y"|"all"`, `groupBy: "instance"|"family"`, `timeZone`, `limit`, `includeContextWeight`), `sessions.usage.timeseries`, `sessions.usage.logs` (the three `sessions.usage*` are `advertise: false`), `models.authStatus` (has a usage cache). Per-response footer: `sessions.patch { responseUsage: "off"|"tokens"|"full"|"on" }` or `/usage`. Agent tool `session_status`.
- Result payload shapes for `usage.status` / `usage.cost` / `sessions.usage` were not read — **UNVERIFIED** (spike 7).
- Attribution limit: "This attributes the whole session to its creator, not individual turns to participants". Sub-agent cost: "each sub-agent has its own context and token usage"; a roll-up across a session tree is the client's job (**UNVERIFIED** whether `groupBy: "family"` covers children — it is documented as rotated session ids only).

**Reuse:** all. **Build:** a usage panel; tree roll-up for teams and workflow runs (plugin keeps `runId -> sessionKey` and sums).

---

## H. Terminal, exec, files, workspaces

### H.1 Interactive PTY — VERIFIED-YES, core feature

`packages/gateway-protocol/src/schema/terminal.ts` ("Terminal methods open a PTY-backed shell session bound to one authenticated operator connection and stream its bytes back over the existing WebSocket"); dependency `@lydell/node-pty` (`package.json:2258`); also `packages/terminal-core`.

| RPC (all `operator.admin`) | Params -> result |
|---|---|
| `terminal.open` | `{ agentId?, sessionKey?, catalog?, cols, rows }` (1..2000) -> `{ sessionId, agentId, shell, cwd, confined, title? }` (`:21-44`) |
| `terminal.input` | `{ sessionId, data }` |
| `terminal.resize` | `{ sessionId, cols, rows }` |
| `terminal.close` | `{ sessionId }` |
| `terminal.attach` | `{ sessionId }` -> open result + `{ owner?: "conn" | "agent:...", buffer, seq? }` (ring-buffer replay, `:89-104`) |
| `terminal.list` | -> `{ sessions: [{ sessionId, agentId, shell, title?, cwd, confined, attached, owner?, createdAtMs }] }` |
| `terminal.upload` | `{ sessionId, name, contentBase64 }` (16 MiB cap) -> `{ path, size }` |

Events: `terminal.data { sessionId, seq, data }`, `terminal.exit { sessionId, exitCode?, signal?, reason?: "process_exit"|"closed"|"disconnected"|"detached"|"error" }`.

Config (`docs/gateway/config-gateway.md:201-202`): "`terminal.enabled`: the admin-scoped operator terminal. Default: `true` ... The terminal starts a host PTY in the selected agent workspace, inherits the Gateway process environment, and is refused for agents with `sandbox.mode: \"all\"`"; `terminal.shell`. Code: "terminal unavailable: agent ... runs in a sandbox ...; in-sandbox terminals are not supported yet" (`src/gateway/server-methods/terminal.ts:124-131`). The schema comment states the trust level plainly: "the terminal surface is already operator.admin (full host access)".

Agents can share it: core tool `terminal` — "Use shared operator terminals with policy-governed input" (`src/agents/tool-catalog.ts:343-348`, `coding` profile); a `sessionKey`-bound shell is shared between "the session's agent and the initiating operator".

Can a plugin offer its own PTY safely? It does not need to; the built-in one exists. If JAgentChill wants terminals for non-admin devices it would have to build a second surface (plugin RPC + `plugin.jagentchill.*` events + `node-pty` in a plugin service) and would then own: authorisation per device, confinement (there is no sandboxed PTY to lean on), environment scrubbing (the host PTY "inherits the Gateway process environment", including provider keys), idle reaping, and output back-pressure. Recommended: do not; gate the built-in terminal behind `operator.admin` devices only, or disable it (`gateway.terminal.enabled: false`) for the product's default profile.

### H.2 Exec, processes, approvals

- Tools: `exec { command, workdir, env, yieldMs (10000), background, timeoutSeconds, pty, host: "auto"|"sandbox"|"gateway"|"node", ask }` and `process` (poll/kill background sessions). "`exec` is a mutating shell surface ... Disabling OpenClaw filesystem tools ... does not make `exec` read-only."
- Client RPCs: `sessions.processes.list` (`operator.read`), `sessions.processes.stop` (`operator.write`); `exec.approval.list|get|resolve|waitDecision|grants.list|grants.revoke` (`operator.approvals`); `exec.approvals.get|set` allowlist (`operator.admin`); `tools.invoke` (`operator.write`).
- Remote/sandbox exec: `environments.*` and `environments.session.exec` (`operator.admin`); node hosts via `node.invoke` (`system.run`), `execNode` on a session (`operator.admin`).

### H.3 Sandboxing

"Sandboxing is off by default and controlled by `agents.defaults.sandbox` (global), `agents.entries.*.sandbox` (per-agent) ... The Gateway process always stays on the host"; "This is not a perfect security boundary". Backends: Docker, Podman, SSH, OpenShell, Crabbox. Session knob: `sandboxMode: "off" | null` ("required session isolation cannot be relaxed"). CLI backends are outside it: "This is argument-level policy applied to the command Claude Code will run, not sandboxed execution by OpenClaw. Claude Code owns cwd, PATH, environment, and sandboxing."

### H.4 Files, workspaces, projects — VERIFIED-YES

- Agent tools: `ls`, `read`, `write`, `edit`, `apply_patch`.
- Workspace per agent: `agents.entries.<id>.workspace`; RPC `agents.workspace.list|get`, `agents.files.list|get|set`.
- Working directory per session: `sessions.create { cwd }` — "Absolute Gateway working directory ... Gateway paths outside configured agent workspaces and all execNode paths require operator..." (text truncated in my read; the stricter scope is `operator.admin` per `docs/gateway/operator-scopes.md` for `execNode`; for out-of-workspace `cwd` it is **UNVERIFIED**). Per run: `agent { cwd }`; per spawn: `sessions_spawn { cwd }`.
- Session root and containment: `permissionMode` boundary is "the session's recorded canonical `sessionRoot`, or the selected agent's canonical workspace".
- Browsing: `fs.listDir { path?, nodeId? }` -> `{ path, parent?, home, entries: [{ name, path, hidden? }] }` — directories only, "for the new-session folder picker"; `operator.write` on the Gateway host limited "to configured agent workspaces", `operator.admin` for nodes (`packages/gateway-protocol/src/schema/fs.ts`).
- Session files: `sessions.files.list|get|assets` (`operator.read`), `sessions.files.set|reveal` (`operator.admin`); `sessions.diff` (`operator.read`).
- Projects: `projects.list`, `projects.add { gitUrl, name? }` (`operator.write`), `projects.register { path, name? }` / `projects.remove` (`operator.admin`), `projects.searchRemote`; `sessions.create { projectId | projectGitUrl | repository }`.
- Worktrees: `worktrees.list|branches|create|remove|restore|gc`; `sessions.create { worktree, worktreeName, worktreeBaseRef, worktreeSource: "empty" }`; plugin `api.runtime.worktrees.create` exists but `ownerKind` is typed `"workboard"` only (`src/plugins/runtime/types.ts:214-228`).
- Groups with default folders: `sessions.groups.defaults|update`.
- Artifacts: `artifacts.list|get|download` (`operator.read`).

**Reuse:** everything. **Build:** file tree/editor UI over `sessions.files.*`, a project picker, terminal panes over `terminal.*`. A general file *tree* listing (files as well as directories) outside a session is not offered by `fs.listDir`; use `sessions.files.list`.

---

## I. Security posture

What an `operator.write` device can do once CLI backends and exec are enabled:

- Start agent turns on any agent it can see (`chat.send`, `sessions.send`, `agent`), pick the model/runtime/thinking per session, and set `permissionMode` up to `workspace` ("`full` requires `operator.admin`").
- Through those turns, cause `exec` on the Gateway host subject to the agent's exec policy. Unconfigured default: "Without those settings or sandboxing, the default is full access."
- Call tools directly: `tools.invoke` (`operator.write`), relay ordinary node commands (`node.invoke`), stop session processes, add projects by git URL, create worktrees.
- With `claude-cli` / ACP, the external CLI runs as the Gateway OS user with that user's vendor login, outside OpenClaw's sandbox; ACP `approve-all` is "the harness-level break-glass switch".
- It cannot: open terminals, log in providers, set API keys, create/modify agents, write config, install skills/plugins, mutate cron, set `execNode`, or select `full` mode — all `operator.admin`.

The docs are explicit that this is not tenant isolation: "`operator.write` still authorizes Gateway-wide operations such as tool invocation, ordinary node command relay, and other write-scoped control-plane actions. Session restrictions do not turn that scope into a per-person isolation boundary. Use separate Gateways when mutually untrusted people must not share diagnostics or control-plane write authority." Default `tools.sessions.visibility: "all"` exposes "other agents' and other users' transcripts" to session tools.

Settings that scope it down per agent:

- `agents.entries.<id>.tools.profile` (`minimal|coding|messaging|full`), `.tools.allow|alsoAllow|deny`, `.tools.elevated`, `.tools.swarm`.
- `agents.entries.<id>.sandbox { mode, ... }`; `agents.defaults.sandbox.sessionToolsVisibility`.
- Exec: `tools.exec.mode`, `security: deny|allowlist|full`, `ask: off|on-miss|always`, allowlist via `exec.approvals.*`.
- Session: `permissionMode` (`read-only` denies exec and omits mutation tools), `toolOverrides`.
- Delegation: `agents.entries.<id>.subagents.allowAgents`, `maxSpawnDepth`, `maxChildrenPerAgent`; `tools.agentToAgent.enabled|allow`; `tools.sessions.visibility`.
- Runtimes: `acp.enabled`, `acp.allowedAgents`, `plugins.entries.acpx.config.permissionMode` (`approve-reads` default), `nativeAgents.<id>: false`; `gateway.cliAgents.enabled: false`; `gateway.terminal.enabled: false`; restricted runs with `toolsAllow` make `claude-cli` disable "Claude's native tools and user, project, and local customizations".
- Models: `agents.defaults.modelPolicy.allow`; plugin overrides `plugins.entries.<id>.subagent.allowModelOverride|allowedModels`.
- Plugin layer: `before_tool_call` hook can `block` or `requireApproval` per agent/session (see the feasibility note section 12).

Implication for JAgentChill: a paired editor device should get `operator.read` + `operator.write` (+ `operator.approvals`/`operator.questions` if it answers prompts), never `operator.admin`. Provider login, agent/team creation, skill install and terminals then need either an admin "owner" device or plugin RPCs that perform the narrow admin action on the device's behalf after the plugin's own authorisation check (feasible only if the plugin's in-process requests can carry admin scope — spike 6).

---

## Build vs reuse

| Requirement | OpenClaw piece to reuse | What the JAgentChill plugin builds | Risk |
|---|---|---|---|
| 1a. Providers through installed agent CLIs | `claude-cli`, `google-gemini-cli` backends; `codex`, `copilot`, `agentsapi` harnesses; `acpx` (17 targets + custom `agents.<id>.command`, `acp-*` runtimes); session catalogs + `sessions.catalog.startTerminal` | Runtime picker; acpx agent entries or one extra `registerCliBackend` for CLIs not covered; install/health checks (`acpx.agents.list`, `/acp doctor`) | Medium: tool/steer/mode parity differs per runtime; ACP tools off by default; ACP spawn has no direct RPC; `registerAgentHarness` contract is experimental and changes on 2026-10-12 |
| 1b. Direct API key / OAuth | Auth profiles, `models.authLogin` + `wizard.*`, `models.authSetApiKey`, `models.authStatus|probe|authOrderSet`, `models.providers.<id>` | Provider settings UI | Medium: all mutations need `operator.admin`; wizard step protocol unverified |
| 2. Switch provider/model/thinking between turns | `sessions.patch { model, agentRuntime, thinkingLevel, fastMode, permissionMode, toolOverrides }`, `models.list` capabilities, `/model` | Composer pickers; "patch then send" sequencing; warning on cross-runtime switch | Medium: native-runtime context loss on runtime switch; no per-message model on `chat.send` |
| 2. Steer mid-turn, abort, queue | `chat.send queueMode` (`steer|followup|collect|interrupt`), `sessions.abort`, `chat.abort` | Queue UI | Low for built-in/Codex; ACP cannot steer a running turn; CLI unverified |
| 2. "Modes" | `permissionMode` (`read-only|guarded|workspace|full`), tool profiles, ACP `set-mode` | Map product modes onto permission modes; no plan mode for `claude-cli` | Medium: live change rejected on CLI-backed runs |
| 2. Skills per message | `$skill` references (<= 8), `/skill`, `toolOverrides.skills`, `skills.status` | Skill picker inserting tokens | Low |
| 2. Usage | `usage.status`, `usage.cost`, `sessions.usage*`, `responseUsage`, provider plan windows | Usage panel; tree roll-up | Low; payload shapes unverified |
| 3. Sub-agents, agents spawning agents | `sessions_spawn`, `sessions_yield`, `subagents`, limits, announce chain, Swarm | Session-tree UI | Low |
| 3. Agent-to-agent calls/messages | `sessions_send`, `tools.agentToAgent`, `tools.sessions.visibility` | Policy presets | Low; default visibility is `all` |
| 3. Fixed-role teams (supervisor -> lead -> peers) | Team preset pattern, `allowAgents`, `delegationMode`, `AGENTS.md`, `agents.create`, `mutateConfigFile` | Team model + generator that writes agents, allowlists and role contracts; optional enforcement in a `before_tool_call` hook | Medium-high: ordering is "prompt guidance, not a scheduler" |
| 3. Hand-off / hand-back | `sessions_yield`, completion delivery, `sessions.assignOwner`, bindings | Hand-off verb and UI state | High: no first-class primitive |
| 3. Programmatic runs | `api.runtime.subagent.run|waitForRun`, `agent` RPC, `onAgentEvent` | Thin wrapper | Low; model override needs `allowModelOverride` |
| 4. Linked-agent workflows / drawn graphs | Nothing as an engine. Borrow ideas: Lobster resume tokens, Swarm `outputSchema`, cron for triggers | Own graph store, scheduler service, node executors, approvals, status events, canvas | High: largest net-new piece |
| 5. PTY terminals | `terminal.open|input|resize|close|attach|list|upload`, `terminal.data|exit`, agent tool `terminal` | xterm panes | Medium: `operator.admin` only, host shell, no sandboxed terminal, inherits Gateway env |
| 5. Working directory / projects / files | `sessions.create { cwd, projectId, worktree }`, `projects.*`, `worktrees.*`, `fs.listDir`, `sessions.files.*`, `sessions.diff`, `artifacts.*` | Project picker, file tree, diff view | Low-medium: writes and out-of-workspace paths need admin |
| Security | Scopes, tool profiles, sandbox, exec approvals, `permissionMode` | Device scope policy; narrow admin proxies in the plugin | High: `operator.write` is not an isolation boundary |

## Spikes to run on a live Gateway

1. `sessions.create { agentRuntime: "acp-opencode" | "claude-cli" | "copilot" }` and `sessions.patch { agentRuntime }` from an `operator.write` device: accepted? which scope? what do `sessions.describe` and `models.list.runtimeChoices` report?
2. Event parity: run the same prompt on `openclaw`, `claude-cli`, `google-gemini-cli`, `codex`, and an ACP session with `tool-events` advertised; record `agent` / `session.tool` / `session.message` / usage payloads and approval prompts for each.
3. `models.authLogin` for one OAuth provider (`openai`) and one device-code provider (`github-copilot`) from a remote non-browser client: capture every `wizard.next` step and how the redirect/URL is surfaced.
4. Runtime switch mid-session (openclaw -> claude-cli -> openclaw, and model switch inside `claude-cli`): how much history the new runtime actually receives.
5. Mid-turn steer on `claude-cli` and `google-gemini-cli` (`chat.send queueMode: "steer"`), and a `permissionMode` change during a CLI-backed run (expect rejection).
6. From a non-bundled plugin: scopes carried by `api.runtime.gateway.request("agents.create" | "models.authSetApiKey" | "terminal.open")`; and `api.runtime.subagent.run` with `provider`/`model`/`cwd`/`toolsAlsoAllow` with and without `allowModelOverride`.
7. Payload shapes of `usage.status`, `usage.cost`, `sessions.usage` (does `groupBy: "family"` include sub-agent children?), with one API-key and one subscription provider.
8. A three-tier team (supervisor -> lead -> two peers) built only from config: does `maxSpawnDepth` + `allowAgents` hold the shape, can peers `sessions_send` each other, what the client sees in `sessions.changed`.
9. `terminal.open` + `terminal.attach` after reconnect; confirm refusal for a sandboxed agent and what environment variables the shell inherits.
10. Lobster in the embedded runner: confirm a step cannot start an agent turn, to close the question of reusing it as a workflow backend.
