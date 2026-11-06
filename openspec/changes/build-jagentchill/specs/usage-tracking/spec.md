## ADDED Requirements

### Requirement: Usage sources and single accounting
The product SHALL account for every cost in exactly one of two host stores and present both through one Usage view. **Agent usage** — tokens, cost, turns and duration of agent turns on any runtime (`agent-runtimes.Runtime model and the two access methods`) — is owned by this capability and stored in the server's host database (`<dataDir>/jagentchill.sqlite`). **Generation cost** — image, video, voice, music, lip-sync, transcription, translation and other provider calls made by the server's generation service — is owned by `generation-providers.Usage ledger`. An agent turn is never written to the generation ledger, and a generation call is never written as agent usage, including a generation call started by a tool inside an agent turn (that call is a ledger row carrying the turn's `sessionId` and `toolCallId`). Where numbers come from is fixed and shown to the user: per-turn tokens come from the runtime through the Gateway's agent events; session and provider aggregates are cross-checked with the Gateway's `usage.status`, `usage.cost` and `sessions.usage*` methods; plan and quota windows come only from the Gateway's provider usage path and only for providers where "Plan usage" is on (see `usage-tracking.Plan usage consent and sources`). All amounts are in USD; there is no currency selector. Usage data never leaves the host except to a paired device that requests it. Every usage feature requires a connected host. [NEW]

#### Scenario: Generation inside a turn
- **WHEN** an agent turn costing 0.04 USD in tokens calls `jc_generate_image`, which costs 0.08 USD
- **THEN** one agent usage record of 0.04 USD and one ledger row of 0.08 USD exist, and the session total is 0.12 USD with no amount counted twice

#### Scenario: Server-made model call
- **WHEN** the generation service translates captions through a provider API
- **THEN** a ledger row with capability `translation` exists and no agent usage record is written

### Requirement: Per-turn usage record
For every agent turn the server SHALL write one record: `{id, sessionId, sessionKey, runId, rootSessionId, parentSessionId?, agentId, persona?, role?, projectId?, workflowRunId?, teamRunId?, automationId?, deviceId?, runtimeId, providerId, endpointId?, modelId, upstreamProvider?, authProfileId?, servedBy?, billing: "api" | "plan" | "local" | "unknown", outcome: "completed" | "cancelled" | "failed", inputTokens?, cachedInputTokens?, cacheWriteTokens?, outputTokens?, totalTokens?, tokenSource: "reported" | "estimated" | "none", costUsd?, costSource: "reported" | "estimated" | "included" | "unknown", priceSource: "provider" | "aggregator" | "catalogue" | "admin" | "none", equivalentCostUsd?, toolCalls, started_ms, duration_ms, contextUsedTokens?, contextMaxTokens?, reconciled: boolean}`. `cachedInputTokens` is the runtime's cache-read count and `cacheWriteTokens` its cache-write count; `inputTokens` excludes both. `servedBy` is the object of `agent-runtimes.Served-by attribution` (the endpoint, model, upstream provider and hops that actually answered); `endpointId` and `upstreamProvider` repeat its final hop as flat, indexed columns, `providerId` and `modelId` are the serving ones, and `upstreamProvider` is absent when the aggregator does not disclose it (never guessed). `tokenSource` and `priceSource` are taken from the hand-off of `agent-runtimes.Usage and pricing through endpoints`: `tokenSource: "estimated"` marks token counts the host estimated at 4 characters per token because the endpoint reported none and its setting "Estimate tokens when the endpoint reports none" is on; `priceSource` is `provider` when the cost itself was reported, `admin` for a price entered on the endpoint model or a model override, `aggregator` for a price from an aggregator's catalogue, `catalogue` for the bundled price table and `none` for an unpriced model. `duration_ms` is wall time from the turn's start to its terminal event. `deviceId` is the device that sent the message, absent for agent-initiated, workflow and automation turns. Records are keyed by `(sessionKey, runId)`; writing the same turn twice updates the record and never adds a second one. Records contain no prompt text, no response text, no tool input or output, no file path and no secret. [NEW]

#### Scenario: Completed turn on an API-key provider
- **WHEN** a turn on `builtin` with an API-key profile reports 12 000 input, 3 000 cached and 800 output tokens
- **THEN** the record has those three values, `tokenSource: "reported"`, `billing: "api"`, a `costUsd` with `costSource` `reported` or `estimated`, and `outcome: "completed"`

#### Scenario: Duplicate terminal event
- **WHEN** the terminal event of a turn is delivered twice after a reconnect
- **THEN** exactly one record exists for that `(sessionKey, runId)`

#### Scenario: No content stored
- **WHEN** a test inspects the usage table after a session with long prompts and tool outputs
- **THEN** no column contains any prompt, response or tool payload text

#### Scenario: Turn served through an aggregator
- **WHEN** a turn runs on an endpoint whose aggregator reports the upstream provider and a catalogue price
- **THEN** the record carries `endpointId`, `upstreamProvider`, `servedBy.hops[]`, `priceSource: "aggregator"` and `tokenSource: "reported"`

#### Scenario: Endpoint that reports no usage
- **WHEN** a turn runs on an endpoint that returns no usage and whose "Estimate tokens when the endpoint reports none" setting is on
- **THEN** the record has token counts with `tokenSource: "estimated"`, and with the setting off it has no token fields and `tokenSource: "none"`

### Requirement: Capture from Gateway events with reconciliation
The server SHALL capture usage on the host, not from clients: over its gateway link (`server-api.Gateway link`) it receives the Gateway's `agent` events of every session it relays and reads the per-turn usage payload `{input, output, cacheRead, cacheWrite, total}` that the built-in runtime, harnesses and CLI backends emit, updating the record on every usage update and finalising it at the turn's terminal event. While a turn runs, the open record is updated at least every 5 s when the runtime streams usage. At the end of each turn and once per day for sessions active that day, the server reconciles with the Gateway method `sessions.usage {key}` called over the link: when the Gateway's session totals differ from the sum of the server's records for that session, the difference is applied to the most recent record and `reconciled` is set true, so that session totals always equal the Gateway's. Payload shapes of `usage.status`, `usage.cost` and `sessions.usage` and event parity across runtimes are gated by spikes S13 and S8; when a runtime's events carry no usage but `sessions.usage` reports session totals, the per-turn record is derived from the change in session totals across the turn; when neither source reports, the record is written with `tokenSource: "none"`, `costSource: "unknown"`, and only turn count, duration and tool-call count. The server estimates token counts from text length only in the one case of `agent-runtimes.Usage and pricing through endpoints` — an endpoint that reports no usage and has "Estimate tokens when the endpoint reports none" on — at 4 characters per token; such records carry `tokenSource: "estimated"` and are labelled as estimates on every surface. In every other case missing tokens stay missing. Because the Gateway attributes a session to its creator and not to turn participants, attribution to a device, persona, project, team run or workflow run is the server's — the device is the turn's recorded initiator (`server-api.Run initiator attribution and host-execution gating`) — taken from its own session binding (`sessionKey → {projectId, deviceId}`) and run registries. Usage events that the Gateway emitted while the link was down are not replayed: when the link is ready again the server reconciles every session that had an open record with `sessions.usage`, and while the Gateway is unavailable (`server-api.Gateway supervision and lifecycle`) reconciliation and plan usage wait and the stored usage views keep answering from the server's database. [NEW]

#### Scenario: Running turn
- **WHEN** a turn has been streaming for 20 s on a runtime that streams usage
- **THEN** the session's usage indicator has been updated at least three times and shows the tokens used so far

#### Scenario: Reconciliation
- **WHEN** the server's records for a session sum to 41 200 input tokens and `sessions.usage` reports 41 950
- **THEN** the last record gains 750 input tokens, is marked `reconciled`, and the session total reads 41 950

#### Scenario: Endpoint without usage, estimation on
- **WHEN** a turn completes through a custom endpoint that reports no usage and has "Estimate tokens when the endpoint reports none" on
- **THEN** the record has token counts with `tokenSource: "estimated"`; with the same setting off, or on any other runtime, no token count is derived from text length

#### Scenario: Runtime reports nothing
- **WHEN** a turn completes on an ACP runtime whose capability `usage` is `none`
- **THEN** the record has `tokenSource: "none"`, no token fields, `duration_ms` and `toolCalls`, and usage surfaces show "Not reported by <runtime>"

### Requirement: Interrupted and failed turns count
Usage of turns that are cancelled, interrupted by a steer with mode `interrupt`, stopped by a runtime switch, or failed SHALL be recorded with the partial usage streamed up to the terminal event and `outcome` `cancelled` or `failed`, and SHALL be included in every total. Turns are counted in `turns` regardless of outcome; the breakdown `{completed, cancelled, failed}` is available in session and aggregate views. A turn lost to a crash of the Gateway or of the server before its terminal event is finalised at the next start as `failed` with the last usage update received. [JAD JD-USE-008]

#### Scenario: Stop mid-turn
- **WHEN** the user stops a turn after 6 000 input and 300 output tokens were reported
- **THEN** a record with `outcome: "cancelled"` and those tokens exists and the session totals include them

#### Scenario: Gateway crash
- **WHEN** the Gateway process is killed during a turn and the server restarts it
- **THEN** the open record is closed as `failed` with the tokens of its last update and is not left open

### Requirement: Cost determination and labels
Each record's cost SHALL be determined in this order and labelled accordingly. (1) `reported` — the runtime or provider returned a cost for the turn; shown as "Reported". (2) `estimated` — tokens are reported and billing is `api`: the amount is the Gateway's estimate for the session where `usage.cost` provides one, otherwise tokens multiplied by the model's `tokens` pricing from `generation-providers.Cost model` (input, cached input and output rates; cache writes at the input rate unless the model defines a rate); shown as "Estimated" with the price table's "Prices as of <date>"; when the tokens themselves are estimated (`tokenSource: "estimated"`) the amount is also `estimated` and every surface shows "Estimated — tokens not reported by the endpoint", and such amounts never raise a row's accuracy above `estimated`. (3) `included` — billing is `plan` (a subscription login of a CLI runtime, or an OAuth/CLI-login profile the Gateway marks as plan-billed) or `local`: `costUsd` is 0 and the amount is shown as "Included in plan" or "Local — no cost", never as "$0.00" alone. (4) `unknown` — no tokens (`tokenSource: "none"`), or no price for the model (`priceSource: "none"`): a model without a price is labelled **"Unpriced"** wherever models, turns or rows are listed (the same word as `generation-providers.Cost model` and `agent-runtimes.Usage and pricing through endpoints`), its turns' cost is shown as "Unknown" and excluded from sums, with the count of such turns stated next to every total they are missing from. For `included` and `estimated` records the server also stores `equivalentCostUsd` — tokens at list price — shown only as "Equivalent API cost (estimate)". Amounts are stored with 6 decimal places and displayed with 2, or 4 below 0.01 USD. A cost is never invented: a provider that reports 0 for a plan-billed turn is labelled `included`, not free. A result served by the built-in sound-pack source `jc-sound-pack` (`generation-providers.Provider registry by capability type`) is recorded as one ledger row with `costUsd` 0, `costSource: "included"`, the provider `jc-sound-pack` and the item's provenance (pack item id, licence, origin), and is shown as "Bundled sound pack — no cost"; it consumes no budget and needs no approval. [JAD JD-USE-011] [NEW]

#### Scenario: Subscription CLI
- **WHEN** a turn runs on `claude-code` signed in with a subscription and reports tokens and no cost
- **THEN** the record has `billing: "plan"`, `costSource: "included"`, and the session shows "Included in plan" with "Equivalent API cost (estimate) $0.31"

#### Scenario: Model without a price
- **WHEN** a custom endpoint model has no pricing and a turn reports tokens
- **THEN** the cost is "Unknown", the tokens are counted, and the session total carries the note "1 turn with unknown cost not included"

#### Scenario: Mixed total
- **WHEN** a period contains reported, estimated and included turns
- **THEN** the total is labelled "Estimated" and its tooltip breaks the sum into Reported, Estimated, Included in plan (turn count) and Unknown (turn count)

#### Scenario: Unpriced model
- **WHEN** a turn runs on an endpoint model with `priceSource: "none"` and reported tokens
- **THEN** the turn's tokens are shown, its cost reads "Unknown", the model is labelled "Unpriced", and totals state "1 turn with unknown cost"

#### Scenario: Bundled sound pack result
- **WHEN** a run's sound-effect step is answered by `jc-sound-pack`
- **THEN** the usage ledger has one row for it with `costUsd` 0, provider `jc-sound-pack` and the pack item's provenance, shown as "Bundled sound pack — no cost"

### Requirement: Session totals
Each session SHALL have cumulative totals `{inputTokens, cachedInputTokens, cacheWriteTokens, outputTokens, totalTokens, agentCostUsd, generationCostUsd, totalCostUsd, equivalentCostUsd, turns {completed, cancelled, failed}, toolCalls, duration_ms, firstTurn_ms, lastTurn_ms, byRuntime[], byModel[], accuracy}` read with `jagentchill.usage.session.get {sessionId, includeTree?}` (scope `jagentchill.config.read`). Totals only grow during a session's life. They survive a runtime switch (the session keeps one total with a per-runtime breakdown), a rewind (usage already spent stays counted), archive and restore. A forked session starts at zero and its copied history adds no usage. An imported CLI session starts at zero with the note "Usage before import is not included". A CLI opened in terminal mode (`agent-runtimes.Native CLI in a host terminal`) records nothing and shows "Not tracked in terminal mode". `generationCostUsd` is the sum of ledger rows whose `sessionId` is the session. The `usage` object in `chat-agent.Session record and metadata` is filled from these totals. [JAD JD-USE-008] [NEW]

#### Scenario: Runtime switch keeps totals
- **WHEN** a session used 50 000 tokens on `builtin` and is switched to `codex` for two more turns
- **THEN** the session total includes all turns and `byRuntime` has two entries

#### Scenario: Rewind does not refund
- **WHEN** the user rewinds three turns
- **THEN** the session totals are unchanged

#### Scenario: Fork starts at zero
- **WHEN** a session with 200 000 tokens is forked
- **THEN** the fork shows 0 tokens until its first own turn

### Requirement: Agent-tree roll-up
For sessions that spawn other agents — sub-agents (`multi-agent-orchestration.Parentage and the agent tree`), team runs (`multi-agent-orchestration.Durable run record`) and workflow runs (`agent-workflows.Run state machine`) — the server SHALL keep the tree from its own registries (`parentSessionId`, `rootSessionId`, `teamRunId`, `workflowRunId → sessionKey`) and compute, for every node, `own` totals and `subtree` totals (own plus all descendants) in the shape of `usage-tracking.Session totals`. `jagentchill.usage.tree.get {rootSessionId | teamRunId | workflowRunId}` (scope `jagentchill.config.read`) returns `{node: {sessionId, agentId, label, persona?, role?, runtimeId, modelId, status, own, subtree, sharePct, children[]}}` with children ordered by `subtree.totalCostUsd` descending, then by tokens. `sharePct` is the node's subtree share of the root's cost, or of tokens when the root's cost is unknown or zero. A child's usage is never added to its parent's `own` totals. Detaching a child from its parent keeps its past usage in the original tree and starts a new root for subsequent turns. The roll-up does not rely on the Gateway grouping (`sessions.usage {groupBy: "family"}` is documented for rotated session ids only); it is computed for trees of up to 500 nodes within 300 ms (a tree holds at most 200 agents under `multi-agent-orchestration.Tree limits`; runtime-native sub-agents are included in their parent). The per-agent attribution that feeds this roll-up is produced by `multi-agent-orchestration.Usage roll-up`; this requirement is the single read model and `jagentchill.usage.tree.get` and `jagentchill.usage.query` (`usage-tracking.Unified usage query`) are the only reads other capabilities use. [NEW]

#### Scenario: Lead with two peers
- **WHEN** a lead spends 0.20 USD and its peers 0.50 and 0.30 USD
- **THEN** the lead node shows own 0.20 and subtree 1.00 USD, and the peers show shares 50 % and 30 %

#### Scenario: Workflow run
- **WHEN** a workflow run started four agent nodes and three generation nodes
- **THEN** `tree.get {workflowRunId}` returns the four agent sessions under one root with the run's generation cost in the root's `generationCostUsd`

#### Scenario: Detached child
- **WHEN** a child with 30 000 tokens is detached and runs two more turns
- **THEN** the original tree still includes the 30 000 tokens and the two new turns appear under the child as its own root

### Requirement: Attribution dimensions
Every agent usage record and every ledger row SHALL be attributable to these dimensions for grouping and filtering: `provider`, `endpoint` (the endpoint record that served the call; "Direct" when none), `upstreamProvider` (the provider behind an aggregator; "Not disclosed" when absent), `runtime`, `model`, `billing`, `tokenSource`, `priceSource`, `project`, `film`, `filmEpisode`, `filmStage`, `session`, `rootSession`, `agent` (persona), `role` (ORC role), `teamRun`, `workflowRun`, `automation`, `device`, `capability` (`llm-agent` for agent usage; the ledger's capability for generation), `source` (`agent` | `generation`), `outcome`, `day` and `month`. A session with no project is grouped as "No project". The film dimensions come from the `filmId` of ledger rows and from the film, episode and stage a pipeline run or `film.step` job carries (`film-production.Cost estimates and budgets`); usage outside a film is grouped as "No film". `servedBy` hops other than the final one are not dimensions: they are shown in the turn detail only. A custom runtime profile is its own `runtime` value and also carries `baseRuntime` so that views can merge profiles with their base ("Group profiles with their base runtime", default on). A deleted session, project, persona or runtime keeps its id and last known label in records ("<label> (deleted)"). A session moved to another project attributes subsequent turns to the new project; past records keep the project they were recorded with. [NEW]

#### Scenario: Group by runtime with profiles merged
- **WHEN** usage exists on `claude-code` and on a profile extending it
- **THEN** with the merge option on there is one row "Claude Code" that expands to the two, and with it off there are two rows

#### Scenario: Deleted project
- **WHEN** a project with usage is deleted permanently
- **THEN** its rows remain under "<project name> (deleted)" and totals are unchanged

#### Scenario: Group by endpoint and upstream provider
- **WHEN** usage is grouped by `endpoint` then `upstreamProvider` over a range in which one aggregator endpoint was answered by two upstream providers
- **THEN** the endpoint row expands into two rows, one per upstream provider, whose sums equal the endpoint row

#### Scenario: Film dimension
- **WHEN** usage is grouped by `film` then `filmStage`
- **THEN** agent turns and generation calls of a film's storyboard stage appear in one row under that film

### Requirement: Daily rollups and lifetime totals
The server SHALL maintain one rollup per calendar day in the host's time zone per `(provider, runtime, model, billing, source)` with token, cost, turn, call and duration sums, plus a lifetime total per host. Rollups and the lifetime total are updated as records are written and SHALL NOT shrink when a session, project, agent or runtime is deleted or when raw records pass their retention. The host's time zone id is returned with every response that has days, and the UI states "Days are in <time zone> (the host's time zone)". A change of the host's time zone applies to days from then on and does not re-bucket past rollups. `jagentchill.usage.history.get {from_day, to_day}` (scope `jagentchill.config.read`) returns the rollups for up to 800 days per call. [JAD JD-USE-009] [NEW]

#### Scenario: Lifetime survives deletion
- **WHEN** a session with 1.20 USD of usage is deleted
- **THEN** the lifetime total and that day's rollup still include 1.20 USD

#### Scenario: Day boundary
- **WHEN** a turn ends at 23:59:50 host time and the next starts at 00:00:10
- **THEN** the two records fall into consecutive days of the host's time zone, regardless of the viewing device's time zone

### Requirement: Context-window meter data
For the active session the server SHALL expose `context {usedTokens, maxTokens, pct, source: "reported" | "unknown", model, updated_ms}` taken from the last turn's usage and the model's context window on the session's runtime (`agent-runtimes.Model discovery`, including a per-session `context_window` feature value). `pct` is `usedTokens / maxTokens` rounded to the nearest whole percent, capped at 100. When the runtime reports no context figure the meter shows an empty ring with "Context size not reported by <runtime>". Tone: default below 80 %, `warning` from 80 %, `danger` from 95 %; at `danger` the tooltip offers "Compact conversation" where the runtime's `compaction` capability is not `none`. After compaction, a runtime switch or a model change the figure is cleared until the next turn reports. [JAD JD-USE-007] [NEW]

#### Scenario: Meter after a turn
- **WHEN** the last turn reports 150 000 used tokens on a model with a 200 000-token window
- **THEN** the meter shows 75 % in the default tone

#### Scenario: Near the limit
- **WHEN** the figure reaches 96 %
- **THEN** the meter is in the `danger` tone with an icon and the tooltip offers "Compact conversation"

#### Scenario: After a model change
- **WHEN** the user changes to a model with a different context window
- **THEN** the meter shows an empty ring with "Updates after the next message"

### Requirement: Provider plan usage shape
Plan and quota information SHALL use one provider-agnostic shape: `{providerId, runtimeIds[], displayName, status: "available" | "unavailable" | "error" | "off", planLabel?, sourceLabel?, fetched_ms?, nextRefresh_ms?, windows: [{id, label, usedPct?, remainingPct?, resetsAt_ms?, runsOutAt_ms?, shortfallPct?, tone}], balances: [{id, label, used?, remaining?, limit?, unit: "usd" | "credits" | "requests" | "tokens", resetsAt_ms?, tone}], details: [{label, value}], error?}`. A window is a time-boxed allowance (for example a 5-hour session window, a weekly window, a model-scoped window); balances are amounts (for example credits, extra-usage spend, a spending budget). `tone` is `default | ok | warning | danger`: for windows and balances with a known used percentage, `ok` below 70 %, `warning` from 70 %, `danger` from 90 %; `default` when unknown. `runsOutAt_ms` is computed by the server only when `usedPct`, `resetsAt_ms` and the window length are known: it is the time at which usage reaches 100 % at the average rate since the window began, and is omitted when that time is after the reset; `shortfallPct` is the projected percentage over 100 at the reset, omitted when not positive. `sourceLabel` states the origin in words, for example "From Anthropic, using the Claude Code login on <host name>". `status: "off"` means the user has not turned "Plan usage" on for that provider. [JAD JD-USE-002] [NEW]

#### Scenario: Two windows and a balance
- **WHEN** a provider reports a 5-hour window at 82 % used, a weekly window at 40 % and a credit balance
- **THEN** the shape has two `windows` (tones `warning` and `ok`) with reset times, and one `balances` entry with unit `credits`

#### Scenario: Projected run-out
- **WHEN** a weekly window is 60 % used two days after it began with five days left
- **THEN** `runsOutAt_ms` is about 1.3 days from now and `shortfallPct` is present

#### Scenario: Provider gives a plan name only
- **WHEN** the provider reports a plan label and no window
- **THEN** the shape has `planLabel`, empty `windows`, and one `details` row, and the card renders without bars

### Requirement: Plan usage consent and sources
Plan usage SHALL be fetched only for providers where an admin turned "Plan usage" on (`usage.planUsage.<providerId>: boolean`, scope `jagentchill.config.write` to change). Defaults: off for every provider reached through a CLI's own login (CLI runtimes and the `cli-login` auth method); on for providers the user connected in the app with an API key, OAuth or device code, where the host already holds the credential for that purpose. Turning it on for a CLI-login provider shows the dialog "Show plan usage for <provider>? <host name> will use the <CLI name> sign-in stored on that computer to ask <provider> for your plan limits. Nothing is changed in that sign-in and nothing is sent anywhere else." with "Cancel" and "Turn on"; the choice is recorded in the audit log. The server itself SHALL NOT open, read, copy or parse any CLI credential file, OS keychain item, CLI state database or CLI configuration to obtain credentials, under any setting; the only source is the Gateway's own provider usage path — `usage.status`, including what harnesses contribute through their usage snapshot — called over the gateway link for enabled providers only. JAgentDesk ships its own fetchers that read each CLI's credential store without asking; that design is not reproduced. A fetch is read-only: it never refreshes, rewrites or rotates a credential. A provider or runtime for which the Gateway exposes no plan data reports `status: "unavailable"` with `error: "Not exposed by this runtime"`, and a failing fetch degrades to `status: "error"` for that provider without failing the request. Whether `usage.status` can be limited to named providers is gated by spike S13; when it cannot, the per-provider switches are replaced by one host switch "Plan usage for all connected providers" (default off) whose dialog lists every provider and CLI login that will be used, and no call is made while it is off. Every plan-usage destination is a provider host already listed in `security-privacy.Network egress control`. [JAD JD-USE-003] [NEW]

#### Scenario: Default for a CLI login
- **WHEN** `claude-code` is ready and the admin has not changed any usage setting
- **THEN** the Anthropic plan card shows "Plan usage is off" with "Turn on", no request for plan data has been made for it, and no file under the CLI's configuration directory has been opened by the server

#### Scenario: Turning it on
- **WHEN** the admin confirms the dialog for the Claude Code login
- **THEN** the next fetch returns windows with `sourceLabel` naming the login used, and an audit record `usage.planUsage.enable` exists

#### Scenario: Runtime without plan data
- **WHEN** Plan usage is on for a provider reached through a custom ACP command
- **THEN** its card shows "Not exposed by this runtime" and other providers' cards are unaffected

### Requirement: Plan usage fetching and cache
`jagentchill.usage.plan.list {providerIds?, refresh?}` (scope `jagentchill.config.read`) SHALL return the shapes of `usage-tracking.Provider plan usage shape` for every connected provider and enabled CLI runtime. Data is fetched on demand — only while a usage surface is visible on some device — and never on a timer. The host caches the combined result for 300 000 ms; concurrent requests during a fetch share that one fetch; `refresh: true` bypasses the cache at most once per 30 s per provider (otherwise the cached result is returned with its `fetched_ms`). Each provider fetch has a 10 000 ms timeout. A provider that fails yields a row with `status: "error"` or `"unavailable"` while the others are returned normally; the last successful result for a failing provider is returned alongside as `stale` for at most 1 h. The cache is in memory and is empty after a server restart. `nextRefresh_ms` is `fetched_ms + 300 000`. [JAD JD-USE-001] [NEW]

#### Scenario: Two devices open usage at once
- **WHEN** a desktop and a phone open the Plan usage tab within one second
- **THEN** one fetch per enabled provider is made and both devices receive the same `fetched_ms`

#### Scenario: Refresh spam
- **WHEN** the user presses "Refresh" three times in 10 s
- **THEN** one new fetch is made and the other presses return the cached result

#### Scenario: One provider times out
- **WHEN** one of three providers does not answer within 10 s
- **THEN** two cards show fresh data and the third shows "Unable to load usage" with its last data marked "From <time>"

### Requirement: Plan usage rendering
Plan usage SHALL be rendered with generic components only — a window bar and a balance bar — with no provider-specific layout. A provider card shows: the provider label and `planLabel`; `sourceLabel` in caption text; one window bar per window (label, a bar filled to `usedPct`, "<used> % used" and "resets <relative time>", and "runs out <relative time>" in the `warning` or `danger` tone when present); one balance bar per balance (label, "<used> of <limit> <unit>" or "<remaining> <unit> left", a bar when `limit` is known); `details` as label–value rows; and "Updated <relative time>". Tones are drawn with the status tokens of `design-system.Colour tokens` and always paired with text, so that meaning does not depend on colour. A percentage that is unknown renders an empty bar with "Not reported". Bars are 6 px high with a 3 px radius; cards are 1 column on compact, 2 on medium, 3 on wide. Each bar exposes its value to assistive technology as "<label>, <n> percent used, resets <time>". [JAD JD-USE-004] [NEW]

#### Scenario: Same component for every provider
- **WHEN** two providers with different window sets are shown
- **THEN** both cards are built from the same window-bar and balance-bar components and differ only in data

#### Scenario: Unknown percentage
- **WHEN** a window has a label and a reset time and no percentage
- **THEN** its bar is empty and reads "Not reported", with the reset time still shown

### Requirement: Plan usage section in settings
Settings ▸ Host ▸ Usage SHALL contain a section "Plan usage" with: one card per connected provider and enabled CLI runtime, a per-provider "Plan usage" switch (admins), a "Refresh" button, and the states "Loading usage…", "No usage data" (no connected provider), "Unable to load usage" with "Retry", "Plan usage is off" with "Turn on" (admins) or "Ask an admin device to turn this on", "Connect to this host to see provider usage", and "Update the host to see provider usage" when the host's protocol lacks the method. The section header carries the fixed explanation "Limits are reported by each provider. JAgentChill asks only the providers you turn on here." with a "Learn where these numbers come from" link to the accuracy notes of `usage-tracking.Accuracy caveats shown to the user`. [JAD JD-USE-005] [NEW]

#### Scenario: Older host
- **WHEN** the connected host's negotiated protocol has no `jagentchill.usage.plan.list`
- **THEN** the section shows "Update the host to see provider usage" and no error toast

#### Scenario: Editor device
- **WHEN** an editor opens the section with one provider off
- **THEN** cards for enabled providers show data, the off provider shows "Ask an admin device to turn this on", and no switch is interactive

### Requirement: Composer usage indicator
The session composer SHALL show a usage indicator at the trailing end of its control row (placement and density by `chat-agent.Composer layout and controls`): the context-window ring of `usage-tracking.Context-window meter data`, 16 px on web and desktop and 20 px on mobile, with the percentage as text at `full` density. Hovering or focusing it (desktop, web) or pressing it (mobile, as a bottom sheet) opens a panel with three sections: "Context" (used and maximum tokens, percentage, model); "This session" (input, cached input and output tokens, turns, duration, agent cost with its accuracy label, generation cost, total; "Not reported by <runtime>" where applicable; and a link "View session usage"); and "Plan usage — <provider>" for the session's provider (the window and balance bars, or "Plan usage is off", or "Not exposed by this runtime"). The panel's plan section triggers a plan fetch under the caching rules above. While a turn runs, the session section updates at least every 5 s. The indicator is hidden for a draft with no turns and shows an "Offline" state with the last known values while disconnected. Its accessible name is "Usage: context <n> percent, session cost <amount or label>". [JAD JD-USE-006, JD-USE-007] [NEW]

#### Scenario: Tooltip on desktop
- **WHEN** the user hovers the ring in a session on `builtin` with Plan usage on for its provider
- **THEN** the panel shows context, session totals with "Estimated" next to the cost, and the provider's window bars

#### Scenario: Subscription CLI session
- **WHEN** the session runs on a plan-billed CLI runtime with Plan usage off
- **THEN** the cost line reads "Included in plan" and the plan section reads "Plan usage is off" with "Turn on" for admins

#### Scenario: Mobile
- **WHEN** the user presses the ring on a phone
- **THEN** a bottom sheet with the same three sections opens and closes by swipe down or the close button

### Requirement: Session usage view with agent-tree drill-down
"View session usage" (from the composer indicator, the session menu, and a row of the Sessions tab) SHALL open the session usage view hosted by `chat-agent.Session insights and usage`, whose Usage content is defined here: a header with the session totals and accuracy label; a breakdown table "By model and runtime" (runtime, provider, model, billing, turns, input, cached input, output, cost, share); a "Per turn" list (start time, duration, runtime · model, tokens in/out/cached, cost with label, outcome, tool calls) with a bar chart of cost per turn, or of tokens per turn when every cost is included or unknown; a "Generation" table of the session's ledger rows grouped by capability; and "Agents" — the tree of `usage-tracking.Agent-tree roll-up` as an indented, collapsible list where each row shows the agent label, role, runtime · model, status, own total, subtree total and a share bar. Selecting an agent row drills into that agent's own session usage view with a breadcrumb back to the root; the tree is expanded two levels by default. Every figure shown is reproducible by `jagentchill.usage.query` with the same filters. Wide layout: a 960 px modal; compact: a full-screen page with the sections as an accordion. Rows are keyboard-navigable (Left/Right collapse and expand; Enter drills in). [NEW]

#### Scenario: Drill into a peer
- **WHEN** the user opens a team lead's session usage and presses Enter on a peer row
- **THEN** the peer's own usage view opens with a breadcrumb "<lead> ▸ <peer>" and its per-turn list

#### Scenario: Tokens chart when cost is unavailable
- **WHEN** every turn of the session is plan-billed
- **THEN** the chart plots tokens per turn and its caption reads "Cost is included in the plan — showing tokens"

#### Scenario: Session without sub-agents
- **WHEN** the session spawned no agent
- **THEN** the "Agents" section shows "This session did not start other agents"

### Requirement: Unified usage query
`jagentchill.usage.query {groupBy: Dimension[] (1–3), filters?, from_ms, to_ms, sort?, cursor?, limit?}` (scope `jagentchill.config.read`; default limit 100, max 1 000) SHALL be the single query for agent usage and generation cost together. `Dimension` is any dimension of `usage-tracking.Attribution dimensions`; `filters` accepts every dimension, including `endpoint`, `upstreamProvider`, `tokenSource`, `priceSource` and `film`. Each result row is `{keys, labels, agent: {turns {completed, cancelled, failed}, inputTokens, cachedInputTokens, cacheWriteTokens, outputTokens, costUsd, equivalentCostUsd, includedTurns, unknownCostTurns, unreportedTurns, duration_ms}, generation: {calls, units, costUsd, unknownCostCalls}, totalCostUsd, estimatedTokenTurns, unpricedTurns, accuracy: "reported" | "estimated" | "mixed" | "partial"}` plus a `totals` row and `timeZone`. `accuracy` is `reported` when every contributing amount is reported, `estimated` when any is estimated, `mixed` when reported and included amounts coexist, and `partial` when any contributing turn or call has unknown cost or unreported tokens. Agent rows come from this capability's store and generation rows from `generation-providers.Usage ledger`, read on the host through that capability's query interface; this method replaces any separate client-facing ledger query, so that every screen shows one set of numbers. A query over 100 000 agent records plus 100 000 ledger rows returns within 1 s on the reference desktop host. Ranges are limited to 800 days per call; `from_ms` after `to_ms` fails with `INVALID_PARAMS`. **Session visibility:** sessions are private by default (`server-api.Session ownership and visibility`), so a row grouped or filtered by `session`, `device`, `persona` or agent — and every per-session method of this capability (`jagentchill.usage.session.get`, `jagentchill.usage.tree.get`) — is returned only for sessions the calling device can read; usage of sessions it cannot read is included in rows grouped by provider, model, runtime, project or day without any session identifier, and a query grouped by session reports the remainder as one row "Other sessions"; `admin` devices see every session. [NEW]

#### Scenario: Group by provider across both sources
- **WHEN** the query groups by `provider` for the last 30 days
- **THEN** a provider that served both chat turns and image generation has one row with both `agent` and `generation` filled and `totalCostUsd` equal to their sum

#### Scenario: Accuracy flag
- **WHEN** a row combines estimated turns and two turns with unknown cost
- **THEN** its `accuracy` is `partial` and `agent.unknownCostTurns` is 2

#### Scenario: Too many dimensions
- **WHEN** `groupBy` has four entries
- **THEN** the call fails with `INVALID_PARAMS`

### Requirement: Usage screen — Overview
The Usage screen (route `/h/[hostId]/usage`, a primary destination owned as a route by `app-shell-navigation.Route map`; `/settings/usage` redirects to it, and `settings-preferences.Host usage and limits settings` shows only a summary with the link "Open Usage") SHALL have the tabs Overview, Providers and runtimes, Projects, Sessions, Plan usage, and a shared range control (Today, Last 7 days, Last 30 days, This month, Last month, Custom; default Last 30 days) that persists per device. Overview shows: KPI tiles — Total cost (with accuracy label), Agent tokens (input / cached / output), Turns, Generation cost, Active time (sum of turn durations), and Lifetime total; a timeline chart of cost per day stacked by source (Agent, Generation) with a toggle to tokens per day and a hover/focus tooltip listing each stack's value; "By model" (top 10 with "Show all"); "Top agents" (personas by cost, then tokens); "Active context" (the sessions currently above 80 % context, with links); and a "Cache savings (estimate)" tile — cached input tokens multiplied by the difference between the model's input and cached-input list prices — always labelled "estimate". The chart uses the categorical colour tokens of `design-system.Colour tokens`, has a legend, and every value it plots is also readable without hover in the table below it. Per-tool cost is not shown. Empty range: "No usage in this period". Loading: skeleton tiles and chart. Compact layout: tiles two per row, the chart scrolls horizontally with a fixed y-axis, tables become stacked rows. [JAD JD-USE-010, JD-USE-011] [NEW]

#### Scenario: Overview for the last 30 days
- **WHEN** an admin opens Usage with data in the range
- **THEN** the tiles, the stacked daily chart, By model, Top agents and Active context are shown, and the total equals the `totals` row of `jagentchill.usage.query` for the same range

#### Scenario: Cache savings is labelled
- **WHEN** cached input tokens exist for priced models
- **THEN** the tile reads "Cache savings (estimate)" with the amount and a tooltip stating how it is computed

#### Scenario: Empty period
- **WHEN** the selected range has no usage
- **THEN** the chart area shows "No usage in this period" and the tiles show a dash, not zero cost

#### Scenario: Old settings route
- **WHEN** a client opens `/settings/usage`
- **THEN** it is redirected to `/h/[hostId]/usage` of the current host with the same tab and range

### Requirement: Usage screen — Providers and runtimes
The "Providers and runtimes" tab SHALL show a segmented switch "By provider | By endpoint | By runtime | By model" over a table with columns: name, access (CLI, Direct or Endpoint), billing, turns, input, cached input, output, agent cost, generation cost, total, accuracy, share bar. Rows expand to the next level (provider → runtimes → models, endpoint → upstream providers → models, or runtime → providers → models). Model rows carry the chips "Unpriced" (`priceSource: "none"`) and "Tokens estimated" (any turn with `tokenSource: "estimated"`), each with a text label, and a price-source caption ("Reported by provider", "Aggregator price", "Price table", "Admin price"). Profiles are merged with their base runtime by default with the toggle "Group profiles with their base runtime". Each row links to the Sessions tab filtered to it. A runtime whose turns have no reported tokens shows "Not reported" in token columns and its turn count and duration. Sorting by any numeric column; default total descending. [NEW]

#### Scenario: Runtime view
- **WHEN** the admin selects "By runtime"
- **THEN** each enabled or historically used runtime is a row with its access method and totals, and expanding `builtin` lists the providers used through it

#### Scenario: Unreported runtime
- **WHEN** an ACP runtime produced 12 turns with no usage reported
- **THEN** its row shows 12 turns, the active time, and "Not reported" for tokens and cost

#### Scenario: By endpoint
- **WHEN** the user selects "By endpoint" and expands an aggregator endpoint
- **THEN** one row per upstream provider is listed, or a single row "Not disclosed" when the aggregator reports none

### Requirement: Usage screen — Projects
The "Projects" tab SHALL list projects with usage in the range: project name (linking to the project), sessions, turns, agent tokens, agent cost, generation cost, total, accuracy, budget state from `generation-providers.Budgets with hard stop` ("<spent> of <limit>" with a bar, or "No budget"), and a sparkline of daily total. "No project" and deleted projects are rows. Expanding a project shows its breakdown by source and capability and its top five sessions, with "View all sessions". The same figures filtered to one project are shown in that project's settings panel. [NEW]

#### Scenario: Project with a budget
- **WHEN** a project with a 20 USD budget has spent 16.40 USD
- **THEN** its row shows "16.40 of 20.00" with the bar in the `warning` tone

#### Scenario: Sessions without a project
- **WHEN** some sessions in the range have no project
- **THEN** they are summed in a "No project" row that expands like any other

### Requirement: Usage screen — Sessions
The "Sessions" tab SHALL list sessions with usage in the range, 50 per page: title (linking to the session), persona, project, runtime · model (the latest, with "+<n>" when several), turns, tokens, agent cost, generation cost, total with accuracy label, sub-agent count, last activity. Root sessions are listed; a row with sub-agents shows a disclosure that expands the agent tree inline with own and subtree totals, and "Open usage" opens the session usage view. Filters: project, persona, runtime, provider, billing, "Has sub-agents", outcome; search by title. Team runs and workflow runs appear as rows of kind "Team run" and "Workflow run" with their tree. Deleted sessions appear as "<title> (deleted)" without a link. [NEW]

#### Scenario: Expand a tree inline
- **WHEN** the user expands a team run row
- **THEN** the lead and peers are listed indented with own and subtree totals, and the row's total equals the root's subtree total

#### Scenario: Filter by runtime
- **WHEN** the filter is set to Codex
- **THEN** only sessions with at least one turn on `codex` in the range are listed, with totals restricted to those turns and a caption "Showing Codex turns only"

### Requirement: Budgets hook
Agent usage SHALL count toward the budgets of `generation-providers.Budgets with hard stop` (global, provider, project, film, session, run and automation scopes); this capability reports and that capability decides, including the order in which budgets apply (the `auto`-mode session budget, default 5.00 USD, before the per-run ceilings of `multi-agent-orchestration.Autonomous control` and `multi-agent-orchestration.Worker and verifier loops`). (1) After every record with a `reported` or `estimated` cost, the server commits the amount to every applicable budget scope with the reference `agent-turn:<recordId>`; updates during a running turn commit the increase since the last commit. (2) Before a turn starts, the client calls `jagentchill.usage.budget.check {sessionKey}` (scope `jagentchill.agent.use`) and the server repeats the check itself when it relays the send — the relay of `server-api.Agent session relay` is the only way a turn starts, so a client that skips the call gains nothing — and again at every `jc_*` tool call at its agent tool endpoint (`server-api.Agent tool endpoint and session binding`); JAgentChill is not an OpenClaw plugin and has no tool hook inside the Gateway: when any applicable hard-stop budget is already exhausted, the send is refused or the tool call blocked with `BUDGET_EXCEEDED` naming the scope and the amount over, and interactive sessions show "Budget reached — <scope>" with "Raise budget" (admins) or "Ask an admin device". (3) When a running turn's committed cost exhausts a hard-stop budget, remaining tool calls of that turn are blocked, the model's final text is still delivered, and the session shows the same banner; a turn is never aborted mid-stream by a budget. Blocking uses the two controls the server has: a `jc_*` tool call is refused at the tool endpoint with `BUDGET_EXCEEDED`; a native OpenClaw tool call (exec, file, `sessions_spawn` and the like) is blocked by denying its approval request with the reason `BUDGET_EXCEEDED` — only the server answers the Gateway's approval RPCs (`server-api.Approval and question resolution`) — and by tightening the session's tool overrides with `sessions.patch` so that no native tool is offered for the rest of the turn, the mechanism of `multi-agent-orchestration.Team shape enforcement at the tool endpoint`; the overrides are restored when the budget is raised or its period resets. On a runtime whose `nativeToolCoverage` cell (`agent-runtimes.Capability flags per runtime`) says native tools cannot be withheld, native calls that need no approval still run in that turn, the session banner says "Budget reached — this runtime's own tools keep running until the current turn ends", and the next send is refused. (4) The warning threshold (80 %) raises the notification of `notifications.Notification event catalogue` once per scope per period. **Unpriced models — hard-stop rule**: a turn whose model is unpriced (`priceSource: "none"`) is refused before it starts, by `budget.check` and again by the server when it relays the send and at the tool endpoint, with `BUDGET_EXCEEDED` and `details.reason: "unpriced_model"` whenever any applicable hard-stop budget has "Allow unknown-cost models" off — the single rule of `generation-providers.Budgets with hard stop`; the composer then shows "<model> has no price and a spending limit is active" with "Choose another model" and, on admin devices, "Allow unknown-cost models". When every applicable hard-stop budget allows it, the turn runs, commits 0 and budget views state "includes unpriced usage". Turns with `tokenSource: "estimated"` commit their estimated amount and budget views state "includes estimated tokens". Raising or removing a budget is an admin action in every case; no surface bypasses a hard stop. `included` and `unknown` costs commit 0; when the host setting "Count plan-billed turns at list price toward budgets" (`usage.budgetPlanTurnsAtListPrice`, default false) is on, `equivalentCostUsd` is committed instead and budget views label the affected amounts "includes list-price estimates". Budget views state "Plan-billed and unreported turns do not count toward budgets" when the setting is off and such turns exist in the period. Unattended workflow and automation turns follow the same rules and fail their step on `BUDGET_EXCEEDED`. [NEW]

#### Scenario: Session budget in Auto mode
- **WHEN** an Auto-mode session reaches its 5.00 USD session budget during a turn
- **THEN** the next tool call in that turn is blocked with `BUDGET_EXCEEDED`, the turn ends with the model's text, and the composer shows "Budget reached — session" with "Raise budget"

#### Scenario: Send refused before the turn
- **WHEN** a project's hard-stop budget is exhausted and the user presses send
- **THEN** `budget.check` returns blocked, no turn starts, and the draft stays in the composer

#### Scenario: Client skips the budget check
- **WHEN** a project's hard-stop budget is exhausted and a device calls `jagentchill.chat.send` without calling `jagentchill.usage.budget.check` first
- **THEN** the server refuses the send with `BUDGET_EXCEEDED` naming the scope and sends nothing to the Gateway

#### Scenario: Native tool call after the budget is exhausted
- **WHEN** a workspace session's turn exhausts a hard-stop budget and the agent then requests an exec that needs approval and calls `jc_generate_image`
- **THEN** the server denies the approval request with the reason `BUDGET_EXCEEDED`, the tool endpoint refuses `jc_generate_image` with `BUDGET_EXCEEDED`, the turn is not aborted, and the model's final text is delivered

#### Scenario: Plan-billed turns
- **WHEN** a subscription CLI session runs 40 turns with the list-price setting off
- **THEN** no budget amount changes and the budget view shows the caveat line

#### Scenario: Unpriced model under a hard-stop budget
- **WHEN** a session with a hard-stop session budget whose "Allow unknown-cost models" is off selects an unpriced endpoint model and the user sends a message
- **THEN** `budget.check` returns blocked with `details.reason: "unpriced_model"`, no turn starts, and the draft stays in the composer

#### Scenario: Unpriced model allowed
- **WHEN** the same budget has "Allow unknown-cost models" on
- **THEN** the turn runs, commits 0 to the budget, and the budget view states "includes unpriced usage"

### Requirement: Usage live updates
Usage changes SHALL be pushed on channel P as `jagentchill.usage.updated {sessionId, rootSessionId, projectId?}` on stream `usage`, at most one event per session per 2 s while a turn runs and exactly one at each turn's terminal event; clients subscribe with `jagentchill.usage.subscribe` for the sessions and aggregate views on screen and pull with `usage.session.get` or `usage.query` on receipt, on a `seq` gap, and after reconnect. Open aggregate views refresh at most once per 10 s. Events carry identifiers only, never amounts. [NEW]

#### Scenario: Sub-agent finishes
- **WHEN** a peer agent completes a turn while the lead's usage view is open on another device
- **THEN** that device receives one event with the lead's `rootSessionId` and the tree row for the peer updates within 3 s

#### Scenario: Reconnect
- **WHEN** a device reconnects after 5 minutes offline with the Overview open
- **THEN** it re-runs its query once and shows current numbers without waiting for an event

### Requirement: Export CSV
`jagentchill.usage.export {query, detail: "grouped" | "records", idempotencyKey}` (scope `jagentchill.config.read`) SHALL produce a CSV as a content-addressed blob and return `{blobSha256, fileName, rowCount, truncated}`; the client downloads it through `server-api.Authenticated media delivery`. `grouped` exports the rows of the current view. `records` exports one line per agent usage record and per ledger row in the range with the columns, in order: `source`, `timestamp_utc` (ISO 8601), `day_host_tz`, `session_id`, `session_title`, `root_session_id`, `parent_session_id`, `agent`, `role`, `project_id`, `project_name`, `team_run_id`, `workflow_run_id`, `automation_id`, `device_name`, `runtime`, `base_runtime`, `provider`, `model`, `capability`, `billing`, `outcome`, `input_tokens`, `cached_input_tokens`, `cache_write_tokens`, `output_tokens`, `units`, `cost_usd`, `cost_source`, `equivalent_cost_usd`, `duration_ms`, `tool_calls`. Format: UTF-8 with a byte-order mark, comma separator, CRLF line ends, RFC 4180 quoting, dot decimal separator, empty cell for unknown values (never 0), and any cell starting with `=`, `+`, `-` or `@` prefixed with a single quote. File name `jagentchill-usage-<from>-<to>.csv` with dates in the host time zone. At most 1 000 000 lines are exported; beyond that `truncated` is true and the dialog says "Export limited to 1,000,000 rows — narrow the range". Export blobs are deleted after 24 h. Delivery: desktop — save dialog; web — browser download; mobile — share sheet. The export contains no prompt or response text. [NEW]

#### Scenario: Records export
- **WHEN** an admin exports records for last month
- **THEN** a CSV with the header row above and one line per turn and per generation call downloads, and a plan-billed turn's `cost_usd` cell is `0` with `cost_source` `included` while an unknown cost is an empty cell

#### Scenario: Formula-like title
- **WHEN** a session title begins with `=SUM(`
- **THEN** the exported cell begins with a single quote

#### Scenario: Very large range
- **WHEN** the range contains 1.4 million records
- **THEN** the file has 1 000 000 data lines, `truncated` is true, and the dialog shows the limit message

### Requirement: Retention and reset
Raw agent usage records SHALL be kept for 24 months by default (`usage.retentionMonths`, 3–60), matching the generation ledger; a daily purge at 03:00 host time deletes older records in batches of at most 10 000 without blocking writes. Daily rollups and lifetime totals are kept until reset. Plan usage data is never persisted. Deleting a session or project does not delete its usage records. "Reset usage history…" (Settings ▸ Host ▸ Usage, role `admin`, `jagentchill.usage.history.reset {confirm: true, scope: "agent" | "all"}` with scope `jagentchill.config.write`) asks "Reset usage history? Totals, charts and per-session usage on <host name> will start from zero. This cannot be undone." and requires typing the host name; scope `agent` deletes agent usage records, rollups and the agent part of the lifetime total; scope `all` also asks `generation-providers.Usage ledger` to clear its ledger. A reset never changes budget amounts already committed for the current budget periods, never touches the Gateway's own session transcripts, and is recorded in the audit log with the actor device and scope. The erasure procedure of `security-privacy.Data erasure` includes this store. [JAD JD-USE-012] [NEW]

#### Scenario: Reset agent usage
- **WHEN** an admin confirms a reset with scope `agent`
- **THEN** Overview shows no agent usage for any range, generation cost is unchanged, the current month's budget spend is unchanged, and an audit record exists

#### Scenario: Retention purge
- **WHEN** a record is older than the retention period
- **THEN** after the next purge it is absent from record-level queries and exports, and its day's rollup and the lifetime total are unchanged

#### Scenario: Wrong host name
- **WHEN** the admin types a different name in the confirmation field
- **THEN** the "Reset" button stays disabled

### Requirement: Accuracy caveats shown to the user
The product SHALL state, wherever a figure is shown, how reliable it is. Every cost carries one of the labels Reported, Estimated, Included in plan, Unknown; every aggregate carries its `accuracy`. The Usage screen has a persistent "About these numbers" disclosure, and each caveat below is shown inline where it applies:
- "Estimated" — "Calculated from token counts and list prices as of <date>. Your provider's invoice is the source of truth."
- Plan-billed — "This runtime is billed through a subscription. Cost per turn is not available; tokens are shown instead."
- Unreported — "<runtime> does not report token usage. Turns and time are counted; tokens and cost are not."
- Terminal mode — "Sessions run in a terminal are not tracked."
- Imported sessions — "Usage before import is not included."
- Partial turns — "Stopped and failed turns are included with the usage reported before they ended."
- Plan windows — "Reported by <provider> at <time>. Limits can change without notice."
- Projections — run-out times and shortfalls are labelled "Projection".
- Cache savings and equivalent API cost — labelled "estimate".
- Time zone — "Days are in <time zone> (the host's time zone)."
- Attribution — "A session's usage belongs to the project it was in when each turn ran."
No surface shows an estimated or unknown amount without its label, and no surface rounds an unknown cost to zero. Screen readers receive the label as part of the amount ("0.42 dollars, estimated"). [JAD JD-USE-011] [NEW]

#### Scenario: Estimated total on the Overview
- **WHEN** the range's total includes any estimated amount
- **THEN** the tile reads "$12.84 · Estimated" and the disclosure explains the estimate with the price table date

#### Scenario: Screen reader
- **WHEN** a screen reader focuses a session cost that is included in a plan
- **THEN** it announces "Included in plan" and does not announce "zero dollars"

#### Scenario: Unknown is never zero
- **WHEN** every turn in a session has unknown cost
- **THEN** the session cost reads "Unknown" in the indicator, the session view, the Sessions tab and the CSV (empty cell)

### Requirement: Usage permissions and privacy
Reading usage (`usage.query`, `usage.session.get`, `usage.tree.get`, `usage.history.get`, `usage.plan.list`, `usage.export`) SHALL require scope `jagentchill.config.read`, held by all three roles; `usage.budget.check` requires `jagentchill.agent.use`; changing Plan usage switches, retention, the list-price budget setting and resetting history require `jagentchill.config.write` (role `admin`). A `viewer` sees usage read-only. Device names appear in usage only to devices with role `admin`; other roles receive `deviceId: null`. Agents have no tool that reads other sessions' usage; an agent sees only its own session's status through the runtime. Usage records, rollups and plan data are never sent to any external host, are excluded from push notification payloads, and are included in the host backup of `server-api.Host backup and restore`. Diagnostics bundles include only record counts and the last capture error, not usage rows. [NEW]

#### Scenario: Viewer
- **WHEN** a viewer opens the Usage screen
- **THEN** all tabs are readable, export works, and the Plan usage switches and "Reset usage history…" are absent

#### Scenario: Editor and device names
- **WHEN** an editor exports records
- **THEN** the `device_name` column is empty in every line

### Requirement: Usage empty, offline and error states
Each usage surface SHALL define its non-happy states. Not connected: the composer indicator shows the last known values with "Offline"; the Usage screen shows "Connect to this host to see usage" and no cached chart. No usage yet on the host: Overview shows "No usage yet — usage appears after your first agent message or generation" with a link to Home. Capture degraded (the server failed to read usage from events for a runtime, or reconciliation failed three times in a row): the affected runtime's rows carry a warning "Usage capture for <runtime> is incomplete since <time>" and the host health reports `degraded` with reason `usage_capture`; turns keep running. Query failure: tables and charts show "Unable to load usage" with "Retry" and keep the range control usable. A query that exceeds 5 s returns `TIMEOUT` and the UI suggests a shorter range. Database write failure (disk full): usage of affected turns is buffered in memory for at most 1 000 records and written when space returns; beyond that the oldest buffered records are dropped and the degraded warning states the count lost. [NEW]

#### Scenario: Capture failure does not stop the chat
- **WHEN** usage events of one runtime cannot be parsed after a Gateway update
- **THEN** turns on that runtime still complete, their records have `tokenSource: "none"`, and the runtime's usage rows show the incomplete-capture warning

#### Scenario: Disk full
- **WHEN** the host disk is full during three turns and space is freed afterwards
- **THEN** the three records are written from the buffer and totals include them

#### Scenario: Fresh host
- **WHEN** an admin opens Usage before any turn or generation
- **THEN** Overview shows the "No usage yet" message and the other tabs show their empty states without an error

### Requirement: Usage RPC surface
The `usage` domain of `server-api.RPC domain ownership` SHALL consist of exactly the 10 methods of this table and the event `jagentchill.usage.updated` on stream `usage`. The parameters, result and required scope of each method are stated by the requirement named in its row; the one query contract is `usage-tracking.Unified usage query`.

| Method | Defined in |
|---|---|
| `jagentchill.usage.session.get` | `usage-tracking.Session totals` |
| `jagentchill.usage.query` | `usage-tracking.Unified usage query` |
| `jagentchill.usage.tree.get` | `usage-tracking.Agent-tree roll-up` |
| `jagentchill.usage.history.get` | `usage-tracking.Daily rollups and lifetime totals` |
| `jagentchill.usage.plan.list` | `usage-tracking.Plan usage fetching and cache` |
| `jagentchill.usage.budget.check` | `usage-tracking.Budgets hook` |
| `jagentchill.usage.subscribe` | `usage-tracking.Usage live updates` |
| `jagentchill.usage.export` | `usage-tracking.Export CSV` |
| `jagentchill.usage.history.reset` | `usage-tracking.Retention and reset` |
| `jagentchill.usage.unsubscribe` | `usage-tracking.Usage RPC surface` |

`jagentchill.usage.unsubscribe` takes the same selection of sessions and aggregate views as `jagentchill.usage.subscribe` and ends delivery for it; the pull RPCs of the stream are `jagentchill.usage.session.get` and `jagentchill.usage.query`. A handler under `jagentchill.usage.` that this table does not name MUST fail the contract test `rpc-ownership`. [NEW]

#### Scenario: Ownership test is exact
- **WHEN** the contract test `rpc-ownership` compares the server's handlers under `jagentchill.usage.` with this table
- **THEN** the two sets are equal

#### Scenario: Unlisted method
- **WHEN** server code adds a handler `jagentchill.usage.purge`
- **THEN** `rpc-ownership` fails and names the method
