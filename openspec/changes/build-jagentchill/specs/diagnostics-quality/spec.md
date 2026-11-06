## ADDED Requirements

### Requirement: Structured logging
JAgentChill Server and every client SHALL log through one structured logger with levels `error`, `warn`, `info` and `debug`, each entry carrying `time_ms`, `level`, `scope` (dotted module name), `msg` and optional fields. The server SHALL write JSON lines to `<dataDir>/logs/server.log`, rotating at 10 485 760 bytes and keeping 5 files, and SHALL write the output of the supervised Gateway child, unparsed, to `<dataDir>/logs/gateway.log` with the same rotation; the desktop app SHALL write its main-process and renderer logs to the app's log directory with the same rotation; mobile and web clients SHALL keep a ring buffer of the last 5 000 entries persisted to local storage. Default level SHALL be `info` in release builds and `debug` in development builds; a user can set `debug` at runtime (client: About ▸ Diagnostics; host: Host ▸ Diagnostics, key `logging.level`, scope `jagentchill.config.write`) for the next 60 minutes, after which it returns to `info`. All entries SHALL pass through `security-privacy.Log and diagnostics redaction`. Logs never leave the device or host except inside a user-exported diagnostics bundle. [JAD] [NEW]

#### Scenario: Rotation
- **WHEN** `server.log` reaches 10 485 760 bytes
- **THEN** it is rotated, and at most 5 rotated files exist

#### Scenario: Temporary verbose level
- **WHEN** the user sets the level to `debug` at 10:00
- **THEN** `debug` entries are recorded until 11:00 and the level is `info` again afterwards

#### Scenario: Entry shape
- **WHEN** any log line of `server.log` is parsed as JSON
- **THEN** it has `time_ms`, `level`, `scope` and `msg`

### Requirement: Diagnostics bundle
About ▸ Diagnostics ▸ "Export diagnostics" SHALL produce a `.zip` containing: client logs; version and compatibility information; device platform, OS version, GPU adapter name, WebGPU/WebGL2 and WebCodecs capability results; connection history of the last 24 hours (states, error codes and close codes — kept by the redaction rule —, connection path, addresses with the host part kept and no credentials); recent job records without inputs; performance samples; local crash records; local feedback entries; the results of the diagnostics registry; settings without secrets; and, when a host is connected and the device holds `jagentchill.config.write` (role `admin`), the server's logs, the supervised Gateway's log (redacted line by line, with the Gateway token, and the tool endpoint secret removed), the Gateway supervision state, health report, spike results, run-profile check and `doctor` output fetched through the signed route `GET /jagentchill/v1/diagnostics/bundle`; a `viewer` or `editor` device gets the host's public health answer and version only, because host logs can name other owners' sessions and workspaces. It SHALL contain no media, no project or script content, no prompt text beyond the redaction rule, no terminal bytes, no usage rows (counts only), no keys, tokens or secrets. Before saving, a review screen SHALL list the files with sizes and let the user untick any file. The bundle SHALL be saved or shared only through the platform's save or share sheet and SHALL never be uploaded by the app. Building it SHALL take 15 seconds or less for 50 MB of logs on the reference desktop. [JAD] [NEW]

#### Scenario: Export and review
- **WHEN** the user chooses "Export diagnostics"
- **THEN** the review screen lists each file with its size, and the saved zip contains exactly the ticked files

#### Scenario: No secrets or media
- **WHEN** the produced bundle is scanned
- **THEN** it contains no media file, no project JSON, no device token, no private key and no provider key

#### Scenario: Gateway part unavailable
- **WHEN** the host is unreachable during export
- **THEN** the bundle is produced with client data only and a `README.txt` line "Host diagnostics not included: unreachable"

#### Scenario: Viewer exports diagnostics
- **WHEN** a `viewer` device exports diagnostics with a host connected
- **THEN** the bundle holds client data plus the host's health answer and versions, the bundle route was not called, and `README.txt` says "Host logs not included: admin devices only"

#### Scenario: Admin exports diagnostics
- **WHEN** an `admin` device exports diagnostics with a host connected
- **THEN** the host part is included and contains no secret value, no session transcript and no audit record

### Requirement: Diagnostics registry
There SHALL be one registry of health checks ("diagnostics") shared by all capabilities. An entry is `{ id, scope: "project" | "device" | "host", severity: "caution" | "error", messageKey, check(context) → boolean }`, registered at start-up by the capability that owns it. Project-scope checks SHALL be re-evaluated on every committed command and on media status change, debounced 200 ms; device- and host-scope checks at start-up and on "Run checks". Consumers subscribe by id (for example `transcription.no_audio`, registered by capability `captions-subtitles`, disables its Generate action). Engine-emitted diagnostics — the `diagnostic` events of `render-engine.Engine diagnostics surface`, whose ids start with one of its thirteen prefixes `surface/`, `scene/`, `descriptor/`, `shader/`, `blend/`, `mask/`, `matte/`, `font/`, `media/`, `color/`, `engine/`, `export/` and `time/` (for example `shader/unsupported`, `blend/unknown`, `matte/unavailable`, `font/fallback`, `color/hdr-tonemapped`, `engine/flow-fallback`, `surface/navigation-blocked`) — SHALL be appended to the same registry with severity `caution`, their last occurrence time and occurrence count; the registry accepts an engine id only when it starts with one of those thirteen prefixes, and the failing codes of `render-engine.Engine error codes` are errors of the failed call, not registry entries. Host ▸ Diagnostics and About ▸ Diagnostics SHALL list each registered diagnostic with id, scope, severity, localised message and current result, and the editor SHALL show project-scope failures in its diagnostics popover. [PORT SH-012] [NEW]

#### Scenario: Project check updates after an edit
- **WHEN** the user deletes the only audio track of a project
- **THEN** within 300 ms the diagnostic `transcription.no_audio` is failing and the Generate captions action is disabled with its message

#### Scenario: Engine diagnostic recorded
- **WHEN** the engine reports `font/fallback` during preview
- **THEN** the registry lists it with severity `caution` and the time of its last occurrence

#### Scenario: Unknown engine id
- **WHEN** the engine surface reports a diagnostic id that `render-engine.Engine error codes` does not list
- **THEN** development and test builds fail the protocol validation, and release builds record it once as `engine/unknown-diagnostic` without showing it to the user

#### Scenario: Duplicate id
- **WHEN** two capabilities register the same diagnostic id
- **THEN** start-up fails in development builds with `duplicate diagnostic id` and the unit gate catches it

### Requirement: Connection diagnostics screen
Personal settings ▸ Connections SHALL show, for each paired host: connection state (the labels of `device-pairing-signing.Connection liveness and backoff`), address in use, connection path (the labels of `device-pairing-signing.Connection path indicator`), the state of the client's tailnet node where one exists, and channel P transport (`ws` or `sse`), round-trip time of the last ping in milliseconds, effective protocol version, time connected, reconnect count in the last 24 hours, agent relay state ("Ready", or "Unavailable" with the health reason `core_call_unavailable`), and the last error code with its message. A "Run connection test" action SHALL execute, in order and with a pass or fail result and duration each: address selection by kind (the staggered race of `device-pairing-signing.Address kinds and selection order`, starting the tailnet node or proxy when needed, failing with `tailnet_login_required` when it is not signed in); TCP and TLS connect with the certificate pin check where one applies; `GET /jagentchill/v1/health`; channel P open and `challenge` received; Gateway signature verified; device proof accepted (`ready` received); a signed HTTP request (`HEAD /jagentchill/v1/blobs/<SHA-256 of the empty string>`, which passes on HTTP 200 or 404 and fails on 401 or 403); an agent relay round trip (`jagentchill.session.list` with `limit` 1, which exercises an in-process core call); and clock difference (pass at 120 000 ms or less). A failed step SHALL show the localised explanation for its error code and one suggested action. [NEW]

#### Scenario: All steps pass
- **WHEN** the test runs against a healthy host
- **THEN** every step shows a pass mark with a duration and the total completes in 10 seconds or less

#### Scenario: Clock difference
- **WHEN** the device clock is 4 minutes ahead
- **THEN** the clock step fails with "This device's clock differs from the host by 4 minutes" and the action "Open date and time settings"

#### Scenario: Host unreachable
- **WHEN** no address answers
- **THEN** the connect step fails, subsequent steps are marked "Skipped", and the suggestion mentions joining the same tailnet

#### Scenario: Agent relay unavailable
- **WHEN** every earlier step passes and the server's gateway link is not established (the supervised Gateway is starting, restarting or in a crash loop)
- **THEN** the relay step fails with `UNAVAILABLE` and the explanation "Agents are unavailable on this host", with the action "Open host diagnostics" for an admin

#### Scenario: Same steps on every client
- **WHEN** the test runs on web, on the desktop app (macOS, Windows, Linux) and on the mobile app (iOS, Android)
- **THEN** the same steps appear in the same order, except that the certificate-pin step reads "Browser-trusted certificate" on web

