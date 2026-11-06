## ADDED Requirements

### Requirement: Runtime model and the two access methods
Every agent session SHALL run on exactly one **runtime**, identified by a runtime id matching `^[a-z][a-z0-9-]{1,39}$`. A model reference is the triple `{runtimeId, providerId, modelId}`; a bare model id MUST be rejected with `INVALID_PARAMS`. Runtimes belong to one of two access methods. **CLI runtimes** (`kind: "cli"`) drive an agent CLI installed on the Gateway host through an existing OpenClaw CLI backend, plugin harness or the `acpx` ACP client; the product makes no model API call for these and holds no credential for them — the CLI uses its own login. **Direct runtimes** (`kind: "direct"`) call the model provider from the Gateway through OpenClaw's built-in `openclaw` runtime using an OpenClaw auth profile (API key or OAuth). JAgentChill is not an OpenClaw plugin: the server SHALL NOT add an agent harness, backend or any other code to the Gateway and SHALL NOT wrap a CLI itself; it reuses `claude-cli`, `google-gemini-cli`, `codex`, `copilot` and `acpx` unchanged and builds only detection, diagnostics, configuration, catalogues, snapshots, the capability matrix, the runtime switch and the admin proxy on top of them, driving them only through Gateway RPCs, events and configuration over the server's gateway link (`server-api.Gateway link`). Provider access is offered three equal ways — an installed CLI, a sign-in directly with the provider (OAuth or device code), and an API key — plus OpenAI-compatible and Anthropic-compatible endpoints and local proxies (`agent-runtimes.Shared endpoint record`). Every feature of this capability requires the Gateway to be linked; while it is not, each method of this capability that needs it answers `GATEWAY_UNAVAILABLE`. [JAD JD-PRV-001] [NEW]

#### Scenario: CLI runtime uses the CLI's own login
- **WHEN** a session runs on `claude-code` and no provider key is stored on the host
- **THEN** the turn completes using the login of the `claude` binary on the Gateway host
- **AND** no secret file and no auth profile is created by the server for that turn

#### Scenario: Direct runtime uses an auth profile
- **WHEN** a session runs on `builtin` with provider `openai` and one valid API-key profile
- **THEN** the Gateway calls the provider directly and the turn's usage is attributed to runtime `builtin`

#### Scenario: Bare model id
- **WHEN** a client submits a selection `{modelId: "gpt-5"}` without `runtimeId` and `providerId`
- **THEN** the call fails with `INVALID_PARAMS` naming the missing fields and the session selection is unchanged

### Requirement: Supported CLI runtimes and their Gateway targets
The server SHALL ship the following built-in CLI runtimes. The mapping is fixed and each row is covered by the runtime contract tests of `diagnostics-quality.Gateway contract tests`.

| Runtime id | Label | Gateway target | Start path | Launch binary | Enabled by default |
|---|---|---|---|---|---|
| `claude-code` | Claude Code | CLI backend `claude-cli` | `agentRuntime: "claude-cli"` | `claude` | yes |
| `gemini-cli` | Gemini CLI | CLI backend `google-gemini-cli` | `agentRuntime: "google-gemini-cli"` | `gemini` | yes |
| `codex` | Codex | plugin harness `codex` (Codex app-server) | `agentRuntime: "codex"` | `codex` | yes |
| `copilot` | Copilot | plugin harness `copilot` | explicit `agentRuntime: "copilot"` (never selected by `auto`) | `copilot` | yes |
| `acp-opencode` | OpenCode | `acpx` native runtime `acp-opencode` | `agentRuntime: "acp-opencode"` | `opencode` | yes |
| `acp-qwen` | Qwen Code | `acpx` native runtime `acp-qwen` | `agentRuntime: "acp-qwen"` | as reported by `acpx.agents.list` | no |
| `acp-pi` | Pi | `acpx` native runtime `acp-pi` | `agentRuntime: "acp-pi"` | as reported by `acpx.agents.list` | no |
| `acp-kilocode` | Kilo Code | `acpx` native runtime `acp-kilocode` | `agentRuntime: "acp-kilocode"` | as reported by `acpx.agents.list` | no |
| `acp-copilot` | Copilot (ACP) | `acpx` native runtime `acp-copilot` | `agentRuntime: "acp-copilot"` | as reported by `acpx.agents.list` | no |

There is no bundled Codex CLI backend and no OpenCode CLI backend in OpenClaw; Codex therefore runs only through the `codex` harness and OpenCode only through ACP. A session is placed on a runtime only by the server over its gateway link, with `sessions.create {agentRuntime}` or `sessions.patch {agentRuntime}`, after the checks of `agent-runtimes.Runtime policy enforcement on the host`; no device calls those methods (`chat-agent.Agent sessions run on Gateway sessions`). Acceptance of those fields from the server's gateway link for each id is gated by spike S7; a runtime id for which S7 fails is listed `unavailable` with `runtime/unsupported-capability`. The two CLI backends `claude-cli` and `google-gemini-cli` are used exactly as bundled: their command, arguments and environment are plugin code of the owning extension and cannot be overridden by configuration (`agent-runtimes.Launch environment`). Enabling a runtime adds the owning plugin id (`anthropic`, `google`, `codex`, `copilot`, `acpx`) to `plugins.allow` and, for `acp-*`, sets `plugins.entries.acpx.config.nativeAgents.<id>: true`; disabling the last runtime of a plugin removes those entries. [JAD JD-PRV-002] [NEW]

#### Scenario: Fresh host
- **WHEN** the server starts on a Gateway with no runtime configuration
- **THEN** `claude-code`, `gemini-cli`, `codex`, `copilot`, `acp-opencode` and `builtin` are listed enabled, and `acp-qwen`, `acp-pi`, `acp-kilocode`, `acp-copilot` are listed disabled

#### Scenario: Session placed on Codex
- **WHEN** an admin starts a workspace session with runtime `codex`
- **THEN** the Gateway session is created with `agentRuntime: "codex"` and `sessions.describe` reports that runtime

#### Scenario: Copilot is never chosen implicitly
- **WHEN** a session is created without a runtime for a model that the Copilot harness can also serve
- **THEN** the session does not run on `copilot`; `copilot` is used only when the selection names it

### Requirement: ACP target runtimes
In addition to the five native `acp-*` runtimes, the server SHALL expose the remaining `acpx` targets as runtimes with ids `acp-claude`, `acp-codex`, `acp-cursor`, `acp-droid`, `acp-fast-agent`, `acp-gemini`, `acp-iflow`, `acp-kimi`, `acp-kiro`, `acp-mux`, `acp-openclaw`, `acp-qoder` and `acp-trae` (13 ids; 18 ACP targets in total with the five native ones), all disabled by default and added from the catalogue of `agent-runtimes.One-click ACP catalogue`. These targets have no native runtime id, so their sessions are ACP sessions with key `agent:<agentId>:acp:<uuid>`, started by the server over its gateway link with the Gateway's ACP spawn control (`/acp spawn <target>` sent with the Gateway's `chat.send` over the server's gateway link, which holds the `operator.admin` scope the Gateway requires for it) and bound to the product session record; the permission profile and the mode of such a session are set per session with `/acp permissions` and `/acp set-mode` the same way. `acp.enabled` and `acp.dispatch.enabled` are set true, `acp.backend` is `acpx`, and `acp.allowedAgents` SHALL contain exactly the targets of the enabled ACP runtimes. This start path is gated by spike S12 (administrator-scope calls over the gateway link) and by spike S24, which has three pass criteria: (a) `/acp spawn` over the gateway link returns a session key the server can bind to its record; (b) `/acp permissions` applies per session, on ACP session keys and on the five native `acp-*` runtimes; (c) `/acp set-mode` applies per session on both. Fallbacks: (a) fails or S12 fails → the 13 session-path targets, every custom ACP command runtime and every proxy profile of `agent-runtimes.Proxy profiles for CLI runtimes` report status `unavailable` with reason `runtime/acp-spawn-unsupported`, and only the five native `acp-*` runtimes are selectable; (b) fails → every ACP runtime runs under the host-wide `acpx` permission profile `approve-reads` (`plugins.entries.acpx.config.permissionMode` is plugin-global configuration), the Auto mapping equals Edit and no ACP runtime offers an unattended mode; (c) fails → the Plan and Ask rows of ACP runtimes are published `supported: false` with "This host version cannot set this agent's mode". [NEW]

#### Scenario: Enable a session-path target
- **WHEN** an admin adds `acp-cursor` from the catalogue and the `cursor` ACP command is installed and signed in
- **THEN** `acp.allowedAgents` contains `cursor`, the runtime reports `ready`, and a new workspace session on it receives an ACP session key

#### Scenario: Disabled target is not dispatchable
- **WHEN** `acp-kiro` is disabled
- **THEN** `kiro` is absent from `acp.allowedAgents` and a request to start a session on `acp-kiro` fails with `runtime/disabled`

#### Scenario: Spawn path unavailable
- **WHEN** criterion (a) of spike S24 fails on the pinned Gateway version
- **THEN** `acp-cursor` is listed with status `unavailable`, reason "This host version cannot start this agent", and cannot be selected

#### Scenario: Per-session permission profile unavailable
- **WHEN** criterion (b) of spike S24 fails on the pinned Gateway version
- **THEN** every ACP runtime's mode list shows no unattended mode, Auto maps to the same permission profile as Edit, and the matrix footnote says so

### Requirement: Direct runtime
The server SHALL expose exactly one direct runtime, id `builtin`, label "Built-in", mapped to OpenClaw's `openclaw` runtime (the session's `agentRuntime` is `null` or `"openclaw"`). It is always present, cannot be removed, and is disabled only by disabling every direct provider. It serves every provider that has at least one usable auth profile (see `agent-runtimes.Direct provider list`) and every custom endpoint with the `llm` capability. It is the runtime of every creative agent by default and the only runtime on which all JAgentChill tools, steering, all four product modes, per-model attachments and host-owned approvals are available without a bridge. [NEW]

#### Scenario: Built-in is the default
- **WHEN** a session is created for `jagentchill-director` with no explicit runtime and the role's default profile names runtime `builtin`
- **THEN** the session runs on the `openclaw` runtime with the profile's provider and model

#### Scenario: No direct provider connected
- **WHEN** no provider has a usable auth profile and no `llm` endpoint exists
- **THEN** `builtin` is listed with status `unavailable`, reason `runtime/no-provider`, and the model browser shows "Connect a provider" for it

### Requirement: Runtime configuration store
Runtime configuration SHALL be one document under the key `runtimes` of the server's own configuration file (`<dataDir>/config.json`, validated by the Zod schema in `packages/protocol`; it is not part of the Gateway configuration) with shape `{version: 1, revision, probeTimeout_ms, extraPath: string[] (0–16 absolute directories of the host), providerGroups: {<providerId>: <group id>}, pinnedModelIds: {<providerId>: string[] (≤ 50)}, entries: {<runtimeId>: {enabled, order, label?, description?, command?, env?, params?, models?, additionalModels?, disallowedTools?, extends?, proxy?}}}`. It is read with `jagentchill.runtime.config.get` (scope `jagentchill.config.read`) and changed with `jagentchill.runtime.config.update {patch, removeRuntimeIds?, expectedRevision}` (scope `jagentchill.config.write`); a stale `expectedRevision` fails with `CONFLICT` and changes nothing. The document MUST NOT contain secret values: `env` values are either literal non-secret strings or `{secret: "<NAME>"}` references to `security-privacy.Host secret storage`. An entry whose id is a built-in runtime id is an override of that built-in (label, description, command, env, models, additionalModels, enabled, order); any other id is a custom profile and MUST set `extends`. `order` is an integer 0–9 999 and defines list order everywhere (ascending, ties by label); JAgentDesk declares the field without using it, and here it is effective. A disabled runtime is hidden from every picker, is never probed, and reports `status: "unavailable"` with `enabled: false`. Every successful update is applied to the Gateway configuration through the Gateway's configuration methods within 2 s and announced with the event `jagentchill.runtime.updated`. [JAD JD-PRV-018] [NEW]

#### Scenario: Disable a runtime
- **WHEN** an admin turns off `gemini-cli`
- **THEN** within 2 s it disappears from the model browser on every connected device, no `gemini` process is started by any snapshot read, and its settings row shows "Disabled"

#### Scenario: Reorder
- **WHEN** an admin drags `codex` above `claude-code` in settings
- **THEN** `order` values are rewritten and the model browser lists Codex before Claude Code on every device

#### Scenario: Stale revision
- **WHEN** two admin devices load revision 7 and both submit an update
- **THEN** the second update fails with `CONFLICT` and that device shows "Settings changed on another device" with "Reload"

#### Scenario: Secret in env
- **WHEN** an update sets `env.ANTHROPIC_API_KEY` to a literal value that matches a credential pattern (32 or more characters of base64, hex or a known key prefix)
- **THEN** the update fails with `INVALID_PARAMS` and the message "Store this value as a secret and reference it"

### Requirement: CLI detection by binary and version
For every enabled CLI runtime the server SHALL resolve the launch command: the entry's `command[0]` when set (source `override`), otherwise the default binary of the runtime (source `default`), otherwise for ACP targets the command reported by `acpx.agents.list`. A bare name is looked up on the Gateway process `PATH` extended with the directories of `extraPath` (`agent-runtimes.Runtime configuration store`); an absolute path MUST exist and be executable. The rules are stated per host operating system, because the Gateway host is macOS, Linux or Windows: on **macOS and Linux** a bare name matches a file of exactly that name in a searched directory, and "executable" means a regular file (after symlink resolution) with an execute permission bit for the Gateway's user; on **Windows** a bare name without an extension is tried with each extension of the Gateway process `PATHEXT` in order (so `claude` resolves `claude.cmd`, `codex` resolves `codex.exe`, and package-manager shims are found), name comparison is case-insensitive, and "executable" means an existing file whose extension is in `PATHEXT`; a resolved `.cmd`, `.bat` or `.ps1` file is started through the command interpreter with arguments passed as an array, never as a concatenated command line. Resolution yields `{path, source}` or the failure `runtime/not-installed`. When resolved, the server runs the version command (`<binary> --version`; for package-runner commands such as `npx -y <pkg> --acp` the probe is `npx -y <pkg> --version`) with a 5 000 ms timeout and stores the first line of output, trimmed to 120 characters, as `binary.version`; a failing or timed-out version command sets `version: null` and does not change the status. Detection runs on the Gateway host only; clients never probe their own machine. [JAD JD-PRV-003] [NEW]

#### Scenario: Binary on PATH
- **WHEN** `claude` resolves to `/usr/local/bin/claude` and prints `2.3.1 (Claude Code)`
- **THEN** the snapshot entry has `binary {path: "/usr/local/bin/claude", source: "default", version: "2.3.1 (Claude Code)"}`

#### Scenario: Binary missing
- **WHEN** `codex` is not on `PATH` and no override is set
- **THEN** the entry has `status: "unavailable"`, `error.code: "runtime/not-installed"`, and the UI pill reads "Not installed"

#### Scenario: Non-executable override
- **WHEN** on a macOS or Linux host an override command points to an existing file without execute permission
- **THEN** the entry is `unavailable` with `runtime/not-installed` and the diagnostic row "Executable: no"

#### Scenario: Shim on a Windows host
- **WHEN** the Gateway runs on Windows, `PATHEXT` contains `.CMD`, and the only match for `claude` on `PATH` is `C:\Users\me\AppData\Roaming\npm\claude.cmd`
- **THEN** the snapshot entry has that file as `binary.path` with `source: "default"`, and the version command runs through the command interpreter

#### Scenario: Windows file without an executable extension
- **WHEN** on a Windows host an override command points to an existing file `C:\tools\agent.txt`
- **THEN** the entry is `unavailable` with `runtime/not-installed` and the diagnostic row "Executable: no"

### Requirement: Login and health check
Availability SHALL require a login check in addition to the binary check; JAgentDesk reports a runtime ready from the binary alone and fails at the first turn, which is the defect corrected here. After a successful binary check the server determines `login.state` as `signed_in`, `signed_out` or `unknown` using, in order, the first source that applies: (1) the runtime's own status command, run with a 5 000 ms timeout and no stdin — `claude auth status` for `claude-code`, `codex login status` for `codex`, `opencode auth list` for `acp-opencode`; exit code 0 with a non-empty account means `signed_in`, a documented not-logged-in exit means `signed_out`; (2) the Gateway's own readiness for that runtime, read from `models.list {includeDetails: true, refresh: true}` `runtimeChoices[]` — `unavailableReason: "missing-auth" | "auth-failed"` means `signed_out`, an available choice means `signed_in`; (3) for ACP runtimes, an ACP `initialize` followed by `session/new` in a temporary directory with a 20 000 ms timeout — an authentication-required error means `signed_out`, success means `signed_in`, and the probe session is closed immediately. When no source can decide, `login.state` is `unknown`. A runtime is `ready` only when the binary resolves and `login.state` is `signed_in` or `unknown`; `signed_out` yields `status: "unavailable"` with `error.code: "runtime/signed-out"`. An `unknown` login is shown as "Sign-in not verified" on the runtime row and never blocks selection. The server MUST NOT read, copy or parse any CLI credential file or OS keychain item to decide login state. The health check never sends a model prompt and consumes no tokens. [NEW]

#### Scenario: Installed but signed out
- **WHEN** `claude` is installed and `claude auth status` reports no account
- **THEN** `claude-code` is `unavailable` with `runtime/signed-out`, the pill reads "Sign in required", and the row shows the hint "Run `claude` in a terminal on the host and sign in"

#### Scenario: Status command times out
- **WHEN** the status command does not exit within 5 000 ms and the Gateway reports no readiness for the runtime
- **THEN** the process is killed, `login.state` is `unknown`, the runtime is `ready`, and the row shows "Sign-in not verified"

#### Scenario: ACP probe
- **WHEN** an ACP agent answers `initialize` and rejects `session/new` with an authentication-required error
- **THEN** the runtime is `unavailable` with `runtime/signed-out` and no session remains open

### Requirement: Runtime status values
Each runtime SHALL report exactly one status: `loading` (never probed in this scope, or a probe is running), `ready` (binary and login checks passed and the catalogue was fetched), `error` (a probe step threw; `error {code, message, step}` is set), `unavailable` (disabled, not installed, signed out, no provider, or blocked by a failed spike). Alongside, each entry carries `enabled` and `source: "builtin" | "catalogue" | "custom"`. UI pills map as: `loading` → "Loading", `ready` → "Available", `error` → "Error", `unavailable` + `enabled: false` → "Disabled", `runtime/not-installed` → "Not installed", `runtime/signed-out` → "Sign in required", any other `unavailable` → "Unavailable". [JAD JD-PRV-004] [NEW]

#### Scenario: Error keeps the previous catalogue
- **WHEN** a `ready` runtime is refreshed and the catalogue call throws
- **THEN** the entry becomes `error` with the message and step, and `models` and `modes` from the previous successful fetch remain in the entry marked `stale: true`

#### Scenario: Pill for a disabled runtime
- **WHEN** a runtime has `enabled: false`
- **THEN** its pill reads "Disabled" regardless of whether the binary is installed

### Requirement: Runtime snapshot
The server SHALL maintain a snapshot — the only structure the UI reads for runtimes. Entry shape: `{runtimeId, kind, source, status, enabled, order, label, description, binary?: {path, source, version}, login?: {state, account?, checked_ms}, defaultModeId, modes[], features[], models[], capabilities, fetched_ms?, stale?, error?}`. `login.account` is at most a display name or masked e-mail (`a***@example.com`); tokens are never present. Snapshots are cached per resolved working directory plus one `global` scope used when the request has no `cwd`; at most 32 directory scopes are kept, least recently read evicted first. Wire: `jagentchill.runtime.snapshot.get {cwd?}` (scope `jagentchill.config.read`), `jagentchill.runtime.snapshot.refresh {cwd?, runtimeIds?}` (scope `jagentchill.agent.use`), event `jagentchill.runtime.updated {scope, runtimeIds[]}` on stream `runtime`; after a gap or reconnect the client pulls with `snapshot.get`. A snapshot read returns within 200 ms with whatever is cached (cold entries as `loading`) and never waits for a probe. Snapshot state is in memory and is rebuilt after a Gateway restart. [JAD JD-PRV-005] [NEW]

#### Scenario: Cold read
- **WHEN** a device calls `snapshot.get` for a directory never read before
- **THEN** the response arrives within 200 ms with every enabled runtime `loading`, probes start, and `jagentchill.runtime.updated` follows as each entry settles

#### Scenario: Per-directory models
- **WHEN** a project directory contains CLI settings that add a model for `claude-code`
- **THEN** the snapshot for that `cwd` lists the model and the `global` snapshot does not

#### Scenario: Reconnect
- **WHEN** a client reconnects after missing two `runtime.updated` events
- **THEN** it detects the `seq` gap and calls `snapshot.get`, and its UI matches the host state within 1 s

### Requirement: Snapshot refresh rules
A read SHALL probe only entries that are `loading` in the requested scope. An entry that is `ready`, `error` or `unavailable` stays cached and is not re-probed by reads, with these refresh triggers: (a) an explicit `snapshot.refresh` for named runtimes, one scope, or all; (b) a configuration change, which rebuilds the registry, marks changed entries `loading` while keeping their previous `models` and `modes`, and re-probes them; (c) the Gateway's `models.snapshot` event, which re-reads the catalogue of `builtin` only; (d) a login-only re-check (binary and login steps, no catalogue call) when the model browser opens and the selected runtime's `login.checked_ms` is older than 600 000 ms — JAgentDesk has no expiry, so a sign-out outside the app stays invisible there; (e) opening the model browser while the selected runtime is not `ready`, which refreshes that runtime only; (f) a turn failing with an authentication error, which marks that runtime `loading` and re-probes it. "Refresh all" from settings clears every scope and re-probes `global` only. Concurrent refreshes of the same runtime and scope are coalesced into one probe. No refresh is triggered by window focus or by a timer. [JAD JD-PRV-005] [NEW]

#### Scenario: Warm read does not spawn processes
- **WHEN** every enabled runtime is `ready` and a second device opens the model browser within 10 minutes
- **THEN** no CLI process is started and the response is served from the cache

#### Scenario: Stale login
- **WHEN** the model browser opens 11 minutes after the last login check of the selected runtime
- **THEN** only the binary and login steps run for that runtime, and the catalogue is not fetched again

#### Scenario: Retry from an error row
- **WHEN** the user presses "Retry" on a runtime in `error`
- **THEN** only that runtime is refreshed, the row shows "Retrying…" until it settles, and other rows do not flicker

### Requirement: Probe deadline
One runtime probe (binary, version, login, catalogue) SHALL run under a single deadline `probeTimeout_ms`, default 120 000, range 10 000–600 000, configurable in the runtime configuration. On expiry the server terminates the whole process tree it started for the probe — on macOS and Linux each probe child is started in its own process group and the group receives SIGTERM, then SIGKILL after 2 000 ms; on Windows each probe child is started in a job object and the server runs `taskkill /PID <pid> /T`, then `taskkill /PID <pid> /T /F` after 2 000 ms, and closes the job object so that no descendant survives — and sets `status: "error"` with `error.code: "runtime/probe-timeout"`, `error.step` naming the pending step (`resolve-binary`, `version`, `login-check`, `catalogue`, `acp-initialize`, `acp-session-new`) and the message "Timed out after <n> s while <step label>". At most 4 probes run concurrently per Gateway; further probes wait in order. [JAD JD-PRV-006] [NEW]

#### Scenario: Catalogue call hangs
- **WHEN** a CLI's model listing does not return within the deadline
- **THEN** the entry becomes `error` with `step: "catalogue"`, the message names that step, and no child process of the probe is left running

#### Scenario: Deadline out of range
- **WHEN** an update sets `probeTimeout_ms` to 5 000
- **THEN** the update fails with `INVALID_PARAMS` naming the range 10 000–600 000

#### Scenario: Deadline on a Windows host
- **WHEN** a probe of an `npx`-launched ACP agent exceeds the deadline on a Windows host
- **THEN** the shim, the Node process and its children are all gone within 2 000 ms of the forced termination, and the entry is `error` with `runtime/probe-timeout`

### Requirement: Launch environment
What the product can set for a runtime's child process depends on who launches it, and this requirement states each case as verified against the pinned OpenClaw source. **(a) Processes the server starts itself** (probes, diagnostics, and every launch through the product launch wrapper) SHALL receive the Gateway process environment (the environment the server gave the Gateway child process when it launched it, `server-api.Gateway supervision and lifecycle`) with these changes: (1) removed — every variable matching the deny patterns `OPENCLAW_*TOKEN*`, `OPENCLAW_GATEWAY_*`, `JAGENTCHILL_*`, the names of all secrets in `security-privacy.Host secret storage`, and the parent-agent-session markers `CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_SSE_PORT` and `CODEX_SANDBOX*`, so that a Gateway started from inside an agent CLI can still launch that CLI; (2) overlaid — the entry's `env`, with `{secret}` references resolved at launch and never logged. Variable names are matched case-insensitively on a Windows host and case-sensitively on macOS and Linux. **(b) The product launch wrapper** is the Node entry `server/bin/jagentchill-runtime-launch.mjs`, started with the Gateway's own Node binary on macOS, Linux and Windows (never a shell script, so that one implementation serves every host OS). It is what the server writes as `plugins.entries.acpx.config.agents.<id> {command: <node binary path>, args: [<wrapper path>, "--entry", <runtime entry id>]}` — the `acpx` agent entry accepts only `command` and `args` (`extensions/acpx/src/config-schema.ts:107-114`), so environment variables cannot be configured there and are applied by the wrapper: it reads the named entry from the server over a per-launch one-time token on loopback, applies rules (1) and (2), and executes the entry's real command with its arguments, forwarding stdio, exit code and termination. Custom ACP commands, community ACP agents and every custom profile that sets `env`, `command` or `proxy` are launched this way (`agent-runtimes.Custom runtime profiles`). **(c) The bundled CLI backends `claude-cli` and `google-gemini-cli`** are launched by their owning extensions: command, arguments and environment are plugin code (`docs/gateway/cli-backends.md`: "Command, argv, environment … mechanics are plugin code"; `agents.defaults.cliBackends` is a dead configuration key, `src/config/dead-config-keys.test.ts:62`), and each backend deletes endpoint and credential variables before launch (`extensions/anthropic/cli-constants.ts`: `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_CUSTOM_HEADERS` and others; `extensions/google/cli-backend-auth.runtime.ts`: `GEMINI_API_KEY`, `GOOGLE_GEMINI_BASE_URL`, `GEMINI_CLI_CUSTOM_HEADERS` and others). The product therefore sets no `env` and no `command` on `claude-code` and `gemini-cli` themselves: the Environment and Command fields are absent from their built-in rows with the note "The built-in <runtime> runtime always uses the CLI's own sign-in. To change its address, key or command, create a profile — it runs through ACP." **(d) The harness runtimes `codex` and `copilot`** are launched by their extensions; whether an entry `env` reaches their child process is not established by the pinned source and is gated by spike S27 (env and command delivery for the `codex` and `copilot` harnesses and for `acpx` custom agents through the wrapper); until S27 passes for a harness, and when it fails, that harness is treated as case (c). Keys enter a CLI runtime only through an `env` `{secret}` reference written by an admin on a wrapper-launched entry. [JAD JD-PRV-019, JD-PRV-020] [NEW]