### Requirement: Host doctor report
`jagentchill.diagnostics.report` (scope `jagentchill.config.read`) and `jagentchill doctor` SHALL return the same list of checks, each `{ id, status (ok | warn | fail), message, remediation? }`, covering: database integrity (`PRAGMA quick_check`), schema version and pending migrations, blob store writable, storage thresholds (the same values as `server-api.Host storage accounting and cleanup`: `warn` at 90 % of quota or below `storage.lowSpaceWarnBytes` free, `fail` below 1 GiB free), FFmpeg presence, version and encoder set, render host probe, run profile (each item of `platform-skeleton.Gateway run profile` and the launch environment variables), core bind (loopback only), product listener states and their certificate expiry, web origin exclusivity, enabled public routes, secrets directory permissions, secret values found in configuration files, queue and service state, stalled jobs (running with a heartbeat older than 90 seconds), pending OpenClaw pairing requests (none is created by the product), in-process core call availability per context, the codec table and the OpenH264 state, orphaned and unmanaged sessions, devices whose key is stored in a file, terminal enabled, sessions in unattended mode, the who-can-call-whom preset when it is `all`, the tailnet ingress bridge state, the configured content host, recorded results of the gating spikes, and clock sanity (system time after the build date). Host ▸ Diagnostics SHALL render the list with a "Run again" action. [NEW]

#### Scenario: Low disk space
- **WHEN** the state volume has 4 GiB free with the default 5 GiB threshold
- **THEN** the report contains `{ id: "storage-space", status: "warn" }` with a remediation naming the storage settings

#### Scenario: Stalled job
- **WHEN** a job has been `running` with a heartbeat 2 minutes old
- **THEN** the report contains a `warn` for `stalled-jobs` listing the job id

#### Scenario: Same result on both surfaces
- **WHEN** the RPC and the CLI are run within the same minute on an unchanged host
- **THEN** both return the same check ids and statuses

#### Scenario: Render host missing
- **WHEN** no render host executable can be resolved
- **THEN** the report contains `{ id: "render-host", status: "warn" }` with the remediation "Install the desktop app or the headless image to enable export on this host"

### Requirement: Local crash and error capture
An uncaught error in any client SHALL be caught by a top-level boundary that writes a crash record `{ id, time_ms, appVersion, platform, route, message, stack, lastActions[20] }` to local storage (keeping the 50 most recent), where `lastActions` holds action ids only and never user text, and shows a recovery screen with "Reload", "Copy details" and "Export diagnostics". A native crash that the JavaScript boundary cannot see SHALL be detected on the next launch from a marker written at start and cleared at clean exit, and recorded as a crash record with `message: "native crash"`. An error inside the editor SHALL trigger an immediate save of unsaved operations before the recovery screen is shown, and on reload the project SHALL reopen at its last saved state. A render-engine failure (GPU device lost, wasm trap, decoder error) SHALL NOT take down the app; recovery behaviour is owned by `render-engine.GPU device-lost recovery` and `render-engine.Wasm panic capture and recovery`. Crash records SHALL never be transmitted automatically. [NEW]

#### Scenario: Uncaught error in the editor
- **WHEN** a component throws while a project with unsaved operations is open
- **THEN** the operations are saved, the recovery screen appears, and "Reload" reopens the project with no lost edit

#### Scenario: Native crash marker
- **WHEN** the mobile app is killed by a native fault and relaunched
- **THEN** a crash record with `message` `native crash` exists and no network request was made because of it

#### Scenario: Action ids only
- **WHEN** a crash record is written after the user typed text into a title
- **THEN** `lastActions` contains the action id `preview.edit-text` and none of the typed characters

### Requirement: Local feedback capture
This requirement is the single owner of the feedback form; other capabilities only link to it. The app SHALL provide "Send feedback" in the sidebar Help menu, the desktop Help menu, the editor header menu and the About page, opening a popover (bottom sheet on mobile) with a text area of 1 to 5 000 characters with placeholder "Thoughts, bugs, ideas…", the actions "Save", "Save as file…" and "Copy", an unticked option "Attach diagnostics bundle" that applies to "Save as file…", and "Cancel". The draft SHALL persist across closing the popover and app restarts until saved or cleared. "Save" SHALL store the entry `{ id, message, created_ms, appVersion, route }` locally, show the toast "Feedback saved", clear the form and close the popover. Because the product has no vendor server, feedback SHALL be stored locally only and SHALL never be transmitted by the app to any host, including the paired Gateway (no RPC, route or event carries it); the popover SHALL state "Feedback is saved on your device and included when you export diagnostics". A history view SHALL list the last 20 entries with relative timestamps and allow deleting an entry and "Clear history". The per-turn rating of agent answers is a different feature, owned by `chat-agent.Turn rating`. [PORT W-001] [NEW]

#### Scenario: Save feedback
- **WHEN** the user types 40 characters and chooses "Save"
- **THEN** the toast appears, the popover closes, and the entry is first in the history view

#### Scenario: Empty or too long
- **WHEN** the text is empty or exceeds 5 000 characters
- **THEN** "Save", "Save as file…" and "Copy" are disabled, and beyond 5 000 the counter shows the excess in the error colour

#### Scenario: Draft kept
- **WHEN** the user types text, closes the popover and restarts the app
- **THEN** reopening the popover shows the same text

#### Scenario: No network use
- **WHEN** feedback is saved on a device connected to a host
- **THEN** no network request is made as a result

#### Scenario: Save as file with diagnostics
- **WHEN** the user ticks "Attach diagnostics bundle" and chooses "Save as file…"
- **THEN** the platform save sheet offers one `.zip` containing `feedback.txt` and the diagnostics bundle files

### Requirement: Performance instrumentation
Clients SHALL measure and keep locally a ring buffer of the last 60 minutes, sampled once per second while the editor is open and always on: preview frames per second and dropped frames, frame composite time, decode queue depth, scrub-to-frame latency, timeline interaction frame time, JS heap and wasm memory, GPU texture memory estimate, export speed as a multiple of real time, and RPC round-trip time. A developer overlay toggled from About ▸ Diagnostics ▸ "Performance overlay" and by the action `view.performanceOverlay` of capability `keyboard-shortcuts` (the only place its default binding is stated) SHALL display the current values over the preview; per-frame spans are recorded only while the overlay is on. The overlay and the buffer SHALL add no more than 2 % to mean frame time on the reference desktop. [NEW]

#### Scenario: Overlay shows live values
- **WHEN** the overlay is on during playback
- **THEN** frames per second, dropped frames, composite time and memory update at least once per second

#### Scenario: Overhead bound
- **WHEN** the reference playback benchmark runs with and without the overlay on the reference desktop
- **THEN** mean frame time differs by 2 % or less

### Requirement: Reference devices
There SHALL be exactly one set of reference devices for the product, owned by this requirement and recorded with model, OS version and build in `docs/PERF-BASELINE.md`; every other capability says "reference desktop", "reference phone" or "reference host" and cites this requirement instead of naming hardware. **Reference desktop**: Apple M1 with 8 GB memory (macOS) or Intel Core i5-1135G7 with 16 GB memory (Windows and Linux). **Reference iPhone**: iPhone 12 on iOS 26. **Reference Android phone**: a phone with Snapdragon 778G and 6 GB memory on Android 12 or newer, with the Android System WebView version pinned in `docs/TOOLCHAIN.md`. **Reference host** (for Gateway-side numbers): the reference desktop running JAgentChill Server and the Gateway it supervises. **CI runner class**: the hosted runner type named in each `jagentchill-*.yml` job, recorded in the same file; a timing stated "on the CI runner class" refers to it. The two reference phones are also the devices of spike S6. [NEW]

#### Scenario: Baseline file names the devices
- **WHEN** `docs/PERF-BASELINE.md` is parsed by the performance job
- **THEN** it names one desktop, one iPhone and one Android phone with model and OS version, each matching the classes above

#### Scenario: Hardware named elsewhere
- **WHEN** a spec file other than this capability's names a phone or computer model as a performance reference
- **THEN** `pnpm jagentchill:check:coverage` fails with `reference device named outside diagnostics-quality`