#### Scenario: Gateway started inside an agent CLI
- **WHEN** the Gateway process has `CLAUDECODE=1` in its environment and a session starts on a custom profile that extends `claude-code`
- **THEN** the profile is launched through the wrapper and the child process environment does not contain `CLAUDECODE`

#### Scenario: Secret reference
- **WHEN** a profile has `env: {OPENROUTER_API_KEY: {secret: "OPENROUTER_API_KEY"}}`
- **THEN** the child receives the secret value, and neither the configuration document, the `acpx` agent entry, the diagnostics report, nor any log line contains it

#### Scenario: Gateway token is not inherited
- **WHEN** any CLI runtime process is launched through the wrapper
- **THEN** its environment contains no variable matching `OPENCLAW_GATEWAY_*`

#### Scenario: Built-in Claude Code row has no environment field
- **WHEN** an admin opens the built-in `claude-code` runtime in settings
- **THEN** no Environment or Command field is shown, and the stated note offers "Create a profile"

#### Scenario: Same wrapper on a Windows host
- **WHEN** a custom ACP command is added on a Windows host
- **THEN** its `acpx` agent entry has the Gateway's `node.exe` as `command` and the `.mjs` wrapper path as its first argument, and the agent starts with the entry's environment applied

### Requirement: Install hints
Each built-in runtime and catalogue entry SHALL carry `install {docsUrl, steps[]}` where each step is `{platform: "macos" | "windows" | "linux" | "any", command?, text}`. When a runtime is `runtime/not-installed`, its row and detail sheet show "Not installed on <host name>", the steps for the Gateway host's platform (commands in a monospace block with a Copy button), and "Open install guide" (the URL opens on the client device). The product SHALL NOT install, update or remove a CLI binary itself. When a runtime is `runtime/signed-out`, the hint is the sign-in command of that CLI and, for a device with role `admin` on a host with terminals enabled, a button "Open terminal on host" (scope `jagentchill.host.exec`) that opens a terminal through `workspaces-terminal.Terminal RPC surface and size ownership` with the command typed and not executed. [NEW]

#### Scenario: Not installed on a Linux host
- **WHEN** `codex` is missing on a Linux Gateway and the user opens its row on a phone
- **THEN** the sheet shows the Linux install step with Copy and an "Open install guide" link, and no install is attempted by the app

#### Scenario: Sign-in from the app
- **WHEN** an admin presses "Open terminal on host" for a signed-out `claude-code`
- **THEN** a host terminal opens with `claude` typed at the prompt and nothing is executed until the admin presses Enter

#### Scenario: Editor sees the hint without the terminal action
- **WHEN** a device with role `editor` opens the same row
- **THEN** the sign-in command is shown with Copy and the "Open terminal on host" button is absent

### Requirement: Diagnostics report
`jagentchill.runtime.diagnose {runtimeId}` (scope `jagentchill.config.write`) SHALL force a re-probe of that runtime in the `global` scope and return `{text, rows[], generated_ms}` where `rows` are `{label, value, level: "ok" | "warn" | "error" | "info"}` and `text` is the same content as plain text. Rows, in order: Runtime id; Gateway target; Command (configured and resolved, with source); Executable (yes/no); Version command and output; `PATH` directories searched (count, and the list in `text`); Login (state, masked account, the status command used and its exit code); Gateway readiness (`models.list` `available` and `unavailableReason` for the runtime); for ACP runtimes the `initialize` result (protocol version, agent name) and the `session/new` result; Models (count); Modes (ids); Capabilities (one line per flag); Environment (names of overlaid variables only, never values); Status; Last error with step; Duration. Collection is capped at max(`probeTimeout_ms`, 120 000 ms). Home directories are shown as `~`. The report never contains secret values, tokens or full e-mail addresses. [JAD JD-PRV-017] [NEW]

#### Scenario: Report for a signed-out CLI
- **WHEN** an admin runs the diagnostic for a signed-out `claude-code`
- **THEN** the rows show the resolved path, the version, "Login: signed out (claude auth status, exit 1)" at level `error`, and "Status: unavailable"

#### Scenario: Non-admin
- **WHEN** a device with role `editor` calls `jagentchill.runtime.diagnose`
- **THEN** the call fails with `SCOPE_DENIED`

### Requirement: Diagnostics sheet
The runtime detail SHALL offer "Diagnostic", opening a sheet titled "Diagnostic — <runtime label>" with the rows as a two-column list (level shown by an icon and a text label, not colour alone), buttons "Copy" (copies `text`) and "Refresh" (runs the diagnostic again), and the states "Running diagnostic…" (spinner; rows of the previous run stay visible and dimmed), "No diagnostic available" and "Failed to fetch diagnostic" with "Retry". Desktop and web: a 560 px side sheet; mobile: a full-height bottom sheet with the Copy and Refresh buttons in the header. The sheet is reachable by keyboard and closes with Escape. [JAD JD-PRV-017] [NEW]

#### Scenario: Copy
- **WHEN** the admin presses "Copy"
- **THEN** the clipboard holds the plain-text report and a toast "Diagnostic copied" appears for 3 s

#### Scenario: Refresh while open
- **WHEN** the admin signs in to the CLI on the host and presses "Refresh"
- **THEN** the Login row changes to "signed in" and the Status row to "ready" without closing the sheet

### Requirement: One-click ACP catalogue
The server SHALL bundle a static catalogue of ACP agents, returned by `jagentchill.runtime.catalogue.list {query?}` (scope `jagentchill.config.read`). It has two groups. **Gateway targets**: the 17 non-default `acp-*` runtimes of `agent-runtimes.Supported CLI runtimes and their Gateway targets` and `agent-runtimes.ACP target runtimes` (all 18 ACP targets except `acp-opencode`, which is enabled by default). **Community agents**: entries with ids `agoragentic-acp`, `amp-acp`, `auggie`, `autohand`, `cline`, `codebuddy-code`, `codewhale`, `cortex-code`, `corust-agent`, `crow-cli`, `deepagents`, `dimcode`, `dirac`, `factory-droid`, `gjc`, `glm-acp-agent`, `goose`, `grok`, `hermes`, `junie`, `minimax-code`, `minion-code`, `mistral-vibe`, `nova`, `poolside`, `sigit`, `stakpak` and `vtcode` (28 ids), stored in `server/data/acp-catalogue.json`. Every entry is `{id, title, description (≤ 200 chars), version, installUrl, command: [string, …string[]], env?, params?, group}`; the build fails when an entry lacks a field or names a third-party logo asset. Entries render with a generic glyph and the title text. "Add" on a Gateway target enables that runtime; "Add" on a community agent writes one configuration entry `{extends: "acp", label, description, command, env, params, enabled: true}`. "Add" never installs a binary; the card links "Install instructions" to `installUrl`. A command that uses a package runner (`npx -y <pkg>@<version> --acp`) is marked "Downloads on first launch" on the card and in the confirmation dialog. The list is searchable by title, id and description (case-insensitive substring), and already-added entries show "Added". [JAD JD-PRV-015] [NEW]

#### Scenario: Add a community agent
- **WHEN** an admin searches "goose" and presses "Add"
- **THEN** one configuration entry with `extends: "acp"` and the catalogue command is written, the runtime appears in the list as `loading`, and no package or binary is installed by the app

#### Scenario: Package-runner entry
- **WHEN** the admin adds an entry whose command starts with `npx -y`
- **THEN** a confirmation dialog states "This agent is downloaded from npm the first time it runs" with "Add" and "Cancel"

#### Scenario: No match
- **WHEN** the search text matches no entry
- **THEN** the list shows "No agents match your search" and a link "Add a custom ACP command"

### Requirement: Custom runtime profiles
An admin SHALL be able to create up to 20 custom profiles. A profile is a configuration entry with a new id and `extends: <builtin runtime id>`; it clones the base runtime's definition and applies: `label` (1–40 chars, required), `description` (0–200), `command` (replaces the base command; array of 1–32 strings), `env` (merged over the base env, profile wins; ≤ 32 variables, names `^[A-Za-z_][A-Za-z0-9_]{0,63}$`), `proxy` (`agent-runtimes.Proxy profiles for CLI runtimes`), `models` and `additionalModels` (see `agent-runtimes.Model overrides and additional models`), `disallowedTools` (concatenated with the base list, de-duplicated; ≤ 64 names), `enabled`, `order`. Extending an unknown id, or omitting `extends` on a non-built-in id, fails validation with `INVALID_PARAMS` and the path of the field.

How a profile is realised depends on what it overrides, and the profile's `realisation` field in the snapshot states it. **`native`** — a profile that overrides only `label`, `description`, `models`, `additionalModels`, `disallowedTools`, `enabled` or `order` runs on the base runtime's Gateway target and shows the base runtime's capability column. **`acp`** — a profile that sets `env`, `command` or `proxy` is never realised on the bundled backends `claude-cli` and `google-gemini-cli` (they discard those settings, `agent-runtimes.Launch environment`), nor on a harness for which spike S27 has not passed: it is an ACP runtime. The server projects it to `plugins.entries.acpx.config.agents.<profileId>` whose command is the product launch wrapper and whose real command is the profile's `command` when set, otherwise the ACP adapter command that `acpx.agents.list` reports for the base CLI's own ACP target (`claude` for `claude-code`, `gemini` for `gemini-cli`, `codex` for `codex`, `copilot` for `copilot`, `opencode` for `acp-opencode`), adds `<profileId>` to `acp.allowedAgents`, and starts sessions on the session path of `agent-runtimes.ACP target runtimes` (spikes S12, S22 and S24). An `acp` profile has the **ACP column** of `agent-runtimes.Published capability matrix`, not its base runtime's: no steer, no fork, JAgentChill tools only through the host-wide bridge, not eligible for team roles (`multi-agent-orchestration.Runtime eligibility for team roles`), and never `jcToolsOnly`. The profile editor and the profile's row show the caption "Runs through ACP: messages wait for the turn to end, and this profile cannot staff a team" whenever the realisation is `acp`, and saving a change that moves a profile from `native` to `acp` asks for confirmation with that text. A base runtime with no ACP target (`acp.*` community agents are already ACP) cannot be extended with `env` or `command` unless the profile supplies its own ACP-speaking `command`.

A profile's sessions, snapshot entry, usage records and models are labelled with the profile id. Deleting a profile referenced by an ORC profile, a workflow node or an automation is refused with `CONFLICT` and `details.references[]`; deleting one used by live sessions marks those sessions "Runtime removed" and requires a runtime switch before the next turn. [JAD JD-PRV-013] [NEW]

#### Scenario: Profile with a different endpoint
- **WHEN** an admin creates `claude-router` extending `claude-code` with `env {ANTHROPIC_BASE_URL: "https://router.example", ANTHROPIC_AUTH_TOKEN: {secret: "ROUTER_TOKEN"}}`
- **THEN** the profile has `realisation: "acp"`, an `acpx` agent entry `claude-router` launching the wrapper exists, the model browser lists "claude-router" as its own runtime with the ACP capability column and the caption "Runs through ACP", sessions on it start the Claude ACP adapter with the merged environment, and usage is reported under `claude-router`

#### Scenario: Label-only profile stays native
- **WHEN** an admin creates a profile extending `claude-code` that sets only a label and a replacement model list
- **THEN** the profile has `realisation: "native"`, runs on `agentRuntime: "claude-cli"` and shows the `claude-code` capability column

#### Scenario: Unknown base
- **WHEN** an update adds a profile with `extends: "claude"`
- **THEN** the update fails with `INVALID_PARAMS`, path `entries.<id>.extends`, message "Unknown runtime 'claude'"

#### Scenario: Delete a referenced profile
- **WHEN** the admin removes a profile that the `editor` ORC role uses
- **THEN** the removal is refused and the dialog lists the role with a link to it

### Requirement: Custom ACP command runtime
An admin SHALL be able to add any ACP-speaking CLI as a runtime with `extends: "acp"` and a required `command`. The server projects it to `plugins.entries.acpx.config.agents.<id> {command, args}` (through the launch wrapper of `agent-runtimes.Launch environment`) and adds `<id>` to `acp.allowedAgents`. JAgentChill tools are MCP tools of the server's tool endpoint (`server-api.Agent tool endpoint and session binding`), not OpenClaw plugin tools, so the `acpx` plugin-tools bridge (`plugins.entries.acpx.config.pluginToolsMcpBridge`) does not carry them and the server leaves it off. Whether they reach ACP agents is one host-wide setting, "Offer editor tools to ACP agents" (default on) in Settings ▸ Runtimes, not a per-runtime parameter: while it is on and at least one ACP runtime is enabled, the server makes its `mcp.servers.jagentchill` definition available to ACP sessions by the mechanism spike S8 confirms on the pinned tag — the pinned documentation states that ACP bridge mode accepts no per-session MCP server injection (`gateway/openclaw/docs/cli/mcp.md`), so the candidates under test are, in order, the `acpx` OpenClaw-tools bridge (`plugins.entries.acpx.config.openClawToolsMcpBridge`, `gateway/openclaw/docs/tools/acp-agents-setup.md`) exposing the Gateway's MCP-server tools, and a static MCP-server entry in the agent's own `acpx` configuration; when neither delivers `jc_*` tools whose calls the server can bind to their session (spike S23), every ACP runtime has `jcTools: "none"`. An agent that ignores MCP servers likewise has `jcTools: "none"` after its contract probe. `params` accepted: `supportsMcpServers` (boolean, default true), `clientCapabilities {fsRead, fsWrite, terminal}` (booleans, default all false; `fsWrite` and `terminal` can be turned on only for workspace agents). Modes, models and thinking options of such a runtime are whatever the agent reports at `initialize`/`session/new`. Missing `command` fails with `INVALID_PARAMS`. The start path and its spike gate are those of `agent-runtimes.ACP target runtimes`. [JAD JD-PRV-014] [NEW]

#### Scenario: Add a custom ACP CLI
- **WHEN** an admin adds id `my-agent` with command `["my-agent", "--acp"]`
- **THEN** the `acpx` agents map and `acp.allowedAgents` contain `my-agent`, and the runtime is probed with `initialize` and `session/new`

#### Scenario: Command missing
- **WHEN** an entry has `extends: "acp"` and no `command`
- **THEN** the update fails with `INVALID_PARAMS` and path `entries.<id>.command`

#### Scenario: Agent does not speak ACP
- **WHEN** the command exits or prints non-ACP output during `initialize`
- **THEN** the runtime becomes `error` with `step: "acp-initialize"` and the message includes the first 200 characters of the process output

### Requirement: Profile editor
Settings SHALL provide a form for creating and editing custom profiles and custom ACP commands; JAgentDesk has no such form and requires hand-editing a file. Fields: Base runtime (select of enabled built-ins plus "Custom ACP command"; fixed after creation), Id (auto-derived from the label, editable until first save), Label, Description, Command (one argument per chip, with a "Paste command line" action that splits by shell quoting rules), Environment (rows of name + either a plain value or a secret picker listing secret names from `settings-preferences.Host secrets settings`), ACP options (the three `params` groups, only for ACP), Models ("Use discovered models" or "Replace with this list"), Additional models, Disallowed tools, Enabled. "Test" runs the diagnostic against the unsaved form and shows its rows inline; "Save" is enabled only when validation passes. Unsaved changes prompt "Discard changes?" on close. On mobile the form is a full-screen page with a sticky Save bar. [NEW]

#### Scenario: Test before saving
- **WHEN** the admin fills a custom ACP command and presses "Test"
- **THEN** the diagnostic rows for that unsaved definition appear inline within the probe deadline and nothing is written to the configuration

#### Scenario: Plain value that looks like a key
- **WHEN** the admin types a 40-character token into a plain environment value
- **THEN** the row shows "This looks like a secret" with the action "Store as secret", and Save stays disabled until the value is stored as a secret or cleared

### Requirement: Model discovery
The catalogue of a runtime SHALL come from one discovery step that yields `{models[], modes[], defaultModeId}`. For `builtin`, the harness runtimes and the CLI backends, models are read from the Gateway's `models.list {view: "all", includeDetails: true, includeProviderCapabilities: true}` filtered to entries whose `agentRuntime` or `runtimeChoices[]` name the runtime's Gateway target; per-runtime fields are taken from the matching `runtimeChoices[]` element, not from the model's top level. For ACP runtimes, models are the model options advertised by the agent in `session/new`. A model entry is `{providerId, modelId, label, description?, isDefault, contextWindow?, contextWindows?[], input: ("text" | "image" | "audio" | "video" | "document")[], supportsTools, thinkingOptions[], defaultThinkingOptionId?, supportsFastMode, readiness, unavailableUntil_ms?, source: "discovered" | "configured" | "additional" | "custom"}`. Repeated `(providerId, modelId)` pairs are collapsed, first wins, and one warning line is logged per probe. A runtime that reports no model list exposes one entry `{modelId: "default", label: "Default model"}`. Model ids and defaults are never hard-coded in the product; defaults come from the enabled catalogue. [JAD JD-PRV-007] [NEW]

#### Scenario: Per-runtime capability
- **WHEN** a model is offered by both `builtin` and `codex` and only the `codex` runtime choice lists thinking level `xhigh`
- **THEN** the model's entry under `codex` has `xhigh` and its entry under `builtin` does not

#### Scenario: Duplicate ids
- **WHEN** a catalogue returns the same model id twice
- **THEN** the snapshot lists it once and the host log has one warning naming the runtime and id

#### Scenario: Agent reports no models
- **WHEN** an ACP agent advertises no model option
- **THEN** the runtime has one model "Default model" and the model browser shows no thinking control for it

### Requirement: Model overrides and additional models
Configuration `models` on a runtime entry SHALL replace discovery entirely: only the listed models are shown and, when the runtime also has static modes, no process is started for discovery. `additionalModels` SHALL be merged on top by `modelId`: a same-id entry updates the discovered model's `label`, `description`, `contextWindow` and `isDefault` in place; a new id is appended with `source: "additional"`; an `isDefault: true` in the additions clears every other default. An admin (scope `jagentchill.config.write`) can also add a custom model id from the runtime detail ("Add model" → "Add custom model", field "Model ID", 1–200 characters, no whitespace) and remove it; custom ids are stored in `additionalModels` with `source: "custom"`. The detail lists models under "Discovered" and "Custom models" with an "Updated <relative time>" stamp from `fetched_ms`. Limits: ≤ 200 configured and ≤ 50 additional models per runtime. [JAD JD-PRV-008] [NEW]

#### Scenario: Replacement list
- **WHEN** a profile sets `models` to two entries
- **THEN** exactly those two models are listed for the profile and no discovery process runs for it

#### Scenario: Relabel and set default
- **WHEN** `additionalModels` contains `{modelId: "sonnet", label: "Team default", isDefault: true}` and discovery reports `sonnet` and `opus` with `opus` as default
- **THEN** `sonnet` is shown as "Team default" and is the only default

#### Scenario: Custom id with spaces
- **WHEN** the admin enters "gpt 5" as a custom model id
- **THEN** the field shows "Model ID cannot contain spaces" and nothing is saved