### Requirement: Performance budgets
This requirement owns the product-level budgets; engine budgets (dropped frames at most 2 % on desktop and 5 % on mobile, scrub first frame at the 95th percentile within 100 ms on desktop and 150 ms on mobile, engine memory at most 2 048 MiB on desktop, 1 536 MiB on web and 600 MiB on mobile, and the mobile pool sizes) are owned by `render-engine.Performance budgets` and `render-engine.Memory ceilings per platform` and are measured by the same benchmark suite; no other capability states performance numbers of its own for these metrics. On the devices of `diagnostics-quality.Reference devices` the product SHALL meet: cold start to interactive Home in 3.0 s on desktop and 4.0 s on mobile; opening a 300-element project to an interactive timeline in 2.0 s; timeline drag and zoom at 16.7 ms or less per frame at the 95th percentile on desktop; undo or redo applied in 50 ms; scrolling of any virtualised list or grid (project list, media grid, a storyboard of 200 panels, a session timeline of 2 000 items) at 16.7 ms or less per frame at the 95th percentile on desktop and on mobile, with the 99th percentile at 33.3 ms or less on mobile; whole-app memory at most 3 GiB on desktop and 1.2 GiB on mobile while editing the reference 1080p30 three-layer project. The mobile editor budgets, measured on both reference phones with the fixture project "mobile-reference" of `diagnostics-quality.Test fixtures`, are identified by these metric ids, which `mobile-editor` emits and cites without restating numbers: `mobile.editor-open-to-first-frame` 2.5 s; `mobile.tool-tap-to-sheet-shown` 200 ms; `mobile.timeline-scroll-frame-time` 16.7 ms at the 95th percentile and 33 ms at the 99th; `mobile.trim-handle-response` 50 ms; `mobile.scrub-to-frame` 150 ms; `mobile.app-memory-editing` 1.2 GiB. Host-side durations stated by other capabilities "on the reference host" (for example assembling a film episode into a timeline within 30 s) are measured on the reference host of `diagnostics-quality.Reference devices` by the same suite. An automated benchmark SHALL measure product and engine budgets on the desktop reference runner in the job `jagentchill-performance` (default branch and nightly), and a nightly job `jagentchill-performance-mobile` SHALL measure them on the two reference phones. The gate has one rule: it fails when a budget is exceeded, or when a metric is more than 10 % worse than the stored baseline. [NEW]

#### Scenario: Budget met
- **WHEN** the benchmark suite runs on the desktop reference runner
- **THEN** every metric is within its budget and within 10 % of baseline, and the gate passes

#### Scenario: Regression inside the budget
- **WHEN** a change makes project open time 15 % worse than baseline while still under 2.0 s
- **THEN** the performance gate fails and reports the metric, baseline and measured value

#### Scenario: Budget exceeded on a phone
- **WHEN** the nightly mobile job measures `mobile.app-memory-editing` at 1.3 GiB on either reference phone (the reference iPhone or the reference Android phone)
- **THEN** the job fails and opens an issue naming the metric and device

#### Scenario: Mobile metric ids are complete
- **WHEN** the nightly mobile job finishes on the two reference phones
- **THEN** its report contains a value for each of the six `mobile.*` metric ids on each phone

#### Scenario: Baseline update
- **WHEN** a contributor intentionally changes a baseline
- **THEN** the change to the baseline file requires the same pull request to include the benchmark output as evidence

### Requirement: Gating spikes
The spikes S6 to S28 (S1 to S5 are withdrawn and their ids are never reused) SHALL be executed against the pinned OpenClaw tag, with JAgentChill Server supervising the pristine Gateway, — and, for S6, S19 and the client part of S20, on the reference devices — before the work they gate, each with a binary result per stated criterion, recorded as a decision record `docs/decisions/NNNN-spike-S<n>-<slug>.md` containing `result: pass | fail` (per part where the row has parts, per runtime or per target where the row says so), `status`, the commands or steps run, the captured evidence and the consequence taken. The job `jagentchill-policy` SHALL fail when a pull request completes a task of a gated area while the spike's record is absent. A failed spike applies the fallback of its row, and no fallback edits a file of `gateway/openclaw/`. Surfaces already proven by execution — supervising the Gateway as a child and ending it as a process group, the gateway link with its four scopes and its three approval capabilities, MCP discovery of the agent tool endpoint, a configuration change at run time, a real agent turn that calls a server tool, the effect of `permissionMode` `read-only` and `guarded` on a host command, and a host-command approval answered by a paired `admin` device, all on macOS with the `claude-cli` runtime (`docs/decisions/0002-own-server-gateway-sidecar.md` rows 1 to 16) — are not spikes: they are asserted on every pull request by `diagnostics-quality.Gateway contract tests`. Two classes of row differ: where "Owner sign-off" is `no`, the specified fallback applies automatically and the record's `status` is `fallback-applied`; where it is `yes`, the property at stake is one the owner mandated, so a failed record is written with `status: awaiting-owner`, the policy job blocks the gated task group, and work continues only when the record carries `status: owner-approved` together with the chosen option — nothing is replaced automatically.

| Spike | Pass when | Gates | Fallback when failed (owner requirement) | Owner sign-off |
|---|---|---|---|---|
| S1 | withdrawn — no device connects to OpenClaw's native socket (decision A1) | — | — | — |
| S2 | withdrawn with the server architecture — JAgentChill is not a plugin of OpenClaw (design D1): there are no in-process core calls; the server calls the Gateway over its gateway link from any context (`server-api.Gateway calls over the link`) | — | — | — |
| S3 | withdrawn with the server architecture — JAgentChill is not a plugin of OpenClaw (design D1): the channel P WebSocket is served by the server's own listener | — | — | — |
| S4 | withdrawn with the server architecture — JAgentChill is not a plugin of OpenClaw (design D1): nothing of JAgentChill is bundled with or generated into OpenClaw, and no upstream file is patched (`platform-skeleton.Allowed upstream patch list`) | — | — | — |
| S5 | withdrawn — JAgentChill has its own workspace and is not loaded into or built inside OpenClaw's; the app toolchain builds are a CI job (`platform-skeleton.Workspace feasibility spike and fallback`) | — | — | — |
| S6 | the thirteen-row WebView matrix of design D4 (`mobile-editor.WebView capability spike matrix`) on both reference phones inside `JagentchillEngineView`; the same run measures the peak memory of each on-device transcription model | all render tasks on mobile; minimum OS; which transcription models a phone offers | per row: `render-engine.Capability constraints from the WebView spike` (WebGL2, proxy editing, export on the paired host) and `updates-distribution.Minimum operating system versions`; a blocking row raises that platform's minimum | no |
| S7 | `sessions.create` and `sessions.patch` with `agentRuntime`, sent over the gateway link, are accepted for the built-in runtime, each CLI runtime and one ACP target, and the created session runs a turn | runtime selection | the runtime is not selectable; `agent-runtimes.Admin proxy and Gateway reuse` | no |
| S8 | the same prompt on each runtime yields comparable `agent`, tool, message, usage and approval events; each runtime can be launched with its native tools disabled; a native tool call is seen by the server on the gateway link, as an approval request or as an `agent` tool event (the `nativeToolCoverage` cell); per runtime and per `permissionMode` value (`read-only`, `guarded`, `workspace`, `full`) the effect on a host command and on a file write is the one `agent-runtimes.Runtime modes catalogue` states (measured so far on `claude-cli` only: no mode → runs unasked, `read-only` → refused, `guarded` → asks under the run-profile policy; decision 0002 rows 13 and 15); per runtime, instruction text the server sets for a turn — the persona text of the agent entry and the extra system prompt of the Gateway's `agent` RPC — reaches the model (a marker placed there is repeated by the model; `chat.inject` and `chat.send.workContext` do not reach it, decision 0002 row 12) | capability matrix content; creative sessions on CLI and ACP runtimes; the product modes each runtime offers; persona and role instructions on each runtime | `agent-runtimes.Capability matrix generated from contract tests` (cell `unsupported`; a runtime without `nativeToolCoverage` is admin-only for workspace sessions); a permission mode whose measured effect is weaker than the catalogue states is published `supported: false` for that runtime; on a runtime where instruction text does not reach the model the server sends it as the leading block of the turn's message with `chat.send`, which is proven to reach the model | no |
| S9 | `models.authLogin` and `wizard.*` can be driven over the gateway link for one OAuth and one device-code provider with the consent URL handed to a remote device | provider login from devices | `agent-runtimes.OAuth login through the admin proxy` (login on the host with the printed command) | no |
| S10 | how much history a new runtime receives after a mid-session runtime switch is measured | runtime switch | `agent-runtimes.Durable history hand-over` | no |
| S11 | mid-turn steer on the CLI runtimes and a permission-mode change during a CLI-backed run behave as documented | steer and mode controls | `agent-runtimes.Steer support contract` (follow-up instead of steer; mode change queued) | no |
| S12 | per method, a method that needs the Gateway's administrator scope (`agents.create`, `models.authSetApiKey`, `sessions.rewind` and the others in `CORE_METHODS`) is accepted from the server's gateway link, which holds `operator.admin` | every admin proxy; rewind and compact | `server-api.Narrow admin proxies` (`UNSUPPORTED_FEATURE` with the host command) | no |
| S13 | payload shapes of `usage.status`, `usage.cost` and `sessions.usage`, including sub-agent grouping, are captured | usage views | `usage-tracking.Capture from Gateway events with reconciliation` | no |
| S14 | a three-tier team built from configuration alone keeps its shape (`maxSpawnDepth`, `allowAgents`) | team runs | `multi-agent-orchestration.Team shape enforcement at the tool endpoint` | no |
| S15 | on macOS, Windows and Linux hosts and in the Linux container, the server's own PTY worker spawns the default shell, resizes it, delivers 100 MiB of output without stalling the server's event loop, kills the process tree, survives the disconnect of every device, and gives the shell an environment without the Gateway's and the server's secrets (there is no OpenClaw terminal backend to choose) | the product terminal and CLI interfaces in a terminal tab | `workspaces-terminal.Terminal backend and worker process` (on a host system where it fails the feature `terminal` is not advertised) | no |
| S16 | a Lobster step cannot start an agent turn (confirming it is no workflow backend) | none; closes a design question | capability `agent-workflows` (own engine in either outcome) | no |
| S17 | custom endpoint contract: (a) several keys, tool-call probe, upstream-provider attribution; (b) literal query parameters appended to a projected `baseUrl` survive | endpoint features | `agent-runtimes.Custom endpoint verification spike` (a failed part is not offered; secret query values are never projected in any outcome) | no |
| S18 | a workflow run started from a chat session reports back into that session while it is busy: with a turn running and one user follow-up queued, the server-started report is delivered exactly once, after the running turn, without aborting it, in arrival order | report-back of agent-started workflow and team runs into chat | `agent-workflows.Workflow started from a chat session` (durable per-session outbox; shown as a run-report item and prepended to the next turn) | no |
| S19 | the archify fork compiles and renders in Chromium, Safari and Firefox on the reference desktop (web build), in the desktop renderer on macOS, Windows and Linux, and in the engine WebView on both reference phones, and redrawing while one node of the 200-node, 400-edge fixture is dragged meets the eight criteria of `workflow-diagram.Performance budgets and load shedding` on each target | the workflow canvas renderer in `packages/archify` | no automatic replacement (decision A5). The record lists the failing targets and the owner chooses (a) fix the fork, (b) a product renderer on the failing platform class only, (c) a product renderer everywhere; a desktop browser that fails is listed as unsupported for canvas editing and keeps the read-only outline view; a renderer adopted under (b) or (c) needs its own passing record S19b before it ships (`workflow-diagram.Renderer spike S19 and fallback renderer`) | yes |
| S20 | (Gateway part, on macOS, Windows and Linux) the ingress helper forwards only `/jagentchill/` paths including the WebSocket upgrade, and only to the server's loopback port, answers 404 itself for every other path including `/agent-tools/mcp`, has no route to the Gateway port, strips and sets the peer headers with the per-start secret, and the server classifies a forwarded request as remote (no local treatment, rate limits keyed by the peer), for the tailnet listener (peer from the node's `WhoIs`) and the LAN TLS listener; (client part) the embedded tsnet node runs inside the iOS and the Android app, joins a tailnet and carries a channel P connection for 30 minutes in the foreground within the mobile memory budget | every non-loopback path into a host; remote access from phones without the Tailscale app | Gateway part: no automatic fallback — a raw forwarder is not acceptable; the failing listener is not offered until the owner decides (`server-api.Product listeners and path restriction`). Client part: the specified option is the operating system's Tailscale client on BOTH mobile platforms (`device-pairing-signing.Embedded tailnet node on mobile`), applied only with sign-off because the embedded node is an owner requirement | yes |
| S21 | per runtime, the server relays a session over the gateway link with full fidelity: text deltas, tool start/update/end, usage, session lifecycle, runtime-raised approvals and questions received on a link that declares the capabilities `approvals`, `exec-approvals` and `plugin-approvals` and answered over it with `approval.resolve { id, kind, decision }` (`allow-once` runs the call, `deny` blocks it) and `question.resolve`, with no device-held scope — passed on `claude-cli`, whose native tool approvals arrive as `plugin.approval.requested` (decision 0002 rows 15 and 16); open on every other runtime, including which runtime uses the `exec.approval.*` kind —; `runId` attribution with denial of a native tool call at its approval request and abort of the run on a forbidden tool event; whether, and in which permission modes, the runtime raises an approval request for a `jc_*` tool of the server's own MCP endpoint; the Gateway's pending-approval list after a link reconnect; whether the Gateway lists its connected operator clients to the link; and, for a session in each non-unattended mode, that a native read or write of a file under `<dataDir>/secrets/` or `<dataDir>/gateway-state/` is refused or raises an approval request the server can deny | the agent relay; server-resolved approvals; host-execution gating; protected paths against native tools | a runtime that fails a required item is not offered (`runtime/relay-unsupported`); degraded items are published in the capability matrix (`server-api.Agent session relay`); a runtime whose native file tools reach a protected path without a request is offered for workspace-class sessions only to `admin` owners (`security-privacy.Workspace agent safeguards`) | no |
| S22 | an installed CLI is routed through a proxy as an ACP custom agent launched by the product launch wrapper, which sets the proxy environment; a turn's requests arrive at a local stub proxy (per CLI) | proxy profiles for CLI runtimes (decision A7) | proxy profiles are not offered for that CLI and the capability matrix says so; the bundled `claude-cli` and `google-gemini-cli` backends are offered without proxy support in every outcome (`agent-runtimes.Proxy profiles for CLI runtimes`) | no |
| S23 | session binding on every runtime: with two sessions of the runtime calling the same `jc_*` tool at the same time for two rounds, every call is served for its own session and no other — each session holds its own MCP connection across turns, and the Gateway `agent` event of each call (`stream: "item"`, `kind: "tool"`, `phase: "start"`, carrying `sessionKey`, `toolCallId` and `name`) is on the gateway link within 3 000 ms of the MCP request; nothing the model says takes part (context injected with `chat.inject` or `chat.send.workContext` does not reach the model, decision 0002); a session whose MCP session the server closed (idle limit, session bound, link loss) opens a new one and its next call is bound to it again; and two sessions whose first calls of one tool coincide both receive `SESSION_UNBOUND` with `ambiguous` and bind on their retries. Passed on `claude-cli` for the two-session rounds, with the re-initialisation and the `ambiguous` case not yet observed there; open on the embedded runtime, Codex, Gemini and ACP targets | every `jc_*` agent tool on that runtime | the runtime is not offered for `jc_*` tools (`server-api.Agent tool endpoint and session binding`) | no |
| S24 | ACP session path: `/acp spawn <target>` issued over the gateway link returns a session key the server can bind; `/acp permissions` and `/acp set-mode` apply per session on ACP session keys and on native `acp-*` runtimes | ACP target runtimes, their modes | session-path targets `unavailable`; ACP modes limited to the global `approve-reads` profile; unattended mode absent on ACP (capability `agent-runtimes`) | no |
| S25 | the server observes on the gateway link a session change (`sessions.patch` made over the link, or by the host's own `openclaw` command) within 1 000 ms | runtime policy enforcement on sessions changed outside the relay | the policy check runs at the start of every turn, at the tool endpoint and at every approval request (`agent-runtimes.Runtime policy enforcement on the host`) | no |
| S26 | a session model override suppresses the agent's configured fallback chain ("strict" model) | the "Allow fallback" toggle | "Allow fallback" is always on for agent turns and the toggle is hidden (capability `agent-runtimes`) | no |
| S27 | environment and command of a custom profile reach the child process for acpx custom agents and for the `codex` and `copilot` harnesses | custom runtime profiles (Environment and Command fields) | those fields are disabled for the failing runtime kind (capability `agent-runtimes`) | no |
| S28 | per media capability (image, video, speech, transcription, music), a generation offered by one of OpenClaw's own bundled provider plugins is started and its result fetched by the server over the gateway link (`tools.invoke`, `tts.convert`, `tts.speak`) without an agent turn | builtin media providers reached through the Gateway (capability `generation-providers`) | the failing capability is served only by the server's own providers and endpoint presets; transcription starts there | no |

[NEW]

#### Scenario: Every spike has a record before gated work
- **WHEN** the policy job runs on a pull request that completes a pairing or agent-relay task
- **THEN** it passes only if decision records with a `result` exist for S20, S21 and S23

#### Scenario: Failed spike with an automatic fallback
- **WHEN** the S23 record says `fail` for one CLI runtime, whose sessions share one MCP connection
- **THEN** the server is built with that runtime not offered for `jc_*` tools, the runtime contract suite passes for the others, the record's status is `fallback-applied`, and no file of `gateway/openclaw/` is modified

#### Scenario: Failed spike that needs the owner
- **WHEN** the S19 record says `fail` for Safari, or the client part of S20 fails on Android
- **THEN** the record is `awaiting-owner`, `jagentchill-policy` fails every pull request that completes a task of the gated group with `spike S<n> awaits owner decision`, and no renderer or tailnet path is swapped until the record is `owner-approved`

#### Scenario: Record without evidence
- **WHEN** a spike record has a `result` and an empty evidence section
- **THEN** the policy job fails with `spike record has no evidence: S<n>`

#### Scenario: Withdrawn spikes have no record requirement
- **WHEN** the policy job looks for spike records
- **THEN** it requires none for S1 to S5, and fails a specification or task that names one of them other than as withdrawn

#### Scenario: Results visible on a host
- **WHEN** an admin opens Host ▸ Diagnostics
- **THEN** the doctor list shows the compiled result of each host-side spike (S12 per method, S15, the Gateway part of S20, and S21 and S23 per runtime) and no entry for S1 to S5

#### Scenario: Runtime fails the relay spike
- **WHEN** the S21 record says a CLI runtime's approvals cannot be answered over the gateway link
- **THEN** that runtime is not offered, its matrix row says `relay: unsupported`, and the other runtimes are unaffected

#### Scenario: Canvas work before S19
- **WHEN** a pull request completes a workflow canvas task while no S19 decision record exists
- **THEN** the policy job fails with `gating spike S19 has no recorded result`

### Requirement: Test taxonomy
Tests SHALL be organised into these layers with fixed locations and commands: (1) unit — `*.test.ts` beside source in every package, run by `pnpm jagentchill:test:unit`; (2) wasm — Rust `cargo test` for `packages/render-wasm`; (3) golden-frame — `packages/render/golden/`, run by `pnpm jagentchill:test:golden`; (4) protocol and pairing — `server/test/protocol/`, run against a real server by `pnpm jagentchill:test:pairing`; (5) gateway contract — `server/test/contract/`, run against the built Gateway of the pinned tag by `pnpm jagentchill:test:gateway-contract`; (6) runtime contract — `server/test/runtime-contract/`, run by `pnpm jagentchill:test:runtimes`; (7) end-to-end web and desktop — Playwright in `apps/app/e2e/` and `apps/desktop/e2e/`; (8) end-to-end mobile — Maestro flows in `apps/app/maestro/`; (9) benchmarks — `packages/render/bench/` and `apps/app/bench/`. Tests that call real external providers or need a logged-in vendor CLI SHALL be named `*.real.e2e.test.ts`, SHALL be excluded from pull-request CI, and SHALL run only in a manually triggered or nightly workflow with operator-supplied credentials. [JAD] [NEW]

#### Scenario: Layer commands exist
- **WHEN** each of the listed commands is run on a built tree
- **THEN** each executes only tests of its layer and exits 0 on a passing tree

#### Scenario: Real-provider test in pull-request CI
- **WHEN** pull-request CI collects tests
- **THEN** no file matching `*.real.e2e.test.ts` is executed

### Requirement: Unit tests with typed fake ports
Unit tests SHALL exercise code through its ports (`StoragePort`, `MediaPort`, `EngineSurface`, clock, random source, network egress, channel P client, core-call module) using hand-written typed fakes that implement the port's TypeScript interface and live in `packages/*/src/testing/`. Module-level mocking (`vi.mock`, `jest.mock`, `vi.doMock`) SHALL NOT be used in JAgentChill packages, enforced by a lint rule. Tests SHALL be deterministic: time and randomness come from injected fakes, assertions SHALL NOT be conditional, and matchers `toBeTruthy`, `toBeFalsy` and `toBeDefined` SHALL be rejected by lint in favour of exact assertions. Line coverage SHALL be at least 85 % for `jagentchill-editor-core` and `jagentchill-protocol`, and at least 70 % for every other JAgentChill package, measured per package. [JAD] [NEW]

#### Scenario: Module mock used
- **WHEN** a test file contains `vi.mock("../storage")`
- **THEN** `pnpm jagentchill:lint` fails with rule `no-module-mock`

#### Scenario: Fake drifts from the port
- **WHEN** a method is added to `StoragePort` and the fake does not implement it
- **THEN** typecheck fails at the fake

#### Scenario: Coverage below threshold
- **WHEN** `jagentchill-editor-core` line coverage is 84.2 %
- **THEN** the unit gate fails and prints the package, the measured value and the threshold

### Requirement: Golden-frame tests with tolerance
This requirement owns the golden test protocol; the thresholds are the single tolerance of design D6, owned by `render-engine.Golden-frame determinism`, and no other value is used anywhere. Each case is a project fixture plus a list of times in ticks, rendered at 640×360 into 8-bit sRGB RGBA and compared with a stored PNG. Two named tolerances exist. **Golden tolerance**: a frame passes when at least 99.5 % of pixels have every channel within 2/255 of the golden, no pixel differs by more than 16/255 in any channel, and the structural similarity index is 0.99 or higher; goldens are authoritative only on the CI runtime (Linux, software rasterisation). **Preview-versus-export tolerance** (same device, before encoding): maximum per-channel difference 1. Frames containing text compared across operating systems or between a device and the render host use the parity threshold SSIM ≥ 0.98. Cases SHALL run on both back ends (WebGPU and WebGL2) using software rasterisation in CI so that results do not depend on runner GPUs, each compared with the same golden, and SHALL also run inside the render host executable. The suite SHALL contain at least 150 cases, with at least one case for every blend mode, every mask type and combine mode, every bundled effect and filter id, three cases (start, middle, end of the transition) for every bundled transition id, every colour-adjustment control, chroma key, crop and flip, text styling features with the bundled fonts, keyframed transform, speed curve and reverse, each layer stage of the engine's stage order, and each classic defect named in `diagnostics-quality.Classic defect regression tests` that affects rendering. On failure the job SHALL upload the actual frame, the golden and a difference heat map. Goldens SHALL be changed only with `pnpm jagentchill:test:golden --update`, and a pull request that changes a golden SHALL fail `jagentchill-policy` unless its description contains a line `Golden-Update: <reason>`. A golden of a catalogue effect, filter or transition becomes normative only after a visual review against the catalogue text is recorded in `docs/GOLDEN-REVIEW.md` (id, reviewer, commit); the completeness check fails for a catalogue id with no golden case or no review row. [NEW]

#### Scenario: Within tolerance
- **WHEN** a rendered frame differs from its golden by a channel delta of 1 on 3 % of pixels and by more than 2 on 0.3 % of pixels, none above 16, with SSIM 0.995
- **THEN** the case passes

#### Scenario: Too many differing pixels
- **WHEN** 0.6 % of pixels differ by more than 2
- **THEN** the case fails and the three artifacts (actual, golden, heat map) are attached to the CI run

#### Scenario: One far-off pixel
- **WHEN** a single pixel differs by 17 in one channel
- **THEN** the case fails

#### Scenario: Back-end parity
- **WHEN** the same case runs on WebGPU and on WebGL2
- **THEN** both pass against the same golden

#### Scenario: Preview equals export
- **WHEN** a reference frame is rendered by the preview path and by the export path on one device before encoding
- **THEN** no channel of any pixel differs by more than 1

#### Scenario: Golden changed without justification
- **WHEN** a pull request modifies a PNG under `golden/` and its description lacks a `Golden-Update:` line
- **THEN** the job `jagentchill-policy` fails

#### Scenario: New effect without a golden
- **WHEN** an effect is added to the bundled library with no golden case referencing its id
- **THEN** the golden suite's completeness check fails and names the effect

### Requirement: Frame-accuracy and audio tests
In addition to golden frames, automated tests SHALL assert: every exported frame index maps to the same source frame as the preview at that tick for the reference projects at 23.976, 25, 29.97, 30, 50, 59.94 and 60 fps (zero mismatches), including a project using 60 fps sources through their proxies; exported duration equals the project duration within one frame; tick arithmetic in TypeScript and in the Rust crate agrees on the shared vector file including frame rates with denominators up to 1 000 000 over 24 hours; and the mixed audio of reference projects matches a stored reference with a peak sample error of −60 dBFS or lower and audio/video offset of 10 ms or less across a 10-minute export. [NEW]

#### Scenario: Fractional frame rate
- **WHEN** the 29.97 fps reference project is exported and frame 1000 is decoded
- **THEN** it equals the preview frame at the tick of frame 1000

#### Scenario: Long export drift
- **WHEN** a 10-minute project with a click track is exported
- **THEN** the measured audio/video offset at the end is 10 ms or less

#### Scenario: Tick parity on a long non-standard project
- **WHEN** the vector for frame 2 000 000 at 30 000 000/1 000 000 fps is evaluated in TypeScript and in Rust
- **THEN** both return the same tick value

### Requirement: End-to-end tests
Playwright suites SHALL drive the real web build and the packaged desktop app against a real Gateway started with a scratch state directory, and Maestro flows SHALL drive the iOS simulator and Android emulator builds. A smoke subset SHALL cover: create a project, import media, split and trim, add text, play, export and verify the output file's duration and resolution; pair a second client with the six-digit code; pair a browser on the host computer at the default network level by link and by short code; sync a project to it and observe an edit live; hand an export to the Gateway's render host; run a chat agent turn on the built-in runtime over channel P that applies an edit and undo it; as an `editor`, be refused a host-execution approval that an `admin` then allows; run the one-prompt video workflow template to its first approval; write a script and submit it for review. Failure cases SHALL assert the text the user sees. End-to-end tests SHALL NOT mock the Gateway, storage or the render engine; the only stand-in permitted is a local OpenAI-compatible stub endpoint registered as a provider, and evidence produced with it is labelled as fixture data (`diagnostics-quality.Story and evidence tracking`). Every failed test SHALL retain a video and trace. The smoke subset SHALL finish in 15 minutes or less per platform on the CI runner class. [JAD] [NEW]

#### Scenario: Smoke subset on web
- **WHEN** `pnpm jagentchill:test:e2e --project web --grep @smoke` runs
- **THEN** all smoke cases pass within 15 minutes and the exported file has the expected duration within one frame

#### Scenario: Failing case leaves evidence
- **WHEN** an end-to-end case fails
- **THEN** a video and a trace for that case are uploaded as CI artifacts

#### Scenario: Mobile pairing flow
- **WHEN** the Maestro flow `pair-with-code` runs on the iOS simulator and on the Android emulator against the test Gateway
- **THEN** on both the app reaches "Paired" and the device appears in the host's device list

### Requirement: Gateway contract tests
A contract suite, `pnpm jagentchill:test:gateway-contract`, SHALL start JAgentChill Server with its real supervisor against the built, pristine Gateway of the pinned OpenClaw tag and assert two groups. **Gateway group** (what the server relies on in OpenClaw, `server-api.Gateway link`): the Gateway starts as a child with its own state directory, a loopback bind and the server-generated token, and is ready at `hello-ok`; an invalid configuration exits with code 78; a `shutdown` event precedes close code 1012; the link connects with `@openclaw/gateway-client` on protocol 4 and is granted `operator.read`, `operator.write`, `operator.admin` and `operator.approvals` without a manual pairing step; the version of `@openclaw/gateway-client` equals `gateway/OPENCLAW_VERSION`; every method in `CORE_METHODS` exists and accepts the parameters the server sends (test `core-methods`), and every Gateway event the server consumes carries the fields it reads; `config.get` followed by `config.patch { raw, baseHash }` changes a running Gateway; one agent turn started by the server (`sessions.create`, `chat.send`) calls a server tool, and its `agent` tool events carry `sessionKey`, `toolCallId` and `name`; MCP discovery lists every tool of the catalogue by its base name; no OpenClaw plugin with an id starting `jagentchill` is loaded and the Gateway has no method starting `jagentchill.`; the Gateway tree equals the pinned tag; and one test per surface of `platform-skeleton.Gateway surface feasibility record` passes. **Server group** (the server's own contract): the server starts with default configuration and refuses an unknown configuration key; every tool of the agent tool endpoint matches `^jc_[a-z]+(_[a-z0-9]+)+$`, has no caller-identity parameter and is listed in the tool index of `agent-editing-tools.Tool naming and families`; every channel P method is in a domain of `RPC_DOMAINS`, is named by the owner requirement of `server-api.RPC domain ownership` (test `rpc-ownership`), and has request and response schemas, a declared scope from the 13 scopes and an `idempotent` flag; `jagentchill.hostcli.*` methods exist only on the local admin endpoint; every emitted event is in `EVENT_NAMES`; every emitted error code is in the registry; every audit action is in `AUDIT_ACTIONS`; every job kind is in the closed kind list; every configuration key is inside a group of the closed group list; the set of HTTP routes of the server's listener equals the route table plus the exception table of capability `server-api` plus `/agent-tools/mcp`, and only the exception routes answer an unsigned request with a status other than 401; `features` in `ready` equals `FEATURE_FLAGS`; no device record, frame or store row holds an OpenClaw scope or token, and no byte sent to a device holds the Gateway token, the link identity or the tool endpoint secret; the tests `origin-exclusive` (`server-api.Web origin isolation`) and `role-boundary` (`security-privacy.Trust model`) pass; no path outside `/jagentchill/` is reachable through a product listener, and neither the Gateway port nor `/agent-tools/mcp` is reachable on a non-loopback address; the effective tools of every creative agent are within the allow-list; no import resolves into `gateway/openclaw/` or to OpenClaw's plugin SDK; agent methods answer `GATEWAY_UNAVAILABLE` and the other domains keep working while the Gateway child is stopped; and the server, with its Gateway child, starts and stops cleanly 20 times in succession without leaked timers, handles, child processes, bound ports or open database connections. This suite SHALL run in pull-request CI and in the upgrade procedure of `platform-skeleton.Upstream merge procedure`. [NEW]

#### Scenario: Clean run on the pinned tag
- **WHEN** the contract suite runs on the pinned tag
- **THEN** all assertions of both groups pass

#### Scenario: Gateway method changed in a newer OpenClaw
- **WHEN** the pin is raised to a tag that removed or reshaped a method of `CORE_METHODS`
- **THEN** the suite fails in the Gateway group and names the method

#### Scenario: Client library differs from the pin
- **WHEN** `server/package.json` pins `@openclaw/gateway-client` to another version than `gateway/OPENCLAW_VERSION`
- **THEN** the suite fails and names both versions

#### Scenario: Handle or process leak
- **WHEN** a service leaves an interval running after stop, or a Gateway child survives the server
- **THEN** the start/stop cycle assertion fails and reports the leaked handle count or the surviving process

#### Scenario: Route drift
- **WHEN** server code adds a route missing from both tables
- **THEN** the suite fails and names the route

### Requirement: Runtime contract tests and capability matrix
A runtime contract suite SHALL run one scripted scenario set, unchanged, against every agent runtime the product supports (the built-in runtime, each CLI runtime and at least one ACP target, as listed by `agent-runtimes.Runtime model and the two access methods`) on a real Gateway: start a session; stream a text turn; call a `jc_*` tool; have two sessions call the same `jc_*` tool at once and see each call served for its own session, and a call the Gateway did not report refused with `SESSION_UNBOUND`; raise an approval and have the server answer it over the gateway link with the resolving device recorded; raise and answer a question; observe a native tool call on the gateway link, as an approval request or an `agent` tool event, with its `runId`; steer, follow up and interrupt a running turn; change model, thinking level and mode between turns; attach a file; report usage; resume after a Gateway restart; switch to another runtime and back; spawn a child agent. For each runtime and each capability the suite SHALL record `supported`, `degraded` (with the observed behaviour) or `unsupported`, and SHALL write the result as `docs/capability-matrix.json`, which is the source of the published matrix of `agent-runtimes.Capability matrix generated from contract tests`; no matrix cell is written by hand. The built-in runtime's rows SHALL run in pull-request CI against the stub endpoint; rows that need a vendor CLI login SHALL run in the nightly or manually triggered workflow with operator-supplied logins, and the matrix file records the date and CLI version of each row's last run. A release SHALL fail when a row's last run is older than 30 days or predates the pinned OpenClaw tag. [NEW]

#### Scenario: Matrix generated from results
- **WHEN** the runtime contract suite finishes for a runtime that cannot steer a running turn
- **THEN** the matrix file has `steer: "degraded"` for that runtime with the observed fallback, and the UI's capability matrix shows the same value

#### Scenario: Hand-edited matrix
- **WHEN** a pull request changes `capability-matrix.json` without a matching suite run artifact
- **THEN** the job `jagentchill-policy` fails with `capability matrix must be generated`

#### Scenario: Stale row at release
- **WHEN** a release is tagged while the `codex` row was last run 45 days ago
- **THEN** the release workflow fails and names the row

### Requirement: Classic defect regression tests
Each of the suspected defects and incomplete behaviours recorded in `docs/research/opencut-classic-inventory.md` (including the six probable bugs called out in the design, the storage migration adapter call and the dual playback clocks) SHALL have a named regression test written before the related code is ported, located beside the ported module and listed in `docs/CLASSIC-DEFECTS.md` with columns: inventory reference, description, test file, status. The test SHALL fail against behaviour equal to classic and pass against the corrected JAgentChill behaviour. The checklist coverage gate SHALL fail when an entry in that file has no existing test file. [NEW]

#### Scenario: Defect list complete
- **WHEN** `docs/CLASSIC-DEFECTS.md` is compared with the inventory's defect notes
- **THEN** every item marked as a probable bug, STUB or PARTIAL in the inventory has a row

#### Scenario: Missing test
- **WHEN** a row names a test file that does not exist
- **THEN** `pnpm jagentchill:check:coverage` fails with `classic defect without test: <row id>`

#### Scenario: Playback clock defect
- **WHEN** the playback clock regression test runs a 5-minute simulated playback
- **THEN** the playhead and the audio clock differ by 1 frame or less at every sample

### Requirement: Verify gate
`pnpm jagentchill:verify` SHALL run, in order, stopping at the first failure and printing a one-line summary per step with its duration: `openspec validate --strict` for every active change; `jagentchill:check:upstream`; `jagentchill:check:coverage`; `jagentchill:check:stories`; `jagentchill:check:design` (`platform-skeleton.UI design reference file`); `jagentchill:check:contrast` (the token contrast gate named in `diagnostics-quality.CI gates`); typecheck of all JAgentChill packages; lint (including dependency-direction, the graph-library denylist for `packages/workflow` and `packages/archify`, the `single-channel` rule, no-module-mock, no-upstream-internals, `no-plugin-sdk` and `gateway-boundary` rules); format check; locale parity (`en`, `vi`, `ja` have identical key sets with no empty value); unit tests with coverage thresholds; wasm tests; the Gateway build of the pinned tag (`jagentchill:gateway:build`, a cache hit when current); gateway contract tests; protocol and pairing tests on both transports; the built-in rows of the runtime contract tests; protocol compatibility fixtures; build of the server, web export and desktop bundle. It SHALL exit 0 only when every step passes. A story's `## Verify command` SHALL invoke this command or a documented subset plus the story's own tests. [NEW]

#### Scenario: Passing tree
- **WHEN** the command runs on a passing tree
- **THEN** it prints one line per step ending in `ok` and exits 0

#### Scenario: First failure stops the run
- **WHEN** typecheck fails
- **THEN** subsequent steps do not run, the summary marks typecheck `fail`, and the exit status is non-zero

#### Scenario: Missing translation
- **WHEN** a key exists in `en` and is absent in `ja`
- **THEN** the locale parity step fails and names the key

### Requirement: CI gates
Every pull request SHALL be blocked from merging unless these jobs pass: `jagentchill-upstream-guard`, `jagentchill-checklist-coverage`, `jagentchill-policy` (decision records, spike records for S6 to S28 including the `awaiting-owner` block, telemetry denylist, golden-update justification, generated capability matrix, prompt overlap, evidence labels), `jagentchill-licences` (notices, asset provenance, generated assets up to date, and coverage of the 271 classic country codes by the flag sticker set), `jagentchill-design` (two checks: `jagentchill:check:design`, and the contrast gate `jagentchill:check:contrast` of decision B7 — for every text-on-surface and control-on-surface pair the generated token file declares, in light and in dark and in every state (default, hover, pressed, selected, disabled-with-meaning, focus ring), the computed WCAG 2.2 contrast ratio is at least 4.5:1 for text below 24 px regular or 18.66 px bold, 3:1 for larger text, and 3:1 for user-interface components, focus indicators and meaningful graphics; a pair within 0.05 of its threshold fails; the pair list and the token values are owned by capability `design-system`), `jagentchill-packaging` (per desktop platform and architecture and for the container image: the packaged app starts its server, the server's Gateway child becomes ready and is a pristine build of the pinned tag, the server reports the render host probe passed, both FFmpeg builds report LGPL configuration, and the test `ffmpeg-openh264-split` of `updates-distribution.Desktop packaging targets` passes), `jagentchill-typecheck`, `jagentchill-lint`, `jagentchill-unit`, `jagentchill-wasm`, `jagentchill-golden`, `jagentchill-contract` (the suite of `diagnostics-quality.Gateway contract tests`, including the tests `rpc-ownership`, `tool-index`, `orc-route-ids`, `tool-range-rule` and `session-permission-mode` named below), `jagentchill-workflow` (the workflow engine suite and four named tests: `archify-projection` — every built-in template and the fixtures of `workflow-diagram.Archify HTML export on the host` are projected by `agent-workflows.Archify projection`, and each result validates against the upstream `workflow.schema.json` at the commit pinned by `workflow-diagram.Archify fork package` and is accepted by `archify validate workflow` of the fork's tree and of the unpatched upstream tree; `template-node-ids` — the shipped documents `one-prompt-video.json` and `film-episode.json` of `packages/workflow/templates/` contain exactly the node ids their specifications list (`agent-workflows.Built-in templates`, `prompt-to-video-workflow`, `film-production.Film pipeline template`); `archify-fork-inventory` and `archify-core-neutral` — the two gates of `workflow-diagram.Archify fork package` and `workflow-diagram.Environment-neutral compile core`), `jagentchill-pairing`, `jagentchill-runtimes-builtin`, `jagentchill-e2e-smoke` (web and desktop), `jagentchill-build`. On the default branch and nightly the full end-to-end suites (web, desktop on macOS, Windows and Linux, iOS simulator, Android emulator), `jagentchill-performance`, `jagentchill-performance-mobile`, `jagentchill-connection-matrix` (the cases of `device-pairing-signing.Connection path tests on every platform` on macOS, Windows, Linux, iOS, Android and web) and the vendor-CLI rows of `jagentchill-runtimes` SHALL also run. Branch protection SHALL require the pull-request jobs by name; a job that is skipped by path filter counts as passed only for the documentation-only filter in `platform-skeleton.Continuous integration entry points`. The named tests are: `tool-index` — every `jc_*` tool name used in a capability spec, the server manifest or a bundled skill is a row of the index of `agent-editing-tools.Tool naming and families`, the tool list of each owning capability equals its index row, and each tool has exactly one parameter schema; `orc-route-ids` — every task-route id used by a capability, a built-in template or a bundled skill is in the list of `orc-model-routing.Routes with primary and ordered fallbacks`; `rpc-ownership` — every channel P method is named by its owner's requirement (`server-api.RPC domain ownership`); `tool-range-rule` — every ranged numeric parameter of every `jc_*` tool, called with one value above its maximum, fails with `OUT_OF_RANGE` carrying `min` and `max`, and no tool clamps (`agent-editing-tools.Validation`); and `session-permission-mode` — no code path sends `sessions.create`, or a mode-changing `sessions.patch`, to the Gateway without an explicit `permissionMode` (`server-api.Agent session relay`). A checked-in workflow is not proof it ran: the release workflow SHALL verify through the CI provider's API that every required job succeeded on the tagged commit, and SHALL run the release-checklist gate `preset-verification` of `agent-runtimes.Endpoint presets`, which stops the release while the shipped preset data lacks, for any of the capabilities `voice-design`, `sfx` and `lipsync` or the stock kinds `video` and `image`, a `media-endpoint` or `stock-source` preset with a non-empty `verified.ref`, or contains a preset whose `verified.ref` is empty. [NEW]

#### Scenario: Contrast below the threshold
- **WHEN** a token change makes a secondary text colour 4.3:1 on the sidebar surface in dark theme
- **THEN** the job `jagentchill-design` fails with the pair, the theme, the measured ratio and the required 4.5:1

#### Scenario: One gate fails
- **WHEN** `jagentchill-golden` fails on a pull request
- **THEN** the pull request cannot be merged

#### Scenario: Projection no longer validates
- **WHEN** a change to a built-in template or to the projection makes a projected document fail the pinned upstream `workflow.schema.json` (for example by emitting `meta.description` or omitting `meta.output`)
- **THEN** the job `jagentchill-workflow` fails in the test `archify-projection` and names the template and the offending property

#### Scenario: Tool missing from the index
- **WHEN** a capability spec or a bundled skill names a `jc_*` tool that is not a row of the tool index
- **THEN** the job `jagentchill-contract` fails in the test `tool-index` and names the tool and the file

#### Scenario: Unknown task route
- **WHEN** a built-in template references the task route `image.sketch`
- **THEN** the test `orc-route-ids` fails and names the route

#### Scenario: Template node id drift
- **WHEN** `film-episode.json` renames the node `storyboard`
- **THEN** the test `template-node-ids` fails and names the missing id

#### Scenario: Unverified media preset at release
- **WHEN** a tag is pushed while the shipped preset data has no `media-endpoint` preset with a non-empty `verified.ref` for `lipsync`
- **THEN** the release workflow stops in `preset-verification` naming the capability

#### Scenario: Required job missing on a release commit
- **WHEN** a tag is pushed on a commit for which `jagentchill-pairing` has no successful run
- **THEN** the release workflow stops with `required job not successful: jagentchill-pairing`

#### Scenario: Nightly end-to-end failure
- **WHEN** the nightly Android suite fails
- **THEN** an issue is opened automatically with the failing flow, video and trace links

### Requirement: Checklist coverage gate
`pnpm jagentchill:check:coverage` SHALL parse every PORT-CHECKLIST id from section 7 of `docs/research/opencut-classic-inventory.md` (515 lines), every CAPCUT-PARITY-CHECKLIST id (291 lines) from section 4 of `docs/research/capcut-parity-benchmark.md` and every JD id (178 lines, prefixes JD-PRV, JD-CMP, JD-MID, JD-ORC, JD-MA, JD-SKL, JD-USE, JD-TRM, JD-WS) from `docs/research/jagentdesk-agent-features.md`, parse the provenance tags of every requirement in `openspec/changes/build-jagentchill/specs/*/spec.md` (and, after archiving, `openspec/specs/*/spec.md`), and parse `tasks.md`. It SHALL fail, listing each offending item, when: a checklist id is referenced by no requirement; any requirement, whatever its tag, is referenced by no task; a tag references an id that does not exist in its checklist; a requirement has no provenance tag; a requirement has no scenario; two requirements in one spec share a name; a back-ticked `capability.Requirement name` reference resolves to no requirement; a task references a requirement that does not exist; `tasks.md` is missing; a spec contains, as a whole word and case-insensitively, any word banned by the authoring rules of `openspec/config.yaml`; a spec other than `workflow-diagram`, `platform-skeleton` and `diagnostics-quality` names a canvas renderer technology — a term listed in `packages/archify/renderer-terms.json` — because requirements outside the canvas capability must hold for either outcome of spike S19; a spec names a spike id outside S6 to S28 (S1 to S5 only where they are stated as withdrawn); a spec names a client connection to OpenClaw's native socket, an OpenClaw operator scope held by a device, or a bootstrap token as product behaviour (terms list `scripts/removed-terms.json`, matched outside sentences that state the removal); or a requirement that names one desktop or one mobile operating system for a behaviour names no equivalent for the others of its family (heuristic list of platform words; exceptions are annotated in `scripts/platform-parity-exceptions.json` with a reason). It SHALL write a report `openspec/changes/build-jagentchill/coverage-report.json` with, per id, the requirements and tasks that cover it, and SHALL print totals of covered and uncovered ids per checklist. [NEW]

#### Scenario: Full coverage
- **WHEN** every PORT, CC and JD id is tagged on at least one requirement and every requirement is referenced by a task
- **THEN** the command prints `PORT 515/515, CC 291/291, JD 178/178` and exits 0

#### Scenario: Unmapped checklist id
- **WHEN** one JD id appears in no requirement tag
- **THEN** the command exits non-zero and prints `uncovered: JD <id>`

#### Scenario: Requirement without a task
- **WHEN** a requirement tagged only `[NEW]` is referenced by no task in `tasks.md`
- **THEN** the command exits non-zero and prints `no task for requirement: <capability>.<Requirement name>`

#### Scenario: Unknown id in a tag
- **WHEN** a requirement tag names a PORT id that has no line in the inventory
- **THEN** the command exits non-zero and prints `unknown checklist id: PORT <id>`

#### Scenario: Dangling cross-reference
- **WHEN** a spec contains a back-ticked reference to a requirement name that the named capability does not define
- **THEN** the command exits non-zero and prints `unresolved reference` with the spec and the name

#### Scenario: Renderer named outside the canvas capability
- **WHEN** the spec of capability `agent-workflows` contains a term listed in `packages/archify/renderer-terms.json`
- **THEN** the command exits non-zero and prints `renderer term outside workflow-diagram` with the spec and line

#### Scenario: Removed transport named as behaviour
- **WHEN** a spec says a device opens the native Gateway socket with an operator scope
- **THEN** the command exits non-zero and prints `removed term` with the spec and line

#### Scenario: Checklist grows
- **WHEN** a new checklist line is appended to the benchmark after the last existing id
- **THEN** the gate fails until a requirement and a task cover the new id

### Requirement: Story and evidence tracking
The gate `pnpm jagentchill:check:stories` SHALL enforce `platform-skeleton.User story convention` and additionally SHALL fail when a task in `tasks.md` is marked complete while every story referencing that task's requirement is still `planned`, or when a story marked `implemented` references a requirement that no completed task covers. Evidence recorded in a story SHALL be one or more of: the output of the story's verify command with its commit SHA, a CI run URL, a path to a recorded video or screenshot under `docs/stories/evidence/US-###/`. Every evidence file SHALL have a sidecar `<file>.meta.json` with `source: "live" | "fixture"` and `capturedAt_ms`; evidence produced with seeded, simulated, stubbed or fixture data SHALL have `source: "fixture"`, and the story's Evidence section SHALL start that item with the words `fixture data`. The gate SHALL fail for an evidence file without a sidecar and for a `fixture` item without the label. A pull request that marks tasks complete without a story evidence update SHALL fail `jagentchill-policy`. [NEW]

#### Scenario: Task complete, story untouched
- **WHEN** a pull request ticks a task and all stories for its requirement remain `planned`
- **THEN** the stories gate fails and names the task and stories

#### Scenario: Fixture evidence labelled
- **WHEN** a story's evidence is a screenshot taken with fixture media, with sidecar `source: "fixture"` and the line starting `fixture data`
- **THEN** the gate passes

#### Scenario: Fixture evidence unlabelled
- **WHEN** the sidecar says `fixture` and the Evidence line lacks the label
- **THEN** the gate fails with `US-###: fixture evidence is not labelled`

#### Scenario: Evidence without a sidecar
- **WHEN** a screenshot under `docs/stories/evidence/US-012/` has no `.meta.json`
- **THEN** the gate fails and names the file

### Requirement: Test fixtures
Media used by tests SHALL live under `packages/media/fixtures/` (and Git LFS for files above 1 MiB), SHALL be generated synthetically or carry a licence permitting redistribution recorded in `fixtures/LICENSES.md`, and SHALL include at least: H.264, HEVC, VP9 and AV1 video at 23.976, 30 and 60 fps; a variable-frame-rate phone clip; a clip with rotation metadata; 10-bit HDR video; AAC, MP3, WAV and Opus audio including a mono and a 5.1 file; PNG with alpha, JPEG with EXIF orientation, animated GIF and WebP; SRT, VTT and ASS subtitle files; a `.cube` LUT; a `.jcscript` script and a Fountain text file; a `.jcworkflow` workflow including the 200-node, 400-edge canvas fixture `wf-200`; `fixtures/audio/speech-fan-noise.wav` (speech with steady background noise, for the noise-reduction and voice-enhance checks); `fixtures/retime/pan-24fps` (a 24 fps pan with its ground-truth 48 fps frames, for frame interpolation); the AI acceptance sets under `fixtures/ai/` with their manifest (speech sets for word error rate and word timing, a lyrics line-break set, subject-tracking and cutout sets), as enumerated by `ai-editing-tools.AI acceptance fixtures`; the project fixture "mobile-reference" (1080p30, 10 main-track clips on 720p proxies, one overlay, one text element, one filter layer) used by the mobile budgets; and an OpenCut classic project export for each storage schema generation used by the migration tests. Fixtures SHALL NOT include material from CapCut, Devin or waoowaoo. [NEW]

#### Scenario: Licence record complete
- **WHEN** the fixtures directory is compared with `fixtures/LICENSES.md`
- **THEN** every file has an entry stating `synthetic` or a licence identifier and source

#### Scenario: Classic import fixture
- **WHEN** the migration test imports the classic schema fixtures
- **THEN** each opens at the current schema version with element counts equal to the recorded expectations

### Requirement: Flaky test policy
A test that fails and then passes on retry in CI SHALL be recorded as flaky in the job summary. Automatic retries SHALL be limited to 1 for end-to-end tests and 0 for unit, golden, contract, runtime-contract and pairing tests. A test recorded flaky 3 times within 7 days SHALL cause `jagentchill-policy` to fail on the default branch until the test is fixed or quarantined with a linked issue; quarantined tests SHALL be listed in `docs/QUARANTINE.md` and SHALL number 5 or fewer at any time. `jagentchill-policy` SHALL fail a pull request in which the count of `it(` and `test(` declarations in JAgentChill packages decreases unless its description contains a line `Test-Removal: <reason>`. [JAD] [NEW]

#### Scenario: Unit test retried
- **WHEN** a unit test fails once
- **THEN** the unit job fails without retry

#### Scenario: Third flake in a week
- **WHEN** an end-to-end test is recorded flaky a third time in 7 days
- **THEN** the default-branch policy job fails naming the test

#### Scenario: Quarantine limit
- **WHEN** a sixth test is added to the quarantine list
- **THEN** the policy job fails with `quarantine limit exceeded (6 > 5)`

#### Scenario: Test deleted without a reason
- **WHEN** a pull request removes 3 test declarations and its description has no `Test-Removal:` line
- **THEN** the policy job fails with `test count decreased by 3`

### Requirement: Job and event inspector
Host ▸ Diagnostics ▸ "Activity" SHALL list Gateway jobs (kind, state, progress, attempt, created and finished times, creator, error code and message) with filters by kind and state, a detail view showing the redacted error envelope and timeline of state changes, and the actions Cancel and Retry subject to the scope rule of `server-api.Job RPCs and events`; there is no pause action for Gateway jobs. The same screen SHALL offer a developer "Event log" tab, enabled by the performance-overlay setting, showing the last 500 channel P events received by this client with event name, stream, `seq`, time and payload size (payload bodies hidden unless expanded). [NEW]

#### Scenario: Inspect a failed job
- **WHEN** the user opens a failed generation job
- **THEN** the detail view shows its error code, localised message, attempt count and state timeline, and "Retry" is enabled for a device holding `jagentchill.generation.run`

#### Scenario: No jobs
- **WHEN** the host has no jobs
- **THEN** the list shows "No activity yet"

#### Scenario: Sequence gap visible
- **WHEN** the event log has received `seq` 10 and then 14 on a stream
- **THEN** a "gap: 3 events" row is shown between them