### Requirement: Thinking options
Thinking options SHALL be per model and per runtime, read from the catalogue (`thinkingLevels[]`, `thinkingDefault`) and never hard-coded. Each option is `{id, label}`; canonical ids are those of the Gateway (`off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `adaptive`, `max`, `ultra`), and a runtime's native effort names are mapped onto them by the Gateway (`--effort` for `claude-cli`, `effort` / `reasoning_effort` / `thought_level` for ACP agents that advertise one, native effort for `codex`). A model with zero or one option exposes no thinking control. The option is applied with `sessions.patch {thinkingLevel}`; `null` restores the model default. The effective option read back from `sessions.describe` after the patch is the value stored and shown. A runtime for which the Gateway documents no thinking mapping (`gemini-cli`) exposes no options. [JAD JD-PRV-009] [NEW]

#### Scenario: Read-back differs
- **WHEN** the user picks `high` and the session reports `medium` after the patch
- **THEN** the control shows `medium` and a notice "This model applied Medium" is returned to the caller

#### Scenario: Single option
- **WHEN** the active model advertises only `off`
- **THEN** the model's `thinkingOptions` has one element and the composer shows no thinking control

### Requirement: Runtime modes catalogue
Each runtime SHALL publish `modes[]` with entries `{id, label, description, icon, colorTier: "safe" | "moderate" | "dangerous" | "planning", isUnattended, productMode?: "ask" | "plan" | "edit" | "auto"}` and a `defaultModeId` that is never an unattended mode. The product modes of `chat-agent.Composer modes` are mapped per runtime as follows; a product mode a runtime cannot honour is listed with `supported: false` and a reason.

| Runtime | Ask | Plan | Edit (default) | Auto | Unattended mode |
|---|---|---|---|---|---|
| `builtin` | `permissionMode: "read-only"` | `read-only` plus the server's plan gate | `guarded` | `workspace` | `full` |
| `claude-code` | `read-only` (host-enforced through the Gateway's tool-permission relay) | `read-only` plus plan gate | `guarded` | `workspace` | `full` (the Gateway launches the CLI with its bypass mode) |
| `gemini-cli` | not supported — "This runtime edits files without asking" | not supported — same reason | native `auto_edit` (fixed by the Gateway) | native `auto_edit` with `workspace` | none |
| `codex` | `read-only` | `read-only` plus plan gate | `guarded` | `workspace` | `full` |
| `copilot` | `read-only` | `read-only` plus plan gate | `guarded` | `workspace` | `full` |
| ACP runtimes | the agent's read-only or plan mode when it advertises one, otherwise not supported | ACP `set-mode plan` when advertised, otherwise not supported | ACP permission profile `approve-reads` | `approve-reads` with the server's auto-accept for JAgentChill tools | `approve-all` |

**Every session carries an explicit permission mode.** The server never sends `sessions.create` or a mode-changing `sessions.patch` without `permissionMode` (`server-api.Agent session relay`: a Gateway session without one runs host commands unasked). The table above is the mapping for workspace-class sessions: the cell's `permissionMode` (`read-only`, `guarded`, `workspace`, `full`) is sent on creation and on every mode change, and a row that names a native mode or an ACP permission profile additionally sends `guarded` as the Gateway-side value (`read-only` for an ACP agent's read-only or plan mode), so that the Gateway's own exec and file tools are never less restricted than the product mode. A creative-class session is `read-only` on the Gateway under all four product modes — it has no native exec or file tool to permit — and its product mode is enforced on `jc_*` tools by the server (`agent-editing-tools.Tool policy profile`). `full` is never set at creation: it is applied only by `agent-runtimes.Unattended modes and their warning`. Native modes reported at runtime by an ACP agent are appended after the mapped ones with `productMode` unset. What has been measured on a real run is the `claude-code` row for three values only (`docs/decisions/0002-own-server-gateway-sidecar.md` rows 13 and 15): no `permissionMode` → host commands run unasked; `read-only` → they are refused; `guarded` → under the run-profile policy `ask: "on-miss"` with an empty allowlist they raise an approval request (and are refused without one while `ask` is off). Every other cell — `workspace` and `full` on `claude-code`, and every mode of every other runtime — is a working value that spike S8 confirms or corrects per runtime, and a mode whose measured effect is weaker than its cell states is published `supported: false` with the reason "Not enforceable on this runtime" and is not selectable. `gemini-cli` Ask/Plan support and the `copilot` row are likewise working values of S8; the ACP row rests on the per-session `/acp permissions` and `/acp set-mode` controls of spike S24 and takes the fallbacks stated in `agent-runtimes.ACP target runtimes`; the published matrix always reflects the test result. Every mode change is applied by the server after its policy check, never by a device. Colour tiers: Ask and Plan `planning`, Edit `safe`, Auto `moderate`, every unattended mode `dangerous`. Tiers are rendered with the `design-system` status tokens together with an icon and a text label. [JAD JD-PRV-010] [NEW]

#### Scenario: Unsupported product mode is explained
- **WHEN** the session runtime is `gemini-cli`
- **THEN** the runtime's mode list has Ask and Plan with `supported: false` and the reason "This runtime edits files without asking", and `defaultModeId` maps to Edit

#### Scenario: Agent-reported native mode
- **WHEN** an ACP agent advertises modes `agent`, `plan` and `architect`
- **THEN** the mode list contains Plan mapped to `plan`, Edit, Auto, the unattended mode, and "architect" as an extra native mode with no product mapping

#### Scenario: Default is never unattended
- **WHEN** an ACP agent reports its own default mode as an allow-all mode
- **THEN** the runtime's `defaultModeId` is the Edit mapping, not the allow-all mode

#### Scenario: Explicit permission mode on every runtime
- **WHEN** workspace-class sessions are created in Edit mode on `builtin`, `claude-code`, `gemini-cli` and an ACP runtime, and a creative-class session is created in Auto mode on `builtin`
- **THEN** the four workspace `sessions.create` calls carry `permissionMode: "guarded"`, the creative one carries `permissionMode: "read-only"`, and none is sent without the field

#### Scenario: Mode change keeps an explicit value
- **WHEN** the owner of a `codex` workspace session switches from Edit to Auto and then to Ask
- **THEN** the server sends `sessions.patch` with `permissionMode` `workspace` and then `read-only`

### Requirement: Unattended modes and their warning
The mode flagged `isUnattended` is the runtime's no-prompt, most-permissive mode. Entering it SHALL require all of: a workspace-class session (creative agents have no unattended mode); a device with role `admin`; the call `jagentchill.session.unattended.set {sessionKey, enabled: true, confirm: true}` (scope `jagentchill.config.write`), which the server applies over its gateway link because `permissionMode: "full"` needs `operator.admin`. The UI SHALL show a confirmation dialog titled "Run without asking?" with the body "<runtime label> will run commands and change files on <host name> without asking. This applies to this session only." and the buttons "Cancel" (default focus) and "Run without asking"; JAgentDesk enters such modes with no confirmation, which is corrected here. While active, the session shows a persistent badge "Unattended" in the `dangerous` tier in the session header, on its sidebar row and on the composer mode control, on every device. The grant is per session, is never remembered as a device preference, is never a default in ORC profiles or host settings, and is cleared by a runtime switch, by session fork, by session import, and by a restart of the Gateway or of the server (`security-privacy.Workspace agent safeguards`). Every grant and revocation is written to the audit log of `server-api.Audit log` with action `session.unattended.set`. [NEW]

#### Scenario: Confirm and badge
- **WHEN** an admin selects the unattended mode on a `codex` session and confirms
- **THEN** the session's permission mode becomes `full`, the badge "Unattended" appears on the admin's desktop and phone within 1 s, and an audit record is written

#### Scenario: Editor attempts it
- **WHEN** a device with role `editor` calls `jagentchill.session.unattended.set`
- **THEN** the call fails with `SCOPE_DENIED` and the mode is unchanged; in the UI the unattended mode row is shown disabled with "Admin devices only"

#### Scenario: Cleared by restart
- **WHEN** the Gateway restarts while a session is unattended
- **THEN** after restart the session is in its runtime's default mode and the badge is gone

### Requirement: Unattended inheritance for agent-created agents
When an agent creates another agent (`multi-agent-orchestration.Tool jc_agent_create`), the order in which the child's mode is resolved — explicit mode, no parent, same runtime, different runtime, no modes, failure with `runtime/mode-not-inheritable` and the message "Cannot inherit mode '<parent mode>' on <target runtime>. Pass an explicit mode: <list>" — and the rule that a child is never more permissive than its parent are defined once in `multi-agent-orchestration.Child mode and permission inheritance`; this capability supplies the per-runtime mode lists that resolution reads (`agent-runtimes.Runtime modes catalogue`) and adds one rule: in every branch a child SHALL become unattended only when the root session of its tree holds an active unattended grant of `agent-runtimes.Unattended modes and their warning`; otherwise an unattended result is replaced by a failure with `runtime/unattended-not-granted`. With no parent session (a device or workflow caller) the target's unattended mode is used only when the creating device holds such a grant request. A child inherits the root's badge. [JAD JD-PRV-011] [NEW]

#### Scenario: Same runtime
- **WHEN** a `claude-code` agent in Plan creates a `claude-code` child without naming a mode
- **THEN** the child starts in Plan

#### Scenario: Cross-runtime without a mapping
- **WHEN** a `codex` agent in Edit creates an agent on an ACP runtime whose only modes are native ones with no Edit mapping
- **THEN** creation fails with `runtime/mode-not-inheritable` and the error lists the target's mode ids

#### Scenario: Unattended parent, ungranted root
- **WHEN** a child requests the unattended mode and the root session has no unattended grant
- **THEN** creation fails with `runtime/unattended-not-granted` and no agent is created

### Requirement: Session features
Each runtime SHALL publish `features[]`, each `{type: "toggle", id, label, description?, tooltip?, icon?, value: boolean}` or `{type: "select", id, label, description?, tooltip?, icon?, value: string | null, options: {id, label}[]}`. Features are per session and depend on the active model. The catalogue is: `fast_mode` — select with options from the model's fast-mode support (`off`, `on`, `auto`, `ultrafast`), shown only when `supportsFastMode` is true, applied with `sessions.patch {fastMode}`; `context_window` — select of the model's `contextWindows[]`, shown when there are two or more, applied with `sessions.patch {contextWindow}`; `usage_footer` — select `off | tokens | full`, applied with `sessions.patch {responseUsage}`; and, for ACP runtimes, one select per session configuration option the agent advertises (id `acp:<optionId>`), applied through the ACP session-config call. A feature can be changed while the session lives; setting a feature the runtime does not publish fails with `runtime/unsupported-capability` and the message "This runtime does not support <feature label>". Feature values are reset to defaults by a runtime switch and re-validated on a model change (values no longer offered fall back to the default, and the response lists them in `resetFeatures[]`). Every feature is set through `jagentchill.session.control.set` only, and the server applies the patch over its gateway link — `contextWindow`, `responseUsage` and tool overrides need the Gateway's administrator scope on `sessions.patch` and therefore rest on spike S12; when S12 fails, `context_window` and `usage_footer` are not published. ACP configuration options are confirmed by contract test S24; when the bridge does not surface them, no `acp:*` feature is published. [JAD JD-PRV-012] [NEW]

#### Scenario: Model-dependent feature
- **WHEN** the user changes from a fast-capable model to one without fast mode while `fast_mode` is `on`
- **THEN** `fast_mode` disappears from `features[]`, the session's fast mode is off, and the response lists `fast_mode` in `resetFeatures`

#### Scenario: Unsupported feature
- **WHEN** a client sets `fast_mode` on a runtime that publishes no such feature
- **THEN** the call fails with `runtime/unsupported-capability` and nothing changes

### Requirement: Direct provider list
`jagentchill.provider.auth.list` (scope `jagentchill.config.read`) SHALL return every model provider bundled in the pinned OpenClaw tag with `{providerId, label, description, docsUrl, choices: [{choiceId, kind, label, hint?, available, unavailableReason?}], connected, profiles[], pluginAllowed, overrideActive}`. `choiceId` is the manifest's auth-choice id and is passed verbatim to the Gateway as `authChoice`; it is never collapsed, because region, plan and tenant variants of one provider (`api-key-cn`, `api-global`, `oauth-cn`, `token-plan-ams`, `coding-global`, `device-enterprise`, `standard-api-key-cn` and the like) select different endpoints. `kind` is the closed enum `api-key | oauth | device-code | cli-login | setup-token | local | custom-endpoint | cloud-credentials` and decides only which form the app shows. The list and each provider's choices are generated at build time from the `providerAuthChoices` of the bundled provider manifests and are not hand-maintained; `kind` is derived from each manifest choice's method by the rule table `server/data/provider-auth-kinds.json` (`{<manifest method id or pattern>: kind}`, for example `entra-id` → `oauth`, `siwc` → `cli-login`, `existing-server` → `local`, `cloud-api-key` → `api-key`), and the build fails naming any manifest method the table does not map. Counts, grouping and upstream-bump behaviour are defined in `agent-runtimes.Provider coverage and grouping`. Each entry also carries `group` and, for aggregators, `catalogueSize`. Kinds as of the pinned tag, which the generated data must reproduce: OAuth for `openai`, `xai`, `openrouter`, `chutes`, `minimax-portal` and `radius`; device code for `github-copilot`, `openai` and `xai`; `anthropic` offers `api-key`, `setup-token` and `cli-login` and no browser OAuth; `google` offers `api-key` only; local providers `ollama`, `llama-cpp`, `apple-fm` and `copilot-proxy`; endpoint-style providers `lmstudio`, `vllm` and `sglang` (kind `custom-endpoint`), and `litellm` (API key with a base URL). **Cloud credentials.** The five cloud-platform providers `amazon-bedrock`, `amazon-bedrock-mantle`, `google-vertex`, `anthropic-vertex` and `azure-openai-responses` declare no `providerAuthChoices` — they authenticate with the cloud credentials present on the host (provider `auth: "aws-sdk"` and the equivalent) — so they are generated from the overlay id list of the pinned tag together with `server/data/cloud-providers.json` (`{<providerId>: {label, credentialSource, requiredSettings[] {key, label, example}, docsUrl}}`) and carry exactly one choice of kind `cloud-credentials`: the form shows "Uses the cloud credentials configured on <host name>", the provider's non-secret settings (region, project, resource name) and no key field; "Connect" calls `jagentchill.provider.auth.connectCloud {providerId, settings}` (scope `jagentchill.config.write`), which adds the provider plugin to `plugins.allow`, writes the settings and runs `models.probe`; the probe result decides `connected`. The product never reads, copies or stores a cloud credential. Connecting the first profile of a provider adds its plugin id to `plugins.allow` (see `generation-providers.Provider sources`); removing the last profile removes it. Within each group providers are listed alphabetically with connected ones first, and the list is searchable by label and id. [NEW]

#### Scenario: Anthropic choices
- **WHEN** an admin opens "Add provider" and chooses Anthropic
- **THEN** the offered choices are "API key", "Setup token" and "Use the Claude Code login on this host", and no browser sign-in is offered

#### Scenario: Region variants stay distinct
- **WHEN** a bundled manifest declares the choices `api-key` and `api-key-cn` for one provider
- **THEN** the list returns two choices of kind `api-key` with their own labels, and connecting with the second passes `authChoice: "api-key-cn"` to the Gateway

#### Scenario: Unmapped manifest method
- **WHEN** an upstream bump adds a manifest choice whose method is absent from `provider-auth-kinds.json`
- **THEN** the build fails naming the provider and the method

#### Scenario: Cloud platform provider
- **WHEN** an admin opens Amazon Bedrock on a host whose environment holds valid cloud credentials and presses "Connect" after entering a region
- **THEN** no key field was shown, the provider plugin is enabled, the probe passes and the provider is listed connected with its models

#### Scenario: Cloud credentials missing on the host
- **WHEN** the same action runs on a host without cloud credentials
- **THEN** the provider stays not connected with "No cloud credentials were found on <host name>" and a link to the provider's setup document

#### Scenario: Connecting loads the provider plugin
- **WHEN** the first profile for `openrouter` is saved
- **THEN** `plugins.allow` contains the `openrouter` provider plugin and its models appear under `builtin` after the next catalogue read

### Requirement: API key entry and validation
An API key SHALL never be an RPC parameter. The client sends it with the signed route `PUT /jagentchill/v1/secrets/{name}` (scope `jagentchill.secrets.manage`, see `server-api.Signed HTTP route surface`), then calls `jagentchill.provider.auth.setApiKey {providerId, choiceId?, secretName, profileId?, profileLabel?}` (scope `jagentchill.config.write`). The server reads the secret on the host and stores it as an OpenClaw auth profile. Two write paths exist because the Gateway RPC cannot name a profile: the **first** API-key profile of a provider is written with `models.authSetApiKey {provider, apiKey}` over the gateway link, which creates `<providerId>:default`; that RPC has no profile id and replaces the provider's existing API-key profile (`src/commands/models/auth-api-key.ts:93-109`), so it is never used again while one exists. Every **further** key, and the replacement of one named profile, is written as a **named auth profile** without any OpenClaw SDK call (the server loads no OpenClaw code): an `api_key` profile `<providerId>:<slug>` whose credential is a SecretRef (`keyRef: {source, provider, id}`, `gateway/openclaw/docs/gateway/authentication.md`) pointing at the server's secret file, written with `config.patch` over the gateway link; where spike S17 (c) shows the pinned tag does not accept that for a provider, the server instead runs the Gateway's own host command `openclaw models auth paste-token --provider <providerId> --profile-id <providerId>:<slug>` against the managed state directory with the key piped on standard input, never as an argument (`gateway/openclaw/docs/cli/models.md`). Either write is followed by `models.authOrderSet` so the new profile is in the provider's order (`agent-runtimes.Multiple auth profiles with order and rotation`, spike S17 (c)); the secret file remains the single place the value was entered and is shared with `generation-providers` when the same provider serves generation. While a base-URL override is active for the provider the key is saved only after the confirmation of `agent-runtimes.Base-URL override on bundled providers`. Validation runs before the profile is reported connected: `models.probe {provider, profileId, timeoutMs: 15000}`, called over the gateway link with the `operator.admin` scope (spike S12; when S12 fails the whole action reports `UNSUPPORTED_FEATURE` as stated in `agent-runtimes.Admin proxy and Gateway reuse`); results map to `ok` → connected, `auth` → "The provider rejected this key", `billing` → "The key is valid but the account has no credit" (profile kept, health `billing`), `rate_limit` → connected with health `rate_limited`, `timeout` and `unknown` → "Unable to reach the provider" with "Save anyway" and "Retry", `no_model` → "No model is available for this key", `format` → "Unexpected response from the provider". A rejected key (`auth`) is not kept: the auth profile and the secret are removed. The key field is a masked single-line input with a reveal toggle, accepts paste, trims surrounding whitespace, rejects values shorter than 8 or longer than 16 384 bytes, and is cleared from client memory after submission. Stored keys are shown as `••••<last4>` only when the value is at least 12 characters. [NEW]

#### Scenario: Valid key
- **WHEN** an admin pastes a valid key for `openai` and presses "Connect"
- **THEN** within 15 s the provider shows "Connected", one profile `openai:default` is listed with health `ok`, and the key value is not present in any RPC frame

#### Scenario: Rejected key
- **WHEN** the probe returns `auth`
- **THEN** the form shows "The provider rejected this key", no profile is listed, and the secret file is deleted

#### Scenario: Provider unreachable
- **WHEN** the probe times out
- **THEN** the form shows "Unable to reach the provider" with "Save anyway" and "Retry"; "Save anyway" stores the profile with health `unknown`

#### Scenario: Second key does not overwrite the first
- **WHEN** `openai:default` exists and an admin adds a second key labelled "Team B"
- **THEN** the profile `openai:team-b` is created as a named auth profile, `openai:default` still holds its own key, and the provider's order lists both

### Requirement: OAuth login through the admin proxy
Provider login SHALL be driven from the app through the server, because `models.authLogin` and `wizard.*` require `operator.admin`, which no device holds. Methods (all scope `jagentchill.config.write`): `jagentchill.provider.auth.login.start {providerId, choiceId, profileLabel?}` → `{loginId, step}`; `jagentchill.provider.auth.login.next {loginId, answer?}` → `{step}`; `jagentchill.provider.auth.login.status {loginId}` → `{step}`; `jagentchill.provider.auth.login.cancel {loginId}`. `loginId` is a 26-character upper-case ULID. The server calls `models.authLogin {sessionId, authChoice}` and `wizard.next | wizard.status | wizard.cancel` over its gateway link with the `operator.admin` scope and translates each wizard step into one of: `{kind: "open-url", url, instructions}`, `{kind: "device-code", userCode, verificationUrl, expires_ms, intervalSec}`, `{kind: "enter-text", prompt, masked}` (for a pasted redirect URL or code), `{kind: "choose", prompt, options[]}`, `{kind: "progress", message}`, `{kind: "done", profileId}`, `{kind: "error", code, message}`. A login expires 600 000 ms after `start`; one login per provider runs at a time (a second `start` returns the existing `loginId` to the same device and `CONFLICT` to another device). Step payloads never contain access tokens, refresh tokens or authorisation codes issued to the host. `enter-text` answers are sent over the signed secret route under a single-use name `LOGIN_<loginId>` (32 characters, which satisfies the secret-name rule `^[A-Z][A-Z0-9_]{0,63}$` of `server-api.Secret write and read surface`) and are deleted on consumption. `login.start` for a provider with an active base-URL override fails with `runtime/override-not-allowed` (`agent-runtimes.Base-URL override on bundled providers`). Login events for a `loginId` are delivered only to the device that started it. The step protocol is gated by spike S9 and the administrator-scope call by S12; when S9 shows that a provider's wizard cannot be driven remotely, that method is listed for the provider with `available: false` and the note "Sign in on the host: run `openclaw models auth login`", and API key remains available. [NEW]

#### Scenario: Browser OAuth on desktop
- **WHEN** an admin starts OAuth for `openai` on the desktop app
- **THEN** the first step is `open-url`, the system browser opens it, and after the provider redirects the sheet advances to `done` and the profile is listed

#### Scenario: Expired login
- **WHEN** 10 minutes pass without completing the steps
- **THEN** `login.status` returns `{kind: "error", code: "runtime/login-expired"}`, the wizard session is cancelled on the Gateway, and the sheet offers "Start again"

#### Scenario: Editor cannot sign in a provider
- **WHEN** a device with role `editor` calls `login.start`
- **THEN** the call fails with `SCOPE_DENIED` and the provider page shows "Ask an admin device to connect this provider"

#### Scenario: Login advances through its steps
- **WHEN** an admin starts a login whose first step is `enter-text`, uploads the answer under `LOGIN_<loginId>` and calls `jagentchill.provider.auth.login.next {loginId}`
- **THEN** the next step is returned, the single-use secret no longer exists, and `login.cancel` at any step ends the wizard on the Gateway

### Requirement: Login hand-off per platform
The login sheet SHALL present steps by platform. **Desktop**: `open-url` opens the system browser through the main process (never an in-app webview) and the sheet shows "Waiting for sign-in…" with "Open again" and "Copy link"; when the flow needs the redirect URL pasted back, the sheet shows a field "Paste the address from your browser". **Web**: the URL opens in a new tab with `noopener`; if the pop-up is blocked the sheet shows a visible link "Open sign-in page". **Mobile**: when the provider offers `device-code`, that method is preselected and the sheet shows the user code in 28 px monospace with "Copy code", the verification URL with "Open", and a countdown to `expires_ms`; when the provider offers only browser OAuth, the sheet offers "Continue on a desktop device" — a list of the user's online paired devices with role `admin` on desktop or web; choosing one transfers the login (`jagentchill.provider.auth.login.transfer {loginId, toDeviceId}`), the target device receives a targeted notification "Finish signing in to <provider>" that opens the login sheet at the current step, and the phone shows "Continue on <device name>" until the login ends — and, as the alternative, "Open on this phone", which opens the URL in the system browser and shows the paste-back field. A transferred login belongs to the target device from that moment. While polling a device code the server polls at the provider's `intervalSec` and the sheet needs no user action after the code is entered at the provider. [NEW]

#### Scenario: Device code on a phone
- **WHEN** an admin phone starts login for `github-copilot`
- **THEN** the sheet shows the user code, "Copy code", "Open" and a countdown, and switches to "Connected" within one poll interval after the code is approved at the provider

#### Scenario: Hand off to desktop
- **WHEN** an admin phone starts OAuth for `openrouter` and picks the online desktop
- **THEN** the desktop shows a notification and opens the login sheet at the `open-url` step, and the phone shows "Continue on <desktop name>"

#### Scenario: No desktop online
- **WHEN** no other admin device is online
- **THEN** the hand-off list shows "No desktop device is online" and "Open on this phone" stays available

### Requirement: Multiple auth profiles with order and rotation
A provider SHALL support up to 8 auth profiles (`profileId` `<providerId>:<slug>`, slug `^[a-z0-9][a-z0-9-]{0,31}$` derived from the label, label 1–40 chars). `jagentchill.provider.auth.list` returns for each `{profileId, label, type: "api-key" | "oauth" | "device-code" | "cli-login" | "setup-token" | "cloud-credentials", choiceId, account?, keyHint?, health, lastProbe_ms, cooldownUntil_ms?, order}`. API-key profiles beyond the first are created by the named-profile write of `agent-runtimes.API key entry and validation`, because `models.authSetApiKey` replaces instead of adding; sign-in profiles are created by the Gateway's own login flow. The order is set with `jagentchill.provider.auth.order.set {providerId, profileIds[]}` (scope `jagentchill.config.write`), which calls `models.authOrderSet` over the gateway link; the first usable profile in order is used. Rotation is the Gateway's: on an overloaded or rate-limit error one rotation to the next profile of the same provider happens before the model fallback chain advances. Whether a second API-key profile written as a named auth profile is honoured — listed, ordered and rotated to on a 429 — on a bundled provider and on a custom provider id is point (c) of spike S17. When that point fails for a class of provider, that class has **one key per provider**: "Add another key" is absent there, a request to create a second API-key profile fails with `UNSUPPORTED_FEATURE` ("This host version supports one key per provider — add a second endpoint and link it as an equivalent"), and reliability comes from equivalent endpoints (`agent-runtimes.Failover across keys and endpoints`); the limit of 8 and its `QUOTA_EXCEEDED` apply only where the point passed. The settings list shows profiles in order with drag handles (keyboard: `Alt+Up` / `Alt+Down`), the badge "In use" on the profile that served the last turn, and "Cooling down until <time>" for a profile in cooldown. `jagentchill.provider.auth.test {providerId, profileId}` (scope `jagentchill.config.write`) runs the probe of `agent-runtimes.Auth profile health` for one profile. [NEW]

#### Scenario: Rotation on rate limit
- **WHEN** S17 (c) passed, profile 1 of `anthropic` returns a rate-limit error and profile 2 is healthy
- **THEN** the turn continues on profile 2 without a model change, the session shows the status line "Switched to account <profile 2 label>", and profile 1 shows "Cooling down until <time>"

#### Scenario: Reorder with the keyboard
- **WHEN** an admin focuses the second profile and presses `Alt+Up`
- **THEN** it becomes first, `models.authOrderSet` is called with the new order, and a screen reader announces "<label> moved to position 1 of 2"

#### Scenario: Ninth profile
- **WHEN** S17 (c) passed and a provider has 8 profiles and an admin adds another
- **THEN** the call fails with `QUOTA_EXCEEDED` naming the limit

#### Scenario: Host supports one key per provider
- **WHEN** S17 (c) failed for bundled providers and an admin opens a connected provider
- **THEN** "Add another key" is absent, a direct request for a second API-key profile fails with `UNSUPPORTED_FEATURE`, and the existing key was not replaced

### Requirement: Auth profile health
Each profile SHALL carry `health`: `ok`, `rate_limited`, `billing`, `auth_failed`, `expired`, `cooldown`, `unknown`. Health is updated by (a) `models.probe`, run on demand from the profile row ("Test") and automatically once after every Gateway start for profiles not probed in the last 24 h, at most 2 probes concurrently; (b) the outcome of real turns (an authentication failure sets `auth_failed`; a rate-limit sets `cooldown` with the Gateway's `unavailableUntil`); (c) `models.authStatus` for OAuth expiry. An OAuth profile within 24 h of expiry that the Gateway cannot refresh (`models.authRefresh` fails) becomes `expired` and raises the notification kind `provider.auth_expired` ("Sign in to <provider> again", `requiresAction`, delivered to devices with `jagentchill.config.write`; `notifications.Notification event catalogue`), once per profile until it is signed in again or removed. Two earlier warnings are raised as well: `provider.auth_expiring` once per profile per expiry, 72 hours before the expiry of a sign-in that cannot be renewed without the user (an OAuth, device-code or setup-token profile with no usable refresh), and `provider.auth_refresh_failed` once per profile when 3 consecutive refresh attempts failed or the provider rejected the refresh, both delivered to devices with `jagentchill.config.write` with the action "Sign in again" (`notifications.Notification event catalogue`). A provider whose every profile is `auth_failed`, `expired` or `billing` reports its models with readiness `needs-auth`. Health is shown with an icon and text, never colour alone. [NEW]

#### Scenario: Token refresh fails
- **WHEN** the Gateway cannot refresh an OAuth profile
- **THEN** the profile shows "Expired — sign in again" with a "Sign in" button that starts the login for that profile, and admins receive one notification

#### Scenario: Manual test
- **WHEN** an admin presses "Test" on a profile
- **THEN** the row shows "Testing…" and then the mapped result with the time of the test, within 15 s

#### Scenario: Expired OAuth profile notifies admins
- **WHEN** an OAuth profile expires and `models.authRefresh` fails
- **THEN** one `provider.auth_expired` notification is raised to admin devices with the action "Sign in again", and no second one is raised for that profile while it stays expired

#### Scenario: Sign-in about to expire
- **WHEN** a device-code profile that cannot be refreshed reaches 72 hours before its expiry
- **THEN** one `provider.auth_expiring` notification is raised for that profile, and no second one is raised for the same expiry

#### Scenario: Refresh keeps failing
- **WHEN** `models.authRefresh` fails 3 consecutive times for an OAuth profile
- **THEN** one `provider.auth_refresh_failed` notification is raised with the action "Sign in again"

### Requirement: Sign out and credential removal
`jagentchill.provider.auth.logout {providerId, profileIds?}` (scope `jagentchill.config.write`) SHALL call `models.authLogout` over the gateway link, delete the matching secret files, and remove the provider's plugin from `plugins.allow` when no profile and no generation capability remain. The UI asks "Remove <profile label>? Sessions using <provider> will need another account or provider." with "Remove" and "Cancel". Running turns on the removed profile finish or fail on their own; the next turn uses the next profile in order or fails with `runtime/signed-out`. Removal is recorded in the audit log by profile id only. [NEW]

#### Scenario: Remove the only profile
- **WHEN** the last profile of `xai` is removed
- **THEN** `xai` models show readiness `needs-auth` in the model browser, and a session pinned to an `xai` model shows "Connect xAI or choose another model" above its composer

#### Scenario: Remove one of two
- **WHEN** one of two `openai` profiles is removed while a turn is idle
- **THEN** the next turn runs on the remaining profile with no error

### Requirement: Custom endpoints as direct providers
An endpoint record of `agent-runtimes.Shared endpoint record` with the `llm` capability SHALL appear in `jagentchill.provider.auth.list` with method `custom-endpoint`, in group Custom, and in the model browser under runtime `builtin` with provider label = the endpoint label and one entry per enabled model. Such a provider always runs on `builtin` and is never routed to a harness runtime (the Gateway keeps custom endpoints on its own runtime so their transport settings apply). API proxies, relays, routers and gateways are first-class here: they are created from presets (`agent-runtimes.Endpoint presets`), speak one of the verified dialects (`agent-runtimes.Verified API dialects`), have their own model list, capability overrides, pricing, health, failover and attribution as defined in the requirements of those names, and are managed with `jagentchill.provider.endpoint.list | get | upsert | remove | duplicate | discover | test | export | import`. An endpoint whose enabled models all have `supportsTools: false` is listed with the note "No tools — chat only" and cannot be selected for an agent that requires JAgentChill tools. The contract between an endpoint record and the Gateway's custom-provider behaviour is verified by spike S17 (`agent-runtimes.Custom endpoint verification spike`). [NEW]

#### Scenario: Local endpoint
- **WHEN** an admin adds `http://127.0.0.1:1234/v1` with "Allow unencrypted connection on a private network" on and two models
- **THEN** both models appear under Built-in with the endpoint's label, and a session on one of them runs on the `openclaw` runtime

#### Scenario: Tool-less model
- **WHEN** an endpoint model has `supportsTools: false` and the user tries to select it for `jagentchill-editor`
- **THEN** the row is disabled with "This model cannot use tools" and the selection is unchanged

#### Scenario: Two relays side by side
- **WHEN** two endpoints created from the same preset serve the same model id
- **THEN** the model browser lists the model once under each endpoint label and a session can use either

### Requirement: Credential storage on the host only
Provider credentials SHALL exist only on the Gateway host: API keys and header values as owner-only secret files per `security-privacy.Host secret storage`, and auth-profile secrets (keys, OAuth tokens) in OpenClaw's own auth-profile store. No credential is stored on a client device, sent to a client, written to the runtime configuration document, included in snapshots, diagnostics, exports or backups of the server configuration, or passed to another device during login hand-off. Client-visible fields are limited to `keyHint` (last 4 characters, only for values ≥ 12 characters), masked `account`, `health` and timestamps. CLI runtime credentials are owned by the CLI and are never read by the server (see `agent-runtimes.Login and health check`). The server makes no encryption-at-rest claim for these stores; the settings page states "Stored on <host name>, protected by file permissions". [NEW]

#### Scenario: Snapshot contains no secret
- **WHEN** a test scans every `jagentchill.runtime.*` and `jagentchill.provider.auth.*` response and event for a connected provider
- **THEN** no response contains the key, a token, or more than the last 4 characters of the key

#### Scenario: Phone lost
- **WHEN** an admin phone that connected three providers is revoked
- **THEN** all three providers stay connected on the host and nothing needs rotating because the phone never held a credential

### Requirement: Provider coverage and grouping
The direct-provider list SHALL cover every model provider bundled in the pinned OpenClaw tag and SHALL be generated at build time from the bundled plugin manifests (`gateway/openclaw/extensions/*/openclaw.plugin.json`, key `providerAuthChoices`), never from a hand-written list. In the pinned tag (2026.9.8 @ `0816aa1b`) 60 bundled manifests declare 95 auth choices in 57 provider groups; the generated data must reproduce those three numbers, and a build check fails when the generated list and the manifests disagree. A provider bundled by a newer upstream tag appears in the list after the tag is raised and the data regenerated, with no change to product code. The manifests carry no router or aggregator marker (their `categories` are only `models` and `media`), so grouping is product data in `server/data/provider-groups.json` (`{<providerId>: {group, docPath}}`), each entry citing the upstream provider document it was derived from. The UI groups, in this order: **First-party** (the default group for any provider id absent from the data file, for example `anthropic`, `openai`, `google`, `xai`, `mistral`, `deepseek`); **Aggregators and routers** — providers whose upstream document describes one key or endpoint in front of several upstream model providers: `openrouter`, `clawrouter`, `kilocode`, `litellm`, `cloudflare-ai-gateway`, `vercel-ai-gateway`, `opencode`, `opencode-go` and `deepinfra`; **Cloud platforms** — `amazon-bedrock`, `amazon-bedrock-mantle`, `google-vertex`, `anthropic-vertex`, `microsoft-foundry`, `azure-openai-responses` (only `microsoft-foundry` is among the 60 manifests; the other five declare no auth choice and are added from the overlay id list with the single `cloud-credentials` choice of `agent-runtimes.Direct provider list`, so the generated list holds the 57 manifest groups plus these five entries); **Local runtimes** — `ollama`, `llama-cpp`, `lmstudio`, `vllm`, `sglang`, `apple-fm`, `copilot-proxy`; **Custom** — endpoint records of `agent-runtimes.Shared endpoint record`. An admin can move a provider to another group in settings (the `providerGroups` map of `agent-runtimes.Runtime configuration store`, written with `jagentchill.runtime.config.update`), which changes presentation only. Each group header shows "<connected> of <total>"; search matches label, id and group name across groups. [NEW]

#### Scenario: Counts match the pinned tag
- **WHEN** the provider data is generated against the pinned tag
- **THEN** it contains 95 auth choices in 57 groups from 60 manifests and the build check passes

#### Scenario: Upstream adds a provider
- **WHEN** the pinned tag is raised to one that bundles a new provider plugin and the data is regenerated
- **THEN** the provider appears under First-party with its auth methods and no source file of the product was edited

#### Scenario: Grouped list
- **WHEN** an admin opens "Add provider"
- **THEN** OpenRouter, ClawRouter, Kilo Gateway, LiteLLM, Cloudflare AI Gateway, Vercel AI Gateway, OpenCode, OpenCode Go and DeepInfra are listed under "Aggregators and routers", and a search for "router" returns that group's matches

### Requirement: Verified API dialects
The dialect of an endpoint SHALL be one of the values OpenClaw accepts in `models.providers.<id>.api`. The pinned tag accepts exactly twelve (`packages/llm-core/src/model-data.ts:2-15`, enforced by the enum at `src/config/zod-schema.core.ts:157`): `openai-completions`, `openai-responses`, `openai-chatgpt-responses`, `anthropic-messages`, `google-generative-ai`, `google-interactions`, `google-vertex`, `github-copilot`, `bedrock-converse-stream`, `ollama`, `pi-messages`, `azure-openai-responses`. Custom endpoints offer five of them, with these consequences shown in the form next to the dialect select:

| Dialect (label) | `api` value | Tools | Vision | Thinking mapping | Streaming and usage |
|---|---|---|---|---|---|
| OpenAI Chat Completions | `openai-completions` | function calling when the model's `compat.supportsTools` is true; `strict` and JSON-schema response format off unless declared | per model `input` | `reasoning_effort` when `compat.supportsReasoningEffort` is true, shaped by `compat.thinkingFormat` (`openai`, `openrouter`, `deepseek`, `together`, `qwen`, `qwen-chat-template`, `zai`) | SSE; usage through `stream_options.include_usage` unless `compat.supportsUsageInStreaming` is false; on non-OpenAI hosts the `developer` role, `service_tier`, `store` and prompt-cache hints are never sent |
| OpenAI Responses | `openai-responses` | yes | per model `input` | reasoning effort | SSE; stored continuation only with `compat.supportsResponsesContinuation` |
| Anthropic Messages | `anthropic-messages` | yes | per model `input` | extended thinking budget; must fit the model's `maxTokens` | SSE; implicit Anthropic beta headers are suppressed on any host other than the public Anthropic API and are sent only when set in `headers["anthropic-beta"]`; cache markers with `compat.cacheControlFormat: "anthropic"` |
| Google Generative AI | `google-generative-ai` | yes | per model `input` | thinking levels from `thinkingLevelMap` | SSE |
| Ollama native | `ollama` | yes (the `/v1` OpenAI-compatible Ollama URL is refused in the form with "Use the native URL without /v1 — tool calling breaks on /v1") | per model `input` | per model | native stream |

The remaining seven values belong to bundled providers and are not selectable for a custom endpoint. Selecting a dialect sets the defaults of the per-model capability overrides; it never claims a capability the endpoint was not tested or declared to have. A dialect added by a newer upstream tag becomes selectable only after it is added to this table. [NEW]

#### Scenario: Dialect list is checked against the Gateway
- **WHEN** the build runs against the pinned tag
- **THEN** a check confirms that the five offered `api` values are members of the Gateway's dialect enum and fails naming any that is not

#### Scenario: Anthropic-compatible proxy
- **WHEN** an endpoint uses dialect Anthropic Messages on a host that is not the public Anthropic API
- **THEN** the form states "Beta headers are not sent automatically — add `anthropic-beta` under Headers if your proxy needs them"

#### Scenario: Ollama with /v1
- **WHEN** an admin enters `http://127.0.0.1:11434/v1` with dialect Ollama native
- **THEN** the form refuses the URL with the stated message and offers "Remove /v1"

### Requirement: Shared endpoint record
A custom endpoint — a proxy, relay, router, gateway or self-hosted model server — SHALL be one record owned by this capability and referenced, not redefined, by `generation-providers` (see `agent-runtimes.Endpoint contract for generation capabilities`). Records live under the key `endpoints.<endpointId>` of the server configuration (`<dataDir>/config.json`) with the shape: `{id (^[a-z][a-z0-9-]{1,39}$, unique across bundled provider ids and endpoints), label (1–40), presetId?, presetVersion?, baseUrl, dialect, auth: {mode: "none" | "bearer" | "header", secretName?, headerName?, prefix?}, headers?: {<name>: string | {secret}} (≤ 16), query?: {<name>: string | {secret}} (≤ 8), tls?: {caSecretName?, serverName?, allowSelfSigned: boolean, clientCertSecretName?, clientKeySecretName?}, allowPrivateNetwork: boolean, outboundProxy?: {mode: "env" | "explicit", url?}, timeoutSeconds (5–3 600, default 120), maxConcurrency (1–64, default 4), modelSource: "discover" | "manual" | "discover-and-manual", models: EndpointModel[], capabilities: ("llm" | "image" | "video" | "tts" | "transcription" | "music" | "sfx" | "voice-design" | "lipsync" | "stock-media" | "translation")[], enabled, order, notes? (≤ 500), created_ms, updated_ms}`. Secret names match `^[A-Z][A-Z0-9_]{0,63}$` (the rule of `security-privacy.Host secret storage`); a name that does not match is refused with `INVALID_PARAMS`. Secret values are never in the record: every credential, secret header, secret query value, CA bundle and client key is a named secret written through the signed secret route of `server-api.Signed HTTP route surface`, and no secret value is ever written in clear into the Gateway configuration (`openclaw.json`), its snapshots or backups, or a log line. The server projects an `llm` endpoint into the Gateway configuration as `models.providers.<id>`: `baseUrl`, `api` = dialect, `apiKey` or `request.auth` (`authorization-bearer` or `header {headerName, value, prefix}`; `authHeader: false` for mode `none`), `headers`, `request.tls {ca, serverName, insecureSkipVerify, cert, key}`, `request.allowPrivateNetwork`, `request.proxy`, `timeoutSeconds` and `models[]` — every secret as a Gateway file SecretRef, all of which the provider schema accepts (`src/config/zod-schema.core.ts:164-221`, `:320-355`). A custom provider must declare both `baseUrl` and `models` (`:359-381`), so an endpoint with no model is stored but not projected and reports "Add at least one model". Two fields have no Gateway equivalent in the pinned tag and are therefore server-enforced: `query` and `maxConcurrency`. **`query`**: the projected `models.providers.<id>.baseUrl` is a plain string in the Gateway schema (`src/config/zod-schema.core.ts:327`), not a secret input like `apiKey` and `headers` (`:328`, `:349`), so only **literal** (non-secret) query values are appended to the projected `baseUrl` — whether the Gateway preserves a query string when it joins request paths is point (b) of spike S17, and when it does not, literal `query` values are honoured for the server's own calls only and the form states "Not applied to agent chat on this host version". A `{secret}` query value is **never** projected: it is applied only by the server's own endpoint client at request time, and an endpoint that has a `{secret}` query value cannot have the `llm` capability — saving it is refused with `INVALID_PARAMS` and "This endpoint needs its key in the address — agent chat cannot use it; put the key in a header"; the same endpoint is accepted for non-`llm` capabilities, whose calls the server makes itself. The server's endpoint client redacts every query value in logs, diagnostics, error details and audit records. Secret `headers` are projected only as Gateway file SecretRefs, which the schema accepts for that field. **`maxConcurrency`**: enforced exactly for calls the server makes — generation jobs, workflow and team runs it starts — and, for interactive agent turns, as an admission check in `jagentchill.chat.send` before the Gateway is called (every turn passes that method, `chat-agent.Agent sessions run on Gateway sessions`); provider-side limits are normalised by `agent-runtimes.Endpoint error normalisation`. At most 40 endpoint records exist per Gateway. [NEW]

#### Scenario: Header-authenticated relay
- **WHEN** an admin saves an endpoint with `auth {mode: "header", headerName: "x-api-key", secretName: "RELAY_KEY"}`
- **THEN** the Gateway provider entry has `request.auth {mode: "header", headerName: "x-api-key"}` with a file SecretRef as value, and the configuration document, every RPC response and every log line are free of the key

#### Scenario: Endpoint without models
- **WHEN** an endpoint is saved with an empty model list and discovery returned nothing
- **THEN** the record is stored, nothing is written under `models.providers`, and its row shows "Add at least one model"

#### Scenario: Id collides with a bundled provider
- **WHEN** an admin names an endpoint `openrouter`
- **THEN** the save fails with `ALREADY_EXISTS` and the form suggests `openrouter-2`

#### Scenario: Secret query value on a chat endpoint
- **WHEN** an admin saves an endpoint with capability `llm` and `query: {key: {secret: "RELAY_KEY"}}`
- **THEN** the save fails with `INVALID_PARAMS` and the stated message, and nothing is written under `models.providers`

#### Scenario: Secret query value on a media endpoint
- **WHEN** an endpoint with only the capability `image` has `query: {key: {secret: "IMG_KEY"}}` and an image is generated
- **THEN** the server's endpoint client adds the parameter to the request, and a scan of `openclaw.json`, the server configuration document and the host log finds no occurrence of the key value

#### Scenario: Literal query value
- **WHEN** an `llm` endpoint has `query: {"api-version": "2026-01-01"}` and S17 (b) passed
- **THEN** the projected `baseUrl` ends with `?api-version=2026-01-01`

### Requirement: Endpoint model list and discovery
Models of an endpoint SHALL come from discovery, manual entry, or both. `jagentchill.provider.endpoint.discover {endpointId | draft}` (scope `jagentchill.config.write`) calls, from the Gateway host with the endpoint's auth, headers, query, TLS and timeout, the model-list route of the dialect: OpenAI dialects `GET <baseUrl>/models`; Anthropic Messages `GET <baseUrl>/v1/models` (or `<baseUrl>/models` when `baseUrl` already ends in `/v1`); Google Generative AI `GET <baseUrl>/v1beta/models`; Ollama native `GET <baseUrl>/api/tags`; a preset can override the path. The response is capped at 8 MiB and 5 000 models and parsed leniently (a `data[]` or `models[]` array of objects with `id` or `name`); fields the route reports — context length, modalities, tool support, pricing — prefill the model's capability overrides and are marked "From endpoint". Discovery never overwrites a field the admin edited. When the route is absent (404/405), needs different auth, or returns an unparseable body, discovery ends with the reason shown and the form switches to manual entry ("Add model": Model ID 1–200 characters, display name). With `discover-and-manual`, manual models are kept and discovered ones are refreshed on "Refresh models" and at most once per 24 h while the endpoint is in use; models that disappear upstream are kept and flagged "No longer listed" rather than deleted. An endpoint lists at most 2 000 models, of which only those the admin enabled (default: the first 50 by name, or all when fewer) are projected into the Gateway and shown in the model browser. [NEW]

#### Scenario: Relay with a model list
- **WHEN** an OpenAI-compatible relay answers `/models` with 120 entries
- **THEN** 120 models are listed with "From endpoint" metadata, 50 are enabled by default, and the admin can enable more

#### Scenario: No model-list route
- **WHEN** the endpoint answers 404 for the model-list route
- **THEN** the form shows "This endpoint has no model list — add models by ID" and the manual field is focused

#### Scenario: Model removed upstream
- **WHEN** a refresh no longer returns a model that an ORC profile uses
- **THEN** the model stays in the record flagged "No longer listed" and the profile shows a warning, not a broken reference

### Requirement: Per-model capability overrides and aliases
Each `EndpointModel` SHALL be `{id (the id sent upstream), alias? (1–60; unique within the endpoint), label, enabled, contextWindow? (1 024–10 000 000), maxOutputTokens?, input: ("text" | "image" | "audio" | "video")[], supportsTools, supportsStrictTools?, reasoning: boolean, reasoningEfforts?: string[], thinkingLevelMap?, thinkingFormat?, maxTokensField?: "max_tokens" | "max_completion_tokens", usageInStreaming: boolean (default true), extraBody?: object (≤ 8 KiB), headers?, pricing?, equivalents?: {endpointId, modelId}[] (≤ 4), source: "discovered" | "manual", editedFields[]}` and is projected to the Gateway model definition fields `id`, `name`, `contextWindow`, `maxTokens`, `input`, `reasoning`, `thinkingLevelMap`, `headers`, `cost`, and `compat {supportsTools, supportsStrictMode, supportedReasoningEfforts, thinkingFormat, maxTokensField, supportsUsageInStreaming}` (`src/config/zod-schema.core.ts:248-304`, `src/config/zod-schema.model-compat.ts`). `alias` is written to `agents.defaults.models["<endpointId>/<modelId>"].alias` and is what pickers show; `extraBody` is written to that entry's `params.extra_body`, the Gateway's documented channel for vendor-specific request fields on OpenAI-compatible proxies. Defaults when a field is unset follow the Gateway: text-only input, no reasoning, no fixed output limit, and a 200 000-token context budget; the form shows these effective defaults in placeholder text and marks a model with no declared context window "Context size assumed". `reasoningEfforts` become the model's thinking options of `agent-runtimes.Thinking options`. A model with `supportsTools: false` is "chat only" and cannot serve an agent that needs JAgentChill tools. Bulk edit applies one override to all selected models. [NEW]

#### Scenario: Alias
- **WHEN** an admin sets alias "Fast local" on model `qwen3.5:27b`
- **THEN** the model browser shows "Fast local", the upstream request still carries `qwen3.5:27b`, and usage is recorded under the real id with the alias as label

#### Scenario: Declared reasoning efforts
- **WHEN** a model declares `reasoningEfforts: ["low", "high"]`
- **THEN** the composer offers exactly Low and High for it

#### Scenario: Unknown context size
- **WHEN** a manual model has no `contextWindow`
- **THEN** the model row shows "Context size assumed (200,000)" and the context meter is labelled "assumed"

### Requirement: Endpoint connection test
`jagentchill.provider.endpoint.test {endpointId | draft, modelId?}` (scope `jagentchill.config.write`) SHALL run real requests from the Gateway host and return a step report `{steps: [{id, status: "pass" | "fail" | "skipped", latency_ms?, detail}], summary}` within 60 s. Steps, in order: `resolve` (DNS and the address class — loopback, private, tailnet or public); `connect` (TCP and TLS, reporting certificate subject, issuer and whether the chain validated against system roots, the custom CA, or was accepted as self-signed); `auth-and-models` (the model-list call); `completion` (a minimal real completion of at most 16 output tokens on the chosen or first enabled model — through the Gateway's `models.probe` once the endpoint is saved, and through the server's own minimal client for the selected dialect while it is an unsaved draft — reporting time to first token and total time); `streaming` (whether tokens arrived incrementally); `usage` (whether token usage was returned); `tool-call` (one turn offering a single no-op tool and requiring its use, run over the gateway link as a one-shot run with a model override; pass means a well-formed tool call came back); `vision` (only when the model declares image input: a 64×64 test image). A failing step does not stop independent steps. The dialog states before running: "This sends a few small real requests to <host> and can use a small number of tokens." Results are stored on the record as `lastTest {at_ms, steps}` and feed capability hints: a failed `tool-call` offers "Mark this model as chat only", a failed `usage` offers "Turn off usage in streaming". The `tool-call` step depends on one-shot Gateway runs with a model override (spikes S12 and S17); when unavailable it reports `skipped` with "Not tested on this host version". The test never logs request or response bodies. [NEW]

#### Scenario: Working relay
- **WHEN** an admin presses "Test connection" on a healthy OpenAI-compatible relay
- **THEN** the report shows every step passed with latencies, time to first token, and "Tools: working"

#### Scenario: Tools do not work
- **WHEN** the completion passes and the model answers the tool probe with plain text
- **THEN** `tool-call` is `fail` with "The model replied in text instead of calling the tool" and the dialog offers "Mark this model as chat only"

#### Scenario: Wrong dialect
- **WHEN** the endpoint speaks Anthropic Messages and the record says OpenAI Chat Completions
- **THEN** `completion` fails with `runtime/dialect-mismatch` and the hint "This endpoint answered like an Anthropic-compatible API — change the dialect"

### Requirement: Endpoint presets
The server SHALL ship presets as data, `server/data/endpoint-presets.json`, each `{presetId, version (integer), label, description, kind: "bundled-provider" | "custom-endpoint" | "media-endpoint" | "stock-source", bundledProviderId?, baseUrlTemplate, variables[] {name, label, example, required}, dialect, auth, headers?, modelListPath?, modelSource, capabilities[], media?: {<capability>: {template, custom?, stock?}}, models?: EndpointModel[], docsUrl, notes, verified: {by: "openclaw-docs" | "vendor-docs", ref}}`. Shipped presets: OpenRouter (`kind: "bundled-provider"`, `openrouter`); LiteLLM (`bundled-provider`, `litellm`; `http://localhost:4000`, OpenAI Chat Completions); Cloudflare AI Gateway (`bundled-provider`, `cloudflare-ai-gateway`; template `https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/anthropic`, optional secret header `cf-aig-authorization`); Vercel AI Gateway (`bundled-provider`, `vercel-ai-gateway`; `https://ai-gateway.vercel.sh`, Anthropic Messages compatible, models from `/v1/models`); Ollama (`bundled-provider`, `ollama`; native dialect, `http://127.0.0.1:11434`); LM Studio (`bundled-provider`, `lmstudio`; `http://localhost:1234/v1`); vLLM (`bundled-provider`, `vllm`; `http://127.0.0.1:8000/v1`); 9router (`custom-endpoint`); Generic OpenAI-compatible (`custom-endpoint`, OpenAI Chat Completions, bearer auth, `<baseUrl>/models`); Generic Anthropic-compatible (`custom-endpoint`, Anthropic Messages, header auth `x-api-key`). Values of the first seven are taken from the upstream provider documents of the pinned tag and carry `verified.by: "openclaw-docs"`. The 9router preset describes 9router as documented by its own project (repository `decolua/9router`, `README.md` and `docs/ARCHITECTURE.md`, read 2026-10-05): a user-run local routing gateway that exposes one OpenAI-compatible surface under `/v1` on port 20128 by default and issues its own API key in its dashboard. Preset values: `baseUrlTemplate: "http://{host}:{port}/v1"` with variables `host` (example `localhost`) and `port` (example `20128`), dialect OpenAI Chat Completions, `auth {mode: "bearer"}` with the key the admin copies from the 9router dashboard, `modelListPath: "/models"`, `modelSource: "discover-and-manual"`, `allowPrivateNetwork` preselected for loopback and private hosts, `verified {by: "vendor-docs", ref}` holding the two document URLs and the read date. Model ids are whatever the instance lists (provider-prefixed ids such as `<prefix>/<model>`); none is shipped. The release checklist re-verifies port, path and auth against the tool's documentation and fails when `verified.ref` is older than the release branch date; an admin whose instance speaks another dialect uses "Generic Anthropic-compatible". **Media and stock presets** (decision: the product ships no vendor-named provider adapter; a hosted media or stock service the Gateway has no provider contract for is reached through an endpoint record with the user's own key). A `media-endpoint` preset prefills an endpoint record for one or more of the capabilities `voice-design`, `sfx`, `lipsync`, `music`, `image`, `video`, `tts` or `transcription` together with its `media.<capability>` templates and a starter model list; a `stock-source` preset prefills an endpoint record with `capabilities: ["stock-media"]`, the `stock-search` template (search path, field mapping, paging, licence mapping) and the kinds it serves. The shipped data SHALL contain: (a) "Generic media endpoint" (`media-endpoint`; empty base URL, bearer auth, template `custom` with an empty body for the admin to fill) and "Generic stock source" (`stock-source`; empty base URL and mapping); (b) at least one `media-endpoint` preset for each of `voice-design`, `sfx` and `lipsync`, and at least one `stock-source` preset for each of the kinds `video` and `image`, each for a named hosted service with `verified.by: "vendor-docs"`, a non-empty `verified.ref` (the vendor's API reference URL and the date it was read) and the licence mapping of that service's published terms. The named services of (b) for the three capabilities the Gateway has no provider contract for are fixed here, each using the `custom` template features of `generation-providers.Media request templates` (multipart parts, upload steps, asynchronous polling, binary results): **sound effects** — ElevenLabs sound generation (`POST https://api.elevenlabs.io/v1/sound-generation`, JSON body with the prompt text and duration, header auth `xi-api-key`, binary audio result); **voice design** — ElevenLabs voice design (the text-to-voice design call, then the create-voice call whose result is the reusable voice id; same host and header auth); **lip-sync** — sync. (`POST https://api.sync.so/v2/generate` with the video and audio inputs supplied through upload steps, header auth `x-api-key`, asynchronous with a status poll, result by URL on the service's own host). Each carries `verified.ref` (the vendor's API reference URL and the date it was read) and a contract test against a recorded fixture of that vendor's documented request and response; the exact paths, field names and status values live in the preset data and are re-verified by the release checklist. The stock presets of (b) are release data. The release checklist fails while a capability or kind of (b) has no preset with a non-empty `verified.ref`, a preset whose reference is empty is not shipped, and a preset's vendor name appears only as its `label` — the product still contains no vendor-named adapter code. Presets of both kinds carry no key; creating an endpoint from one asks for the user's own key, stores it as a named secret, and adds the preset's hosts to the egress list as that endpoint's row. A `bundled-provider` preset connects the bundled plugin, keeping its discovery, pricing and media features; a `custom-endpoint` preset prefills an endpoint record. Every prefilled field stays editable. "Duplicate" on a preset creates a user preset stored in `endpoints.presets` that can be edited and deleted with `jagentchill.provider.preset.upsert {preset}` and `jagentchill.provider.preset.remove {presetId}` (scope `jagentchill.config.write`); shipped presets cannot be changed or deleted (`CONFLICT`). Any number of endpoints can be created from one preset; since a bundled provider id exists once, a second instance of a `bundled-provider` preset is created as a custom endpoint with the same base URL template and dialect and a new id (for example `litellm-2`), with a note listing which plugin-only features do not apply to it. `jagentchill.provider.preset.list {kind?, capability?}` (scope `jagentchill.config.read`). [NEW]

#### Scenario: Two LiteLLM proxies
- **WHEN** an admin connects LiteLLM from the preset and then adds a second one for another host
- **THEN** the first is the bundled `litellm` provider, the second is a custom endpoint `litellm-2` with dialect OpenAI Chat Completions, and both appear as separate providers in the model browser

#### Scenario: 9router preset
- **WHEN** an admin picks the 9router preset on a host where 9router runs locally with defaults
- **THEN** the form opens with `http://localhost:20128/v1`, dialect OpenAI Chat Completions and a bearer key field, and discovery lists the models the instance reports

#### Scenario: Lip-sync preset contract test
- **WHEN** the shipped lip-sync preset is run against its recorded fixture
- **THEN** the upload steps, the generate request and the status poll match the fixture and the result video is stored

#### Scenario: Duplicate and edit a preset
- **WHEN** an admin duplicates "Generic OpenAI-compatible", renames it "Team relay" and adds a header
- **THEN** "Team relay" is listed under "Your presets" and new endpoints created from it start with that header

#### Scenario: Stock source from a preset
- **WHEN** an admin picks a shipped `stock-source` preset for stock video, enters their own key and saves
- **THEN** an endpoint record with `capabilities: ["stock-media"]` and the `stock-search` template exists, its key is a named secret, the preset's hosts are a row of the egress list, and stock video search returns that source's items

#### Scenario: Release gate for media presets
- **WHEN** the shipped preset data holds no `media-endpoint` preset with a non-empty `verified.ref` for `lipsync`
- **THEN** the release checklist fails naming the capability

#### Scenario: Filter presets by capability
- **WHEN** `jagentchill.provider.preset.list {capability: "sfx"}` is called
- **THEN** only presets declaring `sfx` are returned, including "Generic media endpoint"

### Requirement: Preset change migration
Each endpoint SHALL remember `presetId` and `presetVersion`. When a product update ships a higher version of a preset, existing endpoints are not changed. Their rows show "Preset updated", and the detail offers a three-column comparison (field, your value, new preset value) with per-field "Apply" and "Apply all unedited"; fields the admin edited are never applied by "Apply all unedited". A preset removed by an update leaves its endpoints working with the caption "Preset no longer shipped". A preset whose `kind` changes from `custom-endpoint` to `bundled-provider` (upstream started bundling that router) offers "Move to the built-in provider", which creates the bundled connection with the same secret, re-points ORC profiles, workflow nodes and automations that reference the endpoint id, keeps usage history under the old id with a link to the new one, and disables the old record; the move is one confirmed operation that either completes fully or changes nothing. [NEW]

#### Scenario: Preset default URL changes
- **WHEN** an update changes a preset's default path and an endpoint still has the old unedited value
- **THEN** the endpoint keeps working with the old value, shows "Preset updated", and "Apply all unedited" sets the new path

#### Scenario: Edited field is preserved
- **WHEN** the admin had changed the timeout and the new preset version also changes the timeout
- **THEN** "Apply all unedited" leaves the admin's timeout and lists it as "Kept — you changed this"

### Requirement: Aggregator model catalogues
For providers in the group "Aggregators and routers" and for endpoints with more than 100 models, the model browser data and the provider detail SHALL handle large catalogues. The unified contract `jagentchill.runtime.models.list` (`agent-runtimes.Unified model browser data contract`) returns for such a provider only the pre-search set described below; the paged per-provider call is a separate method, `jagentchill.runtime.models.search` (scope `jagentchill.config.read`), which accepts `{providerId, includeIds?: string[] (≤ 60), query?, filters?: {input?: ("image" | "audio" | "video")[], minContextWindow?, supportsTools?, reasoning?, maxInputPricePerMillionUsd?, free?: boolean, upstreamProvider?}, sort?: "name" | "context" | "price" | "recent", cursor?, limit? (default 50, max 200)}` and returns pages with a total; search matches the model id, label and upstream maker, and answers within 200 ms for 5 000 models from the host cache. Each model carries `upstreamProvider?` (the part of the id before the first `/` when the aggregator uses that form), `pricing?`, `free` (both token prices are 0), and its declared capabilities. An admin pins models per provider with `jagentchill.provider.pin.set {providerId, modelIds[] (≤ 50)}` (scope `jagentchill.config.write`; stored in `pinnedModelIds` of `agent-runtimes.Runtime configuration store`), and pinned models are listed first for every device. Favourites and recents are device-local (`chat-agent.Model browser`, `chat-agent.Remembered composer preferences`) and unknown to the host, so before a search the host returns exactly `pinned ∪ ORC-referenced ∪ includeIds` — the client passes its favourites and its 5 recent models of that provider in `includeIds`; the rest are reached by search or "Browse all <n> models". The OpenRouter catalogue is the live catalogue the bundled plugin discovers (tool support taken from each model's `supported_parameters`); ClawRouter's is scoped to the key's policy through its `/v1/catalog`; Vercel AI Gateway's comes from `/v1/models`; the product ships no second fixed list for any of them. A catalogue fetch failure shows "Unable to load models from <provider>" with "Retry" and keeps the last list marked stale. [NEW]

#### Scenario: Filter a large catalogue
- **WHEN** a user filters OpenRouter models to "Tools" and "Image input" with at least 200 000 tokens of context and sorts by price
- **THEN** only models meeting all three are listed, cheapest first, with the total count

#### Scenario: Pinned by an admin
- **WHEN** an admin pins three models of an aggregator
- **THEN** every device lists those three first under that provider before any search

#### Scenario: Model without tool support
- **WHEN** an aggregator model does not advertise tool support
- **THEN** it is marked "No tools — chat only" and is not selectable for an agent that needs JAgentChill tools

#### Scenario: Pre-search set
- **WHEN** a device calls `jagentchill.runtime.models.search` for an aggregator with no query and `includeIds` holding 2 favourites and 5 recents, while 3 models are pinned and 1 is referenced by ORC
- **THEN** the page holds those 11 models (fewer when they overlap) and the total of the full catalogue

### Requirement: Aggregator routing preferences
Routing preferences an aggregator supports SHALL be exposed only where the Gateway exposes them. For OpenRouter (the bundled provider and any endpoint whose `baseUrl` host is `openrouter.ai`) the provider detail has a "Routing" section, read with `jagentchill.provider.routing.get {providerId}` (scope `jagentchill.config.read`) and written with `jagentchill.provider.routing.set {providerId, modelId?, routing, responseCache?}` (scope `jagentchill.config.write`), that edits `models.providers.openrouter.params.provider` — the object the Gateway forwards as the request `provider` field — with the keys the Gateway's schema accepts (`src/config/zod-schema.model-compat.ts:15-44`): `order[]`, `only[]`, `ignore[]`, `allow_fallbacks`, `require_parameters`, `data_collection` (`allow` | `deny`), `zdr`, `quantizations[]`, `sort`, `max_price {prompt, completion, image, audio, request}`, `preferred_min_throughput`, `preferred_max_latency`; a per-model override is stored on that model's params and wins over the provider-wide object. The same section offers OpenRouter response caching (`responseCache`, `responseCacheTtlSeconds`). For Vercel AI Gateway the section edits `only[]` and `order[]`. For every other aggregator, router and custom endpoint there is no typed form: preferences are passed through as JSON in the model's `extraBody` or in an ORC profile's `params.extraBody` (see `orc-model-routing.Profile schema`), validated only as JSON and by size (≤ 8 KiB), with the caption "Sent as-is to <provider>. JAgentChill does not check these fields." Where a profile-level value applies is limited by what the Gateway can carry: one agent has one `params` object per `provider/model` (`src/config/zod-schema.agent-entry-base.ts:12-20`), so for **agent turns** the model-level `extraBody` and the single profile value allowed by `orc-model-routing.Profile schema` are what is sent, and two profiles of one persona cannot send different bodies to the same model; for **requests the server makes itself** (generation calls and server-made one-shot LLM steps) a profile-level value overrides the model-level one for that request only. [NEW]

#### Scenario: Deny data collection on OpenRouter
- **WHEN** an admin sets `data_collection` to Deny and `order` to two upstream providers
- **THEN** `models.providers.openrouter.params.provider` holds those values and the next turn's request carries them

#### Scenario: Pass-through on a relay
- **WHEN** an image-generation ORC profile on a custom relay has `params.extraBody {"route": "cheap"}` and a second profile on the same model has none
- **THEN** generation requests made with the first profile carry the field and requests made with the second do not

#### Scenario: Unknown key in the typed form
- **WHEN** a client submits an OpenRouter routing key that the Gateway schema does not accept
- **THEN** the update fails with `INVALID_PARAMS` naming the key and nothing is written

### Requirement: Base-URL override on bundled providers
An admin SHALL be able to point a bundled provider (for example `anthropic`, `openai`, `google`) at a proxy while keeping that provider's native dialect, model catalogue and auth profile: `jagentchill.provider.override.set {providerId, baseUrl, headers?, tls?, allowPrivateNetwork?, timeoutSeconds?}` (scope `jagentchill.config.write`) writes a provider overlay `models.providers.<providerId>` with only those fields. The Gateway accepts an overlay without `models` for bundled provider ids (`src/config/zod-schema.core.ts:359-381`, ids in `src/config/model-provider-overlay-ids.ts`). The form states the documented consequences of leaving the native host: Anthropic beta headers are no longer sent implicitly; OpenAI-only request shaping (`service_tier`, `store`, prompt-cache hints, the `developer` role) and attribution headers are dropped; aggregator-specific headers and cache markers apply only while the host is the aggregator's own. Because the provider's stored credential is sent to the new host, the override is allowed only when every profile in the provider's auth order is an API-key profile; with an OAuth, device-code, setup-token or CLI-login profile present the call fails with `runtime/override-not-allowed` and "Sign-in tokens are not sent to a custom address — use an API key profile". Saving requires the confirmation "Requests and the <provider> API key will be sent to <host> instead of <native host>." The provider row then carries a persistent chip "Via <host>", the override is covered by `agent-runtimes.Endpoint connection test`, and "Remove override" (`jagentchill.provider.override.remove {providerId}`, scope `jagentchill.config.write`) restores the native address. The API-key-only rule holds for as long as the override exists, not only when it is created: while an override is active, `jagentchill.provider.auth.login.start`, every non-API-key choice and `connectCloud` for that provider fail with `runtime/override-not-allowed` and "Remove the custom address before signing in"; and because a profile can also be added on the host with the `openclaw` command, the server re-checks at the start of every turn it relays and at every server-made call that the provider's auth order holds only API-key profiles — when it does not, the turn is refused with `runtime/override-not-allowed`, the overlay's `baseUrl` is removed, the notification kind `provider.endpoint_unhealthy` is raised to admin devices ("The custom address of <provider> was turned off because a sign-in account was added"), and the audit record `provider.override.disabled` is written. Which credential the Gateway sends to an overridden address for each auth type is confirmed by spike S17; the API-key-only rule above is the behaviour that holds either way. [NEW]

#### Scenario: Anthropic through a corporate proxy
- **WHEN** an admin with one Anthropic API-key profile sets the base URL to `https://llm-proxy.example/anthropic` and confirms
- **THEN** Anthropic models keep their catalogue and thinking options, turns go to the proxy, and the row shows "Via llm-proxy.example"

#### Scenario: OAuth profile present
- **WHEN** the provider's auth order contains an OAuth profile
- **THEN** the override is refused with `runtime/override-not-allowed` and no configuration is written

#### Scenario: Remove
- **WHEN** the admin removes the override
- **THEN** the overlay's `baseUrl` is cleared, the chip disappears, and the next turn goes to the native address

#### Scenario: Sign-in attempted while an override is active
- **WHEN** an override is active for `openai` and an admin starts the OAuth choice for `openai`
- **THEN** `login.start` fails with `runtime/override-not-allowed` and the message "Remove the custom address before signing in"

#### Scenario: Sign-in profile added on the host
- **WHEN** an OAuth profile for a provider with an active override is added with the `openclaw` command and a device then sends a message to a session on that provider
- **THEN** the turn is refused before any request leaves the host, the override is removed, admins are notified, and no sign-in token was sent to the custom address

### Requirement: Proxy profiles for CLI runtimes
An installed CLI SHALL be routable through a proxy or router (for example 9router) with a custom profile whose `proxy` field is set, created from a "Route through a proxy" form: Base runtime; Endpoint (an existing endpoint record, or a base URL typed here); Key (a secret name, or "No key"); Model mapping (optional list `{cliModel, upstreamModel}` written into the profile's `models`); and the resulting environment variables, shown and editable before saving. A proxy profile is always realised as an **ACP custom agent launched by the product launch wrapper**, which sets the proxy environment for the child (`agent-runtimes.Custom runtime profiles`, realisation `acp`; `agent-runtimes.Launch environment` case (b)); it is never realised on a bundled CLI backend. The form states the path and its consequences before saving: "Runs through ACP: messages wait for the turn to end, and this profile cannot staff a team" and "Uses <proxy host> instead of the CLI's own sign-in".

What is and is not possible per CLI, as verified against the pinned OpenClaw source, is published in the form and in the capability matrix:

| Base runtime | Built-in runtime through a proxy | Proxy profile (ACP + launch wrapper) |
|---|---|---|
| `claude-code` | not possible — the bundled `claude-cli` backend deletes `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN` and `ANTHROPIC_API_KEY` before launch and has no configuration to change command or environment | offered when spike S22 passes for the Claude ACP adapter: the wrapper sets the variables and starts the adapter that `acpx.agents.list` reports for target `claude` |
| `gemini-cli` | not possible — the bundled `google-gemini-cli` backend deletes `GOOGLE_GEMINI_BASE_URL`, `GEMINI_API_KEY` and its header variables before launch | offered when S22 passes for the Gemini ACP target |
| `codex` | not offered — environment delivery to the harness is unverified (spike S27); when S27 passes for `codex` the Environment field of a `native` profile is enabled for non-proxy variables only | offered when S22 passes for the Codex ACP adapter |
| `copilot` | not offered — as `codex` | offered when S22 passes for target `copilot` |
| `acp-opencode` and other ACP targets, custom ACP commands | not applicable (already ACP) | offered when S22 passes for that target; variable names are free-form |

Spike S22 passes for a CLI when a turn started on a wrapper-launched ACP agent of that CLI sends its model requests to a local stub proxy named by the profile's variables. When S22 fails for a CLI — or spike S24 (the ACP session path) or S12 fails — proxy profiles are not offered for that CLI: the form lists it disabled with "This host version cannot route <CLI> through a proxy", existing proxy profiles of it report `unavailable` with `runtime/unsupported-capability`, and the matrix row "proxy" of that CLI reads "no". In every outcome the built-in `claude-code` and `gemini-cli` runtimes stay available without proxy support.

Which variables each CLI honours is preset data, `server/data/cli-proxy-env.json`, `{<runtimeId>: {baseUrlVar[], keyVar[], extra?: {<name>: value}, docsUrl, verifiedRef}}` — shipped working values: `claude-code` → `ANTHROPIC_BASE_URL` with `ANTHROPIC_AUTH_TOKEN`; `codex` → `OPENAI_BASE_URL` with `OPENAI_API_KEY`; `gemini-cli` → `GOOGLE_GEMINI_BASE_URL` with `GEMINI_API_KEY`. These names are properties of the CLIs, not of OpenClaw; each MUST be confirmed against the CLI's documentation for the supported versions before release (the release checklist fails on an empty `verifiedRef`), admins can edit them per profile, and a CLI absent from the data gets a form with empty variable names. The key variable is always written as a `{secret}` reference; a literal key is refused. The profile requires the dialect the CLI speaks: choosing an endpoint whose dialect differs (for example an OpenAI-only relay for `claude-code`) is refused with "Claude Code needs an Anthropic-compatible address". The wrapper-launched adapter does not use the bundled backend's sign-in handling, so the form warns "<CLI> uses these variables instead of its sign-in while this profile is used". The matrix flag `proxy: "acp" | "no"` per runtime is generated from the S22 results. [NEW]

#### Scenario: Claude Code through a router
- **WHEN** S22 passed for the Claude ACP adapter and an admin creates a proxy profile on `claude-code` with an Anthropic-compatible endpoint and secret `ROUTER_KEY`
- **THEN** a profile with `realisation: "acp"` exists whose `env` has `ANTHROPIC_BASE_URL` set to the endpoint address and `ANTHROPIC_AUTH_TOKEN` as a secret reference, it is listed as its own runtime with the caption "Runs through ACP", and a turn on it sends its requests to the router

#### Scenario: Built-in runtime is not rerouted
- **WHEN** that proxy profile exists and a session runs on the built-in `claude-code` runtime
- **THEN** that session uses the CLI's own sign-in and sends nothing to the router

#### Scenario: Spike fails for one CLI
- **WHEN** the S22 result for the Gemini ACP target is `fail`
- **THEN** the "Route through a proxy" form lists Gemini CLI disabled with the stated reason, the matrix shows `proxy: "no"` for `gemini-cli`, and the built-in `gemini-cli` runtime is still selectable

#### Scenario: Dialect mismatch
- **WHEN** the admin picks an endpoint with dialect OpenAI Chat Completions for `claude-code`
- **THEN** the form refuses with the stated message and saves nothing

#### Scenario: Literal key
- **WHEN** the admin types a key value into the key variable
- **THEN** the form offers "Store as secret" and Save stays disabled until the value is a secret reference

### Requirement: Proxy routing verification for CLI runtimes
The diagnostics of a proxy profile SHALL check that the CLI really talks to the proxy. Rows added to `agent-runtimes.Diagnostics report`: "Proxy address" (host and port only); "Reachable from the host" (the endpoint `connect` and `auth-and-models` steps with the profile's key); "Launch path" ("ACP through the launch wrapper"); "Variables delivered" (names present in the child environment, read by starting the wrapper with its `--echo-env-names` argument in place of the agent command — values never shown). An explicit action "Verify routing" (admin; confirmation "This sends one short real prompt through <proxy> and can use a few tokens") runs one probe turn with the profile's base-URL variable temporarily pointed at a loopback forwarder the server opens for that turn only. The forwarder is bound to `127.0.0.1` on a random port, is closed within 60 s, and accepts only requests whose path begins with a per-probe random token of 32 hexadecimal characters that is part of the base URL handed to the CLI (`http://127.0.0.1:<port>/<token>/…`); a request without the token gets 404 and is not forwarded. This mechanism is the same on macOS, Linux and Windows and needs no inspection of process trees. The forwarder strips the token, relays every request unchanged to the proxy and counts them. Result: "Routed through <proxy>: <n> requests, first response in <ms>" when at least one request passed and the turn completed; "The CLI did not use the proxy address" when the turn completed with zero forwarded requests (the CLI ignored the variable — typically an unsupported CLI version); or the forwarded error with its normalised code. The forwarder stores no request or response body and adds no header. For a CLI whose proxy profiles are not offered (`agent-runtimes.Proxy profiles for CLI runtimes`), "Verify routing" is absent. [NEW]

#### Scenario: CLI honours the variable
- **WHEN** "Verify routing" runs on a working proxy profile
- **THEN** the report shows at least one forwarded request and the first-response time, and the forwarder port is closed afterwards

#### Scenario: CLI ignores the variable
- **WHEN** the installed CLI version does not read the configured base-URL variable
- **THEN** the report reads "The CLI did not use the proxy address" with the variable name and the CLI version, and the profile row carries a warning

#### Scenario: Request without the probe token
- **WHEN** another local process sends a request to the forwarder port without the token path
- **THEN** it receives 404, nothing is forwarded to the proxy, and the request is not counted

### Requirement: Endpoint reachability and placement
Every endpoint SHALL be called from the Gateway host, never from a client device, and the UI SHALL say so. The base-URL field carries the caption "Called from <host name>. `localhost` here means that computer, not this device." Saving or testing resolves the address on the host and classifies it: `public`, `private` (RFC 1918, unique-local, link-local), `tailnet`, `loopback`. Rules: `http` is accepted only for loopback, private and tailnet addresses and needs the toggle "Allow unencrypted connection on a private network"; `http` to a public address is refused; a private or tailnet address sets `request.allowPrivateNetwork: true` in the projection (the Gateway's documented switch for sending a key to a private-network host) after the confirmation "The key for this endpoint will be sent to <address> on your private network"; cloud metadata addresses are always refused. When the Gateway runs in a container or headless distribution — reported by the server as `host.placement: "desktop" | "container" | "headless"` — a loopback address shows the warning "The host runs in a container: `localhost` is the container itself. Use `host.docker.internal`, the host's LAN address, or a service name." with a one-press "Use host.docker.internal" where that name resolves on the host; the save is allowed after acknowledgement. An unreachable address is saved only with "Save anyway" and reports health `unreachable`. Every endpoint host is added, per endpoint, to the outbound allow-list of `security-privacy.Network egress control` (row: endpoint label, host and port, purpose "Model endpoint", data sent "prompts, attachments and tool results of sessions that use it", disabling setting = the endpoint's enable switch); a host disabled there makes the endpoint report `EGRESS_BLOCKED`; removing the endpoint removes its allow-list row. Redirects to a different host are not followed. [NEW]

#### Scenario: Phone configuring a loopback proxy
- **WHEN** an admin on a phone enters `http://localhost:4000`
- **THEN** the caption states the address is on the Gateway host, and the test reports reachability as seen from that host

#### Scenario: Gateway in Docker
- **WHEN** the Gateway reports placement `container` and the admin enters a loopback address
- **THEN** the container warning appears with "Use host.docker.internal", and choosing it rewrites the host part of the address

#### Scenario: Public http
- **WHEN** the admin enters `http://relay.example.com/v1`
- **THEN** the save is refused with "Use https for addresses on the internet"

### Requirement: Endpoint TLS options
An endpoint SHALL support: a custom CA bundle (PEM, ≤ 256 KiB, stored as a secret and projected to `request.tls.ca`); a server name override (`request.tls.serverName`); a client certificate and key for mutual TLS (secrets, `request.tls.cert` / `key`); and "Accept a self-signed certificate" (`request.tls.insecureSkipVerify: true`). The last is available only to a device with role `admin`, only for loopback, private and tailnet addresses, and only after a dialog that shows the presented certificate's subject, issuer, validity and SHA-256 fingerprint with the text "This certificate cannot be verified. Anyone on the network path is able to read prompts and the key sent to this endpoint. Prefer adding the proxy's CA instead." and the buttons "Add CA instead", "Cancel" and "Accept this certificate"; the dialog's default focus is "Cancel". The accepted fingerprint is stored, and the server's own calls refuse the endpoint when the presented certificate changes (`runtime/tls-untrusted`, "The certificate of <host> changed"); the endpoint then needs a new acceptance. The endpoint row shows a persistent "Certificate not verified" chip and the choice is written to the audit log. Self-signed acceptance is never offered for a public address. [NEW]

#### Scenario: Corporate CA
- **WHEN** an admin uploads the proxy's CA bundle
- **THEN** the `connect` step reports "Validated with your CA" and no warning chip is shown

#### Scenario: Self-signed on a public host
- **WHEN** the address is public and its certificate does not validate
- **THEN** the form offers only "Add CA" and the endpoint cannot be saved as trusted

#### Scenario: Certificate changes
- **WHEN** an accepted self-signed certificate is replaced on the proxy
- **THEN** the endpoint's health becomes `tls-untrusted`, generation calls to it fail with `runtime/tls-untrusted`, and the row asks the admin to review the new certificate

### Requirement: Endpoint health
Each endpoint and each overridden bundled provider SHALL carry `health {state: "ok" | "degraded" | "rate-limited" | "quota" | "auth-failed" | "unreachable" | "tls-untrusted" | "blocked" | "unknown", since_ms, lastOk_ms?, lastError?: {code, message}, latency_ms?: {p50, p95}, successRate?}` computed on the host from real traffic (the last 50 calls or 15 minutes, whichever is fewer) and from tests. State rules: `ok` — the last call succeeded and success rate is at least 90 %; `degraded` — success rate 50–90 % or p95 latency above three times the 24-hour median; `rate-limited`, `quota`, `auth-failed`, `tls-untrusted`, `blocked` — from the latest normalised error; `unreachable` — three consecutive connection failures. An idle endpoint is not polled; one lightweight check (the model-list call, no completion) runs when the model browser opens and the endpoint's last result is older than 10 minutes, at most 2 checks concurrently. Health is shown as an icon with a text label on the endpoint row, in the model browser group, and in ORC route rows; `jagentchill.provider.endpoint.list` returns it and changes are announced with `jagentchill.runtime.updated`. A health change to `auth-failed`, `quota` or `unreachable` on an endpoint used by an ORC default route raises the notification kind `provider.endpoint_unhealthy`, at most one per endpoint per hour (`notifications.Notification event catalogue`). [NEW]

#### Scenario: Proxy goes down
- **WHEN** three calls in a row fail to connect
- **THEN** the endpoint shows "Unreachable since <time>", its models show readiness `error` with "Retry", and admins get one notification if a default route uses it

#### Scenario: Idle endpoint
- **WHEN** an endpoint has not been used for a day and nobody opens the model browser
- **THEN** no request is sent to it

### Requirement: Failover across keys and endpoints
Reliability SHALL be layered, each layer mapped onto what the Gateway provides. (1) **Several keys for one provider or endpoint**: up to 8 auth profiles in order per `agent-runtimes.Multiple auth profiles with order and rotation`; the Gateway rotates to the next key of the same provider only on rate-limit class responses (429, `rate_limit`, `quota`, resource exhausted, too many concurrent requests, throttling) and fails immediately on other errors. Several API-key profiles — on a bundled provider and on a custom endpoint id — depend on point (c) of spike S17 (`agent-runtimes.Multiple auth profiles with order and rotation`); where that point fails, the provider or endpoint has one key and layer 2 is used instead. (2) **Several endpoints for the same model**: the admin links endpoints that serve the same model into a "failover group" on the model (`equivalents: [{endpointId, modelId}]`, ≤ 4), which the server projects into the Gateway's ordered model fallback chain for agents whose route's primary target is that model — for an interactive session only while that session has "Allow fallback" on (`orc-model-routing.Per-run override`), so that a strict session model is never silently served by another endpoint; the Gateway advances to the next entry after the key rotation of layer 1 is exhausted. `equivalents` is a field of `EndpointModel` (`agent-runtimes.Per-model capability overrides and aliases`), edited through `jagentchill.provider.endpoint.upsert`. (3) **ORC fallback routes** across different models or providers per `orc-model-routing.Routes with primary and ordered fallbacks`; an ORC route can list targets on different endpoints. For agent turns on a Gateway runtime the attempts, delays and the error classes that advance each layer are the Gateway's own (`orc-model-routing.Route resolution and fallback`). The order of evaluation is always key rotation, then equivalents, then ORC fallbacks, and a loop over the same target is prevented by skipping any target already tried in the turn. Targets whose health is `auth-failed`, `tls-untrusted`, `blocked` or `unreachable` are skipped without a call for 60 s after the failure. For generation calls the same three layers are applied by `generation-providers` with its own retry policy. Every hop is disclosed as defined in `agent-runtimes.Served-by attribution`. [NEW]

#### Scenario: Second key on rate limit
- **WHEN** the first key of a relay returns 429 and a second key profile exists
- **THEN** the turn continues on the second key with the same model and the first profile shows a cooldown

#### Scenario: Second proxy when the first is down
- **WHEN** a model has two equivalent endpoints and the first is unreachable
- **THEN** the turn is served by the second endpoint, and the first is skipped without a call for the next 60 s

#### Scenario: Authentication error does not rotate keys
- **WHEN** the first key is rejected with an authentication error
- **THEN** no other key of that endpoint is tried for that request, the profile becomes `auth_failed`, and the route advances to the next equivalent or fallback

### Requirement: Endpoint error normalisation
Errors from aggregators, routers and proxies SHALL be normalised into the domain codes of `agent-runtimes.Error mapping`, extended with: `runtime/overloaded` (HTTP 503/529 or an upstream "overloaded" body; `retryable: true`); `runtime/quota-exhausted` (a periodic usage or spending limit of the key or virtual key, including a router's own budget; message "The key for <endpoint> reached its limit" with the reset time when reported); `runtime/free-tier-limit` (a free model's or free plan's request cap; message "Free usage limit reached on <provider>", actions "Choose a paid model" and "Retry at <time>"); `runtime/endpoint-unreachable` (DNS, connection refused, timeout before headers); `runtime/tls-untrusted`; `runtime/dialect-mismatch` (the response is not of the configured dialect — HTML, a different API's error shape, or 404 on the completion path); `runtime/upstream-error` (the proxy answered 502/504 or wrapped an upstream failure; `details.upstream` when the body names it); `runtime/override-not-allowed`. Classification uses HTTP status, standard `Retry-After` and rate-limit headers, and the body fields `error.type`, `error.code` and `error.message`; 402 maps to `runtime/billing`; 429 maps to `runtime/free-tier-limit` when the model is free-priced or the body says so, to `runtime/quota-exhausted` when the body names a quota, budget or periodic limit, and to `runtime/rate-limited` otherwise. `details` always carries `{endpointId, providerId, modelId, httpStatus?, retryAfter_ms?}`. The raw body is available under "Details" after redaction and truncation to 2 000 characters. An unclassifiable error is `UNAVAILABLE` with the HTTP status in the message. [NEW]

#### Scenario: Free model cap
- **WHEN** a free aggregator model answers 429 with a daily free-limit message
- **THEN** the turn fails with `runtime/free-tier-limit` and the error item offers "Choose a paid model"

#### Scenario: Virtual key budget
- **WHEN** a router answers that the key's monthly budget is exceeded
- **THEN** the code is `runtime/quota-exhausted`, the endpoint health is `quota`, and key rotation to another profile is attempted

#### Scenario: HTML error page
- **WHEN** a misconfigured proxy returns an HTML page with status 200
- **THEN** the code is `runtime/dialect-mismatch` with the hint "Check the base URL and dialect"

### Requirement: Served-by attribution
Every turn SHALL record and show which endpoint actually served it: `servedBy {runtimeId, providerId, endpointId?, modelId, upstreamProvider?, authProfileId?, viaOverrideHost?, hops: [{providerId, endpointId?, modelId, authProfileId?, outcome, code?}]}`. `hops` lists, in order, every key, equivalent endpoint and fallback target tried in the turn. The assistant message footer shows "<model label> · <endpoint or provider label>", with "via <host>" for an overridden bundled provider and "(<upstream provider>)" when the aggregator reports which upstream answered; a turn with more than one hop shows a "Rerouted" chip whose popover lists the hops with their reasons. The values come from the Gateway's agent events for the run (provider, model, auth profile); the upstream provider behind an aggregator is shown only when the Gateway surfaces it in those events — gated by spike S17, and omitted otherwise, never guessed. `servedBy` is stored on the turn's record (`usage-tracking.Per-turn usage record`) and is filterable in `usage-tracking.Unified usage query`. When the session's selected model and the serving model differ, the session header shows the status line "Answered by <served> instead of <selected>" for that turn. [NEW]

#### Scenario: Footer on a relay
- **WHEN** a turn on model alias "Fast local" is served by endpoint "Office relay"
- **THEN** the footer reads "Fast local · Office relay"

#### Scenario: Rerouted turn
- **WHEN** the first endpoint returned `runtime/overloaded` and the second served the turn
- **THEN** the footer names the second endpoint with a "Rerouted" chip listing the first hop as "Overloaded"

### Requirement: Usage and pricing through endpoints
The hand-off to `usage-tracking.Per-turn usage record` for turns on aggregators and endpoints SHALL be: `{servedBy, tokens?: {input, cachedInput, cacheWrite, output}, tokenSource: "reported" | "estimated" | "none", pricing?: ModelPricing, priceSource: "aggregator" | "catalogue" | "admin" | "none"}`. `usage-tracking` stores these values unchanged and adds the `priceSource` value `provider` for a turn whose cost itself was reported. Tokens are `reported` when the endpoint returns usage. When an endpoint returns none (a relay that drops usage from streams), the endpoint setting "Estimate tokens when the endpoint reports none" (default off) lets the host estimate from the request and response text at 4 characters per token; such turns are `estimated` and labelled so everywhere; with the setting off they are `none`. Pricing per endpoint and model uses the `tokens` shape of `generation-providers.Cost model` (input, cached input, output and cache-write USD per million tokens) and is resolved in this order: a price the admin entered on the endpoint model (`admin`); the price the aggregator publishes in its catalogue (`aggregator` — OpenRouter and ClawRouter catalogues carry pricing); the bundled price table when the endpoint model is mapped to a known model with "Same model as…" (`catalogue`); otherwise `none`. The pricing editor on the endpoint detail lists every enabled model with its source and "Prices as of <date>", supports bulk entry and CSV paste, and offers "Local — no cost" which sets the model to free. A model with `priceSource: "none"` is shown as "Unpriced" in pickers and usage; its turns have unknown cost, and under a hard-stop budget they are refused with `BUDGET_EXCEEDED` unless that budget's "Allow unknown-cost models" option of `generation-providers.Budgets with hard stop` is on, in which case they count as 0 and budget views say so. The server also projects admin and aggregator prices into the Gateway model definition's `cost` so the Gateway's own estimates agree; the unit of that field is confirmed by spike S17, and when unconfirmed nothing is projected and the server's price is the only one used. A router's own spend report (for example a virtual key's budget) is shown as a plan-usage balance through `usage-tracking.Provider plan usage shape` only where the Gateway's usage path exposes it. [NEW]

#### Scenario: Aggregator price
- **WHEN** a turn runs on an OpenRouter model whose catalogue entry has prices
- **THEN** the hand-off carries `priceSource: "aggregator"` and usage shows an estimated cost

#### Scenario: Unpriced model under a hard-stop budget
- **WHEN** a relay model has no price and the project has a hard-stop budget without "Allow unknown-cost models"
- **THEN** sending is refused with `BUDGET_EXCEEDED` and the message "This model has no price — add one or allow unpriced models for this budget"

#### Scenario: Relay drops usage
- **WHEN** an endpoint with token estimation on returns no usage for a turn
- **THEN** the turn's tokens are recorded as `estimated` and every surface labels them "Estimated"

### Requirement: Endpoint contract for generation capabilities
The endpoint record SHALL be the one connection object for model endpoints of every capability, so that an aggregator or OpenAI-compatible media endpoint is connected once. Contract for `generation-providers`: (1) it stores no base URL, key, header, TLS or proxy setting of its own for such providers and references `endpointId` (or a bundled provider id) instead; (2) `capabilities[]` on the record lists what the endpoint serves — `llm` is owned here; `image`, `video`, `tts`, `transcription`, `music`, `sfx`, `voice-design`, `lipsync`, `stock-media` and `translation` are declared here and consumed there; (3) per non-`llm` capability the record carries `media.<capability> {template: "openai-images" | "openai-audio-speech" | "openai-audio-transcriptions" | "openai-videos" | "custom" | "stock-search", custom?, stock?}`, whose request and response mapping is owned by `generation-providers.Media request templates` (`stock-search` only for `stock-media`; `music`, `sfx`, `voice-design` and `lipsync` only with `custom`); (4) all calls go through one host-side endpoint client that applies this record's auth, headers, query, TLS, timeout, `maxConcurrency` (one shared limit across capabilities), egress allow-list entry, health accounting, error normalisation and served-by attribution; (5) for bundled providers that declare media contracts in their manifests — the full per-capability list of the pinned tag is the table of `generation-providers.Provider registry by capability type` (among the aggregators: OpenRouter for image, music, video, speech and media understanding; LiteLLM for image; DeepInfra for image, speech, video and media understanding; Together and Novita for video) — generation goes through the Gateway's media provider of that plugin, and the single connection made here enables both chat and generation; hosted media, speech and stock capabilities are never served by a vendor-named adapter of the product: they come from those bundled plugins or from an endpoint record created from a preset (`agent-runtimes.Endpoint presets`); (6) deleting an endpoint is refused with `CONFLICT` while any generation route, ORC profile, workflow node or automation references it, listing the references; (7) the model list of an endpoint is one list, each model tagged with the capability it serves. The earlier limit of 20 custom providers is replaced by this capability's limit of 40 endpoint records. [NEW]

#### Scenario: One connection, two uses
- **WHEN** an admin connects OpenRouter once and enables an image model on it
- **THEN** chat sessions and `jc_generate_image` both work through that connection and the key was entered once

#### Scenario: Shared concurrency
- **WHEN** an endpoint has `maxConcurrency` 4 and four image jobs are running on it
- **THEN** a fifth generation job on that endpoint waits in the job queue until one finishes

#### Scenario: Delete a referenced endpoint
- **WHEN** an admin deletes an endpoint that the `image` ORC role uses
- **THEN** deletion is refused with `CONFLICT` and the dialog lists the role

#### Scenario: Stock source declared on an endpoint
- **WHEN** an endpoint created from a stock preset declares `capabilities: ["stock-media"]` with `media.stock-media.template: "stock-search"`
- **THEN** `generation-providers` lists the provider `endpoint:<endpointId>` with capability `stock-media` and stores only the endpoint id and the template

### Requirement: Endpoint management permissions
Endpoint privileges SHALL follow the device roles of design D25. Role `admin` (scope `jagentchill.config.write`, plus `jagentchill.secrets.manage` for keys, CA bundles and client certificates): create, edit, duplicate, enable, disable, reorder and delete endpoints and presets; set base-URL overrides; edit model lists, capability overrides, aliases, pricing, routing preferences and failover groups; run discovery and connection tests; accept a self-signed certificate; create CLI proxy profiles and run "Verify routing"; import and export. Roles `editor` and `admin` (scope `jagentchill.agent.use`): select endpoint models for sessions, favourite them, and read health. All roles including `viewer` (scope `jagentchill.config.read`): list endpoints with label, dialect, group, health and model metadata. For non-admin roles `jagentchill.provider.endpoint.list` returns `baseUrl` reduced to the host name, omits header names, query names, secret names, TLS details and notes, and the detail page is read-only with "Only admin devices can change endpoints". Agents of either class have no tool that reads or changes endpoint configuration. Every change is written to the audit log (`endpoint.create`, `endpoint.update` with changed field names only, `endpoint.delete`, `endpoint.tls.accept`, `provider.override.set`, `endpoint.import`). [NEW]

#### Scenario: Editor view
- **WHEN** an editor opens an endpoint's detail
- **THEN** only the label, host name, dialect, health and models are shown, and no control changes state

#### Scenario: Editor attempts a change
- **WHEN** an editor device calls `jagentchill.provider.endpoint.upsert`
- **THEN** the call fails with `SCOPE_DENIED`

### Requirement: Endpoint configuration import and export
`jagentchill.provider.endpoint.export {endpointIds?}` (scope `jagentchill.config.write`) SHALL produce a JSON document `{format: "jagentchill-endpoints", version: 1, exported_ms, endpoints[], userPresets[], overrides[], cliProxyProfiles[]}` saved as `<name>.jcendpoints.json`. It contains no secret value: every credential, secret header, secret query value, CA bundle and client key appears only as `{secret: "<NAME>", required: true}`; the accepted self-signed fingerprint, `lastTest`, health and usage are not exported. `…endpoint.import {document, mode: "merge" | "replace-matching"}` validates the document against the schema, shows a preview (new, changed with a field-level comparison, unchanged, id conflicts with a rename field), lists every secret the import needs with its state on this host ("Present" or "Missing — enter"), and applies the whole selection in one operation or nothing. Imported endpoints with missing secrets are created disabled. `allowSelfSigned` is never imported as true — it is reset and must be accepted again on the importing host — and private or loopback addresses are flagged "Check this address on <host name>". Documents larger than 2 MiB or with more than 40 endpoints are refused with `PAYLOAD_TOO_LARGE`; a document of a higher `version` is refused with `UNSUPPORTED_FEATURE`. Export and import are also part of `orc-model-routing.Import and export of an ORC configuration` by reference, so that an ORC export can name the endpoints it depends on. [NEW]

#### Scenario: Export has no secrets
- **WHEN** an admin exports three endpoints with keys and a secret header
- **THEN** the file contains the three records with secret references only, and a scan finds no key value

#### Scenario: Import on another host
- **WHEN** the file is imported on a host that has one of the three secrets
- **THEN** the preview marks two secrets "Missing — enter", and endpoints whose secrets stay missing are created disabled

#### Scenario: Self-signed acceptance is not carried over
- **WHEN** an exported endpoint had a self-signed certificate accepted
- **THEN** after import its TLS option is off and the first test shows the certificate dialog

### Requirement: Custom endpoint verification spike
Spike S17 SHALL be added to the gating spikes of design D18 and run on a live Gateway of the pinned tag before the endpoint requirements are frozen. It records, with evidence in `docs/decisions/`: (a) a custom provider written to `models.providers.<id>` for each of the five offered dialects completes a streamed turn with a tool call; (b) whether a query string on `baseUrl` survives request path joining; (c) whether a second API-key profile written as a named auth profile (SecretRef `keyRef` through `config.patch`, otherwise `openclaw models auth paste-token --profile-id` with the key on standard input) and ordered with `models.authOrderSet` is listed, kept beside the first and rotated to on a 429 — tested once on a bundled provider and once on a custom provider id, with `models.authSetApiKey` confirmed to replace instead of add; (d) which credential the Gateway sends to a bundled provider whose `baseUrl` is overridden, per auth type; (e) the unit and effect of the model `cost` field; (f) whether agent events of a turn expose the upstream provider reported by an aggregator; (g) whether a one-shot Gateway run started over the gateway link accepts a model override naming a custom provider. Fallbacks when a point fails: (a) the failing dialect is removed from the offered list for that release; (b) `query` applies to the server's own calls only; (c) one key per provider for the class that failed (bundled, custom or both), with failover through equivalent endpoints and no `QUOTA_EXCEEDED` rule for a ninth profile there; (d) base-URL overrides stay limited to API-key profiles, which is already the rule; (e) prices are not projected and the server's price table is the only source; (f) the upstream provider is not shown; (g) the `tool-call` test step reports `skipped`. No fallback involves editing a file of the OpenClaw core. [NEW]

#### Scenario: Dialect fails the spike
- **WHEN** S17 shows that tool calls do not complete on one of the five dialects through a custom provider
- **THEN** that dialect is absent from the dialect select in the release and the capability matrix footnote names it

#### Scenario: Evidence is recorded
- **WHEN** S17 has run
- **THEN** `docs/decisions/` contains one record with the seven results and the Gateway version, and the release checklist references it

### Requirement: Unified model browser data contract
`jagentchill.runtime.models.list {cwd?, sessionKey?, agentId?, query?}` (scope `jagentchill.config.read`) SHALL return one structure for both access methods: `{groups: [{runtimeId, kind, label, status, readiness, order, error?, capabilities, defaultModeId, modes[], features[], providers: [{providerId, label, connected, health?, models: ModelEntry[]}]}], selection?, policy: {canSelectWorkspaceRuntimes, creativeRuntimeIds[], reason?}}`. `ModelEntry` is the entry of `agent-runtimes.Model discovery` plus `ref {runtimeId, providerId, modelId}` and `capabilities` (the runtime's flags narrowed by the model: attachments from `input[]`, `jcTools` false when `supportsTools` is false). For a CLI runtime there is one provider element whose `providerId` equals the runtime's vendor id (for example `anthropic` for `claude-code`). `selection` echoes the session's current `{ref, modeId, thinkingOptionId, featureValues}` when `sessionKey` is given. `query` filters models across all runtimes by case-insensitive substring of label, model id, provider label or runtime label — a cross-runtime search, which JAgentDesk lacks. The same model offered by two runtimes appears once under each with its own capabilities. The response is served from the snapshot within 200 ms. This requirement is the single definition of `jagentchill.runtime.models.list`; the paged search inside one large provider is the separate method `jagentchill.runtime.models.search` of `agent-runtimes.Aggregator model catalogues`. The presentation of this data is owned by `chat-agent.Model browser` (views, favourites, recents) and `chat-agent.Control row densities` (density); this requirement is the model browser contract that `agent-workflows.Node configuration panel and validation feedback`, `orc-model-routing.Profile modal` and `workspaces-terminal.New workspace screen` reuse. [NEW]

#### Scenario: Both access methods in one list
- **WHEN** `claude-code` is ready and `builtin` has `anthropic` connected
- **THEN** the response has two groups, each listing the Anthropic models it serves, with `jcTools: "bridge"` under `claude-code` and `jcTools: "native"` under `builtin`

#### Scenario: Cross-runtime search
- **WHEN** the query is "sonnet"
- **THEN** matching models from every enabled runtime are returned grouped by runtime, and runtimes with no match are omitted

#### Scenario: Viewer reads the list
- **WHEN** a device with role `viewer` calls `models.list`
- **THEN** the data is returned with `policy.canSelectWorkspaceRuntimes: false` and the UI renders it read-only

### Requirement: Model readiness
Every model entry and every group SHALL carry `readiness`: `ready`; `loading`; `needs-install` (CLI missing); `needs-auth` (CLI signed out, or no usable auth profile, or Gateway `unavailableReason` `missing-auth` / `auth-failed`); `cooldown` (with `unavailableUntil_ms`); `unsupported` (Gateway `unavailableReason: "unsupported-runtime"`, or the model lacks a capability the agent requires); `disabled`; `error`. Only `ready` and `cooldown` entries are selectable; selecting a `cooldown` model shows "Rate limited until <time> — the request will wait or use the next account". Every non-selectable entry shows its reason and one action: "Install guide", "Sign in" / "Connect", "Enable" (admin only), or "Retry". [NEW]

#### Scenario: Signed-out CLI in the browser
- **WHEN** `codex` is installed and signed out
- **THEN** its group has readiness `needs-auth`, its models from the last successful fetch are listed dimmed, and the group shows "Sign in required" with the sign-in hint

#### Scenario: Unsupported pair
- **WHEN** the Gateway reports `unsupported-runtime` for a model under `copilot`
- **THEN** that entry is not selectable and shows "Not available on Copilot"

### Requirement: Capability flags per runtime
Every runtime SHALL publish `capabilities` with exactly these flags: `jcTools: "native" | "bridge" | "none"` (whether `jc_*` tools are callable); `jcToolsOnly: boolean` (the runtime can be launched with every native file, command, process, web and browser tool disabled so that only JAgentChill tools are callable — the condition of `agent-runtimes.Creative sessions on CLI and ACP runtimes`); `nativeToolCoverage: boolean` (every native tool request of the runtime is subject to the Gateway tool policy the server writes for the session's agent, is reported to the server over the gateway link as a tool item of the Gateway's `agent` events (`stream: "item"`, `kind: "tool"`, carrying `sessionKey`, `toolCallId` and the tool `name`), and — where the policy asks — waits for a Gateway approval that only the server answers; the runtime never executes a native tool the Gateway did not see — the condition of `multi-agent-orchestration.Runtime eligibility for team roles`); `steer: boolean` (input can be added to a running turn); `queueModes: ("steer" | "followup" | "interrupt")[]`; `productModes: {ask, plan, edit, auto}` each `{supported, reason?}`; `liveModeChange: boolean` (a mode change applies during a running turn); `thinking: boolean`; `attachments: {image, document, audio, video}` booleans (upper bound; the model narrows it); `resume: boolean` (a session continues after a Gateway restart with the runtime's own context); `rewind: {conversation, files}` booleans; `fork: boolean`; `importSessions: boolean`; `usage: "tokens-and-cost" | "tokens" | "none"`; `approvals: "host" | "relayed" | "runtime" | "none"` (who decides tool permissions: the Gateway's approval flow, the runtime's requests relayed to the user, the runtime alone, or nobody); `questions: boolean` (structured questions to the user); `compaction: "host" | "runtime" | "none"`; `subAgents: boolean`; `pty: boolean` (the real CLI can be opened in a host terminal); `skills: "token" | "native-dir" | "sentence"` (see `skills.Invocation rewriting per runtime`). Unknown flags sent by a newer host are ignored by clients. These flags are the single vocabulary for runtime capabilities: other capabilities name them by these identifiers (never by synonyms), and they are the contract `chat-agent.Composer control row` uses to show, dim or hide composer and message controls. One further flag is published per runtime: `proxy: "acp" | "no"` (`agent-runtimes.Proxy profiles for CLI runtimes`). `jcTools` is `native` or `bridge` only on a runtime where the server can bind each `jc_*` call to its agent session from the Gateway-reported tool call (`server-api.Agent tool endpoint and session binding`); binding is established per runtime by spike S23 (passed on `claude-cli` only so far), and a runtime on which it fails is published `jcTools: "none"` and is not offered for `jc_*` tools. [NEW]

#### Scenario: Flags are complete
- **WHEN** any runtime entry is returned
- **THEN** every flag above is present with a value of the stated type

#### Scenario: Model narrows attachments
- **WHEN** runtime `builtin` has `attachments.image: true` and the selected model's `input` is `["text"]`
- **THEN** that model's `capabilities.attachments.image` is false

### Requirement: Published capability matrix
The product SHALL publish the capability matrix in Settings ▸ Runtimes ("Compare runtimes"), in `docs/product/RUNTIME-MATRIX.md`, and through `jagentchill.runtime.matrix.get` (scope `jagentchill.config.read`), all generated from the same data. The values below are the required behaviour for the pinned Gateway tag; cells marked ‡ rest on an unverified OpenClaw behaviour, are confirmed by the named spike, and take the stated fallback when the spike fails.

| Flag | `builtin` | `claude-code` | `gemini-cli` | `codex` | `copilot` | ACP runtimes |
|---|---|---|---|---|---|---|
| jcTools | native (the Gateway's MCP client on `mcp.servers.jagentchill`) | bridge (the backend's generated strict MCP configuration, which merges the enabled `mcp.servers`) ‡S8, fallback none | bridge (generated CLI settings carrying the enabled `mcp.servers`) ‡S8, fallback none | bridge (the `mcp.servers.jagentchill.codex` thread projection) ‡S8, fallback none | bridge ‡S8, fallback none | bridge (the host-wide setting of `agent-runtimes.Custom ACP command runtime`) ‡S8, fallback none |
| jcToolsOnly | yes | yes ‡S8, fallback no | yes ‡S8, fallback no | yes ‡S8, fallback no | no | no ‡S8 (yes only for a target whose agent honours a tool-disable configuration; fallback no) |
| nativeToolCoverage | yes | yes ‡S8, fallback no | yes ‡S8, fallback no | yes ‡S8, fallback no | no ‡S8 | no (the agent executes its native tools itself) |
| steer | yes | yes ‡S11, fallback no | yes ‡S11, fallback no | yes (batched `turn/steer`) | yes ‡S11, fallback no | no |
| queueModes | steer, followup, interrupt | followup, interrupt (+ steer per S11) | followup, interrupt (+ steer per S11) | steer, followup, interrupt | followup, interrupt (+ steer per S11) | followup, interrupt |
| productModes | all four | all four | Edit, Auto ‡S8 | all four | all four ‡S8 | per advertised modes |
| liveModeChange | yes | no | no | no (interrupt and continue) | no ‡S8 | no |
| thinking | per model | per model | no | per model | per model ‡S8 | when the agent advertises an effort option |
| attachments | per model `input[]` | image | image | image | image ‡S8 | image only |
| resume | yes | yes (stored CLI session id) | yes (`--resume`) | yes (native thread) | yes ‡S8 | when the agent supports `session/load` |
| rewind | conversation ‡S12, fallback none; files: no runtime at the pinned tag | none | none | none | none | none |
| fork | yes | yes (`--fork-session`) | no | no | no | no |
| importSessions | no | yes | no | yes | no | `acp-opencode`, `acp-pi` yes; others no |
| usage | tokens-and-cost for API-key profiles; tokens for plan-billed profiles | tokens | tokens | tokens ‡S8, fallback none | tokens ‡S8, fallback none | none ‡S8 |
| approvals | host | host (tool-permission relay; grants never cover shell) | runtime for native tools, host for JAgentChill tools | host | host ‡S8 | relayed (`approve-reads` profile) |
| questions | yes | yes (the Gateway question flow, answered by the server over its gateway link) ‡S21, fallback no | no | no ‡S8 | no ‡S8 | no |
| compaction | host | runtime (`/compact` forwarded) | runtime (manual compaction unsupported) | runtime | runtime | runtime |
| subAgents | yes | yes | no | yes | no | no |
| pty | no | yes | no | yes | no | `acp-opencode`, `acp-pi` yes; others no |
| skills | token | token (passed as a temporary CLI plugin directory) | token | token | token | native-dir or sentence |

| proxy | not applicable (endpoints and base-URL overrides) | acp ‡S22, fallback no | acp ‡S22, fallback no | acp ‡S22, fallback no | acp ‡S22, fallback no | acp ‡S22, fallback no |
| relay (stream deltas, tool events, usage, approvals) | yes ‡S21 | yes ‡S21 | yes ‡S21 | yes ‡S21 | yes ‡S21 | yes ‡S21 |

A runtime whose relay row fails is not offered (`runtime/relay-unsupported`). The ACP column additionally rests on spike S24 with the fallbacks of `agent-runtimes.ACP target runtimes`. A custom profile with realisation `native` shows its base runtime's column; a custom profile with realisation `acp` (every profile that sets `env`, `command` or `proxy`) and a custom ACP command show the ACP column, narrowed by the agent's own `initialize` response. [NEW]

#### Scenario: Matrix screen
- **WHEN** an admin opens "Compare runtimes"
- **THEN** a table lists every enabled runtime as a column and every flag as a row, each cell a text value with an icon, and a footnote row "Verified on <date> against Gateway <version>"

#### Scenario: Spike fails
- **WHEN** contract test S11 shows that `claude-code` does not accept a steer
- **THEN** the generated matrix has `steer: no` for `claude-code` in the app, the document and the RPC, with no manual edit

### Requirement: Capability matrix generated from contract tests
The matrix data SHALL be produced by the runtime contract suite of design D18: one scripted scenario per flag (JAgentChill tool call, a launch with native tools disabled followed by a prompt that asks for a shell command, a native tool call reported as a tool item of the Gateway's `agent` events and refused by a deny entry of the agent's Gateway tool policy, steer during a tool call, each product mode, mode change mid-turn, thinking change, each attachment kind, restart-and-resume, rewind, fork, import, usage payload, approval prompt, question, sub-agent spawn, PTY start, skill reference) executed against every built-in runtime on a live Gateway. The suite writes `packages/protocol/data/runtime-matrix.json` `{gatewayVersion, generated_ms, runtimes: {<id>: {flags, evidence: {<flag>: "pass" | "fail" | "not-run"}}}}`. A release build fails when the file's `gatewayVersion` differs from the pinned tag, when any built-in runtime is missing, or when a required cell of `agent-runtimes.Published capability matrix` without a ‡ marker is `fail`. A flag whose scenario was `not-run` (CLI not available in the test environment) is published with the fallback value and the footnote "Not verified in this release". At run time the host intersects the file with what the live Gateway reports (`models.list` `runtimeChoices`, ACP `initialize`), so a host can only narrow, never widen, a published flag. [NEW]

#### Scenario: Stale matrix blocks the release
- **WHEN** the pinned Gateway tag is raised and the matrix file was not regenerated
- **THEN** the release build fails with "runtime-matrix.json was generated for <old version>"

#### Scenario: Host narrows a flag
- **WHEN** the file says an ACP runtime supports image attachments and the installed agent's `initialize` response does not advertise image prompts
- **THEN** the snapshot publishes `attachments.image: false` for that runtime on that host

### Requirement: Behaviour when a runtime lacks a capability
A control or action that needs a missing capability SHALL never fail silently or be silently ignored. Rules: (1) per-session controls stay visible and dimmed with the reason as tooltip (desktop/web) or inline caption (mobile) — never hidden — when the host has the feature but the selected runtime lacks it; controls are hidden only when the host lacks the feature entirely; (2) `steer` false → a message sent while a turn runs is delivered as `followup`, the queued chip reads "Will send after this turn" and the composer hint reads "<runtime> cannot take messages mid-turn"; (3) product mode unsupported → the mode row is dimmed with the reason and cannot be selected; (4) `liveModeChange` false → a mode change during a running turn is accepted as pending, returns the notice "Applies after this turn", and is applied before the next turn starts; plan approval follows the same limit — on such a runtime an approved plan is executed in a new turn (`chat-agent.Plan approval`), never by a mode change inside the plan turn; (5) attachment kind unsupported → the attachment is refused at attach time with "<runtime> accepts images only" and the draft is unchanged; (6) `jcTools: "none"` → the runtime cannot be selected for a creative agent or for any session bound to a video project ("This runtime cannot use editor tools") and is selectable only for workspace sessions; `jcToolsOnly: false` → the runtime is workspace-class for editor devices (`agent-runtimes.Creative sessions on CLI and ACP runtimes`); `nativeToolCoverage: false` or `jcTools: "none"` → the runtime cannot staff a team role or lead a team, as stated once in `multi-agent-orchestration.Runtime eligibility for team roles`; (7) `usage: "none"` → usage surfaces show "Not reported by <runtime>" instead of zero; (8) `rewind`, `fork`, `importSessions`, `pty` false → the corresponding menu item is absent for that session and the reason appears in "Compare runtimes"; (9) `questions` false → `jc_session_ask` is delivered as a plain assistant message ending the turn; (10) `resume` false → after a Gateway restart the session continues with the durable hand-over of `agent-runtimes.Durable history hand-over` and a status line "Context restored from history". Server-side, any request needing a missing capability fails with `runtime/unsupported-capability` and `details {runtimeId, capability}`. [NEW]

#### Scenario: Steer on an ACP runtime
- **WHEN** the user presses Enter during a running turn on `acp-opencode`
- **THEN** the message is queued as a follow-up, its chip reads "Will send after this turn", and it is delivered when the turn ends

#### Scenario: Editor tools required
- **WHEN** the user tries to switch a project-bound session to a runtime with `jcTools: "none"`
- **THEN** the row is dimmed with "This runtime cannot use editor tools" and a direct RPC attempt fails with `runtime/unsupported-capability`

#### Scenario: Usage not reported
- **WHEN** a session ran three turns on a runtime with `usage: "none"`
- **THEN** the session usage indicator reads "Not reported by <runtime>" and the totals are not shown as 0 tokens

### Requirement: Session control application
Model, thinking, mode and feature changes on a live session SHALL be applied before the next `chat.send`, because `chat.send` carries no model. The runtime-side contract is `jagentchill.session.control.set {sessionKey, ref?, thinkingOptionId?, modeId?, features?, expected?: {lifecycleRevision?, modeId?}}` (scope `jagentchill.agent.use`) → `{accepted, applied: {ref, modeId, thinkingOptionId, featureValues}, pending?: {modeId?}, notices: {code, message}[], resetFeatures[]}`. The server validates the request against the snapshot and the policy of `agent-runtimes.Runtime policy enforcement on the host` — refusing it with its error before any Gateway call — and then applies it over the gateway link with `sessions.patch {model, thinkingLevel, permissionMode, fastMode, contextWindow, responseUsage, toolOverrides}` (using the Gateway's `expected*` compare-and-swap guards) and, for ACP runtimes, the ACP mode and configuration calls; it then reads the session back and returns the effective values, which are what is stored and broadcast to every device viewing the session. `ref: null` selects the runtime's default model. A change of `ref` to another runtime is refused here with `runtime/switch-required` and must use `agent-runtimes.Switch runtime operation`. None of these changes cancels a running turn; a model change during a turn applies to the same turn only where the Gateway marks a live switch, otherwise it returns the notice `applies-next-turn` ("Applies to the next message"). Each call completes within 3 s or fails with `TIMEOUT` leaving the session unchanged. This method is the only way a device changes a session's model, thinking, mode or features: no device calls `sessions.patch`. In the Gateway, `model`, `thinkingLevel` and `fastMode` need its write scope while `contextWindow`, `responseUsage`, tool overrides and `permissionMode: "full"` need its administrator scope; the server's gateway link supplies either, the latter gated by spike S12. [NEW]

#### Scenario: Mode change during a CLI turn
- **WHEN** the mode is changed to Plan while a `claude-code` turn is running
- **THEN** the response has `accepted: true`, `pending.modeId` set, the notice "Applies after this turn", and the session's permission mode changes when the turn ends and before the next one starts

#### Scenario: Read-back is authoritative
- **WHEN** a mode is requested and the runtime reports a different effective mode afterwards
- **THEN** `applied.modeId` is the runtime's value and every device shows that value

#### Scenario: Stale expectation
- **WHEN** two devices change the mode at the same time with the same `expected.modeId`
- **THEN** the second call fails with `CONFLICT` and that device refreshes the control to the first device's choice

#### Scenario: Refused before the Gateway
- **WHEN** an `editor` device calls `jagentchill.session.control.set` with a `modeId` that is the runtime's unattended mode
- **THEN** the call fails with `SCOPE_DENIED`, no `sessions.patch` was made, and the session is unchanged

### Requirement: Steer support contract
For a session with a running turn, the runtime layer SHALL resolve the requested queue mode against `capabilities.queueModes` inside the server, as part of `jagentchill.chat.send` (`chat-agent.Steer, queue and interrupt while running`): `steer` on a runtime with `steer: true` is sent by the server as the Gateway's `chat.send {queueMode: "steer"}` and is delivered at the next runtime boundary without interrupting a tool call in progress; `steer` on a runtime with `steer: false` is downgraded to `followup` and the response carries `downgradedFrom: "steer"`; `interrupt` aborts the active run and starts a new turn on every runtime; `followup` waits for the turn to end. **Expected-turn guard.** The Gateway's `chat.send` carries no expected run id (its only compare-and-swap field, `expectedLeafEntryId`, is ignored for steer sends, `packages/gateway-protocol/src/schema/logs-chat.ts:343-349`), so the guard is implemented by the server: a steer carries `expectedRunId`, and the server compares it with the session's active run id immediately before the Gateway call; a mismatch returns `{delivered: false, effective: "none", reason: "turn-changed"}` and sends nothing. The remaining window between that check and the Gateway's delivery cannot be closed without a change to OpenClaw and is accepted as stated in the chat requirement. `jagentchill.session.queue.resolve {sessionKey, requested, expectedRunId?}` (scope `jagentchill.agent.use`) returns `{effective, downgradedFrom?, reason?}` — including `{effective: "none", reason: "turn-changed"}` — without sending anything, so that a client can label its send button before the user presses it. A steer that the Gateway reports as requiring a follow-up turn (changed model selection, account pin or tool permission since the turn began) is reported the same way with reason "Settings changed during this turn". Queued messages are the Gateway's pending inputs: kept by the Gateway across reconnects until consumed or cancelled, removed one at a time by the server with `chat.abort {sessionKey, runId: <pending input's runId>}` and all at once with `chat.abort {discardPendingInput}` / `sessions.abort {clearQueued}`. Steer on the CLI runtimes and per-item removal of pending inputs are gated by spike S11. Swarm collector children are never steerable. [NEW]

#### Scenario: Downgrade
- **WHEN** `queue.resolve` is called with `requested: "steer"` for a session on an ACP runtime
- **THEN** it returns `{effective: "followup", downgradedFrom: "steer", reason: "This runtime cannot take messages mid-turn"}`

#### Scenario: Steer during a tool call
- **WHEN** a steer is sent to a `builtin` session while a `jc_generate_video` call is running
- **THEN** the tool call is not cancelled and the steer text is delivered to the model at the next boundary of the same turn

#### Scenario: Expected turn no longer active
- **WHEN** `queue.resolve` is called with `requested: "steer"` and an `expectedRunId` that is not the session's active run
- **THEN** it returns `{effective: "none", reason: "turn-changed"}`

### Requirement: Switch runtime operation
`jagentchill.session.runtime.switch {sessionKey, ref, idempotencyKey}` (scope `jagentchill.agent.use`, subject to `agent-runtimes.Who can configure and who can select`) SHALL move a live session to another runtime while keeping the session. Steps, in order: (1) validate target readiness, policy and required capabilities before any Gateway call — on failure nothing changes; the caller is a device (checked under `agent-runtimes.Who can configure and who can select`) or an agent through `jc_agent_set_model` — for an agent caller the readiness, policy and "who can select" checks are evaluated with the owner device of the caller's tree root (`multi-agent-orchestration.Ownership checks along the tree`), so an agent can never select what its owner is not permitted to select —, and an agent caller can never change an agent's class: a target that would make a creative-class agent workspace-class is refused with `AGENT_CLASS_DENIED` (`multi-agent-orchestration.Agent classes and creation privileges`); (2) when the target is the same runtime, perform a plain model change through `agent-runtimes.Session control application` and stop — a provider change inside `builtin` is such a change and keeps the full native transcript; (3) cancel a running turn (reason `runtime-switch`) and wait up to 10 000 ms for the acknowledgement, then force `sessions.abort`; pending permission and question cards of that turn are resolved as cancelled on every device; (4) build and persist the hand-over of `agent-runtimes.Durable history hand-over`; (5) apply `sessions.patch {agentRuntime, model}` on the same Gateway session; when the Gateway refuses an in-place change because the session's native transcript is locked to its creating harness or ACP backend, the server creates a new Gateway session (`parentSessionKey` = the old key, same agent, `cwd`, project binding and tool overrides), closes the old one as "runtime switched", and re-points the product session record to the new key; (6) reset to the target's defaults: native mode, thinking option, feature values and runtime-specific extras; (7) publish the new state. Kept: the product session id, title, timeline as displayed, project binding, workspace directory, folder, tags, pin, queued user messages in order, attached skills (re-resolved per `skills.Invocation rewriting per runtime`), pending proposals, usage totals and the sub-agent tree records. Reset: native mode, thinking, features, unattended grant, native-side context beyond the hand-over, prompt-cache reuse. The product mode (Ask/Plan/Edit/Auto, ordered from least to most permissive) is kept when the target supports it; otherwise the session takes the most permissive supported mode that is not more permissive than the current one and the response lists the change; when no such mode exists the switch is refused with `runtime/unsupported-capability` unless the request carries `acceptModeChange: "<modeId>"` naming the mode the user confirmed — a switch never makes a session more permissive without that explicit confirmation. The operation completes within 5 s after the cancel acknowledgement; a failure in step 5 restores the previous runtime selection and reports `runtime/switch-refused`. In-place switching and the amount of history a native runtime receives are gated by spike S10; the re-homing path of step 5 is the fallback. [NEW]

#### Scenario: Switch while idle
- **WHEN** an admin switches a workspace session from `builtin` to `claude-code`
- **THEN** the session id, title and timeline are unchanged, the mode control shows the target's default mode, thinking and features show the target's defaults, and the next message runs on `claude-code`

#### Scenario: Switch during a turn
- **WHEN** the switch is requested while a turn is running
- **THEN** the turn is cancelled first, its permission card disappears on every device, the timeline shows "Turn stopped — runtime switched", and then the switch completes

#### Scenario: Never more permissive
- **WHEN** a session in Ask is switched to a runtime that supports only Edit and Auto
- **THEN** the switch is refused with `runtime/unsupported-capability` and the dialog explains "This runtime cannot run in Ask mode", offering "Switch and use Edit"
- **AND** only after the user confirms does the client resend with `acceptModeChange: "edit"`, and the switch then succeeds in Edit

#### Scenario: In-place change refused
- **WHEN** the Gateway rejects `sessions.patch {agentRuntime}` for an ACP session
- **THEN** a new Gateway session is created and bound to the same product session id, and the user sees one continuous timeline

### Requirement: Durable history hand-over
When a switch targets a runtime that keeps its own native context (every runtime except `builtin`, which reads the Gateway transcript itself), the server SHALL carry the prior conversation as a curated text hand-over and SHALL store it durably; JAgentDesk keeps this in the memory of its process and loses it on restart, which is corrected here. Content: a header (session title, source runtime and model, workspace directory, project name, creation time, item count) followed, in timeline order, by user messages, assistant messages and tool calls (tool name, a one-line input summary, and the result truncated to 2 000 characters); reasoning text, attachments' binary content and secrets are excluded; attachments are listed by name and kind. The whole document is wrapped in a `<chat-history-summary>` block and capped at 200 000 characters: when longer, the oldest items are dropped whole and the marker "[<n> earlier items omitted]" is inserted after the header — JAgentDesk applies no cap. It is stored in the server's host database (`runtime_handover {sessionId, fromRef, toRef, text, itemCount, omittedCount, created_ms, status: "staged" | "delivered" | "superseded", delivered_ms?}`), read with `jagentchill.session.handover.get {sessionKey}` (scope `jagentchill.agent.use`). Delivery: the hand-over is prepended to the next user turn on the new runtime by the server itself — every send passes `jagentchill.chat.send`, so the server adds the stored text as the leading block of the message it relays (as a text attachment, or inline text for image-only runtimes — spike S10 confirms per runtime which of the two forms reaches the model); no client assembles it. It is rendered collapsed in the timeline as "Chat history (<n> items)". It is marked `delivered` only when that turn's prompt is acknowledged by the runtime; a failed or cancelled first turn leaves it `staged` and it is sent again. A second switch before delivery marks the record `superseded` and builds a new one from the full timeline. Delivered records are kept 30 days and are viewable from the session menu ("View carried context"). Building the hand-over for 5 000 timeline items takes at most 2 s. [NEW]

#### Scenario: Survives a restart
- **WHEN** the user switches runtime, the Gateway restarts, and the user then sends a message
- **THEN** the message is delivered with the stored hand-over and the new runtime answers with knowledge of the earlier conversation

#### Scenario: Long conversation
- **WHEN** the curated history is 450 000 characters
- **THEN** the stored text is at most 200 000 characters, begins with the header and "[<n> earlier items omitted]", and ends with the most recent items intact

#### Scenario: First turn fails
- **WHEN** the first turn on the new runtime fails before the prompt is acknowledged
- **THEN** the record stays `staged` and the next message carries the hand-over again, exactly once

#### Scenario: Switch to Built-in
- **WHEN** a session is switched from `codex` to `builtin`
- **THEN** no hand-over record is created and the status line reads "Built-in reads the full conversation"

### Requirement: Switch notices and limits
After a switch the server SHALL return, and the session SHALL show, the following: a toast "Runtime switched — your chat context carries over to the next message." (localised, 5 s); a status line in the timeline "Switched from <old runtime · model> to <new runtime · model>" with the time; the notice "Earlier turns cannot be rewound or re-run on <new runtime>" when the target has its own native context; "Mode reset to <mode>", "Thinking reset to <option>" and "Features reset" lines for each value that changed; and "Unattended turned off" when a grant was cleared. The switch confirmation dialog — shown before a switch that crosses runtimes, with a "Don't ask again on this device" checkbox — lists what is kept and what resets and warns "The new runtime starts from a summary, not the full transcript" for native-context targets. Switching back to a previously used runtime starts a fresh native session with a new hand-over; the earlier native session is not resumed. At most 20 runtime switches per session per hour are accepted; the next attempt fails with `RATE_LIMITED`. [NEW]

#### Scenario: Notices
- **WHEN** a session in `claude-code` with thinking `high` is switched to `codex`
- **THEN** the timeline shows the switch line, "Thinking reset to <codex default>", and the rewind actions on earlier messages are absent

#### Scenario: Rate limit
- **WHEN** a client requests a 21st switch within one hour
- **THEN** the call fails with `RATE_LIMITED` and `details.retryAfter_ms`

### Requirement: Session import from a CLI's native history
The server SHALL let a workspace-capable user adopt a session started in a CLI's own interface, for runtimes with `importSessions: true`, by reusing the Gateway's session catalogs (`sessions.catalog.list | read | import | continue`; bundled catalog ids `claude`, `codex`, `opencode`, `pi`). `jagentchill.session.import.list {runtimeIds?, cwd?, since_ms?, limit?}` (scope `jagentchill.agent.use`; default limit 20, max 100, newest first) returns rows `{runtimeId, nativeId, cwd, title?, promptPreviews[] (≤ 3, each ≤ 160 chars), lastActivity_ms, alreadyImported}` plus `failedRuntimeIds[]`; rows already imported are flagged and filtered by default. `jagentchill.session.import.create {runtimeId, nativeId, cwd, projectId?, tags?}` creates a product session of the workspace class on that runtime, resumes the native session, replays its history into the timeline (including native sub-agent events where the catalog provides them), and publishes the session only when replay finished; importing the same `nativeId` twice fails with `ALREADY_EXISTS` and the message "This session is already imported". An imported session starts in the runtime's default mode with no unattended grant. Import reads history through the catalog only and never copies CLI credential files. Titles fall back to "Untitled session" and previews to "No prompt preview". The import sheet UI is owned by `chat-agent.Import CLI sessions`. [NEW]

#### Scenario: List across runtimes
- **WHEN** the user opens import with `claude-code` and `codex` enabled and the Codex catalog fails
- **THEN** Claude Code rows are listed and `failedRuntimeIds` contains `codex`, which the sheet shows as "Unable to load sessions for Codex"

#### Scenario: Import and continue
- **WHEN** the user imports a Claude Code session with 40 messages
- **THEN** a new session appears with those messages in its timeline and the next message continues the same native session

#### Scenario: Duplicate import
- **WHEN** the same native session is imported again
- **THEN** the call fails with `ALREADY_EXISTS` and no second session is created

### Requirement: Native CLI in a host terminal
For runtimes with `pty: true`, a device with scope `jagentchill.host.exec` (role `admin`) SHALL be able to open the CLI's real interactive interface in a terminal tab of the server's own PTY worker: the server starts the CLI's executable (path from `agent-runtimes.Runtime snapshot`) in the workspace `cwd` as `workspaces-terminal.CLI runtime interface in a terminal tab` defines, on macOS, Windows and Linux hosts alike; OpenClaw's `sessions.catalog.startTerminal` and the Gateway terminal are not used, and `gateway.terminal.enabled` stays false (`platform-skeleton.Gateway run profile`). Entry points: "Open in terminal" on the runtime detail and on a workspace session's menu (continuing that session's native id where the catalog supports `continueSession`). The terminal tab, its role check and its lifecycle are owned by `workspaces-terminal.CLI runtime interface in a terminal tab` (created, attached, resized and closed through `workspaces-terminal.Terminal RPC surface and size ownership`). A terminal-mode CLI is a byte stream: the server records no structured tool calls, proposals, approvals or usage for it, the pane header shows "Terminal mode — activity is not tracked", and the session's usage shows "Not reported". The action is absent for editor and viewer devices. While host terminals are off (`workspaces-terminal.Terminal enablement and host-shell warning`) the action is shown disabled with "Terminals are turned off on this host" and every RPC that would start one fails with `terminal/disabled`, the code defined in `workspaces-terminal.Workspace, file, git and terminal error codes`; no other code is used for that condition by this capability. [NEW]

#### Scenario: Open Claude Code in a terminal
- **WHEN** an admin presses "Open in terminal" for `claude-code` in a workspace directory
- **THEN** a terminal pane opens running the `claude` interface in that directory, and the pane header shows "Terminal mode — activity is not tracked"

#### Scenario: Terminals disabled
- **WHEN** the host terminal setting is off
- **THEN** the action is shown disabled with "Terminals are turned off on this host" and an RPC attempt fails with `terminal/disabled`

### Requirement: Per-role defaults through ORC
The runtime of an agent SHALL default from ORC: every ORC profile carries `{runtime, provider, model, thinking?, mode?, params}` (see `orc-model-routing.Profile schema`), and this capability supplies the validation for those fields — `runtime` must be an enabled runtime id; `{runtime, provider, model}` must exist in the snapshot or be marked `unverified` when the runtime is not `ready`; `thinking` must be one of that model's options on that runtime; `mode` must be a supported, non-unattended mode of that runtime. A creative role (director, screenwriter, storyboard, editor, reviewer and custom creative roles) accepts only runtimes with `jcTools` not `none`; a profile naming a CLI or ACP runtime makes sessions of that role workspace-class — except where `agent-runtimes.Creative sessions on CLI and ACP runtimes` applies — and is saveable only by an admin with the warning "Agents on this runtime can run commands on <host name>"; a profile used by a team role additionally needs a runtime that is eligible per `multi-agent-orchestration.Runtime eligibility for team roles`. Resolution order for a new session or agent is exactly `orc-model-routing.Override precedence`, which this capability quotes and does not reorder: a per-run override first; then the per-session level, which for the agent's own model is the explicit selection made in the draft; then the container (project or film); then the Team route; then the role's route in the global configuration. Device-remembered preferences (last model, mode, thinking-by-model and feature values per runtime) only pre-fill the controls when the user manually picks that runtime; they never override an ORC default. When a resolved target is not selectable (runtime disabled, signed out, model gone), resolution moves to the route's next fallback and the session shows `orc-model-routing.Fallback disclosure`; when no target remains, the start fails with `NO_ROUTE`. Because the Gateway has no per-agent runtime pin, the projection writes `agents.entries.jagentchill-<persona>.models["<provider>/<model>"].agentRuntime` and the server additionally sets `agentRuntime` explicitly on every session it creates. [NEW]

#### Scenario: Role default
- **WHEN** the `screenwriter` role's default profile is `{runtime: "builtin", provider: "anthropic", model: "<id>"}` and the user starts a Screenwriter session without touching the model control
- **THEN** the session runs on that triple and the model control shows it

#### Scenario: Fallback when signed out
- **WHEN** the `editor` role's primary profile names `claude-code`, which is signed out, and the first fallback names `builtin`
- **THEN** the session starts on the fallback and shows the fallback disclosure naming the reason "Claude Code needs sign-in"

#### Scenario: Unattended mode in a profile
- **WHEN** an ORC update sets a profile's `mode` to a runtime's unattended mode
- **THEN** validation fails with `INVALID_PARAMS` and the message "Unattended modes cannot be a default"

### Requirement: Who can configure and who can select
Privileges SHALL follow the device roles and agent classes of design D25. **Configure** (scope `jagentchill.config.write`, plus `jagentchill.secrets.manage` for keys; role `admin` only): enable, disable, reorder and remove runtimes; add from the catalogue; create and edit profiles and custom ACP commands; add or remove models; connect, sign in, reorder, test and remove auth profiles; add custom endpoints; run diagnostics; grant unattended mode. **Host execution** (scope `jagentchill.host.exec`; role `admin` only): open a CLI in a host terminal (`agent-runtimes.Native CLI in a host terminal`) and "Open terminal on host" from an install hint; this is the same scope that `workspaces-terminal.Role and permission matrix` requires for terminals, workspace scripts and git mutations. **Select** (scope `jagentchill.agent.use`; roles `editor` and `admin`): choose runtime, model, thinking, mode and features for a session; switch runtime; refresh the snapshot; import sessions. **Read** (scope `jagentchill.config.read`; all roles): snapshot, model list, matrix, provider list without account details beyond the label. Agent class (design D25; classes and the creation privilege are defined in `multi-agent-orchestration.Agent classes and creation privileges`): a session on `builtin` with a creative agent is creative-class and selectable by `editor`; a session on any CLI or ACP runtime, or on `builtin` with file or command tools, is workspace-class by default and is selectable only by `admin`, or by `editor` when the host setting "Allow workspace agents for editors" (`agents.allowWorkspaceAgentsForEditors`, default false) is on. The single exception is `agent-runtimes.Creative sessions on CLI and ACP runtimes`. `models.list` reports this as `policy.canSelectWorkspaceRuntimes`, and for an editor without it CLI and ACP groups are listed dimmed with "Admin devices only". A `viewer` sees all controls read-only. These rights are on top of session ownership: a device selects, switches and patches only in a session it can act in under `server-api.Session ownership and visibility`. No device ever holds an OpenClaw scope of any kind; a denied call returns `SCOPE_DENIED` before the Gateway is called. [NEW]

#### Scenario: Editor on a default host
- **WHEN** an editor opens the model browser on a host where the workspace-agent setting is off
- **THEN** Built-in models are selectable, CLI and ACP groups are dimmed with "Admin devices only", and `jagentchill.session.runtime.switch` to `codex` fails with `SCOPE_DENIED`

#### Scenario: Host allows workspace agents for editors
- **WHEN** an admin turns on "Allow workspace agents for editors"
- **THEN** within 2 s the editor's model browser makes ready CLI runtimes selectable, while unattended modes remain "Admin devices only"

#### Scenario: Viewer
- **WHEN** a viewer opens Settings ▸ Runtimes
- **THEN** the list and the matrix are visible, and every switch, button and menu that changes state is absent or disabled

### Requirement: Creative sessions on CLI and ACP runtimes
CLI and ACP runtimes SHALL be workspace-class by default (design D25). There is exactly one carve-out: a CLI or ACP runtime is permitted to serve a **creative** agent session started by a device with role `editor` only when the published matrix (`agent-runtimes.Published capability matrix`) shows, for that runtime on that host, both `jcTools` `native` or `bridge` and `jcToolsOnly: true` — that is, the runtime can be launched with every native file, command, process, web and browser tool disabled so that only the server's `jc_*` tools are callable. In every other case — `jcToolsOnly: false`, a cell published with its fallback value because its spike failed or was not run, a custom profile or custom ACP command (which never has `jcToolsOnly: true`), or any session that needs a native tool — selecting the runtime requires role `admin` or the host setting "Allow workspace agents for editors" (`agents.allowWorkspaceAgentsForEditors`, `multi-agent-orchestration.Agent classes and creation privileges`), and the session is workspace-class. A session under the carve-out: is created with the launch restriction applied by the server (the CLI's tool-restriction arguments or generated settings; ACP `clientCapabilities {fsRead: false, fsWrite: false, terminal: false}` plus the agent's own tool-disable configuration) and with the persona's `jc_*`-tool allow-list; has class `creative` on its agent record and in `models.list`, where such runtimes are reported per runtime as `policy.creativeRuntimeIds[]`; never offers an unattended mode; cannot be opened in a host terminal; and is checked by `agent-runtimes.Runtime policy enforcement on the host` — a native tool event observed on such a session aborts the turn within 1 000 ms, switches the session back to `builtin` through `agent-runtimes.Switch runtime operation`, writes the audit record `runtime.policy.violation` with `reason: "native-tool-in-creative-session"`, and marks the runtime `jcToolsOnly: false` on this host until the next snapshot refresh by an admin. The carve-out grants no workspace directory, no exec approval and no additional scope, and does not make the runtime eligible for team roles (`multi-agent-orchestration.Runtime eligibility for team roles`). Every other statement about agent class in `agent-runtimes.Who can configure and who can select`, `agent-runtimes.Per-role defaults through ORC`, `multi-agent-orchestration.Agent classes and creation privileges`, `agent-workflows.Roles, permissions and agent classes` and `workspaces-terminal.Role and permission matrix` is read with this carve-out and adds no other exception. [NEW]

#### Scenario: Editor selects a CLI runtime that can run JAgentChill tools only
- **WHEN** the matrix on this host has `jcTools: "bridge"` and `jcToolsOnly: true` for `claude-code`, the workspace-agent setting is off, and an `editor` device selects `claude-code` for a Screenwriter session
- **THEN** the session starts as a creative session with native tools disabled, `tools.effective` lists only `jc_*` tools, and no unattended mode is offered

#### Scenario: Runtime cannot disable its native tools
- **WHEN** the matrix has `jcToolsOnly: false` for an ACP runtime and an `editor` device without the host setting selects it
- **THEN** the row is dimmed with "Admin devices only" and `jagentchill.session.runtime.switch` to it fails with `SCOPE_DENIED`

#### Scenario: Fallback cell
- **WHEN** the `jcToolsOnly` cell of `codex` is published with its fallback value because spike S8 was not run for it
- **THEN** `codex` is treated as workspace-class for every editor device

#### Scenario: Native tool observed in a creative session
- **WHEN** a creative session on `claude-code` emits a native shell tool event
- **THEN** the turn is aborted within 1 s, the session is switched to `builtin` with the durable hand-over, an audit record `runtime.policy.violation` exists, and editors can no longer select `claude-code` on this host until an admin refreshes the snapshot

### Requirement: Runtime policy enforcement on the host
Runtime, model and mode policy SHALL be enforced by the server **before** it calls the Gateway, in the handler of every relayed method (`server-api.Agent session relay`, `chat-agent.Agent sessions run on Gateway sessions`): no device can create or patch a Gateway session by any other path, because devices hold no OpenClaw scope and never reach the native port (`server-api.Native Gateway port isolation`). (1) **Pre-call check.** `jagentchill.session.create`, `jagentchill.session.control.set`, `jagentchill.session.runtime.switch`, `jagentchill.session.unattended.set`, `jagentchill.session.import.create`, `jagentchill.session.update {agentId}` and `jagentchill.chat.send` each compare the requested or current runtime, model, permission mode and agent with the policy for the calling device and the session's owner (`server-api.Session ownership and visibility`): a workspace-class runtime for a device not permitted to select one, a disabled runtime, a runtime that failed its relay spike, a model outside `agents.defaults.modelPolicy.allow`, `permissionMode: "full"` without an unattended grant, a creative agent on a runtime with `jcTools: "none"`, or a creative session on a CLI or ACP runtime outside `agent-runtimes.Creative sessions on CLI and ACP runtimes` is refused with `SCOPE_DENIED`, `runtime/disabled`, `runtime/relay-unsupported`, `runtime/policy-denied` or `runtime/unsupported-capability` as applicable, and the Gateway is not called. (2) **Tool gate.** The server has no hook inside the Gateway, so the gate has three parts, each a mechanism that exists. (a) Every `jc_*` tool call arrives at the server's tool endpoint, which binds its MCP connection to the agent session whose Gateway-reported tool call matches and serves only reported calls; a call that cannot be bound fails with `SESSION_UNBOUND`, and a call bound to a session whose run has no recorded permitted initiator fails with `SCOPE_DENIED`, and neither changes anything (`server-api.Agent tool endpoint and session binding`, `server-api.Run initiator attribution and host-execution gating`). (b) Native tools are limited before the run starts by the Gateway tool policy the server writes for the session's agent (`agents.entries.<agentId>.tools.allow | deny`, `gateway/openclaw/docs/gateway/sandbox-vs-tool-policy-vs-elevated.md`): a creative agent's policy denies every native file, command, process, web, browser and session tool, so the Gateway itself refuses the call. (c) A native tool call that needs a decision raises a Gateway approval request, which reaches the server only because its link declares the approval capabilities (`server-api.Gateway link`) and which only the server answers (`approval.resolve { id, kind, decision }`, with `operator.approvals`; `server-api.Approval and question resolution`); the server denies it when it has no record for the session or the run has no recorded permitted initiator. In addition the server watches the tool items of the Gateway's `agent` events over its link — the same events from which it binds every `jc_*` call to its session (spike S23) — and a native tool call observed for a session without a record, or outside what the recorded policy permits, aborts the run (`sessions.abort`) and writes the audit record `runtime.policy.violation`. (3) **Sessions changed outside the relay.** The only actors that can still change a session without the relay are on the host itself — the host's own `openclaw` command and agent tools. For these the server keeps a defence in depth, not its primary control: when a session starts, on every session change it observes through the Gateway's `sessions.changed` events over its link, and at the start of every turn it relays, it compares the session's effective runtime, permission mode and agent with the server's record; a session that drifted has its running turn aborted (`sessions.abort`), its `agentRuntime` and `permissionMode` patched back to the recorded values over the gateway link within 1 000 ms, and an audit record `runtime.policy.violation` written. Observation through Gateway session events within 1 000 ms is gated by spike S25; when it fails, the comparison at the start of every turn and the tool gate of rule (2) remain. (4) **Gateway-level switches** are kept minimal: `acp.allowedAgents` lists only enabled ACP runtimes; `gateway.cliAgents.enabled` is true exactly while at least one CLI runtime is enabled and `gateway.terminal.enabled` is always false, whatever the host terminal setting of `workspaces-terminal.Terminal enablement and host-shell warning` (`platform-skeleton.Gateway run profile`); `agents.defaults.modelPolicy.allow` lists only models of enabled runtimes and connected providers. The settings page states that this is policy for devices of one operator and not isolation between mutually untrusted people (see `security-privacy.Trust model`). [NEW]

#### Scenario: Switch refused before the Gateway is called
- **WHEN** an editor device without workspace permission calls `jagentchill.session.runtime.switch` with a `ref` on `claude-code`
- **THEN** the call fails with `SCOPE_DENIED`, the server made no `sessions.patch`, the session never left its runtime, and the device shows "Admin devices only"

#### Scenario: Session patched on the host outside the relay
- **WHEN** someone on the host runs the `openclaw` command to set `agentRuntime: "claude-cli"` on a creative session the server owns
- **THEN** at the latest when the next turn starts the session is back on its recorded runtime, no tool call ran on `claude-cli` for a device, and an audit record `runtime.policy.violation` exists

#### Scenario: Disabled runtime still referenced
- **WHEN** a runtime is disabled while a session on it is idle
- **THEN** the next send is refused with `runtime/disabled` before any Gateway call and the composer shows "This runtime was turned off — choose another" with the model browser action

### Requirement: Runtimes settings screen
The settings content of this capability is split over four of the six tabs of Host ▸ Runtimes & providers (`settings-preferences.Providers and model routing entry points`; the first tab, Providers, is `settings-preferences.Provider access methods and accounts`): **CLI runtimes** (this requirement), **Sign-in & keys** (`agent-runtimes.Direct provider list` and the key, OAuth and profile requirements), **Endpoints** (`agent-runtimes.Shared endpoint record`, `agent-runtimes.Endpoint presets`, `agent-runtimes.Endpoint connection test`, `agent-runtimes.Base-URL override on bundled providers`, `agent-runtimes.Proxy profiles for CLI runtimes`) and **Capability matrix** (`agent-runtimes.Published capability matrix`); the remaining tab, Media providers, is `generation-providers.Providers settings page`. The CLI runtimes tab SHALL contain: a card "CLI runtimes" with one row per CLI runtime (generic glyph, label, id caption, status pill, "<n> models" when ready, version caption, enable switch, drag handle for order); a card "Sign-in & keys" with one row per connected provider (label, the access methods in use — account sign-in, API key —, profile count, worst health pill) and "Add provider", which opens the Sign-in & keys tab; a card "Add runtime" with the searchable catalogue and "Custom ACP command" and "New profile" buttons; and a link "Compare runtimes". Pressing a runtime row opens a detail sheet: status with reason and hint, login state with masked account, model list with search ("Search models", states "Loading models…", "No models detected", "No models match your search", "Retry"), sections "Discovered" and "Custom models" with "Updated <time>", modes, capabilities, and buttons "Add model", "Diagnostic", "Refresh", "Open in terminal" (when available), "Edit" (custom entries), and a menu "Remove runtime" for catalogue and custom entries with the confirmation "Remove <name>? Sessions using it will need another runtime. This cannot be undone." Built-in runtimes cannot be removed, only disabled. Disconnected: "Connect to this host to see runtimes". Empty CLI card (all disabled): "No CLI runtime is turned on". Non-admin devices see the page read-only with the banner "Only admin devices can change runtimes". Mobile: cards stack, sheets are full-height bottom sheets, reorder uses "Move up" / "Move down" in the row menu instead of drag. All rows are reachable by keyboard; the enable switch is announced as "<runtime>, <status>, switch, on/off". [JAD JD-PRV-016] [NEW]

#### Scenario: Model search in the detail
- **WHEN** an admin opens `codex` and types "mini" in the model search
- **THEN** only models whose label or id contains "mini" are listed, or "No models match your search"

#### Scenario: Remove a custom runtime
- **WHEN** an admin confirms "Remove runtime" on a custom ACP command with no references
- **THEN** its configuration entry and its `acpx` agents entry are deleted, it disappears from all pickers within 2 s, and an audit record is written

#### Scenario: Disconnected
- **WHEN** the device is not connected to the host
- **THEN** the page shows "Connect to this host to see runtimes" and no stale switch is interactive

### Requirement: Admin proxy and Gateway reuse
Every Gateway method this capability needs that requires `operator.admin` — `models.authLogin`, `wizard.*`, `models.authSetApiKey`, `models.authLogout`, `models.authOrderSet`, `models.authRefresh`, `models.probe`, `agents.update`, configuration writes, `sessions.patch` with `permissionMode: "full"`, `contextWindow`, `responseUsage` or tool overrides, `sessions.rewind`, `sessions.compact`, ACP spawn, permission and mode control — and the question flow method `question.resolve`, which the Gateway reserves for its own question scope — SHALL be called only by the server over its gateway link (the official `@openclaw/gateway-client`, protocol v4, loopback, with the server's token and Ed25519 device identity and the scopes `operator.read`, `operator.write`, `operator.admin` and `operator.approvals`; `server-api.Gateway link`); no device and no other process holds those scopes. Each proxy method on channel P is narrow (one purpose, typed parameters validated with the shared Zod schemas), checks the caller's device record, role and JAgentChill scope in the handler before calling the Gateway, writes an audit record for every state change (`actorDeviceId`, action, target, outcome; no secret), and is rate limited to 30 calls per device per minute for mutations. There is no generic pass-through: a method name or scope is never taken from client input. Methods the Gateway offers at lower scopes (`models.list`, `models.authStatus`, `acpx.agents.list`, `sessions.describe`, `commands.list`) are called over the same link, because the server is the only client of the Gateway (`server-api.Gateway link`). The named-profile write of `agent-runtimes.API key entry and validation` (a `config.patch`, or the Gateway's own host command run by the server) is subject to the same handler checks, audit record and rate limit. Administrator-scope calls over the gateway link are gated by spike S12; when S12 fails, every admin-requiring action of this capability reports `UNSUPPORTED_FEATURE` with the message "Configure this on the host with the `openclaw` command", the settings page shows the equivalent host command for each action, and read-only features (snapshot, model list, matrix, selection among already-configured runtimes) keep working. Because `models.probe` is among the administrator-scope methods, the S12 fallback also covers validation: a key entered on the host is reported with health `unknown`, "Test" on a profile and the `completion` step of `agent-runtimes.Endpoint connection test` for a saved endpoint report `skipped` with "Not tested on this host version", and rewind, `/compact`, `context_window` and `usage_footer` are absent as their owners state. No file of OpenClaw is edited or added for any of this, and while the Gateway is not linked every method of this requirement answers `GATEWAY_UNAVAILABLE`. [NEW]

#### Scenario: No pass-through
- **WHEN** a client sends `jagentchill.provider.auth.setApiKey` with an extra field `method: "config.set"`
- **THEN** the request fails schema validation with `INVALID_PARAMS` and no core method is called

#### Scenario: Audit of a provider connection
- **WHEN** an admin connects a provider
- **THEN** one audit record with action `provider.auth.connect`, the provider id, the profile id and the device id exists, and it contains no key material

#### Scenario: Administrator-scope calls unavailable
- **WHEN** contract test S12 fails on the pinned Gateway
- **THEN** "Add provider" opens a panel with the host command to run, and existing runtimes remain selectable

### Requirement: Error mapping
Runtime and provider failures SHALL be mapped to one closed set of domain codes under `runtime/` (this list plus the endpoint codes of `agent-runtimes.Endpoint error normalisation`), each with a localised user message and an action, and returned inside the envelope of `server-api.RPC error envelope`: `runtime/not-installed` ("<runtime> is not installed on <host>", Install guide); `runtime/signed-out` ("Sign in to <runtime> on <host>", sign-in hint or Connect); `runtime/disabled` (Enable, admin); `runtime/no-provider` (Connect a provider); `runtime/probe-timeout` (Retry); `runtime/launch-failed` (the CLI exited before its first event; message includes exit code and the first 200 characters of stderr; Diagnostic); `runtime/auth-failed` (the provider rejected the credential mid-session; Sign in again); `runtime/rate-limited` (`retryable: true`, `details.retryAfter_ms`); `runtime/billing` ("The account has no remaining credit or quota"); `runtime/model-unavailable` (the model no longer exists on that runtime; Choose another model); `runtime/context-overflow` (Compact or start a new session); `runtime/unsupported-capability` (`details.capability`); `runtime/switch-required`; `runtime/switch-refused`; `runtime/acp-spawn-unsupported`; `runtime/mode-not-inheritable`; `runtime/unattended-not-granted`; `runtime/login-expired`; `runtime/policy-denied` (a relayed call was refused by `agent-runtimes.Runtime policy enforcement on the host`); `runtime/relay-unsupported` (the runtime failed spike S21 on this Gateway version and is not offered; message "<runtime> cannot be used on this host version"). Source mapping: `models.probe` status `auth` → `runtime/auth-failed`, `rate_limit` → `runtime/rate-limited`, `billing` → `runtime/billing`, `timeout` → `TIMEOUT`, `no_model` → `runtime/model-unavailable`, `format` and `unknown` → `UNAVAILABLE`; `models.list` `unavailableReason` `missing-auth` → `runtime/signed-out`, `auth-failed` → `runtime/auth-failed`, `cooldown` → `runtime/rate-limited`, `unsupported-runtime` → `runtime/unsupported-capability`. A raw CLI or provider message is shown only under a "Details" disclosure, truncated to 2 000 characters and passed through the redaction of `security-privacy.Log and diagnostics redaction`. Turn failures appear as error items in the timeline (`chat-agent.Error items`) carrying the same code and action. [NEW]

#### Scenario: CLI exits at launch
- **WHEN** a CLI process exits with code 127 before emitting an event
- **THEN** the turn fails with `runtime/launch-failed`, the error item reads "<runtime> failed to start (exit 127)" with a "Diagnostic" action for admins, and stderr is under "Details"

#### Scenario: Rate limit with retry time
- **WHEN** the only profile of a provider is rate limited for 90 s
- **THEN** the turn fails with `runtime/rate-limited`, `details.retryAfter_ms` near 90 000, and the error item offers "Retry in 1 min 30 s" and "Choose another model"

#### Scenario: Unknown provider failure
- **WHEN** a provider returns an unrecognised error
- **THEN** the code is `UNAVAILABLE`, the message is "The provider returned an unexpected error", and no credential fragment appears in "Details"

### Requirement: Offline and no-runtime states
The product SHALL define these states. **Not connected to a Gateway**: every runtime control is disabled, the model control shows the last known selection with "Offline", settings show "Connect to this host to see runtimes", and nothing is probed; the editor itself keeps working. **Connected, no runtime ready** (no CLI ready and no provider connected): Home and the session composer show a card "Set up an AI runtime" with two actions — "Use an installed CLI" (opens Runtimes with detected-but-signed-out and not-installed rows first) and "Connect a provider" (opens the provider list) — for admins, and "Ask an admin device to set up a runtime" for editors and viewers; sending is disabled with the tooltip "No AI runtime is ready". **Selected runtime becomes unavailable mid-session**: the composer shows a banner naming the reason with "Choose another runtime" and, where a route fallback exists, "Use <fallback>"; drafts and queued messages are kept. **Host has no network**: CLI and provider probes that need the network report `runtime/probe-timeout` or `UNAVAILABLE`, local providers (`ollama`, `llama-cpp`, `apple-fm`, loopback endpoints) stay `ready`, and the banner reads "The host is offline — only local models are available". **Snapshot still loading**: pickers show skeleton rows for at most the probe deadline and never an empty list labelled as "No models". [NEW]

#### Scenario: First run with nothing configured
- **WHEN** an admin opens Home on a fresh host with no CLI installed and no provider
- **THEN** the card "Set up an AI runtime" is shown with both actions, and the send button is disabled with "No AI runtime is ready"

#### Scenario: Host loses the internet
- **WHEN** the host has no network and an `ollama` model is ready
- **THEN** that model stays selectable, cloud models show "Unavailable — host offline", and a turn on the local model completes

#### Scenario: Reconnect
- **WHEN** the device reconnects to the Gateway
- **THEN** the snapshot is pulled, controls become interactive, and the kept draft is still in the composer

### Requirement: Runtime limits
The following limits SHALL apply per Gateway: 40 endpoint records with at most 2 000 models each; 16 headers and 8 query parameters per endpoint; 20 user presets; 4 equivalent endpoints per model; 50 pinned models per provider; 20 custom profiles (entries with `extends` naming a built-in runtime; community ACP agents and custom ACP commands, which have `extends: "acp"`, do not count toward the 20); 40 **added** runtime entries in total — every entry an admin added counts (a session-path ACP target added from the catalogue, a community ACP agent, a custom ACP command, a custom profile), while the 10 runtimes present by default (the nine built-in CLI runtimes and `builtin`) and catalogue targets not yet added do not; 8 auth profiles per provider; 200 configured and 50 additional models per runtime; 32 environment variables and 32 command arguments per entry; 32 cached snapshot directory scopes; 4 concurrent probes; 1 login per provider and 4 concurrent logins per Gateway; 20 runtime switches per session per hour; diagnostics text ≤ 64 KiB. Exceeding a count limit fails with `QUOTA_EXCEEDED` naming the limit and its value; exceeding a size limit fails with `PAYLOAD_TOO_LARGE`. Limits are constants of the release and are listed in Settings ▸ Runtimes ▸ "Limits". [NEW]

#### Scenario: Twenty-first profile
- **WHEN** an admin creates a 21st custom profile
- **THEN** the update fails with `QUOTA_EXCEEDED`, `details {limit: "customProfiles", max: 20}`, and the form shows "You can have up to 20 custom profiles"

#### Scenario: Concurrent probes
- **WHEN** "Refresh all" is pressed with 12 enabled runtimes
- **THEN** at most 4 probes run at once and all 12 rows settle without any being skipped

### Requirement: Runtime and provider administration RPC surface
This capability SHALL define exactly the channel P methods of the three tables below and no other: the whole `runtime` domain, the sub-namespaces `provider.auth.*`, `provider.endpoint.*`, `provider.preset.*`, `provider.override.*`, `provider.routing.*` and `provider.pin.*` delegated to it within the `provider` domain, and the sub-namespaces `session.control.*`, `session.runtime.*`, `session.handover.*`, `session.queue.*`, `session.import.*` and `session.unattended.*` delegated to it within the `session` domain (`server-api.RPC domain ownership`). The parameters, result and required scope of each method are stated by the requirement named in its row; every method that changes state follows `agent-runtimes.Admin proxy and Gateway reuse`, and every method that names a session applies `server-api.Session ownership and visibility` first.

Domain `runtime` (11 methods; event `jagentchill.runtime.updated` on stream `runtime`, opened and closed with `jagentchill.runtime.subscribe {}` and `jagentchill.runtime.unsubscribe {}`, scope `jagentchill.config.read`; pull RPC `jagentchill.runtime.snapshot.get`):

| Method | Defined in |
|---|---|
| `jagentchill.runtime.config.get` | `agent-runtimes.Runtime configuration store` |
| `jagentchill.runtime.config.update` | `agent-runtimes.Runtime configuration store` |
| `jagentchill.runtime.snapshot.get` | `agent-runtimes.Runtime snapshot` |
| `jagentchill.runtime.snapshot.refresh` | `agent-runtimes.Runtime snapshot` |
| `jagentchill.runtime.diagnose` | `agent-runtimes.Diagnostics report` |
| `jagentchill.runtime.catalogue.list` | `agent-runtimes.One-click ACP catalogue` |
| `jagentchill.runtime.models.list` | `agent-runtimes.Unified model browser data contract` |
| `jagentchill.runtime.models.search` | `agent-runtimes.Aggregator model catalogues` |
| `jagentchill.runtime.matrix.get` | `agent-runtimes.Published capability matrix` |
| `jagentchill.runtime.subscribe` | `agent-runtimes.Runtime and provider administration RPC surface` |
| `jagentchill.runtime.unsubscribe` | `agent-runtimes.Runtime and provider administration RPC surface` |

Enabling, disabling, reordering and removing a runtime, adding a catalogue entry, a profile or a custom ACP command, `extraPath`, `providerGroups` and the "Offer editor tools to ACP agents" switch are all written with `jagentchill.runtime.config.update`; the Runtimes settings actions name no other method.

Delegated within `provider` (29 methods; changes are announced by `jagentchill.provider.changed` of `generation-providers.Provider RPC surface`):

| Method | Defined in |
|---|---|
| `jagentchill.provider.auth.list` | `agent-runtimes.Direct provider list` |
| `jagentchill.provider.auth.connectCloud` | `agent-runtimes.Direct provider list` |
| `jagentchill.provider.auth.setApiKey` | `agent-runtimes.API key entry and validation` |
| `jagentchill.provider.auth.login.start` | `agent-runtimes.OAuth login through the admin proxy` |
| `jagentchill.provider.auth.login.next` | `agent-runtimes.OAuth login through the admin proxy` |
| `jagentchill.provider.auth.login.status` | `agent-runtimes.OAuth login through the admin proxy` |
| `jagentchill.provider.auth.login.cancel` | `agent-runtimes.OAuth login through the admin proxy` |
| `jagentchill.provider.auth.login.transfer` | `agent-runtimes.Login hand-off per platform` |
| `jagentchill.provider.auth.order.set` | `agent-runtimes.Multiple auth profiles with order and rotation` |
| `jagentchill.provider.auth.test` | `agent-runtimes.Multiple auth profiles with order and rotation` |
| `jagentchill.provider.auth.logout` | `agent-runtimes.Sign out and credential removal` |
| `jagentchill.provider.endpoint.discover` | `agent-runtimes.Endpoint model list and discovery` |
| `jagentchill.provider.endpoint.duplicate` | `agent-runtimes.Custom endpoints as direct providers` |
| `jagentchill.provider.endpoint.export` | `agent-runtimes.Endpoint configuration import and export` |
| `jagentchill.provider.endpoint.get` | `agent-runtimes.Custom endpoints as direct providers` |
| `jagentchill.provider.endpoint.import` | `agent-runtimes.Endpoint configuration import and export` |
| `jagentchill.provider.endpoint.list` | `agent-runtimes.Custom endpoints as direct providers` |
| `jagentchill.provider.endpoint.remove` | `agent-runtimes.Custom endpoints as direct providers` |
| `jagentchill.provider.endpoint.test` | `agent-runtimes.Endpoint connection test` |
| `jagentchill.provider.endpoint.upsert` | `agent-runtimes.Custom endpoints as direct providers` |
| `jagentchill.provider.preset.list` | `agent-runtimes.Endpoint presets` |
| `jagentchill.provider.preset.upsert` | `agent-runtimes.Endpoint presets` |
| `jagentchill.provider.preset.remove` | `agent-runtimes.Endpoint presets` |
| `jagentchill.provider.override.get` | `agent-runtimes.Base-URL override on bundled providers` |
| `jagentchill.provider.override.set` | `agent-runtimes.Base-URL override on bundled providers` |
| `jagentchill.provider.override.remove` | `agent-runtimes.Base-URL override on bundled providers` |
| `jagentchill.provider.routing.get` | `agent-runtimes.Aggregator routing preferences` |
| `jagentchill.provider.routing.set` | `agent-runtimes.Aggregator routing preferences` |
| `jagentchill.provider.pin.set` | `agent-runtimes.Aggregator model catalogues` |

`jagentchill.provider.endpoint.upsert` carries the whole endpoint record, including the model list with each model's `enabled`, capability overrides, alias, pricing and `equivalents`, the endpoint's `enabled` switch, and its `media.<capability>` templates; `jagentchill.provider.override.get {providerId}` (scope `jagentchill.config.read`) returns the active override without secret values.

Delegated within `session` (7 methods; changes are announced by `jagentchill.session.updated` of `chat-agent.Session and chat RPC surface`):

| Method | Defined in |
|---|---|
| `jagentchill.session.unattended.set` | `agent-runtimes.Unattended modes and their warning` |
| `jagentchill.session.control.set` | `agent-runtimes.Session control application` |
| `jagentchill.session.queue.resolve` | `agent-runtimes.Steer support contract` |
| `jagentchill.session.runtime.switch` | `agent-runtimes.Switch runtime operation` |
| `jagentchill.session.handover.get` | `agent-runtimes.Durable history hand-over` |
| `jagentchill.session.import.create` | `agent-runtimes.Session import from a CLI's native history` |
| `jagentchill.session.import.list` | `agent-runtimes.Session import from a CLI's native history` |

A handler under one of these prefixes that the tables do not name MUST fail the contract test `rpc-ownership`. [NEW]

#### Scenario: Ownership test is exact
- **WHEN** the contract test `rpc-ownership` compares the server's handlers under `jagentchill.runtime.`, the six delegated `jagentchill.provider.` prefixes and the six delegated `jagentchill.session.` prefixes with these tables
- **THEN** the two sets are equal

#### Scenario: Login can be advanced
- **WHEN** the protocol package is read for the prefix `jagentchill.provider.auth.login.`
- **THEN** exactly `start`, `next`, `status`, `cancel` and `transfer` have schemas and handlers

#### Scenario: One contract per method name
- **WHEN** the protocol package is read for `jagentchill.runtime.models.list` and `jagentchill.runtime.models.search`
- **THEN** the first has the unified parameters `{cwd?, sessionKey?, agentId?, query?}` and the second the paged per-provider parameters, and no method has two schemas

#### Scenario: Deleted spelling
- **WHEN** a client calls `jagentchill.runtime.refresh`
- **THEN** the response error code is `NOT_FOUND` with `details.reason` `unknown_method`, because the method is `jagentchill.runtime.snapshot.refresh`

#### Scenario: Preset list filter
- **WHEN** a device holding `jagentchill.config.read` calls `jagentchill.provider.preset.list {kind: "stock-source"}`
- **THEN** only presets of kind `stock-source` are returned
